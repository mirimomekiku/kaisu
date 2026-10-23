import ContextMenu, { type MenuEntry } from "./ContextMenu";
import { useRowMenu } from "../hooks/useRowMenu";
import { useMediaActions } from "../hooks/useMediaDialogs";
import { fileMenu } from "../lib/fileMenu";
import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import BulkDownloadEditor from "./BulkDownloadEditor";
import { editableDownload, type QueueEdit } from "../lib/queueEdit";
import type { DownloadItem } from "../hooks/useDownloads";
import { queuePositions } from "../lib/queueOrder";
import type { Mode, ViewMode } from "../lib/storage";
import DownloadRow, { DownloadTable, QUEUE_VIEWS, type Handlers } from "./DownloadRow";
import SpeedLimitDialog from "./SpeedLimitDialog";
import PageHeading from "./PageHeading";
import { effectiveView } from "./ViewSwitcher";

interface Props extends Omit<Handlers, "onSpeedLimit"> {
  items: DownloadItem[];
  mode: Mode;
  view: ViewMode;
  /** Sets (or with `null` removes) the speed limit of one download. */
  onSetRateLimit: (id: string, limit: string | null) => void;
  onEditWaiting: (ids: string[], edit: QueueEdit) => void;
}

/** The Downloads page: the queue as a table, or as rows, cards or compact lines. */
export default function DownloadsPage({ items, mode, view, onSetRateLimit, onEditWaiting, ...actions }: Props) {
  const queueView = effectiveView(view, QUEUE_VIEWS);
  const positions = useMemo(() => queuePositions(items), [items]);
  const [limitingId, setLimitingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const shown = items.filter((item) => (filter === "all" || (filter === "active" ? ["downloading", "processing", "queued"].includes(item.status) : item.status === filter)) && `${item.title} ${item.url} ${item.outDir}`.toLowerCase().includes(query.trim().toLowerCase()));
  const waiting = shown.filter(editableDownload);
  const selection = waiting.filter((item) => selected.has(item.id));
  const selectionKey = waiting.map((item) => item.id).join("\n");
  useEffect(() => { const visible = new Set(selectionKey.split("\n")); setSelected((old) => new Set([...old].filter((id) => visible.has(id)))); }, [selectionKey]);
  const context = useRowMenu(shown.map((item) => item.id));
  const media = useMediaActions();
  const current = shown.find((item) => item.id === context.menu?.id);
  const limiting = items.find((i) => i.id === limitingId && i.status !== "completed" && i.status !== "error" && i.status !== "cancelled");
  const handlers: Handlers = { ...actions, onSpeedLimit: setLimitingId };

  const dialog = <>{limiting && <SpeedLimitDialog key={limiting.id} item={limiting} onSet={onSetRateLimit} onClose={() => setLimitingId(null)} />}{editing && <BulkDownloadEditor count={selection.length} onSave={(edit) => { onEditWaiting(selection.map((item) => item.id), edit); setSelected(new Set()); }} onClose={() => setEditing(false)} />}</>;

  const entries: MenuEntry[] = current ? [
    { kind: "heading", label: current.title },
    ...(["queued", "downloading", "processing"].includes(current.status) ? [{ label: "Pause download", onSelect: () => actions.onPause(current.id) }] : []),
    ...(current.status === "paused" ? [{ label: "Resume download", onSelect: () => actions.onResume(current.id) }] : []),
    ...(["error", "cancelled"].includes(current.status) ? [{ label: "Try again", onSelect: () => actions.onRetry(current.id) }] : []),
    ...(current.status === "queued" ? [
      { label: "Download this next", onSelect: () => actions.onRunNext(current.id) },
      { label: "Download this last", onSelect: () => actions.onRunLater(current.id) },
    ] : []),
    ...(["queued", "downloading", "paused"].includes(current.status) ? [{ label: "Speed limit", onSelect: () => setLimitingId(current.id) }] : []),
    ...(current.status === "completed" ? fileMenu(current.path, undefined, media, { onOpen: actions.onOpen, onReveal: actions.onReveal, onCopyPath: actions.onCopyPath, onDelete: actions.onDeleteFile }) : []),
    { kind: "separator" },
    ...(["completed", "error", "cancelled"].includes(current.status) ? [{ label: "Remove from list", onSelect: () => actions.onRemove(current.id) }] : [{ label: "Cancel download", onSelect: () => actions.onCancel(current.id) }]),
  ] : [];
  const menu = current && context.menu && <ContextMenu {...context.menu} label={`Download actions for ${current.title}`} items={entries} onClose={context.close} />;

  const heading = <><PageHeading title="Downloads" description="Follow progress here. Finished files stay available in History.">
    <input className="field" type="search" aria-label="Search downloads" placeholder="Search title, URL or folder" value={query} onChange={(e) => setQuery(e.target.value)} />
    <select className="field" aria-label="Download status" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All downloads ({items.length})</option><option value="active">In progress</option><option value="paused">Paused</option><option value="completed">Completed</option><option value="error">Needs attention</option><option value="cancelled">Cancelled</option></select>
    <span className="dim" role="status">{shown.length} shown</span>
  </PageHeading>
  {waiting.length > 0 && <div className="download-selection">
    <button className="btn small" onClick={() => setSelected(new Set(waiting.map((item) => item.id)))}>Select waiting shown</button>
    <button className="btn small" disabled={!selection.length} onClick={() => setSelected(new Set())}>Clear selection</button>
    <button className="btn small" disabled={!selection.length} onClick={() => setEditing(true)}>Edit selected downloads ({selection.length})</button>
    <div className="download-selection-items" role="group" aria-label="Select waiting downloads">{waiting.map((item) => <label key={item.id} title={item.title}><input type="checkbox" aria-label={`Select download ${item.title}`} checked={selected.has(item.id)} onChange={(e) => setSelected((old) => { const next = new Set(old); if (e.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /><span className="truncate">{item.title}</span></label>)}</div>
  </div>}</>;
  if (shown.length === 0) {
    return <>{heading}
      <div className="empty" style={{ minHeight: 340 }}>
        <div className="big">
          <Download className="w-14 h-14" strokeWidth={1.25} />
        </div>
        <h2>{items.length ? "No downloads match these filters" : "No downloads"}</h2>
        <p className="m-0">{items.length ? "Change your search or status to see the rest of your queue." : "Start a download from Search to follow its progress here."}</p>
        {items.length > 0 && <button className="btn" onClick={() => { setFilter("all"); setQuery(""); }}>Show all downloads</button>}
      </div>{dialog}
    </>;
  }
  if (queueView === "details") {
    return (
      <>
        {heading}
        <DownloadTable items={shown} mode={mode} positions={positions} rowMenu={context.bind} {...handlers} />
        {dialog}
        {menu}
      </>
    );
  }
  return (
    <>
      {heading}
      <div className={`p-3 ${queueView === "grid" ? "grid grid-cols-2 lg:grid-cols-3 gap-3 items-start" : queueView === "compact" ? "flex flex-col gap-1" : "flex flex-col gap-1.5"}`}>
        {shown.map((item) => (
          <DownloadRow key={item.id} item={item} mode={mode} view={queueView} position={positions.get(item.id)} rowMenu={context.bind} {...handlers} />
        ))}
      </div>
      {dialog}
        {menu}
    </>
  );
}
