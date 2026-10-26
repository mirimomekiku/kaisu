//! Recovery records live in app data, independent of the webview's queue store.
use std::{fs, path::PathBuf, sync::Mutex};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use crate::{download::{DownloadRequest, Downloads}, scope::Scope};

static EDIT: Mutex<()> = Mutex::new(());
#[derive(Serialize, Deserialize)]
pub struct Recovery {
    pub id: String,
    pub request: DownloadRequest,
    pub expected_path: Option<String>,
    pub resolved_format: Option<String>,
    pub updated: u64,
}
fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|p| p.join("download-recovery")).map_err(|e| e.to_string())
}
fn key(req: &DownloadRequest) -> Result<&str, String> {
    let id = req.recovery_id.as_deref().unwrap_or(&req.id);
    if id.is_empty() || id.len() > 128 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b)) { return Err("Invalid recovery ID.".into()); }
    Ok(id)
}
fn scrub_request(request: &mut DownloadRequest) {
    request.extra.proxy = None;
    let safe_url = crate::net::redact_urls(&request.url);
    if safe_url != request.url { request.extra.credentials_required = true; request.url = safe_url; }
    if request.extra.custom_args.as_deref().is_some_and(crate::net::sensitive_custom_args) {
        request.extra.custom_args = Some("[REDACTED]".into()); request.extra.credentials_required = true;
    }
}
pub fn save(app: &AppHandle, req: &DownloadRequest, path: Option<&str>, format: Option<&str>) -> Result<(), String> {
    save_at(dir(app)?, req, path, format)
}
pub fn owned_path(app: &AppHandle, req: &DownloadRequest, resolved_format: Option<&str>) -> Option<PathBuf> {
    owned_path_at(dir(app).ok()?, req, resolved_format)
}
fn owned_path_at(root: PathBuf, req: &DownloadRequest, resolved_format: Option<&str>) -> Option<PathBuf> {
    let file = root.join(format!("{}.json", key(req).ok()?));
    let record: Recovery = serde_json::from_slice(&fs::read(file).ok()?).ok()?;
    // Redacted credentials cannot establish ownership of a live authenticated request.
    if record.request.extra.credentials_required || !compatible(&record, req)
        || resolved_format.is_none() || record.resolved_format.as_deref() != resolved_format { return None; }
    record.expected_path.map(PathBuf::from)
}

/// Compare artifact choices separately from operational controls. Recovery can pin an
/// originally automatic selector to its recorded resolved stream, but cannot choose a new one.
fn compatible(record: &Recovery, req: &DownloadRequest) -> bool {
    if record.request.preset != req.preset || record.request.out_dir != req.out_dir
        || record.request.url != crate::net::redact_urls(&req.url) { return false; }
    let choices = |r: &DownloadRequest| {
        let mut value = serde_json::to_value(&r.extra).unwrap_or_default();
        if let Some(object) = value.as_object_mut() {
            for key in ["proxy", "rate_limit", "fragment_limit", "managed_retries", "verbose", "credentials_required", "collision"] { object.remove(key); }
            if r.extra.custom_args.as_deref().is_some_and(crate::net::sensitive_custom_args) {
                object.insert("custom_args".into(), serde_json::json!("[REDACTED]"));
            }
            // Ignore the selector only when the caller uses the recorded resolution.
            if record.resolved_format.as_deref() == req.extra.format_id.as_deref() && record.resolved_format.is_some() {
                object.remove("format_id");
            }
        }
        value
    };
    choices(&record.request) == choices(req)
}

pub fn check_compatible(app: &AppHandle, req: &DownloadRequest) -> Result<(), String> {
    let file = dir(app)?.join(format!("{}.json", key(req)?));
    if let Ok(bytes) = fs::read(file) {
        let prior: Recovery = serde_json::from_slice(&bytes).map_err(|_| "The recovery record is unreadable. Queue the link again to start a fresh download.")?;
        if !compatible(&prior, req) { return Err("This recovery record has different output choices. Queue the link again to start a fresh download; the original partial files have been kept.".into()); }
    }
    Ok(())
}
fn save_at(root: PathBuf, req: &DownloadRequest, path: Option<&str>, format: Option<&str>) -> Result<(), String> {
    let _edit = EDIT.lock().map_err(|_| "Recovery storage is unavailable.")?; fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let id = key(req)?;
    let file = root.join(format!("{id}.json"));
    let prior = fs::read(&file).ok().and_then(|b| serde_json::from_slice::<Recovery>(&b).ok());
    if prior.as_ref().is_some_and(|record| !compatible(record, req)) {
        return Err("The recovery choices changed. The original recovery record and partial files have been kept.".into());
    }
    let mut request: DownloadRequest = serde_json::from_value(serde_json::to_value(req).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    scrub_request(&mut request);
    request.expected_volume = req.expected_volume.or_else(|| crate::download::volume_id(&req.out_dir));
    request.recovery_id = Some(id.into());
    let record = Recovery {
        id: id.into(), request,
        expected_path: path.map(str::to_string).or_else(|| prior.as_ref().and_then(|r| r.expected_path.clone())),
        resolved_format: format.map(str::to_string).or_else(|| prior.and_then(|r| r.resolved_format)),
        updated: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs(),
    };
    let tmp = file.with_extension("tmp");
    fs::write(&tmp, serde_json::to_vec(&record).map_err(|e| e.to_string())?).map_err(|e| format!("Couldn't save download recovery: {e}"))?;
    fs::rename(&tmp, &file).map_err(|e| format!("Couldn't save download recovery: {e}"))
}
pub fn complete(app: &AppHandle, req: &DownloadRequest) {
    if let (Ok(root), Ok(id)) = (dir(app), key(req)) { let _ = fs::remove_file(root.join(format!("{id}.json"))); }
}
#[tauri::command]
pub fn download_recovery(app: AppHandle, scope: State<'_, Scope>) -> Result<Vec<Recovery>, String> {
    let root = dir(&app)?;
    let mut out = Vec::new();
    let roots = scope.library_dirs();
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten().take(1000) {
            if entry.path().extension().is_none_or(|e| e != "json") { continue; }
            let Ok(bytes) = fs::read(entry.path()) else { continue };
            if bytes.len() > 262144 { continue; }
            let Ok(mut record) = serde_json::from_slice::<Recovery>(&bytes) else { continue };
            if key(&record.request).ok() != Some(record.id.as_str()) || crate::download::validate_url(&record.request.url).is_err() { continue; }
            if !roots.iter().any(|p| record.request.out_dir.starts_with(p)) { continue; }
            let before = serde_json::to_value(&record.request).map_err(|e| e.to_string())?;
            scrub_request(&mut record.request);
            if before != serde_json::to_value(&record.request).map_err(|e| e.to_string())? {
                save_at(root.clone(), &record.request, record.expected_path.as_deref(), record.resolved_format.as_deref())?;
            }
            if let Some(format) = &record.resolved_format {
                if !format.is_empty() && format.len() <= 64 && format.bytes().all(|c| c.is_ascii_alphanumeric() || b"_.*+-".contains(&c)) {
                    record.request.extra.format_id = Some(format.clone());
                }
            }
            out.push(record);
        }
    }
    out.sort_by(|a,b| b.updated.cmp(&a.updated)); out.truncate(200); Ok(out)
}
#[tauri::command]
pub fn discard_download_recovery(app: AppHandle, downloads: State<'_, Downloads>, ids: Vec<String>) -> Result<(), String> {
    if !downloads.is_idle() { return Err("Wait for running downloads to stop before discarding recovery records.".into()); }
    let root = dir(&app)?;
    for id in ids.into_iter().take(200) {
        if !id.is_empty() && id.len() <= 128 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b)) {
            let file = root.join(format!("{id}.json"));
            match fs::remove_file(file) { Ok(()) => {}, Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}, Err(e) => return Err(e.to_string()) }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> DownloadRequest {
        serde_json::from_value(serde_json::json!({ "id": "attempt", "recovery_id": "saved", "url": "https://example.com/video", "preset": "best", "out_dir": std::env::temp_dir() })).unwrap()
    }

    #[test]
    fn changed_output_choices_never_adopt_or_overwrite_original_recovery() {
        let root = std::env::temp_dir().join(format!("kaisu-recovery-profile-{}", uuid::Uuid::new_v4()));
        let original = request();
        save_at(root.clone(), &original, Some("original.mp4"), Some("137+140")).unwrap();
        let before = fs::read(root.join("saved.json")).unwrap();
        for (key, value) in [("preset", serde_json::json!("p720")), ("out_dir", serde_json::json!("/different")), ("url", serde_json::json!("https://example.com/other")),
            ("extra", serde_json::json!({ "format_id": "18" })), ("extra", serde_json::json!({ "output": { "layout": "music" } })),
            ("extra", serde_json::json!({ "audio_format": "flac" })), ("extra", serde_json::json!({ "clip": { "start": 1, "end": 2 } }))] {
            let mut changed = serde_json::to_value(&original).unwrap(); changed[key] = value;
            let changed: DownloadRequest = serde_json::from_value(changed).unwrap();
            assert!(owned_path_at(root.clone(), &changed, Some("137+140")).is_none());
            assert!(save_at(root.clone(), &changed, Some("new.mp4"), None).is_err());
            assert_eq!(fs::read(root.join("saved.json")).unwrap(), before);
        }
        let mut fresh = request(); fresh.preset = crate::download::Preset::P720; fresh.recovery_id = Some("fresh".into());
        save_at(root.clone(), &fresh, Some("new.mp4"), Some("18")).unwrap();
        assert_eq!(fs::read(root.join("saved.json")).unwrap(), before);
        assert!(root.join("fresh.json").is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn compatible_controls_resume_only_the_recorded_streams() {
        let root = std::env::temp_dir().join(format!("kaisu-recovery-streams-{}", uuid::Uuid::new_v4()));
        let mut req = request();
        save_at(root.clone(), &req, Some("original.mp4"), Some("137+140")).unwrap();
        req.extra.rate_limit = Some("500K".into()); req.extra.fragment_limit = Some(2);
        req.extra.proxy = Some("http://proxy:8080".into()); req.extra.verbose = true; req.extra.managed_retries = true;
        assert_eq!(owned_path_at(root.clone(), &req, Some("137+140")), Some(PathBuf::from("original.mp4")));
        assert!(owned_path_at(root.clone(), &req, Some("18")).is_none());
        assert!(owned_path_at(root.clone(), &req, None).is_none());
        // Recovery explicitly pins the originally automatic selection to its recorded format.
        req.extra.format_id = Some("137+140".into());
        assert_eq!(owned_path_at(root.clone(), &req, Some("137+140")), Some(PathBuf::from("original.mp4")));
        save_at(root.clone(), &req, None, None).unwrap();
        req.extra.format_id = Some("18".into());
        assert!(owned_path_at(root.clone(), &req, Some("18")).is_none());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn private_headers_and_signed_links_are_never_written_to_recovery() {
        let root = std::env::temp_dir().join(format!("kaisu-private-manifest-{}", uuid::Uuid::new_v4()));
        let req: DownloadRequest = serde_json::from_value(serde_json::json!({ "id": "private", "url": "https://cdn.example/a?token=private-link", "preset": "audio", "out_dir": std::env::temp_dir(), "extra": { "custom_args": "--add-headers 'X-Token: private-header'" } })).unwrap();
        save_at(root.clone(), &req, None, None).unwrap();
        let text = fs::read_to_string(root.join("private.json")).unwrap();
        assert!(!text.contains("private-link")); assert!(!text.contains("private-header"));
        let record: Recovery = serde_json::from_str(&text).unwrap(); assert!(record.request.extra.credentials_required);
        assert!(req.url.contains("private-link"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn recovery_preserves_choices_format_and_path_without_proxy_credentials() {
        let root = std::env::temp_dir().join(format!("kaisu-manifest-{}", uuid::Uuid::new_v4()));
        let req: DownloadRequest = serde_json::from_value(serde_json::json!({
            "id": "attempt-1", "recovery_id": "saved-1", "url": "https://vimeo.com/123", "preset": "audio",
            "out_dir": std::env::temp_dir(), "extra": { "audio_format": "flac", "proxy": "http://user:secret@proxy:8080",
                "output": { "layout": "music" }, "clip": { "start": 5, "end": 12 }, "custom_args": "--embed-chapters" }
        })).unwrap();
        save_at(root.clone(), &req, Some("/music/track.flac"), None).unwrap();
        save_at(root.clone(), &req, None, Some("251")).unwrap();
        let bytes = fs::read(root.join("saved-1.json")).unwrap();
        let text = String::from_utf8(bytes.clone()).unwrap();
        assert!(!text.contains("secret"));
        let record: Recovery = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(record.expected_path.as_deref(), Some("/music/track.flac"));
        assert_eq!(record.resolved_format.as_deref(), Some("251"));
        let json = serde_json::to_value(record.request).unwrap();
        assert_eq!(json["extra"]["audio_format"], "flac");
        assert_eq!(json["extra"]["clip"]["start"], 5.0);
        assert_eq!(json["extra"]["output"]["layout"], "music");
        assert_eq!(json["extra"]["custom_args"], "--embed-chapters");
        assert!(!root.join("saved-1.tmp").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn recovery_ids_cannot_escape_app_storage() {
        let req: DownloadRequest = serde_json::from_value(serde_json::json!({
            "id": "x", "recovery_id": "../escape", "url": "https://example.com/video", "preset": "best", "out_dir": "/music"
        })).unwrap();
        assert!(key(&req).is_err());
    }
}
