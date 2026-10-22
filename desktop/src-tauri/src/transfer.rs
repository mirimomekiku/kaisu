//! Moving finished downloads to another place (an external drive, a NAS share) and removing old ones.
//!
//! Both only ever touch files inside folders the app was told about, and only real audio and video files with their
//! subtitle and lyrics companions, so a damaged history entry can't point them at anything else. A move is a copy
//! that is checked before the original is removed: a drive that disappears halfway loses nothing.

use std::{fs, sync::Mutex};

static TRANSFER: Mutex<()> = Mutex::new(());
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{files::MEDIA_EXTENSIONS, scope::Scope};

/// Files that belong next to a download and travel (or go) with it.
const SIDECAR_EXTENSIONS: &[&str] = &["srt", "vtt", "lrc", "txt"];

#[derive(Deserialize, Clone, Copy, Default, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum MoveMode {
    /// Copy, check, then remove the original.
    #[default]
    Move,
    /// Leave the original where it is.
    Copy,
}

#[derive(Deserialize, Clone, Copy, Default, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Conflict {
    /// `Song (2).mp3`
    #[default]
    KeepBoth,
    Skip,
    Replace,
}

#[derive(Deserialize)]
pub struct MoveItem {
    pub id: String,
    pub path: String,
}

#[derive(Serialize, Debug, Default)]
pub struct MoveResult {
    pub id: String,
    pub ok: bool,
    pub skipped: bool,
    pub new_path: Option<String>,
    pub error: Option<String>,
    /// The file itself arrived, but something that belongs with it (subtitles, lyrics) did not.
    pub warning: Option<String>,
}

/// Where a file ended up, and a note when one of its companion files could not follow it.
#[derive(Debug, PartialEq)]
struct Moved {
    path: PathBuf,
    warning: Option<String>,
}

fn is_media(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).is_some_and(|e| MEDIA_EXTENSIONS.contains(&e.as_str()))
}

fn is_sidecar(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).is_some_and(|e| SIDECAR_EXTENSIONS.contains(&e.as_str()))
}

/// `a/b/../c` without touching the disk. Refuses to climb out of the start.
fn has_parent_part(path: &Path) -> bool {
    path.components().any(|c| matches!(c, Component::ParentDir))
}

/// A real file we may touch: absolute, free of `..`, inside `base`, a media file that exists.
pub(crate) fn checked_source(path: &str, base: &Path) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() || has_parent_part(&p) {
        return Err("That isn't a valid file location.".into());
    }
    let real = fs::canonicalize(&p).map_err(|_| "The file has been moved or deleted.".to_string())?;
    let real_base = fs::canonicalize(base).map_err(|_| "The download folder can't be found.".to_string())?;
    if !real.starts_with(&real_base) {
        return Err("That file isn't in the download folder.".into());
    }
    if !real.is_file() || !is_media(&real) {
        return Err("Only audio and video files are moved.".into());
    }
    Ok(real)
}

/// Where a file lands: the same folders as in the download folder (`keep_layout`), or straight in the destination.
pub fn destination_for(src: &Path, base: &Path, dest: &Path, keep_layout: bool) -> Option<PathBuf> {
    let rel = if keep_layout { src.strip_prefix(base).ok()?.to_path_buf() } else { PathBuf::from(src.file_name()?) };
    Some(dest.join(rel))
}

/// `Song.mp3` → `Song (2).mp3` (or 3, 4, ...) until the name is free.
pub fn unique_name(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file").to_string();
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    let dir = path.parent().unwrap_or(Path::new(""));
    (2..10_000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or_else(|| path.to_path_buf())
}

/// The subtitle and lyrics files that sit next to a download (`Song.mp3` → `Song.lrc`, `Song.en.srt`).
fn sidecars_of(media: &Path) -> Vec<PathBuf> {
    let (Some(dir), Some(stem)) = (media.parent(), media.file_stem().and_then(|s| s.to_str())) else { return Vec::new() };
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let prefix = format!("{stem}.");
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p != media && fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_file()) && is_sidecar(p) && p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(&prefix)))
        .collect()
}

/// Copies, checks the size, and only then puts the file under its real name.
fn copy_checked(from: &Path, to: &Path) -> Result<(), String> {
    let part = to.with_file_name(format!("{}.kaisu-part", to.file_name().and_then(|n| n.to_str()).unwrap_or("file")));
    // Reserve before copying. An existing staging file is never overwritten or cleaned up by us.
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut output = options.open(&part)
        .map_err(|e| format!("Couldn't reserve a working copy: {e}"))?;
    let result = (|| {
        let mut input = fs::File::open(from).map_err(|e| format!("Couldn't read the file: {e}"))?;
        let before = input.metadata().map_err(|e| e.to_string())?;
        let copied = std::io::copy(&mut input, &mut output).map_err(|e| format!("Couldn't copy the file: {e}"))?;
        output.sync_all().map_err(|e| format!("Couldn't finish writing the copy: {e}"))?;
        let after = input.metadata().map_err(|e| e.to_string())?;
        if copied != before.len() || after.len() != before.len() || before.modified().ok() != after.modified().ok()
            || output.metadata().map(|m| m.len()).unwrap_or(0) != before.len() {
            return Err("The file changed or the copy came out the wrong size, so the original was kept.".to_string());
        }
        output.set_permissions(before.permissions()).map_err(|e| format!("Couldn't preserve the file permissions: {e}"))?;
        drop(output);
        fs::rename(&part, to).map_err(|e| format!("Couldn't finish the copy: {e}"))
    })();
    if result.is_err() {
        #[cfg(windows)]
        if let Ok(metadata) = fs::metadata(&part) {
            let mut permissions = metadata.permissions();
            permissions.set_readonly(false);
            let _ = fs::set_permissions(&part, permissions);
        }
        let _ = fs::remove_file(&part);
    }
    result
}

/// Preserve the complete suffix: song.en.srt follows song (2).mp3 as song (2).en.srt.
fn companion_target(source: &Path, target: &Path, companion: &Path) -> Result<PathBuf, String> {
    let stem = source.file_stem().and_then(|s| s.to_str()).ok_or("Invalid media filename.")?;
    let suffix = companion.file_name().and_then(|s| s.to_str()).and_then(|s| s.strip_prefix(stem)).ok_or("Invalid companion filename.")?;
    let new_stem = target.file_stem().and_then(|s| s.to_str()).ok_or("Invalid destination filename.")?;
    Ok(target.with_file_name(format!("{new_stem}{suffix}")))
}

fn occupied(path: &Path) -> bool { fs::symlink_metadata(path).is_ok() }

/// Pick a name for the whole group, including companion-only collisions.
fn group_target(source: &Path, requested: &Path, companions: &[PathBuf]) -> Result<PathBuf, String> {
    let stem = requested.file_stem().and_then(|s| s.to_str()).ok_or("Invalid destination filename.")?;
    let ext = requested.extension().and_then(|s| s.to_str()).map(|s| format!(".{s}")).unwrap_or_default();
    for n in 1..10_000 {
        let target = if n == 1 { requested.to_path_buf() } else { requested.with_file_name(format!("{stem} ({n}){ext}")) };
        if !occupied(&target) && sidecars_of(&target).is_empty()
            && companions.iter().all(|side| companion_target(source, &target, side).is_ok_and(|p| !occupied(&p))) {
            return Ok(target);
        }
    }
    Err("Couldn't find a free name for the media and its companion files.".into())
}

/// Moves or copies one file. Returns where it ended up (None when it was skipped).
fn transfer_one(src: &Path, base: &Path, dest_root: &Path, mode: MoveMode, conflict: Conflict, keep_layout: bool) -> Result<Option<Moved>, String> {
    let requested = destination_for(src, base, dest_root, keep_layout).ok_or("Couldn't work out where this file goes.")?;
    let sides = sidecars_of(src);
    let target = match conflict {
        Conflict::KeepBoth => group_target(src, &requested, &sides)?,
        Conflict::Skip if requested.exists() => return Ok(None),
        _ => requested,
    };
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Couldn't create the folder {}: {e}", parent.display()))?;
    }
    let size = fs::metadata(src).map(|m| m.len()).unwrap_or(0);
    let free = crate::download::free_space_for(dest_root)?;
    // Moving inside one drive needs no extra space, but copying does; checking either way keeps it simple.
    if free < size + 16 * 1024 * 1024 {
        return Err("There isn't enough free space at the destination.".into());
    }
    match mode {
        // Same drive: a rename is instant and can't half-finish.
        MoveMode::Move if fs::rename(src, &target).is_ok() => {}
        MoveMode::Move => {
            copy_checked(src, &target)?;
            fs::remove_file(src).map_err(|e| format!("Copied, but couldn't remove the original: {e}"))?;
        }
        MoveMode::Copy => copy_checked(src, &target)?,
    }
    // Companions go along. Losing one doesn't fail the song, but it is reported.
    let mut failed: Vec<String> = Vec::new();
    for side in sides {
        let t = companion_target(src, &target, &side)?;
        if t.exists() && conflict == Conflict::Skip { continue; }
        let done = match mode {
            MoveMode::Move if fs::rename(&side, &t).is_ok() => Ok(()),
            MoveMode::Move => copy_checked(&side, &t).and_then(|_| fs::remove_file(&side).map_err(|e| format!("Copied, but couldn't remove the original: {e}"))),
            MoveMode::Copy => copy_checked(&side, &t),
        };
        if let Err(e) = done {
            failed.push(format!("{} ({e})", side.file_name().and_then(|n| n.to_str()).unwrap_or("a companion file")));
        }
    }
    let warning = (!failed.is_empty()).then(|| format!("The file was {} but not everything that goes with it: {}", if mode == MoveMode::Copy { "copied" } else { "moved" }, failed.join("; ")));
    Ok(Some(Moved { path: target, warning }))
}

/// Checks a destination is there and can be written to. Nothing is created.
fn check_destination_sync(path: &str) -> Result<u64, String> {
    let dir = PathBuf::from(path);
    if path.trim().is_empty() || !dir.is_absolute() {
        return Err("Choose a folder for moved downloads.".into());
    }
    if !dir.exists() {
        return Err("That drive or folder isn't connected right now.".into());
    }
    if !dir.is_dir() {
        return Err("That is a file, not a folder.".into());
    }
    let test = dir.join(format!(".kaisu-write-test-{}", std::process::id()));
    fs::write(&test, b"").map_err(|_| "Kaisu can't write to that folder. Is the drive read-only?".to_string())?;
    let _ = fs::remove_file(&test);
    crate::download::free_space_for(&dir)
}

#[derive(Serialize)]
pub struct DestinationCheck {
    pub free: u64,
}

#[tauri::command]
pub fn check_destination(path: String) -> Result<DestinationCheck, String> {
    check_destination_sync(&path).map(|free| DestinationCheck { free })
}

/// Moves or copies finished downloads from the download folder to the folder for moved downloads.
/// Both folders come from `Scope`, never from the caller.
#[tauri::command]
pub async fn transfer_files(app: tauri::AppHandle, scope: State<'_, Scope>, items: Vec<MoveItem>, mode: Option<MoveMode>, conflict: Option<Conflict>, keep_layout: Option<bool>) -> Result<Vec<MoveResult>, String> {
    let (base, dest) = (scope.download()?, scope.moved()?);
    let sources: std::collections::HashMap<_, _> = items.iter().map(|i| (i.id.clone(), i.path.clone())).collect();
    let mut results = run_transfer(items, base.display().to_string(), dest.display().to_string(), mode, conflict, keep_layout).await?;
    if mode.unwrap_or_default() == MoveMode::Move {
        let mappings: Vec<_> = results.iter().filter(|r| r.ok && !r.skipped).filter_map(|r| Some((sources.get(&r.id)?.clone(), crate::scope::plain_path(Path::new(r.new_path.as_ref()?))))).collect();
        let updated = (|| {
            let _lock = crate::library::CACHE_EDIT.lock().map_err(|_| "Library is unavailable.".to_string())?;
            let cache = crate::library::cache_path(&app)?;
            let mut tracks = crate::library::load_cache(&cache);
            crate::library::relocate_cached_tracks(&mut tracks, &mappings);
            crate::library::save_cache(&cache, &tracks)
        })();
        if let Err(why) = updated {
            // The files have moved; return their successful mappings even if cache persistence fails.
            for result in results.iter_mut().filter(|r| r.ok && !r.skipped) {
                let note = format!("The file moved, but its library cache could not be updated: {why}");
                result.warning = Some(result.warning.take().map(|w| format!("{w}; {note}")).unwrap_or(note));
            }
        }
    }
    Ok(results)
}

async fn run_transfer(items: Vec<MoveItem>, base_dir: String, dest_dir: String, mode: Option<MoveMode>, conflict: Option<Conflict>, keep_layout: Option<bool>) -> Result<Vec<MoveResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = TRANSFER.lock().map_err(|_| "File transfer is unavailable.")?;
        let (mode, conflict, keep_layout) = (mode.unwrap_or_default(), conflict.unwrap_or_default(), keep_layout.unwrap_or(true));
        check_destination_sync(&dest_dir)?;
        let base = PathBuf::from(&base_dir);
        let dest = fs::canonicalize(&dest_dir).map_err(|_| "That drive or folder isn't connected right now.".to_string())?;
        let real_base = fs::canonicalize(&base).map_err(|_| "The download folder can't be found.".to_string())?;
        // Moving a folder into itself would never end.
        if dest.starts_with(&real_base) || real_base.starts_with(&dest) {
            return Err("The destination can't be the download folder, or inside it (or contain it).".to_string());
        }
        Ok(items
            .into_iter()
            .map(|item| {
                let done = checked_source(&item.path, &real_base).and_then(|src| transfer_one(&src, &real_base, &dest, mode, conflict, keep_layout));
                match done {
                    Ok(Some(m)) => MoveResult { id: item.id, ok: true, new_path: Some(crate::scope::plain_path(&m.path)), warning: m.warning, ..Default::default() },
                    Ok(None) => MoveResult { id: item.id, ok: true, skipped: true, ..Default::default() },
                    Err(e) => MoveResult { id: item.id, error: Some(e), ..Default::default() },
                }
            })
            .collect())
    })
    .await
    .map_err(|e| format!("The move stopped unexpectedly: {e}"))?
}

#[derive(Serialize, Debug, Default)]
pub struct DeleteResult {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

/// Deletes downloaded files (and their subtitle and lyrics files) from the download folder, and from the folder for
/// moved downloads when `include_moved` is set. Explicit file actions may opt into library roots with `include_library`;
/// automatic cleanup never sets that flag. The folders come from `Scope`, never from the caller.
#[tauri::command]
pub async fn delete_files(scope: State<'_, Scope>, paths: Vec<String>, include_moved: Option<bool>, permanent: Option<bool>, include_library: Option<bool>) -> Result<Vec<DeleteResult>, String> {
    let download = scope.download();
    let moved = if include_moved.unwrap_or(false) { scope.moved().ok() } else { None };
    let allowed: Vec<String> = if include_library.unwrap_or(false) {
        scope.library_dirs().iter().map(|p| p.display().to_string()).collect()
    } else { download.iter().chain(moved.iter()).map(|p| p.display().to_string()).collect() };
    if let (Err(why), true) = (&download, allowed.is_empty()) {
        return Err(why.clone());
    }
    run_delete(paths, allowed, permanent.unwrap_or(false)).await
}

async fn run_delete(paths: Vec<String>, allowed: Vec<String>, permanent: bool) -> Result<Vec<DeleteResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bases: Vec<PathBuf> = allowed.iter().filter_map(|a| fs::canonicalize(a).ok()).collect();
        if bases.is_empty() {
            return Err("There's no download folder to delete from.".to_string());
        }
        Ok(paths
            .into_iter()
            .map(|path| {
                let outcome = bases
                    .iter()
                    .find_map(|b| checked_source(&path, b).ok())
                    .ok_or_else(|| "That file isn't somewhere Kaisu may delete from.".to_string())
                    .and_then(|real| {
                        let sides = sidecars_of(&real);
                        crate::removal::remove(&real, permanent)?;
                        let mut warnings = Vec::new();
                        for s in sides {
                            if let Err(why) = crate::removal::remove(&s, permanent) {
                                warnings.push(format!("{}: {why}", s.display()));
                            }
                        }
                        Ok(warnings)
                    });
                match outcome {
                    Ok(warnings) => DeleteResult { path, ok: true, error: None, warning: (!warnings.is_empty()).then(|| format!("The media file was removed, but some companion files remain: {}", warnings.join("; "))) },
                    Err(e) => DeleteResult { path, ok: false, error: Some(e), warning: None },
                }
            })
            .collect())
    })
    .await
    .map_err(|e| format!("The delete stopped unexpectedly: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kaisu-tr-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn destinations_keep_or_flatten_the_layout() {
        let (base, dest) = (Path::new("/dl"), Path::new("/mnt/usb"));
        let src = Path::new("/dl/Artist/Album/01 - Song.mp3");
        assert_eq!(destination_for(src, base, dest, true).unwrap(), Path::new("/mnt/usb/Artist/Album/01 - Song.mp3"));
        assert_eq!(destination_for(src, base, dest, false).unwrap(), Path::new("/mnt/usb/01 - Song.mp3"));
        assert!(destination_for(Path::new("/elsewhere/x.mp3"), base, dest, true).is_none());
    }

    #[test]
    fn names_are_made_unique() {
        let dir = scratch("unique");
        let p = dir.join("Song.mp3");
        assert_eq!(unique_name(&p), p);
        write(&p, b"x");
        assert_eq!(unique_name(&p), dir.join("Song (2).mp3"));
        write(&dir.join("Song (2).mp3"), b"x");
        assert_eq!(unique_name(&p), dir.join("Song (3).mp3"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn only_media_inside_the_base_is_accepted() {
        let base = scratch("src");
        write(&base.join("a/song.mp3"), b"12345");
        write(&base.join("notes.exe"), b"x");
        let outside = scratch("outside");
        write(&outside.join("secret.mp3"), b"x");
        assert!(checked_source(&base.join("a/song.mp3").display().to_string(), &base).is_ok());
        assert!(checked_source(&base.join("notes.exe").display().to_string(), &base).is_err());
        assert!(checked_source(&outside.join("secret.mp3").display().to_string(), &base).is_err());
        assert!(checked_source(&format!("{}/a/../../{}/secret.mp3", base.display(), outside.file_name().unwrap().to_str().unwrap()), &base).is_err());
        assert!(checked_source("relative.mp3", &base).is_err());
        assert!(checked_source(&base.join("missing.mp3").display().to_string(), &base).is_err());
        fs::remove_dir_all(&base).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn moving_keeps_layout_and_takes_companions() {
        let base = scratch("mv-base");
        let dest = scratch("mv-dest");
        write(&base.join("Artist/song.mp3"), b"audio-bytes");
        write(&base.join("Artist/song.en.srt"), b"subs");
        write(&base.join("Artist/song.lrc"), b"lyrics");
        write(&base.join("Artist/other.mp3"), b"stay");
        let src = checked_source(&base.join("Artist/song.mp3").display().to_string(), &base).unwrap();
        let real_base = fs::canonicalize(&base).unwrap();
        let real_dest = fs::canonicalize(&dest).unwrap();
        let moved = transfer_one(&src, &real_base, &real_dest, MoveMode::Move, Conflict::KeepBoth, true).unwrap().unwrap();
        let out = moved.path.clone();
        assert_eq!(out, real_dest.join("Artist/song.mp3"));
        assert_eq!(moved.warning, None, "nothing went wrong");
        assert_eq!(fs::read(&out).unwrap(), b"audio-bytes");
        assert!(dest.join("Artist/song.en.srt").is_file() && dest.join("Artist/song.lrc").is_file());
        assert!(!base.join("Artist/song.mp3").exists() && !base.join("Artist/song.lrc").exists(), "originals are gone after a move");
        assert!(base.join("Artist/other.mp3").exists(), "other files are untouched");
        fs::remove_dir_all(&base).ok();
        fs::remove_dir_all(&dest).ok();
    }

    #[test]
    fn a_companion_that_cannot_follow_is_reported_not_swallowed() {
        let base = scratch("warn-base");
        let dest = scratch("warn-dest");
        write(&base.join("song.mp3"), b"audio");
        write(&base.join("song.lrc"), b"lyrics");
        // A folder where the lyrics file would land makes that one file impossible to place.
        fs::create_dir_all(dest.join("song.lrc")).unwrap();
        let (real_base, real_dest) = (fs::canonicalize(&base).unwrap(), fs::canonicalize(&dest).unwrap());
        let src = checked_source(&base.join("song.mp3").display().to_string(), &base).unwrap();
        let moved = transfer_one(&src, &real_base, &real_dest, MoveMode::Copy, Conflict::Replace, true).unwrap().unwrap();
        assert!(moved.path.is_file(), "the song itself arrived");
        let warning = moved.warning.expect("the lyrics failure is reported");
        assert!(warning.contains("song.lrc") && warning.contains("copied"), "{warning}");
        fs::remove_dir_all(&base).ok();
        fs::remove_dir_all(&dest).ok();
    }

    #[test]
    fn copying_leaves_the_original_and_conflicts_follow_the_rule() {
        let base = scratch("cp-base");
        let dest = scratch("cp-dest");
        write(&base.join("song.mp3"), b"new");
        write(&dest.join("song.mp3"), b"old");
        let real_base = fs::canonicalize(&base).unwrap();
        let real_dest = fs::canonicalize(&dest).unwrap();
        let src = checked_source(&base.join("song.mp3").display().to_string(), &base).unwrap();
        assert_eq!(transfer_one(&src, &real_base, &real_dest, MoveMode::Copy, Conflict::Skip, true).unwrap(), None);
        assert_eq!(fs::read(dest.join("song.mp3")).unwrap(), b"old");
        let both = transfer_one(&src, &real_base, &real_dest, MoveMode::Copy, Conflict::KeepBoth, true).unwrap().unwrap().path;
        assert_eq!(both, real_dest.join("song (2).mp3"));
        assert_eq!(fs::read(&both).unwrap(), b"new");
        transfer_one(&src, &real_base, &real_dest, MoveMode::Copy, Conflict::Replace, true).unwrap();
        assert_eq!(fs::read(dest.join("song.mp3")).unwrap(), b"new");
        assert!(base.join("song.mp3").exists());
        assert!(!fs::read_dir(&dest).unwrap().flatten().any(|e| e.file_name().to_string_lossy().ends_with(".kaisu-part")), "no half-copies are left behind");
        fs::remove_dir_all(&base).ok();
        fs::remove_dir_all(&dest).ok();
    }

    #[test]
    fn destinations_are_checked() {
        let dir = scratch("dest-check");
        assert!(check_destination_sync(&dir.display().to_string()).is_ok());
        assert!(check_destination_sync(&dir.join("not-plugged-in").display().to_string()).unwrap_err().contains("isn't connected"));
        assert!(check_destination_sync("").is_err());
        assert!(check_destination_sync("relative").is_err());
        let file = dir.join("f.txt");
        write(&file, b"x");
        assert!(check_destination_sync(&file.display().to_string()).is_err());
        assert!(!dir.join("not-plugged-in").exists(), "checking never creates the destination");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn keep_both_names_the_media_and_all_companions_as_one_group() {
        for mode in [MoveMode::Move, MoveMode::Copy] {
            for collision in ["song.mp3", "song.en.srt", "song.lrc"] {
                let base = scratch(&format!("group-source-{mode:?}-{collision}"));
                let dest = scratch(&format!("group-dest-{mode:?}-{collision}"));
                for name in ["song.mp3", "song.en.srt", "song.ja.vtt", "song.lrc"] { write(&base.join(name), name.as_bytes()); }
                write(&dest.join(collision), b"existing");
                write(&dest.join("song (2).lrc"), b"existing numbered lyrics");
                let moved = transfer_one(&base.join("song.mp3"), &base, &dest, mode, Conflict::KeepBoth, false).unwrap().unwrap();
                assert_eq!(moved.path, dest.join("song (3).mp3"));
                assert!(moved.warning.is_none());
                for suffix in [".mp3", ".en.srt", ".ja.vtt", ".lrc"] {
                    assert_eq!(fs::read(dest.join(format!("song (3){suffix}"))).unwrap(), format!("song{suffix}").as_bytes());
                    assert_eq!(base.join(format!("song{suffix}")).exists(), mode == MoveMode::Copy);
                }
                assert_eq!(fs::read(dest.join(collision)).unwrap(), b"existing");
                fs::remove_dir_all(base).ok(); fs::remove_dir_all(dest).ok();
            }
        }
    }

    #[test]
    fn an_existing_staging_file_is_never_overwritten_or_removed() {
        let dir = scratch("staging-collision");
        let (source, target, part) = (dir.join("original.mp3"), dir.join("copy.mp3"), dir.join("copy.mp3.kaisu-part"));
        write(&source, b"source"); write(&part, b"other operation");
        assert!(copy_checked(&source, &target).is_err());
        assert_eq!(fs::read(&part).unwrap(), b"other operation");
        assert_eq!(fs::read(&source).unwrap(), b"source");
        assert!(!target.exists());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn keep_both_does_not_attach_existing_unrelated_lyrics_or_subtitles() {
        let base = scratch("orphan-source");
        let dest = scratch("orphan-dest");
        write(&base.join("song.mp3"), b"audio without sidecars");
        write(&dest.join("song.ja.srt"), b"unrelated subtitles");
        let moved = transfer_one(&base.join("song.mp3"), &base, &dest, MoveMode::Copy, Conflict::KeepBoth, true).unwrap().unwrap();
        assert_eq!(moved.path, dest.join("song (2).mp3"));
        assert_eq!(fs::read(dest.join("song.ja.srt")).unwrap(), b"unrelated subtitles");
        assert!(sidecars_of(&moved.path).is_empty());
        fs::remove_dir_all(base).ok(); fs::remove_dir_all(dest).ok();
    }

    #[test]
    fn failed_copy_cleans_only_its_own_staging_file() {
        let dir = scratch("staging-failure");
        let target = dir.join("copy.mp3");
        assert!(copy_checked(&dir.join("missing.mp3"), &target).is_err());
        assert!(!dir.join("copy.mp3.kaisu-part").exists() && !target.exists());
        fs::remove_dir_all(dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn checked_copies_preserve_private_file_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("copy-permissions");
        let (source, target) = (dir.join("source.mp3"), dir.join("copy.mp3"));
        write(&source, b"private audio");
        fs::set_permissions(&source, fs::Permissions::from_mode(0o600)).unwrap();
        copy_checked(&source, &target).unwrap();
        assert_eq!(fs::metadata(&target).unwrap().permissions().mode() & 0o777, 0o600);
        fs::remove_dir_all(dir).ok();
    }

    #[tokio::test]
    async fn a_destination_inside_the_download_folder_is_refused() {
        let base = scratch("loop");
        write(&base.join("song.mp3"), b"x");
        let inside = base.join("backup");
        fs::create_dir_all(&inside).unwrap();
        let items = vec![MoveItem { id: "1".into(), path: base.join("song.mp3").display().to_string() }];
        let err = run_transfer(items, base.display().to_string(), inside.display().to_string(), None, None, None).await.unwrap_err();
        assert!(err.contains("can't be the download folder"));
        assert!(base.join("song.mp3").exists());
        fs::remove_dir_all(&base).ok();
    }

    #[tokio::test]
    async fn deleting_stays_inside_the_allowed_folders() {
        let base = scratch("del-base");
        let other = scratch("del-other");
        write(&base.join("a/old.mp3"), b"x");
        write(&base.join("a/old.srt"), b"x");
        write(&base.join("a/keep.mp3"), b"x");
        write(&other.join("mine.mp3"), b"x");
        let paths = vec![base.join("a/old.mp3").display().to_string(), other.join("mine.mp3").display().to_string(), base.join("a/missing.mp3").display().to_string()];
        let res = run_delete(paths, vec![base.display().to_string()], true).await.unwrap();
        assert!(res[0].ok && !res[1].ok && !res[2].ok, "{res:?}");
        assert!(!base.join("a/old.mp3").exists() && !base.join("a/old.srt").exists(), "the companion goes too");
        assert!(base.join("a/keep.mp3").exists() && other.join("mine.mp3").exists());
        assert!(run_delete(vec![], vec![], true).await.is_err());
        fs::remove_dir_all(&base).ok();
        fs::remove_dir_all(&other).ok();
    }
}
