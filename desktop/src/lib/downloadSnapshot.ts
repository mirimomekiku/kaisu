import type { DownloadItem } from "../hooks/useDownloads";
import type { SavedDownload } from "./storage";
/** Persist only queue fields, never transient logs, playback state or process details. */
export function downloadSnapshot(items: DownloadItem[]): SavedDownload[] {
  return items.filter((i) => i.status !== "completed").map((i) => ({
    id: i.id, recoveryId: i.recoveryId ?? i.id, estimatedBytes: i.estimatedBytes, expectedVolume: i.expectedVolume,
    title: i.title, url: i.url, thumbnail: i.thumbnail, preset: i.preset, outDir: i.outDir, extra: i.extra,
    status: i.status, progress: i.progress, clipKey: i.clipKey, placeholderTitle: i.placeholderTitle, channel: i.channel,
  }));
}
