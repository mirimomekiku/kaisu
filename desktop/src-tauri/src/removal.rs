//! Explicit permanent deletion or recoverable OS trash; never fall back between modes.
use std::{fs, path::Path};
#[cfg(target_os = "windows")]
mod windows_recycle;

fn remove_with(path: &Path, permanent: bool, recycle: impl FnOnce(&Path) -> Result<(), String>) -> Result<(), String> {
    let kind = fs::symlink_metadata(path).map_err(|e| e.to_string())?.file_type();
    if !kind.is_file() { return Err("Only regular files can be removed; folders and symbolic links are kept.".into()); }
    if permanent { fs::remove_file(path).map_err(|e| format!("Couldn't delete the file: {e}")) }
    else { recycle(path) }
}

pub fn remove(path: &Path, permanent: bool) -> Result<(), String> {
    remove_with(path, permanent, |path| {
        #[cfg(target_os = "windows")]
        let result = windows_recycle::recycle(path);
        #[cfg(not(target_os = "windows"))]
        let result = trash::delete(path).map_err(|e| e.to_string());
        result.map_err(|e| format!("Couldn't move the file to the Recycle Bin or Trash. The file was not permanently deleted: {e}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recycling_failure_never_falls_back_to_permanent_deletion() {
        let dir = crate::library::tests::scratch("recycling-failure");
        let path = dir.join("music.mp3"); fs::write(&path, b"keep").unwrap();
        assert!(remove_with(&dir, false, |_| panic!("folders must not reach the recycle API")).is_err());
        assert!(remove_with(&path, false, |_| Err("No trash on this drive".into())).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"keep");
        remove_with(&path, true, |_| panic!("permanent mode must not call recycle")).unwrap();
        assert!(!path.exists()); fs::remove_dir_all(dir).ok();
    }
}
