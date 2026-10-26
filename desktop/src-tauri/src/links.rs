//! Telling videos, playlists and channels apart, and listing the videos inside a playlist or channel.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, State};
use url::Url;

use crate::{engine::Engine, search::SearchResult};

const MAX_PLAYLIST_ITEMS: u32 = 500;

#[derive(Serialize, PartialEq, Eq, Debug, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum LinkKind {
    Video,
    Playlist,
    Channel,
}

fn host_is(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

/// A best-effort guess from the address alone, so the UI can decide between "inspect a video" and
/// "list a playlist" without asking yt-dlp first.
pub fn classify(link: &str) -> LinkKind {
    let Ok(url) = Url::parse(link.trim()) else { return LinkKind::Video };
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let segments: Vec<&str> = url.path_segments().map(|s| s.filter(|p| !p.is_empty()).collect()).unwrap_or_default();
    let has_query = |key: &str| url.query_pairs().any(|(k, v)| k == key && !v.is_empty());

    if host_is(&host, "youtube.com") || host_is(&host, "youtube-nocookie.com") {
        return match segments.first().copied() {
            Some("playlist") if has_query("list") => LinkKind::Playlist,
            Some("watch") | Some("shorts") | Some("live") | Some("embed") | Some("v") => LinkKind::Video,
            Some(s) if s.starts_with('@') => LinkKind::Channel,
            Some("channel") | Some("c") | Some("user") => LinkKind::Channel,
            _ => LinkKind::Video,
        };
    }
    if host == "youtu.be" {
        return LinkKind::Video;
    }
    if host_is(&host, "soundcloud.com") {
        return match segments.as_slice() {
            [_, "sets", _] => LinkKind::Playlist,
            [_] => LinkKind::Channel,
            _ => LinkKind::Video,
        };
    }
    if host_is(&host, "bandcamp.com") {
        return match segments.first().copied() {
            Some("album") => LinkKind::Playlist,
            None | Some("music") => LinkKind::Channel,
            _ => LinkKind::Video,
        };
    }
    if segments.iter().any(|s| matches!(*s, "playlist" | "playlists" | "sets" | "album")) {
        return LinkKind::Playlist;
    }
    LinkKind::Video
}

/// Channel pages list their tabs; the videos are on the `/videos` tab.
pub fn listing_url(link: &str, kind: LinkKind) -> String {
    let trimmed = link.trim();
    if kind != LinkKind::Channel {
        return trimmed.to_string();
    }
    let Ok(mut url) = Url::parse(trimmed) else { return trimmed.to_string() };
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if !host_is(&host, "youtube.com") {
        return trimmed.to_string();
    }
    let mut segments: Vec<String> = url.path_segments().map(|s| s.filter(|p| !p.is_empty()).map(String::from).collect()).unwrap_or_default();
    // "@name", "channel/ID", "c/name" and "user/name" are the channel itself; anything after is a tab.
    let base = if segments.first().is_some_and(|s| s.starts_with('@')) { 1 } else { 2 };
    if segments.len() == base {
        segments.push("videos".into());
        url.set_path(&segments.join("/"));
    }
    url.to_string()
}

#[tauri::command]
pub fn classify_link(url: String) -> LinkKind {
    classify(&url)
}

#[derive(Serialize)]
pub struct PlaylistInfo {
    title: String,
    uploader: Option<String>,
    kind: LinkKind,
    /// How many videos the site says there are (may exceed what was listed).
    total: Option<u64>,
    entries: Vec<SearchResult>,
}

/// Videos from a flat listing. Unlike search results, ids can be anything (other sites don't use 11-character ids).
pub(crate) fn parse_entries(json: &serde_json::Value) -> Vec<SearchResult> {
    let Some(entries) = json.get("entries").and_then(|e| e.as_array()) else { return Vec::new() };
    let text = |e: &serde_json::Value, k: &str| e.get(k).and_then(|x| x.as_str()).map(str::to_string);

    entries
        .iter()
        .filter_map(|e| {
            let id = text(e, "id")?;
            let is_yt_video = id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
            let link = text(e, "url")
                .filter(|u| u.starts_with("http://") || u.starts_with("https://"))
                .or_else(|| text(e, "webpage_url").filter(|u| u.starts_with("http")))
                .or_else(|| is_yt_video.then(|| format!("https://www.youtube.com/watch?v={id}")))?;
            let title = text(e, "title").unwrap_or_else(|| link.clone());
            let live = matches!(text(e, "live_status").as_deref(), Some("is_live" | "is_upcoming"));
            let thumbnail = e
                .get("thumbnails")
                .and_then(|t| t.as_array())
                .and_then(|t| t.iter().rev().find_map(|x| x.get("url")?.as_str().map(str::to_string)))
                .or_else(|| text(e, "thumbnail"))
                .or_else(|| is_yt_video.then(|| format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg")))
                .unwrap_or_default();
            Some(SearchResult {
                id,
                title,
                url: link,
                channel: text(e, "channel").or_else(|| text(e, "uploader")),
                duration_secs: e.get("duration").and_then(|d| d.as_f64()),
                view_count: e.get("view_count").and_then(|c| c.as_u64()),
                thumbnail,
                live,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn get_playlist(app: AppHandle, engine: State<'_, Engine>, url: String, limit: Option<u32>, proxy: Option<String>) -> Result<PlaylistInfo, String> {
    let link = url.trim();
    if !(link.starts_with("http://") || link.starts_with("https://")) || link.contains(char::is_whitespace) {
        return Err("Enter a full web link (starting with http:// or https://) without spaces.".into());
    }
    let kind = match classify(link) {
        LinkKind::Video => LinkKind::Playlist, // the caller asked for a listing, so treat it as one
        k => k,
    };
    let target = listing_url(link, kind);
    let limit = limit.unwrap_or(200).clamp(1, MAX_PLAYLIST_ITEMS);
    let ytdlp = engine.ytdlp_path(&app).await?;

    let end = limit.to_string();
    let proxy = crate::net::proxy_option(proxy.as_deref())?;
    let args = ["--flat-playlist", "--dump-single-json", "--no-warnings", "--playlist-end", end.as_str(), "--", target.as_str()];
    let json = crate::ytdlp::run_capture(&ytdlp, &args, Duration::from_secs(120), proxy.as_deref()).await?;
    let v: serde_json::Value = serde_json::from_str(&json).map_err(|e| format!("Unreadable playlist response: {e}"))?;

    let entries = parse_entries(&v);
    let text = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
    Ok(PlaylistInfo {
        title: text("title").unwrap_or_else(|| "Playlist".into()),
        uploader: text("uploader").or_else(|| text("channel")),
        kind,
        total: v.get("playlist_count").and_then(|c| c.as_u64()).or(Some(entries.len() as u64)),
        entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn youtube_links_are_classified() {
        let cases = [
            ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", LinkKind::Video),
            ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123", LinkKind::Video),
            ("https://youtu.be/dQw4w9WgXcQ?list=PL123", LinkKind::Video),
            ("https://www.youtube.com/shorts/abcdefghijk", LinkKind::Video),
            ("https://music.youtube.com/watch?v=abc", LinkKind::Video),
            ("https://www.youtube.com/playlist?list=PL123", LinkKind::Playlist),
            ("https://www.youtube.com/playlist", LinkKind::Video),
            ("https://www.youtube.com/@jawed", LinkKind::Channel),
            ("https://www.youtube.com/@jawed/videos", LinkKind::Channel),
            ("https://www.youtube.com/channel/UC4QobU6STFB0P71PMvOGN5A", LinkKind::Channel),
            ("https://www.youtube.com/c/Name", LinkKind::Channel),
            ("https://www.youtube.com/user/name", LinkKind::Channel),
        ];
        for (url, want) in cases {
            assert_eq!(classify(url), want, "{url}");
        }
    }

    #[test]
    fn other_sites_and_junk() {
        assert_eq!(classify("https://soundcloud.com/artist/sets/mixtape"), LinkKind::Playlist);
        assert_eq!(classify("https://soundcloud.com/artist"), LinkKind::Channel);
        assert_eq!(classify("https://soundcloud.com/artist/track"), LinkKind::Video);
        assert_eq!(classify("https://band.bandcamp.com/album/x"), LinkKind::Playlist);
        assert_eq!(classify("https://band.bandcamp.com/track/x"), LinkKind::Video);
        assert_eq!(classify("https://vimeo.com/123456"), LinkKind::Video);
        assert_eq!(classify("https://example.com/watch/playlist/9"), LinkKind::Playlist);
        assert_eq!(classify("not a url"), LinkKind::Video);
        assert_eq!(classify("https://evilyoutube.com/@x"), LinkKind::Video);
    }

    #[test]
    fn channels_list_their_videos_tab() {
        let ch = |u: &str| listing_url(u, LinkKind::Channel);
        assert_eq!(ch("https://www.youtube.com/@jawed"), "https://www.youtube.com/@jawed/videos");
        assert_eq!(ch("https://www.youtube.com/@jawed/"), "https://www.youtube.com/@jawed/videos");
        assert_eq!(ch("https://www.youtube.com/@jawed/shorts"), "https://www.youtube.com/@jawed/shorts");
        assert_eq!(ch("https://www.youtube.com/channel/UCabc"), "https://www.youtube.com/channel/UCabc/videos");
        assert_eq!(ch("https://www.youtube.com/channel/UCabc/streams"), "https://www.youtube.com/channel/UCabc/streams");
        assert_eq!(listing_url("https://www.youtube.com/playlist?list=PL1", LinkKind::Playlist), "https://www.youtube.com/playlist?list=PL1");
        assert_eq!(ch("https://soundcloud.com/artist"), "https://soundcloud.com/artist");
    }

    #[test]
    fn entries_from_youtube_and_other_sites() {
        let v = serde_json::json!({"entries": [
            {"id":"jNQXAC9IVRw","url":"https://www.youtube.com/watch?v=jNQXAC9IVRw","title":"Me at the zoo","channel":"jawed","duration":19,"view_count":5,
             "thumbnails":[{"url":"https://i.ytimg.com/a.jpg"}]},
            {"id":"abcdefghijk","title":"No url field"},
            {"id":"12345","url":"https://soundcloud.com/a/b","title":"Track"},
            {"id":"99","title":"unusable, no link"},
            {"title":"no id"},
            {"id":"abcdefghijl","title":"Live","live_status":"is_live"}
        ]});
        let e = parse_entries(&v);
        assert_eq!(e.len(), 4);
        assert_eq!(e[0].thumbnail, "https://i.ytimg.com/a.jpg");
        assert_eq!(e[1].url, "https://www.youtube.com/watch?v=abcdefghijk");
        assert_eq!(e[1].thumbnail, "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg");
        assert_eq!(e[2].url, "https://soundcloud.com/a/b");
        assert_eq!(e[2].thumbnail, "");
        assert!(e[3].live);
    }
}
