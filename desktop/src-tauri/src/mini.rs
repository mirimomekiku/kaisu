//! Switch the existing window into a compact player; the audio engine stays in the same webview.
use std::sync::Mutex;
use tauri::{LogicalSize, PhysicalPosition, PhysicalSize, State, WebviewWindow};

struct Geometry { size: PhysicalSize<u32>, position: PhysicalPosition<i32>, maximized: bool, top: bool, resizable: bool }
#[derive(Default)]
pub struct MiniState(Mutex<Option<Geometry>>);

fn restore(window: &WebviewWindow, saved: &Geometry) -> tauri::Result<()> {
    window.set_min_size(Some(LogicalSize::new(720.0, 576.0)))?;
    window.set_size(saved.size)?;
    window.set_position(saved.position)?;
    window.set_always_on_top(saved.top)?;
    window.set_resizable(saved.resizable)?;
    if saved.maximized { window.maximize()?; }
    Ok(())
}

#[tauri::command]
pub fn set_mini_mode(window: WebviewWindow, state: State<'_, MiniState>, mini: bool) -> Result<(), String> {
    if window.label() != "main" { return Err("This is only available in the main window.".into()); }
    let mut saved = state.0.lock().map_err(|_| "Window state is unavailable.")?;
    if mini {
        if saved.is_some() { return Ok(()); }
        let geometry = (|| -> tauri::Result<Geometry> { Ok(Geometry { size: window.inner_size()?, position: window.outer_position()?, maximized: window.is_maximized()?, top: window.is_always_on_top()?, resizable: window.is_resizable()? }) })().map_err(|e| e.to_string())?;
        let result = (|| -> tauri::Result<()> {
            if geometry.maximized { window.unmaximize()?; }
            window.set_min_size(Some(LogicalSize::new(420.0, 180.0)))?;
            window.set_size(LogicalSize::new(480.0, 210.0))?;
            window.set_resizable(true)?;
            window.set_always_on_top(true)
        })();
        if let Err(e) = result { let _ = restore(&window, &geometry); return Err(e.to_string()); }
        *saved = Some(geometry);
    } else if let Some(geometry) = saved.as_ref() {
        restore(&window, geometry).map_err(|e| e.to_string())?;
        *saved = None;
    }
    Ok(())
}
