//! Exact byte duplicates only. Selection is reviewed in the UI and revalidated before removal.
use std::{collections::HashMap, fs, io::Read, path::{Path, PathBuf}, sync::Mutex};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State, ipc::Channel};
use crate::{library, scope::{self, Scope}};

static REMOVE: Mutex<()> = Mutex::new(());

fn digest(path: &Path) -> Result<(u64, String), String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let before = file.metadata().map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut read = 0u64;
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        read += n as u64;
        hash.update(&buffer[..n]);
    }
    let after = file.metadata().map_err(|e| e.to_string())?;
    if read != before.len() || before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("The file changed during comparison. Scan again.".into());
    }
    Ok((read, hash.finalize().iter().map(|b| format!("{b:02x}")).collect()))
}

#[derive(Serialize, Debug)]
pub struct DuplicateGroup { pub hash: String, pub size: u64, pub paths: Vec<String> }
#[derive(Serialize)]
pub struct DuplicateScan { pub groups: Vec<DuplicateGroup>, pub skipped: usize }

pub fn find(paths: Vec<PathBuf>, mut progress: impl FnMut(usize, usize)) -> DuplicateScan {
    let mut sizes: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    let mut skipped = 0;
    for path in paths {
        match fs::metadata(&path) {
            Ok(m) if m.len() > 0 => sizes.entry(m.len()).or_default().push(path),
            Ok(_) => {},
            Err(_) => skipped += 1,
        }
    }
    let candidates: Vec<PathBuf> = sizes.into_values().filter(|p| p.len() > 1).flatten().collect();
    let total = candidates.len();
    let mut hashes: HashMap<(u64, String), Vec<String>> = HashMap::new();
    progress(0, total);
    for (i, path) in candidates.into_iter().enumerate() {
        match digest(&path) {
            Ok(key) => hashes.entry(key).or_default().push(scope::plain_path(&path)),
            Err(_) => skipped += 1,
        }
        progress(i + 1, total);
    }
    let mut groups: Vec<DuplicateGroup> = hashes.into_iter().filter(|(_, paths)| paths.len() > 1).map(|((size, hash), mut paths)| {
        paths.sort(); paths.dedup(); DuplicateGroup { hash, size, paths }
    }).filter(|g| g.paths.len() > 1).collect();
    groups.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.paths[0].cmp(&b.paths[0])));
    DuplicateScan { groups, skipped }
}

#[tauri::command]
pub async fn library_duplicates(scope: State<'_, Scope>, on_progress: Channel<library::ScanProgress>) -> Result<DuplicateScan, String> {
    let dirs = scope.library_dirs();
    // Canonical path checks also cover a symlink introduced after directory enumeration.
    let paths = library::audio_files(&dirs).into_iter().filter_map(|p| scope.media_file(&scope::plain_path(&p)).ok()).collect();
    tauri::async_runtime::spawn_blocking(move || find(paths, |done, total| { let _ = on_progress.send(library::ScanProgress { done, total }); }))
        .await.map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct Removal { pub path: String, pub ok: bool, pub error: Option<String> }

pub fn remove_checked(keep: &Path, remove: &[PathBuf], expected: &str, permanent: bool) -> Result<Vec<Removal>, String> {
    let _lock = REMOVE.lock().map_err(|_| "Duplicate removal is unavailable.")?;
    let keep = fs::canonicalize(keep).map_err(|_| "The copy to keep is missing. Scan again.")?;
    let original = digest(&keep)?;
    if original.1 != expected { return Err("The copy to keep changed. Scan again before removing anything.".into()); }
    let mut results = Vec::new();
    for path in remove {
        let result = (|| {
            let real = fs::canonicalize(path).map_err(|e| e.to_string())?;
            if real == keep { return Err("The copy to keep cannot be removed.".to_string()); }
            if digest(&keep)? != original || digest(&real)? != original {
                return Err("These files no longer match. Nothing was removed.".into());
            }
            // Only the selected audio file is removed. Companion files are intentionally kept.
            crate::removal::remove(&real, permanent)
        })();
        results.push(Removal { path: scope::plain_path(path), ok: result.is_ok(), error: result.err() });
    }
    Ok(results)
}

#[tauri::command]
pub async fn library_remove_duplicates(app: AppHandle, scope: State<'_, Scope>, keep: String, paths: Vec<String>, hash: String, permanent: Option<bool>) -> Result<Vec<Removal>, String> {
    if paths.is_empty() || paths.len() > 500 { return Err("Select between 1 and 500 duplicate files.".into()); }
    let keep = scope.media_file(&keep)?;
    let files: Vec<PathBuf> = paths.iter().map(|p| scope.media_file(p)).collect::<Result<_, _>>()?;
    if !library::is_audio(&keep) || files.iter().any(|p| !library::is_audio(p)) { return Err("Only music files can be compared here.".into()); }
    let cache = library::cache_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let results = remove_checked(&keep, &files, &hash, permanent.unwrap_or(false))?;
        let _lock = library::CACHE_EDIT.lock().unwrap_or_else(|e| e.into_inner());
        let mut tracks = library::load_cache(&cache);
        tracks.retain(|t| !results.iter().any(|r| r.ok && r.path == t.path));
        library::save_cache(&cache, &tracks)?;
        Ok(results)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::scratch;
    #[test]
    fn equal_sizes_are_not_enough_to_call_files_duplicates() {
        let dir = scratch("duplicates");
        let paths: Vec<PathBuf> = ["a.mp3", "b.mp3", "c.mp3"].iter().map(|p| dir.join(p)).collect();
        fs::write(&paths[0], b"same").unwrap(); fs::write(&paths[1], b"same").unwrap(); fs::write(&paths[2], b"diff").unwrap();
        let found = find(paths.clone(), |_, _| {});
        assert_eq!(found.groups.len(), 1); assert_eq!(found.groups[0].paths.len(), 2);
        assert_eq!(found.groups[0].size, 4);
        let result = remove_checked(&paths[0], &paths[1..2], &found.groups[0].hash, true).unwrap();
        assert!(result[0].ok && paths[0].exists() && !paths[1].exists() && paths[2].exists());
        fs::remove_dir_all(dir).ok();
    }
    #[test]
    fn stale_comparisons_and_removing_the_keeper_are_refused() {
        let dir = scratch("duplicates-stale");
        let (a, b) = (dir.join("a.mp3"), dir.join("b.mp3"));
        fs::write(&a, b"same").unwrap(); fs::write(&b, b"same").unwrap();
        let hash = digest(&a).unwrap().1;
        assert!(!remove_checked(&a, std::slice::from_ref(&a), &hash, true).unwrap()[0].ok);
        fs::write(&b, b"edited").unwrap();
        assert!(!remove_checked(&a, std::slice::from_ref(&b), &hash, true).unwrap()[0].ok);
        fs::write(&a, b"changed").unwrap();
        assert!(remove_checked(&a, std::slice::from_ref(&b), &hash, true).is_err());
        assert!(a.exists() && b.exists());
        fs::remove_dir_all(dir).ok();
    }
}
