// Times one keyword search over a synthetic vault of N files, every file with
// a vector and one in five with a note, then times on their own the note
// sidecar read each search makes per file, and the per-file vector lookup it
// used to make against the one batch query (Vectors::embedded) it makes now.
// Run: cargo run --release --example search_probe -- [files] [scratch dir]
use deja_lib::{color, dispatch, meta, vectors, Meta};
use serde_json::json;
use std::path::PathBuf;
use std::time::{Duration, Instant};

fn median(mut runs: Vec<Duration>) -> Duration {
  runs.sort();
  runs[runs.len() / 2]
}

fn time<T>(runs: usize, mut work: impl FnMut() -> T) -> Duration {
  median((0..runs).map(|_| {
    let started = Instant::now();
    std::hint::black_box(work());
    started.elapsed()
  }).collect())
}

fn main() {
  let count: usize = std::env::args().nth(1).and_then(|n| n.parse().ok()).unwrap_or(10_000);
  let scratch = std::env::args().nth(2).map(PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("deja-search-probe"));
  let root = scratch.join("vault");
  let data = scratch.join("data");
  let _ = std::fs::remove_dir_all(&scratch);
  std::fs::create_dir_all(&data).unwrap();
  std::fs::write(data.join("settings.json"), r#"{"semantic":false}"#).unwrap();
  std::env::set_var("DEJA_DATA_DIR", &data);

  let rels: Vec<String> = (0..count).map(|i| format!("folder-{:03}/picture-{i:05}.png", i % 100)).collect();
  for (i, rel) in rels.iter().enumerate() {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"x").unwrap();
    if i % 5 == 0 {
      let note = Meta { tags: vec!["tag".into()], note: "a note".into(), ..Meta::default() };
      meta::write(&root, rel, &note).unwrap();
    }
  }
  let root = std::fs::canonicalize(&root).unwrap();
  let cache = data.join("cache").join(format!("{:016x}", color::fnv64(root.to_string_lossy().as_bytes())));
  let store = vectors::Vectors::open(&cache.join("vectors.db")).unwrap();
  let vector = vec![0.5f32; vectors::DIM];
  if std::env::var("PROBE_NO_VECTORS").is_err() {
    for rel in &rels {
      store.insert(rel, &vector).unwrap();
    }
  }

  dispatch("open_vault", &json!({ "path": root })).unwrap();
  let search = |query: &str| dispatch("search", &json!({ "query": query, "semantic": false })).unwrap();
  let browse = time(5, || search(""));
  let keyword = time(5, || search("picture-0042"));
  let notes = time(5, || rels.iter().map(|rel| meta::read(&root, rel)).count());
  let lookups = time(5, || rels.iter().filter(|rel| store.has(rel)).count());
  let view = time(5, || dispatch("refresh", &json!({})).unwrap());
  let scan = time(5, || deja_lib::scan::walk_all(&root));
  // One query for every path with a vector, the batch a search could make instead.
  let conn = rusqlite::Connection::open(cache.join("vectors.db")).unwrap();
  let batch = time(5, || {
    let mut statement =
      conn.prepare("SELECT rel_path FROM entries WHERE id IN (SELECT rowid FROM image_vectors)").unwrap();
    let rows: std::collections::HashSet<String> =
      statement.query_map([], |row| row.get(0)).unwrap().flatten().collect();
    rels.iter().filter(|rel| rows.contains(*rel)).count()
  });
  let finds = time(5, || rels.iter().filter(|rel| rels.iter().any(|r| r == *rel)).count());
  println!("{count} files");
  println!("search, empty query      {browse:?}");
  println!("search, keyword query    {keyword:?}");
  println!("  of which, note reads   {notes:?}");
  println!("  of which, vector looks {lookups:?}");
  println!("  linear finds, as before {finds:?}");
  println!("vector looks as 1 query  {batch:?}");
  println!("refresh (walk + view)    {view:?}");
  println!("  of which, walk         {scan:?}");
  let _ = std::fs::remove_dir_all(&scratch);
}
