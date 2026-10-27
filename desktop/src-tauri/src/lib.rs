mod app_update;
mod waveform;
mod artwork;
mod custom_args;
mod download;
mod download_manifest;
mod duplicates;
mod engine;
mod files;
mod identification;
mod leftovers;
mod library;
mod library_folders;
mod link_handler;
mod links;
mod loudness;
mod lyrics;
mod lyrics_edit;
mod media;
mod media_stream;
mod meta;
mod mini;
mod net;
mod output;
mod podcast;
mod portable_sync;
mod power;
mod proc;
mod removal;
mod scope;
mod secrets;
mod search;
mod setup;
mod subs;
mod tags;
mod thumbs;
mod transfer;
mod tray;
mod ytdlp;

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
    proxy: Option<String>,
) -> Result<UpdateResult, String> {
    if !downloads.is_idle() {
        return Err("Wait for running downloads to finish before updating".into());
    }
    let proxy = net::proxy_option(proxy.as_deref())?;
    engine.update(&app, proxy.as_deref()).await
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
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(waveform::Waveforms::default())
        .manage(link_handler::Incoming::default())
        .manage(Engine::default())
        .manage(download::Downloads::default())
        .manage(tray::TrayState::default())
        .manage(scope::Scope::default())
        .manage(power::PowerTimer::default())
        .manage(thumbs::Thumbs::default())
        .manage(mini::MiniState::default())
        .manage(artwork::ArtworkStore::default())
        .manage(identification::Identification::default())
        .manage(portable_sync::SyncState::default())
        .manage(media_stream::MediaStream::default())
        .setup(|app| {
            library_folders::restore(app.handle(), &app.state::<scope::Scope>());
            media::clean_previews(app.handle());
            tray::init(app.handle());
            link_handler::init(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| tray::on_window_event(window, event))
        .invoke_handler(tauri::generate_handler![
            waveform::media_waveform, waveform::cancel_waveform,
            get_engine_info,
            update_engine,
            default_download_dir,
            setup::check_setup,
            setup::run_setup,
            files::file_exists,
            files::file_info,
            files::export_text,
            files::pick_link_file,
            app_update::check_app_update,
            link_handler::take_incoming_links, link_handler::link_handler_status, link_handler::link_handler_set,
            files::open_file,
            files::reveal_file,
            files::reveal_engine,
            files::open_url,
            files::open_folder,
            power::schedule_power,
            power::cancel_power,
            scope::set_managed_folders,
            thumbs::fetch_thumbnail,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_status,
            secrets::secret_delete,
            links::classify_link,
            links::get_playlist,
            download::get_media_info,
            download::start_download,
            download::cancel_download,
            custom_args::allowed_custom_options,
            custom_args::check_custom_args,
            leftovers::find_leftovers,
            download_manifest::download_recovery,
            download_manifest::discard_download_recovery,
            artwork::library_choose_artwork,
            artwork::library_artwork_preview,
            artwork::library_discard_artwork,
            identification::identify_search,
            identification::identify_details,
            identification::identify_cover,
            identification::album_release_search,
            identification::album_release_tracks,
            lyrics_edit::lyrics_edit_read,
            lyrics_edit::lyrics_edit_save,
            portable_sync::portable_sync_devices,
            portable_sync::portable_sync_profiles,
            portable_sync::portable_sync_create,
            portable_sync::portable_sync_save,
            portable_sync::portable_sync_forget,
            portable_sync::portable_sync_plan,
            portable_sync::portable_sync_apply,
            portable_sync::portable_sync_cancel,
            library::library_load,
            library_folders::library_folders,
            library_folders::library_add_folder,
            library_folders::library_remove_folder,
            library_folders::library_locate,
            duplicates::library_duplicates,
            duplicates::library_remove_duplicates,
            mini::set_mini_mode,
            library::library_scan,
            library::library_forget_missing,
            library::library_cover,
            lyrics::lyrics_read,
            tags::library_edit_tags,
            loudness::library_analyze,
            podcast::podcast_fetch,
            lyrics::lyrics_find,
            leftovers::remove_leftovers,
            media::play_in_app,
            media::preview_clip,
            media::discard_preview,
            media::convert_audio,
            download::preview_command,
            files::check_folder,
            transfer::check_destination,
            transfer::transfer_files,
            transfer::delete_files,
            download::free_space,
            download::preflight_downloads,
            search::search_media,
            net::test_proxy,
            tray::set_tray_status,
            tray::tray_available,
            tray::show_main_window,
            tray::quit_app,
            tray::finish_exit,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Never leave yt-dlp / ffmpeg running after Kaisu is gone.
            if let tauri::RunEvent::Exit = event {
                app.state::<waveform::Waveforms>().cancel_all();
                app.state::<download::Downloads>().kill_all();
                app.state::<portable_sync::SyncState>().kill_all();
            }
        });
}
