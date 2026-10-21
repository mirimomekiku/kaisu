import type { LcdState } from "../components/Lcd";
import type { DownloadItem } from "../hooks/useDownloads";
import type { EngineInfo } from "./api";
import { formatEta, formatSpeed } from "./format";

interface Args {
  searching: boolean;
  loadingMore: boolean;
  busyWhat: "search" | "list";
  loadingInfo: boolean;
  sourceName: string;
  /** The search or listing on screen, or the search box's text when there is none. */
  query: string;
  /** What is in the search box. */
  url: string;
  /** A short confirmation ("Link copied", "Added to Downloads"). */
  note: { title: string; subtitle?: string } | null;
  activeDownloads: DownloadItem[];
  queuedCount: number;
  pausedCount: number;
  schedulePaused: boolean;
  engine: EngineInfo | null;
}

const mean = (items: DownloadItem[]) => items.reduce((sum, i) => sum + i.progress, 0) / items.length;

/** What the status display in the toolbar says, in order of what matters most right now. */
export function lcdState(a: Args): LcdState {
  if (a.searching || a.loadingMore) return { title: a.busyWhat === "list" ? "Loading the list…" : `Searching ${a.sourceName}…`, subtitle: a.query, progress: null, busy: true };
  if (a.loadingInfo) return { title: "Looking up video…", subtitle: a.url, progress: null, busy: true };
  // A short confirmation wins for its few seconds, then progress returns.
  if (a.note) return { ...a.note, progress: a.activeDownloads.length > 0 ? mean(a.activeDownloads) : null };
  if (a.activeDownloads.length > 0) {
    const first = a.activeDownloads[0];
    const detail = first.status === "processing" ? "Finishing up…" : [formatSpeed(first.speed), formatEta(first.eta)].filter(Boolean).join(" · ") || `${Math.round(first.progress)}%`;
    return {
      title: first.title,
      subtitle: a.activeDownloads.length > 1 ? `${a.activeDownloads.length} downloads · ${detail}` : detail,
      progress: mean(a.activeDownloads),
    };
  }
  if (a.schedulePaused && (a.queuedCount > 0 || a.pausedCount > 0)) return { title: "Paused by your schedule", subtitle: "Downloads continue when the rule ends", progress: null };
  if (a.queuedCount > 0) return { title: "Waiting to download…", subtitle: `${a.queuedCount} in queue`, progress: null };
  if (a.pausedCount > 0) return { title: "Downloads paused", subtitle: `${a.pausedCount} paused. Press Resume to continue`, progress: null };
  if (a.engine && !a.engine.ready) return { title: "Helper tools missing", subtitle: "Open Settings, then Repair", progress: null };
  return { title: "Kaisu", subtitle: `Paste a link or search ${a.sourceName}`, progress: null };
}
