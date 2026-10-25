//! How loud each song is, measured with ffmpeg's `loudnorm` filter (EBU R128, in LUFS) and remembered in the library cache.
//! The player uses it to turn louder songs down so a playlist doesn't jump in volume. Nothing is ever changed in the files.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{engine, library, proc, scope::Scope};

/// Measuring reads the whole song; a long mix needs time.
const ANALYZE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// The most songs one call measures, so a call stays short and the page can show progress.
const MAX_BATCH: usize = 20;

/// The integrated loudness from what `loudnorm=print_format=json` printed, or None for silence or anything unexpected.
pub fn parse_loudnorm(stderr: &str) -> Option<f64> {
    let end = stderr.rfind('}')?;
    let start = stderr[..end].rfind('{')?;
    let value: serde_json::Value = serde_json::from_str(&stderr[start..=end]).ok()?;
    let lufs = match value.get("input_i")? {
        serde_json::Value::String(s) => s.trim().parse::<f64>().ok()?,
        serde_json::Value::Number(n) => n.as_f64()?,
        _ => return None,
    };
    // Silence is reported as -inf; a value this low means nothing useful.
    (lufs.is_finite() && lufs > -70.0 && lufs < 10.0).then_some(lufs)
}

fn analyze_args(input: &Path) -> Vec<String> {
    ["-hide_banner", "-nostats", "-vn", "-sn", "-dn", "-i"].iter().map(|s| s.to_string()).chain([input.display().to_string()]).chain(["-af", "loudnorm=print_format=json", "-f", "null", "-"].iter().map(|s| s.to_string())).collect()
}

#[derive(Serialize, Clone, Debug)]
pub struct Loudness {
    pub path: String,
    /// LUFS, or null when it couldn't be measured.
    pub loudness: Option<f64>,
}

/// Measures these songs (at most a few at a time) and remembers the results.
#[tauri::command]
pub async fn library_analyze(app: AppHandle, scope: State<'_, Scope>, paths: Vec<String>) -> Result<Vec<Loudness>, String> {
    let (ffmpeg_dir, _) = engine::locate_ffmpeg(&app).ok_or("The media converter (ffmpeg) isn't installed yet. Open Setup to install it.")?;
    let ffmpeg = ffmpeg_dir.join(format!("ffmpeg{}", engine::EXE));
    let cache = library::cache_path(&app)?;
    let files: Vec<(String, Result<PathBuf, String>)> = paths.into_iter().take(MAX_BATCH).map(|p| (p.clone(), scope.media_file(&p))).collect();

    let mut results = Vec::with_capacity(files.len());
    for (path, real) in files {
        let loudness = match real {
            Ok(real) => {
                let args = analyze_args(&real);
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                proc::run_capture_stderr(&ffmpeg, &refs, ANALYZE_TIMEOUT).await.ok().and_then(|err| parse_loudnorm(&err))
            }
            Err(_) => None,
        };
        results.push(Loudness { path, loudness });
    }

    let found: Vec<(String, f64)> = results.iter().filter_map(|r| r.loudness.map(|l| (r.path.clone(), l))).collect();
    if !found.is_empty() {
        tauri::async_runtime::spawn_blocking(move || {
            let _lock = library::CACHE_EDIT.lock().unwrap_or_else(|e| e.into_inner());
            let mut remembered = library::load_cache(&cache);
            for (path, lufs) in found {
                if let Some(t) = remembered.iter_mut().find(|t| t.path == path) {
                    t.loudness = Some(lufs);
                }
            }
            let _ = library::save_cache(&cache, &remembered);
            Ok::<(), String>(())
        })
        .await
        .map_err(|e| e.to_string())??;
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    const REAL: &str = "[Parsed_loudnorm_0 @ 000001] \n{\n\t\"input_i\" : \"-14.52\",\n\t\"input_tp\" : \"-0.31\",\n\t\"input_lra\" : \"6.10\",\n\t\"input_thresh\" : \"-25.11\",\n\t\"output_i\" : \"-24.00\",\n\t\"normalization_type\" : \"dynamic\",\n\t\"target_offset\" : \"0.00\"\n}\n";

    #[test]
    fn the_loudness_is_read_from_ffmpegs_report() {
        assert_eq!(parse_loudnorm(REAL), Some(-14.52));
        assert_eq!(parse_loudnorm(&format!("size=N/A time=00:03:00\n{REAL}")), Some(-14.52));
    }

    #[test]
    fn silence_and_nonsense_give_nothing() {
        assert_eq!(parse_loudnorm("{ \"input_i\" : \"-inf\" }"), None);
        assert_eq!(parse_loudnorm("{ \"input_i\" : \"-91.0\" }"), None);
        assert_eq!(parse_loudnorm("{ \"input_i\" : \"loud\" }"), None);
        assert_eq!(parse_loudnorm("{ \"other\" : 1 }"), None);
        assert_eq!(parse_loudnorm("no report here"), None);
        assert_eq!(parse_loudnorm(""), None);
    }

    #[test]
    fn the_measuring_command_reads_one_file_and_writes_nothing() {
        let a = analyze_args(Path::new("/m/a b.mp3"));
        assert!(a.windows(2).any(|w| w == ["-i", "/m/a b.mp3"]));
        assert_eq!(a.last().map(String::as_str), Some("-"));
        assert!(a.windows(2).any(|w| w == ["-f", "null"]));
    }
}
