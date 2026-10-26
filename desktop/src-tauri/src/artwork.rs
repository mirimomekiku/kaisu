//! Images are granted by a native chooser, validated, and kept briefly behind opaque tokens.
use std::{collections::VecDeque, fs, io::{Cursor, Read}, sync::{Arc, Mutex, atomic::{AtomicU64, Ordering}}};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, ipc::Response};
use tauri_plugin_dialog::DialogExt;
const MAX_BYTES: u64 = 8 * 1024 * 1024;
static NEXT: AtomicU64 = AtomicU64::new(1);
#[derive(Default)]
pub struct ArtworkStore(Mutex<VecDeque<(String, Arc<Vec<u8>>)>>);
#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ArtworkEdit { Replace { token: String }, Remove }
#[derive(Serialize)]
pub struct ArtworkChoice { token: String, name: String }

pub fn validate(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_BYTES { return Err("Choose a JPEG or PNG image up to 8 MB.".into()); }
    let mut reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|e| e.to_string())?;
    if !matches!(reader.format(), Some(image::ImageFormat::Jpeg | image::ImageFormat::Png)) { return Err("Artwork must be a JPEG or PNG image.".into()); }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096); limits.max_image_height = Some(4096); limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    reader.decode().map_err(|e| format!("This image cannot be decoded (maximum 4096 by 4096 pixels): {e}"))?;
    Ok(())
}
impl ArtworkStore {
    pub fn insert(&self, bytes: Vec<u8>, name: String) -> Result<ArtworkChoice, String> {
        validate(&bytes)?;
        let token = format!("art-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        let mut images = self.0.lock().map_err(|_| "Artwork is unavailable.")?;
        while images.len() >= 4 { images.pop_front(); }
        images.push_back((token.clone(), Arc::new(bytes)));
        Ok(ArtworkChoice { token, name })
    }
    pub fn get(&self, token: &str) -> Result<Arc<Vec<u8>>, String> {
        self.0.lock().map_err(|_| "Artwork is unavailable.")?.iter().find(|(id, _)| id == token).map(|(_, bytes)| bytes.clone()).ok_or("Choose the artwork again; its preview expired.".into())
    }
}
#[tauri::command]
pub async fn library_choose_artwork(app: AppHandle, store: State<'_, ArtworkStore>) -> Result<Option<ArtworkChoice>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().set_title("Choose album artwork").add_filter("JPEG or PNG", &["jpg", "jpeg", "png"]).pick_file(move |file| { let _ = tx.send(file); });
    let Some(file) = rx.await.map_err(|e| e.to_string())? else { return Ok(None) };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let file = fs::File::open(&path).map_err(|e| e.to_string())?;
        if !file.metadata().map_err(|e| e.to_string())?.is_file() { return Err("Choose an image file.".to_string()); }
        let mut bytes = Vec::new(); file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        validate(&bytes)?; Ok::<_, String>(bytes)
    }).await.map_err(|e| e.to_string())??;
    Ok(Some(store.insert(bytes, name)?))
}
#[tauri::command]
pub fn library_artwork_preview(store: State<'_, ArtworkStore>, token: String) -> Result<Response, String> { Ok(Response::new(store.get(&token)?.as_ref().clone())) }
#[tauri::command]
pub fn library_discard_artwork(store: State<'_, ArtworkStore>, token: String) { if let Ok(mut images) = store.0.lock() { images.retain(|(id, _)| id != &token); } }

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    pub fn png() -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2).write_to(&mut bytes, image::ImageFormat::Png).unwrap(); bytes.into_inner()
    }
    #[test]
    fn image_validation_decodes_and_enforces_type_size_and_dimensions() {
        assert!(validate(&png()).is_ok()); assert!(validate(b"not an image").is_err());
        assert!(validate(&vec![0; MAX_BYTES as usize + 1]).is_err());
        let mut huge = Cursor::new(Vec::new()); image::DynamicImage::new_rgb8(4097, 1).write_to(&mut huge, image::ImageFormat::Png).unwrap();
        assert!(validate(&huge.into_inner()).is_err());
        let mut truncated = png(); truncated.truncate(20); assert!(validate(&truncated).is_err());
    }
}
