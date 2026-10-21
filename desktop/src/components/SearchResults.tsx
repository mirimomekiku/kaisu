import { useRef, useState } from "react";
import { CheckCircle2, Film, Loader2, Music, Radio, Video, X } from "lucide-react";
import type { Preset, SearchResult } from "../lib/api";
import { formatCount, formatDuration } from "../lib/format";
import type { ViewMode } from "../lib/storage";
import ContextMenu, { type MenuEntry } from "./ContextMenu";
import Picture from "./Picture";

export const SEARCH_VIEWS: ViewMode[] = ["details", "list", "grid", "compact"];
export type BatchQuality = "best" | "p1080" | "p720";

interface Props {
  query: string;
  /** Replaces "Results for ..." (playlists, channels, a list of links). */
  heading?: string;
  /** e.g. "Showing the first 200 of 1,240 videos." */
  limitNote?: string | null;
  /** Shown for playlists and channels: download everything listed, no ticking needed. */
  onDownloadAll?: (kind: "video" | "audio") => void;
  results: SearchResult[];
  view: ViewMode;
  /** The result whose details are currently open. */
  openUrl: string | null;
  /** URLs ticked for a batch download. */
  checked: Set<string>;
  /** URLs already in the download history. */
  downloadedUrls: Set<string>;
  loadingMore: boolean;
  canLoadMore: boolean;
  advanced: boolean;
  audioLabel: string;
  /** Short confirmation shown after a batch was queued. */
  notice: string | null;
  onOpen: (result: SearchResult) => void;
  onToggle: (url: string) => void;
  onToggleAll: (all: boolean) => void;
  onLoadMore: () => void;
  onDownloadChecked: (kind: "video" | "audio", quality: BatchQuality) => void;
  // right-click menu actions
  onDownloadOne: (result: SearchResult, preset: Preset) => void;
  onCopy: (text: string, what: string) => void;
  onOpenInBrowser: (url: string) => void;
  onSearchFor: (query: string) => void;
  /** The newest downloaded file for this video, if any. */
  downloadedFile: (url: string) => { path: string; exists: boolean | undefined } | null;
  onOpenFile: (path: string) => void;
  onRevealFile: (path: string) => void;
}

function Art({ r, downloaded, cls }: { r: SearchResult; downloaded: boolean; cls: string }) {
  return (
    <div className={`thumb ${cls}`}>
      <Picture url={r.thumbnail} fallback={<Film className="w-4 h-4" />} />
      {r.live ? (
        <span className="tag live inline-flex items-center gap-1">
          <Radio className="w-2.5 h-2.5" /> LIVE
        </span>
      ) : (
        r.duration_secs != null && <span className="tag">{formatDuration(r.duration_secs)}</span>
      )}
      {downloaded && (
        <span className="tag top inline-flex items-center gap-1">
          <CheckCircle2 className="w-2.5 h-2.5" /> Downloaded
        </span>
      )}
    </div>
  );
}

export default function SearchResults(p: Props) {
  const view = SEARCH_VIEWS.includes(p.view) ? p.view : "details";
  const [quality, setQuality] = useState<BatchQuality>("best");
  const allChecked = p.results.length > 0 && p.results.every((r) => p.checked.has(r.url));
  const checkedDownloaded = p.results.filter((r) => p.checked.has(r.url) && p.downloadedUrls.has(r.url)).length;
  const n = p.checked.size;
  const [menu, setMenu] = useState<{ x: number; y: number; result: SearchResult | null } | null>(null);

  // On Windows the Menu key also sends a `contextmenu` event (after the key goes up), aimed at the wrong place.
  // Opening from the key already happened, so that follow-up event is ignored.
  const keyOpenedAt = useRef(0);
  const openMenu = (e: React.MouseEvent, result: SearchResult | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button === 0 && Date.now() - keyOpenedAt.current < 600) return;
    setMenu({ x: e.clientX, y: e.clientY, result });
  };
  /** The keyboard way in: the Menu key or Shift+F10 opens the same menu next to the focused row. */
  const menuKey = (result: SearchResult) => (e: React.KeyboardEvent) => {
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      keyOpenedAt.current = Date.now();
      const box = e.currentTarget.getBoundingClientRect();
      setMenu({ x: box.left + 24, y: box.bottom, result });
    }
  };

  const buildMenu = (r: SearchResult | null): MenuEntry[] => {
    const sep: MenuEntry = { kind: "separator" };
    if (!r) {
      return [
        { label: "Select all", disabled: p.results.length === 0 || allChecked, onSelect: () => p.onToggleAll(true) },
        { label: "Deselect all", disabled: n === 0, onSelect: () => p.onToggleAll(false) },
        ...(p.canLoadMore ? [sep, { label: "Show more results", onSelect: p.onLoadMore } as MenuEntry] : []),
      ];
    }
    if (p.checked.has(r.url) && n > 1) {
      return [
        { kind: "heading", label: `${n} selected videos` },
        { label: `Download ${n} videos`, onSelect: () => p.onDownloadChecked("video", "best") },
        { label: `Download ${n} videos (720p)`, onSelect: () => p.onDownloadChecked("video", "p720") },
        { label: `Download ${n} audio (${p.audioLabel})`, onSelect: () => p.onDownloadChecked("audio", "best") },
        sep,
        { label: "Deselect all", onSelect: () => p.onToggleAll(false) },
      ];
    }
    const file = p.downloadedFile(r.url);
    const gone = file?.exists === false;
    return [
      { kind: "heading", label: r.title },
      { label: "Show details", onSelect: () => p.onOpen(r) },
      sep,
      { label: "Download video", disabled: r.live, onSelect: () => p.onDownloadOne(r, "best") },
      { label: "Download video (720p)", disabled: r.live, onSelect: () => p.onDownloadOne(r, "p720") },
      { label: `Download audio (${p.audioLabel})`, disabled: r.live, onSelect: () => p.onDownloadOne(r, "audio") },
      sep,
      { label: p.checked.has(r.url) ? "Deselect" : "Select", onSelect: () => p.onToggle(r.url) },
      ...(file
        ? [
            sep,
            { label: gone ? "Open downloaded file (moved or deleted)" : "Open downloaded file", disabled: gone, onSelect: () => p.onOpenFile(file.path) } as MenuEntry,
            { label: "Show in folder", disabled: gone, onSelect: () => p.onRevealFile(file.path) } as MenuEntry,
          ]
        : []),
      sep,
      { label: "Open in browser", onSelect: () => p.onOpenInBrowser(r.url) },
      { label: "Copy link", onSelect: () => p.onCopy(r.url, "Link") },
      { label: "Copy title", onSelect: () => p.onCopy(r.title, "Title") },
      ...(r.channel ? [sep, { label: `Search “${r.channel}”`, onSelect: () => p.onSearchFor(r.channel as string) } as MenuEntry] : []),
    ];
  };

  const checkbox = (r: SearchResult) => (
    <input type="checkbox" checked={p.checked.has(r.url)} onChange={() => p.onToggle(r.url)} aria-label={`Select ${r.title}`} />
  );

  const nameButton = (r: SearchResult, extra = "") => (
    <button type="button" className={`name-btn ${extra}`} onClick={() => p.onOpen(r)} onKeyDown={menuKey(r)} aria-pressed={r.url === p.openUrl} title={r.title}>
      {r.title}
    </button>
  );

  const meta = (r: SearchResult) => [r.channel, r.view_count != null ? `${formatCount(r.view_count)} views` : null].filter(Boolean).join(" · ");

  // ---- table (iTunes "List" view) ----
  const table = (
    <table className="itable">
      <thead>
        <tr>
          <th className="fit" aria-label="Select" />
          <th>Name</th>
          <th className="hidden sm:table-cell" style={{ width: "22%" }}>
            Channel
          </th>
          <th className="fit" style={{ textAlign: "right" }}>
            Time
          </th>
          <th className="fit hidden md:table-cell" style={{ textAlign: "right" }}>
            Views
          </th>
          <th className="fit hidden md:table-cell">Status</th>
        </tr>
      </thead>
      <tbody>
        {p.results.map((r) => {
          const open = r.url === p.openUrl;
          const done = p.downloadedUrls.has(r.url);
          return (
            <tr key={r.id} className={open ? "sel" : ""} onContextMenu={(e) => openMenu(e, r)}>
              <td className="fit">{checkbox(r)}</td>
              <td>{nameButton(r)}</td>
              <td className={`hidden sm:table-cell ${open ? "" : "dim"}`}>{r.channel}</td>
              <td className="fit num">{r.live ? "LIVE" : formatDuration(r.duration_secs)}</td>
              <td className={`fit num hidden md:table-cell ${open ? "" : "dim"}`}>{r.view_count != null ? formatCount(r.view_count) : ""}</td>
              <td className="fit hidden md:table-cell">{done ? <span style={{ color: open ? "#fff" : "#2f8a2b" }}>✓ Downloaded</span> : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const renderItem = (r: SearchResult) => {
    const open = r.url === p.openUrl;
    const done = p.downloadedUrls.has(r.url);

    if (view === "grid") {
      return (
        <li key={r.id} className={`row-card relative overflow-hidden ${open ? "sel" : ""}`} onContextMenu={(e) => openMenu(e, r)}>
          <div className="absolute top-1.5 left-1.5 z-10 bg-white/85 rounded-[3px] p-[3px] flex border border-black/20">{checkbox(r)}</div>
          <button type="button" onClick={() => p.onOpen(r)} onKeyDown={menuKey(r)} aria-pressed={open} className="w-full text-left flex flex-col border-0 bg-transparent p-0">
            <Art r={r} downloaded={done} cls="w-full aspect-video !border-0 !border-b !shadow-none" />
            <div className="p-2 flex flex-col gap-0.5 min-w-0">
              <div className="font-bold line-clamp-2 leading-snug" title={r.title}>
                {r.title}
              </div>
              <div className="dim truncate">{meta(r)}</div>
            </div>
          </button>
        </li>
      );
    }

    if (view === "compact") {
      return (
        <li key={r.id} className={`row-card zebra flex items-center gap-2.5 px-2 py-1 ${open ? "sel" : ""}`} onContextMenu={(e) => openMenu(e, r)}>
          {checkbox(r)}
          <Art r={r} downloaded={false} cls="w-12 aspect-video" />
          <div className="flex-1 min-w-0">{nameButton(r)}</div>
          <span className="hidden sm:block w-32 truncate dim">{r.channel}</span>
          <span className="w-12 text-right tabular-nums dim">{r.live ? "LIVE" : formatDuration(r.duration_secs)}</span>
          {done && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: "#2f8a2b" }} aria-label="Downloaded" />}
        </li>
      );
    }

    return (
      <li key={r.id} className={`row-card zebra flex items-center gap-3 p-2 ${open ? "sel" : ""}`} onContextMenu={(e) => openMenu(e, r)}>
        {checkbox(r)}
        <Art r={r} downloaded={done} cls="w-36 aspect-video" />
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          {nameButton(r, "!whitespace-normal line-clamp-2 font-bold text-[13px] leading-snug")}
          <div className="dim truncate">{meta(r)}</div>
        </div>
      </li>
    );
  };

  const qualityOptions: Array<[BatchQuality, string]> = [
    ["best", "Best available"],
    ...(p.advanced ? ([["p1080", "1080p"]] as Array<[BatchQuality, string]>) : []),
    ["p720", p.advanced ? "720p" : "Smaller files (720p)"],
  ];

  return (
    <section
      aria-label="Search results"
      className="flex flex-col min-h-0"
      onContextMenu={(e) => {
        if (!(e.target as HTMLElement).closest("tr, li, thead")) openMenu(e, null);
      }}
    >
      <div
        className="flex items-center justify-between gap-3 px-3 py-1.5"
        style={{ background: "linear-gradient(#f6f6f6,#e6e6e6)", borderBottom: "1px solid #b4b4b4" }}
      >
        <h3 className="m-0 text-[12px] font-bold truncate" title={p.heading}>
          {p.heading ?? `Results for “${p.query}”`}
        </h3>
        <div className="flex items-center gap-3 shrink-0">
          {p.onDownloadAll && p.results.length > 0 && (
            <span className="flex items-center gap-1.5">
              <button type="button" className="btn small primary" onClick={() => p.onDownloadAll?.("video")}>
                <Video className="w-3 h-3" /> Download all {p.results.length} videos
              </button>
              <button type="button" className="btn small" onClick={() => p.onDownloadAll?.("audio")}>
                <Music className="w-3 h-3" /> All as audio
              </button>
            </span>
          )}
          {p.results.length > 0 && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={allChecked} onChange={() => p.onToggleAll(!allChecked)} />
              Select all
            </label>
          )}
        </div>
      </div>

      {p.limitNote && <div className="banner">{p.limitNote}</div>}

      {p.notice && (
        <div role="status" className="banner ok">
          <CheckCircle2 className="w-3.5 h-3.5" /> {p.notice}
        </div>
      )}

      {p.results.length === 0 ? (
        <div className="empty">
          <h2>No videos found</h2>
          <p className="m-0">Try different words.</p>
        </div>
      ) : view === "details" ? (
        table
      ) : (
        <ul
          className={`m-0 list-none p-3 ${
            view === "grid" ? "grid grid-cols-2 lg:grid-cols-3 gap-3" : view === "compact" ? "flex flex-col gap-1" : "flex flex-col gap-1.5"
          }`}
        >
          {p.results.map(renderItem)}
        </ul>
      )}

      {p.canLoadMore && p.results.length > 0 && (
        <div className="flex justify-center py-3">
          <button type="button" onClick={p.onLoadMore} disabled={p.loadingMore} className="btn">
            {p.loadingMore && <Loader2 className="w-3 h-3 animate-spin" />}
            Show more results
          </button>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.result ? `Actions for ${menu.result.title}` : "Result list actions"}
          items={buildMenu(menu.result)}
          onClose={() => setMenu(null)}
        />
      )}

      {n > 0 && (
        <div role="region" aria-label="Selected videos" className="selbar">
          <b>
            {n} selected
            {checkedDownloaded > 0 && <span style={{ fontWeight: "normal", opacity: 0.8 }}> · {checkedDownloaded} already downloaded</span>}
          </b>
          <div className="flex-1" />
          <label className="flex items-center gap-1.5">
            Video quality
            <select value={quality} onChange={(e) => setQuality(e.target.value as BatchQuality)} className="field" aria-label="Video quality">
              {qualityOptions.map(([v, text]) => (
                <option key={v} value={v}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => p.onDownloadChecked("video", quality)} className="btn primary small">
            <Video className="w-3 h-3" /> Download {n} video{n > 1 ? "s" : ""}
          </button>
          <button type="button" onClick={() => p.onDownloadChecked("audio", quality)} className="btn small">
            <Music className="w-3 h-3" /> Download {n} audio ({p.audioLabel})
          </button>
          <button type="button" onClick={() => p.onToggleAll(false)} className="btn small icon" title="Clear selection" aria-label="Clear selection">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </section>
  );
}
