// A file moved in Finder, seen by a scan and then by a relaunch, through
// `dispatch` the way the frontend calls it. Its own test binary, so it owns
// the global engine.
use deja_lib::{dispatch, Meta};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn copy_tree(from: &Path, to: &Path) {
  std::fs::create_dir_all(to).expect("create dir");
  for entry in std::fs::read_dir(from).expect("read fixture dir").flatten() {
    let target = to.join(entry.file_name());
    if entry.file_type().expect("file type").is_dir() {
      copy_tree(&entry.path(), &target);
    } else {
      std::fs::copy(entry.path(), &target).expect("copy fixture");
    }
  }
}

fn entry<'a>(view: &'a Value, rel: &str) -> &'a Value {
  view["entries"].as_array().expect("entries").iter().find(|e| e["relPath"] == rel).expect("entry")
}

#[test]
fn a_file_moved_in_finder_is_still_indexed_after_a_relaunch() {
  let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
  let vault: PathBuf = std::env::temp_dir().join(format!("deja-finder-move-{}-{stamp}", std::process::id()));
  copy_tree(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/vault"), &vault);
  let vault = std::fs::canonicalize(&vault).unwrap();
  let data = vault.with_extension("data");
  std::fs::create_dir_all(&data).unwrap();
  std::fs::write(data.join("settings.json"), r#"{"semantic":false}"#).unwrap();
  std::env::set_var("DEJA_DATA_DIR", &data);

  dispatch("open_vault", &json!({ "path": vault })).expect("open");
  dispatch("index_slice", &json!({ "batch": 100 })).expect("index");
  let noted = Meta { tags: vec!["逆光".into()], rating: 4, note: "别丢".into(), source: None };
  dispatch("save_meta", &json!({ "relPath": "摄影/人像/黄昏逆光-01.jpg", "meta": noted })).expect("note");
  std::fs::create_dir_all(vault.join("摄影/待整理")).unwrap();
  std::fs::rename(vault.join("摄影/人像/黄昏逆光-01.jpg"), vault.join("摄影/待整理/黄昏.jpg")).unwrap();
  dispatch("refresh", &json!({})).expect("refresh");

  // The app quits and starts again: only what was saved to disk is left.
  let relaunched = dispatch("open_vault", &json!({ "path": vault })).expect("reopen");
  assert_eq!(entry(&relaunched, "摄影/待整理/黄昏.jpg")["indexed"], json!(true), "nothing is derived again");

  for dir in [&vault, &data] {
    let _ = std::fs::remove_dir_all(dir);
  }
}
