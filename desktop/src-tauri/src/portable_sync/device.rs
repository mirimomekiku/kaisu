//! Mounted-folder discovery is a transport boundary. MTP devices can later supply a
//! separate transport implementation without pretending shell objects are file paths.
use std::path::Path;
#[cfg(target_os = "linux")] use std::fs;
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct Device { pub id: String, pub label: String, pub location: String, pub transport: &'static str }

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetDriveTypeW(root: *const u16) -> u32;
    fn GetVolumePathNameW(file: *const u16, root: *mut u16, length: u32) -> i32;
    fn GetVolumeInformationW(root: *const u16, name: *mut u16, length: u32, serial: *mut u32, maximum: *mut u32, flags: *mut u32, filesystem: *mut u16, filesystem_length: u32) -> i32;
}
pub(super) fn identity(path: &Path) -> Option<u64> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut root = [0u16; 32768]; let mut serial = 0;
        // SAFETY: live NUL-terminated input and correctly sized writable output buffers.
        unsafe {
            if GetVolumePathNameW(path.as_ptr(), root.as_mut_ptr(), root.len() as u32) == 0 { return None; }
            if GetVolumeInformationW(root.as_ptr(), std::ptr::null_mut(), 0, &mut serial, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), 0) == 0 { return None; }
        }
        Some(serial as u64)
    }
    #[cfg(not(windows))]
    { crate::download::volume_id(path) }
}
pub fn discover() -> Vec<Device> {
    let mut locations = Vec::new();
    #[cfg(windows)]
    for letter in b'A'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        let wide: Vec<u16> = root.encode_utf16().chain(Some(0)).collect();
        // DRIVE_REMOVABLE. USB disks reported as fixed can still be chosen explicitly.
        if unsafe { GetDriveTypeW(wide.as_ptr()) } == 2 { locations.push(root); }
    }
    #[cfg(target_os = "linux")]
    if let Ok(mounts) = fs::read_to_string("/proc/mounts") {
        for line in mounts.lines() {
            let Some(location) = line.split_whitespace().nth(1) else { continue };
            let location = location.replace("\\040", " ").replace("\\011", "\t").replace("\\134", "\\");
            if ["/media/", "/run/media/", "/mnt/"].iter().any(|p| location.starts_with(p)) { locations.push(location); }
        }
    }
    locations.sort(); locations.dedup();
    let mut devices: Vec<Device> = locations.into_iter().filter(|p| Path::new(p).is_dir()).map(|location| Device {
        id: format!("folder:{}:{}", identity(Path::new(&location)).map(|v| v.to_string()).unwrap_or_default(), location),
        label: format!("Removable folder {location}"), location, transport: "mounted_folder",
    }).collect();
    devices.extend(super::mtp::discover());
    devices
}
