use crate::scan::RawFile;
use crate::{color, files, Computed};
use std::path::{Path, PathBuf};

fn thumb_name(rel_path: &str) -> String {
  format!("{:016x}.png", color::fnv64(rel_path.as_bytes()))
}

fn build_thumb(cache_dir: &Path, file: &RawFile, resize: bool) -> Option<PathBuf> {
  let target = cache_dir.join("thumbs").join(thumb_name(&file.rel_path));
  if target.exists() {
    return Some(target);
  }
  if let Some(parent) = target.parent() {
    std::fs::create_dir_all(parent).ok()?;
  }
  let out = target.to_string_lossy().to_string();
  let src = file.abs.to_string_lossy().to_string();
  let produced = match file.kind.as_str() {
    "video" => files::run(
      "ffmpeg",
      &[
        "-y".into(),
        "-v".into(),
        "error".into(),
        "-ss".into(),
        "0".into(),
        "-i".into(),
        src,
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        "scale=512:-1".into(),
        out,
      ],
    )
    .is_some(),
    // `sips -Z` also scales small files up; a thumbnail should never grow.
    _ if resize => files::run(
      "sips",
      &["-Z".into(), "512".into(), "-s".into(), "format".into(), "png".into(), src, "--out".into(), out],
    )
    .is_some(),
    _ => files::run(
      "sips",
      &["-s".into(), "format".into(), "png".into(), src, "--out".into(), out],
    )
    .is_some(),
  };
  produced.then_some(target)
}

fn analysis_sample(cache_dir: &Path, file: &RawFile, thumb: &Path) -> Option<Vec<color::Rgb>> {
  let temp = cache_dir.join("thumbs").join(format!("{}.32.png", thumb_name(&file.rel_path)));
  let source = if file.kind == "video" {
    thumb.to_string_lossy().to_string()
  } else {
    file.abs.to_string_lossy().to_string()
  };
  let produced = files::run(
    "sips",
    &[
      "-Z".into(),
      "32".into(),
      "-s".into(),
      "format".into(),
      "png".into(),
      source,
      "--out".into(),
      temp.to_string_lossy().to_string(),
    ],
  );
  let sample = produced
    .and_then(|_| std::fs::read(&temp).ok())
    .and_then(|bytes| color::decode_png(&bytes))
    .map(|image| color::thumbnail(&image, 32));
  let _ = std::fs::remove_file(&temp);
  sample
}

/// Everything the viewer and the grid need, derived once and cached.
pub fn build(cache_dir: &Path, file: &RawFile) -> Computed {
  let (width, height) = match file.kind.as_str() {
    "video" => files::ffprobe_size(&file.abs),
    _ => files::sips_size(&file.abs),
  };
  let resize = match (width, height) {
    (Some(w), Some(h)) => w.max(h) > 512,
    _ => true,
  };
  let thumb = build_thumb(cache_dir, file, resize);
  let sample = thumb
    .as_deref()
    .and_then(|path| analysis_sample(cache_dir, file, path));
  let colors = sample
    .as_deref()
    .map(|s| color::dominant_colors(s, 0.10, 3))
    .unwrap_or_default();
  let hash = sample.as_deref().map(|s| color::dhash(s, 32)).unwrap_or_default();
  Computed {
    size_bytes: file.size_bytes,
    modified: file.modified,
    width,
    height,
    colors,
    dhash: hash,
    thumb_path: thumb.map(|p| p.to_string_lossy().to_string()),
    analysis: crate::ANALYSIS,
  }
}
