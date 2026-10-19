use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Moves files into the system Trash, where the user still finds them. All of
/// them go in one Finder request: one per file took a second each and chimed
/// once per file. A scratch folder stands in when the environment names one,
/// so no test run reaches the user's own Trash.
pub fn trash(paths: &[PathBuf], into: Option<&Path>) -> Result<(), String> {
  let Some(dir) = into else {
    return ::trash::delete_all(paths).map_err(|e| format!("trash failed: {e}"));
  };
  std::fs::create_dir_all(dir).map_err(|e| format!("trash failed: {e}"))?;
  for path in paths {
    let name = path.file_name().ok_or("trash failed: no file name")?.to_string_lossy();
    // Copies share names, and a batch sends them in together.
    let name = crate::import::unique(dir, &name);
    std::fs::rename(path, dir.join(name)).map_err(|e| format!("trash failed: {e}"))?;
  }
  Ok(())
}

/// Runs a system tool with no shell. Returns stdout on success.
pub fn run(bin: &str, args: impl IntoIterator<Item = impl AsRef<OsStr>>) -> Option<String> {
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
  let args = ["-g", "pixelWidth", "-g", "pixelHeight"];
  let Some(text) = run("sips", args.iter().map(OsStr::new).chain([path.as_os_str()])) else {
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
  let args = ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0"];
  let Some(text) = run("ffprobe", args.iter().map(OsStr::new).chain([path.as_os_str()])) else {
    return (None, None);
  };
  let mut parts = text.trim().split(',');
  let width = parts.next().and_then(|v| v.trim().parse().ok());
  let height = parts.next().and_then(|v| v.trim().parse().ok());
  (width, height)
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

    trash(&[file.clone()], Some(&dir.join("trash"))).unwrap();

    assert!(!file.exists(), "the file leaves the vault");
    assert_eq!(std::fs::read(dir.join("trash/图.jpg")).unwrap(), b"jpeg");
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn trash_reports_a_file_it_cannot_move() {
    let dir = std::env::temp_dir().join(format!("deja-trash-missing-{}", std::process::id()));
    let error = trash(&[dir.join("gone.jpg")], Some(&dir)).unwrap_err();
    assert!(error.starts_with("trash failed"), "{error}");
  }
}
