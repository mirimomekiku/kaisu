//! Moving finished downloads to another place (an external drive, a NAS share) and removing old ones.
//!
//! Both only ever touch files inside folders the app was told about, and only real audio and video files with their
//! subtitle and lyrics companions, so a damaged history entry can't point them at anything else. A move is a copy
//! that is checked before the original is removed: a drive that disappears halfway loses nothing.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::files::MEDIA_EXTENSIONS;

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
fn checked_source(path: &str, base: &Path) -> Result<PathBuf, String> {
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
        .filter(|p| p != media && is_sidecar(p) && p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(&prefix)))
        .collect()
}

/// Copies, checks the size, and only then puts the file under its real name.
fn copy_checked(from: &Path, to: &Path) -> Result<(), String> {
    let part = to.with_file_name(format!("{}.kaisu-part", to.file_name().and_then(|n| n.to_str()).unwrap_or("file")));
    let result = (|| {
        let copied = fs::copy(from, &part).map_err(|e| format!("Couldn't copy the file: {e}"))?;
        let expected = fs::metadata(from).map_err(|e| e.to_string())?.len();
        if copied != expected || fs::metadata(&part).map(|m| m.len()).unwrap_or(0) != expected {
            return Err("The copy came out the wrong size, so the original was kept.".to_string());
        }
        fs::rename(&part, to).map_err(|e| format!("Couldn't finish the copy: {e}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&part);
    }
    result
}

/// Moves or copies one file. Returns where it ended up (None when it was skipped).
fn transfer_one(src: &Path, base: &Path, dest_root: &Path, mode: MoveMode, conflict: Conflict, keep_layout: bool) -> Result<Option<PathBuf>, String> {
    let target = destination_for(src, base, dest_root, keep_layout).ok_or("Couldn't work out where this file goes.")?;
    let target = if target.exists() {
        match conflict {
            Conflict::Skip => return Ok(None),
            Conflict::Replace => target,
            Conflict::KeepBoth => unique_name(&target),
        }
    } else {
        target
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
    // Companions go along; losing one is not worth failing the song.
    for side in sidecars_of(src) {
        if let Some(t) = destination_for(&side, base, dest_root, keep_layout) {
            let t = if t.exists() && conflict == Conflict::Skip { continue } else if t.exists() && conflict == Conflict::KeepBoth { unique_name(&t) } else { t };
            let _ = match mode {
                MoveMode::Move if fs::rename(&side, &t).is_ok() => Ok(()),
                MoveMode::Move => copy_checked(&side, &t).and_then(|_| fs::remove_file(&side).map_err(|e| e.to_string())),
                MoveMode::Copy => copy_checked(&side, &t),
            };
        }
    }
    Ok(Some(target))
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

#[tauri::command]
pub async fn transfer_files(items: Vec<MoveItem>, base_dir: String, dest_dir: String, mode: Option<MoveMode>, conflict: Option<Conflict>, keep_layout: Option<bool>) -> Result<Vec<MoveResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
                    Ok(Some(p)) => MoveResult { id: item.id, ok: true, new_path: Some(p.display().to_string()), ..Default::default() },
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
}

/// Deletes downloaded files (and their subtitle and lyrics files) that lie inside `allowed` folders.
#[tauri::command]
pub async fn delete_files(paths: Vec<String>, allowed: Vec<String>) -> Result<Vec<DeleteResult>, String> {
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
                        fs::remove_file(&real).map_err(|e| format!("Couldn't delete it: {e}"))?;
                        for s in sides {
                            let _ = fs::remove_file(s);
                        }
                        Ok(())
                    });
                match outcome {
                    Ok(()) => DeleteResult { path, ok: true, error: None },
                    Err(e) => DeleteResult { path, ok: false, error: Some(e) },
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
        let out = transfer_one(&src, &real_base, &real_dest, MoveMode::Move, Conflict::KeepBoth, true).unwrap().unwrap();
        assert_eq!(out, real_dest.join("Artist/song.mp3"));
        assert_eq!(fs::read(&out).unwrap(), b"audio-bytes");
        assert!(dest.join("Artist/song.en.srt").is_file() && dest.join("Artist/song.lrc").is_file());
        assert!(!base.join("Artist/song.mp3").exists() && !base.join("Artist/song.lrc").exists(), "originals are gone after a move");
        assert!(base.join("Artist/other.mp3").exists(), "other files are untouched");
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
        let both = transfer_one(&src, &real_base, &real_dest, MoveMode::Copy, Conflict::KeepBoth, true).unwrap().unwrap();
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

    #[tokio::test]
    async fn a_destination_inside_the_download_folder_is_refused() {
        let base = scratch("loop");
        write(&base.join("song.mp3"), b"x");
        let inside = base.join("backup");
        fs::create_dir_all(&inside).unwrap();
        let items = vec![MoveItem { id: "1".into(), path: base.join("song.mp3").display().to_string() }];
        let err = transfer_files(items, base.display().to_string(), inside.display().to_string(), None, None, None).await.unwrap_err();
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
        let res = delete_files(paths, vec![base.display().to_string()]).await.unwrap();
        assert!(res[0].ok && !res[1].ok && !res[2].ok, "{res:?}");
        assert!(!base.join("a/old.mp3").exists() && !base.join("a/old.srt").exists(), "the companion goes too");
        assert!(base.join("a/keep.mp3").exists() && other.join("mine.mp3").exists());
        assert!(delete_files(vec![], vec![]).await.is_err());
        fs::remove_dir_all(&base).ok();
        fs::remove_dir_all(&other).ok();
    }
}
