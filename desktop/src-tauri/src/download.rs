//! Download and inspect commands. The frontend sends a typed request; the argument list is
//! built here, so no free-form text reaches yt-dlp's option parser except the validated
//! "custom arguments" field that advanced users can opt into.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, ipc::Channel};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::{
    custom_args::parse_custom_args,
    engine::{self, Engine},
    meta::{self, AudioExtras, CoverMode, CoverOptions, LyricsMode, MetaOptions},
    net,
    output::{self, Clip, OutputOptions, PlaylistCtx},
    proc,
    subs::{self, SubtitleOptions, SubtitleTrack},
};

/// Below this much free space we refuse to start: yt-dlp would fail halfway and leave a big partial file.
const MIN_FREE_BYTES: u64 = 200 * 1024 * 1024;

const NO_FFMPEG: &str = "The media converter (ffmpeg) isn't installed yet. Open Setup to install it.";

#[derive(Deserialize, Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    Best,
    P1080,
    P720,
    #[serde(alias = "audio_mp3")]
    Audio,
}

#[derive(Deserialize, Serialize, Clone, Copy, Default)]
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

#[derive(Deserialize, Serialize, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SponsorBlock {
    #[default]
    Off,
    Mark,
    Remove,
}

#[derive(Deserialize, Serialize, Clone, Copy)]
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

#[derive(Deserialize, Serialize, Default)]
#[serde(default)]
pub struct ExtraOptions {
    pub sponsorblock: SponsorBlock,
    pub cookies_from_browser: Option<Browser>,
    /// Subtitle languages and where to put them.
    pub subs: Option<SubtitleOptions>,
    /// Route everything through this proxy.
    pub proxy: Option<String>,
    pub audio_format: AudioFormat,
    /// A specific yt-dlp format id (or `video+audio`), instead of the preset's selector.
    pub format_id: Option<String>,
    /// e.g. `500K` or `2M`.
    pub rate_limit: Option<String>,
    /// Advanced users' own yt-dlp options. Validated by `parse_custom_args`.
    pub custom_args: Option<String>,
    /// Forward yt-dlp's normal console output to the log.
    pub verbose: bool,
    /// Folder layout and file naming.
    pub output: OutputOptions,
    /// Set when this video is one of a playlist's items (adds the folder and number).
    pub playlist: Option<PlaylistCtx>,
    /// Download only part of the video.
    pub clip: Option<Clip>,
    /// Tags the user typed in.
    pub meta: Option<MetaOptions>,
    pub cover: Option<CoverOptions>,
    pub lyrics: Option<LyricsMode>,
    pub audio: Option<AudioExtras>,
    /// Remove "(Official Video)" and similar from titles.
    pub clean_titles: bool,
}

#[derive(Deserialize, Serialize)]
pub struct DownloadRequest {
    pub id: String,
    pub url: String,
    pub preset: Preset,
    pub out_dir: PathBuf,
    #[serde(default)]
    pub extra: ExtraOptions,
    #[serde(default)]
    pub recovery_id: Option<String>,
    #[serde(default)]
    pub estimated_bytes: Option<u64>,
    #[serde(default)]
    pub expected_volume: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DownloadEvent {
    Progress { pct: Option<f32>, speed: Option<f64>, eta: Option<u64> },
    Stage { stage: String },
    Warning { message: String },
    /// The real title, learned from yt-dlp (items added from a pasted link only know their URL at first).
    Meta { title: String },
    Log { line: String },
    /// The finished file was looked at: `ok: false` means it may be damaged or cut off.
    Checked { ok: bool, note: Option<String> },
    Done { path: Option<String> },
    Cancelled,
    Error { message: String },
}

struct Active { job: Arc<proc::JobControl>, reserved: u64, destination: PathBuf }

#[derive(Default)]
pub struct Downloads {
    active: Mutex<HashMap<String, Active>>,
    early_cancel: Mutex<HashMap<String, std::time::Instant>>,
}

/// Takes a download off the running list when it goes out of scope, so no way out of `run_download` (an early error
/// included) can leave it there and make Kaisu think a download is still running.
struct ActiveGuard<'a> {
    downloads: &'a Downloads,
    id: &'a str,
}

impl Drop for ActiveGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut map) = self.downloads.active.lock() {
            map.remove(self.id);
        }
    }
}

impl Downloads {
    pub fn is_idle(&self) -> bool {
        self.active.lock().map(|m| m.is_empty()).unwrap_or(true)
    }

    /// Stops every running download (used when the app exits, so no yt-dlp or ffmpeg is left behind).
    pub fn kill_all(&self) {
        if let Ok(map) = self.active.lock() {
            for active in map.values() {
                active.job.cancel();
            }
        }
    }
}

/// Free space on the drive that holds `dir`, even if `dir` doesn't exist yet.
pub fn free_space_for(dir: &std::path::Path) -> Result<u64, String> {
    let mut probe = dir;
    while !probe.exists() {
        probe = probe.parent().ok_or_else(|| format!("Cannot check free space for {}", dir.display()))?;
    }
    fs4::available_space(probe).map_err(|e| format!("Cannot check free space: {e}"))
}

#[tauri::command]
pub fn free_space(path: PathBuf) -> Result<u64, String> {
    free_space_for(&path)
}

// ---- validation ---------------------------------------------------------------------

pub(crate) fn validate_url(url: &str) -> Result<&str, String> {
    let url = url.trim();
    let ok = (url.to_ascii_lowercase().starts_with("http://") || url.to_ascii_lowercase().starts_with("https://")) && url.len() <= 8192 && !url.chars().any(|c| c.is_whitespace() || c.is_control())
        && url::Url::parse(url).is_ok_and(|u| ["http", "https"].contains(&u.scheme()) && u.host_str().is_some_and(|h| !h.is_empty()) && u.username().is_empty() && u.password().is_none());
    if ok { Ok(url) } else { Err("Enter a full web link (starting with http:// or https://) without spaces.".into()) }
}

fn validate_format_id(id: &str) -> Result<&str, String> {
    let ok = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || "_.*+-".contains(c));
    if ok { Ok(id) } else { Err("That format isn't valid.".into()) }
}

fn validate_rate_limit(limit: &str) -> Result<&str, String> {
    let digits = limit.trim_end_matches(['K', 'k', 'M', 'm']);
    let mut parts = digits.split('.');
    let whole = parts.next().unwrap_or("");
    let decimal = parts.next();
    let shape = !whole.is_empty() && whole.bytes().all(|c| c.is_ascii_digit())
        && decimal.is_none_or(|p| !p.is_empty() && p.bytes().all(|c| c.is_ascii_digit())) && parts.next().is_none();
    let factor = match limit.as_bytes().last() { Some(b'K' | b'k') => 1024.0, Some(b'M' | b'm') => 1048576.0, _ => 1.0 };
    let ok = limit.len() <= 32 && limit.len() - digits.len() <= 1 && shape && digits.parse::<f64>().is_ok_and(|v| v.is_finite() && v * factor >= 1.0 && v * factor <= 1_000_000_000_000.0);
    if ok { Ok(limit) } else { Err("Speed limit must be between 1 byte/s and 1 TB/s, like 500K or 2M.".into()) }
}

// ---- argument building ------------------------------------------------------------------

fn build_args(
    req: &DownloadRequest,
    url: &str,
    ffmpeg_dir: &std::path::Path,
    js_runtime: Option<&str>,
) -> Result<Vec<String>, String> {
    if let Some(pl) = &req.extra.playlist {
        if pl.index == 0 || pl.index > pl.total || pl.total > 100000 || pl.title.len() > 4000 { return Err("Invalid playlist position or title.".into()); }
    }
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
    push(&["--print", "before_dl:KAISU_META|%(title)s"]);
    push(&["--print", "before_dl:KAISU_FILE|%(filename)s"]);
    push(&["--print", "before_dl:KAISU_FORMAT|%(format_id)s"]);
    push(&["--print", "after_move:KAISU_TAGS|%(artist,uploader)s|%(track,title)s|%(duration)s"]);
    push(&["--trim-filenames", "150"]);
    if extra.clean_titles {
        push(&["--replace-in-metadata", "title", meta::TITLE_NOISE_REGEX, ""]);
    }
    let template = output::build_template(&extra.output, matches!(req.preset, Preset::Audio), extra.playlist.as_ref(), extra.clip.as_ref())?;
    push(&["-o", template.as_str()]);
    if let Some(clip) = &extra.clip {
        clip.validate()?;
        let section = clip.section();
        push(&["--download-sections", section.as_str()]);
        if clip.precise {
            push(&["--force-keyframes-at-cuts"]);
        }
    }

    let custom_format = extra.format_id.as_deref().map(validate_format_id).transpose()?;
    match req.preset {
        Preset::Audio => {
            push(&["-f", custom_format.unwrap_or("ba/b"), "-x", "--audio-format", extra.audio_format.as_arg()]);
            let audio = extra.audio.clone().unwrap_or_default();
            push(&["--audio-quality", audio.quality()?.as_str(), "--embed-metadata"]);
            for arg in audio.args() {
                push(&[arg.as_str()]);
            }
            let cover = extra.cover.clone().unwrap_or_default();
            for arg in cover.audio_args(matches!(extra.audio_format, AudioFormat::Wav))? {
                push(&[arg.as_str()]);
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
    if let Some(meta) = extra.meta.as_ref().filter(|m| !m.is_empty()) {
        for arg in meta.args()? {
            push(&[arg.as_str()]);
        }
    }
    if let Some(cover) = &extra.cover {
        // A custom picture is added after the download; make sure it exists now rather than at the end.
        if cover.mode == CoverMode::Custom && !matches!(req.preset, Preset::Audio) {
            return Err("Custom cover art is only for audio downloads.".into());
        }
    }
    let subtitle_args = match &extra.subs {
        Some(subs) => subs.args(matches!(req.preset, Preset::Audio))?,
        None => Vec::new(),
    };
    for arg in &subtitle_args {
        push(&[arg.as_str()]);
    }
    // The proxy is not an argument: it reaches yt-dlp through its environment (see `proc::command_with_proxy`), so a
    // password in it never shows on the command line. It is only checked here.
    net::proxy_option(extra.proxy.as_deref())?;
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
        let downloaded: f64 = parse_num::<f64>(f.get(1)?).filter(|v| v.is_finite() && *v >= 0.0)?;
        let total: Option<f64> = parse_num(f.get(2)?).or_else(|| parse_num(f.get(3).copied()?));
        let speed = f.get(4).and_then(|s| parse_num::<f64>(s)).filter(|v| v.is_finite() && *v >= 0.0);
        let eta = f.get(5).and_then(|s| parse_num::<f64>(s)).filter(|v| v.is_finite() && *v >= 0.0).map(|e| e as u64);
        let format = f.get(6).map(|s| s.trim().to_string());

        if format != self.last_format {
            if self.last_format.is_some() {
                self.stream_index += 1.0;
            }
            self.last_format = format;
        }

        let within = total.filter(|t| *t > 0.0).map(|t| (downloaded / t).clamp(0.0, 1.0) as f32).unwrap_or(0.0);
        let idx = self.stream_index.min(self.expected_streams - 1.0);
        let pct = total.filter(|t| t.is_finite() && *t > 0.0).map(|_| ((idx + within) / self.expected_streams * 100.0).min(99.0));
        Some(DownloadEvent::Progress { pct, speed, eta })
    }
}

/// `artist|track|duration`, where the track itself may contain `|`.
fn parse_tags(rest: &str) -> Option<(String, String, Option<f64>)> {
    let parts: Vec<&str> = rest.split('|').collect();
    if parts.len() < 3 {
        return None;
    }
    let clean = |s: &str| if s.trim() == "NA" { String::new() } else { s.trim().to_string() };
    let artist = clean(parts[0]);
    let track = clean(&parts[1..parts.len() - 1].join("|"));
    Some((artist, track, parse_num(parts[parts.len() - 1])))
}

/// What happens to a finished file: custom cover art, lyrics, then a check that it plays. None of it can fail the
/// download itself; problems are reported in the log, and a damaged file is flagged.
async fn finish_file(req: &DownloadRequest, ffmpeg_dir: &std::path::Path, file: PathBuf, tags: Option<(String, String, Option<f64>)>, on_event: &Channel<DownloadEvent>) -> Result<(), String> {
    let exe = if cfg!(windows) { ".exe" } else { "" };
    let ffmpeg = ffmpeg_dir.join(format!("ffmpeg{exe}"));
    let ffprobe = ffmpeg_dir.join(format!("ffprobe{exe}"));
    let log = |line: String| {
        let _ = on_event.send(DownloadEvent::Log { line });
    };
    let warn = |line: String| {
        let _ = on_event.send(DownloadEvent::Warning { message: line.clone() });
        log(line);
    };
    let audio = matches!(req.preset, Preset::Audio);
    let extra = &req.extra;

    let _ = on_event.send(DownloadEvent::Stage { stage: "extras".into() });
    if audio {
        if let Some(cover) = extra.cover.as_ref().filter(|c| c.mode == CoverMode::Custom) {
            match meta::validate_cover(cover.path.as_deref().unwrap_or("")) {
                Ok(img) => match meta::apply_custom_cover(&ffmpeg, &file, &img).await {
                    Ok(()) => log("[kaisu] Added your cover art.".into()),
                    Err(e) => warn(format!("[kaisu] Couldn't add the cover art: {e}")),
                },
                Err(e) => warn(format!("[kaisu] Couldn't add the cover art: {e}")),
            }
        }

        let mode = extra.lyrics.unwrap_or_default();
        if mode != LyricsMode::Off {
            let (found_artist, found_title, duration) = tags.clone().unwrap_or_default();
            let typed = extra.meta.as_ref();
            let artist = typed.and_then(|m| m.artist.clone()).filter(|a| !a.trim().is_empty()).unwrap_or(found_artist);
            let title = typed.and_then(|m| m.title.clone()).filter(|a| !a.trim().is_empty()).unwrap_or(found_title);
            let (artist, title) = meta::tidy_for_lookup(&artist, &title);
            match crate::setup::client(extra.proxy.as_deref()) {
                Err(e) => warn(format!("[kaisu] Lyrics: {e}")),
                Ok(client) => match meta::fetch_lyrics(&client, &artist, &title, duration).await {
                    Ok(None) => log(format!("[kaisu] Lyrics: none found for {artist} - {title}.")),
                    Err(e) => warn(format!("[kaisu] Lyrics: {e}")),
                    Ok(Some(lyrics)) => {
                        if mode.file() {
                            match meta::write_lyrics_file(&file, &lyrics).await {
                                Ok(p) => log(format!("[kaisu] Saved lyrics to {}.", p.display())),
                                Err(e) => warn(format!("[kaisu] Lyrics: {e}")),
                            }
                        }
                        if mode.embed() {
                            match meta::embed_lyrics(&ffmpeg, &file, &lyrics).await {
                                Ok(()) => log("[kaisu] Embedded the lyrics.".into()),
                                Err(e) => warn(format!("[kaisu] Lyrics: {e}")),
                            }
                        }
                    }
                },
            }
        }
    }

    // A clip is only as long as the clip; otherwise compare with the video's own length.
    let expected = match &extra.clip {
        Some(c) => Some(c.end - c.start),
        None => tags.as_ref().and_then(|t| t.2),
    };
    let expected = if extra.sponsorblock == SponsorBlock::Remove || extra.audio.as_ref().is_some_and(|a| a.trim_silence) { None } else { expected };
    let _ = on_event.send(DownloadEvent::Stage { stage: "verifying".into() });
    let verdict = meta::verify_file(&ffprobe, &file, expected).await;
    if let Some(note) = &verdict.note {
        log(format!("[kaisu] Check: {note}"));
    }
    let _ = on_event.send(DownloadEvent::Checked { ok: verdict.ok, note: verdict.note.clone() });
    if verdict.ok { Ok(()) } else { Err(verdict.note.unwrap_or_else(|| "Output verification failed.".into())) }
}

// ---- commands ---------------------------------------------------------------------------

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    engine: State<'_, Engine>,
    downloads: State<'_, Downloads>,
    scope: State<'_, crate::scope::Scope>,
    req: DownloadRequest,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    validate_url(&req.url)?;
    if req.id.is_empty() || req.id.len() > 128 || !req.id.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b)) { return Err("Invalid download ID.".into()); }
    let job = downloads.begin(&req.id, req.out_dir.clone(), req.estimated_bytes.unwrap_or(0).saturating_mul(3))?;
    let running = ActiveGuard { downloads: &downloads, id: &req.id };
    let _ = on_event.send(DownloadEvent::Stage { stage: "preparing".into() });
    let result = proc::DOWNLOAD_JOB.scope(job.clone(), async {
        tokio::select! {
            biased;
            _ = job.cancelled() => Ok(None),
            result = async {
                build_args(&req, &req.url, std::path::Path::new("ffmpeg"), None)?;
                crate::files::check_folder(req.out_dir.display().to_string())?;
                if !scope.library_dirs().iter().any(|root| req.out_dir.starts_with(root)) {
                    crate::library_folders::register_destinations(&app, &scope, &[req.out_dir.display().to_string()])?;
                }
                run_download(&app, &engine, &downloads, &req, &on_event).await
            } => result,
        }
    }).await;
    drop(running);
    if job.is_cancelled() { let _ = on_event.send(DownloadEvent::Cancelled); return Ok(()); }
    match &result {
        Ok(path) => { crate::download_manifest::complete(&app, &req); let _ = on_event.send(DownloadEvent::Done { path: path.clone() }); }
        Err(message) => { let _ = on_event.send(DownloadEvent::Error { message: message.clone() }); }
    }
    result.map(|_| ())
}

async fn run_download(
    app: &AppHandle,
    engine: &Engine,
    downloads: &Downloads,
    req: &DownloadRequest,
    on_event: &Channel<DownloadEvent>,
) -> Result<Option<String>, String> {
    let url = validate_url(&req.url)?;
    check_destination_volume(req)?;
    tokio::fs::create_dir_all(&req.out_dir)
        .await
        .map_err(|e| format!("Cannot use folder {}: {e}", req.out_dir.display()))?;

    let free = free_space_for(&req.out_dir)?;
    let reserved = downloads.active.lock().map_err(|_| "Download state unavailable.")?.iter()
        .filter(|(id, active)| id.as_str() != req.id && same_volume(&active.destination, &req.out_dir))
        .map(|(_, active)| active.reserved).fold(0u64, u64::saturating_add);
    let needed = MIN_FREE_BYTES.saturating_add(req.estimated_bytes.unwrap_or(0).saturating_mul(3)).saturating_add(reserved);
    if free < needed {
        return Err(format!(
            "There isn't enough free disk space to download here ({} MB free). Free up some space or choose another folder.",
            free / (1024 * 1024)
        ));
    }

    let ytdlp = engine.ytdlp_path(app).await?;
    let (ffmpeg_dir, _) = engine::locate_ffmpeg(app).ok_or(NO_FFMPEG)?;
    let js = engine::locate_js_runtime(app).map(|rt| rt.arg());
    let args = build_args(req, url, &ffmpeg_dir, js.as_deref())?;
    let proxy = net::proxy_option(req.extra.proxy.as_deref())?;

    crate::download_manifest::save(app, req, None, None)?;
    let mut child = proc::command_with_proxy(&ytdlp, proxy.as_deref()).args(&args).spawn().map_err(|e| format!("Failed to start yt-dlp: {e}"))?;
    let pid = child.id().ok_or("yt-dlp exited immediately")?;
    let job = proc::DOWNLOAD_JOB.with(Clone::clone);
    let mut lease = job.attach(pid);
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    let log_channel = on_event.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut buf = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = net::redact_urls(&line);
            let _ = log_channel.send(DownloadEvent::Log { line: line.clone() });
            buf.push_str(&line);
            buf.push('\n');
            if buf.len() > 16_384 {
                let mut at = buf.len() - 8_192;
                while !buf.is_char_boundary(at) { at += 1; }
                buf = buf.split_off(at);
            }
        }
        buf
    });
    struct AbortReader(tokio::task::AbortHandle);
    impl Drop for AbortReader { fn drop(&mut self) { self.0.abort(); } }
    let _reader_guard = AbortReader(stderr_task.abort_handle());

    let mut progress = ProgressState::new(req.preset);
    let mut final_path: Option<String> = None;
    let mut tags: Option<(String, String, Option<f64>)> = None;
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(rest) = line.strip_prefix("KAISU|") {
            if let Some(ev) = progress.handle(&format!("KAISU|{rest}")) {
                let _ = on_event.send(ev);
            }
        } else if let Some(rest) = line.strip_prefix("KAISU_PP|") {
            if rest.trim() == "started" {
                let _ = on_event.send(DownloadEvent::Stage { stage: "converting".into() });
            }
        } else if let Some(title) = line.strip_prefix("KAISU_META|") {
            let title = title.trim();
            if !title.is_empty() && title != "NA" {
                let _ = on_event.send(DownloadEvent::Meta { title: title.to_string() });
            }
        } else if let Some(rest) = line.strip_prefix("KAISU_TAGS|") {
            tags = parse_tags(rest);
        } else if let Some(path) = line.strip_prefix("KAISU_FILE|") {
            validate_planned_path(std::path::Path::new(path.trim()), &req.out_dir)?;
            crate::download_manifest::save(app, req, Some(path.trim()), None)?;
        } else if let Some(format) = line.strip_prefix("KAISU_FORMAT|") {
            crate::download_manifest::save(app, req, None, Some(format.trim()))?;
        } else if let Some(path) = line.strip_prefix("KAISU_DONE|") {
            final_path = Some(path.trim().to_string());
        } else if req.extra.verbose {
            let _ = on_event.send(DownloadEvent::Log { line: net::redact_urls(&line) });
        }
    }

    let status = child.wait().await.map_err(|e| format!("Failed to wait for yt-dlp: {e}"))?;
    lease.reaped();
    let stderr_text = stderr_task.await.unwrap_or_default();
    drop(lease);
    if status.success() {
        let path = final_path.ok_or("The downloader exited without producing an output file.")?;
        let file = PathBuf::from(&path);
        validate_output_file(&file, &req.out_dir)?;
        finish_file(req, &ffmpeg_dir, file, tags, on_event).await?;
        Ok(Some(path))
    } else {
        Err(proc::clean_stderr(&stderr_text))
    }
}

fn validate_output_file(file: &std::path::Path, dir: &std::path::Path) -> Result<(), String> {
    validate_planned_path(file, dir)?;
    let root = std::fs::canonicalize(dir).map_err(|_| "The download folder is unavailable.")?;
    let actual = std::fs::canonicalize(file).map_err(|_| "The downloader's output file is missing.")?;
    if !actual.starts_with(root) || !actual.is_file() { return Err("The output file isn't inside the selected download folder.".into()); }
    if actual.metadata().map_err(|e| e.to_string())?.len() == 0 { return Err("The output file is empty.".into()); }
    if cfg!(windows) && actual.as_os_str().to_string_lossy().encode_utf16().count() >= 260 { return Err("The complete output path is too long for Windows. Choose a shorter destination or file name.".into()); }
    Ok(())
}

fn validate_planned_path(file: &std::path::Path, dir: &std::path::Path) -> Result<(), String> {
    use std::path::Component;
    if !file.is_absolute() || file.components().any(|c| matches!(c, Component::ParentDir)) || !PathBuf::from(crate::scope::plain_path(file)).starts_with(PathBuf::from(crate::scope::plain_path(dir))) {
        return Err("The planned output isn't inside the selected download folder.".into());
    }
    let plain = crate::scope::plain_path(file);
    validate_path_length(&plain, cfg!(windows))?;
    let root = std::fs::canonicalize(dir).map_err(|_| "The download destination is unavailable.")?;
    let mut parent = file.parent().ok_or("The output has no parent folder.")?;
    while !parent.exists() { parent = parent.parent().ok_or("The output destination is unavailable.")?; }
    if !std::fs::canonicalize(parent).map_err(|e| e.to_string())?.starts_with(root) {
        return Err("The output folder points outside the selected download destination.".into());
    }
    Ok(())
}
fn validate_path_length(path: &str, windows: bool) -> Result<(), String> {
    if windows && path.encode_utf16().count() >= 260 {
        return Err("The complete output path is too long for Windows. Choose a shorter destination or file name.".into());
    }
    if !windows && (path.len() >= 4096 || path.split('/').any(|part| part.len() > 255)) {
        return Err("The complete output path or one of its names is too long. Choose a shorter name.".into());
    }
    Ok(())
}

#[derive(Serialize)]
pub struct Preflight { folder: String, free: u64, needed: u64, estimated: bool }
#[tauri::command]
pub fn preflight_downloads(downloads: State<'_, Downloads>, requests: Vec<DownloadRequest>) -> Result<Vec<Preflight>, String> {
    preflight_for(&downloads, requests)
}
fn preflight_for(downloads: &Downloads, requests: Vec<DownloadRequest>) -> Result<Vec<Preflight>, String> {
    if requests.is_empty() || requests.len() > 1000 { return Err("Choose between 1 and 1000 downloads.".into()); }
    let mut groups: Vec<Preflight> = Vec::new();
    for req in requests {
        validate_url(&req.url)?;
        build_args(&req, &req.url, std::path::Path::new("ffmpeg"), None)?;
        check_destination_volume(&req)?;
        let checked = crate::files::check_folder(req.out_dir.display().to_string())?;
        let estimate = req.estimated_bytes.filter(|v| *v > 0).map(|v| v.saturating_mul(3));
        if let Some(group) = groups.iter_mut().find(|g| same_volume(std::path::Path::new(&g.folder), &req.out_dir)) {
            group.needed = group.needed.saturating_add(estimate.unwrap_or(0));
            group.estimated |= estimate.is_some();
            group.free = group.free.min(checked.free);
        } else {
            let reserved = downloads.active.lock().map_err(|_| "Download state unavailable.")?.values()
                .filter(|a| same_volume(&a.destination, &req.out_dir)).map(|a| a.reserved).fold(0u64, u64::saturating_add);
            groups.push(Preflight { folder: req.out_dir.display().to_string(), free: checked.free, needed: MIN_FREE_BYTES.saturating_add(reserved).saturating_add(estimate.unwrap_or(0)), estimated: estimate.is_some() });
        }
    }
    Ok(groups)
}

fn same_volume(a: &std::path::Path, b: &std::path::Path) -> bool {
    fn existing(mut p: &std::path::Path) -> &std::path::Path { while !p.exists() { match p.parent() { Some(parent) => p = parent, None => break } } p }
    #[cfg(unix)] { use std::os::unix::fs::MetadataExt; return std::fs::metadata(existing(a)).ok().zip(std::fs::metadata(existing(b)).ok()).is_none_or(|(a,b)| a.dev() == b.dev()); }
    #[cfg(windows)] {
        let a = std::fs::canonicalize(existing(a)).unwrap_or_else(|_| a.to_path_buf());
        let b = std::fs::canonicalize(existing(b)).unwrap_or_else(|_| b.to_path_buf());
        a.components().next().zip(b.components().next()).is_some_and(|(a,b)| a.as_os_str().to_string_lossy().eq_ignore_ascii_case(&b.as_os_str().to_string_lossy()))
    }
}

/// The command Kaisu would run for a download, for the "show command" button and for copying into a terminal.
#[tauri::command]
pub async fn preview_command(app: AppHandle, engine: State<'_, Engine>, req: DownloadRequest) -> Result<String, String> {
    let executable = engine.ytdlp_path(&app).await?;
    let ffmpeg_dir = engine::locate_ffmpeg(&app).map(|(dir, _)| dir).ok_or(NO_FFMPEG)?;
    let runtime = engine::locate_js_runtime(&app).map(|rt| rt.arg());
    let args = preview_args(&req, &ffmpeg_dir, runtime.as_deref())?;
    Ok(command_line(&executable.display().to_string(), &args, cfg!(windows)))
}
fn preview_args(req: &DownloadRequest, ffmpeg_dir: &std::path::Path, runtime: Option<&str>) -> Result<Vec<String>, String> {
    let url = validate_url(&req.url)?.to_string();
    let mut args = build_args(req, &url, ffmpeg_dir, runtime)?;
    if let Some(proxy) = net::proxy_option(req.extra.proxy.as_deref())? {
        let at = args.len() - 2;
        args.splice(at..at, ["--proxy".to_string(), net::redact_urls(&proxy)]);
    }
    Ok(args)
}
fn command_line(executable: &str, args: &[String], powershell: bool) -> String {
    let prefix = if powershell && executable != "yt-dlp" { "& " } else { "" };
    format!("{prefix}{}", std::iter::once(shell_quote_for(executable, powershell)).chain(args.iter().map(|a| shell_quote_for(a, powershell))).collect::<Vec<_>>().join(" "))
}

fn shell_quote_for(arg: &str, powershell: bool) -> String {
    let plain = !arg.is_empty() && arg.chars().all(|c| c.is_ascii_alphanumeric() || "-_./=:,@%+".contains(c));
    if powershell && !plain { return format!("'{}'", arg.replace('\'', "''")); }
    if plain { arg.to_string() } else { format!("'{}'", arg.replace('\'', "'\\''")) }
}

#[tauri::command]
pub fn cancel_download(downloads: State<'_, Downloads>, id: String) -> Result<(), String> {
    downloads.cancel(&id)
}
impl Downloads {
    fn begin(&self, id: &str, destination: PathBuf, reserved: u64) -> Result<Arc<proc::JobControl>, String> {
        let job = Arc::new(proc::JobControl::default());
        let mut active = self.active.lock().map_err(|_| "Download state unavailable.")?;
        if active.contains_key(id) { return Err("That download attempt is already running.".into()); }
        if self.early_cancel.lock().map_err(|_| "Download state unavailable.")?.remove(id).is_some() { job.cancel(); }
        active.insert(id.into(), Active { job: job.clone(), reserved, destination });
        Ok(job)
    }
    fn cancel(&self, id: &str) -> Result<(), String> {
        if id.is_empty() || id.len() > 128 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b)) { return Err("Invalid download ID.".into()); }
        let map = self.active.lock().map_err(|_| "Download state unavailable.")?;
        if let Some(active) = map.get(id) {
            let job = active.job.clone(); drop(map); job.cancel();
        } else {
            let mut pending = self.early_cancel.lock().map_err(|_| "Download state unavailable.")?;
            pending.retain(|_, at| at.elapsed() < Duration::from_secs(60));
            if pending.len() >= 1024 { return Err("Too many pending cancellation requests.".into()); }
            pending.insert(id.into(), std::time::Instant::now());
        }
        Ok(())
    }
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
    like_count: Option<u64>,
    /// `YYYYMMDD`, as yt-dlp reports it.
    upload_date: Option<String>,
    /// Trimmed to a readable length; the full text can be huge.
    description: Option<String>,
    webpage_url: Option<String>,
    is_live: bool,
    subtitles: Vec<SubtitleTrack>,
    artist: Option<String>,
    track: Option<String>,
    album: Option<String>,
    release_year: Option<u32>,
    genre: Option<String>,
    /// yt-dlp's word for who may watch: `public`, `needs_auth`, `subscriber_only`, `premium_only`, `private`...
    availability: Option<String>,
    age_limit: Option<u32>,
    /// `is_live`, `is_upcoming`, `was_live`, `not_live`...
    live_status: Option<String>,
    formats: Vec<FormatInfo>,
}

const DESCRIPTION_CHARS: usize = 800;

fn trim_description(d: &str) -> Option<String> {
    let d = d.trim();
    if d.is_empty() {
        return None;
    }
    let mut out: String = d.chars().take(DESCRIPTION_CHARS).collect();
    if d.chars().count() > DESCRIPTION_CHARS {
        out.push('…');
    }
    Some(out)
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
    proxy: Option<String>,
    url: String,
) -> Result<MediaInfo, String> {
    let url = validate_url(&url)?;
    let proxy = net::proxy_option(proxy.as_deref())?;
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

    let json = proc::run_capture_proxied(&ytdlp, &arg_refs, Duration::from_secs(60), proxy.as_deref()).await?;
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
        like_count: v.get("like_count").and_then(|c| c.as_u64()),
        upload_date: text("upload_date"),
        description: text("description").and_then(|d| trim_description(&d)),
        webpage_url: text("webpage_url"),
        is_live: v.get("is_live").and_then(|l| l.as_bool()).unwrap_or(false),
        subtitles: subs::tracks(&v),
        artist: text("artist").or_else(|| v.get("artists").and_then(|a| a.as_array()).and_then(|a| a.first()).and_then(|a| a.as_str()).map(str::to_string)),
        track: text("track"),
        album: text("album"),
        release_year: v.get("release_year").and_then(|y| y.as_u64()).map(|y| y as u32),
        genre: text("genre"),
        availability: text("availability"),
        age_limit: v.get("age_limit").and_then(|a| a.as_u64()).map(|a| a as u32),
        live_status: text("live_status"),
        formats: parse_formats(&v),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn shell_quote(arg: &str) -> String { shell_quote_for(arg, cfg!(windows)) }
    fn preview_command(req: DownloadRequest) -> Result<String, String> {
        Ok(command_line("yt-dlp", &preview_args(&req, Path::new("<ffmpeg folder>"), None)?, cfg!(windows)))
    }
    fn req(preset: Preset) -> DownloadRequest {
        DownloadRequest {
            id: "1".into(),
            url: "https://example.com/v".into(),
            preset,
            out_dir: PathBuf::from("/tmp/out"),
            extra: ExtraOptions::default(),
            recovery_id: None, estimated_bytes: None, expected_volume: None,
        }
    }

    fn args(r: &DownloadRequest) -> Result<Vec<String>, String> {
        build_args(r, "https://example.com/v", Path::new("/bin"), None)
    }

    #[test]
    fn shared_validation_cases_match_the_frontend() {
        let cases: serde_json::Value = serde_json::from_str(include_str!("../../testdata/download-validation.json")).unwrap();
        for case in cases["urls"].as_array().unwrap() { assert_eq!(validate_url(case[0].as_str().unwrap()).is_ok(), case[1].as_bool().unwrap(), "{case}"); }
        for case in cases["rates"].as_array().unwrap() { assert_eq!(validate_rate_limit(case[0].as_str().unwrap()).is_ok(), case[1].as_bool().unwrap(), "{case}"); }
    }
    #[test]
    fn early_cancel_and_duplicate_attempts_are_safe() {
        let downloads = Downloads::default();
        downloads.cancel("early").unwrap();
        let job = downloads.begin("early", std::env::temp_dir(), 123).unwrap();
        assert!(job.is_cancelled());
        assert!(!downloads.is_idle());
        assert!(downloads.begin("early", std::env::temp_dir(), 123).is_err());
        let guard = ActiveGuard { downloads: &downloads, id: "early" };
        drop(guard);
        assert!(downloads.is_idle());
        let next = downloads.begin("new-attempt", std::env::temp_dir(), 123).unwrap();
        downloads.cancel("early").unwrap();
        assert!(!next.is_cancelled(), "cancelling an old attempt cannot reach the resumed job");
    }
    #[test]
    fn output_path_limits_are_platform_specific_and_count_unicode() {
        assert!(validate_path_length(&format!("C:/{}", "x".repeat(260)), true).is_err());
        assert!(validate_path_length(&format!("/music/{}", "é".repeat(128)), false).is_err());
        assert!(validate_path_length("/home/user/Music/Normal.mp3", false).is_ok());
        assert!(validate_path_length("C:/Music/Normal.mp3", true).is_ok());
    }
    #[test]
    fn missing_or_empty_output_cannot_complete() {
        let root = std::env::temp_dir().join(format!("kaisu-output-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        assert!(validate_output_file(&root.join("missing.mp3"), &root).is_err());
        std::fs::write(root.join("empty.mp3"), []).unwrap();
        assert!(validate_output_file(&root.join("empty.mp3"), &root).is_err());
        std::fs::write(root.join("normal.mp3"), b"media").unwrap();
        assert!(validate_output_file(&root.join("normal.mp3"), &root).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unknown_total_is_reported_as_indeterminate() {
        assert!(matches!(ProgressState::new(Preset::Best).handle("KAISU|123|NA|NA|1000|NA|137"), Some(DownloadEvent::Progress { pct: None, .. })));
    }
    #[test]
    fn preflight_groups_by_volume_and_includes_active_and_conversion_space() {
        let root = std::env::temp_dir().join(format!("kaisu-preflight-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let downloads = Downloads::default();
        downloads.begin("active", root.clone(), 1234).unwrap();
        let mut a = req(Preset::Best); a.out_dir = root.join("a"); a.estimated_bytes = Some(100);
        let mut b = req(Preset::Audio); b.out_dir = root.join("b"); b.estimated_bytes = Some(200);
        let groups = preflight_for(&downloads, vec![a, b]).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].needed, MIN_FREE_BYTES + 1234 + 900);
        assert!(groups[0].estimated);
        assert!(!root.join("a").exists(), "preflight does not create destinations");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn command_exports_preserve_dollars_apostrophes_and_spaces() {
        assert_eq!(shell_quote_for("Bob's $HOME (live).mp3", true), "'Bob''s $HOME (live).mp3'");
        assert_eq!(shell_quote_for("Bob's $HOME (live).mp3", false), "'Bob'\\''s $HOME (live).mp3'");
        assert_eq!(shell_quote_for("C:\\My Music\\file.mp3", true), "'C:\\My Music\\file.mp3'");
        assert_eq!(command_line("C:\\Program Files\\yt-dlp.exe", &["--".into(), "https://example.com".into()], true), "& 'C:\\Program Files\\yt-dlp.exe' -- https://example.com");
        assert_eq!(command_line("/home/u/My Tools/yt-dlp", &["--".into()], false), "'/home/u/My Tools/yt-dlp' --");
    }
    #[cfg(unix)]
    #[test]
    fn recovery_refuses_a_different_mount() {
        let mut r = req(Preset::Best);
        r.out_dir = std::env::temp_dir();
        r.expected_volume = volume_id(&r.out_dir).map(|v| v + 1);
        assert!(check_destination_volume(&r).is_err());
    }
    #[test]
    fn audio_extras_cover_and_tags_reach_yt_dlp() {
        let mut r = req(Preset::Audio);
        r.extra.audio = Some(AudioExtras { quality: Some("192K".into()), normalize: true, trim_silence: false });
        r.extra.cover = Some(CoverOptions { mode: CoverMode::Square, path: None });
        r.extra.meta = Some(MetaOptions { artist: Some("A: B".into()), year: Some("2001".into()), ..Default::default() });
        let a = args(&r).unwrap();
        let at = |flag: &str| a.iter().position(|x| x == flag).map(|i| a[i + 1].clone());
        assert_eq!(at("--audio-quality").as_deref(), Some("192K"));
        assert!(a.iter().any(|x| x.starts_with("ExtractAudio+ffmpeg_o:-af loudnorm")));
        assert!(a.iter().any(|x| x.contains("crop=min(iw")));
        assert!(a.iter().any(|x| x == "A\\: B:%(meta_artist)s"));
        assert!(a.iter().any(|x| x == "%(kaisu_unset|2001)s:%(meta_date)s"));
        assert!(a.iter().any(|x| x.starts_with("KAISU_TAGS") || x.contains("KAISU_TAGS")));
        assert!(a.windows(2).any(|w| w[0] == "--trim-filenames"));
    }

    #[test]
    fn bad_extras_are_refused_before_running() {
        let mut r = req(Preset::Audio);
        r.extra.audio = Some(AudioExtras { quality: Some("--exec".into()), ..Default::default() });
        assert!(args(&r).is_err());
        let mut r = req(Preset::Best);
        r.extra.cover = Some(CoverOptions { mode: CoverMode::Custom, path: Some("/x.jpg".into()) });
        assert!(args(&r).is_err(), "custom covers are audio-only");
        let mut r = req(Preset::Audio);
        r.extra.meta = Some(MetaOptions { year: Some("abcd".into()), ..Default::default() });
        assert!(args(&r).is_err());
    }

    #[test]
    fn tags_line_is_parsed() {
        assert_eq!(parse_tags("Daft Punk|One More Time|320.5"), Some(("Daft Punk".into(), "One More Time".into(), Some(320.5))));
        assert_eq!(parse_tags("NA|A | B|NA"), Some((String::new(), "A | B".into(), None)));
        assert_eq!(parse_tags("x|y"), None);
    }

    #[test]
    fn preview_quotes_awkward_arguments() {
        assert_eq!(shell_quote("plain-arg_1.mp4"), "plain-arg_1.mp4");
        assert_eq!(shell_quote("has space"), "'has space'");
        assert_eq!(shell_quote_for("it's", false), "'it'\\''s'");
        assert_eq!(shell_quote_for("it's", true), "'it''s'");
        let p = preview_command(req(Preset::Best)).unwrap();
        assert!(p.starts_with("yt-dlp --no-playlist") && p.ends_with("-- https://example.com/v"));
    }

    #[test]
    fn url_is_always_after_double_dash() {
        let a = args(&req(Preset::Best)).unwrap();
        let n = a.len();
        assert_eq!(a[n - 2], "--");
        assert_eq!(a[n - 1], "https://example.com/v");
    }

    #[test]
    fn a_proxy_never_goes_on_the_command_line_and_the_preview_hides_its_password() {
        let mut r = req(Preset::Best);
        r.extra.proxy = Some("socks5://me:hunter2@10.0.0.1:1080".into());
        let a = args(&r).unwrap();
        assert!(!a.iter().any(|x| x.contains("hunter2") || x == "--proxy"), "the real command line carries no proxy: {a:?}");
        let preview = preview_command(r).unwrap();
        assert!(preview.contains("--proxy 'socks5://me:***@10.0.0.1:1080' -- https://example.com/v"), "quoted, because * would otherwise glob in a shell: {preview}");
        assert!(!preview.contains("hunter2"));
        let mut bad = req(Preset::Best);
        bad.extra.proxy = Some("ftp://nope".into());
        assert!(args(&bad).is_err(), "a bad proxy is still refused before anything runs");
    }

    #[test]
    fn a_finished_download_leaves_the_running_list_however_the_function_ends() {
        let downloads = Downloads::default();
        downloads.active.lock().unwrap().insert("a".into(), Active { job: Arc::new(proc::JobControl::default()), reserved: 0, destination: PathBuf::new() });
        assert!(!downloads.is_idle());
        {
            let _running = ActiveGuard { downloads: &downloads, id: "a" };
        }
        assert!(downloads.is_idle());
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
    fn clips_use_download_sections_and_name_the_file() {
        let mut r = req(Preset::Best);
        r.extra.clip = Some(Clip { start: 80.0, end: 165.0, precise: false });
        let a = args(&r).unwrap();
        assert!(a.windows(2).any(|w| w == ["--download-sections", "*80-165"]));
        assert!(!a.contains(&"--force-keyframes-at-cuts".to_string()));
        assert!(a.iter().any(|x| x.contains("[clip 1m20s-2m45s]")));
        r.extra.clip = Some(Clip { start: 80.0, end: 165.0, precise: true });
        assert!(args(&r).unwrap().contains(&"--force-keyframes-at-cuts".to_string()));
        r.extra.clip = Some(Clip { start: 9.0, end: 3.0, precise: false });
        assert!(args(&r).is_err());
    }

    #[test]
    fn playlist_items_land_in_a_numbered_folder() {
        let mut r = req(Preset::Audio);
        r.extra.playlist = Some(PlaylistCtx { title: "Road trip".into(), index: 4, total: 30 });
        let a = args(&r).unwrap();
        let o = a.iter().position(|x| x == "-o").unwrap();
        assert_eq!(a[o + 1], "Road trip/04 - %(title).150B [%(id)s].%(ext)s");
    }

    #[test]
    fn a_bad_custom_template_fails_the_download_before_it_starts() {
        let mut r = req(Preset::Best);
        r.extra.output.custom = Some("../../escape/%(title)s".into());
        assert!(args(&r).is_err());
    }

    #[test]
    fn free_space_is_found_for_folders_that_do_not_exist_yet() {
        let tmp = std::env::temp_dir().join("kaisu-nope").join("deeper");
        assert!(free_space_for(&tmp).unwrap() > 0);
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
            Some(DownloadEvent::Progress { pct, .. }) => pct.unwrap(),
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
                assert!((pct.unwrap() - 25.0).abs() < 0.1);
                assert!(speed.is_none() && eta.is_none());
            }
            _ => panic!(),
        }
    }

    #[test]
    fn descriptions_are_trimmed() {
        assert_eq!(trim_description("  \n "), None);
        assert_eq!(trim_description(" hello ").as_deref(), Some("hello"));
        let long = "é".repeat(DESCRIPTION_CHARS + 5);
        let t = trim_description(&long).unwrap();
        assert_eq!(t.chars().count(), DESCRIPTION_CHARS + 1);
        assert!(t.ends_with('…'));
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

pub(crate) fn volume_id(mut path: &std::path::Path) -> Option<u64> {
    while !path.exists() { path = path.parent()?; }
    #[cfg(unix)] { use std::os::unix::fs::MetadataExt; std::fs::metadata(path).ok().map(|m| m.dev()) }
    #[cfg(windows)] { let _ = path; None }
}
fn check_destination_volume(req: &DownloadRequest) -> Result<(), String> {
    if let Some(expected) = req.expected_volume {
        if volume_id(&req.out_dir).is_some_and(|actual| actual != expected) { return Err("The original download drive is not mounted here. Reconnect it before recovering this download.".into()); }
    }
    Ok(())
}
