import { useMusicPreferences } from "../hooks/useMusicPreferences";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ArrowDown, ArrowLeft, ArrowUp, Download, ListEnd, ListMusic, ListStart, Pencil, Play, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PlaylistsApi } from "../hooks/usePlaylists";
import { errorText, exportText, type LibTrack } from "../lib/api";
import { formatClock } from "../lib/format";
import { baseName } from "../lib/mediaKind";
import { m3uFileName, toM3u, type Playlist } from "../lib/playlists";
import Sheet from "./Sheet";
import SmartPlaylistEditor from "./SmartPlaylistEditor";
import { smartTracks } from "../lib/smartPlaylists";
import type { Listening } from "../lib/listening";

interface Props {
  listening: Listening;
  api: PlaylistsApi;
  /** Every song in the library, by path. */
  byPath: Map<string, LibTrack>;
  onPlay: (tracks: LibTrack[]) => void;
  onNext: (tracks: LibTrack[]) => void;
  onAdd: (tracks: LibTrack[]) => void;
  announce: (note: { title: string; subtitle?: string }) => void;
  flash: (text: string, error?: boolean) => void;
}

const count = (n: number) => `${n} song${n === 1 ? "" : "s"}`;

/** Playlists: made from the library, played in order, and exported as .m3u8. */
export default function PlaylistsView({ api, byPath, listening, onPlay, onNext, onAdd, announce, flash }: Props) {
  const preferences = useMusicPreferences()?.preferences;
  const [openId, setOpenId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [smartEdit, setSmartEdit] = useState<Playlist | "new" | null>(null);
  const [minute, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(timer); }, []);
  const resolved = useMemo(() => api.playlists.map((p) => p.smart ? { ...p, paths: smartTracks([...byPath.values()], p.smart, listening, Date.now(), preferences).map((t) => t.path) } : p), [api.playlists, byPath, listening, minute, preferences]);
  const open = resolved.find((p) => p.id === openId) ?? null;
  const smartDialog = smartEdit && <SmartPlaylistEditor initial={smartEdit === "new" ? undefined : smartEdit.smart} initialName={smartEdit === "new" ? "" : smartEdit.name} onClose={() => setSmartEdit(null)} onSave={(name, rules) => {
    if (smartEdit === "new") {
      const made = api.create(name, [], rules);
      if ("problem" in made) return made.problem;
      setOpenId(made.playlist.id);
      announce({ title: "Smart playlist created", subtitle: name });
      return null;
    }
    return api.rename(smartEdit.id, name) ?? api.editSmart(smartEdit.id, rules);
  }} />;

  if (!open) {
    return (
      <><div className="lib-scroll">
        <div className="lib-tools"><button className="btn small" disabled={!api.loaded} onClick={() => setSmartEdit("new")}>New smart playlist</button></div>
        {api.playlists.length === 0 ? (
          <div className="empty" style={{ minHeight: 200 }}>
            <div className="big">
              <ListMusic className="w-14 h-14" strokeWidth={1.25} />
            </div>
            <h2>{api.loaded ? "No playlists yet" : "Reading your playlists…"}</h2>
            <p className="m-0">Use “Add to playlist” on a song or an album to start one.</p>
          </div>
        ) : (
          <ul className="artist-list" aria-label="Playlists">
            {resolved.map((p) => (
              <li key={p.id}>
                <button type="button" className="artist-row" aria-label={`Open ${p.name}`} onClick={() => setOpenId(p.id)}>
                  <b className="truncate">{p.name}</b>
                  <span className="dim">{p.smart ? "Smart · " : ""}{count(p.paths.length)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>{smartDialog}</>
    );
  }

  const found = open.paths.flatMap((path) => {
    const t = byPath.get(path);
    return t && !t.missing ? [t] : [];
  });
  const missing = open.paths.length - found.length;
  const total = found.reduce((s, t) => s + (t.duration > 0 ? t.duration : 0), 0);

  const exportIt = async () => {
    try {
      const target = await saveDialog({ title: "Export playlist", defaultPath: m3uFileName(open.name), filters: [{ name: "Playlist", extensions: ["m3u8"] }] });
      if (!target) return;
      await exportText(
        target,
        toM3u(open, (path) => {
          const t = byPath.get(path);
          return t ? { title: t.title, artist: t.artist || undefined, duration: t.duration } : undefined;
        }),
      );
      announce({ title: "Playlist exported", subtitle: open.name });
    } catch (e) {
      flash(errorText(e), true);
    }
  };

  const back = () => {
    setOpenId(null);
    setConfirmDelete(false);
  };

  return (
    <><div className="lib-scroll">
      <div className="album-detail">
        <div className="flex flex-col gap-1.5 min-w-0">
          <button type="button" className="btn small w-fit" onClick={back}>
            <ArrowLeft className="w-3 h-3" /> Back to playlists
          </button>
          <h2 className="m-0 text-[18px] truncate">{open.name}</h2>
          <div className="dim">
            {count(open.paths.length)}
            {total > 0 ? ` · ${formatClock(total)}` : ""}
            {missing > 0 ? ` · ${missing} not in the library now` : ""}
          </div>
          {open.smart && <p className="dim">Smart playlist · automatically matches {open.smart.match === "all" ? "all" : "any"} of {open.smart.rules.length} rules. Up to 5,000 available songs, sorted by title.</p>}
          <div className="flex gap-2 flex-wrap">
            {open.smart && <button className="btn small" onClick={() => setSmartEdit(open)}>Edit rules</button>}
            <button type="button" className="btn small primary" disabled={found.length === 0} onClick={() => onPlay(found)}>
              <Play className="w-3 h-3" /> Play playlist
            </button>
            <button type="button" className="btn small" disabled={found.length === 0} onClick={() => onNext(found)}>
              <ListStart className="w-3 h-3" /> Play next
            </button>
            <button type="button" className="btn small" disabled={found.length === 0} onClick={() => onAdd(found)}>
              <ListEnd className="w-3 h-3" /> Add to queue
            </button>
            <button type="button" className="btn small" onClick={() => setRenaming(true)}>
              <Pencil className="w-3 h-3" /> Rename
            </button>
            <button type="button" className="btn small" disabled={open.paths.length === 0} onClick={() => void exportIt()}>
              <Download className="w-3 h-3" /> Export .m3u8
            </button>
            {confirmDelete ? (
              <>
                <button
                  type="button"
                  className="btn small danger"
                  onClick={() => {
                    api.remove(open.id);
                    back();
                    announce({ title: "Playlist deleted", subtitle: open.name });
                  }}
                >
                  Yes, delete it
                </button>
                <button type="button" className="btn small" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className="btn small" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="w-3 h-3" /> Delete playlist
              </button>
            )}
          </div>
        </div>
        {open.paths.length === 0 ? (
          <p className="dim">{open.smart ? "No songs match these rules. Edit the rules or add more music to your library." : "This playlist is empty. Add songs from the Songs or Albums view."}</p>
        ) : (
          <ol className="album-tracks" aria-label="Tracks">
            {open.paths.map((path, i) => {
              const t = byPath.get(path);
              const title = t?.title ?? baseName(path);
              return (
                <li key={path} className="lib-row album-track">
                  <span className="num dim mono">{i + 1}</span>
                  {t && !t.missing ? (
                    <button type="button" className="lib-title link truncate" aria-label={`Play ${title}`} onClick={() => onPlay(found.slice(found.indexOf(t)))}>
                      {title}
                    </button>
                  ) : (
                    <span className="truncate dim" title="This file is no longer in the library">
                      {title} (missing)
                    </span>
                  )}
                  <span className="num mono">{t && t.duration > 0 ? formatClock(t.duration) : ""}</span>
                  {!open.smart && <span className="lib-actions">
                    <button type="button" className="row-btn" aria-label={`Move ${title} up`} disabled={i === 0} onClick={() => api.move(open.id, i, i - 1)}>
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button type="button" className="row-btn" aria-label={`Move ${title} down`} disabled={i === open.paths.length - 1} onClick={() => api.move(open.id, i, i + 1)}>
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button type="button" className="row-btn" aria-label={`Remove ${title} from the playlist`} onClick={() => api.removeTrack(open.id, i)}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>}
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {renaming && <RenameSheet playlist={open} onRename={(name) => api.rename(open.id, name)} onClose={() => setRenaming(false)} />}
    </div>{smartDialog}</>
  );
}

function RenameSheet({ playlist, onRename, onClose }: { playlist: Playlist; onRename: (name: string) => string | null; onClose: () => void }) {
  const [name, setName] = useState(playlist.name);
  const [problem, setProblem] = useState<string | null>(null);
  const unchanged = !name.trim() || name.trim() === playlist.name;
  const save = () => {
    const p = onRename(name);
    setProblem(p);
    if (!p) onClose();
  };
  return (
    <Sheet
      title="Rename playlist"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={unchanged} onClick={save}>
            Rename
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!unchanged) save();
        }}
      >
        <input
          className="field"
          aria-label="Playlist name"
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setProblem(null);
          }}
        />
        {problem && (
          <span role="alert" style={{ color: "#b3261e" }}>
            {problem}
          </span>
        )}
      </form>
    </Sheet>
  );
}
