//! Which folders Kaisu may move files out of, move them into, and delete from.
//!
//! The webview tells us once, through `set_managed_folders`, which folder holds the downloads and which one finished
//! files are moved to. `transfer_files` and `delete_files` then work only inside those two folders and take no folder
//! from the caller, so a damaged or hostile page can't point a delete at somewhere else. Folders that are far too
//! broad (a drive root, the user's own folder or one that contains it, system folders) are refused: downloading into
//! them still works, but moving and deleting do not.

use std::{
    ffi::OsString,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

use serde::Serialize;
use tauri::State;

#[derive(Default, Clone)]
enum Slot {
    #[default]
    Unset,
    Ok(PathBuf),
    Refused(String),
}

#[derive(Default)]
struct Folders {
    download: Slot,
    moved: Slot,
}

#[derive(Default)]
pub struct Scope {
    inner: Mutex<Folders>,
}

impl Scope {
    fn get(&self, pick: impl Fn(&Folders) -> Slot, unset: &str) -> Result<PathBuf, String> {
        let folders = self.inner.lock().map_err(|_| "Folder settings are unavailable.".to_string())?;
        match pick(&folders) {
            Slot::Ok(p) => Ok(p),
            Slot::Refused(why) => Err(why),
            Slot::Unset => Err(unset.to_string()),
        }
    }

    /// The folder downloads are saved in.
    pub fn download(&self) -> Result<PathBuf, String> {
        self.get(|f| f.download.clone(), "Choose a download folder first.")
    }

    /// A media file inside the download folder or the folder for moved downloads, as its real path. Anything else is refused.
    pub fn media_file(&self, path: &str) -> Result<PathBuf, String> {
        let mut refusal = "That file isn't in a download folder.".to_string();
        for base in [self.download(), self.moved()].into_iter().flatten() {
            match crate::transfer::checked_source(path, &base) {
                Ok(real) => return Ok(real),
                Err(why) => refusal = why,
            }
        }
        Err(refusal)
    }

    /// The folder finished downloads are moved to.
    pub fn moved(&self) -> Result<PathBuf, String> {
        self.get(|f| f.moved.clone(), "Choose a folder for moved downloads first.")
    }
}

/// `path` with every symlink resolved, even when its last parts don't exist yet.
fn lenient_canonical(path: &Path) -> PathBuf {
    let mut tail: Vec<OsString> = Vec::new();
    let mut cur = path;
    loop {
        if let Ok(real) = std::fs::canonicalize(cur) {
            return tail.iter().rev().fold(real, |acc, part| acc.join(part));
        }
        match (cur.parent(), cur.file_name()) {
            (Some(parent), Some(name)) => {
                tail.push(name.to_owned());
                cur = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// Why this folder is too broad to move files in or delete from, or `None` when it is fine.
fn too_broad(path: &Path, home: Option<&Path>, system: &[PathBuf]) -> Option<&'static str> {
    let p = lenient_canonical(path);
    if !p.components().any(|c| matches!(c, Component::Normal(_))) {
        return Some("is the top of a drive");
    }
    if let Some(home) = home
        && lenient_canonical(home).starts_with(&p)
    {
        return Some("is your user folder, or contains it");
    }
    if system.iter().any(|s| p.starts_with(lenient_canonical(s))) {
        return Some("is a system folder");
    }
    None
}

fn system_folders() -> Vec<PathBuf> {
    let mut folders: Vec<PathBuf> = ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"].into_iter().filter_map(std::env::var_os).map(PathBuf::from).collect();
    if cfg!(unix) {
        folders.extend(["/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/run", "/sbin", "/sys", "/usr", "/var"].map(PathBuf::from));
    }
    folders
}

fn home_folder() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

/// Accepts a folder for moving and deleting, or says why not. Empty text means "not set".
fn judge(label: &str, text: &str, home: Option<&Path>, system: &[PathBuf]) -> Slot {
    let text = text.trim();
    if text.is_empty() {
        return Slot::Unset;
    }
    let path = PathBuf::from(text);
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Slot::Refused(format!("The {label} must be a full path."));
    }
    match too_broad(&path, home, system) {
        Some(why) => Slot::Refused(format!("Moving and deleting are turned off for the {label} ({}) because it {why}. Choose a more specific folder.", path.display())),
        None => Slot::Ok(path),
    }
}

#[derive(Serialize)]
pub struct ScopeStatus {
    /// Set when a folder was refused for moving and deleting.
    pub problem: Option<String>,
}

/// Tells Kaisu which folders it may move files out of, move them into, and delete from.
#[tauri::command]
pub fn set_managed_folders(scope: State<'_, Scope>, download: String, moved: String) -> ScopeStatus {
    let (home, system) = (home_folder(), system_folders());
    let (download, moved) = (judge("download folder", &download, home.as_deref(), &system), judge("folder for moved downloads", &moved, home.as_deref(), &system));
    let problem = [&download, &moved].into_iter().find_map(|slot| if let Slot::Refused(why) = slot { Some(why.clone()) } else { None });
    if let Ok(mut folders) = scope.inner.lock() {
        *folders = Folders { download, moved };
    }
    ScopeStatus { problem }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kaisu-scope-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_top_of_a_drive_is_too_broad() {
        let root = std::env::temp_dir().ancestors().last().unwrap().to_path_buf();
        assert!(too_broad(&root, None, &[]).is_some());
    }

    #[test]
    fn the_user_folder_and_its_parents_are_too_broad_but_folders_inside_are_fine() {
        let home = scratch("home");
        let music = home.join("Music");
        assert!(too_broad(&home, Some(&home), &[]).is_some());
        assert!(too_broad(home.parent().unwrap(), Some(&home), &[]).is_some(), "a folder that contains the user folder");
        assert!(too_broad(&music, Some(&home), &[]).is_none(), "even before it exists");
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn system_folders_and_everything_in_them_are_refused() {
        let sys = scratch("sys");
        let system = std::slice::from_ref(&sys);
        assert!(too_broad(&sys, None, system).is_some());
        assert!(too_broad(&sys.join("drivers"), None, system).is_some());
        assert!(too_broad(&scratch("elsewhere"), None, system).is_none());
        std::fs::remove_dir_all(&sys).ok();
    }

    #[test]
    fn a_folder_is_judged_by_its_text() {
        let ok = scratch("ok");
        assert!(matches!(judge("download folder", "", None, &[]), Slot::Unset));
        assert!(matches!(judge("download folder", "   ", None, &[]), Slot::Unset));
        assert!(matches!(judge("download folder", "relative/dir", None, &[]), Slot::Refused(_)));
        assert!(matches!(judge("download folder", &format!("{}/../x", ok.display()), None, &[]), Slot::Refused(_)));
        assert!(matches!(judge("download folder", &ok.display().to_string(), None, &[]), Slot::Ok(_)));
        match judge("folder for moved downloads", &ok.display().to_string(), None, std::slice::from_ref(&ok)) {
            Slot::Refused(why) => assert!(why.contains("folder for moved downloads") && why.contains("system folder"), "{why}"),
            _ => panic!("expected a refusal"),
        }
        std::fs::remove_dir_all(&ok).ok();
    }

    #[test]
    fn nothing_may_be_touched_until_folders_are_registered() {
        let scope = Scope::default();
        assert!(scope.download().is_err() && scope.moved().is_err());
        let dir = scratch("reg");
        *scope.inner.lock().unwrap() = Folders { download: Slot::Ok(dir.clone()), moved: Slot::Refused("no".into()) };
        assert_eq!(scope.download().unwrap(), dir);
        assert_eq!(scope.moved().unwrap_err(), "no");
        std::fs::remove_dir_all(&dir).ok();
    }
}
