//! Experimental MTP transport (phones and tablets). Storage rules live in `Storage`, which only needs the small
//! `Backend` trait; the Windows Portable Devices implementation is the only code that touches the device API.
//! Files are never replaced in place: MTP has no atomic rename, so an existing name is refused instead of overwritten.
use std::{fs, io::{Read, Write}, path::PathBuf, sync::{Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
use sha2::{Digest, Sha256};
use super::{Profile, fs::{CollectionStorage, check, digest, hex, relative}};
use crate::proc::JobControl;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Node { pub id: String, pub name: String, pub folder: bool, pub size: u64 }

pub(super) trait Backend: Send {
    fn children(&self, parent: &str) -> Result<Vec<Node>, String>;
    fn make_folder(&self, parent: &str, name: &str) -> Result<String, String>;
    fn upload(&self, parent: &str, name: &str, size: u64, source: &mut dyn Read) -> Result<String, String>;
    fn download(&self, id: &str) -> Result<Box<dyn Read>, String>;
    fn remove(&self, id: &str) -> Result<(), String>;
    fn free(&self) -> Result<u64, String>;
}

pub(super) struct Storage<B: Backend> { backend: B, root: String }
struct Spool(PathBuf);
impl Drop for Spool { fn drop(&mut self) { let _ = fs::remove_file(&self.0); } }

fn names(path: &str) -> Result<Vec<String>, String> {
    Ok(relative(path)?.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect())
}
fn only<'a>(nodes: &'a [Node], name: &str) -> Result<Option<&'a Node>, String> {
    let mut found = nodes.iter().filter(|n| n.name == name);
    let first = found.next();
    if found.next().is_some() { return Err(format!("The device lists \"{name}\" more than once. It was kept.")); }
    Ok(first)
}

impl<B: Backend> Storage<B> {
    pub(super) fn new(backend: B, root: String) -> Self { Self { backend, root } }
    fn find(&self, path: &str) -> Result<Option<Node>, String> {
        let mut parent = self.root.clone();
        let parts = names(path)?;
        for (i, part) in parts.iter().enumerate() {
            let Some(node) = only(&self.backend.children(&parent)?, part)?.cloned() else { return Ok(None) };
            if i + 1 == parts.len() { return Ok(Some(node)); }
            if !node.folder { return Err("A portable folder is a file on the device. It was kept.".into()); }
            parent = node.id;
        }
        Ok(None)
    }
    fn parent_of(&self, path: &str) -> Result<(String, String), String> {
        let mut parts = names(path)?;
        let file = parts.pop().ok_or("Invalid portable path.")?;
        let mut parent = self.root.clone();
        for part in parts {
            parent = match only(&self.backend.children(&parent)?, &part)? {
                Some(node) if node.folder => node.id.clone(),
                Some(_) => return Err("A portable folder is a file on the device. It was kept.".into()),
                None => self.backend.make_folder(&parent, &part)?,
            };
        }
        Ok((parent, file))
    }
    fn file(&self, path: &str) -> Result<Node, String> {
        match self.find(path)? {
            Some(node) if !node.folder => Ok(node),
            Some(_) => Err("A portable output is a link or directory. It was kept.".into()),
            None => Err("The device file is missing.".into()),
        }
    }
}

impl<B: Backend> CollectionStorage for Storage<B> {
    fn exists(&self, path: &str) -> Result<bool, String> {
        match self.find(path)? {
            Some(node) if !node.folder => Ok(true),
            Some(_) => Err("A portable output is a link or directory. It was kept.".into()),
            None => Ok(false),
        }
    }
    fn hash(&self, path: &str, job: &JobControl) -> Result<(String, u64), String> {
        digest(self.backend.download(&self.file(path)?.id)?, job)
    }
    fn write(&self, path: &str, input: &mut dyn Read, replace: Option<&str>, expected: Option<&str>, job: &JobControl) -> Result<(String, u64), String> {
        if self.exists(path)? {
            return Err(if replace.is_some() { "Replacing a file on an MTP device isn't supported yet. Remove the old copy from the device first." } else { "A file already occupies a portable output. Preview again; it was not overwritten." }.into());
        }
        // The size must be known before an MTP upload starts, so the source is spooled locally and checked first.
        let spool = Spool(std::env::temp_dir().join(format!("kaisu-mtp-{}.tmp", uuid::Uuid::new_v4())));
        let (hash, size) = {
            let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&spool.0).map_err(|e| e.to_string())?;
            let mut sum = Sha256::new(); let mut size = 0u64; let mut buffer = [0u8; 128 * 1024];
            loop {
                check(job)?;
                let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
                if count == 0 { break; }
                sum.update(&buffer[..count]); file.write_all(&buffer[..count]).map_err(|e| e.to_string())?; size += count as u64;
            }
            file.sync_all().map_err(|e| e.to_string())?;
            (hex(&sum.finalize()), size)
        };
        if expected.is_some_and(|e| e != hash) { return Err("A source file changed during sync. Preview the collection again.".into()); }
        check(job)?;
        let (parent, name) = self.parent_of(path)?;
        let mut source = fs::File::open(&spool.0).map_err(|e| e.to_string())?;
        let uploaded = self.backend.upload(&parent, &name, size, &mut source);
        let verified = match &uploaded {
            Ok(id) => self.backend.download(id).and_then(|reader| digest(reader, job)).map(|v| (v, id.clone())),
            Err(e) => Err(e.clone()),
        };
        match verified {
            Ok((found, _)) if found == (hash.clone(), size) => Ok((hash, size)),
            other => {
                // Remove only what this call created: the object it was just given, never a pre-existing name.
                if let Ok(id) = &uploaded { let _ = self.backend.remove(id); }
                Err(match other { Err(e) => format!("The device copy could not be completed: {e}"), Ok(_) => "The device copy failed verification and was removed. The original was kept.".into() })
            }
        }
    }
    fn remove_matching(&self, path: &str, hash: &str, job: &JobControl) -> Result<(), String> {
        let node = self.file(path)?;
        if digest(self.backend.download(&node.id)?, job)?.0 != hash { return Err("This device file changed after preview. It was kept.".into()); }
        self.backend.remove(&node.id)
    }
}

/// The collection's own folder inside the device storage. A missing one is valid for a new profile only.
pub(super) fn namespace<B: Backend>(backend: &B, root: &str, name: &str, create: bool, ledger_empty: bool) -> Result<Option<String>, String> {
    match only(&backend.children(root)?, name)? {
        Some(node) if node.folder => Ok(Some(node.id.clone())),
        Some(_) => Err("The portable collection name is used by a file on the device. It was kept.".into()),
        None if !ledger_empty => Err("The original portable collection folder is unavailable on the device.".into()),
        None if create => backend.make_folder(root, name).map(Some),
        None => Ok(None),
    }
}

pub(super) fn id_parts(id: &str) -> Option<(&str, &str)> {
    id.strip_prefix("mtp:")?.rsplit_once('|').filter(|(device, storage)| !device.is_empty() && !storage.is_empty())
}
fn ids(profile: &Profile) -> Result<(&str, &str), String> {
    Ok((profile.device_id.as_deref().ok_or("This profile has no device.")?, profile.storage_id.as_deref().ok_or("This profile has no device storage.")?))
}
pub(super) fn check_device(profile: &Profile) -> Result<(), String> {
    let (device, storage) = ids(profile)?;
    wpd::open(device, storage).map(|_| ())
}
pub(super) fn open(profile: &Profile, name: &str, create: bool, ledger_empty: bool) -> Result<Option<Box<dyn CollectionStorage>>, String> {
    let (device, storage) = ids(profile)?;
    let backend = wpd::open(device, storage)?;
    let root = backend.storage_id().to_string();
    Ok(namespace(&backend, &root, name, create, ledger_empty)?.map(|id| Box::new(Storage::new(backend, id)) as Box<dyn CollectionStorage>))
}
pub(super) fn free(profile: &Profile) -> Result<u64, String> {
    let (device, storage) = ids(profile)?;
    wpd::open(device, storage)?.free()
}
/// While a sync runs, background polling must not open the same phone again.
static PAUSED: AtomicBool = AtomicBool::new(false);
static FOUND: Mutex<Option<(Instant, Vec<super::device::Device>)>> = Mutex::new(None);
const FRESH: Duration = Duration::from_secs(20);
pub(super) fn set_paused(paused: bool) { PAUSED.store(paused, Ordering::SeqCst); }
pub(super) fn paused() -> bool { PAUSED.load(Ordering::SeqCst) }
/// Opening each phone is slow and can wake it, so a recent answer is reused for a few seconds.
pub(super) fn discover() -> Vec<super::device::Device> {
    let mut cache = FOUND.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, devices)) = cache.as_ref() && (paused() || at.elapsed() < FRESH) { return devices.clone(); }
    let devices = wpd::devices();
    *cache = Some((Instant::now(), devices.clone()));
    devices
}

#[cfg(not(windows))]
mod wpd {
    use super::*;
    pub struct Device;
    impl Device { pub fn storage_id(&self) -> &str { "" } }
    impl Backend for Device {
        fn children(&self, _: &str) -> Result<Vec<Node>, String> { Err(unsupported()) }
        fn make_folder(&self, _: &str, _: &str) -> Result<String, String> { Err(unsupported()) }
        fn upload(&self, _: &str, _: &str, _: u64, _: &mut dyn Read) -> Result<String, String> { Err(unsupported()) }
        fn download(&self, _: &str) -> Result<Box<dyn Read>, String> { Err(unsupported()) }
        fn remove(&self, _: &str) -> Result<(), String> { Err(unsupported()) }
        fn free(&self) -> Result<u64, String> { Err(unsupported()) }
    }
    fn unsupported() -> String { "MTP devices are only supported on Windows so far. On Linux, mount the device and choose its folder.".into() }
    pub fn open(_: &str, _: &str) -> Result<Device, String> { Err(unsupported()) }
    pub fn devices() -> Vec<super::super::device::Device> { Vec::new() }
}

#[cfg(windows)]
mod wpd {
    use std::ffi::c_void;
    use windows::{
        Win32::{
            Devices::PortableDevices::*,
            Foundation::PROPERTYKEY,
            System::Com::{CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemAlloc, CoTaskMemFree, CoUninitialize, IStream, STGC_DEFAULT, STGM_READ, StructuredStorage::{PROPVARIANT, PropVariantClear}},
            System::Variant::VT_LPWSTR,
        },
        core::{HRESULT, Interface, PCWSTR, PWSTR, w},
    };
    use super::*;

    const GENERIC_READ_WRITE: u32 = 0xC000_0000;
    const RPC_E_CHANGED_MODE: i32 = 0x8001_0106_u32 as i32;
    const DEVICE_ROOT: &str = "DEVICE";

    fn e(error: windows::core::Error) -> String { format!("The device reported an error: {}", error.message().trim()) }
    fn wide(text: &str) -> Vec<u16> { text.encode_utf16().chain(Some(0)).collect() }
    /// Takes ownership of a string the device API allocated.
    unsafe fn take(text: PWSTR) -> String {
        if text.is_null() { return String::new(); }
        let value = unsafe { text.to_string() }.unwrap_or_default();
        unsafe { CoTaskMemFree(Some(text.0 as *const c_void)) };
        value
    }
    fn values() -> Result<IPortableDeviceValues, String> { unsafe { CoCreateInstance(&PortableDeviceValues, None, CLSCTX_INPROC_SERVER) }.map_err(e) }
    fn keys(list: &[&PROPERTYKEY]) -> Result<IPortableDeviceKeyCollection, String> {
        let collection: IPortableDeviceKeyCollection = unsafe { CoCreateInstance(&PortableDeviceKeyCollection, None, CLSCTX_INPROC_SERVER) }.map_err(e)?;
        for key in list { unsafe { collection.Add(*key) }.map_err(e)?; }
        Ok(collection)
    }

    /// One thread's use of COM; interfaces must be released before it ends.
    struct Com(bool);
    impl Com {
        fn start() -> Result<Self, String> {
            // SAFETY: balanced with `CoUninitialize` in `Drop` when this call succeeded.
            let result: HRESULT = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            if result.0 == RPC_E_CHANGED_MODE { return Ok(Com(false)); }
            result.ok().map_err(e)?;
            Ok(Com(true))
        }
    }
    impl Drop for Com { fn drop(&mut self) { if self.0 { unsafe { CoUninitialize() }; } } }

    pub struct Device {
        device: IPortableDevice, content: IPortableDeviceContent, props: IPortableDeviceProperties, resources: IPortableDeviceResources,
        storage: String,
        _com: Com,
    }
    // SAFETY: created and used on one worker thread inside a multithreaded COM apartment, never shared between threads.
    unsafe impl Send for Device {}
    impl Drop for Device { fn drop(&mut self) { let _ = unsafe { self.device.Close() }; } }

    struct Reader(IStream);
    impl Read for Reader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let mut count = 0u32;
            let length = buffer.len().min(1 << 20) as u32;
            // SAFETY: the buffer is valid for `length` bytes for the duration of the call.
            let result = unsafe { self.0.Read(buffer.as_mut_ptr() as *mut c_void, length, Some(&mut count)) };
            result.ok().map_err(|error| std::io::Error::other(error.message()))?;
            Ok(count as usize)
        }
    }

    fn open_device(id: &str) -> Result<(IPortableDevice, Com), String> {
        let com = Com::start()?;
        let device: IPortableDevice = unsafe { CoCreateInstance(&PortableDeviceFTM, None, CLSCTX_INPROC_SERVER) }.map_err(e)?;
        let info = values()?;
        unsafe {
            info.SetStringValue(&WPD_CLIENT_NAME, w!("Kaisu")).map_err(e)?;
            info.SetUnsignedIntegerValue(&WPD_CLIENT_MAJOR_VERSION, 0).map_err(e)?;
            info.SetUnsignedIntegerValue(&WPD_CLIENT_DESIRED_ACCESS, GENERIC_READ_WRITE).map_err(e)?;
            let name = wide(id);
            device.Open(PCWSTR(name.as_ptr()), &info).map_err(|_| "Couldn't open the device. Unlock it and choose File transfer (MTP) mode.".to_string())?;
        }
        Ok((device, com))
    }

    pub fn open(id: &str, storage: &str) -> Result<Device, String> {
        let (device, com) = open_device(id)?;
        let content = unsafe { device.Content() }.map_err(e)?;
        let props = unsafe { content.Properties() }.map_err(e)?;
        let resources = unsafe { content.Transfer() }.map_err(e)?;
        let opened = Device { device, content, props, resources, storage: storage.to_string(), _com: com };
        let known = opened.children(DEVICE_ROOT)?;
        if !known.iter().any(|n| n.id == storage) { return Err("That device storage is no longer available. Reconnect the device.".into()); }
        Ok(opened)
    }
    impl Device {
        pub fn storage_id(&self) -> &str { &self.storage }
        fn info(&self, id: &str) -> Result<Node, String> {
            let wanted = keys(&[&WPD_OBJECT_ORIGINAL_FILE_NAME, &WPD_OBJECT_NAME, &WPD_OBJECT_CONTENT_TYPE, &WPD_OBJECT_SIZE])?;
            let object = wide(id);
            let found = unsafe { self.props.GetValues(PCWSTR(object.as_ptr()), &wanted) }.map_err(e)?;
            let name = unsafe { found.GetStringValue(&WPD_OBJECT_ORIGINAL_FILE_NAME).or_else(|_| found.GetStringValue(&WPD_OBJECT_NAME)) }.map(|n| unsafe { take(n) }).unwrap_or_default();
            let kind = unsafe { found.GetGuidValue(&WPD_OBJECT_CONTENT_TYPE) }.ok();
            let folder = kind.is_some_and(|k| k == WPD_CONTENT_TYPE_FOLDER || k == WPD_CONTENT_TYPE_FUNCTIONAL_OBJECT);
            let size = unsafe { found.GetUnsignedLargeIntegerValue(&WPD_OBJECT_SIZE) }.unwrap_or(0);
            Ok(Node { id: id.to_string(), name, folder, size })
        }
        fn ids(&self, parent: &str) -> Result<Vec<String>, String> {
            let parent = wide(parent);
            let list = unsafe { self.content.EnumObjects(0, PCWSTR(parent.as_ptr()), None::<&IPortableDeviceValues>) }.map_err(e)?;
            let mut found = Vec::new();
            loop {
                let mut batch = [PWSTR::null(); 32];
                let mut fetched = 0u32;
                let result = unsafe { list.Next(&mut batch, &mut fetched) };
                for id in &batch[..fetched as usize] { found.push(unsafe { take(*id) }); }
                if result.is_err() { return Err("The device's file list could not be read.".into()); }
                if fetched == 0 || result.0 != 0 { break; }
                if found.len() > 100_000 { return Err("That device folder has too many items.".into()); }
            }
            Ok(found)
        }
        fn describe(&self, parent: &str, name: &str, kind: &windows::core::GUID) -> Result<IPortableDeviceValues, String> {
            let v = values()?;
            let (parent, name) = (wide(parent), wide(name));
            unsafe {
                v.SetStringValue(&WPD_OBJECT_PARENT_ID, PCWSTR(parent.as_ptr())).map_err(e)?;
                v.SetStringValue(&WPD_OBJECT_NAME, PCWSTR(name.as_ptr())).map_err(e)?;
                v.SetStringValue(&WPD_OBJECT_ORIGINAL_FILE_NAME, PCWSTR(name.as_ptr())).map_err(e)?;
                v.SetGuidValue(&WPD_OBJECT_CONTENT_TYPE, kind).map_err(e)?;
            }
            Ok(v)
        }
    }
    impl Backend for Device {
        fn children(&self, parent: &str) -> Result<Vec<Node>, String> { self.ids(parent)?.iter().map(|id| self.info(id)).collect() }
        fn make_folder(&self, parent: &str, name: &str) -> Result<String, String> {
            let v = self.describe(parent, name, &WPD_CONTENT_TYPE_FOLDER)?;
            let mut id = PWSTR::null();
            unsafe { self.content.CreateObjectWithPropertiesOnly(&v, &mut id) }.map_err(e)?;
            Ok(unsafe { take(id) })
        }
        fn upload(&self, parent: &str, name: &str, size: u64, source: &mut dyn Read) -> Result<String, String> {
            let v = self.describe(parent, name, &WPD_CONTENT_TYPE_GENERIC_FILE)?;
            let format = if name.to_ascii_lowercase().ends_with(".mp3") { WPD_OBJECT_FORMAT_MP3 } else { WPD_OBJECT_FORMAT_UNSPECIFIED };
            unsafe { v.SetUnsignedLargeIntegerValue(&WPD_OBJECT_SIZE, size).map_err(e)?; v.SetGuidValue(&WPD_OBJECT_FORMAT, &format).map_err(e)?; }
            let mut stream: Option<IStream> = None;
            let mut optimal = 0u32;
            unsafe { self.content.CreateObjectWithPropertiesAndData(&v, &mut stream, &mut optimal, std::ptr::null_mut()) }.map_err(e)?;
            let stream = stream.ok_or("The device did not accept the file.")?;
            let mut buffer = vec![0u8; (optimal as usize).clamp(64 * 1024, 4 * 1024 * 1024)];
            let mut sent = 0u64;
            loop {
                let count = source.read(&mut buffer).map_err(|error| error.to_string())?;
                if count == 0 { break; }
                let mut written = 0u32;
                // SAFETY: the buffer holds `count` initialised bytes.
                unsafe { stream.Write(buffer.as_ptr() as *const c_void, count as u32, Some(&mut written)) }.ok().map_err(e)?;
                if written as usize != count { return Err("The device stopped accepting data.".into()); }
                sent += count as u64;
            }
            if sent != size { return Err("The file changed while it was being sent.".into()); }
            unsafe { stream.Commit(STGC_DEFAULT) }.map_err(e)?;
            let data: IPortableDeviceDataStream = stream.cast().map_err(e)?;
            Ok(unsafe { take(data.GetObjectID().map_err(e)?) })
        }
        fn download(&self, id: &str) -> Result<Box<dyn Read>, String> {
            let object = wide(id);
            let mut stream: Option<IStream> = None;
            let mut optimal = 0u32;
            unsafe { self.resources.GetStream(PCWSTR(object.as_ptr()), &WPD_RESOURCE_DEFAULT, STGM_READ.0, &mut optimal, &mut stream) }.map_err(e)?;
            Ok(Box::new(Reader(stream.ok_or("The device did not return the file.")?)))
        }
        fn remove(&self, id: &str) -> Result<(), String> {
            let list: IPortableDevicePropVariantCollection = unsafe { CoCreateInstance(&PortableDevicePropVariantCollection, None, CLSCTX_INPROC_SERVER) }.map_err(e)?;
            let text = wide(id);
            // SAFETY: the allocation holds the NUL-terminated id; `PropVariantClear` releases it.
            unsafe {
                let memory = CoTaskMemAlloc(text.len() * 2) as *mut u16;
                if memory.is_null() { return Err("Out of memory.".into()); }
                std::ptr::copy_nonoverlapping(text.as_ptr(), memory, text.len());
                let mut variant = PROPVARIANT::default();
                let inner = &mut *variant.Anonymous.Anonymous;
                inner.vt = VT_LPWSTR;
                inner.Anonymous.pwszVal = PWSTR(memory);
                let added = list.Add(&variant).map_err(e);
                let _ = PropVariantClear(&mut variant);
                added?;
                self.content.Delete(PORTABLE_DEVICE_DELETE_NO_RECURSION.0 as u32, &list, std::ptr::null_mut()).map_err(e)
            }
        }
        fn free(&self) -> Result<u64, String> {
            let wanted = keys(&[&WPD_STORAGE_FREE_SPACE_IN_BYTES])?;
            let object = wide(&self.storage);
            let found = unsafe { self.props.GetValues(PCWSTR(object.as_ptr()), &wanted) }.map_err(e)?;
            unsafe { found.GetUnsignedLargeIntegerValue(&WPD_STORAGE_FREE_SPACE_IN_BYTES) }.map_err(|_| "The device didn't report its free space.".to_string())
        }
    }

    pub fn devices() -> Vec<super::super::device::Device> {
        let Ok(_com) = Com::start() else { return Vec::new() };
        let Ok(manager) = (unsafe { CoCreateInstance::<_, IPortableDeviceManager>(&PortableDeviceManager, None, CLSCTX_INPROC_SERVER) }) else { return Vec::new() };
        let mut count = 0u32;
        if unsafe { manager.GetDevices(std::ptr::null_mut(), &mut count) }.is_err() || count == 0 { return Vec::new(); }
        let mut found = vec![PWSTR::null(); count as usize];
        if unsafe { manager.GetDevices(found.as_mut_ptr(), &mut count) }.is_err() { return Vec::new(); }
        let mut out = Vec::new();
        for id in found.into_iter().take(count as usize) {
            let pnp = unsafe { take(id) };
            if pnp.is_empty() || pnp.contains('|') { continue; }
            let wide_id = wide(&pnp);
            let mut length = 0u32;
            let _ = unsafe { manager.GetDeviceFriendlyName(PCWSTR(wide_id.as_ptr()), PWSTR::null(), &mut length) };
            let mut name = vec![0u16; length.max(1) as usize];
            let friendly = if length > 0 && unsafe { manager.GetDeviceFriendlyName(PCWSTR(wide_id.as_ptr()), PWSTR(name.as_mut_ptr()), &mut length) }.is_ok() { String::from_utf16_lossy(&name).trim_end_matches('\0').to_string() } else { "Portable device".to_string() };
            // A locked phone, or one set to charge only, cannot be opened; it simply isn't offered.
            let Ok((device, com)) = open_device(&pnp) else { continue };
            let Ok(content) = (unsafe { device.Content() }) else { continue };
            let Ok(props) = (unsafe { content.Properties() }) else { continue };
            let Ok(resources) = (unsafe { content.Transfer() }) else { continue };
            let probe = Device { device, content, props, resources, storage: String::new(), _com: com };
            let Ok(storages) = probe.children(DEVICE_ROOT) else { continue };
            for storage in storages.into_iter().filter(|s| !s.id.contains('|')) {
                out.push(super::super::device::Device { id: format!("mtp:{pnp}|{}", storage.id), label: format!("{friendly} — {} (MTP, experimental)", if storage.name.is_empty() { "Storage" } else { &storage.name }), location: String::new(), transport: "mtp" });
            }
        }
        out
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use std::{cell::RefCell, collections::HashMap, io::Cursor, rc::Rc};

    /// An in-memory device: a tree of folders and files with an optional fault, so the storage rules can be tested without hardware.
    #[derive(Default)]
    pub struct Memory { pub nodes: Rc<RefCell<HashMap<String, (String, Node, Vec<u8>)>>>, pub corrupt_uploads: bool, next: Rc<RefCell<u32>> }
    // SAFETY: tests use it from one thread.
    unsafe impl Send for Memory {}
    impl Backend for Memory {
        fn children(&self, parent: &str) -> Result<Vec<Node>, String> {
            let mut nodes: Vec<_> = self.nodes.borrow().values().filter(|(p, ..)| p == parent).map(|(_, n, _)| n.clone()).collect();
            nodes.sort_by(|a, b| a.id.cmp(&b.id)); Ok(nodes)
        }
        fn make_folder(&self, parent: &str, name: &str) -> Result<String, String> {
            let id = { let mut n = self.next.borrow_mut(); *n += 1; format!("o{n}") };
            self.nodes.borrow_mut().insert(id.clone(), (parent.into(), Node { id: id.clone(), name: name.into(), folder: true, size: 0 }, Vec::new())); Ok(id)
        }
        fn upload(&self, parent: &str, name: &str, size: u64, source: &mut dyn Read) -> Result<String, String> {
            let mut data = Vec::new(); source.read_to_end(&mut data).map_err(|e| e.to_string())?;
            assert_eq!(data.len() as u64, size);
            if self.corrupt_uploads { data.push(0); }
            let id = { let mut n = self.next.borrow_mut(); *n += 1; format!("o{n}") };
            self.nodes.borrow_mut().insert(id.clone(), (parent.into(), Node { id: id.clone(), name: name.into(), folder: false, size }, data)); Ok(id)
        }
        fn download(&self, id: &str) -> Result<Box<dyn Read>, String> { Ok(Box::new(Cursor::new(self.nodes.borrow().get(id).ok_or("gone")?.2.clone()))) }
        fn remove(&self, id: &str) -> Result<(), String> { self.nodes.borrow_mut().remove(id).map(|_| ()).ok_or_else(|| "gone".into()) }
        fn free(&self) -> Result<u64, String> { Ok(1 << 30) }
    }
    fn storage() -> Storage<Memory> {
        let memory = Memory::default();
        let root = namespace(&memory, "root", "Kaisu-test", true, true).unwrap().unwrap();
        Storage::new(memory, root)
    }
    fn job() -> JobControl { JobControl::default() }

    #[test]
    fn files_are_written_verified_and_read_back_in_nested_folders() {
        let s = storage();
        let (hash, size) = s.write("Music/Artist/Album/song.mp3", &mut Cursor::new(b"audio".to_vec()), None, None, &job()).unwrap();
        assert_eq!(size, 5);
        assert!(s.exists("Music/Artist/Album/song.mp3").unwrap() && !s.exists("Music/Artist/other.mp3").unwrap());
        assert_eq!(s.hash("Music/Artist/Album/song.mp3", &job()).unwrap(), (hash.clone(), 5));
        // A second file reuses the folders instead of duplicating them.
        s.write("Music/Artist/Album/two.mp3", &mut Cursor::new(b"more".to_vec()), None, None, &job()).unwrap();
        let folders = s.backend.nodes.borrow().values().filter(|(_, n, _)| n.folder).count();
        assert_eq!(folders, 4, "the collection folder, Music, Artist and Album");
    }
    #[test]
    fn nothing_is_overwritten_and_a_changed_source_is_refused() {
        let s = storage();
        s.write("Music/a.mp3", &mut Cursor::new(b"one".to_vec()), None, None, &job()).unwrap();
        assert!(s.write("Music/a.mp3", &mut Cursor::new(b"two".to_vec()), None, None, &job()).unwrap_err().contains("not overwritten"));
        assert!(s.write("Music/a.mp3", &mut Cursor::new(b"two".to_vec()), Some("abc"), None, &job()).unwrap_err().contains("isn't supported"));
        assert!(s.write("Music/b.mp3", &mut Cursor::new(b"x".to_vec()), None, Some("wrong"), &job()).unwrap_err().contains("source file changed"));
        assert!(!s.exists("Music/b.mp3").unwrap());
        assert_eq!(s.backend.nodes.borrow().values().filter(|(_, n, _)| n.name == "a.mp3").count(), 1);
    }
    #[test]
    fn a_corrupt_upload_is_removed_and_reported() {
        let mut s = storage(); s.backend.corrupt_uploads = true;
        assert!(s.write("Music/a.mp3", &mut Cursor::new(b"audio".to_vec()), None, None, &job()).unwrap_err().contains("failed verification"));
        assert!(!s.exists("Music/a.mp3").unwrap());
    }
    #[test]
    fn removal_only_deletes_a_file_that_still_matches() {
        let s = storage();
        let (hash, _) = s.write("Music/a.mp3", &mut Cursor::new(b"one".to_vec()), None, None, &job()).unwrap();
        assert!(s.remove_matching("Music/a.mp3", "0".repeat(64).as_str(), &job()).unwrap_err().contains("changed"));
        assert!(s.exists("Music/a.mp3").unwrap());
        s.remove_matching("Music/a.mp3", &hash, &job()).unwrap();
        assert!(!s.exists("Music/a.mp3").unwrap());
    }
    #[test]
    fn a_cancelled_job_stops_before_anything_reaches_the_device() {
        let s = storage(); let cancelled = job(); cancelled.cancel();
        assert!(s.write("Music/a.mp3", &mut Cursor::new(b"one".to_vec()), None, None, &cancelled).is_err());
        assert!(!s.exists("Music/a.mp3").unwrap());
    }
    #[test]
    fn files_and_folders_cannot_be_confused_and_paths_stay_relative() {
        let s = storage();
        s.write("Music/a.mp3", &mut Cursor::new(b"one".to_vec()), None, None, &job()).unwrap();
        assert!(s.exists("Music").is_err(), "a folder where a file is expected is refused");
        assert!(s.exists("Music/a.mp3/inside.mp3").is_err(), "a file used as a folder is refused");
        for bad in ["../x.mp3", "/x.mp3", "Music\\x.mp3", ""] { assert!(s.exists(bad).is_err(), "{bad}"); }
    }
    #[test]
    fn the_collection_folder_is_created_only_for_a_new_profile() {
        let m = Memory::default();
        assert_eq!(namespace(&m, "root", "Kaisu-x", false, true).unwrap(), None);
        assert!(namespace(&m, "root", "Kaisu-x", true, false).is_err(), "an existing export whose folder vanished is not silently recreated");
        let id = namespace(&m, "root", "Kaisu-x", true, true).unwrap().unwrap();
        assert_eq!(namespace(&m, "root", "Kaisu-x", false, false).unwrap(), Some(id));
    }
    #[test]
    fn duplicate_names_on_a_device_are_refused() {
        let m = Memory::default();
        m.make_folder("root", "Kaisu-x").unwrap(); m.make_folder("root", "Kaisu-x").unwrap();
        assert!(namespace(&m, "root", "Kaisu-x", true, true).unwrap_err().contains("more than once"));
    }
    #[test]
    fn device_ids_split_into_device_and_storage() {
        assert_eq!(id_parts("mtp:\\\\?\\usb#vid_1&pid_2#abc|s10001"), Some(("\\\\?\\usb#vid_1&pid_2#abc", "s10001")));
        for bad in ["folder:1:/x", "mtp:nopipe", "mtp:|s1", "mtp:dev|"] { assert_eq!(id_parts(bad), None, "{bad}"); }
    }
}
