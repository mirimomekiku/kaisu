import { PRESET_LABEL, clipLabel } from "./format";
import type { HistoryItem } from "./storage";

export type HistorySort = "date" | "title" | "channel" | "format" | "size";

export interface HistoryRow {
  item: HistoryItem;
  /** undefined while still being checked */
  exists: boolean | undefined;
  size: number | undefined;
}

/** Sorts rows; ties fall back to newest first so the order is stable and predictable. */
export function sortHistory(rows: HistoryRow[], by: HistorySort, descending: boolean): HistoryRow[] {
  const text = (v: string | undefined) => (v ?? "").toLocaleLowerCase();
  const compare = (a: HistoryRow, b: HistoryRow): number => {
    switch (by) {
      case "title":
        return text(a.item.title).localeCompare(text(b.item.title));
      case "channel":
        return text(a.item.channel).localeCompare(text(b.item.channel));
      case "format":
        return (PRESET_LABEL[a.item.preset] ?? a.item.preset).localeCompare(PRESET_LABEL[b.item.preset] ?? b.item.preset);
      case "size":
        return (a.size ?? -1) - (b.size ?? -1);
      default:
        return a.item.timestamp - b.item.timestamp;
    }
  };
  const sign = descending ? -1 : 1;
  return rows.slice().sort((a, b) => sign * compare(a, b) || b.item.timestamp - a.item.timestamp);
}

const csvCell = (value: string | number | undefined): string => {
  const s = value === undefined ? "" : String(value);
  // Quote anything with a separator, quote or newline. Cells that start with = + - @ are prefixed so a spreadsheet
  // never treats downloaded titles as formulas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function historyToCsv(rows: HistoryRow[]): string {
  const header = ["Title", "Channel", "Format", "Clip", "Downloaded", "Size (bytes)", "File", "Link"];
  const lines = rows.map(({ item, size, exists }) =>
    [
      item.title,
      item.channel,
      PRESET_LABEL[item.preset] ?? item.preset,
      clipLabel(item.clip),
      new Date(item.timestamp).toISOString(),
      size,
      exists === false ? "" : item.path ?? "",
      item.url,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}

export function historyToJson(rows: HistoryRow[]): string {
  return JSON.stringify(
    rows.map(({ item, size, exists }) => ({
      title: item.title,
      channel: item.channel ?? null,
      format: PRESET_LABEL[item.preset] ?? item.preset,
      clip: item.clip ? clipLabel(item.clip) : null,
      downloaded: new Date(item.timestamp).toISOString(),
      sizeBytes: size ?? null,
      file: exists === false ? null : item.path,
      fileExists: exists ?? null,
      link: item.url,
    })),
    null,
    2,
  );
}
