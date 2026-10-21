//! Passwords kept in the operating system's credential store (Windows Credential Manager, macOS Keychain, the Secret
//! Service on Linux) instead of in Kaisu's settings file, which anyone who can read your files can open.
//!
//! Only the names in `NAMES` can be used, so a page can't treat this as a general-purpose vault. When there is no
//! credential store (a Linux desktop without one, say) every call fails with a message, and the caller keeps the
//! password where it was before.

use keyring::{Entry, Error};

const SERVICE: &str = "com.kaisu.app";

/// Everything Kaisu ever stores here.
const NAMES: &[&str] = &["proxy-password"];

fn explain(e: Error) -> String {
    format!("The system's password store isn't available: {e}")
}

fn entry(service: &str, name: &str) -> Result<Entry, String> {
    if !NAMES.contains(&name) {
        return Err("That isn't something Kaisu stores.".into());
    }
    Entry::new(service, name).map_err(explain)
}

fn set(service: &str, name: &str, value: &str) -> Result<(), String> {
    entry(service, name)?.set_password(value).map_err(explain)
}

fn get(service: &str, name: &str) -> Result<Option<String>, String> {
    match entry(service, name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(explain(e)),
    }
}

fn delete(service: &str, name: &str) -> Result<(), String> {
    match entry(service, name)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(explain(e)),
    }
}

#[tauri::command]
pub async fn secret_set(name: String, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set(SERVICE, &name, &value)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn secret_get(name: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || get(SERVICE, &name)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn secret_delete(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete(SERVICE, &name)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_names_are_allowed() {
        assert!(set(SERVICE, "something-else", "x").is_err());
        assert!(get(SERVICE, "../proxy-password").is_err());
        assert!(delete(SERVICE, "").is_err());
    }

    /// Talks to the real credential store under a throwaway service name. Skipped where there isn't one.
    #[test]
    fn a_password_round_trips_through_the_real_store() {
        let service = format!("com.kaisu.app.test-{}", std::process::id());
        if let Err(e) = set(&service, "proxy-password", "p@ss:w/rd é") {
            eprintln!("skipped: {e}");
            return;
        }
        assert_eq!(get(&service, "proxy-password").unwrap().as_deref(), Some("p@ss:w/rd é"));
        set(&service, "proxy-password", "second").unwrap();
        assert_eq!(get(&service, "proxy-password").unwrap().as_deref(), Some("second"));
        delete(&service, "proxy-password").unwrap();
        assert_eq!(get(&service, "proxy-password").unwrap(), None);
        delete(&service, "proxy-password").unwrap();
    }
}
