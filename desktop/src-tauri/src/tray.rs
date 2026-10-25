//! The tray icon, and what closing the window means.
//!
//! The close button can keep Kaisu running in the background so downloads continue ("downloads" mode: only while
//! something is downloading; "always"; or "never"). The webview tells us the queue's state through
//! `set_tray_status`, and we decide here, in Rust, so closing works even if the page is busy.

use std::sync::{
    Mutex, MutexGuard,
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
};
use std::time::Duration;

use serde::Deserialize;
use tauri::{
    AppHandle, Emitter, Manager, State, Window, WindowEvent, Wry,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::download::Downloads;

/// A poisoned lock only means another thread panicked; the tray state is plain data and still usable.
fn locked<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

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
    preparing_exit: AtomicBool,
    /// Counts quit requests so a stale fallback timer from a cancelled quit cannot end a later one.
    quit_epoch: AtomicU64,
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
    let state = app.state::<TrayState>();
    if state.preparing_exit.swap(true, Ordering::SeqCst) { return; }
    let epoch = state.quit_epoch.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = app.emit("prepare-exit", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(8));
        let state = handle.state::<TrayState>();
        if state.quit_epoch.load(Ordering::SeqCst) == epoch && state.preparing_exit.swap(false, Ordering::SeqCst) {
            handle.state::<Downloads>().kill_all();
            handle.exit(0);
        }
    });
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
        let play_pause = MenuItem::with_id(app, "player_toggle", "Play / pause music", true, None::<&str>)?;
        let previous = MenuItem::with_id(app, "player_previous", "Previous track", true, None::<&str>)?;
        let next = MenuItem::with_id(app, "player_next", "Next track", true, None::<&str>)?;
        let quit_item = MenuItem::with_id(app, "quit", "Quit Kaisu", true, None::<&str>)?;
        let (sep1, sep2, sep3) = (PredefinedMenuItem::separator(app)?, PredefinedMenuItem::separator(app)?, PredefinedMenuItem::separator(app)?);
        let menu = Menu::with_items(app, &[&show, &sep1, &status, &pause, &resume, &sep2, &play_pause, &previous, &next, &sep3, &quit_item])?;

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
                // The music player lives in the page; the tray just tells it what was pressed.
                id @ ("player_toggle" | "player_previous" | "player_next") => {
                    let _ = app.emit("tray-action", id);
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
        *locked(&state.status_item) = Some(status);
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
        let mode = *locked(&state.mode);
        if should_hide(mode, state.busy.load(Ordering::SeqCst), state.available.load(Ordering::SeqCst)) {
            api.prevent_close();
            let _ = window.hide();
            state.hidden_by_close.store(true, Ordering::SeqCst);
            let _ = window.app_handle().emit("background-started", ());
        } else {
            api.prevent_close();
            quit(window.app_handle());
        }
    }
}

/// What the tray menu says about the queue.
fn status_text(active: u32, queued: u32, paused: u32, playing: bool) -> String {
    match (active, queued, paused) {
        (0, 0, 0) if playing => "Playing music".to_string(),
        (0, 0, 0) => "No active downloads".to_string(),
        (0, 0, p) => format!("{p} paused"),
        (a, q, _) => format!("{a} downloading{}{}", if q > 0 { format!(", {q} waiting") } else { String::new() }, if playing { " · playing music" } else { "" }),
    }
}

/// The page reports its queue (and whether music is playing) so the tray and the close button can react. Music counts as
/// work: closing the window while it plays keeps Kaisu running in the background, and it quits when the music stops.
#[tauri::command]
pub fn set_tray_status(app: AppHandle, state: State<'_, TrayState>, active: u32, queued: u32, paused: u32, mode: CloseMode, playing: Option<bool>) {
    let playing = playing.unwrap_or(false);
    let busy = active + queued + u32::from(playing);
    state.busy.store(busy, Ordering::SeqCst);
    *locked(&state.mode) = mode;

    let text = status_text(active, queued, paused, playing);
    if let Some(item) = locked(&state.status_item).as_ref() {
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
            if should_quit_when_idle(*locked(&st.mode), st.busy.load(Ordering::SeqCst), st.hidden_by_close.load(Ordering::SeqCst)) {
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
pub fn finish_exit(app: AppHandle, saved: bool) {
    if !app.state::<TrayState>().preparing_exit.swap(false, Ordering::SeqCst) { return; }
    if saved { app.state::<Downloads>().kill_all(); app.exit(0); } else { show_main(&app); }
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
    fn the_menu_says_what_is_going_on() {
        assert_eq!(status_text(0, 0, 0, false), "No active downloads");
        assert_eq!(status_text(0, 0, 0, true), "Playing music");
        assert_eq!(status_text(0, 0, 3, false), "3 paused");
        assert_eq!(status_text(2, 1, 0, false), "2 downloading, 1 waiting");
        assert_eq!(status_text(1, 0, 0, true), "1 downloading · playing music");
    }

    #[test]
    fn playing_music_keeps_the_window_alive_in_the_background() {
        use CloseMode::*;
        // Music alone counts as one busy thing.
        assert!(should_hide(Downloads, 1, true));
        assert!(!should_quit_when_idle(Downloads, 1, true), "still playing");
        assert!(should_quit_when_idle(Downloads, 0, true), "the music stopped");
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
