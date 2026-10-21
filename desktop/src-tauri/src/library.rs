//! The music library: the sound files in the download folder (and the folder for moved downloads), with their tags and
//! properties, read once and remembered.
//!
//! Only the folders Kaisu was told about are looked at (see `scope.rs`). The result is kept in a file in the app's data folder,
//! so starting up shows the library at once and a rescan only reads files that are new or changed.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use lofty::{
    file::{FileType, TaggedFileExt},
    prelude::*,
    tag::ItemKey,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, ipc::{Channel, Response}};

use crate::scope::Scope;

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "m4a", "opus", "ogg", "oga", "flac", "wav", "aac", "wma"];
const MAX_DEPTH: usize = 8;
const MAX_TRACKS: usize = 100_000;
const MAX_COVER_BYTES: usize = 8 * 1024 * 1024;
const COVER_NAMES: &[&str] = &["cover", "folder", "front", "albumart", "album"];
const COVER_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct LibTrack {
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album_artist: String,
    pub album: String,
    pub track: Option<u32>,
    pub disc: Option<u32>,
    pub year: Option<u16>,
    pub genre: String,
    /// Seconds.
    pub duration: f64,
    /// Kilobits a second, when the format has one.
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u8>,
    pub channels: Option<u8>,
    /// "MP3", "FLAC", ...
    pub format: String,
    pub size: u64,
    /// Seconds since 1970 when the file was last changed.
    pub modified: u64,
    /// The file carries a picture of its own.
    pub has_cover: bool,
    /// How loud it is, in LUFS, once measured.
    pub loudness: Option<f64>,
}

pub fn is_audio(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).is_some_and(|e| AUDIO_EXTENSIONS.contains(&e.as_str()))
}

fn format_name(kind: FileType, ext: &str) -> String {
    match kind {
        FileType::Mpeg => "MP3".into(),
        FileType::Flac => "FLAC".into(),
        FileType::Mp4 => "M4A".into(),
        FileType::Opus => "Opus".into(),
        FileType::Vorbis => "OGG Vorbis".into(),
        FileType::Wav => "WAV".into(),
        FileType::Aac => "AAC".into(),
        _ => ext.to_ascii_uppercase(),
    }
}

/// What a file's name says when it has no tags: the name without `.ext` and without a trailing ` [youtube id]`.
pub fn title_from_name(path: &Path) -> String {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
    let trimmed = match stem.rfind(" [") {
        Some(at) if stem.ends_with(']') && stem[at + 2..stem.len() - 1].len() == 11 => &stem[..at],
        _ => stem,
    };
    if trimmed.trim().is_empty() { stem.to_string() } else { trimmed.trim().to_string() }
}

fn stat(path: &Path) -> Option<(u64, u64)> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    Some((meta.len(), modified))
}

/// Reads one file. A file whose tags can't be read still gets an entry (named from its file name), so it can be played.
pub fn read_track(path: &Path) -> LibTrack {
    let (size, modified) = stat(path).unwrap_or((0, 0));
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_string();
    let mut track = LibTrack {
        path: path.display().to_string(),
        title: title_from_name(path),
        format: ext.to_ascii_uppercase(),
        size,
        modified,
        ..Default::default()
    };
    let Ok(tagged) = lofty::read_from_path(path) else { return track };

    let props = tagged.properties();
    track.duration = props.duration().as_secs_f64();
    track.bitrate = props.audio_bitrate();
    track.sample_rate = props.sample_rate();
    track.bit_depth = props.bit_depth();
    track.channels = props.channels();
    track.format = format_name(tagged.file_type(), &ext);

    if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
        let text = |v: Option<std::borrow::Cow<'_, str>>| v.map(|s| s.trim().to_string()).unwrap_or_default();
        let title = text(tag.title());
        if !title.is_empty() {
            track.title = title;
        }
        track.artist = text(tag.artist());
        track.album = text(tag.album());
        track.genre = text(tag.genre());
        track.album_artist = tag.get_string(ItemKey::AlbumArtist).map(|s| s.trim().to_string()).unwrap_or_default();
        track.track = tag.track();
        track.disc = tag.disk();
        track.year = tag.date().map(|d| d.year);
        track.has_cover = !tag.pictures().is_empty();
    }
    track
}

/// Every sound file under `dir`, a few folders deep. Symbolic links are not followed.
fn list_audio(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= MAX_TRACKS {
            return;
        }
        let Ok(kind) = entry.file_type() else { continue };
        let path = entry.path();
        if kind.is_dir() {
            if depth < MAX_DEPTH {
                list_audio(&path, depth + 1, out);
            }
        } else if kind.is_file() && is_audio(&path) {
            out.push(path);
        }
    }
}

/// Reads the library: files whose size and date are unchanged are taken from `known`, the rest are read. Files that are
/// gone are left out. `progress(done, total)` is told how far along it is.
pub fn scan(dirs: &[PathBuf], known: &[LibTrack], mut progress: impl FnMut(usize, usize)) -> Vec<LibTrack> {
    let mut files = Vec::new();
    for dir in dirs {
        list_audio(dir, 0, &mut files);
    }
    files.sort();
    files.dedup();
    let cache: HashMap<&str, &LibTrack> = known.iter().map(|t| (t.path.as_str(), t)).collect();
    let total = files.len();
    let mut out = Vec::with_capacity(total);
    for (i, path) in files.iter().enumerate() {
        let key = path.display().to_string();
        let now = stat(path);
        match (cache.get(key.as_str()), now) {
            (Some(old), Some((size, modified))) if old.size == size && old.modified == modified => out.push((*old).clone()),
            _ => out.push(read_track(path)),
        }
        if i % 25 == 0 || i + 1 == total {
            progress(i + 1, total);
        }
    }
    out
}

// ---- the cache file --------------------------------------------------------------------------

fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("library.json")).map_err(|e| format!("Cannot find the app data folder: {e}"))
}

pub fn load_cache(path: &Path) -> Vec<LibTrack> {
    fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

pub fn save_cache(path: &Path, tracks: &[LibTrack]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
    }
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string(tracks).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| format!("Cannot save the library: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("Cannot save the library: {e}"))
}

// ---- commands --------------------------------------------------------------------------------

/// What was remembered from the last scan, instantly.
#[tauri::command]
pub async fn library_load(app: AppHandle) -> Result<Vec<LibTrack>, String> {
    let path = cache_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || load_cache(&path)).await.map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
pub struct ScanProgress {
    pub done: usize,
    pub total: usize,
}

/// Looks through the download folder and the folder for moved downloads, reading what is new or changed.
#[tauri::command]
pub async fn library_scan(app: AppHandle, scope: State<'_, Scope>, on_progress: Channel<ScanProgress>) -> Result<Vec<LibTrack>, String> {
    let dirs: Vec<PathBuf> = [scope.download(), scope.moved()].into_iter().flatten().collect();
    if dirs.is_empty() {
        return Err(scope.download().err().unwrap_or_else(|| "Choose a download folder first.".into()));
    }
    let cache = cache_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let known = load_cache(&cache);
        let tracks = scan(&dirs, &known, |done, total| {
            let _ = on_progress.send(ScanProgress { done, total });
        });
        save_cache(&cache, &tracks)?;
        Ok(tracks)
    })
    .await
    .map_err(|e| format!("The scan stopped unexpectedly: {e}"))?
}

/// The picture for a track: the one inside the file, or a `cover.jpg`-style file in its folder.
pub fn cover_bytes(path: &Path) -> Option<Vec<u8>> {
    if let Ok(tagged) = lofty::read_from_path(path)
        && let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag())
        && let Some(picture) = tag.pictures().first()
        && !picture.data().is_empty()
    {
        return Some(picture.data().to_vec());
    }
    let dir = path.parent()?;
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path();
        let stem = p.file_stem().and_then(|s| s.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
        let ext = p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
        if COVER_NAMES.contains(&stem.as_str()) && COVER_EXTENSIONS.contains(&ext.as_str()) && entry.metadata().is_ok_and(|m| m.is_file() && (m.len() as usize) <= MAX_COVER_BYTES) {
            return fs::read(&p).ok();
        }
    }
    None
}

/// The picture to show for a sound file, as image bytes. Errors when there is none (the page shows a placeholder).
#[tauri::command]
pub async fn library_cover(scope: State<'_, Scope>, path: String) -> Result<Response, String> {
    let real = scope.media_file(&path)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || cover_bytes(&real)).await.map_err(|e| e.to_string())?;
    match bytes {
        Some(b) if b.len() <= MAX_COVER_BYTES && crate::thumbs::looks_like_image(&b) => Ok(Response::new(b)),
        _ => Err("No picture.".into()),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use lofty::{config::WriteOptions, file::AudioFile, picture::{MimeType, Picture, PictureType}, tag::{Tag, TagType}};

    /// A silent mono 8-bit WAV of the given length.
    pub fn wav(seconds: u32) -> Vec<u8> {
        let rate = 8000u32;
        let n = rate * seconds;
        let mut b = Vec::new();
        b.extend_from_slice(b"RIFF");
        b.extend_from_slice(&(36 + n).to_le_bytes());
        b.extend_from_slice(b"WAVEfmt ");
        b.extend_from_slice(&16u32.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&rate.to_le_bytes());
        b.extend_from_slice(&rate.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&8u16.to_le_bytes());
        b.extend_from_slice(b"data");
        b.extend_from_slice(&n.to_le_bytes());
        b.extend(std::iter::repeat_n(128u8, n as usize));
        b
    }

    pub fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kaisu-lib-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Writes a WAV with the given tags.
    pub fn tagged_wav(path: &Path, seconds: u32, title: &str, artist: &str, album: &str, track: u32, year: u16) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, wav(seconds)).unwrap();
        let mut file = lofty::read_from_path(path).unwrap();
        let mut tag = Tag::new(TagType::Id3v2);
        tag.set_title(title.into());
        tag.set_artist(artist.into());
        tag.set_album(album.into());
        tag.set_track(track);
        tag.insert_text(ItemKey::AlbumArtist, artist.into());
        tag.insert_text(ItemKey::RecordingDate, year.to_string());
        file.insert_tag(tag);
        file.save_to_path(path, WriteOptions::default()).unwrap();
    }

    #[test]
    fn a_files_tags_and_properties_are_read() {
        let dir = scratch("read");
        let path = dir.join("one.wav");
        tagged_wav(&path, 2, "Da Funk", "Daft Punk", "Homework", 4, 1997);
        let t = read_track(&path);
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album.as_str(), t.album_artist.as_str()), ("Da Funk", "Daft Punk", "Homework", "Daft Punk"));
        assert_eq!((t.track, t.year, t.format.as_str()), (Some(4), Some(1997), "WAV"));
        assert!((t.duration - 2.0).abs() < 0.1, "{}", t.duration);
        assert_eq!((t.sample_rate, t.channels, t.bit_depth), (Some(8000), Some(1), Some(8)));
        assert!(t.size > 16_000 && t.modified > 0 && !t.has_cover);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_file_without_tags_is_named_from_its_file_name() {
        let dir = scratch("untagged");
        let path = dir.join("Some Song [abcdefghijk].wav");
        fs::write(&path, wav(1)).unwrap();
        let t = read_track(&path);
        assert_eq!(t.title, "Some Song");
        assert_eq!((t.artist.as_str(), t.album.as_str()), ("", ""));
        assert!(t.duration > 0.5);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_file_that_cannot_be_read_still_gets_an_entry() {
        let dir = scratch("broken");
        let path = dir.join("Broken Song.mp3");
        fs::write(&path, b"this is not audio at all").unwrap();
        let t = read_track(&path);
        assert_eq!((t.title.as_str(), t.format.as_str(), t.duration), ("Broken Song", "MP3", 0.0));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn titles_come_from_names_sensibly() {
        assert_eq!(title_from_name(Path::new("/a/Title [FGBhQbmPwH8].mp3")), "Title");
        assert_eq!(title_from_name(Path::new("/a/Title [not an id].mp3")), "Title [not an id]");
        assert_eq!(title_from_name(Path::new("/a/[FGBhQbmPwH8].mp3")), "[FGBhQbmPwH8]");
        assert_eq!(title_from_name(Path::new("/a/Plain.flac")), "Plain");
    }

    #[test]
    fn scanning_finds_sound_files_in_folders_and_leaves_the_rest() {
        let dir = scratch("scan");
        tagged_wav(&dir.join("A/Album/01.wav"), 1, "One", "Artist", "Album", 1, 2001);
        tagged_wav(&dir.join("A/Album/02.wav"), 1, "Two", "Artist", "Album", 2, 2001);
        fs::write(dir.join("A/Album/cover.jpg"), b"x").unwrap();
        fs::write(dir.join("notes.txt"), b"x").unwrap();
        fs::write(dir.join("video.mp4"), b"x").unwrap();
        fs::write(dir.join("A/Album/03.wav.part"), b"x").unwrap();
        let mut seen = Vec::new();
        let tracks = scan(std::slice::from_ref(&dir), &[], |d, t| seen.push((d, t)));
        assert_eq!(tracks.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), ["One", "Two"]);
        assert_eq!(seen.last(), Some(&(2, 2)));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_rescan_only_reads_what_changed() {
        let dir = scratch("rescan");
        let (a, b) = (dir.join("a.wav"), dir.join("b.wav"));
        tagged_wav(&a, 1, "A", "X", "Y", 1, 2000);
        tagged_wav(&b, 1, "B", "X", "Y", 2, 2000);
        let first = scan(std::slice::from_ref(&dir), &[], |_, _| {});
        // A remembered entry that disagrees with the file proves it was taken from memory, not read again.
        let mut known = first.clone();
        known[0].title = "Remembered".into();
        let second = scan(std::slice::from_ref(&dir), &known, |_, _| {});
        assert_eq!(second[0].title, "Remembered");
        // A changed file is read again, and a deleted one is gone.
        fs::write(&a, wav(3)).unwrap();
        fs::remove_file(&b).unwrap();
        let third = scan(std::slice::from_ref(&dir), &known, |_, _| {});
        assert_eq!(third.len(), 1);
        assert_ne!(third[0].title, "Remembered");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_cache_survives_a_restart_and_a_damaged_one_is_ignored() {
        let dir = scratch("cache");
        let file = dir.join("data/library.json");
        let tracks = vec![LibTrack { path: "/a.mp3".into(), title: "A".into(), duration: 3.5, ..Default::default() }];
        save_cache(&file, &tracks).unwrap();
        assert_eq!(load_cache(&file), tracks);
        fs::write(&file, "{ not json").unwrap();
        assert!(load_cache(&file).is_empty());
        assert!(load_cache(&dir.join("missing.json")).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_cover_comes_from_the_file_or_a_picture_beside_it() {
        let dir = scratch("cover");
        let path = dir.join("song.wav");
        tagged_wav(&path, 1, "S", "A", "B", 1, 2000);
        assert!(cover_bytes(&path).is_none());
        fs::write(dir.join("Cover.JPG"), [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).unwrap();
        assert_eq!(cover_bytes(&path), Some(vec![0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]));
        fs::remove_file(dir.join("Cover.JPG")).unwrap();
        // One inside the file wins.
        let mut file = lofty::read_from_path(&path).unwrap();
        let tag = file.primary_tag_mut().unwrap();
        tag.push_picture(Picture::unchecked(vec![0x89, b'P', b'N', b'G', 9, 9]).pic_type(PictureType::CoverFront).mime_type(MimeType::Png).build());
        file.save_to_path(&path, WriteOptions::default()).unwrap();
        assert!(read_track(&path).has_cover);
        assert_eq!(cover_bytes(&path).map(|b| b[1]), Some(b'P'));
        fs::remove_dir_all(&dir).ok();
    }
}
