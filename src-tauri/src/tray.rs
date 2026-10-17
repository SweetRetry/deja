//! The menu bar icon. Closing the window only hides it, so the open vault keeps
//! watching Finder and indexing; the icon brings the window back, opens a
//! recent folder, or quits.

use std::sync::OnceLock;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager};

const TRAY: &str = "shelf";
const SHOW: &str = "show";
const QUIT: &str = "quit";
const RECENT: &str = "recent:";
/// Heard by the frontend, which opens the folder the same way the picker does.
pub const OPEN_VAULT_EVENT: &str = "tray-open-vault";

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn install(app: &AppHandle) -> tauri::Result<()> {
  let _ = APP.set(app.clone());
  tauri::tray::TrayIconBuilder::with_id(TRAY)
    .icon(glyph())
    .icon_as_template(true)
    .tooltip("Shelf")
    .menu(&menu(app)?)
    .show_menu_on_left_click(true)
    .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
    .build(app)?;
  Ok(())
}

/// Rebuilds the recent list after a vault opens. A no-op without a tray, which
/// is how the e2e server runs the same dispatch.
pub fn refresh() {
  let Some(app) = APP.get() else { return };
  let handle = app.clone();
  let _ = app.run_on_main_thread(move || {
    if let (Some(tray), Ok(menu)) = (handle.tray_by_id(TRAY), menu(&handle)) {
      let _ = tray.set_menu(Some(menu));
    }
  });
}

pub fn show_window(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
}

fn on_menu(app: &AppHandle, id: &str) {
  match id {
    SHOW => show_window(app),
    QUIT => app.exit(0),
    _ => {
      if let Some(path) = id.strip_prefix(RECENT) {
        show_window(app);
        let _ = app.emit(OPEN_VAULT_EVENT, path);
      }
    }
  }
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
  let recent = Submenu::with_id(app, "recent", "最近的文件夹", true)?;
  let paths = crate::recent_vaults();
  let home = std::env::var("HOME").unwrap_or_default();
  if paths.is_empty() {
    recent.append(&MenuItem::with_id(app, "recent-empty", "还没有打开过文件夹", false, None::<&str>)?)?;
  }
  for path in &paths {
    recent.append(&MenuItem::with_id(app, format!("{RECENT}{path}"), short_path(path, &home), true, None::<&str>)?)?;
  }
  Menu::with_items(
    app,
    &[
      &MenuItem::with_id(app, SHOW, "显示 Shelf", true, None::<&str>)?,
      &recent,
      &PredefinedMenuItem::separator(app)?,
      &MenuItem::with_id(app, QUIT, "退出 Shelf", true, None::<&str>)?,
    ],
  )
}

/// Two vaults can share a folder name, so the label keeps the path, with the
/// home folder folded to `~` the way Finder's Go menu shows it.
fn short_path(path: &str, home: &str) -> String {
  match path.strip_prefix(home) {
    Some(rest) if !home.is_empty() && (rest.is_empty() || rest.starts_with('/')) => format!("~{rest}"),
    _ => path.to_string(),
  }
}

/// The app mark, a wide slab, drawn as a template so macOS tints it for the
/// light and dark menu bar. 36px is the 18pt menu bar slot at 2x.
fn glyph() -> Image<'static> {
  const SIZE: u32 = 36;
  let (left, right, top, bottom) = (6, 30, 11, 25);
  let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
  for y in top..bottom {
    for x in left..right {
      let corner = (x == left || x == right - 1) && (y == top || y == bottom - 1);
      rgba[((y * SIZE + x) * 4 + 3) as usize] = if corner { 0x80 } else { 0xff };
    }
  }
  Image::new_owned(rgba, SIZE, SIZE)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn short_path_folds_only_the_home_folder() {
    assert_eq!(short_path("/Users/me/Pictures/refs", "/Users/me"), "~/Pictures/refs");
    assert_eq!(short_path("/Users/meg/refs", "/Users/me"), "/Users/meg/refs");
    assert_eq!(short_path("/Volumes/Users/me", "/Users/me"), "/Volumes/Users/me");
  }
}
