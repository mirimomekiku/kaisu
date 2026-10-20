//! Network settings shared by every request Kaisu makes: validating the proxy a user typed in, and testing it.

use std::time::Duration;

use tauri::{AppHandle, State};
use url::Url;

use crate::{engine::Engine, proc};

const MAX_PROXY_CHARS: usize = 300;
const SCHEMES: &[&str] = &["http", "https", "socks4", "socks4a", "socks5", "socks5h"];

/// Checks a proxy address and returns it normalised. Credentials may be included (`socks5://user:pass@host:1080`).
pub fn validate_proxy(proxy: &str) -> Result<String, String> {
    let p = proxy.trim();
    let bad = |why: &str| Err(format!("Proxy: {why}"));
    if p.is_empty() {
        return bad("it's empty.");
    }
    if p.chars().count() > MAX_PROXY_CHARS || p.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return bad("it can't contain spaces or be that long.");
    }
    // A bare "host:port" is the most common way to type one; assume plain HTTP, as yt-dlp does.
    let with_scheme = if p.contains("://") { p.to_string() } else { format!("http://{p}") };
    let url = Url::parse(&with_scheme).map_err(|_| "Proxy: that isn't a valid address, like http://host:8080 or socks5://host:1080.".to_string())?;
    if !SCHEMES.contains(&url.scheme()) {
        return bad("use http://, https://, socks4://, socks5:// (or socks5h://).");
    }
    if url.host_str().is_none_or(str::is_empty) {
        return bad("it needs a host name.");
    }
    if !(url.path().is_empty() || url.path() == "/") || url.query().is_some() || url.fragment().is_some() {
        return bad("it should be just the address, like http://host:8080.");
    }
    Ok(with_scheme)
}

/// `None` or blank means "no proxy". Anything else must be valid.
pub fn proxy_option(proxy: Option<&str>) -> Result<Option<String>, String> {
    match proxy.map(str::trim) {
        None | Some("") => Ok(None),
        Some(p) => validate_proxy(p).map(Some),
    }
}

/// Tries the proxy with a real, tiny yt-dlp request, so "works" means "works for downloading".
#[tauri::command]
pub async fn test_proxy(app: AppHandle, engine: State<'_, Engine>, proxy: String) -> Result<String, String> {
    let proxy = validate_proxy(&proxy)?;
    let ytdlp = engine.ytdlp_path(&app).await?;
    let args = ["--proxy", proxy.as_str(), "--flat-playlist", "--dump-single-json", "--no-warnings", "--", "ytsearch1:kaisu"];
    proc::run_capture(&ytdlp, &args, Duration::from_secs(45))
        .await
        .map(|_| "The proxy works: Kaisu reached YouTube through it.".to_string())
        .map_err(|e| {
            let hint = if e.contains("Timed out") { "It didn't answer in time." } else { "It refused the connection or isn't reachable." };
            format!("{hint} ({})", e.lines().last().unwrap_or("no details").trim())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_common_forms() {
        assert_eq!(validate_proxy("http://proxy.local:8080").unwrap(), "http://proxy.local:8080");
        assert_eq!(validate_proxy("  proxy.local:3128 ").unwrap(), "http://proxy.local:3128");
        assert_eq!(validate_proxy("socks5://127.0.0.1:9050").unwrap(), "socks5://127.0.0.1:9050");
        assert_eq!(validate_proxy("socks5h://user:p%40ss@host:1080").unwrap(), "socks5h://user:p%40ss@host:1080");
        assert!(validate_proxy("https://secure.proxy").is_ok());
        assert!(validate_proxy("socks4a://h:1").is_ok());
    }

    #[test]
    fn rejects_junk_and_dangerous_schemes() {
        for bad in ["", "   ", "ftp://h:1", "file:///etc/passwd", "javascript:alert(1)", "http://", "http:// host", "http://h:99999", "http://h:1/path", "http://h:1?x=1", "-o /tmp/x", "http://h:1 --exec x"] {
            assert!(validate_proxy(bad).is_err(), "{bad:?} should be rejected");
        }
        assert!(validate_proxy(&format!("http://{}", "a".repeat(400))).is_err());
    }

    #[test]
    fn blank_means_no_proxy() {
        assert_eq!(proxy_option(None).unwrap(), None);
        assert_eq!(proxy_option(Some("  ")).unwrap(), None);
        assert_eq!(proxy_option(Some("h:1")).unwrap(), Some("http://h:1".into()));
        assert!(proxy_option(Some("ftp://h")).is_err());
    }
}
