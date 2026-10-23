//! Unfinished downloads left in the download folder: the `.part` files yt-dlp keeps while a download is running. After a
//! crash or a power cut, or a queue that was cleared, they stay behind. This finds them so Kaisu can offer to carry on
//! (yt-dlp picks a `.part` file up where it stopped) or clear them away.
//!
//! Only the download folder Kaisu was told about is looked at, only a few folders deep, and only `.part` and `.ytdl` files
//! are ever listed or removed.

use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Serialize;
use tauri::State;

use crate::{scope::Scope, download::Downloads};

const MAX_DEPTH: usize = 4;
const MAX_FOUND: usize = 200;
const AUDIO_EXTENSIONS: &[&str] = &["m4a", "mp3", "opus", "ogg", "flac", "wav", "aac"];

#[derive(Serialize, Debug, PartialEq)]
pub struct Leftover {
    pub path: String,
    /// The file name without `.part`, which is what the finished file would be called.
    pub name: String,
    pub size: u64,
    /// Seconds since 1970 when it was last written to.
    pub modified: u64,
    /// The 11-character YouTube id in the name (`Title [id].mp4.part`), when there is one.
    pub video_id: Option<String>,
    /// The part looks like sound only, so resuming should ask for audio.
    pub audio_only: bool,
}

fn is_part(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("part"))
}

fn is_removable(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("part") || e.eq_ignore_ascii_case("ytdl"))
}

/// `Title [dQw4w9WgXcQ].f251.webm` → `dQw4w9WgXcQ`, using the last `[...]` that is exactly an id.
pub fn video_id_in(name: &str) -> Option<String> {
    let mut found = None;
    let mut rest = name;
    while let Some(open) = rest.find('[') {
        let after = &rest[open + 1..];
        let Some(close) = after.find(']') else { break };
        let candidate = &after[..close];
        if candidate.len() == 11 && candidate.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            found = Some(candidate.to_string());
        }
        rest = &after[close + 1..];
    }
    found
}

/// What the file would be called when finished, and whether it is sound only: `Song [id].f251.m4a.part`.
fn describe(path: &Path) -> (String, bool) {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    let finished = name.strip_suffix(".part").or_else(|| name.strip_suffix(".PART")).unwrap_or(name).to_string();
    let ext = Path::new(&finished).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    (finished, AUDIO_EXTENSIONS.contains(&ext.as_str()))
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<Leftover>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= MAX_FOUND {
            return;
        }
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            if depth < MAX_DEPTH {
                walk(&path, depth + 1, out);
            }
        } else if kind.is_file() && is_part(&path) {
            let Ok(meta) = entry.metadata() else { continue };
            let (name, audio_only) = describe(&path);
            let modified = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            out.push(Leftover { path: path.display().to_string(), video_id: video_id_in(&name), name, size: meta.len(), modified, audio_only });
        }
    }
}

/// Every `.part` file in `dir`, newest first.
pub fn scan(dir: &Path) -> Vec<Leftover> {
    let mut found = Vec::new();
    walk(dir, 0, &mut found);
    found.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.path.cmp(&b.path)));
    found
}

/// Removes the given `.part` files and the `.ytdl` file that goes with each, but only inside `base`.
pub fn remove(paths: &[String], base: &Path) -> Vec<(String, Result<(), String>)> {
    let real_base = fs::canonicalize(base);
    paths
        .iter()
        .map(|p| {
            let outcome = (|| {
                let real_base = real_base.as_ref().map_err(|_| "The download folder can't be found.".to_string())?;
                let path = PathBuf::from(p);
                if !path.is_absolute() || path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
                    return Err("That isn't a valid file location.".to_string());
                }
                let real = fs::canonicalize(&path).map_err(|_| "That file is already gone.".to_string())?;
                if !real.starts_with(real_base) || !real.is_file() || !is_part(&real) {
                    return Err("Only unfinished downloads in the download folder are removed.".to_string());
                }
                // `Song.mp4.part` is tracked by `Song.mp4.ytdl`.
                let state = real.with_extension("ytdl");
                fs::remove_file(&real).map_err(|e| format!("Couldn't remove it: {e}"))?;
                if is_removable(&state) && state.is_file() {
                    let _ = fs::remove_file(&state);
                }
                Ok(())
            })();
            (p.clone(), outcome)
        })
        .collect()
}

/// Unfinished downloads in the download folder.
#[tauri::command]
pub async fn find_leftovers(scope: State<'_, Scope>, downloads: State<'_, Downloads>) -> Result<Vec<Leftover>, String> {
    if !downloads.is_idle() { return Ok(Vec::new()); }
    let mut dirs = scope.destination_dirs(); dirs.extend(scope.download().ok()); dirs.sort(); dirs.dedup();
    tauri::async_runtime::spawn_blocking(move || {
        let mut found: Vec<_> = dirs.iter().flat_map(|dir| scan(dir)).collect();
        found.sort_by(|a,b| a.path.cmp(&b.path)); found.dedup_by(|a,b| a.path == b.path);
        found.sort_by(|a,b| b.modified.cmp(&a.modified)); found.truncate(MAX_FOUND); found
    }).await.map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct RemoveResult {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
}

/// Removes unfinished downloads (`.part` files) from the download folder.
#[tauri::command]
pub async fn remove_leftovers(scope: State<'_, Scope>, downloads: State<'_, Downloads>, paths: Vec<String>) -> Result<Vec<RemoveResult>, String> {
    if !downloads.is_idle() { return Err("Wait for running downloads to stop before removing partial files.".into()); }
    if paths.len() > MAX_FOUND { return Err("Remove up to 200 partial files at once.".into()); }
    let mut dirs = scope.destination_dirs(); dirs.extend(scope.download().ok()); dirs.sort(); dirs.dedup();
    let results = tauri::async_runtime::spawn_blocking(move || paths.into_iter().map(|path| {
        let result = dirs.iter().find_map(|dir| {
            let real = fs::canonicalize(&path).ok()?; let root = fs::canonicalize(dir).ok()?;
            real.starts_with(root).then(|| remove(std::slice::from_ref(&path), dir).remove(0).1)
        }).unwrap_or_else(|| Err("That partial file isn't in a registered download destination.".into()));
        (path, result)
    }).collect::<Vec<_>>()).await.map_err(|e| e.to_string())?;
    Ok(results.into_iter().map(|(path, r)| RemoveResult { path, ok: r.is_ok(), error: r.err() }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kaisu-left-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn ids_are_read_from_the_default_file_names() {
        assert_eq!(video_id_in("Daft Punk - One More Time [FGBhQbmPwH8].f137.mp4").as_deref(), Some("FGBhQbmPwH8"));
        assert_eq!(video_id_in("Mix [live] [a-b_c1D2e3F]").as_deref(), Some("a-b_c1D2e3F"), "the last one that is an id");
        assert_eq!(video_id_in("Title [too short]"), None);
        assert_eq!(video_id_in("No brackets.mp4"), None);
        assert_eq!(video_id_in("Broken [FGBhQbmPwH8"), None);
    }

    #[test]
    fn part_files_are_found_with_what_they_will_become() {
        let dir = scratch("scan");
        write(&dir.join("Song [FGBhQbmPwH8].f251.m4a.part"), b"12345");
        write(&dir.join("Song [FGBhQbmPwH8].f251.m4a.ytdl"), b"{}");
        write(&dir.join("deep/er/Clip [abcdefghijk].mp4.part"), b"1234567890");
        write(&dir.join("finished [abcdefghijl].mp4"), b"done");
        write(&dir.join("notes.txt"), b"x");
        let found = scan(&dir);
        assert_eq!(found.len(), 2, "{found:?}");
        let audio = found.iter().find(|l| l.video_id.as_deref() == Some("FGBhQbmPwH8")).unwrap();
        assert!(audio.audio_only && audio.size == 5 && audio.name == "Song [FGBhQbmPwH8].f251.m4a");
        let video = found.iter().find(|l| l.video_id.as_deref() == Some("abcdefghijk")).unwrap();
        assert!(!video.audio_only && video.size == 10);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nothing_is_found_in_a_missing_folder() {
        assert!(scan(&std::env::temp_dir().join("kaisu-left-nope")).is_empty());
    }

    #[test]
    fn removing_takes_the_part_and_its_state_file_but_only_inside_the_folder() {
        let dir = scratch("rm");
        let outside = scratch("rm-out");
        write(&dir.join("a.mp4.part"), b"x");
        write(&dir.join("a.mp4.ytdl"), b"{}");
        write(&dir.join("keep.mp4"), b"x");
        write(&dir.join("keep.txt.part"), b"x");
        write(&outside.join("other.mp4.part"), b"x");
        let paths = vec![
            dir.join("a.mp4.part").display().to_string(),
            dir.join("keep.mp4").display().to_string(),
            outside.join("other.mp4.part").display().to_string(),
            "relative.part".to_string(),
            format!("{}/../{}/other.mp4.part", dir.display(), outside.file_name().unwrap().to_str().unwrap()),
        ];
        let results = remove(&paths, &dir);
        assert!(results[0].1.is_ok());
        assert!(!dir.join("a.mp4.part").exists() && !dir.join("a.mp4.ytdl").exists(), "the state file goes with it");
        assert!(results[1].1.is_err() && dir.join("keep.mp4").exists(), "finished files are never removed");
        assert!(results[2].1.is_err() && outside.join("other.mp4.part").exists(), "nothing outside the folder");
        assert!(results[3].1.is_err() && results[4].1.is_err());
        assert!(dir.join("keep.txt.part").exists(), "untouched unless asked for");
        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&outside).ok();
    }
}
