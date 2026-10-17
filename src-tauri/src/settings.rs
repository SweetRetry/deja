// What the user decides about the app as a whole, as opposed to one vault. It
// lives in its own file next to config.json so the recent-vault writer, which
// rewrites that file wholesale, cannot clobber it.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
  /// Off: no model process and no vectors; search matches names, tags and notes.
  pub semantic: bool,
  /// Seconds the model stays loaded with nothing to do; 0 keeps it loaded.
  pub model_idle_secs: u64,
  /// Folder names skipped anywhere in a vault, on top of scan's built-in list.
  pub ignored: Vec<String>,
}

impl Default for Settings {
  fn default() -> Self {
    Settings { semantic: true, model_idle_secs: 300, ignored: Vec::new() }
  }
}

static CURRENT: Mutex<Option<Settings>> = Mutex::new(None);

fn path() -> PathBuf {
  crate::data_dir().join("settings.json")
}

pub fn get() -> Settings {
  let mut guard = CURRENT.lock().expect("settings lock");
  guard
    .get_or_insert_with(|| {
      std::fs::read_to_string(path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
    })
    .clone()
}

/// A folder name, not a path: trimmed, deduplicated, no separators.
fn normalize(names: Vec<String>) -> Vec<String> {
  let mut out: Vec<String> = Vec::new();
  for name in names {
    let name = name.trim().to_string();
    if !name.is_empty() && !name.contains('/') && !out.contains(&name) {
      out.push(name);
    }
  }
  out
}

/// Returns the settings before and after, so the caller can undo what the
/// old ones started (a model loaded with another idle timeout).
pub fn save(args: &Value) -> Result<(Settings, Settings), String> {
  let mut next: Settings = serde_json::from_value(args.get("settings").cloned().unwrap_or_default())
    .map_err(|e| format!("settings are malformed: {e}"))?;
  next.ignored = normalize(next.ignored);
  let _ = std::fs::create_dir_all(crate::data_dir());
  std::fs::write(path(), serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?)
    .map_err(|e| format!("cannot write settings: {e}"))?;
  let before = get();
  *CURRENT.lock().expect("settings lock") = Some(next.clone());
  Ok((before, next))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn ignored_names_are_folder_names() {
    let names = vec![" exports ".into(), "".into(), "a/b".into(), "exports".into(), "_archive".into()];
    assert_eq!(normalize(names), vec!["exports".to_string(), "_archive".to_string()]);
  }

  #[test]
  fn missing_fields_take_defaults() {
    let parsed: Settings = serde_json::from_str(r#"{"semantic":false}"#).unwrap();
    assert_eq!(parsed, Settings { semantic: false, ..Settings::default() });
  }
}
