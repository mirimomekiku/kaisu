//! Locates yt-dlp and ffmpeg/ffprobe and keeps yt-dlp up to date.
//!
//! Lookup order, per tool:
//!   1. bundled  - next to the app executable (what the installers ship)
//!   2. managed  - the app's own data folder (what Setup and the updater install)
//!   3. system   - anywhere on PATH
//!
//! For yt-dlp the newer of bundled/managed wins, so a new app release never regresses to an
//! older engine and an updated copy never goes stale behind a read-only install directory.

use std::{
    cmp::Ordering,
    env,
    path::{Path, PathBuf},
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use crate::{proc, setup};

pub const EXE: &str = env::consts::EXE_SUFFIX;
const MISSING: &str = "The video downloader (yt-dlp) isn't installed yet. Open Setup to install it.";

#[derive(Clone, Copy, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Bundled,
    Managed,
    System,
}

#[derive(Clone, Serialize)]
pub struct Component {
    pub ready: bool,
    pub source: Option<Source>,
    pub version: Option<String>,
    pub path: Option<String>,
}

impl Component {
    fn missing() -> Self {
        Self { ready: false, source: None, version: None, path: None }
    }
}

#[derive(Serialize)]
pub struct EngineInfo {
    pub ytdlp: Component,
    pub ffmpeg: Component,
    /// JavaScript runtime (deno, or node/bun) that yt-dlp needs to read YouTube.
    pub js: Component,
    pub ready: bool,
}

/// A JavaScript runtime yt-dlp can be pointed at.
#[derive(Clone)]
pub struct JsRuntime {
    pub name: &'static str,
    pub path: PathBuf,
    pub source: Source,
}

impl JsRuntime {
    /// Value for yt-dlp's `--js-runtimes` (`RUNTIME[:PATH]`).
    pub fn arg(&self) -> String {
        format!("{}:{}", self.name, self.path.display())
    }
}

#[derive(Serialize)]
pub struct UpdateResult {
    pub updated: bool,
    pub version: String,
    pub previous: String,
}

#[derive(Clone)]
struct Resolved {
    path: PathBuf,
    version: String,
    source: Source,
}

#[derive(Default)]
pub struct Engine {
    resolved: Mutex<Option<Resolved>>,
}

/// Directory holding the bundled sidecars: next to the executable (the bundler strips the
/// target triple; in dev `tauri-build` copies them into `target/<profile>`).
pub fn bundled_dir() -> Result<PathBuf, String> {
    env::current_exe()
        .map_err(|e| format!("Cannot locate executable: {e}"))?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Executable has no parent directory".to_string())
}

pub fn managed_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("engine"))
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    let file = format!("{name}{EXE}");
    env::split_paths(&env::var_os("PATH")?).map(|d| d.join(&file)).find(|p| p.is_file())
}

fn has_ffmpeg(dir: &Path) -> bool {
    dir.join(format!("ffmpeg{EXE}")).is_file() && dir.join(format!("ffprobe{EXE}")).is_file()
}

/// yt-dlp versions look like `2026.08.19` or `2026.08.19.123456`.
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let parse = |s: &str| -> Vec<u64> { s.split('.').map(|p| p.parse().unwrap_or(0)).collect() };
    parse(a).cmp(&parse(b))
}

pub async fn version_of(path: &Path) -> Result<String, String> {
    let out = proc::run_capture(path, &["--version"], Duration::from_secs(30)).await?;
    let v = out.trim().to_string();
    if v.is_empty() { Err("yt-dlp printed no version".into()) } else { Ok(v) }
}

async fn probe(path: PathBuf, source: Source) -> Option<Resolved> {
    if !path.is_file() {
        return None;
    }
    version_of(&path).await.ok().map(|version| Resolved { path, version, source })
}

/// The folder holding a usable ffmpeg + ffprobe pair, and where it came from.
pub fn locate_ffmpeg(app: &AppHandle) -> Option<(PathBuf, Source)> {
    if let Ok(dir) = bundled_dir() {
        if has_ffmpeg(&dir) {
            return Some((dir, Source::Bundled));
        }
    }
    if let Ok(dir) = managed_dir(app) {
        if has_ffmpeg(&dir) {
            return Some((dir, Source::Managed));
        }
    }
    let ffmpeg = find_in_path("ffmpeg")?;
    let dir = ffmpeg.parent()?.to_path_buf();
    has_ffmpeg(&dir).then_some((dir, Source::System))
}

/// Deno from the managed folder or PATH, else node/bun from PATH (older machines often have those).
pub fn locate_js_runtime(app: &AppHandle) -> Option<JsRuntime> {
    if let Ok(dir) = managed_dir(app) {
        let path = dir.join(format!("deno{EXE}"));
        if path.is_file() {
            return Some(JsRuntime { name: "deno", path, source: Source::Managed });
        }
    }
    ["deno", "node", "bun"].into_iter().find_map(|name| {
        find_in_path(name).map(|path| JsRuntime { name, path, source: Source::System })
    })
}

async fn ffmpeg_version(dir: &Path) -> Option<String> {
    let out = proc::run_capture(&dir.join(format!("ffmpeg{EXE}")), &["-version"], Duration::from_secs(15)).await.ok()?;
    out.lines().next()?.split_whitespace().nth(2).map(str::to_string)
}

impl Engine {
    async fn resolve(&self, app: &AppHandle) -> Option<Resolved> {
        let mut guard = self.resolved.lock().await;
        if let Some(r) = guard.as_ref() {
            return Some(r.clone());
        }

        let bundled = match bundled_dir() {
            Ok(d) => probe(d.join(format!("yt-dlp{EXE}")), Source::Bundled).await,
            Err(_) => None,
        };
        let managed = match managed_dir(app) {
            Ok(d) => probe(d.join(format!("yt-dlp{EXE}")), Source::Managed).await,
            Err(_) => None,
        };
        let chosen = match (bundled, managed) {
            (Some(b), Some(m)) => Some(if compare_versions(&m.version, &b.version) != Ordering::Less { m } else { b }),
            (Some(r), None) | (None, Some(r)) => Some(r),
            (None, None) => match find_in_path("yt-dlp") {
                Some(p) => probe(p, Source::System).await,
                None => None,
            },
        };
        if chosen.is_some() {
            *guard = chosen.clone();
        }
        chosen
    }

    /// Forget the cached lookup (after installing or updating a tool).
    pub async fn reset(&self) {
        *self.resolved.lock().await = None;
    }

    pub async fn ytdlp_path(&self, app: &AppHandle) -> Result<PathBuf, String> {
        self.resolve(app).await.map(|r| r.path).ok_or_else(|| MISSING.to_string())
    }

    /// Never fails: a missing tool is reported as `ready: false`.
    pub async fn info(&self, app: &AppHandle) -> EngineInfo {
        let ytdlp = match self.resolve(app).await {
            Some(r) => Component {
                ready: true,
                source: Some(r.source),
                version: Some(r.version),
                path: Some(r.path.display().to_string()),
            },
            None => Component::missing(),
        };
        let ffmpeg = match locate_ffmpeg(app) {
            Some((dir, source)) => Component {
                ready: true,
                source: Some(source),
                version: ffmpeg_version(&dir).await,
                path: Some(dir.display().to_string()),
            },
            None => Component::missing(),
        };
        let js = match locate_js_runtime(app) {
            Some(rt) => Component {
                ready: true,
                source: Some(rt.source),
                version: proc::run_capture(&rt.path, &["--version"], Duration::from_secs(15))
                    .await
                    .ok()
                    .and_then(|o| o.lines().next().map(|l| format!("{} {}", rt.name, l.trim_start_matches(rt.name).trim()))),
                path: Some(rt.path.display().to_string()),
            },
            None => Component::missing(),
        };
        let ready = ytdlp.ready && ffmpeg.ready && js.ready;
        EngineInfo { ytdlp, ffmpeg, js, ready }
    }

    /// Checks GitHub for a newer yt-dlp and installs it into the managed folder.
    /// The caller must make sure no download is running (Windows can't replace a running exe).
    pub async fn update(&self, app: &AppHandle, proxy: Option<&str>) -> Result<UpdateResult, String> {
        let current = self.resolve(app).await;
        let latest = setup::latest_tag(proxy).await?;
        let previous = current.as_ref().map(|c| c.version.clone()).unwrap_or_default();

        if current.as_ref().is_some_and(|c| compare_versions(&latest, &c.version) != Ordering::Greater) {
            return Ok(UpdateResult { updated: false, version: previous.clone(), previous });
        }

        let version = setup::install_ytdlp(&managed_dir(app)?, &latest, proxy, &|_| {}).await?;
        self.reset().await;
        Ok(UpdateResult { updated: true, version, previous })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_ordering() {
        assert_eq!(compare_versions("2026.08.19", "2026.08.19"), Ordering::Equal);
        assert_eq!(compare_versions("2026.09.01", "2026.08.19"), Ordering::Greater);
        assert_eq!(compare_versions("2026.08.19", "2026.08.19.123456"), Ordering::Less);
        assert_eq!(compare_versions("2026.10.02", "2026.9.30"), Ordering::Greater);
    }

    #[tokio::test]
    async fn latest_tag_comes_from_github() {
        let tag = setup::latest_tag(None).await.expect("latest tag");
        assert!(tag.starts_with("20"), "{tag}");
    }

    #[tokio::test]
    async fn runs_bundled_binary() {
        let bin = Path::new(env!("CARGO_MANIFEST_DIR")).join("bin").join(format!("yt-dlp-{}{EXE}", "x86_64-unknown-linux-gnu"));
        if !bin.exists() {
            return;
        }
        let v = version_of(&bin).await.unwrap();
        assert!(v.starts_with("20"), "{v}");
    }

    #[test]
    fn path_lookup_finds_a_directory_entry() {
        let dir = env::temp_dir().join(format!("kaisu-path-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("fake-tool{EXE}")), b"").unwrap();
        let old = env::var_os("PATH");
        // SAFETY: tests in this module don't read PATH concurrently.
        unsafe { env::set_var("PATH", &dir) };
        let found = find_in_path("fake-tool");
        unsafe { env::set_var("PATH", old.unwrap_or_default()) };
        let _ = std::fs::remove_dir_all(&dir);
        assert!(found.is_some());
    }
}
