//! Tags, cover art, lyrics, audio processing and the check that a finished file actually plays.
//!
//! Everything the user can type here ends up either in a yt-dlp option or in an ffmpeg command, so each value is
//! cleaned and limited first, and nothing is ever passed through a shell.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::proc;

const MAX_TEXT_CHARS: usize = 200;
const MAX_COVER_BYTES: u64 = 20 * 1024 * 1024;
const COVER_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];

/// Brackets that only decorate a title: "(Official Video)", "[Lyrics]", "(4K)". Used with `--replace-in-metadata`.
pub const TITLE_NOISE_REGEX: &str = r"(?i)\s*[(\[][^)\]]*(?:official|lyrics?|music video|visuali[sz]er|audio only|full audio|\b4k\b|\bhd\b)[^)\]]*[)\]]";

// ---- tags --------------------------------------------------------------------------------

#[derive(Deserialize, Serialize, Default, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct MetaOptions {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<String>,
    pub track: Option<String>,
    pub genre: Option<String>,
}

/// Tidies a typed value: one line, no control characters, no backslash right before the separator.
/// `None` for blank. Errors for text that is too long.
pub fn clean_text(label: &str, raw: &str) -> Result<Option<String>, String> {
    let one_line: String = raw.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let text = one_line.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = text.trim_end_matches('\\').trim_end().to_string();
    if text.is_empty() {
        return Ok(None);
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(format!("{label} is too long (up to {MAX_TEXT_CHARS} characters)."));
    }
    Ok(Some(text))
}

/// yt-dlp reads `FROM:TO`; a literal colon needs `\:` and a literal percent sign `%%`.
///
/// A FROM made only of word characters ("Jawed", "2005") is taken as the *name of a field* to read, which finds
/// nothing and yields "NA". Writing it as a template with a default value makes it literal text again.
fn escape_parse_metadata(text: &str) -> String {
    if text.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return format!("%(kaisu_unset|{text})s");
    }
    text.replace('%', "%%").replace(':', "\\:")
}

impl MetaOptions {
    pub fn is_empty(&self) -> bool {
        [&self.title, &self.artist, &self.album, &self.year, &self.track, &self.genre].iter().all(|f| f.as_deref().is_none_or(|v| v.trim().is_empty()))
    }

    /// Cleaned values, with the year and track number checked.
    pub fn cleaned(&self) -> Result<Vec<(&'static str, String)>, String> {
        let mut out = Vec::new();
        let mut add = |field: &'static str, label: &str, value: &Option<String>| -> Result<(), String> {
            if let Some(text) = value.as_deref().map(|v| clean_text(label, v)).transpose()?.flatten() {
                out.push((field, text));
            }
            Ok(())
        };
        add("title", "The title", &self.title)?;
        add("artist", "The artist", &self.artist)?;
        add("album", "The album", &self.album)?;
        add("genre", "The genre", &self.genre)?;
        if let Some(year) = self.year.as_deref().map(str::trim).filter(|y| !y.is_empty()) {
            let ok = year.len() == 4 && year.chars().all(|c| c.is_ascii_digit()) && (1000..=2999).contains(&year.parse::<u32>().unwrap_or(0));
            if !ok {
                return Err("The year must be four digits, like 2024.".into());
            }
            out.push(("date", year.to_string()));
        }
        if let Some(track) = self.track.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
            let ok = track.len() <= 3 && track.chars().all(|c| c.is_ascii_digit()) && track != "0" && !track.starts_with('0');
            if !ok {
                return Err("The track number must be a whole number from 1 to 999.".into());
            }
            out.push(("track", track.to_string()));
        }
        Ok(out)
    }

    pub fn args(&self) -> Result<Vec<String>, String> {
        let mut a = Vec::new();
        for (field, value) in self.cleaned()? {
            a.push("--parse-metadata".to_string());
            a.push(format!("{}:%(meta_{field})s", escape_parse_metadata(&value)));
        }
        if !a.is_empty() {
            a.push("--embed-metadata".to_string());
        }
        Ok(a)
    }
}

// ---- cover art ---------------------------------------------------------------------------

#[derive(Deserialize, Serialize, Clone, Copy, Default, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum CoverMode {
    /// The site's thumbnail (audio files only, like before).
    #[default]
    Default,
    /// The thumbnail, cropped to a centred square.
    Square,
    /// No cover art.
    None,
    /// An image the user picked.
    Custom,
}

#[derive(Deserialize, Serialize, Default, Clone, Debug)]
#[serde(default)]
pub struct CoverOptions {
    pub mode: CoverMode,
    pub path: Option<String>,
}

/// Checks a picked cover image and returns it as a path.
pub fn validate_cover(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err("Choose the cover image again.".into());
    }
    let ext = p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    if !COVER_EXTENSIONS.contains(&ext.as_str()) {
        return Err("Cover art must be a .jpg, .png or .webp picture.".into());
    }
    let meta = std::fs::metadata(&p).map_err(|_| "The cover image can't be found. Choose it again.".to_string())?;
    if !meta.is_file() {
        return Err("The cover image can't be found. Choose it again.".into());
    }
    if meta.len() == 0 || meta.len() > MAX_COVER_BYTES {
        return Err("Cover art must be smaller than 20 MB.".into());
    }
    Ok(p)
}

impl CoverOptions {
    /// What to tell yt-dlp for an audio download. Custom art is added afterwards by `apply_custom_cover`.
    pub fn audio_args(&self, wav: bool) -> Result<Vec<String>, String> {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        Ok(match self.mode {
            CoverMode::None | CoverMode::Custom => {
                if self.mode == CoverMode::Custom {
                    validate_cover(self.path.as_deref().unwrap_or(""))?;
                }
                Vec::new()
            }
            CoverMode::Default if wav => Vec::new(), // WAV can't carry cover art
            CoverMode::Default => s(&["--embed-thumbnail", "--convert-thumbnails", "jpg"]),
            CoverMode::Square if wav => Vec::new(),
            CoverMode::Square => s(&[
                "--embed-thumbnail",
                "--convert-thumbnails",
                "jpg",
                "--ppa",
                "ThumbnailsConvertor+ffmpeg_o:-q:v 2 -vf 'crop=min(iw\\,ih):min(iw\\,ih)'",
            ]),
        })
    }
}

/// Puts the user's own picture on a finished audio file (MP3, M4A or FLAC), replacing any cover already there.
pub async fn apply_custom_cover(ffmpeg: &Path, audio: &Path, cover: &Path) -> Result<(), String> {
    let ext = audio.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    if !["mp3", "m4a", "flac"].contains(&ext.as_str()) {
        return Err(format!("{} files can't hold cover art.", ext.to_uppercase()));
    }
    let tmp = audio.with_extension(format!("kaisu-tmp.{ext}"));
    let mut args: Vec<String> = ["-y", "-loglevel", "error", "-i"].map(String::from).into();
    args.push(audio.display().to_string());
    args.push("-i".into());
    args.push(cover.display().to_string());
    args.extend(["-map", "0:a", "-map", "1:v", "-c", "copy", "-map_metadata", "0", "-disposition:v:0", "attached_pic"].map(String::from));
    args.extend(["-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)"].map(String::from));
    if ext == "mp3" {
        args.extend(["-id3v2_version", "3"].map(String::from));
    }
    args.push(tmp.display().to_string());
    run_ffmpeg_replace(ffmpeg, &args, &tmp, audio).await
}

async fn run_ffmpeg_replace(ffmpeg: &Path, args: &[String], tmp: &Path, target: &Path) -> Result<(), String> {
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    match proc::run_capture(ffmpeg, &refs, Duration::from_secs(120)).await {
        Ok(_) => tokio::fs::rename(tmp, target).await.map_err(|e| format!("Couldn't replace the file: {e}")),
        Err(e) => {
            let _ = tokio::fs::remove_file(tmp).await;
            Err(e)
        }
    }
}

// ---- audio processing ----------------------------------------------------------------------

#[derive(Deserialize, Serialize, Default, Clone, Debug)]
#[serde(default)]
pub struct AudioExtras {
    /// `0` (best) to `9` for variable quality, or a bitrate like `192K`.
    pub quality: Option<String>,
    /// Make loudness consistent between tracks.
    pub normalize: bool,
    /// Cut silence from the start and end.
    pub trim_silence: bool,
}

pub fn validate_audio_quality(q: &str) -> Result<&str, String> {
    let bitrate = q.strip_suffix(['K', 'k']).is_some_and(|n| (2..=3).contains(&n.len()) && n.chars().all(|c| c.is_ascii_digit()) && (32..=512).contains(&n.parse::<u32>().unwrap_or(0)));
    let vbr = q.len() == 1 && q.chars().all(|c| c.is_ascii_digit());
    if bitrate || vbr { Ok(q) } else { Err("Audio quality must be 0 to 9, or a bitrate like 192K.".into()) }
}

impl AudioExtras {
    pub fn quality(&self) -> Result<String, String> {
        match self.quality.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
            Some(q) => validate_audio_quality(q).map(str::to_string),
            None => Ok("0".into()),
        }
    }

    /// The ffmpeg audio filter chain, if any processing was asked for.
    pub fn filter(&self) -> Option<String> {
        const TRIM: &str = "silenceremove=start_periods=1:start_threshold=-50dB";
        let mut parts: Vec<String> = Vec::new();
        if self.trim_silence {
            // Trim the start, flip, trim what was the end, flip back.
            parts.extend([TRIM.to_string(), "areverse".into(), TRIM.to_string(), "areverse".into()]);
        }
        if self.normalize {
            parts.push("loudnorm=I=-16:TP=-1.5:LRA=11".into());
        }
        (!parts.is_empty()).then(|| parts.join(","))
    }

    pub fn args(&self) -> Vec<String> {
        match self.filter() {
            Some(f) => vec!["--ppa".into(), format!("ExtractAudio+ffmpeg_o:-af {f}")],
            None => Vec::new(),
        }
    }
}

// ---- lyrics --------------------------------------------------------------------------------

#[derive(Deserialize, Serialize, Clone, Copy, Default, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum LyricsMode {
    #[default]
    Off,
    /// A `.lrc` file next to the song.
    File,
    /// Inside the song's tags.
    Embed,
    Both,
}

impl LyricsMode {
    pub fn file(self) -> bool {
        matches!(self, LyricsMode::File | LyricsMode::Both)
    }
    pub fn embed(self) -> bool {
        matches!(self, LyricsMode::Embed | LyricsMode::Both)
    }
}

#[derive(Debug, PartialEq)]
pub struct Lyrics {
    pub synced: Option<String>,
    pub plain: Option<String>,
}

/// "Artist - Topic" channels and "(Official Video)" decorations make poor search terms.
pub fn tidy_for_lookup(artist: &str, title: &str) -> (String, String) {
    let artist = artist.trim().trim_end_matches(" - Topic").trim().to_string();
    let mut title = title.trim().to_string();
    // Drop bracketed noise like "(Official Video)", "[Lyrics]", "(HD)".
    let noise = ["official", "lyric", "video", "audio", "hd", "4k", "remaster", "visualizer"];
    loop {
        let open = title.rfind(['(', '[']);
        let Some(start) = open else { break };
        let close = if title[start..].starts_with('(') { ')' } else { ']' };
        let Some(end_rel) = title[start..].find(close) else { break };
        let inner = title[start + 1..start + end_rel].to_lowercase();
        if end_rel + start + 1 >= title.len() && noise.iter().any(|n| inner.contains(n)) {
            title = title[..start].trim().to_string();
        } else {
            break;
        }
    }
    // "Artist - Song" → "Song" when the artist matches.
    if let Some((left, right)) = title.split_once(" - ") {
        if artist.is_empty() || left.trim().eq_ignore_ascii_case(&artist) {
            return (if artist.is_empty() { left.trim().to_string() } else { artist }, right.trim().to_string());
        }
    }
    (artist, title)
}

pub fn parse_lyrics(body: &str) -> Option<Lyrics> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let text = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let lyrics = Lyrics { synced: text("syncedLyrics"), plain: text("plainLyrics") };
    (lyrics.synced.is_some() || lyrics.plain.is_some()).then_some(lyrics)
}

/// Looks the song up on LRCLIB (a free lyrics service). `Ok(None)` means it simply has none.
pub async fn fetch_lyrics(client: &reqwest::Client, artist: &str, title: &str, duration: Option<f64>) -> Result<Option<Lyrics>, String> {
    if title.trim().is_empty() {
        return Ok(None);
    }
    let mut params = vec![("artist_name", artist.to_string()), ("track_name", title.to_string())];
    if let Some(d) = duration.filter(|d| *d > 0.0) {
        params.push(("duration", format!("{}", d.round() as u64)));
    }
    let url = reqwest::Url::parse_with_params("https://lrclib.net/api/get", &params).map_err(|e| e.to_string())?;
    let res = client.get(url).timeout(Duration::from_secs(15)).send().await.map_err(|e| format!("Couldn't reach the lyrics service: {e}"))?;
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !res.status().is_success() {
        return Err(format!("The lyrics service answered {}.", res.status()));
    }
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(parse_lyrics(&body))
}

/// Saves `.lrc` (or `.txt` when only plain lyrics exist) next to the song.
pub async fn write_lyrics_file(audio: &Path, lyrics: &Lyrics) -> Result<PathBuf, String> {
    let (ext, text) = match (&lyrics.synced, &lyrics.plain) {
        (Some(s), _) => ("lrc", s.clone()),
        (None, Some(p)) => ("txt", p.clone()),
        _ => return Err("No lyrics to save.".into()),
    };
    let path = audio.with_extension(ext);
    tokio::fs::write(&path, text).await.map_err(|e| format!("Couldn't save the lyrics: {e}"))?;
    Ok(path)
}

/// Preserve synchronized timestamps in the embedded text so the file remains useful
/// without its sidecar. Plain lyrics are used when synchronized lyrics are unavailable.
fn lyrics_to_embed(lyrics: &Lyrics) -> Result<String, String> {
    lyrics.synced.clone().or_else(|| lyrics.plain.clone()).ok_or("No lyrics to embed.".into())
}
/// Writes lyrics into the song's tags.
pub async fn embed_lyrics(_ffmpeg: &Path, audio: &Path, lyrics: &Lyrics) -> Result<(), String> {
    let ext = audio.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    if !["mp3", "m4a", "flac", "opus", "wav"].contains(&ext.as_str()) {
        return Err(format!("{} files can't hold lyrics.", ext.to_uppercase()));
    }
    let text = lyrics_to_embed(lyrics)?;
    crate::tags::embed_lyrics(audio.to_path_buf(), text).await
}

/// "[01:23.45] words" → "words"
#[cfg(test)]
pub fn strip_timestamps(lrc: &str) -> String {
    lrc.lines()
        .map(|l| {
            let mut rest = l.trim();
            while rest.starts_with('[') {
                match rest.find(']') {
                    Some(i) => rest = rest[i + 1..].trim_start(),
                    None => break,
                }
            }
            rest
        })
        .collect::<Vec<_>>()
        .join("\n")
}

// ---- checking the finished file -------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub struct Verdict {
    pub ok: bool,
    pub note: Option<String>,
}

/// Decides whether a probed duration is believable next to the expected one.
pub fn judge_duration(found: Option<f64>, expected: Option<f64>) -> Verdict {
    let Some(found) = found.filter(|d| d.is_finite() && *d > 0.0) else {
        return Verdict { ok: false, note: Some("This file can't be read, so it may be damaged.".into()) };
    };
    if let Some(expected) = expected.filter(|e| *e > 1.0) {
        let slack = (expected * 0.03).max(3.0);
        if found + slack < expected {
            return Verdict { ok: false, note: Some(format!("This file is shorter than expected ({} s instead of {} s), so it may be cut off.", found.round(), expected.round())) };
        }
        if found > expected + slack.max(10.0) {
            return Verdict { ok: false, note: Some(format!("This file is longer than expected ({} s instead of {} s).", found.round(), expected.round())) };
        }
    }
    Verdict { ok: true, note: None }
}

pub async fn verify_file(ffprobe: &Path, file: &Path, expected: Option<f64>) -> Verdict {
    let path = file.display().to_string();
    let args = ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path.as_str()];
    let probe = proc::run_capture(ffprobe, &args, Duration::from_secs(30)).await.ok().and_then(|out| serde_json::from_str::<serde_json::Value>(&out).ok());
    let playable = probe.as_ref().and_then(|p| p["streams"].as_array()).is_some_and(|streams| streams.iter().any(|s| matches!(s["codec_type"].as_str(), Some("audio" | "video"))));
    if !playable { return Verdict { ok: false, note: Some("This file has no readable audio or video stream.".into()) }; }
    let found = probe.as_ref().and_then(|p| p["format"]["duration"].as_str()).and_then(|d| d.parse::<f64>().ok());
    let size = tokio::fs::metadata(file).await.map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        return Verdict { ok: false, note: Some("This file is empty.".into()) };
    }
    judge_duration(found, expected)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn embedding_prefers_lrc_timestamps_and_falls_back_to_plain_text() {
        let synced = "[00:01.00] A line";
        assert_eq!(lyrics_to_embed(&Lyrics { synced: Some(synced.into()), plain: Some("A line".into()) }).unwrap(), synced);
        assert_eq!(lyrics_to_embed(&Lyrics { synced: None, plain: Some("Plain line".into()) }).unwrap(), "Plain line");
        assert!(lyrics_to_embed(&Lyrics { synced: None, plain: None }).is_err());
    }

    fn meta(f: impl FnOnce(&mut MetaOptions)) -> MetaOptions {
        let mut m = MetaOptions::default();
        f(&mut m);
        m
    }

    #[test]
    fn the_title_pattern_is_valid_and_only_matches_decorations() {
        // Python's `re` is what runs it; the same constructs exist in Rust's regex syntax for a basic sanity check.
        assert!(TITLE_NOISE_REGEX.starts_with("(?i)"));
        assert!(!TITLE_NOISE_REGEX.contains('"'));
        assert!(TITLE_NOISE_REGEX.matches("official").count() == 1);
    }

    #[test]
    fn text_is_cleaned() {
        assert_eq!(clean_text("t", "  Hello \n world\t").unwrap(), Some("Hello world".into()));
        assert_eq!(clean_text("t", "   ").unwrap(), None);
        assert_eq!(clean_text("t", "ends with slash \\\\").unwrap(), Some("ends with slash".into()));
        assert!(clean_text("t", &"x".repeat(201)).is_err());
    }

    #[test]
    fn metadata_arguments_escape_what_yt_dlp_reads() {
        let a = meta(|m| m.title = Some("AC: 100% Live".into())).args().unwrap();
        assert_eq!(a, vec!["--parse-metadata", "AC\\: 100%% Live:%(meta_title)s", "--embed-metadata"]);
        // A single word would otherwise be read as a field name and come out as "NA".
        let word = meta(|m| m.artist = Some("Jawed".into())).args().unwrap();
        assert_eq!(word[1], "%(kaisu_unset|Jawed)s:%(meta_artist)s");
        assert!(MetaOptions::default().args().unwrap().is_empty());
        assert!(meta(|m| m.title = Some("  ".into())).is_empty());
    }

    #[test]
    fn year_and_track_are_checked() {
        assert!(meta(|m| m.year = Some("2024".into())).args().is_ok());
        for bad in ["24", "20x4", "0999", "12345"] {
            assert!(meta(|m| m.year = Some(bad.into())).args().is_err(), "{bad}");
        }
        assert!(meta(|m| m.track = Some("7".into())).args().is_ok());
        for bad in ["0", "07", "1000", "a", "-1"] {
            assert!(meta(|m| m.track = Some(bad.into())).args().is_err(), "{bad}");
        }
        let a = meta(|m| m.year = Some("2005".into())).args().unwrap();
        assert!(a.iter().any(|x| x.ends_with(":%(meta_date)s")));
    }

    #[test]
    fn cover_modes() {
        let c = |mode| CoverOptions { mode, path: None };
        assert!(c(CoverMode::Default).audio_args(false).unwrap().contains(&"--embed-thumbnail".to_string()));
        assert!(c(CoverMode::Default).audio_args(true).unwrap().is_empty());
        assert!(c(CoverMode::None).audio_args(false).unwrap().is_empty());
        let sq = c(CoverMode::Square).audio_args(false).unwrap();
        assert!(sq.iter().any(|x| x.contains("crop=min(iw\\,ih)")));
        assert!(c(CoverMode::Custom).audio_args(false).is_err(), "custom needs a real file");
    }

    #[test]
    fn cover_files_are_checked() {
        let dir = std::env::temp_dir().join(format!("kaisu-cover-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("a.PNG");
        std::fs::write(&ok, b"x").unwrap();
        assert!(validate_cover(&ok.display().to_string()).is_ok());
        let bad = dir.join("a.exe");
        std::fs::write(&bad, b"x").unwrap();
        assert!(validate_cover(&bad.display().to_string()).is_err());
        let empty = dir.join("e.jpg");
        std::fs::write(&empty, b"").unwrap();
        assert!(validate_cover(&empty.display().to_string()).is_err());
        assert!(validate_cover("relative.jpg").is_err());
        assert!(validate_cover(&dir.join("missing.jpg").display().to_string()).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn audio_extras() {
        assert_eq!(AudioExtras::default().filter(), None);
        let norm = AudioExtras { normalize: true, ..Default::default() };
        assert_eq!(norm.args(), vec!["--ppa", "ExtractAudio+ffmpeg_o:-af loudnorm=I=-16:TP=-1.5:LRA=11"]);
        let both = AudioExtras { normalize: true, trim_silence: true, ..Default::default() };
        let f = both.filter().unwrap();
        assert!(f.starts_with("silenceremove") && f.matches("areverse").count() == 2 && f.ends_with("loudnorm=I=-16:TP=-1.5:LRA=11"));
        for ok in ["0", "5", "9", "128K", "320k", "64K"] {
            assert!(validate_audio_quality(ok).is_ok(), "{ok}");
        }
        for bad in ["", "10", "-1", "31K", "999K", "abc", "128", "1 K", "5;rm"] {
            assert!(validate_audio_quality(bad).is_err(), "{bad}");
        }
        assert_eq!(AudioExtras::default().quality().unwrap(), "0");
    }

    #[test]
    fn lookup_terms_are_tidied() {
        assert_eq!(tidy_for_lookup("Daft Punk - Topic", "One More Time"), ("Daft Punk".into(), "One More Time".into()));
        assert_eq!(tidy_for_lookup("Daft Punk", "Daft Punk - One More Time (Official Video)"), ("Daft Punk".into(), "One More Time".into()));
        assert_eq!(tidy_for_lookup("SomeChannel", "Song [Lyrics] (HD)"), ("SomeChannel".into(), "Song".into()));
        assert_eq!(tidy_for_lookup("", "Artist - Song"), ("Artist".into(), "Song".into()));
        assert_eq!(tidy_for_lookup("X", "Keep (Live in Paris)"), ("X".into(), "Keep (Live in Paris)".into()));
    }

    #[test]
    fn lyrics_responses() {
        assert!(parse_lyrics("{}").is_none());
        assert!(parse_lyrics("nonsense").is_none());
        let l = parse_lyrics(r#"{"syncedLyrics":"[00:01.00] hi\n[00:02.50] there","plainLyrics":"hi\nthere"}"#).unwrap();
        assert_eq!(l.plain.as_deref(), Some("hi\nthere"));
        assert_eq!(strip_timestamps(l.synced.as_deref().unwrap()), "hi\nthere");
        assert_eq!(parse_lyrics(r#"{"plainLyrics":"only plain"}"#).unwrap().synced, None);
    }

    #[test]
    fn durations_are_judged() {
        assert!(judge_duration(Some(100.0), Some(101.0)).ok);
        assert!(judge_duration(Some(100.0), None).ok);
        assert!(!judge_duration(None, Some(100.0)).ok);
        assert!(!judge_duration(Some(0.0), None).ok);
        assert!(!judge_duration(Some(40.0), Some(100.0)).ok, "cut off");
        assert!(judge_duration(Some(9.0), Some(10.0)).ok, "small differences are fine");
        assert!(!judge_duration(Some(300.0), Some(100.0)).ok, "much longer");
    }
}
