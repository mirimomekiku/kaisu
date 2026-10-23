//! Loopback streaming for native media decoders that cannot read a webview's custom asset scheme.
//! URLs contain random capabilities, never paths. Only explicitly authorized files are served.
use std::{
    collections::VecDeque,
    fs::File,
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct MediaStream(Mutex<Option<Server>>);
struct Server { port: u16, files: Arc<Mutex<Files>> }
struct Entry { token: String, path: PathBuf, used: Instant }
type Files = VecDeque<Entry>;

/// A playback URL stops working after this long without a request, so a leaked one does not stay valid forever.
/// Every request, including each seek, renews it, so a long pause does not break resuming.
const IDLE_EXPIRY: Duration = Duration::from_secs(6 * 60 * 60);
const MAX_URLS: usize = 128;

fn drop_expired(files: &mut Files, now: Instant) {
    files.retain(|entry| now.duration_since(entry.used) < IDLE_EXPIRY);
}

/// The webview's own origins. Anything else (a web page in a browser, another local app) is refused.
fn allowed_origin(origin: &str) -> bool {
    matches!(origin, "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost")
        || (cfg!(debug_assertions) && matches!(origin, "http://localhost:1420" | "http://127.0.0.1:1420"))
}

/// Web Audio needs CORS-readable media, so the player's origin is echoed back. Requests without an `Origin` header
/// are not cross-origin and need no CORS headers.
fn cors_headers(origin: Option<&str>) -> String {
    match origin.filter(|o| allowed_origin(o)) {
        Some(origin) => format!("Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\nAccess-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n"),
        None => "Vary: Origin\r\n".to_string(),
    }
}

impl MediaStream {
    pub fn authorize(&self, app: &AppHandle, path: PathBuf) -> Result<String, String> {
        let mut state = self.0.lock().map_err(|_| "The player is busy. Try again.")?;
        if state.is_none() {
            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).map_err(|e| format!("Couldn't start the local player: {e}"))?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let files = Arc::new(Mutex::new(Files::new()));
            let shared = files.clone();
            let app = app.clone();
            std::thread::Builder::new().name("media-stream".into()).spawn(move || {
                let active = Arc::new(AtomicUsize::new(0));
                for stream in listener.incoming().flatten() {
                    if active.fetch_add(1, Ordering::Relaxed) >= 8 { active.fetch_sub(1, Ordering::Relaxed); continue; }
                    let files = shared.clone(); let app = app.clone(); let active = active.clone();
                    std::thread::spawn(move || { let _ = serve(stream, port, &files, &app); active.fetch_sub(1, Ordering::Relaxed); });
                }
            }).map_err(|e| format!("Couldn't start the local player: {e}"))?;
            *state = Some(Server { port, files });
        }
        let Some(server) = state.as_ref() else { return Err("Couldn't start the local player.".into()); };
        let token = uuid::Uuid::new_v4().simple().to_string();
        let mut files = server.files.lock().map_err(|_| "The player is busy. Try again.")?;
        // Only current/recent playback URLs are retained; the server never exposes a directory.
        drop_expired(&mut files, Instant::now());
        if files.len() >= MAX_URLS { files.pop_front(); }
        files.push_back(Entry { token: token.clone(), path, used: Instant::now() });
        Ok(format!("http://127.0.0.1:{}/{token}", server.port))
    }
}

/// A single byte range, including open-ended and suffix ranges. Multi-range is unnecessary for media playback.
fn byte_range(value: &str, len: u64) -> Option<(u64, u64)> {
    if len == 0 { return None; }
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    if start.is_empty() {
        let suffix: u64 = end.parse().ok()?;
        return (suffix > 0).then_some((len.saturating_sub(suffix), len - 1));
    }
    let start: u64 = start.parse().ok()?;
    let end = if end.is_empty() { len - 1 } else { end.parse::<u64>().ok()?.min(len - 1) };
    (start < len && start <= end).then_some((start, end))
}

fn mime(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "mp3" => "audio/mpeg", "m4a" | "m4b" => "audio/mp4", "aac" => "audio/aac", "flac" => "audio/flac",
        "wav" => "audio/wav", "ogg" | "oga" | "opus" => "audio/ogg", "webm" => "video/webm",
        "mp4" | "m4v" => "video/mp4", "mkv" => "video/x-matroska", "aiff" | "aif" => "audio/aiff",
        "wma" => "audio/x-ms-wma", "mov" => "video/quicktime", "avi" => "video/x-msvideo",
        _ => "application/octet-stream",
    }
}

fn serve(mut stream: TcpStream, port: u16, files: &Mutex<Files>, app: &AppHandle) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(15)))?;
    let mut reader = BufReader::new((&stream).take(8193));
    let mut request = String::new();
    let mut used = reader.read_line(&mut request)?;
    let parts: Vec<_> = request.split_whitespace().collect();
    if parts.len() != 3 || !matches!(parts[0], "GET" | "HEAD" | "OPTIONS") { return status(&mut stream, "405 Method Not Allowed", None); }
    let head = parts[0] == "HEAD";
    let preflight = parts[0] == "OPTIONS";
    let token = parts[1].strip_prefix('/').unwrap_or("").to_string();
    if token.len() != 32 || !token.bytes().all(|b| b.is_ascii_hexdigit()) { return status(&mut stream, "404 Not Found", None); }
    let mut host = String::new(); let mut range = None; let mut origin: Option<String> = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?; used += n;
        if used > 8192 || n == 0 { return status(&mut stream, "400 Bad Request", None); }
        if line == "\r\n" { break; }
        if let Some((key, value)) = line.split_once(':') {
            if key.eq_ignore_ascii_case("host") { host = value.trim().to_string(); }
            if key.eq_ignore_ascii_case("origin") { origin = Some(value.trim().to_string()); }
            if key.eq_ignore_ascii_case("range") {
                if range.is_some() { return status(&mut stream, "400 Bad Request", None); }
                range = Some(value.trim().to_string());
            }
        }
    }
    if host != format!("127.0.0.1:{port}") { return status(&mut stream, "403 Forbidden", None); }
    // A request from a page that is not Kaisu's own is refused, even with a valid URL.
    if origin.as_deref().is_some_and(|o| !allowed_origin(o)) { return status(&mut stream, "403 Forbidden", None); }
    let cors = cors_headers(origin.as_deref());
    let path = files.lock().ok().and_then(|mut files| {
        let now = Instant::now();
        drop_expired(&mut files, now);
        files.iter_mut().find(|entry| entry.token == token).map(|entry| { entry.used = now; entry.path.clone() })
    });
    let Some(path) = path else { return status(&mut stream, "404 Not Found", Some(&cors)); };
    // Recheck current folder authorization on every request, including seeks after a folder was removed.
    let Ok(real) = app.state::<crate::scope::Scope>().media_file(&path.to_string_lossy()) else { return status(&mut stream, "403 Forbidden", Some(&cors)); };
    // Capabilities remain random, file-specific and scope-checked.
    if preflight { return status(&mut stream, "204 No Content", Some(&cors)); }
    let Ok(mut file) = File::open(&real) else { return status(&mut stream, "404 Not Found", Some(&cors)); };
    let len = file.metadata()?.len();
    let (code, start, end) = if let Some(value) = range {
        let Some((start, end)) = byte_range(&value, len) else {
            write!(stream, "HTTP/1.1 416 Range Not Satisfiable\r\n{cors}Content-Range: bytes */{len}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
            return Ok(());
        };
        ("206 Partial Content", start, end)
    } else { ("200 OK", 0, len.saturating_sub(1)) };
    let count = if len == 0 { 0 } else { end - start + 1 };
    write!(stream, "HTTP/1.1 {code}\r\n{cors}Content-Type: {}\r\nContent-Length: {count}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n", mime(&real))?;
    if code.starts_with("206") { write!(stream, "Content-Range: bytes {start}-{end}/{len}\r\n")?; }
    write!(stream, "\r\n")?;
    if !head { file.seek(SeekFrom::Start(start))?; io::copy(&mut file.take(count), &mut stream)?; }
    Ok(())
}
fn status(stream: &mut TcpStream, code: &str, cors: Option<&str>) -> io::Result<()> {
    write!(stream, "HTTP/1.1 {code}\r\n{}Content-Length: 0\r\nConnection: close\r\n\r\n", cors.unwrap_or(""))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_apps_own_origins_get_cors_access() {
        let own = cors_headers(Some("tauri://localhost"));
        assert!(own.contains("Access-Control-Allow-Origin: tauri://localhost\r\n"));
        assert!(own.contains("Vary: Origin\r\n"));
        assert!(own.contains("Access-Control-Allow-Headers: Range\r\n"));
        assert!(!own.contains("Access-Control-Allow-Credentials"));
        for other in [Some("https://example.com"), Some("null"), Some("http://tauri.localhost.evil.test"), None] {
            assert!(!cors_headers(other).contains("Access-Control-Allow-Origin"), "{other:?}");
        }
        assert!(allowed_origin("http://tauri.localhost") && !allowed_origin("http://localhost:8080"));
    }
    #[test]
    fn status_sends_the_given_cors_headers() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (mut server, _) = listener.accept().unwrap();
        status(&mut server, "204 No Content", Some(&cors_headers(Some("tauri://localhost")))).unwrap(); drop(server);
        let mut response = String::new(); client.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 204"));
        assert!(response.contains("Access-Control-Allow-Origin: tauri://localhost\r\n"));
    }
    #[test]
    fn unused_urls_expire_but_used_ones_do_not() {
        let now = Instant::now();
        let mut files = Files::new();
        files.push_back(Entry { token: "old".into(), path: PathBuf::new(), used: now - IDLE_EXPIRY - Duration::from_secs(1) });
        files.push_back(Entry { token: "recent".into(), path: PathBuf::new(), used: now - IDLE_EXPIRY + Duration::from_secs(60) });
        drop_expired(&mut files, now);
        assert_eq!(files.iter().map(|e| e.token.as_str()).collect::<Vec<_>>(), ["recent"]);
    }
    #[test]
    fn seek_ranges_cover_explicit_open_ended_and_suffix_requests() {
        assert_eq!(byte_range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(byte_range("bytes=90-", 100), Some((90, 99)));
        assert_eq!(byte_range("bytes=-20", 100), Some((80, 99)));
        assert_eq!(byte_range("bytes=-200", 100), Some((0, 99)));
        assert_eq!(byte_range("bytes=0-999", 100), Some((0, 99)));
    }
    #[test]
    fn invalid_ranges_never_read_outside_the_file() {
        for value in ["bytes=100-", "bytes=4-2", "bytes=-0", "bytes=0-1,3-4", "bytes=x-5", "items=0-1", "bytes=18446744073709551616-"] { assert_eq!(byte_range(value, 100), None, "{value}"); }
        assert_eq!(byte_range("bytes=0-", 0), None);
    }
}
