// A Model Context Protocol server over Streamable HTTP, so an agent on this
// machine (Claude Code, Cursor, anything that speaks MCP) can search the open
// vault, look at a file, and tag it. It lives inside the app rather than in a
// separate process so it shares the one engine and the one model: a second
// process would load another gigabyte of model and race the app on the cache.
//
// Only POST with a JSON reply is offered; there is nothing for the server to
// push, so no SSE stream and no session. It listens on loopback alone and
// refuses a Host or Origin that is not loopback, which keeps a web page from
// reaching it through DNS rebinding.
use crate::{http, search, Entry, Meta};
use base64::Engine as _;
use serde_json::{json, Value};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub const DEFAULT_PORT: u16 = 5178;
const VERSIONS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26"];
const SEARCH_LIMIT: usize = 20;

pub fn port() -> u16 {
  std::env::var("DEJA_MCP_PORT").ok().and_then(|value| value.parse().ok()).unwrap_or(DEFAULT_PORT)
}

pub fn url() -> String {
  format!("http://127.0.0.1:{}/mcp", port())
}

static STOP: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

pub fn running() -> bool {
  STOP.lock().expect("mcp lock").is_some()
}

/// Starts or stops the listener to match `enabled`. Calling it twice with the
/// same value does nothing. Fails only when the port is taken.
pub fn apply(enabled: bool) -> Result<(), String> {
  let mut running = STOP.lock().expect("mcp lock");
  match (enabled, running.take()) {
    (true, Some(stop)) => *running = Some(stop),
    (false, None) => {}
    (false, Some(stop)) => {
      stop.store(true, Ordering::SeqCst);
      // accept() blocks; a connection wakes it to see the flag.
      let _ = TcpStream::connect(("127.0.0.1", port()));
    }
    (true, None) => {
      let listener = TcpListener::bind(("127.0.0.1", port())).map_err(|e| format!("port {} is taken: {e}", port()))?;
      let stop = Arc::new(AtomicBool::new(false));
      *running = Some(stop.clone());
      std::thread::spawn(move || {
        for stream in listener.incoming() {
          if stop.load(Ordering::SeqCst) {
            break;
          }
          if let Ok(stream) = stream {
            std::thread::spawn(move || serve(&stream));
          }
        }
      });
    }
  }
  Ok(())
}

fn loopback(host: &str) -> bool {
  let name = host.rsplit_once(':').map_or(host, |(name, port)| if port.chars().all(|c| c.is_ascii_digit()) { name } else { host });
  matches!(name, "127.0.0.1" | "localhost" | "[::1]")
}

/// One HTTP exchange. Also called by the e2e backend, which routes `/mcp` here.
pub fn serve(stream: &TcpStream) {
  let Some(request) = http::read(stream) else { return };
  let path = request.path.split('?').next().unwrap_or("");
  let text = |status: &str, body: &str| http::respond(stream, status, &[("Content-Type", "text/plain")], body.as_bytes());
  if !path.ends_with("/mcp") {
    return text("404 Not Found", "the MCP endpoint is /mcp");
  }
  let host_ok = request.header("host").is_some_and(loopback);
  let origin_ok = request.header("origin").map_or(true, |origin| {
    origin.strip_prefix("http://").or_else(|| origin.strip_prefix("https://")).is_some_and(loopback)
  });
  if !host_ok || !origin_ok {
    return text("403 Forbidden", "only clients on this machine may connect");
  }
  if request.method != "POST" {
    return http::respond(stream, "405 Method Not Allowed", &[("Allow", "POST")], b"");
  }
  let reply = match serde_json::from_slice::<Value>(&request.body) {
    Ok(message) => answer(&message),
    Err(e) => Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": e.to_string() } })),
  };
  match reply {
    Some(reply) => http::respond(stream, "200 OK", &[("Content-Type", "application/json")], reply.to_string().as_bytes()),
    None => http::respond(stream, "202 Accepted", &[], b""),
  }
}

/// The JSON-RPC layer: a reply for a request, nothing for a notification.
pub fn answer(message: &Value) -> Option<Value> {
  let error = |id: &Value, code: i64, text: &str| json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": text } });
  if message.is_array() {
    return Some(error(&Value::Null, -32600, "batches are not supported"));
  }
  let id = message.get("id")?;
  let params = message.get("params").cloned().unwrap_or(json!({}));
  let result = match message.get("method").and_then(Value::as_str).unwrap_or("") {
    "initialize" => {
      let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
      json!({
        "protocolVersion": if VERSIONS.contains(&asked) { asked } else { VERSIONS[0] },
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "deja", "title": "Déjà", "version": env!("CARGO_PKG_VERSION") },
        "instructions": "Déjà is the user's local image and video library: the folder open in the Déjà app. \
          Search by what a picture shows or by name, tag and note; every result has an absolute path you can read. \
          Tags, rating and note are the user's own; change them only when asked.",
      })
    }
    "ping" => json!({}),
    "tools/list" => json!({ "tools": tools() }),
    "tools/call" => {
      let name = params.get("name").and_then(Value::as_str).unwrap_or("");
      let args = params.get("arguments").cloned().unwrap_or(json!({}));
      match call(name, &args) {
        Ok(Reply { data, image }) => {
          let mut content = vec![json!({ "type": "text", "text": serde_json::to_string_pretty(&data).unwrap_or_default() })];
          content.extend(image.map(|png| json!({ "type": "image", "data": png, "mimeType": "image/png" })));
          json!({ "content": content, "structuredContent": data, "isError": false })
        }
        Err(problem) => json!({ "content": [{ "type": "text", "text": problem }], "isError": true }),
      }
    }
    other => return Some(error(id, -32601, &format!("unknown method: {other}"))),
  };
  Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn tools() -> Value {
  let path = json!({ "type": "string", "description": "The file's path, relative to the vault or absolute." });
  json!([
    {
      "name": "vault_info",
      "title": "Vault overview",
      "description": "The folder open in Déjà: its path, how many files it has, how far indexing is, its subfolders and every tag in use with its count.",
      "inputSchema": { "type": "object", "properties": {} },
      "annotations": { "readOnlyHint": true },
    },
    {
      "name": "search_assets",
      "title": "Search the vault",
      "description": "Finds images and videos in the vault. A query is matched against what the picture shows (when semantic search is on) and against file names, tags and notes; results come best first. Without a query, lists files matching the filters in `sort` order.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "What to look for, in any language, e.g. \"white dress under a blue sky\"." },
          "folder": { "type": "string", "description": "Only this vault folder and its subfolders, relative to the vault." },
          "tag": { "type": "string", "description": "Only files carrying this tag." },
          "minRating": { "type": "integer", "minimum": 0, "maximum": 5 },
          "kind": { "type": "string", "enum": ["image", "video"] },
          "color": { "type": "string", "description": "A colour family the file's palette contains: red, orange, yellow, green, cyan, blue, purple, pink, brown, black, gray or white." },
          "sort": { "type": "string", "enum": ["name", "modified", "size", "rating"], "description": "Order when there is no query." },
          "limit": { "type": "integer", "minimum": 1, "maximum": 200, "default": SEARCH_LIMIT },
        },
      },
      "annotations": { "readOnlyHint": true },
    },
    {
      "name": "get_asset",
      "title": "Look at a file",
      "description": "One file's details (size, dimensions, main colours, tags, rating, note, source URL) and, for indexed files, a 512px thumbnail you can see.",
      "inputSchema": {
        "type": "object",
        "properties": { "path": path, "thumbnail": { "type": "boolean", "default": true } },
        "required": ["path"],
      },
      "annotations": { "readOnlyHint": true },
    },
    {
      "name": "find_similar",
      "title": "Find similar files",
      "description": "Files that look like the given one, by layout, colour and content; near duplicates first.",
      "inputSchema": {
        "type": "object",
        "properties": { "path": path, "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": SEARCH_LIMIT } },
        "required": ["path"],
      },
      "annotations": { "readOnlyHint": true },
    },
    {
      "name": "update_asset",
      "title": "Tag, rate or annotate a file",
      "description": "Changes a file's tags, rating or note, which Déjà stores as Markdown in the vault's .deja folder. Fields left out stay as they are. The file itself is never touched.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": path,
          "tags": { "type": "array", "items": { "type": "string" }, "description": "Replaces every tag." },
          "addTags": { "type": "array", "items": { "type": "string" } },
          "removeTags": { "type": "array", "items": { "type": "string" } },
          "rating": { "type": "integer", "minimum": 0, "maximum": 5, "description": "0 clears the rating." },
          "note": { "type": "string", "description": "Replaces the note; an empty string clears it." },
        },
        "required": ["path"],
      },
      "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true },
    },
  ])
}

struct Reply {
  data: Value,
  image: Option<String>,
}

impl From<Value> for Reply {
  fn from(data: Value) -> Self {
    Reply { data, image: None }
  }
}

fn call(name: &str, args: &Value) -> Result<Reply, String> {
  let result = match name {
    "vault_info" => vault_info().map(Reply::from),
    "search_assets" => search_assets(args).map(Reply::from),
    "get_asset" => get_asset(args),
    "find_similar" => find_similar(args).map(Reply::from),
    "update_asset" => update_asset(args).map(Reply::from),
    other => return Err(format!("unknown tool: {other}")),
  };
  result.map_err(|problem| match problem.as_str() {
    "no vault open" => "Déjà has no folder open. Ask the user to open one in the Déjà app.".into(),
    _ => problem,
  })
}

/// What every tool says about a file. `path` is what the other tools take back.
fn item(root: &std::path::Path, entry: &Entry) -> Value {
  json!({
    "path": entry.rel_path,
    "absolutePath": root.join(&entry.rel_path),
    "kind": entry.kind,
    "width": entry.width,
    "height": entry.height,
    "tags": entry.meta.tags,
    "rating": entry.meta.rating,
    "note": entry.meta.note,
  })
}

/// A relative path as given, or an absolute one inside the vault made relative.
fn relative(args: &Value) -> Result<String, String> {
  let raw = args.get("path").and_then(Value::as_str).ok_or("path is required")?;
  let root = crate::vault_root()?;
  let rel = std::path::Path::new(raw).strip_prefix(&root).map(|rel| rel.to_string_lossy().into_owned());
  Ok(rel.unwrap_or_else(|_| raw.trim_start_matches("./").to_string()))
}

fn vault_info() -> Result<Value, String> {
  crate::with_engine(|engine| {
    let progress = crate::progress(engine);
    let mut tags: std::collections::BTreeMap<String, usize> = Default::default();
    for file in &engine.files {
      for tag in crate::meta::read(&engine.root, &file.rel_path).tags {
        *tags.entry(tag).or_default() += 1;
      }
    }
    Ok(json!({
      "root": engine.root,
      "files": progress.total,
      "indexed": progress.indexed,
      "embedded": progress.embedded,
      "semanticSearch": crate::settings::get().semantic,
      "folders": crate::folders_of(&engine.files, &engine.dirs),
      "tags": tags,
    }))
  })
}

fn search_assets(args: &Value) -> Result<Value, String> {
  let limit = args.get("limit").and_then(Value::as_u64).map_or(SEARCH_LIMIT, |n| n.clamp(1, 200) as usize);
  let field = |name: &str| args.get(name).cloned().unwrap_or(Value::Null);
  let kinds = args.get("kind").map_or(json!([]), |kind| json!([kind]));
  let found = search::run(&json!({
    "query": args.get("query").and_then(Value::as_str).unwrap_or(""),
    "sort": field("sort"),
    "filter": { "folder": field("folder"), "tag": field("tag"), "minRating": field("minRating"), "color": field("color"), "kinds": kinds },
  }))?;
  let paths: Vec<&str> = found["entries"].as_array().into_iter().flatten().filter_map(|entry| entry["relPath"].as_str()).collect();
  let results = crate::with_engine(|engine| {
    Ok(
      paths
        .iter()
        .take(limit)
        .filter_map(|rel| crate::entry_view(engine, rel))
        .map(|entry| {
          let mut row = item(&engine.root, &entry);
          // The percentage the app shows too; absent for keyword-only matches.
          if let Some(matched) = found["scores"][&entry.rel_path]["match"].as_f64() {
            row["match"] = json!(matched);
          }
          row
        })
        .collect::<Vec<Value>>(),
    )
  })?;
  Ok(json!({ "total": paths.len(), "semantic": found["semantic"], "results": results }))
}

fn get_asset(args: &Value) -> Result<Reply, String> {
  let rel = relative(args)?;
  let (root, entry) = crate::with_engine(|engine| {
    let entry = crate::entry_view(engine, &rel).ok_or_else(|| format!("{rel} is not in the vault"))?;
    Ok((engine.root.clone(), entry))
  })?;
  let mut data = item(&root, &entry);
  data["name"] = json!(entry.name);
  data["sizeBytes"] = json!(entry.size_bytes);
  data["modified"] = json!(entry.modified);
  data["colors"] = json!(entry.colors);
  data["source"] = json!(entry.meta.source);
  let wanted = args.get("thumbnail").and_then(Value::as_bool).unwrap_or(true);
  let image = entry
    .thumb_path
    .filter(|_| wanted)
    .and_then(|thumb| std::fs::read(thumb).ok())
    .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes));
  Ok(Reply { data, image })
}

fn find_similar(args: &Value) -> Result<Value, String> {
  let rel = relative(args)?;
  let limit = args.get("limit").and_then(Value::as_u64).map_or(SEARCH_LIMIT, |n| n.clamp(1, 100) as usize);
  let found = search::similar(&json!({ "relPath": rel, "limit": limit }))?;
  crate::with_engine(|engine| {
    let results: Vec<Value> = found["results"]
      .as_array()
      .into_iter()
      .flatten()
      .filter_map(|row| crate::entry_view(engine, row["relPath"].as_str()?))
      .map(|entry| item(&engine.root, &entry))
      .collect();
    Ok(json!({ "results": results }))
  })
}

fn strings(args: &Value, name: &str) -> Result<Option<Vec<String>>, String> {
  args.get(name).map(|value| serde_json::from_value(value.clone()).map_err(|_| format!("{name} must be a list of strings"))).transpose()
}

/// The new tags: a replacement list if given, then additions, then removals,
/// trimmed and without repeats, in the order first seen.
pub fn retag(current: &[String], replace: Option<Vec<String>>, add: Vec<String>, remove: &[String]) -> Vec<String> {
  let mut next: Vec<String> = Vec::new();
  for tag in replace.unwrap_or_else(|| current.to_vec()).into_iter().chain(add) {
    let tag = tag.trim().to_string();
    if !tag.is_empty() && !next.contains(&tag) && !remove.iter().any(|gone| gone.trim() == tag) {
      next.push(tag);
    }
  }
  next
}

fn update_asset(args: &Value) -> Result<Value, String> {
  let rel = relative(args)?;
  let current = crate::with_engine(|engine| crate::entry_view(engine, &rel).ok_or_else(|| format!("{rel} is not in the vault")))?;
  let rating = match args.get("rating") {
    None => current.meta.rating,
    Some(value) => value.as_u64().filter(|n| *n <= 5).ok_or("rating must be a whole number from 0 to 5")? as u8,
  };
  let meta = Meta {
    tags: retag(&current.meta.tags, strings(args, "tags")?, strings(args, "addTags")?.unwrap_or_default(), &strings(args, "removeTags")?.unwrap_or_default()),
    rating,
    note: args.get("note").and_then(Value::as_str).map_or(current.meta.note.clone(), str::to_string),
    source: current.meta.source.clone(),
  };
  crate::dispatch("save_meta", &json!({ "relPath": rel, "meta": meta }))?;
  // The folder watcher skips .deja, so the window is told directly.
  crate::DIRTY.store(true, Ordering::SeqCst);
  crate::with_engine(|engine| Ok(item(&engine.root, &crate::entry_view(engine, &rel).ok_or("the file is gone")?)))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn tags(list: &[&str]) -> Vec<String> {
    list.iter().map(|tag| tag.to_string()).collect()
  }

  #[test]
  fn initialize_echoes_a_known_version_and_offers_tools() {
    let reply = answer(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } })).unwrap();
    assert_eq!(reply["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(reply["result"]["capabilities"], json!({ "tools": {} }));
    let unknown = answer(&json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": { "protocolVersion": "1999-01-01" } })).unwrap();
    assert_eq!(unknown["result"]["protocolVersion"], "2025-11-25");
  }

  #[test]
  fn a_notification_gets_no_reply() {
    assert_eq!(answer(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })), None);
  }

  #[test]
  fn tools_list_names_every_tool() {
    let reply = answer(&json!({ "jsonrpc": "2.0", "id": "a", "method": "tools/list" })).unwrap();
    let names: Vec<&str> = reply["result"]["tools"].as_array().unwrap().iter().map(|tool| tool["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["vault_info", "search_assets", "get_asset", "find_similar", "update_asset"]);
  }

  #[test]
  fn an_unknown_method_is_a_jsonrpc_error_and_an_unknown_tool_a_tool_error() {
    let method = answer(&json!({ "jsonrpc": "2.0", "id": 3, "method": "resources/list" })).unwrap();
    assert_eq!(method["error"]["code"], -32601);
    let tool = answer(&json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "nope" } })).unwrap();
    assert_eq!(tool["result"]["isError"], true);
    assert_eq!(tool["result"]["content"][0]["text"], "unknown tool: nope");
  }

  #[test]
  fn retag_replaces_then_adds_then_removes() {
    assert_eq!(retag(&tags(&["a", "b"]), None, tags(&["c", " b "]), &tags(&["a"])), tags(&["b", "c"]));
    assert_eq!(retag(&tags(&["a"]), Some(tags(&["x", "x", ""])), vec![], &[]), tags(&["x"]));
  }

  #[test]
  fn only_loopback_hosts_pass() {
    assert!(loopback("127.0.0.1:5178"));
    assert!(loopback("localhost"));
    assert!(loopback("[::1]:5178"));
    assert!(!loopback("evil.example:5178"));
    assert!(!loopback("127.0.0.1.evil.example"));
  }
}
