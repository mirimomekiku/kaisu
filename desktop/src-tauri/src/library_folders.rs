//! Imported roots are granted by a native folder chooser and persisted by the backend.
use std::{fs, path::PathBuf, sync::Mutex};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use crate::{library, scope::{self, Scope}};

static EDIT: Mutex<()> = Mutex::new(());
const MAX_FOLDERS: usize = 50;

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("library-folders.json")).map_err(|e| e.to_string())
}

pub fn restore(app: &AppHandle, scope: &Scope) {
    let dirs: Vec<String> = file(app).ok().and_then(|p| fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let checked = dirs.into_iter().take(MAX_FOLDERS).filter_map(|p| scope::validate_library_folder(&PathBuf::from(p)).ok()).map(|p| PathBuf::from(scope::plain_path(&p))).collect();
    let _ = scope.set_library_dirs(checked);
}

#[derive(Serialize)]
pub struct MusicFolder { pub path: String, pub available: bool }

fn roots(scope: &Scope) -> Vec<MusicFolder> {
    scope.imported_dirs().iter().map(|p| MusicFolder { path: scope::plain_path(p), available: p.is_dir() }).collect()
}

fn save(app: &AppHandle, scope: &Scope, dirs: Vec<PathBuf>) -> Result<Vec<MusicFolder>, String> {
    let path = file(app)?;
    fs::create_dir_all(path.parent().ok_or("No app data folder.")?).map_err(|e| e.to_string())?;
    let values: Vec<String> = dirs.iter().map(|p| scope::plain_path(p)).collect();
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec(&values).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    scope.set_library_dirs(dirs)?;
    Ok(roots(scope))
}

#[tauri::command]
pub fn library_folders(scope: State<'_, Scope>) -> Vec<MusicFolder> { roots(&scope) }

#[tauri::command]
pub async fn library_add_folder(app: AppHandle, scope: State<'_, Scope>) -> Result<Vec<MusicFolder>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().set_title("Add a music folder to Kaisu").pick_folder(move |folder| { let _ = tx.send(folder); });
    let Some(folder) = rx.await.map_err(|e| e.to_string())? else { return Ok(roots(&scope)) };
    let path = folder.into_path().map_err(|e| e.to_string())?;
    let real = fs::canonicalize(path).map_err(|e| format!("That folder is unavailable: {e}"))?;
    let real = scope::validate_library_folder(&real)?;
    if !real.is_dir() { return Err("Choose a folder, not a file.".into()); }
    let _lock = EDIT.lock().map_err(|_| "Music folders are unavailable.")?;
    let mut dirs = scope.imported_dirs();
    let plain = PathBuf::from(scope::plain_path(&real));
    if !dirs.contains(&plain) {
        if dirs.len() >= MAX_FOLDERS { return Err("You can add up to 50 music folders.".into()); }
        dirs.push(plain);
    }
    save(&app, &scope, dirs)
}

#[tauri::command]
pub fn library_remove_folder(app: AppHandle, scope: State<'_, Scope>, path: String) -> Result<Vec<MusicFolder>, String> {
    let _lock = EDIT.lock().map_err(|_| "Music folders are unavailable.")?;
    let dirs = scope.imported_dirs().into_iter().filter(|p| scope::plain_path(p) != path).collect();
    save(&app, &scope, dirs)
}

#[derive(Serialize)]
pub struct Relocated { pub from: String, pub track: library::LibTrack }

#[tauri::command]
pub async fn library_locate(app: AppHandle, scope: State<'_, Scope>, path: String) -> Result<Option<Relocated>, String> {
    let cache = library::cache_path(&app)?;
    let previous = library::load_cache(&cache).into_iter().find(|t| t.path == path).ok_or("That entry is no longer in the library.")?;
    if PathBuf::from(&path).is_file() { return Err("That file is not missing. Rescan the library first.".into()); }
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().set_title("Locate the moved music file").add_filter("Audio", &["mp3", "m4a", "opus", "ogg", "oga", "flac", "wav", "aac", "wma"])
        .pick_file(move |file| { let _ = tx.send(file); });
    let Some(file) = rx.await.map_err(|e| e.to_string())? else { return Ok(None) };
    let chosen = file.into_path().map_err(|e| e.to_string())?;
    let real = scope.media_file(&chosen.display().to_string()).map_err(|_| "Add the folder containing this file to the library first.")?;
    if !library::is_audio(&real) { return Err("Choose an audio file.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let mut track = library::read_track(&real);
        track.path = scope::plain_path(&real);
        track.added = if previous.added > 0 { previous.added } else { previous.modified };
        let _lock = library::CACHE_EDIT.lock().map_err(|_| "Library is unavailable.")?;
        let mut tracks = library::load_cache(&cache);
        tracks.retain(|t| t.path != path && t.path != track.path);
        tracks.push(track.clone());
        library::save_cache(&cache, &tracks)?;
        Ok(Some(Relocated { from: path, track }))
    }).await.map_err(|e| e.to_string())?
}
