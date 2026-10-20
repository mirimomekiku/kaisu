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
- Search YouTube or SoundCloud from one box, or paste a link. Playlists and channels work too, and you can paste or
  drop several links at once.
- Choose video or audio, pick a quality, and download only the part of a video you want.
- Save subtitles inside the video or as separate files, in the languages you choose.
- Pause and resume downloads. If you close the app, unfinished downloads come back, paused, next time.

**Stay organised**
- **Move to an external drive:** choose a drive or folder and Kaisu moves (or copies) finished downloads there by
  itself, keeping your folders. If the drive isn't plugged in, files wait and go as soon as it appears. Nothing is
  removed until the copy has been checked.
- **Clean up:** optionally delete downloads older than a number of days so your disk doesn't fill up.
- **Smart names:** save music as Artist / Album folders with track numbers, and tidy "(Official Video)" and similar out
  of titles.
- Files are sorted into folders and named the way you like (by channel, by year, video and audio apart, and so on).
- Kaisu warns you before downloading something you already have, or when your disk is nearly full.
- **History** shows everything you have downloaded with its size and channel. Sort and filter it, open files,
  download again, clean up entries for files that were deleted, and export the list as CSV or JSON.

**Stay in control**
- Run in the background from the tray icon, get a notification when downloads finish, or have Kaisu open the folder,
  quit, sleep or shut down the computer when it is done.
- Use a **proxy** if you need one, and test it before relying on it.
- Set a **bandwidth schedule** (Advanced mode) to slow downloads or hold them back at certain times, such as your
  working hours.
- Copied links are offered to you when you switch back to Kaisu, and links can be dragged onto the window.
- Quick actions on every finished download: play it, show it in its folder, copy its location, or delete it. Press
  Ctrl+Shift+L to play the latest one. Keyboard shortcuts cover most other things; press F1 to see them.

**Simple or Advanced**
- **Simple** mode is for everyday use: paste, choose video or audio, download. Problems are explained in plain words.
- **Advanced** mode adds exact format choice, audio format and quality options, SponsorBlock, browser cookies, speed
  limits, download logs and your own yt-dlp options.

Kaisu keeps the downloader up to date automatically, so it keeps working when sites change.

## The terminal version

If you prefer a text interface, run `tui/run-tui.sh` (Linux) or `tui/run-tui.cmd` (Windows). It installs what it needs
the first time. Type words to search, or paste a link, then choose video or audio.

## Good to know

- Search currently works with YouTube and SoundCloud. Other sites can still be downloaded by pasting a link.
- Proxy logins are stored in Kaisu's settings file without encryption.
- The Windows app is not code-signed yet, so Windows may warn you the first time you run it.
- Kaisu is for downloading content you have the right to save. You are responsible for following the terms of the
  sites you use and the laws where you live.

## For developers

Build and test instructions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence note

The ffmpeg that Kaisu downloads is the LGPL build, without GPL or non-free codecs. MP3 output uses libmp3lame, which
is included. If you redistribute Kaisu, include the licence texts for ffmpeg and yt-dlp.
