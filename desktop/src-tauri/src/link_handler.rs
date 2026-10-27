//! `kaisu://add?url=...` links, sent by the browser extension or any page. A link only offers addresses to the
//! window; nothing is looked up, queued or downloaded until the user chooses to, so a web page cannot start a download.
use std::sync::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

const SCHEME: &str = "kaisu";
const MAX_LINKS: usize = 50;
const MAX_LINK_LENGTH: usize = 4096;
const MAX_PENDING: usize = 200;

/// Links that arrived before the window finished loading (a cold start from the browser).
#[derive(Default)]
pub struct Incoming(Mutex<Vec<String>>);

#[derive(Serialize, Debug, PartialEq)]
pub struct HandlerStatus { pub registered: bool, pub supported: bool }

/// The http(s) addresses in a `kaisu://add` link, de-duplicated. Anything else yields nothing.
pub fn parse(raw: &str) -> Vec<String> {
    let Ok(link) = Url::parse(raw.trim()) else { return Vec::new() };
    if link.scheme() != SCHEME || link.host_str() != Some("add") { return Vec::new(); }
    let mut found: Vec<String> = Vec::new();
    for (key, value) in link.query_pairs() {
        if key != "url" || value.len() > MAX_LINK_LENGTH { continue; }
        let Ok(target) = Url::parse(value.trim()) else { continue };
        if !matches!(target.scheme(), "http" | "https") || target.host_str().is_none() || !target.username().is_empty() || target.password().is_some() { continue; }
        let target = target.to_string();
        if !found.contains(&target) { found.push(target); }
        if found.len() == MAX_LINKS { break; }
    }
    found
}

fn deliver(app: &AppHandle, urls: &[tauri::Url]) {
    let links: Vec<String> = urls.iter().flat_map(|u| parse(u.as_str())).collect();
    if links.is_empty() { return; }
    {
        let incoming = app.state::<Incoming>();
        let mut pending = incoming.0.lock().unwrap_or_else(|e| e.into_inner());
        pending.extend(links.iter().cloned());
        pending.dedup();
        let excess = pending.len().saturating_sub(MAX_PENDING);
        pending.drain(..excess);
    }
    crate::tray::show_main(app);
    let _ = app.emit("kaisu-links", ());
}

/// Listens for links that reach a running app, and for the one that launched it.
pub fn init(app: &AppHandle) {
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| deliver(&handle, &event.urls()));
    if let Ok(Some(urls)) = app.deep_link().get_current() { deliver(app, &urls); }
}

/// Hands over (and forgets) the links waiting for the window.
#[tauri::command]
pub fn take_incoming_links(incoming: State<'_, Incoming>) -> Vec<String> {
    std::mem::take(&mut *incoming.0.lock().unwrap_or_else(|e| e.into_inner()))
}

#[cfg(any(windows, target_os = "linux"))]
#[tauri::command]
pub fn link_handler_status(app: AppHandle) -> HandlerStatus {
    HandlerStatus { registered: app.deep_link().is_registered(SCHEME).unwrap_or(false), supported: true }
}
#[cfg(not(any(windows, target_os = "linux")))]
#[tauri::command]
pub fn link_handler_status(_app: AppHandle) -> HandlerStatus { HandlerStatus { registered: false, supported: false } }

/// Registering is an explicit choice: it writes a per-user association (Windows registry, a Linux desktop entry) that
/// points at this executable.
#[cfg(any(windows, target_os = "linux"))]
#[tauri::command]
pub fn link_handler_set(app: AppHandle, enabled: bool) -> Result<HandlerStatus, String> {
    let links = app.deep_link();
    if enabled { links.register(SCHEME) } else { links.unregister(SCHEME) }.map_err(|e| format!("Couldn't change the browser link setting: {e}"))?;
    Ok(link_handler_status(app))
}
#[cfg(not(any(windows, target_os = "linux")))]
#[tauri::command]
pub fn link_handler_set(_app: AppHandle, _enabled: bool) -> Result<HandlerStatus, String> {
    Err("Browser links aren't supported on this system.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_addresses_in_add_links_are_accepted() {
        assert_eq!(parse("kaisu://add?url=https%3A%2F%2Fyoutu.be%2Fabc"), ["https://youtu.be/abc"]);
        assert_eq!(parse("kaisu://add?url=https://a.example/x&url=http://b.example/&url=https://a.example/x"), ["https://a.example/x", "http://b.example/"]);
        for bad in [
            "kaisu://add?url=file%3A%2F%2F%2Fetc%2Fpasswd", "kaisu://add?url=javascript%3Aalert(1)", "kaisu://add?url=ftp://x.example/a",
            "kaisu://run?url=https://a.example/", "https://a.example/?url=https://b.example/", "kaisu://add", "kaisu://add?url=",
            "kaisu://add?url=https://user:pw@a.example/", "kaisu://add?other=https://a.example/", "not a url",
        ] { assert!(parse(bad).is_empty(), "{bad}"); }
    }

    #[test]
    fn the_number_and_size_of_links_are_bounded() {
        let many: String = (0..80).map(|i| format!("&url=https://a.example/{i}")).collect();
        assert_eq!(parse(&format!("kaisu://add?x=1{many}")).len(), MAX_LINKS);
        assert!(parse(&format!("kaisu://add?url=https://a.example/{}", "a".repeat(MAX_LINK_LENGTH))).is_empty());
    }
}
