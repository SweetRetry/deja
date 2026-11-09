// The picture on the system clipboard, for pages that show an image the
// browser will not let go of: it can be copied but not dragged. Asking whether
// there is one reads only the pasteboard's type list; the bytes are read when
// the user takes the offer.

pub struct Picture {
  pub bytes: Vec<u8>,
}

/// The pasteboard's change count while it holds a picture, so the UI can tell
/// one copy from the next without reading it.
pub fn change() -> Option<i64> {
  platform::change()
}

pub fn read() -> Option<Picture> {
  platform::read()
}

/// Puts text on the clipboard, as ⌥⌘C in Finder does with a path.
pub fn write_text(text: &str) -> Result<(), String> {
  platform::write_text(text)
}

/// Puts the files themselves on the clipboard, as ⌘C in Finder does, so a paste
/// in Finder copies them and a paste in a chat attaches them.
pub fn write_files(paths: &[std::path::PathBuf]) -> Result<(), String> {
  platform::write_files(paths)
}

#[cfg(all(target_os = "macos", not(feature = "e2e")))]
mod platform {
  use super::Picture;
  use objc2_app_kit::{NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeTIFF};

  /// A browser's "Copy Image" offers png; a screenshot or Preview offers tiff.
  pub fn change() -> Option<i64> {
    let board = NSPasteboard::generalPasteboard();
    let types = board.types()?;
    let has = |wanted: &objc2_foundation::NSString| types.iter().any(|kind| &*kind == wanted);
    // SAFETY: the type constants are immutable statics defined by AppKit.
    let found = unsafe { has(NSPasteboardTypePNG) || has(NSPasteboardTypeTIFF) };
    found.then(|| board.changeCount() as i64)
  }

  pub fn read() -> Option<Picture> {
    let board = NSPasteboard::generalPasteboard();
    // SAFETY: as above.
    let data = unsafe { board.dataForType(NSPasteboardTypePNG).or_else(|| board.dataForType(NSPasteboardTypeTIFF)) }?;
    Some(Picture { bytes: data.to_vec() })
  }

  pub fn write_text(text: &str) -> Result<(), String> {
    use objc2_app_kit::NSPasteboardTypeString;
    let board = NSPasteboard::generalPasteboard();
    board.clearContents();
    // SAFETY: as above.
    let written = unsafe { board.setString_forType(&objc2_foundation::NSString::from_str(text), NSPasteboardTypeString) };
    written.then_some(()).ok_or_else(|| "the clipboard refused the text".into())
  }

  /// One pasteboard item per file, each holding its file URL: the form Finder
  /// writes, and the only one that carries more than one file.
  pub fn write_files(paths: &[std::path::PathBuf]) -> Result<(), String> {
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPasteboardItem, NSPasteboardTypeFileURL, NSPasteboardWriting};
    use objc2_foundation::{NSArray, NSString, NSURL};
    let items: Vec<objc2::rc::Retained<ProtocolObject<dyn NSPasteboardWriting>>> = paths
      .iter()
      .filter_map(|path| {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let text = url.absoluteString()?;
        let item = NSPasteboardItem::new();
        // SAFETY: as above.
        unsafe { item.setString_forType(&text, NSPasteboardTypeFileURL) }.then_some(item)
      })
      .map(ProtocolObject::from_retained)
      .collect();
    let board = NSPasteboard::generalPasteboard();
    board.clearContents();
    board
      .writeObjects(&NSArray::from_retained_slice(&items))
      .then_some(())
      .ok_or_else(|| "the clipboard refused the files".into())
  }
}

/// The e2e backend has no desktop session, so a test sets the clipboard by
/// writing `clipboard.png` into the data dir.
#[cfg(feature = "e2e")]
mod platform {
  use super::Picture;

  fn file() -> std::path::PathBuf {
    crate::data_dir().join("clipboard.png")
  }

  pub fn change() -> Option<i64> {
    let modified = std::fs::metadata(file()).ok()?.modified().ok()?;
    let since = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(since.as_nanos() as i64)
  }

  pub fn read() -> Option<Picture> {
    std::fs::read(file()).ok().map(|bytes| Picture { bytes })
  }

  /// What a test reads back: `copied.json`, `{"text": ...}` or `{"files": [...]}`.
  fn copied(value: serde_json::Value) -> Result<(), String> {
    std::fs::write(crate::data_dir().join("copied.json"), value.to_string()).map_err(|e| e.to_string())
  }

  pub fn write_text(text: &str) -> Result<(), String> {
    copied(serde_json::json!({ "text": text }))
  }

  pub fn write_files(paths: &[std::path::PathBuf]) -> Result<(), String> {
    copied(serde_json::json!({ "files": paths }))
  }
}

#[cfg(not(any(target_os = "macos", feature = "e2e")))]
mod platform {
  use super::Picture;

  pub fn change() -> Option<i64> {
    None
  }

  pub fn read() -> Option<Picture> {
    None
  }

  pub fn write_text(_: &str) -> Result<(), String> {
    Err("no clipboard on this platform".into())
  }

  pub fn write_files(_: &[std::path::PathBuf]) -> Result<(), String> {
    Err("no clipboard on this platform".into())
  }
}
