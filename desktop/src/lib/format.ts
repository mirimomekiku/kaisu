import type { Preset } from "./api";

export const PRESET_LABEL: Record<Preset, string> = {
  best: "Best quality (MP4)",
  p1080: "1080p (MP4)",
  p720: "720p (MP4)",
  audio: "Audio only",
};

export function formatDuration(secs: number | null): string {
  if (secs == null) return "--:--";
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatSpeed(bytesPerSec: number | null): string {
  if (bytesPerSec == null) return "";
  const mb = bytesPerSec / 1_048_576;
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.round(bytesPerSec / 1024)} KB/s`;
}

export function formatEta(secs: number | null): string {
  if (secs == null) return "";
  return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s left` : `${secs}s left`;
}
