//! Thumbnails. The webview is not allowed to load pictures from the internet itself (its content policy permits only
//! the app's own files and in-memory pictures), so it asks for them here. That way they travel through the proxy the user
//! chose, nothing is contacted until Kaisu decides to, and the answer is checked to really be a picture.
//!
//! Only public internet addresses are fetched: a link that points at this computer or at a device on the local network
//! (by name, by number, or through a redirect) is refused, so a page can't use thumbnails to probe the network.

use std::{
    net::{IpAddr, SocketAddr, ToSocketAddrs},
    sync::Mutex,
    time::Duration,
};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use tauri::{State, ipc::Response};
use url::{Host, Url};

const MAX_BYTES: usize = 5 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;
const MAX_URL_CHARS: usize = 2048;

/// Names that only mean something inside a private network.
const PRIVATE_SUFFIXES: &[&str] = &[".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".home.arpa"];

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            let shared = o[0] == 100 && (o[1] & 0b1100_0000) == 64; // 100.64.0.0/10, carrier-grade NAT
            !(v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_unspecified() || v4.is_broadcast() || v4.is_multicast() || v4.is_documentation() || shared || o[0] == 0)
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(v4));
            }
            let first = v6.segments()[0];
            let unique_local = (first & 0xfe00) == 0xfc00;
            let link_local = (first & 0xffc0) == 0xfe80;
            !(v6.is_loopback() || v6.is_unspecified() || v6.is_multicast() || unique_local || link_local)
        }
    }
}

/// A link Kaisu may fetch a picture from: http(s), a sane length, and a public host.
fn check_url(url: &Url) -> Result<(), String> {
    const NO: &str = "That picture can't be loaded.";
    if !matches!(url.scheme(), "http" | "https") || url.as_str().len() > MAX_URL_CHARS || !url.username().is_empty() || url.password().is_some() {
        return Err(NO.into());
    }
    match url.host() {
        Some(Host::Ipv4(ip)) if is_public_ip(IpAddr::V4(ip)) => Ok(()),
        Some(Host::Ipv6(ip)) if is_public_ip(IpAddr::V6(ip)) => Ok(()),
        Some(Host::Domain(name)) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            // A name without a dot is a machine on the local network ("printer", "nas").
            if !name.contains('.') || name == "localhost" || PRIVATE_SUFFIXES.iter().any(|s| name.ends_with(s)) { Err(NO.into()) } else { Ok(()) }
        }
        _ => Err(NO.into()),
    }
}

/// Looks names up like the system does, but only hands back public addresses. Used for the connection itself, so a name
/// that is public when checked and private when connected (or after a redirect) is still refused.
struct PublicOnly;

impl Resolve for PublicOnly {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let found = tauri::async_runtime::spawn_blocking(move || (host.as_str(), 0).to_socket_addrs().map(|found| found.collect::<Vec<SocketAddr>>())).await??;
            let public: Vec<SocketAddr> = found.into_iter().filter(|a| is_public_ip(a.ip())).collect();
            if public.is_empty() {
                return Err("not a public address".into());
            }
            Ok(Box::new(public.into_iter()) as Addrs)
        })
    }
}

fn build_client(proxy: Option<&str>) -> Result<reqwest::Client, String> {
    let redirects = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS || check_url(attempt.url()).is_err() { attempt.stop() } else { attempt.follow() }
    });
    let mut builder = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; Kaisu)")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .redirect(redirects)
        .dns_resolver(PublicOnly);
    if let Some(p) = proxy {
        builder = builder.proxy(reqwest::Proxy::all(p).map_err(|e| format!("Proxy: {e}"))?);
    }
    builder.build().map_err(|e| format!("HTTP client error: {e}"))
}

/// The picture formats browsers show that Kaisu accepts, recognised by their first bytes (never by what the server says).
pub(crate) fn looks_like_image(b: &[u8]) -> bool {
    b.starts_with(&[0xFF, 0xD8, 0xFF])
        || b.starts_with(b"\x89PNG\r\n\x1a\n")
        || b.starts_with(b"GIF87a")
        || b.starts_with(b"GIF89a")
        || (b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP")
        || (b.len() >= 12 && &b[4..8] == b"ftyp" && (&b[8..12] == b"avif" || &b[8..12] == b"avis"))
}

#[derive(Default)]
pub struct Thumbs {
    /// The client for the proxy it was made for, so a page full of pictures doesn't build one client per picture.
    client: Mutex<Option<(Option<String>, reqwest::Client)>>,
}

impl Thumbs {
    fn client(&self, proxy: Option<&str>) -> Result<reqwest::Client, String> {
        let mut slot = self.client.lock().map_err(|_| "Pictures are unavailable.".to_string())?;
        if let Some((made_for, client)) = slot.as_ref()
            && made_for.as_deref() == proxy
        {
            return Ok(client.clone());
        }
        let client = build_client(proxy)?;
        *slot = Some((proxy.map(str::to_string), client.clone()));
        Ok(client)
    }
}

/// The bytes of a thumbnail, fetched through the proxy (if any) and checked to be a small picture.
#[tauri::command]
pub async fn fetch_thumbnail(thumbs: State<'_, Thumbs>, url: String, proxy: Option<String>) -> Result<Response, String> {
    let url = Url::parse(url.trim()).map_err(|_| "That picture can't be loaded.".to_string())?;
    check_url(&url)?;
    let proxy = crate::net::proxy_option(proxy.as_deref())?;
    let client = thumbs.client(proxy.as_deref())?;

    let mut res = client.get(url).header(reqwest::header::ACCEPT, "image/*").send().await.map_err(|_| "The picture didn't load.".to_string())?;
    if !res.status().is_success() {
        return Err("The picture didn't load.".into());
    }
    if res.content_length().is_some_and(|n| n > MAX_BYTES as u64) {
        return Err("That picture is too large.".into());
    }
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|_| "The picture didn't load.".to_string())? {
        if body.len() + chunk.len() > MAX_BYTES {
            return Err("That picture is too large.".into());
        }
        body.extend_from_slice(&chunk);
    }
    if !looks_like_image(&body) {
        return Err("That isn't a picture.".into());
    }
    Ok(Response::new(body))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(url: &str) -> bool {
        check_url(&Url::parse(url).unwrap()).is_ok()
    }

    #[test]
    fn public_sites_are_fine() {
        assert!(ok("https://i.ytimg.com/vi/abc/mqdefault.jpg"));
        assert!(ok("http://cdn.example.org/a.png"));
        assert!(ok("https://8.8.8.8/x.jpg"));
        assert!(ok("https://[2001:4860:4860::8888]/x.jpg"));
        assert!(ok("https://I.YTIMG.COM./x.jpg"), "a trailing dot and capitals don't matter");
    }

    #[test]
    fn this_computer_and_the_local_network_are_refused() {
        for bad in [
            "http://localhost/x.png",
            "http://LOCALHOST:8080/x.png",
            "http://app.localhost/x.png",
            "http://127.0.0.1/x.png",
            "http://127.1/x.png",
            "http://2130706433/x.png",
            "http://0x7f.0.0.1/x.png",
            "http://10.1.2.3/x.png",
            "http://172.16.0.1/x.png",
            "http://192.168.1.1/x.png",
            "http://169.254.169.254/latest/meta-data/",
            "http://100.64.0.1/x.png",
            "http://0.0.0.0/x.png",
            "http://[::1]/x.png",
            "http://[::ffff:192.168.0.1]/x.png",
            "http://[fd00::1]/x.png",
            "http://[fe80::1]/x.png",
            "http://printer/x.png",
            "http://nas.local/x.png",
            "http://router.lan/x.png",
            "http://wiki.corp/x.png",
        ] {
            assert!(!ok(bad), "{bad} must be refused");
        }
    }

    #[test]
    fn only_plain_web_links_without_logins_are_fetched() {
        for bad in ["file:///etc/passwd", "ftp://example.com/a.png", "data:image/png;base64,AAAA", "https://user:pw@example.com/a.png"] {
            assert!(!ok(bad), "{bad}");
        }
        assert!(!ok(&format!("https://example.com/{}", "a".repeat(3000))));
    }

    #[test]
    fn pictures_are_recognised_by_their_bytes() {
        assert!(looks_like_image(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]));
        assert!(looks_like_image(b"\x89PNG\r\n\x1a\nrest"));
        assert!(looks_like_image(b"GIF89a...."));
        assert!(looks_like_image(b"RIFF\x24\0\0\0WEBPVP8 "));
        assert!(looks_like_image(b"\0\0\0\x1cftypavif\0\0\0\0"));
        assert!(!looks_like_image(b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), "scripts can hide in SVG");
        assert!(!looks_like_image(b"<!doctype html><html>"));
        assert!(!looks_like_image(b"MZ\x90\0"));
        assert!(!looks_like_image(b""));
        assert!(!looks_like_image(b"RIFF\x24\0\0\0WAVEfmt "));
    }

    #[test]
    fn the_client_is_reused_for_the_same_proxy() {
        let thumbs = Thumbs::default();
        assert!(thumbs.client(None).is_ok());
        assert!(thumbs.client(None).is_ok());
        assert!(thumbs.client(Some("http://127.0.0.1:8080")).is_ok());
        assert_eq!(thumbs.client.lock().unwrap().as_ref().unwrap().0.as_deref(), Some("http://127.0.0.1:8080"));
    }
}
