use std::path::Path;
use std::process::{Command, Stdio};

/// Moves one file into the system Trash, where the user still finds it. A
/// scratch folder stands in when the environment names one, so no test run
/// reaches the user's own Trash.
pub fn trash(path: &Path, into: Option<&Path>) -> Result<(), String> {
  let Some(dir) = into else {
    return ::trash::delete(path).map_err(|e| format!("trash failed: {e}"));
  };
  std::fs::create_dir_all(dir).map_err(|e| format!("trash failed: {e}"))?;
  let name = path.file_name().ok_or("trash failed: no file name")?;
  std::fs::rename(path, dir.join(name)).map_err(|e| format!("trash failed: {e}"))
}

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

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn trash_moves_the_file_into_the_named_folder() {
    let dir = std::env::temp_dir().join(format!("deja-trash-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("vault")).unwrap();
    let file = dir.join("vault/图.jpg");
    std::fs::write(&file, b"jpeg").unwrap();

    trash(&file, Some(&dir.join("trash"))).unwrap();

    assert!(!file.exists(), "the file leaves the vault");
    assert_eq!(std::fs::read(dir.join("trash/图.jpg")).unwrap(), b"jpeg");
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn trash_reports_a_file_it_cannot_move() {
    let dir = std::env::temp_dir().join(format!("deja-trash-missing-{}", std::process::id()));
    let error = trash(&dir.join("gone.jpg"), Some(&dir)).unwrap_err();
    assert!(error.starts_with("trash failed"), "{error}");
  }
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
