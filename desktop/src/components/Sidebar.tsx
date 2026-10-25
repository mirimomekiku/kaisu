import { Bookmark, Download, Film, History as HistoryIcon, Library as LibraryIcon, ListMusic, Podcast, Search, Settings as SettingsIcon, type LucideIcon } from "lucide-react";
import { defaultSidebar, NAV_LABELS, type SidebarOptions } from "../lib/customization";
import Picture from "./Picture";
import { FEATURES } from "../lib/features";

export type Page = "search" | "downloads" | "history" | "library" | "podcasts" | "settings" | "sources";

interface Props {
  options?: SidebarOptions;
  playlists: Array<{ id: string; name: string }>;
  sources: Array<{ id: string; title: string }>;
  onPlaylist: (id: string) => void;
  onSource: (id: string) => void;
  page: Page;
  onNavigate: (page: Page) => void;
  /** Downloads currently running, and how many are in the list in total. */
  active: number;
  total: number;
  historyCount: number;
  /** Songs in the music library. */
  songCount: number;
  /** Selected video artwork, or the current song's loaded album cover. */
  art: { src: string | null; caption: string; kind?: "video" | "album" } | null;
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
export default function Sidebar({ options = defaultSidebar(), playlists, sources, onPlaylist, onSource, page, onNavigate, active, total, historyCount, songCount, art }: Props) {
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <nav aria-label="Sections">
        <div className="source-header">Sections</div>
        {options.order.filter((key) => !options.hidden.includes(key) && (key !== "podcasts" || FEATURES.podcasts)).map((key) => {
          const icons = { search: Search, downloads: Download, sources: Bookmark, history: HistoryIcon, library: LibraryIcon, podcasts: Podcast, settings: SettingsIcon };
          const count = key === "downloads" ? active || total : key === "history" ? historyCount : key === "library" ? songCount : undefined;
          return <Item key={key} icon={icons[key]} label={NAV_LABELS[key]} page={key} current={page} count={options.showCounts ? count : undefined} hot={key === "downloads" && active > 0} onNavigate={onNavigate} />;
        })}
        {(options.playlistPins.some((id) => playlists.some((p) => p.id === id)) || options.sourcePins.some((id) => sources.some((p) => p.id === id))) && <div className="source-header">Pinned</div>}
        {options.playlistPins.flatMap((id) => { const p = playlists.find((p) => p.id === id); return p ? [<button key={`playlist-${id}`} className="source" aria-label={`Open pinned playlist ${p.name}`} title={p.name} onClick={() => onPlaylist(id)}><ListMusic className="w-3.5 h-3.5" /><span className="truncate">{p.name}</span></button>] : []; })}
        {options.sourcePins.flatMap((id) => { const p = sources.find((p) => p.id === id); return p ? [<button key={`source-${id}`} className="source" aria-label={`Open pinned source ${p.title}`} title={p.title} onClick={() => onSource(id)}><Bookmark className="w-3.5 h-3.5" /><span className="truncate">{p.title}</span></button>] : []; })}
      </nav>

      {options.showArtwork && <div className="artwell" aria-label="Artwork">
        <div className={`art${art?.kind === "album" ? " album-art" : ""}`}>
          <Picture url={art?.src} fallback={<Film className="w-9 h-9 opacity-60" />} />
        </div>
        <div className="cap truncate" title={art?.caption}>
          {art?.caption ?? "No video selected"}
        </div>
      </div>}
    </aside>
  );
}
