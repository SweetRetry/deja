// Integration test over a real folder: the same fixture vault the app shows.
// Proves scanning, metadata round trips, and that a thumbnail lands on disk and
// decodes, without needing the GUI.
use shelf_lib::{color, meta, scan, thumb};
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
  let dir = std::env::temp_dir().join(format!("shelf-{name}-{}-{stamp}", std::process::id()));
  let _ = std::fs::remove_dir_all(&dir);
  copy_tree(&workspace().join("public/vault"), &dir);
  dir
}

#[test]
fn scans_the_fixture_vault_and_ignores_noise() {
  let vault = temp_vault("scan");
  let files = scan::walk(&vault, &[]);
  let paths: Vec<String> = files.iter().map(|file| file.rel_path.clone()).collect();

  assert_eq!(files.len(), 12, "twelve images, got {paths:?}");
  assert!(paths.contains(&"摄影/人像/黄昏逆光-01.jpg".to_string()));
  assert!(paths.contains(&"乱码名-A7f3.jpg".to_string()), "chinese and ascii names both scan");
  assert!(
    !paths.iter().any(|path| path.starts_with(".shelf")),
    "the hidden metadata folder is not media"
  );
  assert!(
    !paths.iter().any(|path| path.contains("node_modules") || path.contains(".git")),
    "ignored folders stay out"
  );
  assert!(!paths.iter().any(|path| path.ends_with("README.md")), "non media is skipped");
  assert!(
    files.iter().all(|file| file.size_bytes > 0 && file.modified > 0 && file.kind == "image"),
    "every entry carries size, mtime and kind"
  );
  let _ = std::fs::remove_dir_all(&vault);
}

#[test]
fn a_folder_the_user_ignores_drops_out_at_any_depth() {
  let vault = temp_vault("ignored");
  let paths: Vec<String> = scan::walk(&vault, &["人像".to_string()])
    .iter()
    .map(|file| file.rel_path.clone())
    .collect();
  assert!(!paths.iter().any(|path| path.contains("/人像/")), "nested 摄影/人像 is skipped, got {paths:?}");
  assert!(paths.contains(&"乱码名-A7f3.jpg".to_string()), "the rest of the vault still scans");
  let _ = std::fs::remove_dir_all(&vault);
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
  let actual: Vec<String> = scan::walk(&vault, &[]).iter().map(|file| file.rel_path.clone()).collect();
  assert_eq!(actual, expected, "the scanner and the e2e fixture describe the same vault");
  let _ = std::fs::remove_dir_all(&vault);
}

#[test]
fn metadata_round_trips_through_disk() {
  let vault = temp_vault("meta");
  let rel = "海报/深色海报.jpg";
  assert!(meta::read(&vault, rel).tags.is_empty(), "no file yet means empty meta");

  let written = shelf_lib::Meta {
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

  meta::write(&vault, rel, &shelf_lib::Meta::default()).expect("clear meta");
  assert!(!meta::meta_path(&vault, rel).exists(), "an empty meta removes the file");
  let _ = std::fs::remove_dir_all(&vault);
}

#[test]
fn thumbnail_lands_on_disk_and_decodes() {
  let vault = temp_vault("thumb");
  let cache = vault.join(".cache");
  let file = scan::walk(&vault, &[])
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
