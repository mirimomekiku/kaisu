import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Download, Link2, Loader2, Search, X } from "lucide-react";
import { useConfirm } from "./components/ConfirmDialog";
import DownloadRow, { DownloadTable, QUEUE_VIEWS } from "./components/DownloadRow";
import HistoryView, { HISTORY_VIEWS } from "./components/HistoryView";
import Lcd, { type LcdState } from "./components/Lcd";
import MediaCard, { type DownloadChoice } from "./components/MediaCard";
import SearchField from "./components/SearchField";
import SearchResults, { SEARCH_VIEWS, type BatchQuality } from "./components/SearchResults";
import SettingsPage, { type EngineState } from "./components/SettingsPage";
import Tour from "./components/Tour";
import ShortcutsDialog from "./components/ShortcutsDialog";
import Sidebar, { type Page } from "./components/Sidebar";
import TitleBar from "./components/TitleBar";
import WindowControls from "./components/WindowControls";
import SetupScreen from "./components/SetupScreen";
import StatusBar from "./components/StatusBar";
import ViewSwitcher, { effectiveView } from "./components/ViewSwitcher";
import { useAutoClear } from "./hooks/useAutoClear";
import { useBatchFinish, useSessionStats, type WhenDone } from "./hooks/useBatchFinish";
import { useClipboardOffer } from "./hooks/useClipboardOffer";
import { useDownloadedFiles } from "./hooks/useDownloadedFiles";
import { useDropLinks } from "./hooks/useDropLinks";
import { sameDownload, useDownloads, type DownloadItem } from "./hooks/useDownloads";
import { useQueuePersistence } from "./hooks/useQueuePersistence";
import { useShortcuts } from "./hooks/useShortcuts";
import { useSchedule } from "./hooks/useSchedule";
import { useTrayBridge } from "./hooks/useTrayBridge";
import {
  checkSetup,
  classifyLink,
  defaultDownloadDir,
  errorText,
  exportText,
  freeSpace,
  getEngineInfo,
  getMediaInfo,
  getPlaylist,
  openFolder,
  openUrl,
  revealEngine,
  searchMedia,
  setProxy,
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
  type SearchSource,
  type SetupInfo,
  type SubtitleOptions,
} from "./lib/api";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { friendlyError } from "./lib/errors";
import { historyToCsv, historyToJson, type HistoryRow } from "./lib/history";
import { validateRule } from "./lib/schedule";
import { SEARCH_SOURCES, knownSource, sourceLabel } from "./lib/sources";
import { parseLangs, toOptions } from "./lib/subtitles";
import { clipKeyOf, clipLabel, formatBytes, formatEta, formatSpeed } from "./lib/format";
import { extractUrls, playlistOf, shortLink } from "./lib/links";
import {
  DEFAULT_SETTINGS,
  loadHistory,
  loadQueue,
  loadSettings,
  saveHistory,
  saveSettings,
  type HistoryItem,
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

/** What Simple mode always sends: sensible defaults, none of the advanced settings. */
const SIMPLE_BASE: Omit<ExtraOptions, "output" | "playlist" | "clip" | "proxy" | "subs"> = {
  sponsorblock: "off",
  cookies_from_browser: null,
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
  channel?: string;
  /** Subtitles picked for this one download; otherwise the settings decide (Advanced mode only). */
  subs?: SubtitleOptions | null;
}

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
  const [flash, setFlash] = useState<{ text: string; error: boolean } | null>(null);
  const [note, setNote] = useState<{ title: string; subtitle?: string } | null>(null);
  const [historyStats, setHistoryStats] = useState({ count: 0, bytes: 0 });
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [restoredCount, setRestoredCount] = useState(0);
  const [tourOpen, setTourOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const historyRef = useRef(history);
  historyRef.current = history;
  const inspectToken = useRef(0);
  const searchToken = useRef(0);
  const lastAutoInspected = useRef("");
  const searchInput = useRef<HTMLInputElement>(null);
  const session = useSessionStats();
  const confirm = useConfirm();

  const mode = settings.mode;
  const advanced = mode === "advanced";
  const engine: EngineInfo | null = setupInfo?.engine ?? null;
  const source = knownSource(settings.searchSource);
  const sourceName = sourceLabel(source);
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
        channel: item.channel,
      };
      const rest = historyRef.current.filter((h) => !sameDownload({ url: h.url, preset: h.preset, clipKey: h.clip }, { url: entry.url, preset: entry.preset, clipKey: entry.clip }));
      updateHistory([entry, ...rest]);
    },
    [updateHistory],
  );

  // The bandwidth schedule only applies in Advanced mode, like the other advanced options.
  const usableRules = useMemo(() => settings.schedule.filter((rule) => validateRule(rule) === null), [settings.schedule]);
  const schedule = useSchedule(usableRules, advanced);
  const policy = useMemo(() => ({ blocked: schedule.paused, limit: schedule.limit }), [schedule.paused, schedule.limit]);

  const { items, enqueue, cancel, pause, resume, pauseAll, resumeAll, retry, remove, clearFinished, restore, hasActive } = useDownloads(
    advanced ? settings.concurrency : 2,
    handleCompleted,
    policy,
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useQueuePersistence(items, queueLoaded);

  const changeSettings = useCallback((patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    if (patch.proxy !== undefined) setProxy(patch.proxy);
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
  useAutoClear(flash, setFlash, 6000);
  useAutoClear(note, setNote, 4500);
  useAutoClear(batchNotice, setBatchNotice, 7000);

  const { existing, sizes, recheck, openDownloaded, revealDownloaded } = useDownloadedFiles(history, page, showFlash);

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
      setProxy(s.proxy);
      setSettings(s);
      setHistory(h);
      setSettingsLoaded(true);
      if (q.length > 0) {
        restore(q);
        setRestoredCount(q.filter((d) => d.status !== "error" && d.status !== "cancelled").length);
      }
      setQueueLoaded(true);
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
      const found = await searchMedia(query, limit, knownSource(settingsRef.current.searchSource));
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

  const defaultSubs = (): SubtitleOptions | null =>
    advanced ? toOptions(settings.subtitleMode, parseLangs(settings.subtitleLangs), settings.subtitleAuto) : null;

  const buildExtra = (formatId: string | null, ctx?: { playlist?: PlaylistCtx | null; clip?: Clip | null; subs?: SubtitleOptions | null }): ExtraOptions => ({
    // The proxy applies in both modes: it is about reaching the internet, not about choices.
    proxy: settings.proxy.trim() || null,
    subs: ctx?.subs !== undefined ? ctx.subs : defaultSubs(),
    ...(advanced
      ? {
          sponsorblock: settings.sponsorblock,
          cookies_from_browser: settings.cookiesBrowser,
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
        extra: buildExtra(r.formatId, { playlist: r.playlist, clip: r.clip, subs: r.subs }),
        clipKey: clipKeyOf(r.clip ?? null),
        placeholderTitle: r.placeholderTitle,
        channel: r.channel,
      })),
    );
    setNote({ title: "Added to Downloads", subtitle: todo.length === 1 ? todo[0].title : `${todo.length} items` });
    return todo.length;
  };

  const queueDownload = (target: string, title: string, thumbnail: string, preset: Preset, formatId: string | null, playlist?: PlaylistCtx | null, channel?: string) =>
    submitDownloads([{ url: target, title, thumbnail, preset, formatId, playlist, channel }]);

  /** Queues earlier downloads again, each in the format it had. Clips can't be repeated from what history keeps. */
  const downloadAgainMany = async (picked: HistoryItem[]) => {
    const whole = picked.filter((h) => !h.clip);
    if (whole.length < picked.length) showFlash(`${picked.length - whole.length} clip${picked.length - whole.length === 1 ? " was" : "s were"} skipped. Download clips again from their video.`);
    if (whole.length === 0) return;
    const added = await submitDownloads(whole.map((h) => ({ url: h.url, title: h.title, thumbnail: h.thumbnail, preset: h.preset, formatId: null, channel: h.channel })));
    if (added > 0) setPage("downloads");
  };

  const exportHistory = async (rows: HistoryRow[], format: "csv" | "json") => {
    try {
      const target = await saveDialog({
        title: "Export history",
        defaultPath: `kaisu-history.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!target) return;
      await exportText(target, format === "csv" ? historyToCsv(rows) : historyToJson(rows));
      setNote({ title: "History exported", subtitle: `${rows.length} item${rows.length === 1 ? "" : "s"}` });
    } catch (e) {
      showFlash(errorText(e), true);
    }
  };

  const downloadCurrent = async (choice: DownloadChoice) => {
    if (!media) return false;
    const key = clipKeyOf(choice.clip);
    const title = choice.clip ? `${media.info.title} (clip ${clipLabel(key)})` : media.info.title;
    const added = await submitDownloads(
      [{ url: media.url, title, thumbnail: media.info.thumbnail ?? "", preset: choice.preset, formatId: choice.formatId, clip: choice.clip, channel: media.info.uploader ?? undefined, subs: choice.subs }],
      choice.estimate,
    );
    return added > 0;
  };

  const activeOptions = [
    settings.sponsorblock !== "off" && `SponsorBlock ${settings.sponsorblock}`,
    settings.cookiesBrowser && `cookies from ${settings.cookiesBrowser}`,
    settings.subtitleMode !== "off" && `subtitles (${settings.subtitleLangs.trim() || "none chosen"})`,
    settings.proxy.trim() && "proxy",
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
      channel: r.channel ?? undefined,
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

  // ---- behaviours that live in their own hooks ----
  const { whenDone, setWhenDone, countdown, cancelCountdown } = useBatchFinish({
    items,
    busyCount,
    session,
    notifyWhenDone: settings.notifyWhenDone,
    outDir: effectiveOutDir,
    showFlash,
    announce: setNote,
  });
  const trayOk = useTrayBridge({
    active: activeDownloads.length,
    queued: queuedCount,
    paused: pausedCount,
    closeMode: settings.closeMode,
    ready: settingsLoaded,
    pauseAll,
    resumeAll,
  });
  const dragging = useDropLinks({
    onLink: submitLink,
    onLinks: showLinks,
    onNothing: () => showFlash("That doesn't contain a link Kaisu can use.", true),
  });
  const clipboard = useClipboardOffer(settingsLoaded && settings.watchClipboard && !!engine?.ready, url);
  useShortcuts({
    page,
    hasResults: !!search,
    hasOpenVideo: !!visibleMedia,
    anythingPaused: pausedCount > 0,
    hasOutDir: !!effectiveOutDir,
    selectedCount: checked.size,
    showShortcuts: () => setShortcutsOpen(true),
    goTo: setPage,
    focusSearch: () => {
      setPage("search");
      searchInput.current?.focus();
      searchInput.current?.select();
    },
    selectAll: () => toggleAll(true),
    clearSelection: () => setChecked(new Set()),
    downloadOpenVideo: (asAudio) => void downloadCurrent({ preset: asAudio ? "audio" : "best", formatId: null, clip: null, estimate: null, subs: defaultSubs() }),
    togglePauseAll: () => (pausedCount > 0 ? resumeAll() : pauseAll()),
    openDownloadFolder: () => openFolder(effectiveOutDir).catch((err) => showFlash(errorText(err), true)),
  });

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
      onDownloadOne={(r, preset) => queueDownload(r.url, r.title, r.thumbnail, preset, null, listingCtx(r), r.channel ?? undefined)}
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
    if (searching || loadingMore) return { title: busyWhat === "list" ? "Loading the list…" : `Searching ${sourceName}…`, subtitle: search?.query ?? url.trim(), progress: null, busy: true };
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
    if (schedule.paused && (queuedCount > 0 || pausedCount > 0)) return { title: "Paused by your schedule", subtitle: "Downloads continue when the rule ends", progress: null };
    if (queuedCount > 0) return { title: "Waiting to download…", subtitle: `${queuedCount} in queue`, progress: null };
    if (pausedCount > 0) return { title: "Downloads paused", subtitle: `${pausedCount} paused. Press Resume to continue`, progress: null };
    if (engine && !engine.ready) return { title: "Helper tools missing", subtitle: "Open Settings, then Repair", progress: null };
    return { title: "Kaisu", subtitle: `Paste a link or search ${sourceName}`, progress: null };
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
          ? `${historyStats.count === history.length ? history.length : `${historyStats.count} of ${history.length}`} item${history.length === 1 ? "" : "s"}${historyStats.bytes > 0 ? `, ${formatBytes(historyStats.bytes)}` : ""}`
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
          <select
            value={source}
            onChange={(e) => {
              const next = e.target.value as SearchSource;
              changeSettings({ searchSource: next });
              // Showing search results? Search the same words on the new site.
              if (search?.kind === "search" && search.query) {
                setMedia(null);
                runSearch(search.query, SEARCH_PAGE_SIZE);
              }
            }}
            className="source-select"
            aria-label="Search source"
            title="Where to search"
          >
            {SEARCH_SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <SearchField
            value={url}
            onChange={setUrl}
            onSubmit={handleSubmit}
            inputRef={searchInput}
            busy={searching || loadingInfo}
            placeholder={`Search ${sourceName} or paste a link`}
            sourceName={sourceName}
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
          <button className="btn small" onClick={cancelCountdown}>
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

      {clipboard.offer && clipboard.offer !== url.trim() && (
        <div role="status" className="banner" style={{ background: "linear-gradient(#eef5ff,#dcebff)", borderColor: "#9fbde8", color: "#1d3f73" }}>
          <Link2 className="w-3.5 h-3.5" />
          <span>
            You copied a link: <b className="selectable">{shortLink(clipboard.offer)}</b>
          </span>
          <button
            className="btn small primary"
            onClick={() => {
              const link = clipboard.offer;
              clipboard.dismiss();
              if (link) submitLink(link);
            }}
          >
            Look it up
          </button>
          <button className="row-btn" aria-label="Dismiss" title="Dismiss" onClick={clipboard.dismiss}>
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
                    subtitleDefaults={advanced ? { mode: settings.subtitleMode, langs: settings.subtitleLangs, auto: settings.subtitleAuto } : { mode: "off", langs: settings.subtitleLangs, auto: true }}
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
              sizes={sizes}
              sort={settings.historySort}
              sortDesc={settings.historySortDesc}
              onSortChange={(historySort, historySortDesc) => changeSettings({ historySort, historySortDesc })}
              view={settings.viewHistory}
              advanced={advanced}
              audioLabel={audioLabel}
              onOpen={openDownloaded}
              onReveal={revealDownloaded}
              onRemove={(id) => updateHistory(history.filter((h) => h.id !== id))}
              onRemoveMany={(ids) => {
                const gone = new Set(ids);
                updateHistory(history.filter((h) => !gone.has(h.id)));
              }}
              onClear={() => updateHistory([])}
              onDownloadAgainMany={downloadAgainMany}
              onExport={exportHistory}
              onRecheck={recheck}
              onDownloadAgain={(item, preset) => queueDownload(item.url, item.title, item.thumbnail, preset, null, null, item.channel)}
              onShownChange={(count, bytes) => setHistoryStats((prev) => (prev.count === count && prev.bytes === bytes ? prev : { count, bytes }))}
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
              onShowTour={() => setTourOpen(true)}
              scheduleState={schedule}
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
      {(tourOpen || (settingsLoaded && queueLoaded && !settings.tourSeen && !!engine?.ready)) && (
        <Tour
          onFinish={() => {
            setTourOpen(false);
            changeSettings({ tourSeen: true });
          }}
        />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div>Drop the link to look it up</div>
        </div>
      )}
    </div>
  );
}
