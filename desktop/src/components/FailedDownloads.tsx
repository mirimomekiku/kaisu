import { RotateCcw, Trash2 } from "lucide-react";
import { failedGroups } from "../lib/failedDownloads";
import type { DownloadItem } from "../hooks/useDownloads";

/** Lists what failed, by playlist, with one button to try those again or clear them instead of handling each row. */
export default function FailedDownloads({ items, onRetry, onRemove }: { items: DownloadItem[]; onRetry: (id: string) => void; onRemove: (id: string) => void }) {
  const groups = failedGroups(items);
  if (groups.length === 0) return null;
  const total = groups.reduce((n, g) => n + g.ids.length, 0);
  return <section className="panel mx-3 my-2 p-3" aria-label="Failed downloads">
    <div className="flex flex-wrap items-center gap-2">
      <b role="status">{total} download{total === 1 ? "" : "s"} failed</b>
      <span className="flex-1" />
      {groups.length > 1 && <button type="button" className="btn small" onClick={() => groups.forEach((g) => g.ids.forEach(onRetry))}><RotateCcw className="w-3 h-3" /> Try all {total} again</button>}
    </div>
    <ul className="list-none p-0 m-0 mt-2 flex flex-col gap-1.5">{groups.map((g) => <li key={g.key} className="flex flex-wrap items-center gap-2">
      <span className="flex-1 min-w-0 break-words"><b>{g.title}</b> · {g.ids.length} failed <span className="dim">— {g.reason}</span></span>
      <button type="button" className="btn small" aria-label={`Try ${g.ids.length} from ${g.title} again`} onClick={() => g.ids.forEach(onRetry)}><RotateCcw className="w-3 h-3" /> Try again</button>
      <button type="button" className="btn small" aria-label={`Remove ${g.ids.length} failed from ${g.title}`} onClick={() => g.ids.forEach(onRemove)}><Trash2 className="w-3 h-3" /> Remove</button>
    </li>)}</ul>
  </section>;
}
