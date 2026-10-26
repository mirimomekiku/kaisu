//! Process helpers. yt-dlp's one-file builds are a bootloader plus a child, and yt-dlp itself
//! spawns ffmpeg, so cancelling has to kill the whole tree, not just the process we started.

use std::{path::Path, process::Stdio, time::Duration};

use tokio::{io::AsyncReadExt, process::Command};
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};

/// A download owns every subprocess until final verification has finished.
#[derive(Default)]
pub struct JobControl {
    cancelled: AtomicBool,
    pids: Mutex<Vec<u32>>,
    wake: tokio::sync::Notify,
}
impl JobControl {
    pub fn is_cancelled(&self) -> bool { self.cancelled.load(Ordering::SeqCst) }
    pub fn cancel(&self) {
        let pids = self.pids.lock().unwrap_or_else(|e| e.into_inner());
        if self.cancelled.swap(true, Ordering::SeqCst) { return; }
        for pid in pids.iter() { kill_tree(*pid); }
        drop(pids);
        self.wake.notify_waiters();
    }
    pub async fn cancelled(&self) {
        loop {
            let notified = self.wake.notified();
            tokio::pin!(notified); notified.as_mut().enable();
            if self.is_cancelled() { return; }
            notified.await;
        }
    }
    pub fn attach(self: &Arc<Self>, pid: u32) -> ProcessLease {
        let mut pids = self.pids.lock().unwrap_or_else(|e| e.into_inner());
        if self.is_cancelled() { kill_tree(pid); } else { pids.push(pid); }
        ProcessLease { job: Some(self.clone()), pid, reaped: false }
    }
}
pub struct ProcessLease { job: Option<Arc<JobControl>>, pid: u32, reaped: bool }
impl ProcessLease { pub fn reaped(&mut self) { self.reaped = true; } }
impl Drop for ProcessLease {
    fn drop(&mut self) {
        if let Some(job) = &self.job {
            // Holding the lock also prevents cancellation from targeting an already reaped PID.
            if let Ok(mut pids) = job.pids.lock() {
                if !self.reaped && !job.is_cancelled() { kill_tree(self.pid); }
                pids.retain(|pid| *pid != self.pid);
            }
        }
    }
}
tokio::task_local! { pub static DOWNLOAD_JOB: Arc<JobControl>; }
fn track_child(pid: Option<u32>) -> Option<ProcessLease> {
    pid.and_then(|pid| DOWNLOAD_JOB.try_with(|job| job.attach(pid)).ok())
}

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
    let mut cmd = command_with_proxy(program, proxy);
    cmd.args(args);
    capture(cmd, timeout).await
}

/// Capture an already configured command, retaining the same process leases and cancellation.
pub async fn capture(mut cmd: Command, timeout: Duration) -> Result<String, String> {
    let program = cmd.as_std().get_program().to_string_lossy().into_owned();
    let mut child = cmd.spawn().map_err(|e| format!("Failed to start {program}: {e}"))?;
    let mut lease = track_child(child.id());
    let mut stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;

    let work = async {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let (_, _, status) = tokio::join!(stdout.read_to_end(&mut out), stderr.read_to_end(&mut err), child.wait());
        (out, err, status)
    };

    let result = tokio::time::timeout(timeout, work).await;
    if matches!(&result, Ok((_, _, Ok(_)))) { if let Some(lease) = &mut lease { lease.reaped(); } }
    match result {
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

/// Runs a short command and returns what it printed on stderr (some tools, like ffmpeg's filters, report there), failing on a
/// non-zero exit or timeout.
pub async fn run_capture_stderr(program: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut child = command(program).args(args).spawn().map_err(|e| format!("Failed to start {}: {e}", program.display()))?;
    let mut lease = track_child(child.id());
    let mut stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;

    let work = async {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let (_, _, status) = tokio::join!(stdout.read_to_end(&mut out), stderr.read_to_end(&mut err), child.wait());
        (err, status)
    };

    let result = tokio::time::timeout(timeout, work).await;
    if matches!(&result, Ok((_, Ok(_)))) { if let Some(lease) = &mut lease { lease.reaped(); } }
    match result {
        Ok((err, Ok(status))) if status.success() => Ok(String::from_utf8_lossy(&err).into_owned()),
        Ok((err, Ok(_))) => Err(clean_stderr(&String::from_utf8_lossy(&err))),
        Ok((_, Err(e))) => Err(format!("Process error: {e}")),
        Err(_) => {
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

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancellation_before_subscription_is_observed() {
        let job = JobControl::default(); job.cancel();
        tokio::time::timeout(Duration::from_millis(100), job.cancelled()).await.unwrap();
    }
    #[tokio::test]
    async fn cancellation_interrupts_a_final_processing_helper() {
        let job = Arc::new(JobControl::default());
        let control = job.clone();
        let cancel = async {
            loop {
                if !control.pids.lock().unwrap().is_empty() { control.cancel(); break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };
        let work = DOWNLOAD_JOB.scope(job.clone(), async {
            #[cfg(windows)]
            let result = run_capture(Path::new("powershell.exe"), &["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 30"], Duration::from_secs(35)).await;
            #[cfg(unix)]
            let result = run_capture(Path::new("/bin/sh"), &["-c", "sleep 30"], Duration::from_secs(35)).await;
            assert!(result.is_err());
        });
        tokio::time::timeout(Duration::from_secs(10), async { tokio::join!(work, cancel); }).await.unwrap();
        assert!(job.is_cancelled());
        assert!(job.pids.lock().unwrap().is_empty());
    }
}

#[cfg(unix)]
pub fn kill_tree(pid: u32) {
    // The child leads its own process group (see `command`), so -pid reaches every descendant.
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}
