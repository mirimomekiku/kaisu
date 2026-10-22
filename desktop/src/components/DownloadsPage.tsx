import ContextMenu, { type MenuEntry } from "./ContextMenu";
import { useRowMenu } from "../hooks/useRowMenu";
import { useMediaActions } from "../hooks/useMediaDialogs";
import { fileMenu } from "../lib/fileMenu";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
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
}

/** The Downloads page: the queue as a table, or as rows, cards or compact lines. */
export default function DownloadsPage({ items, mode, view, onSetRateLimit, ...actions }: Props) {
  const queueView = effectiveView(view, QUEUE_VIEWS);
  const positions = useMemo(() => queuePositions(items), [items]);
  const [limitingId, setLimitingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const shown = items.filter((item) => filter === "all" || (filter === "active" ? ["downloading", "processing", "queued"].includes(item.status) : item.status === filter));
  const context = useRowMenu(shown.map((item) => item.id));
  const media = useMediaActions();
  const current = shown.find((item) => item.id === context.menu?.id);
  const limiting = items.find((i) => i.id === limitingId && i.status !== "completed" && i.status !== "error" && i.status !== "cancelled");
  const handlers: Handlers = { ...actions, onSpeedLimit: setLimitingId };

  const dialog = limiting && <SpeedLimitDialog key={limiting.id} item={limiting} onSet={onSetRateLimit} onClose={() => setLimitingId(null)} />;

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

  const heading = <PageHeading title="Downloads" description="Follow progress here. Finished files stay available in History.">
    <select className="field" aria-label="Download status" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All downloads ({items.length})</option><option value="active">In progress</option><option value="paused">Paused</option><option value="completed">Completed</option><option value="error">Needs attention</option><option value="cancelled">Cancelled</option></select>
    <span className="dim" role="status">{shown.length} shown</span>
  </PageHeading>;
  if (shown.length === 0) {
    return <>{heading}
      <div className="empty" style={{ minHeight: 340 }}>
        <div className="big">
          <Download className="w-14 h-14" strokeWidth={1.25} />
        </div>
        <h2>{items.length ? "No downloads match this status" : "No downloads"}</h2>
        <p className="m-0">{items.length ? "Choose another status to see the rest of your queue." : "Start a download from Search to follow its progress here."}</p>
        {items.length > 0 && <button className="btn" onClick={() => setFilter("all")}>Show all downloads</button>}
      </div>
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
