import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AlertTriangle, FolderOpen, RefreshCw, Settings as SettingsIcon, Wrench } from "lucide-react";
import type { AudioFormat, Browser, Component, EngineInfo, SponsorBlock } from "../lib/api";
import type { Settings } from "../lib/storage";

export type EngineState =
  | { kind: "idle" }
  | { kind: "updating" }
  | { kind: "message"; text: string; error?: boolean };

interface Props {
  settings: Settings;
  effectiveOutDir: string;
  engine: EngineInfo | null;
  engineState: EngineState;
  onChange: (patch: Partial<Settings>) => void;
  onCheckUpdate: () => void;
  onOpenSetup: () => void;
}

const BROWSERS: Browser[] = ["firefox", "chrome", "chromium", "edge", "brave", "opera", "vivaldi"];
const AUDIO_FORMATS: Array<[AudioFormat, string]> = [
  ["mp3", "MP3 (most compatible)"],
  ["m4a", "M4A / AAC"],
  ["opus", "Opus (small, high quality)"],
  ["flac", "FLAC (lossless)"],
  ["wav", "WAV (uncompressed)"],
];

const field =
  "bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-neutral-300 focus:outline-none focus:border-rose-500";
const card = "bg-neutral-950/60 border border-neutral-800/80 rounded-xl p-3";
const label = "text-neutral-500 block mb-1.5";

function componentLine(name: string, c: Component | undefined) {
  if (!c) return `${name} …`;
  if (!c.ready) return `${name} missing`;
  return `${name} ${c.version ?? "ready"}${c.source ? ` (${c.source})` : ""}`;
}

export default function SettingsPanel({
  settings,
  effectiveOutDir,
  engine,
  engineState,
  onChange,
  onCheckUpdate,
  onOpenSetup,
}: Props) {
  const advanced = settings.mode === "advanced";

  const pickFolder = async () => {
    const dir = await open({ directory: true, multiple: false, defaultPath: effectiveOutDir || undefined });
    if (typeof dir === "string") onChange({ outDir: dir });
  };

  return (
    <div className="border-b border-neutral-800 bg-neutral-900/80 px-6 py-4">
      <div className="max-w-4xl mx-auto flex flex-col gap-4 text-xs">
        <span className="font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
          <SettingsIcon className="w-3.5 h-3.5 text-rose-400" /> Settings
        </span>

        <div className={`grid grid-cols-1 ${advanced ? "sm:grid-cols-2" : ""} gap-3`}>
          <div className={card}>
            <span className={label}>Save downloads to</span>
            <div className="flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate font-mono text-neutral-200 select-text" title={effectiveOutDir}>
                {effectiveOutDir || "…"}
              </span>
              <button onClick={pickFolder} className={`${field} flex items-center gap-1.5 cursor-pointer hover:border-neutral-600`}>
                <FolderOpen className="w-3.5 h-3.5" /> Change
              </button>
            </div>
          </div>

          {advanced && (
            <>
              <div className={card}>
                <span className={label}>Simultaneous downloads</span>
                <select
                  value={settings.concurrency}
                  onChange={(e) => onChange({ concurrency: Number(e.target.value) })}
                  className={field}
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div className={card}>
                <span className={label}>Audio format (for "Audio" downloads)</span>
                <select
                  value={settings.audioFormat}
                  onChange={(e) => onChange({ audioFormat: e.target.value as AudioFormat })}
                  className={field}
                >
                  {AUDIO_FORMATS.map(([id, text]) => (
                    <option key={id} value={id}>
                      {text}
                    </option>
                  ))}
                </select>
              </div>

              <div className={card}>
                <span className={label}>Speed limit (e.g. 500K or 2M, blank = unlimited)</span>
                <input
                  value={settings.rateLimit}
                  onChange={(e) => onChange({ rateLimit: e.target.value })}
                  placeholder="unlimited"
                  spellCheck={false}
                  className={`${field} w-32 font-mono select-text`}
                />
              </div>

              <div className={card}>
                <span className={label}>SponsorBlock</span>
                <select
                  value={settings.sponsorblock}
                  onChange={(e) => onChange({ sponsorblock: e.target.value as SponsorBlock })}
                  className={field}
                >
                  <option value="off">Off</option>
                  <option value="mark">Mark segments as chapters</option>
                  <option value="remove">Remove sponsor / self-promo / interaction</option>
                </select>
              </div>

              <div className={card}>
                <span className={label}>Use cookies from browser (login-gated videos)</span>
                <select
                  value={settings.cookiesBrowser ?? ""}
                  onChange={(e) => onChange({ cookiesBrowser: (e.target.value || null) as Browser | null })}
                  className={field}
                >
                  <option value="">None</option>
                  {BROWSERS.map((b) => (
                    <option key={b} value={b}>
                      {b[0].toUpperCase() + b.slice(1)}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 mt-2.5 text-neutral-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.subtitles}
                    onChange={(e) => onChange({ subtitles: e.target.checked })}
                    className="accent-rose-500"
                  />
                  Embed English subtitles when available
                </label>
                <label className="flex items-center gap-2 mt-2 text-neutral-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.verbose}
                    onChange={(e) => onChange({ verbose: e.target.checked })}
                    className="accent-rose-500"
                  />
                  Keep a detailed log for each download
                </label>
              </div>

              <div className={`${card} sm:col-span-2`}>
                <span className={label}>
                  Custom yt-dlp arguments, added to every download{" "}
                  <span className="text-amber-400/90 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> for experts
                  </span>
                </span>
                <input
                  value={settings.customArgs}
                  onChange={(e) => onChange({ customArgs: e.target.value })}
                  placeholder="--embed-chapters --retries 10"
                  spellCheck={false}
                  className={`${field} w-full font-mono select-text`}
                />
                <p className="text-neutral-600 mt-1.5">
                  Options that run programs (<span className="font-mono">--exec</span> and similar) are blocked.
                </p>
              </div>
            </>
          )}
        </div>

        <div className={`${card} flex flex-col gap-2.5`}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <span className="text-neutral-500 block mb-0.5">Download engine</span>
              {advanced ? (
                <div className="font-mono text-neutral-200 flex flex-col gap-0.5">
                  <span>{componentLine("yt-dlp", engine?.ytdlp)}</span>
                  <span>{componentLine("ffmpeg", engine?.ffmpeg)}</span>
                  <span>{componentLine("js runtime", engine?.js)}</span>
                  {engine?.ytdlp.path && (
                    <button
                      onClick={() => revealItemInDir(engine.ytdlp.path as string).catch((e) => console.warn(e))}
                      className="text-left text-[11px] text-neutral-500 hover:text-neutral-300 underline cursor-pointer w-fit"
                    >
                      Show yt-dlp location
                    </button>
                  )}
                </div>
              ) : (
                <span className="text-neutral-200">
                  {engine?.ready ? "Up to date and ready" : "Needs attention"}
                  {engine?.ytdlp.version && <span className="text-neutral-500"> · version {engine.ytdlp.version}</span>}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onOpenSetup}
                className={`${field} flex items-center gap-1.5 cursor-pointer hover:border-neutral-600`}
                title="Check the helper tools and repair anything missing"
              >
                <Wrench className="w-3.5 h-3.5" /> Repair
              </button>
              <button
                onClick={onCheckUpdate}
                disabled={engineState.kind === "updating"}
                className={`${field} flex items-center gap-1.5 cursor-pointer hover:border-neutral-600 disabled:opacity-50`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${engineState.kind === "updating" ? "animate-spin" : ""}`} />
                Check for updates
              </button>
            </div>
          </div>
          {engineState.kind === "message" && (
            <span className={engineState.error ? "text-red-400" : "text-emerald-400"}>{engineState.text}</span>
          )}
          <label className="flex items-center gap-2 text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoUpdate}
              onChange={(e) => onChange({ autoUpdate: e.target.checked })}
              className="accent-rose-500"
            />
            Keep the downloader up to date automatically
          </label>
        </div>
      </div>
    </div>
  );
}
