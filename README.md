# Kaisu

Kaisu downloads videos and music from YouTube and hundreds of other sites. It is a simple desktop app for Windows
and Linux, plus a text-based version for the terminal. Behind the scenes it uses the well-known
[yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg tools.

> Kaisu is in early development (version 0.0.x). Expect rough edges.

## Getting it

Download the latest **kaisu** file for your system from the
[Releases page](https://github.com/mirimomekiku/kaisu/releases) and run it. There is nothing to install.

The first time you open it, Kaisu offers to download the helper tools it needs (about 100-200 MB). It takes one click,
keeps everything in its own folder, and changes nothing else on your computer. It warns you if the disk is too full,
works behind a proxy, and can check again if you installed the tools yourself. A short tour then shows you around.

## What you can do

**Find and download**
- Search YouTube, YouTube Music (songs) or SoundCloud from one box, or paste a link. Playlists and channels work too, and you can paste or
  drop several links at once.
- Choose video or audio, pick a quality, and download only the part of a video you want.
- Save subtitles inside the video or as separate files, in the languages you choose.
- **Watch before you download:** a "Preview" button fetches the first 20 seconds in low quality and plays them in Kaisu.
- Pause and resume downloads. If you close the app, unfinished downloads come back, paused, next time. If a
  crash or a cancelled download left half-finished files in your download folder, Kaisu offers to ask for those videos
  again (yt-dlp carries on from where it stopped when it can) or to clear them away.
- **Queue:** waiting downloads show their place in line. Drag one onto another to change who starts first, or give a
  single download its own speed limit.
- **Search and bulk editing:** search Downloads by title, URL or folder. Select waiting downloads to change quality,
  audio format, destination or speed together. Running downloads are skipped; changing quality or destination may start a fresh file.
- **Download into a playlist:** Search lets you choose an existing library playlist or create one for audio downloads.
  Waiting items appear on that playlist, and verified files are added automatically. The choice survives queue restoration and recovery.
- **Saved sources:** save a channel or playlist from Search, or paste its link in Saved sources. Check manually for new items,
  review them, and download selected items using saved video/audio and playlist choices. Each check reads up to 500 items;
  older items outside that window may not be detected. Checks do not start background downloads.
- Queued and restored downloads use your current proxy settings. Proxy addresses and passwords are not saved with the queue.
- **File already exists:** choose Keep both (a unique name), Skip existing (the old file is verified first) or Replace in Settings > Downloads.
  Downloads of the same link with the same output choices are not queued twice.
- **Shared limits (Advanced mode):** a total speed budget and a total fragment-connection budget are split between queue slots,
  so idle slots leave bandwidth free. Changing them restarts running transfers, keeping their partial files.
- **Stalls and retries:** a download with no progress shows a notice after 30 seconds and times out after two minutes (conversion
  gets longer). Automatic retries use increasing, jittered delays, and a rate-limited website (HTTP 429) is paused for a cooldown.
- **Private links and headers:** signed-link tokens and private headers are removed from the queue, history, recovery files, logs and
  copied commands. Header values live in the system password store; a restored download that needs them asks for a fresh link.

**Stay organised**
- **Move to an external drive:** choose a drive or folder and Kaisu moves (or copies) finished downloads there by
  itself, keeping your folders. If the drive isn't plugged in, files wait and go as soon as it appears. Nothing is
  removed until the copy has been checked.
- Moving a song also updates its playlists, favorites, ratings, listening records and playback queue.
- **Clean up:** remove downloads older than a number of days. Recycle Bin or Trash is the default; permanent deletion is an explicit choice. Empty the bin to reclaim disk space.
- **Smart names:** save music as Artist / Album folders with track numbers, and tidy "(Official Video)" and similar out
  of titles.
- Files are sorted into folders and named the way you like (by channel, by year, video and audio apart, and so on).
- Kaisu warns you before downloading something you already have, or when your disk is nearly full.
- **History** retains completion records without an automatic 500-entry cutoff. Long lists initially show 500 rows;
  search and export use every matching record, and Show 500 more expands the list. History shows everything you have downloaded with its size and channel. Sort and filter it, open files,
  download again, clean up entries for files that were deleted, and export the list as CSV or JSON.

**Finding your way**
- **Customization settings:** Settings > Customization includes text size (11–16 px), compact or comfortable spacing, artwork
  shapes and reduced motion. Reorder or hide sidebar sections, change its width, toggle artwork/counts, and pin up to 20 playlists
  and 20 saved sources. Playlist pins open that playlist; source pins open the source in Search. Settings always stays reachable.
- **Theme editor:** preview a custom palette in Settings > Customization, then apply it. Color choices use real colors without the
  base theme’s whole-page filters, with contrast checks for readable text. Import/export portable Kaisu theme JSON files; imports
  enter the preview before applying. Use base theme or Reset custom theme to return to built-in colors.
- **Customization presets:** Classic, Compact and Study presets apply appearance, sidebar, seeking and custom palette together.
  Save up to 20 named custom presets, update them from the current settings, or delete them while keeping the current appearance.
- **Seek preferences:** Settings > Playback changes forward/backward intervals (1–120 seconds), Shift fine seeking (1–10 seconds),
  and optional mouse-wheel seeking over the seek bar (off by default, reversible direction). J/L seek while browsing or using the full-screen player, except in text fields and other dialogs;
  arrow keys use the same intervals on a focused seek bar. Full-screen and mini-player share these settings.
- Right-click a download or history row for its actions; Shift+F10 opens the same menu from the keyboard. Selected history rows also offer batch actions.
- Downloads can be filtered by status; History actions groups export and cleanup. File actions groups queue, conversion, copy and delete controls on downloaded files, with Open and Play kept visible.
- Downloads show preparation, downloading, conversion, extras and verification separately. Unknown sizes use indeterminate progress. Pause and cancel cover the entire job, including final helper processes; missing, empty or unreadable output is reported as a failure.
- Destination checks group downloads by drive, reserve space for active jobs and allow three times the estimated size for downloading and conversion. Windows checks the complete generated path; Linux checks filename byte limits and the original recovery drive identity.
- Interrupted downloads keep recovery records independently of the saved queue, with their original URL, destination, output choices and resolved format. Recovery reuses compatible partial files and may restart when they are unavailable. Discarding recovery records keeps media and partial files. Legacy partial-file scanning includes registered alternate destinations.
- Copied download commands use PowerShell syntax on Windows and shell syntax on Linux, with the installed tool paths and redacted proxy passwords.
- Storage failures show a persistent notice with Retry. Normal exit flushes the queue and pending saves; failed reads prevent
  replacement of that saved collection. Invalid settings use safe defaults, and a recovery screen can reset settings after a rendering error.
- Settings opens with general preferences. Choose a section or search for a setting; changes save automatically.

**Music**
- Browse downloaded music by song, album or artist, edit tags, and make playlists you can export as `.m3u8`.
- **Playlist organization:** create and rename folders, move playlists between them, and choose a local JPEG/PNG cover.
  Drag playlists or songs to reorder them; arrow buttons provide the same controls. Removing a folder keeps its playlists.
- **A quieter library:** use the view dropdown to switch between Songs, Albums, Artists, Playlists and Listening. Library filters group format, file availability, favorites and ratings; Library tools holds folders, rescanning and library cleanup.
- **Select several songs:** tick their boxes, Ctrl/Command-click rows to toggle them, or Shift-click a range. Apply tags,
  favorites and ratings together, or play, queue and add the selection to a playlist. Selected actions groups tag, favorite, queue and playlist operations; Rate selected applies a rating. Ctrl/Command+A in the song list
  selects all matching songs, including those off screen; Escape clears the selection. Filtering drops hidden selections.
- **Artwork editor:** Edit tags > Choose image previews a JPEG/PNG before embedding it as the front cover. Apply one cover to an album or remove embedded artwork. Originals are replaced only after the working copy passes verification. Folder artwork stays in place.
- **Import your collection:** Library > Library tools > Music folders adds existing music without moving it. Optional watching checks for
  changes every five minutes while visible, and when the window regains focus after at least a minute. Missing files stay listed; use the Missing files filter
  and Locate file to reconnect a moved song. Import its new containing folder first if needed.
- **Favorites and ratings:** heart songs from the library or player, rate songs from 0 (unrated) to 5, and filter your collection. Preferences stay local and follow files you relocate.
- **Listening dashboard:** Library > the Listening view shows recently played, most played songs, top artists, completed plays and measured playback time. Earlier play counts are retained; time is measured from this version onward.
- **Smart playlists:** Library > Playlists > New smart playlist offers Recently added, Most played, Never played, Favorites and
  Top rated presets, or custom all/any rules for title, artist, album, genre, format, year, play count, recently added,
  played/unplayed, favorite status, rating, duration in seconds and file folders (including subfolders). Preview matches before
  saving, choose an order and direction, and limit results to 1–5,000 songs. Membership updates automatically; a play counts when
  a track finishes. Playback and export follow the chosen order; exports save a snapshot of the current matches.
- **Library health:** the cleanup view opens with one summary of what needs attention: missing files, files that could not be read
  (damaged, empty or not really audio; shown in their folder, never deleted by Kaisu), incomplete metadata and exact duplicates.
- **Library cleanup:** Library > Library tools > Library cleanup reviews missing files and incomplete metadata with search,
  issue filters, 100-row pages and selections of up to 500 songs. Locate moved files, edit individual or shared tags, and open exact
  duplicate review. Missing-entry removal previews the exact paths and verifies each file is still absent before updating the index;
  media files, playlists and listening history are kept. Unavailable music folders must be reconnected first. Metadata checks use
  cached tags and embedded artwork; folder covers are not counted, and filename-derived titles may hide missing title tags.
- **Exact duplicates:** compare file contents, choose a copy to keep, and review selected copies before moving them to the Recycle Bin or Trash.
  Permanent deletion is available explicitly. Kaisu checks that copies still match before removal; companion files are kept.
- **Full-screen player:** use the expand button in the player bar for large artwork, synced or plain lyrics, an Up next queue, and playback controls. Click a timed lyric to seek. Escape returns to the app without restarting the song. Online lyric lookup asks for consent.
- Play music in Kaisu with a queue, shuffle, repeat, playback speed and a sleep timer. Long tracks remember your place. Speed, sleep and mini-player controls are grouped in Playback options.
- Select queued tracks with checkboxes, Ctrl/Command-click or Shift-click; drag them together or use Selected queue actions to move or remove them. Duplicate songs can be selected separately. Undo restores up to 20 queue moves, removals or clears during the session; Ctrl/Command+Z works while the queue is focused. A cleared queue restores paused at its saved position. Adding tracks, replacing the queue or changing shuffle starts a new undo history.
- **Gentle sleep timer:** choose a 10-, 30- or 60-second fade, or no fade. Stop at the deadline or finish the current song
  and fade near its end. Your normal volume returns when the timer stops or is cancelled.
- **Playback transitions:** Settings > Playback transitions enables next-track preloading (on by default) and optional crossfade, up to 12 seconds. Pause, mute and volume affect both songs during overlap. Short tracks use shorter fades; repeat-one and sleep-after-track do not overlap. Exact gapless timing depends on the audio format and system player.
- Choose linear or equal-power crossfades. Consecutive numbered tracks on the same album can play without overlap.
  If an incoming track fails during overlap, Kaisu restores the outgoing song when it can still play.
- **Playback recovery:** failed tracks offer Retry, Locate file and Skip. Optional automatic skipping stops when no
  untried tracks remain, including when repeat is enabled. Loading and buffering time out with a readable recovery message.
- **Audio output and details:** choose an available output in Settings > Playback or Playback options. Permission and
  platform support determine which devices are available. A disconnected device falls back to the system default while
  its preference is retained. Playback details show the file, format, sample rate, bitrate, bit depth and decoder errors when available.
- **Equalizer (Windows and Linux):** open Equalizer from the player bar or full-screen player, or Settings > Playback.
  Adjust ten bands from 31 Hz to 16 kHz and a preamp, choose a preset, or reset to flat. Bypass keeps your adjustments.
  Automatic headroom reduces EQ boosts to help avoid clipping. Settings stay local and apply to both crossfade decks;
  your music files are unchanged.
- **A–B looping:** Playback options (or Playback tools in the full-screen player) sets A and B for a repeating passage.
  Loops are local to the current track, pause crossfade, and clear when you change tracks. Seeking outside the passage disables
  looping. Finish-track sleep takes priority; ordinary sleep deadlines still stop playback. Timing depends on the system player.
- **Playback profiles:** Settings > Playback offers Music, Spoken audio and Practice, plus up to 20 saved profiles.
  A profile applies speed, EQ, transitions, volume leveling and long-track resume. Save your current choices as a new profile,
  or choose a saved profile to update. Manual changes switch the active label to Custom settings.
- **Optional waveform seek bar:** off by default. Enable Settings > Playback > Waveform seek bar to show a local waveform
  in the player bar and full-screen player. Analysis reads only the playing file, keeps a small cache and stops when no view
  needs it. Audio is not uploaded. If analysis is unavailable, too slow or exceeds 24 hours, the ordinary seek bar still works.
- **Listening sessions:** Library > Listening and the player's Playback options keep the latest 30 sessions. Each saves up to
  500 queued tracks around the current song, its position, speed, volume and shuffle/repeat settings. A new queue or a
  30-minute listening break starts a session. Rename sessions, restore a queue paused, or save it as a playlist. Clearing
  session history keeps music files, playlists and listening statistics. Located or automatically moved files update saved sessions too.
- **Mini-player:** use Playback options > Open mini-player for a compact always-on-top window with playback, seek and volume controls.
  Return to the full window without restarting playback.
- Read saved lyrics or choose to look them up online. Measure loudness to make loud songs quieter during playback.
- Podcasts are temporarily hidden, including background checks and automatic episode downloads. Saved subscriptions and
  the implementation are retained.

**Stay in control**
- Run in the background from the tray icon, get a notification when downloads finish, or have Kaisu open the folder,
  quit, sleep or shut down the computer when it is done.
- Use a **proxy** if you need one, and test it before relying on it.
- Set a **bandwidth schedule** (Advanced mode) to slow downloads or hold them back at certain times, such as your
  working hours.
- Copied links are offered to you when you switch back to Kaisu, and links can be dragged onto the window.
- **Play and convert:** finished downloads play inside Kaisu, and can be turned into an MP3, M4A, Opus, FLAC or WAV copy
  (the original is kept).
- Quick actions on every finished download: play it, show it in its folder, copy its location, or delete it. Press
  Ctrl+Shift+L to play the latest one. Keyboard shortcuts cover most other things; press F1 to see them.

**Simple or Advanced**
- **Simple** mode is for everyday use: paste, choose video or audio, download. Problems are explained in plain words.
- **Advanced** mode adds site rules ("anything from this site is audio, as FLAC, saved in this folder"), exact format choice, audio format and quality options, SponsorBlock, browser cookies, speed
  limits, download logs and your own yt-dlp options.
- **Before you download:** the video card says which site rule will change the download (a rule overrides the card's choices) and how
  the file will be saved (folder layout and naming).
- **Original audio:** pick "Original audio (no conversion)" to keep the site's own file, usually Opus or M4A. Volume, silence and
  quality options need conversion, so they are skipped for it. FLAC and WAV note that sites serve compressed audio, so those files
  get larger without sounding better.
- **Password store:** Settings > Network shows whether your system password store works. Without one, a proxy password stays in the
  settings file and private header values are not remembered after Kaisu closes.
- **New versions:** once a day (switch it off in Settings) Kaisu reads the version number on its public releases page and tells you
  when a newer one exists. It never downloads or installs anything; you update by downloading the new file.

Kaisu keeps the downloader up to date automatically, so it keeps working when sites change.

## The terminal version

If you prefer a text interface, run `tui/run-tui.sh` (Linux) or `tui/run-tui.cmd` (Windows). It installs what it needs
the first time. Type words to search, or paste a link, then choose video or audio.

## Good to know

- Search currently works with YouTube, YouTube Music (songs) and SoundCloud. Other sites can still be downloaded by pasting a link.
- A proxy password is kept in your system's password store (Windows Credential Manager, macOS Keychain, or the Secret Service on Linux), not in
  Kaisu's settings file. If your system has no password store, it stays in the settings file, unencrypted.
- The "custom arguments" box in Advanced settings accepts only a list of safe yt-dlp options, written exactly as yt-dlp
  spells them (Settings shows the list). Anything that runs programs or reads or writes files at a path you give is refused.
- Looking up lyrics is off until you agree: it sends the song's artist and title to the free LRCLIB service (lrclib.net).
- Thumbnails are fetched by Kaisu itself, through your proxy if you set one.
- Files sent to the Recycle Bin or Trash can be restored there. If recycling fails, Kaisu reports an error and does not fall back to permanent deletion.
- Imported music stays in its original folders. Automatic download cleanup does not use imported roots. Removing a music folder from the library keeps its files.
- Site-rule destinations are included in the library and listed in Music folders. Previously used destinations stay registered
  after a rule is removed; you can remove them there without deleting their files. Registering a destination does not expand automatic cleanup.
- The Windows app is not code-signed yet, so Windows may warn you the first time you run it.
- Kaisu is for downloading content you have the right to save. You are responsible for following the terms of the
  sites you use and the laws where you live.

## For developers

Build and test instructions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence note

The ffmpeg that Kaisu downloads is the LGPL build, without GPL or non-free codecs. MP3 output uses libmp3lame, which
is included. If you redistribute Kaisu, include the licence texts for ffmpeg and yt-dlp.
