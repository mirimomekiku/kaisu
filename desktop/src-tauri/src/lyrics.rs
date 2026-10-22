//! Lyrics for the music player: what is already there for a song (a `.lrc` or `.txt` file beside it, or lyrics inside its
//! tags), and looking them up on LRCLIB when there are none.
//!
//! Reading is local and needs no consent. The online lookup sends the song's artist and title to a third party, so the page asks
//! first (the same consent as lyrics at download time); this module only does what it is told.

use std::{fs, path::Path};

use lofty::{file::TaggedFileExt, tag::ItemKey};
use serde::Serialize;
use tauri::State;

use crate::{library, meta, net, scope::Scope};

/// No lyrics file is anywhere near this big.
const MAX_BYTES: u64 = 512 * 1024;

#[derive(Serialize, Default, PartialEq, Debug, Clone)]
pub struct SongLyrics {
    /// Timestamped lines (`[01:23.45] words`), for following along.
    pub synced: Option<String>,
    /// Plain text.
    pub plain: Option<String>,
    /// Where they came from: "file", "tags" or "online".
    pub source: Option<&'static str>,
}

/// Whether text has the `[mm:ss...]` timestamps that make lyrics followable.
pub fn looks_synced(text: &str) -> bool {
    text.lines().any(|l| {
        let b = l.trim_start().as_bytes();
        b.len() > 5 && b[0] == b'[' && b[1].is_ascii_digit() && b[2].is_ascii_digit() && b[3] == b':' && b[4].is_ascii_digit() && b[5].is_ascii_digit()
    })
}

fn tidy(text: &str) -> Option<String> {
    let cleaned = text.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    let cleaned = cleaned.trim();
    (!cleaned.is_empty()).then(|| cleaned.to_string())
}

fn read_text(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_BYTES {
        return None;
    }
    tidy(&String::from_utf8_lossy(&fs::read(path).ok()?))
}

fn classify(text: String, source: &'static str) -> SongLyrics {
    if looks_synced(&text) { SongLyrics { synced: Some(text), plain: None, source: Some(source) } } else { SongLyrics { synced: None, plain: Some(text), source: Some(source) } }
}

/// What lyrics a song already has: a `.lrc` beside it, then a `.txt`, then the ones in its tags.
pub fn read_for(audio: &Path) -> SongLyrics {
    for ext in ["lrc", "txt"] {
        if let Some(text) = read_text(&audio.with_extension(ext)) {
            return classify(text, "file");
        }
    }
    if let Ok(tagged) = lofty::read_from_path(audio)
        && let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag())
        && let Some(text) = tag.get_string(ItemKey::Lyrics).or_else(|| tag.get_string(ItemKey::UnsyncLyrics)).and_then(tidy)
    {
        return classify(text, "tags");
    }
    SongLyrics::default()
}

/// The lyrics a song already has.
#[tauri::command]
pub async fn lyrics_read(scope: State<'_, Scope>, path: String) -> Result<SongLyrics, String> {
    let real = scope.media_file(&path)?;
    tauri::async_runtime::spawn_blocking(move || read_for(&real)).await.map_err(|e| e.to_string())
}

/// Looks the song up on LRCLIB and saves what it finds beside the song (`.lrc`, or `.txt` for plain lyrics).
#[tauri::command]
pub async fn lyrics_find(scope: State<'_, Scope>, path: String, proxy: Option<String>) -> Result<SongLyrics, String> {
    let real = scope.media_file(&path)?;
    let proxy = net::proxy_option(proxy.as_deref())?;
    let track = {
        let real = real.clone();
        tauri::async_runtime::spawn_blocking(move || library::read_track(&real)).await.map_err(|e| e.to_string())?
    };
    let (artist, title) = meta::tidy_for_lookup(&track.artist, &track.title);
    let client = crate::setup::client(proxy.as_deref())?;
    let found = meta::fetch_lyrics(&client, &artist, &title, Some(track.duration)).await?;
    let Some(lyrics) = found else { return Err(format!("No lyrics were found for {}.", if artist.is_empty() { title.clone() } else { format!("{artist} - {title}") })) };
    meta::write_lyrics_file(&real, &lyrics).await?;
    Ok(match (lyrics.synced, lyrics.plain) {
        (Some(s), _) => SongLyrics { synced: Some(s), plain: None, source: Some("online") },
        (None, p) => SongLyrics { synced: None, plain: p, source: Some("online") },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::{scratch, tagged_wav};
    use lofty::{config::WriteOptions, file::AudioFile};

    #[test]
    fn timestamps_are_recognised() {
        assert!(looks_synced("[00:12.50] Hello\n[00:15.00] World"));
        assert!(looks_synced("[ar:Someone]\n[01:02.3]line"));
        assert!(looks_synced("  [10:00] after a gap"));
        assert!(!looks_synced("Just words\nand more words"));
        assert!(!looks_synced("[Chorus]\nla la la"));
        assert!(!looks_synced(""));
    }

    #[test]
    fn a_lrc_file_beside_the_song_is_synced_lyrics() {
        let dir = scratch("lrc");
        let song = dir.join("Song.wav");
        fs::write(&song, b"x").unwrap();
        fs::write(dir.join("Song.lrc"), "\u{feff}[00:01.00] One\r\n[00:02.00] Two\r\n").unwrap();
        let l = read_for(&song);
        assert_eq!(l.source, Some("file"));
        assert_eq!(l.synced.as_deref(), Some("[00:01.00] One\n[00:02.00] Two"));
        assert_eq!(l.plain, None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_txt_or_an_untimed_lrc_is_plain_lyrics_and_lrc_wins() {
        let dir = scratch("txt");
        let song = dir.join("Song.wav");
        fs::write(&song, b"x").unwrap();
        fs::write(dir.join("Song.txt"), "Plain words\n").unwrap();
        assert_eq!(read_for(&song), SongLyrics { synced: None, plain: Some("Plain words".into()), source: Some("file") });
        fs::write(dir.join("Song.lrc"), "no timestamps here").unwrap();
        assert_eq!(read_for(&song).plain.as_deref(), Some("no timestamps here"));
        fs::write(dir.join("Song.lrc"), "[00:01.00] timed").unwrap();
        assert!(read_for(&song).synced.is_some());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn lyrics_inside_the_tags_are_found_when_there_is_no_file() {
        let dir = scratch("tags");
        let song = dir.join("Song.wav");
        tagged_wav(&song, 1, "Song", "Artist", "Album", 1, 2000);
        assert_eq!(read_for(&song), SongLyrics::default());
        let mut file = lofty::read_from_path(&song).unwrap();
        file.primary_tag_mut().unwrap().insert_text(ItemKey::UnsyncLyrics, "Embedded words\nsecond line".into());
        file.save_to_path(&song, WriteOptions::default()).unwrap();
        let l = read_for(&song);
        assert_eq!((l.source, l.plain.as_deref()), (Some("tags"), Some("Embedded words\nsecond line")));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_and_oversized_files_are_ignored() {
        let dir = scratch("odd");
        let song = dir.join("Song.wav");
        fs::write(&song, b"x").unwrap();
        fs::write(dir.join("Song.lrc"), "   \n\n").unwrap();
        assert_eq!(read_for(&song), SongLyrics::default());
        fs::write(dir.join("Song.lrc"), vec![b'a'; (MAX_BYTES + 1) as usize]).unwrap();
        assert_eq!(read_for(&song), SongLyrics::default());
        fs::remove_dir_all(&dir).ok();
    }
}
