import { Fragment, useEffect, useState } from "react";
import { ChevronDown, Film, History as HistoryIcon, RotateCcw, Search, Trash2 } from "lucide-react";
import type { Preset } from "../lib/api";
import { PRESET_LABEL } from "../lib/format";
import type { HistoryItem, ViewMode } from "../lib/storage";
import ChoicePicker from "./ChoicePicker";
import FileActions from "./FileActions";

export const HISTORY_VIEWS: ViewMode[] = ["details", "list", "grid", "compact"];

interface Props {
  items: HistoryItem[];
  /** Whether each downloaded file still exists, keyed by path. Missing keys are still being checked. */
  exists: Record<string, boolean>;
  view: ViewMode;
  advanced: boolean;
  audioLabel: string;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onDownloadAgain: (item: HistoryItem, preset: Preset) => void;
  /** Reports how many items match the current filter, for the status bar. */
  onShownChange?: (count: number) => void;
}

type KindFilter = "all" | "video" | "audio";

export default function HistoryView(p: Props) {
  const view = HISTORY_VIEWS.includes(p.view) ? p.view : "details";
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [again, setAgain] = useState<string | null>(null);

  const shown = p.items.filter(
    (h) =>
      (kind === "all" || (kind === "audio") === (h.preset === "audio")) &&
      (!filter.trim() || h.title.toLowerCase().includes(filter.trim().toLowerCase())),
  );
  const shownCount = shown.length;
  const { onShownChange } = p;
  useEffect(() => onShownChange?.(shownCount), [onShownChange, shownCount]);

  const when = (h: HistoryItem) => new Date(h.timestamp).toLocaleString();
  const day = (h: HistoryItem) => new Date(h.timestamp).toLocaleDateString();
  const label = (h: HistoryItem) => PRESET_LABEL[h.preset] ?? h.preset;

  const file = (h: HistoryItem, iconOnly: boolean, openLabelled = false) => (
    <FileActions path={h.path} exists={h.path ? p.exists[h.path] : undefined} onOpen={p.onOpen} onReveal={p.onReveal} iconOnly={iconOnly} openLabelled={openLabelled} />
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
    <div className={`thumb ${cls}`}>{h.thumbnail ? <img src={h.thumbnail} alt="" referrerPolicy="no-referrer" loading="lazy" /> : <Film className="w-3.5 h-3.5" />}</div>
  );

  const table = (
    <table className="itable">
      <thead>
        <tr>
          <th>Name</th>
          <th className="hidden sm:table-cell fit">Format</th>
          <th className="hidden md:table-cell fit">Downloaded</th>
          <th className="fit" aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {shown.map((h) => (
          <Fragment key={h.id}>
            <tr>
              <td>
                <div className="flex items-center gap-2 min-w-0">
                  {thumb(h, "w-[34px] aspect-video !shadow-none")}
                  <span className="truncate" title={h.title}>
                    {h.title}
                  </span>
                </div>
              </td>
              <td className="hidden sm:table-cell fit dim">{label(h)}</td>
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
                <td colSpan={4} style={{ maxWidth: "none", height: "auto", padding: "6px 10px 8px" }}>
                  {chooser(h)}
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );

  const renderItem = (h: HistoryItem) => {
    if (view === "grid") {
      return (
        <li key={h.id} className="row-card overflow-hidden flex flex-col">
          {thumb(h, "w-full aspect-video !border-0 !shadow-none")}
          <div className="p-2 flex flex-col gap-1.5 min-w-0">
            <div className="font-bold line-clamp-2 leading-snug" title={h.title}>
              {h.title}
            </div>
            <div className="dim">
              {label(h)} · {day(h)}
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
            {thumb(h, "w-10 aspect-video")}
            <span className="flex-1 min-w-0 truncate" title={h.title}>
              {h.title}
            </span>
            <span className="hidden sm:block dim shrink-0">{label(h)}</span>
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
          {thumb(h, "w-24 aspect-video")}
          <div className="min-w-0 flex-1">
            <div className="font-bold truncate" title={h.title}>
              {h.title}
            </div>
            <div className="dim">
              {label(h)} · {when(h)}
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

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center gap-3 flex-wrap px-3 py-1.5" style={{ background: "linear-gradient(#f6f6f6,#e6e6e6)", borderBottom: "1px solid #b4b4b4" }}>
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
        <div className="flex-1" />
        <button onClick={p.onClear} className="btn small">
          <Trash2 className="w-3 h-3" /> Clear History
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <h2>No matches</h2>
          <p className="m-0">Nothing in your history matches that filter.</p>
        </div>
      ) : view === "details" ? (
        table
      ) : (
        <ul className={`m-0 list-none p-3 ${view === "grid" ? "grid grid-cols-2 lg:grid-cols-3 gap-3" : view === "compact" ? "flex flex-col gap-1" : "flex flex-col gap-1.5"}`}>
          {shown.map(renderItem)}
        </ul>
      )}
    </div>
  );
}
