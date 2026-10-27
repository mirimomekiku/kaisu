// Scripted stand-in for @tauri-apps/api/core, following the real command/event protocol.
type Ev = Record<string, unknown>;
let nextId = 1;
/** Where a file would be played from. Real Kaisu gives an asset address; here a tiny silent sound (or nothing playable). */
const wavs = new Map<number, string>();
/** A silent sound of the given length, as an address the page can play. */
function silentWav(seconds: number): string {
  const known = wavs.get(seconds);
  if (known) return known;
  const rate = 8000;
  const n = rate * seconds;
  const buf = new Uint8Array(44 + n).fill(128);
  const view = new DataView(buf.buffer);
  const tag = (at: number, text: string) => [...text].forEach((c, i) => (buf[at + i] = c.charCodeAt(0)));
  tag(0, "RIFF");
  view.setUint32(4, 36 + n, true);
  tag(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  tag(36, "data");
  view.setUint32(40, n, true);
  const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  wavs.set(seconds, url);
  return url;
}
export function convertFileSrc(path: string): string {
  if ((window as any).__mock?.unplayable) return `data:application/octet-stream;base64,AAAA#${encodeURIComponent(path)}`;
  const lengths = (window as any).__mock?.audioSeconds;
  return silentWav(typeof lengths === "object" && lengths !== null ? (lengths[path] ?? lengths["*"] ?? 30) : (lengths ?? 30));
}
export class Channel<T = Ev> {
  id = nextId++;
  onmessage: (m: T) => void = () => {};
}
const w = window as any;
w.__mock ??= { ready: false, calls: [] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const comp = (ready: boolean, version: string | null, source: string | null) => ({
  ready, version, source, path: ready ? `/opt/kaisu/${version}` : null,
});
const engine = (ready: boolean) => {
  const partial = !ready && w.__mock.partial;
  return {
    ytdlp: comp(ready || partial, ready || partial ? "2026.08.19" : null, ready || partial ? "managed" : null),
    ffmpeg: comp(ready, ready ? "N-127697" : null, ready ? "managed" : null),
    js: comp(ready, ready ? "deno 2.9.7" : null, ready ? "managed" : null),
    ready,
  };
};

const formats = [
  { id: "140", ext: "m4a", resolution: null, fps: null, vcodec: null, acodec: "mp4a.40.2", filesize: 3_200_000, note: "medium", kind: "audio" },
  { id: "251", ext: "webm", resolution: null, fps: null, vcodec: null, acodec: "opus", filesize: 3_000_000, note: "medium", kind: "audio" },
  { id: "18", ext: "mp4", resolution: "640x360", fps: 30, vcodec: "avc1.42001E", acodec: "mp4a.40.2", filesize: 11_000_000, note: "360p", kind: "both" },
  { id: "136", ext: "mp4", resolution: "1280x720", fps: 30, vcodec: "avc1.4d401f", acodec: null, filesize: 41_000_000, note: "720p", kind: "video" },
  { id: "137", ext: "mp4", resolution: "1920x1080", fps: 60, vcodec: "avc1.640028", acodec: null, filesize: 95_000_000, note: "1080p60", kind: "video" },
];

const thumb = (hue: number) =>
  "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><rect width='480' height='270' fill='hsl(${hue},45%,35%)'/><circle cx='240' cy='135' r='34' fill='white' opacity='.8'/></svg>`);
const idOf = (i: number) => `vid${String(i).padStart(8, "0")}`; // 11 chars

const destinationFolders = (): string[] => JSON.parse(localStorage.getItem("__downloadFolders") ?? "[]");
function musicFolders() {
  const folders = structuredClone(w.__mock.musicFolders ?? []);
  for (const path of destinationFolders()) {
    const existing = folders.find((f: any) => f.path === path);
    const info = { path, available: !(w.__mock.badFolders ?? []).includes(path), download_destination: true, configured: (w.__mock.folders?.siteFolders ?? []).includes(path) };
    if (existing) Object.assign(existing, info); else folders.push(info);
  }
  return folders;
}

export async function invoke(cmd: string, args: any = {}): Promise<any> {
  w.__mock.calls.push({ cmd, args: JSON.parse(JSON.stringify(args, (k, v) => (k === "onEvent" ? "[channel]" : v))) });
  switch (cmd) {
    case "identify_search":
      if (!args.allowed) throw "Online lookup consent is required.";
      if (w.__mock.identifyFail) throw "Couldn't reach MusicBrainz.";
      await sleep(w.__mock.identifyDelay ?? 20);
      return structuredClone(w.__mock.identifyByTitle?.[args.title] ?? w.__mock.identificationCandidates ?? []);
    case "identify_details":
      if (!args.allowed) throw "Online lookup consent is required.";
      await sleep(w.__mock.identifyDelay ?? 20);
      return structuredClone(w.__mock.identifyTagsById?.[args.recordingId] ?? w.__mock.identificationTags ?? {});
    case "identify_cover":
      if (!args.allowed) throw "Online lookup consent is required.";
      if (w.__mock.identifyCoverFail) throw "No artwork was found for this release.";
      return { token: "identified-cover", name: "Cover Art Archive front cover" };
    case "portable_sync_devices": return structuredClone(w.__mock.portableDevices ?? []);
    case "portable_sync_profiles": return structuredClone(w.__mock.portableProfiles ?? []);
    case "portable_sync_create": {
      if (w.__mock.portableChooseCancel) return null;
      const phone = typeof args.deviceId === "string" && args.deviceId.startsWith("mtp:");
      const profile = { id: `portable-${Date.now()}`, name: args.name, folder: phone ? "Pixel — Internal storage (MTP, experimental)" : "/media/USB", volume: phone ? null : 42, transport: phone ? "mtp" : "folder", format: "original", bitrate: 192, source_kind: "library", source_ids: [], available: true, message: "" };
      (w.__mock.portableProfiles ??= []).push(profile); return profile;
    }
    case "portable_sync_save": {
      const profile = (w.__mock.portableProfiles ?? []).find((p: any) => p.id === args.id);
      if (!profile) throw "Profile not found.";
      Object.assign(profile, { name: args.name, format: args.format, bitrate: args.bitrate, source_kind: args.sourceKind, source_ids: args.sourceIds });
      return structuredClone(profile);
    }
    case "portable_sync_forget": w.__mock.portableProfiles = (w.__mock.portableProfiles ?? []).filter((p: any) => p.id !== args.id); return;
    case "portable_sync_cancel": (w.__mock.portableCancelled ??= []).push(args.id); return;
    case "portable_sync_plan": {
      if (w.__mock.portablePlanFail) throw "Device disconnected. Reconnect the original device.";
      args.onProgress.onmessage({ phase: "Checking music", done: 1, total: args.paths.length, title: "Checking files" });
      await sleep(w.__mock.portablePlanDelay ?? 30);
      if ((w.__mock.portableCancelled ?? []).includes(args.id)) throw "Portable sync cancelled. Original files were kept.";
      return { id: args.id, destination: "/media/USB/Kaisu-profile", additions: args.paths.map((p: string) => p.split("/").pop()), unchanged: 2, removals: ["Old portable song"], protected: ["Device-side edit"], needed_bytes: 1000, free_bytes: w.__mock.portableFree ?? 1000000000, conversion: (w.__mock.portableProfiles ?? []).find((p: any) => p.id === args.profileId)?.format === "mp3" };
    }
    case "portable_sync_apply":
      if (w.__mock.portableApplyFail) throw "Device disconnected during copying. Original files were kept.";
      args.onProgress.onmessage({ phase: "Copying", done: 1, total: 2, title: "Song" });
      await sleep(w.__mock.portableApplyDelay ?? 30);
      if ((w.__mock.portableCancelled ?? []).includes(args.id)) throw "Portable sync cancelled. Completed copies were kept.";
      return { copied: 2, removed: args.removeOld ? 1 : 0, unchanged: 2, warnings: [] };
    case "check_setup":
      return {
        engine: engine(w.__mock.ready),
        platform: { os: w.__mock.os ?? "linux", arch: "x86_64", distro: "fedora", auto_install: true },
        manual_steps: w.__mock.os === "windows"
          ? ["winget install yt-dlp.yt-dlp", "winget install Gyan.FFmpeg", "winget install DenoLand.Deno"]
          : ["sudo dnf install yt-dlp ffmpeg-free", "curl -fsSL https://deno.land/install.sh | sh    (JavaScript runtime for YouTube)"],
        managed_dir: "/home/u/.local/share/com.kaisu.app/engine",
        free_bytes: w.__mock.freeBytes ?? 50 * 1024 ** 3,
      };
    case "get_engine_info":
      return engine(w.__mock.ready);
    case "run_setup": {
      const ch: Channel = args.onEvent;
      const send = (e: Ev) => ch.onmessage(e);
      const todo = engine(false);
      for (const [c, label] of [["ytdlp", "Downloading the video downloader…"], ["ffmpeg", "Downloading the media converter…"], ["js", "Downloading the YouTube helper…"]] as const) {
        if ((todo as any)[c].ready) continue;
        send({ kind: "step", component: c, label });
        for (let p = 0; p <= 100; p += 20) {
          send({ kind: "progress", component: c, pct: p });
          await sleep(w.__mock.setupDelay ?? 250);
          if (w.__mock.failAt === c && p === 40 && !w.__mock.failedOnce) { w.__mock.failedOnce = true; throw "Couldn't reach the download server. Check your internet connection and try again."; }
        }
        if (c === "ffmpeg") { send({ kind: "step", component: c, label: "Unpacking…" }); await sleep(300); }
      }
      send({ kind: "finished" });
      w.__mock.ready = true;
      return engine(true);
    }
    case "update_engine":
      return { updated: false, version: "2026.08.19", previous: "2026.08.19" };
    case "default_download_dir":
      return "/home/u/Downloads";
    case "get_media_info": {
      await sleep(400);
      if (/private/.test(args.url)) throw "ERROR: [youtube] abc123: Sign in to confirm your age. This video may be inappropriate for some users.";
      if (!/^https?:\/\//.test(args.url)) throw "Enter a full web link (starting with http:// or https://) without spaces.";
      return {
        title: "Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film", thumbnail: thumb(200), uploader: "Blender",
        duration_secs: 635, view_count: 1234567, like_count: 45210, upload_date: "20140530", is_live: !!w.__mock.live,
        webpage_url: args.url,
        description: "Big Buck Bunny is a short computer animated film by the Blender Institute.\nLicensed under Creative Commons Attribution 3.0. " + "More text. ".repeat(40),
        artist: null, track: null, album: null, release_year: null, genre: null,
        availability: w.__mock.availability ?? "public", age_limit: w.__mock.ageLimit ?? 0, live_status: w.__mock.liveStatus ?? "not_live",
        subtitles: w.__mock.noSubs ? [] : [
          { code: "en", name: "English", auto: false },
          { code: "de", name: "German", auto: false },
          { code: "pt-BR", name: "Portuguese (Brazil)", auto: true },
        ],
        formats,
      };
    }
    case "file_info":
      return args.paths.map((p: string) => {
        const exists = !(w.__mock.missing ?? []).includes(p);
        return { exists, size: exists ? (w.__mock.sizes?.[p] ?? 1_000_000 + (p.length % 7) * 100_000) : 0 };
      });
    case "export_text":
      if (w.__mock.exportFail) throw "Couldn't save the file: permission denied";
      (w.__mock.exports ??= []).push({ path: "/home/u/export.csv", contents: args.contents });
      return "/home/u/export.csv";
    case "test_proxy":
      await sleep(200);
      if (/bad/.test(args.proxy)) throw "Couldn't connect through the proxy. Check the address and that it is running.";
      return "The proxy works.";
    case "check_folder":
      if (w.__mock.folderProblem) throw w.__mock.folderProblem;
      if ((w.__mock.badFolders ?? []).includes(args.path)) throw "That drive or folder isn't connected right now.";
      return { exists: true, free: w.__mock.free ?? 500 * 1024 ** 3 };
    case "preview_command":
      return `yt-dlp --no-playlist -P '${args.req.out_dir}' -- ${args.req.url}${args.req.extra.audio?.normalize ? " --ppa 'ExtractAudio+ffmpeg_o:-af loudnorm'" : ""}`;
    case "download_recovery":
      return w.__mock.downloadRecovery ?? [];
    case "discard_download_recovery":
      w.__mock.downloadRecovery = (w.__mock.downloadRecovery ?? []).filter((r: any) => !args.ids.includes(r.id));
      return;
    case "preflight_downloads": {
      if (w.__mock.folderProblem) throw w.__mock.folderProblem;
      const groups = new Map<string, any>();
      for (const req of args.requests) {
        if ((w.__mock.badFolders ?? []).includes(req.out_dir)) throw "That destination isn't available.";
        const group = groups.get(req.out_dir) ?? { folder: req.out_dir, free: w.__mock.freeByFolder?.[req.out_dir] ?? w.__mock.free ?? 500 * 1024 ** 3, needed: 200 * 1024 ** 2, estimated: false };
        group.needed += (req.estimated_bytes ?? 0) * 3; group.estimated ||= !!req.estimated_bytes;
        groups.set(req.out_dir, group);
      }
      return [...groups.values()];
    }
    case "check_destination":
      if (w.__mock.destMissing) throw "That drive or folder isn't connected right now.";
      return { free: w.__mock.destFree ?? 200 * 1024 ** 3 };
    case "set_managed_folders": {
      const siteFolders: string[] = args.siteFolders ?? [];
      if (siteFolders.some((p) => !p.startsWith("/") || ["/", "/home/u", "/etc", "/usr"].includes(p))) throw "Choose a more specific site-rule folder.";
      localStorage.setItem("__downloadFolders", JSON.stringify([...new Set([...destinationFolders(), ...siteFolders])]));
      w.__mock.folders = { download: String(args.download).trim(), moved: String(args.moved).trim(), siteFolders };
      return { problem: w.__mock.folderProblem ?? null };
    }
    case "transfer_files": {
      // Like the real command, the folders come from what was registered, never from the call.
      const f = w.__mock.folders;
      if (!f?.download) throw "Choose a download folder first.";
      if (!f.moved) throw "Choose a folder for moved downloads first.";
      if (w.__mock.destMissing) throw "That drive or folder isn't connected right now.";
      (w.__mock.transfers ??= []).push({ ...JSON.parse(JSON.stringify(args)), baseDir: f.download, destDir: f.moved });
      const base = f.download.replace(/\/+$/, "");
      return args.items.map((i: any) => {
        if ((w.__mock.transferFail ?? []).includes(i.path)) return { id: i.id, ok: false, skipped: false, new_path: null, error: "Couldn't copy the file: the drive is full", warning: null };
        if (w.__mock.transferSkip) return { id: i.id, ok: true, skipped: true, new_path: null, error: null, warning: null };
        const rel = args.keepLayout ? i.path.slice(base.length + 1) : i.path.split("/").pop();
        const warning = (w.__mock.transferWarn ?? []).includes(i.path) ? "The file was moved but not everything that goes with it: song.lrc (Couldn't copy the file: access is denied)" : null;
        const new_path = `${f.moved.replace(/\/+$/, "")}/${rel}`;
        if (args.mode === "move") w.__mock.library = (w.__mock.library ?? []).map((t: any) => t.path === i.path ? { ...t, path: new_path, missing: false } : t);
        return { id: i.id, ok: true, skipped: false, new_path, error: null, warning };
      });
    }
    case "delete_files": {
      const f = w.__mock.folders;
      if (!f?.download) throw "Choose a download folder first.";
      const allowed = [f.download, ...(args.includeMoved && f.moved ? [f.moved] : []), ...(args.includeLibrary ? musicFolders().map((folder: any) => folder.path) : [])];
      (w.__mock.deleteCalls ??= []).push({ ...JSON.parse(JSON.stringify(args)), allowed });
      return args.paths.map((p: string) => {
        if (w.__mock.recycleFail && !args.permanent) return { path: p, ok: false, error: "Couldn't move the file to the Recycle Bin. The file was not permanently deleted." };
        if (w.__mock.deleteFail) return { path: p, ok: false, error: "Couldn't delete it: permission denied" };
        (w.__mock.missing ??= []).push(p);
        return { path: p, ok: true, error: null };
      });
    }
    case "file_exists":
      return args.paths.map((p: string) => !(w.__mock.missing ?? []).includes(p));
    case "open_file":
    case "reveal_file":
      if (w.__mock.openerFail) throw "The system could not launch the file manager or player.";
      if ((w.__mock.missing ?? []).includes(args.path)) throw "That file has been moved or deleted.";
      return;
    case "check_custom_args":
      return /--exec|(^|\s)-o\s/.test(args.text) ? "`--exec` isn't allowed because it can run programs on your computer." : null;
    case "allowed_custom_options":
      return [{ names: ["-R", "--retries"], values: 1 }, { names: ["--embed-chapters"], values: 0 }, { names: ["-f", "--format"], values: 1 }];
    case "podcast_fetch":
      await sleep(w.__mock.feedDelay ?? 30);
      if (w.__mock.feedFail || !w.__mock.feeds?.[args.url]) throw "That isn't a podcast feed.";
      return structuredClone(w.__mock.feeds[args.url]);
    case "album_release_search":
      if (!args.allowed) throw "Allow the online lookup first.";
      await sleep(w.__mock.albumDelay ?? 20);
      if (w.__mock.albumFail) throw "Couldn't reach MusicBrainz.";
      return structuredClone(w.__mock.albumReleases ?? []);
    case "album_release_tracks":
      if (!args.allowed) throw "Allow the online lookup first.";
      await sleep(w.__mock.albumDelay ?? 20);
      if (w.__mock.albumFail || !w.__mock.albumTracklist) throw "This release has no tracklist yet.";
      return structuredClone(w.__mock.albumTracklist);
    case "lyrics_edit_read": {
      if (w.__mock.lyricsEditReadFail) throw "Couldn't read this song.";
      const found = (w.__mock.lyrics ?? {})[args.path];
      return { text: found?.synced ?? found?.plain ?? "", revision: String(w.__mock.lyricsRevision ?? 1), sidecar: found?.source === "file" };
    }
    case "lyrics_edit_save": {
      await sleep(w.__mock.lyricsEditDelay ?? 20);
      if (w.__mock.lyricsEditSaveFail) throw "The lyrics file was not saved: permission denied.";
      if (args.revision !== String(w.__mock.lyricsRevision ?? 1)) throw "The song or its lyrics changed outside this editor. Reload saved lyrics before saving.";
      w.__mock.lyricsRevision = Number(w.__mock.lyricsRevision ?? 1) + 1;
      const synced = /^\[\d+:\d+/m.test(args.text);
      (w.__mock.lyrics ??= {})[args.path] = { synced: synced ? args.text : null, plain: synced ? null : args.text, source: args.sidecar ? "file" : "tags" };
      return { document: { text: args.text, revision: String(w.__mock.lyricsRevision), sidecar: args.sidecar }, embedded: args.embed, sidecar: args.sidecar, warnings: [] };
    }
    case "lyrics_read":
      return (w.__mock.lyrics ?? {})[args.path] ?? { synced: null, plain: null, source: null };
    case "lyrics_find": {
      await sleep(w.__mock.lyricsDelay ?? 40);
      if (w.__mock.lyricsFindFail) throw "No lyrics were found for Artist - Song.";
      const found = w.__mock.lyricsFound ?? { synced: "[00:01.00] Found line one\n[00:02.00] Found line two", plain: null, source: "online" };
      (w.__mock.lyrics ??= {})[args.path] = found;
      return found;
    }
    case "library_folders":
      return musicFolders();
    case "library_add_folder": {
      if (w.__mock.folderFail) throw "Couldn't open that folder.";
      const path = w.__mock.importFolder;
      const folders = (w.__mock.musicFolders ??= []);
      if (path && !folders.some((f: any) => f.path === path)) {
        folders.push({ path, available: true });
        w.__mock.library = [...(w.__mock.library ?? []), ...(w.__mock.importTracks ?? [])];
      }
      return musicFolders();
    }
    case "library_remove_folder":
      if ((w.__mock.folders?.siteFolders ?? []).includes(args.path)) throw "Remove this folder from your site rules first.";
      localStorage.setItem("__downloadFolders", JSON.stringify(destinationFolders().filter((path) => path !== args.path)));
      w.__mock.musicFolders = (w.__mock.musicFolders ?? []).filter((f: any) => f.path !== args.path);
      w.__mock.library = (w.__mock.library ?? []).filter((t: any) => !t.path.startsWith(args.path + "/"));
      return musicFolders();
    case "library_locate": {
      const track = w.__mock.relocations?.[args.path];
      if (!track) return null;
      w.__mock.library = [...(w.__mock.library ?? []).filter((t: any) => t.path !== args.path && t.path !== track.path), track];
      return { from: args.path, track };
    }
    case "library_forget_missing": {
      const results = args.paths.map((path: string) => {
        const track = (w.__mock.library ?? []).find((t: any) => t.path === path);
        const error = !track?.missing ? "The file has returned. Rescan to restore its entry." : (w.__mock.forgetFail ?? []).includes(path) ? "Its music folder is unavailable. Reconnect it and rescan first." : null;
        return { path, ok: !error, error };
      });
      const removed = new Set(results.filter((r: any) => r.ok).map((r: any) => r.path));
      w.__mock.library = (w.__mock.library ?? []).filter((t: any) => !removed.has(t.path));
      return results;
    }
    case "library_duplicates":
      args.onProgress.onmessage({ done: 2, total: 2 });
      await sleep(30);
      return { groups: w.__mock.duplicateGroups ?? [], skipped: w.__mock.duplicateSkipped ?? 0 };
    case "library_remove_duplicates": {
      if (w.__mock.recycleFail && !args.permanent) throw "Couldn't move the file to the Recycle Bin. The file was not permanently deleted.";
      if (w.__mock.duplicateFail) throw "A copy changed since comparison. Compare again before removing it.";
      const results = args.paths.map((path: string) => ({ path, ok: path !== args.keep, error: path === args.keep ? "Keep this copy." : null }));
      const removed = results.filter((r: any) => r.ok).map((r: any) => r.path);
      w.__mock.library = (w.__mock.library ?? []).filter((t: any) => !removed.includes(t.path));
      return results;
    }
    case "set_mini_mode":
      if (w.__mock.miniFail) throw "Couldn't change the window size.";
      w.__mock.mini = args.mini;
      return;
    case "library_load":
      return structuredClone(w.__mock.library ?? []);
    case "library_scan": {
      const ch: Channel = args.onProgress;
      const found = w.__mock.library ?? [];
      (w.__mock.scanning = true);
      for (let i = 0; i < 3; i++) {
        ch.onmessage({ done: Math.round((found.length * (i + 1)) / 3), total: found.length });
        await sleep(w.__mock.scanDelay ?? 20);
      }
      w.__mock.scanning = false;
      return structuredClone(w.__mock.library ?? []);
    }
    case "library_choose_artwork":
      if (w.__mock.artworkFail) throw "Choose a valid JPEG or PNG image up to 8 MB.";
      return w.__mock.cancelArtwork ? null : { token: "art-test", name: "Album cover.png" };
    case "library_artwork_preview":
      return Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)).buffer;
    case "library_discard_artwork":
      (w.__mock.discardedArtwork ??= []).push(args.token); return;
    case "library_edit_tags": {
      (w.__mock.tagEdits ??= []).push({ paths: args.paths, edit: JSON.parse(JSON.stringify(args.edit)) });
      await sleep(w.__mock.tagDelay ?? 30);
      return args.paths.map((path: string) => {
        if ((w.__mock.tagFail ?? []).includes(path)) return { path, ok: false, error: "Couldn't replace the file (Access is denied). Is it open in another program?", track: null };
        const lib: any[] = (w.__mock.library ??= []);
        const at = lib.findIndex((t) => t.path === path);
        const field: Record<string, string> = { title: "title", artist: "artist", album: "album", album_artist: "album_artist", genre: "genre" };
        const track = { ...lib[at] };
        for (const [k, v] of Object.entries(args.edit as Record<string, any>)) {
          if (k === "artwork") { track.has_cover = v.action === "replace"; continue; }
          if (field[k]) track[field[k]] = v;
          else track[k] = v === "" ? null : Number(v);
        }
        if (at >= 0) lib[at] = track;
        return { path, ok: true, error: null, track };
      });
    }
    case "library_analyze": {
      (w.__mock.analyzed ??= []).push(args.paths);
      await sleep(w.__mock.analyzeDelay ?? 20);
      const out = args.paths.map((path: string) => ({ path, loudness: (w.__mock.analyzeFail ?? []).includes(path) ? null : (w.__mock.loudness?.[path] ?? -20) }));
      const lib: any[] = (w.__mock.library ??= []);
      for (const r of out) {
        const t = lib.find((x) => x.path === r.path);
        if (t && r.loudness != null) t.loudness = r.loudness;
      }
      return out;
    }
    case "library_cover": {
      if ((w.__mock.noCover ?? []).includes(args.path) || w.__mock.noCovers) throw "No picture.";
      return Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)).buffer;
    }
    case "find_leftovers":
      return w.__mock.leftovers ?? [];
    case "remove_leftovers":
      (w.__mock.removedLeftovers ??= []).push(...args.paths);
      w.__mock.leftovers = (w.__mock.leftovers ?? []).filter((l: any) => !args.paths.includes(l.path));
      return args.paths.map((path: string) => ({ path, ok: true, error: null }));
    case "media_waveform":
      await sleep(w.__mock.waveformDelay ?? 50);
      if (w.__mock.waveformFail) throw "The waveform could not be decoded.";
      return { duration: w.__mock.audioSeconds ?? 120, peaks: Array.from({ length: 128 }, (_, i) => Math.abs(Math.sin(i / 8))) };
    case "cancel_waveform":
      (w.__mock.waveformCancelled ??= []).push(args.id); return;
    case "play_in_app":
      if (w.__mock.playDelay) await sleep(w.__mock.playDelay);
      if ((w.__mock.playFailPaths ?? []).includes(args.path)) throw "The file has been moved or deleted.";
      if (w.__mock.playRefused) throw "That file isn't in a download folder.";
      return convertFileSrc(args.path);
    case "preview_clip":
      await sleep(w.__mock.previewDelay ?? 60);
      if (w.__mock.previewFail) throw "Previews wait until your downloads have finished.";
      return "/cache/preview/abc.mp4";
    case "discard_preview":
      (w.__mock.discarded ??= []).push(args.path);
      return;
    case "convert_audio": {
      await sleep(w.__mock.convertDelay ?? 60);
      if (w.__mock.convertFail) throw "Couldn't convert it: not enough free space";
      (w.__mock.converted ??= []).push({ path: args.path, format: args.format });
      return { path: String(args.path).replace(/\.[^./\\]+$/, `.${args.format}`) };
    }
    case "open_url":
      return;
    case "reveal_engine":
      return;
    case "classify_link": {
      const u: string = args.url;
      if (/youtube\.com\/playlist\?list=/.test(u)) return "playlist";
      if (/youtube\.com\/(@|channel\/)/.test(u)) return "channel";
      return "video";
    }
    case "get_playlist": {
      await sleep(w.__mock.playlistDelay ?? 250);
      if (w.__mock.playlistFail) throw "The source could not be reached.";
      const kind = /\/@|\/channel\//.test(args.url) ? "channel" : "playlist";
      const total = w.__mock.playlistTotal ?? 7;
      const n = Math.min(args.limit, total);
      return {
        title: kind === "channel" ? "Blender Channel" : "Road Trip: Mix / 2026",
        uploader: "Blender", kind, total,
        entries: w.__mock.playlistEntries ?? Array.from({ length: n }, (_, i) => ({
          id: `pl${String(i).padStart(9, "0")}`, title: `Playlist video ${i + 1}`, url: `https://www.youtube.com/watch?v=pl${String(i).padStart(9, "0")}`,
          channel: "Blender", duration_secs: 100 + i, view_count: 1000 * (i + 1), thumbnail: thumb(30 * i), live: false,
        })),
      };
    }
    case "free_space":
      return w.__mock.free ?? 500 * 1024 ** 3;
    case "schedule_power": {
      // The countdown belongs to the backend: it can't be shorter than 10 seconds, and a new one replaces the old.
      if (w.__mock.powerRefused) throw "Downloads are still running, so Kaisu won't turn the computer off.";
      clearTimeout(w.__mock.powerTimer);
      w.__mock.powerTimer = setTimeout(() => (w.__mock.powerFired ??= []).push({ action: args.action }), Math.min(300, Math.max(10, args.seconds)) * 1000);
      return;
    }
    case "cancel_power":
      clearTimeout(w.__mock.powerTimer);
      w.__mock.powerTimer = null;
      return;
    case "fetch_thumbnail": {
      if ((w.__mock.thumbFail ?? []).includes(args.url)) throw "The picture didn't load.";
      await sleep(w.__mock.thumbDelay ?? 20);
      // A 1x1 PNG.
      return Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)).buffer;
    }
    case "secret_set":
      if (w.__mock.noKeyring) throw "The system's password store isn't available: no store";
      (w.__mock.secrets ??= {})[args.name] = args.value;
      return;
    case "secret_get":
      if (w.__mock.noKeyring) throw "The system's password store isn't available: no store";
      return (w.__mock.secrets ??= {})[args.name] ?? null;
    case "take_incoming_links":
    case "pick_link_file":
      if (w.__mock.linkFileError) throw w.__mock.linkFileError;
      return w.__mock.linkFile ?? null;
      return (w.__mock.incomingLinks ?? []).splice(0);
    case "link_handler_status":
      return { registered: !!w.__mock.linkHandler, supported: true };
    case "link_handler_set":
      w.__mock.linkHandler = !!args.enabled;
      return { registered: !!w.__mock.linkHandler, supported: true };
    case "secret_status":
      return w.__mock.noKeyring ? { available: false, store: "Secret Service", detail: "The system's password store isn't available: no store" } : { available: true, store: "Secret Service", detail: null };
    case "check_app_update": {
      if (w.__mock.appUpdateFail) throw "Couldn't reach GitHub.";
      const latest = w.__mock.appLatest ?? "0.0.4";
      (w.__mock.appUpdateChecks = (w.__mock.appUpdateChecks ?? 0) + 1);
      return { current: "0.0.4", latest, newer: latest !== "0.0.4", url: "https://github.com/mirimomekiku/kaisu/releases" };
    }
    case "secret_delete":
      if (w.__mock.noKeyring) throw "The system's password store isn't available: no store";
      delete (w.__mock.secrets ??= {})[args.name];
      return;
    case "open_folder":
    case "set_tray_status":
    case "quit_app":
    case "finish_exit":
      return;
    case "tray_available":
      return w.__mock.tray ?? true;
    case "search_media": {
      await sleep(300);
      if (/boom/.test(args.query)) throw "ERROR: unable to download webpage: <urlopen error [Errno -2] Name or service not known>";
      if (/nothing/.test(args.query)) return [];
      return Array.from({ length: args.limit }, (_, i) => ({
        id: idOf(i), title: `${args.query} — result ${i + 1}${args.source === "soundcloud" ? " (SC)" : ""}`,
        url: args.source === "soundcloud" ? `https://api.soundcloud.com/tracks/soundcloud%3Atracks%3A${1000 + i}` : `https://www.youtube.com/watch?v=${idOf(i)}`,
        channel: `Channel ${i + 1}`, duration_secs: 60 * (i + 1) + 5, view_count: 1000 * (i + 1) ** 2, thumbnail: thumb(40 * i), live: i === 3,
      }));
    }
    case "start_download": {
      const ch: Channel = args.onEvent;
      const req = args.req;
      const send = (e: Ev) => ch.onmessage(e);
      if (w.__mock.manualDownloads) {
        return new Promise((resolve, reject) => {
          (w.__mock.downloadControls ??= {})[req.id] = { send, resolve, reject };
          send({ kind: "stage", stage: "preparing" });
        });
      }
      w.__mock.cancelled?.delete(req.id); // a resumed download starts fresh
      const cancelled = () => w.__mock.cancelled?.has(req.id);
      send({ kind: "log", line: `[youtube] Extracting URL: ${req.url}` });
      send({ kind: "meta", title: w.__mock.metaTitle ?? "Real Title From yt-dlp" });
      if (/flaky/.test(req.url)) {
        const seen = ((w.__mock.attempts ??= {})[req.url] = ((w.__mock.attempts ??= {})[req.url] ?? 0) + 1);
        if (seen <= (w.__mock.flakyFor ?? 1)) {
          const message = "ERROR: Unable to download webpage: <urlopen error timed out>";
          send({ kind: "error", message });
          throw message;
        }
      }
      if (/fail/.test(req.url)) {
        await sleep(300);
        const message = "ERROR: Unable to download webpage: <urlopen error [Errno -2] Name or service not known>";
        send({ kind: "log", line: message });
        send({ kind: "error", message });
        throw message;
      }
      for (let p = 5; p <= 95; p += 15) {
        if (cancelled()) { send({ kind: "cancelled" }); return; }
        send({ kind: "progress", pct: p, speed: 6_400_000, eta: Math.round((100 - p) / 8) });
        send({ kind: "log", line: `[download] ${p}.0% of 95.00MiB at 6.1MiB/s` });
        await sleep(w.__mock.dlDelay ?? 500);
      }
      send({ kind: "processing" });
      await sleep(500);
      if (w.__mock.checkFails) send({ kind: "checked", ok: false, note: "This file is shorter than expected (4 s instead of 19 s), so it may be cut off." });
      send({ kind: "done", path: `${req.out_dir}/Big Buck Bunny [aqz-KE-bpKQ].mp4` });
      return;
    }
    case "cancel_download":
      (w.__mock.cancelled ??= new Set()).add(args.id);
      if (w.__mock.downloadControls?.[args.id]) {
        w.__mock.downloadControls[args.id].send({ kind: "cancelled" });
        w.__mock.downloadControls[args.id].resolve();
      }
      return;
    default:
      throw `unmocked command ${cmd}`;
  }
}
