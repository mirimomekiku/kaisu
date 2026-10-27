import type { DownloadItem } from "../hooks/useDownloads";

export interface FailedGroup {
  /** The playlist's title, or "" for downloads that were not part of one. */
  key: string;
  title: string;
  ids: string[];
  /** The most common reason among them, shortened. */
  reason: string;
}

const firstLine = (text: string | undefined) => (text ?? "").split("\n")[0].trim().slice(0, 160);

/**
 * Failed downloads (not ones the user cancelled) grouped by the playlist they came from, so a playlist with a few
 * failures can be retried or cleared on its own. Larger groups come first.
 */
export function failedGroups(items: Array<Pick<DownloadItem, "id" | "status" | "extra" | "errorMsg">>): FailedGroup[] {
  const groups = new Map<string, { ids: string[]; reasons: Map<string, number> }>();
  const empty = (): { ids: string[]; reasons: Map<string, number> } => ({ ids: [], reasons: new Map() });
  for (const item of items) {
    if (item.status !== "error") continue;
    const key = item.extra.playlist?.title?.trim() ?? "";
    const group = groups.get(key) ?? empty();
    group.ids.push(item.id);
    const reason = firstLine(item.errorMsg) || "No reason was reported";
    group.reasons.set(reason, (group.reasons.get(reason) ?? 0) + 1);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, title: key || "Single downloads", ids: g.ids, reason: [...g.reasons.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.ids.length - a.ids.length || a.title.localeCompare(b.title));
}
