pub mod color;
pub mod files;
pub mod import;
pub mod meta;
pub mod model;
pub mod scan;
pub mod search;
pub mod settings;
pub mod thumb;
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
}

impl Computed {
  pub fn matches(&self, file: &scan::RawFile) -> bool {
    self.size_bytes == file.size_bytes && self.modified == file.modified
  }
}

pub struct Engine {
  pub root: PathBuf,
  pub cache_dir: PathBuf,
  pub files: Vec<scan::RawFile>,
  pub computed: BTreeMap<String, Computed>,
  pub pending: Vec<usize>,
  pub vectors: vectors::Vectors,
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
  let raw = match std::env::var("SHELF_DATA_DIR") {
    Ok(dir) => PathBuf::from(dir),
    Err(_) => {
      let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
      PathBuf::from(home).join("Library/Application Support/Shelf")
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

fn folders_of(files: &[scan::RawFile]) -> Vec<String> {
  let mut set = std::collections::BTreeSet::new();
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

fn snapshot(engine: &Engine) -> Value {
  let entries: Vec<Entry> = engine
    .files
    .iter()
    .map(|f| entry_from(f, engine.computed.get(&f.rel_path), &engine.root, &engine.vectors))
    .collect();
  let indexed = entries.iter().filter(|e| e.indexed).count();
  let embedded = settled(engine);
  json!({
    "root": engine.root.to_string_lossy(),
    "folders": folders_of(&engine.files),
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
    "refresh" => refresh(),
    "import" => import(args),
    "undo_import" => undo_import(args),
    "take_dirty" => Ok(json!({ "dirty": DIRTY.swap(false, std::sync::atomic::Ordering::SeqCst) })),
    "warm_model" => warm_model(),
    "settings" => serde_json::to_value(settings::get()).map_err(|e| e.to_string()),
    "save_settings" => save_settings(args),
    "selfcheck_requested" => Ok(json!({
      "enabled": std::env::var("SHELF_SELFCHECK").is_ok(),
      "vault": std::env::var("SHELF_SELFCHECK_VAULT").ok(),
      "out": std::env::var("SHELF_SELFCHECK_OUT").ok(),
    })),
    "selfcheck_report" => selfcheck_report(args),
    "model_status" => Ok(json!({ "ready": model::healthy(), "sidecar": model::sidecar_dir().map(|p| p.to_string_lossy().to_string()) })),
    other => Err(format!("unknown command: {other}")),
  }
}

/// Written by the app itself from inside the real window, then the process
/// exits so a harness can read the verdict without touching the UI.
fn selfcheck_report(args: &Value) -> Result<Value, String> {
  let out = std::env::var("SHELF_SELFCHECK_OUT").map_err(|_| "SHELF_SELFCHECK_OUT is not set")?;
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
/// picks up changed ignored folders and the embedding work semantic now owes.
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
  let files = scan::walk(&expanded, &settings::get().ignored);
  let mut computed = load_cache(&cache_dir);
  let keep: std::collections::BTreeSet<String> = files.iter().map(|f| f.rel_path.clone()).collect();
  computed.retain(|rel, _| keep.contains(rel));
  let store = vectors::Vectors::open(&cache_dir.join("vectors.db"))?;
  store.retain(&files.iter().map(|f| f.rel_path.clone()).collect::<Vec<_>>())?;
  let pending: Vec<usize> = files
    .iter()
    .enumerate()
    .filter(|(_, f)| !computed.get(&f.rel_path).map(|c| c.matches(f)).unwrap_or(false))
    .map(|(i, _)| i)
    .collect();
  let engine = Engine { root: expanded.clone(), cache_dir, files, computed, pending, vectors: store };
  let view = snapshot(&engine);
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
        if event.paths.iter().any(|p| !p.to_string_lossy().contains("/.shelf/")) {
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

fn refresh() -> Result<Value, String> {
  let mut guard = ENGINE.lock().expect("engine lock");
  let engine = guard.as_mut().ok_or("no vault open")?;
  let files = scan::walk(&engine.root, &settings::get().ignored);
  let keep: std::collections::BTreeSet<String> = files.iter().map(|f| f.rel_path.clone()).collect();
  engine.computed.retain(|rel, _| keep.contains(rel));
  engine.pending = files
    .iter()
    .enumerate()
    .filter(|(_, f)| !engine.computed.get(&f.rel_path).map(|c| c.matches(f)).unwrap_or(false))
    .map(|(i, _)| i)
    .collect();
  engine.files = files;
  Ok(snapshot(engine))
}

/// Writes dropped items into a vault folder, then rescans so the reply already
/// lists them; the watcher's later dirty flag only repeats the same scan.
fn import(args: &Value) -> Result<Value, String> {
  let folder = args.get("folder").and_then(Value::as_str).unwrap_or("");
  let items: Vec<import::Item> = serde_json::from_value(args.get("items").cloned().unwrap_or(json!([])))
    .map_err(|e| format!("items are malformed: {e}"))?;
  let root = ENGINE.lock().expect("engine lock").as_ref().ok_or("no vault open")?.root.clone();
  let imported = import::import_into(&root, folder, &items)?;
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
  let indexed = engine.computed.len();
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
    .run(tauri::generate_context!())
    .expect("error while running the app");
}

#[tauri::command]
async fn command(name: String, args: Value) -> Result<Value, String> {
  tauri::async_runtime::spawn_blocking(move || dispatch(&name, &args))
    .await
    .map_err(|e| e.to_string())?
}
