//! All app-owned yt-dlp calls ignore portable, output-folder, user and system configs.
//! Keep this separate from generic process helpers: ffmpeg and JS runtimes do not take this flag.
use std::{path::Path, time::Duration};
use tokio::process::Command;

pub const IGNORE_CONFIG: &str = "--ignore-config";

pub fn command(program: &Path, proxy: Option<&str>) -> Command {
    let mut cmd = crate::proc::command_with_proxy(program, proxy);
    cmd.arg(IGNORE_CONFIG);
    cmd
}

pub async fn run_capture(program: &Path, args: &[&str], timeout: Duration, proxy: Option<&str>) -> Result<String, String> {
    let mut cmd = command(program, proxy);
    cmd.args(args);
    crate::proc::capture(cmd, timeout).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streaming_commands_cannot_inherit_external_configuration() {
        let cmd = command(Path::new("yt-dlp"), None);
        assert_eq!(cmd.as_std().get_args().next().unwrap(), IGNORE_CONFIG);
    }

    #[tokio::test]
    async fn capture_passes_isolation_before_the_callers_arguments() {
        // libtest refuses the yt-dlp-only option before running tests. This exercises the
        // real capture path without a shell, a downloader installation or network access.
        let error = run_capture(&std::env::current_exe().unwrap(), &["--list"], Duration::from_secs(15), None).await.unwrap_err();
        assert!(error.contains("ignore-config"), "{error}");
    }

    #[tokio::test]
    #[ignore = "requires KAISU_TEST_YTDLP pointing to an installed yt-dlp executable"]
    async fn real_downloader_ignores_output_folder_configuration_without_network() {
        let program = std::path::PathBuf::from(std::env::var_os("KAISU_TEST_YTDLP").expect("Set KAISU_TEST_YTDLP"));
        let root = std::env::temp_dir().join(format!("kaisu-config-isolation-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        // The invalid option makes the negative control fail during parsing, before any
        // exec hook could run. A successful isolated call must ignore the entire file.
        std::fs::write(root.join("yt-dlp.conf"), "--kaisu-invalid-config-option\n--exec before_dl:NEVER_EXECUTE\n--write-info-json\n").unwrap();
        let info = root.join("fixture.json");
        std::fs::write(&info, serde_json::to_vec(&serde_json::json!({
            "id": "offline-fixture", "title": "Offline fixture", "extractor": "generic", "extractor_key": "Generic",
            "webpage_url": "https://example.invalid/fixture", "url": "https://example.invalid/fixture.mp4",
            "ext": "mp4", "format_id": "http", "vcodec": "h264", "acodec": "aac"
        })).unwrap()).unwrap();
        let (folder, info) = (root.display().to_string(), info.display().to_string());
        let args = ["-P", folder.as_str(), "--simulate", "--load-info-json", info.as_str(), "--dump-single-json"];
        let error = crate::proc::run_capture(&program, &args, Duration::from_secs(30)).await.unwrap_err();
        assert!(error.contains("kaisu-invalid-config-option"), "negative control must load the fixture config: {error}");
        let captured = run_capture(&program, &args, Duration::from_secs(30), None).await.unwrap();
        assert_eq!(serde_json::from_str::<serde_json::Value>(&captured).unwrap()["id"], "offline-fixture");
        let streamed = command(&program, None).args(args).output().await.unwrap();
        assert!(streamed.status.success(), "{}", String::from_utf8_lossy(&streamed.stderr));
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&streamed.stdout).unwrap()["id"], "offline-fixture");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 2, "no config-requested files were written");
        std::fs::remove_dir_all(root).unwrap();
    }
}
