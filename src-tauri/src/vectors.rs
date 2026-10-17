// Vector storage on sqlite-vec: one image vector per file. Text queries and
// "find similar" both search this one table. The scan index stays JSON (small),
// the vectors live in SQLite so a nearest-neighbour query is an index scan, not a walk over
// every file in Rust.
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Once;

pub const DIM: usize = crate::model::DIM;

static LOAD_EXTENSION: Once = Once::new();

fn load_extension() {
  LOAD_EXTENSION.call_once(|| {
    // Registers vec0 for every connection opened afterwards in this process.
    unsafe {
      rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
        sqlite_vec::sqlite3_vec_init as *const (),
      )));
    }
  });
}

fn vector_blob(vector: &[f32]) -> Vec<u8> {
  vector.iter().flat_map(|value| value.to_le_bytes()).collect()
}

pub struct Vectors {
  conn: Connection,
}

impl Vectors {
  pub fn open(path: &Path) -> Result<Self, String> {
    load_extension();
    if let Some(parent) = path.parent() {
      std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    // user_version records the vector width. Vectors of another width cannot be
    // compared with today's queries, so they are dropped and re-embedded.
    let stored: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    if stored != DIM as i64 {
      conn.execute_batch("DROP TABLE IF EXISTS image_vectors;").map_err(|e| format!("schema: {e}"))?;
    }
    // text_vectors held filename text; search never reads it any more.
    conn
      .execute_batch(&format!(
        "PRAGMA journal_mode=WAL;
         PRAGMA user_version={DIM};
         CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, rel_path TEXT UNIQUE NOT NULL);
         DROP TABLE IF EXISTS text_vectors;
         CREATE VIRTUAL TABLE IF NOT EXISTS image_vectors USING vec0(embedding float[{DIM}] distance_metric=cosine);"
      ))
      .map_err(|e| format!("schema: {e}"))?;
    Ok(Self { conn })
  }

  fn row_id(&self, rel_path: &str) -> Result<i64, String> {
    self
      .conn
      .execute(
        "INSERT INTO entries (rel_path) VALUES (?1) ON CONFLICT(rel_path) DO NOTHING",
        params![rel_path],
      )
      .map_err(|e| e.to_string())?;
    self
      .conn
      .query_row("SELECT id FROM entries WHERE rel_path = ?1", params![rel_path], |row| row.get(0))
      .map_err(|e| e.to_string())
  }

  pub fn insert(&self, rel_path: &str, vector: &[f32]) -> Result<(), String> {
    let id = self.row_id(rel_path)?;
    self
      .conn
      .execute(
        "INSERT OR REPLACE INTO image_vectors (rowid, embedding) VALUES (?1, ?2)",
        params![id, vector_blob(vector)],
      )
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn has(&self, rel_path: &str) -> bool {
    self
      .conn
      .query_row(
        "SELECT 1 FROM image_vectors WHERE rowid = (SELECT id FROM entries WHERE rel_path = ?1)",
        params![rel_path],
        |_| Ok(()),
      )
      .is_ok()
  }

  pub fn count(&self) -> usize {
    self
      .conn
      .query_row("SELECT count(*) FROM image_vectors", [], |row| row.get::<_, i64>(0))
      .unwrap_or(0) as usize
  }

  pub fn missing(&self, rel_paths: &[String], limit: usize) -> Vec<String> {
    rel_paths.iter().filter(|rel| !self.has(rel)).take(limit).cloned().collect()
  }

  pub fn nearest(&self, vector: &[f32], k: usize) -> Result<Vec<(String, f32)>, String> {
    let mut statement = self
      .conn
      .prepare(
        "SELECT e.rel_path, v.distance FROM image_vectors v JOIN entries e ON e.id = v.rowid
         WHERE v.embedding MATCH ?1 AND k = ?2 ORDER BY v.distance",
      )
      .map_err(|e| e.to_string())?;
    let rows = statement
      .query_map(params![vector_blob(vector), k as i64], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)? as f32))
      })
      .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
  }

  pub fn vector(&self, rel_path: &str) -> Option<Vec<f32>> {
    let blob: Vec<u8> = self
      .conn
      .query_row(
        "SELECT embedding FROM image_vectors WHERE rowid = (SELECT id FROM entries WHERE rel_path = ?1)",
        params![rel_path],
        |row| row.get(0),
      )
      .ok()?;
    Some(
      blob
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect(),
    )
  }

  pub fn retain(&self, keep: &[String]) -> Result<(), String> {
    let keep_set: std::collections::BTreeSet<&String> = keep.iter().collect();
    let mut statement = self
      .conn
      .prepare("SELECT id, rel_path FROM entries")
      .map_err(|e| e.to_string())?;
    let rows: Vec<(i64, String)> = statement
      .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
      .map_err(|e| e.to_string())?
      .flatten()
      .collect();
    for (id, rel_path) in rows {
      if keep_set.contains(&rel_path) {
        continue;
      }
      let _ = self
        .conn
        .execute("DELETE FROM image_vectors WHERE rowid = ?1", params![id]);
      let _ = self.conn.execute("DELETE FROM entries WHERE id = ?1", params![id]);
    }
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_db(name: &str) -> std::path::PathBuf {
    let stamp = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .expect("clock")
      .as_nanos();
    std::env::temp_dir().join(format!("shelf-vec-{name}-{}-{stamp}.db", std::process::id()))
  }

  fn axis(index: usize) -> Vec<f32> {
    let mut vector = vec![0.0f32; DIM];
    vector[index] = 1.0;
    vector
  }

  #[test]
  fn nearest_neighbour_comes_back_in_distance_order() {
    let path = temp_db("knn");
    let store = Vectors::open(&path).expect("open store");
    store.insert("a.png", &axis(0)).expect("insert a");
    store.insert("b.png", &axis(1)).expect("insert b");
    store.insert("c.png", &axis(2)).expect("insert c");

    let hits = store.nearest(&axis(1), 2).expect("query");
    assert_eq!(hits.first().map(|(rel, _)| rel.as_str()), Some("b.png"), "exact direction wins");
    assert_eq!(hits.len(), 2, "k caps the result set");
    assert!(hits[0].1 <= hits[1].1, "distances ascend");

    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn stored_vector_reads_back_and_marks_the_file() {
    let path = temp_db("readback");
    let store = Vectors::open(&path).expect("open store");
    store.insert("a.png", &axis(3)).expect("insert");

    assert!(store.has("a.png"));
    assert_eq!(store.count(), 1);
    assert_eq!(store.vector("a.png").map(|v| v[3]), Some(1.0));
    assert_eq!(store.missing(&["a.png".to_string(), "b.png".to_string()], 10), vec!["b.png".to_string()]);

    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn opening_an_old_store_drops_the_text_table() {
    let path = temp_db("migrate");
    {
      load_extension();
      let conn = Connection::open(&path).expect("open raw");
      conn
        .execute_batch(&format!(
          "CREATE VIRTUAL TABLE text_vectors USING vec0(embedding float[{DIM}] distance_metric=cosine);"
        ))
        .expect("old schema");
    }
    let store = Vectors::open(&path).expect("open store");
    let tables: i64 = store
      .conn
      .query_row("SELECT count(*) FROM sqlite_master WHERE name = 'text_vectors'", [], |row| row.get(0))
      .expect("count");
    assert_eq!(tables, 0);

    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn vectors_of_another_width_are_dropped_on_open() {
    let path = temp_db("width");
    {
      load_extension();
      let conn = Connection::open(&path).expect("open raw");
      conn
        .execute_batch(
          "PRAGMA user_version=256;
           CREATE TABLE entries (id INTEGER PRIMARY KEY, rel_path TEXT UNIQUE NOT NULL);
           CREATE VIRTUAL TABLE image_vectors USING vec0(embedding float[256] distance_metric=cosine);
           INSERT INTO entries (id, rel_path) VALUES (1, 'old.png');",
        )
        .expect("old schema");
      let mut old = vec![0.0f32; 256];
      old[0] = 1.0;
      conn
        .execute("INSERT INTO image_vectors (rowid, embedding) VALUES (1, ?1)", params![vector_blob(&old)])
        .expect("old row");
    }
    let store = Vectors::open(&path).expect("open store");
    assert_eq!(store.count(), 0, "256-wide vectors are gone");
    store.insert("new.png", &axis(0)).expect("a current-width vector fits");
    assert_eq!(store.count(), 1);
    drop(store);
    assert_eq!(Vectors::open(&path).expect("reopen").count(), 1, "same width survives a reopen");

    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn retain_drops_rows_that_left_the_folder() {
    let path = temp_db("retain");
    let store = Vectors::open(&path).expect("open store");
    store.insert("gone.png", &axis(0)).expect("insert");
    store.insert("here.png", &axis(1)).expect("insert");
    store.retain(&["here.png".to_string()]).expect("retain");

    assert_eq!(store.count(), 1);
    assert!(!store.has("gone.png"));
    assert!(store.has("here.png"));

    let _ = std::fs::remove_file(&path);
  }
}
