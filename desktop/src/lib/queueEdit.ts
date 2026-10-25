import type { DownloadItem } from "../hooks/useDownloads";
import type { AudioFormat, Preset } from "./api";
import { forFormat } from "./audioFormats";

export interface QueueEdit { preset?: Preset; audioFormat?: AudioFormat; outDir?: string; rateLimit?: string | null }
export const editableDownload = (item: DownloadItem) => item.status === "queued" || item.status === "paused";
export function editWaitingDownloads(items: DownloadItem[], ids: Set<string>, edit: QueueEdit, unavailable: Set<string> = new Set()): DownloadItem[] {
  return items.map((item) => !ids.has(item.id) || !editableDownload(item) || unavailable.has(item.id) ? item : {
    ...item,
    ...(edit.preset ? { preset: edit.preset } : {}),
    ...(edit.outDir?.trim() ? { outDir: edit.outDir.trim() } : {}),
    extra: { ...item.extra,
      ...(edit.preset ? { format_id: null } : {}),
      ...(edit.audioFormat ? { audio_format: edit.audioFormat, audio: forFormat(edit.audioFormat, item.extra.audio ?? null) } : {}),
      ...(edit.rateLimit !== undefined ? { rate_limit: edit.rateLimit } : {}),
    },
  });
}
