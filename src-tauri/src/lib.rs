pub mod clipboard;
pub mod color;
pub mod dupes;
pub mod files;
pub mod import;
pub mod meta;
pub mod model;
pub mod scan;
pub mod scope;
pub mod search;
pub mod settings;
pub mod thumb;
pub mod tray;
pub mod vectors;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const IMAGE_EXTS: &[&str] = &[
  "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp", "avif",
];
pub const VIDEO_EXTS: &[&str] = &["mp4", "mov", "m4v", "webm", "mkv"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ColorShare {
  pub hex: String,
  pub share: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
  #[serde(default)]
  pub tags: Vec<String>,
  #[serde(default)]
  pub rating: u8,
  #[serde(default)]
  pub note: String,
  #[serde(default)]
  pub source: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
  pub rel_path: String,
  pub name: String,
  pub ext: String,
  pub kind: String,
  pub size_bytes: u64,
  pub modified: i64,
  pub width: Option<u32>,
  pub height: Option<u32>,
  pub colors: Vec<ColorShare>,
  pub dhash: String,
  pub thumb_path: Option<String>,
  pub indexed: bool,
  pub embedded: bool,
  #[serde(flatten)]
  pub meta: Meta,
}

/// What the indexer derives from the file itself, cached so a second launch
/// does not pay for it again.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Computed {
  pub size_bytes: u64,
  pub modified: i64,
  pub width: Option<u32>,
  pub height: Option<u32>,
  pub colors: Vec<ColorShare>,
  pub dhash: String,
  pub thumb_path: Option<String>,
  /// Which ANALYSIS derived this; an older one is derived again.
  #[serde(default)]
  pub analysis: u32,
}

/// Bumped when what `thumb::build` derives changes. 1: dhash reads the whole
/// picture, not its top-left corner.
pub const ANALYSIS: u32 = 1;

impl Computed {
  pub fn matches(&self, file: &scan::RawFile) -> bool {
    self.analysis == ANALYSIS && self.size_bytes == file.size_bytes && self.modified == file.modified
  }
}

pub struct Engine {
  pub root: PathBuf,
  pub cache_dir: PathBuf,
  /// Only the files in scope: browsing, search and indexing all start here.
  pub files: Vec<scan::RawFile>,
  /// Kept for every walked file, excluded ones too, so bringing a folder back
  /// into scope costs nothing.
  pub computed: BTreeMap<String, Computed>,
  pub pending: Vec<usize>,
  pub vectors: vectors::Vectors,
  pub scope: scope::Scope,
  pub tree: Vec<scope::FolderCount>,
  /// Every folder in scope, empty ones too, so the sidebar can list a folder
  /// before anything is in it.
  pub dirs: Vec<String>,
}

/// What the background work is doing right now. The UI mirrors this instead of
/// inferring it from counters.
pub fn phase_of(pending: usize, embedded: usize, total: usize) -> &'static str {
  if pending > 0 {
    "deriving"
  } else if embedded < total {
    "embedding"
  } else if total == 0 {
    "empty"
  } else {
    "ready"
  }
}

static ENGINE: Mutex<Option<Engine>> = Mutex::new(None);
static DIRTY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Absolute paths this process wrote by import; undo deletes only these.
static IMPORTED: Mutex<std::collections::BTreeSet<PathBuf>> = Mutex::new(std::collections::BTreeSet::new());

/// Always absolute: thumbnail paths are handed to another process (the model
/// sidecar) whose working directory is not ours.
pub fn data_dir() -> PathBuf {
  let raw = match std::env::var("DEJA_DATA_DIR") {
    Ok(dir) => PathBuf::from(dir),
    Err(_) => {
      let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
      PathBuf::from(home).join("Library/Application Support/Deja")
    }
  };
  if raw.is_absolute() {
    raw
  } else {
    std::env::current_dir().map(|cwd| cwd.join(&raw)).unwrap_or(raw)
  }
}

pub fn config_path() -> PathBuf {
  data_dir().join("config.json")
}

pub fn recent_vaults() -> Vec<String> {
  let raw = std::fs::read_to_string(config_path()).unwrap_or_default();
  let value: Value = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
  value
    .get("recent")
    .and_then(Value::as_array)
    .map(|rows| rows.iter().filter_map(|r| r.as_str().map(str::to_string)).collect())
    .unwrap_or_default()
}

fn remember_vault(path: &str) {
  let mut recent = recent_vaults();
  recent.retain(|p| p != path);
  recent.insert(0, path.to_string());
  recent.truncate(8);
  let _ = std::fs::create_dir_all(data_dir());
  let _ = std::fs::write(
    config_path(),
    serde_json::to_string_pretty(&json!({ "recent": recent })).unwrap_or_default(),
  );
  tray::refresh();
}

fn cache_path(root: &Path) -> PathBuf {
  let digest = color::fnv64(root.to_string_lossy().as_bytes());
  data_dir().join("cache").join(format!("{digest:016x}"))
}

fn load_cache(dir: &Path) -> BTreeMap<String, Computed> {
  let raw = std::fs::read_to_string(dir.join("index.json")).unwrap_or_default();
  serde_json::from_str(&raw).unwrap_or_default()
}

fn save_cache(dir: &Path, computed: &BTreeMap<String, Computed>) {
  let _ = std::fs::create_dir_all(dir);
  let _ = std::fs::write(
    dir.join("index.json"),
    serde_json::to_string(computed).unwrap_or_default(),
  );
}

fn folders_of(files: &[scan::RawFile], dirs: &[String]) -> Vec<String> {
  let mut set: std::collections::BTreeSet<String> = dirs.iter().cloned().collect();
  set.insert(String::new());
  for file in files {
    let parts: Vec<&str> = file.rel_path.split('/').collect();
    for i in 1..parts.len() {
      set.insert(parts[..i].join("/"));
    }
  }
  set.into_iter().collect()
}

fn entry_from(file: &scan::RawFile, computed: Option<&Computed>, root: &Path, vectors: &vectors::Vectors) -> Entry {
  Entry {
    rel_path: file.rel_path.clone(),
    name: file.name.clone(),
    ext: file.ext.clone(),
    kind: file.kind.clone(),
    size_bytes: file.size_bytes,
    modified: file.modified,
    width: computed.and_then(|c| c.width),
    height: computed.and_then(|c| c.height),
    colors: computed.map(|c| c.colors.clone()).unwrap_or_default(),
    dhash: computed.map(|c| c.dhash.clone()).unwrap_or_default(),
    thumb_path: computed.and_then(|c| c.thumb_path.clone()),
    indexed: computed.is_some(),
    embedded: vectors.has(&file.rel_path),
    meta: meta::read(root, &file.rel_path),
  }
}

pub fn entry_view(engine: &Engine, rel_path: &str) -> Option<Entry> {
  let file = engine.files.iter().find(|f| f.rel_path == rel_path)?;
  Some(entry_from(file, engine.computed.get(&file.rel_path), &engine.root, &engine.vectors))
}

/// Files the embedder is done with: they have a vector, or they were derived
/// without a thumbnail and so never will. Progress counts these against the
/// total; counting only vectors left a folder with one broken file "embedding"
/// on every launch.
fn settled(engine: &Engine) -> usize {
  // With semantic search off no vector is owed, so every file is settled.
  if !settings::get().semantic {
    return engine.files.len();
  }
  engine
    .files
    .iter()
    .filter(|file| match engine.computed.get(&file.rel_path) {
      Some(computed) if computed.thumb_path.is_none() => true,
      _ => engine.vectors.has(&file.rel_path),
    })
    .count()
}

/// The vault as the frontend first sees it. `sort` matches what the first
/// search will answer with, so the wall does not reorder itself once that lands.
fn snapshot(engine: &Engine, sort: &str) -> Value {
  let mut entries: Vec<Entry> = engine
    .files
    .iter()
    .map(|f| entry_from(f, engine.computed.get(&f.rel_path), &engine.root, &engine.vectors))
    .collect();
  search::sort_static(&mut entries, sort);
  let indexed = entries.iter().filter(|e| e.indexed).count();
  let embedded = settled(engine);
  json!({
    "root": engine.root.to_string_lossy(),
    "scope": { "chosen": engine.scope.chosen, "excluded": engine.scope.excluded, "tree": engine.tree },
    "folders": folders_of(&engine.files, &engine.dirs),
    "entries": entries,
    "indexed": indexed,
    "embedded": embedded,
    "total": engine.files.len(),
    "phase": phase_of(engine.pending.len(), embedded, engine.files.len()),
    "model": { "ready": model::healthy() },
  })
}

pub fn dispatch(name: &str, args: &Value) -> Result<Value, String> {
  match name {
    "open_vault" => open_vault(args),
    "recent" => Ok(json!({ "recent": recent_vaults() })),
    "search" => search::run(args),
    "save_meta" => save_meta(args),
    "index_slice" => index_slice(args),
    "similar" => search::similar(args),
    "entry" => entry(args),
    "reveal" => reveal(args),
    "trash_entries" => trash_entries(args),
    "move_entries" => move_entries(args),
    "create_folder" => create_folder(args),
    "duplicates" => duplicates(),
    "refresh" => refresh(),
    "import" => import(args),
    "clipboard_image" => Ok(json!({ "change": clipboard::change() })),
    "clipboard_preview" => clipboard_preview(),
    "import_clipboard" => import_clipboard(args),
    "undo_import" => undo_import(args),
    "set_scope" => set_scope(args),
    "take_dirty" => Ok(json!({ "dirty": DIRTY.swap(false, std::sync::atomic::Ordering::SeqCst) })),
    "warm_model" => warm_model(),
    "settings" => serde_json::to_value(settings::get()).map_err(|e| e.to_string()),
    "save_settings" => save_settings(args),
    "selfcheck_requested" => Ok(json!({
      "enabled": std::env::var("DEJA_SELFCHECK").is_ok(),
      "vault": std::env::var("DEJA_SELFCHECK_VAULT").ok(),
      "out": std::env::var("DEJA_SELFCHECK_OUT").ok(),
    })),
    "selfcheck_report" => selfcheck_report(args),
    "model_status" => Ok(json!({ "ready": model::healthy(), "sidecar": model::sidecar_dir().map(|p| p.to_string_lossy().to_string()) })),
    other => Err(format!("unknown command: {other}")),
  }
}

/// Written by the app itself from inside the real window, then the process
/// exits so a harness can read the verdict without touching the UI.
fn selfcheck_report(args: &Value) -> Result<Value, String> {
  let out = std::env::var("DEJA_SELFCHECK_OUT").map_err(|_| "DEJA_SELFCHECK_OUT is not set")?;
  let report = args.get("report").cloned().unwrap_or_else(|| json!({}));
  let body = serde_json::to_string_pretty(&report)
    .map_err(|e| e.to_string())?;
  std::fs::write(&out, body).map_err(|e| e.to_string())?;
  std::thread::spawn(|| {
    std::thread::sleep(std::time::Duration::from_millis(600));
    std::process::exit(0);
  });
  Ok(json!({ "written": out }))
}

/// A model loaded under the old settings is stopped; the next search starts it
/// with the new idle timeout. The dirty flag makes the frontend rescan, which
/// picks up the embedding work semantic now owes.
fn save_settings(args: &Value) -> Result<Value, String> {
  let (before, next) = settings::save(args)?;
  if !next.semantic || next.model_idle_secs != before.model_idle_secs {
    model::stop();
  }
  DIRTY.store(true, std::sync::atomic::Ordering::SeqCst);
  serde_json::to_value(next).map_err(|e| e.to_string())
}

fn warm_model() -> Result<Value, String> {
  if !settings::get().semantic {
    return Err("semantic search is off".into());
  }
  let ms = model::ensure_started(std::time::Duration::from_secs(180))?;
  Ok(json!({ "ready": true, "warmMs": ms }))
}

fn open_vault(args: &Value) -> Result<Value, String> {
  let path = args.get("path").and_then(Value::as_str).ok_or("path is required")?;
  let root = PathBuf::from(path);
  let expanded = std::fs::canonicalize(&root).unwrap_or(root);
  if !expanded.is_dir() {
    return Err(format!("{} is not a folder", expanded.to_string_lossy()));
  }
  let cache_dir = cache_path(&expanded);
  let _ = std::fs::create_dir_all(cache_dir.join("thumbs"));
  let mut engine = Engine {
    root: expanded.clone(),
    computed: load_cache(&cache_dir),
    vectors: vectors::Vectors::open(&cache_dir.join("vectors.db"))?,
    cache_dir,
    files: Vec::new(),
    pending: Vec::new(),
    scope: scope::read(&expanded),
    tree: Vec::new(),
    dirs: Vec::new(),
  };
  rescan(&mut engine)?;
  let sort = args.get("sort").and_then(Value::as_str).unwrap_or("name");
  let view = snapshot(&engine, sort);
  remember_vault(&expanded.to_string_lossy());
  *ENGINE.lock().expect("engine lock") = Some(engine);
  watch_folder(&expanded);
  Ok(view)
}

/// FSEvents through `notify`, setting one flag. The frontend polls the flag and
/// asks for a refresh, so a change in Finder shows up within seconds.
fn watch_folder(root: &Path) {
  use notify::{RecursiveMode, Watcher};
  let root = root.to_path_buf();
  std::thread::spawn(move || {
    let Ok(mut watcher) = notify::recommended_watcher(|event: notify::Result<notify::Event>| {
      if let Ok(event) = event {
        if event.paths.iter().any(|p| !p.to_string_lossy().contains("/.deja/")) {
          DIRTY.store(true, std::sync::atomic::Ordering::SeqCst);
        }
      }
    }) else {
      return;
    };
    if watcher.watch(&root, RecursiveMode::Recursive).is_ok() {
      loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
      }
    }
  });
}

/// Carries what is keyed by a file's path to where the file went: its sidecar,
/// the cached derivations with the thumbnail, and the vector.
fn carry(engine: &mut Engine, from: &str, to: &str) {
  let sidecar = meta::meta_path(&engine.root, from);
  let target = meta::meta_path(&engine.root, to);
  if sidecar.exists() {
    if let Some(parent) = target.parent() {
      let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::rename(&sidecar, &target);
  }
  if let Some(mut computed) = engine.computed.remove(from) {
    // The thumbnail is named after the path; one left under the old name
    // would be picked up by the next file to land there.
    let thumb = thumb::path_for(&engine.cache_dir, to);
    if let Some(old) = computed.thumb_path.as_deref() {
      if std::fs::rename(old, &thumb).is_ok() {
        computed.thumb_path = Some(thumb.to_string_lossy().to_string());
      }
    }
    engine.computed.insert(to.to_string(), computed);
  }
  let _ = engine.vectors.rename(from, to);
}

/// Files that moved while the app was not the one moving them (Finder, a
/// shell). A rename keeps a file's size and modified time, so a path that
/// vanished and a path that appeared with the same pair are one file. A pair
/// shared by several paths on either side is not told apart and stays two.
fn moved_outside(computed: &BTreeMap<String, Computed>, walked: &[scan::RawFile]) -> Vec<(String, String)> {
  let present: std::collections::BTreeSet<&str> = walked.iter().map(|f| f.rel_path.as_str()).collect();
  let mut gone: BTreeMap<(u64, i64), Vec<&String>> = BTreeMap::new();
  for (rel, c) in computed {
    if c.modified != 0 && !present.contains(rel.as_str()) {
      gone.entry((c.size_bytes, c.modified)).or_default().push(rel);
    }
  }
  let mut came: BTreeMap<(u64, i64), Vec<&String>> = BTreeMap::new();
  for f in walked {
    if f.modified != 0 && !computed.contains_key(&f.rel_path) {
      came.entry((f.size_bytes, f.modified)).or_default().push(&f.rel_path);
    }
  }
  gone
    .into_iter()
    .filter_map(|(key, from)| match (from.as_slice(), came.get(&key).map(Vec::as_slice)) {
      ([from], Some([to])) => Some((from.to_string(), to.to_string())),
      _ => None,
    })
    .collect()
}

/// Walks the whole vault: the tree and the caches follow what is on disk, and
/// only files in scope become the engine's files and pending work.
fn rescan(engine: &mut Engine) -> Result<(), String> {
  let (walked, dirs) = scan::walk_all(&engine.root);
  for (from, to) in moved_outside(&engine.computed, &walked) {
    // Notes already at the new path are the newer ones; the file starts over.
    if !meta::meta_path(&engine.root, &to).exists() {
      carry(engine, &from, &to);
    }
  }
  let keep: Vec<String> = walked.iter().map(|f| f.rel_path.clone()).collect();
  let keep_set: std::collections::BTreeSet<&String> = keep.iter().collect();
  engine.computed.retain(|rel, _| keep_set.contains(rel));
  engine.vectors.retain(&keep)?;
  engine.tree = scope::tree(&walked);
  // A folder is in scope when what it holds would be.
  engine.dirs = dirs.into_iter().filter(|dir| engine.scope.contains(&format!("{dir}/"))).collect();
  engine.files = walked.into_iter().filter(|f| engine.scope.contains(&f.rel_path)).collect();
  engine.pending = engine
    .files
    .iter()
    .enumerate()
    .filter(|(_, f)| !engine.computed.get(&f.rel_path).map(|c| c.matches(f)).unwrap_or(false))
    .map(|(i, _)| i)
    .collect();
  Ok(())
}

fn refresh() -> Result<Value, String> {
  let mut guard = ENGINE.lock().expect("engine lock");
  let engine = guard.as_mut().ok_or("no vault open")?;
  rescan(engine)?;
  Ok(snapshot(engine, "name"))
}

/// Saves the folders the user left out and answers with the view they leave.
/// The first save is what marks the scope as chosen.
fn set_scope(args: &Value) -> Result<Value, String> {
  let excluded: Vec<String> = serde_json::from_value(args.get("excluded").cloned().unwrap_or(json!([])))
    .map_err(|e| format!("excluded is malformed: {e}"))?;
  let mut guard = ENGINE.lock().expect("engine lock");
  let engine = guard.as_mut().ok_or("no vault open")?;
  engine.scope = scope::write(&engine.root, excluded)?;
  rescan(engine)?;
  Ok(snapshot(engine, "name"))
}

/// Writes dropped items into a vault folder, then rescans so the reply already
/// lists them; the watcher's later dirty flag only repeats the same scan.
fn import(args: &Value) -> Result<Value, String> {
  let folder = args.get("folder").and_then(Value::as_str).unwrap_or("");
  let items: Vec<import::Item> = serde_json::from_value(args.get("items").cloned().unwrap_or(json!([])))
    .map_err(|e| format!("items are malformed: {e}"))?;
  import_items(folder, &items)
}

/// A small png of the clipboard's picture as a data URL, with its pixel size,
/// for the offer to show before the user takes it.
fn clipboard_preview() -> Result<Value, String> {
  use base64::Engine as _;
  let picture = clipboard::read().ok_or("the clipboard holds no image")?;
  let dir = data_dir().join("clipboard");
  std::fs::create_dir_all(&dir).map_err(|e| format!("preview failed: {e}"))?;
  let source = dir.join(format!("source.{}", import::sniff(&picture.bytes).unwrap_or("png")));
  let small = dir.join("preview.png");
  std::fs::write(&source, &picture.bytes).map_err(|e| format!("preview failed: {e}"))?;
  let (width, height) = files::sips_size(&source);
  let args = ["-Z", "320", "-s", "format", "png"].map(String::from).into_iter()
    .chain([source.to_string_lossy().into(), "--out".into(), small.to_string_lossy().into()])
    .collect::<Vec<_>>();
  let scaled = files::run("sips", &args).and_then(|_| std::fs::read(&small).ok());
  let _ = std::fs::remove_file(&source);
  let _ = std::fs::remove_file(&small);
  let bytes = scaled.ok_or("preview failed")?;
  let url = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes));
  Ok(json!({ "url": url, "width": width, "height": height }))
}

/// The picture on the clipboard, imported the way a dropped one is.
fn import_clipboard(args: &Value) -> Result<Value, String> {
  let folder = args.get("folder").and_then(Value::as_str).unwrap_or("");
  use base64::Engine as _;
  let picture = clipboard::read().ok_or("the clipboard holds no image")?;
  let url = format!("data:;base64,{}", base64::engine::general_purpose::STANDARD.encode(&picture.bytes));
  import_items(folder, &[import::Item { url, name: Some("剪贴板图片".into()), source: None }])
}

fn import_items(folder: &str, items: &[import::Item]) -> Result<Value, String> {
  let root = ENGINE.lock().expect("engine lock").as_ref().ok_or("no vault open")?.root.clone();
  let imported = import::import_into(&root, folder, items)?;
  IMPORTED.lock().expect("imported lock").extend(imported.iter().map(|rel| root.join(rel)));
  Ok(json!({ "imported": imported, "view": refresh()? }))
}

/// Takes back an import. Paths it did not write are refused, so the UI cannot
/// be used to delete the user's own files.
fn undo_import(args: &Value) -> Result<Value, String> {
  let rels: Vec<String> = serde_json::from_value(args.get("relPaths").cloned().unwrap_or(json!([])))
    .map_err(|e| format!("relPaths are malformed: {e}"))?;
  let root = ENGINE.lock().expect("engine lock").as_ref().ok_or("no vault open")?.root.clone();
  let mut imported = IMPORTED.lock().expect("imported lock");
  if let Some(rel) = rels.iter().find(|rel| !imported.contains(&root.join(rel))) {
    return Err(format!("{rel} was not imported here"));
  }
  import::remove(&root, &rels)?;
  for rel in &rels {
    imported.remove(&root.join(rel));
  }
  drop(imported);
  Ok(json!({ "view": refresh()? }))
}

fn entry(args: &Value) -> Result<Value, String> {
  let rel = args.get("relPath").and_then(Value::as_str).ok_or("relPath is required")?;
  let guard = ENGINE.lock().expect("engine lock");
  let engine = guard.as_ref().ok_or("no vault open")?;
  serde_json::to_value(entry_view(engine, rel).ok_or_else(|| format!("{rel} is not in the vault"))?)
    .map_err(|e| e.to_string())
}

/// Selects the file in Finder. Only paths the vault already lists are accepted,
/// so the UI cannot be used to open arbitrary locations.
fn reveal(args: &Value) -> Result<Value, String> {
  let rel = args.get("relPath").and_then(Value::as_str).ok_or("relPath is required")?;
  let path = {
    let guard = ENGINE.lock().expect("engine lock");
    let engine = guard.as_ref().ok_or("no vault open")?;
    if !engine.files.iter().any(|file| file.rel_path == rel) {
      return Err(format!("{rel} is not in the vault"));
    }
    engine.root.join(rel)
  };
  std::process::Command::new("open")
    .arg("-R")
    .arg(&path)
    .status()
    .map_err(|e| format!("reveal failed: {e}"))?;
  Ok(json!({ "revealed": true }))
}

fn rel_paths(args: &Value) -> Result<Vec<String>, String> {
  serde_json::from_value(args.get("relPaths").cloned().unwrap_or(json!([])))
    .map_err(|e| format!("relPaths are malformed: {e}"))
}

/// Only what the vault already lists may be deleted or moved, so the UI cannot
/// be used to touch arbitrary locations. Checked for every path before any moves.
fn listed(engine: &Engine, rels: &[String]) -> Result<(), String> {
  match rels.iter().find(|rel| !engine.files.iter().any(|file| &file.rel_path == *rel)) {
    Some(rel) => Err(format!("{rel} is not in the vault")),
    None => Ok(()),
  }
}

/// Moves files the vault lists to the system Trash in one request and
/// rescans, so the reply already leaves them out. A request that fails part
/// way leaves some files moved; the reply says which by looking at the disk.
fn trash_entries(args: &Value) -> Result<Value, String> {
  let rels = rel_paths(args)?;
  let root = {
    let guard = ENGINE.lock().expect("engine lock");
    let engine = guard.as_ref().ok_or("no vault open")?;
    listed(engine, &rels)?;
    engine.root.clone()
  };
  let into = std::env::var_os("DEJA_TRASH_DIR").map(PathBuf::from);
  let paths: Vec<PathBuf> = rels.iter().map(|rel| root.join(rel)).collect();
  let error = files::trash(&paths, into.as_deref()).err();
  let trashed: Vec<&String> = rels.iter().filter(|rel| !root.join(rel).exists()).collect();
  // The sidecar stays behind, so putting the file back restores its tags.
  Ok(json!({ "trashed": trashed, "error": error, "view": refresh()? }))
}

/// Moves files into another vault folder, numbering a name that is taken the
/// way Finder does. Tags, the thumbnail and the vector go along, so nothing is
/// derived again. A file already in the folder stays put.
fn move_entries(args: &Value) -> Result<Value, String> {
  let rels = rel_paths(args)?;
  let folder = args.get("folder").and_then(Value::as_str).unwrap_or("").to_string();
  let mut guard = ENGINE.lock().expect("engine lock");
  let engine = guard.as_mut().ok_or("no vault open")?;
  listed(engine, &rels)?;
  if folder.split('/').any(|part| part == ".." || part.starts_with('.')) {
    return Err(format!("{folder} is not in the vault"));
  }
  let dir = if folder.is_empty() { engine.root.clone() } else { engine.root.join(&folder) };
  if !dir.is_dir() {
    return Err(format!("{folder} is not in the vault"));
  }
  let mut moved: Vec<(String, String)> = Vec::new();
  for rel in &rels {
    let (parent, name) = rel.rsplit_once('/').unwrap_or(("", rel));
    if parent == folder {
      continue;
    }
    let name = import::unique(&dir, name);
    let to = if folder.is_empty() { name.clone() } else { format!("{folder}/{name}") };
    std::fs::rename(engine.root.join(rel), dir.join(&name)).map_err(|e| format!("move failed: {e}"))?;
    carry(engine, rel, &to);
    moved.push((rel.clone(), to));
  }
  rescan(engine)?;
  save_cache(&engine.cache_dir, &engine.computed);
  let moved: Vec<Value> = moved.into_iter().map(|(from, to)| json!({ "from": from, "to": to })).collect();
  Ok(json!({ "moved": moved, "view": snapshot(engine, "name") }))
}

/// Makes an empty folder inside a vault folder and rescans, so the reply
/// already lists it. A name another folder or file holds is refused rather
/// than numbered: the user typed it and should see why it did not land.
fn create_folder(args: &Value) -> Result<Value, String> {
  let parent = args.get("parent").and_then(Value::as_str).unwrap_or("").to_string();
  let name = args.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
  // Finder shows ":" as "/", and a leading dot hides the folder from the walk.
  if name.is_empty() || name.starts_with('.') || name.contains(['/', '\\', ':']) {
    return Err(format!("{name} is not a valid folder name"));
  }
  let mut guard = ENGINE.lock().expect("engine lock");
  let engine = guard.as_mut().ok_or("no vault open")?;
  if !parent.is_empty() && !engine.dirs.contains(&parent) {
    return Err(format!("{parent} is not in the vault"));
  }
  let rel = if parent.is_empty() { name.clone() } else { format!("{parent}/{name}") };
  let dir = engine.root.join(&rel);
  if dir.exists() {
    return Err(format!("{rel} already exists"));
  }
  std::fs::create_dir(&dir).map_err(|e| format!("create folder failed: {e}"))?;
  rescan(engine)?;
  Ok(json!({ "folder": rel, "view": snapshot(engine, "name") }))
}

/// Copies across the whole vault. Only files whose size another file shares are
/// read, since only those can be byte copies.
fn duplicates() -> Result<Value, String> {
  let guard = ENGINE.lock().expect("engine lock");
  let engine = guard.as_ref().ok_or("no vault open")?;
  let entries: Vec<Entry> = engine.files.iter().filter_map(|f| entry_view(engine, &f.rel_path)).collect();
  let mut sizes: BTreeMap<u64, usize> = BTreeMap::new();
  for file in &engine.files {
    *sizes.entry(file.size_bytes).or_default() += 1;
  }
  let digests: BTreeMap<String, u64> = engine
    .files
    .iter()
    .filter(|file| sizes[&file.size_bytes] > 1)
    .filter_map(|file| std::fs::read(&file.abs).ok().map(|bytes| (file.rel_path.clone(), color::fnv64(&bytes))))
    .collect();
  Ok(json!({ "groups": dupes::groups(&entries, &digests) }))
}

fn save_meta(args: &Value) -> Result<Value, String> {
  let rel = args
    .get("relPath")
    .and_then(Value::as_str)
    .ok_or("relPath is required")?
    .to_string();
  let meta: Meta = serde_json::from_value(args.get("meta").cloned().unwrap_or(json!({})))
    .map_err(|e| format!("meta is malformed: {e}"))?;
  let guard = ENGINE.lock().expect("engine lock");
  let engine = guard.as_ref().ok_or("no vault open")?;
  meta::write(&engine.root, &rel, &meta)?;
  let mut view = entry_view(engine, &rel).ok_or_else(|| format!("{rel} is not in the vault"))?;
  view.meta = meta;
  serde_json::to_value(view).map_err(|e| e.to_string())
}

/// One slice of background work: derive thumbnails and analysis for `batch`
/// files, then embed whatever still has no vector. The frontend calls this in a
/// loop and stops calling it to pause.
fn index_slice(args: &Value) -> Result<Value, String> {
  let batch = args.get("batch").and_then(Value::as_u64).unwrap_or(2) as usize;
  let model_ready = settings::get().semantic && model::ready_or_restart();
  let mut guard = ENGINE.lock().expect("engine lock");
  let engine = guard.as_mut().ok_or("no vault open")?;
  let derived = batch.min(engine.pending.len());
  for _ in 0..derived {
    let index = engine.pending.remove(0);
    let file = engine.files[index].clone();
    let computed = thumb::build(&engine.cache_dir, &file);
    engine.computed.insert(file.rel_path.clone(), computed);
  }

  let mut embedded_now = 0usize;
  let mut embed_error: Option<String> = None;
  // Only files with a thumbnail can be embedded; the rest would be retried forever.
  let thumbs: BTreeMap<String, String> = engine
    .files
    .iter()
    .filter_map(|file| {
      let thumb = engine.computed.get(&file.rel_path)?.thumb_path.clone()?;
      Some((file.rel_path.clone(), thumb))
    })
    .collect();
  if model_ready {
    let paths: Vec<String> = thumbs.keys().cloned().collect();
    let items: Vec<model::Item> = engine
      .vectors
      .missing(&paths, batch.max(1))
      .into_iter()
      .map(|rel| model::Item { image: Some(thumbs[&rel].clone()), id: rel, text: None })
      .collect();
    for chunk in items.chunks(8) {
      match model::embed(chunk) {
        Ok(rows) => {
          for (rel, vector) in rows {
            if engine.vectors.insert(&rel, &vector).is_ok() {
              embedded_now += 1;
            }
          }
        }
        Err(error) => embed_error = Some(error),
      }
    }
  }

  if derived > 0 || embedded_now > 0 {
    save_cache(&engine.cache_dir, &engine.computed);
  }
  let indexed = engine.files.iter().filter(|f| engine.computed.contains_key(&f.rel_path)).count();
  let embedded = settled(engine);
  Ok(json!({
    "indexed": indexed,
    "embedded": embedded,
    "total": engine.files.len(),
    "remaining": engine.pending.len(),
    "phase": phase_of(engine.pending.len(), embedded, engine.files.len()),
    "derived": derived,
    "embeddedNow": embedded_now,
    "modelReady": model::healthy(),
    "modelError": embed_error,
  }))
}

pub fn run_tauri() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![command])
    .setup(|app| Ok(tray::install(app.handle())?))
    // Closing hides the window; the menu bar icon quits.
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building the app")
    .run(|app, event| {
      // A Dock click brings back the window that closing hid.
      #[cfg(target_os = "macos")]
      if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = event {
        tray::show_window(app);
      }
      let _ = (app, event);
    });
}

#[tauri::command]
async fn command(name: String, args: Value) -> Result<Value, String> {
  tauri::async_runtime::spawn_blocking(move || dispatch(&name, &args))
    .await
    .map_err(|e| e.to_string())?
}
