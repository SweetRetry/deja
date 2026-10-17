use std::path::Path;
use std::process::{Command, Stdio};

/// Runs a system tool with no shell. Returns stdout on success.
pub fn run(bin: &str, args: &[String]) -> Option<String> {
  let output = Command::new(bin)
    .args(args)
    .stdin(Stdio::null())
    .stderr(Stdio::null())
    .output()
    .ok()?;
  if !output.status.success() {
    return None;
  }
  Some(String::from_utf8_lossy(&output.stdout).to_string())
}

/// `sips -g pixelWidth -g pixelHeight` output, e.g. "  pixelWidth: 96".
pub fn sips_size(path: &Path) -> (Option<u32>, Option<u32>) {
  let args = vec![
    "-g".to_string(),
    "pixelWidth".to_string(),
    "-g".to_string(),
    "pixelHeight".to_string(),
    path.to_string_lossy().to_string(),
  ];
  let Some(text) = run("sips", &args) else {
    return (None, None);
  };
  let read = |key: &str| -> Option<u32> {
    text
      .lines()
      .find(|line| line.trim_start().starts_with(key))
      .and_then(|line| line.split(':').nth(1))
      .and_then(|value| value.trim().parse().ok())
  };
  (read("pixelWidth"), read("pixelHeight"))
}

/// `ffprobe` keeps video dimensions in the stream, not in `sips`.
pub fn ffprobe_size(path: &Path) -> (Option<u32>, Option<u32>) {
  let args = vec![
    "-v".to_string(),
    "error".to_string(),
    "-select_streams".to_string(),
    "v:0".to_string(),
    "-show_entries".to_string(),
    "stream=width,height".to_string(),
    "-of".to_string(),
    "csv=p=0".to_string(),
    path.to_string_lossy().to_string(),
  ];
  let Some(text) = run("ffprobe", &args) else {
    return (None, None);
  };
  let mut parts = text.trim().split(',');
  let width = parts.next().and_then(|v| v.trim().parse().ok());
  let height = parts.next().and_then(|v| v.trim().parse().ok());
  (width, height)
}
