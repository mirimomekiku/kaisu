//! The "custom arguments" box in Advanced settings: extra yt-dlp options typed by the user.
//!
//! Only options on a list are accepted, written exactly as yt-dlp spells them (no abbreviations, no `-R3`-style attached
//! values), each with the number of values it takes. Everything else is refused: options that run programs or load plugins,
//! read or write files at paths the user gives (`-o`, `-P`, `--cookies`, `--batch-file`, `--load-info-json`, `--cache-dir`,
//! ...), change where tools are found (`--ffmpeg-location`, `--js-runtimes`, `--downloader`), pass raw arguments to
//! ffmpeg (`--postprocessor-args`), put a login on the command line, or switch off certificate checks. Bare words are
//! refused too, so a link can't be slipped in as a second download. The list below was checked against yt-dlp's own option
//! parser, which is where the number of values comes from.

use serde::Serialize;

/// `(spellings, number of values)`. A flag takes none.
type Allowed = (&'static [&'static str], usize);

const ALLOWED: &[Allowed] = &[
    // Network and reliability
    (&["-R", "--retries"], 1),
    (&["--file-access-retries"], 1),
    (&["--fragment-retries"], 1),
    (&["--retry-sleep"], 1),
    (&["--extractor-retries"], 1),
    (&["--socket-timeout"], 1),
    (&["-4", "--force-ipv4"], 0),
    (&["-6", "--force-ipv6"], 0),
    (&["-N", "--concurrent-fragments"], 1),
    (&["--throttled-rate"], 1),
    (&["--http-chunk-size"], 1),
    (&["--buffer-size"], 1),
    (&["--resize-buffer"], 0),
    (&["--no-resize-buffer"], 0),
    (&["--sleep-interval", "--min-sleep-interval"], 1),
    (&["--max-sleep-interval"], 1),
    (&["--sleep-subtitles"], 1),
    (&["--sleep-requests"], 1),
    (&["--user-agent"], 1),
    (&["--referer"], 1),
    (&["--add-headers"], 1),
    (&["--xff"], 1),
    (&["--impersonate"], 1),
    (&["-r", "--limit-rate", "--rate-limit"], 1),
    (&["--geo-bypass"], 0),
    (&["--no-geo-bypass"], 0),
    (&["--geo-bypass-country"], 1),
    (&["--geo-bypass-ip-block"], 1),
    (&["--extractor-args"], 1),
    (&["--compat-options"], 1),
    (&["--live-from-start"], 0),
    (&["--no-live-from-start"], 0),
    (&["--wait-for-video"], 1),
    (&["--no-wait-for-video"], 0),
    (&["--ignore-no-formats-error"], 0),
    (&["--lazy-playlist"], 0),
    (&["--no-lazy-playlist"], 0),
    // Which formats
    (&["-f", "--format"], 1),
    (&["-S", "--format-sort"], 1),
    (&["--merge-output-format"], 1),
    (&["--prefer-free-formats"], 0),
    (&["--no-prefer-free-formats"], 0),
    (&["--check-formats"], 0),
    (&["--check-all-formats"], 0),
    (&["--no-check-formats"], 0),
    (&["--audio-multistreams"], 0),
    (&["--no-audio-multistreams"], 0),
    (&["--video-multistreams"], 0),
    (&["--no-video-multistreams"], 0),
    // Which videos
    (&["-I", "--playlist-items"], 1),
    (&["--playlist-start"], 1),
    (&["--playlist-end"], 1),
    (&["--match-filters"], 1),
    (&["--no-match-filters"], 0),
    (&["--max-downloads"], 1),
    (&["--min-filesize"], 1),
    (&["--max-filesize"], 1),
    (&["--date"], 1),
    (&["--datebefore"], 1),
    (&["--dateafter"], 1),
    (&["--age-limit"], 1),
    // Converting and tagging
    (&["-x", "--extract-audio"], 0),
    (&["--audio-format"], 1),
    (&["--audio-quality"], 1),
    (&["--remux-video"], 1),
    (&["--recode-video"], 1),
    (&["--embed-subs"], 0),
    (&["--no-embed-subs"], 0),
    (&["--embed-thumbnail"], 0),
    (&["--no-embed-thumbnail"], 0),
    (&["--embed-metadata", "--add-metadata"], 0),
    (&["--no-embed-metadata", "--no-add-metadata"], 0),
    (&["--embed-chapters", "--add-chapters"], 0),
    (&["--no-embed-chapters", "--no-add-chapters"], 0),
    (&["--embed-info-json"], 0),
    (&["--no-embed-info-json"], 0),
    (&["--parse-metadata"], 1),
    (&["--replace-in-metadata"], 3),
    (&["--convert-subs", "--convert-sub", "--convert-subtitles"], 1),
    (&["--convert-thumbnails"], 1),
    (&["--split-chapters", "--split-tracks"], 0),
    (&["--no-split-chapters", "--no-split-tracks"], 0),
    (&["--download-sections"], 1),
    (&["--force-keyframes-at-cuts"], 0),
    (&["--no-force-keyframes-at-cuts"], 0),
    // Extra files
    (&["--write-subs", "--write-srt"], 0),
    (&["--no-write-subs", "--no-write-srt"], 0),
    (&["--write-auto-subs", "--write-automatic-subs"], 0),
    (&["--no-write-auto-subs", "--no-write-automatic-subs"], 0),
    (&["--sub-langs", "--srt-langs"], 1),
    (&["--sub-format"], 1),
    (&["--write-thumbnail"], 0),
    (&["--no-write-thumbnail"], 0),
    (&["--write-all-thumbnails"], 0),
    (&["--write-description"], 0),
    (&["--no-write-description"], 0),
    (&["--write-info-json"], 0),
    (&["--no-write-info-json"], 0),
    (&["--write-comments", "--get-comments"], 0),
    (&["--no-write-comments", "--no-get-comments"], 0),
    // SponsorBlock
    (&["--sponsorblock-mark"], 1),
    (&["--sponsorblock-remove"], 1),
    (&["--sponsorblock-chapter-title"], 1),
    (&["--no-sponsorblock"], 0),
    // File names and overwriting
    (&["--restrict-filenames"], 0),
    (&["--no-restrict-filenames"], 0),
    (&["--windows-filenames"], 0),
    (&["--no-windows-filenames"], 0),
    (&["--trim-filenames", "--trim-file-names"], 1),
    (&["-w", "--no-overwrites"], 0),
    (&["--force-overwrites", "--yes-overwrites"], 0),
    (&["--no-force-overwrites"], 0),
    (&["-c", "--continue"], 0),
    (&["--no-continue"], 0),
    (&["--part"], 0),
    (&["--no-part"], 0),
    (&["--mtime"], 0),
    (&["--no-mtime"], 0),
    (&["--keep-fragments"], 0),
    (&["--no-keep-fragments"], 0),
    // Errors and messages
    (&["-i", "--ignore-errors"], 0),
    (&["--no-abort-on-error"], 0),
    (&["--abort-on-error", "--no-ignore-errors"], 0),
    (&["--abort-on-unavailable-fragments", "--no-skip-unavailable-fragments"], 0),
    (&["--skip-unavailable-fragments", "--no-abort-on-unavailable-fragments"], 0),
    (&["-v", "--verbose"], 0),
    (&["--no-warnings"], 0),
];

/// Options that are refused for a reason worth saying out loud, because people paste them from recipes found online.
const RUNS_PROGRAMS: &[&str] = &[
    "--exec",
    "--exec-before-download",
    "--netrc-cmd",
    "--plugin-dirs",
    "--config-locations",
    "--config-location",
    "--print-to-file",
    "--downloader",
    "--external-downloader",
    "--downloader-args",
    "--external-downloader-args",
    "--use-postprocessor",
    "--postprocessor-args",
    "--ppa",
    "--ffmpeg-location",
    "--js-runtimes",
    "--remote-components",
];

/// Splits like a shell: whitespace separates, single or double quotes group.
pub fn split_args(input: &str) -> Result<Vec<String>, String> {
    let (mut out, mut cur, mut quote, mut has_token) = (Vec::new(), String::new(), None::<char>, false);
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some('"'), '\\') if matches!(chars.peek(), Some('"') | Some('\\')) => cur.extend(chars.next()),
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => {
                quote = Some(c);
                has_token = true;
            }
            (None, c) if c.is_whitespace() => {
                if has_token || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    has_token = false;
                }
            }
            (None, c) => cur.push(c),
        }
    }
    if quote.is_some() {
        return Err("Custom arguments have an unclosed quote.".into());
    }
    if has_token || !cur.is_empty() {
        out.push(cur);
    }
    Ok(out)
}

fn find(name: &str) -> Option<&'static Allowed> {
    ALLOWED.iter().find(|(spellings, _)| spellings.contains(&name))
}

/// Why `name` was refused, in words a person can act on.
fn refusal(token: &str, name: &str) -> String {
    let long = name.to_ascii_lowercase();
    // yt-dlp accepts unambiguous abbreviations, so a shortened spelling of a program-running option counts too.
    if long.len() > 2 && RUNS_PROGRAMS.iter().any(|d| d.starts_with(&long)) {
        return format!("`{token}` isn't allowed because it can run programs on your computer.");
    }
    if !token.starts_with("--") && token.len() > 2 && token.is_char_boundary(2) && find(&token[..2]).is_some() {
        return format!("Write `{} {}` as two separate words. Options and their values can't be joined (`{token}`).", &token[..2], &token[2..]);
    }
    if !token.starts_with('-') {
        return format!("`{token}` isn't an option. Links can't go in this box; use the search box.");
    }
    format!("`{token}` isn't one of the options Kaisu allows here. Open \"Allowed options\" to see the list.")
}

/// Checks the text typed into the custom-arguments box and returns it as separate arguments, or says what is wrong.
pub fn parse_custom_args(input: &str) -> Result<Vec<String>, String> {
    if input.len() > 2000 || input.contains('\0') {
        return Err("Custom arguments are too long or contain invalid characters.".into());
    }
    let tokens = split_args(input)?;
    let mut i = 0;
    while i < tokens.len() {
        let token = &tokens[i];
        if token == "--" {
            return Err("Custom arguments can't contain a bare `--`.".into());
        }
        let (name, inline) = match token.split_once('=') {
            Some((n, v)) if token.starts_with("--") => (n, Some(v)),
            _ => (token.as_str(), None),
        };
        let Some((_, values)) = find(name) else { return Err(refusal(token, name)) };
        i += 1;
        let value = inline.or_else(|| tokens.get(i).map(String::as_str));
        if matches!(find(name), Some((spellings, _)) if spellings.contains(&"--compat-options")) {
            // This option can switch off yt-dlp's check on the file extension a website asks for.
            if value.is_some_and(|v| v.to_ascii_lowercase().contains("unsafe-ext")) {
                return Err("`--compat-options` can't turn off the safe file-extension check.".into());
            }
        }
        match (*values, inline) {
            (1, Some(_)) | (0, None) => {}
            (0, Some(_)) => return Err(format!("`{name}` doesn't take a value.")),
            (n, Some(_)) => return Err(format!("`{name}` takes {n} values, which can't be joined with `=`. Write them as separate words.")),
            (n, None) => {
                if i + n > tokens.len() {
                    return Err(format!("`{name}` needs {} value{}.", n, if n == 1 { "" } else { "s" }));
                }
                i += n;
            }
        }
    }
    Ok(tokens)
}

/// Whether the text in the custom-arguments box is acceptable, so Settings can say what is wrong as it is typed.
#[tauri::command]
pub fn check_custom_args(text: String) -> Option<String> {
    parse_custom_args(&text).err()
}

#[derive(Serialize)]
pub struct CustomOption {
    /// Every way yt-dlp lets it be written, shortest first.
    names: Vec<&'static str>,
    /// How many values follow it.
    values: usize,
}

/// The options the custom-arguments box accepts, for showing in Settings.
#[tauri::command]
pub fn allowed_custom_options() -> Vec<CustomOption> {
    ALLOWED.iter().map(|(names, values)| CustomOption { names: names.to_vec(), values: *values }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_args_are_split_like_a_shell() {
        assert_eq!(split_args(r#"--proxy "http://a b" -x 'q r'"#).unwrap(), ["--proxy", "http://a b", "-x", "q r"]);
        assert_eq!(split_args(r#"-o "C:\music\%(title)s.%(ext)s""#).unwrap(), ["-o", r"C:\music\%(title)s.%(ext)s"]);
        assert_eq!(split_args("a  b").unwrap(), ["a", "b"]);
        assert!(split_args("--x \"unterminated").is_err());
    }

    #[test]
    fn ordinary_options_are_accepted() {
        for ok in [
            "--sponsorblock-mark all --embed-chapters -R 3",
            "--retries 10 --fragment-retries=5",
            "-f \"bv*[height<=720]+ba\" -S res,ext",
            "--replace-in-metadata title \"\\s+\" \" \"",
            "--extractor-args youtube:player_client=web --user-agent \"My Agent\"",
            "-x --audio-format opus --embed-thumbnail",
            "--download-sections \"*10-20\"",
            "",
        ] {
            assert!(parse_custom_args(ok).is_ok(), "{ok:?}: {:?}", parse_custom_args(ok));
        }
    }

    #[test]
    fn dangerous_options_are_refused_even_abbreviated_and_say_why() {
        for bad in [
            "--exec touch /tmp/x",
            "--exec=calc",
            "--EXEC=calc",
            "--exec-before-download id",
            "--exec-be=calc",
            "--ex=calc",
            "--netrc-cmd foo",
            "--plugin-dirs /tmp",
            "--print-to-file x y",
            "--downloader aria2c",
            "--external-downloader x",
            "--ppa ffmpeg:-y",
            "--postprocessor-args x",
            "--ffmpeg-location /tmp",
            "--js-runtimes deno:/tmp/x",
        ] {
            let why = parse_custom_args(bad).unwrap_err();
            assert!(why.contains("can run programs"), "{bad} -> {why}");
        }
    }

    #[test]
    fn options_that_touch_files_or_the_network_in_surprising_ways_are_refused() {
        for bad in [
            "-o /etc/x",
            "--output /x",
            "-P /tmp",
            "--paths /tmp",
            "--cookies /etc/passwd",
            "--cookies-from-browser chrome:/x",
            "--batch-file urls.txt",
            "-a urls.txt",
            "--load-info-json x.json",
            "--cache-dir /tmp",
            "--download-archive /tmp/a",
            "--config-locations x",
            "--username u",
            "-u u",
            "--password p",
            "--video-password p",
            "--no-check-certificates",
            "--proxy http://evil:1",
            "--sponsorblock-api http://evil",
            "--allow-unplayable-formats",
            "-F",
            "--list-formats",
            "-j",
            "--dump-json",
            "--print x",
            "-q",
            "--yes-playlist",
        ] {
            assert!(parse_custom_args(bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn compat_options_cannot_disable_the_extension_check() {
        assert!(parse_custom_args("--compat-options no-keep-subs").is_ok());
        assert!(parse_custom_args("--compat-options allow-unsafe-ext").is_err());
        assert!(parse_custom_args("--compat-options=no-keep-subs,allow-unsafe-ext").is_err());
    }

    #[test]
    fn spellings_must_be_exact() {
        assert!(parse_custom_args("--retr 3").is_err(), "no abbreviations");
        assert!(parse_custom_args("--RETRIES 3").is_err(), "no other capitals");
        let why = parse_custom_args("-R3").unwrap_err();
        assert!(why.contains("two separate words"), "{why}");
        assert!(parse_custom_args("-xv").is_err(), "no combined short flags");
    }

    #[test]
    fn links_and_bare_words_are_refused() {
        let why = parse_custom_args("https://example.com/other").unwrap_err();
        assert!(why.contains("isn't an option"), "{why}");
        assert!(parse_custom_args("--retries 3 https://example.com").is_err());
        assert!(parse_custom_args("--").is_err());
        assert!(parse_custom_args("--retries 3 -- https://example.com").is_err());
    }

    #[test]
    fn the_right_number_of_values_is_required() {
        assert!(parse_custom_args("--retries").unwrap_err().contains("needs 1 value"));
        assert!(parse_custom_args("--replace-in-metadata title x").unwrap_err().contains("needs 3 values"));
        assert!(parse_custom_args("--replace-in-metadata=title x y").unwrap_err().contains("takes 3 values"));
        assert!(parse_custom_args("--embed-chapters=yes").unwrap_err().contains("doesn't take a value"));
        // A value may begin with a dash, like yt-dlp's own parser allows.
        assert!(parse_custom_args("-S -size").is_ok());
        assert!(parse_custom_args("--retries 3 --embed-chapters").is_ok());
    }

    #[test]
    fn the_settings_page_can_ask_whether_the_text_is_acceptable() {
        assert_eq!(check_custom_args("--retries 3".into()), None);
        assert_eq!(check_custom_args("".into()), None);
        assert!(check_custom_args("--exec calc".into()).unwrap().contains("can run programs"));
    }

    #[test]
    fn the_list_has_no_duplicates_and_nothing_dangerous_slipped_in() {
        let mut seen = std::collections::HashSet::new();
        for (names, _) in ALLOWED {
            for n in *names {
                assert!(seen.insert(*n), "{n} is listed twice");
                assert!(n.starts_with('-') && !n.contains(' ') && !n.contains('='), "{n}");
                assert!(!RUNS_PROGRAMS.contains(n), "{n} runs programs but is allowed");
            }
        }
        for never in ["-o", "-P", "-a", "--proxy", "--cookies", "--exec", "--config-locations", "--cache-dir", "--no-check-certificates"] {
            assert!(!seen.contains(never), "{never} must never be allowed");
        }
        assert!(allowed_custom_options().len() > 100);
    }
}
