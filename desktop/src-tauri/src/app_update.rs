//! Tells the user when a newer Kaisu release exists, and (on Windows, once a release key is configured) installs it. Checking only
//! reads the public `/releases/latest` redirect; the link it offers is a fixed page, not text taken from the network.
//!
//! Installing downloads `kaisu-windows-x64.exe` from that release, checks an Ed25519 signature made with the maintainer's private
//! key over the version and the file's SHA-256, and only then replaces the running program (keeping the old one beside it until the
//! next start). A download that fails any check is deleted and nothing is replaced. The new version starts only on the user's restart.

use std::{path::{Path, PathBuf}, sync::{Mutex, atomic::{AtomicBool, Ordering}}};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State, ipc::Channel};
use tokio::io::AsyncWriteExt;

const RELEASES: &str = "https://github.com/mirimomekiku/kaisu/releases";
const ASSET: &str = "kaisu-windows-x64.exe";
/// The maintainer's public key. Empty until a key pair has been created, which keeps installing switched off.
const PUBLIC_KEY: &str = include_str!("../update-key.pub");
const MAX_BYTES: u64 = 300 * 1024 * 1024;
const NEW_NAME: &str = ".kaisu-update-new.exe";

#[derive(Serialize, Debug, PartialEq)]
pub struct AppUpdate {
    pub current: String,
    /// The newest release's version, if the repository has one.
    pub latest: Option<String>,
    pub newer: bool,
    pub url: &'static str,
    /// Kaisu can download, verify and install this update itself.
    pub installable: bool,
}

#[derive(Default)]
pub struct UpdateState { busy: AtomicBool, installed: Mutex<Option<String>> }

fn hex_bytes<const N: usize>(text: &str) -> Option<[u8; N]> {
    let text = text.trim();
    if text.len() != N * 2 || !text.is_ascii() { return None; }
    let mut out = [0u8; N];
    for (i, byte) in out.iter_mut().enumerate() { *byte = u8::from_str_radix(&text[i * 2..i * 2 + 2], 16).ok()?; }
    Some(out)
}

/// The first non-comment line of the key file, when it is a valid Ed25519 public key.
fn parse_key(file: &str) -> Option<VerifyingKey> {
    let line = file.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with('#'))?;
    VerifyingKey::from_bytes(&hex_bytes::<32>(line)?).ok()
}

/// What is signed: the version and the file's SHA-256, so a signature cannot be reused for another version or file.
fn signed_message(version: &str, digest: &[u8]) -> Vec<u8> {
    let mut message = b"kaisu-update-v1\0".to_vec();
    message.extend_from_slice(version.as_bytes());
    message.push(0);
    message.extend_from_slice(digest);
    message
}

fn verify(key: &VerifyingKey, version: &str, digest: &[u8], signature_hex: &str) -> Result<(), String> {
    let bytes = hex_bytes::<64>(signature_hex).ok_or("The update's signature file is not valid.")?;
    key.verify_strict(&signed_message(version, digest), &Signature::from_bytes(&bytes)).map_err(|_| "The update's signature did not match, so it was not installed.".to_string())
}

fn installable() -> bool { cfg!(windows) && parse_key(PUBLIC_KEY).is_some() }

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
    AppUpdate { current: current.to_string(), latest: latest.map(|v| v.iter().map(u64::to_string).collect::<Vec<_>>().join(".")), newer, url: RELEASES, installable: newer && installable() }
}

#[tauri::command]
pub async fn check_app_update(proxy: Option<String>) -> Result<AppUpdate, String> {
    let proxy = crate::net::proxy_option(proxy.as_deref())?;
    let segment = crate::setup::latest_release_segment(RELEASES, proxy.as_deref()).await?;
    Ok(compare(env!("CARGO_PKG_VERSION"), &segment))
}

/// The normalised number of the newest release, only when it is newer than this version.
fn newer_than_current(segment: &str) -> Result<String, String> {
    let update = compare(env!("CARGO_PKG_VERSION"), segment);
    match (update.newer, update.latest) { (true, Some(version)) => Ok(version), _ => Err("There is no newer Kaisu release.".into()) }
}

async fn fetch_small(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client.get(url).send().await.map_err(crate::setup::net_err)?;
    if !response.status().is_success() { return Err(format!("The release has no signature file (the server answered {}).", response.status())); }
    let bytes = response.bytes().await.map_err(crate::setup::net_err)?;
    if bytes.len() > 4096 { return Err("The signature file is too large.".into()); }
    String::from_utf8(bytes.to_vec()).map_err(|_| "The signature file is not text.".into())
}

/// Streams the release file to `dest`, returning its SHA-256. Refuses anything larger than the limit or that is not a Windows program.
async fn fetch_file(client: &reqwest::Client, url: &str, dest: &Path, on_progress: &Channel<f32>) -> Result<Vec<u8>, String> {
    let mut response = client.get(url).send().await.map_err(crate::setup::net_err)?;
    if !response.status().is_success() { return Err(format!("The release has no {ASSET} (the server answered {}).", response.status())); }
    let total = response.content_length();
    if total.is_some_and(|t| t > MAX_BYTES) { return Err("The update file is larger than expected.".into()); }
    let mut file = tokio::fs::OpenOptions::new().write(true).create_new(true).open(dest).await.map_err(|e| format!("Kaisu can't write to its own folder: {e}"))?;
    let (mut hasher, mut done, mut last) = (Sha256::new(), 0u64, -1.0f32);
    let mut first = [0u8; 2];
    while let Some(chunk) = response.chunk().await.map_err(crate::setup::net_err)? {
        if done == 0 && chunk.len() >= 2 { first.copy_from_slice(&chunk[..2]); }
        done += chunk.len() as u64;
        if done > MAX_BYTES { return Err("The update file is larger than expected.".into()); }
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| format!("Couldn't save the update: {e}"))?;
        if let Some(t) = total.filter(|t| *t > 0) {
            let pct = done as f32 / t as f32 * 100.0;
            if pct - last >= 1.0 { last = pct; let _ = on_progress.send(pct.min(100.0)); }
        }
    }
    file.flush().await.map_err(|e| format!("Couldn't save the update: {e}"))?;
    if &first != b"MZ" { return Err("The downloaded file is not a Windows program.".into()); }
    Ok(hasher.finalize().to_vec())
}

/// Deletes the downloaded file unless it was put in place.
struct Staged(PathBuf);
impl Drop for Staged { fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); } }

/// Puts the verified file in place of the running program. The old one is kept beside it until the next start.
fn swap_in(current: &Path, staged: &Path, backup: &Path) -> Result<(), String> {
    if backup.exists() { std::fs::remove_file(backup).map_err(|e| format!("Couldn't clear the previous backup: {e}"))?; }
    std::fs::rename(current, backup).map_err(|e| format!("Couldn't replace the running program: {e}"))?;
    if let Err(e) = std::fs::rename(staged, current) {
        let _ = std::fs::rename(backup, current);
        return Err(format!("Couldn't put the update in place; the current version was kept: {e}"));
    }
    Ok(())
}
fn backup_of(current: &Path) -> PathBuf { let mut name = current.as_os_str().to_owned(); name.push(".old"); PathBuf::from(name) }

struct Free<'a>(&'a AtomicBool);
impl Drop for Free<'_> { fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); } }

/// Downloads the newest release, checks its signature and installs it. The new version starts only when the user restarts.
#[tauri::command]
pub async fn app_update_install(downloads: State<'_, crate::download::Downloads>, state: State<'_, UpdateState>, version: String, proxy: Option<String>, on_progress: Channel<f32>) -> Result<(), String> {
    if !cfg!(windows) { return Err("Installing updates is only supported on Windows so far. Download the new file from the releases page.".into()); }
    let key = parse_key(PUBLIC_KEY).ok_or("This build of Kaisu cannot verify updates, so it will not install them. Download the new file from the releases page.")?;
    if !downloads.is_idle() { return Err("Wait for running downloads to finish before updating.".into()); }
    if state.busy.swap(true, Ordering::SeqCst) { return Err("An update is already being installed.".into()); }
    let _free = Free(&state.busy);
    let proxy = crate::net::proxy_option(proxy.as_deref())?;
    // The release is looked up again here; the page's word for which version to fetch is not trusted.
    let latest = newer_than_current(&crate::setup::latest_release_segment(RELEASES, proxy.as_deref()).await?)?;
    if latest != version { return Err("A different release is now the newest. Check for updates again.".into()); }
    let current = std::env::current_exe().map_err(|e| e.to_string())?;
    let folder = current.parent().ok_or("Kaisu could not find its own folder.")?;
    let staged = Staged(folder.join(NEW_NAME));
    let _ = std::fs::remove_file(&staged.0);
    let client = crate::setup::client(proxy.as_deref())?;
    let base = format!("{RELEASES}/download/v{latest}/{ASSET}");
    let digest = fetch_file(&client, &base, &staged.0, &on_progress).await?;
    verify(&key, &latest, &digest, &fetch_small(&client, &format!("{base}.sig")).await?)?;
    swap_in(&current, &staged.0, &backup_of(&current))?;
    std::mem::forget(staged);
    *state.installed.lock().unwrap_or_else(|e| e.into_inner()) = Some(latest);
    Ok(())
}

/// Starts the installed version once this one has closed, then quits.
#[tauri::command]
pub fn app_update_restart(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    if state.installed.lock().unwrap_or_else(|e| e.into_inner()).is_none() { return Err("No update has been installed.".into()); }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        // Wait for this process to end first: a second copy would hand over to the running one and quit.
        let script = format!("Wait-Process -Id {} -ErrorAction SilentlyContinue; Start-Process -FilePath '{}'", std::process::id(), exe.display().to_string().replace('\'', "''"));
        std::process::Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script]).creation_flags(0x0800_0000).spawn().map_err(|e| format!("Couldn't schedule the restart: {e}"))?;
    }
    crate::tray::quit(&app);
    Ok(())
}

/// Removes what a finished update left behind. Failure only means it is tried again next time.
pub fn clean_leftovers() {
    let Ok(current) = std::env::current_exe() else { return };
    let _ = std::fs::remove_file(backup_of(&current));
    if let Some(folder) = current.parent() { let _ = std::fs::remove_file(folder.join(NEW_NAME)); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

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
            assert!(!r.installable, "{tag}");
        }
    }

    fn signed(version: &str, bytes: &[u8]) -> (VerifyingKey, Vec<u8>, String) {
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let digest = Sha256::digest(bytes).to_vec();
        let signature = key.sign(&signed_message(version, &digest));
        (key.verifying_key(), digest, signature.to_bytes().iter().map(|b| format!("{b:02x}")).collect())
    }

    #[test]
    fn only_a_matching_signature_for_this_version_and_file_installs() {
        let (key, digest, signature) = signed("0.0.6", b"program");
        assert!(verify(&key, "0.0.6", &digest, &signature).is_ok());
        assert!(verify(&key, "0.0.7", &digest, &signature).is_err(), "another version");
        assert!(verify(&key, "0.0.6", &Sha256::digest(b"tampered"), &signature).is_err(), "another file");
        assert!(verify(&key, "0.0.6", &digest, &"0".repeat(128)).is_err(), "a made-up signature");
        assert!(verify(&key, "0.0.6", &digest, "not hex").is_err());
        let other = SigningKey::from_bytes(&[8u8; 32]).verifying_key();
        assert!(verify(&other, "0.0.6", &digest, &signature).is_err(), "another key");
    }

    /// Made by scripts/release-sign.mjs (see release-sign.test.mjs): the two implementations must agree byte for byte.
    #[test]
    fn a_signature_made_by_the_release_script_verifies() {
        let key = parse_key("ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c").unwrap();
        let digest = Sha256::digest(b"program");
        let signature = "6e0da9f31847314487459f618f802301398dae423d0b46b7c50d417b07bbf89ed09b33ebda9bfac7f7c206d1f6639294feab5e0dc4ce3af0b44dc95bbeccbe08";
        assert!(verify(&key, "0.0.6", &digest, signature).is_ok());
        assert!(verify(&key, "0.0.7", &digest, signature).is_err());
    }

    #[test]
    fn the_key_file_needs_a_real_public_key() {
        let key = SigningKey::from_bytes(&[7u8; 32]).verifying_key();
        let hex: String = key.to_bytes().iter().map(|b| format!("{b:02x}")).collect();
        assert!(parse_key(&format!("# note\n\n{hex}\n")).is_some());
        for bad in ["", "# only a comment", "abcd", &"zz".repeat(32), &format!("{hex}00")] { assert!(parse_key(bad).is_none(), "{bad}"); }
    }

    #[test]
    fn only_a_newer_release_may_be_installed() {
        assert!(newer_than_current("v99.0.0").is_ok());
        for tag in ["v0.0.1", "v0.0.0", "latest", ""] { assert!(newer_than_current(tag).is_err(), "{tag}"); }
    }

    #[test]
    fn the_swap_keeps_the_old_program_and_rolls_back_on_failure() {
        let dir = std::env::temp_dir().join(format!("kaisu-swap-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let (current, staged) = (dir.join("kaisu.exe"), dir.join(NEW_NAME));
        std::fs::write(&current, b"old").unwrap();
        std::fs::write(&staged, b"new").unwrap();
        let backup = backup_of(&current);
        swap_in(&current, &staged, &backup).unwrap();
        assert_eq!(std::fs::read(&current).unwrap(), b"new");
        assert_eq!(std::fs::read(&backup).unwrap(), b"old");
        // The staged file is gone, so a second swap fails and must put the running program back.
        assert!(swap_in(&current, &staged, &backup).is_err());
        assert_eq!(std::fs::read(&current).unwrap(), b"new");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn the_reported_version_is_normalised() {
        assert_eq!(compare("0.0.4", "v0.0.5").latest.as_deref(), Some("0.0.5"));
    }
}
