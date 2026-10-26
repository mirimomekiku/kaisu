import { ActionMenu, FilterDropdown } from "./Dropdown";
import SongList from "./SongList";
import { useMusicPreferences } from "../hooks/useMusicPreferences";
import ListeningDashboard from "./ListeningDashboard";
import { ArrowLeft, Disc3, ListEnd, ListMusic, ListPlus, ListStart, Loader2, Music, Pencil, Play, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { usePlayerEngine } from "../hooks/usePlayer";
import type { EditResult, LibTrack } from "../lib/api";
import type { TagEditRequest } from "../lib/tagEdit";
import TagEditor from "./TagEditor";
import PlaylistPicker from "./PlaylistPicker";
import PlaylistsView from "./PlaylistsView";
import type { PlaylistsApi } from "../hooks/usePlaylists";
import { formatClock } from "../lib/format";
import { albumsOf, artistsOf, filterTracks, formatsOf, sortTracks, toPlayerTrack, totalDuration, type Album, type SortKey } from "../lib/library";
import { CoverArt } from "./Picture";
import type { LibraryManagement } from "../hooks/useLibrary";
import type { Listening } from "../lib/listening";
import MusicFolders from "./MusicFolders";
import DuplicateFinder from "./DuplicateFinder";
import PortableSync from "./PortableSync";
import LyricsEditor from "./LyricsEditor";

type View = "songs" | "albums" | "artists" | "playlists" | "listening";

/** Playing from a long list queues this many tracks from the one chosen, so the queue stays manageable. */
const QUEUE_FROM_HERE = 500;

const SORTS: Array<[SortKey, string]> = [
  ["title", "Title"],
  ["artist", "Artist"],
  ["album", "Album"],
  ["year", "Year"],
  ["duration", "Length"],
  ["added", "Date added"],
];

interface Props {
  playlists: PlaylistsApi;
  management: LibraryManagement;
  listening: Listening;
  onRelocated: (from: string, to: string) => void;
  tracks: LibTrack[];
  scanning: { done: number; total: number } | null;
  loaded: boolean;
  onScan: () => void;
  onReveal: (path: string) => void;
  /** Changes tags in these files. */
  analysing: { done: number; total: number } | null;
  unmeasuredCount: number;
  onAnalyse: () => void;
  onStopAnalysing: () => void;
  onEditTags: (paths: string[], edit: TagEditRequest) => Promise<EditResult[]>;
  announce: (note: { title: string; subtitle?: string }) => void;
  flash: (text: string, error?: boolean) => void;
}

const hours = (seconds: number) => {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

/** The music library: every sound file found in the download folders, by song, album or artist. */
export default function LibraryPage({ playlists, tracks, management, listening, onRelocated, scanning, loaded, onScan, onReveal, onEditTags, analysing, unmeasuredCount, onAnalyse, onStopAnalysing, announce, flash }: Props) {
  const preferences = useMusicPreferences()?.preferences;
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [minimumRating, setMinimumRating] = useState(0);
  const player = usePlayerEngine();
  const [adding, setAdding] = useState<LibTrack[] | null>(null);
  const [view, setView] = useState<View>("songs");
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("");
  const [sort, setSort] = useState<SortKey>("title");
  const [artist, setArtist] = useState("");
  const [openAlbum, setOpenAlbum] = useState<string | null>(null);
  const [editing, setEditing] = useState<LibTrack[] | null>(null);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [lyricTrack, setLyricTrack] = useState<LibTrack | null>(null);
  const [availability, setAvailability] = useState("available");
  const eligible = useMemo(() => tracks.filter((t) => (!favoritesOnly || preferences?.[t.path]?.favorite) && (preferences?.[t.path]?.rating ?? 0) >= minimumRating && (availability === "all" || (availability === "missing" ? !!t.missing : !t.missing))), [tracks, availability, favoritesOnly, minimumRating, preferences]);

  const formats = useMemo(() => formatsOf(tracks), [tracks]);
  const matching = useMemo(() => filterTracks(eligible, { query, format, artist: "" }), [eligible, query, format]);
  const shown = useMemo(() => sortTracks(artist ? filterTracks(eligible, { query, format, artist }) : matching, sort), [eligible, query, format, artist, matching, sort]);
  const albums = useMemo(() => albumsOf(shown), [shown]);
  const artists = useMemo(() => artistsOf(matching), [matching]);
  const byPath = useMemo(() => new Map(tracks.map((t) => [t.path, t])), [tracks]);
  const album = openAlbum ? albums.find((a) => a.key === openAlbum) ?? null : null;

  const play = (list: LibTrack[], from = 0) => player?.play(list.slice(from).filter((t) => !t.missing).slice(0, QUEUE_FROM_HERE).map(toPlayerTrack), 0);
  const next = (list: LibTrack[]) => {
    player?.playNext(list.filter((t) => !t.missing).map(toPlayerTrack));
    announce({ title: "Playing next", subtitle: list.length === 1 ? list[0].title : `${list.length} tracks` });
  };
  const add = (list: LibTrack[]) => {
    player?.enqueue(list.filter((t) => !t.missing).map(toPlayerTrack));
    announce({ title: "Added to the queue", subtitle: list.length === 1 ? list[0].title : `${list.length} tracks` });
  };

  const addToPlaylist = (id: string, list: LibTrack[]) => {
    const name = playlists.playlists.find((p) => p.id === id)?.name ?? "the playlist";
    const added = playlists.add(id, list.map((t) => t.path));
    announce({ title: added > 0 ? `Added to ${name}` : `Already in ${name}`, subtitle: added > 0 ? `${added} song${added === 1 ? "" : "s"}` : undefined });
    setAdding(null);
  };
  const createWith = (name: string, list: LibTrack[]): string | null => {
    const r = playlists.create(name, list.map((t) => t.path));
    if ("problem" in r) return r.problem;
    announce({ title: `Added to ${r.playlist.name}`, subtitle: `${r.playlist.paths.length} song${r.playlist.paths.length === 1 ? "" : "s"}` });
    setAdding(null);
    return null;
  };

  const changeView = (next: View) => {
    setView(next);
    setOpenAlbum(null);
  };
  const filterCount = [!!format, availability !== "available", favoritesOnly, minimumRating > 0].filter(Boolean).length;
  const resetFilters = () => { setFormat(""); setAvailability("available"); setFavoritesOnly(false); setMinimumRating(0); };
  const locate = async (path: string) => {
    try {
      const found = await management.locate(path);
      if (found) { onRelocated(found.from, found.track.path); announce({ title: "Moved file located", subtitle: found.track.title }); }
    } catch (e) { flash(e instanceof Error ? e.message : String(e), true); }
  };

  return (
    <section className="library" aria-label="Music library">
      <header className="lib-bar">
        <h1 className="lib-title-heading">Library</h1>
        <select className="field lib-view" aria-label="Library view" value={view} onChange={(e) => changeView(e.target.value as View)}>
          {(["songs", "albums", "artists", "playlists", "listening"] as const).map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
        </select>

        {!["playlists", "listening"].includes(view) && <label className="lib-search">
          <Search className="w-3.5 h-3.5" aria-hidden="true" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your music" aria-label="Search the library" spellCheck={false} />
          {query && (
            <button type="button" className="row-btn" aria-label="Clear the search" onClick={() => setQuery("")}>
              <X className="w-3 h-3" />
            </button>
          )}
        </label>}
        {!["playlists", "listening"].includes(view) && <FilterDropdown label={`Library filters${filterCount ? ` (${filterCount})` : ""}`}>
          <label>Format<select className="field" aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value)}><option value="">All formats</option>{formats.map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
          <label>Files<select className="field" aria-label="File availability" value={availability} onChange={(e) => setAvailability(e.target.value)}><option value="available">Available files</option><option value="missing">Missing files</option><option value="all">All files</option></select></label>
          <label className="dropdown-check"><input type="checkbox" aria-label="Favorites only" checked={favoritesOnly} onChange={(e) => setFavoritesOnly(e.target.checked)} />Favorites only</label>
          <label>Rating<select className="field" aria-label="Minimum rating" value={minimumRating} onChange={(e) => setMinimumRating(Number(e.target.value))}><option value="0">All ratings</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+ stars</option>)}</select></label>
          <button className="btn small" onClick={resetFilters}>Reset filters</button>
        </FilterDropdown>}
        {view === "songs" && <select className="field" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>{SORTS.map(([key, label]) => <option key={key} value={key}>Sort: {label}</option>)}</select>}
        <span className="flex-1" />
        <ActionMenu label="Library tools" items={[
          { label: "Music folders", onSelect: () => setFoldersOpen(true) },
          { label: "Find duplicates", onSelect: () => setDuplicatesOpen(true) },
          { label: "Portable collection sync", onSelect: () => setSyncOpen(true) },
          { kind: "separator" },
          { label: "Rescan", onSelect: onScan, disabled: scanning !== null },
          ...(analysing ? [{ label: `Stop measuring loudness (${analysing.done} of ${analysing.total})`, onSelect: onStopAnalysing }] : [{ label: `Measure loudness (${unmeasuredCount})`, onSelect: onAnalyse, disabled: unmeasuredCount === 0 }]),
        ]} />
      </header>
      <div className="lib-summary">
        <span aria-label="Library size">{shown.length === tracks.length ? `${tracks.length} songs` : `${shown.length} of ${tracks.length} songs`}{shown.length > 0 ? ` · ${hours(totalDuration(shown))}` : ""}</span>
        <span>{management.watching ? "Watching for changes" : "Watching paused"}{tracks.some((t) => t.missing) ? ` · ${tracks.filter((t) => t.missing).length} missing` : ""}</span>
      </div>

      {artist && (
        <div className="lib-chip" role="status">
          Showing <b>{artist}</b>
          <button type="button" className="row-btn" aria-label={`Show all artists instead of ${artist}`} onClick={() => setArtist("")}>
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      {scanning && (
        <div className="lib-chip" role="status" aria-label="Scan progress">
          <Loader2 className="w-3 h-3 animate-spin" /> {scanning.total > 0 ? `Reading ${scanning.done} of ${scanning.total}…` : "Looking for music…"}
        </div>
      )}

      {view === "listening" ? <ListeningDashboard tracks={tracks} stats={listening} onPlay={(t) => player?.play([toPlayerTrack(t)])} /> : view === "playlists" ? (
        <PlaylistsView
          api={playlists}
          byPath={byPath}
          listening={listening}
          onPlay={(list) => play(list)}
          onNext={next}
          onAdd={add}
          announce={announce}
          flash={flash}
        />
      ) : tracks.length === 0 ? (
        <div className="empty" style={{ minHeight: 280 }}>
          <div className="big">
            <Music className="w-14 h-14" strokeWidth={1.25} />
          </div>
          <h2>{scanning || !loaded ? "Reading your music…" : "No music yet"}</h2>
          <p className="m-0">Add an existing music folder or download audio to start your library.</p>
          <button className="btn primary" onClick={() => setFoldersOpen(true)}>Add music to your library</button>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty" style={{ minHeight: 200 }}>
          <h2>Nothing matches</h2>
          <p className="m-0">Clear the search or reset filters to see your music.</p>
          <button className="btn" onClick={() => { resetFilters(); setQuery(""); setArtist(""); }}>Reset library filters</button>
        </div>
      ) : view === "songs" ? (
        <SongList tracks={shown} onLyrics={setLyricTrack} onLocate={(path) => void locate(path)} onPlay={play} onNext={next} onAdd={add} onReveal={onReveal} onEdit={setEditing} onPlaylist={setAdding} announce={announce} />
      ) : view === "albums" ? (
        album ? (
          <AlbumDetail album={album} onLocate={(path) => void locate(path)} onBack={() => setOpenAlbum(null)} onPlay={play} onNext={next} onAdd={add} onEdit={setEditing} onPlaylist={setAdding} />
        ) : (
          <div className="lib-scroll">
            <div className="album-grid" role="list" aria-label="Albums">
              {albums.map((a) => (
                <div key={a.key} role="listitem" className="min-w-0">
                  <button type="button" className="album-card" aria-label={`Open ${a.title} by ${a.artist}`} onClick={() => setOpenAlbum(a.key)}>
                    <div className="thumb album-cover">
                      <CoverArt path={a.tracks[0].path} fallback={<Disc3 className="w-8 h-8 opacity-50" />} />
                    </div>
                    <span className="album-title truncate">{a.title}</span>
                    <span className="dim truncate">
                      {a.artist}
                      {a.year ? ` · ${a.year}` : ""}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      ) : (
        <div className="lib-scroll">
          <ul className="artist-list" aria-label="Artists">
            {artists.map((a) => (
              <li key={a.name}>
                <button
                  type="button"
                  className="artist-row"
                  aria-label={`Show ${a.name}`}
                  onClick={() => {
                    setArtist(a.name);
                    setView("albums");
                    setOpenAlbum(null);
                  }}
                >
                  <b className="truncate">{a.name}</b>
                  <span className="dim">
                    {a.albums} album{a.albums === 1 ? "" : "s"} · {a.tracks} song{a.tracks === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {adding && (
        <PlaylistPicker
          what={adding.length === 1 ? adding[0].title : `${adding.length} songs`}
          playlists={playlists.playlists.filter((p) => !p.smart)}
          onPick={(id) => addToPlaylist(id, adding)}
          onCreate={(name) => createWith(name, adding)}
          onClose={() => setAdding(null)}
        />
      )}
      {foldersOpen && <MusicFolders management={management} onClose={() => setFoldersOpen(false)} />}
      {duplicatesOpen && <DuplicateFinder byPath={byPath} onChanged={onScan} onReveal={onReveal} onClose={() => setDuplicatesOpen(false)} />}
      {syncOpen && <PortableSync tracks={tracks} playlists={playlists.playlists} listening={listening} onClose={() => setSyncOpen(false)} />}
      {lyricTrack && <LyricsEditor key={lyricTrack.path} path={lyricTrack.path} title={lyricTrack.title} artist={lyricTrack.artist} onSaved={onScan} onClose={() => setLyricTrack(null)} />}
      {editing && (
        <TagEditor
          // A new key for a new selection starts the form afresh.
          key={editing.map((t) => t.path).join("|")}
          tracks={editing}
          onSave={(edit) => onEditTags(editing.map((t) => t.path), edit)}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function AlbumDetail({ album, onLocate, onBack, onPlay, onNext, onAdd, onEdit, onPlaylist }: { album: Album; onLocate: (path: string) => void; onBack: () => void; onPlay: (list: LibTrack[], from: number) => void; onNext: (list: LibTrack[]) => void; onAdd: (list: LibTrack[]) => void; onEdit: (tracks: LibTrack[]) => void; onPlaylist: (tracks: LibTrack[]) => void }) {
  const available = album.tracks.filter((t) => !t.missing);
  return (
    <div className="lib-scroll">
      <div className="album-detail">
        <div className="flex items-start gap-4">
          <div className="thumb album-cover large">
            <CoverArt path={album.tracks[0].path} fallback={<Disc3 className="w-12 h-12 opacity-50" />} />
          </div>
          <div className="flex flex-col gap-1.5 min-w-0">
            <button type="button" className="btn small w-fit" onClick={onBack}>
              <ArrowLeft className="w-3 h-3" /> Back to albums
            </button>
            <h2 className="m-0 text-[18px] truncate">{album.title}</h2>
            <div className="dim">
              {album.artist}
              {album.year ? ` · ${album.year}` : ""} · {album.tracks.length} song{album.tracks.length === 1 ? "" : "s"} · {hours(album.duration)}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="btn small primary" disabled={available.length === 0} onClick={() => onPlay(album.tracks, 0)}>
                <Play className="w-3 h-3" /> Play album
              </button>
              <button type="button" className="btn small" disabled={available.length === 0} onClick={() => onNext(available)}>
                <ListStart className="w-3 h-3" /> Play next
              </button>
              <button type="button" className="btn small" disabled={available.length === 0} onClick={() => onAdd(available)}>
                <ListEnd className="w-3 h-3" /> Add to queue
              </button>
              <button type="button" className="btn small" disabled={available.length === 0} onClick={() => onPlaylist(available)}>
                <ListMusic className="w-3 h-3" /> Add to playlist
              </button>
              <button type="button" className="btn small" disabled={available.length === 0} onClick={() => onEdit(available)}>
                <Pencil className="w-3 h-3" /> Edit album
              </button>
            </div>
          </div>
        </div>
        <ol className="album-tracks" aria-label="Tracks">
          {album.tracks.map((t, i) => (
            <li key={t.path} className="lib-row album-track">
              <span className="num dim mono">{t.track ?? i + 1}</span>
              <button type="button" className="lib-title link truncate" disabled={!!t.missing} aria-label={`Play ${t.title}`} onClick={() => onPlay(album.tracks, i)}>
                {t.title}{t.missing ? " (missing)" : ""}
              </button>
              <span className="num mono">{t.duration > 0 ? formatClock(t.duration) : ""}</span>
              <span className="lib-actions">
                {t.missing ? <button className="btn small" aria-label={`Locate ${t.title}`} onClick={() => onLocate(t.path)}>Locate file</button> : <>
                <button type="button" className="row-btn" aria-label={`Add ${t.title} to the queue`} title="Add to the queue" onClick={() => onAdd([t])}>
                  <ListEnd className="w-3 h-3" />
                </button>
                <button type="button" className="row-btn" aria-label={`Add ${t.title} to a playlist`} title="Add to a playlist" onClick={() => onPlaylist([t])}>
                  <ListPlus className="w-3 h-3" />
                </button>
                <button type="button" className="row-btn" aria-label={`Edit tags of ${t.title}`} title="Edit tags" onClick={() => onEdit([t])}>
                  <Pencil className="w-3 h-3" />
                </button>
                </>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
