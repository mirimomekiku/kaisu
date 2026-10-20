mod download;
mod engine;
mod files;
mod links;
mod output;
mod proc;
mod search;
mod setup;
mod tray;

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
        // Must come first: a second launch focuses the running window instead of starting another copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Engine::default())
        .manage(download::Downloads::default())
        .manage(tray::TrayState::default())
        .setup(|app| {
            tray::init(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| tray::on_window_event(window, event))
        .invoke_handler(tauri::generate_handler![
            get_engine_info,
            update_engine,
            default_download_dir,
            setup::check_setup,
            setup::run_setup,
            files::file_exists,
            files::open_file,
            files::reveal_file,
            files::reveal_engine,
            files::open_url,
            files::open_folder,
            files::system_power,
            links::classify_link,
            links::get_playlist,
            download::get_media_info,
            download::start_download,
            download::cancel_download,
            download::free_space,
            search::search_media,
            tray::set_tray_status,
            tray::tray_available,
            tray::show_main_window,
            tray::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Never leave yt-dlp / ffmpeg running after Kaisu is gone.
            if let tauri::RunEvent::Exit = event {
                app.state::<download::Downloads>().kill_all();
            }
        });
}
