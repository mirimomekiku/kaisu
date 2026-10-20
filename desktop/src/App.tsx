import React, { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { AlertCircle, AlertTriangle, Download, Link2, Loader2, Search, X } from "lucide-react";
import { useConfirm } from "./components/ConfirmDialog";
import DownloadRow, { DownloadTable, QUEUE_VIEWS } from "./components/DownloadRow";
import HistoryView, { HISTORY_VIEWS } from "./components/HistoryView";
import Lcd, { type LcdState } from "./components/Lcd";
import MediaCard, { type DownloadChoice } from "./components/MediaCard";
import SearchField from "./components/SearchField";
import SearchResults, { SEARCH_VIEWS, type BatchQuality } from "./components/SearchResults";
import SettingsPage, { type EngineState } from "./components/SettingsPage";
import ShortcutsDialog from "./components/ShortcutsDialog";
import Sidebar, { type Page } from "./components/Sidebar";
import TitleBar from "./components/TitleBar";
import WindowControls from "./components/WindowControls";
import SetupScreen from "./components/SetupScreen";
import StatusBar from "./components/StatusBar";
import ViewSwitcher, { effectiveView } from "./components/ViewSwitcher";
import { sameDownload, useDownloads, type DownloadItem } from "./hooks/useDownloads";
import {
  checkSetup,
  classifyLink,
  defaultDownloadDir,
  errorText,
  fileExists,
  freeSpace,
  getEngineInfo,
  getMediaInfo,
  getPlaylist,
  openFile,
  openFolder,
  openUrl,
  quitApp,
  revealEngine,
  revealFile,
  searchMedia,
  setTrayStatus,
  systemPower,
  trayAvailable,
  updateEngine,
  type Clip,
  type EngineInfo,
  type ExtraOptions,
  type LinkKind,
  type MediaInfo,
  type OutputOptions,
  type PlaylistCtx,
  type Preset,
  type SearchResult,
  type SetupInfo,
} from "./lib/api";
import { friendlyError } from "./lib/errors";
import { clipKeyOf, clipLabel, formatBytes, formatEta, formatSpeed } from "./lib/format";
import { extractUrls, isMediaHost, playlistOf, shortLink } from "./lib/links";
import { notify } from "./lib/notify";
import {
  DEFAULT_SETTINGS,
  loadHistory,
  loadQueue,
  loadSettings,
  saveHistory,
  saveQueue,
  saveSettings,
  type HistoryItem,
  type SavedDownload,
  type Settings,
  type ViewMode,
} from "./lib/storage";

const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTO_INSPECT_DELAY_MS = 700;
const LOOKS_LIKE_URL = /^https?:\/\/\S+$/i;
const SEARCH_PAGE_SIZE = 12;
const SEARCH_MAX = 48;
const LISTING_PAGE = 200;
const LISTING_MAX = 500;
const LOW_DISK_BYTES = 2 * 1024 * 1024 * 1024;
const COUNTDOWN_SECONDS = 30;

/** What Simple mode always sends: sensible defaults, none of the advanced settings. */
const SIMPLE_BASE: Omit<ExtraOptions, "output" | "playlist" | "clip"> = {
  sponsorblock: "off",
  cookies_from_browser: null,
  subtitles: false,
  audio_format: "mp3",
  format_id: null,
  rate_limit: null,
  custom_args: null,
  verbose: false,
};

type ListingKind = "search" | "playlist" | "channel" | "links";
interface Listing {
  kind: ListingKind;
  query: string;
  items: SearchResult[];
  limit: number;
  title?: string;
  total?: number | null;
  sourceUrl?: string;
}

/** Something to download: what the user asked for, before it becomes a queue item. */
interface DownloadReq {
  url: string;
  title: string;
  thumbnail: string;
  preset: Preset;
  formatId: string | null;
  playlist?: PlaylistCtx | null;
  clip?: Clip | null;
  /** The title is only the link; yt-dlp supplies the real one once it starts. */
  placeholderTitle?: boolean;
}

type WhenDone = "nothing" | "folder" | "quit" | "sleep" | "shutdown";

const isFinishedStatus = (status: string) => status === "completed" || status === "error" || status === "cancelled";

export default function App() {
  const [url, setUrl] = useState("");
  const [page, setPage] = useState<Page>("search");
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
  const [search, setSearch] = useState<Listing | null>(null);
  const [busyWhat, setBusyWhat] = useState<"search" | "list">("search");
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [existing, setExisting] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<{ text: string; error: boolean } | null>(null);
  const [note, setNote] = useState<{ title: string; subtitle?: string } | null>(null);
  const [historyShown, setHistoryShown] = useState(0);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [restoredCount, setRestoredCount] = useState(0);
  const [clipboardOffer, setClipboardOffer] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [trayOk, setTrayOk] = useState<boolean | null>(null);
  const [whenDone, setWhenDone] = useState<WhenDone>("nothing");
  const [countdown, setCountdown] = useState<{ action: "sleep" | "shutdown"; seconds: number } | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const historyRef = useRef(history);
  historyRef.current = history;
  const inspectToken = useRef(0);
  const searchToken = useRef(0);
  const lastAutoInspected = useRef("");
  const lastOffered = useRef("");
  const searchInput = useRef<HTMLInputElement>(null);
  const urlRef = useRef(url);
  urlRef.current = url;
  /** What happened since downloads last went idle, for the "finished" notification. */
  const session = useRef({ completed: 0, failed: 0, lastDir: "", failedIds: new Set<string>() });
  const confirm = useConfirm();

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
      session.current.completed += 1;
      session.current.lastDir = item.outDir;
      const entry: HistoryItem = {
        id: item.id,
        url: item.url,
        title: item.title,
        thumbnail: item.thumbnail,
        preset: item.preset,
        path: item.path,
        timestamp: Date.now(),
        clip: item.clipKey,
      };
      const rest = historyRef.current.filter((h) => !sameDownload({ url: h.url, preset: h.preset, clipKey: h.clip }, { url: entry.url, preset: entry.preset, clipKey: entry.clip }));
      updateHistory([entry, ...rest]);
    },
    [updateHistory],
  );

  const { items, enqueue, cancel, pause, resume, pauseAll, resumeAll, retry, remove, clearFinished, restore, hasActive } = useDownloads(
    advanced ? settings.concurrency : 2,
    handleCompleted,
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const actionsRef = useRef({ pauseAll, resumeAll });
  actionsRef.current = { pauseAll, resumeAll };

  const changeSettings = useCallback((patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
  }, []);

  const setEngine = useCallback((next: EngineInfo) => {
    setSetupInfo((prev) => (prev ? { ...prev, engine: next } : prev));
  }, []);

  const showFlash = useCallback((text: string, error = false) => {
    setFlash({ text, error });
  }, []);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4500);
    return () => clearTimeout(t);
  }, [note]);
  useEffect(() => {
    if (!batchNotice) return;
    const t = setTimeout(() => setBatchNotice(null), 7000);
    return () => clearTimeout(t);
  }, [batchNotice]);

  // Which downloaded files still exist? Re-checked whenever history changes or a tab is opened.
  useEffect(() => {
    const paths = [...new Set(history.map((h) => h.path).filter((p): p is string => Boolean(p)))];
    if (paths.length === 0) {
      setExisting({});
      return;
    }
    let cancelled = false;
    fileExists(paths)
      .then((res) => {
        if (!cancelled) setExisting(Object.fromEntries(paths.map((p, i) => [p, res[i]])));
      })
      .catch((e) => console.warn("file check failed", e));
    return () => {
      cancelled = true;
    };
  }, [history, page]);

  const openDownloaded = useCallback(
    (path: string) => {
      openFile(path).catch((e) => {
        showFlash(errorText(e), true);
        setExisting((prev) => ({ ...prev, [path]: false }));
      });
    },
    [showFlash],
  );
  const revealDownloaded = useCallback(
    (path: string) => {
      revealFile(path).catch((e) => {
        showFlash(errorText(e), true);
        setExisting((prev) => ({ ...prev, [path]: false }));
      });
    },
    [showFlash],
  );

  const copyText = useCallback(
    (text: string, what: string) => {
      navigator.clipboard
        ?.writeText(text)
        .then(() => setNote({ title: `${what} copied`, subtitle: text }))
        .catch(() => showFlash("Couldn't copy to the clipboard.", true));
    },
    [showFlash],
  );

  // The browser's own right-click menu (Reload, Inspect...) makes no sense in an app window. Keep it only where
  // it's useful: text fields and selectable text. Our own menus handle the rest.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("input, textarea, .selectable")) e.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // A new mode changes what "pasted link" does, so allow an immediate re-lookup.
  useEffect(() => {
    lastAutoInspected.current = "";
  }, [settings.mode]);

  const setView = useCallback(
    (key: "viewSearch" | "viewQueue" | "viewHistory") => (view: ViewMode) => changeSettings({ [key]: view }),
    [changeSettings],
  );

  // ---- startup ----
  useEffect(() => {
    (async () => {
      const [s, h, q] = await Promise.all([loadSettings(), loadHistory(), loadQueue()]);
      setSettings(s);
      setHistory(h);
      setSettingsLoaded(true);
      if (q.length > 0) {
        restore(q);
        setRestoredCount(q.filter((d) => d.status !== "error" && d.status !== "cancelled").length);
      }
      setQueueLoaded(true);
    })();
    trayAvailable().then(setTrayOk).catch(() => setTrayOk(null));
    defaultDownloadDir().then(setDefaultDir).catch((e) => console.warn(e));
    checkSetup()
      .then(setSetupInfo)
      .catch((e) => setSetupError(errorText(e)));
  }, []);

  // The queue is saved (at most once a second) so unfinished downloads can be resumed after a restart.
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!queueLoaded || saveTimer.current !== null) return;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      const unfinished: SavedDownload[] = itemsRef.current
        .filter((i) => i.status !== "completed")
        .map((i) => ({
          id: i.id,
          title: i.title,
          url: i.url,
          thumbnail: i.thumbnail,
          preset: i.preset,
          outDir: i.outDir,
          extra: i.extra,
          status: i.status,
          progress: i.progress,
          clipKey: i.clipKey,
          placeholderTitle: i.placeholderTitle,
        }));
      saveQueue(unfinished);
    }, 1000);
  }, [items, queueLoaded]);

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

  // ---- inspect / lists ----
  const loadListing = useCallback(async (link: string, limit: number) => {
    const token = ++searchToken.current;
    const more = limit > LISTING_PAGE;
    if (!more) {
      setChecked(new Set());
      setBatchNotice(null);
    }
    setBusyWhat("list");
    more ? setLoadingMore(true) : setSearching(true);
    setErrorMessage(null);
    setShowErrorDetails(false);
    try {
      const info = await getPlaylist(link, limit);
      if (token === searchToken.current) {
        setSearch({ kind: info.kind === "channel" ? "channel" : "playlist", query: link, items: info.entries, limit, title: info.title, total: info.total, sourceUrl: link });
      }
    } catch (err) {
      if (token === searchToken.current) setErrorMessage(errorText(err));
    } finally {
      if (token === searchToken.current) {
        setSearching(false);
        setLoadingMore(false);
      }
    }
  }, []);

  /** Looks a link up: a playlist or channel is listed, a single video gets its details card. */
  const handleFetchInfo = useCallback(
    async (arg?: string) => {
      const target = (arg ?? url).trim();
      if (!target) return;

      const token = ++inspectToken.current;
      lastAutoInspected.current = target;
      setLoadingInfo(true);
      setErrorMessage(null);
      setShowErrorDetails(false);
      setMedia(null);
      try {
        const kind = await classifyLink(target).catch((): LinkKind => "video");
        if (token !== inspectToken.current) return;
        if (kind !== "video") {
          setLoadingInfo(false);
          await loadListing(target, LISTING_PAGE);
          return;
        }
        const info = await getMediaInfo(target, advanced ? settings.cookiesBrowser : null);
        if (token === inspectToken.current) setMedia({ url: target, info });
      } catch (err) {
        if (token === inspectToken.current) setErrorMessage(errorText(err));
      } finally {
        if (token === inspectToken.current) setLoadingInfo(false);
      }
    },
    [url, advanced, settings.cookiesBrowser, loadListing],
  );

  const runSearch = useCallback(async (query: string, limit: number) => {
    const token = ++searchToken.current;
    const more = limit > SEARCH_PAGE_SIZE;
    if (!more) {
      setChecked(new Set());
      setBatchNotice(null);
    }
    setBusyWhat("search");
    more ? setLoadingMore(true) : setSearching(true);
    setErrorMessage(null);
    setShowErrorDetails(false);
    try {
      const found = await searchMedia(query, limit);
      if (token === searchToken.current) setSearch({ kind: "search", query, items: found, limit });
    } catch (err) {
      if (token === searchToken.current) setErrorMessage(errorText(err));
    } finally {
      if (token === searchToken.current) {
        setSearching(false);
        setLoadingMore(false);
      }
    }
  }, []);

  /** Several links at once (a multi-link paste or drop): list them, all ticked, ready to download together. */
  const showLinks = useCallback((urls: string[]) => {
    const entries: SearchResult[] = urls.map((u) => ({ id: u, title: u, url: u, channel: null, duration_secs: null, view_count: null, thumbnail: "", live: false }));
    searchToken.current++;
    setMedia(null);
    setErrorMessage(null);
    setSearch({ kind: "links", query: "", items: entries, limit: entries.length, title: `${entries.length} links` });
    setChecked(new Set(urls));
    setBatchNotice(null);
    setPage("search");
  }, []);

  /** Look up one link from anywhere (clipboard offer, drop). */
  const submitLink = useCallback(
    (link: string) => {
      setUrl(link);
      setSearch(null);
      setPage("search");
      handleFetchInfo(link);
    },
    [handleFetchInfo],
  );

  /** Enter in the search box: links are looked up, anything else is searched. */
  const handleSubmit = () => {
    const text = url.trim();
    if (!text) return;
    setPage("search");
    const links = extractUrls(text);
    const onlyLinks = links.length > 0 && text.replace(/https?:\/\/\S+/gi, "").trim() === "";
    if (onlyLinks && links.length > 1) {
      showLinks(links);
    } else if (LOOKS_LIKE_URL.test(text)) {
      setSearch(null);
      handleFetchInfo();
    } else {
      setMedia(null);
      runSearch(text, SEARCH_PAGE_SIZE);
    }
  };

  const searchFor = (query: string) => {
    setUrl(query);
    setPage("search");
    setMedia(null);
    runSearch(query, SEARCH_PAGE_SIZE);
  };

  const selectResult = (result: SearchResult) => {
    setUrl(result.url);
    lastAutoInspected.current = result.url; // don't let simple mode's auto-lookup fire a second time
    handleFetchInfo(result.url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Simple mode: look the link up as soon as a complete one has been pasted.
  useEffect(() => {
    const target = url.trim();
    if (!settingsLoaded || mode !== "simple" || !engine?.ready) return;
    if (!LOOKS_LIKE_URL.test(target) || target === lastAutoInspected.current) return;
    const timer = setTimeout(() => {
      setPage("search");
      handleFetchInfo();
    }, AUTO_INSPECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [url, mode, settingsLoaded, engine?.ready, handleFetchInfo]);

  // ---- download ----
  const outputOptions = (): OutputOptions => ({
    layout: settings.layout,
    name: settings.nameStyle,
    custom: advanced && settings.customName.trim() ? settings.customName.trim() : null,
    playlist_folder: settings.playlistFolder,
    playlist_numbering: settings.playlistNumbering,
  });

  const buildExtra = (formatId: string | null, ctx?: { playlist?: PlaylistCtx | null; clip?: Clip | null }): ExtraOptions => ({
    ...(advanced
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
      : SIMPLE_BASE),
    output: outputOptions(),
    playlist: ctx?.playlist ?? null,
    clip: ctx?.clip ?? null,
  });

  /**
   * The one way downloads get queued. Skips what is already queued, asks before repeating something already on
   * disk, and warns when the drive is nearly full. Returns how many were added (0 if the user backed out).
   */
  const submitDownloads = async (reqs: DownloadReq[], estimateBytes: number | null = null): Promise<number> => {
    if (!effectiveOutDir) {
      setErrorMessage("Could not determine a download folder. Choose one in Settings.");
      return 0;
    }
    const keyOf = (r: DownloadReq) => ({ url: r.url, preset: r.preset, clipKey: clipKeyOf(r.clip ?? null) });

    const live = itemsRef.current.filter((i) => !isFinishedStatus(i.status));
    let todo = reqs.filter((r) => !live.some((i) => sameDownload(i, keyOf(r))));
    if (todo.length === 0) {
      setNote({ title: "Already in Downloads", subtitle: reqs.length === 1 ? reqs[0].title : `${reqs.length} items` });
      return 0;
    }

    if (settingsRef.current.warnDuplicates) {
      const onDisk = (r: DownloadReq) =>
        historyRef.current.find(
          (h) => sameDownload({ url: h.url, preset: h.preset, clipKey: h.clip }, keyOf(r)) && h.path && existing[h.path] !== false,
        );
      const dupes = todo.filter((r) => onDisk(r));
      if (dupes.length > 0) {
        if (todo.length === 1) {
          const prior = onDisk(todo[0]);
          const choice = await confirm.ask({
            title: "You already downloaded this",
            body: (
              <p className="m-0">
                <b>{todo[0].title}</b> was downloaded{prior ? ` on ${new Date(prior.timestamp).toLocaleDateString()}` : ""}. Download it again?
              </p>
            ),
            buttons: [
              { id: "cancel", label: "Cancel" },
              ...(prior?.path ? [{ id: "open", label: "Open the file" }] : []),
              { id: "again", label: "Download again", primary: true },
            ],
          });
          if (choice === "open" && prior?.path) openDownloaded(prior.path);
          if (choice !== "again") return 0;
        } else {
          const choice = await confirm.ask({
            title: `${dupes.length} of these are already downloaded`,
            body: <p className="m-0">You have already downloaded {dupes.length} of the {todo.length} selected items. Skip those, or download everything again?</p>,
            buttons: [
              { id: "cancel", label: "Cancel" },
              { id: "all", label: "Download all anyway" },
              ...(dupes.length < todo.length ? [{ id: "skip", label: `Skip ${dupes.length} already downloaded`, primary: true }] : []),
            ],
          });
          if (choice === "skip") todo = todo.filter((r) => !dupes.includes(r));
          else if (choice !== "all") return 0;
        }
      }
    }

    const free = await freeSpace(effectiveOutDir).catch(() => null);
    if (free !== null) {
      const needed = estimateBytes ? estimateBytes * 1.3 : 0;
      if (free < LOW_DISK_BYTES || (needed > 0 && free < needed)) {
        const choice = await confirm.ask({
          title: "Low disk space",
          body: (
            <p className="m-0">
              Only <b>{formatBytes(free)}</b> is free where downloads are saved
              {needed > 0 ? `, and this needs about ${formatBytes(needed)}` : ""}. If the drive fills up, the download will fail part-way. Continue anyway?
            </p>
          ),
          buttons: [
            { id: "go", label: "Download anyway" },
            { id: "cancel", label: "Cancel", primary: true },
          ],
          cancelId: "cancel",
        });
        if (choice !== "go") return 0;
      }
    }

    enqueue(
      todo.map((r) => ({
        url: r.url,
        title: r.title,
        thumbnail: r.thumbnail,
        preset: r.preset,
        outDir: effectiveOutDir,
        extra: buildExtra(r.formatId, { playlist: r.playlist, clip: r.clip }),
        clipKey: clipKeyOf(r.clip ?? null),
        placeholderTitle: r.placeholderTitle,
      })),
    );
    setNote({ title: "Added to Downloads", subtitle: todo.length === 1 ? todo[0].title : `${todo.length} items` });
    return todo.length;
  };

  const queueDownload = (target: string, title: string, thumbnail: string, preset: Preset, formatId: string | null, playlist?: PlaylistCtx | null) =>
    submitDownloads([{ url: target, title, thumbnail, preset, formatId, playlist }]);

  const downloadCurrent = async (choice: DownloadChoice) => {
    if (!media) return false;
    const key = clipKeyOf(choice.clip);
    const title = choice.clip ? `${media.info.title} (clip ${clipLabel(key)})` : media.info.title;
    const added = await submitDownloads(
      [{ url: media.url, title, thumbnail: media.info.thumbnail ?? "", preset: choice.preset, formatId: choice.formatId, clip: choice.clip }],
      choice.estimate,
    );
    return added > 0;
  };

  const activeOptions = [
    settings.sponsorblock !== "off" && `SponsorBlock ${settings.sponsorblock}`,
    settings.cookiesBrowser && `cookies from ${settings.cookiesBrowser}`,
    settings.subtitles && "subtitles",
    settings.rateLimit.trim() && `limit ${settings.rateLimit.trim()}/s`,
    settings.customArgs.trim() && "custom arguments",
    settings.audioFormat !== "mp3" && `audio ${settings.audioFormat.toUpperCase()}`,
  ].filter((x): x is string => Boolean(x));

  const toggleChecked = (u: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(u) ? next.delete(u) : next.add(u);
      return next;
    });

  const toggleAll = (all: boolean) => setChecked(all && search ? new Set(search.items.map((r) => r.url)) : new Set());

  /** Playlist items remember their position, so their files can be numbered. */
  const listingCtx = (r: SearchResult): PlaylistCtx | null =>
    search?.kind === "playlist"
      ? { title: search.title ?? "Playlist", index: search.items.indexOf(r) + 1, total: Math.max(search.total ?? 0, search.items.length) }
      : null;

  const requestsFor = (picked: SearchResult[], kind: "video" | "audio", quality: BatchQuality): DownloadReq[] =>
    picked.map((r) => ({
      url: r.url,
      title: r.title,
      thumbnail: r.thumbnail,
      preset: kind === "audio" ? "audio" : quality,
      formatId: null,
      playlist: listingCtx(r),
      placeholderTitle: search?.kind === "links",
    }));

  const downloadPicked = async (picked: SearchResult[], kind: "video" | "audio", quality: BatchQuality) => {
    const added = await submitDownloads(requestsFor(picked, kind, quality));
    if (added > 0) {
      setChecked(new Set());
      setBatchNotice(`Added ${added} ${kind === "audio" ? "audio" : "video"} download${added > 1 ? "s" : ""} to the queue.`);
    }
  };
  const downloadChecked = (kind: "video" | "audio", quality: BatchQuality) => {
    if (search) downloadPicked(search.items.filter((r) => checked.has(r.url)), kind, quality);
  };
  const downloadAll = (kind: "video" | "audio") => {
    if (search) downloadPicked(search.items, kind, "best");
  };

  // ---- derived ----
  const activeDownloads = items.filter((i) => i.status === "downloading" || i.status === "processing");
  const queuedCount = items.filter((i) => i.status === "queued").length;
  const pausedCount = items.filter((i) => i.status === "paused").length;
  const busyCount = activeDownloads.length + queuedCount;

  const previouslyDownloaded = history.find((h) => url.trim() && h.url === url.trim() && !h.clip);
  const downloadedUrls = new Set(history.map((h) => h.url));
  const downloadsOfCurrent = media
    ? history.filter((h) => h.url === media.url).map((item) => ({ item, exists: item.path ? existing[item.path] : undefined }))
    : [];
  const audioLabel = advanced ? settings.audioFormat.toUpperCase() : "MP3";
  const queueView = effectiveView(settings.viewQueue, QUEUE_VIEWS);
  const finishedCount = items.filter((i) => isFinishedStatus(i.status)).length;
  const friendlyInputError = errorMessage ? friendlyError(errorMessage) : null;
  const visibleMedia = media && media.url === url.trim() ? media.info : null;
  const partOfPlaylist = visibleMedia && media ? playlistOf(media.url) : null;

  const needsSetup = setupInfo !== null && ((!setupInfo.engine.ready && !setupSkipped) || setupRequested);

  // ---- when downloads finish: notification, "when done" action ----
  const prevBusy = useRef(0);
  useEffect(() => {
    // count failures once each
    for (const i of items) {
      if (i.status === "error" && !session.current.failedIds.has(i.id)) {
        session.current.failedIds.add(i.id);
        session.current.failed += 1;
      }
    }
    const was = prevBusy.current;
    prevBusy.current = busyCount;
    if (!(was > 0 && busyCount === 0)) return;

    const { completed, failed, lastDir } = session.current;
    session.current = { completed: 0, failed: 0, lastDir: "", failedIds: new Set() };
    if (completed + failed === 0) return;

    const body = completed > 0 ? `${completed} downloaded${failed ? `, ${failed} failed` : ""}` : `${failed} failed`;
    setNote({ title: completed > 0 ? "Downloads finished" : "Downloads failed", subtitle: body });
    if (settingsRef.current.notifyWhenDone && !document.hasFocus()) notify("Kaisu: downloads finished", body);

    const action = whenDone;
    if (action !== "nothing" && completed > 0) {
      setWhenDone("nothing");
      const folder = lastDir || effectiveOutDir;
      if (action === "folder" && folder) openFolder(folder).catch((e) => showFlash(errorText(e), true));
      else if (action === "quit") quitApp().catch(() => {});
      else if (action === "sleep" || action === "shutdown") setCountdown({ action, seconds: COUNTDOWN_SECONDS });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyCount, items]);

  useEffect(() => {
    if (!countdown) return;
    if (countdown.seconds <= 0) {
      systemPower(countdown.action).catch((e) => showFlash(errorText(e), true));
      setCountdown(null);
      return;
    }
    const t = setTimeout(() => setCountdown({ ...countdown, seconds: countdown.seconds - 1 }), 1000);
    return () => clearTimeout(t);
  }, [countdown, showFlash]);

  // ---- tray, close button and background mode ----
  useEffect(() => {
    if (!settingsLoaded) return;
    setTrayStatus(activeDownloads.length, queuedCount, pausedCount, settings.closeMode).catch(() => {});
  }, [activeDownloads.length, queuedCount, pausedCount, settings.closeMode, settingsLoaded]);

  useEffect(() => {
    let dead = false;
    const offs: Array<() => void> = [];
    const on = (name: string, fn: (payload: unknown) => void) =>
      listen(name, (e) => fn(e.payload))
        .then((off) => (dead ? off() : offs.push(off)))
        .catch(() => {});
    on("tray-action", (action) => (action === "pause_all" ? actionsRef.current.pauseAll() : actionsRef.current.resumeAll()));
    on("background-started", () => notify("Kaisu is still downloading", "It keeps going in the background. Open it again from the tray icon, or launch Kaisu again."));
    return () => {
      dead = true;
      offs.forEach((off) => off());
    };
  }, []);

  // ---- links dropped on the window ----
  useEffect(() => {
    let depth = 0;
    const hasLink = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).some((t) => t === "text/uri-list" || t === "text/plain" || t === "text/html");
    const onEnter = (e: DragEvent) => {
      if (!hasLink(e)) return;
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasLink(e)) e.preventDefault(); // allows dropping here
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const text = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain") || "";
      const links = extractUrls(text);
      if (links.length === 1) submitLink(links[0]);
      else if (links.length > 1) showLinks(links);
      else showFlash("That doesn't contain a link Kaisu can use.", true);
    };
    document.addEventListener("dragenter", onEnter);
    document.addEventListener("dragover", onOver);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, [submitLink, showLinks, showFlash]);

  // ---- offer to download a video link that was just copied ----
  useEffect(() => {
    if (!settingsLoaded || !settings.watchClipboard || !engine?.ready) return;
    const check = async () => {
      if (!document.hasFocus()) return;
      try {
        const text = ((await readText()) ?? "").trim();
        const links = extractUrls(text);
        if (links.length !== 1 || links[0] !== text || !isMediaHost(text)) return;
        if (text === lastOffered.current || text === urlRef.current.trim()) return;
        lastOffered.current = text;
        setClipboardOffer(text);
      } catch {
        /* the clipboard may be empty or hold something that isn't text */
      }
    };
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [settingsLoaded, settings.watchClipboard, engine?.ready]);

  // ---- keyboard shortcuts ----
  const shortcutHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcutHandler.current = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    // Dialogs and menus handle their own keys.
    if (document.querySelector("[role=alertdialog], [role=dialog][aria-modal=true], [role=menu]")) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const typing = !!(e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]");

    if (e.key === "F1" || (mod && key === "/")) {
      e.preventDefault();
      setShortcutsOpen(true);
    } else if (mod && !e.altKey && ["f", "l", "k"].includes(key)) {
      e.preventDefault();
      setPage("search");
      searchInput.current?.focus();
      searchInput.current?.select();
    } else if (mod && !e.altKey && ["1", "2", "3", "4"].includes(key)) {
      e.preventDefault();
      setPage((["search", "downloads", "history", "settings"] as Page[])[Number(key) - 1]);
    } else if (mod && key === ",") {
      e.preventDefault();
      setPage("settings");
    } else if (mod && key === "a" && !typing && page === "search" && search) {
      e.preventDefault();
      toggleAll(true);
    } else if (mod && key === "d" && visibleMedia) {
      e.preventDefault();
      downloadCurrent({ preset: e.shiftKey ? "audio" : "best", formatId: null, clip: null, estimate: null });
    } else if (mod && e.shiftKey && key === "p") {
      e.preventDefault();
      pausedCount > 0 ? resumeAll() : pauseAll();
    } else if (mod && key === "o" && effectiveOutDir) {
      e.preventDefault();
      openFolder(effectiveOutDir).catch((err) => showFlash(errorText(err), true));
    } else if (e.key === "Escape") {
      if (checked.size > 0) setChecked(new Set());
      else if (typing) (e.target as HTMLElement).blur();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcutHandler.current(e);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const listingTitle =
    search?.kind === "playlist" || search?.kind === "channel" ? `${search.title ?? ""}${search.total ? ` · ${search.total} video${search.total === 1 ? "" : "s"}` : ""}` : search?.kind === "links" ? search.title : undefined;
  const isListing = search?.kind === "playlist" || search?.kind === "channel";

  const resultsEl = search && (
    <SearchResults
      query={search.query}
      heading={listingTitle}
      limitNote={isListing && search.total && search.total > search.items.length ? `Showing the first ${search.items.length} of ${search.total} videos.` : null}
      onDownloadAll={isListing ? downloadAll : undefined}
      results={search.items}
      view={settings.viewSearch}
      openUrl={visibleMedia ? url.trim() : null}
      checked={checked}
      downloadedUrls={downloadedUrls}
      loadingMore={loadingMore}
      canLoadMore={isListing ? search.items.length >= search.limit && search.limit < LISTING_MAX : search.kind === "search" && search.items.length >= search.limit && search.limit < SEARCH_MAX}
      advanced={advanced}
      audioLabel={audioLabel}
      notice={batchNotice}
      onOpen={selectResult}
      onToggle={toggleChecked}
      onToggleAll={toggleAll}
      onLoadMore={() =>
        isListing && search.sourceUrl
          ? loadListing(search.sourceUrl, Math.min(search.limit + LISTING_PAGE, LISTING_MAX))
          : runSearch(search.query, Math.min(search.limit + SEARCH_PAGE_SIZE, SEARCH_MAX))
      }
      onDownloadChecked={downloadChecked}
      onDownloadOne={(r, preset) => queueDownload(r.url, r.title, r.thumbnail, preset, null, listingCtx(r))}
      onCopy={copyText}
      onOpenInBrowser={(u) => openUrl(u).catch((e) => showFlash(errorText(e), true))}
      onSearchFor={searchFor}
      downloadedFile={(u) => {
        const h = history.find((x) => x.url === u && x.path && !x.clip);
        return h?.path ? { path: h.path, exists: existing[h.path] } : null;
      }}
      onOpenFile={openDownloaded}
      onRevealFile={revealDownloaded}
    />
  );

  // ---- gates ----
  /** Screens that appear before the main window still need the app's own title bar. */
  const gate = (body: React.ReactNode) => (
    <div className="app">
      <TitleBar />
      <div className="flex-1 min-h-0 overflow-auto" style={{ background: "var(--paper)" }}>
        {body}
      </div>
    </div>
  );

  if (setupError) {
    return gate(
      <div className="empty" style={{ minHeight: "100%" }}>
        <AlertCircle className="w-10 h-10" style={{ color: "#b3261e" }} />
        <h2>Kaisu couldn't start</h2>
        <p className="m-0 selectable break-words max-w-md">{setupError}</p>
      </div>,
    );
  }
  if (!setupInfo) {
    return gate(
      <div className="empty" style={{ minHeight: "100%" }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#2f66bf" }} />
      </div>,
    );
  }
  if (needsSetup) {
    return gate(
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
      />,
    );
  }

  const lcd: LcdState = (() => {
    if (searching || loadingMore) return { title: busyWhat === "list" ? "Loading the list…" : "Searching YouTube…", subtitle: search?.query ?? url.trim(), progress: null, busy: true };
    if (loadingInfo) return { title: "Looking up video…", subtitle: url.trim(), progress: null, busy: true };
    // A short confirmation ("Link copied", "Added to Downloads") wins for its few seconds, then progress returns.
    if (note) return { ...note, progress: activeDownloads.length > 0 ? activeDownloads.reduce((sum, i) => sum + i.progress, 0) / activeDownloads.length : null };
    if (activeDownloads.length > 0) {
      const first = activeDownloads[0];
      const mean = activeDownloads.reduce((sum, i) => sum + i.progress, 0) / activeDownloads.length;
      const detail =
        first.status === "processing"
          ? "Finishing up…"
          : [formatSpeed(first.speed), formatEta(first.eta)].filter(Boolean).join(" · ") || `${Math.round(first.progress)}%`;
      return {
        title: first.title,
        subtitle: activeDownloads.length > 1 ? `${activeDownloads.length} downloads · ${detail}` : detail,
        progress: mean,
      };
    }
    if (queuedCount > 0) return { title: "Waiting to download…", subtitle: `${queuedCount} in queue`, progress: null };
    if (pausedCount > 0) return { title: "Downloads paused", subtitle: `${pausedCount} paused. Press Resume to continue`, progress: null };
    if (engine && !engine.ready) return { title: "Helper tools missing", subtitle: "Open Settings, then Repair", progress: null };
    return { title: "Kaisu", subtitle: "Paste a link or search YouTube", progress: null };
  })();

  const viewKey = page === "search" ? "viewSearch" : page === "downloads" ? "viewQueue" : "viewHistory";
  const viewOptions = page === "search" ? SEARCH_VIEWS : page === "downloads" ? QUEUE_VIEWS : HISTORY_VIEWS;
  const currentView = effectiveView(settings[viewKey], viewOptions);

  const engineDot = engineState.kind === "updating" || (engine && !engine.ready) ? "warn" : "";

  const statusCenter =
    page === "search"
      ? search
        ? `${search.items.length} result${search.items.length === 1 ? "" : "s"}${checked.size ? `, ${checked.size} selected` : ""}`
        : visibleMedia
          ? "1 video"
          : ""
      : page === "downloads"
        ? `${items.length} download${items.length === 1 ? "" : "s"}${activeDownloads.length ? `, ${activeDownloads.length} active` : ""}`
        : page === "history"
          ? `${historyShown === history.length ? history.length : `${historyShown} of ${history.length}`} item${history.length === 1 ? "" : "s"}`
          : "";

  const artwork = { src: visibleMedia?.thumbnail ?? null, caption: visibleMedia?.title ?? "No video selected" };

  const emptyState = (icon: React.ReactNode, title: string, text: string) => (
    <div className="empty" style={{ minHeight: 340 }}>
      <div className="big">{icon}</div>
      <h2>{title}</h2>
      <p className="m-0">{text}</p>
    </div>
  );

  return (
    <div className="app">
      <header className="toolbar" data-tauri-drag-region>
        <WindowControls />
        <div className="toolbar-group" data-tauri-drag-region>
          {page !== "settings" ? (
            <ViewSwitcher value={currentView} options={viewOptions} onChange={setView(viewKey)} label="Layout" />
          ) : (
            <span className="font-bold text-[13px]" data-tauri-drag-region style={{ textShadow: "0 1px 0 rgba(255,255,255,.7)" }}>
              Settings
            </span>
          )}
        </div>

        <Lcd {...lcd} />

        <div className="toolbar-group end" data-tauri-drag-region>
          <SearchField
            value={url}
            onChange={setUrl}
            onSubmit={handleSubmit}
            inputRef={searchInput}
            busy={searching || loadingInfo}
            placeholder={advanced ? "Search or paste a link" : "Search YouTube or paste a link"}
          />
        </div>
      </header>

      {engine && !engine.ready && (
        <div className="banner">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Some helper tools are missing, so downloads may not work properly.</span>
          <button onClick={() => setSetupRequested(true)} className="link border-0 bg-transparent p-0" style={{ font: "inherit" }}>
            Fix now
          </button>
        </div>
      )}

      {countdown && (
        <div role="alert" className="banner countdown">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>
            Downloads finished. Kaisu will {countdown.action === "sleep" ? "put the computer to sleep" : "shut the computer down"} in {countdown.seconds} second
            {countdown.seconds === 1 ? "" : "s"}.
          </span>
          <button className="btn small" onClick={() => setCountdown(null)}>
            Cancel
          </button>
        </div>
      )}

      {restoredCount > 0 && pausedCount > 0 && (
        <div role="status" className="banner">
          <span>
            {restoredCount} download{restoredCount === 1 ? " was" : "s were"} unfinished when Kaisu last closed.
          </span>
          <button
            className="btn small primary"
            onClick={() => {
              resumeAll();
              setRestoredCount(0);
            }}
          >
            Resume
          </button>
          <button
            className="btn small"
            onClick={() => {
              items.filter((i) => i.status === "paused").forEach((i) => cancel(i.id));
              clearFinished();
              setRestoredCount(0);
            }}
          >
            Remove them
          </button>
          <button className="row-btn" aria-label="Decide later" title="Decide later" onClick={() => setRestoredCount(0)}>
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {clipboardOffer && clipboardOffer !== url.trim() && (
        <div role="status" className="banner" style={{ background: "linear-gradient(#eef5ff,#dcebff)", borderColor: "#9fbde8", color: "#1d3f73" }}>
          <Link2 className="w-3.5 h-3.5" />
          <span>
            You copied a link: <b className="selectable">{shortLink(clipboardOffer)}</b>
          </span>
          <button
            className="btn small primary"
            onClick={() => {
              const link = clipboardOffer;
              setClipboardOffer(null);
              submitLink(link);
            }}
          >
            Look it up
          </button>
          <button className="row-btn" aria-label="Dismiss" title="Dismiss" onClick={() => setClipboardOffer(null)}>
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {flash && (
        <div role="status" className={`banner ${flash.error ? "bad" : "ok"}`}>
          <span>{flash.text}</span>
          <button onClick={() => setFlash(null)} aria-label="Dismiss" className="row-btn">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="app-body">
        <Sidebar
          page={page}
          onNavigate={setPage}
          active={activeDownloads.length}
          total={items.length}
          historyCount={history.length}
          art={artwork}
        />

        <main className="content" aria-label={page}>
          {page === "search" && (
            <div className="page flush">
              {(errorMessage && friendlyInputError) || (previouslyDownloaded && !visibleMedia) ? (
                <div className="px-4 pt-3 flex flex-col gap-2">
                  {previouslyDownloaded && !visibleMedia && (
                    <div className="alert note items-center">
                      <span className="flex-1 min-w-0 truncate">
                        You already downloaded this (<b>{previouslyDownloaded.title}</b>) on {new Date(previouslyDownloaded.timestamp).toLocaleDateString()}.
                      </span>
                      <button onClick={() => setPage("history")} className="link border-0 bg-transparent p-0 shrink-0" style={{ font: "inherit" }}>
                        View in History
                      </button>
                    </div>
                  )}
                  {errorMessage && friendlyInputError && (
                    <div className="alert">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#b3261e" }} />
                      {advanced ? (
                        <div className="break-words whitespace-pre-wrap selectable">{errorMessage}</div>
                      ) : (
                        <div className="flex flex-col gap-1 min-w-0">
                          <b>{friendlyInputError.summary}</b>
                          {friendlyInputError.hint && <span>{friendlyInputError.hint}</span>}
                          <button onClick={() => setShowErrorDetails((v) => !v)} className="link border-0 bg-transparent p-0 w-fit text-left" style={{ font: "inherit" }}>
                            {showErrorDetails ? "Hide" : "Show"} technical details
                          </button>
                          {showErrorDetails && <div className="mono dim break-words whitespace-pre-wrap selectable">{errorMessage}</div>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : null}

              {visibleMedia && partOfPlaylist && !isListing && (
                <div className="px-3 pt-3">
                  <div className="alert note items-center">
                    <span className="flex-1 min-w-0">This video is part of a playlist.</span>
                    <button
                      className="btn small"
                      onClick={() => {
                        setUrl(partOfPlaylist.url);
                        setMedia(null);
                        loadListing(partOfPlaylist.url, LISTING_PAGE);
                      }}
                    >
                      View playlist
                    </button>
                  </div>
                </div>
              )}

              {visibleMedia && (
                <div className="p-3">
                  <MediaCard
                    key={media?.url}
                    info={visibleMedia}
                    mode={mode}
                    audioLabel={audioLabel}
                    activeOptions={activeOptions}
                    downloads={downloadsOfCurrent}
                    onDownload={downloadCurrent}
                    onOpen={openDownloaded}
                    onReveal={revealDownloaded}
                  />
                </div>
              )}

              {resultsEl}

              {!search && !visibleMedia && !errorMessage &&
                emptyState(
                  <Search className="w-14 h-14" strokeWidth={1.25} />,
                  "Search YouTube or paste a link",
                  "Type in the search box at the top right and press Return. Tick several results to download them all at once.",
                )}
            </div>
          )}

          {page === "downloads" &&
            (items.length === 0 ? (
              emptyState(<Download className="w-14 h-14" strokeWidth={1.25} />, "No downloads", "Videos you download will appear here with their progress.")
            ) : effectiveView(settings.viewQueue, QUEUE_VIEWS) === "details" ? (
              <DownloadTable items={items} mode={mode} onCancel={cancel} onPause={pause} onResume={resume} onRetry={retry} onRemove={remove} onOpen={openDownloaded} onReveal={revealDownloaded} />
            ) : (
              <div
                className={`p-3 ${
                  queueView === "grid" ? "grid grid-cols-2 lg:grid-cols-3 gap-3 items-start" : queueView === "compact" ? "flex flex-col gap-1" : "flex flex-col gap-1.5"
                }`}
              >
                {items.map((item) => (
                  <DownloadRow
                    key={item.id}
                    item={item}
                    mode={mode}
                    view={queueView}
                    onCancel={cancel}
                    onPause={pause}
                    onResume={resume}
                    onRetry={retry}
                    onRemove={remove}
                    onOpen={openDownloaded}
                    onReveal={revealDownloaded}
                  />
                ))}
              </div>
            ))}

          {page === "history" && (
            <HistoryView
              items={history}
              exists={existing}
              view={settings.viewHistory}
              advanced={advanced}
              audioLabel={audioLabel}
              onOpen={openDownloaded}
              onReveal={revealDownloaded}
              onRemove={(id) => updateHistory(history.filter((h) => h.id !== id))}
              onClear={() => updateHistory([])}
              onDownloadAgain={(item, preset) => queueDownload(item.url, item.title, item.thumbnail, preset, null)}
              onShownChange={setHistoryShown}
            />
          )}

          {page === "settings" && (
            <SettingsPage
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
              onRevealEngine={() => revealEngine().catch((e) => showFlash(errorText(e), true))}
              onShowShortcuts={() => setShortcutsOpen(true)}
              trayAvailable={trayOk}
            />
          )}
        </main>
      </div>

      <StatusBar
        left={
          advanced && engine ? (
            <button className="row-btn" onClick={() => setPage("settings")} title={engine.ytdlp.source ? `yt-dlp source: ${engine.ytdlp.source}. Open settings` : "Open settings"}>
              <span className={`dot ${engineDot}`} />
              {engineState.kind === "updating" ? "Updating engine…" : engine.ytdlp.version ? `yt-dlp ${engine.ytdlp.version}` : "Engine"}
            </button>
          ) : null
        }
        center={statusCenter}
        right={
          page === "downloads" ? (
            <>
              {busyCount > 0 || pausedCount > 0 ? (
                <button className="btn small" onClick={() => (pausedCount > 0 && busyCount === 0 ? resumeAll() : pauseAll())}>
                  {pausedCount > 0 && busyCount === 0 ? "Resume all" : "Pause all"}
                </button>
              ) : null}
              <label className="flex items-center gap-1">
                When done
                <select value={whenDone} onChange={(e) => setWhenDone(e.target.value as WhenDone)} className="field" style={{ height: 19, fontSize: 11 }} aria-label="When downloads finish">
                  <option value="nothing">do nothing</option>
                  <option value="folder">open the folder</option>
                  <option value="quit">quit Kaisu</option>
                  <option value="sleep">sleep</option>
                  <option value="shutdown">shut down</option>
                </select>
              </label>
              {finishedCount > 0 && (
                <button className="btn small" onClick={clearFinished}>
                  Clear finished
                </button>
              )}
            </>
          ) : null
        }
      />

      {confirm.dialog}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div>Drop the link to look it up</div>
        </div>
      )}
    </div>
  );
}
