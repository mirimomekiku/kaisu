//! Subtitles: which languages a video offers, and the yt-dlp options for downloading them.

use serde::{Deserialize, Serialize};

const MAX_LANGS: usize = 12;
const MAX_LANG_CHARS: usize = 20;
/// YouTube lists a machine translation into ~150 languages for most videos; offering them all is noise.
const MAX_AUTO_TRACKS: usize = 12;

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct SubtitleOptions {
    /// Language codes or patterns: `en`, `pt-BR`, `en.*`.
    pub langs: Vec<String>,
    /// Put the subtitles inside the video file.
    pub embed: bool,
    /// Save them next to the video as `.srt` files.
    pub file: bool,
    /// Also accept automatically generated captions (human-made ones are preferred when both exist).
    pub auto: bool,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct SubtitleTrack {
    pub code: String,
    pub name: String,
    pub auto: bool,
}

fn lang_ok(lang: &str) -> bool {
    let l = lang.strip_suffix(".*").unwrap_or(lang);
    let mut parts = l.split(['-', '_']);
    let first = parts.next().unwrap_or("");
    first != "all"
        && (2..=3).contains(&first.len())
        && first.chars().all(|c| c.is_ascii_alphabetic())
        && lang.chars().count() <= MAX_LANG_CHARS
        && parts.all(|p| (1..=8).contains(&p.len()) && p.chars().all(|c| c.is_ascii_alphanumeric()))
}

impl SubtitleOptions {
    /// Whether this asks for anything at all for the given kind of download.
    pub fn wanted(&self, audio: bool) -> bool {
        self.file || (self.embed && !audio)
    }

    /// The yt-dlp arguments, or an error naming what is wrong.
    pub fn args(&self, audio: bool) -> Result<Vec<String>, String> {
        if !self.wanted(audio) {
            return Ok(Vec::new());
        }
        if self.langs.is_empty() {
            return Err("Choose at least one subtitle language.".into());
        }
        if self.langs.len() > MAX_LANGS || !self.langs.iter().all(|l| lang_ok(l)) {
            return Err("Those subtitle languages aren't valid. Use codes like en, es or pt-BR.".into());
        }

        let mut a = vec!["--write-subs".to_string()];
        if self.auto {
            a.push("--write-auto-subs".into());
        }
        a.extend(["--sub-langs".into(), self.langs.join(","), "--convert-subs".into(), "srt".into()]);
        // Audio can't carry subtitles, so there it is files or nothing.
        if self.embed && !audio {
            a.push("--embed-subs".into());
            if !self.file {
                // Embedding alone shouldn't leave loose .srt files behind.
                a.extend(["--compat-options".into(), "no-keep-subs".into()]);
            }
        }
        Ok(a)
    }
}

/// The subtitle languages a video offers, from yt-dlp's JSON.
pub fn tracks(info: &serde_json::Value) -> Vec<SubtitleTrack> {
    let read = |key: &str| -> Vec<(String, String)> {
        let Some(map) = info.get(key).and_then(|m| m.as_object()) else { return Vec::new() };
        let mut out: Vec<(String, String)> = map
            .iter()
            .filter(|(code, formats)| code.as_str() != "live_chat" && formats.as_array().is_some_and(|f| !f.is_empty()))
            .map(|(code, formats)| {
                let name = formats.get(0).and_then(|f| f.get("name")).and_then(|n| n.as_str()).unwrap_or(code);
                (code.clone(), name.to_string())
            })
            .collect();
        out.sort_by_key(|(code, name)| (name.to_lowercase(), code.clone()));
        out
    };

    let manual = read("subtitles");
    let mut auto = read("automatic_captions");
    auto.retain(|(code, _)| !manual.iter().any(|(m, _)| m == code));
    if auto.len() > MAX_AUTO_TRACKS {
        // Keep only the spoken language's own captions, not the pile of translations.
        let spoken = info.get("language").and_then(|l| l.as_str());
        auto.retain(|(code, _)| code.ends_with("-orig") || Some(code.as_str()) == spoken);
    }

    manual
        .into_iter()
        .map(|(code, name)| SubtitleTrack { code, name, auto: false })
        .chain(auto.into_iter().map(|(code, name)| SubtitleTrack { code, name, auto: true }))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn opts(langs: &[&str], embed: bool, file: bool, auto: bool) -> SubtitleOptions {
        SubtitleOptions { langs: langs.iter().map(|s| s.to_string()).collect(), embed, file, auto }
    }

    #[test]
    fn nothing_requested_means_no_arguments() {
        assert!(opts(&["en"], false, false, true).args(false).unwrap().is_empty());
        assert!(SubtitleOptions::default().args(false).unwrap().is_empty());
        // Embedding into audio is impossible, so it asks for nothing.
        assert!(opts(&["en"], true, false, false).args(true).unwrap().is_empty());
    }

    #[test]
    fn files_only() {
        let a = opts(&["en", "de"], false, true, false).args(false).unwrap();
        assert_eq!(a, ["--write-subs", "--sub-langs", "en,de", "--convert-subs", "srt"]);
    }

    #[test]
    fn embedding_alone_removes_the_loose_files() {
        let a = opts(&["en"], true, false, false).args(false).unwrap();
        assert!(a.contains(&"--embed-subs".to_string()));
        assert!(a.windows(2).any(|w| w == ["--compat-options", "no-keep-subs"]));
    }

    #[test]
    fn both_keeps_the_files() {
        let a = opts(&["en"], true, true, true).args(false).unwrap();
        assert!(a.contains(&"--embed-subs".to_string()) && a.contains(&"--write-auto-subs".to_string()));
        assert!(!a.contains(&"no-keep-subs".to_string()));
    }

    #[test]
    fn audio_gets_files_only() {
        let a = opts(&["en"], true, true, false).args(true).unwrap();
        assert!(a.contains(&"--write-subs".to_string()) && !a.contains(&"--embed-subs".to_string()));
    }

    #[test]
    fn languages_are_validated() {
        for ok in ["en", "pt-BR", "zh-Hans", "es-419", "en.*", "fil", "en_US"] {
            assert!(lang_ok(ok), "{ok}");
        }
        for bad in ["", "e", "all", "english-is-too-long-for-this", "en,de", "--exec", "en;rm", "..", "en/../x", "-en", "en .*"] {
            assert!(!lang_ok(bad), "{bad:?}");
        }
        assert!(opts(&[], false, true, false).args(false).is_err());
        assert!(opts(&["en", "--exec x"], false, true, false).args(false).is_err());
        let too_many = SubtitleOptions { langs: vec!["en".to_string(); 13], file: true, ..Default::default() };
        assert!(too_many.args(false).is_err());
    }

    #[test]
    fn tracks_list_manual_first_and_hide_duplicate_auto() {
        let info = json!({
            "subtitles": { "en": [{"ext":"vtt","name":"English"}], "de": [{"name":"German"}], "live_chat": [{"name":"chat"}] },
            "automatic_captions": { "en": [{"name":"English (auto)"}], "fr": [{"name":"French (auto)"}] }
        });
        let t = tracks(&info);
        let got: Vec<(&str, bool)> = t.iter().map(|x| (x.code.as_str(), x.auto)).collect();
        assert_eq!(got, vec![("en", false), ("de", false), ("fr", true)]);
        assert_eq!(t[0].name, "English");
    }

    #[test]
    fn huge_auto_caption_lists_are_cut_down() {
        let mut auto = serde_json::Map::new();
        for i in 0..40 {
            auto.insert(format!("l{i:02}"), json!([{"name": format!("Lang {i}")}]));
        }
        auto.insert("en-orig".into(), json!([{"name": "English (Original)"}]));
        let info = json!({ "language": "en", "automatic_captions": auto });
        let t = tracks(&info);
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].code, "en-orig");
        assert!(t[0].auto);
    }

    #[test]
    fn no_subtitles_is_an_empty_list() {
        assert!(tracks(&json!({})).is_empty());
        assert!(tracks(&json!({"subtitles": {}})).is_empty());
    }
}
