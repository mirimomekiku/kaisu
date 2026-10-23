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
    pub credentials_required: bool,
    pub collision: CollisionPolicy,
    pub fragment_limit: Option<u8>,
    pub managed_retries: bool,
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

#[derive(Deserialize, Serialize, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CollisionPolicy { #[default] KeepBoth, Skip, Replace }

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
    Skipped { path: String },
    Stalled { seconds: u64 },
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

/// Download timing. The same numbers are checked against `testdata/download-validation.json`, which the
/// frontend's retry settings are checked against too.
const STALL_NOTICE_SECS: u64 = 30;
const DEFAULT_TIMEOUT_SECS: u64 = 120;
const CONVERSION_TIMEOUT_SECS: u64 = 1800;
const READ_BUFFER_BYTES: u64 = 32768;

struct DownloadWatchdog {
    idle: std::time::Instant,
    stage: &'static str,
    bytes: HashMap<String, f64>,
    file_activity: Option<std::time::SystemTime>,
    transfer_timeout: u64,
}
impl DownloadWatchdog {
    fn new() -> Self { Self { idle: std::time::Instant::now(), stage: "preparation", bytes: HashMap::new(), file_activity: None, transfer_timeout: DEFAULT_TIMEOUT_SECS } }
    fn expired(&self) -> bool { self.idle.elapsed().as_secs() >= match self.stage { "conversion" => CONVERSION_TIMEOUT_SECS, "transfer" => self.transfer_timeout, _ => DEFAULT_TIMEOUT_SECS } }
    fn poll_conversion(&mut self, output: &std::path::Path) {
        if self.stage != "conversion" { return; }
        let prefix = format!("{}.", output.file_stem().unwrap_or_default().to_string_lossy());
        let newest = output.parent().and_then(|parent| std::fs::read_dir(parent).ok()).into_iter().flatten().flatten()
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
            .filter_map(|entry| entry.metadata().ok()?.modified().ok()).max();
        if newest > self.file_activity { self.file_activity = newest; self.idle = std::time::Instant::now(); }
    }
    fn observe(&mut self, line: &str) {
        if line.starts_with("KAISU_PP|") {
            // A postprocessor's repeated status lines cannot extend its stage deadline forever.
            if self.stage != "conversion" { self.stage = "conversion"; self.idle = std::time::Instant::now(); }
        } else if line.starts_with("KAISU|") {
            let fields: Vec<_> = line.split('|').collect();
            let bytes = fields.get(1).and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite() && *v >= 0.0);
            let format = fields.get(6).copied().unwrap_or("");
            if let Some(bytes) = bytes {
                let previous = self.bytes.entry(format.into()).or_insert(-1.0);
                if bytes > *previous {
                    self.idle = std::time::Instant::now(); *previous = bytes;
                }
                self.stage = "transfer";
            }
        } else if line.starts_with("KAISU_META|") && self.stage == "preparation" {
            self.idle = std::time::Instant::now();
        }
    }
}

/// Canonicalize existing ancestors to collapse symlinks/junctions, even for new subfolders.
fn output_key(path: &std::path::Path) -> Result<String, String> {
    let mut parent = path;
    let mut missing = Vec::new();
    while !parent.exists() {
        missing.push(parent.file_name().ok_or("Invalid output filename.")?.to_os_string());
        parent = parent.parent().ok_or("Invalid output destination.")?;
    }
    let mut canonical = std::fs::canonicalize(parent).map_err(|e| e.to_string())?;
    for part in missing.into_iter().rev() { canonical.push(part); }
    let key = crate::scope::plain_path(&canonical);
    Ok(if cfg!(windows) { key.to_lowercase() } else { key })
}

fn reserve_output(downloads: &Downloads, req: &DownloadRequest, planned: &std::path::Path, owned: Option<&std::path::Path>) -> Result<(PathBuf, Option<PathBuf>), String> {
    let base = owned.filter(|p| p.parent() == planned.parent()).unwrap_or(planned);
    let mut candidate = base.to_path_buf();
    // Audio extraction changes the extension after the download.
    if matches!(req.preset, Preset::Audio) { candidate.set_extension(req.extra.audio_format.as_arg()); }
    let original = candidate.clone();
    let mut active = downloads.active.lock().map_err(|_| "Download state unavailable.")?;
    for n in 0..1000 {
        let stem_path = candidate.with_extension("");
        let key = output_key(&stem_path)?;
        let busy = active.iter().any(|(id, a)| id != &req.id && a.output.as_deref().is_some_and(|other| other == key || other.starts_with(&format!("{key}.")) || key.starts_with(&format!("{other}."))));
        let stem = stem_path.file_name().ok_or("Invalid output filename.")?.to_string_lossy();
        let prefix = format!("{stem}.");
        let family: Vec<_> = std::fs::read_dir(candidate.parent().ok_or("Invalid output folder.")?).ok().into_iter().flatten().flatten().filter(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if cfg!(windows) { name.to_lowercase().starts_with(&prefix.to_lowercase()) } else { name.starts_with(&prefix) }
        }).collect();
        let collision = !family.is_empty();
        let unsafe_family = family.iter().any(|e| e.file_type().map(|t| t.is_symlink() || t.is_dir()).unwrap_or(true));
        if req.extra.collision == CollisionPolicy::Replace && unsafe_family {
            return Err("An existing output or partial file is a link or directory. Choose Keep both to avoid writing through it.".into());
        }
        let own = !unsafe_family && owned.is_some_and(|p| p.with_extension("") == stem_path);
        if !busy && (!collision || own || req.extra.collision == CollisionPolicy::Replace || (req.extra.collision == CollisionPolicy::Skip && candidate.is_file())) {
            validate_planned_path(&candidate, &req.out_dir)?;
            active.get_mut(&req.id).ok_or("Download is no longer active.")?.output = Some(key);
            let existing = (req.extra.collision == CollisionPolicy::Skip && candidate.is_file()).then(|| candidate.clone());
            return Ok((candidate, existing));
        }
        if req.extra.collision != CollisionPolicy::KeepBoth {
            return Err(if busy { "Another download is writing this filename. Wait for it to finish or choose Keep both." } else { "Partial or sidecar files already use this filename. Choose Keep both or Replace." }.into());
        }
        let suffix = req.recovery_id.as_deref().unwrap_or(&req.id);
        let name = format!("[{suffix}-{n}] {}.{}", original.file_stem().ok_or("Invalid output filename.")?.to_string_lossy(), original.extension().unwrap_or_default().to_string_lossy());
        candidate = original.with_file_name(name);
    }
    Err("Could not find an unused output filename.".into())
}

struct Active { job: Arc<proc::JobControl>, reserved: u64, destination: PathBuf, output: Option<String> }

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
fn rate_bytes(limit: &str) -> Result<u64, String> {
    validate_rate_limit(limit)?;
    let factor = match limit.as_bytes().last() { Some(b'K' | b'k') => 1024.0, Some(b'M' | b'm') => 1048576.0, _ => 1.0 };
    Ok((limit.trim_end_matches(['K', 'k', 'M', 'm']).parse::<f64>().map_err(|_| "Invalid speed limit.")? * factor) as u64)
}

// ---- argument building ------------------------------------------------------------------

fn build_args(
    req: &DownloadRequest,
    url: &str,
    ffmpeg_dir: &std::path::Path,
    js_runtime: Option<&str>,
) -> Result<Vec<String>, String> {
    if req.recovery_id.as_deref().is_some_and(|id| id.is_empty() || id.len() > 128 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))) {
        return Err("Invalid recovery ID.".into());
    }
    if req.extra.credentials_required || req.url.contains("[REDACTED]") || req.extra.custom_args.as_deref().is_some_and(|s| s.contains("[REDACTED]")) {
        return Err("This saved download had private headers or a signed link. Paste a fresh link and re-enter its custom headers to download it again; credentials are not kept in recovery files.".into());
    }
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
    // App resource budgets win over custom options, including aliases and equals forms.
    let fragments = extra.fragment_limit.unwrap_or(4);
    if !(1..=24).contains(&fragments) { return Err("Fragment connection limit must be between 1 and 24.".into()); }
    let fragments = extra.rate_limit.as_deref().filter(|s| !s.trim().is_empty()).map(|rate| rate_bytes(rate.trim()).map(|bytes| fragments.min(bytes.min(24) as u8))).transpose()?.unwrap_or(fragments);
    a.extend(["--concurrent-fragments".into(), fragments.to_string()]);
    if let Some(rate) = extra.rate_limit.as_deref().filter(|s| !s.trim().is_empty()) {
        if extra.clip.is_some() { return Err("Speed limits cannot be enforced for clip transfers through ffmpeg. Clear the speed limits or download the full video.".into()); }
        // yt-dlp applies its rate limiter independently inside each fragment HTTP transfer.
        a.extend(["--limit-rate".into(), (rate_bytes(rate.trim())? / u64::from(fragments)).max(1).to_string()]);
        a.extend(["--downloader".into(), "native".into()]);
    }
    if extra.managed_retries {
        for flag in ["--retries", "--fragment-retries", "--extractor-retries", "--file-access-retries"] {
            a.extend([flag.into(), "0".into()]);
        }
    }
    a.extend(["--socket-timeout".into(), "30".into(), if extra.collision == CollisionPolicy::Replace { "--force-overwrites".into() } else { "--no-overwrites".into() }]);
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
    }).await.map_err(|message: String| net::redact_values(&message, &net::custom_header_values(req.extra.custom_args.as_deref())));
    drop(running);
    if job.is_cancelled() { let _ = on_event.send(DownloadEvent::Cancelled); return Ok(()); }
    match &result {
        Ok(output) => {
            crate::download_manifest::complete(&app, &req);
            let event = match output { Some((path, true)) => DownloadEvent::Skipped { path: path.clone() }, _ => DownloadEvent::Done { path: output.as_ref().map(|(path, _)| path.clone()) } };
            let _ = on_event.send(event);
        }
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
) -> Result<Option<(String, bool)>, String> {
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
    let mut args = build_args(req, url, &ffmpeg_dir, js.as_deref())?;
    let proxy = net::proxy_option(req.extra.proxy.as_deref())?;

    // Resolve the actual basename before any media/sidecar writes and reserve its entire family.
    let mut planning = args.clone();
    let at = planning.len() - 2;
    planning.splice(at..at, ["--simulate".into(), "--print".into(), "KAISU_PLAN|%(filename)s".into(), "--print".into(), "KAISU_TRANSPORT|%(protocol)s|%(is_live)s".into()]);
    let plan = proc::run_capture_proxied(&ytdlp, &planning.iter().map(String::as_str).collect::<Vec<_>>(), Duration::from_secs(90), proxy.as_deref()).await?;
    let planned = plan.lines().find_map(|l| l.strip_prefix("KAISU_PLAN|")).ok_or("Could not resolve the output filename before downloading.")?;
    let planned = PathBuf::from(planned.trim());
    if let Some(transport) = plan.lines().find_map(|l| l.strip_prefix("KAISU_TRANSPORT|")) {
        let (protocol, live) = transport.split_once('|').unwrap_or((transport, "NA"));
        if req.extra.rate_limit.as_deref().is_some_and(|s| !s.trim().is_empty()) && (live == "True" || !protocol.split('+').all(|p| matches!(p, "http" | "https" | "http_dash_segments" | "m3u8" | "m3u8_native"))) {
            return Err("This live stream or transfer protocol cannot enforce the speed limit. Clear the speed limits before downloading it.".into());
        }
        if req.extra.fragment_limit == Some(1) && protocol.contains("http_dash_segments_generator+") {
            return Err("This stream needs at least two fragment connections. Increase Total fragment connections or select a combined video format.".into());
        }
        let protocols: Vec<_> = protocol.split('+').collect();
        if protocols.iter().all(|p| *p == "http_dash_segments_generator") {
            let streams = protocols.len();
            let budget = usize::from(req.extra.fragment_limit.unwrap_or(4));
            let effective = budget / streams * streams;
            if effective == 0 { return Err("The selected streams need more fragment connections than this job's share. Increase Total fragment connections or reduce simultaneous downloads.".into()); }
            // yt-dlp rounds workers up per parallel stream; round down before giving it the budget.
            let at = args.len() - 2;
            args.splice(at..at, ["--concurrent-fragments".into(), effective.to_string()]);
        }
        if protocols.iter().all(|p| matches!(*p, "http" | "https")) {
            if let Some(rate) = req.extra.rate_limit.as_deref().filter(|s| !s.trim().is_empty()) {
                // Plain HTTP streams are fetched sequentially, so they can use the full slot share.
                let at = args.len() - 2;
                args.splice(at..at, ["--limit-rate".into(), rate_bytes(rate.trim())?.to_string()]);
            }
        }
    }
    validate_planned_path(&planned, &req.out_dir)?;
    let owned = crate::download_manifest::owned_path(app, req);
    let (chosen, existing) = reserve_output(downloads, req, &planned, owned.as_deref())?;
    if let Some(existing) = existing {
        validate_output_file(&existing, &req.out_dir)?;
        let probe = ffmpeg_dir.join(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" });
        let verdict = meta::verify_file(&probe, &existing, None).await;
        if !verdict.ok { return Err("The existing file failed verification. Choose Keep both or Replace to download it again.".into()); }
        return Ok(Some((existing.display().to_string(), true)));
    }
    let stem = chosen.with_extension("").display().to_string().replace('%', "%%");
    let at = args.len() - 2;
    args.splice(at..at, [
        "-o".into(), format!("{stem}.%(ext)s"),
        "-o".into(), format!("chapter:{stem}.chapter-%(section_number)03d.%(ext)s"),
        // The resolved basename was already trimmed during planning. Do not truncate its unique prefix a second time.
        "--trim-filenames".into(), "10000".into(),
    ]);
    validate_planned_path(&chosen, &req.out_dir)?;
    crate::download_manifest::save(app, req, Some(&chosen.display().to_string()), None)?;
    let mut child = proc::command_with_proxy(&ytdlp, proxy.as_deref()).args(&args).spawn().map_err(|e| format!("Failed to start yt-dlp: {e}"))?;
    let pid = child.id().ok_or("yt-dlp exited immediately")?;
    let job = proc::DOWNLOAD_JOB.with(Clone::clone);
    let mut lease = job.attach(pid);
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    let log_channel = on_event.clone();
    let header_values = net::custom_header_values(req.extra.custom_args.as_deref());
    let stderr_secrets = header_values.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut buf = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = net::redact_values(&line, &stderr_secrets);
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
    let mut watchdog = DownloadWatchdog::new();
    if let Some(rate) = req.extra.rate_limit.as_deref().filter(|s| !s.trim().is_empty()) {
        // Very low intentional limits can legitimately take longer to fill yt-dlp's read buffer.
        watchdog.transfer_timeout = DEFAULT_TIMEOUT_SECS.max(READ_BUFFER_BYTES / rate_bytes(rate.trim())?.max(1));
    }
    let mut timer = tokio::time::interval(Duration::from_secs(5));
    loop {
        let line = tokio::select! {
            result = lines.next_line() => match result { Ok(Some(line)) => line, Ok(None) => break, Err(e) => return Err(format!("Could not read downloader output: {e}")) },
            _ = timer.tick() => {
                watchdog.poll_conversion(&chosen);
                let idle = watchdog.idle.elapsed().as_secs();
                if watchdog.expired() {
                    return Err(format!("Download timed out: no progress for {idle} seconds during {}. Partial files were kept; retry to resume.", watchdog.stage));
                }
                if idle >= STALL_NOTICE_SECS && watchdog.stage != "conversion" {
                    let _ = on_event.send(DownloadEvent::Stalled { seconds: idle });
                }
                continue;
            }
        };
        watchdog.observe(&line);
        if watchdog.idle.elapsed() < Duration::from_secs(1) { let _ = on_event.send(DownloadEvent::Stalled { seconds: 0 }); }
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
            let _ = on_event.send(DownloadEvent::Log { line: net::redact_values(&line, &header_values) });
        }
    }

    let status = tokio::time::timeout(Duration::from_secs(120), child.wait()).await.map_err(|_| "Download timed out while waiting for the downloader to exit.")?.map_err(|e| format!("Failed to wait for yt-dlp: {e}"))?;
    lease.reaped();
    let stderr_text = tokio::time::timeout(Duration::from_secs(5), stderr_task).await.ok().and_then(Result::ok).unwrap_or_default();
    drop(lease);
    if status.success() {
        let path = final_path.ok_or("The downloader exited without producing an output file.")?;
        let file = PathBuf::from(&path);
        validate_output_file(&file, &req.out_dir)?;
        finish_file(req, &ffmpeg_dir, file, tags, on_event).await?;
        Ok(Some((path, false)))
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
    let values = net::custom_header_values(req.extra.custom_args.as_deref());
    Ok(args.into_iter().map(|arg| net::redact_values(&arg, &values)).collect())
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
        active.insert(id.into(), Active { job: job.clone(), reserved, destination, output: None });
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

    #[test]
    fn reservations_protect_final_partial_and_overlapping_sidecar_families() {
        let root = std::env::temp_dir().join(format!("kaisu-reservations-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let downloads = Downloads::default();
        let mut a = req(Preset::Audio); a.out_dir = root.clone();
        downloads.begin(&a.id, root.clone(), 0).unwrap();
        let first = reserve_output(&downloads, &a, &root.join("Song.webm"), None).unwrap().0;
        assert_eq!(first, root.join("Song.mp3"));
        let mut b = req(Preset::Best); b.id = "2".into(); b.out_dir = root.clone();
        downloads.begin(&b.id, root.clone(), 0).unwrap();
        let other = reserve_output(&downloads, &b, &root.join("Song.mp3.mp4"), None).unwrap().0;
        assert_ne!(other, root.join("Song.mp3.mp4"));
        b.extra.collision = CollisionPolicy::Replace;
        assert!(reserve_output(&downloads, &b, &root.join("Song.mp4"), None).is_err());
        // Both case variants must map to the same reservation on Windows.
        if cfg!(windows) { assert!(reserve_output(&downloads, &b, &root.join("song.mp4"), None).is_err()); }
        drop(ActiveGuard { downloads: &downloads, id: &a.id });
        assert_eq!(reserve_output(&downloads, &b, &root.join("Song.mp4"), None).unwrap().0, root.join("Song.mp4"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn existing_outputs_follow_policy_and_owned_partials_can_resume() {
        let root = std::env::temp_dir().join(format!("kaisu-collision-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let downloads = Downloads::default(); let mut r = req(Preset::Audio); r.out_dir = root.clone();
        downloads.begin(&r.id, root.clone(), 0).unwrap();
        std::fs::write(root.join("Song.mp3.part"), b"partial").unwrap();
        let chosen = reserve_output(&downloads, &r, &root.join("Song.webm"), None).unwrap().0;
        assert_ne!(chosen, root.join("Song.mp3"));
        let owned = root.join("Song.webm");
        assert_eq!(reserve_output(&downloads, &r, &owned, Some(&owned)).unwrap().0, root.join("Song.mp3"));
        r.extra.collision = CollisionPolicy::Skip;
        assert!(reserve_output(&downloads, &r, &owned, None).is_err());
        std::fs::write(root.join("Song.mp3"), b"finished").unwrap();
        assert_eq!(reserve_output(&downloads, &r, &owned, None).unwrap().1, Some(root.join("Song.mp3")));
        r.extra.collision = CollisionPolicy::Replace;
        assert!(reserve_output(&downloads, &r, &owned, None).unwrap().1.is_none());
        assert_eq!(std::fs::read(root.join("Song.mp3.part")).unwrap(), b"partial");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn output_aliases_share_locks_and_replace_refuses_symlinks() {
        let root = std::env::temp_dir().join(format!("kaisu-alias-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("real")).unwrap();
        std::os::unix::fs::symlink(root.join("real"), root.join("alias")).unwrap();
        assert_eq!(output_key(&root.join("real/Song")).unwrap(), output_key(&root.join("alias/Song")).unwrap());
        let downloads = Downloads::default(); let mut r = req(Preset::Audio); r.out_dir = root.join("real"); r.extra.collision = CollisionPolicy::Replace;
        downloads.begin(&r.id, r.out_dir.clone(), 0).unwrap();
        std::fs::write(root.join("other.mp3"), b"keep").unwrap();
        std::os::unix::fs::symlink(root.join("other.mp3"), r.out_dir.join("Song.mp3.part")).unwrap();
        assert!(reserve_output(&downloads, &r, &r.out_dir.join("Song.webm"), None).is_err());
        assert_eq!(std::fs::read(root.join("other.mp3")).unwrap(), b"keep");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn watchdog_requires_increasing_bytes_and_allows_longer_conversion() {
        let mut watch = DownloadWatchdog::new();
        watch.observe("KAISU|100|1000|NA|10|10|video");
        watch.observe("KAISU|50|1000|NA|10|10|audio");
        watch.idle = std::time::Instant::now() - Duration::from_secs(121);
        watch.observe("KAISU|100|1000|NA|10|10|video");
        watch.observe("KAISU|50|1000|NA|10|10|audio");
        assert!(watch.expired(), "zero-progress chatter must not keep a job alive");
        watch.observe("KAISU|101|1000|NA|10|10|video"); assert!(!watch.expired());
        watch.observe("KAISU_PP|started");
        watch.idle = std::time::Instant::now() - Duration::from_secs(121);
        assert!(!watch.expired());
        watch.idle = std::time::Instant::now() - Duration::from_secs(1801);
        assert!(watch.expired());
    }

    #[test]
    fn budgets_and_app_retry_policy_override_custom_arguments() {
        let mut r = req(Preset::Audio);
        r.extra.custom_args = Some("--concurrent-fragments=24 --limit-rate=100M --retries infinite --fragment-retries infinite".into());
        r.extra.fragment_limit = Some(2); r.extra.rate_limit = Some("2M".into()); r.extra.managed_retries = true;
        let a = args(&r).unwrap();
        let last = |name: &str| a.windows(2).rev().find(|w| w[0] == name).unwrap()[1].clone();
        assert_eq!(last("--concurrent-fragments"), "2");
        assert_eq!(last("--limit-rate"), "1048576");
        assert_eq!(last("--retries"), "0"); assert_eq!(last("--fragment-retries"), "0");
        r.extra.fragment_limit = Some(0); assert!(args(&r).is_err());
        r.extra.fragment_limit = Some(1); r.extra.credentials_required = true; assert!(args(&r).is_err());
    }

    #[test]
    fn previews_hide_arbitrary_header_and_signed_link_values() {
        let mut r = req(Preset::Best);
        r.url = "https://cdn.example/video?v=public&token=signed-secret".into();
        r.extra.custom_args = Some("--add-headers 'X-Download-Secret: arbitrary-secret'".into());
        let preview = preview_command(r).unwrap();
        assert!(!preview.contains("arbitrary-secret")); assert!(!preview.contains("signed-secret"));
        assert!(preview.contains("v=public"));
    }

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
    fn timeouts_match_the_shared_values() {
        let cases: serde_json::Value = serde_json::from_str(include_str!("../../testdata/download-validation.json")).unwrap();
        let t = &cases["timeouts"];
        assert_eq!(t["stallNoticeSeconds"].as_u64(), Some(STALL_NOTICE_SECS));
        assert_eq!(t["defaultSeconds"].as_u64(), Some(DEFAULT_TIMEOUT_SECS));
        assert_eq!(t["conversionSeconds"].as_u64(), Some(CONVERSION_TIMEOUT_SECS));
        assert_eq!(t["readBufferBytes"].as_u64(), Some(READ_BUFFER_BYTES));
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
        downloads.active.lock().unwrap().insert("a".into(), Active { job: Arc::new(proc::JobControl::default()), reserved: 0, destination: PathBuf::new(), output: None });
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
