//! Process helpers. yt-dlp's one-file builds are a bootloader plus a child, and yt-dlp itself
//! spawns ffmpeg, so cancelling has to kill the whole tree, not just the process we started.

use std::{path::Path, process::Stdio, time::Duration};

use tokio::{io::AsyncReadExt, process::Command};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A command with piped output, no console window (Windows) and its own process group (Unix).
pub fn command(program: &Path) -> Command {
    let mut cmd = Command::new(program);
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    #[cfg(unix)]
    cmd.process_group(0);
    cmd
}

/// Like `command`, but sends everything through `proxy` when one is given.
///
/// The proxy goes in the environment, which yt-dlp reads, and not on the command line: a command line can be read by
/// every other program running as the same user, and a proxy address may contain a password.
pub fn command_with_proxy(program: &Path, proxy: Option<&str>) -> Command {
    let mut cmd = command(program);
    if let Some(proxy) = proxy {
        for name in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] {
            cmd.env(name, proxy);
        }
        // An explicit proxy means "everything", so leave out any exceptions inherited from the environment.
        cmd.env_remove("NO_PROXY").env_remove("no_proxy");
    }
    cmd
}

/// Runs a short command and returns its stdout, failing on a non-zero exit or timeout.
pub async fn run_capture(program: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    run_capture_proxied(program, args, timeout, None).await
}

/// `run_capture`, through `proxy` when one is given (see `command_with_proxy`).
pub async fn run_capture_proxied(program: &Path, args: &[&str], timeout: Duration, proxy: Option<&str>) -> Result<String, String> {
    let mut child = command_with_proxy(program, proxy).args(args).spawn().map_err(|e| format!("Failed to start {}: {e}", program.display()))?;
    let mut stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;

    let work = async {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let (_, _, status) = tokio::join!(stdout.read_to_end(&mut out), stderr.read_to_end(&mut err), child.wait());
        (out, err, status)
    };

    match tokio::time::timeout(timeout, work).await {
        Ok((out, _, Ok(status))) if status.success() => Ok(String::from_utf8_lossy(&out).into_owned()),
        Ok((_, err, Ok(_))) => Err(clean_stderr(&String::from_utf8_lossy(&err))),
        Ok((_, _, Err(e))) => Err(format!("Process error: {e}")),
        Err(_) => {
            // kill_on_drop only reaches the direct child; take down the tree as well.
            if let Some(pid) = child.id() {
                kill_tree(pid);
            }
            Err("Timed out".into())
        }
    }
}

/// The last few lines of a program's error output, with any password in a web address hidden.
pub fn clean_stderr(s: &str) -> String {
    let msg: Vec<&str> = s.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let tail = msg.iter().rev().take(4).rev().copied().collect::<Vec<_>>().join("\n");
    if tail.is_empty() { "Process failed without output".into() } else { crate::net::redact_urls(&tail) }
}

#[cfg(windows)]
pub fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(unix)]
pub fn kill_tree(pid: u32) {
    // The child leads its own process group (see `command`), so -pid reaches every descendant.
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}
