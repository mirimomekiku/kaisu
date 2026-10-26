//! Device writes and deletions are confined to a profile's own directory capability.
use std::{fs, io::{Read, Write}, path::{Component, Path}};
use cap_primitives::{ambient_authority, fs as cap};
use sha2::{Digest, Sha256};
use crate::proc::JobControl;

pub(super) struct Folder(pub fs::File);
/// Device transports implement the same reviewed operations. A future MTP transport
/// can map relative names to object IDs without leaking MTP objects into local paths.
pub(super) trait CollectionStorage: Send {
    fn exists(&self, path: &str) -> Result<bool, String>;
    fn hash(&self, path: &str, job: &JobControl) -> Result<(String, u64), String>;
    fn write(&self, path: &str, input: &mut dyn Read, replace: Option<&str>, expected: Option<&str>, job: &JobControl) -> Result<(String, u64), String>;
    fn remove_matching(&self, path: &str, hash: &str, job: &JobControl) -> Result<(), String>;
}
impl CollectionStorage for Folder {
    fn exists(&self, path: &str) -> Result<bool, String> { Folder::exists(self, path) }
    fn hash(&self, path: &str, job: &JobControl) -> Result<(String, u64), String> { Folder::hash(self, path, job) }
    fn write(&self, path: &str, input: &mut dyn Read, replace: Option<&str>, expected: Option<&str>, job: &JobControl) -> Result<(String, u64), String> { Folder::write(self, path, input, replace, expected, job) }
    fn remove_matching(&self, path: &str, hash: &str, job: &JobControl) -> Result<(), String> { Folder::remove_matching(self, path, hash, job) }
}
fn error(e: impl std::fmt::Display) -> String { format!("The portable folder couldn't be accessed: {e}") }
pub(super) fn relative(path: &str) -> Result<&Path, String> {
    let path = Path::new(path);
    if path.as_os_str().is_empty() || path.components().any(|c| !matches!(c, Component::Normal(_))) || path.as_os_str().to_string_lossy().contains('\\') {
        return Err("Invalid portable relative path.".into());
    }
    Ok(path)
}
fn normal(metadata: &cap::Metadata) -> bool {
    #[cfg(windows)] { use cap::MetadataExt; if metadata.file_attributes() & 0x400 != 0 { return false; } }
    !metadata.file_type().is_symlink()
}
impl Folder {
    pub(super) fn root(path: &Path) -> Result<Self, String> { cap::open_ambient_dir(path, ambient_authority()).map(Self).map_err(error) }
    pub(super) fn child(&self, path: &str, create: bool) -> Result<Self, String> {
        let mut directory = self.0.try_clone().map_err(error)?;
        for part in relative(path)?.components() {
            let Component::Normal(name) = part else { unreachable!() };
            let name = Path::new(name);
            if create { match cap::create_dir(&directory, name, &cap::DirOptions::new()) { Ok(()) => {}, Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}, Err(e) => return Err(error(e)) } }
            let metadata = cap::stat(&directory, name, cap::FollowSymlinks::No).map_err(error)?;
            if !normal(&metadata) || !metadata.is_dir() { return Err("Portable sync refuses links and junctions in its folders.".into()); }
            directory = cap::open_dir_nofollow(&directory, name).map_err(error)?;
        }
        Ok(Self(directory))
    }
    fn parent(&self, path: &str, create: bool) -> Result<(Self, std::ffi::OsString), String> {
        let path = relative(path)?;
        let parent = match path.parent().filter(|p| !p.as_os_str().is_empty()) { Some(p) => self.child(p.to_str().ok_or("Invalid portable path.")?, create)?, None => Self(self.0.try_clone().map_err(error)?) };
        Ok((parent, path.file_name().ok_or("Invalid portable filename.")?.into()))
    }
    pub(super) fn exists(&self, path: &str) -> Result<bool, String> {
        relative(path)?;
        match cap::stat(&self.0, Path::new(path), cap::FollowSymlinks::No) {
            Ok(m) if normal(&m) && m.is_file() => Ok(true),
            Ok(_) => Err("A portable output is a link or directory. It was kept.".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(error(e)),
        }
    }
    pub(super) fn hash(&self, path: &str, job: &JobControl) -> Result<(String, u64), String> {
        let (parent, name) = self.parent(path, false)?;
        let mut options = cap::OpenOptions::new(); options.read(true);
        digest(cap::open(&parent.0, Path::new(&name), &options).map_err(error)?, job)
    }
    /// The caller must have reviewed and revalidated any existing managed output before replacing it.
    pub(super) fn write(&self, path: &str, mut input: impl Read, replace: Option<&str>, expected: Option<&str>, job: &JobControl) -> Result<(String, u64), String> {
        let (parent, name) = self.parent(path, true)?;
        let present = parent.exists(name.to_str().ok_or("Invalid portable filename.")?)?;
        if present {
            let previous = replace.ok_or("A file already occupies a portable output. Preview again; it was not overwritten.")?;
            if parent.hash(name.to_str().ok_or("Invalid portable filename.")?, job)?.0 != previous { return Err("A managed device file changed. It was kept; preview again.".into()); }
        }
        let stage = format!(".kaisu-{}.tmp", uuid::Uuid::new_v4());
        let mut options = cap::OpenOptions::new(); options.write(true).create_new(true);
        let mut output = cap::open(&parent.0, Path::new(&stage), &options).map_err(error)?;
        let result = (|| {
            let mut hash = Sha256::new(); let mut size = 0u64; let mut buffer = [0; 128 * 1024];
            loop {
                check(job)?; let count = input.read(&mut buffer).map_err(error)?; if count == 0 { break; }
                hash.update(&buffer[..count]); output.write_all(&buffer[..count]).map_err(error)?; size += count as u64;
            }
            let hash = hex(&hash.finalize());
            if expected.is_some_and(|e| e != hash) { return Err("A source file changed during sync. Preview the collection again.".into()); }
            output.sync_all().map_err(error)?; drop(output);
            let verified = digest(cap::open(&parent.0, Path::new(&stage), &cap::OpenOptions::new().read(true)).map_err(error)?, job)?;
            if verified != (hash.clone(), size) { return Err("The device copy failed verification. The original was kept.".into()); }
            check(job)?;
            if parent.exists(name.to_str().ok_or("Invalid portable filename.")?)? {
                let previous = replace.ok_or("The portable destination changed. Preview again.")?;
                if parent.hash(name.to_str().ok_or("Invalid portable filename.")?, job)?.0 != previous { return Err("A device file changed during copying and was kept.".into()); }
            }
            cap::rename(&parent.0, Path::new(&stage), &parent.0, Path::new(&name)).map_err(error)?;
            Ok((hash, size))
        })();
        if result.is_err() { let _ = cap::remove_file(&parent.0, Path::new(&stage)); }
        result
    }
    pub(super) fn remove_matching(&self, path: &str, hash: &str, job: &JobControl) -> Result<(), String> {
        if self.hash(path, job)?.0 != hash { return Err("This device file changed after preview. It was kept.".into()); }
        let (parent, name) = self.parent(path, false)?;
        cap::remove_file(&parent.0, Path::new(&name)).map_err(error)
    }
}
pub(super) fn check(job: &JobControl) -> Result<(), String> { if job.is_cancelled() { Err("Portable sync cancelled. Completed copies are kept and can be reused.".into()) } else { Ok(()) } }
pub(super) fn digest(mut input: impl Read, job: &JobControl) -> Result<(String, u64), String> {
    let mut hash = Sha256::new(); let mut length = 0; let mut buffer = [0; 128 * 1024];
    loop { check(job)?; let count = input.read(&mut buffer).map_err(error)?; if count == 0 { break; } hash.update(&buffer[..count]); length += count as u64; }
    Ok((hex(&hash.finalize()), length))
}
pub(super) fn hex(bytes: &[u8]) -> String { bytes.iter().map(|byte| format!("{byte:02x}")).collect() }
