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
- Queued and restored downloads use your current proxy settings. Proxy addresses and passwords are not saved with the queue.

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
- **History** shows everything you have downloaded with its size and channel. Sort and filter it, open files,
  download again, clean up entries for files that were deleted, and export the list as CSV or JSON.

**Finding your way**
- Right-click a download or history row for its actions; Shift+F10 opens the same menu from the keyboard. Selected history rows also offer batch actions.
- Downloads can be filtered by status; History actions groups export and cleanup. File actions groups queue, conversion, copy and delete controls on downloaded files, with Open and Play kept visible.
- Settings opens with general preferences. Choose a section or search for a setting; changes save automatically.

**Music**
- Browse downloaded music by song, album or artist, edit tags, and make playlists you can export as `.m3u8`.
- **Playlist organization:** create and rename folders, move playlists between them, and choose a local JPEG/PNG cover.
  Drag playlists or songs to reorder them; arrow buttons provide the same controls. Removing a folder keeps its playlists.
- **A quieter library:** use the view dropdown to switch between Songs, Albums, Artists, Playlists and Listening. Library filters group format, file availability, favorites and ratings; Library tools holds folders, rescanning and duplicate cleanup.
- **Select several songs:** tick their boxes, Ctrl/Command-click rows to toggle them, or Shift-click a range. Apply tags,
  favorites and ratings together, or play, queue and add the selection to a playlist. Selected actions groups tag, favorite, queue and playlist operations; Rate selected applies a rating. Ctrl/Command+A in the song list
  selects all matching songs, including those off screen; Escape clears the selection. Filtering drops hidden selections.
- **Artwork editor:** Edit tags > Choose image previews a JPEG/PNG before embedding it as the front cover. Apply one cover to an album or remove embedded artwork. Originals are replaced only after the working copy passes verification. Folder artwork stays in place.
- **Import your collection:** Library > Library tools > Music folders adds existing music without moving it. Optional watching checks for
  changes every 15 seconds and when the window regains focus. Missing files stay listed; use the Missing files filter
  and Locate file to reconnect a moved song. Import its new containing folder first if needed.
- **Favorites and ratings:** heart songs from the library or player, rate songs from 0 (unrated) to 5, and filter your collection. Preferences stay local and follow files you relocate.
- **Listening dashboard:** Library > the Listening view shows recently played, most played songs, top artists, completed plays and measured playback time. Earlier play counts are retained; time is measured from this version onward.
- **Smart playlists:** match all or any rules for title, artist, album, genre, format, year, play count, recently added,
  played/unplayed, favorite status or rating. Membership updates automatically; a play counts when a track finishes. Exports save the current matches.
- **Exact duplicates:** compare file contents, choose a copy to keep, and review selected copies before moving them to the Recycle Bin or Trash.
  Permanent deletion is available explicitly. Kaisu checks that copies still match before removal; companion files are kept.
- **Full-screen player:** use the expand button in the player bar for large artwork, synced or plain lyrics, an Up next queue, and playback controls. Click a timed lyric to seek. Escape returns to the app without restarting the song. Online lyric lookup asks for consent.
- Play music in Kaisu with a queue, shuffle, repeat, playback speed and a sleep timer. Long tracks remember your place. Speed, sleep and mini-player controls are grouped in Playback options.
- **Playback transitions:** Settings > Playback transitions enables next-track preloading (on by default) and optional crossfade, up to 12 seconds. Pause, mute and volume affect both songs during overlap. Short tracks use shorter fades; repeat-one and sleep-after-track do not overlap. Exact gapless timing depends on the audio format and system player.
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
