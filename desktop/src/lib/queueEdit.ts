import type { DownloadItem } from "../hooks/useDownloads";
import type { AudioFormat, Preset } from "./api";

export interface QueueEdit { preset?: Preset; audioFormat?: AudioFormat; outDir?: string; rateLimit?: string | null }
export const editableDownload = (item: DownloadItem) => item.status === "queued" || item.status === "paused";
export function editWaitingDownloads(items: DownloadItem[], ids: Set<string>, edit: QueueEdit, unavailable: Set<string> = new Set()): DownloadItem[] {
  return items.map((item) => {
    if (!ids.has(item.id) || !editableDownload(item) || unavailable.has(item.id)) return item;
    const next: DownloadItem = {
      ...item,
      ...(edit.preset ? { preset: edit.preset } : {}),
      ...(edit.outDir?.trim() ? { outDir: edit.outDir.trim() } : {}),
      extra: { ...item.extra,
        ...(edit.preset ? { format_id: null } : {}),
        ...(edit.audioFormat ? { audio_format: edit.audioFormat } : {}),
        ...(edit.rateLimit !== undefined ? { rate_limit: edit.rateLimit } : {}),
      },
    };
    const destinationChanged = next.outDir !== item.outDir;
    if (destinationChanged || next.preset !== item.preset || next.extra.audio_format !== item.extra.audio_format || next.extra.format_id !== item.extra.format_id) {
      // Keep the original manifest/partials recoverable under their original choices.
      // A new ID also makes changing back later independent of a download already started.
      next.recoveryId = crypto.randomUUID();
      next.progress = 0;
      next.path = null;
      next.stage = "preparing";
      if (destinationChanged) next.expectedVolume = undefined;
    }
    return next;
  });
}
