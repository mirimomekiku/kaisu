//! Download and inspect commands. The frontend sends a typed request; the argument list is
//! built here, so no free-form text reaches yt-dlp's option parser except the validated
//! "custom arguments" field that advanced users can opt into.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, ipc::Channel};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::{
    engine::{self, Engine},
    proc,
};

const NO_FFMPEG: &str = "The media converter (ffmpeg) isn't installed yet. Open Setup to install it.";

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    Best,
    P1080,
    P720,
    #[serde(alias = "audio_mp3")]
    Audio,
}

#[derive(Deserialize, Clone, Copy, Default)]
#[serde(rename_all = "snake_case")]
pub enum AudioFormat {
    #[default]
    Mp3,
    M4a,
    Opus,
    Flac,
    Wav,
}

impl AudioFormat {
    fn as_arg(self) -> &'static str {
        match self {
            AudioFormat::Mp3 => "mp3",
            AudioFormat::M4a => "m4a",
            AudioFormat::Opus => "opus",
            AudioFormat::Flac => "flac",
            AudioFormat::Wav => "wav",
        }
    }
}

#[derive(Deserialize, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SponsorBlock {
    #[default]
    Off,
    Mark,
    Remove,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum Browser {
    Firefox,
    Chrome,
    Chromium,
    Edge,
    Brave,
    Opera,
    Vivaldi,
}

impl Browser {
    fn as_arg(self) -> &'static str {
        match self {
            Browser::Firefox => "firefox",
            Browser::Chrome => "chrome",
            Browser::Chromium => "chromium",
            Browser::Edge => "edge",
            Browser::Brave => "brave",
            Browser::Opera => "opera",
            Browser::Vivaldi => "vivaldi",
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ExtraOptions {
    pub sponsorblock: SponsorBlock,
    pub cookies_from_browser: Option<Browser>,
    pub subtitles: bool,
    pub audio_format: AudioFormat,
    /// A specific yt-dlp format id (or `video+audio`), instead of the preset's selector.
    pub format_id: Option<String>,
    /// e.g. `500K` or `2M`.
    pub rate_limit: Option<String>,
    /// Advanced users' own yt-dlp options. Validated by `parse_custom_args`.
    pub custom_args: Option<String>,
    /// Forward yt-dlp's normal console output to the log.
    pub verbose: bool,
}

#[derive(Deserialize)]
pub struct DownloadRequest {
    pub id: String,
    pub url: String,
    pub preset: Preset,
    pub out_dir: PathBuf,
    #[serde(default)]
    pub extra: ExtraOptions,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DownloadEvent {
    Progress { pct: f32, speed: Option<f64>, eta: Option<u64> },
    Processing,
    Log { line: String },
    Done { path: Option<String> },
    Cancelled,
    Error { message: String },
}

struct Active {
    pid: u32,
    cancelled: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Downloads {
    active: Mutex<HashMap<String, Active>>,
}

impl Downloads {
    pub fn is_idle(&self) -> bool {
        self.active.lock().map(|m| m.is_empty()).unwrap_or(true)
    }
}

// ---- validation ---------------------------------------------------------------------

fn validate_url(url: &str) -> Result<&str, String> {
    let url = url.trim();
    let ok = (url.starts_with("http://") || url.starts_with("https://")) && !url.contains(char::is_whitespace);
    if ok { Ok(url) } else { Err("Enter a full web link (starting with http:// or https://) without spaces.".into()) }
}

fn validate_format_id(id: &str) -> Result<&str, String> {
    let ok = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || "_.*+-".contains(c));
    if ok { Ok(id) } else { Err("That format isn't valid.".into()) }
}

fn validate_rate_limit(limit: &str) -> Result<&str, String> {
    let digits = limit.trim_end_matches(['K', 'k', 'M', 'm']);
    let ok = !digits.is_empty()
        && limit.len() - digits.len() <= 1
        && digits.chars().all(|c| c.is_ascii_digit() || c == '.')
        && digits.matches('.').count() <= 1;
    if ok { Ok(limit) } else { Err("Speed limit must look like 500K or 2M.".into()) }
}

/// Options that make yt-dlp run programs or read arbitrary config. They are blocked even for
/// advanced users, because people routinely paste "recipes" from the internet.
const DENIED_OPTIONS: &[&str] = &[
    "--exec",
    "--exec-before-download",
    "--netrc-cmd",
    "--plugin-dirs",
    "--config-locations",
    "--config-location",
    "--print-to-file",
];

/// Splits like a shell: whitespace separates, single or double quotes group.
fn split_args(input: &str) -> Result<Vec<String>, String> {
    let (mut out, mut cur, mut quote, mut has_token) = (Vec::new(), String::new(), None::<char>, false);
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some('"'), '\\') if matches!(chars.peek(), Some('"') | Some('\\')) => cur.push(chars.next().unwrap()),
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => {
                quote = Some(c);
                has_token = true;
            }
            (None, c) if c.is_whitespace() => {
                if has_token || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    has_token = false;
                }
            }
            (None, c) => cur.push(c),
        }
    }
    if quote.is_some() {
        return Err("Custom arguments have an unclosed quote.".into());
    }
    if has_token || !cur.is_empty() {
        out.push(cur);
    }
    Ok(out)
}

fn parse_custom_args(input: &str) -> Result<Vec<String>, String> {
    if input.len() > 2000 || input.contains('\0') {
        return Err("Custom arguments are too long or contain invalid characters.".into());
    }
    let tokens = split_args(input)?;
    for t in &tokens {
        if t == "--" {
            return Err("Custom arguments can't contain a bare `--`.".into());
        }
        if let Some(rest) = t.strip_prefix("--") {
            // yt-dlp accepts unambiguous abbreviations, so match on prefixes too.
            let name = format!("--{}", rest.split('=').next().unwrap_or_default().to_lowercase());
            if name.len() > 2 && DENIED_OPTIONS.iter().any(|d| d.starts_with(&name)) {
                return Err(format!("`{t}` isn't allowed because it can run programs on your computer."));
            }
        }
    }
    Ok(tokens)
}

// ---- argument building ------------------------------------------------------------------

fn build_args(
    req: &DownloadRequest,
    url: &str,
    ffmpeg_dir: &std::path::Path,
    js_runtime: Option<&str>,
) -> Result<Vec<String>, String> {
    let extra = &req.extra;
    let mut a: Vec<String> = Vec::new();
    let mut push = |items: &[&str]| a.extend(items.iter().map(|s| s.to_string()));

    push(&["--no-playlist", "--newline", "--progress", "--progress-delta", "0.25"]);
    push(&["--windows-filenames", "--concurrent-fragments", "4"]);
    if extra.verbose {
        push(&["--no-quiet"]);
    } else {
        push(&["--no-warnings"]);
    }
    push(&[
        "--progress-template",
        "download:KAISU|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s",
    ]);
    push(&["--progress-template", "postprocess:KAISU_PP|%(progress.status)s"]);
    push(&["--print", "after_move:KAISU_DONE|%(filepath)s"]);
    push(&["-o", "%(title).150B [%(id)s].%(ext)s"]);

    let custom_format = extra.format_id.as_deref().map(validate_format_id).transpose()?;
    match req.preset {
        Preset::Audio => {
            push(&["-f", custom_format.unwrap_or("ba/b"), "-x", "--audio-format", extra.audio_format.as_arg()]);
            push(&["--audio-quality", "0", "--embed-metadata"]);
            // WAV can't carry cover art.
            if !matches!(extra.audio_format, AudioFormat::Wav) {
                push(&["--embed-thumbnail", "--convert-thumbnails", "jpg"]);
            }
        }
        video => {
            match custom_format {
                Some(id) => push(&["-f", id]),
                None => {
                    let selector = match video {
                        Preset::P1080 => "bv*[height<=1080]+ba/b[height<=1080]",
                        Preset::P720 => "bv*[height<=720]+ba/b[height<=720]",
                        _ => "bv*+ba/b",
                    };
                    push(&["-f", selector, "-S", "res,ext:mp4:m4a"]);
                }
            }
            // "mp4/mkv": use MP4 when the streams fit, fall back to MKV instead of failing.
            push(&["--merge-output-format", "mp4/mkv"]);
        }
    }

    match extra.sponsorblock {
        SponsorBlock::Off => {}
        SponsorBlock::Mark => push(&["--sponsorblock-mark", "all"]),
        SponsorBlock::Remove => push(&["--sponsorblock-remove", "sponsor,selfpromo,interaction"]),
    }
    if extra.subtitles && !matches!(req.preset, Preset::Audio) {
        push(&["--write-subs", "--sub-langs", "en.*", "--embed-subs"]);
    }
    if let Some(b) = extra.cookies_from_browser {
        push(&["--cookies-from-browser", b.as_arg()]);
    }
    if let Some(limit) = extra.rate_limit.as_deref().filter(|l| !l.trim().is_empty()) {
        push(&["--limit-rate", validate_rate_limit(limit.trim())?]);
    }

    if let Some(js) = js_runtime {
        push(&["--js-runtimes", js]);
    }
    a.push("--ffmpeg-location".into());
    a.push(ffmpeg_dir.display().to_string());
    a.push("-P".into());
    a.push(req.out_dir.display().to_string());
    if let Some(custom) = extra.custom_args.as_deref().filter(|c| !c.trim().is_empty()) {
        a.extend(parse_custom_args(custom)?);
    }
    // Everything after `--` is a positional URL, never an option.
    a.push("--".into());
    a.push(url.to_string());
    Ok(a)
}

fn parse_num<T: std::str::FromStr>(s: &str) -> Option<T> {
    match s.trim() {
        "" | "NA" | "None" => None,
        v => v.parse().ok(),
    }
}

/// Tracks overall progress across yt-dlp's separate video and audio streams.
struct ProgressState {
    expected_streams: f32,
    stream_index: f32,
    last_format: Option<String>,
}

impl ProgressState {
    fn new(preset: Preset) -> Self {
        let expected_streams = if matches!(preset, Preset::Audio) { 1.0 } else { 2.0 };
        Self { expected_streams, stream_index: 0.0, last_format: None }
    }

    fn handle(&mut self, line: &str) -> Option<DownloadEvent> {
        let f: Vec<&str> = line.split('|').collect();
        let downloaded: f64 = parse_num(f.get(1)?)?;
        let total: Option<f64> = parse_num(f.get(2)?).or_else(|| parse_num(f.get(3).copied()?));
        let speed = f.get(4).and_then(|s| parse_num::<f64>(s));
        let eta = f.get(5).and_then(|s| parse_num::<f64>(s)).map(|e| e as u64);
        let format = f.get(6).map(|s| s.trim().to_string());

        if format != self.last_format {
            if self.last_format.is_some() {
                self.stream_index += 1.0;
            }
            self.last_format = format;
        }

        let within = total.filter(|t| *t > 0.0).map(|t| (downloaded / t).clamp(0.0, 1.0) as f32).unwrap_or(0.0);
        let idx = self.stream_index.min(self.expected_streams - 1.0);
        let pct = ((idx + within) / self.expected_streams * 100.0).min(99.0);
        Some(DownloadEvent::Progress { pct, speed, eta })
    }
}

// ---- commands ---------------------------------------------------------------------------

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    engine: State<'_, Engine>,
    downloads: State<'_, Downloads>,
    req: DownloadRequest,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let result = run_download(&app, &engine, &downloads, &req, &on_event).await;
    if let Err(message) = &result {
        let _ = on_event.send(DownloadEvent::Error { message: message.clone() });
    }
    result
}

async fn run_download(
    app: &AppHandle,
    engine: &Engine,
    downloads: &Downloads,
    req: &DownloadRequest,
    on_event: &Channel<DownloadEvent>,
) -> Result<(), String> {
    let url = validate_url(&req.url)?;
    tokio::fs::create_dir_all(&req.out_dir)
        .await
        .map_err(|e| format!("Cannot use folder {}: {e}", req.out_dir.display()))?;

    let ytdlp = engine.ytdlp_path(app).await?;
    let (ffmpeg_dir, _) = engine::locate_ffmpeg(app).ok_or(NO_FFMPEG)?;
    let js = engine::locate_js_runtime(app).map(|rt| rt.arg());
    let args = build_args(req, url, &ffmpeg_dir, js.as_deref())?;

    let mut child = proc::command(&ytdlp).args(&args).spawn().map_err(|e| format!("Failed to start yt-dlp: {e}"))?;
    let pid = child.id().ok_or("yt-dlp exited immediately")?;
    let cancelled = Arc::new(AtomicBool::new(false));
    downloads
        .active
        .lock()
        .map_err(|_| "download state poisoned")?
        .insert(req.id.clone(), Active { pid, cancelled: cancelled.clone() });

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    let log_channel = on_event.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut buf = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = log_channel.send(DownloadEvent::Log { line: line.clone() });
            buf.push_str(&line);
            buf.push('\n');
            if buf.len() > 16_384 {
                buf = buf.split_off(buf.len() - 8_192);
            }
        }
        buf
    });

    let mut progress = ProgressState::new(req.preset);
    let mut final_path: Option<String> = None;
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(rest) = line.strip_prefix("KAISU|") {
            if let Some(ev) = progress.handle(&format!("KAISU|{rest}")) {
                let _ = on_event.send(ev);
            }
        } else if let Some(rest) = line.strip_prefix("KAISU_PP|") {
            if rest.trim() == "started" {
                let _ = on_event.send(DownloadEvent::Processing);
            }
        } else if let Some(path) = line.strip_prefix("KAISU_DONE|") {
            final_path = Some(path.trim().to_string());
        } else if req.extra.verbose {
            let _ = on_event.send(DownloadEvent::Log { line });
        }
    }

    let status = child.wait().await.map_err(|e| format!("Failed to wait for yt-dlp: {e}"))?;
    let stderr_text = stderr_task.await.unwrap_or_default();
    if let Ok(mut m) = downloads.active.lock() {
        m.remove(&req.id);
    }

    if cancelled.load(Ordering::SeqCst) {
        let _ = on_event.send(DownloadEvent::Cancelled);
        return Ok(());
    }
    if status.success() {
        let _ = on_event.send(DownloadEvent::Done { path: final_path });
        Ok(())
    } else {
        Err(proc::clean_stderr(&stderr_text))
    }
}

#[tauri::command]
pub fn cancel_download(downloads: State<'_, Downloads>, id: String) -> Result<(), String> {
    let map = downloads.active.lock().map_err(|_| "download state poisoned")?;
    if let Some(active) = map.get(&id) {
        active.cancelled.store(true, Ordering::SeqCst);
        proc::kill_tree(active.pid);
    }
    Ok(())
}

#[derive(Serialize)]
pub struct FormatInfo {
    id: String,
    ext: String,
    resolution: Option<String>,
    fps: Option<f64>,
    vcodec: Option<String>,
    acodec: Option<String>,
    filesize: Option<u64>,
    note: Option<String>,
    /// "video" (no audio track), "audio" (no video track) or "both".
    kind: &'static str,
}

#[derive(Serialize)]
pub struct MediaInfo {
    title: String,
    thumbnail: Option<String>,
    uploader: Option<String>,
    duration_secs: Option<f64>,
    view_count: Option<u64>,
    formats: Vec<FormatInfo>,
}

fn parse_formats(v: &serde_json::Value) -> Vec<FormatInfo> {
    let Some(list) = v.get("formats").and_then(|f| f.as_array()) else { return Vec::new() };
    let text = |f: &serde_json::Value, k: &str| f.get(k).and_then(|x| x.as_str()).map(str::to_string);

    list.iter()
        .filter_map(|f| {
            let id = text(f, "format_id")?;
            let ext = text(f, "ext").unwrap_or_default();
            let note = text(f, "format_note");
            if ext == "mhtml" || note.as_deref().is_some_and(|n| n.contains("storyboard")) {
                return None;
            }
            let none = |c: &Option<String>| c.as_deref().is_none_or(|c| c == "none");
            let (vcodec, acodec) = (text(f, "vcodec"), text(f, "acodec"));
            let kind = match (none(&vcodec) && f.get("vcodec").is_some(), none(&acodec) && f.get("acodec").is_some()) {
                (true, _) => "audio",
                (_, true) => "video",
                _ => "both",
            };
            Some(FormatInfo {
                id,
                ext,
                resolution: text(f, "resolution").filter(|r| r != "audio only"),
                fps: f.get("fps").and_then(|x| x.as_f64()),
                vcodec: vcodec.filter(|c| c != "none"),
                acodec: acodec.filter(|c| c != "none"),
                filesize: f.get("filesize").or_else(|| f.get("filesize_approx")).and_then(|x| x.as_f64()).map(|x| x as u64),
                note,
                kind,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn get_media_info(
    app: AppHandle,
    engine: State<'_, Engine>,
    cookies_from_browser: Option<Browser>,
    url: String,
) -> Result<MediaInfo, String> {
    let url = validate_url(&url)?;
    let ytdlp = engine.ytdlp_path(&app).await?;

    let mut args: Vec<String> =
        ["--dump-single-json", "--no-playlist", "--no-warnings", "--skip-download"].map(String::from).into();
    if let Some(b) = cookies_from_browser {
        args.extend(["--cookies-from-browser".into(), b.as_arg().into()]);
    }
    if let Some(rt) = engine::locate_js_runtime(&app) {
        args.extend(["--js-runtimes".into(), rt.arg()]);
    }
    args.extend(["--".into(), url.to_string()]);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();

    let json = proc::run_capture(&ytdlp, &arg_refs, Duration::from_secs(60)).await?;
    let v: serde_json::Value = serde_json::from_str(&json).map_err(|e| format!("Unreadable response from yt-dlp: {e}"))?;

    let text = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
    let thumbnail = text("thumbnail").or_else(|| {
        v.get("thumbnails")?.as_array()?.iter().rev().find_map(|t| t.get("url")?.as_str().map(str::to_string))
    });

    Ok(MediaInfo {
        title: text("title").unwrap_or_else(|| "Untitled".into()),
        thumbnail,
        uploader: text("uploader").or_else(|| text("channel")),
        duration_secs: v.get("duration").and_then(|d| d.as_f64()),
        view_count: v.get("view_count").and_then(|c| c.as_u64()),
        formats: parse_formats(&v),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn req(preset: Preset) -> DownloadRequest {
        DownloadRequest {
            id: "1".into(),
            url: "https://example.com/v".into(),
            preset,
            out_dir: PathBuf::from("/tmp/out"),
            extra: ExtraOptions::default(),
        }
    }

    fn args(r: &DownloadRequest) -> Result<Vec<String>, String> {
        build_args(r, "https://example.com/v", Path::new("/bin"), None)
    }

    #[test]
    fn url_is_always_after_double_dash() {
        let a = args(&req(Preset::Best)).unwrap();
        let n = a.len();
        assert_eq!(a[n - 2], "--");
        assert_eq!(a[n - 1], "https://example.com/v");
    }

    #[test]
    fn rejects_option_like_and_non_http_urls() {
        assert!(validate_url("--exec=touch /tmp/x").is_err());
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("https://a.b/c d").is_err());
        assert!(validate_url(" https://a.b/c ").is_ok());
    }

    #[test]
    fn audio_preset_uses_chosen_format() {
        let mut r = req(Preset::Audio);
        r.extra.audio_format = AudioFormat::Flac;
        let a = args(&r).unwrap();
        assert!(a.windows(2).any(|w| w == ["--audio-format", "flac"]));
        assert!(!a.contains(&"--merge-output-format".to_string()));
        r.extra.audio_format = AudioFormat::Wav;
        assert!(!args(&r).unwrap().contains(&"--embed-thumbnail".to_string()));
    }

    #[test]
    fn old_history_preset_name_still_deserializes() {
        let p: Preset = serde_json::from_str("\"audio_mp3\"").unwrap();
        assert!(matches!(p, Preset::Audio));
    }

    #[test]
    fn js_runtime_is_passed_when_available() {
        let a = build_args(&req(Preset::Best), "https://a.b", Path::new("/bin"), Some("deno:/x/deno")).unwrap();
        assert!(a.windows(2).any(|w| w == ["--js-runtimes", "deno:/x/deno"]));
    }

    #[test]
    fn video_falls_back_to_mkv_container() {
        let a = args(&req(Preset::P720)).unwrap();
        assert!(a.windows(2).any(|w| w == ["--merge-output-format", "mp4/mkv"]));
    }

    #[test]
    fn specific_format_replaces_preset_selector() {
        let mut r = req(Preset::Best);
        r.extra.format_id = Some("137+140".into());
        let a = args(&r).unwrap();
        assert!(a.windows(2).any(|w| w == ["-f", "137+140"]));
        assert!(!a.contains(&"-S".to_string()));
        r.extra.format_id = Some("137; rm -rf".into());
        assert!(args(&r).is_err());
    }

    #[test]
    fn rate_limit_is_validated() {
        for ok in ["500K", "2M", "1.5M", "100"] {
            assert!(validate_rate_limit(ok).is_ok(), "{ok}");
        }
        for bad in ["", "M", "5MB", "--exec", "1.2.3K", "5 K"] {
            assert!(validate_rate_limit(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn custom_args_are_split_like_a_shell() {
        assert_eq!(split_args(r#"--proxy "http://a b" -x 'q r'"#).unwrap(), ["--proxy", "http://a b", "-x", "q r"]);
        assert_eq!(split_args(r#"-o "C:\music\%(title)s.%(ext)s""#).unwrap(), ["-o", r"C:\music\%(title)s.%(ext)s"]);
        assert_eq!(split_args("a  b").unwrap(), ["a", "b"]);
        assert!(split_args("--x \"unterminated").is_err());
    }

    #[test]
    fn dangerous_custom_args_are_blocked_even_abbreviated() {
        for bad in [
            "--exec touch /tmp/x",
            "--exec=calc",
            "--EXEC=calc",
            "--exec-before-download id",
            "--exec-be=calc",
            "--ex=calc",
            "--netrc-cmd foo",
            "--plugin-dirs /tmp",
            "--print-to-file x y",
            "--",
        ] {
            assert!(parse_custom_args(bad).is_err(), "{bad} should be rejected");
        }
        assert!(parse_custom_args("--sponsorblock-mark all --embed-chapters -R 3").is_ok());
    }

    #[test]
    fn custom_args_land_before_the_url_separator() {
        let mut r = req(Preset::Best);
        r.extra.custom_args = Some("--embed-chapters".into());
        let a = args(&r).unwrap();
        let (chap, sep) = (a.iter().position(|x| x == "--embed-chapters").unwrap(), a.len() - 2);
        assert!(chap < sep && a[sep] == "--");
    }

    #[test]
    fn progress_spans_two_streams() {
        let mut p = ProgressState::new(Preset::Best);
        let pct = |e: Option<DownloadEvent>| match e {
            Some(DownloadEvent::Progress { pct, .. }) => pct,
            _ => panic!("expected progress"),
        };
        let a = pct(p.handle("KAISU|50|100|NA|1000|1|137"));
        let b = pct(p.handle("KAISU|100|100|NA|1000|NA|137"));
        let c = pct(p.handle("KAISU|50|100|NA|1000|1|140"));
        assert!((a - 25.0).abs() < 0.1 && (b - 50.0).abs() < 0.1 && (c - 75.0).abs() < 0.1);
    }

    #[test]
    fn progress_uses_estimate_when_total_missing() {
        let mut p = ProgressState::new(Preset::Audio);
        match p.handle("KAISU|25|NA|100|NA|NA|251") {
            Some(DownloadEvent::Progress { pct, speed, eta }) => {
                assert!((pct - 25.0).abs() < 0.1);
                assert!(speed.is_none() && eta.is_none());
            }
            _ => panic!(),
        }
    }

    #[test]
    fn formats_are_classified() {
        let v = serde_json::json!({"formats": [
            {"format_id":"sb0","ext":"mhtml","format_note":"storyboard","vcodec":"none","acodec":"none"},
            {"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a.40.2","resolution":"audio only","filesize":1000},
            {"format_id":"137","ext":"mp4","vcodec":"avc1","acodec":"none","resolution":"1920x1080","fps":30.0},
            {"format_id":"18","ext":"mp4","vcodec":"avc1","acodec":"mp4a","resolution":"640x360"}
        ]});
        let f = parse_formats(&v);
        assert_eq!(f.iter().map(|x| (x.id.as_str(), x.kind)).collect::<Vec<_>>(), [("140", "audio"), ("137", "video"), ("18", "both")]);
        assert_eq!(f[0].resolution, None);
        assert_eq!(f[0].filesize, Some(1000));
    }
}
