//! Loopback streaming for native media decoders that cannot read a webview's custom asset scheme.
//! URLs contain random capabilities, never paths. Only explicitly authorized files are served.
use std::{
    collections::VecDeque,
    fs::File,
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}},
    time::Duration,
};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct MediaStream(Mutex<Option<Server>>);
struct Server { port: u16, files: Arc<Mutex<VecDeque<(String, PathBuf)>>> }

impl MediaStream {
    pub fn authorize(&self, app: &AppHandle, path: PathBuf) -> Result<String, String> {
        let mut state = self.0.lock().map_err(|_| "The player is busy. Try again.")?;
        if state.is_none() {
            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).map_err(|e| format!("Couldn't start the local player: {e}"))?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let files = Arc::new(Mutex::new(VecDeque::new()));
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
        let server = state.as_ref().unwrap();
        let token = uuid::Uuid::new_v4().simple().to_string();
        let mut files = server.files.lock().map_err(|_| "The player is busy. Try again.")?;
        // Only current/recent playback URLs are retained; the server never exposes a directory.
        if files.len() >= 128 { files.pop_front(); }
        files.push_back((token.clone(), path));
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

fn serve(mut stream: TcpStream, port: u16, files: &Mutex<VecDeque<(String, PathBuf)>>, app: &AppHandle) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(15)))?;
    let mut reader = BufReader::new((&stream).take(8193));
    let mut request = String::new();
    let mut used = reader.read_line(&mut request)?;
    let parts: Vec<_> = request.split_whitespace().collect();
    if parts.len() != 3 || !matches!(parts[0], "GET" | "HEAD") { return status(&mut stream, "405 Method Not Allowed"); }
    let head = parts[0] == "HEAD";
    let token = parts[1].strip_prefix('/').unwrap_or("").to_string();
    if token.len() != 32 || !token.bytes().all(|b| b.is_ascii_hexdigit()) { return status(&mut stream, "404 Not Found"); }
    let mut host = String::new(); let mut range = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?; used += n;
        if used > 8192 || n == 0 { return status(&mut stream, "400 Bad Request"); }
        if line == "\r\n" { break; }
        if let Some((key, value)) = line.split_once(':') {
            if key.eq_ignore_ascii_case("host") { host = value.trim().to_string(); }
            if key.eq_ignore_ascii_case("range") {
                if range.is_some() { return status(&mut stream, "400 Bad Request"); }
                range = Some(value.trim().to_string());
            }
        }
    }
    if host != format!("127.0.0.1:{port}") { return status(&mut stream, "403 Forbidden"); }
    let path = files.lock().ok().and_then(|files| files.iter().find(|(key, _)| key == &token).map(|(_, path)| path.clone()));
    let Some(path) = path else { return status(&mut stream, "404 Not Found"); };
    // Recheck current folder authorization on every request, including seeks after a folder was removed.
    let Ok(real) = app.state::<crate::scope::Scope>().media_file(&path.to_string_lossy()) else { return status(&mut stream, "403 Forbidden"); };
    let Ok(mut file) = File::open(&real) else { return status(&mut stream, "404 Not Found"); };
    let len = file.metadata()?.len();
    let (code, start, end) = if let Some(value) = range {
        let Some((start, end)) = byte_range(&value, len) else {
            write!(stream, "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{len}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
            return Ok(());
        };
        ("206 Partial Content", start, end)
    } else { ("200 OK", 0, len.saturating_sub(1)) };
    let count = if len == 0 { 0 } else { end - start + 1 };
    write!(stream, "HTTP/1.1 {code}\r\nContent-Type: {}\r\nContent-Length: {count}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n", mime(&real))?;
    if code.starts_with("206") { write!(stream, "Content-Range: bytes {start}-{end}/{len}\r\n")?; }
    write!(stream, "\r\n")?;
    if !head { file.seek(SeekFrom::Start(start))?; io::copy(&mut file.take(count), &mut stream)?; }
    Ok(())
}
fn status(stream: &mut TcpStream, code: &str) -> io::Result<()> {
    write!(stream, "HTTP/1.1 {code}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;
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
