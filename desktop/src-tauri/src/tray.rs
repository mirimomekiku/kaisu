//! The tray icon, and what closing the window means.
//!
//! The close button can keep Kaisu running in the background so downloads continue ("downloads" mode: only while
//! something is downloading; "always"; or "never"). The webview tells us the queue's state through
//! `set_tray_status`, and we decide here, in Rust, so closing works even if the page is busy.

use std::sync::{
    Mutex,
    atomic::{AtomicBool, AtomicU32, Ordering},
};
use std::time::Duration;

use serde::Deserialize;
use tauri::{
    AppHandle, Emitter, Manager, State, Window, WindowEvent, Wry,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::download::Downloads;

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
#[serde(rename_all = "snake_case")]
pub enum CloseMode {
    /// Keep running in the background only while downloads are in progress.
    #[default]
    Downloads,
    /// Closing the window always hides it to the tray.
    Always,
    /// Closing the window quits.
    Never,
}

#[derive(Default)]
pub struct TrayState {
    available: AtomicBool,
    mode: Mutex<CloseMode>,
    /// Downloads running or waiting.
    busy: AtomicU32,
    /// We hid the window because of a close request (as opposed to the user minimising it).
    hidden_by_close: AtomicBool,
    status_item: Mutex<Option<MenuItem<Wry>>>,
}

/// Should a close request hide the window instead of quitting?
fn should_hide(mode: CloseMode, busy: u32, tray_available: bool) -> bool {
    tray_available
        && match mode {
            CloseMode::Always => true,
            CloseMode::Downloads => busy > 0,
            CloseMode::Never => false,
        }
}

/// Should a hidden Kaisu quit now that its work is done?
fn should_quit_when_idle(mode: CloseMode, busy: u32, hidden_by_close: bool) -> bool {
    hidden_by_close && mode == CloseMode::Downloads && busy == 0
}

#[cfg(target_os = "linux")]
fn tray_supported() -> bool {
    // The tray library loads these at runtime and aborts the whole app if they are missing, so look first.
    ["libayatana-appindicator3.so.1", "libappindicator3.so.1"]
        .iter()
        .any(|name| unsafe { libloading::Library::new(*name) }.is_ok())
}

#[cfg(not(target_os = "linux"))]
fn tray_supported() -> bool {
    true
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    app.state::<TrayState>().hidden_by_close.store(false, Ordering::SeqCst);
}

/// Quits for real: stops downloads first so no yt-dlp or ffmpeg process is left behind.
pub fn quit(app: &AppHandle) {
    app.state::<Downloads>().kill_all();
    app.exit(0);
}

/// Called once at startup. Failure just means "no tray".
pub fn init(app: &AppHandle) {
    if !tray_supported() {
        return;
    }
    let build = || -> tauri::Result<()> {
        let show = MenuItem::with_id(app, "show", "Show Kaisu", true, None::<&str>)?;
        let status = MenuItem::with_id(app, "status", "No active downloads", false, None::<&str>)?;
        let pause = MenuItem::with_id(app, "pause", "Pause all downloads", true, None::<&str>)?;
        let resume = MenuItem::with_id(app, "resume", "Resume all downloads", true, None::<&str>)?;
        let quit_item = MenuItem::with_id(app, "quit", "Quit Kaisu", true, None::<&str>)?;
        let (sep1, sep2) = (PredefinedMenuItem::separator(app)?, PredefinedMenuItem::separator(app)?);
        let menu = Menu::with_items(app, &[&show, &sep1, &status, &pause, &resume, &sep2, &quit_item])?;

        let mut builder = TrayIconBuilder::with_id("main")
            .tooltip("Kaisu")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "show" => show_main(app),
                "quit" => quit(app),
                "pause" => {
                    let _ = app.emit("tray-action", "pause_all");
                }
                "resume" => {
                    let _ = app.emit("tray-action", "resume_all");
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                    show_main(tray.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        builder.build(app)?;

        let state = app.state::<TrayState>();
        *state.status_item.lock().unwrap() = Some(status);
        state.available.store(true, Ordering::SeqCst);
        Ok(())
    };
    if let Err(e) = build() {
        eprintln!("Kaisu: tray icon unavailable: {e}");
    }
}

/// Window events: a close request may hide the window instead (see the module docs).
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        let state = window.state::<TrayState>();
        let mode = *state.mode.lock().unwrap();
        if should_hide(mode, state.busy.load(Ordering::SeqCst), state.available.load(Ordering::SeqCst)) {
            api.prevent_close();
            let _ = window.hide();
            state.hidden_by_close.store(true, Ordering::SeqCst);
            let _ = window.app_handle().emit("background-started", ());
        }
    }
}

/// The page reports its queue so the tray and the close button can react.
#[tauri::command]
pub fn set_tray_status(app: AppHandle, state: State<'_, TrayState>, active: u32, queued: u32, paused: u32, mode: CloseMode) {
    let busy = active + queued;
    state.busy.store(busy, Ordering::SeqCst);
    *state.mode.lock().unwrap() = mode;

    let text = match (active, queued, paused) {
        (0, 0, 0) => "No active downloads".to_string(),
        (0, 0, p) => format!("{p} paused"),
        (a, q, _) => format!("{a} downloading{}", if q > 0 { format!(", {q} waiting") } else { String::new() }),
    };
    if let Some(item) = state.status_item.lock().unwrap().as_ref() {
        let _ = item.set_text(&text);
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(if busy > 0 { format!("Kaisu: {text}") } else { "Kaisu".to_string() }));
    }

    if should_quit_when_idle(mode, busy, state.hidden_by_close.load(Ordering::SeqCst)) {
        // Give the "downloads finished" notification a moment to go out, and make sure nothing changed.
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(3));
            let st = handle.state::<TrayState>();
            if should_quit_when_idle(*st.mode.lock().unwrap(), st.busy.load(Ordering::SeqCst), st.hidden_by_close.load(Ordering::SeqCst)) {
                quit(&handle);
            }
        });
    }
}

#[tauri::command]
pub fn tray_available(state: State<'_, TrayState>) -> bool {
    state.available.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    quit(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_hides_only_when_it_should() {
        use CloseMode::*;
        assert!(!should_hide(Downloads, 0, true), "idle: just quit");
        assert!(should_hide(Downloads, 2, true), "busy: keep downloading in the background");
        assert!(should_hide(Always, 0, true));
        assert!(!should_hide(Never, 5, true));
        assert!(!should_hide(Always, 9, false), "no tray icon: never hide, or the window would be lost");
    }

    #[test]
    fn a_hidden_app_quits_when_its_downloads_finish() {
        use CloseMode::*;
        assert!(should_quit_when_idle(Downloads, 0, true));
        assert!(!should_quit_when_idle(Downloads, 1, true));
        assert!(!should_quit_when_idle(Downloads, 0, false), "visible: stay open");
        assert!(!should_quit_when_idle(Always, 0, true), "always mode keeps the tray icon alive");
    }
}
