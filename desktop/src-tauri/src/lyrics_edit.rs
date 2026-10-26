//! Explicit lyric edits, guarded by a revision of the audio and both sidecars.
use std::{fs, io::{Read, Write}, path::Path, sync::Mutex};
use cap_primitives::{ambient_authority, fs as cap};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;
use crate::{lyrics, scope::Scope};

static EDIT: Mutex<()> = Mutex::new(());
const MAX: usize = 512 * 1024;
#[derive(Serialize, Debug)]
pub struct Document { text: String, revision: String, sidecar: bool }
#[derive(Serialize, Debug)]
pub struct Saved { document: Option<Document>, embedded: bool, sidecar: bool, warnings: Vec<String> }

fn sidecar_bytes(directory: &fs::File, name: &Path) -> Result<Option<Vec<u8>>, String> {
    let metadata = match cap::stat(directory, name, cap::FollowSymlinks::No) {
        Ok(m) => m, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None), Err(e) => return Err(e.to_string()),
    };
    #[cfg(windows)] { use cap::MetadataExt; if metadata.file_attributes() & 0x400 != 0 { return Err("Lyrics sidecars cannot be links or junctions.".into()); } }
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX as u64 { return Err("A lyrics sidecar is a link, directory, or larger than 512 KB. It was kept.".into()); }
    let mut options = cap::OpenOptions::new(); options.read(true);
    let mut data = Vec::new();
    cap::open(directory, name, &options).map_err(|e| e.to_string())?.take(MAX as u64 + 1).read_to_end(&mut data).map_err(|e| e.to_string())?;
    if data.len() > MAX { return Err("The lyrics file grew beyond 512 KB. Reload before editing.".into()); }
    Ok(Some(data))
}
fn document(audio: &Path) -> Result<Document, String> {
    let directory = cap::open_ambient_dir(audio.parent().ok_or("Invalid song path.")?, ambient_authority()).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut source = fs::File::open(audio).map_err(|e| e.to_string())?; let mut buffer = [0; 128 * 1024];
    loop { let n = source.read(&mut buffer).map_err(|e| e.to_string())?; if n == 0 { break; } hash.update(&buffer[..n]); }
    let mut sidecar = false;
    for ext in ["lrc", "txt"] {
        hash.update(ext.as_bytes());
        let path = audio.with_extension(ext);
        if let Some(data) = sidecar_bytes(&directory, Path::new(path.file_name().ok_or("Invalid lyrics filename.")?))? { hash.update([1]); hash.update(data); sidecar = true; } else { hash.update([0]); }
    }
    let found = lyrics::read_for(audio);
    let text = found.synced.or(found.plain).unwrap_or_default();
    if text.len() > MAX { return Err("Embedded lyrics exceed the editor's 512 KB limit.".into()); }
    let revision = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    Ok(Document { text, revision, sidecar })
}
fn save(audio: &Path, text: &str, revision: &str, embed: bool, sidecar: bool) -> Result<Saved, String> {
    if !embed && !sidecar { return Err("Choose at least one place to save lyrics.".into()); }
    if text.trim().is_empty() || text.len() > MAX || text.contains('\0') { return Err("Enter lyrics up to 512 KB without NUL characters.".into()); }
    if document(audio)?.revision != revision { return Err("The song or its lyrics changed outside this editor. Reload saved lyrics before saving.".into()); }
    let directory = cap::open_ambient_dir(audio.parent().ok_or("Invalid song path.")?, ambient_authority()).map_err(|e| e.to_string())?;
    let destination = audio.with_extension("lrc"); let name = Path::new(destination.file_name().ok_or("Invalid lyrics filename.")?);
    let previous_sidecar = sidecar_bytes(&directory, name)?;
    let stage_name = format!(".kaisu-lyrics-{}.tmp", uuid::Uuid::new_v4()); let stage = Path::new(&stage_name);
    if sidecar {
        let mut options = cap::OpenOptions::new(); options.write(true).create_new(true);
        // A failed reservation must never remove a pre-existing staging file.
        let mut file = cap::open(&directory, stage, &options).map_err(|e| format!("Couldn't reserve a lyrics working file: {e}"))?;
        let staged = file.write_all(text.as_bytes()).and_then(|_| file.sync_all()).map_err(|e| e.to_string());
        drop(file);
        let staged = staged.and_then(|_| {
            if sidecar_bytes(&directory, stage)?.as_deref() != Some(text.as_bytes()) { return Err("The staged lyrics did not verify correctly.".into()); }
            Ok(())
        });
        if let Err(e) = staged { let _ = cap::remove_file(&directory, stage); return Err(format!("Couldn't prepare the lyrics file: {e}")); }
    }
    let result = (|| {
        if document(audio)?.revision != revision { return Err("The song changed while preparing the edit. Reload saved lyrics.".into()); }
        if embed { crate::tags::embed_lyrics_file(audio, text)?; }
        let mut warnings = Vec::new(); let mut wrote_sidecar = false;
        if sidecar {
            // Recheck the final entry before committing the staged file.
            match sidecar_bytes(&directory, name).and_then(|current| {
                if current != previous_sidecar { return Err("The .lrc file changed during saving; that external edit was kept.".into()); }
                cap::rename(&directory, stage, &directory, name).map_err(|e| e.to_string())
            }) {
                Ok(()) => wrote_sidecar = true,
                Err(e) if embed => warnings.push(format!("Lyrics were embedded, but the .lrc file was not saved: {e}")),
                Err(e) => return Err(format!("The lyrics file was not saved: {e}")),
            }
        }
        let document = match document(audio) { Ok(doc) => Some(doc), Err(e) => { warnings.push(format!("The saved lyrics could not be reloaded: {e}")); None } };
        Ok(Saved { document, embedded: embed, sidecar: wrote_sidecar, warnings })
    })();
    if sidecar { let _ = cap::remove_file(&directory, stage); }
    result
}
#[tauri::command]
pub async fn lyrics_edit_read(scope: State<'_, Scope>, path: String) -> Result<Document, String> {
    let audio = scope.media_file(&path)?;
    tauri::async_runtime::spawn_blocking(move || { let _lock = EDIT.lock().map_err(|_| "Lyrics editing is unavailable.")?; document(&audio) }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn lyrics_edit_save(scope: State<'_, Scope>, path: String, text: String, revision: String, embed: bool, sidecar: bool) -> Result<Saved, String> {
    let audio = scope.media_file(&path)?;
    tauri::async_runtime::spawn_blocking(move || { let _lock = EDIT.lock().map_err(|_| "Lyrics editing is unavailable.")?; save(&audio, &text, &revision, embed, sidecar) }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_edits_are_refused_and_sidecar_save_preserves_the_audio() {
        let dir = crate::library::tests::scratch("lyrics-edit"); let audio = dir.join("song.wav");
        fs::write(&audio, crate::library::tests::wav(1)).unwrap();
        let original = fs::read(&audio).unwrap(); let first = document(&audio).unwrap();
        let text = "[00:01.25]Hello\n[00:02.50]World";
        let saved = save(&audio, text, &first.revision, false, true).unwrap();
        assert!(saved.sidecar && !saved.embedded && saved.warnings.is_empty());
        assert_eq!(fs::read(&audio).unwrap(), original); assert_eq!(document(&audio).unwrap().text, text);
        assert!(save(&audio, "Stale", &first.revision, false, true).unwrap_err().contains("changed"));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn invalid_edits_never_create_files() {
        let dir = crate::library::tests::scratch("lyrics-edit-invalid"); let audio = dir.join("song.wav"); fs::write(&audio, crate::library::tests::wav(1)).unwrap();
        let revision = document(&audio).unwrap().revision;
        for (text, embed, sidecar) in [("", false, true), ("Lyrics", false, false), ("bad\0text", true, true)] { assert!(save(&audio, text, &revision, embed, sidecar).is_err()); }
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1); fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn saving_both_replaces_lyrics_without_changing_existing_music_tags() {
        let dir = crate::library::tests::scratch("lyrics-edit-both"); let audio = dir.join("song.wav");
        crate::library::tests::tagged_wav(&audio, 1, "Title", "Artist", "Album", 1, 2000);
        fs::write(audio.with_extension("lrc"), "Old sidecar").unwrap();
        fs::write(audio.with_extension("txt"), "Keep this unrelated plain copy").unwrap();
        let revision = document(&audio).unwrap().revision;
        let text = "[00:00.20]New lyrics";
        let result = save(&audio, text, &revision, true, true).unwrap();
        assert!(result.embedded && result.sidecar && result.warnings.is_empty());
        assert_eq!(document(&audio).unwrap().text, text);
        fs::remove_file(audio.with_extension("lrc")).unwrap(); fs::remove_file(audio.with_extension("txt")).unwrap();
        assert_eq!(lyrics::read_for(&audio).synced.as_deref(), Some(text));
        let track = crate::library::read_track(&audio); assert_eq!((track.title.as_str(), track.artist.as_str(), track.album.as_str()), ("Title", "Artist", "Album"));
        assert!((track.duration - 1.0).abs() < 0.1); fs::remove_dir_all(dir).unwrap();
    }
}
