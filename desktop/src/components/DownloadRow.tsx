import { Fragment, useState, type ReactNode } from "react";
import { AlertCircle, Check, Film, Loader2, Pause, Play, RotateCcw, ScrollText, X } from "lucide-react";
import type { DownloadItem } from "../hooks/useDownloads";
import { friendlyError } from "../lib/errors";
import { PRESET_LABEL, formatEta, formatSpeed } from "../lib/format";
import type { Mode, ViewMode } from "../lib/storage";
import FileActions from "./FileActions";

export const QUEUE_VIEWS: ViewMode[] = ["details", "list", "grid", "compact"];

interface Handlers {
  onCancel: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
}

interface Props extends Handlers {
  item: DownloadItem;
  mode: Mode;
  view: ViewMode;
}

const isFinished = (i: DownloadItem) => i.status === "completed" || i.status === "error" || i.status === "cancelled";
const presetLabel = (i: DownloadItem) => (i.preset === "audio" ? `Audio (${i.extra.audio_format.toUpperCase()})` : PRESET_LABEL[i.preset]);

function barClass(i: DownloadItem): string {
  if (i.status === "completed") return "done";
  if (i.status === "processing") return "finishing";
  if (i.status === "error" || i.status === "cancelled" || i.status === "paused") return "idle";
  return "";
}

function Bar({ item }: { item: DownloadItem }) {
  return (
    <div className={`progress ${barClass(item)}`} role="progressbar" aria-valuenow={Math.round(item.progress)} aria-valuemin={0} aria-valuemax={100} aria-label={`Progress for ${item.title}`}>
      <i style={{ width: `${Math.max(item.progress, item.status === "queued" ? 0 : 4)}%` }} />
    </div>
  );
}

/** Short status text for a download, e.g. "6.1 MB/s · 12s left". */
function statusText(item: DownloadItem, advanced: boolean): ReactNode {
  switch (item.status) {
    case "queued":
      return <span className="dim">Waiting…</span>;
    case "paused":
      return <span className="dim">Paused{item.progress > 0 ? ` at ${Math.round(item.progress)}%` : ""}</span>;
    case "downloading":
      return (
        <span className="inline-flex items-center gap-1.5">
          {item.speed == null && <Loader2 className="w-3 h-3 animate-spin" />}
          {advanced ? formatSpeed(item.speed) || `${Math.round(item.progress)}%` : `${Math.round(item.progress)}%`}
          {item.eta != null && <span className="dim">{formatEta(item.eta)}</span>}
        </span>
      );
    case "processing":
      return <span style={{ color: "#a56a00" }}>Finishing up…</span>;
    case "completed":
      return (
        <span className="inline-flex items-center gap-1" style={{ color: "#2f8a2b" }}>
          <Check className="w-3 h-3" /> Done
        </span>
      );
    case "cancelled":
      return <span className="dim">Cancelled</span>;
    case "error":
      return (
        <span className="inline-flex items-center gap-1" style={{ color: "#b3261e" }}>
          <AlertCircle className="w-3 h-3" /> Failed
        </span>
      );
  }
}

function Actions({ item, advanced, iconOnly, showLog, onToggleLog, ...h }: { item: DownloadItem; advanced: boolean; iconOnly: boolean; showLog: boolean; onToggleLog: () => void } & Handlers) {
  const finished = isFinished(item);
  return (
    <span className="inline-flex items-center gap-0.5">
      {advanced && item.log.length > 0 && (
        <button className="row-btn" title={showLog ? "Hide log" : "Show log"} aria-label="Toggle log" onClick={onToggleLog}>
          <ScrollText className="w-3 h-3" />
        </button>
      )}
      {item.status === "completed" && <FileActions path={item.path} exists={undefined} onOpen={h.onOpen} onReveal={h.onReveal} iconOnly={iconOnly} />}
      {(item.status === "error" || item.status === "cancelled") && (
        <button className="row-btn" title="Try again" aria-label="Try again" onClick={() => h.onRetry(item.id)}>
          <RotateCcw className="w-3 h-3" />
        </button>
      )}
      {(item.status === "queued" || item.status === "downloading" || item.status === "processing") && (
        <button className="row-btn" title="Pause" aria-label="Pause download" onClick={() => h.onPause(item.id)}>
          <Pause className="w-3 h-3" />
        </button>
      )}
      {item.status === "paused" && (
        <button className="row-btn" title="Resume" aria-label="Resume download" onClick={() => h.onResume(item.id)}>
          <Play className="w-3 h-3" />
        </button>
      )}
      <button
        className="row-btn"
        title={finished ? "Remove from list" : "Cancel"}
        aria-label={finished ? "Remove from list" : "Cancel download"}
        onClick={() => (finished ? h.onRemove(item.id) : h.onCancel(item.id))}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

/** Error text (plain language in Simple mode) and, in Advanced mode, the log. */
function Detail({ item, advanced, showLog, compactErrors }: { item: DownloadItem; advanced: boolean; showLog: boolean; compactErrors?: boolean }) {
  const [showRaw, setShowRaw] = useState(false);
  const friendly = item.status === "error" && item.errorMsg ? friendlyError(item.errorMsg) : null;
  if (!friendly && !(advanced && showLog) && !(advanced && item.status === "completed" && item.path && !compactErrors)) return null;
  return (
    <div className="flex flex-col gap-1 text-[11px]">
      {advanced && item.status === "completed" && item.path && (
        <div className="mono dim truncate selectable" title={item.path}>
          {item.path}
        </div>
      )}
      {friendly &&
        (advanced ? (
          <div className="whitespace-pre-wrap break-words selectable" style={{ color: "#b3261e" }}>
            {item.errorMsg}
          </div>
        ) : (
          <>
            <div style={{ color: "#b3261e" }}>
              <b>{friendly.summary}</b> {friendly.hint}
            </div>
            <button onClick={() => setShowRaw((v) => !v)} className="link border-0 bg-transparent p-0 w-fit text-[11px]">
              {showRaw ? "Hide" : "Show"} technical details
            </button>
            {showRaw && <div className="mono dim whitespace-pre-wrap break-words selectable">{item.errorMsg}</div>}
          </>
        ))}
      {advanced && showLog && (
        <pre className="m-0 max-h-44 overflow-auto bg-white border border-[#b4b4b4] rounded-[3px] p-2 mono whitespace-pre-wrap break-all" style={{ boxShadow: "inset 0 1px 2px rgba(0,0,0,.15)" }}>
          {item.log.join("\n")}
        </pre>
      )}
    </div>
  );
}

function Thumb({ item, cls }: { item: DownloadItem; cls: string }) {
  return <div className={`thumb ${cls}`}>{item.thumbnail ? <img src={item.thumbnail} alt="" referrerPolicy="no-referrer" /> : <Film className="w-3.5 h-3.5" />}</div>;
}

/** The list / grid / compact layouts for a single download. The table layout is `DownloadTable`. */
export default function DownloadRow({ item, mode, view, ...h }: Props) {
  const advanced = mode === "advanced";
  const [showLog, setShowLog] = useState(false);
  const actions = <Actions item={item} advanced={advanced} iconOnly={view !== "list"} showLog={showLog} onToggleLog={() => setShowLog((v) => !v)} {...h} />;

  if (view === "grid") {
    return (
      <div className="row-card overflow-hidden flex flex-col">
        <div className="relative">
          <Thumb item={item} cls="w-full aspect-video !border-0 !shadow-none" />
          <div className="absolute inset-x-1.5 bottom-1.5">
            <Bar item={item} />
          </div>
        </div>
        <div className="p-2 flex flex-col gap-1 min-w-0">
          <div className="font-bold line-clamp-2 leading-snug" title={item.title}>
            {item.title}
          </div>
          <div className="dim truncate">{presetLabel(item)}</div>
          <div className="flex items-center justify-between gap-2 min-h-[20px]">
            <div>{statusText(item, advanced)}</div>
            {actions}
          </div>
          <Detail item={item} advanced={advanced} showLog={showLog} compactErrors />
        </div>
      </div>
    );
  }

  if (view === "compact") {
    return (
      <div className="row-card zebra px-2 py-1 flex flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <Thumb item={item} cls="w-10 aspect-video" />
          <span className="flex-1 min-w-0 truncate" title={item.title}>
            {item.title}
          </span>
          <span className="hidden sm:inline dim shrink-0">{presetLabel(item)}</span>
          <span className="shrink-0 w-24 text-right">{statusText(item, advanced)}</span>
          {actions}
        </div>
        {!isFinished(item) && <Bar item={item} />}
        {advanced && showLog && <Detail item={item} advanced showLog compactErrors />}
      </div>
    );
  }

  return (
    <div className="row-card zebra p-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <Thumb item={item} cls="w-24 aspect-video" />
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold truncate" title={item.title}>
              {item.title}
            </span>
            <span className="shrink-0 flex items-center gap-2">
              {statusText(item, advanced)}
              {actions}
            </span>
          </div>
          <div className="dim">
            {presetLabel(item)}
            {advanced && item.extra.format_id && <span className="mono"> · {item.extra.format_id}</span>}
          </div>
          <Bar item={item} />
        </div>
      </div>
      <Detail item={item} advanced={advanced} showLog={showLog} />
    </div>
  );
}

/** The iTunes-style list: one line per download with an Aqua progress bar column. */
export function DownloadTable({ items, mode, ...h }: { items: DownloadItem[]; mode: Mode } & Handlers) {
  const advanced = mode === "advanced";
  const [open, setOpen] = useState<string | null>(null);
  return (
    <table className="itable">
      <thead>
        <tr>
          <th>Name</th>
          <th className="hidden sm:table-cell fit">Format</th>
          <th style={{ width: "26%" }}>Progress</th>
          <th className="fit">Status</th>
          <th className="fit" aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const expanded = open === item.id;
          const hasDetail = (item.status === "error" && !!item.errorMsg) || (advanced && (item.log.length > 0 || item.status === "completed"));
          return (
            <Fragment key={item.id}>
              <tr>
                <td>
                  <div className="flex items-center gap-2 min-w-0">
                    <Thumb item={item} cls="w-[34px] aspect-video !shadow-none" />
                    {hasDetail ? (
                      <button className="name-btn" aria-expanded={expanded} title={item.title} onClick={() => setOpen(expanded ? null : item.id)}>
                        {item.title}
                      </button>
                    ) : (
                      <span className="truncate" title={item.title}>
                        {item.title}
                      </span>
                    )}
                  </div>
                </td>
                <td className="hidden sm:table-cell fit dim">{presetLabel(item)}</td>
                <td>
                  <Bar item={item} />
                </td>
                <td className="fit">{statusText(item, advanced)}</td>
                <td className="fit">
                  <Actions item={item} advanced={false} iconOnly showLog={false} onToggleLog={() => {}} {...h} />
                </td>
              </tr>
              {(expanded || (item.status === "error" && !advanced)) && (
                <tr style={{ background: "#fbfbfb" }}>
                  <td colSpan={5} style={{ maxWidth: "none", whiteSpace: "normal", height: "auto", padding: "6px 10px" }}>
                    <Detail item={item} advanced={advanced} showLog={expanded} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
