// Managing files through `dispatch`, the way the frontend does: finding copies,
// moving and trashing in batches. Its own test binary, so it owns the global
// engine without racing the scope test in vault.rs.
use deja_lib::{dispatch, meta, Meta};
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
fn copies_are_found_then_moved_and_trashed_in_batches() {
  let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
  let vault: PathBuf = std::env::temp_dir().join(format!("deja-manage-{}-{stamp}", std::process::id()));
  copy_tree(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/vault"), &vault);
  let data = vault.with_extension("data");
  let trash = vault.with_extension("trash");
  std::fs::create_dir_all(&data).unwrap();
  std::fs::write(data.join("settings.json"), r#"{"semantic":false}"#).unwrap();
  std::env::set_var("DEJA_DATA_DIR", &data);
  std::env::set_var("DEJA_TRASH_DIR", &trash);

  // A byte copy in another folder, and a half-size re-save under another name.
  std::fs::copy(vault.join("海报/深色海报.jpg"), vault.join("UI参考/深色海报.jpg")).unwrap();
  let small = vault.join("摄影/风景/海边-小.jpg");
  let resized = std::process::Command::new("sips")
    .args(["-Z", "320", "-s", "formatOptions", "60"])
    .arg(vault.join("摄影/风景/海边-dusk.jpg"))
    .arg("--out")
    .arg(&small)
    .output()
    .expect("sips");
  assert!(resized.status.success());

  dispatch("open_vault", &json!({ "path": vault })).expect("open");
  dispatch("index_slice", &json!({ "batch": 100 })).expect("index");
  let found = dispatch("duplicates", &json!({})).expect("duplicates");
  assert_eq!(
    found["groups"],
    json!([
      // The fixture ships these two as the same bytes under two names.
      { "paths": ["摄影/人像/黄昏逆光-01.jpg", "摄影/人像/黄昏逆光-02.jpg"], "exact": true },
      { "paths": ["摄影/风景/海边-dusk.jpg", "摄影/风景/海边-小.jpg"], "exact": false },
      { "paths": ["海报/深色海报.jpg", "UI参考/深色海报.jpg"], "exact": true },
    ]),
    "the re-save and each copy follow the file to keep: the larger, then the older"
  );

  // Moving carries the tags and the derived thumbnail, and numbers a taken name.
  let tagged = Meta { tags: vec!["夜".into()], ..Meta::default() };
  dispatch("save_meta", &json!({ "relPath": "海报/深色海报.jpg", "meta": tagged })).expect("tag");
  let moved = dispatch("move_entries", &json!({ "relPaths": ["海报/深色海报.jpg", "UI参考/深色海报.jpg"], "folder": "摄影" }))
    .expect("move");
  assert_eq!(
    moved["moved"],
    json!([
      { "from": "海报/深色海报.jpg", "to": "摄影/深色海报.jpg" },
      { "from": "UI参考/深色海报.jpg", "to": "摄影/深色海报 2.jpg" },
    ])
  );
  assert!(vault.join("摄影/深色海报 2.jpg").exists() && !vault.join("海报/深色海报.jpg").exists());
  assert_eq!(meta::read(&vault, "摄影/深色海报.jpg").tags, vec!["夜".to_string()], "the tags went along");
  let view = &moved["view"];
  let entry = view["entries"].as_array().unwrap().iter().find(|e| e["relPath"] == "摄影/深色海报.jpg").unwrap();
  assert_eq!(entry["indexed"], json!(true), "nothing is derived again");
  assert!(Path::new(entry["thumbPath"].as_str().unwrap()).exists());
  assert_eq!(view["phase"], json!("ready"));

  let escape = dispatch("move_entries", &json!({ "relPaths": ["摄影/深色海报.jpg"], "folder": "../elsewhere" }));
  assert!(escape.unwrap_err().contains("is not in the vault"));

  let trashed = dispatch("trash_entries", &json!({ "relPaths": ["摄影/深色海报.jpg", "摄影/深色海报 2.jpg"] }))
    .expect("trash");
  assert_eq!(trashed["trashed"], json!(["摄影/深色海报.jpg", "摄影/深色海报 2.jpg"]));
  assert!(!rels(&trashed["view"]).iter().any(|rel| rel.contains("深色海报")));
  let mut binned: Vec<String> =
    std::fs::read_dir(&trash).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
  binned.sort();
  assert_eq!(binned, vec!["深色海报 2.jpg", "深色海报.jpg"], "two files of one name both reach the Trash");

  let outside = dispatch("trash_entries", &json!({ "relPaths": ["摄影/风景/海边-小.jpg", "../x.jpg"] }));
  assert!(outside.unwrap_err().contains("is not in the vault"));
  assert!(small.exists(), "a batch with one bad path touches nothing");

  // A new folder is listed while still empty, so files can move into it.
  let made = dispatch("create_folder", &json!({ "parent": "摄影", "name": " 待整理 " })).expect("create");
  assert_eq!(made["folder"], json!("摄影/待整理"));
  assert!(vault.join("摄影/待整理").is_dir());
  assert!(made["view"]["folders"].as_array().unwrap().contains(&json!("摄影/待整理")));
  let again = dispatch("create_folder", &json!({ "parent": "摄影", "name": "待整理" }));
  assert!(again.unwrap_err().contains("already exists"));
  for bad in ["", "  ", ".隐藏", "a/b", "a:b"] {
    let refused = dispatch("create_folder", &json!({ "parent": "", "name": bad }));
    assert!(refused.unwrap_err().contains("is not a valid folder name"), "{bad:?}");
  }
  let escape = dispatch("create_folder", &json!({ "parent": "../elsewhere", "name": "x" }));
  assert!(escape.unwrap_err().contains("is not in the vault"));
  let filed = dispatch("move_entries", &json!({ "relPaths": ["摄影/风景/海边-小.jpg"], "folder": "摄影/待整理" }))
    .expect("move into the new folder");
  assert_eq!(filed["moved"], json!([{ "from": "摄影/风景/海边-小.jpg", "to": "摄影/待整理/海边-小.jpg" }]));

  // A move made in Finder is seen on the next scan: the notes and the derived
  // work follow the file, found by its size and modified time.
  let before = vault.join("摄影/人像/黄昏逆光-01.jpg");
  let after = vault.join("摄影/待整理/黄昏.jpg");
  let noted = Meta { tags: vec!["逆光".into()], rating: 4, note: "别丢".into(), source: None };
  dispatch("save_meta", &json!({ "relPath": "摄影/人像/黄昏逆光-01.jpg", "meta": noted })).expect("note");
  std::fs::rename(&before, &after).unwrap();
  let seen = dispatch("refresh", &json!({})).expect("refresh");
  assert_eq!(meta::read(&vault, "摄影/待整理/黄昏.jpg"), noted, "the notes went along");
  assert!(!meta::meta_path(&vault, "摄影/人像/黄昏逆光-01.jpg").exists(), "none are left behind");
  let entry = seen["entries"].as_array().unwrap().iter().find(|e| e["relPath"] == "摄影/待整理/黄昏.jpg").unwrap();
  assert_eq!(entry["indexed"], json!(true), "nothing is derived again");
  assert!(Path::new(entry["thumbPath"].as_str().unwrap()).exists());
  assert_eq!(entry["note"], json!("别丢"));

  for dir in [&vault, &data, &trash] {
    let _ = std::fs::remove_dir_all(dir);
  }
}
