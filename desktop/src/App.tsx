import { MusicPreferencesContext, useCreateMusicPreferences } from "./hooks/useMusicPreferences";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import AppBanners from "./components/AppBanners";
import LibraryPage from "./components/LibraryPage";
import PodcastsPage from "./components/PodcastsPage";
import { FEATURES } from "./lib/features";
import MiniPlayer from "./components/MiniPlayer";
import { useMiniPlayer } from "./hooks/useMiniPlayer";
import { useListening } from "./hooks/useListening";
import PlayerBar from "./components/PlayerBar";
import { useConfirm } from "./components/ConfirmDialog";
import DownloadsPage from "./components/DownloadsPage";
import { QUEUE_VIEWS } from "./components/DownloadRow";
import HistoryView, { HISTORY_VIEWS } from "./components/HistoryView";
import SearchPage from "./components/SearchPage";
import { SEARCH_VIEWS } from "./components/SearchResults";
import SettingsPage from "./components/SettingsPage";
import SetupScreen from "./components/SetupScreen";
import ShortcutsDialog from "./components/ShortcutsDialog";
import Sidebar, { type Page } from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import TitleBar from "./components/TitleBar";
import Toolbar from "./components/Toolbar";
import Tour from "./components/Tour";
import { effectiveView } from "./components/ViewSwitcher";
import { useAutoClear } from "./hooks/useAutoClear";
import { useAppSettings } from "./hooks/useAppSettings";
import { useBatchFinish, useSessionStats, type WhenDone } from "./hooks/useBatchFinish";
import { useClipboardOffer } from "./hooks/useClipboardOffer";
import { useDownloadActions } from "./hooks/useDownloadActions";
import { useLeftovers } from "./hooks/useLeftovers";
import { useLibrary } from "./hooks/useLibrary";
import { usePodcasts } from "./hooks/usePodcasts";
import { MediaActionsContext, useMediaDialogs } from "./hooks/useMediaDialogs";
import { useLoudness } from "./hooks/useLoudness";
import { PlayerContext, useCreatePlayer, usePlayerState } from "./hooks/usePlayer";
import { useDownloads, sameDownload, type DownloadItem } from "./hooks/useDownloads";
import { useDropLinks } from "./hooks/useDropLinks";
import { useEngine } from "./hooks/useEngine";
import { useFinishedFiles } from "./hooks/useFinishedFiles";
import { useHistoryStore } from "./hooks/useHistoryStore";
import { useQueuePersistence } from "./hooks/useQueuePersistence";
import { useSchedule } from "./hooks/useSchedule";
import { SEARCH_PAGE_SIZE, useSearchFlow } from "./hooks/useSearchFlow";
import { useShortcuts } from "./hooks/useShortcuts";
import { useTrayBridge } from "./hooks/useTrayBridge";
import { checkSetup, defaultDownloadDir, errorText, exportText, openFolder, revealEngine, type SearchSource } from "./lib/api";
import { defaultSubs } from "./lib/extra";
import { formatBytes } from "./lib/format";
import { historyToCsv, historyToJson, type HistoryRow } from "./lib/history";
import { lcdState } from "./lib/lcdState";
import { checkPresetName, presetId, type FormatPreset } from "./lib/presets";
import { validateRule } from "./lib/schedule";
import { knownSource, sourceLabel } from "./lib/sources";
import { loadHistory, loadQueue, loadSettings, type HistoryItem, type ViewMode } from "./lib/storage";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";

const isFinishedStatus = (status: string) => status === "completed" || status === "error" || status === "cancelled";

export default function App() {
  const confirm = useConfirm();
  const musicPreferences = useCreateMusicPreferences();
  const listening = useListening();
  const player = useCreatePlayer(listening.record, listening.recordTime);
  const playerState = usePlayerState(player);
  const [page, setPage] = useState<Page>("search");
  const [defaultDir, setDefaultDir] = useState("");
  const [flash, setFlash] = useState<{ text: string; error: boolean } | null>(null);
  const [note, setNote] = useState<{ title: string; subtitle?: string } | null>(null);
  const [historyStats, setHistoryStats] = useState({ count: 0, bytes: 0 });
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [restoredCount, setRestoredCount] = useState(0);
  const [tourOpen, setTourOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const session = useSessionStats();

  const showFlash = useCallback((text: string, error = false) => setFlash({ text, error }), []);
  const mini = useMiniPlayer(showFlash);
  useAutoClear(flash, setFlash, 6000);
  useAutoClear(note, setNote, 4500);

  const { settings, settingsRef, settingsLoaded, changeSettings, changeSettingsGuarded, ensureLyricsConsent, applyLoaded } = useAppSettings(confirm);
  useEffect(() => { if (settingsLoaded) player.setTransitions(settings.gaplessPlayback, settings.crossfadeSeconds); }, [player, settingsLoaded, settings.gaplessPlayback, settings.crossfadeSeconds]);
  const { history, historyRef, setHistory, updateHistory } = useHistoryStore();
  const setup = useEngine({ settingsLoaded, settingsRef, changeSettings });
  const { engine } = setup;

  const mode = settings.mode;
  const advanced = mode === "advanced";
  const source = knownSource(settings.searchSource);
  const sourceName = sourceLabel(source);
  const effectiveOutDir = settings.outDir ?? defaultDir;

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
        flag: item.warning,
      };
      const rest = historyRef.current.filter((h) => !sameDownload({ url: h.url, preset: h.preset, clipKey: h.clip }, { url: entry.url, preset: entry.preset, clipKey: entry.clip }));
      updateHistory([entry, ...rest]);
    },
    [historyRef, session, updateHistory],
  );

  // The bandwidth schedule only applies in Advanced mode, like the other advanced options.
  const usableRules = useMemo(() => settings.schedule.filter((rule) => validateRule(rule) === null), [settings.schedule]);
  const schedule = useSchedule(usableRules, advanced);
  const policy = useMemo(() => ({ blocked: schedule.paused, limit: schedule.limit }), [schedule.paused, schedule.limit]);
  const limits = useMemo(() => (advanced ? { retries: settings.autoRetries, perSite: settings.perSiteLimit } : { retries: 0, perSite: 0 }), [advanced, settings.autoRetries, settings.perSiteLimit]);

  const { items, enqueue, runNext, runLater, reorder, setRateLimit, cancel, pause, resume, pauseAll, resumeAll, retry, remove, clearFinished, restore, hasActive } = useDownloads(
    advanced ? settings.concurrency : 2,
    handleCompleted,
    policy,
    limits,
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useQueuePersistence(items, queueLoaded);

  const flow = useSearchFlow({ settings, settingsLoaded, settingsRef, engineReady: !!engine?.ready, setPage });
  useAutoClear(flow.batchNotice, flow.setBatchNotice, 7000);

  const files = useFinishedFiles({
    settings,
    outDir: effectiveOutDir,
    settingsLoaded,
    queueLoaded,
    page,
    history,
    historyRef,
    updateHistory,
    confirm,
    showFlash,
    announce: setNote,
  });
  const { existing, sizes, recheck, openDownloaded, revealDownloaded, mover, cleaner, deleteDownloaded } = files;

  // The music library: what was found last time, then what has changed since.
  const library = useLibrary({ ready: files.ready, historyCount: history.length, historyKey: history.map((h) => `${h.path}:${h.timestamp}`).join("\n"), showFlash });
  useLoudness({ engine: player, enabled: settings.levelVolume, tracks: library.tracks, measure: library.measure });

  const copyText = useCallback(
    (text: string, what: string) => {
      navigator.clipboard
        ?.writeText(text)
        .then(() => setNote({ title: `${what} copied`, subtitle: text }))
        .catch(() => showFlash("Couldn't copy to the clipboard.", true));
    },
    [showFlash],
  );
  const copyPath = useCallback((path: string) => copyText(path, "File location"), [copyText]);

  const actions = useDownloadActions({
    settings,
    settingsRef,
    outDir: effectiveOutDir,
    itemsRef,
    enqueue,
    confirm,
    history,
    historyRef,
    existing,
    openDownloaded,
    showFlash,
    announce: setNote,
    setPage,
    setErrorMessage: flow.setErrorMessage,
    media: flow.media,
    search: flow.search,
    checked: flow.checked,
    setChecked: flow.setChecked,
    setBatchNotice: flow.setBatchNotice,
  });

  const podcastsReady = FEATURES.podcasts && files.ready && !!engine?.ready;
  const podcasts = usePodcasts({ ready: podcastsReady, outDir: effectiveOutDir, submitDownloads: actions.submitDownloads, showFlash });

  // Unfinished downloads left in the download folder, looked for once when nothing is running.
  const leftovers = useLeftovers({
    ready: files.ready,
    idle: restoredCount === 0 && items.every((i) => isFinishedStatus(i.status)),
    showFlash,
    announce: setNote,
    submitDownloads: actions.submitDownloads,
  });

  // The player and the audio converter, opened from the buttons on downloaded files and on a video's card.
  const mediaDialogs = useMediaDialogs({
    showFlash,
    announce: setNote,
    openDownloaded,
    player,
    askLyricsConsent: ensureLyricsConsent,
    onConverted: (from, to) => {
      const original = historyRef.current.find((h) => h.path === from);
      if (original) updateHistory([{ ...original, id: `${original.id}-${Date.now().toString(36)}`, path: to, preset: "audio", timestamp: Date.now(), flag: undefined, transferred: undefined }, ...historyRef.current]);
      recheck();
    },
  });

  // The browser's own right-click menu (Reload, Inspect...) makes no sense in an app window. Keep it only where
  // it's useful: text fields and selectable text. Our own menus handle the rest.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("input, textarea, .selectable")) e.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // ---- startup ----
  useEffect(() => {
    (async () => {
      const [s, h, q] = await Promise.all([loadSettings(), loadHistory(), loadQueue()]);
      applyLoaded(s);
      setHistory(h);
      if (q.length > 0) {
        restore(q);
        setRestoredCount(q.filter((d) => d.status !== "error" && d.status !== "cancelled").length);
      }
      setQueueLoaded(true);
    })();
    defaultDownloadDir().then(setDefaultDir).catch((e) => console.warn(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setView = useCallback(
    (key: "viewSearch" | "viewQueue" | "viewHistory") => (view: ViewMode) => changeSettings({ [key]: view }),
    [changeSettings],
  );

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

  const savePreset = (preset: Omit<FormatPreset, "id">): string | null => {
    const problem = checkPresetName(preset.name, settings.presets);
    if (problem) return problem;
    changeSettings({ presets: [...settings.presets, { ...preset, name: preset.name.trim(), id: presetId() }] });
    setNote({ title: "Preset saved", subtitle: preset.name.trim() });
    return null;
  };

  // ---- derived ----
  const activeDownloads = items.filter((i) => i.status === "downloading" || i.status === "processing");
  const queuedCount = items.filter((i) => i.status === "queued").length;
  const pausedCount = items.filter((i) => i.status === "paused").length;
  const busyCount = activeDownloads.length + queuedCount;
  const finishedCount = items.filter((i) => isFinishedStatus(i.status)).length;
  const { url, search, media, checked } = flow;
  const visibleMedia = media && media.url === url.trim() ? media.info : null;

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
    playing: playerState.playing,
    onPlayer: (action) => (action === "toggle" ? player.toggle() : action === "next" ? player.next() : player.previous()),
  });
  const dragging = useDropLinks({
    onLink: flow.submitLink,
    onLinks: flow.showLinks,
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
    selectAll: () => flow.toggleAll(true),
    clearSelection: () => flow.setChecked(new Set()),
    downloadOpenVideo: (asAudio) => void actions.downloadCurrent({ preset: asAudio ? "audio" : "best", formatId: null, clip: null, estimate: null, subs: defaultSubs(settings), meta: null, cover: null, lyrics: null, audio: null }),
    togglePauseAll: () => (pausedCount > 0 ? resumeAll() : pauseAll()),
    openDownloadFolder: () => openFolder(effectiveOutDir).catch((err) => showFlash(errorText(err), true)),
    playerToggle: () => player.toggle(),
    playerNext: () => player.next(),
    playerPrevious: () => player.previous(),
    openLatest: () => {
      const latest = history.filter((h) => h.path && existing[h.path] !== false).sort((a, b) => b.timestamp - a.timestamp)[0];
      if (latest?.path) openDownloaded(latest.path);
      else showFlash("There's no finished download to play yet.", true);
    },
  });

  // ---- gates: screens that appear before the main window still need the app's own title bar ----
  const gate = (body: React.ReactNode) => (
    <div className="app">
      <TitleBar />
      <div className="flex-1 min-h-0 overflow-auto" style={{ background: "var(--paper)" }}>
        {body}
      </div>
    </div>
  );

  if (setup.setupError) {
    return gate(
      <div className="empty" style={{ minHeight: "100%" }}>
        <AlertCircle className="w-10 h-10" style={{ color: "#b3261e" }} />
        <h2>Kaisu couldn't start</h2>
        <p className="m-0 selectable break-words max-w-md">{setup.setupError}</p>
      </div>,
    );
  }
  if (!setup.setupInfo) {
    return gate(
      <div className="empty" style={{ minHeight: "100%" }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#2f66bf" }} />
      </div>,
    );
  }
  if (setup.needsSetup) {
    return gate(
      <SetupScreen
        info={setup.setupInfo}
        proxy={settings.proxy}
        onProxy={(proxy) => changeSettings({ proxy })}
        onRecheck={() => checkSetup().then(setup.setSetupInfo)}
        onDone={(next) => {
          setup.setEngine(next);
          // Setup just fetched the latest yt-dlp; no need to check again right away.
          changeSettings({ lastEngineCheck: Date.now() });
          setup.setSetupRequested(false);
          if (next.ready) setup.setSetupSkipped(false);
        }}
        onSkip={() => {
          setup.setSetupSkipped(true);
          setup.setSetupRequested(false);
        }}
      />,
    );
  }

  const lcd = lcdState({
    searching: flow.searching,
    loadingMore: flow.loadingMore,
    busyWhat: flow.busyWhat,
    loadingInfo: flow.loadingInfo,
    sourceName,
    query: search?.query ?? url.trim(),
    url: url.trim(),
    note,
    activeDownloads,
    queuedCount,
    pausedCount,
    schedulePaused: schedule.paused,
    engine,
  });

  const viewKey = page === "search" ? "viewSearch" : page === "downloads" ? "viewQueue" : "viewHistory";
  const viewOptions = page === "search" ? SEARCH_VIEWS : page === "downloads" ? QUEUE_VIEWS : HISTORY_VIEWS;
  const currentView = effectiveView(settings[viewKey], viewOptions);
  const engineDot = setup.engineState.kind === "updating" || (engine && !engine.ready) ? "warn" : "";

  const statusCenter =
    page === "search"
      ? search
        ? `${search.items.length} result${search.items.length === 1 ? "" : "s"}${checked.size ? `, ${checked.size} selected` : ""}`
        : visibleMedia
          ? "1 video"
          : ""
      : page === "downloads"
        ? `${items.length} download${items.length === 1 ? "" : "s"}${activeDownloads.length ? `, ${activeDownloads.length} active` : ""}`
        : page === "library"
          ? `${library.tracks.length} song${library.tracks.length === 1 ? "" : "s"}`
          : page === "history"
            ? `${historyStats.count === history.length ? history.length : `${historyStats.count} of ${history.length}`} item${history.length === 1 ? "" : "s"}${historyStats.bytes > 0 ? `, ${formatBytes(historyStats.bytes)}` : ""}`
          : "";

  const changeSource = (next: SearchSource) => {
    changeSettings({ searchSource: next });
    // Showing search results? Search the same words on the new site.
    if (search?.kind === "search" && search.query) {
      flow.setMedia(null);
      flow.runSearch(search.query, SEARCH_PAGE_SIZE);
    }
  };

  return (
    <MusicPreferencesContext.Provider value={musicPreferences}>
    <PlayerContext.Provider value={player}>
    <MediaActionsContext.Provider value={mediaDialogs.actions}>
    {mini.mini ? <MiniPlayer engine={player} onRestore={() => void mini.change(false)} busy={mini.busy} error={flash?.error ? flash.text : undefined} /> : <>
    <div className="app">
      <Toolbar
        title={page === "settings" ? "Settings" : page === "library" ? "Library" : page === "podcasts" ? "Podcasts" : null}
        view={currentView}
        viewOptions={viewOptions}
        onView={setView(viewKey)}
        lcd={lcd}
        source={source}
        onSource={changeSource}
        sourceName={sourceName}
        value={url}
        onChange={flow.setUrl}
        onSubmit={flow.handleSubmit}
        inputRef={searchInput}
        busy={flow.searching || flow.loadingInfo}
      />

      <AppBanners
        toolsMissing={!!engine && !engine.ready}
        onFixTools={() => setup.setSetupRequested(true)}
        countdown={countdown}
        onCancelCountdown={cancelCountdown}
        restored={
          restoredCount > 0 && pausedCount > 0
            ? {
                count: restoredCount,
                onResume: () => {
                  resumeAll();
                  setRestoredCount(0);
                },
                onRemove: () => {
                  items.filter((i) => i.status === "paused").forEach((i) => cancel(i.id));
                  clearFinished();
                  setRestoredCount(0);
                },
                onLater: () => setRestoredCount(0),
              }
            : null
        }
        clipboard={
          clipboard.offer && clipboard.offer !== url.trim()
            ? {
                link: clipboard.offer,
                onLookUp: () => {
                  const link = clipboard.offer;
                  clipboard.dismiss();
                  if (link) flow.submitLink(link);
                },
                onDismiss: clipboard.dismiss,
              }
            : null
        }
        flash={flash}
        onDismissFlash={() => setFlash(null)}
        leftovers={
          leftovers.found.length > 0
            ? {
                count: leftovers.found.length,
                bytes: leftovers.bytes,
                resumable: leftovers.resumable,
                onResume: (kind) => void leftovers.resume(kind),
                onClear: async () => {
                  const answer = await confirm.ask({
                    title: "Delete unfinished downloads?",
                    body: (
                      <p className="m-0">
                        {leftovers.found.length} half-finished file{leftovers.found.length === 1 ? "" : "s"} ({formatBytes(leftovers.bytes)}) will be deleted from your download folder. The videos themselves can be downloaded again.
                      </p>
                    ),
                    buttons: [
                      { id: "cancel", label: "Cancel", primary: true },
                      { id: "delete", label: "Delete them" },
                    ],
                    cancelId: "cancel",
                  });
                  if (answer === "delete") void leftovers.clear();
                },
                onLater: leftovers.dismiss,
              }
            : null
        }
      />

      <div className="app-body">
        <Sidebar
          page={page}
          onNavigate={setPage}
          active={activeDownloads.length}
          total={items.length}
          historyCount={history.length}
          songCount={library.tracks.length}
          art={{ src: visibleMedia?.thumbnail ?? null, caption: visibleMedia?.title ?? "No video selected" }}
        />

        <main className="content" aria-label={page}>
          {FEATURES.podcasts && page === "podcasts" && <PodcastsPage api={podcasts} ready={podcastsReady} />}
          {page === "search" && (
            <SearchPage
              flow={flow}
              actions={actions}
              settings={settings}
              visibleMedia={visibleMedia}
              history={history}
              existing={existing}
              setPage={setPage}
              openDownloaded={openDownloaded}
              revealDownloaded={revealDownloaded}
              copyText={copyText}
              showFlash={showFlash}
              ensureLyricsConsent={ensureLyricsConsent}
              savePreset={savePreset}
            />
          )}

          {page === "downloads" && (
            <DownloadsPage
              items={items}
              mode={mode}
              view={settings.viewQueue}
              onCancel={cancel}
              onPause={pause}
              onResume={resume}
              onRetry={retry}
              onRunNext={runNext}
              onRunLater={runLater}
              onReorder={reorder}
              onSetRateLimit={setRateLimit}
              onRemove={remove}
              onOpen={openDownloaded}
              onReveal={revealDownloaded}
              onCopyPath={copyPath}
              onDeleteFile={deleteDownloaded}
            />
          )}

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
              audioLabel={advanced ? settings.audioFormat.toUpperCase() : "MP3"}
              onOpen={openDownloaded}
              onReveal={revealDownloaded}
              onCopyPath={copyPath}
              onDeleteFile={deleteDownloaded}
              onRemove={(id) => updateHistory(history.filter((h) => h.id !== id))}
              onRemoveMany={(ids) => {
                const gone = new Set(ids);
                updateHistory(history.filter((h) => !gone.has(h.id)));
              }}
              onClear={() => updateHistory([])}
              onDownloadAgainMany={actions.downloadAgainMany}
              onExport={exportHistory}
              onRecheck={recheck}
              onDownloadAgain={(item, preset) => actions.queueDownload(item.url, item.title, item.thumbnail, preset, null, null, item.channel)}
              onShownChange={(count, bytes) => setHistoryStats((prev) => (prev.count === count && prev.bytes === bytes ? prev : { count, bytes }))}
            />
          )}

          {page === "library" && <LibraryPage tracks={library.tracks} management={library.management} listening={listening.stats} onRelocated={(from, to) => { listening.relocate(from, to); musicPreferences.relocate(from, to); player.replacePath(from, to); updateHistory(historyRef.current.map((h) => h.path === from ? { ...h, path: to } : h)); }} unmeasuredCount={library.unmeasuredCount} scanning={library.scanning} loaded={library.loaded} onScan={() => void library.scan()} onReveal={revealDownloaded} onEditTags={async (paths, edit) => { const release = player.releaseFiles(paths); try { const results = await library.editTags(paths, edit); if (edit.artwork) player.invalidateCovers(results.filter((r) => r.ok).map((r) => r.path)); return results; } finally { release(); } }} analysing={library.analysing} onAnalyse={() => void library.analyse()} onStopAnalysing={library.stopAnalysing} announce={setNote} flash={showFlash} />}

          {page === "settings" && (
            <SettingsPage
              settings={settings}
              effectiveOutDir={effectiveOutDir}
              engine={engine}
              engineState={setup.engineState}
              onChange={changeSettingsGuarded}
              moveStatus={{ pending: mover.pending.length, destination: mover.destination, moving: mover.moving, moveNow: mover.moveNow }}
              cleanup={{ count: cleaner.candidates.length, bytes: cleaner.bytes, running: cleaner.running, cleanNow: cleaner.cleanNow }}
              onCheckUpdate={() =>
                hasActive ? setup.setEngineState({ kind: "message", text: "Wait for downloads to finish before updating", error: true }) : setup.checkForUpdate(false)
              }
              onOpenSetup={() => setup.setSetupRequested(true)}
              onRevealEngine={() => revealEngine().catch((e) => showFlash(errorText(e), true))}
              onShowShortcuts={() => setShortcutsOpen(true)}
              onShowTour={() => setTourOpen(true)}
              scheduleState={schedule}
              trayAvailable={trayOk}
            />
          )}
        </main>
      </div>

      {playerState.queue.length > 0 && <PlayerBar engine={player} onMini={() => void mini.change(true)} miniBusy={mini.busy} />}

      <StatusBar
        left={
          advanced && engine ? (
            <button className="row-btn" onClick={() => setPage("settings")} title={engine.ytdlp.source ? `yt-dlp source: ${engine.ytdlp.source}. Open settings` : "Open settings"}>
              <span className={`dot ${engineDot}`} />
              {setup.engineState.kind === "updating" ? "Updating engine…" : engine.ytdlp.version ? `yt-dlp ${engine.ytdlp.version}` : "Engine"}
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
      {mediaDialogs.dialogs}
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
    </>}
    </MediaActionsContext.Provider>
    </PlayerContext.Provider>
    </MusicPreferencesContext.Provider>
  );
}
