import { useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle2, Clock, Download, Eye, Music, Radio, ThumbsUp, Video } from "lucide-react";
import FileActions from "./FileActions";
import type { Clip, FormatInfo, MediaInfo, Preset, SubtitleOptions } from "../lib/api";
import { SUBTITLE_MODE_LABEL, defaultSelection, parseLangs, toOptions } from "../lib/subtitles";
import { PRESET_LABEL, clipLabel, formatBytes, formatClock, formatCount, formatDuration, formatUploadDate, parseTimeInput } from "../lib/format";
import type { HistoryItem, Mode, SubtitleMode } from "../lib/storage";

export interface DownloadChoice {
  preset: Preset;
  formatId: string | null;
  /** Only part of the video, when the user asked for that. */
  clip: Clip | null;
  /** Rough size in bytes, for the low-disk-space check. */
  estimate: number | null;
  /** Subtitles chosen for this download. */
  subs: SubtitleOptions | null;
}

interface Props {
  info: MediaInfo;
  mode: Mode;
  /** The subtitle settings to start from. */
  subtitleDefaults: { mode: SubtitleMode; langs: string; auto: boolean };
  /** Name of the audio file type that "Audio only" produces, e.g. "MP3". */
  audioLabel: string;
  /** Short descriptions of advanced options that will apply (advanced mode only). */
  activeOptions: string[];
  /** Earlier downloads of this exact video, newest first. */
  downloads: Array<{ item: HistoryItem; exists: boolean | undefined }>;
  /** Resolves to false when the download didn't start (the user cancelled a warning), so the card stays open. */
  onDownload: (choice: DownloadChoice) => Promise<boolean | void> | boolean | void;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
}

type Quality = "best" | "p1080" | "p720";

const height = (f: FormatInfo) => Number(f.resolution?.split("x")[1] ?? 0);
const QUALITY_LIMIT: Record<Quality, number> = { best: Infinity, p1080: 1080, p720: 720 };

function describe(f: FormatInfo): string {
  const parts: string[] = [f.id];
  if (f.kind !== "audio") {
    const h = height(f);
    parts.push(h ? `${h}p${f.fps && f.fps > 30 ? Math.round(f.fps) : ""}` : (f.resolution ?? "video"));
  } else {
    parts.push(f.note ?? "audio");
  }
  parts.push(f.ext);
  const codec = f.kind === "audio" ? f.acodec : f.vcodec;
  if (codec) parts.push(codec.split(".")[0]);
  if (f.kind === "both") parts.push("with audio");
  if (f.filesize) parts.push(formatBytes(f.filesize));
  return parts.join(" · ");
}

/** Best-effort download size from the format list; null when the site doesn't report sizes. */
function estimateSize(videos: FormatInfo[], audios: FormatInfo[], kind: "video" | "audio", quality: Quality): number | null {
  const bestAudio = audios.reduce<number>((max, f) => Math.max(max, f.filesize ?? 0), 0);
  if (kind === "audio") return bestAudio || null;
  const pick = videos.find((f) => height(f) <= QUALITY_LIMIT[quality] && f.filesize);
  if (!pick?.filesize) return null;
  return pick.filesize + (pick.kind === "video" ? bestAudio : 0);
}

export default function MediaCard({ info, mode, subtitleDefaults, audioLabel, activeOptions, downloads, onDownload, onOpen, onReveal }: Props) {
  const advanced = mode === "advanced";
  const [kind, setKind] = useState<"video" | "audio">("video");
  const [quality, setQuality] = useState<Quality>("best");
  const [videoId, setVideoId] = useState("");
  const [audioId, setAudioId] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [clipOpen, setClipOpen] = useState(false);
  const [clipStart, setClipStart] = useState("0:00");
  const [clipEnd, setClipEnd] = useState(info.duration_secs ? formatClock(info.duration_secs) : "");
  const [precise, setPrecise] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [subMode, setSubMode] = useState<SubtitleMode>(subtitleDefaults.mode);
  const [subLangs, setSubLangs] = useState<string[]>(() => (subtitleDefaults.mode === "off" ? [] : defaultSelection(info.subtitles, parseLangs(subtitleDefaults.langs))));
  const subAuto = subtitleDefaults.auto;
  // The chooser starts open for new videos and tucked away for ones already downloaded.
  const newest = downloads[0]?.item.id;
  const [open, setOpen] = useState(downloads.length === 0);
  const [justAdded, setJustAdded] = useState(false);
  useEffect(() => {
    if (newest) {
      setOpen(false);
      setJustAdded(false);
    }
  }, [newest]);

  const { videos, audios, maxHeight } = useMemo(() => {
    const videoFormats = info.formats
      .filter((f) => f.kind !== "audio")
      .sort((a, b) => height(b) - height(a) || (b.fps ?? 0) - (a.fps ?? 0));
    return {
      videos: videoFormats,
      audios: info.formats.filter((f) => f.kind === "audio").reverse(),
      maxHeight: videoFormats.reduce((m, f) => Math.max(m, height(f)), 0),
    };
  }, [info.formats]);

  const chosenVideo = videos.find((f) => f.id === videoId);

  /** Builds a yt-dlp format id from the stream pickers (advanced mode only). */
  const formatId = (): string | null => {
    if (!advanced) return null;
    if (kind === "audio") return audioId || null;
    if (chosenVideo?.kind === "both") return chosenVideo.id;
    if (chosenVideo) return `${chosenVideo.id}+${audioId || "ba"}`;
    if (audioId) return `bv*+${audioId}`;
    return null;
  };

  const videoSize = estimateSize(videos, audios, "video", quality);
  const audioSize = estimateSize(videos, audios, "audio", quality);

  // A clip only counts when its section is open and both times make sense.
  const clipCheck = useMemo((): { clip: Clip | null; error: string | null } => {
    if (!clipOpen) return { clip: null, error: null };
    const start = parseTimeInput(clipStart);
    const end = parseTimeInput(clipEnd);
    if (start === null || end === null) return { clip: null, error: "Type times like 1:20 or 1:02:30." };
    if (end <= start) return { clip: null, error: "The end must come after the start." };
    if (info.duration_secs && end > info.duration_secs + 1) return { clip: null, error: `The video is only ${formatClock(info.duration_secs)} long.` };
    return { clip: { start, end, precise }, error: null };
  }, [clipOpen, clipStart, clipEnd, precise, info.duration_secs]);
  const clip = clipCheck.clip;
  const baseEstimate = kind === "audio" ? audioSize : videoSize;
  const estimate = baseEstimate && clip && info.duration_secs ? Math.round((baseEstimate * (clip.end - clip.start)) / info.duration_secs) : baseEstimate;

  const submit = async () => {
    if (clipOpen && !clip) return;
    const started = await onDownload({ preset: kind === "audio" ? "audio" : quality, formatId: formatId(), clip, estimate, subs: toOptions(subMode, subLangs, subAuto || subLangs.some((c) => info.subtitles.find((t) => t.code === c)?.auto)) });
    if (started === false) return;
    setOpen(false);
    setJustAdded(true);
  };
  /** Choosing a format with nothing ticked yet starts from the languages in the settings. */
  const changeSubMode = (mode: SubtitleMode) => {
    setSubMode(mode);
    if (mode !== "off" && subLangs.length === 0) setSubLangs(defaultSelection(info.subtitles, parseLangs(subtitleDefaults.langs)));
  };
  const toggleLang = (code: string) => {
    setSubLangs((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
    // Ticking a language means they want it, so don't leave the mode on "none".
    if (subMode === "off") setSubMode("embed");
  };
  const stats = [
    info.view_count != null && { icon: Eye, text: `${formatCount(info.view_count)} views` },
    info.like_count != null && { icon: ThumbsUp, text: formatCount(info.like_count) },
    info.upload_date && formatUploadDate(info.upload_date) && { icon: Calendar, text: formatUploadDate(info.upload_date) },
  ].filter((x): x is { icon: typeof Eye; text: string } => Boolean(x));

  const tile = (active: boolean) =>
    `row-card flex-1 min-w-0 text-left p-2.5 flex items-center gap-2.5 ${active ? "sel" : ""}`;

  return (
    <section className="panel overflow-hidden" aria-label="Video details">
      <div className="inspector p-3 flex flex-col sm:flex-row gap-4">
        <div className="thumb w-full sm:w-56 aspect-video rounded-[3px] self-start">
          {info.thumbnail ? <img src={info.thumbnail} alt="" referrerPolicy="no-referrer" /> : <Video className="w-7 h-7" />}
          {info.is_live ? (
            <span className="tag live inline-flex items-center gap-1">
              <Radio className="w-3 h-3" /> LIVE
            </span>
          ) : (
            info.duration_secs != null && (
              <span className="tag inline-flex items-center gap-1">
                <Clock className="w-3 h-3" /> {formatDuration(info.duration_secs)}
              </span>
            )
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <h2 className="m-0 text-[15px] font-bold leading-snug line-clamp-3 selectable">{info.title}</h2>
          <div className="text-[13px] text-[color:var(--ink-2)] truncate">{info.uploader ?? "Unknown creator"}</div>
          {stats.length > 0 && (
            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap dim">
              {stats.map(({ icon: Icon, text }) => (
                <span key={text} className="inline-flex items-center gap-1.5">
                  <Icon className="w-3 h-3" /> {text}
                </span>
              ))}
            </div>
          )}
          {info.description && (
            <div className="text-[11.5px] text-[color:var(--ink-2)]">
              <p className={`m-0 whitespace-pre-line break-words selectable ${showDescription ? "" : "line-clamp-2"}`}>{info.description}</p>
              <button type="button" onClick={() => setShowDescription((v) => !v)} className="link mt-0.5 border-0 bg-transparent p-0 text-[11px]">
                {showDescription ? "Show less" : "Show more"}
              </button>
            </div>
          )}
          {info.is_live && <p className="m-0 text-[11.5px]" style={{ color: "#9a6a00" }}>This is a live stream. Downloading it may not work until it has ended.</p>}
        </div>
      </div>

      <div className="p-3 flex flex-col gap-2.5">
        {downloads.length > 0 && (
          <ul className="m-0 p-0 list-none flex flex-col gap-1.5" aria-label="Already downloaded">
            {downloads.map(({ item, exists }) => (
              <li key={item.id} className="alert ok items-center flex-wrap !py-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: "#2f8a2b" }} />
                <span className="flex-1 min-w-0">
                  Downloaded as <b>{PRESET_LABEL[item.preset]}</b>
                  {item.clip ? ` (clip ${clipLabel(item.clip)})` : ""} on {new Date(item.timestamp).toLocaleDateString()}
                </span>
                <FileActions path={item.path} exists={exists} onOpen={onOpen} onReveal={onReveal} />
              </li>
            ))}
          </ul>
        )}

        {justAdded && !open && (
          <p role="status" className="m-0" style={{ color: "#2f7a2b" }}>
            Download started. You can follow it in Downloads.
          </p>
        )}

        <button type="button" aria-expanded={open} aria-controls="download-choices" onClick={() => setOpen((v) => !v)} className="disclosure self-start">
          <span className={`tri ${open ? "open" : ""}`} />
          {downloads.length > 0 ? "Download again" : "What would you like to download?"}
        </button>

        {open && (
          <div id="download-choices" className="flex flex-col gap-3 pl-3.5">
            <div className="flex flex-col sm:flex-row gap-2" role="radiogroup" aria-label="Download type">
              <button type="button" role="radio" aria-checked={kind === "video"} onClick={() => setKind("video")} className={tile(kind === "video")}>
                <Video className="w-5 h-5 shrink-0" style={{ color: kind === "video" ? "#2f66bf" : "#7d838c" }} />
                <span className="min-w-0">
                  <span className="block font-bold text-[13px]">Video</span>
                  <span className="block dim truncate">
                    MP4{maxHeight ? ` · up to ${maxHeight}p` : ""}
                    {videoSize ? ` · ~${formatBytes(videoSize)}` : ""}
                  </span>
                </span>
              </button>
              <button type="button" role="radio" aria-checked={kind === "audio"} onClick={() => setKind("audio")} className={tile(kind === "audio")}>
                <Music className="w-5 h-5 shrink-0" style={{ color: kind === "audio" ? "#2f66bf" : "#7d838c" }} />
                <span className="min-w-0">
                  <span className="block font-bold text-[13px]">Audio only</span>
                  <span className="block dim truncate">
                    {audioLabel}
                    {audioSize ? ` · ~${formatBytes(audioSize)}` : ""}
                  </span>
                </span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-h-[22px]">
                {kind === "video" && (
                  <label className="flex items-center gap-2">
                    Quality
                    <select
                      value={quality}
                      onChange={(e) => setQuality(e.target.value as Quality)}
                      disabled={advanced && chosenVideo !== undefined}
                      className="field disabled:opacity-40"
                    >
                      <option value="best">Best available</option>
                      {advanced && <option value="p1080">1080p</option>}
                      <option value="p720">{advanced ? "720p" : "Smaller file (720p)"}</option>
                    </select>
                  </label>
                )}
              </div>
              <button type="button" onClick={submit} disabled={clipOpen && !clip} className="btn primary">
                <Download className="w-3.5 h-3.5" /> {clipOpen ? "Download clip" : kind === "video" ? "Download video" : "Download audio"}
              </button>
            </div>

            {!info.is_live && (
              <div className="flex flex-col gap-2">
                <button type="button" aria-expanded={clipOpen} onClick={() => setClipOpen((v) => !v)} className="disclosure self-start" style={{ fontWeight: "normal" }}>
                  <span className={`tri ${clipOpen ? "open" : ""}`} />
                  Download only part of this video
                </button>
                {clipOpen && (
                  <div className="pl-3.5 flex flex-col gap-2" role="group" aria-label="Clip">
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="flex items-center gap-1.5">
                        From
                        <input type="text" value={clipStart} onChange={(e) => setClipStart(e.target.value)} className="field mono" style={{ width: 84 }} aria-label="Clip start" spellCheck={false} />
                      </label>
                      <label className="flex items-center gap-1.5">
                        to
                        <input type="text" value={clipEnd} onChange={(e) => setClipEnd(e.target.value)} className="field mono" style={{ width: 84 }} aria-label="Clip end" spellCheck={false} />
                      </label>
                      {info.duration_secs != null && <span className="dim">(video is {formatClock(info.duration_secs)} long)</span>}
                    </div>
                    <label className="flex items-center gap-1.5 w-fit">
                      <input type="checkbox" checked={precise} onChange={(e) => setPrecise(e.target.checked)} />
                      Cut exactly at these times (slower, re-encodes the video)
                    </label>
                    {clipCheck.error ? (
                      <p className="m-0" role="alert" style={{ color: "#b3261e" }}>
                        {clipCheck.error}
                      </p>
                    ) : (
                      clip && (
                        <p className="m-0 dim">
                          Downloads {formatClock(clip.end - clip.start)} from {formatClock(clip.start)} to {formatClock(clip.end)}.
                        </p>
                      )
                    )}
                  </div>
                )}
              </div>
            )}

            {info.subtitles.length > 0 && !info.is_live && (
              <div className="flex flex-col gap-2">
                <button type="button" aria-expanded={subOpen} onClick={() => setSubOpen((v) => !v)} className="disclosure self-start" style={{ fontWeight: "normal" }}>
                  <span className={`tri ${subOpen ? "open" : ""}`} />
                  Subtitles{subMode !== "off" && subLangs.length > 0 ? ` (${subLangs.join(", ")})` : ""}
                </button>
                {subOpen && (
                  <div className="pl-3.5 flex flex-col gap-2" role="group" aria-label="Subtitles">
                    <label className="flex items-center gap-2 w-fit">
                      Save as
                      <select value={subMode} onChange={(e) => changeSubMode(e.target.value as SubtitleMode)} className="field" aria-label="Subtitle format">
                        {(Object.keys(SUBTITLE_MODE_LABEL) as SubtitleMode[]).map((m) => (
                          <option key={m} value={m}>
                            {SUBTITLE_MODE_LABEL[m]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <ul className="m-0 p-0 list-none grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 max-h-40 overflow-auto">
                      {info.subtitles.map((t) => (
                        <li key={`${t.code}-${t.auto}`}>
                          <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={subLangs.includes(t.code)} onChange={() => toggleLang(t.code)} />
                            <span className="truncate">
                              {t.name}
                              {t.auto ? " (automatic)" : ""} <span className="dim mono">{t.code}</span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    {kind === "audio" && subMode !== "off" && <p className="m-0 dim">Audio files can't hold subtitles, so they are saved as separate .srt files.</p>}
                  </div>
                )}
              </div>
            )}

            {advanced && (
              <details>
                <summary className="cursor-default select-none">
                  Choose exact streams ({videos.length} video · {audios.length} audio available)
                </summary>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {kind === "video" && (
                    <label className="flex flex-col gap-1 min-w-0">
                      <span className="dim">Video stream</span>
                      <select value={videoId} onChange={(e) => setVideoId(e.target.value)} className="field">
                        <option value="">Automatic</option>
                        {videos.map((f) => (
                          <option key={f.id} value={f.id}>
                            {describe(f)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {(kind === "audio" || chosenVideo?.kind !== "both") && (
                    <label className="flex flex-col gap-1 min-w-0">
                      <span className="dim">Audio stream</span>
                      <select value={audioId} onChange={(e) => setAudioId(e.target.value)} className="field">
                        <option value="">Automatic (best)</option>
                        {audios.map((f) => (
                          <option key={f.id} value={f.id}>
                            {describe(f)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {formatId() && (
                  <p className="mt-2 mb-0 dim">
                    Format selector: <span className="mono selectable" style={{ color: "#333" }}>{formatId()}</span>
                  </p>
                )}
              </details>
            )}

            {advanced && activeOptions.length > 0 && (
              <p className="m-0 dim">
                Active options: <span style={{ color: "#333" }}>{activeOptions.join(" · ")}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
