//! Destination operations remain relative to an open directory capability, rather than
//! turning a validated directory back into an ambient path for a later write or rename.
use std::{fs, path::{Component, Path, PathBuf}};
use cap_primitives::{ambient_authority, fs::{self as cap, OpenOptions}};

pub(super) struct TargetDir {
    logical: PathBuf,
    directory: fs::File,
}

fn ordinary(metadata: &cap_primitives::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use cap_primitives::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 { return false; }
    }
    !metadata.file_type().is_symlink()
}

impl TargetDir {
    pub(super) fn prepare(root: &Path, target: &Path) -> Result<Self, String> {
        let parent = target.parent().ok_or("Invalid destination filename.")?;
        let relative = parent.strip_prefix(root).map_err(|_| "The destination escaped its registered folder.")?;
        let mut directory = cap::open_ambient_dir(root, ambient_authority()).map_err(|e| format!("Couldn't open the destination: {e}"))?;
        for component in relative.components() {
            let Component::Normal(name) = component else { return Err("Invalid destination subfolder.".into()); };
            match cap::create_dir(&directory, Path::new(name), &cap::DirOptions::new()) {
                Ok(()) => {},
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {},
                Err(e) => return Err(format!("Couldn't create the destination subfolder: {e}")),
            }
            let metadata = cap::stat(&directory, Path::new(name), cap::FollowSymlinks::No).map_err(|e| e.to_string())?;
            if !ordinary(&metadata) || !metadata.is_dir() { return Err("Destination subfolders cannot be links or junctions.".into()); }
            // Refuse links atomically at open too. Later file operations use this directory
            // handle, including staging, rename and failure cleanup.
            directory = cap::open_dir_nofollow(&directory, Path::new(name)).map_err(|e| format!("Couldn't secure the destination subfolder: {e}"))?;
        }
        Ok(Self { logical: parent.into(), directory })
    }

    fn name<'a>(&self, target: &'a Path) -> Result<&'a std::ffi::OsStr, String> {
        if target.parent() != Some(self.logical.as_path()) { return Err("The destination escaped its secured folder.".into()); }
        target.file_name().ok_or("Invalid destination filename.".into())
    }

    pub(super) fn occupied(&self, target: &Path) -> Result<bool, String> {
        match cap::stat(&self.directory, Path::new(self.name(target)?), cap::FollowSymlinks::No) {
            Ok(_) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(format!("Couldn't check the destination file: {e}")),
        }
    }

    pub(super) fn has_sidecars(&self, target: &Path) -> Result<bool, String> {
        let prefix = format!("{}.", target.file_stem().ok_or("Invalid destination filename.")?.to_string_lossy());
        for entry in cap::read_dir(&self.directory, Path::new(".")).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            if name.to_string_lossy().starts_with(&prefix) && super::is_sidecar(Path::new(&name)) { return Ok(true); }
        }
        Ok(false)
    }

    fn check_file(&self, target: &Path) -> Result<(), String> {
        match cap::stat(&self.directory, Path::new(self.name(target)?), cap::FollowSymlinks::No) {
            Ok(m) if !ordinary(&m) || !m.is_file() => Err("An existing destination is a link or directory; it was kept.".into()),
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }

    pub(super) fn rename_from(&self, from: &Path, target: &Path) -> Result<(), String> {
        self.check_file(target)?;
        let source = cap::open_ambient_dir(from.parent().ok_or("Invalid source filename.")?, ambient_authority()).map_err(|e| e.to_string())?;
        cap::rename(&source, Path::new(from.file_name().ok_or("Invalid source filename.")?), &self.directory, Path::new(self.name(target)?))
            .map_err(|e| format!("Couldn't move the file: {e}"))
    }

    pub(super) fn copy_checked(&self, from: &Path, target: &Path) -> Result<(), String> {
        self.check_file(target)?;
        let name = self.name(target)?;
        let part = format!("{}.kaisu-part", name.to_string_lossy());
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        { use cap_primitives::fs::OpenOptionsExt; options.mode(0o600); }
        let mut output = cap::open(&self.directory, Path::new(&part), &options).map_err(|e| format!("Couldn't reserve a working copy: {e}"))?;
        let result = (|| {
            let mut input = fs::File::open(from).map_err(|e| format!("Couldn't read the file: {e}"))?;
            let before = input.metadata().map_err(|e| e.to_string())?;
            let copied = std::io::copy(&mut input, &mut output).map_err(|e| format!("Couldn't copy the file: {e}"))?;
            output.sync_all().map_err(|e| format!("Couldn't finish writing the copy: {e}"))?;
            let after = input.metadata().map_err(|e| e.to_string())?;
            if copied != before.len() || after.len() != before.len() || before.modified().ok() != after.modified().ok()
                || output.metadata().map(|m| m.len()).unwrap_or(0) != before.len() {
                return Err("The file changed or the copy came out the wrong size, so the original was kept.".into());
            }
            output.set_permissions(before.permissions()).map_err(|e| format!("Couldn't preserve the file permissions: {e}"))?;
            drop(output);
            self.check_file(target)?;
            cap::rename(&self.directory, Path::new(&part), &self.directory, Path::new(name)).map_err(|e| format!("Couldn't finish the copy: {e}"))
        })();
        if result.is_err() {
            #[cfg(windows)]
            if let Ok(m) = cap::stat(&self.directory, Path::new(&part), cap::FollowSymlinks::No) {
                let mut permissions = m.permissions(); permissions.set_readonly(false);
                let _ = cap::set_permissions(&self.directory, Path::new(&part), permissions);
            }
            let _ = cap::remove_file(&self.directory, Path::new(&part));
        }
        result
    }

    pub(super) fn probe(&self, target: &Path) -> Result<(), String> {
        let name = self.name(target)?;
        let mut options = OpenOptions::new(); options.write(true).create_new(true);
        let file = cap::open(&self.directory, Path::new(name), &options).map_err(|_| "Kaisu can't write to that folder. Is the drive read-only?".to_string())?;
        drop(file);
        cap::remove_file(&self.directory, Path::new(name)).map_err(|e| e.to_string())
    }
}
