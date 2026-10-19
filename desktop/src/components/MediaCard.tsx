import { useMemo, useState } from "react";
import { Clock, Download, Music, Video } from "lucide-react";
import type { FormatInfo, MediaInfo, Preset } from "../lib/api";
import { formatDuration } from "../lib/format";
import type { Mode } from "../lib/storage";

export interface DownloadChoice {
  preset: Preset;
  formatId: string | null;
}

interface Props {
  info: MediaInfo;
  mode: Mode;
  /** Short descriptions of advanced options that will apply (advanced mode only). */
  activeOptions: string[];
  onDownload: (choice: DownloadChoice) => void;
}

const select =
  "bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1 text-xs text-neutral-300 focus:outline-none focus:border-rose-500 max-w-full";

const height = (f: FormatInfo) => Number(f.resolution?.split("x")[1] ?? 0);

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
  if (f.filesize) parts.push(`${(f.filesize / 1_048_576).toFixed(f.filesize > 10_485_760 ? 0 : 1)} MB`);
  return parts.join(" · ");
}

export default function MediaCard({ info, mode, activeOptions, onDownload }: Props) {
  const advanced = mode === "advanced";
  const [kind, setKind] = useState<"video" | "audio">("video");
  const [quality, setQuality] = useState<"best" | "p1080" | "p720">("best");
  const [videoId, setVideoId] = useState("");
  const [audioId, setAudioId] = useState("");

  const { videos, audios } = useMemo(() => {
    const videoFormats = info.formats
      .filter((f) => f.kind !== "audio")
      .sort((a, b) => height(b) - height(a) || (b.fps ?? 0) - (a.fps ?? 0));
    return { videos: videoFormats, audios: info.formats.filter((f) => f.kind === "audio").reverse() };
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

  const submit = () => onDownload({ preset: kind === "audio" ? "audio" : quality, formatId: formatId() });

  return (
    <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5 flex flex-col md:flex-row gap-5 shadow-xl">
      {info.thumbnail ? (
        <img
          src={info.thumbnail}
          alt=""
          referrerPolicy="no-referrer"
          className="w-full md:w-56 h-32 object-cover rounded-xl border border-neutral-800 shadow shrink-0"
        />
      ) : (
        <div className="w-full md:w-56 h-32 bg-neutral-800 rounded-xl flex items-center justify-center text-neutral-500 shrink-0">
          <Video className="w-7 h-7" />
        </div>
      )}

      <div className="flex-1 flex flex-col justify-between gap-3 min-w-0">
        <div>
          <h2 className="text-sm font-semibold text-white line-clamp-2 leading-snug">{info.title}</h2>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-neutral-400">
            <span className="truncate">{info.uploader ?? "Unknown creator"}</span>
            <span>•</span>
            <span className="flex items-center gap-1 shrink-0">
              <Clock className="w-3 h-3" /> {formatDuration(info.duration_secs)}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3 pt-3 border-t border-neutral-800/80">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex rounded-lg bg-neutral-950 border border-neutral-800 p-0.5">
                {(["video", "audio"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setKind(t)}
                    className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                      kind === t ? "bg-rose-600 text-white" : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    {t === "video" ? <Video className="w-3 h-3" /> : <Music className="w-3 h-3" />}
                    {t === "video" ? "Video" : advanced ? "Audio only" : "Audio only (MP3)"}
                  </button>
                ))}
              </div>

              {kind === "video" && (
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as typeof quality)}
                  disabled={advanced && chosenVideo !== undefined}
                  className={`${select} disabled:opacity-40`}
                  aria-label="Video quality"
                >
                  <option value="best">{advanced ? "Best quality" : "Best quality"}</option>
                  {advanced && <option value="p1080">1080p</option>}
                  <option value="p720">{advanced ? "720p" : "Smaller file (720p)"}</option>
                </select>
              )}
            </div>

            <button
              type="button"
              onClick={submit}
              className="bg-rose-600 hover:bg-rose-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-md shadow-rose-950"
            >
              <Download className="w-4 h-4" /> Download
            </button>
          </div>

          {advanced && (
            <details className="text-xs text-neutral-400">
              <summary className="cursor-pointer select-none hover:text-neutral-200">
                Choose exact streams ({videos.length} video · {audios.length} audio available)
              </summary>
              <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {kind === "video" && (
                  <label className="flex flex-col gap-1 min-w-0">
                    <span className="text-neutral-500">Video stream</span>
                    <select value={videoId} onChange={(e) => setVideoId(e.target.value)} className={select}>
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
                    <span className="text-neutral-500">Audio stream</span>
                    <select value={audioId} onChange={(e) => setAudioId(e.target.value)} className={select}>
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
                <p className="mt-2 text-neutral-500">
                  Format selector: <span className="font-mono text-neutral-300 select-text">{formatId()}</span>
                </p>
              )}
            </details>
          )}

          {advanced && activeOptions.length > 0 && (
            <p className="text-[11px] text-neutral-500">
              Active options: <span className="text-neutral-400">{activeOptions.join(" · ")}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
