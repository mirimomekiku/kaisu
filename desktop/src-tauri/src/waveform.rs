//! On-demand, local amplitude envelopes. Audio is streamed; memory stays bounded for long files.
use std::{collections::HashMap, path::Path, sync::{Arc, Mutex}, time::Duration};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncReadExt;
use crate::{engine, proc, scope::Scope};

const RATE: u64 = 200;
const MAX_SAMPLES: u64 = RATE * 24 * 60 * 60;
const MAX_BINS: usize = 768;
#[derive(Clone, Serialize, Deserialize)]
pub struct Waveform { duration: f64, peaks: Vec<f32> }
pub struct Waveforms { jobs: Mutex<HashMap<String, Arc<proc::JobControl>>>, slot: tokio::sync::Semaphore }
impl Default for Waveforms { fn default() -> Self { Self { jobs: Mutex::new(HashMap::new()), slot: tokio::sync::Semaphore::new(1) } } }
impl Waveforms {
    pub fn cancel_all(&self) { if let Ok(jobs) = self.jobs.lock() { for job in jobs.values() { job.cancel(); } } }
}
#[derive(Default)]
struct Envelope { peaks: Vec<f32>, count: u64, width: u64 }
impl Envelope {
    fn push(&mut self, sample: f32) {
        if self.width == 0 { self.width = 1; }
        if self.count / self.width >= MAX_BINS as u64 {
            self.peaks = self.peaks.chunks(2).map(|pair| pair.iter().copied().fold(0.0, f32::max)).collect();
            self.width *= 2;
        }
        let i = (self.count / self.width) as usize;
        let value = if sample.is_finite() { sample.abs().min(1.0) } else { 0.0 };
        if i >= self.peaks.len() { self.peaks.push(value); } else { self.peaks[i] = self.peaks[i].max(value); }
        self.count += 1;
    }
    fn finish(self) -> Result<Waveform, String> {
        if self.count == 0 { return Err("No waveform could be read. The regular seek bar is still available.".into()); }
        // Re-bin the last partial block onto a uniform time axis, preserving peaks.
        let bins = self.peaks.len();
        let mut peaks = vec![0f32; bins];
        for (i, value) in self.peaks.into_iter().enumerate() {
            let start = (i as u64 * self.width * bins as u64 / self.count).min(bins as u64 - 1) as usize;
            let end = (((i as u64 + 1) * self.width * bins as u64).div_ceil(self.count)).min(bins as u64) as usize;
            for peak in peaks.iter_mut().take(end).skip(start) { *peak = peak.max(value); }
        }
        let max = peaks.iter().copied().fold(0.0f32, f32::max);
        if max > 0.0 { for peak in &mut peaks { *peak /= max; } }
        Ok(Waveform { duration: self.count as f64 / RATE as f64, peaks })
    }
}
fn fingerprint(path: &Path) -> Result<String, String> {
    let stat = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = stat.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|t| t.as_nanos()).unwrap_or(0);
    Ok(Sha256::digest(format!("v1:{}:{}:{modified}", path.display(), stat.len()).as_bytes()).iter().map(|b| format!("{b:02x}")).collect())
}
fn args(path: &Path) -> Vec<String> {
    let mut prefix: Vec<String> = ["-hide_banner", "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe"].into_iter().map(str::to_string).collect();
    // Repetitive PCM can falsely probe as MPEG-TS; a verified RIFF/WAVE header is authoritative.
    use std::io::Read;
    let mut header = [0u8; 12];
    if std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut header)).is_ok() && (&header[..4] == b"RIFF" || &header[..4] == b"RF64" || &header[..4] == b"BW64") && &header[8..12] == b"WAVE" { prefix.extend(["-f".into(), "wav".into()]); }
    prefix.push("-i".into());
    prefix.into_iter().chain([path.display().to_string()]).chain(["-map", "0:a:0", "-vn", "-sn", "-dn", "-t", "86400", "-af",
        "aeval=exprs=abs(val(ch)):c=same,aformat=channel_layouts=mono,aresample=200", "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"].into_iter().map(str::to_string)).collect()
}
async fn generate(ffmpeg: &Path, path: &Path, job: Arc<proc::JobControl>) -> Result<Waveform, String> {
    if job.is_cancelled() { return Err("Waveform analysis cancelled".into()); }
    let mut child = proc::command(ffmpeg).args(args(path)).stderr(std::process::Stdio::null()).spawn().map_err(|e| format!("Could not start waveform analysis: {e}"))?;
    let mut lease = job.attach(child.id().ok_or("Waveform process did not start")?);
    let mut stdout = child.stdout.take().ok_or("No waveform output")?;
    let work = async {
        let mut envelope = Envelope::default();
        let mut bytes = [0u8; 8192]; let mut sample = [0u8; 4]; let mut used = 0usize;
        loop {
            let n = stdout.read(&mut bytes).await.map_err(|e| e.to_string())?; if n == 0 { break; }
            for byte in &bytes[..n] {
                sample[used] = *byte; used += 1;
                if used == 4 { envelope.push(f32::from_le_bytes(sample)); used = 0; if envelope.count >= MAX_SAMPLES { return Err("This file exceeds the 24-hour waveform limit.".into()); } }
            }
        }
        let status = child.wait().await.map_err(|e| e.to_string())?;
        lease.reaped();
        if !status.success() { return Err("The waveform could not be decoded. Playback can continue with the regular seek bar.".into()); }
        envelope.finish()
    };
    tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(120), work) => result.map_err(|_| "Waveform analysis timed out. Playback can continue.".to_string())?,
        _ = job.cancelled() => Err("Waveform analysis cancelled".into()),
    }
}
#[tauri::command]
pub async fn media_waveform(app: AppHandle, scope: State<'_, Scope>, state: State<'_, Waveforms>, id: String, path: String) -> Result<Waveform, String> {
    if id.is_empty() || id.len() > 128 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b)) { return Err("Invalid waveform request.".into()); }
    let real = scope.media_file(&path)?;
    let key = fingerprint(&real)?;
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("waveforms");
    let file = cache.join(format!("{key}.json"));

    let job = Arc::new(proc::JobControl::default());
    { let mut jobs = state.jobs.lock().map_err(|_| "Waveform analysis unavailable")?; if jobs.len() >= 4 || jobs.contains_key(&id) { return Err("Waveform analysis is busy. Try again shortly.".into()); } jobs.insert(id.clone(), job.clone()); }
    let result = async {
        if job.is_cancelled() { return Err("Waveform analysis cancelled".into()); }
    if let Ok(bytes) = tokio::fs::read(&file).await && bytes.len() < 65536 && let Ok(wave) = serde_json::from_slice::<Waveform>(&bytes) && wave.duration.is_finite() && wave.duration > 0.0 && !wave.peaks.is_empty() && wave.peaks.len() <= MAX_BINS && wave.peaks.iter().all(|p| p.is_finite() && *p >= 0.0 && *p <= 1.0) { return Ok(wave); }

        let _permit = tokio::select! { slot = state.slot.acquire() => slot.map_err(|_| "Waveform analysis unavailable")?, _ = job.cancelled() => return Err("Waveform analysis cancelled".into()) };
        if job.is_cancelled() { return Err("Waveform analysis cancelled".into()); }
        let (dir, _) = engine::locate_ffmpeg(&app).ok_or("Install the media converter in Settings to display waveforms.")?;
        let wave = generate(&dir.join(format!("ffmpeg{}", engine::EXE)), &real, job.clone()).await?;
        if fingerprint(&real)? != key { return Err("The file changed while its waveform was being read. Try again.".into()); }
        if tokio::fs::create_dir_all(&cache).await.is_ok() {
            let tmp = cache.join(format!("{key}-{id}.tmp"));
            if let Ok(bytes) = serde_json::to_vec(&wave) { if tokio::fs::write(&tmp, bytes).await.is_ok() { let _ = tokio::fs::rename(&tmp, &file).await; } let _ = tokio::fs::remove_file(&tmp).await; }
            // Cache entries are tiny; keep at most 128, pruning the oldest after use.
            let prune = cache.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                if let Ok(files) = std::fs::read_dir(prune) { let mut files: Vec<_> = files.flatten().filter(|e| e.path().extension().is_some_and(|x| x == "json")).collect(); files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok()); let remove = files.len().saturating_sub(128); for file in files.into_iter().take(remove) { let _ = std::fs::remove_file(file.path()); } }
            }).await;
        }
        Ok(wave)
    }.await;
    if let Ok(mut jobs) = state.jobs.lock() { jobs.remove(&id); }
    result
}
#[tauri::command]
pub fn cancel_waveform(state: State<'_, Waveforms>, id: String) { if let Ok(jobs) = state.jobs.lock() && let Some(job) = jobs.get(&id) { job.cancel(); } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn bounded_envelope_preserves_silence_peaks_and_duration() {
        let mut e = Envelope::default(); for i in 0..100_000 { e.push(if i == 50000 { 0.5 } else { 0.0 }); }
        assert!(e.peaks.len() <= MAX_BINS); let wave = e.finish().unwrap(); assert_eq!(wave.duration, 500.0); assert!(wave.peaks.contains(&1.0)); assert_eq!(wave.peaks[0], 0.0);
        let mut silence = Envelope::default(); for _ in 0..400 { silence.push(0.0); } assert!(silence.finish().unwrap().peaks.iter().all(|p| *p == 0.0));
    }
    #[test] fn arguments_only_read_a_local_file_and_write_a_pipe() { let a = args(Path::new("/music/a.mp3")); assert!(a.windows(2).any(|w| w == ["-protocol_whitelist", "file,pipe"])); assert_eq!(a.last().unwrap(), "pipe:1"); }
    #[tokio::test]
    #[ignore = "requires the local ffmpeg helper"]
    async fn real_envelope_reads_stereo_without_phase_cancellation_and_can_cancel() {
        let root = std::env::temp_dir().join(format!("kaisu-wave-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("opposite-phase.wav");
        let rate = 48000u32; let frames = rate * 2; let data = frames * 4;
        let mut wav = Vec::new(); wav.extend_from_slice(b"RIFF"); wav.extend_from_slice(&(36 + data).to_le_bytes()); wav.extend_from_slice(b"WAVEfmt "); wav.extend_from_slice(&16u32.to_le_bytes()); wav.extend_from_slice(&1u16.to_le_bytes()); wav.extend_from_slice(&2u16.to_le_bytes()); wav.extend_from_slice(&rate.to_le_bytes()); wav.extend_from_slice(&(rate * 4).to_le_bytes()); wav.extend_from_slice(&4u16.to_le_bytes()); wav.extend_from_slice(&16u16.to_le_bytes()); wav.extend_from_slice(b"data"); wav.extend_from_slice(&data.to_le_bytes());
        for i in 0..frames { let sample = ((i as f64 * 1000.0 * std::f64::consts::TAU / rate as f64).sin() * 12000.0) as i16; wav.extend_from_slice(&sample.to_le_bytes()); wav.extend_from_slice(&(-sample).to_le_bytes()); }
        std::fs::write(&path, wav).unwrap();
        let ffmpeg = std::env::var_os("KAISU_FFMPEG").map(std::path::PathBuf::from).unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../bin/ffmpeg{}", engine::EXE)));
        let result = generate(&ffmpeg, &path, Arc::new(proc::JobControl::default())).await.unwrap();
        assert!((result.duration - 2.0).abs() < 0.05); assert!(result.peaks.iter().any(|p| *p > 0.9)); assert!(result.peaks.len() <= MAX_BINS);
        let job = Arc::new(proc::JobControl::default()); job.cancel();
        assert!(generate(&ffmpeg, &path, job).await.is_err());
        let before = fingerprint(&path).unwrap(); std::fs::write(&path, b"changed").unwrap(); assert_ne!(before, fingerprint(&path).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }
}
