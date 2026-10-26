//! User-initiated metadata suggestions. No audio or local paths are sent to a service.
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use crate::{artwork::{ArtworkChoice, ArtworkStore}, scope::Scope};

const AGENT: &str = concat!("Kaisu/", env!("CARGO_PKG_VERSION"), " (+https://github.com/mirimomekiku/kaisu)");
#[derive(Default)]
pub struct Identification(tokio::sync::Mutex<Option<Instant>>);

#[derive(Serialize)]
pub struct ReleaseChoice { pub id: String, pub title: String, pub date: String, pub country: String, pub edition: String }
#[derive(Serialize)]
pub struct Candidate { pub id: String, pub title: String, pub artist: String, pub duration: Option<f64>, pub score: u64, pub releases: Vec<ReleaseChoice> }
#[derive(Serialize, Deserialize, Default, Debug)]
pub struct SuggestedTags {
    pub title: String, pub artist: String, pub album: Option<String>, pub album_artist: Option<String>,
    pub track: Option<String>, pub disc: Option<String>, pub year: Option<String>, pub genre: Option<String>,
}

fn text(v: &Value) -> String { v.as_str().unwrap_or_default().chars().filter(|c| !c.is_control()).take(200).collect::<String>().trim().to_string() }
fn credit(v: &Value) -> String {
    text(&Value::String(v.as_array().map(|a| a.iter().map(|c| {
        format!("{}{}", c["name"].as_str().or_else(|| c["artist"]["name"].as_str()).unwrap_or_default(), c["joinphrase"].as_str().unwrap_or_default())
    }).collect::<String>()).unwrap_or_default()))
}
fn mbid(id: &str) -> Result<(), String> { uuid::Uuid::parse_str(id).map(|_| ()).map_err(|_| "Invalid music database identifier.".into()) }
fn consent(allowed: bool) -> Result<(), String> { if allowed { Ok(()) } else { Err("Allow the online lookup before searching MusicBrainz.".into()) } }
fn quoted(value: &str) -> String { value.replace('\\', "\\\\").replace('"', "\\\"") }
fn query(title: &str, artist: &str) -> Result<String, String> {
    let (title, artist) = (title.trim(), artist.trim());
    if title.is_empty() || title.chars().count() > 200 || artist.chars().count() > 200 || title.chars().chain(artist.chars()).any(char::is_control) {
        return Err("Enter a song title and optional artist, up to 200 characters each.".into());
    }
    Ok(format!("recording:\"{}\"{}", quoted(title), if artist.is_empty() { String::new() } else { format!(" AND artist:\"{}\"", quoted(artist)) }))
}

async fn bytes(mut response: reqwest::Response, maximum: usize) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            404 => "No information or cover artwork was found for this release.".into(),
            429 | 503 => "The music database is busy. Wait a moment before trying again.".into(),
            _ => format!("The music service answered {}.", response.status()),
        });
    }
    let mut output = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "The music service response was interrupted.")? {
        if output.len().saturating_add(chunk.len()) > maximum { return Err("The music service response was too large.".into()); }
        output.extend_from_slice(&chunk);
    }
    Ok(output)
}
impl Identification {
    async fn get(&self, endpoint: &str, parameters: &[(&str, &str)], proxy: Option<&str>) -> Result<Value, String> {
        let mut last = self.0.lock().await;
        if let Some(last) = *last { tokio::time::sleep(Duration::from_millis(1100).saturating_sub(last.elapsed())).await; }
        *last = Some(Instant::now());
        let client = crate::setup::client(proxy)?;
        let mut url = url::Url::parse(&format!("https://musicbrainz.org/ws/2/{endpoint}")).map_err(|e| e.to_string())?;
        url.query_pairs_mut().extend_pairs(parameters.iter().copied());
        let response = client.get(url)
            .header(reqwest::header::USER_AGENT, AGENT).timeout(Duration::from_secs(25))
            .send().await.map_err(|_| "Couldn't reach MusicBrainz. Check your connection or proxy.")?;
        serde_json::from_slice(&bytes(response, 4 * 1024 * 1024).await?).map_err(|_| "MusicBrainz returned unreadable information.".into())
    }
}
fn candidates(value: &Value) -> Vec<Candidate> {
    value["recordings"].as_array().into_iter().flatten().take(12).filter_map(|r| {
        let id = r["id"].as_str()?; mbid(id).ok()?;
        let title = text(&r["title"]); if title.is_empty() { return None; }
        Some(Candidate { id: id.into(), title, artist: credit(&r["artist-credit"]), duration: r["length"].as_u64().map(|n| n as f64 / 1000.0),
            score: r["score"].as_u64().or_else(|| r["score"].as_str().and_then(|s| s.parse().ok())).unwrap_or(0).min(100),
            releases: r["releases"].as_array().into_iter().flatten().take(8).filter_map(|release| {
                let id = release["id"].as_str()?; mbid(id).ok()?;
                Some(ReleaseChoice { id: id.into(), title: text(&release["title"]), date: text(&release["date"]), country: text(&release["country"]), edition: text(&release["disambiguation"]) })
            }).collect(),
        })
    }).collect()
}
fn suggestion(recording: &Value, release: Option<&Value>, recording_id: &str) -> Result<SuggestedTags, String> {
    let mut tags = SuggestedTags { title: text(&recording["title"]), artist: credit(&recording["artist-credit"]), ..Default::default() };
    let genres = recording["genres"].as_array().and_then(|a| a.iter().max_by_key(|g| g["count"].as_u64().unwrap_or(0)));
    tags.genre = genres.map(|g| text(&g["name"])).filter(|s| !s.is_empty());
    if let Some(release) = release {
        let (medium, track) = release["media"].as_array().into_iter().flatten().find_map(|m| {
            m["tracks"].as_array()?.iter().find(|t| t["recording"]["id"].as_str() == Some(recording_id)).map(|t| (m, t))
        }).ok_or("This recording isn't on the selected release. Choose another edition.")?;
        tags.album = Some(text(&release["title"])).filter(|s| !s.is_empty());
        tags.album_artist = Some(credit(&release["artist-credit"])).filter(|s| !s.is_empty());
        tags.track = track["position"].as_u64().filter(|n| (1..=999).contains(n)).map(|n| n.to_string());
        tags.disc = medium["position"].as_u64().filter(|n| (1..=99).contains(n)).map(|n| n.to_string());
        tags.year = release["date"].as_str().and_then(|d| d.get(..4)).filter(|s| s.parse::<u16>().is_ok_and(|n| (1000..=2999).contains(&n))).map(str::to_string);
        let title = text(&track["title"]); if !title.is_empty() { tags.title = title; }
        let artist = credit(&track["artist-credit"]); if !artist.is_empty() { tags.artist = artist; }
    }
    Ok(tags)
}

#[tauri::command]
pub async fn identify_search(scope: State<'_, Scope>, service: State<'_, Identification>, path: String, title: String, artist: String, allowed: bool, proxy: Option<String>) -> Result<Vec<Candidate>, String> {
    consent(allowed)?; scope.media_file(&path)?;
    let query = query(&title, &artist)?; let proxy = crate::net::proxy_option(proxy.as_deref())?;
    Ok(candidates(&service.get("recording", &[("query", &query), ("fmt", "json"), ("limit", "12")], proxy.as_deref()).await?))
}
#[tauri::command]
pub async fn identify_details(scope: State<'_, Scope>, service: State<'_, Identification>, path: String, recording_id: String, release_id: Option<String>, allowed: bool, proxy: Option<String>) -> Result<SuggestedTags, String> {
    consent(allowed)?; scope.media_file(&path)?; mbid(&recording_id)?;
    if let Some(id) = &release_id { mbid(id)?; }
    let proxy = crate::net::proxy_option(proxy.as_deref())?;
    let recording = service.get(&format!("recording/{recording_id}"), &[("fmt", "json"), ("inc", "artist-credits+genres")], proxy.as_deref()).await?;
    let release = match release_id { Some(id) => Some(service.get(&format!("release/{id}"), &[("fmt", "json"), ("inc", "recordings+artist-credits")], proxy.as_deref()).await?), None => None };
    suggestion(&recording, release.as_ref(), &recording_id)
}
#[tauri::command]
pub async fn identify_cover(scope: State<'_, Scope>, store: State<'_, ArtworkStore>, path: String, release_id: String, allowed: bool, proxy: Option<String>) -> Result<ArtworkChoice, String> {
    consent(allowed)?; scope.media_file(&path)?; mbid(&release_id)?;
    let proxy = crate::net::proxy_option(proxy.as_deref())?;
    let response = crate::thumbs::build_client(proxy.as_deref())?.get(format!("https://coverartarchive.org/release/{release_id}/front-500"))
        .header(reqwest::header::USER_AGENT, AGENT).timeout(Duration::from_secs(25)).send().await.map_err(|_| "Couldn't load artwork from the Cover Art Archive.")?;
    store.insert(bytes(response, 8 * 1024 * 1024).await?, "Cover Art Archive front cover".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn queries_are_bounded_literal_fields_and_consent_is_required() {
        assert_eq!(query("A \"song\"", "A\\B").unwrap(), "recording:\"A \\\"song\\\"\" AND artist:\"A\\\\B\"");
        assert!(query("", "artist").is_err()); assert!(query(&"x".repeat(201), "").is_err()); assert!(consent(false).is_err());
        assert!(mbid("../bad").is_err());
    }
    #[test]
    fn release_suggestions_use_the_matching_track_not_the_first_track() {
        let recording = serde_json::json!({"title":"Original", "artist-credit":[{"name":"Singer", "joinphrase":" & "},{"artist":{"name":"Guest"}}]});
        let release = serde_json::json!({"title":"Album", "date":"2001-04-02", "artist-credit":[{"name":"Album artist"}], "media":[{"position":2,"tracks":[{"position":1,"title":"Other","recording":{"id":"other"}},{"position":4,"title":"Selected","recording":{"id":"match"}}]}]});
        let result = suggestion(&recording, Some(&release), "match").unwrap();
        assert_eq!(result.title, "Selected"); assert_eq!(result.artist, "Singer & Guest"); assert_eq!(result.track.as_deref(), Some("4"));
        assert_eq!(result.disc.as_deref(), Some("2")); assert_eq!(result.year.as_deref(), Some("2001"));
        assert!(suggestion(&recording, Some(&release), "missing").is_err());
    }
}
