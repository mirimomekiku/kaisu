import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, Download as DownloadIcon, Film, History as HistoryIcon, RefreshCw, RotateCcw, Search, Trash2 } from "lucide-react";
import type { Preset } from "../lib/api";
import { PRESET_LABEL, formatBytes } from "../lib/format";
import { sortHistory, type HistoryRow, type HistorySort } from "../lib/history";
import type { HistoryItem, ViewMode } from "../lib/storage";
import ChoicePicker from "./ChoicePicker";
import FileActions from "./FileActions";
import Picture from "./Picture";

export const HISTORY_VIEWS: ViewMode[] = ["details", "list", "grid", "compact"];

const SORT_LABEL: Record<HistorySort, string> = { date: "Date", title: "Name", channel: "Channel", format: "Format", size: "Size" };

interface Props {
  items: HistoryItem[];
  /** Whether each downloaded file still exists, keyed by path. Missing keys are still being checked. */
  exists: Record<string, boolean>;
  /** File sizes in bytes, keyed by path (only for files that exist). */
  sizes: Record<string, number>;
  view: ViewMode;
  sort: HistorySort;
  sortDesc: boolean;
  onSortChange: (sort: HistorySort, descending: boolean) => void;
  advanced: boolean;
  audioLabel: string;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
  onCopyPath: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onRemove: (id: string) => void;
  onRemoveMany: (ids: string[]) => void;
  onClear: () => void;
  onDownloadAgain: (item: HistoryItem, preset: Preset) => void;
  onDownloadAgainMany: (items: HistoryItem[]) => void;
  onExport: (rows: HistoryRow[], format: "csv" | "json") => void;
  onRecheck: () => void;
  /** Reports how many items match the current filter and their total size, for the status bar. */
  onShownChange?: (count: number, bytes: number) => void;
}

type KindFilter = "all" | "video" | "audio";
type FileFilter = "all" | "present" | "missing";

export default function HistoryView(p: Props) {
  const view = HISTORY_VIEWS.includes(p.view) ? p.view : "details";
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [files, setFiles] = useState<FileFilter>("all");
  const [again, setAgain] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const rows: HistoryRow[] = useMemo(
    () =>
      p.items.map((item) => ({
        item,
        exists: item.path ? p.exists[item.path] : false,
        size: item.path ? p.sizes[item.path] : undefined,
      })),
    [p.items, p.exists, p.sizes],
  );

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matching = rows.filter(
      ({ item, exists }) =>
        (kind === "all" || (kind === "audio") === (item.preset === "audio")) &&
        (files === "all" || (files === "missing" ? exists === false : exists === true)) &&
        (!needle || item.title.toLowerCase().includes(needle) || (item.channel ?? "").toLowerCase().includes(needle)),
    );
    return sortHistory(matching, p.sort, p.sortDesc);
  }, [rows, filter, kind, files, p.sort, p.sortDesc]);

  const missing = rows.filter((r) => r.exists === false && r.item.path).length;
  const shownCount = shown.length;
  const shownBytes = shown.reduce((sum, r) => sum + (r.size ?? 0), 0);
  const { onShownChange } = p;
  useEffect(() => onShownChange?.(shownCount, shownBytes), [onShownChange, shownCount, shownBytes]);

  // Forget selected items that no longer exist (removed, or filtered out of the list).
  useEffect(() => {
    const visible = new Set(shown.map((r) => r.item.id));
    setPicked((prev) => {
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [shown]);

  const pickedRows = shown.filter((r) => picked.has(r.item.id));
  const allPicked = shown.length > 0 && pickedRows.length === shown.length;
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(shown.map((r) => r.item.id)));

  const when = (h: HistoryItem) => new Date(h.timestamp).toLocaleString();
  const day = (h: HistoryItem) => new Date(h.timestamp).toLocaleDateString();
  const label = (h: HistoryItem) => PRESET_LABEL[h.preset] ?? h.preset;
  const sizeOf = (h: HistoryItem) => (h.path && p.sizes[h.path] !== undefined ? formatBytes(p.sizes[h.path]) : "");

  const file = (h: HistoryItem, iconOnly: boolean, openLabelled = false) => (
    <FileActions path={h.path} exists={h.path ? p.exists[h.path] : undefined} onOpen={p.onOpen} onReveal={p.onReveal} onCopyPath={p.onCopyPath} onDelete={p.onDeleteFile} iconOnly={iconOnly} openLabelled={openLabelled} />
  );

  const flagged = (h: HistoryItem) =>
    h.flag ? (
      <span className="shrink-0" title={h.flag} aria-label={`Check this file: ${h.flag}`} style={{ color: "#a56a00" }}>
        <AlertTriangle className="w-3 h-3" />
      </span>
    ) : null;

  const check = (h: HistoryItem) => (
    <input type="checkbox" checked={picked.has(h.id)} onChange={() => toggle(h.id)} aria-label={`Select "${h.title}"`} className="shrink-0" />
  );

  const againToggle = (h: HistoryItem, withLabel: boolean) => (
    <button
      type="button"
      aria-expanded={again === h.id}
      aria-label={`Download "${h.title}" again`}
      title="Download again"
      onClick={() => setAgain(again === h.id ? null : h.id)}
      className={withLabel ? "btn small" : "row-btn"}
    >
      <RotateCcw className="w-3 h-3" />
      {withLabel && "Download again"}
      <ChevronDown className="w-3 h-3" style={{ transform: again === h.id ? "rotate(180deg)" : undefined }} />
    </button>
  );

  const remove = (h: HistoryItem) => (
    <button type="button" className="row-btn" title="Remove from history" aria-label={`Remove "${h.title}" from history`} onClick={() => p.onRemove(h.id)}>
      <Trash2 className="w-3 h-3" />
    </button>
  );

  const chooser = (h: HistoryItem) =>
    again === h.id && (
      <div className="pt-2">
        <ChoicePicker
          advanced={p.advanced}
          audioLabel={p.audioLabel}
          onChoose={(preset) => {
            setAgain(null);
            p.onDownloadAgain(h, preset);
          }}
        />
      </div>
    );

  const thumb = (h: HistoryItem, cls: string) => (
    <div className={`thumb ${cls}`}><Picture url={h.thumbnail} fallback={<Film className="w-3.5 h-3.5" />} /></div>
  );

  const sortBy = (by: HistorySort) => p.onSortChange(by, p.sort === by ? !p.sortDesc : by === "date" || by === "size");
  const header = (by: HistorySort, className = "", text = SORT_LABEL[by]) => (
    <th className={className} aria-sort={p.sort === by ? (p.sortDesc ? "descending" : "ascending") : "none"}>
      <button type="button" className="name-btn font-bold inline-flex items-center gap-1" onClick={() => sortBy(by)} title={`Sort by ${text.toLowerCase()}`}>
        {text}
        {p.sort === by && (p.sortDesc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
      </button>
    </th>
  );

  const table = (
    <table className="itable">
      <thead>
        <tr>
          <th className="fit">
            <input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="Select all shown" />
          </th>
          {header("title", "", "Name")}
          {header("channel", "hidden lg:table-cell")}
          {header("format", "hidden sm:table-cell fit")}
          {header("size", "hidden md:table-cell fit")}
          {header("date", "hidden md:table-cell fit", "Downloaded")}
          <th className="fit" aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {shown.map(({ item: h }) => (
          <Fragment key={h.id}>
            <tr aria-selected={picked.has(h.id)}>
              <td className="fit">{check(h)}</td>
              <td>
                <div className="flex items-center gap-2 min-w-0">
                  {thumb(h, "w-[34px] aspect-video !shadow-none")}
                  <span className="truncate" title={h.title}>
                    {h.title}
                  </span>
                  {flagged(h)}
                </div>
              </td>
              <td className="hidden lg:table-cell dim truncate">{h.channel ?? ""}</td>
              <td className="hidden sm:table-cell fit dim">{label(h)}</td>
              <td className="hidden md:table-cell fit dim">{sizeOf(h)}</td>
              <td className="hidden md:table-cell fit dim">{when(h)}</td>
              <td className="fit">
                <span className="inline-flex items-center gap-0.5">
                  {file(h, true, true)}
                  {againToggle(h, false)}
                  {remove(h)}
                </span>
              </td>
            </tr>
            {again === h.id && (
              <tr style={{ background: "#f6f8fc" }}>
                <td colSpan={7} style={{ maxWidth: "none", height: "auto", padding: "6px 10px 8px" }}>
                  {chooser(h)}
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );

  const details = (h: HistoryItem) => [label(h), h.channel, sizeOf(h)].filter(Boolean).join(" · ");

  const renderItem = ({ item: h }: HistoryRow) => {
    if (view === "grid") {
      return (
        <li key={h.id} className="row-card overflow-hidden flex flex-col">
          {thumb(h, "w-full aspect-video !border-0 !shadow-none")}
          <div className="p-2 flex flex-col gap-1.5 min-w-0">
            <div className="flex items-start gap-1.5">
              {check(h)}
              <div className="font-bold line-clamp-2 leading-snug" title={h.title}>
                {h.title}
              </div>
            </div>
            <div className="dim truncate">
              {details(h)} · {day(h)}
            </div>
            <div className="flex items-center justify-between gap-1 flex-wrap">
              {file(h, true)}
              <span className="inline-flex items-center gap-0.5">
                {againToggle(h, false)}
                {remove(h)}
              </span>
            </div>
            {chooser(h)}
          </div>
        </li>
      );
    }

    if (view === "compact") {
      return (
        <li key={h.id} className="row-card zebra px-2 py-1 flex flex-col">
          <div className="flex items-center gap-2.5">
            {check(h)}
            {thumb(h, "w-10 aspect-video")}
            <span className="flex-1 min-w-0 truncate" title={h.title}>
              {h.title}
            </span>
            <span className="hidden sm:block dim shrink-0">{label(h)}</span>
            <span className="hidden md:block dim shrink-0 w-16 text-right">{sizeOf(h)}</span>
            <span className="hidden md:block dim shrink-0 w-24 text-right">{day(h)}</span>
            <span className="inline-flex items-center gap-0.5 shrink-0">
              {file(h, true)}
              {againToggle(h, false)}
              {remove(h)}
            </span>
          </div>
          {chooser(h)}
        </li>
      );
    }

    return (
      <li key={h.id} className="row-card zebra p-2 flex flex-col">
        <div className="flex items-center gap-3">
          {check(h)}
          {thumb(h, "w-24 aspect-video")}
          <div className="min-w-0 flex-1">
            <div className="font-bold truncate flex items-center gap-1.5" title={h.title}>
              <span className="truncate">{h.title}</span>
              {flagged(h)}
            </div>
            <div className="dim truncate">
              {details(h)} · {when(h)}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            {file(h, false)}
            {againToggle(h, true)}
            {remove(h)}
          </div>
        </div>
        {chooser(h)}
      </li>
    );
  };

  if (p.items.length === 0) {
    return (
      <div className="empty" style={{ minHeight: 320 }}>
        <HistoryIcon className="big w-12 h-12" strokeWidth={1.25} />
        <h2>No downloads yet</h2>
        <p className="m-0">Finished downloads are saved here, so you can open them again later.</p>
      </div>
    );
  }

  const exportRows = pickedRows.length > 0 ? pickedRows : shown;
  const bar = { background: "linear-gradient(#f6f6f6,#e6e6e6)", borderBottom: "1px solid #b4b4b4" };

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center gap-3 flex-wrap px-3 py-1.5" style={bar}>
        <label className="searchfield" style={{ width: 220 }}>
          <span className="lead">
            <Search className="w-3 h-3" />
          </span>
          <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter history" aria-label="Filter history" />
        </label>
        <div className="seg small" role="radiogroup" aria-label="Show">
          {(["all", "video", "audio"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className="capitalize">
              {k}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1">
          Files
          <select value={files} onChange={(e) => setFiles(e.target.value as FileFilter)} className="field" style={{ height: 20, fontSize: 11 }} aria-label="Files">
            <option value="all">any</option>
            <option value="present">still there</option>
            <option value="missing">missing</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          Sort
          <select value={p.sort} onChange={(e) => p.onSortChange(e.target.value as HistorySort, p.sortDesc)} className="field" style={{ height: 20, fontSize: 11 }} aria-label="Sort by">
            {(Object.keys(SORT_LABEL) as HistorySort[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
          <button type="button" className="row-btn" aria-label={p.sortDesc ? "Sorted descending" : "Sorted ascending"} title="Reverse the order" onClick={() => p.onSortChange(p.sort, !p.sortDesc)}>
            {p.sortDesc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />}
          </button>
        </label>
        <div className="flex-1" />
        <button onClick={p.onRecheck} className="btn small" title="Look again at which files still exist">
          <RefreshCw className="w-3 h-3" /> Check files
        </button>
        {missing > 0 && (
          <button onClick={() => p.onRemoveMany(rows.filter((r) => r.exists === false && r.item.path).map((r) => r.item.id))} className="btn small">
            Remove {missing} missing
          </button>
        )}
        <button onClick={() => p.onExport(exportRows, "csv")} className="btn small" disabled={exportRows.length === 0} title={pickedRows.length > 0 ? "Export the selected items" : "Export the items shown"}>
          Export CSV
        </button>
        <button onClick={() => p.onExport(exportRows, "json")} className="btn small" disabled={exportRows.length === 0}>
          Export JSON
        </button>
        <button onClick={p.onClear} className="btn small">
          <Trash2 className="w-3 h-3" /> Clear History
        </button>
      </div>

      {pickedRows.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap px-3 py-1" role="toolbar" aria-label="Selected items" style={{ ...bar, background: "#e8eef9" }}>
          <b>{pickedRows.length} selected</b>
          <button className="btn small" onClick={() => p.onDownloadAgainMany(pickedRows.map((r) => r.item))}>
            <DownloadIcon className="w-3 h-3" /> Download again
          </button>
          <button
            className="btn small"
            onClick={() => {
              p.onRemoveMany(pickedRows.map((r) => r.item.id));
              setPicked(new Set());
            }}
          >
            <Trash2 className="w-3 h-3" /> Remove from history
          </button>
          <button className="btn small" onClick={() => setPicked(new Set())}>
            Select none
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty">
          <h2>No matches</h2>
          <p className="m-0">Nothing in your history matches that filter.</p>
        </div>
      ) : view === "details" ? (
        table
      ) : (
        <>
          <label className="flex items-center gap-2 px-3 pt-2 w-fit">
            <input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="Select all shown" />
            Select all shown
          </label>
          <ul className={`m-0 list-none p-3 ${view === "grid" ? "grid grid-cols-2 lg:grid-cols-3 gap-3" : view === "compact" ? "flex flex-col gap-1" : "flex flex-col gap-1.5"}`}>
            {shown.map(renderItem)}
          </ul>
        </>
      )}
    </div>
  );
}
