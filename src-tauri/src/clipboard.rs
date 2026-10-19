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
}
