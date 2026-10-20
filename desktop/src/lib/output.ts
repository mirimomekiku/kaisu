import type { Layout, NameStyle } from "./api";

/** Mirrors the Rust template builder, with sample data, so Settings can show what a file will be called. */
export interface OutputPrefs {
  layout: Layout;
  nameStyle: NameStyle;
  customName: string;
  playlistFolder: boolean;
  playlistNumbering: boolean;
}

export const LAYOUT_LABEL: Record<Layout, string> = {
  flat: "All in one folder",
  channel: "A folder for each channel",
  kind: "Separate Video and Audio folders",
  year: "A folder for each upload year",
};

export const NAME_LABEL: Record<NameStyle, string> = {
  title_id: "Title [id]  (never collides)",
  title: "Title",
  channel_title: "Channel - Title",
  date_title: "Date - Title",
};

const SAMPLE = { title: "Big Buck Bunny", id: "aqz-KE-bpKQ", channel: "Blender", uploader: "Blender", year: "2014", date: "2014-05-30" };

/** Fills in the yt-dlp fields we know about. Anything else is shown as typed, so odd fields are still visible. */
function fill(template: string, isAudio: boolean): string {
  return template
    // yt-dlp field syntax: %(name)<flags><width/precision><type>, e.g. %(title).150B or %(id)s
    .replace(/%\(title\)[.\d+#-]*[A-Za-z]/g, SAMPLE.title)
    .replace(/%\(id\)[.\d+#-]*[A-Za-z]/g, SAMPLE.id)
    .replace(/%\(channel,uploader(?:\|[^)]*)?\)s/g, SAMPLE.channel)
    .replace(/%\(channel\)s/g, SAMPLE.channel)
    .replace(/%\(uploader\)s/g, SAMPLE.uploader)
    .replace(/%\(upload_date>%Y-%m-%d(?:\|[^)]*)?\)s/g, SAMPLE.date)
    .replace(/%\(upload_date>%Y(?:\|[^)]*)?\)s/g, SAMPLE.year)
    .replace(/%\(ext\)s/g, isAudio ? "mp3" : "mp4")
    .replace(/%%/g, "%");
}

const NAME_TEMPLATE: Record<NameStyle, string> = {
  title_id: "%(title).150B [%(id)s]",
  title: "%(title).180B",
  channel_title: "%(channel,uploader|Unknown)s - %(title).150B",
  date_title: "%(upload_date>%Y-%m-%d|unknown date)s - %(title).150B",
};

/** A quick local check of a custom template, so mistakes show up while typing. The backend re-checks everything. */
export function checkCustomName(custom: string): string | null {
  const c = custom.trim();
  if (!c) return null;
  if (c.includes("\\")) return "Use / (not \\) between folders.";
  if (/^([/~]|[A-Za-z]:)/.test(c)) return "Use a path relative to your download folder.";
  if (c.split("/").some((s) => s === "" || s === "." || s === "..")) return "Folders can't be empty, '.' or '..'.";
  if (/[<>:"|?*]/.test(c.replace(/%\([^)]*\)[A-Za-z0-9.]*/g, ""))) return 'File names can\'t contain < > : " | ? *';
  return null;
}

export function previewPath(prefs: OutputPrefs, opts: { audio?: boolean; playlist?: boolean } = {}): string {
  const isAudio = !!opts.audio;
  const custom = prefs.customName.trim();
  let dirs: string[];
  let file: string;
  if (custom) {
    const segs = custom.replace(/\.%\(ext\)s$/, "").split("/");
    file = segs.pop() ?? "";
    dirs = segs;
  } else {
    dirs = [];
    if (prefs.layout === "channel") dirs.push("%(channel,uploader|Unknown channel)s");
    if (prefs.layout === "kind") dirs.push(isAudio ? "Audio" : "Video");
    if (prefs.layout === "year") dirs.push("%(upload_date>%Y|Unknown year)s");
    file = NAME_TEMPLATE[prefs.nameStyle];
  }
  let prefix = "";
  if (opts.playlist) {
    if (prefs.playlistFolder) dirs.push("Road Trip Mix");
    if (prefs.playlistNumbering) prefix = "04 - ";
  }
  return [...dirs, `${prefix}${file}.%(ext)s`].map((s) => fill(s, isAudio)).join("/");
}
