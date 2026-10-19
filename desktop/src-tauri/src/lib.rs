mod download;
mod engine;
mod proc;
mod setup;

use engine::{Engine, EngineInfo, UpdateResult};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
async fn get_engine_info(app: AppHandle, engine: State<'_, Engine>) -> Result<EngineInfo, String> {
    Ok(engine.info(&app).await)
}

/// Checks for and installs a newer yt-dlp. Refused while downloads are running, because
/// Windows can't replace an executable that is in use.
#[tauri::command]
async fn update_engine(
    app: AppHandle,
    engine: State<'_, Engine>,
    downloads: State<'_, download::Downloads>,
) -> Result<UpdateResult, String> {
    if !downloads.is_idle() {
        return Err("Wait for running downloads to finish before updating".into());
    }
    engine.update(&app).await
}

#[tauri::command]
fn default_download_dir(app: AppHandle) -> Result<String, String> {
    app.path()
        .download_dir()
        .map(|p| p.display().to_string())
        .map_err(|e| format!("Cannot find Downloads folder: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(Engine::default())
        .manage(download::Downloads::default())
        .invoke_handler(tauri::generate_handler![
            get_engine_info,
            update_engine,
            default_download_dir,
            setup::check_setup,
            setup::run_setup,
            download::get_media_info,
            download::start_download,
            download::cancel_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
