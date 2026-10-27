//! Opening downloaded files. Done here rather than in the webview so only real media files can
//! be launched: a damaged history entry (or a pasted path) must never start an arbitrary program.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::engine::Engine;

/// Everything yt-dlp/ffmpeg can produce from Kaisu's presets, plus common neighbours.
pub(crate) const MEDIA_EXTENSIONS: &[&str] = &[
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

#[derive(serde::Serialize, Debug, PartialEq, Eq)]
pub struct FileInfo {
    pub exists: bool,
    pub size: u64,
}

/// Whether each downloaded file is still there and how big it is (for the history page).
#[tauri::command]
pub fn file_info(paths: Vec<String>) -> Vec<FileInfo> {
    paths
        .iter()
        .take(5000)
        .map(|p| {
            let path = PathBuf::from(p);
            match std::fs::metadata(&path) {
                Ok(m) if path.is_absolute() && m.is_file() => FileInfo { exists: true, size: m.len() },
                _ => FileInfo { exists: false, size: 0 },
            }
        })
        .collect()
}

const MAX_EXPORT_BYTES: usize = 20 * 1024 * 1024;

/// Asks the user where to save an export and writes it there. The dialog is opened here, so the webview cannot choose the
/// path itself: it can only offer a name and contents. Only .csv, .json and playlists (.m3u/.m3u8). Returns the saved path,
/// or nothing if the user cancelled.
#[tauri::command]
pub async fn export_text(app: AppHandle, title: String, default_name: String, extension: String, contents: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let extension = extension.to_ascii_lowercase();
    if !["csv", "json", "m3u", "m3u8"].contains(&extension.as_str()) {
        return Err("Exports are saved as .csv, .json or .m3u8.".into());
    }
    if contents.len() > MAX_EXPORT_BYTES {
        return Err("That export is too large.".into());
    }
    let name = Path::new(&default_name).file_name().and_then(|n| n.to_str()).unwrap_or("export").to_string();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title(title.chars().take(100).collect::<String>()).set_file_name(name).add_filter(extension.to_uppercase(), &[extension.as_str()]).blocking_save_file()
    }).await.map_err(|e| e.to_string())?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    write_export(&path, &contents)?;
    Ok(Some(path.display().to_string()))
}

const MAX_LINK_FILE: u64 = 2 * 1024 * 1024;

#[derive(serde::Serialize)]
pub struct LinkFile { pub name: String, pub text: String }

/// Reads a small text file of links. Binary files and anything over 2 MB are refused.
fn read_link_text(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|e| format!("Couldn't open that file: {e}"))?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() { return Err("Choose a text or CSV file.".into()); }
    if meta.len() > MAX_LINK_FILE { return Err("That file is larger than 2 MB. Split it into smaller lists.".into()); }
    let mut bytes = Vec::new();
    file.take(MAX_LINK_FILE + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_LINK_FILE { return Err("That file is larger than 2 MB. Split it into smaller lists.".into()); }
    if bytes.contains(&0) { return Err("That doesn't look like a text file.".into()); }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Asks the user for a text or CSV file of links and returns its contents. The dialog is opened here, so the page cannot
/// choose which file is read.
#[tauri::command]
pub async fn pick_link_file(app: AppHandle) -> Result<Option<LinkFile>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title("Choose a file of links").add_filter("Text or CSV", &["txt", "csv", "tsv", "md", "list"]).blocking_pick_file()
    }).await.map_err(|e| e.to_string())?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("links").chars().take(120).collect();
    let text = tauri::async_runtime::spawn_blocking(move || read_link_text(&path)).await.map_err(|e| e.to_string())??;
    Ok(Some(LinkFile { name, text }))
}

fn write_export(p: &Path, contents: &str) -> Result<(), String> {
    if !p.is_absolute() {
        return Err("Not a valid file location.".into());
    }
    let ext = p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    if !["csv", "json", "m3u", "m3u8"].contains(&ext.as_str()) {
        return Err("Exports are saved as .csv, .json or .m3u8.".into());
    }
    if contents.len() > MAX_EXPORT_BYTES {
        return Err("That export is too large.".into());
    }
    if p.is_dir() {
        return Err("Pick a file name, not a folder.".into());
    }
    if !p.parent().is_some_and(|d| d.is_dir()) {
        return Err("That folder doesn't exist.".into());
    }
    std::fs::write(p, contents).map_err(|e| format!("Couldn't save the file: {e}"))
}

#[derive(serde::Serialize, Debug)]
pub struct FolderCheck {
    pub exists: bool,
    pub free: u64,
}

/// Longest folder path we accept on Windows, leaving room for the file name inside the old 260-character limit.
const MAX_FOLDER_CHARS_WINDOWS: usize = 150;

const WINDOWS_RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7",
    "LPT8", "LPT9",
];

/// Problems with a folder name that depend only on the text (so they can be tested anywhere).
fn folder_text_problem(path: &str, windows: bool) -> Option<String> {
    if path.chars().any(char::is_control) || path.split(['/', '\\']).any(|p| p == "..") {
        return Some("Use a full download folder without parent-directory shortcuts or control characters.".into());
    }
    if path.trim().is_empty() {
        return Some("Choose a download folder.".into());
    }
    // Judged by the text alone (and by the `windows` flag, not the OS this runs on), so it behaves the same everywhere.
    let absolute = if windows {
        let b = path.as_bytes();
        (b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')) || path.starts_with("\\\\")
    } else {
        path.starts_with('/')
    };
    if !absolute {
        return Some("The download folder must be a full path.".into());
    }
    if windows {
        if path.starts_with(r"\\.\") || path.starts_with(r"\\?\") || path.chars().any(|c| "<>\"|?*".contains(c)) {
            return Some("Choose a normal drive or network folder, without device paths or invalid characters.".into());
        }
        if path.chars().count() > MAX_FOLDER_CHARS_WINDOWS {
            return Some(format!("That folder's path is too long for Windows (over {MAX_FOLDER_CHARS_WINDOWS} characters). Choose a shorter one."));
        }
        for part in path.split(['\\', '/']) {
            let stem = part.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
            if WINDOWS_RESERVED.contains(&stem.as_str()) {
                return Some(format!("\"{part}\" is a reserved name on Windows and can't be used for a folder."));
            }
            if part.ends_with(' ') || (part.ends_with('.') && part != "." && part != "..") {
                return Some(format!("Windows doesn't allow folder names that end with a space or a dot (\"{part}\")."));
            }
        }
    }
    None
}

/// Checks that downloads can really go into this folder: it is (or can be made) a folder, it can be written to, and how
/// much space is left. Nothing is created.
#[tauri::command]
pub fn check_folder(path: String) -> Result<FolderCheck, String> {
    if let Some(problem) = folder_text_problem(&path, cfg!(windows)) {
        return Err(problem);
    }
    let dir = PathBuf::from(&path);
    if dir.is_file() {
        return Err("That is a file, not a folder.".into());
    }
    let mut probe = dir.as_path();
    while !probe.exists() {
        probe = probe.parent().ok_or("That folder's drive isn't available.")?;
    }
    if !probe.is_dir() {
        return Err("That location isn't a folder.".into());
    }
    let test = probe.join(format!(".kaisu-write-test-{}", uuid::Uuid::new_v4()));
    let handle = std::fs::OpenOptions::new().write(true).create_new(true).open(&test).map_err(|_| {
        if probe == dir { "Kaisu can't write to that folder. Choose another one.".to_string() } else { format!("Kaisu can't create the folder inside {}.", probe.display()) }
    })?;
    drop(handle);
    let _ = std::fs::remove_file(&test);
    let free = crate::download::free_space_for(&dir)?;
    Ok(FolderCheck { exists: dir.is_dir(), free })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn link_files_must_be_small_text_files() {
        let dir = std::env::temp_dir().join(format!("kaisu-links-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let list = dir.join("list.csv");
        fs::write(&list, "url,title
https://example.com/a,A
").unwrap();
        assert!(read_link_text(&list).unwrap().contains("https://example.com/a"));
        fs::write(dir.join("bin"), [1u8, 0, 2]).unwrap();
        assert!(read_link_text(&dir.join("bin")).unwrap_err().contains("text file"));
        fs::write(dir.join("big"), vec![b'a'; (MAX_LINK_FILE + 1) as usize]).unwrap();
        assert!(read_link_text(&dir.join("big")).unwrap_err().contains("2 MB"));
        assert!(read_link_text(&dir).is_err());
        fs::remove_dir_all(dir).ok();
    }

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

    #[test]
    fn file_info_reports_existing_and_missing() {
        let dir = std::env::temp_dir().join(format!("kaisu-fi-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.mp4");
        std::fs::write(&f, b"12345").unwrap();
        let info = file_info(vec![f.display().to_string(), dir.join("nope.mp4").display().to_string(), dir.display().to_string(), "relative.mp4".into()]);
        assert_eq!(info[0], FileInfo { exists: true, size: 5 });
        assert!(!info[1].exists && !info[2].exists && !info[3].exists);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn export_is_restricted() {
        let dir = std::env::temp_dir().join(format!("kaisu-ex-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(write_export(&dir.join("h.csv"), "a,b").is_ok());
        assert_eq!(std::fs::read_to_string(dir.join("h.csv")).unwrap(), "a,b");
        assert!(write_export(&dir.join("h.json"), "[]").is_ok());
        assert!(write_export(&dir.join("p.m3u8"), "#EXTM3U").is_ok());
        assert!(write_export(&dir.join("h.exe"), "x").is_err());
        assert!(write_export(&dir, "x").is_err());
        assert!(write_export(Path::new("h.csv"), "x").is_err());
        assert!(write_export(&dir.join("missing").join("h.csv"), "x").is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn folder_names_are_checked_by_text() {
        assert!(folder_text_problem("", false).is_some());
        assert!(folder_text_problem("relative/dir", false).is_some());
        assert!(folder_text_problem("/home/u/Music", false).is_none());
        assert!(folder_text_problem("C:\\Users\\u\\Music", true).is_none());
        assert!(folder_text_problem("C:\\Users\\CON\\x", true).is_some());
        assert!(folder_text_problem("C:\\Users\\nul.txt", true).is_some());
        assert!(folder_text_problem("C:\\Users\\u\\Music.", true).is_some());
        assert!(folder_text_problem(&format!("C:\\{}", "a".repeat(200)), true).is_some());
        assert!(folder_text_problem("/home/u/CON", false).is_none(), "reserved names only matter on Windows");
    }

    #[test]
    fn folder_check_finds_space_and_refuses_files() {
        let dir = std::env::temp_dir().join(format!("kaisu-fc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = check_folder(dir.join("not-made-yet").display().to_string()).unwrap();
        assert!(!ok.exists && ok.free > 0);
        assert!(check_folder(dir.display().to_string()).unwrap().exists);
        let file = dir.join("f.txt");
        std::fs::write(&file, b"x").unwrap();
        assert!(check_folder(file.display().to_string()).is_err());
        assert!(!dir.join("not-made-yet").exists(), "checking must not create anything");
        std::fs::remove_dir_all(&dir).ok();
    }
}
