//! Reviewed, incremental exports to mounted folders. Sources are never moved or deleted.
mod fs;
mod device;
use std::{collections::{HashMap, HashSet}, fs as disk, io::Cursor, path::{Path, PathBuf}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State, ipc::Channel};
use tauri_plugin_dialog::DialogExt;
use crate::{engine, library, proc::{self, JobControl}, scope::{self, Scope}};
use fs::{Folder, CollectionStorage, digest, check};

static EDIT: Mutex<()> = Mutex::new(());
const LIMIT: usize = 5000;
const FLOOR: u64 = 32 * 1024 * 1024;
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Format { Original, Mp3 }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Profile {
    pub id: String, pub name: String, pub folder: String, pub volume: Option<u64>, pub format: Format, pub bitrate: u16,
    pub source_kind: String, pub source_ids: Vec<String>,
}
#[derive(Serialize)]
pub struct ProfileStatus { #[serde(flatten)] pub profile: Profile, pub available: bool, pub message: String }
#[derive(Clone, Deserialize, Serialize)]
pub struct Playlist { pub id: String, pub name: String, pub paths: Vec<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct Entry { key: String, relative: String, title: String, source_hash: String, output_hash: String, size: u64 }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct Ledger { version: u8, profile_id: String, entries: Vec<Entry> }
#[derive(Clone)]
enum Input { File(PathBuf, Option<PathBuf>), Bytes(Vec<u8>) }
#[derive(Clone)]
struct Item { entry: Entry, input: Input, convert: bool, duration: f64, replaces: Option<Entry> }
#[derive(Clone)]
struct Plan { profile: Profile, before: Ledger, wanted: Vec<Item>, additions: Vec<usize>, removals: Vec<Entry>, kept: Vec<Entry>, created: Instant }
struct Session { job: Arc<JobControl>, plan: Option<Plan>, created: Instant }
#[derive(Default)]
pub struct SyncState { sessions: Mutex<HashMap<String, Session>>, applying: AtomicBool }
impl SyncState {
    pub fn kill_all(&self) { if let Ok(sessions) = self.sessions.lock() { for s in sessions.values() { s.job.cancel(); } } }
}
#[derive(Clone, Serialize)]
pub struct Progress { pub phase: String, pub done: usize, pub total: usize, pub title: String }
#[derive(Serialize)]
pub struct PlanView {
    pub id: String, pub destination: String, pub additions: Vec<String>, pub unchanged: usize,
    pub removals: Vec<String>, pub protected: Vec<String>, pub needed_bytes: u64, pub free_bytes: u64, pub conversion: bool,
}
#[derive(Serialize, Debug)]
pub struct SyncResult { pub copied: usize, pub removed: usize, pub unchanged: usize, pub warnings: Vec<String> }

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> { app.path().app_data_dir().map(|p| p.join("portable-sync")).map_err(|e| e.to_string()) }
fn hash(bytes: &[u8]) -> String { fs::hex(&Sha256::digest(bytes)) }
fn uuid(id: &str) -> Result<(), String> { uuid::Uuid::parse_str(id).map(|_| ()).map_err(|_| "Invalid portable sync identifier.".into()) }
fn namespace(profile: &Profile) -> String { format!("Kaisu-{}", profile.id) }
fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    disk::create_dir_all(path.parent().ok_or("Invalid sync storage.")?).map_err(|e| e.to_string())?;
    let stage = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let result = (|| { use std::io::Write; let mut f = disk::OpenOptions::new().write(true).create_new(true).open(&stage).map_err(|e| e.to_string())?; f.write_all(&bytes).map_err(|e| e.to_string())?; f.sync_all().map_err(|e| e.to_string())?; drop(f); disk::rename(&stage, path).map_err(|e| e.to_string()) })();
    if result.is_err() { let _ = disk::remove_file(stage); } result
}
fn profiles(root: &Path) -> Result<Vec<Profile>, String> {
    match disk::read(root.join("profiles.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "The portable profile file is unreadable; it has been kept.".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()), Err(e) => Err(e.to_string()),
    }
}
fn profile(root: &Path, id: &str) -> Result<Profile, String> { uuid(id)?; profiles(root)?.into_iter().find(|p| p.id == id).ok_or("Choose a portable device profile.".into()) }
fn ledger(root: &Path, profile: &Profile) -> Result<Ledger, String> {
    match disk::read(root.join(format!("{}.json", profile.id))) {
        Ok(bytes) => {
            if bytes.len() > 8 * 1024 * 1024 { return Err("The portable sync record is too large.".into()); }
            let ledger: Ledger = serde_json::from_slice(&bytes).map_err(|_| "The portable sync record is unreadable. Device files have been kept.")?;
            if ledger.version != 1 || ledger.profile_id != profile.id || ledger.entries.len() > 20_000 { return Err("Invalid portable sync record.".into()); }
            let mut names = HashSet::new();
            for entry in &ledger.entries {
                fs::relative(&entry.relative)?;
                if !entry.relative.starts_with("Music/") && !entry.relative.starts_with("Playlists/") { return Err("Invalid managed portable path.".into()); }
                if entry.output_hash.len() != 64 || !entry.output_hash.bytes().all(|c| c.is_ascii_hexdigit()) || !names.insert(&entry.relative) { return Err("Invalid managed portable file record.".into()); }
            }
            Ok(ledger)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Ledger { version: 1, profile_id: profile.id.clone(), entries: Vec::new() }), Err(e) => Err(e.to_string()),
    }
}
fn connected(profile: &Profile) -> Result<(), String> {
    if !Path::new(&profile.folder).is_dir() { return Err("Device folder is unavailable. Reconnect the drive.".into()); }
    let resolved = disk::canonicalize(&profile.folder).map_err(|e| e.to_string())?;
    if scope::plain_path(&resolved) != profile.folder { return Err("The device folder now resolves to a different location. Choose the original mounted folder again.".into()); }
    if profile.volume.is_some() && device::identity(Path::new(&profile.folder)) != profile.volume { return Err("A different drive is using this location. Reconnect the original device or create a new profile.".into()); }
    Ok(())
}
fn device_folder(profile: &Profile, before: &Ledger, create: bool) -> Result<Option<Box<dyn CollectionStorage>>, String> {
    connected(profile)?;
    let root = Folder::root(Path::new(&profile.folder))?;
    let name = namespace(profile);
    // A missing folder is valid for a new profile, never for an existing export on a
    // reconnected/replaced device. The local ledger is authoritative, not a device manifest.
    match root.child(&name, false) {
        Ok(folder) => Ok(Some(Box::new(folder))),
        Err(_) if !Path::new(&profile.folder).join(&name).exists() && before.entries.is_empty() => if create { root.child(&name, true).map(|folder| Some(Box::new(folder) as Box<dyn CollectionStorage>)) } else { Ok(None) },
        Err(e) => Err(format!("The original portable collection folder is unavailable. {e}")),
    }
}
fn status(profile: Profile) -> ProfileStatus { let message = connected(&profile).err().unwrap_or_default(); ProfileStatus { available: message.is_empty(), message, profile } }
fn safe(value: &str, fallback: &str) -> String {
    let mut out = String::new();
    for c in value.chars().filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c)) { if out.len() + c.len_utf8() > 45 { break; } out.push(c); }
    let out = out.trim().trim_matches('.').trim().to_string();
    if out.is_empty() { return fallback.into(); }
    let stem = out.split('.').next().unwrap_or_default().to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"].contains(&stem.as_str()) { format!("_{out}") } else { out }
}
fn progress(channel: &Channel<Progress>, phase: &str, done: usize, total: usize, title: &str) { let _ = channel.send(Progress { phase: phase.into(), done, total, title: title.into() }); }
fn sidecar(media: &Path, path: &Path) -> Result<(), String> {
    let parent = disk::canonicalize(media.parent().ok_or("Invalid music path.")?).map_err(|e| e.to_string())?;
    if ![media.with_extension("lrc"), media.with_extension("txt")].contains(&path.to_path_buf())
        || !disk::symlink_metadata(path).is_ok_and(|m| m.file_type().is_file())
        || !disk::canonicalize(path).is_ok_and(|p| p.parent() == Some(parent.as_path())) { return Err("A lyrics file moved or became a link. Preview again.".into()); }
    Ok(())
}

#[tauri::command]
pub fn portable_sync_devices() -> Vec<device::Device> { device::discover() }
#[tauri::command]
pub fn portable_sync_profiles(app: AppHandle) -> Result<Vec<ProfileStatus>, String> { Ok(profiles(&data_dir(&app)?)?.into_iter().map(status).collect()) }
#[tauri::command]
pub async fn portable_sync_create(app: AppHandle, scope: State<'_, Scope>, name: String, device_id: Option<String>) -> Result<Option<ProfileStatus>, String> {
    let folder = if let Some(id) = device_id {
        PathBuf::from(device::discover().into_iter().find(|d| d.id == id).ok_or("That removable device is no longer connected.")?.location)
    } else {
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.dialog().file().set_title("Choose a portable collection folder").pick_folder(move |folder| { let _ = tx.send(folder); });
        let Some(folder) = rx.await.map_err(|e| e.to_string())? else { return Ok(None) };
        folder.into_path().map_err(|e| e.to_string())?
    };
    let root = disk::canonicalize(folder).map_err(|_| "That folder is unavailable.")?;
    if scope.library_dirs().iter().filter_map(|p| disk::canonicalize(p).ok()).any(|p| root.starts_with(p)) { return Err("Choose a destination outside your music folders so the library cannot sync into itself.".into()); }
    let mut name = name.trim().chars().filter(|c| !c.is_control()).take(80).collect::<String>(); if name.is_empty() { name = "Portable collection".into(); }
    let profile = Profile { id: uuid::Uuid::new_v4().to_string(), name, folder: scope::plain_path(&root), volume: device::identity(&root), format: Format::Original, bitrate: 192, source_kind: "library".into(), source_ids: Vec::new() };
    let data = data_dir(&app)?; let _edit = EDIT.lock().map_err(|_| "Portable profiles are busy.")?;
    let mut profiles = profiles(&data)?; if profiles.len() >= 30 { return Err("You can save up to 30 portable profiles.".into()); }
    profiles.push(profile.clone()); atomic_json(&data.join("profiles.json"), &profiles)?; Ok(Some(status(profile)))
}
#[tauri::command]
pub fn portable_sync_save(app: AppHandle, state: State<'_, SyncState>, id: String, name: String, format: Format, bitrate: u16, source_kind: String, source_ids: Vec<String>) -> Result<ProfileStatus, String> {
    if state.applying.load(Ordering::SeqCst) { return Err("Wait for portable sync to finish before editing a profile.".into()); }
    if name.trim().is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) || ![128,192,256,320].contains(&bitrate) || !["library","playlists","albums"].contains(&source_kind.as_str()) || source_ids.len() > 200 || source_ids.iter().any(|s| s.len() > 500) { return Err("Invalid portable profile options.".into()); }
    let root = data_dir(&app)?; let _edit = EDIT.lock().map_err(|_| "Portable profiles are busy.")?; let mut profiles = profiles(&root)?;
    let profile = profiles.iter_mut().find(|p| p.id == id).ok_or("Profile not found.")?;
    profile.name = name.trim().into(); profile.format = format; profile.bitrate = bitrate; profile.source_kind = source_kind; profile.source_ids = source_ids;
    let saved = profile.clone(); atomic_json(&root.join("profiles.json"), &profiles)?; Ok(status(saved))
}
#[tauri::command]
pub fn portable_sync_forget(app: AppHandle, state: State<'_, SyncState>, id: String) -> Result<(), String> {
    if state.applying.load(Ordering::SeqCst) { return Err("Wait for portable sync to finish before removing a profile.".into()); }
    let root = data_dir(&app)?; let _edit = EDIT.lock().map_err(|_| "Portable profiles are busy.")?; let mut profiles = profiles(&root)?;
    profiles.retain(|p| p.id != id); atomic_json(&root.join("profiles.json"), &profiles)
}
#[tauri::command]
pub fn portable_sync_cancel(state: State<'_, SyncState>, id: String) { if let Ok(mut sessions) = state.sessions.lock() { if let Some(session) = sessions.remove(&id) { session.job.cancel(); } } }

fn build_plan(profile: Profile, before: Ledger, paths: Vec<PathBuf>, playlists: Vec<Playlist>, job: &JobControl, channel: &Channel<Progress>) -> Result<Plan, String> {
    let folder = device_folder(&profile, &before, false)?;
    let mut wanted = Vec::new(); let mut exported = HashMap::new();
    for (i, path) in paths.iter().enumerate() {
        check(job)?; let track = library::read_track(path); progress(channel, "Checking music", i, paths.len(), &track.title);
        let (source_hash, size) = digest(disk::File::open(path).map_err(|e| e.to_string())?, job)?;
        if size == 0 { return Err(format!("{} is empty.", track.title)); }
        let signature = format!("{}|{source_hash}|{:?}|{}", path.display(), profile.format, profile.bitrate);
        let key = hash(signature.as_bytes());
        let ext = if profile.format == Format::Mp3 { "mp3".to_string() } else { path.extension().and_then(|e| e.to_str()).unwrap_or("audio").to_ascii_lowercase() };
        let relative = format!("Music/{}/{}/{}{}-{}.{}", safe(&track.artist, "Unknown artist"), safe(&track.album, "Unknown album"), track.track.map(|n| format!("{n:02} - ")).unwrap_or_default(), safe(&track.title, "Track"), &key[..16], ext);
        #[cfg(windows)] if Path::new(&profile.folder).join(namespace(&profile)).join(&relative).as_os_str().to_string_lossy().encode_utf16().count() >= 260 { return Err("A portable filename is too long. Choose a shorter destination folder.".into()); }
        exported.insert(scope::plain_path(path), (relative.clone(), track.title.clone(), track.duration));
        let expected = if profile.format == Format::Mp3 { ((track.duration.max(0.0) * f64::from(profile.bitrate) * 125.0 * 1.2) as u64).max(size) } else { size };
        wanted.push(Item { entry: Entry { key: key.clone(), relative: relative.clone(), title: track.title.clone(), source_hash, output_hash: String::new(), size: expected }, input: Input::File(path.clone(), None), convert: profile.format == Format::Mp3, duration: track.duration, replaces: None });
        for extension in ["lrc", "txt"] {
            let lyrics = path.with_extension(extension);
            if disk::symlink_metadata(&lyrics).is_err() { continue; }
            sidecar(path, &lyrics)?;
            let (source_hash, size) = digest(disk::File::open(&lyrics).map_err(|e| e.to_string())?, job)?;
            let relative = Path::new(&relative).with_extension(extension).to_string_lossy().replace('\\', "/");
            let key = hash(format!("{key}:{extension}:{source_hash}").as_bytes());
            wanted.push(Item { entry: Entry { key, relative, title: format!("{} ({extension} lyrics)", track.title), source_hash, output_hash: String::new(), size }, input: Input::File(lyrics, Some(path.clone())), convert: false, duration: 0.0, replaces: None });
        }
    }
    let mut lists = playlists;
    lists.push(Playlist { id: "kaisu-collection".into(), name: "Collection".into(), paths: paths.iter().map(|p| scope::plain_path(p)).collect() });
    for list in lists {
        let mut data = String::from("#EXTM3U\n");
        for path in &list.paths {
            let (relative, title, duration) = exported.get(path).ok_or("A playlist changed or includes music outside the selected collection. Preview again.")?;
            data.push_str(&format!("#EXTINF:{},{}\n../{}\n", *duration as u64, title.replace(['\r','\n'], " "), relative));
        }
        let source_hash = hash(data.as_bytes()); let key = hash(format!("playlist:{}:{source_hash}", list.id).as_bytes());
        let relative = format!("Playlists/{}-{}.m3u8", safe(&list.name, "Playlist"), &hash(list.id.as_bytes())[..12]);
        wanted.push(Item { entry: Entry { key, relative, title: format!("Playlist: {}", list.name), source_hash, output_hash: String::new(), size: data.len() as u64 }, input: Input::Bytes(data.into_bytes()), convert: false, duration: 0.0, replaces: None });
    }
    let mut additions = Vec::new(); let mut removals = Vec::new(); let mut kept = Vec::new();
    for (i, item) in wanted.iter_mut().enumerate() {
        let prior = before.entries.iter().find(|e| e.key == item.entry.key);
        if let (Some(prior), Some(folder)) = (prior, &folder) {
            if folder.exists(&prior.relative)? {
                if folder.hash(&prior.relative, job)? != (prior.output_hash.clone(), prior.size) { return Err(format!("{} was changed on the device. It was kept. Restore it or choose another profile before syncing.", prior.title)); }
                item.entry = prior.clone(); continue;
            }
        }
        if let Some(folder) = &folder { if folder.exists(&item.entry.relative)? {
            let previous = before.entries.iter().find(|e| e.relative == item.entry.relative).ok_or_else(|| format!("A file already occupies {}. It was kept.", item.entry.relative))?;
            if folder.hash(&previous.relative, job)? != (previous.output_hash.clone(), previous.size) { return Err(format!("{} was changed on the device and was kept.", previous.title)); }
            item.replaces = Some(previous.clone());
        } }
        additions.push(i);
    }
    for previous in &before.entries {
        if wanted.iter().any(|item| item.entry.relative == previous.relative) { continue; }
        if let Some(folder) = &folder {
            if folder.exists(&previous.relative)? {
                if folder.hash(&previous.relative, job)? == (previous.output_hash.clone(), previous.size) { removals.push(previous.clone()); }
                else { kept.push(previous.clone()); }
            }
        }
    }
    Ok(Plan { profile, before, wanted, additions, removals, kept, created: Instant::now() })
}

#[tauri::command]
pub async fn portable_sync_plan(app: AppHandle, state: State<'_, SyncState>, scope: State<'_, Scope>, profile_id: String, id: String, paths: Vec<String>, playlists: Vec<Playlist>, on_progress: Channel<Progress>) -> Result<PlanView, String> {
    uuid(&id)?;
    let mut playlist_ids = HashSet::new();
    if paths.is_empty() || paths.len() > LIMIT || playlists.len() > 100 || playlists.iter().any(|p| p.paths.len() > LIMIT || p.id.is_empty() || p.id == "kaisu-collection" || !playlist_ids.insert(&p.id) || p.id.len() > 500 || p.name.chars().count() > 500 || p.name.trim().is_empty()) { return Err("Select between 1 and 5000 available songs and up to 100 distinct playlists.".into()); }
    let profile = profile(&data_dir(&app)?, &profile_id)?; connected(&profile)?;
    let before = ledger(&data_dir(&app)?, &profile)?;
    let mut seen = HashSet::new(); let mut sources = Vec::new(); let mut normalized = HashMap::new();
    for path in paths {
        let real = scope.media_file(&path)?; if !library::is_audio(&real) { return Err("Portable collections contain audio files only.".into()); }
        if real.starts_with(Path::new(&profile.folder).join(namespace(&profile))) { return Err("A portable collection cannot be synced back into itself. Exclude its device folder from this selection.".into()); }
        normalized.insert(path, scope::plain_path(&real)); if seen.insert(real.clone()) { sources.push(real); }
    }
    let playlists: Vec<_> = playlists.into_iter().map(|mut p| { for path in &mut p.paths { *path = normalized.get(path).cloned().unwrap_or_default(); } p }).collect();
    let job = Arc::new(JobControl::default());
    {
        let mut sessions = state.sessions.lock().map_err(|_| "Portable sync is busy.")?;
        sessions.retain(|_, s| s.plan.is_none() || s.created.elapsed() < Duration::from_secs(900));
        if sessions.len() >= 4 || sessions.contains_key(&id) { return Err("Close an earlier sync preview before starting another.".into()); }
        sessions.insert(id.clone(), Session { job: job.clone(), plan: None, created: Instant::now() });
    }
    let mut session_cleanup = SessionCleanup { sessions: &state.sessions, id: id.clone(), armed: true };
    let result = tauri::async_runtime::spawn_blocking(move || build_plan(profile, before, sources, playlists, &job, &on_progress)).await.map_err(|e| e.to_string())?;
    let plan = match result { Ok(plan) => plan, Err(error) => { state.sessions.lock().map_err(|_| "Portable sync is busy.")?.remove(&id); return Err(error); } };
    let needed_bytes = plan.additions.iter().map(|i| plan.wanted[*i].entry.size).fold(FLOOR, u64::saturating_add);
    let free_bytes = crate::download::free_space_for(Path::new(&plan.profile.folder))?;
    let view = PlanView { id: id.clone(), destination: Path::new(&plan.profile.folder).join(namespace(&plan.profile)).display().to_string(), additions: plan.additions.iter().map(|i| plan.wanted[*i].entry.title.clone()).collect(), unchanged: plan.wanted.len() - plan.additions.len(), removals: plan.removals.iter().map(|e| e.title.clone()).collect(), protected: plan.kept.iter().map(|e| e.title.clone()).collect(), needed_bytes, free_bytes, conversion: plan.profile.format == Format::Mp3 };
    let mut sessions = state.sessions.lock().map_err(|_| "Portable sync is busy.")?;
    let session = sessions.get_mut(&id).ok_or("Sync preview was cancelled.")?; session.plan = Some(plan);
    session_cleanup.armed = false;
    Ok(view)
}

struct Applying<'a>(&'a AtomicBool);
impl Drop for Applying<'_> { fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); } }
struct SessionCleanup<'a> { sessions: &'a Mutex<HashMap<String, Session>>, id: String, armed: bool }
impl Drop for SessionCleanup<'_> {
    fn drop(&mut self) { if self.armed { if let Ok(mut sessions) = self.sessions.lock() { sessions.remove(&self.id); } } }
}
struct Temporary(PathBuf);
impl Drop for Temporary { fn drop(&mut self) { let _ = disk::remove_file(&self.0); } }
#[tauri::command]
pub async fn portable_sync_apply(app: AppHandle, state: State<'_, SyncState>, scope: State<'_, Scope>, id: String, remove_old: bool, on_progress: Channel<Progress>) -> Result<SyncResult, String> {
    if state.applying.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() { return Err("Another portable sync is running.".into()); }
    let _applying = Applying(&state.applying);
    let (plan, job) = {
        let mut sessions = state.sessions.lock().map_err(|_| "Portable sync is busy.")?;
        let session = sessions.get_mut(&id).ok_or("Preview the portable collection again.")?;
        (session.plan.take().ok_or("This preview was already used. Preview again.")?, session.job.clone())
    };
    let _session_cleanup = SessionCleanup { sessions: &state.sessions, id: id.clone(), armed: true };
    let root = data_dir(&app)?;
    if plan.created.elapsed() > Duration::from_secs(900) || profile(&root, &plan.profile.id)? != plan.profile || ledger(&root, &plan.profile)? != plan.before { return Err("The profile or sync record changed. Preview the collection again.".into()); }
    for item in &plan.wanted { if let Input::File(path, authority) = &item.input {
        let media = authority.as_ref().unwrap_or(path);
        if scope.media_file(&media.display().to_string())? != *media { return Err("A library folder changed. Preview again.".into()); }
        if authority.is_some() { sidecar(media, path)?; }
    } }
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("portable-sync"); disk::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let helpers = if plan.profile.format == Format::Mp3 { Some(engine::locate_ffmpeg(&app).ok_or("Install ffmpeg in Setup before converting a portable collection.")?.0) } else { None };
    let result = tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(proc::DOWNLOAD_JOB.scope(job.clone(), apply_plan(&root, &cache, &plan, helpers.as_deref(), remove_old, job, on_progress)))
    }).await.map_err(|e| e.to_string())?;
    if let Ok(mut sessions) = state.sessions.lock() { sessions.remove(&id); }
    result
}

async fn apply_plan(root: &Path, cache: &Path, plan: &Plan, helpers: Option<&Path>, remove_old: bool, job: Arc<JobControl>, channel: Channel<Progress>) -> Result<SyncResult, String> {
    connected(&plan.profile)?;
    let needed = plan.additions.iter().map(|i| plan.wanted[*i].entry.size).fold(FLOOR, u64::saturating_add);
    if crate::download::free_space_for(Path::new(&plan.profile.folder))? < needed { return Err("There isn't enough free device space. Preview again after freeing space.".into()); }
    let folder = device_folder(&plan.profile, &plan.before, true)?.ok_or("Device folder unavailable.")?;
    let mut ledger = plan.before.clone(); let mut result = SyncResult { copied: 0, removed: 0, unchanged: plan.wanted.len() - plan.additions.len(), warnings: Vec::new() };
    // Recheck every reused output before adding anything; a stale preview must not overwrite device edits.
    for (i, item) in plan.wanted.iter().enumerate() { if !plan.additions.contains(&i) && folder.hash(&item.entry.relative, &job)? != (item.entry.output_hash.clone(), item.entry.size) { return Err("Device contents changed after preview. Preview again.".into()); } }
    for (number, index) in plan.additions.iter().enumerate() {
        check(&job)?; connected(&plan.profile)?; let item = &plan.wanted[*index];
        progress(&channel, if item.convert { "Converting" } else { "Copying" }, number, plan.additions.len(), &item.entry.title);
        let temporary = cache.join(format!("{}.mp3", uuid::Uuid::new_v4()));
        let _temporary = Temporary(temporary.clone());
        let output = match &item.input {
            Input::Bytes(data) => folder.write(&item.entry.relative, &mut Cursor::new(data), item.replaces.as_ref().map(|e| e.output_hash.as_str()), Some(&item.entry.source_hash), &job),
            Input::File(path, _) => {
                if digest(disk::File::open(path).map_err(|e| e.to_string())?, &job)?.0 != item.entry.source_hash { return Err(format!("{} changed after preview. Preview again.", item.entry.title)); }
                if item.convert {
                    if crate::download::free_space_for(cache)? < item.entry.size.saturating_add(FLOOR) { return Err("There isn't enough working space on this computer for conversion.".into()); }
                    let helpers = helpers.ok_or("The converter is unavailable.")?;
                    let args = vec!["-nostdin".into(), "-hide_banner".into(), "-loglevel".into(), "error".into(), "-n".into(), "-i".into(), path.display().to_string(), "-map".into(), "0:a:0".into(), "-map".into(), "0:v:0?".into(), "-c:v".into(), "copy".into(), "-disposition:v".into(), "attached_pic".into(), "-map_metadata".into(), "0".into(), "-c:a".into(), "libmp3lame".into(), "-b:a".into(), format!("{}k", plan.profile.bitrate), temporary.display().to_string()];
                    let converted = proc::run_capture(&helpers.join(format!("ffmpeg{}", engine::EXE)), &args.iter().map(String::as_str).collect::<Vec<_>>(), Duration::from_secs(1800)).await;
                    if let Err(e) = converted { let _ = disk::remove_file(&temporary); return Err(format!("Couldn't convert {}: {e}", item.entry.title)); }
                    let lyrics = crate::lyrics::read_for(path);
                    if let Some(text) = lyrics.synced.or(lyrics.plain) { crate::tags::embed_lyrics(temporary.clone(), text).await?; }
                    let verified = crate::meta::verify_file(&helpers.join(format!("ffprobe{}", engine::EXE)), &temporary, (item.duration > 0.0).then_some(item.duration)).await;
                    if !verified.ok { let _ = disk::remove_file(&temporary); return Err("A converted copy failed verification; the original was kept.".into()); }
                    let copied = folder.write(&item.entry.relative, &mut disk::File::open(&temporary).map_err(|e| e.to_string())?, item.replaces.as_ref().map(|e| e.output_hash.as_str()), None, &job);
                    let _ = disk::remove_file(&temporary); copied
                } else { folder.write(&item.entry.relative, &mut disk::File::open(path).map_err(|e| e.to_string())?, item.replaces.as_ref().map(|e| e.output_hash.as_str()), Some(&item.entry.source_hash), &job) }
            }
        }?;
        let mut entry = item.entry.clone(); entry.output_hash = output.0; entry.size = output.1;
        ledger.entries.retain(|e| e.relative != entry.relative); ledger.entries.push(entry);
        atomic_json(&root.join(format!("{}.json", plan.profile.id)), &ledger)?;
        result.copied += 1; progress(&channel, "Copied and verified", number + 1, plan.additions.len(), &item.entry.title);
    }
    if remove_old { for entry in &plan.removals {
        check(&job)?; connected(&plan.profile)?; progress(&channel, "Removing old managed copies", result.removed, plan.removals.len(), &entry.title);
        match folder.remove_matching(&entry.relative, &entry.output_hash, &job) {
            Ok(()) => { ledger.entries.retain(|e| e.relative != entry.relative); result.removed += 1; atomic_json(&root.join(format!("{}.json", plan.profile.id)), &ledger)?; },
            Err(e) => result.warnings.push(format!("{}: {e}", entry.title)),
        }
    } }
    for entry in &plan.kept { result.warnings.push(format!("{} was changed on the device and was kept.", entry.title)); }
    progress(&channel, "Finished", plan.wanted.len(), plan.wanted.len(), "Portable collection ready");
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_session_cleanup_releases_the_preview_slot() {
        let sessions = Mutex::new(HashMap::new());
        sessions.lock().unwrap().insert("failed".into(), Session { job: Arc::new(JobControl::default()), plan: None, created: Instant::now() });
        {
            let _cleanup = SessionCleanup { sessions: &sessions, id: "failed".into(), armed: true };
        }
        assert!(sessions.lock().unwrap().is_empty());
    }
    fn channel() -> Channel<Progress> { Channel::new(|_| Ok(())) }
    fn fixture() -> (PathBuf, PathBuf, Profile) {
        let root = std::env::temp_dir().join(format!("kaisu-portable-{}", uuid::Uuid::new_v4()));
        let source = root.join("original.wav"); disk::create_dir_all(root.join("device")).unwrap(); disk::create_dir_all(root.join("cache")).unwrap();
        library::tests::tagged_wav(&source, 1, "Song", "Artist", "Album", 1, 2001);
        let folder = disk::canonicalize(root.join("device")).unwrap();
        let profile = Profile { id: uuid::Uuid::new_v4().to_string(), name: "Test device".into(), folder: scope::plain_path(&folder), volume: device::identity(&folder), format: Format::Original, bitrate: 192, source_kind: "library".into(), source_ids: vec![] };
        (root, source, profile)
    }
    #[tokio::test]
    async fn native_sync_is_incremental_exports_relative_playlists_and_keeps_originals() {
        let (root, source, profile) = fixture(); let job = Arc::new(JobControl::default());
        let original = disk::read(&source).unwrap();
        let before = ledger(&root, &profile).unwrap();
        let playlist = Playlist { id: "order".into(), name: "Road trip".into(), paths: vec![scope::plain_path(&source)] };
        let plan = build_plan(profile.clone(), before, vec![source.clone()], vec![playlist.clone()], &job, &channel()).unwrap();
        assert!(!Path::new(&profile.folder).join(namespace(&profile)).exists(), "preview cannot write to the device");
        let result = apply_plan(&root, &root.join("cache"), &plan, None, false, job.clone(), channel()).await.unwrap();
        assert_eq!(result.copied, 3); assert_eq!(disk::read(&source).unwrap(), original);
        let saved = ledger(&root, &profile).unwrap();
        let exported = saved.entries.iter().find(|e| e.relative.starts_with("Music/")).unwrap();
        assert_eq!(disk::read(Path::new(&profile.folder).join(namespace(&profile)).join(&exported.relative)).unwrap(), original);
        for entry in saved.entries.iter().filter(|e| e.relative.starts_with("Playlists/")) {
            let text = disk::read_to_string(Path::new(&profile.folder).join(namespace(&profile)).join(&entry.relative)).unwrap();
            assert!(text.contains("../Music/") && !text.contains(&scope::plain_path(&source)));
        }
        let second = build_plan(profile.clone(), saved, vec![source.clone()], vec![playlist], &job, &channel()).unwrap();
        assert!(second.additions.is_empty());
        let result = apply_plan(&root, &root.join("cache"), &second, None, false, job, channel()).await.unwrap();
        assert_eq!(result.copied, 0); assert_eq!(result.unchanged, 3);
        disk::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn cleanup_removes_only_unchanged_previously_managed_copies() {
        let (root, source, profile) = fixture(); let job = Arc::new(JobControl::default());
        let first = build_plan(profile.clone(), ledger(&root, &profile).unwrap(), vec![source.clone()], vec![], &job, &channel()).unwrap();
        apply_plan(&root, &root.join("cache"), &first, None, false, job.clone(), channel()).await.unwrap();
        let saved = ledger(&root, &profile).unwrap(); let output = Path::new(&profile.folder).join(namespace(&profile));
        let song = saved.entries.iter().find(|e| e.relative.starts_with("Music/")).unwrap().clone();
        disk::write(output.join(&song.relative), b"device-side edit").unwrap(); disk::write(output.join("unrelated.mp3"), b"unrelated").unwrap();
        library::tests::tagged_wav(&source, 2, "New version", "Artist", "Album", 1, 2001);
        let next = build_plan(profile.clone(), saved, vec![source.clone()], vec![], &job, &channel()).unwrap();
        assert_eq!(next.kept.len(), 1); assert_eq!(next.removals.len(), 0);
        let result = apply_plan(&root, &root.join("cache"), &next, None, true, job, channel()).await.unwrap();
        assert_eq!(result.removed, 0); assert!(!result.warnings.is_empty());
        assert_eq!(disk::read(output.join(&song.relative)).unwrap(), b"device-side edit");
        assert_eq!(disk::read(output.join("unrelated.mp3")).unwrap(), b"unrelated");
        assert!(source.is_file()); disk::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn stale_sources_and_cancelled_jobs_never_replace_a_device_file() {
        let (root, source, profile) = fixture(); let job = Arc::new(JobControl::default());
        let plan = build_plan(profile.clone(), ledger(&root, &profile).unwrap(), vec![source.clone()], vec![], &job, &channel()).unwrap();
        disk::write(&source, library::tests::wav(2)).unwrap();
        assert!(apply_plan(&root, &root.join("cache"), &plan, None, false, job.clone(), channel()).await.unwrap_err().contains("changed after preview"));
        job.cancel(); assert!(build_plan(profile.clone(), ledger(&root, &profile).unwrap(), vec![source], vec![], &job, &channel()).is_err());
        assert!(ledger(&root, &profile).unwrap().entries.is_empty()); disk::remove_dir_all(root).unwrap();
    }
    #[test]
    fn portable_names_and_ledger_paths_are_safe_on_both_platforms() {
        assert_eq!(safe("CON", "Unknown"), "_CON"); assert_eq!(safe("../../a:b\\c", "Unknown"), "abc");
        assert!(safe(&"é".repeat(80), "Unknown").len() <= 45);
        for path in ["../outside.mp3", "/absolute.mp3", "Music/../../x", "Music\\escape.mp3", ""] { assert!(fs::relative(path).is_err()); }
    }
    #[test]
    fn a_cancelled_staged_write_cleans_only_its_own_file() {
        let (root, _, profile) = fixture(); let directory = Folder::root(Path::new(&profile.folder)).unwrap();
        let job = Arc::new(JobControl::default()); job.cancel();
        assert!(directory.write("cancelled.mp3", Cursor::new(b"music"), None, None, &job).is_err());
        assert_eq!(disk::read_dir(&profile.folder).unwrap().count(), 0); drop(directory); disk::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn lyrics_sidecars_follow_audio_and_owned_playlists_update_in_place() {
        let (root, source, profile) = fixture(); let job = Arc::new(JobControl::default());
        disk::write(source.with_extension("lrc"), "[00:01.00] First line").unwrap();
        let first = build_plan(profile.clone(), ledger(&root, &profile).unwrap(), vec![source.clone()], vec![], &job, &channel()).unwrap();
        assert_eq!(first.wanted.len(), 3);
        apply_plan(&root, &root.join("cache"), &first, None, false, job.clone(), channel()).await.unwrap();
        let saved = ledger(&root, &profile).unwrap(); let output = Path::new(&profile.folder).join(namespace(&profile));
        let audio = saved.entries.iter().find(|e| e.relative.ends_with(".wav")).unwrap();
        let lyrics = Path::new(&audio.relative).with_extension("lrc");
        assert_eq!(disk::read_to_string(output.join(&lyrics)).unwrap(), "[00:01.00] First line");
        disk::write(source.with_extension("lrc"), "[00:01.00] Edited line").unwrap();
        let next = build_plan(profile.clone(), saved, vec![source.clone()], vec![], &job, &channel()).unwrap();
        assert_eq!(next.additions.len(), 1); assert!(next.wanted[next.additions[0]].replaces.is_some());
        apply_plan(&root, &root.join("cache"), &next, None, false, job, channel()).await.unwrap();
        assert_eq!(disk::read_to_string(output.join(lyrics)).unwrap(), "[00:01.00] Edited line");
        assert_eq!(ledger(&root, &profile).unwrap().entries.len(), 3);
        disk::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn reviewed_pruning_happens_after_new_copies_and_never_touches_unmanaged_files() {
        let (root, source, profile) = fixture(); let job = Arc::new(JobControl::default());
        let first = build_plan(profile.clone(), ledger(&root, &profile).unwrap(), vec![source.clone()], vec![], &job, &channel()).unwrap();
        apply_plan(&root, &root.join("cache"), &first, None, false, job.clone(), channel()).await.unwrap();
        let old = ledger(&root, &profile).unwrap(); let output = Path::new(&profile.folder).join(namespace(&profile));
        let old_audio = old.entries.iter().find(|e| e.relative.starts_with("Music/")).unwrap().relative.clone();
        disk::write(output.join("personal-notes.txt"), b"keep").unwrap();
        library::tests::tagged_wav(&source, 2, "Replacement", "Artist", "Album", 1, 2001);
        let next = build_plan(profile.clone(), old, vec![source.clone()], vec![], &job, &channel()).unwrap();
        assert_eq!(next.removals.len(), 1);
        let result = apply_plan(&root, &root.join("cache"), &next, None, true, job, channel()).await.unwrap();
        assert_eq!(result.removed, 1); assert!(!output.join(old_audio).exists());
        assert_eq!(disk::read(output.join("personal-notes.txt")).unwrap(), b"keep"); assert!(source.is_file());
        disk::remove_dir_all(root).unwrap();
    }
    #[test]
    fn a_replaced_volume_is_detected_before_creating_a_collection() {
        let (root, source, mut profile) = fixture();
        profile.volume = device::identity(Path::new(&profile.folder)).map(|n| n.wrapping_add(1));
        assert!(connected(&profile).is_err()); assert!(source.is_file()); assert_eq!(disk::read_dir(&profile.folder).unwrap().count(), 0);
        disk::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    #[ignore = "requires KAISU_TEST_FFMPEG_DIR with ffmpeg and ffprobe"]
    async fn converted_collection_preserves_embedded_timed_lyrics_and_original() {
        let helpers = PathBuf::from(std::env::var_os("KAISU_TEST_FFMPEG_DIR").expect("set KAISU_TEST_FFMPEG_DIR"));
        let (root, source, mut profile) = fixture();
        crate::tags::embed_lyrics(source.clone(), "[00:00.20]Portable lyrics".into()).await.unwrap();
        let original = disk::read(&source).unwrap();
        profile.format = Format::Mp3; profile.bitrate = 256;
        let job = Arc::new(JobControl::default());
        let plan = build_plan(profile.clone(), ledger(&root, &profile).unwrap(), vec![source.clone()], vec![], &job, &channel()).unwrap();
        apply_plan(&root, &root.join("cache"), &plan, Some(&helpers), false, job, channel()).await.unwrap();
        let saved = ledger(&root, &profile).unwrap();
        let audio = saved.entries.iter().find(|e| e.relative.ends_with(".mp3")).unwrap();
        let exported = Path::new(&profile.folder).join(namespace(&profile)).join(&audio.relative);
        assert_eq!(crate::lyrics::read_for(&exported).synced.as_deref(), Some("[00:00.20]Portable lyrics"));
        assert_eq!(library::read_track(&exported).title, "Song");
        assert_eq!(disk::read(source).unwrap(), original);
        disk::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn junctions_cannot_redirect_a_portable_write() {
        let (root, _, profile) = fixture();
        let outside = root.join("outside"); disk::create_dir(&outside).unwrap();
        let collection = Path::new(&profile.folder).join(namespace(&profile)); disk::create_dir(&collection).unwrap();
        let link = collection.join("Music");
        let status = std::process::Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", "New-Item -ItemType Junction -Path $env:KAISU_TEST_LINK -Target $env:KAISU_TEST_OUTSIDE -ErrorAction Stop | Out-Null"])
            .env("KAISU_TEST_LINK", &link).env("KAISU_TEST_OUTSIDE", &outside).status().unwrap();
        assert!(status.success());
        let folder = fs::Folder::root(&collection).unwrap();
        assert!(folder.write("Music/leak.mp3", &b"no"[..], None, None, &JobControl::default()).is_err());
        assert_eq!(disk::read_dir(&outside).unwrap().count(), 0);
        drop(folder);
        disk::remove_dir(link).unwrap(); disk::remove_dir_all(root).unwrap();
    }
}
