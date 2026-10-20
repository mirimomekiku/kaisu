//! Opening downloaded files. Done here rather than in the webview so only real media files can
//! be launched: a damaged history entry (or a pasted path) must never start an arbitrary program.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::engine::Engine;

/// Everything yt-dlp/ffmpeg can produce from Kaisu's presets, plus common neighbours.
const MEDIA_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "webm", "mov", "avi", "flv", "m4v", "mp3", "m4a", "opus", "ogg", "oga", "flac", "wav", "aac", "wma",
];

const GONE: &str = "That file has been moved or deleted.";

/// A path we are willing to open: absolute, an existing regular file, with a media extension.
fn media_file(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err("Not a valid file location.".into());
    }
    let ext = p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    if !MEDIA_EXTENSIONS.contains(&ext.as_str()) {
        return Err("Kaisu only opens audio and video files.".into());
    }
    if !p.is_file() {
        return Err(GONE.into());
    }
    Ok(p)
}

/// Opens a folder in the system file manager (for "open the folder when done").
#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() || !p.is_dir() {
        return Err("That folder doesn't exist.".into());
    }
    app.opener().open_path(p.display().to_string(), None::<&str>).map_err(|e| format!("Couldn't open the folder: {e}"))
}

#[derive(serde::Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum PowerAction {
    Sleep,
    Shutdown,
}

/// The OS command for a power action, or `None` where we don't support it.
fn power_command(action: PowerAction, os: &str) -> Option<(&'static str, &'static [&'static str])> {
    match (os, action) {
        ("windows", PowerAction::Sleep) => Some(("rundll32.exe", &["powrprof.dll,SetSuspendState", "0,1,0"])),
        ("windows", PowerAction::Shutdown) => Some(("shutdown", &["/s", "/t", "0"])),
        ("linux", PowerAction::Sleep) => Some(("systemctl", &["suspend"])),
        ("linux", PowerAction::Shutdown) => Some(("systemctl", &["poweroff"])),
        _ => None,
    }
}

/// Puts the computer to sleep or shuts it down. The UI shows a cancellable countdown first.
#[tauri::command]
pub fn system_power(action: PowerAction) -> Result<(), String> {
    let (program, args) = power_command(action, std::env::consts::OS).ok_or("That isn't supported on this computer.")?;
    let mut cmd = std::process::Command::new(program);
    cmd.args(args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("Couldn't run {program}: {e}"))
}

/// A link we are willing to hand to the system browser: plain http(s), no whitespace, a sane length.
fn web_url(url: &str) -> Result<&str, String> {
    let u = url.trim();
    let ok = (u.starts_with("https://") || u.starts_with("http://")) && u.len() <= 2048 && !u.contains(char::is_whitespace);
    if ok { Ok(u) } else { Err("That isn't a web link Kaisu can open.".into()) }
}

/// Opens a web page in the default browser.
#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let u = web_url(&url)?;
    app.opener().open_url(u, None::<&str>).map_err(|e| format!("Couldn't open the browser: {e}"))
}

/// For each path: does it still exist as a file? Used to flag history entries whose file was moved.
#[tauri::command]
pub fn file_exists(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).is_file()).collect()
}

/// Opens a downloaded file in the system's default player.
#[tauri::command]
pub fn open_file(app: AppHandle, path: String) -> Result<(), String> {
    let p = media_file(&path)?;
    app.opener().open_path(p.display().to_string(), None::<&str>).map_err(|e| format!("Couldn't open the file: {e}"))
}

/// Shows a downloaded file in the system file manager.
#[tauri::command]
pub fn reveal_file(app: AppHandle, path: String) -> Result<(), String> {
    let p = media_file(&path)?;
    app.opener().reveal_item_in_dir(p).map_err(|e| format!("Couldn't show the file: {e}"))
}

/// Shows the yt-dlp executable Kaisu is using (Advanced settings). No path is taken from the caller.
#[tauri::command]
pub async fn reveal_engine(app: AppHandle, engine: State<'_, Engine>) -> Result<(), String> {
    let path = engine.ytdlp_path(&app).await?;
    app.opener().reveal_item_in_dir(path).map_err(|e| format!("Couldn't show the folder: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kaisu-files-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn accepts_existing_media_files_of_any_case() {
        let ok = temp("clip.MP4");
        fs::write(&ok, b"x").unwrap();
        assert_eq!(media_file(ok.to_str().unwrap()).unwrap(), ok);
        let _ = fs::remove_file(ok);
    }

    #[test]
    fn rejects_programs_scripts_and_documents() {
        for name in ["run.exe", "run.sh", "x.desktop", "x.lnk", "x.bat", "x.txt", "noext"] {
            let p = temp(name);
            fs::write(&p, b"x").unwrap();
            assert!(media_file(p.to_str().unwrap()).is_err(), "{name} must not be openable");
            let _ = fs::remove_file(p);
        }
    }

    #[test]
    fn rejects_relative_missing_and_directories() {
        assert!(media_file("clip.mp4").is_err());
        assert_eq!(media_file(temp("gone.mp4").to_str().unwrap()).unwrap_err(), GONE);
        let dir = temp("folder.mp4");
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(media_file(dir.to_str().unwrap()).unwrap_err(), GONE);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn power_actions_map_to_real_commands_per_os() {
        assert_eq!(power_command(PowerAction::Sleep, "linux"), Some(("systemctl", &["suspend"][..])));
        assert_eq!(power_command(PowerAction::Shutdown, "linux"), Some(("systemctl", &["poweroff"][..])));
        assert_eq!(power_command(PowerAction::Shutdown, "windows"), Some(("shutdown", &["/s", "/t", "0"][..])));
        assert_eq!(power_command(PowerAction::Sleep, "windows").map(|c| c.0), Some("rundll32.exe"));
        assert_eq!(power_command(PowerAction::Sleep, "plan9"), None);
    }

    #[test]
    fn open_folder_requires_an_existing_absolute_directory() {
        let dir = temp("a-folder");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(dir.is_absolute() && dir.is_dir());
        assert!(!PathBuf::from("relative/dir").is_absolute());
        let _ = std::fs::remove_dir(dir);
    }

    #[test]
    fn only_plain_web_links_open_in_the_browser() {
        assert!(web_url(" https://www.youtube.com/watch?v=abc ").is_ok());
        assert!(web_url("http://example.com").is_ok());
        for bad in ["file:///etc/passwd", "javascript:alert(1)", "ftp://x", "https://a b", "calc.exe", "", "-flag", "mailto:a@b.c"] {
            assert!(web_url(bad).is_err(), "{bad}");
        }
        assert!(web_url(&format!("https://a.b/{}", "x".repeat(3000))).is_err());
    }

    #[test]
    fn existence_check_is_per_path() {
        let ok = temp("here.mp3");
        fs::write(&ok, b"x").unwrap();
        let got = file_exists(vec![ok.display().to_string(), temp("nope.mp3").display().to_string()]);
        assert_eq!(got, [true, false]);
        let _ = fs::remove_file(ok);
    }
}
