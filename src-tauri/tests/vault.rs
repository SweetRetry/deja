// Integration test over a real folder: the same fixture vault the app shows.
// Proves scanning, metadata round trips, and that a thumbnail lands on disk and
// decodes, without needing the GUI.
use serde_json::json;
use deja_lib::{color, dispatch, meta, scan, thumb};
use std::path::{Path, PathBuf};

fn workspace() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

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

fn temp_vault(name: &str) -> PathBuf {
  let stamp = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .expect("clock")
    .as_nanos();
  let dir = std::env::temp_dir().join(format!("deja-{name}-{}-{stamp}", std::process::id()));
  let _ = std::fs::remove_dir_all(&dir);
  copy_tree(&workspace().join("public/vault"), &dir);
  dir
}

#[test]
fn scans_the_fixture_vault_and_ignores_noise() {
  let vault = temp_vault("scan");
  let files = scan::walk_all(&vault).0;
  let paths: Vec<String> = files.iter().map(|file| file.rel_path.clone()).collect();

  assert_eq!(files.len(), 12, "twelve images, got {paths:?}");
  assert!(paths.contains(&"摄影/人像/黄昏逆光-01.jpg".to_string()));
  assert!(paths.contains(&"乱码名-A7f3.jpg".to_string()), "chinese and ascii names both scan");
  assert!(
    !paths.iter().any(|path| path.starts_with(".deja")),
    "the hidden metadata folder is not media"
  );
  assert!(
    !paths.iter().any(|path| path.contains("node_modules") || path.contains(".git")),
    "ignored folders stay out"
  );
  assert!(!paths.iter().any(|path| path.ends_with("README.md")), "non media is skipped");
  assert!(
    files.iter().all(|file| file.size_bytes > 0 && file.modified > 0 && file.kind == scan::Kind::Image),
    "every entry carries size, mtime and kind"
  );
  let _ = std::fs::remove_dir_all(&vault);
}

// The one test that drives the global engine through `dispatch`, the way the
// frontend does; semantic is off so no model process starts.
#[test]
fn scope_excludes_a_subtree_and_brings_it_back_without_recomputing() {
  let vault = temp_vault("scope");
  // The fixture ships a chosen scope so e2e skips the picker; this is a first open.
  let _ = std::fs::remove_file(vault.join(".deja/scope.json"));
  let data = vault.with_extension("data");
  std::fs::create_dir_all(&data).expect("data dir");
  std::fs::write(data.join("settings.json"), r#"{"semantic":false}"#).expect("settings");
  std::env::set_var("DEJA_DATA_DIR", &data);
  let rels = |view: &serde_json::Value| -> Vec<String> {
    view["entries"].as_array().expect("entries").iter().map(|e| e["relPath"].as_str().unwrap().to_string()).collect()
  };

  let first = dispatch("open_vault", &json!({ "path": vault })).expect("open");
  assert_eq!(first["scope"]["chosen"], json!(false), "no scope.json yet means the user has not picked");
  assert_eq!(first["scope"]["excluded"], json!([]));
  assert_eq!(first["scope"]["tree"][0], json!({ "path": "", "files": 12 }), "the root comes first and counts all");
  assert_eq!(first["total"], json!(12));
  assert_eq!((first["indexed"].clone(), first["phase"].clone()), (json!(0), json!("deriving")));
  let step = dispatch("index_slice", &json!({ "batch": 5 })).expect("index a slice");
  assert_eq!(
    (step["derived"].clone(), step["indexed"].clone(), step["remaining"].clone(), step["total"].clone()),
    (json!(5), json!(5), json!(7), json!(12)),
    "one slice derives exactly its batch and counts what is left"
  );
  let progress = dispatch("index_slice", &json!({ "batch": 100 })).expect("index");
  assert_eq!((progress["indexed"].clone(), progress["remaining"].clone()), (json!(12), json!(0)));
  assert_eq!(progress["derived"], json!(7), "the second slice takes only the rest");
  let idle = dispatch("index_slice", &json!({ "batch": 100 })).expect("idle slice");
  assert_eq!((idle["derived"].clone(), idle["remaining"].clone()), (json!(0), json!(0)));

  let narrowed = dispatch("set_scope", &json!({ "excluded": ["摄影/人像", "摄影/人像/深"] })).expect("set scope");
  assert_eq!(narrowed["scope"]["chosen"], json!(true));
  assert_eq!(narrowed["scope"]["excluded"], json!(["摄影/人像"]), "a path inside another is dropped");
  assert_eq!(narrowed["total"], json!(9));
  assert!(!rels(&narrowed).iter().any(|rel| rel.starts_with("摄影/人像/")), "the subtree left the entries");
  assert!(narrowed["scope"]["tree"].as_array().unwrap().contains(&json!({ "path": "摄影/人像", "files": 3 })), "but stays in the tree");
  assert!(!narrowed["folders"].as_array().unwrap().contains(&json!("摄影/人像")), "and leaves the folder list");
  let raw = std::fs::read_to_string(vault.join(".deja/scope.json")).expect("scope.json written");
  assert_eq!(serde_json::from_str::<serde_json::Value>(&raw).unwrap(), json!({ "excluded": ["摄影/人像"] }));
  let search = dispatch("search", &json!({ "query": "逆光", "semantic": false })).expect("search");
  assert!(!rels(&search).iter().any(|rel| rel.starts_with("摄影/人像/")), "search only sees files in scope");

  let restored = dispatch("set_scope", &json!({ "excluded": [] })).expect("restore");
  assert_eq!(rels(&restored), rels(&first), "every entry is back");
  assert_eq!((restored["indexed"].clone(), restored["phase"].clone()), (json!(12), json!("ready")), "from the cache, nothing pending");
  let _ = std::fs::remove_dir_all(&vault);
  let _ = std::fs::remove_dir_all(&data);
}

#[test]
fn matches_the_shared_contract_file() {
  let contract: serde_json::Value =
    serde_json::from_str(&std::fs::read_to_string(workspace().join("fixtures/expected-vault.json")).expect("contract file"))
      .expect("contract json");
  let expected: Vec<String> = contract["entries"]
    .as_array()
    .expect("entries")
    .iter()
    .map(|row| row["relPath"].as_str().expect("relPath").to_string())
    .collect();
  let vault = temp_vault("contract");
  let actual: Vec<String> = scan::walk_all(&vault).0.iter().map(|file| file.rel_path.clone()).collect();
  assert_eq!(actual, expected, "the scanner and the e2e fixture describe the same vault");
  let _ = std::fs::remove_dir_all(&vault);
}

#[test]
fn metadata_round_trips_through_disk() {
  let vault = temp_vault("meta");
  let rel = "海报/深色海报.jpg";
  assert!(meta::read(&vault, rel).tags.is_empty(), "no file yet means empty meta");

  let written = deja_lib::Meta {
    tags: vec!["深色".into(), "封面,候选".into()],
    rating: 4,
    note: "留白多。\n第二行。".into(),
    source: Some("https://example.com/a".into()),
  };
  meta::write(&vault, rel, &written).expect("write meta");
  let raw = std::fs::read_to_string(meta::meta_path(&vault, rel)).expect("meta file exists");
  assert!(raw.starts_with("---\n"), "frontmatter comes first");
  assert!(raw.contains("tags: [深色, \"封面,候选\"]"), "a comma inside a tag is quoted: {raw}");

  let back = meta::read(&vault, rel);
  assert_eq!(back, written, "what goes in comes out");

  meta::write(&vault, rel, &deja_lib::Meta::default()).expect("clear meta");
  assert!(!meta::meta_path(&vault, rel).exists(), "an empty meta removes the file");
  let _ = std::fs::remove_dir_all(&vault);
}

#[test]
fn thumbnail_lands_on_disk_and_decodes() {
  let vault = temp_vault("thumb");
  let cache = vault.join(".cache");
  let file = scan::walk_all(&vault).0
    .into_iter()
    .find(|file| file.rel_path == "摄影/风景/海边-dusk.jpg")
    .expect("fixture present");

  let computed = thumb::build(&cache, &file);
  let thumb_path = computed.thumb_path.as_deref().expect("a thumbnail path");
  assert!(Path::new(thumb_path).exists(), "thumbnail written to {thumb_path}");

  let bytes = std::fs::read(thumb_path).expect("read thumbnail");
  let image = color::decode_png(&bytes).expect("thumbnail is a decodable png");
  assert!(image.width <= 512 && image.width > 0, "a thumbnail never grows past 512: {}", image.width);
  let (w, h) = (computed.width.expect("width"), computed.height.expect("height"));
  assert!(w > 0 && h > 0, "size probed from the file");
  let expect_height = (image.width as f64 * h as f64 / w as f64).round() as u32;
  assert!(
    (image.height as i64 - expect_height as i64).abs() <= 1,
    "thumbnail keeps the aspect of {}x{}, got {}x{}",
    w,
    h,
    image.width,
    image.height
  );
  assert!(!computed.colors.is_empty(), "dominant colors were computed");
  assert_eq!(computed.dhash.len(), 16, "dhash is a 64 bit value in hex");
  let _ = std::fs::remove_dir_all(&vault);
}
