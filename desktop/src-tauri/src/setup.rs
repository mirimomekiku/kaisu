//! First-run setup: detects the platform and installs whatever helper tools are missing
//! (yt-dlp and ffmpeg/ffprobe) into the app's own data folder, with checksum verification.
//!
//! Everything platform-specific lives in `assets()` / `extract_ffmpeg()` / `manual_steps()`,
//! so supporting another OS means touching only this file.

use std::{env, path::Path, time::Duration};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State, ipc::Channel};
use tokio::io::AsyncWriteExt;

use crate::{
    download::Downloads,
    engine::{self, EXE, Engine, EngineInfo},
    proc,
};

const YTDLP_BASE: &str = "https://github.com/yt-dlp/yt-dlp/releases";
const FFMPEG_BASE: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest";
const DENO_BASE: &str = "https://github.com/denoland/deno/releases/latest/download";
const UNSUPPORTED: &str = "Automatic setup isn't available for this computer. Follow the manual steps instead.";

/// Release asset names for the current OS and CPU.
pub struct Assets {
    pub ytdlp: &'static str,
    pub ffmpeg: &'static str,
    /// JavaScript runtime yt-dlp needs for YouTube.
    pub deno: &'static str,
}

pub fn assets() -> Option<Assets> {
    match (env::consts::OS, env::consts::ARCH) {
        ("windows", "x86_64") => Some(Assets {
            ytdlp: "yt-dlp.exe",
            ffmpeg: "ffmpeg-master-latest-win64-lgpl.zip",
            deno: "deno-x86_64-pc-windows-msvc.zip",
        }),
        ("linux", "x86_64") => Some(Assets {
            ytdlp: "yt-dlp_linux",
            ffmpeg: "ffmpeg-master-latest-linux64-lgpl.tar.xz",
            deno: "deno-x86_64-unknown-linux-gnu.zip",
        }),
        ("linux", "aarch64") => Some(Assets {
            ytdlp: "yt-dlp_linux_aarch64",
            ffmpeg: "ffmpeg-master-latest-linuxarm64-lgpl.tar.xz",
            deno: "deno-aarch64-unknown-linux-gnu.zip",
        }),
        _ => None,
    }
}

// ---- platform description ---------------------------------------------------------

#[derive(Serialize)]
pub struct Platform {
    pub os: &'static str,
    pub arch: &'static str,
    pub distro: Option<String>,
    pub auto_install: bool,
}

#[derive(Serialize)]
pub struct SetupInfo {
    pub engine: EngineInfo,
    pub platform: Platform,
    pub manual_steps: Vec<String>,
    pub managed_dir: String,
}

/// `(ID, ID_LIKE...)` from /etc/os-release, lower-cased.
fn linux_distro_ids() -> Vec<String> {
    let Ok(text) = std::fs::read_to_string("/etc/os-release") else { return Vec::new() };
    let mut ids = Vec::new();
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else { continue };
        let value = value.trim().trim_matches('"').to_lowercase();
        match key {
            "ID" => ids.insert(0, value),
            "ID_LIKE" => ids.extend(value.split_whitespace().map(str::to_string)),
            _ => {}
        }
    }
    ids
}

fn platform() -> Platform {
    Platform {
        os: env::consts::OS,
        arch: env::consts::ARCH,
        distro: if cfg!(target_os = "linux") { linux_distro_ids().into_iter().next() } else { None },
        auto_install: assets().is_some(),
    }
}

/// Copy-pasteable commands for installing the tools by hand, matched to the OS / distro.
pub fn manual_steps() -> Vec<String> {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    match env::consts::OS {
        "windows" => s(&["winget install yt-dlp.yt-dlp", "winget install Gyan.FFmpeg", "winget install DenoLand.Deno"]),
        "linux" => {
            let mut steps = linux_package_steps();
            steps.push("curl -fsSL https://deno.land/install.sh | sh    (JavaScript runtime for YouTube)".to_string());
            steps
        }
        _ => s(&["Install yt-dlp, ffmpeg (with ffprobe) and deno, and make sure all are on your PATH."]),
    }
}

fn linux_package_steps() -> Vec<String> {
    let ids = linux_distro_ids();
    let is = |names: &[&str]| ids.iter().any(|i| names.contains(&i.as_str()));
    let step = if is(&["fedora", "rhel", "centos"]) {
        "sudo dnf install yt-dlp ffmpeg-free"
    } else if is(&["debian", "ubuntu"]) {
        "sudo apt install ffmpeg yt-dlp"
    } else if is(&["arch"]) {
        "sudo pacman -S yt-dlp ffmpeg"
    } else if is(&["suse", "opensuse"]) {
        "sudo zypper install yt-dlp ffmpeg"
    } else {
        "Install yt-dlp and ffmpeg with your distribution's package manager."
    };
    vec![step.to_string()]
}

// ---- HTTP helpers -----------------------------------------------------------------

pub fn net_err(e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() {
        "Couldn't reach the download server. Check your internet connection and try again.".into()
    } else {
        format!("Download failed: {e}")
    }
}

fn with_proxy(builder: reqwest::ClientBuilder, proxy: Option<&str>) -> Result<reqwest::ClientBuilder, String> {
    match proxy {
        Some(p) => Ok(builder.proxy(reqwest::Proxy::all(p).map_err(|e| format!("Proxy: {e}"))?)),
        None => Ok(builder),
    }
}

pub(crate) fn client(proxy: Option<&str>) -> Result<reqwest::Client, String> {
    with_proxy(
        reqwest::Client::builder().user_agent("kaisu").connect_timeout(Duration::from_secs(20)).read_timeout(Duration::from_secs(45)),
        proxy,
    )?
    .build()
    .map_err(|e| format!("HTTP client error: {e}"))
}

async fn get_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let res = client.get(url).send().await.map_err(net_err)?;
    if !res.status().is_success() {
        return Err(format!("The download server answered {} for {url}", res.status()));
    }
    res.text().await.map_err(net_err)
}

fn checksum_for(sums: &str, file: &str) -> Option<String> {
    sums.lines().find_map(|l| {
        let mut it = l.split_whitespace();
        let (hash, name) = (it.next()?, it.next()?.trim_start_matches('*'));
        (name == file).then(|| hash.to_string())
    })
}

/// A one-file checksum: `<hash>  <name>` (sha256sum) or PowerShell's `Hash : <HASH>` block.
fn single_checksum(text: &str) -> Option<String> {
    let is_hash = |h: &str| h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit());
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Hash") {
            let h = rest.trim_start_matches([' ', ':']).trim();
            if is_hash(h) {
                return Some(h.to_lowercase());
            }
        } else if let Some(h) = line.split_whitespace().next() {
            if is_hash(h) {
                return Some(h.to_lowercase());
            }
        }
    }
    None
}

type Progress<'a> = &'a (dyn Fn(f32) + Send + Sync);

/// Streams `url` to `dest`, reporting 0..100 and returning the SHA-256 of what was written.
async fn download_to(client: &reqwest::Client, url: &str, dest: &Path, progress: Progress<'_>) -> Result<String, String> {
    let mut res = client.get(url).send().await.map_err(net_err)?;
    if !res.status().is_success() {
        return Err(format!("The download server answered {} for {url}", res.status()));
    }
    let total = res.content_length();
    let mut file = tokio::fs::File::create(dest).await.map_err(|e| format!("Cannot write {}: {e}", dest.display()))?;
    let mut hasher = Sha256::new();
    let (mut done, mut last) = (0u64, -1.0f32);

    while let Some(chunk) = res.chunk().await.map_err(net_err)? {
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| format!("Cannot write {}: {e}", dest.display()))?;
        done += chunk.len() as u64;
        if let Some(t) = total.filter(|t| *t > 0) {
            let pct = done as f32 / t as f32 * 100.0;
            if pct - last >= 0.5 {
                last = pct;
                progress(pct.min(100.0));
            }
        }
    }
    file.flush().await.map_err(|e| format!("Cannot write {}: {e}", dest.display()))?;
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// The latest yt-dlp release tag, read from the `/releases/latest` redirect (not rate limited).
pub async fn latest_tag(proxy: Option<&str>) -> Result<String, String> {
    let client = with_proxy(
        reqwest::Client::builder().user_agent("kaisu").timeout(Duration::from_secs(20)).redirect(reqwest::redirect::Policy::none()),
        proxy,
    )?
    .build()
    .map_err(|e| format!("HTTP client error: {e}"))?;
    let res = client.get(format!("{YTDLP_BASE}/latest")).send().await.map_err(net_err)?;
    let location = res
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .ok_or("GitHub did not report a latest release")?;
    let tag = location.rsplit('/').next().unwrap_or_default();
    if tag.is_empty() || !tag.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return Err(format!("Unexpected release tag: {tag:?}"));
    }
    Ok(tag.to_string())
}

// ---- installers -------------------------------------------------------------------

#[cfg(unix)]
pub fn make_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("Cannot mark {} executable: {e}", path.display()))
}

#[cfg(not(unix))]
pub fn make_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// Downloads yt-dlp `tag` into `dir`, verifies it, test-runs it, then moves it into place.
/// Returns the version the new binary reports.
pub async fn install_ytdlp(dir: &Path, tag: &str, proxy: Option<&str>, progress: Progress<'_>) -> Result<String, String> {
    let a = assets().ok_or(UNSUPPORTED)?;
    tokio::fs::create_dir_all(dir).await.map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    let client = client(proxy)?;
    let base = format!("{YTDLP_BASE}/download/{tag}");

    let sums = get_text(&client, &format!("{base}/SHA2-256SUMS")).await?;
    let expected = checksum_for(&sums, a.ytdlp).ok_or_else(|| format!("No checksum is published for {}", a.ytdlp))?;

    let tmp = dir.join(format!("yt-dlp.download{EXE}"));
    let actual = download_to(&client, &format!("{base}/{}", a.ytdlp), &tmp, progress).await;
    let cleanup = |e: String| {
        let _ = std::fs::remove_file(&tmp);
        e
    };
    let actual = actual.map_err(cleanup)?;
    if !actual.eq_ignore_ascii_case(&expected) {
        return Err(cleanup("The downloaded file failed its safety check and was discarded.".into()));
    }
    make_executable(&tmp).map_err(cleanup)?;

    let version = engine::version_of(&tmp)
        .await
        .map_err(|e| cleanup(format!("The downloaded yt-dlp doesn't run on this computer: {e}")))?;

    tokio::fs::rename(&tmp, dir.join(format!("yt-dlp{EXE}")))
        .await
        .map_err(|e| cleanup(format!("Cannot install yt-dlp: {e}")))?;
    Ok(version)
}

/// Downloads the static LGPL ffmpeg build and unpacks `ffmpeg` and `ffprobe` into `dir`.
pub async fn install_ffmpeg(dir: &Path, proxy: Option<&str>, progress: Progress<'_>, status: &(dyn Fn(&str) + Send + Sync)) -> Result<(), String> {
    let a = assets().ok_or(UNSUPPORTED)?;
    tokio::fs::create_dir_all(dir).await.map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    let client = client(proxy)?;

    let sums = get_text(&client, &format!("{FFMPEG_BASE}/checksums.sha256")).await?;
    let expected = checksum_for(&sums, a.ffmpeg).ok_or_else(|| format!("No checksum is published for {}", a.ffmpeg))?;

    let archive = dir.join("ffmpeg.download");
    let result = async {
        let actual = download_to(&client, &format!("{FFMPEG_BASE}/{}", a.ffmpeg), &archive, progress).await?;
        if !actual.eq_ignore_ascii_case(&expected) {
            return Err("The downloaded file failed its safety check and was discarded.".to_string());
        }

        status("Unpacking…");
        let (archive_p, dir_p) = (archive.clone(), dir.to_path_buf());
        tokio::task::spawn_blocking(move || extract_ffmpeg(&archive_p, &dir_p))
            .await
            .map_err(|e| format!("Unpacking failed: {e}"))??;

        for name in ["ffmpeg", "ffprobe"] {
            let partial = dir.join(format!("{name}{EXE}.partial"));
            make_executable(&partial)?;
            let fin = dir.join(format!("{name}{EXE}"));
            tokio::fs::rename(&partial, &fin).await.map_err(|e| format!("Cannot install {name}: {e}"))?;
        }
        proc::run_capture(&dir.join(format!("ffmpeg{EXE}")), &["-version"], Duration::from_secs(30))
            .await
            .map_err(|e| format!("The downloaded ffmpeg doesn't run on this computer: {e}"))?;
        Ok(())
    }
    .await;

    let _ = tokio::fs::remove_file(&archive).await;
    for name in ["ffmpeg", "ffprobe"] {
        let _ = tokio::fs::remove_file(dir.join(format!("{name}{EXE}.partial"))).await;
    }
    result
}

/// Downloads the Deno runtime (a single executable inside a zip) into `dir`.
pub async fn install_deno(dir: &Path, proxy: Option<&str>, progress: Progress<'_>) -> Result<(), String> {
    let a = assets().ok_or(UNSUPPORTED)?;
    tokio::fs::create_dir_all(dir).await.map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    let client = client(proxy)?;

    let sums = get_text(&client, &format!("{DENO_BASE}/{}.sha256sum", a.deno)).await?;
    let expected = single_checksum(&sums).ok_or("Could not read the published checksum for deno")?;

    let archive = dir.join("deno.download");
    let partial = dir.join(format!("deno{EXE}.partial"));
    let result = async {
        let actual = download_to(&client, &format!("{DENO_BASE}/{}", a.deno), &archive, progress).await?;
        if !actual.eq_ignore_ascii_case(&expected) {
            return Err("The downloaded file failed its safety check and was discarded.".to_string());
        }
        let (archive_p, partial_p) = (archive.clone(), partial.clone());
        tokio::task::spawn_blocking(move || extract_single(&archive_p, &format!("deno{EXE}"), &partial_p))
            .await
            .map_err(|e| format!("Unpacking failed: {e}"))??;
        make_executable(&partial)?;
        let fin = dir.join(format!("deno{EXE}"));
        tokio::fs::rename(&partial, &fin).await.map_err(|e| format!("Cannot install deno: {e}"))?;
        proc::run_capture(&fin, &["--version"], Duration::from_secs(30))
            .await
            .map_err(|e| format!("The downloaded deno doesn't run on this computer: {e}"))?;
        Ok(())
    }
    .await;

    let _ = tokio::fs::remove_file(&archive).await;
    let _ = tokio::fs::remove_file(&partial).await;
    result
}

/// Copies the zip entry whose file name is `name` to `dest`.
fn extract_single(archive: &Path, name: &str, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("Cannot open download: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("Unreadable download: {e}"))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("Unreadable download: {e}"))?;
        let entry_name = entry.name().map_err(|e| format!("Unreadable download: {e}"))?.to_string();
        if entry_name.rsplit('/').next() == Some(name) {
            let mut out = std::fs::File::create(dest).map_err(|e| format!("Cannot unpack {name}: {e}"))?;
            std::io::copy(&mut entry, &mut out).map_err(|e| format!("Cannot unpack {name}: {e}"))?;
            return Ok(());
        }
    }
    Err(format!("The download didn't contain {name}"))
}

/// Unpacks `bin/ffmpeg` and `bin/ffprobe` from the archive to `<dest>/<name><EXE>.partial`.
fn extract_ffmpeg(archive: &Path, dest: &Path) -> Result<(), String> {
    let is_zip = assets().is_some_and(|a| a.ffmpeg.ends_with(".zip"));
    if is_zip { extract_ffmpeg_zip(archive, dest) } else { extract_ffmpeg_tar_xz(archive, dest) }
}

/// Windows builds ship as a zip. Compiled on every OS so it can be tested anywhere.
fn extract_ffmpeg_zip(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("Cannot open download: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("Unreadable download: {e}"))?;
    let mut found = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("Unreadable download: {e}"))?;
        let name = entry.name().map_err(|e| format!("Unreadable download: {e}"))?.to_string();
        let Some(base) = ["ffmpeg", "ffprobe"].into_iter().find(|b| {
            name.ends_with(&format!("/bin/{b}.exe")) || name.ends_with(&format!("/bin/{b}"))
        }) else {
            continue;
        };
        let mut out = std::fs::File::create(dest.join(format!("{base}{EXE}.partial")))
            .map_err(|e| format!("Cannot unpack {base}: {e}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("Cannot unpack {base}: {e}"))?;
        found += 1;
    }
    if found == 2 { Ok(()) } else { Err("The download didn't contain ffmpeg and ffprobe".into()) }
}

#[cfg(target_os = "linux")]
fn extract_ffmpeg_tar_xz(archive: &Path, dest: &Path) -> Result<(), String> {
    use std::{ffi::OsStr, fs::File, io::BufReader};

    let file = File::open(archive).map_err(|e| format!("Cannot open download: {e}"))?;
    let mut ar = tar::Archive::new(xz2::read::XzDecoder::new(BufReader::new(file)));
    let mut found = 0;
    for entry in ar.entries().map_err(|e| format!("Unreadable download: {e}"))? {
        let mut entry = entry.map_err(|e| format!("Unreadable download: {e}"))?;
        let path = entry.path().map_err(|e| format!("Unreadable download: {e}"))?.into_owned();
        let in_bin = path.parent().and_then(|p| p.file_name()) == Some(OsStr::new("bin"));
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n @ ("ffmpeg" | "ffprobe")) if in_bin => n.to_string(),
            _ => continue,
        };
        entry.unpack(dest.join(format!("{name}{EXE}.partial"))).map_err(|e| format!("Cannot unpack {name}: {e}"))?;
        found += 1;
    }
    if found == 2 { Ok(()) } else { Err("The download didn't contain ffmpeg and ffprobe".into()) }
}

#[cfg(not(target_os = "linux"))]
fn extract_ffmpeg_tar_xz(_archive: &Path, _dest: &Path) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

// ---- commands -----------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SetupEvent {
    Step { component: &'static str, label: String },
    Progress { component: &'static str, pct: f32 },
    Finished,
}

#[tauri::command]
pub async fn check_setup(app: AppHandle, engine: State<'_, Engine>) -> Result<SetupInfo, String> {
    Ok(SetupInfo {
        engine: engine.info(&app).await,
        platform: platform(),
        manual_steps: manual_steps(),
        managed_dir: engine::managed_dir(&app)?.display().to_string(),
    })
}

/// Installs every missing component. Safe to call again after a failure.
#[tauri::command]
pub async fn run_setup(
    app: AppHandle,
    engine: State<'_, Engine>,
    downloads: State<'_, Downloads>,
    on_event: Channel<SetupEvent>,
    proxy: Option<String>,
) -> Result<EngineInfo, String> {
    if !downloads.is_idle() {
        return Err("Wait for running downloads to finish first.".into());
    }
    let proxy = crate::net::proxy_option(proxy.as_deref())?;
    let proxy = proxy.as_deref();
    let dir = engine::managed_dir(&app)?;
    let info = engine.info(&app).await;

    if !info.ytdlp.ready {
        let _ = on_event.send(SetupEvent::Step { component: "ytdlp", label: "Downloading the video downloader…".into() });
        let tag = latest_tag(proxy).await?;
        let progress = |pct| {
            let _ = on_event.send(SetupEvent::Progress { component: "ytdlp", pct });
        };
        install_ytdlp(&dir, &tag, proxy, &progress).await?;
        engine.reset().await;
    }

    if !info.ffmpeg.ready {
        let _ = on_event.send(SetupEvent::Step { component: "ffmpeg", label: "Downloading the media converter…".into() });
        let progress = |pct| {
            let _ = on_event.send(SetupEvent::Progress { component: "ffmpeg", pct });
        };
        let status = |label: &str| {
            let _ = on_event.send(SetupEvent::Step { component: "ffmpeg", label: label.to_string() });
        };
        install_ffmpeg(&dir, proxy, &progress, &status).await?;
    }

    if !info.js.ready {
        let _ = on_event.send(SetupEvent::Step { component: "js", label: "Downloading the YouTube helper…".into() });
        let progress = |pct| {
            let _ = on_event.send(SetupEvent::Progress { component: "js", pct });
        };
        install_deno(&dir, proxy, &progress).await?;
    }

    let _ = on_event.send(SetupEvent::Finished);
    Ok(engine.info(&app).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_checksum_files() {
        let sums = "abc123  yt-dlp_linux\ndef456 *yt-dlp.exe\n";
        assert_eq!(checksum_for(sums, "yt-dlp_linux").as_deref(), Some("abc123"));
        assert_eq!(checksum_for(sums, "yt-dlp.exe").as_deref(), Some("def456"));
        assert_eq!(checksum_for(sums, "missing"), None);
    }

    #[test]
    fn parses_single_file_checksums() {
        let unix = "c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490  deno-x86_64-unknown-linux-gnu.zip\n";
        assert_eq!(single_checksum(unix).as_deref(), Some("c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490"));
        let ps = "\r\nAlgorithm : SHA256\r\nHash      : A0C3101B4158D1DFB7D6A78A7BF0F3DE80C96BB423C152BEEC8BEB22786F2238\r\nPath      : C:\\a\\deno.zip\r\n";
        assert_eq!(single_checksum(ps).as_deref(), Some("a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238"));
        assert_eq!(single_checksum("not a checksum"), None);
    }

    #[test]
    fn extracts_ffmpeg_from_a_windows_style_zip() {
        use std::io::Write;
        let dir = env::temp_dir().join(format!("kaisu-zip-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("a.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
            let opts = zip::write::SimpleFileOptions::default();
            for (name, body) in [
                ("ffmpeg-master-latest-win64-lgpl/bin/ffmpeg.exe", "FF"),
                ("ffmpeg-master-latest-win64-lgpl/bin/ffprobe.exe", "FP"),
                ("ffmpeg-master-latest-win64-lgpl/doc/readme.txt", "no"),
            ] {
                w.start_file(name, opts).unwrap();
                w.write_all(body.as_bytes()).unwrap();
            }
            w.finish().unwrap();
        }
        extract_ffmpeg_zip(&archive, &dir).unwrap();
        assert_eq!(std::fs::read(dir.join(format!("ffmpeg{EXE}.partial"))).unwrap(), b"FF");
        assert_eq!(std::fs::read(dir.join(format!("ffprobe{EXE}.partial"))).unwrap(), b"FP");
        assert!(!dir.join("readme.txt.partial").exists());

        // An archive missing ffprobe must be rejected, not half-installed silently.
        let broken = dir.join("b.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&broken).unwrap());
            w.start_file("x/bin/ffmpeg.exe", zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(b"FF").unwrap();
            w.finish().unwrap();
        }
        assert!(extract_ffmpeg_zip(&broken, &dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn this_platform_has_manual_steps() {
        assert!(!manual_steps().is_empty());
    }

    #[test]
    fn supported_platforms_have_assets() {
        if matches!((env::consts::OS, env::consts::ARCH), ("linux", "x86_64") | ("windows", "x86_64")) {
            assert!(assets().is_some());
        }
    }

    /// Real download (~60 MB). Run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn installs_ffmpeg_and_ytdlp_into_empty_dir() {
        let dir = env::temp_dir().join(format!("kaisu-setup-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let tag = latest_tag(None).await.unwrap();
        let version = install_ytdlp(&dir, &tag, None, &|_| {}).await.unwrap();
        assert_eq!(version, tag);

        install_ffmpeg(&dir, None, &|_| {}, &|_| {}).await.unwrap();
        install_deno(&dir, None, &|_| {}).await.unwrap();
        for name in ["yt-dlp", "ffmpeg", "ffprobe", "deno"] {
            assert!(dir.join(format!("{name}{EXE}")).is_file(), "{name} missing");
        }
        assert!(!dir.join("ffmpeg.download").exists());
        let out = proc::run_capture(&dir.join(format!("ffprobe{EXE}")), &["-version"], Duration::from_secs(30)).await.unwrap();
        assert!(out.starts_with("ffprobe version"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
