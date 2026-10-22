//! Podcasts: reading an RSS feed so the page can list its episodes and download new ones.
//!
//! Only the feed itself is fetched here, through the proxy the user chose, and only from public internet addresses (the same
//! rules as thumbnails). The episodes are downloaded the usual way, as ordinary downloads. Nothing is read from a feed except
//! text, and every size is capped, so a hostile or broken feed can only be refused.

use std::{collections::HashSet, time::Duration};

use quick_xml::{Reader, XmlVersion, events::Event};
use serde::Serialize;
use url::Url;

use crate::thumbs;

const MAX_FEED_BYTES: usize = 5 * 1024 * 1024;
const MAX_EPISODES: usize = 500;
const MAX_TEXT_CHARS: usize = 500;

#[derive(Serialize, Debug, Default, PartialEq)]
pub struct Episode {
    /// A stable id for telling new episodes from old ones (the feed's own, or the file's address).
    pub id: String,
    pub title: String,
    /// The audio file to download.
    pub url: String,
    /// When it came out, as the feed writes it (the page reads the date).
    pub published: Option<String>,
    /// Seconds, when the feed says.
    pub duration: Option<f64>,
    pub size: Option<u64>,
}

#[derive(Serialize, Debug, Default, PartialEq)]
pub struct Feed {
    pub title: String,
    pub image: Option<String>,
    /// Newest first, as feeds list them.
    pub episodes: Vec<Episode>,
}

/// `1:02:03`, `12:30` or `754` (seconds) as seconds.
pub fn parse_duration(text: &str) -> Option<f64> {
    let parts: Vec<&str> = text.trim().split(':').collect();
    if parts.is_empty() || parts.len() > 3 {
        return None;
    }
    let mut total = 0.0;
    for p in &parts {
        let n: f64 = p.trim().parse().ok()?;
        if !n.is_finite() || n < 0.0 {
            return None;
        }
        total = total * 60.0 + n;
    }
    (total > 0.0 && total < 7.0 * 24.0 * 3600.0).then_some(total)
}

fn clean(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(MAX_TEXT_CHARS).collect()
}

/// A web address a feed gives for a file or picture: http(s) and a public host, or nothing.
fn public_url(s: &str) -> Option<String> {
    let url = Url::parse(s.trim()).ok()?;
    thumbs::check_url(&url).ok()?;
    Some(url.to_string())
}

#[derive(Default)]
struct Draft {
    title: String,
    guid: String,
    published: String,
    duration: String,
    enclosure: Option<(String, Option<u64>)>,
}

/// Reads an RSS 2.0 feed (with the usual iTunes extras). Items without an audio file are skipped.
pub fn parse_feed(xml: &str) -> Result<Feed, String> {
    let mut reader = Reader::from_str(xml);
    let mut feed = Feed::default();
    let mut stack: Vec<String> = Vec::new();
    let mut text = String::new();
    let mut item: Option<Draft> = None;
    let mut saw_channel = false;
    let mut episode_ids = HashSet::new();

    let enclosure = |e: &quick_xml::events::BytesStart<'_>| -> Option<(String, Option<u64>)> {
        let (mut url, mut len, mut kind) = (None, None, None);
        for a in e.attributes().flatten() {
            let value = a.normalized_value(XmlVersion::Implicit1_0).ok()?.into_owned();
            match a.key.as_ref() {
                "url" => url = Some(value),
                "length" => len = value.trim().parse().ok(),
                "type" => kind = Some(value),
                _ => {}
            }
        }
        if kind.is_some_and(|k| !k.to_ascii_lowercase().starts_with("audio/")) {
            return None;
        }
        Some((url?, len))
    };

    loop {
        match reader.read_event().map_err(|_| "That isn't a podcast feed.".to_string())? {
            Event::Start(e) => {
                let name = e.name().as_ref().to_string();
                if name == "channel" && stack.len() == 1 && stack[0] == "rss" {
                    saw_channel = true;
                }
                if name == "item" && saw_channel && stack.len() == 2 && stack.last().is_some_and(|p| p == "channel") {
                    item = Some(Draft::default());
                }
                if let Some(d) = item.as_mut() {
                    if name == "enclosure" {
                        d.enclosure = enclosure(&e);
                    }
                } else if name == "itunes:image" && stack.last().is_some_and(|p| p == "channel")
                    && let Some(a) = e.attributes().flatten().find(|a| a.key.as_ref() == "href")
                {
                    feed.image = a.normalized_value(XmlVersion::Implicit1_0).ok().and_then(|v| public_url(&v)).or(feed.image.take());
                }
                text.clear();
                stack.push(name);
            }
            Event::Empty(e) => {
                let name = e.name().as_ref().to_string();
                if let Some(d) = item.as_mut() {
                    if name == "enclosure" {
                        d.enclosure = enclosure(&e);
                    }
                } else if name == "itunes:image" && stack.last().is_some_and(|p| p == "channel")
                    && let Some(a) = e.attributes().flatten().find(|a| a.key.as_ref() == "href")
                {
                    feed.image = a.normalized_value(XmlVersion::Implicit1_0).ok().and_then(|v| public_url(&v)).or(feed.image.take());
                }
            }
            Event::Text(t) => text.push_str(&t.xml10_content()),
            Event::CData(t) => text.push_str(&t.xml10_content()),
            Event::GeneralRef(r) => {
                let name: &str = &r;
                if let Ok(Some(c)) = r.resolve_char_ref() {
                    text.push(c);
                } else if let Some(s) = quick_xml::escape::resolve_predefined_entity(name) {
                    text.push_str(s);
                }
            }
            Event::End(_) => {
                let name = stack.pop().unwrap_or_default();
                let parent = stack.last().map(String::as_str).unwrap_or("");
                match (&mut item, name.as_str()) {
                    (Some(d), "title") if parent == "item" => d.title = clean(&text),
                    (Some(d), "guid") if parent == "item" => d.guid = text.trim().chars().take(2048).collect(),
                    (Some(d), "pubDate") if parent == "item" => d.published = clean(&text),
                    (Some(d), "itunes:duration") if parent == "item" => d.duration = text.trim().to_string(),
                    (Some(_), "item") => {
                        let d = item.take().unwrap_or_default();
                        if feed.episodes.len() < MAX_EPISODES
                            && let Some((url, size)) = d.enclosure.and_then(|(u, s)| public_url(&u).map(|u| (u, s)))
                        {
                            let id = if d.guid.is_empty() { url.clone() } else { d.guid };
                            if !episode_ids.insert(id.clone()) {
                                text.clear();
                                continue;
                            }
                            feed.episodes.push(Episode {
                                id,
                                title: if d.title.is_empty() { "Untitled episode".into() } else { d.title },
                                url,
                                published: (!d.published.is_empty()).then_some(d.published),
                                duration: parse_duration(&d.duration),
                                size,
                            });
                        }
                    }
                    (None, "title") if parent == "channel" && feed.title.is_empty() => feed.title = clean(&text),
                    (None, "url") if parent == "image" && feed.image.is_none() => feed.image = public_url(&text),
                    _ => {}
                }
                text.clear();
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !saw_channel || !stack.is_empty() {
        return Err("That isn't a podcast feed.".into());
    }
    Ok(feed)
}

/// Reads the feed at `url`.
#[tauri::command]
pub async fn podcast_fetch(url: String, proxy: Option<String>) -> Result<Feed, String> {
    let url = Url::parse(url.trim()).map_err(|_| "That isn't a web address.".to_string())?;
    thumbs::check_url(&url).map_err(|_| "Kaisu can only read feeds from public websites (http or https).".to_string())?;
    let proxy = crate::net::proxy_option(proxy.as_deref())?;
    let client = thumbs::build_client(proxy.as_deref())?;
    let mut res = client
        .get(url)
        .timeout(Duration::from_secs(25))
        .header(reqwest::header::ACCEPT, "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5")
        .send()
        .await
        .map_err(|_| "Couldn't reach that feed.".to_string())?;
    if !res.status().is_success() {
        return Err(format!("The feed answered {}.", res.status()));
    }
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|_| "The feed didn't finish loading.".to_string())? {
        if body.len() + chunk.len() > MAX_FEED_BYTES {
            return Err("That feed is too large.".into());
        }
        body.extend_from_slice(&chunk);
    }
    let text = String::from_utf8_lossy(&body).into_owned();
    let mut feed = parse_feed(&text)?;
    if feed.title.is_empty() {
        feed.title = "Podcast".into();
    }
    Ok(feed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title>Tom &amp; Jerry <![CDATA[Show]]></title>
  <image><url>https://cdn.example.com/cover.jpg</url><title>ignored</title></image>
  <itunes:image href="https://cdn.example.com/itunes.jpg"/>
  <item>
    <title>Episode 2: &#169;ool</title>
    <guid isPermaLink="false">ep-2</guid>
    <pubDate>Mon, 02 Jan 2026 10:00:00 +0000</pubDate>
    <itunes:duration>1:02:03</itunes:duration>
    <enclosure url="https://cdn.example.com/ep2.mp3" length="12345" type="audio/mpeg"/>
  </item>
  <item>
    <title>No audio here</title>
  </item>
  <item>
    <title>Local file</title>
    <enclosure url="http://192.168.1.5/x.mp3" type="audio/mpeg"/>
  </item>
  <item>
    <title>Episode 1</title>
    <enclosure url="https://cdn.example.com/ep1.mp3?token=1" type="audio/mpeg"></enclosure>
    <itunes:duration>754</itunes:duration>
  </item>
</channel>
</rss>"#;

    #[test]
    fn a_feed_is_read() {
        let f = parse_feed(FEED).unwrap();
        assert_eq!(f.title, "Tom & Jerry Show");
        assert_eq!(f.image.as_deref(), Some("https://cdn.example.com/itunes.jpg"));
        assert_eq!(f.episodes.len(), 2, "items without audio or with a private address are left out");
        assert_eq!(
            f.episodes[0],
            Episode {
                id: "ep-2".into(),
                title: "Episode 2: ©ool".into(),
                url: "https://cdn.example.com/ep2.mp3".into(),
                published: Some("Mon, 02 Jan 2026 10:00:00 +0000".into()),
                duration: Some(3723.0),
                size: Some(12345),
            }
        );
        assert_eq!(f.episodes[1].id, "https://cdn.example.com/ep1.mp3?token=1", "without a guid the file's address identifies it");
        assert_eq!(f.episodes[1].duration, Some(754.0));
    }

    #[test]
    fn the_channel_image_is_used_when_there_is_no_itunes_one() {
        let f = parse_feed("<rss><channel><title>T</title><image><url>https://a.example.com/c.png</url></image></channel></rss>").unwrap();
        assert_eq!(f.image.as_deref(), Some("https://a.example.com/c.png"));
        assert!(f.episodes.is_empty());
    }

    #[test]
    fn things_that_are_not_feeds_are_refused() {
        assert!(parse_feed("").is_err());
        assert!(parse_feed("<html><body>hi</body></html>").is_err());
        assert!(parse_feed("<rss><channel><title>broken").is_err());
        assert!(parse_feed("not xml at all").is_err());
    }

    #[test]
    fn a_huge_feed_keeps_only_so_many_episodes() {
        let mut xml = String::from("<rss><channel><title>T</title>");
        for i in 0..(MAX_EPISODES + 50) {
            xml.push_str(&format!("<item><title>e{i}</title><enclosure url=\"https://a.example.com/{i}.mp3\"/></item>"));
        }
        xml.push_str("</channel></rss>");
        assert_eq!(parse_feed(&xml).unwrap().episodes.len(), MAX_EPISODES);
    }

    #[test]
    fn durations() {
        assert_eq!(parse_duration("1:02:03"), Some(3723.0));
        assert_eq!(parse_duration("12:30"), Some(750.0));
        assert_eq!(parse_duration(" 754 "), Some(754.0));
        assert_eq!(parse_duration("abc"), None);
        assert_eq!(parse_duration("1:2:3:4"), None);
        assert_eq!(parse_duration("-5"), None);
        assert_eq!(parse_duration("0"), None);
        assert_eq!(parse_duration(""), None);
    }

    #[test]
    fn enclosure_attributes_are_unescaped_and_video_is_skipped() {
        let xml = r#"<rss><channel><item><guid>a</guid><enclosure url="https://example.com/a.mp3?x=1&amp;y=2" type="audio/mpeg"/></item><item><guid>b</guid><enclosure url="https://example.com/b.mp4" type="video/mp4"/></item><item><guid>a</guid><enclosure url="https://example.com/duplicate.mp3"/></item></channel></rss>"#;
        let feed = parse_feed(xml).unwrap();
        assert_eq!(feed.episodes.len(), 1);
        assert_eq!(feed.episodes[0].url, "https://example.com/a.mp3?x=1&y=2");
    }

    #[test]
    fn only_rss_channels_and_complete_xml_are_accepted() {
        for xml in ["<html><channel><title>X</title></channel></html>", "<rss><channel><title>X</title>", "<rss><channel></rss>"] {
            assert!(parse_feed(xml).is_err(), "{xml}");
        }
    }
}
