//! Playing, previewing and converting media inside Kaisu.
//!
//! - **Playing:** `play_in_app` returns a capability URL for one authorized media file. The loopback stream supports
//!   byte ranges and native decoders, including Linux decoders that cannot read the webview's custom asset scheme.
//! - **Preview:** a short, low-quality copy of the start of a video is downloaded into the app's cache, played, and
//!   deleted afterwards. The page never loads anything from the internet itself, so previews work through the proxy and
//!   the same checks as every other download.
//! - **Convert later:** a finished download is turned into an audio file next to it. The original is never touched and
//!   never overwritten.

use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::{
    download::Downloads,
    engine::{self, Engine},
    net, proc,
    scope::Scope,
    transfer::unique_name,
};

const PREVIEW_SECONDS: u32 = 20;
const PREVIEW_TIMEOUT: Duration = Duration::from_secs(150);
const CONVERT_TIMEOUT: Duration = Duration::from_secs(30 * 60);

// ---- playing ---------------------------------------------------------------------------------

/// Prepares one media file in a registered download, moved, or imported library folder for streaming.
#[tauri::command]
pub fn play_in_app(app: AppHandle, scope: State<'_, Scope>, stream: State<'_, crate::media_stream::MediaStream>, path: String) -> Result<String, String> {
    let real = scope.media_file(&path)?;
    stream.authorize(&app, real)
}

// ---- preview ---------------------------------------------------------------------------------

fn preview_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_cache_dir().map(|d| d.join("preview")).map_err(|e| format!("Cannot find the cache folder: {e}"))
}

/// The arguments for a small, quick copy of the start of a video: the lowest quality that browsers can play.
fn preview_args(dir: &Path, url: &str, ffmpeg_dir: &Path, js_runtime: Option<&str>) -> Vec<String> {
    let mut a: Vec<String> = [
        "--no-playlist",
        "--no-warnings",
        "--no-part",
        "--windows-filenames",
        "--restrict-filenames",
        "--force-overwrites",
        "--download-sections",
    ]
    .map(String::from)
    .into();
    a.push(format!("*0-{PREVIEW_SECONDS}"));
    a.extend(["-f", "wv*[ext=mp4]+wa[ext=m4a]/w[ext=mp4]/wv*+wa/w", "--merge-output-format", "mp4/mkv", "--trim-filenames", "60", "-o", "%(id)s.%(ext)s"].map(String::from));
    a.extend(["--print", "after_move:%(filepath)s"].map(String::from));
    a.extend(["--ffmpeg-location".into(), ffmpeg_dir.display().to_string(), "-P".into(), dir.display().to_string()]);
    if let Some(js) = js_runtime {
        a.extend(["--js-runtimes".into(), js.to_string()]);
    }
    a.push("--".into());
    a.push(url.to_string());
    a
}

/// Downloads the first seconds of a video at low quality into the cache, and lets the page play it. Returns the file's path.
#[tauri::command]
pub async fn preview_clip(app: AppHandle, engine: State<'_, Engine>, downloads: State<'_, Downloads>, url: String, proxy: Option<String>) -> Result<String, String> {
    let url = crate::download::validate_url(&url)?.to_string();
    let proxy = net::proxy_option(proxy.as_deref())?;
    let ytdlp = engine.ytdlp_path(&app).await?;
    let (ffmpeg_dir, _) = engine::locate_ffmpeg(&app).ok_or("The media converter (ffmpeg) isn't installed yet. Open Setup to install it.")?;
    let js = engine::locate_js_runtime(&app).map(|rt| rt.arg());
    let dir = preview_dir(&app)?;
    // A preview isn't worth slowing real downloads down for.
    if !downloads.is_idle() {
        return Err("Previews wait until your downloads have finished.".into());
    }
    clear_dir(&dir);
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot prepare the preview folder: {e}"))?;

    let args = preview_args(&dir, &url, &ffmpeg_dir, js.as_deref());
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = proc::run_capture_proxied(&ytdlp, &refs, PREVIEW_TIMEOUT, proxy.as_deref()).await?;
    let file = out.lines().map(str::trim).rfind(|l| !l.is_empty()).ok_or("The preview didn't produce a file.")?;
    let real = fs::canonicalize(file).map_err(|_| "The preview didn't produce a file.".to_string())?;
    let real_dir = fs::canonicalize(&dir).map_err(|e| e.to_string())?;
    if !real.starts_with(&real_dir) || !real.is_file() {
        return Err("The preview didn't produce a file.".into());
    }
    app.asset_protocol_scope().allow_file(&real).map_err(|e| format!("Couldn't prepare the preview for playing: {e}"))?;
    Ok(real.display().to_string())
}

fn clear_dir(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.flatten() {
            let _ = fs::remove_file(e.path());
        }
    }
}

/// Deletes a preview once it has been watched. Only files in the preview folder can be removed this way.
#[tauri::command]
pub fn discard_preview(app: AppHandle, path: String) -> Result<(), String> {
    let dir = fs::canonicalize(preview_dir(&app)?).map_err(|_| "There is no preview.".to_string())?;
    let real = fs::canonicalize(&path).map_err(|_| "There is no preview.".to_string())?;
    if !real.starts_with(&dir) || !real.is_file() {
        return Err("That isn't a preview.".into());
    }
    fs::remove_file(real).map_err(|e| format!("Couldn't remove the preview: {e}"))
}

/// Removes previews left over from an earlier run.
pub fn clean_previews(app: &AppHandle) {
    if let Ok(dir) = preview_dir(app) {
        clear_dir(&dir);
    }
}

// ---- convert later ---------------------------------------------------------------------------

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum AudioTarget {
    Mp3,
    M4a,
    Opus,
    Flac,
    Wav,
}

impl AudioTarget {
    fn ext(self) -> &'static str {
        match self {
            AudioTarget::Mp3 => "mp3",
            AudioTarget::M4a => "m4a",
            AudioTarget::Opus => "opus",
            AudioTarget::Flac => "flac",
            AudioTarget::Wav => "wav",
        }
    }

    /// The ffmpeg encoder options. All of these encoders are in the LGPL build Kaisu downloads.
    fn codec_args(self) -> &'static [&'static str] {
        match self {
            AudioTarget::Mp3 => &["-c:a", "libmp3lame", "-b:a", "192k"],
            AudioTarget::M4a => &["-c:a", "aac", "-b:a", "192k"],
            AudioTarget::Opus => &["-c:a", "libopus", "-b:a", "128k"],
            AudioTarget::Flac => &["-c:a", "flac"],
            AudioTarget::Wav => &["-c:a", "pcm_s16le"],
        }
    }
}

/// Where the converted file goes: next to the original, same name, new extension, never over an existing file.
fn convert_target(input: &Path, target: AudioTarget) -> PathBuf {
    unique_name(&input.with_extension(target.ext()))
}

fn convert_args(input: &Path, output: &Path, target: AudioTarget) -> Vec<String> {
    let mut a: Vec<String> = ["-nostdin", "-hide_banner", "-loglevel", "error", "-n", "-i"].map(String::from).into();
    a.push(input.display().to_string());
    // Sound only: the first audio stream, no picture, with the tags of the original.
    a.extend(["-vn", "-map", "0:a:0", "-map_metadata", "0"].map(String::from));
    a.extend(target.codec_args().iter().map(|s| s.to_string()));
    a.push(output.display().to_string());
    a
}

#[derive(Serialize)]
pub struct Converted {
    pub path: String,
}

/// Makes an audio copy of a finished download, next to it. The original stays as it is.
#[tauri::command]
pub async fn convert_audio(app: AppHandle, scope: State<'_, Scope>, downloads: State<'_, Downloads>, path: String, format: AudioTarget) -> Result<Converted, String> {
    let input = scope.media_file(&path)?;
    let (ffmpeg_dir, _) = engine::locate_ffmpeg(&app).ok_or("The media converter (ffmpeg) isn't installed yet. Open Setup to install it.")?;
    let ffmpeg = ffmpeg_dir.join(format!("ffmpeg{}", engine::EXE));
    if input.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case(format.ext())) {
        return Err(format!("This is already a .{} file.", format.ext()));
    }
    // Converting is heavy work; let running downloads finish their own conversions first.
    if !downloads.is_idle() {
        return Err("Converting waits until your downloads have finished.".into());
    }
    let output = convert_target(&input, format);
    let args = convert_args(&input, &output, format);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    match proc::run_capture(&ffmpeg, &refs, CONVERT_TIMEOUT).await {
        Ok(_) if output.is_file() => Ok(Converted { path: crate::scope::plain_path(&output) }),
        Ok(_) => Err("The conversion didn't produce a file.".into()),
        Err(e) => {
            let _ = fs::remove_file(&output);
            Err(format!("Couldn't convert it: {e}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_converted_file_sits_next_to_the_original_and_never_replaces_anything() {
        let dir = std::env::temp_dir().join(format!("kaisu-conv-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let input = dir.join("Song [abc].mp4");
        fs::write(&input, b"x").unwrap();
        assert_eq!(convert_target(&input, AudioTarget::Mp3), dir.join("Song [abc].mp3"));
        fs::write(dir.join("Song [abc].mp3"), b"old").unwrap();
        assert_eq!(convert_target(&input, AudioTarget::Mp3), dir.join("Song [abc] (2).mp3"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn conversion_arguments_take_sound_only_and_refuse_to_overwrite() {
        let a = convert_args(Path::new("/dl/a.mp4"), Path::new("/dl/a.mp3"), AudioTarget::Mp3);
        assert!(a.windows(2).any(|w| w == ["-i", "/dl/a.mp4"]) && a.last().unwrap() == "/dl/a.mp3");
        assert!(a.contains(&"-vn".to_string()) && a.contains(&"-n".to_string()), "no video, and -n never overwrites");
        assert!(a.windows(2).any(|w| w == ["-c:a", "libmp3lame"]));
        for (target, codec) in [(AudioTarget::M4a, "aac"), (AudioTarget::Opus, "libopus"), (AudioTarget::Flac, "flac"), (AudioTarget::Wav, "pcm_s16le")] {
            assert!(convert_args(Path::new("/a"), Path::new("/b"), target).windows(2).any(|w| w == ["-c:a", codec]), "{codec}");
        }
    }

    #[test]
    fn only_known_formats_can_be_asked_for() {
        assert_eq!(serde_json::from_str::<AudioTarget>("\"opus\"").unwrap(), AudioTarget::Opus);
        for bad in ["\"exe\"", "\"mp4\"", "\"-f x\"", "\"\""] {
            assert!(serde_json::from_str::<AudioTarget>(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_preview_is_short_small_and_named_by_id() {
        let a = preview_args(Path::new("/cache/preview"), "https://www.youtube.com/watch?v=abc", Path::new("/ff"), None);
        assert!(a.windows(2).any(|w| w[0] == "--download-sections" && w[1] == "*0-20"));
        assert!(a.windows(2).any(|w| w[0] == "-f" && w[1].starts_with("wv*")), "the lowest quality");
        assert!(a.windows(2).any(|w| w == ["-P", "/cache/preview"]) && a.windows(2).any(|w| w == ["-o", "%(id)s.%(ext)s"]));
        let n = a.len();
        assert_eq!(&a[n - 2..], ["--", "https://www.youtube.com/watch?v=abc"], "the link comes after `--`");
    }
}
