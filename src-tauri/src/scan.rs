use crate::{IMAGE_EXTS, VIDEO_EXTS};
use std::path::{Path, PathBuf};

/// What a media file is, by its extension.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
  Image,
  Video,
}

impl Kind {
  /// The name the frontend filters and labels by.
  pub fn as_str(self) -> &'static str {
    match self {
      Kind::Image => "image",
      Kind::Video => "video",
    }
  }
}

#[derive(Clone, Debug)]
pub struct RawFile {
  pub rel_path: String,
  pub name: String,
  pub ext: String,
  pub kind: Kind,
  pub size_bytes: u64,
  pub modified: i64,
  pub abs: PathBuf,
}

const IGNORED_DIRS: &[&str] = &["node_modules", "target", "Library", "System"];

fn keep(ext: &str) -> Option<Kind> {
  if IMAGE_EXTS.contains(&ext) {
    Some(Kind::Image)
  } else if VIDEO_EXTS.contains(&ext) {
    Some(Kind::Video)
  } else {
    None
  }
}

fn modified_ms(path: &Path) -> i64 {
  std::fs::metadata(path)
    .and_then(|m| m.modified())
    .ok()
    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

/// Every image and video under `root`, whatever the vault's scope says; dot
/// folders (`.git`, `.deja`) and the built-in list are never media.
pub fn walk(root: &Path) -> Vec<RawFile> {
  walk_all(root).0
}

/// The files `walk` finds, and every folder it went through below `root`,
/// empty ones too, as sorted relative paths.
pub fn walk_all(root: &Path) -> (Vec<RawFile>, Vec<String>) {
  let mut files = Vec::new();
  let mut dirs = Vec::new();
  let mut stack = vec![root.to_path_buf()];
  while let Some(dir) = stack.pop() {
    let entries = match std::fs::read_dir(&dir) {
      Ok(entries) => entries,
      Err(_) => continue,
    };
    for entry in entries.flatten() {
      let path = entry.path();
      let name = entry.file_name().to_string_lossy().to_string();
      if name.starts_with('.') || IGNORED_DIRS.contains(&name.as_str()) {
        continue;
      }
      let file_type = match entry.file_type() {
        Ok(t) => t,
        Err(_) => continue,
      };
      if file_type.is_symlink() {
        continue;
      }
      if file_type.is_dir() {
        if let Ok(rel) = path.strip_prefix(root) {
          dirs.push(rel.to_string_lossy().replace('\\', "/"));
        }
        stack.push(path);
        continue;
      }
      let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
      let Some(kind) = keep(&ext) else { continue };
      let rel_path = path
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| name.clone());
      let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
      files.push(RawFile {
        rel_path,
        name,
        ext,
        kind,
        size_bytes,
        modified: modified_ms(&path),
        abs: path,
      });
    }
  }
  files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
  dirs.sort();
  (files, dirs)
}
