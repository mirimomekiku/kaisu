import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  Film,
  History as HistoryIcon,
  Loader2,
  RotateCcw,
  Sliders,
  Sparkles,
  Trash2,
} from "lucide-react";
import DownloadRow from "./components/DownloadRow";
import MediaCard, { type DownloadChoice } from "./components/MediaCard";
import SettingsPanel, { type EngineState } from "./components/SettingsPanel";
import SetupScreen from "./components/SetupScreen";
import { useDownloads, type DownloadItem } from "./hooks/useDownloads";
import {
  checkSetup,
  defaultDownloadDir,
  errorText,
  getEngineInfo,
  getMediaInfo,
  updateEngine,
  type EngineInfo,
  type ExtraOptions,
  type MediaInfo,
  type Preset,
  type SetupInfo,
} from "./lib/api";
import { friendlyError } from "./lib/errors";
import { PRESET_LABEL } from "./lib/format";
import {
  DEFAULT_SETTINGS,
  loadHistory,
  loadSettings,
  saveHistory,
  saveSettings,
  type HistoryItem,
  type Mode,
  type Settings,
} from "./lib/storage";

const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTO_INSPECT_DELAY_MS = 700;
const LOOKS_LIKE_URL = /^https?:\/\/\S+$/i;

/** What simple mode always sends: sensible defaults, none of the advanced settings. */
const SIMPLE_EXTRA: ExtraOptions = {
  sponsorblock: "off",
  cookies_from_browser: null,
  subtitles: false,
  audio_format: "mp3",
  format_id: null,
  rate_limit: null,
  custom_args: null,
  verbose: false,
};

export default function App() {
  const [url, setUrl] = useState("");
  const [activeTab, setActiveTab] = useState<"downloader" | "history">("downloader");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [defaultDir, setDefaultDir] = useState("");
  const [setupInfo, setSetupInfo] = useState<SetupInfo | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSkipped, setSetupSkipped] = useState(false);
  const [setupRequested, setSetupRequested] = useState(false);
  const [engineState, setEngineState] = useState<EngineState>({ kind: "idle" });
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [media, setMedia] = useState<{ url: string; info: MediaInfo } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const historyRef = useRef(history);
  historyRef.current = history;
  const inspectToken = useRef(0);
  const lastAutoInspected = useRef("");

  const mode = settings.mode;
  const advanced = mode === "advanced";
  const engine: EngineInfo | null = setupInfo?.engine ?? null;
  const effectiveOutDir = settings.outDir ?? defaultDir;

  const updateHistory = useCallback((next: HistoryItem[]) => {
    setHistory(next);
    saveHistory(next);
  }, []);

  const handleCompleted = useCallback(
    (item: DownloadItem) => {
      const entry: HistoryItem = {
        id: item.id,
        url: item.url,
        title: item.title,
        thumbnail: item.thumbnail,
        preset: item.preset,
        path: item.path,
        timestamp: Date.now(),
      };
      const rest = historyRef.current.filter((h) => !(h.url === entry.url && h.preset === entry.preset));
      updateHistory([entry, ...rest]);
    },
    [updateHistory],
  );

  const { items, enqueue, cancel, retry, remove, clearFinished, hasActive } = useDownloads(
    advanced ? settings.concurrency : 2,
    handleCompleted,
  );

  const changeSettings = useCallback((patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
  }, []);

  const setEngine = useCallback((next: EngineInfo) => {
    setSetupInfo((prev) => (prev ? { ...prev, engine: next } : prev));
  }, []);

  // ---- startup ----
  useEffect(() => {
    (async () => {
      const [s, h] = await Promise.all([loadSettings(), loadHistory()]);
      setSettings(s);
      setHistory(h);
      setSettingsLoaded(true);
    })();
    defaultDownloadDir().then(setDefaultDir).catch((e) => console.warn(e));
    checkSetup()
      .then(setSetupInfo)
      .catch((e) => setSetupError(errorText(e)));
  }, []);

  // ---- engine updates ----
  const checkForUpdate = useCallback(
    async (silent: boolean) => {
      setEngineState({ kind: "updating" });
      try {
        const res = await updateEngine();
        changeSettings({ lastEngineCheck: Date.now() });
        setEngine(await getEngineInfo());
        setEngineState(
          res.updated
            ? { kind: "message", text: res.previous ? `Updated yt-dlp ${res.previous} → ${res.version}` : `Installed yt-dlp ${res.version}` }
            : silent
              ? { kind: "idle" }
              : { kind: "message", text: `yt-dlp ${res.version} is the latest version` },
        );
      } catch (e) {
        setEngineState(silent ? { kind: "idle" } : { kind: "message", text: errorText(e), error: true });
        if (silent) console.warn("Auto-update failed:", e);
      }
    },
    [changeSettings, setEngine],
  );

  const autoUpdateTried = useRef(false);
  useEffect(() => {
    if (!settingsLoaded || !engine?.ytdlp.ready || autoUpdateTried.current) return;
    autoUpdateTried.current = true;
    const s = settingsRef.current;
    if (s.autoUpdate && Date.now() - s.lastEngineCheck > AUTO_UPDATE_INTERVAL_MS) {
      checkForUpdate(true);
    }
  }, [settingsLoaded, engine, checkForUpdate]);

  // ---- inspect ----
  const handleFetchInfo = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const target = url.trim();
      if (!target) return;

      const token = ++inspectToken.current;
      lastAutoInspected.current = target;
      setLoadingInfo(true);
      setErrorMessage(null);
      setShowErrorDetails(false);
      setMedia(null);
      try {
        const info = await getMediaInfo(target, advanced ? settings.cookiesBrowser : null);
        if (token === inspectToken.current) setMedia({ url: target, info });
      } catch (err) {
        if (token === inspectToken.current) setErrorMessage(errorText(err));
      } finally {
        if (token === inspectToken.current) setLoadingInfo(false);
      }
    },
    [url, advanced, settings.cookiesBrowser],
  );

  // Simple mode: look the link up as soon as a complete one has been pasted.
  useEffect(() => {
    const target = url.trim();
    if (!settingsLoaded || mode !== "simple" || !engine?.ready) return;
    if (!LOOKS_LIKE_URL.test(target) || target === lastAutoInspected.current) return;
    const timer = setTimeout(() => handleFetchInfo(), AUTO_INSPECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [url, mode, settingsLoaded, engine?.ready, handleFetchInfo]);

  // ---- download ----
  const buildExtra = (formatId: string | null): ExtraOptions =>
    advanced
      ? {
          sponsorblock: settings.sponsorblock,
          cookies_from_browser: settings.cookiesBrowser,
          subtitles: settings.subtitles,
          audio_format: settings.audioFormat,
          format_id: formatId,
          rate_limit: settings.rateLimit.trim() || null,
          custom_args: settings.customArgs.trim() || null,
          verbose: settings.verbose,
        }
      : SIMPLE_EXTRA;

  const queueDownload = (target: string, title: string, thumbnail: string, preset: Preset, formatId: string | null) => {
    if (!effectiveOutDir) {
      setErrorMessage("Could not determine a download folder. Choose one in Settings.");
      return;
    }
    enqueue({ url: target, title, thumbnail, preset, outDir: effectiveOutDir, extra: buildExtra(formatId) });
    setActiveTab("downloader");
  };

  const downloadCurrent = (choice: DownloadChoice) => {
    if (!media) return;
    queueDownload(media.url, media.info.title, media.info.thumbnail ?? "", choice.preset, choice.formatId);
  };

  const switchMode = (next: Mode) => {
    changeSettings({ mode: next });
    lastAutoInspected.current = "";
  };

  const activeOptions = [
    settings.sponsorblock !== "off" && `SponsorBlock ${settings.sponsorblock}`,
    settings.cookiesBrowser && `cookies from ${settings.cookiesBrowser}`,
    settings.subtitles && "subtitles",
    settings.rateLimit.trim() && `limit ${settings.rateLimit.trim()}/s`,
    settings.customArgs.trim() && "custom arguments",
    settings.audioFormat !== "mp3" && `audio ${settings.audioFormat.toUpperCase()}`,
  ].filter((x): x is string => Boolean(x));

  // ---- derived ----
  const previouslyDownloaded = history.find((h) => url.trim() && h.url === url.trim());
  const finishedCount = items.filter((i) => ["completed", "error", "cancelled"].includes(i.status)).length;
  const friendlyInputError = errorMessage ? friendlyError(errorMessage) : null;
  const visibleMedia = media && media.url === url.trim() ? media.info : null;

  const needsSetup = setupInfo !== null && ((!setupInfo.engine.ready && !setupSkipped) || setupRequested);

  // ---- gates ----
  if (setupError) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
        <div className="max-w-md text-center flex flex-col gap-3 items-center">
          <AlertCircle className="w-8 h-8 text-red-400" />
          <h1 className="font-semibold">Kaisu couldn't start</h1>
          <p className="text-xs text-neutral-400 break-words select-text">{setupError}</p>
        </div>
      </div>
    );
  }
  if (!setupInfo) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-rose-400 animate-spin" />
      </div>
    );
  }
  if (needsSetup) {
    return (
      <SetupScreen
        info={setupInfo}
        onDone={(next) => {
          setEngine(next);
          // Setup just fetched the latest yt-dlp; no need to check again right away.
          changeSettings({ lastEngineCheck: Date.now() });
          setSetupRequested(false);
          if (next.ready) setSetupSkipped(false);
        }}
        onSkip={() => {
          setSetupSkipped(true);
          setSetupRequested(false);
        }}
      />
    );
  }

  const engineDot =
    engineState.kind === "updating" ? "bg-amber-400" : engine && !engine.ready ? "bg-red-400" : "bg-emerald-400";
  const engineLabel =
    engineState.kind === "updating" ? "Updating engine…" : engine?.ytdlp.version ? `yt-dlp ${engine.ytdlp.version}` : "Engine";

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
      active ? "bg-rose-600 text-white shadow-sm" : "text-neutral-400 hover:text-white hover:bg-neutral-800/50"
    }`;
  const modeClass = (active: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
      active ? "bg-neutral-700 text-white" : "text-neutral-500 hover:text-neutral-200"
    }`;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-rose-500 selection:text-white">
      <header className="border-b border-neutral-800/80 bg-neutral-900/40 backdrop-blur-md px-6 py-3.5 flex items-center justify-between gap-3 sticky top-0 z-30">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-rose-600 to-rose-400 flex items-center justify-center shadow-lg shadow-rose-950/50">
              <Film className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-base tracking-tight text-white">Kaisu</span>
          </div>

          <nav className="flex items-center gap-1 bg-neutral-900/90 border border-neutral-800 p-1 rounded-xl">
            <button onClick={() => setActiveTab("downloader")} className={tabClass(activeTab === "downloader")}>
              Downloader
            </button>
            <button onClick={() => setActiveTab("history")} className={tabClass(activeTab === "history")}>
              <HistoryIcon className="w-3.5 h-3.5" />
              <span>History</span>
              {history.length > 0 && (
                <span className="ml-1 px-1.5 bg-neutral-800 text-neutral-300 rounded-full text-[10px]">{history.length}</span>
              )}
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex rounded-lg bg-neutral-900/90 border border-neutral-800 p-0.5" role="group" aria-label="Interface mode">
            <button onClick={() => switchMode("simple")} className={modeClass(mode === "simple")} title="Just paste a link and download">
              Simple
            </button>
            <button onClick={() => switchMode("advanced")} className={modeClass(mode === "advanced")} title="Formats, logs and every option">
              Advanced
            </button>
          </div>

          {advanced && (
            <div
              className="hidden md:flex items-center gap-2 bg-neutral-900/80 border border-neutral-800 px-3 py-1.5 rounded-full text-xs text-neutral-300 font-medium"
              title={engine?.ytdlp.source ? `yt-dlp source: ${engine.ytdlp.source}` : undefined}
            >
              <span className={`w-2 h-2 rounded-full ${engineDot} ${engineState.kind === "updating" ? "animate-pulse" : ""}`} />
              <span className="font-mono">{engineLabel}</span>
            </div>
          )}

          <button
            onClick={() => setShowSettings((v) => !v)}
            className={`p-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
              showSettings
                ? "bg-rose-600/20 border-rose-500/60 text-rose-300"
                : "bg-neutral-900/80 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700"
            }`}
            title="Settings"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>
      </header>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          effectiveOutDir={effectiveOutDir}
          engine={engine}
          engineState={engineState}
          onChange={changeSettings}
          onCheckUpdate={() =>
            hasActive
              ? setEngineState({ kind: "message", text: "Wait for downloads to finish before updating", error: true })
              : checkForUpdate(false)
          }
          onOpenSetup={() => setSetupRequested(true)}
        />
      )}

      {engine && !engine.ready && (
        <div className="bg-amber-950/40 border-b border-amber-800/50 px-6 py-2.5 text-xs text-amber-200 flex items-center justify-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Some helper tools are missing, so downloads may not work properly.</span>
          <button onClick={() => setSetupRequested(true)} className="underline font-medium text-amber-300 hover:text-white cursor-pointer">
            Fix now
          </button>
        </div>
      )}

      <main className="flex-1 max-w-4xl w-full mx-auto p-6 flex flex-col gap-6">
        {activeTab === "downloader" ? (
          <>
            <div className="bg-neutral-900/50 border border-neutral-800/80 rounded-2xl p-6 shadow-xl">
              {!advanced && (
                <div className="mb-4">
                  <h1 className="text-base font-semibold text-white">What do you want to download?</h1>
                  <p className="text-xs text-neutral-500 mt-0.5">Paste a link to a video and Kaisu does the rest.</p>
                </div>
              )}
              <form onSubmit={handleFetchInfo} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={advanced ? "Paste video or audio link..." : "Paste a link here (YouTube, Vimeo, and many more)"}
                  spellCheck={false}
                  autoFocus
                  className="flex-1 select-text bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm placeholder:text-neutral-500 focus:outline-none focus:border-rose-500 transition shadow-inner"
                />
                <button
                  type="submit"
                  disabled={loadingInfo || !url.trim()}
                  className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-medium px-5 py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-rose-950/40 cursor-pointer"
                >
                  {loadingInfo ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{advanced ? "Checking..." : "Looking…"}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>{advanced ? "Inspect" : "Find video"}</span>
                    </>
                  )}
                </button>
              </form>

              {previouslyDownloaded && (
                <div className="mt-4 p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/50 text-amber-200 text-xs flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="truncate">
                      You already downloaded this (<span className="text-white font-medium">{previouslyDownloaded.title}</span>) on{" "}
                      {new Date(previouslyDownloaded.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    onClick={() => setActiveTab("history")}
                    className="text-amber-400 hover:text-white underline font-medium cursor-pointer shrink-0"
                  >
                    View in History
                  </button>
                </div>
              )}

              {errorMessage && friendlyInputError && (
                <div className="mt-4 p-3.5 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  {advanced ? (
                    <div className="break-words whitespace-pre-wrap select-text">{errorMessage}</div>
                  ) : (
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="font-medium">{friendlyInputError.summary}</div>
                      {friendlyInputError.hint && <div className="text-red-300/80">{friendlyInputError.hint}</div>}
                      <button
                        onClick={() => setShowErrorDetails((v) => !v)}
                        className="text-neutral-400 hover:text-neutral-200 underline w-fit cursor-pointer"
                      >
                        {showErrorDetails ? "Hide" : "Show"} technical details
                      </button>
                      {showErrorDetails && (
                        <div className="text-neutral-400 font-mono break-words whitespace-pre-wrap select-text">{errorMessage}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {visibleMedia && (
              <MediaCard
                key={media?.url}
                info={visibleMedia}
                mode={mode}
                activeOptions={activeOptions}
                onDownload={downloadCurrent}
              />
            )}

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Downloads ({items.length})</h3>
                {finishedCount > 0 && (
                  <button onClick={clearFinished} className="text-[11px] text-neutral-500 hover:text-neutral-200 cursor-pointer">
                    Clear finished
                  </button>
                )}
              </div>

              {items.length === 0 ? (
                <div className="min-h-36 border border-dashed border-neutral-800/80 rounded-2xl flex flex-col items-center justify-center p-6 text-neutral-500 text-center">
                  <Download className="w-7 h-7 mb-2 text-neutral-600" />
                  <p className="text-xs font-medium text-neutral-400">Nothing downloading</p>
                  <p className="text-[11px] text-neutral-600 mt-0.5">Your downloads will show up here</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {items.map((item) => (
                    <DownloadRow key={item.id} item={item} mode={mode} onCancel={cancel} onRetry={retry} onRemove={remove} />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">Download History</h2>
                <p className="text-xs text-neutral-500">Media downloaded with Kaisu</p>
              </div>
              {history.length > 0 && (
                <button
                  onClick={() => updateHistory([])}
                  className="px-3 py-1.5 rounded-lg border border-neutral-800 bg-neutral-900/60 hover:bg-neutral-800 text-xs text-neutral-400 hover:text-red-400 flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear History</span>
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="min-h-48 border border-dashed border-neutral-800/80 rounded-2xl flex flex-col items-center justify-center p-8 text-neutral-500 text-center">
                <HistoryIcon className="w-8 h-8 mb-2 text-neutral-600 stroke-[1.5]" />
                <p className="text-xs font-medium text-neutral-400">No download history yet</p>
                <p className="text-[11px] text-neutral-600 mt-1">Completed downloads are saved here automatically.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="bg-neutral-900/40 border border-neutral-800/80 hover:border-neutral-700/80 rounded-xl p-3.5 flex items-center justify-between gap-4 transition shadow-sm"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-12 h-8 rounded-lg object-cover shrink-0 border border-neutral-800"
                        />
                      ) : (
                        <div className="w-12 h-8 rounded-lg bg-neutral-800 flex items-center justify-center text-neutral-500 shrink-0">
                          <Film className="w-4 h-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-neutral-200 truncate">{item.title}</div>
                        <div className="flex items-center gap-2 text-[11px] text-neutral-500 mt-0.5">
                          <span>{PRESET_LABEL[item.preset] ?? item.preset}</span>
                          <span>•</span>
                          <span>{new Date(item.timestamp).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => {
                          setUrl(item.url);
                          queueDownload(item.url, item.title, item.thumbnail, item.preset, null);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs flex items-center gap-1 transition cursor-pointer"
                        title="Download this again"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Download again</span>
                      </button>
                      <button
                        onClick={() => updateHistory(history.filter((h) => h.id !== item.id))}
                        className="p-1.5 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-neutral-800 transition cursor-pointer"
                        title="Remove from history"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
