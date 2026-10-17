use crate::Meta;
use std::path::{Path, PathBuf};

pub fn meta_path(root: &Path, rel: &str) -> PathBuf {
  root.join(".shelf").join("meta").join(format!("{rel}.md"))
}

fn unquote(value: &str) -> String {
  let trimmed = value.trim();
  let stripped = trimmed
    .strip_prefix('"')
    .and_then(|v| v.strip_suffix('"'))
    .or_else(|| trimmed.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')));
  stripped.unwrap_or(trimmed).to_string()
}

/// Commas inside quotes belong to the tag, so a tag may contain one.
fn split_quoted(inner: &str) -> Vec<String> {
  let mut out: Vec<String> = Vec::new();
  let mut current = String::new();
  let mut quoted = false;
  for character in inner.chars() {
    match character {
      '"' | '\'' => {
        quoted = !quoted;
        current.push(character);
      }
      ',' if !quoted => {
        out.push(current.trim().to_string());
        current.clear();
      }
      _ => current.push(character),
    }
  }
  out.push(current.trim().to_string());
  out.into_iter().map(|tag| unquote(&tag)).filter(|tag| !tag.is_empty()).collect()
}

fn parse_tags(value: &str) -> Vec<String> {
  let inner = value
    .trim()
    .strip_prefix('[')
    .and_then(|v| v.strip_suffix(']'))
    .unwrap_or(value);
  split_quoted(inner)
}

pub fn parse(text: &str) -> Meta {
  let mut meta = Meta::default();
  let mut lines = text.lines();
  let mut in_front = false;
  let mut closed = false;
  let mut body: Vec<&str> = Vec::new();
  for line in lines.by_ref() {
    if !in_front {
      if line.trim() == "---" {
        in_front = true;
        continue;
      }
      body.push(line);
      continue;
    }
    if line.trim() == "---" {
      closed = true;
      break;
    }
    if let Some((key, value)) = line.split_once(':') {
      match key.trim() {
        "tags" => {
          if value.trim().is_empty() {
            meta.tags = Vec::new();
          } else {
            meta.tags = parse_tags(value);
          }
        }
        "rating" => meta.rating = value.trim().parse().unwrap_or(0).min(5),
        "source" => {
          let value = unquote(value);
          meta.source = if value.is_empty() { None } else { Some(value) };
        }
        _ => {}
      }
    }
  }
  if closed {
    body.extend(lines);
  }
  meta.note = body.join("\n").trim().to_string();
  meta
}

fn quote_if_needed(tag: &str) -> String {
  if tag.contains(',') || tag.contains('[') || tag.contains(']') {
    format!("\"{tag}\"")
  } else {
    tag.to_string()
  }
}

pub fn render(meta: &Meta) -> String {
  let mut out = String::from("---\n");
  let tags: Vec<String> = meta.tags.iter().map(|t| quote_if_needed(t)).collect();
  out.push_str(&format!("tags: [{}]\n", tags.join(", ")));
  out.push_str(&format!("rating: {}\n", meta.rating));
  if let Some(source) = meta.source.as_deref().filter(|s| !s.is_empty()) {
    out.push_str(&format!("source: {source}\n"));
  }
  out.push_str("---\n");
  if !meta.note.is_empty() {
    out.push('\n');
    out.push_str(meta.note.trim());
    out.push('\n');
  }
  out
}

pub fn is_empty(meta: &Meta) -> bool {
  meta.tags.is_empty() && meta.rating == 0 && meta.note.is_empty() && meta.source.is_none()
}

pub fn read(root: &Path, rel: &str) -> Meta {
  std::fs::read_to_string(meta_path(root, rel))
    .map(|text| parse(&text))
    .unwrap_or_default()
}

pub fn write(root: &Path, rel: &str, meta: &Meta) -> Result<(), String> {
  let path = meta_path(root, rel);
  if is_empty(meta) {
    if path.exists() {
      std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    return Ok(());
  }
  if let Some(parent) = path.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  std::fs::write(&path, render(meta)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn roundtrip_keeps_every_field() {
    let meta = Meta {
      tags: vec!["深色".into(), "登录".into(), "a,b".into()],
      rating: 4,
      note: "间距可以照这个来。\n第二行。".into(),
      source: Some("https://dribbble.com/shots/1".into()),
    };
    let text = render(&meta);
    let back = parse(&text);
    assert_eq!(back.tags, meta.tags, "tags survive a roundtrip, commas included");
    assert_eq!(back.rating, 4);
    assert_eq!(back.note, meta.note);
    assert_eq!(back.source, meta.source);
  }

  #[test]
  fn file_without_frontmatter_is_just_a_note() {
    let meta = parse("随手记一句。\n");
    assert!(meta.tags.is_empty());
    assert_eq!(meta.note, "随手记一句。");
  }

  #[test]
  fn empty_meta_is_recognised() {
    assert!(is_empty(&Meta::default()));
    assert!(!is_empty(&parse("---\nrating: 3\n---\n")));
  }
}
