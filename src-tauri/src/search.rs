use crate::{color, model, Engine, Entry, ENGINE};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;

#[derive(Deserialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Filter {
  pub kinds: Vec<String>,
  pub orientation: Option<String>,
  pub min_width: Option<u32>,
  pub max_width: Option<u32>,
  pub min_height: Option<u32>,
  pub max_height: Option<u32>,
  pub from: Option<i64>,
  pub to: Option<i64>,
  pub color: Option<String>,
  pub folder: Option<String>,
  pub min_rating: Option<u8>,
  pub tag: Option<String>,
}

fn bigrams(word: &str) -> Vec<String> {
  let chars: Vec<char> = word.chars().filter(|c| !c.is_whitespace()).collect();
  if chars.len() < 2 {
    return Vec::new();
  }
  chars.windows(2).map(|pair| pair.iter().collect::<String>()).collect()
}

/// The query, its own words, and the two-character pieces each word is made of.
pub fn tokens(query: &str) -> Vec<String> {
  let mut seen = BTreeSet::new();
  for word in query.to_lowercase().split_whitespace() {
    seen.insert(word.to_string());
    for gram in bigrams(word) {
      seen.insert(gram);
    }
  }
  seen.into_iter().collect()
}

fn hits(haystack: &str, term: &str) -> f64 {
  if haystack.contains(term) {
    return 1.0 + (term.chars().count() as f64) * 0.1;
  }
  let term_grams = bigrams(term);
  if term_grams.is_empty() {
    return 0.0;
  }
  let hay_grams = bigrams(haystack);
  let overlap = term_grams.iter().filter(|gram| hay_grams.contains(gram)).count();
  overlap as f64 / term_grams.len() as f64
}

/// Name and tags speak loudest, the path supports, the note whispers.
pub fn keyword_score(entry: &Entry, terms: &[String]) -> f64 {
  let name = entry.name.to_lowercase();
  let path = entry.rel_path.replace('/', " ").to_lowercase();
  let tags = entry.meta.tags.join(" ").to_lowercase();
  let note = entry.meta.note.to_lowercase();
  let mut score = 0.0;
  for term in terms {
    score += 3.0 * hits(&name, term);
    score += 3.0 * hits(&tags, term);
    score += 2.0 * hits(&path, term);
    score += 1.0 * hits(&note, term);
  }
  score
}

pub fn passes(entry: &Entry, filter: &Filter) -> bool {
  if !filter.kinds.is_empty() && !filter.kinds.contains(&entry.kind) {
    return false;
  }
  if let Some(folder) = filter.folder.as_deref().filter(|f| !f.is_empty()) {
    if !entry.rel_path.starts_with(&format!("{folder}/")) && entry.rel_path != folder {
      return false;
    }
  }
  if let Some(min) = filter.min_width.filter(|m| *m > 0) {
    if entry.width.unwrap_or(0) < min {
      return false;
    }
  }
  if let Some(max) = filter.max_width.filter(|m| *m > 0) {
    if entry.width.unwrap_or(u32::MAX) > max {
      return false;
    }
  }
  if let Some(min) = filter.min_height.filter(|m| *m > 0) {
    if entry.height.unwrap_or(0) < min {
      return false;
    }
  }
  if let Some(max) = filter.max_height.filter(|m| *m > 0) {
    if entry.height.unwrap_or(u32::MAX) > max {
      return false;
    }
  }
  if let Some(from) = filter.from.filter(|v| *v > 0) {
    if entry.modified < from {
      return false;
    }
  }
  if let Some(to) = filter.to.filter(|v| *v > 0) {
    if entry.modified > to {
      return false;
    }
  }
  if let Some(rating) = filter.min_rating.filter(|r| *r > 0) {
    if entry.meta.rating < rating {
      return false;
    }
  }
  if let Some(tag) = filter.tag.as_deref().filter(|t| !t.is_empty()) {
    if !entry.meta.tags.iter().any(|t| t == tag) {
      return false;
    }
  }
  if let Some(orientation) = filter.orientation.as_deref().filter(|o| !o.is_empty()) {
    let (w, h) = (entry.width.unwrap_or(0), entry.height.unwrap_or(0));
    let actual = if w == 0 || h == 0 {
      ""
    } else if w > h {
      "landscape"
    } else if h > w {
      "portrait"
    } else {
      "square"
    };
    if actual != orientation {
      return false;
    }
  }
  if let Some(hex) = filter.color.as_deref().filter(|c| !c.is_empty()) {
    if !color::palette_matches(&entry.colors, hex) {
      return false;
    }
  }
  true
}

fn orientation_of(entry: &Entry) -> &'static str {
  match (entry.width, entry.height) {
    (Some(w), Some(h)) if w > h => "landscape",
    (Some(w), Some(h)) if h > w => "portrait",
    (Some(_), Some(_)) => "square",
    _ => "",
  }
}

pub(crate) fn sort_static(entries: &mut [Entry], sort: &str) {
  match sort {
    "modified" => entries.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.rel_path.cmp(&b.rel_path))),
    "size" => entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes).then(a.rel_path.cmp(&b.rel_path))),
    "rating" => entries.sort_by(|a, b| b.meta.rating.cmp(&a.meta.rating).then(a.rel_path.cmp(&b.rel_path))),
    _ => entries.sort_by(|a, b| natural_name(a).cmp(&natural_name(b))),
  }
}

fn natural_name(entry: &Entry) -> String {
  entry.name.to_lowercase()
}

fn all_entries(engine: &Engine) -> Vec<Entry> {
  engine
    .files
    .iter()
    .map(|file| crate::entry_view(engine, &file.rel_path).expect("entry exists"))
    .collect()
}

const SEMANTIC_K: usize = 400;

/// Wrapping the query as "<q>的照片" lifted mAP 0.892 → 0.937 on the 148-image
/// eval set and left the 50-image set flat (sidecar/eval).
fn query_text(query: &str) -> String {
  format!("{query}的照片")
}

/// Text→image cosine mapped onto 0..100. Measured over both eval folders:
/// non-matches have median 0.59, matches median 0.66 and 95th pct 0.70.
fn match_percent(cosine: f32) -> u8 {
  (((cosine - 0.58) / 0.12).clamp(0.0, 1.0) * 100.0).round() as u8
}

/// Reciprocal rank fusion: a result that is near the top of both lists wins.
fn fuse(keyword: &[String], semantic: &[String], limit: usize) -> Vec<String> {
  const K: f64 = 60.0;
  let mut scores: std::collections::BTreeMap<String, f64> = Default::default();
  for (rank, rel) in keyword.iter().enumerate() {
    *scores.entry(rel.clone()).or_default() += 1.0 / (K + rank as f64 + 1.0);
  }
  for (rank, rel) in semantic.iter().enumerate() {
    *scores.entry(rel.clone()).or_default() += 1.0 / (K + rank as f64 + 1.0);
  }
  let mut ranked: Vec<(String, f64)> = scores.into_iter().collect();
  ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
  ranked.into_iter().take(limit).map(|(rel, _)| rel).collect()
}

pub fn run(args: &Value) -> Result<Value, String> {
  let query = args.get("query").and_then(Value::as_str).unwrap_or("").trim().to_string();
  let sort = args.get("sort").and_then(Value::as_str).unwrap_or("name").to_string();
  let want_semantic = args.get("semantic").and_then(Value::as_bool).unwrap_or(true);
  let filter: Filter = serde_json::from_value(args.get("filter").cloned().unwrap_or(json!({})))
    .unwrap_or_default();
  let started = std::time::Instant::now();
  // Before the engine lock: a model that idled out takes ~3 s to come back.
  let model_ready =
    want_semantic && crate::settings::get().semantic && !query.is_empty() && model::ready_or_restart();
  let guard = ENGINE.lock().expect("engine lock");
  let engine = guard.as_ref().ok_or("no vault open")?;
  // Swatch counts use every filter but colour, so each swatch says how many
  // files picking it would leave.
  let swatches: Vec<String> = serde_json::from_value(args.get("countColors").cloned().unwrap_or(json!([])))
    .unwrap_or_default();
  let other_filters = Filter { color: None, ..filter.clone() };
  let base: Vec<Entry> = all_entries(engine).into_iter().filter(|e| passes(e, &other_filters)).collect();
  let color_counts: Vec<usize> = swatches
    .iter()
    .map(|hex| base.iter().filter(|entry| color::palette_matches(&entry.colors, hex)).count())
    .collect();
  let pool: Vec<Entry> = base.into_iter().filter(|e| passes(e, &filter)).collect();
  let empty = query.is_empty();
  let mut semantic_used = false;
  let semantic_warm_ms = 0u128;
  let mut scores = serde_json::Map::new();

  let ranked: Vec<Entry> = if empty {
    let mut list = pool;
    sort_static(&mut list, &sort);
    list
  } else {
    let terms = tokens(&query);
    let mut keyword: Vec<(String, f64)> = pool
      .iter()
      .map(|entry| (entry.rel_path.clone(), keyword_score(entry, &terms)))
      .filter(|(_, score)| *score > 0.0)
      .collect();
    keyword.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
    let keyword_order: Vec<String> = keyword.iter().map(|(rel, _)| rel.clone()).collect();

    // Image vectors, not the filename text: the picture is what the query
    // describes. Cosines sit in a narrow band (unrelated queries still score
    // ~0.6), so no cutoff; the ranking carries the signal.
    let mut similarity: std::collections::BTreeMap<String, f32> = Default::default();
    if model_ready {
      let query_item = model::Item { id: "query".into(), text: Some(query_text(&query)), image: None };
      if let Ok(vectors) = model::embed(&[query_item]) {
        if let Some((_, query_vector)) = vectors.first() {
          if let Ok(hits) = engine.vectors.nearest(query_vector, SEMANTIC_K) {
            let in_pool: std::collections::BTreeSet<&String> = pool.iter().map(|entry| &entry.rel_path).collect();
            similarity = hits
              .into_iter()
              .filter(|(rel, _)| in_pool.contains(rel))
              .map(|(rel, distance)| (rel, 1.0 - distance))
              .collect();
          }
        }
      }
    }
    let mut semantic_order: Vec<String> = similarity.keys().cloned().collect();
    semantic_order.sort_by(|a, b| similarity[b].partial_cmp(&similarity[a]).unwrap_or(std::cmp::Ordering::Equal).then(a.cmp(b)));
    semantic_used = !semantic_order.is_empty();

    let order = fuse(&keyword_order, &semantic_order, 400);
    for (index, rel) in order.iter().enumerate() {
      let matched = similarity.get(rel).map(|cosine| match_percent(*cosine));
      scores.insert(rel.clone(), json!({ "rank": index + 1, "match": matched }));
    }
    let mut by_path: std::collections::BTreeMap<String, Entry> =
      pool.into_iter().map(|entry| (entry.rel_path.clone(), entry)).collect();
    order.into_iter().filter_map(|rel| by_path.remove(&rel)).collect()
  };

  Ok(json!({
    "entries": ranked,
    "scores": scores,
    "semantic": semantic_used,
    "warmMs": semantic_warm_ms,
    "tookMs": started.elapsed().as_millis(),
    "colorCounts": color_counts,
  }))
}

pub fn similar(args: &Value) -> Result<Value, String> {
  let rel = args.get("relPath").and_then(Value::as_str).ok_or("relPath is required")?;
  let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(24) as usize;
  let guard = ENGINE.lock().expect("engine lock");
  let engine = guard.as_ref().ok_or("no vault open")?;
  let target = crate::entry_view(engine, rel).ok_or_else(|| format!("{rel} is not in the vault"))?;
  let target_image = engine.vectors.vector(rel);
  let entries: Vec<Entry> = engine.files.iter().filter_map(|f| crate::entry_view(engine, &f.rel_path)).collect();
  let mut rows: Vec<(String, f64, f64, f64)> = Vec::new();
  for entry in &entries {
    if entry.rel_path == target.rel_path {
      continue;
    }
    let hash_score = 1.0 - (color::hamming(&target.dhash, &entry.dhash) as f64 / 64.0);
    let color_score = {
      let a = &target.colors;
      let b = &entry.colors;
      if a.is_empty() || b.is_empty() {
        0.0
      } else {
        let mut best: f64 = 1.0;
        for x in a {
          for y in b {
            if let (Some(lx), Some(ly)) = (color::hex_to_oklab(&x.hex), color::hex_to_oklab(&y.hex)) {
              best = best.min(color::distance(lx, ly) / 0.6);
            }
          }
        }
        (1.0 - best).clamp(0.0, 1.0)
      }
    };
    let vector_score = engine
      .vectors
      .vector(&entry.rel_path)
      .map(|other| match target_image.as_ref() {
        Some(mine) => model::cosine(mine, &other) as f64,
        None => 0.0,
      })
      .unwrap_or(0.0);
    let score = 0.55 * hash_score + 0.25 * color_score + 0.20 * vector_score;
    rows.push((entry.rel_path.clone(), score, hash_score, vector_score));
  }
  rows.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
  let results: Vec<Value> = rows
    .into_iter()
    .take(limit)
    .map(|(rel, score, hash_score, vector_score)| {
      json!({
        "relPath": rel,
        "score": (score * 1000.0).round() / 1000.0,
        "hashScore": (hash_score * 1000.0).round() / 1000.0,
        "vectorScore": (vector_score * 1000.0).round() / 1000.0,
        "orientation": orientation_of(&target),
      })
    })
    .collect();
  Ok(json!({ "results": results }))
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::{ColorShare, Meta};

  fn entry(name: &str, rel: &str, tags: &[&str], note: &str) -> Entry {
    Entry {
      rel_path: rel.into(),
      name: name.into(),
      ext: "png".into(),
      kind: "image".into(),
      size_bytes: 100,
      modified: 1_700_000_000_000,
      width: Some(1200),
      height: Some(800),
      colors: vec![ColorShare { hex: "#1b1b1f".into(), share: 0.7 }],
      dhash: "0000000000000000".into(),
      thumb_path: None,
      indexed: true,
      embedded: false,
      meta: Meta {
        tags: tags.iter().map(|t| t.to_string()).collect(),
        rating: 0,
        note: note.into(),
        source: None,
      },
    }
  }

  #[test]
  fn chinese_query_matches_without_a_space() {
    let item = entry("深色登录-dribbble.png", "UI参考/登录页/深色登录-dribbble.png", &["深色"], "");
    let score = keyword_score(&item, &tokens("深色登录页"));
    assert!(score > 6.0, "bigrams should hit both name and path, got {score}");
  }

  #[test]
  fn tag_hits_outrank_a_path_hit() {
    let tagged = entry("a.png", "misc/a.png", &["黄昏"], "");
    let on_path = entry("b.png", "黄昏/b.png", &[], "");
    let terms = tokens("黄昏");
    assert!(keyword_score(&tagged, &terms) > keyword_score(&on_path, &terms));
  }

  #[test]
  fn unrelated_query_scores_zero() {
    let item = entry("海边.png", "摄影/海边.png", &["海"], "");
    assert_eq!(keyword_score(&item, &tokens("登录按钮")), 0.0);
  }

  #[test]
  fn filters_narrow_by_kind_size_and_color() {
    let item = entry("海边.png", "摄影/海边.png", &[], "");
    let mut filter = Filter { kinds: vec!["video".into()], ..Default::default() };
    assert!(!passes(&item, &filter));
    filter = Filter { orientation: Some("portrait".into()), ..Default::default() };
    assert!(!passes(&item, &filter));
    filter = Filter { min_width: Some(2000), ..Default::default() };
    assert!(!passes(&item, &filter));
    filter = Filter { color: Some("#1b1b1f".into()), ..Default::default() };
    assert!(passes(&item, &filter));
    filter = Filter { color: Some("#00ff00".into()), ..Default::default() };
    assert!(!passes(&item, &filter));
  }

  #[test]
  fn match_percent_spans_the_measured_band() {
    assert_eq!(match_percent(0.50), 0);
    assert_eq!(match_percent(0.61), 25);
    assert_eq!(match_percent(0.67), 75);
    assert_eq!(match_percent(0.80), 100);
  }

  #[test]
  fn fusion_prefers_results_high_in_both_lists() {
    let keyword = vec!["a".to_string(), "b".to_string()];
    let semantic = vec!["b".to_string(), "c".to_string()];
    assert_eq!(fuse(&keyword, &semantic, 3), vec!["b", "a", "c"]);
  }
}
