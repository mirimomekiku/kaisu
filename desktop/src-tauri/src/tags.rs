//! Editing the tags of sound files (title, artist, album, ...).
//!
//! Rewriting somebody's music is the riskiest thing Kaisu does, so it is done carefully: the change is made to a temporary copy,
//! the copy is read back to check the tags took and the length is unchanged, and only then does it replace the original. If
//! anything is off the original is untouched. Only files inside the download folders are ever edited (see `scope.rs`).

use std::{
    fs,
    path::{Path, PathBuf},
};

use lofty::{
    config::WriteOptions,
    file::{AudioFile, TaggedFileExt},
    prelude::*,
    tag::{ItemKey, Tag},
    picture::{Picture, PictureType},
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{
    library::{self, LibTrack},
    meta::clean_text,
    scope::Scope,
};

/// What to change. `None` leaves a field alone; an empty string removes it.
#[derive(Deserialize, Default, Debug, Clone, PartialEq)]
#[serde(default)]
pub struct TagEdit {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub track: Option<String>,
    pub disc: Option<String>,
    pub year: Option<String>,
    pub artwork: Option<crate::artwork::ArtworkEdit>,
}

/// An edit with every field checked and cleaned. `Some(None)` means remove.
#[derive(Debug, Default, PartialEq)]
struct Checked {
    title: Option<Option<String>>,
    artist: Option<Option<String>>,
    album: Option<Option<String>>,
    album_artist: Option<Option<String>>,
    genre: Option<Option<String>>,
    track: Option<Option<u32>>,
    disc: Option<Option<u32>>,
    year: Option<Option<u16>>,
}

fn text(label: &str, v: &Option<String>) -> Result<Option<Option<String>>, String> {
    v.as_deref().map(|raw| clean_text(label, raw)).transpose()
}

fn number(label: &str, v: &Option<String>, range: std::ops::RangeInclusive<u32>) -> Result<Option<Option<u32>>, String> {
    let Some(raw) = v.as_deref().map(str::trim) else { return Ok(None) };
    if raw.is_empty() {
        return Ok(Some(None));
    }
    match raw.parse::<u32>() {
        Ok(n) if raw.chars().all(|c| c.is_ascii_digit()) && range.contains(&n) => Ok(Some(Some(n))),
        _ => Err(format!("{label} must be a whole number from {} to {}.", range.start(), range.end())),
    }
}

fn check(edit: &TagEdit) -> Result<Checked, String> {
    Ok(Checked {
        title: text("The title", &edit.title)?,
        artist: text("The artist", &edit.artist)?,
        album: text("The album", &edit.album)?,
        album_artist: text("The album artist", &edit.album_artist)?,
        genre: text("The genre", &edit.genre)?,
        track: number("The track number", &edit.track, 1..=999)?,
        disc: number("The disc number", &edit.disc, 1..=99)?,
        year: number("The year", &edit.year, 1000..=2999)?.map(|y| y.map(|n| n as u16)),
    })
}

impl Checked {
    fn is_empty(&self) -> bool {
        *self == Checked::default()
    }
}

fn apply(tag: &mut Tag, c: &Checked) {
    if let Some(v) = &c.title {
        match v {
            Some(t) => tag.set_title(t.clone()),
            None => tag.remove_title(),
        }
    }
    if let Some(v) = &c.artist {
        match v {
            Some(t) => tag.set_artist(t.clone()),
            None => tag.remove_artist(),
        }
    }
    if let Some(v) = &c.album {
        match v {
            Some(t) => tag.set_album(t.clone()),
            None => tag.remove_album(),
        }
    }
    if let Some(v) = &c.genre {
        match v {
            Some(t) => tag.set_genre(t.clone()),
            None => tag.remove_genre(),
        }
    }
    if let Some(v) = &c.album_artist {
        match v {
            Some(t) => {
                tag.insert_text(ItemKey::AlbumArtist, t.clone());
            }
            None => tag.remove_key(ItemKey::AlbumArtist),
        }
    }
    if let Some(v) = &c.track {
        match v {
            Some(n) => tag.set_track(*n),
            None => tag.remove_track(),
        }
    }
    if let Some(v) = &c.disc {
        match v {
            Some(n) => tag.set_disk(*n),
            None => tag.remove_disk(),
        }
    }
    if let Some(v) = &c.year {
        match v {
            Some(y) => {
                tag.insert_text(ItemKey::RecordingDate, y.to_string());
            }
            None => {
                tag.remove_key(ItemKey::RecordingDate);
                tag.remove_key(ItemKey::Year);
            }
        }
    }
}

/// Whether what was read back from the edited copy says what was asked for.
fn matches(c: &Checked, t: &LibTrack) -> bool {
    let same = |want: &Option<Option<String>>, got: &str| want.as_ref().is_none_or(|w| w.as_deref().unwrap_or("") == got);
    same(&c.artist, &t.artist) && same(&c.album, &t.album) && same(&c.album_artist, &t.album_artist) && same(&c.genre, &t.genre)
        && c.title.as_ref().is_none_or(|w| w.as_deref().is_none_or(|w| w == t.title))
        && c.track.is_none_or(|w| w == t.track)
        && c.disc.is_none_or(|w| w == t.disc)
        && c.year.is_none_or(|w| w == t.year)
}

/// Edits one file and returns how it reads afterwards.
#[cfg(test)]
pub fn edit_file(path: &Path, edit: &TagEdit) -> Result<LibTrack, String> {
    if matches!(edit.artwork, Some(crate::artwork::ArtworkEdit::Replace { .. })) { return Err("Choose artwork through the editor before replacing it.".into()); }
    edit_file_with_artwork(path, edit, None)
}

fn edit_file_with_artwork(path: &Path, edit: &TagEdit, replacement: Option<&[u8]>) -> Result<LibTrack, String> {
    let checked = check(edit)?;
    if checked.is_empty() && edit.artwork.is_none() {
        return Ok(library::read_track(path));
    }
    let before = library::read_track(path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("bin");
    let tmp = path.with_extension(format!("kaisu-tag-tmp.{ext}"));
    let cleanup = |why: String| {
        let _ = fs::remove_file(&tmp);
        why
    };
    fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(|e| format!("Couldn't reserve a working copy (another edit may be running): {e}"))?;
    fs::copy(path, &tmp).map_err(|e| cleanup(format!("Couldn't make a working copy: {e}")))?;

    let mut tagged = lofty::read_from_path(&tmp).map_err(|e| cleanup(format!("This file's tags can't be read: {e}")))?;
    if tagged.primary_tag().is_none() {
        let kind = tagged.primary_tag_type();
        tagged.insert_tag(Tag::new(kind));
    }
    let Some(tag) = tagged.primary_tag_mut() else { return Err(cleanup("This kind of file can't hold tags.".into())) };
    apply(tag, &checked);
    if let Some(art) = &edit.artwork {
        match art {
            crate::artwork::ArtworkEdit::Remove => { while !tag.pictures().is_empty() { tag.remove_picture(0); } }
            crate::artwork::ArtworkEdit::Replace { .. } => {
                let bytes = replacement.ok_or_else(|| cleanup("Choose the artwork again.".into()))?;
                let mut picture = Picture::from_reader(&mut std::io::Cursor::new(bytes)).map_err(|e| cleanup(e.to_string()))?;
                picture.set_pic_type(PictureType::CoverFront);
                tag.remove_picture_type(PictureType::CoverFront);
                tag.push_picture(picture);
            }
        }
    }
    tagged.save_to_path(&tmp, WriteOptions::default()).map_err(|e| cleanup(format!("Couldn't write the tags: {e}")))?;

    if let Some(art) = &edit.artwork {
        let reread = lofty::read_from_path(&tmp).map_err(|e| cleanup(e.to_string()))?;
        let pictures = reread.primary_tag().map(|t| t.pictures()).unwrap_or(&[]);
        let verified = match art {
            crate::artwork::ArtworkEdit::Remove => pictures.is_empty(),
            crate::artwork::ArtworkEdit::Replace { .. } => pictures.iter().any(|p| p.pic_type() == PictureType::CoverFront && Some(p.data()) == replacement),
        };
        if !verified { return Err(cleanup("The artwork did not round-trip correctly; the original file was kept.".into())); }
    }
    // Read the copy back before trusting it: the tags must say what was asked, and the sound must be as long as before.
    let after = library::read_track(&tmp);
    if !matches(&checked, &after) {
        return Err(cleanup("The tags didn't come out as asked, so the file was left as it was.".into()));
    }
    if before.duration > 0.0 && (after.duration - before.duration).abs() > before.duration * 0.01 + 0.5 {
        return Err(cleanup("The edited copy came out a different length, so the file was left as it was.".into()));
    }
    fs::rename(&tmp, path).map_err(|e| cleanup(format!("Couldn't replace the file ({e}). Is it open in another program?")))?;
    Ok(library::read_track(path))
}

#[derive(Serialize)]
pub struct EditResult {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
    /// The file as it reads now, when the edit worked.
    pub track: Option<LibTrack>,
}

/// Edits the tags of these files (all alike), and keeps the remembered library in step.
#[tauri::command]
pub async fn library_edit_tags(app: AppHandle, scope: State<'_, Scope>, artwork: State<'_, crate::artwork::ArtworkStore>, paths: Vec<String>, edit: TagEdit) -> Result<Vec<EditResult>, String> {
    check(&edit)?;
    if paths.is_empty() || paths.len() > 500 { return Err("Edit between 1 and 500 songs at once.".into()); }
    let replacement = match &edit.artwork { Some(crate::artwork::ArtworkEdit::Replace { token }) => Some(artwork.get(token)?), _ => None };
    let cache = library::cache_path(&app)?;
    let files: Vec<(String, Result<PathBuf, String>)> = paths.into_iter().map(|p| (scope.media_file(&p), p)).map(|(real, p)| (p, real)).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::new();
        let mut changed: Vec<LibTrack> = Vec::new();
        for (path, real) in files {
            match real.and_then(|r| edit_file_with_artwork(&r, &edit, replacement.as_ref().map(|b| b.as_slice()))) {
                Ok(mut track) => {
                    // Keep the path the page knows the file by (a checked path can be spelled differently on Windows).
                    track.path = path.clone();
                    changed.push(track.clone());
                    results.push(EditResult { path, ok: true, error: None, track: Some(track) });
                }
                Err(error) => results.push(EditResult { path, ok: false, error: Some(error), track: None }),
            }
        }
        if !changed.is_empty() {
            let _lock = library::CACHE_EDIT.lock().unwrap_or_else(|e| e.into_inner());
            let mut remembered = library::load_cache(&cache);
            for t in changed {
                match remembered.iter_mut().find(|c| c.path == t.path) {
                    // The sound didn't change, so what was measured still holds.
                    Some(slot) => {
                        let loudness = slot.loudness;
                        *slot = LibTrack { loudness, added: if slot.added > 0 { slot.added } else { slot.modified }, ..t };
                    }
                    None => remembered.push(t),
                }
            }
            let _ = library::save_cache(&cache, &remembered);
        }
        Ok(results)
    })
    .await
    .map_err(|e| format!("The edit stopped unexpectedly: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::{scratch, tagged_wav, wav};

    fn edit(f: impl FnOnce(&mut TagEdit)) -> TagEdit {
        let mut e = TagEdit::default();
        f(&mut e);
        e
    }

    #[test]
    fn edited_fields_change_and_the_rest_stay() {
        let dir = scratch("edit");
        let path = dir.join("a.wav");
        tagged_wav(&path, 2, "Old Title", "Old Artist", "Old Album", 3, 1999);
        let t = edit_file(&path, &edit(|e| {
            e.title = Some("New Title".into());
            e.genre = Some("Electronic".into());
            e.year = Some("2005".into());
        }))
        .unwrap();
        assert_eq!((t.title.as_str(), t.genre.as_str(), t.year), ("New Title", "Electronic", Some(2005)));
        assert_eq!((t.artist.as_str(), t.album.as_str(), t.track), ("Old Artist", "Old Album", Some(3)), "untouched");
        assert!((t.duration - 2.0).abs() < 0.1, "the sound is as long as before");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "no working copy is left behind");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_empty_value_removes_a_field() {
        let dir = scratch("remove");
        let path = dir.join("a.wav");
        tagged_wav(&path, 1, "Title", "Artist", "Album", 7, 2001);
        let t = edit_file(&path, &edit(|e| {
            e.album = Some(String::new());
            e.track = Some(String::new());
            e.year = Some(String::new());
        }))
        .unwrap();
        assert_eq!((t.album.as_str(), t.track, t.year), ("", None, None));
        assert_eq!((t.title.as_str(), t.artist.as_str()), ("Title", "Artist"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_file_with_no_tags_can_be_given_some() {
        let dir = scratch("fresh");
        let path = dir.join("Plain Song.wav");
        fs::write(&path, wav(1)).unwrap();
        let t = edit_file(&path, &edit(|e| {
            e.title = Some("Now Titled".into());
            e.artist = Some("Someone".into());
            e.album_artist = Some("Someone".into());
        }))
        .unwrap();
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album_artist.as_str()), ("Now Titled", "Someone", "Someone"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn bad_values_are_refused_before_anything_is_touched() {
        let dir = scratch("bad");
        let path = dir.join("a.wav");
        tagged_wav(&path, 1, "T", "A", "B", 1, 2000);
        let before = fs::read(&path).unwrap();
        for (label, e) in [
            ("year", edit(|e| e.year = Some("abcd".into()))),
            ("year", edit(|e| e.year = Some("99".into()))),
            ("track", edit(|e| e.track = Some("0".into()))),
            ("track", edit(|e| e.track = Some("1000".into()))),
            ("track", edit(|e| e.track = Some("-3".into()))),
            ("disc", edit(|e| e.disc = Some("x".into()))),
            ("title", edit(|e| e.title = Some("x".repeat(201)))),
        ] {
            assert!(edit_file(&path, &e).is_err(), "{label}: {e:?}");
        }
        assert_eq!(fs::read(&path).unwrap(), before, "the file is exactly as it was");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_file_that_cannot_be_read_is_left_alone() {
        let dir = scratch("broken");
        let path = dir.join("broken.mp3");
        fs::write(&path, b"not audio").unwrap();
        assert!(edit_file(&path, &edit(|e| e.title = Some("x".into()))).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"not audio");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "no working copy is left behind");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_edit_that_changes_nothing_touches_nothing() {
        let dir = scratch("noop");
        let path = dir.join("a.wav");
        tagged_wav(&path, 1, "T", "A", "B", 1, 2000);
        let before = fs::read(&path).unwrap();
        edit_file(&path, &TagEdit::default()).unwrap();
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn text_is_cleaned_like_it_is_for_downloads() {
        let c = check(&edit(|e| e.title = Some("  two
 lines	tab  ".into()))).unwrap();
        assert_eq!(c.title, Some(Some("two lines tab".into())));
    }
    #[test]
    fn artwork_is_verified_before_replacement_and_removal_preserves_audio() {
        use crate::artwork::ArtworkEdit;
        let dir = scratch("artwork-edit"); let path = dir.join("song.wav");
        tagged_wav(&path, 2, "Title", "Artist", "Album", 1, 2000);
        let png = crate::artwork::tests::png();
        let replace = TagEdit { artwork: Some(ArtworkEdit::Replace { token: "test".into() }), ..Default::default() };
        let changed = edit_file_with_artwork(&path, &replace, Some(&png)).unwrap();
        assert!(changed.has_cover); assert_eq!(library::cover_bytes(&path), Some(png));
        assert!((changed.duration - 2.0).abs() < 0.1);
        let original = fs::read(&path).unwrap();
        assert!(edit_file_with_artwork(&path, &replace, Some(b"broken")).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        let removed = edit_file(&path, &TagEdit { artwork: Some(ArtworkEdit::Remove), ..Default::default() }).unwrap();
        assert!(!removed.has_cover); assert_eq!(removed.title, "Title");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "working copies were cleaned up");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn an_existing_working_copy_is_never_overwritten_or_removed() {
        let dir = scratch("working-copy-collision"); let path = dir.join("song.wav");
        tagged_wav(&path, 1, "Original", "Artist", "Album", 1, 2000);
        let original = fs::read(&path).unwrap(); let tmp = path.with_extension("kaisu-tag-tmp.wav");
        fs::write(&tmp, b"existing file").unwrap();
        assert!(edit_file(&path, &edit(|e| e.title = Some("Changed".into()))).is_err());
        assert_eq!(fs::read(&path).unwrap(), original); assert_eq!(fs::read(&tmp).unwrap(), b"existing file");
        fs::remove_dir_all(dir).ok();
    }

}
