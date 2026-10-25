import { useState } from "react";
import { usePlaybackTools } from "../hooks/usePlaybackTools";
import type { ListeningSession } from "../lib/listeningSessions";
import { formatClock } from "../lib/format";
import Sheet from "./Sheet";
import PlaylistPicker from "./PlaylistPicker";

export default function ListeningSessions() {
  const tools = usePlaybackTools(); const playlists = tools?.playlists;
  const [editing, setEditing] = useState<ListeningSession | null>(null), [name, setName] = useState("");
  const [adding, setAdding] = useState<ListeningSession | null>(null), [problem, setProblem] = useState("");
  const [confirmClear, setConfirmClear] = useState(false), [notice, setNotice] = useState("");
  if (!tools) return null;
  const api = tools.sessions;
  const paths = adding ? adding.player.queue.map((t) => t.path) : [];
  return <section aria-label="Listening sessions" className="session-history">
    <div className="flex gap-2 flex-wrap items-center"><h3 className="m-0 flex-1">Listening sessions</h3><button className="btn small" disabled={!api.loaded} onClick={api.saveCurrent}>Save current session</button><button className="btn small" disabled={!api.sessions.length} onClick={() => setConfirmClear(true)}>Clear session history</button></div>
    <p className="dim">Keeps your latest 30 sessions, with up to 500 queued tracks around the current song in each. A new queue or a 30-minute listening break starts a session. Restoring replaces the current queue and stays paused.</p>
    {confirmClear && <div className="flex gap-2 flex-wrap" role="group" aria-label="Clear session history confirmation"><span>Clear saved sessions? Music files, playlists and listening statistics are kept.</span><button className="btn small" onClick={() => { api.clear(); setConfirmClear(false); }}>Clear saved sessions</button><button className="btn small" onClick={() => setConfirmClear(false)}>Cancel</button></div>}
    {notice && <p role="status">{notice}</p>}
    {!api.loaded ? <p role="status">Reading sessions…</p> : !api.sessions.length ? <p>Play music to start a session, or save a paused queue.</p> : <ol className="session-list">{api.sessions.map((s) => <li key={s.id} className="session-item">
      <div className="min-w-0"><b className="block truncate">{s.name}</b><span className="dim">{new Date(s.updated).toLocaleString()} · {s.player.queue.length} tracks · {formatClock(s.seconds)} listened</span><span className="block dim truncate">{s.player.queue[s.player.index]?.title} at {formatClock(s.player.position)}{s.omitted ? ` · ${s.omitted} tracks outside the snapshot` : ""}</span></div>
      <div className="flex gap-2 flex-wrap"><button className="btn small" aria-label={`Restore session ${s.name}`} onClick={() => { api.restore(s.id); setNotice(`Restored ${s.name}, paused. Press Play when ready. Missing files offer playback recovery.`); }}>Restore paused</button>
        <button className="btn small" disabled={!playlists?.loaded} aria-label={`Save session ${s.name} as playlist`} onClick={() => setAdding(s)}>Save as playlist</button>
        <button className="btn small" aria-label={`Rename session ${s.name}`} onClick={() => { setEditing(s); setName(s.name); setProblem(""); }}>Rename</button>
        <button className="btn small" aria-label={`Remove session ${s.name}`} onClick={() => api.remove(s.id)}>Remove</button></div>
    </li>)}</ol>}
    {editing && <Sheet title="Rename listening session" onClose={() => setEditing(null)}><form className="flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); const error = api.rename(editing.id, name); if (error) setProblem(error); else setEditing(null); }}><input className="field" aria-label="Session name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /><button className="btn">Save session name</button>{problem && <span role="alert">{problem}</span>}</form></Sheet>}
    {adding && playlists && <PlaylistPicker what={adding.name} playlists={playlists.playlists.filter((p) => !p.smart)} onClose={() => setAdding(null)} onPick={(id) => { const added = playlists.add(id, paths); setNotice(`Added ${added} tracks to the playlist.`); setAdding(null); }} onCreate={(name) => { const result = playlists.create(name, paths); if ("problem" in result) return result.problem; setNotice(`Saved ${result.playlist.name}.`); setAdding(null); return null; }} />}
  </section>;
}
