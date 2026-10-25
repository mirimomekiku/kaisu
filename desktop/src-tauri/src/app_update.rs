//! Tells the user when a newer Kaisu release exists. It only reads the public `/releases/latest` redirect and never
//! downloads or installs anything; the link it offers is a fixed page, not text taken from the network.

use serde::Serialize;

const RELEASES: &str = "https://github.com/mirimomekiku/kaisu/releases";

#[derive(Serialize, Debug, PartialEq)]
pub struct AppUpdate {
    pub current: String,
    /// The newest release's version, if the repository has one.
    pub latest: Option<String>,
    pub newer: bool,
    pub url: &'static str,
}

/// `v1.2.3` -> `[1, 2, 3]`. Anything with a suffix (`-beta`) or another shape is not a release Kaisu announces.
fn parse_version(tag: &str) -> Option<Vec<u64>> {
    let parts: Vec<u64> = tag.trim().trim_start_matches('v').split('.').map(|p| if !p.is_empty() && p.len() <= 6 && p.bytes().all(|b| b.is_ascii_digit()) { p.parse().ok() } else { None }).collect::<Option<_>>()?;
    (!parts.is_empty() && parts.len() <= 4).then_some(parts)
}

fn is_newer(latest: &[u64], current: &[u64]) -> bool {
    let len = latest.len().max(current.len());
    for i in 0..len {
        let (l, c) = (latest.get(i).copied().unwrap_or(0), current.get(i).copied().unwrap_or(0));
        if l != c { return l > c; }
    }
    false
}

fn compare(current: &str, segment: &str) -> AppUpdate {
    let latest = parse_version(segment);
    let newer = match (&latest, parse_version(current)) {
        (Some(l), Some(c)) => is_newer(l, &c),
        _ => false,
    };
    AppUpdate { current: current.to_string(), latest: latest.map(|v| v.iter().map(u64::to_string).collect::<Vec<_>>().join(".")), newer, url: RELEASES }
}

#[tauri::command]
pub async fn check_app_update(proxy: Option<String>) -> Result<AppUpdate, String> {
    let proxy = crate::net::proxy_option(proxy.as_deref())?;
    let segment = crate::setup::latest_release_segment(RELEASES, proxy.as_deref()).await?;
    Ok(compare(env!("CARGO_PKG_VERSION"), &segment))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_releases_are_noticed_numerically() {
        assert!(compare("0.0.4", "v0.0.5").newer);
        assert!(compare("0.0.9", "v0.0.10").newer);
        assert!(compare("0.9.0", "v1.0").newer);
        assert!(!compare("0.0.4", "v0.0.4").newer);
        assert!(!compare("0.1.0", "v0.0.9").newer);
    }

    #[test]
    fn odd_tags_never_announce_an_update() {
        for tag in ["releases", "", "v1.2.3-beta", "latest", "v1..2", "v99999999999"] {
            let r = compare("0.0.4", tag);
            assert!(!r.newer, "{tag}");
            assert!(r.latest.is_none(), "{tag}");
        }
    }

    #[test]
    fn the_reported_version_is_normalised() {
        assert_eq!(compare("0.0.4", "v0.0.5").latest.as_deref(), Some("0.0.5"));
    }
}
