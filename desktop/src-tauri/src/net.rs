//! Network settings shared by every request Kaisu makes: validating the proxy a user typed in, and testing it.

use std::time::Duration;

use tauri::{AppHandle, State};
use url::Url;

use crate::engine::Engine;

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

/// Hides the password in every `scheme://user:password@host` address inside `text`, so error messages, logs and the
/// "show command" preview never carry one: `socks5://me:secret@host:1080` becomes `socks5://me:***@host:1080`.
pub fn redact_urls(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find("://") {
        let (head, tail) = rest.split_at(i + 3);
        out.push_str(head);
        let end = tail.find(|c: char| c.is_whitespace() || matches!(c, '/' | '?' | '#' | '\'' | '"' | '<' | '>' | ')')).unwrap_or(tail.len());
        let (authority, after) = tail.split_at(end);
        match authority.rfind('@') {
            Some(at) => {
                let (userinfo, host) = authority.split_at(at);
                match userinfo.split_once(':') {
                    Some((user, _)) => {
                        out.push_str(user);
                        out.push_str(":***");
                    }
                    None => out.push_str(userinfo),
                }
                out.push_str(host);
            }
            None => out.push_str(authority),
        }
        rest = after;
    }
    out.push_str(rest);
    redact_tokens(&out)
}

pub fn sensitive_custom_args(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    ["--add-headers", "--extractor-args", "--referer", "authorization", "cookie:", "token=", "password="].iter().any(|key| lower.contains(key))
}
/// Remember sensitive option payloads, not just credentials with recognizable names.
/// split_args also works before validation, so a rejected custom option cannot leak a
/// preceding credential through an error message. Whole payloads cover command previews;
/// individual extractor values cover yt-dlp's parsed debug dictionaries and error messages.
pub fn custom_secret_values(text: Option<&str>) -> Vec<String> {
    let args = text.and_then(|s| crate::custom_args::split_args(s).ok()).unwrap_or_default();
    let mut values = Vec::new();
    for (i, arg) in args.iter().enumerate() {
        let (option, inline) = arg.split_once('=').map(|(k, v)| (k, Some(v))).unwrap_or((arg, None));
        if !["--add-headers", "--extractor-args", "--referer"].contains(&option) { continue; }
        let Some(value) = inline.or_else(|| args.get(i + 1).map(String::as_str)) else { continue };
        values.push(value.to_string());
        if option == "--add-headers" {
            if let Some((_, payload)) = value.split_once(':') { values.push(payload.trim().to_string()); }
        } else if option == "--extractor-args" {
            for field in value.split(';') {
                if let Some((_, payload)) = field.split_once('=') {
                    for token in payload.split(',') {
                        values.push(token.to_string());
                        // PO tokens are printed both as CONTEXT+TOKEN and as TOKEN alone.
                        if let Some((_, token)) = token.split_once('+') { values.push(token.to_string()); }
                    }
                }
            }
        }
    }
    values.retain(|v| !v.is_empty());
    // Python repr/debug dictionaries and JSON diagnostics escape quotes and backslashes.
    for value in values.clone() {
        let escaped = value.replace('\\', "\\\\").replace('\n', "\\n").replace('\r', "\\r").replace('\t', "\\t");
        values.push(escaped.replace('\'', "\\'"));
        values.push(escaped.replace('"', "\\\""));
    }
    values.sort_by_key(|s| std::cmp::Reverse(s.len())); values.dedup(); values
}
pub fn redact_values(text: &str, values: &[String]) -> String {
    let mut safe = text.to_string();
    for value in values {
        // Avoid turning benign short extractor values (e.g. player_client=web) into
        // substring redactions of unrelated words such as webm.
        if value.len() >= 4 { safe = safe.replace(value, "[REDACTED]"); continue; }
        let mut out = String::new();
        let mut end = 0;
        for (at, _) in safe.match_indices(value) {
            let boundary = |c: char| !c.is_alphanumeric() && c != '_';
            if safe[..at].chars().next_back().is_none_or(boundary) && safe[at + value.len()..].chars().next().is_none_or(boundary) {
                out.push_str(&safe[end..at]); out.push_str("[REDACTED]"); end = at + value.len();
            }
        }
        out.push_str(&safe[end..]); safe = out;
    }
    redact_urls(&safe)
}
/// Names whose values are secret. Checked against `testdata/download-validation.json`, which the frontend reads too.
const SECRET_KEY_PARTS: [&str; 8] = ["token", "signature", "password", "credential", "secret", "apikey", "api_key", "api-key"];
const SECRET_KEY_EXACT: [&str; 12] = ["auth", "authorization", "authkey", "auth_key", "auth-key", "sig", "key", "hmac", "policy", "session", "sessionid", "session_id"];
fn secret_query_key(key: &str) -> bool {
    let decoded = url::form_urlencoded::parse(format!("{key}=").as_bytes()).next().map(|(k, _)| k.to_lowercase()).unwrap_or_default();
    SECRET_KEY_PARTS.iter().any(|k| decoded.contains(k)) || SECRET_KEY_EXACT.contains(&decoded.as_str())
}
fn redact_tokens(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(at) = rest.find(['?', '&']) {
        out.push_str(&rest[..=at]);
        rest = &rest[at + 1..];
        let end = rest.find(|c: char| c.is_whitespace() || matches!(c, '&' | '#' | '"' | '\'' | '<' | '>')).unwrap_or(rest.len());
        let part = &rest[..end];
        if let Some((key, _)) = part.split_once('=').filter(|(key, _)| secret_query_key(key)) { out.push_str(key); out.push_str("=[REDACTED]"); }
        else { out.push_str(part); }
        rest = &rest[end..];
    }
    out.push_str(rest);
    out.lines().map(|line| {
        let lower = line.to_ascii_lowercase();
        let at = ["authorization:", "authorization=", "proxy-authorization:", "cookie:", "cookie=", "set-cookie:", "x-api-key:", "x-api-key="]
            .iter().filter_map(|key| lower.find(key).map(|i| i + key.len())).min();
        at.map(|at| format!("{} [REDACTED]", &line[..at])).unwrap_or_else(|| line.into())
    }).collect::<Vec<_>>().join("\n")
}

/// Tries the proxy with a real, tiny yt-dlp request, so "works" means "works for downloading".
#[tauri::command]
pub async fn test_proxy(app: AppHandle, engine: State<'_, Engine>, proxy: String) -> Result<String, String> {
    let proxy = validate_proxy(&proxy)?;
    let ytdlp = engine.ytdlp_path(&app).await?;
    let args = ["--flat-playlist", "--dump-single-json", "--no-warnings", "--", "ytsearch1:kaisu"];
    crate::ytdlp::run_capture(&ytdlp, &args, Duration::from_secs(45), Some(&proxy))
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
    fn sensitive_argument_payloads_are_redacted_in_commands_and_parsed_diagnostics() {
        let cases: serde_json::Value = serde_json::from_str(include_str!("../../testdata/custom-argument-redaction.json")).unwrap();
        for fixture in cases.as_array().unwrap() {
            let values = custom_secret_values(fixture["args"].as_str());
            let diagnostic = redact_values(fixture["text"].as_str().unwrap(), &values);
            let command = redact_values(fixture["args"].as_str().unwrap(), &values);
            for secret in fixture["secrets"].as_array().unwrap() {
                let secret = secret.as_str().unwrap();
                assert!(!diagnostic.contains(secret), "{diagnostic}");
                assert!(!command.contains(secret), "{command}");
            }
            for public in fixture["keep"].as_array().unwrap() { assert!(diagnostic.contains(public.as_str().unwrap()), "{diagnostic}"); }
        }
    }

    #[test]
    fn secret_key_lists_match_the_shared_cases() {
        let cases: serde_json::Value = serde_json::from_str(include_str!("../../testdata/download-validation.json")).unwrap();
        let keys = &cases["secretKeys"];
        let list = |v: &serde_json::Value| v.as_array().unwrap().iter().map(|k| k.as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(list(&keys["parts"]), SECRET_KEY_PARTS);
        assert_eq!(list(&keys["exact"]), SECRET_KEY_EXACT);
        for key in list(&keys["redact"]) { let safe = redact_urls(&format!("https://x/a?v=1&{key}=private")); assert!(safe.contains("[REDACTED]") && !safe.contains("private") && safe.contains("v=1"), "{key}: {safe}"); }
        for key in list(&keys["keep"]) { assert!(redact_urls(&format!("https://x/a?{key}=public")).contains(&format!("{key}=public")), "{key}"); }
    }

    #[test]
    fn redacts_headers_signed_queries_and_contextual_custom_header_values() {
        let text = "URL https://cdn.example/a?v=public&%74oken=private&X-Amz-Signature=signature-secret\nAuthorization: Bearer private-header\nCookie: sid=private-cookie";
        let safe = redact_urls(text);
        for secret in ["private", "signature-secret", "private-header", "private-cookie"] { assert!(!safe.contains(secret), "{safe}"); }
        assert!(safe.contains("v=public"));
        let values = custom_secret_values(Some("--add-headers='X-Custom: arbitrary-secret'"));
        assert!(values.contains(&"arbitrary-secret".to_string()));
        assert_eq!(redact_values("header value arbitrary-secret", &values), "header value [REDACTED]");
    }

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
    fn passwords_in_addresses_are_hidden() {
        assert_eq!(redact_urls("socks5://me:secret@host:1080"), "socks5://me:***@host:1080");
        assert_eq!(redact_urls("http://me@host:3128"), "http://me@host:3128", "a user name alone is not a secret");
        assert_eq!(redact_urls("http://host:8080"), "http://host:8080");
        assert_eq!(redact_urls("socks5h://u:p%40ss@h:1 and https://a:b@c/d?x=1"), "socks5h://u:***@h:1 and https://a:***@c/d?x=1");
        assert_eq!(
            redact_urls("ERROR: Unable to connect to proxy 'http://me:secret@10.0.0.1:8080' (timed out)\nsecond: https://x.y/z"),
            "ERROR: Unable to connect to proxy 'http://me:***@10.0.0.1:8080' (timed out)\nsecond: https://x.y/z"
        );
        assert_eq!(redact_urls("no addresses here, just a@b: c"), "no addresses here, just a@b: c");
        assert_eq!(redact_urls("trailing ://"), "trailing ://");
        assert!(!redact_urls("http://u:hunter2@h").contains("hunter2"));
    }

    #[test]
    fn blank_means_no_proxy() {
        assert_eq!(proxy_option(None).unwrap(), None);
        assert_eq!(proxy_option(Some("  ")).unwrap(), None);
        assert_eq!(proxy_option(Some("h:1")).unwrap(), Some("http://h:1".into()));
        assert!(proxy_option(Some("ftp://h")).is_err());
    }
}
