//! Where downloads go and what they are called: folder layout, filename style, playlist folders and
//! numbering, and the suffix for clipped downloads. Produces a yt-dlp output template.
//!
//! A custom template is the one piece of free text that ends up in a path, so it is validated strictly:
//! relative only, no `..`, no characters that are illegal in filenames, and only well-formed `%(field)s` groups.

use serde::{Deserialize, Serialize};

const MAX_CUSTOM_CHARS: usize = 300;
const MAX_PLAYLIST_FOLDER_CHARS: usize = 100;
/// 48 hours: nothing sensible is longer, and it keeps the arithmetic away from silly values.
const MAX_CLIP_SECONDS: f64 = 48.0 * 3600.0;

#[derive(Deserialize, Serialize, Clone, Copy, Default, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Layout {
    /// Everything in the download folder.
    #[default]
    Flat,
    /// A folder per channel.
    Channel,
    /// `Video/` and `Audio/` folders.
    Kind,
    /// A folder per upload year.
    Year,
    /// `Artist/Album/`, the way music players expect it.
    Music,
}

#[derive(Deserialize, Serialize, Clone, Copy, Default, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum NameStyle {
    /// `Title [id]`, which can't collide.
    #[default]
    TitleId,
    Title,
    ChannelTitle,
    DateTitle,
    /// `7 - Title`, using the track number when there is one.
    TrackTitle,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(default)]
pub struct OutputOptions {
    pub layout: Layout,
    pub name: NameStyle,
    /// Replaces layout and name when set (Advanced).
    pub custom: Option<String>,
    /// Put playlist downloads in a folder named after the playlist.
    #[serde(default = "yes")]
    pub playlist_folder: bool,
    /// Prefix playlist items with their position (`01 - `).
    #[serde(default = "yes")]
    pub playlist_numbering: bool,
}

impl Default for OutputOptions {
    fn default() -> Self {
        Self { layout: Layout::Flat, name: NameStyle::TitleId, custom: None, playlist_folder: true, playlist_numbering: true }
    }
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct PlaylistCtx {
    pub title: String,
    /// 1-based position in the playlist.
    pub index: u32,
    pub total: u32,
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug)]
pub struct Clip {
    pub start: f64,
    pub end: f64,
    /// Re-encode at the cut points for an exact cut (slower). Otherwise cuts land on keyframes.
    #[serde(default)]
    pub precise: bool,
}

impl Clip {
    pub fn validate(&self) -> Result<(), String> {
        let ok = self.start.is_finite() && self.end.is_finite() && self.start >= 0.0 && self.end > self.start && self.end <= MAX_CLIP_SECONDS;
        if ok { Ok(()) } else { Err("The clip's start and end times aren't valid (the end must come after the start).".into()) }
    }

    /// The value for `--download-sections`.
    pub fn section(&self) -> String {
        format!("*{}-{}", self.start, self.end)
    }
}

/// `80` → `1m20s`, `3725` → `1h2m5s`. Only letters and digits, so it is always safe in a filename.
pub fn compact_time(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    let (h, m, s) = (total / 3600, (total % 3600) / 60, total % 60);
    match (h, m) {
        (0, 0) => format!("{s}s"),
        (0, _) => format!("{m}m{s}s"),
        _ => format!("{h}h{m}m{s}s"),
    }
}

/// Makes arbitrary text safe to embed as a literal path segment in a yt-dlp template.
pub fn sanitize_literal(text: &str, max_chars: usize) -> String {
    let cleaned: String = text
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed: String = collapsed.chars().take(max_chars).collect();
    // A trailing dot or space is dropped by Windows, and a leading dot hides the folder on Unix.
    let trimmed = trimmed.trim_matches(|c: char| c == '.' || c == ' ').replace('%', "%%");
    if trimmed.is_empty() { "Playlist".into() } else { trimmed }
}

/// Checks a user-written template and returns its path segments (without the extension).
pub fn validate_custom(custom: &str) -> Result<Vec<String>, String> {
    let c = custom.trim();
    let c = c.strip_suffix(".%(ext)s").unwrap_or(c);
    let bad = |why: &str| Err(format!("Custom file name: {why}"));
    if c.is_empty() {
        return bad("it's empty.");
    }
    if c.chars().count() > MAX_CUSTOM_CHARS {
        return bad("it's too long.");
    }
    if c.chars().any(|ch| ch.is_control()) {
        return bad("it contains invalid characters.");
    }
    if c.contains('\\') {
        return bad("use / (not \\) between folders.");
    }
    let bytes = c.as_bytes();
    if c.starts_with('/') || c.starts_with('~') || (bytes.len() > 1 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic()) {
        return bad("it must be relative to your download folder.");
    }

    let segments: Vec<&str> = c.split('/').collect();
    if segments.iter().any(|s| s.is_empty() || *s == "." || *s == "..") {
        return bad("folders can't be empty, '.' or '..'.");
    }

    // Walk each segment: literal text must be filename-safe, and every % must start a %(field)x group or be %%.
    for seg in &segments {
        let chars: Vec<char> = seg.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            match chars[i] {
                '%' if chars.get(i + 1) == Some(&'%') => i += 2,
                '%' if chars.get(i + 1) == Some(&'(') => {
                    let Some(close) = chars[i + 2..].iter().position(|&ch| ch == ')') else {
                        return bad("a %( field is missing its closing ).");
                    };
                    i += 2 + close + 1;
                    // The conversion type (s, d, ...), possibly with a length like `.150B`.
                    let rest: String = chars[i..].iter().take(6).collect();
                    let after = rest.trim_start_matches(|ch: char| ch.is_ascii_digit() || ch == '.' || ch == '+' || ch == '-' || ch == '#');
                    if after.is_empty() || !after.chars().next().is_some_and(|ch| ch.is_ascii_alphabetic()) {
                        return bad("a %(field) needs a type letter after it, like %(title)s.");
                    }
                    let consumed = rest.chars().count() - after.chars().count() + 1;
                    i += consumed;
                }
                '%' => return bad("a lone % isn't allowed. Write %% for a literal percent sign."),
                '<' | '>' | ':' | '"' | '|' | '?' | '*' => return bad("it contains a character that isn't allowed in file names (< > : \" | ? *)."),
                _ => i += 1,
            }
        }
    }
    Ok(segments.into_iter().map(String::from).collect())
}

fn name_template(style: NameStyle) -> &'static str {
    match style {
        NameStyle::TitleId => "%(title).150B [%(id)s]",
        NameStyle::Title => "%(title).180B",
        NameStyle::ChannelTitle => "%(channel,uploader|Unknown)s - %(title).150B",
        NameStyle::DateTitle => "%(upload_date>%Y-%m-%d|unknown date)s - %(title).150B",
        NameStyle::TrackTitle => "%(meta_track,track_number&{} - |)s%(meta_title,track,title).150B",
    }
}

fn digits(mut n: u32) -> usize {
    let mut d = 1;
    while n >= 10 {
        n /= 10;
        d += 1;
    }
    d
}

/// The full `-o` value, relative to the download folder.
pub fn build_template(opts: &OutputOptions, is_audio: bool, playlist: Option<&PlaylistCtx>, clip: Option<&Clip>) -> Result<String, String> {
    let custom = opts.custom.as_deref().map(str::trim).filter(|c| !c.is_empty());

    let (mut dirs, file): (Vec<String>, String) = match custom {
        Some(c) => {
            let mut segs = validate_custom(c)?;
            let file = segs.pop().unwrap_or_default();
            (segs, file)
        }
        None => {
            let dirs: Vec<String> = match opts.layout {
                Layout::Flat => vec![],
                Layout::Channel => vec!["%(channel,uploader|Unknown channel)s".to_string()],
                Layout::Kind => vec![if is_audio { "Audio" } else { "Video" }.to_string()],
                Layout::Year => vec!["%(upload_date>%Y|Unknown year)s".to_string()],
                // Typed tags (meta_*) win over what the site says.
                Layout::Music => vec!["%(meta_artist,artist,channel,uploader|Unknown artist)s".to_string(), "%(meta_album,album|Singles)s".to_string()],
            };
            (dirs, name_template(opts.name).to_string())
        }
    };

    let mut prefix = String::new();
    if let Some(pl) = playlist {
        if opts.playlist_folder {
            dirs.push(sanitize_literal(&pl.title, MAX_PLAYLIST_FOLDER_CHARS));
        }
        if opts.playlist_numbering {
            prefix = format!("{:0width$} - ", pl.index, width = digits(pl.total).max(2));
        }
    }

    let suffix = match clip {
        Some(c) => {
            c.validate()?;
            format!(" [clip {}-{}]", compact_time(c.start), compact_time(c.end))
        }
        None => String::new(),
    };

    dirs.push(format!("{prefix}{file}{suffix}.%(ext)s"));
    Ok(dirs.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts() -> OutputOptions {
        OutputOptions::default()
    }

    #[test]
    fn defaults_match_the_original_template() {
        assert_eq!(build_template(&opts(), false, None, None).unwrap(), "%(title).150B [%(id)s].%(ext)s");
    }

    #[test]
    fn music_layout_and_track_names() {
        let mut o = opts();
        o.layout = Layout::Music;
        o.name = NameStyle::TrackTitle;
        assert_eq!(
            build_template(&o, true, None, None).unwrap(),
            "%(meta_artist,artist,channel,uploader|Unknown artist)s/%(meta_album,album|Singles)s/%(meta_track,track_number&{} - |)s%(meta_title,track,title).150B.%(ext)s"
        );
    }

    #[test]
    fn layouts() {
        let mut o = opts();
        o.layout = Layout::Channel;
        assert_eq!(build_template(&o, false, None, None).unwrap(), "%(channel,uploader|Unknown channel)s/%(title).150B [%(id)s].%(ext)s");
        o.layout = Layout::Kind;
        assert!(build_template(&o, true, None, None).unwrap().starts_with("Audio/"));
        assert!(build_template(&o, false, None, None).unwrap().starts_with("Video/"));
        o.layout = Layout::Year;
        assert!(build_template(&o, false, None, None).unwrap().starts_with("%(upload_date>%Y|Unknown year)s/"));
    }

    #[test]
    fn name_styles() {
        let mut o = opts();
        o.name = NameStyle::Title;
        assert_eq!(build_template(&o, false, None, None).unwrap(), "%(title).180B.%(ext)s");
        o.name = NameStyle::ChannelTitle;
        assert!(build_template(&o, false, None, None).unwrap().starts_with("%(channel,uploader|Unknown)s - "));
        o.name = NameStyle::DateTitle;
        assert!(build_template(&o, false, None, None).unwrap().starts_with("%(upload_date>%Y-%m-%d|unknown date)s - "));
    }

    #[test]
    fn playlists_get_a_folder_and_padded_numbers() {
        let pl = PlaylistCtx { title: "Lo-fi: Beats / Study?".into(), index: 7, total: 120 };
        let t = build_template(&opts(), false, Some(&pl), None).unwrap();
        assert_eq!(t, "Lo-fi_ Beats _ Study_/007 - %(title).150B [%(id)s].%(ext)s");
        let small = PlaylistCtx { title: "P".into(), index: 3, total: 9 };
        assert!(build_template(&opts(), false, Some(&small), None).unwrap().contains("/03 - "));
        let mut o = opts();
        o.playlist_folder = false;
        o.playlist_numbering = false;
        assert_eq!(build_template(&o, false, Some(&small), None).unwrap(), "%(title).150B [%(id)s].%(ext)s");
    }

    #[test]
    fn playlist_folder_comes_after_the_layout_folder() {
        let mut o = opts();
        o.layout = Layout::Kind;
        let pl = PlaylistCtx { title: "Mix".into(), index: 1, total: 3 };
        assert!(build_template(&o, false, Some(&pl), None).unwrap().starts_with("Video/Mix/01 - "));
    }

    #[test]
    fn playlist_titles_cannot_inject_template_syntax_or_paths() {
        assert_eq!(sanitize_literal("100% %(title)s", 100), "100%% %%(title)s");
        assert_eq!(sanitize_literal("../../etc", 100), "_.._etc");
        assert!(!sanitize_literal("a/b\\c", 100).contains(['/', '\\']));
        assert_eq!(sanitize_literal("   ", 100), "Playlist");
        assert_eq!(sanitize_literal("...", 100), "Playlist");
        assert_eq!(sanitize_literal(&"é".repeat(300), 100).chars().count(), 100);
    }

    #[test]
    fn clips_add_a_readable_suffix() {
        let c = Clip { start: 80.0, end: 165.0, precise: false };
        assert_eq!(build_template(&opts(), false, None, Some(&c)).unwrap(), "%(title).150B [%(id)s] [clip 1m20s-2m45s].%(ext)s");
        assert_eq!(c.section(), "*80-165");
        assert_eq!(Clip { start: 0.5, end: 10.25, precise: true }.section(), "*0.5-10.25");
        assert_eq!(compact_time(3725.0), "1h2m5s");
        assert_eq!(compact_time(5.4), "5s");
    }

    #[test]
    fn invalid_clips_are_rejected() {
        for (s, e) in [(10.0, 10.0), (20.0, 10.0), (-1.0, 5.0), (0.0, f64::INFINITY), (f64::NAN, 5.0), (0.0, 1e9)] {
            assert!(Clip { start: s, end: e, precise: false }.validate().is_err(), "{s}-{e}");
        }
        assert!(Clip { start: 0.0, end: 1.0, precise: false }.validate().is_ok());
    }

    #[test]
    fn custom_templates_accept_sensible_input() {
        let mut o = opts();
        o.custom = Some("%(channel)s/%(upload_date>%Y)s/%(title)s [%(id)s]".into());
        assert_eq!(build_template(&o, false, None, None).unwrap(), "%(channel)s/%(upload_date>%Y)s/%(title)s [%(id)s].%(ext)s");
        o.custom = Some("%(title).50B - %(id)s.%(ext)s".into());
        assert_eq!(build_template(&o, false, None, None).unwrap(), "%(title).50B - %(id)s.%(ext)s");
        o.custom = Some("My Music/100%% great %(title)s".into());
        assert!(build_template(&o, true, None, None).is_ok());
    }

    #[test]
    fn custom_templates_reject_escapes_and_junk() {
        for bad in [
            "../secret/%(title)s",
            "a/../b",
            "/etc/%(title)s",
            "~/x/%(title)s",
            "C:/Users/me/%(title)s",
            "c:\\x",
            "a\\b",
            "a//b",
            "./x",
            "",
            "   ",
            "%(title",
            "%(title)",
            "100% off",
            "bad:name",
            "a|b",
            "q?",
            "star*",
            "tab\there",
            &"x".repeat(301),
        ] {
            assert!(validate_custom(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn custom_template_still_gets_playlist_and_clip_context() {
        let mut o = opts();
        o.custom = Some("Music/%(title)s".into());
        let pl = PlaylistCtx { title: "Mix".into(), index: 2, total: 20 };
        let c = Clip { start: 1.0, end: 2.0, precise: false };
        assert_eq!(build_template(&o, true, Some(&pl), Some(&c)).unwrap(), "Music/Mix/02 - %(title)s [clip 1s-2s].%(ext)s");
    }
}
