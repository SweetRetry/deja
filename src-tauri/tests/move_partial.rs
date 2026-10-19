// A move that fails part way, through `dispatch` the way the frontend calls it.
// Its own test binary, so it owns the global engine.
use deja_lib::{color, dispatch};
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

fn rels(view: &Value) -> Vec<String> {
  view["entries"].as_array().expect("entries").iter().map(|e| e["relPath"].as_str().unwrap().to_string()).collect()
}

#[test]
fn a_move_that_fails_part_way_keeps_what_moved() {
  let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
  let vault: PathBuf = std::env::temp_dir().join(format!("deja-move-partial-{}-{stamp}", std::process::id()));
  copy_tree(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/vault"), &vault);
  let vault = std::fs::canonicalize(&vault).unwrap();
  let data = vault.with_extension("data");
  std::fs::create_dir_all(&data).unwrap();
  std::fs::write(data.join("settings.json"), r#"{"semantic":false}"#).unwrap();
  std::env::set_var("DEJA_DATA_DIR", &data);

  dispatch("open_vault", &json!({ "path": vault })).expect("open");
  dispatch("index_slice", &json!({ "batch": 100 })).expect("index");
  // Gone from disk after the vault listed it, as when Finder deletes it first.
  std::fs::remove_file(vault.join("海报/深色海报.jpg")).unwrap();

  let reply = dispatch(
    "move_entries",
    &json!({ "relPaths": ["乱码名-A7f3.jpg", "海报/深色海报.jpg", "摄影/风景/海边-dusk.jpg"], "folder": "UI参考" }),
  )
  .expect("a partial move still answers");
  assert_eq!(
    reply["moved"],
    json!([
      { "from": "乱码名-A7f3.jpg", "to": "UI参考/乱码名-A7f3.jpg" },
      { "from": "摄影/风景/海边-dusk.jpg", "to": "UI参考/海边-dusk.jpg" },
    ]),
    "the files around the failure still move"
  );
  assert!(reply["error"].as_str().unwrap_or("").starts_with("move failed"), "{}", reply["error"]);
  let listed = rels(&reply["view"]);
  assert!(listed.contains(&"UI参考/乱码名-A7f3.jpg".to_string()), "the view is rescanned");
  assert!(!listed.iter().any(|rel| rel == "海报/深色海报.jpg"), "and drops the file that vanished");

  let cache = data.join("cache").join(format!("{:016x}", color::fnv64(vault.to_string_lossy().as_bytes())));
  let saved: Value = serde_json::from_str(&std::fs::read_to_string(cache.join("index.json")).unwrap()).unwrap();
  assert!(saved.get("UI参考/乱码名-A7f3.jpg").is_some(), "the derived data is saved under the new path");
  assert!(saved.get("乱码名-A7f3.jpg").is_none());

  std::fs::remove_file(vault.join("UI参考/海边-dusk.jpg")).unwrap();
  let none = dispatch("move_entries", &json!({ "relPaths": ["UI参考/海边-dusk.jpg"], "folder": "摄影" }));
  assert!(none.unwrap_err().starts_with("move failed"), "a move where nothing moved is an error");

  let _ = std::fs::remove_dir_all(&vault);
  let _ = std::fs::remove_dir_all(&data);
}
