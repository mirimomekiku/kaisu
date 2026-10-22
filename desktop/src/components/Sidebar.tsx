import { Download, Film, History as HistoryIcon, Library as LibraryIcon, Search, Settings as SettingsIcon, type LucideIcon } from "lucide-react";
import Picture from "./Picture";

export type Page = "search" | "downloads" | "history" | "library" | "settings";

interface Props {
  page: Page;
  onNavigate: (page: Page) => void;
  /** Downloads currently running, and how many are in the list in total. */
  active: number;
  total: number;
  historyCount: number;
  /** Songs in the music library. */
  songCount: number;
  /** The video currently open in the inspector, shown as artwork at the bottom. */
  art: { src: string | null; caption: string } | null;
}

function Item({ icon: Icon, label, page, current, count, hot, onNavigate }: {
  icon: LucideIcon;
  label: string;
  page: Page;
  current: Page;
  count?: number;
  hot?: boolean;
  onNavigate: (p: Page) => void;
}) {
  return (
    <button type="button" className="source" aria-current={current === page ? "page" : undefined} onClick={() => onNavigate(page)}>
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
      {count !== undefined && count > 0 && <span className={`count ${hot ? "hot" : ""}`}>{count}</span>}
    </button>
  );
}

/** The iTunes-style "source list": navigation on top, current artwork at the bottom. */
export default function Sidebar({ page, onNavigate, active, total, historyCount, songCount, art }: Props) {
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <nav aria-label="Sections">
        <div className="source-header">Download</div>
        <Item icon={Search} label="Search" page="search" current={page} onNavigate={onNavigate} />
        <Item icon={Download} label="Downloads" page="downloads" current={page} count={active || total} hot={active > 0} onNavigate={onNavigate} />
        <Item icon={HistoryIcon} label="History" page="history" current={page} count={historyCount} onNavigate={onNavigate} />
        <div className="source-header">Music</div>
        <Item icon={LibraryIcon} label="Library" page="library" current={page} count={songCount} onNavigate={onNavigate} />
        <div className="source-header">Kaisu</div>
        <Item icon={SettingsIcon} label="Settings" page="settings" current={page} onNavigate={onNavigate} />
      </nav>

      <div className="artwell" aria-label="Artwork">
        <div className="art">
          <Picture url={art?.src} fallback={<Film className="w-9 h-9 opacity-60" />} />
        </div>
        <div className="cap truncate" title={art?.caption}>
          {art?.caption ?? "No video selected"}
        </div>
      </div>
    </aside>
  );
}
