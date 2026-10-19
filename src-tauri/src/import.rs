// Files dropped onto the window, usually images dragged straight out of a
// browser. Every item arrives as a URL: a `data:` URL for bytes the page could
// read itself, an http(s) URL for an image only the browser had a link to.
use crate::{meta, Meta};
use base64::Engine as _;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Item {
  pub url: String,
  /// The file name the drag carried, when it carried one.
  #[serde(default)]
  pub name: Option<String>,
  /// Where the image came from, kept in the sidecar as `source`.
  #[serde(default)]
  pub source: Option<String>,
}

/// The extension the bytes actually are. A browser link often ends in `.php`
/// or nothing at all, and a `.jpg` may be a webp, so the name is not trusted.
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
  let at = |offset: usize, magic: &[u8]| bytes.get(offset..offset + magic.len()) == Some(magic);
  if at(0, b"\x89PNG\r\n\x1a\n") {
    Some("png")
  } else if at(0, b"\xff\xd8\xff") {
    Some("jpg")
  } else if at(0, b"GIF8") {
    Some("gif")
  } else if at(0, b"RIFF") && at(8, b"WEBP") {
    Some("webp")
  } else if at(0, b"BM") {
    Some("bmp")
  } else if at(0, b"II*\0") || at(0, b"MM\0*") {
    Some("tiff")
  } else if at(0, b"\x1a\x45\xdf\xa3") {
    Some("webm")
  } else if at(4, b"ftyp") {
    match bytes.get(8..12)? {
      b"avif" | b"avis" => Some("avif"),
      b"heic" | b"heix" | b"mif1" | b"msf1" => Some("heic"),
      b"qt  " => Some("mov"),
      b"M4V " => Some("m4v"),
      _ => Some("mp4"),
    }
  } else {
    None
  }
}

fn decode_data_url(url: &str) -> Result<Vec<u8>, String> {
  let (header, body) = url.split_once(',').ok_or("data url is malformed")?;
  if !header.ends_with(";base64") {
    return Err("data url is not base64".into());
  }
  base64::engine::general_purpose::STANDARD
    .decode(body.trim())
    .map_err(|e| format!("data url is malformed: {e}"))
}

/// `curl` is on every Mac, which keeps an HTTP client out of the binary.
fn download(url: &str) -> Result<Vec<u8>, String> {
  let output = Command::new("curl")
    .args(["-fsSL", "--max-time", "30", "--max-filesize", "1073741824"])
    .args(["-A", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Deja"])
    .arg(url)
    .stdin(Stdio::null())
    .stderr(Stdio::null())
    .output()
    .map_err(|e| format!("download failed: {e}"))?;
  if !output.status.success() {
    return Err(format!("download failed: {url}"));
  }
  Ok(output.stdout)
}

fn fetch(url: &str) -> Result<Vec<u8>, String> {
  if url.starts_with("data:") {
    decode_data_url(url)
  } else if url.starts_with("http://") || url.starts_with("https://") {
    download(url)
  } else {
    Err(format!("unsupported url: {url}"))
  }
}

/// The name's stem with the sniffed extension. Path separators and leading
/// dots are stripped so a dropped name cannot leave the folder or hide itself.
pub fn file_name(item: &Item, ext: &str) -> String {
  let from_url = || {
    let path = item.url.split(['?', '#']).next().unwrap_or("");
    let last = path.rsplit('/').next().unwrap_or("");
    percent_decode(last)
  };
  let raw = match item.name.as_deref() {
    Some(name) if !name.trim().is_empty() => name.to_string(),
    _ if item.url.starts_with("data:") => String::new(),
    _ => from_url(),
  };
  let stem = raw.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(&raw);
  let clean: String = stem
    .chars()
    .map(|c| if matches!(c, '/' | '\\' | ':' | '\0') { '-' } else { c })
    .collect();
  let clean = clean.trim().trim_start_matches('.');
  let stem = if clean.is_empty() { "导入" } else { clean };
  format!("{stem}.{ext}")
}

fn percent_decode(text: &str) -> String {
  let bytes = text.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    let hex = bytes.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok());
    match (bytes[i], hex.and_then(|h| u8::from_str_radix(h, 16).ok())) {
      (b'%', Some(value)) => {
        out.push(value);
        i += 3;
      }
      (byte, _) => {
        out.push(byte);
        i += 1;
      }
    }
  }
  String::from_utf8_lossy(&out).to_string()
}

/// `name.png`, then `name 2.png`, `name 3.png`, the way Finder numbers copies.
pub fn unique(dir: &Path, name: &str) -> String {
  if !dir.join(name).exists() {
    return name.to_string();
  }
  let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
  (2..)
    .map(|n| format!("{stem} {n}.{ext}"))
    .find(|candidate| !dir.join(candidate).exists())
    .expect("some number is free")
}

/// The folder `folder` names inside the vault. A path that climbs out, or
/// passes through a hidden folder, is refused like one that does not exist.
pub fn vault_dir(root: &Path, folder: &str) -> Result<PathBuf, String> {
  let dir = if folder.is_empty() { root.to_path_buf() } else { root.join(folder) };
  if folder.split('/').any(|part| part == ".." || part.starts_with('.')) || !dir.is_dir() {
    return Err(format!("{folder} is not in the vault"));
  }
  Ok(dir)
}

/// `name` inside `folder`, as a vault relative path; "" is the vault root.
pub fn rel_in(folder: &str, name: &str) -> String {
  if folder.is_empty() {
    name.to_string()
  } else {
    format!("{folder}/{name}")
  }
}

/// What an import wrote, and the last thing that went wrong along the way when
/// something still landed: an item that did not, or a sidecar that could not
/// be written for one that did.
#[derive(Debug, PartialEq)]
pub struct Landed {
  pub paths: Vec<String>,
  pub warning: Option<String>,
}

/// Fetches each item and writes it into `root/folder`.
pub fn import_into(root: &Path, folder: &str, items: &[Item]) -> Result<Landed, String> {
  write_into(root, folder, items.iter().map(|item| fetch(&item.url).map(|bytes| (item, bytes))))
}

/// Writes each item's bytes into `root/folder`. Items are fetched lazily, one
/// at a time. One bad item does not stop the rest; it fails the call only if
/// nothing landed. A file on disk is always in `paths`, so it can be undone.
pub fn write_into<'a>(
  root: &Path,
  folder: &str,
  fetched: impl IntoIterator<Item = Result<(&'a Item, Vec<u8>), String>>,
) -> Result<Landed, String> {
  let dir = vault_dir(root, folder)?;
  let mut imported = Vec::new();
  let mut last_error = None;
  for result in fetched {
    let (item, bytes) = match result {
      Ok(fetched) => fetched,
      Err(error) => {
        last_error = Some(error);
        continue;
      }
    };
    let Some(ext) = sniff(&bytes) else {
      last_error = Some("not an image or video".to_string());
      continue;
    };
    let name = unique(&dir, &file_name(item, ext));
    if let Err(error) = std::fs::write(dir.join(&name), &bytes) {
      last_error = Some(format!("write failed: {error}"));
      continue;
    }
    let rel = rel_in(folder, &name);
    let source = item.source.clone().filter(|s| s.starts_with("http"));
    if source.is_some() {
      if let Err(error) = meta::write(root, &rel, &Meta { source, ..Meta::default() }) {
        last_error = Some(format!("source not saved for {rel}: {error}"));
      }
    }
    imported.push(rel);
  }
  match (imported.is_empty(), last_error) {
    (true, Some(error)) => Err(error),
    (_, warning) => Ok(Landed { paths: imported, warning }),
  }
}

/// Removes files an import wrote, with their sidecars. The caller passes only
/// paths it recorded from `import_into`, so nothing the user put there is touched.
pub fn remove(root: &Path, rels: &[String]) -> Result<(), String> {
  for rel in rels {
    std::fs::remove_file(root.join(rel)).map_err(|e| format!("undo failed: {e}"))?;
    meta::write(root, rel, &Meta::default())?;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn item(url: &str, name: Option<&str>) -> Item {
    Item { url: url.into(), name: name.map(str::to_string), source: None }
  }

  #[test]
  fn sniffs_by_content_not_name() {
    assert_eq!(sniff(b"\x89PNG\r\n\x1a\n...."), Some("png"));
    assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
    assert_eq!(sniff(b"\0\0\0\x1cftypavif"), Some("avif"));
    assert_eq!(sniff(b"\0\0\0\x14ftypqt  "), Some("mov"));
    assert_eq!(sniff(b"<!doctype html>"), None);
  }

  #[test]
  fn names_come_from_the_drag_then_the_url() {
    assert_eq!(file_name(&item("https://x.com/a/%E6%B5%B7.jpg?w=2", None), "webp"), "海.webp");
    assert_eq!(file_name(&item("https://x.com/a/b.png", Some("封面.png")), "png"), "封面.png");
    assert_eq!(file_name(&item("data:image/png;base64,AA", None), "png"), "导入.png");
    assert_eq!(file_name(&item("https://x.com/", Some("../../.etc")), "png"), "-..-.png");
  }

  #[test]
  fn bytes_in_hand_land_under_the_given_name() {
    let dir = std::env::temp_dir().join(format!("deja-import-bytes-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let pasted = item("", Some("剪贴板图片"));
    let landed = write_into(&dir, "", [Ok((&pasted, b"\x89PNG\r\n\x1a\nrest".to_vec()))]).unwrap();
    assert_eq!(landed, Landed { paths: vec!["剪贴板图片.png".into()], warning: None });
    assert_eq!(std::fs::read(dir.join("剪贴板图片.png")).unwrap(), b"\x89PNG\r\n\x1a\nrest");
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_file_that_landed_is_reported_even_when_its_sidecar_fails() {
    let dir = std::env::temp_dir().join(format!("deja-import-sidecar-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    // A plain file where the metadata folder goes, so no sidecar can be written.
    std::fs::write(dir.join(".deja"), b"").unwrap();
    let png = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nrest");
    let mut drop = item(&format!("data:image/png;base64,{png}"), Some("图.png"));
    drop.source = Some("https://example.com/pic".into());

    let landed = import_into(&dir, "", &[drop]);
    assert!(dir.join("图.png").exists(), "the picture is on disk");
    let landed = landed.expect("the import succeeds");
    assert_eq!(landed.paths, vec!["图.png".to_string()], "so undo must know about it");
    assert!(landed.warning.unwrap_or_default().starts_with("source not saved for 图.png"));
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn writes_a_data_url_and_numbers_a_clash() {
    let dir = std::env::temp_dir().join(format!("deja-import-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("参考")).unwrap();
    let png = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nrest");
    let url = format!("data:image/png;base64,{png}");
    let mut drop = item(&url, Some("图.png"));
    drop.source = Some("https://example.com/pic".into());

    assert_eq!(import_into(&dir, "参考", &[drop]).unwrap().paths, vec!["参考/图.png"]);
    let second = import_into(&dir, "参考", &[item(&url, Some("图.png"))]).unwrap().paths;
    assert_eq!(second, vec!["参考/图 2.png"]);
    assert_eq!(meta::read(&dir, "参考/图.png").source.as_deref(), Some("https://example.com/pic"));
    assert!(import_into(&dir, "../x", &[item(&url, None)]).is_err());

    remove(&dir, &second).unwrap();
    assert!(!dir.join("参考/图 2.png").exists());
    remove(&dir, &["参考/图.png".to_string()]).unwrap();
    assert!(!meta::meta_path(&dir, "参考/图.png").exists(), "the sidecar goes with the file");

    let html = base64::engine::general_purpose::STANDARD.encode(b"<html>");
    let error = import_into(&dir, "", &[item(&format!("data:text/html;base64,{html}"), None)]).unwrap_err();
    assert_eq!(error, "not an image or video");
    let _ = std::fs::remove_dir_all(&dir);
  }
}
