//! YouTube search through yt-dlp's `ytsearchN:` pseudo-URL, in flat mode (no per-video requests),
//! so results come back in a few seconds.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{engine::Engine, proc};

const MAX_RESULTS: u32 = 50;
const MAX_QUERY_CHARS: usize = 200;
/// The `sp` value of a YouTube Music search that shows only songs.
const MUSIC_SONGS_FILTER: &str = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";

#[derive(Serialize, Debug, PartialEq)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub url: String,
    pub channel: Option<String>,
    pub duration_secs: Option<f64>,
    pub view_count: Option<u64>,
    pub thumbnail: String,
    /// "live" / "upcoming" entries can't be downloaded like normal videos.
    pub live: bool,
}

/// Where to search. Only sources that were checked against the real service are listed. Tried and left out because
/// they returned nothing or an error: Dailymotion, Bilibili, Niconico, Yahoo, Google Video, Rokfin and PRX.
#[derive(Deserialize, Clone, Copy, Default, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SearchSource {
    #[default]
    Youtube,
    Soundcloud,
    /// Songs on YouTube Music (the "Songs" filter of its search page).
    YoutubeMusic,
}

impl SearchSource {
    /// What yt-dlp is asked to open: a search prefix, or for YouTube Music the address of its search page.
    /// `query` has been cleaned, and the result goes after `--`, so it can never be read as an option.
    pub fn target(self, limit: u32, query: &str) -> String {
        match self {
            SearchSource::Youtube => format!("ytsearch{limit}:{query}"),
            SearchSource::Soundcloud => format!("scsearch{limit}:{query}"),
            SearchSource::YoutubeMusic => {
                let q: String = url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
                format!("https://music.youtube.com/search?q={q}&sp={MUSIC_SONGS_FILTER}")
            }
        }
    }

    /// Search pages return everything they have, so the number of results has to be asked for.
    fn limits_with_playlist_end(self) -> bool {
        matches!(self, SearchSource::YoutubeMusic)
    }

    fn name(self) -> &'static str {
        match self {
            SearchSource::Youtube => "YouTube",
            SearchSource::Soundcloud => "SoundCloud",
            SearchSource::YoutubeMusic => "YouTube Music",
        }
    }

    fn explain(self, error: String) -> String {
        if error.contains("Timed out") {
            format!("{} didn't answer in time. Check your connection and try again.", self.name())
        } else {
            error
        }
    }
}

fn clean_query(query: &str) -> Result<String, String> {
    let q = query.split_whitespace().collect::<Vec<_>>().join(" ");
    if q.is_empty() {
        return Err("Type something to search for.".into());
    }
    if q.chars().count() > MAX_QUERY_CHARS {
        return Err(format!("Search is limited to {MAX_QUERY_CHARS} characters."));
    }
    Ok(q)
}

fn parse_results(json: &serde_json::Value) -> Vec<SearchResult> {
    let Some(entries) = json.get("entries").and_then(|e| e.as_array()) else { return Vec::new() };
    let text = |e: &serde_json::Value, k: &str| e.get(k).and_then(|x| x.as_str()).map(str::to_string);

    entries
        .iter()
        .filter_map(|e| {
            let id = text(e, "id")?;
            // Channels and playlists can appear in results; only videos have an 11-char id.
            if id.len() != 11 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                return None;
            }
            let title = text(e, "title")?;
            let live = matches!(text(e, "live_status").as_deref(), Some("is_live" | "is_upcoming"));
            let thumbnail = e
                .get("thumbnails")
                .and_then(|t| t.as_array())
                .and_then(|t| t.iter().rev().find_map(|x| x.get("url")?.as_str().map(str::to_string)))
                .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg"));
            Some(SearchResult {
                url: format!("https://www.youtube.com/watch?v={id}"),
                channel: text(e, "channel").or_else(|| text(e, "uploader")),
                duration_secs: e.get("duration").and_then(|d| d.as_f64()),
                view_count: e.get("view_count").and_then(|c| c.as_u64()),
                id,
                title,
                thumbnail,
                live,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn search_media(
    app: AppHandle,
    engine: State<'_, Engine>,
    query: String,
    limit: Option<u32>,
    source: Option<SearchSource>,
    proxy: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    let query = clean_query(&query)?;
    let limit = limit.unwrap_or(12).clamp(1, MAX_RESULTS);
    let ytdlp = engine.ytdlp_path(&app).await?;

    // The pseudo-URL comes after `--`, so a query can never be read as an option.
    let source = source.unwrap_or_default();
    let target = source.target(limit, &query);
    let end = limit.to_string();
    let proxy = crate::net::proxy_option(proxy.as_deref())?;
    let mut args = vec!["--flat-playlist", "--dump-single-json", "--no-warnings"];
    if source.limits_with_playlist_end() {
        args.extend(["--playlist-end", end.as_str()]);
    }
    args.extend(["--", target.as_str()]);
    let json = proc::run_capture_proxied(&ytdlp, &args, Duration::from_secs(45), proxy.as_deref()).await.map_err(|e| source.explain(e))?;
    let v: serde_json::Value = serde_json::from_str(&json).map_err(|e| format!("Unreadable search response: {e}"))?;
    Ok(match source {
        SearchSource::Youtube => parse_results(&v),
        // Other sites don't use YouTube's 11-character ids, so take what they give.
        SearchSource::Soundcloud | SearchSource::YoutubeMusic => crate::links::parse_entries(&v),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sources_map_to_their_prefixes() {
        assert_eq!(SearchSource::Youtube.target(12, "lofi"), "ytsearch12:lofi");
        assert_eq!(SearchSource::Soundcloud.target(5, "a b"), "scsearch5:a b");
        let music = SearchSource::YoutubeMusic.target(12, "daft punk & co");
        assert_eq!(music, format!("https://music.youtube.com/search?q=daft+punk+%26+co&sp={MUSIC_SONGS_FILTER}"));
        assert!(SearchSource::YoutubeMusic.limits_with_playlist_end() && !SearchSource::Youtube.limits_with_playlist_end());
        let m: SearchSource = serde_json::from_str("\"youtube_music\"").unwrap();
        assert_eq!(m, SearchSource::YoutubeMusic);
        assert_eq!(SearchSource::default(), SearchSource::Youtube);
        let s: SearchSource = serde_json::from_str("\"soundcloud\"").unwrap();
        assert_eq!(s, SearchSource::Soundcloud);
        assert!(serde_json::from_str::<SearchSource>("\"dailymotion\"").is_err(), "unverified sources are refused");
    }

    #[test]
    fn queries_are_normalised_and_bounded() {
        assert_eq!(clean_query("  lo   fi \n beats ").unwrap(), "lo fi beats");
        assert!(clean_query("   ").is_err());
        assert!(clean_query(&"a".repeat(201)).is_err());
        // Leading dashes are harmless: the target is always passed after `--`.
        assert_eq!(clean_query("--exec calc").unwrap(), "--exec calc");
    }

    #[test]
    fn results_keep_only_real_videos() {
        let v = serde_json::json!({"entries": [
            {"id":"jNQXAC9IVRw","title":"Me at the zoo","channel":"jawed","duration":19,"view_count":445392114,
             "thumbnails":[{"url":"https://i.ytimg.com/a.jpg"},{"url":"https://i.ytimg.com/b.jpg"}]},
            {"id":"UC4QobU6STFB0P71PMvOGN5A","title":"A channel result"},
            {"id":"short","title":"bad id"},
            {"id":"abcdefghijk","title":"Live now","live_status":"is_live"},
            {"id":"abcdefghijl"}
        ]});
        let r = parse_results(&v);
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].url, "https://www.youtube.com/watch?v=jNQXAC9IVRw");
        assert_eq!(r[0].thumbnail, "https://i.ytimg.com/b.jpg");
        assert_eq!(r[0].duration_secs, Some(19.0));
        assert!(!r[0].live && r[1].live);
        assert_eq!(r[1].thumbnail, "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg");
    }

    #[test]
    fn missing_entries_gives_empty_list() {
        assert!(parse_results(&serde_json::json!({})).is_empty());
    }
}
