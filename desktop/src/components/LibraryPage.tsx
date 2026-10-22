import { ArrowLeft, Disc3, FolderOpen, ListEnd, ListMusic, ListPlus, ListStart, Loader2, Music, Pencil, Play, RefreshCw, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useVirtualRows } from "../hooks/useVirtualRows";
import { usePlayerEngine } from "../hooks/usePlayer";
import type { EditResult, LibTrack } from "../lib/api";
import type { TagEditRequest } from "../lib/tagEdit";
import TagEditor from "./TagEditor";
import PlaylistPicker from "./PlaylistPicker";
import PlaylistsView from "./PlaylistsView";
import { usePlaylists } from "../hooks/usePlaylists";
import { formatClock } from "../lib/format";
import { albumsOf, artistsOf, filterTracks, formatsOf, qualityLabel, sortTracks, toPlayerTrack, totalDuration, type Album, type SortKey } from "../lib/library";
import { CoverArt } from "./Picture";

type View = "songs" | "albums" | "artists" | "playlists";

const ROW_HEIGHT = 28;
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
export default function LibraryPage({ tracks, scanning, loaded, onScan, onReveal, onEditTags, analysing, unmeasuredCount, onAnalyse, onStopAnalysing, announce, flash }: Props) {
  const player = usePlayerEngine();
  const playlists = usePlaylists();
  const [adding, setAdding] = useState<LibTrack[] | null>(null);
  const [view, setView] = useState<View>("songs");
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("");
  const [sort, setSort] = useState<SortKey>("title");
  const [artist, setArtist] = useState("");
  const [openAlbum, setOpenAlbum] = useState<string | null>(null);
  const [editing, setEditing] = useState<LibTrack[] | null>(null);

  const formats = useMemo(() => formatsOf(tracks), [tracks]);
  const matching = useMemo(() => filterTracks(tracks, { query, format, artist: "" }), [tracks, query, format]);
  const shown = useMemo(() => sortTracks(artist ? filterTracks(tracks, { query, format, artist }) : matching, sort), [tracks, query, format, artist, matching, sort]);
  const albums = useMemo(() => albumsOf(shown), [shown]);
  const artists = useMemo(() => artistsOf(matching), [matching]);
  const byPath = useMemo(() => new Map(tracks.map((t) => [t.path, t])), [tracks]);
  const album = openAlbum ? albums.find((a) => a.key === openAlbum) ?? null : null;

  const play = (list: LibTrack[], from = 0) => player?.play(list.slice(from, from + QUEUE_FROM_HERE).map(toPlayerTrack), 0);
  const next = (list: LibTrack[]) => {
    player?.playNext(list.map(toPlayerTrack));
    announce({ title: "Playing next", subtitle: list.length === 1 ? list[0].title : `${list.length} tracks` });
  };
  const add = (list: LibTrack[]) => {
    player?.enqueue(list.map(toPlayerTrack));
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

  return (
    <section className="library" aria-label="Music library">
      <header className="lib-bar">
        {view !== "playlists" && <label className="lib-search">
          <Search className="w-3.5 h-3.5" aria-hidden="true" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your music" aria-label="Search the library" spellCheck={false} />
          {query && (
            <button type="button" className="row-btn" aria-label="Clear the search" onClick={() => setQuery("")}>
              <X className="w-3 h-3" />
            </button>
          )}
        </label>}
        <div role="radiogroup" aria-label="Library view" className="seg">
          {(["songs", "albums", "artists", "playlists"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => changeView(v)} className="capitalize">
              {v}
            </button>
          ))}
        </div>
        {view !== "playlists" && <select className="field" aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="">All formats</option>
          {formats.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>}
        {view === "songs" && (
          <select className="field" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map(([key, label]) => (
              <option key={key} value={key}>
                Sort: {label}
              </option>
            ))}
          </select>
        )}
        <span className="flex-1" />
        <span className="dim" aria-label="Library size">
          {shown.length === tracks.length ? `${tracks.length} songs` : `${shown.length} of ${tracks.length} songs`}
          {shown.length > 0 ? ` · ${hours(totalDuration(shown))}` : ""}
        </span>
        {analysing ? (
          <button className="btn small" onClick={onStopAnalysing} title="Stop measuring loudness">
            <Loader2 className="w-3 h-3 animate-spin" /> Measuring {analysing.done} of {analysing.total} · Stop
          </button>
        ) : (
          unmeasuredCount > 0 && (
            <button className="btn small" onClick={onAnalyse} title="Measure how loud each song is, so the player can keep the volume even">
              Measure loudness ({unmeasuredCount})
            </button>
          )
        )}
        <button className="btn small" onClick={onScan} disabled={scanning !== null} title="Look for new and changed files">
          <RefreshCw className={`w-3 h-3 ${scanning ? "animate-spin" : ""}`} /> Rescan
        </button>
      </header>

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

      {view === "playlists" ? (
        <PlaylistsView
          api={playlists}
          byPath={byPath}
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
          <p className="m-0">Audio you download appears here, ready to play, once it has been found in your download folder.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty" style={{ minHeight: 200 }}>
          <h2>Nothing matches</h2>
          <p className="m-0">Try different words, or choose another format.</p>
        </div>
      ) : view === "songs" ? (
        <SongList tracks={shown} onPlay={play} onNext={next} onAdd={add} onReveal={onReveal} onEdit={(t) => setEditing([t])} onPlaylist={(t) => setAdding([t])} />
      ) : view === "albums" ? (
        album ? (
          <AlbumDetail album={album} onBack={() => setOpenAlbum(null)} onPlay={play} onNext={next} onAdd={add} onEdit={setEditing} onPlaylist={setAdding} />
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
          playlists={playlists.playlists}
          onPick={(id) => addToPlaylist(id, adding)}
          onCreate={(name) => createWith(name, adding)}
          onClose={() => setAdding(null)}
        />
      )}
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

function SongList({ tracks, onPlay, onNext, onAdd, onReveal, onEdit, onPlaylist }: { tracks: LibTrack[]; onPlay: (list: LibTrack[], from: number) => void; onNext: (list: LibTrack[]) => void; onAdd: (list: LibTrack[]) => void; onReveal: (path: string) => void; onEdit: (track: LibTrack) => void; onPlaylist: (track: LibTrack) => void }) {
  const rows = useVirtualRows(tracks.length, ROW_HEIGHT);
  return (
    <>
      <div className="lib-row lib-head" aria-hidden="true">
        <span />
        <span>Title</span>
        <span>Artist</span>
        <span>Album</span>
        <span className="num">Year</span>
        <span className="num">Time</span>
        <span>Quality</span>
        <span />
      </div>
      <div className="lib-scroll" ref={rows.ref}>
        <div role="list" aria-label="Songs" aria-rowcount={tracks.length} style={{ paddingTop: rows.padTop, paddingBottom: rows.padBottom }}>
          {tracks.slice(rows.start, rows.end).map((t, i) => {
            const index = rows.start + i;
            return (
              <div key={t.path} role="listitem" className="lib-row" style={{ height: ROW_HEIGHT }} onDoubleClick={() => onPlay(tracks, index)}>
                <span className="num dim mono">{index + 1}</span>
                <button type="button" className="lib-title link truncate" aria-label={`Play ${t.title}`} title={`Play ${t.title}`} onClick={() => onPlay(tracks, index)}>
                  {t.title}
                </button>
                <span className="truncate">{t.artist || <span className="dim">Unknown artist</span>}</span>
                <span className="truncate">{t.album || <span className="dim">Unknown album</span>}</span>
                <span className="num">{t.year ?? ""}</span>
                <span className="num mono">{t.duration > 0 ? formatClock(t.duration) : ""}</span>
                <span className="dim truncate">{qualityLabel(t)}</span>
                <span className="lib-actions">
                  <button type="button" className="row-btn" aria-label={`Play ${t.title} next`} title="Play next" onClick={() => onNext([t])}>
                    <ListStart className="w-3 h-3" />
                  </button>
                  <button type="button" className="row-btn" aria-label={`Add ${t.title} to the queue`} title="Add to the queue" onClick={() => onAdd([t])}>
                    <ListEnd className="w-3 h-3" />
                  </button>
                  <button type="button" className="row-btn" aria-label={`Add ${t.title} to a playlist`} title="Add to a playlist" onClick={() => onPlaylist(t)}>
                    <ListPlus className="w-3 h-3" />
                  </button>
                  <button type="button" className="row-btn" aria-label={`Edit tags of ${t.title}`} title="Edit tags" onClick={() => onEdit(t)}>
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button type="button" className="row-btn" aria-label={`Show ${t.title} in its folder`} title="Show in folder" onClick={() => onReveal(t.path)}>
                    <FolderOpen className="w-3 h-3" />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function AlbumDetail({ album, onBack, onPlay, onNext, onAdd, onEdit, onPlaylist }: { album: Album; onBack: () => void; onPlay: (list: LibTrack[], from: number) => void; onNext: (list: LibTrack[]) => void; onAdd: (list: LibTrack[]) => void; onEdit: (tracks: LibTrack[]) => void; onPlaylist: (tracks: LibTrack[]) => void }) {
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
              <button type="button" className="btn small primary" onClick={() => onPlay(album.tracks, 0)}>
                <Play className="w-3 h-3" /> Play album
              </button>
              <button type="button" className="btn small" onClick={() => onNext(album.tracks)}>
                <ListStart className="w-3 h-3" /> Play next
              </button>
              <button type="button" className="btn small" onClick={() => onAdd(album.tracks)}>
                <ListEnd className="w-3 h-3" /> Add to queue
              </button>
              <button type="button" className="btn small" onClick={() => onPlaylist(album.tracks)}>
                <ListMusic className="w-3 h-3" /> Add to playlist
              </button>
              <button type="button" className="btn small" onClick={() => onEdit(album.tracks)}>
                <Pencil className="w-3 h-3" /> Edit album
              </button>
            </div>
          </div>
        </div>
        <ol className="album-tracks" aria-label="Tracks">
          {album.tracks.map((t, i) => (
            <li key={t.path} className="lib-row album-track">
              <span className="num dim mono">{t.track ?? i + 1}</span>
              <button type="button" className="lib-title link truncate" aria-label={`Play ${t.title}`} onClick={() => onPlay(album.tracks, i)}>
                {t.title}
              </button>
              <span className="num mono">{t.duration > 0 ? formatClock(t.duration) : ""}</span>
              <span className="lib-actions">
                <button type="button" className="row-btn" aria-label={`Add ${t.title} to the queue`} title="Add to the queue" onClick={() => onAdd([t])}>
                  <ListEnd className="w-3 h-3" />
                </button>
                <button type="button" className="row-btn" aria-label={`Add ${t.title} to a playlist`} title="Add to a playlist" onClick={() => onPlaylist([t])}>
                  <ListPlus className="w-3 h-3" />
                </button>
                <button type="button" className="row-btn" aria-label={`Edit tags of ${t.title}`} title="Edit tags" onClick={() => onEdit([t])}>
                  <Pencil className="w-3 h-3" />
                </button>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
