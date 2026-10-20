import { useEffect, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, FolderOpen, Keyboard, RefreshCw, Route, Wrench } from "lucide-react";
import { checkFolder, errorText, testProxy, type AudioFormat, type Browser, type CloseMode, type Component, type EngineInfo, type Layout, type NameStyle, type SponsorBlock } from "../lib/api";
import type { ScheduleState } from "../lib/schedule";
import { SUBTITLE_MODE_LABEL } from "../lib/subtitles";
import { checkAudioQuality, checkProxy, checkSpeedLimit } from "../lib/validate";
import { formatBytes } from "../lib/format";
import ScheduleEditor from "./ScheduleEditor";
import { LAYOUT_LABEL, NAME_LABEL, checkCustomName, previewPath } from "../lib/output";
import { ACCENTS, type Accent, type Mode, type Settings, type SubtitleMode, type Theme } from "../lib/storage";

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
  onRevealEngine: () => void;
  onShowShortcuts: () => void;
  onShowTour: () => void;
  scheduleState: ScheduleState;
  /** null while still being checked. */
  trayAvailable: boolean | null;
}

const BROWSERS: Browser[] = ["firefox", "chrome", "chromium", "edge", "brave", "opera", "vivaldi"];
const AUDIO_FORMATS: Array<[AudioFormat, string]> = [
  ["mp3", "MP3 (most compatible)"],
  ["m4a", "M4A / AAC"],
  ["opus", "Opus (small, high quality)"],
  ["flac", "FLAC (lossless)"],
  ["wav", "WAV (uncompressed)"],
];

const MODE_TEXT: Record<Mode, string> = {
  simple: "Paste a link or search, choose video or audio, and download. Plain-language messages and no clutter.",
  advanced: "Exact formats and streams, audio format choice, speed limit, SponsorBlock, cookies, per-download logs and your own yt-dlp arguments.",
};

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="panel overflow-hidden" aria-label={title}>
      <div className="panel-title">{title}</div>
      {hint && <div className="pref-hint px-3 pt-2">{hint}</div>}
      <div>{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="pref-row">
      <div className="min-w-0">
        <div>{label}</div>
        {hint && <div className="pref-hint">{hint}</div>}
      </div>
      <div className="shrink-0 max-w-full">{children}</div>
    </div>
  );
}

function componentLine(name: string, c: Component | undefined) {
  if (!c) return `${name} …`;
  if (!c.ready) return `${name} missing`;
  return `${name} ${c.version ?? "ready"}${c.source ? ` (${c.source})` : ""}`;
}

export default function SettingsPage({ settings, effectiveOutDir, engine, engineState, onChange, onCheckUpdate, onOpenSetup, onRevealEngine, onShowShortcuts, onShowTour, scheduleState, trayAvailable }: Props) {
  // Is the download folder usable? Checked whenever it changes, so a problem shows up here and not mid-download.
  const [folder, setFolder] = useState<{ problem?: string; free?: number }>({});
  useEffect(() => {
    if (!effectiveOutDir) return;
    let stale = false;
    checkFolder(effectiveOutDir).then(
      (c) => !stale && setFolder({ free: c.free }),
      (e) => !stale && setFolder({ problem: errorText(e) }),
    );
    return () => {
      stale = true;
    };
  }, [effectiveOutDir]);
  const proxyProblem = checkProxy(settings.proxy);
  const speedProblem = checkSpeedLimit(settings.rateLimit);
  const qualityProblem = checkAudioQuality(settings.audioQuality);
  const [proxyTest, setProxyTest] = useState<{ busy: boolean; text?: string; error?: boolean }>({ busy: false });
  const runProxyTest = async () => {
    setProxyTest({ busy: true });
    try {
      setProxyTest({ busy: false, text: await testProxy(settings.proxy) });
    } catch (e) {
      setProxyTest({ busy: false, text: errorText(e), error: true });
    }
  };
  const advanced = settings.mode === "advanced";

  const customError = advanced ? checkCustomName(settings.customName) : null;
  const prefs = { layout: settings.layout, nameStyle: settings.nameStyle, customName: advanced ? settings.customName : "", playlistFolder: settings.playlistFolder, playlistNumbering: settings.playlistNumbering };

  const pickFolder = async () => {
    const dir = await open({ directory: true, multiple: false, defaultPath: effectiveOutDir || undefined });
    if (typeof dir === "string") onChange({ outDir: dir });
  };

  return (
    <div className="page" style={{ maxWidth: 680, margin: "0 auto", width: "100%" }}>
      <div>
        <h1 className="m-0 text-[17px] font-bold">Settings</h1>
        <p className="m-0 pref-hint">Changes are saved automatically.</p>
      </div>

      <Group title="Interface">
        <div className="pref-row" style={{ alignItems: "flex-start" }}>
          <div>
            <div>Mode</div>
            <div className="pref-hint" style={{ maxWidth: 330 }} id="mode-help">
              {MODE_TEXT[settings.mode]}
            </div>
          </div>
          <div className="seg blue" role="radiogroup" aria-label="Interface mode" aria-describedby="mode-help">
            {(["simple", "advanced"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={settings.mode === m} onClick={() => onChange({ mode: m })} className="capitalize">
                {m}
              </button>
            ))}
          </div>
        </div>
      </Group>

      <Group title="Downloads">
        <Row label="Save downloads to" hint="Where finished files are placed.">
          <div className="flex items-center gap-2 max-w-full">
            <span className="min-w-0 max-w-64 truncate mono selectable" title={effectiveOutDir}>
              {effectiveOutDir || "…"}
            </span>
            <button onClick={pickFolder} className="btn small">
              <FolderOpen className="w-3 h-3" /> Choose…
            </button>
          </div>
        </Row>
        {(folder.problem || folder.free !== undefined) && (
          <div className="pref-row" role={folder.problem ? "alert" : "status"} aria-label="Download folder check" style={{ color: folder.problem ? "#b3261e" : "#2f7a2b" }}>
            {folder.problem ?? `Ready. ${formatBytes(folder.free ?? 0)} free.`}
          </div>
        )}
        <Row label="Folders" hint="How downloads are sorted inside that folder.">
          <select value={settings.layout} onChange={(e) => onChange({ layout: e.target.value as Layout })} className="field" aria-label="Folder layout">
            {(Object.keys(LAYOUT_LABEL) as Layout[]).map((k) => (
              <option key={k} value={k}>
                {LAYOUT_LABEL[k]}
              </option>
            ))}
          </select>
        </Row>
        <Row label="File names" hint="What each file is called.">
          <select
            value={settings.nameStyle}
            onChange={(e) => onChange({ nameStyle: e.target.value as NameStyle })}
            className="field"
            aria-label="File names"
            disabled={advanced && settings.customName.trim() !== ""}
          >
            {(Object.keys(NAME_LABEL) as NameStyle[]).map((k) => (
              <option key={k} value={k}>
                {NAME_LABEL[k]}
              </option>
            ))}
          </select>
        </Row>
        <div className="pref-row">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.playlistFolder} onChange={(e) => onChange({ playlistFolder: e.target.checked })} />
            Put playlist downloads in a folder named after the playlist
          </label>
        </div>
        <div className="pref-row">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.playlistNumbering} onChange={(e) => onChange({ playlistNumbering: e.target.checked })} />
            Number playlist items (01, 02, ...) so they stay in order
          </label>
        </div>
        {advanced && (
          <div className="pref-row" style={{ display: "block" }}>
            <div>Custom file name template</div>
            <input
              value={settings.customName}
              onChange={(e) => onChange({ customName: e.target.value })}
              placeholder="%(channel)s/%(upload_date>%Y)s/%(title)s"
              spellCheck={false}
              aria-label="Custom file name template"
              className="field mono w-full mt-1.5"
            />
            {customError ? (
              <p className="pref-hint mt-1.5 mb-0" role="alert" style={{ color: "#b3261e" }}>
                {customError}
              </p>
            ) : (
              <p className="pref-hint mt-1.5 mb-0">Uses yt-dlp fields such as %(title)s, %(id)s, %(channel)s. Leave empty to use the two settings above.</p>
            )}
          </div>
        )}
        <div className="pref-row" style={{ display: "block" }}>
          <div className="pref-hint">Example</div>
          <div className="mono selectable" aria-label="Example path">
            {previewPath(prefs)}
          </div>
          <div className="mono dim selectable mt-0.5" aria-label="Example playlist path">
            {previewPath(prefs, { playlist: true })}
          </div>
        </div>
        {advanced && (
          <>
            <Row label="Simultaneous downloads" hint="How many run at once; the rest wait in the queue.">
              <select value={settings.concurrency} onChange={(e) => onChange({ concurrency: Number(e.target.value) })} className="field" aria-label="Simultaneous downloads">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Audio format" hint='Used for every "Audio only" download.'>
              <select value={settings.audioFormat} onChange={(e) => onChange({ audioFormat: e.target.value as AudioFormat })} className="field" aria-label="Audio format">
                {AUDIO_FORMATS.map(([id, text]) => (
                  <option key={id} value={id}>
                    {text}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Speed limit" hint="For example 500K or 2M. Leave empty for no limit.">
              <input
                value={settings.rateLimit}
                onChange={(e) => onChange({ rateLimit: e.target.value })}
                placeholder="unlimited"
                spellCheck={false}
                aria-label="Speed limit"
                aria-invalid={!!speedProblem}
                className="field mono"
                style={{ width: 110 }}
              />
            </Row>
            {speedProblem && (
              <div className="pref-row" role="alert" style={{ color: "#b3261e" }}>
                {speedProblem}
              </div>
            )}
            <Row label="Audio quality" hint="Best, or a bitrate such as 192K. Applies to Audio only downloads.">
              <input
                value={settings.audioQuality}
                onChange={(e) => onChange({ audioQuality: e.target.value })}
                placeholder="best"
                spellCheck={false}
                aria-label="Default audio quality"
                aria-invalid={!!qualityProblem}
                className="field mono"
                style={{ width: 110 }}
              />
            </Row>
            {qualityProblem && (
              <div className="pref-row" role="alert" style={{ color: "#b3261e" }}>
                {qualityProblem}
              </div>
            )}
            <div className="pref-row">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.audioNormalize} onChange={(e) => onChange({ audioNormalize: e.target.checked })} />
                Even out the volume of audio downloads
              </label>
            </div>
            <div className="pref-row">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.audioTrimSilence} onChange={(e) => onChange({ audioTrimSilence: e.target.checked })} />
                Trim silence at the start and end of audio downloads
              </label>
            </div>
            <Row label="Cover art" hint="For audio downloads started in bulk. A single download can choose its own.">
              <select value={settings.coverMode} onChange={(e) => onChange({ coverMode: e.target.value as Settings["coverMode"] })} className="field" aria-label="Default cover art">
                <option value="default">The video's thumbnail</option>
                <option value="square">The thumbnail, cropped square</option>
                <option value="none">No cover art</option>
              </select>
            </Row>
            <Row label="Lyrics" hint="Looked up on the free LRCLIB service by artist and title.">
              <select value={settings.lyricsMode} onChange={(e) => onChange({ lyricsMode: e.target.value as Settings["lyricsMode"] })} className="field" aria-label="Default lyrics">
                <option value="off">No lyrics</option>
                <option value="file">Save as a .lrc file</option>
                <option value="embed">Put inside the song</option>
                <option value="both">Both</option>
              </select>
            </Row>
            <Row label="Try again after network errors" hint="Waits 5, 15, then 45 seconds between tries and keeps what was downloaded.">
              <select value={settings.autoRetries} onChange={(e) => onChange({ autoRetries: Number(e.target.value) })} className="field" aria-label="Automatic retries">
                {[0, 1, 2, 3, 5].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "Never" : `Up to ${n} time${n > 1 ? "s" : ""}`}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Downloads per website" hint="Some sites block you if too many run at once.">
              <select value={settings.perSiteLimit} onChange={(e) => onChange({ perSiteLimit: Number(e.target.value) })} className="field" aria-label="Downloads per website">
                <option value={0}>No limit</option>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} at a time
                  </option>
                ))}
              </select>
            </Row>
          </>
        )}
      </Group>

      {advanced && (
        <Group title="Advanced options" hint="Applied to every download made in Advanced mode.">
          <Row label="SponsorBlock" hint="Skip or mark sponsor segments in videos.">
            <select value={settings.sponsorblock} onChange={(e) => onChange({ sponsorblock: e.target.value as SponsorBlock })} className="field" aria-label="SponsorBlock">
              <option value="off">Off</option>
              <option value="mark">Mark segments as chapters</option>
              <option value="remove">Remove sponsor / self-promo / interaction</option>
            </select>
          </Row>
          <Row label="Use cookies from browser" hint="For age-restricted or members-only videos you can watch while logged in.">
            <select
              value={settings.cookiesBrowser ?? ""}
              onChange={(e) => onChange({ cookiesBrowser: (e.target.value || null) as Browser | null })}
              className="field"
              aria-label="Cookies from browser"
            >
              <option value="">None</option>
              {BROWSERS.map((b) => (
                <option key={b} value={b}>
                  {b[0].toUpperCase() + b.slice(1)}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Subtitles" hint="The starting choice for new downloads. You can change it for each video.">
            <select value={settings.subtitleMode} onChange={(e) => onChange({ subtitleMode: e.target.value as SubtitleMode })} className="field" aria-label="Subtitles">
              {(Object.keys(SUBTITLE_MODE_LABEL) as SubtitleMode[]).map((m) => (
                <option key={m} value={m}>
                  {SUBTITLE_MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </Row>
          {settings.subtitleMode !== "off" && (
            <>
              <Row label="Subtitle languages" hint='Language codes separated by commas, like "en, de". Playlists use these directly.'>
                <input
                  value={settings.subtitleLangs}
                  onChange={(e) => onChange({ subtitleLangs: e.target.value })}
                  spellCheck={false}
                  aria-label="Subtitle languages"
                  className="field mono"
                  style={{ width: 140 }}
                />
              </Row>
              <div className="pref-row">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.subtitleAuto} onChange={(e) => onChange({ subtitleAuto: e.target.checked })} />
                  Use automatic captions when there are no human-made ones
                </label>
              </div>
            </>
          )}
          <div className="pref-row">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={settings.verbose} onChange={(e) => onChange({ verbose: e.target.checked })} />
              Keep a detailed log for each download
            </label>
          </div>
          <div className="pref-row" style={{ display: "block" }}>
            <div className="flex items-center gap-2">
              Custom yt-dlp arguments
              <span className="inline-flex items-center gap-1 pref-hint" style={{ color: "#9a6a00" }}>
                <AlertTriangle className="w-3 h-3" /> for experts
              </span>
            </div>
            <input
              value={settings.customArgs}
              onChange={(e) => onChange({ customArgs: e.target.value })}
              placeholder="--embed-chapters --retries 10"
              spellCheck={false}
              aria-label="Custom yt-dlp arguments"
              className="field mono w-full mt-1.5"
            />
            <p className="pref-hint mt-1.5 mb-0">
              Added to every download. Options that run programs (<span className="mono">--exec</span> and similar) are blocked.
            </p>
          </div>
        </Group>
      )}

      <Group title="Notifications and background">
        <div className="pref-row">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.notifyWhenDone} onChange={(e) => onChange({ notifyWhenDone: e.target.checked })} />
            Show a notification when downloads finish while Kaisu is in the background
          </label>
        </div>
        <Row
          label="When I close the window"
          hint={
            trayAvailable === false
              ? "Your desktop doesn't show tray icons, so closing the window always quits (unfinished downloads resume next time). On GNOME, the AppIndicator extension adds tray support."
              : "Downloads can keep going from the tray icon after the window closes."
          }
        >
          <select
            value={settings.closeMode}
            onChange={(e) => onChange({ closeMode: e.target.value as CloseMode })}
            className="field"
            aria-label="When I close the window"
            disabled={trayAvailable === false}
          >
            <option value="downloads">Keep downloading in the background</option>
            <option value="always">Always stay in the tray</option>
            <option value="never">Quit</option>
          </select>
        </Row>
      </Group>

      <Group title="Network" hint="Send everything Kaisu does (searching, downloading, updating) through a proxy.">
        <div className="pref-row" style={{ display: "block" }}>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-2">
              Proxy
              <input
                value={settings.proxy}
                onChange={(e) => {
                  onChange({ proxy: e.target.value });
                  setProxyTest({ busy: false });
                }}
                placeholder="none (e.g. socks5://127.0.0.1:1080)"
                spellCheck={false}
                aria-label="Proxy"
                aria-invalid={!!proxyProblem}
                className="field mono"
                style={{ width: 280 }}
              />
            </label>
            <button className="btn small" disabled={!settings.proxy.trim() || !!proxyProblem || proxyTest.busy} onClick={runProxyTest}>
              <Route className="w-3 h-3" /> {proxyTest.busy ? "Testing…" : "Test proxy"}
            </button>
          </div>
          {proxyProblem && (
            <p className="mt-1.5 mb-0" role="alert" style={{ color: "#b3261e" }}>
              {proxyProblem}
            </p>
          )}
          {proxyTest.text && (
            <p className="mt-1.5 mb-0" role={proxyTest.error ? "alert" : "status"} style={{ color: proxyTest.error ? "#b3261e" : "#2f7a2b" }}>
              {proxyTest.text}
            </p>
          )}
          <p className="pref-hint mt-1.5 mb-0">
            http, https, socks4 and socks5 are supported. If it needs a login, it is part of the address (user:password@host) and is stored unencrypted in Kaisu's settings file.
          </p>
        </div>
      </Group>

      {advanced && (
        <Group title="Bandwidth schedule" hint="Slow downloads down, or hold them back, at certain times (for example while you work). Applies in Advanced mode.">
          <ScheduleEditor rules={settings.schedule} onChange={(schedule) => onChange({ schedule })} state={scheduleState} />
        </Group>
      )}

      <Group title="Appearance">
        <Row label="Theme" hint="Aqua is the classic look. Graphite is colourless. Dark is easier on the eyes at night.">
          <select value={settings.theme} onChange={(e) => onChange({ theme: e.target.value as Theme })} className="field" aria-label="Theme">
            <option value="aqua">Aqua</option>
            <option value="graphite">Graphite</option>
            <option value="dark">Dark</option>
            <option value="system">Match my system</option>
          </select>
        </Row>
        <Row label="Accent colour" hint={settings.theme === "graphite" ? "Graphite has no colour, so this shows in the other themes." : "The colour of buttons, selections and progress bars."}>
          <select value={settings.accent} onChange={(e) => onChange({ accent: e.target.value as Accent })} className="field" aria-label="Accent colour">
            {ACCENTS.map((a) => (
              <option key={a} value={a}>
                {a[0].toUpperCase() + a.slice(1)}
              </option>
            ))}
          </select>
        </Row>
      </Group>

      <Group title="Saved presets" hint="Named download choices. Make one from a video's details, then pick it in one click.">
        {settings.presets.length === 0 ? (
          <div className="pref-row">
            <span className="pref-hint">No presets yet. Open a video, choose what you want, and press "Save these choices…".</span>
          </div>
        ) : (
          settings.presets.map((p) => (
            <div key={p.id} className="pref-row" role="group" aria-label={`Preset ${p.name}`}>
              <div className="min-w-0">
                <div className="truncate">{p.name}</div>
                <div className="pref-hint">
                  {p.kind === "audio" ? `Audio${p.audioQuality ? ` ${p.audioQuality}` : ""}${p.normalize ? ", even volume" : ""}` : `Video ${p.quality === "best" ? "best quality" : p.quality === "p1080" ? "1080p" : "720p"}`}
                  {p.subMode !== "off" ? `, subtitles (${p.subLangs})` : ""}
                </div>
              </div>
              <button className="btn small" aria-label={`Delete preset ${p.name}`} onClick={() => onChange({ presets: settings.presets.filter((x) => x.id !== p.id) })}>
                Delete
              </button>
            </div>
          ))
        )}
      </Group>

      <Group title="Helpers">
        <div className="pref-row">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.warnDuplicates} onChange={(e) => onChange({ warnDuplicates: e.target.checked })} />
            Warn me before downloading something I already have
          </label>
        </div>
        <div className="pref-row">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.watchClipboard} onChange={(e) => onChange({ watchClipboard: e.target.checked })} />
            Offer to download video links I copy (only well-known sites; nothing is sent anywhere)
          </label>
        </div>
        <Row label="Keyboard shortcuts" hint="Press F1 anywhere to see them.">
          <button onClick={onShowShortcuts} className="btn small">
            <Keyboard className="w-3 h-3" /> Show shortcuts
          </button>
        </Row>
        <Row label="Quick tour" hint="A short walk through the main parts of the window.">
          <button onClick={onShowTour} className="btn small">
            Show the tour again
          </button>
        </Row>
      </Group>

      <Group title="Download engine" hint="The helper tools Kaisu uses to find, download and convert media.">
        <div className="pref-row" style={{ alignItems: "flex-start" }}>
          <div className="min-w-0">
            {advanced ? (
              <div className="mono flex flex-col gap-0.5">
                <span>{componentLine("yt-dlp", engine?.ytdlp)}</span>
                <span>{componentLine("ffmpeg", engine?.ffmpeg)}</span>
                <span>{componentLine("js runtime", engine?.js)}</span>
                {engine?.ytdlp.path && (
                  <button onClick={onRevealEngine} className="link border-0 bg-transparent p-0 text-left w-fit mt-1 text-[11px]" style={{ font: "inherit", fontSize: 11 }}>
                    Show yt-dlp location
                  </button>
                )}
              </div>
            ) : (
              <span>
                {engine?.ready ? "Up to date and ready" : "Needs attention"}
                {engine?.ytdlp.version && <span className="dim"> · version {engine.ytdlp.version}</span>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onOpenSetup} className="btn small" title="Check the helper tools and repair anything missing">
              <Wrench className="w-3 h-3" /> Repair
            </button>
            <button onClick={onCheckUpdate} disabled={engineState.kind === "updating"} className="btn small">
              <RefreshCw className={`w-3 h-3 ${engineState.kind === "updating" ? "animate-spin" : ""}`} />
              Check for updates
            </button>
          </div>
        </div>
        {engineState.kind === "message" && (
          <div className="pref-row">
            <span style={{ color: engineState.error ? "#b3261e" : "#2f7a2b" }}>{engineState.text}</span>
          </div>
        )}
        <div className="pref-row">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.autoUpdate} onChange={(e) => onChange({ autoUpdate: e.target.checked })} />
            Keep the downloader up to date automatically
          </label>
        </div>
      </Group>
    </div>
  );
}
