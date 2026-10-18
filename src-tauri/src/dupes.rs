// Which files are the same picture: byte-identical copies, and re-saves of one
// picture (resized, recompressed, another format) whose dHashes agree.
use crate::{color, Entry};
use serde::Serialize;
use std::collections::BTreeMap;

/// A half-size JPEG re-save of each of 49 real images landed within 4 bits of
/// its original; the closest two distinct images of the 49 sat 5 apart.
const NEAR_BITS: u32 = 4;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Group {
  /// The copy to keep first, then the rest.
  pub paths: Vec<String>,
  /// Every copy has the same bytes; otherwise they are re-saves of one picture.
  pub exact: bool,
}

fn aspect(entry: &Entry) -> Option<f64> {
  match (entry.width, entry.height) {
    (Some(w), Some(h)) if w > 0 && h > 0 => Some(w as f64 / h as f64),
    _ => None,
  }
}

/// Stills only: a clip's hash is its first frame, and many clips open on black.
/// The lead colour must agree too, which keeps flat pictures of different
/// colours (all of which hash to zero) apart.
fn near(a: &Entry, b: &Entry) -> bool {
  if a.kind != "image" || b.kind != "image" || a.dhash.is_empty() || b.dhash.is_empty() {
    return false;
  }
  let same_shape = matches!((aspect(a), aspect(b)), (Some(x), Some(y)) if (x / y - 1.0).abs() < 0.02);
  let lead = |e: &Entry| e.colors.first().and_then(|c| color::hex_to_oklab(&c.hex));
  let same_lead = matches!((lead(a), lead(b)), (Some(x), Some(y)) if color::distance(x, y) < 0.1);
  same_shape && same_lead && color::hamming(&a.dhash, &b.dhash) <= NEAR_BITS
}

fn find(parent: &mut [usize], i: usize) -> usize {
  let mut root = i;
  while parent[root] != root {
    root = parent[root];
  }
  parent[i] = root;
  root
}

/// Groups of two or more copies, largest first. `digests` holds a content
/// hash for files whose size another file shares; equal digests are exact
/// copies. Within a group the keeper leads: most pixels, then the higher
/// rating, the bigger file, the older one, the shorter path.
pub fn groups(entries: &[Entry], digests: &BTreeMap<String, u64>) -> Vec<Group> {
  let mut parent: Vec<usize> = (0..entries.len()).collect();
  for i in 0..entries.len() {
    for j in i + 1..entries.len() {
      let (a, b) = (&entries[i], &entries[j]);
      let digest = |e: &Entry| digests.get(&e.rel_path);
      let exact = a.size_bytes == b.size_bytes && digest(a).is_some() && digest(a) == digest(b);
      if exact || near(a, b) {
        let (ri, rj) = (find(&mut parent, i), find(&mut parent, j));
        parent[ri] = rj;
      }
    }
  }
  let mut members: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
  for i in 0..entries.len() {
    let root = find(&mut parent, i);
    members.entry(root).or_default().push(i);
  }
  let pixels = |e: &Entry| e.width.unwrap_or(0) as u64 * e.height.unwrap_or(0) as u64;
  let mut out: Vec<Group> = members
    .into_values()
    .filter(|group| group.len() > 1)
    .map(|mut group| {
      group.sort_by(|&x, &y| {
        let (a, b) = (&entries[x], &entries[y]);
        pixels(b)
          .cmp(&pixels(a))
          .then(b.meta.rating.cmp(&a.meta.rating))
          .then(b.size_bytes.cmp(&a.size_bytes))
          .then(a.modified.cmp(&b.modified))
          .then(a.rel_path.len().cmp(&b.rel_path.len()))
          .then(a.rel_path.cmp(&b.rel_path))
      });
      let first = digests.get(&entries[group[0]].rel_path);
      let exact = first.is_some() && group.iter().all(|&i| digests.get(&entries[i].rel_path) == first);
      Group { paths: group.iter().map(|&i| entries[i].rel_path.clone()).collect(), exact }
    })
    .collect();
  out.sort_by(|a, b| b.paths.len().cmp(&a.paths.len()).then(a.paths[0].cmp(&b.paths[0])));
  out
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::{ColorShare, Meta};

  fn still(rel: &str, size: u64, w: u32, h: u32, dhash: &str, lead: &str) -> Entry {
    Entry {
      rel_path: rel.into(),
      name: rel.rsplit('/').next().unwrap().into(),
      ext: "jpg".into(),
      kind: "image".into(),
      size_bytes: size,
      modified: 0,
      width: Some(w),
      height: Some(h),
      colors: vec![ColorShare { hex: lead.into(), share: 0.5 }],
      dhash: dhash.into(),
      thumb_path: None,
      indexed: true,
      embedded: false,
      meta: Meta::default(),
    }
  }

  #[test]
  fn copies_group_with_the_largest_first() {
    let entries = vec![
      still("a/海.jpg", 900, 1000, 500, "f0f0f0f0f0f0f0f0", "#2a4d8f"),
      still("b/海 2.jpg", 900, 1000, 500, "f0f0f0f0f0f0f0f0", "#2a4d8f"),
      still("海-小.jpg", 300, 500, 250, "f0f0f0f0f0f0f0f1", "#2b4e90"),
      still("山.jpg", 700, 800, 600, "0f0f0f0f0f0f0f0f", "#4f9b3e"),
    ];
    let digests = BTreeMap::from([("a/海.jpg".to_string(), 7), ("b/海 2.jpg".to_string(), 7)]);
    assert_eq!(
      groups(&entries, &digests),
      vec![Group { paths: vec!["a/海.jpg".into(), "b/海 2.jpg".into(), "海-小.jpg".into()], exact: false }]
    );
  }

  #[test]
  fn byte_copies_alone_are_exact() {
    let entries = vec![
      still("x.jpg", 900, 10, 10, "", "#000000"),
      still("y.jpg", 900, 10, 10, "", "#000000"),
    ];
    let digests = BTreeMap::from([("x.jpg".to_string(), 1), ("y.jpg".to_string(), 1)]);
    assert_eq!(groups(&entries, &digests), vec![Group { paths: vec!["x.jpg".into(), "y.jpg".into()], exact: true }]);
  }

  #[test]
  fn flat_pictures_of_other_colours_or_shapes_stay_apart() {
    let entries = vec![
      still("red.png", 1, 100, 100, "0000000000000000", "#d33b36"),
      still("blue.png", 2, 100, 100, "0000000000000000", "#3065be"),
      still("wide-red.png", 3, 300, 100, "0000000000000000", "#d33b36"),
      still("far.png", 4, 100, 100, "00000000000000ff", "#d33b36"),
    ];
    assert_eq!(groups(&entries, &BTreeMap::new()), vec![]);
  }
}
