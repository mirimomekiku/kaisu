import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import type { DownloadItem } from "../hooks/useDownloads";
import { queuePositions } from "../lib/queueOrder";
import type { Mode, ViewMode } from "../lib/storage";
import DownloadRow, { DownloadTable, QUEUE_VIEWS, type Handlers } from "./DownloadRow";
import SpeedLimitDialog from "./SpeedLimitDialog";
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
  const limiting = items.find((i) => i.id === limitingId && i.status !== "completed" && i.status !== "error" && i.status !== "cancelled");
  const handlers: Handlers = { ...actions, onSpeedLimit: setLimitingId };

  const dialog = limiting && <SpeedLimitDialog key={limiting.id} item={limiting} onSet={onSetRateLimit} onClose={() => setLimitingId(null)} />;

  if (items.length === 0) {
    return (
      <div className="empty" style={{ minHeight: 340 }}>
        <div className="big">
          <Download className="w-14 h-14" strokeWidth={1.25} />
        </div>
        <h2>No downloads</h2>
        <p className="m-0">Videos you download will appear here with their progress.</p>
      </div>
    );
  }
  if (queueView === "details") {
    return (
      <>
        <DownloadTable items={items} mode={mode} positions={positions} {...handlers} />
        {dialog}
      </>
    );
  }
  return (
    <>
      <div className={`p-3 ${queueView === "grid" ? "grid grid-cols-2 lg:grid-cols-3 gap-3 items-start" : queueView === "compact" ? "flex flex-col gap-1" : "flex flex-col gap-1.5"}`}>
        {items.map((item) => (
          <DownloadRow key={item.id} item={item} mode={mode} view={queueView} position={positions.get(item.id)} {...handlers} />
        ))}
      </div>
      {dialog}
    </>
  );
}
