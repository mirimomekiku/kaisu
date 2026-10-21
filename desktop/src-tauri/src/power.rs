//! Putting the computer to sleep or shutting it down when downloads are done.
//!
//! The wait happens here, not in the webview. Asking for a power action starts a countdown that this side owns: it can't
//! be shorter than `MIN_DELAY_SECS`, only one can be pending, it can be cancelled, and nothing happens if a download is
//! running when it ends. So a page can't turn the computer off instantly, and a cancelled countdown stays cancelled.

use std::{sync::Mutex, time::Duration};

use serde::Deserialize;
use tauri::{AppHandle, Manager, State};
use tokio::sync::oneshot;

use crate::download::Downloads;

const MIN_DELAY_SECS: u64 = 10;
const MAX_DELAY_SECS: u64 = 300;

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum PowerAction {
    Sleep,
    Shutdown,
}

/// The OS command for a power action, or `None` where we don't support it.
fn power_command(action: PowerAction, os: &str) -> Option<(&'static str, &'static [&'static str])> {
    match (os, action) {
        ("windows", PowerAction::Sleep) => Some(("rundll32.exe", &["powrprof.dll,SetSuspendState", "0,1,0"])),
        ("windows", PowerAction::Shutdown) => Some(("shutdown", &["/s", "/t", "0"])),
        ("linux", PowerAction::Sleep) => Some(("systemctl", &["suspend"])),
        ("linux", PowerAction::Shutdown) => Some(("systemctl", &["poweroff"])),
        _ => None,
    }
}

fn run(action: PowerAction) -> Result<(), String> {
    let (program, args) = power_command(action, std::env::consts::OS).ok_or("That isn't supported on this computer.")?;
    let mut cmd = std::process::Command::new(program);
    cmd.args(args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("Couldn't run {program}: {e}"))
}

fn clamp_delay(seconds: u64) -> Duration {
    Duration::from_secs(seconds.clamp(MIN_DELAY_SECS, MAX_DELAY_SECS))
}

/// Waits `delay`, then runs `act` if nothing is downloading. Does nothing if `cancelled` fires or its sender is dropped first.
async fn countdown(delay: Duration, cancelled: oneshot::Receiver<()>, idle: impl Fn() -> bool, act: impl FnOnce()) {
    tokio::select! {
        _ = tokio::time::sleep(delay) => {
            if idle() {
                act();
            }
        }
        _ = cancelled => {}
    }
}

#[derive(Default)]
pub struct PowerTimer {
    /// Dropping this (or sending on it) cancels the pending countdown.
    pending: Mutex<Option<oneshot::Sender<()>>>,
}

/// Starts a cancellable countdown, then sleeps or shuts down. Refused while downloads are running.
#[tauri::command]
pub fn schedule_power(app: AppHandle, timer: State<'_, PowerTimer>, downloads: State<'_, Downloads>, action: PowerAction, seconds: u64) -> Result<(), String> {
    power_command(action, std::env::consts::OS).ok_or("That isn't supported on this computer.")?;
    if !downloads.is_idle() {
        return Err("Downloads are still running, so Kaisu won't turn the computer off.".into());
    }
    let (cancel, cancelled) = oneshot::channel();
    // Replacing the sender drops the old one, which cancels any earlier countdown.
    *timer.pending.lock().map_err(|_| "Power state is unavailable.")? = Some(cancel);
    let delay = clamp_delay(seconds);
    tauri::async_runtime::spawn(async move {
        let idle = || app.state::<Downloads>().is_idle();
        countdown(delay, cancelled, idle, || {
            let _ = run(action);
        })
        .await;
    });
    Ok(())
}

/// Cancels the pending sleep or shutdown, if there is one.
#[tauri::command]
pub fn cancel_power(timer: State<'_, PowerTimer>) {
    if let Ok(mut pending) = timer.pending.lock() {
        *pending = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };

    #[test]
    fn power_actions_map_to_real_commands_per_os() {
        assert_eq!(power_command(PowerAction::Sleep, "linux"), Some(("systemctl", &["suspend"][..])));
        assert_eq!(power_command(PowerAction::Shutdown, "linux"), Some(("systemctl", &["poweroff"][..])));
        assert_eq!(power_command(PowerAction::Shutdown, "windows"), Some(("shutdown", &["/s", "/t", "0"][..])));
        assert_eq!(power_command(PowerAction::Sleep, "windows").map(|c| c.0), Some("rundll32.exe"));
        assert_eq!(power_command(PowerAction::Sleep, "plan9"), None);
    }

    #[test]
    fn the_wait_cannot_be_skipped_or_stretched() {
        assert_eq!(clamp_delay(0), Duration::from_secs(MIN_DELAY_SECS));
        assert_eq!(clamp_delay(30), Duration::from_secs(30));
        assert_eq!(clamp_delay(u64::MAX), Duration::from_secs(MAX_DELAY_SECS));
    }

    async fn ran(delay_ms: u64, idle: bool, cancel: impl FnOnce(oneshot::Sender<()>)) -> bool {
        let flag = Arc::new(AtomicBool::new(false));
        let (tx, rx) = oneshot::channel();
        let seen = flag.clone();
        let task = tokio::spawn(countdown(Duration::from_millis(delay_ms), rx, move || idle, move || seen.store(true, Ordering::SeqCst)));
        cancel(tx);
        task.await.unwrap();
        flag.load(Ordering::SeqCst)
    }

    #[tokio::test]
    async fn it_runs_when_the_wait_is_over_and_nothing_is_downloading() {
        assert!(ran(30, true, std::mem::forget).await);
    }

    #[tokio::test]
    async fn it_does_nothing_when_a_download_is_running() {
        assert!(!ran(30, false, std::mem::forget).await);
    }

    #[tokio::test]
    async fn cancelling_or_replacing_the_countdown_stops_it() {
        assert!(!ran(200, true, |tx| {
            let _ = tx.send(());
        })
        .await);
        assert!(!ran(200, true, drop).await, "dropping the sender (a newer countdown replaced it) also cancels");
    }
}
