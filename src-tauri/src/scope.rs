// Which folders of one vault get indexed. It lives in the vault, in
// `.deja/scope.json`, so it travels with the folder. Exclusion is by subtree,
// so a folder that appears later is in scope until the user says otherwise.
use crate::scan::RawFile;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Scope {
  /// False until the user has picked once; the file existing is the record.
  #[serde(skip)]
  pub chosen: bool,
  pub excluded: Vec<String>,
}

/// One folder of the picker tree, with every image and video under it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FolderCount {
  pub path: String,
  pub files: usize,
}

fn path(root: &Path) -> PathBuf {
  root.join(".deja").join("scope.json")
}

/// Trimmed, deduplicated, and only the outermost of nested paths. The root ("")
/// cannot be excluded, so files at the top level are always in.
pub fn normalize(paths: Vec<String>) -> Vec<String> {
  let trimmed: Vec<String> = paths.iter().map(|p| p.trim().trim_matches('/').to_string()).collect();
  let mut out: Vec<String> = Vec::new();
  for p in &trimmed {
    let inside = trimmed.iter().any(|q| p.starts_with(&format!("{q}/")));
    if !p.is_empty() && !inside && !out.contains(p) {
      out.push(p.clone());
    }
  }
  out.sort();
  out
}

impl Scope {
  pub fn contains(&self, rel_path: &str) -> bool {
    !self.excluded.iter().any(|folder| rel_path.starts_with(&format!("{folder}/")))
  }
}

/// A missing or unreadable file means the user has not picked yet.
pub fn read(root: &Path) -> Scope {
  std::fs::read_to_string(path(root))
    .ok()
    .and_then(|raw| serde_json::from_str::<Scope>(&raw).ok())
    .map(|scope| Scope { chosen: true, excluded: normalize(scope.excluded) })
    .unwrap_or_default()
}

/// Temp file then rename, so a crash never leaves half a scope behind.
pub fn write(root: &Path, excluded: Vec<String>) -> Result<Scope, String> {
  let scope = Scope { chosen: true, excluded: normalize(excluded) };
  let target = path(root);
  let temp = target.with_extension("json.tmp");
  std::fs::create_dir_all(root.join(".deja")).map_err(|e| e.to_string())?;
  std::fs::write(&temp, serde_json::to_string_pretty(&scope).map_err(|e| e.to_string())?)
    .map_err(|e| format!("cannot write scope: {e}"))?;
  std::fs::rename(&temp, &target).map_err(|e| format!("cannot write scope: {e}"))?;
  Ok(scope)
}

/// Every folder that holds media at any depth, the root ("") first, counted
/// over all walked files whatever the scope says.
pub fn tree(files: &[RawFile]) -> Vec<FolderCount> {
  let mut counts: BTreeMap<String, usize> = BTreeMap::from([(String::new(), 0)]);
  for file in files {
    let parts: Vec<&str> = file.rel_path.split('/').collect();
    for i in 0..parts.len() {
      *counts.entry(parts[..i].join("/")).or_default() += 1;
    }
  }
  counts.into_iter().map(|(path, files)| FolderCount { path, files }).collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  fn file(rel: &str) -> RawFile {
    RawFile {
      rel_path: rel.into(),
      name: rel.rsplit('/').next().unwrap_or(rel).into(),
      ext: "jpg".into(),
      kind: crate::scan::Kind::Image,
      size_bytes: 1,
      modified: 1,
      abs: PathBuf::from(rel),
    }
  }

  #[test]
  fn an_excluded_folder_takes_its_subtree_and_nothing_else() {
    let scope = Scope { chosen: true, excluded: vec!["摄影/人像".into()] };
    assert!(!scope.contains("摄影/人像/a.jpg"));
    assert!(!scope.contains("摄影/人像/深/b.jpg"));
    assert!(scope.contains("摄影/风景/c.jpg"));
    assert!(scope.contains("摄影/人像2/d.jpg"), "a sibling sharing the prefix stays in");
    assert!(scope.contains("e.jpg"), "root files are always in");
  }

  #[test]
  fn normalize_keeps_only_the_outermost_distinct_folders() {
    let paths = vec!["a/b".into(), "".into(), " a ".into(), "c/".into(), "c".into(), "/".into(), "ab".into()];
    assert_eq!(normalize(paths), vec!["a".to_string(), "ab".to_string(), "c".to_string()]);
  }

  #[test]
  fn tree_counts_recursively_with_the_root_first() {
    let files = [file("a/b/1.jpg"), file("a/2.jpg"), file("3.jpg")];
    let rows: Vec<(String, usize)> = tree(&files).into_iter().map(|row| (row.path, row.files)).collect();
    assert_eq!(rows, vec![("".into(), 3), ("a".into(), 2), ("a/b".into(), 1)]);
    assert_eq!(tree(&[]), vec![FolderCount { path: String::new(), files: 0 }]);
  }

  #[test]
  fn a_missing_file_is_unchosen_and_a_written_one_reads_back() {
    let root = std::env::temp_dir().join(format!("deja-scope-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    assert_eq!(read(&root), Scope::default());
    let written = write(&root, vec!["x/y".into(), "x".into()]).unwrap();
    assert_eq!(written, Scope { chosen: true, excluded: vec!["x".into()] });
    assert_eq!(read(&root), written);
    let raw = std::fs::read_to_string(path(&root)).unwrap();
    assert_eq!(serde_json::from_str::<serde_json::Value>(&raw).unwrap(), serde_json::json!({ "excluded": ["x"] }));
    let _ = std::fs::remove_dir_all(&root);
  }
}
