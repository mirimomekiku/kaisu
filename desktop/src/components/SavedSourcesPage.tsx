import { useState } from "react";
import { Bookmark, RefreshCw } from "lucide-react";
import { AUDIO_FORMAT_IDS, audioFormatName, lossyEncodeNote } from "../lib/audioFormats";
import type { SavedSourcesApi } from "../hooks/useSavedSources";
import type { PlaylistsApi } from "../hooks/usePlaylists";
import type { SavedSource } from "../lib/savedSources";
import type { AudioFormat, Preset } from "../lib/api";
import DownloadPlaylistTarget from "./DownloadPlaylistTarget";
import PageHeading from "./PageHeading";

export default function SavedSourcesPage({ api, playlists, ready, onOpen }: { api: SavedSourcesApi; playlists: PlaylistsApi; ready: boolean; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState("");
  return <section className="page" aria-label="Saved sources">
    <PageHeading title="Saved sources" description="Keep channels and playlists here. Check for new items, then choose what to download." />
    <form className="flex gap-2 flex-wrap p-3" onSubmit={async (e) => { e.preventDefault(); if (await api.save(url)) setUrl(""); }}>
      <input className="field flex-1 min-w-0" aria-label="Channel or playlist link" placeholder="Paste a channel or playlist link" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button className="btn primary" disabled={!ready || !api.loaded || !!api.working || !url.trim()}>Save source</button>
      <button type="button" className="btn" disabled={!ready || !!api.working || !api.sources.length} onClick={() => void api.check()}><RefreshCw className="w-3 h-3" /> Check all</button>
    </form>
    <p className="px-3 dim">Checks run only when you ask. Each check reads up to 500 items; older items outside that range may not be detected. Downloads use your current destination and the choices saved below.</p>
    {!api.loaded ? <p className="p-3" role="status">Reading saved sources…</p> : api.sources.length === 0 ? <div className="empty"><Bookmark className="w-12 h-12" /><h2>No saved sources yet</h2><p>Save a channel or playlist from Search, or paste its link above.</p></div> : api.sources.map((source) => <SourceCard key={source.id} source={source} api={api} playlists={playlists} ready={ready} onOpen={onOpen} />)}
  </section>;
}

function SourceCard({ source, api, playlists, ready, onOpen }: { source: SavedSource; api: SavedSourcesApi; playlists: PlaylistsApi; ready: boolean; onOpen: (url: string) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const available = source.pending.filter((e) => !e.live);
  const picked = available.filter((e) => selected.has(e.url)).map((e) => e.url);
  const all = available.length > 0 && picked.length === available.length;
  return <article className="saved-source p-3 m-3 flex flex-col gap-2" aria-label={source.title}>
    <div className="flex gap-2 items-center flex-wrap"><h2 className="m-0 text-[15px] flex-1 min-w-0 truncate">{source.title}</h2>
      <button className="btn small" onClick={() => onOpen(source.url)}>Open in Search</button>
      <button className="btn small" disabled={!ready || !!api.working} onClick={() => void api.check(source.id)}>{api.working === source.id ? "Working…" : "Check for new items"}</button>
      <button className="btn small" onClick={() => setRemoving(!removing)}>Remove source</button>
    </div>
    {removing && <div className="flex gap-2 items-center flex-wrap" role="group" aria-label="Confirm source removal"><span>Remove this saved source and its review list? Downloaded files are kept.</span><button className="btn small" onClick={() => api.remove(source.id)}>Remove saved source</button><button className="btn small" onClick={() => setRemoving(false)}>Cancel</button></div>}
    <span className="dim selectable break-all">{source.url}</span>
    <span className="dim">{source.pending.length} item{source.pending.length === 1 ? "" : "s"} to review · {source.checked ? `Last checked ${new Date(source.checked).toLocaleString()}` : "Not checked yet"}{source.total && source.total > 500 ? ` · Showing the first 500 of ${source.total}` : ""}</span>
    <div className="flex gap-2 items-center flex-wrap">
      <label>Download as <select className="field" aria-label={`Download format for ${source.title}`} value={source.preset} onChange={(e) => api.update(source.id, { preset: e.target.value as Preset })}>
        <option value="best">Best video</option><option value="p1080">1080p video</option><option value="p720">720p video</option><option value="audio">Audio only</option>
      </select></label>
      {source.preset === "audio" && <><label>Audio format <select className="field" aria-label={`Audio format for ${source.title}`} value={source.audioFormat} onChange={(e) => api.update(source.id, { audioFormat: e.target.value as AudioFormat })}>{AUDIO_FORMAT_IDS.map((format) => <option key={format} value={format}>{audioFormatName(format)}</option>)}</select></label>
        {lossyEncodeNote(source.audioFormat) && <p className="pref-hint m-0" role="note">{lossyEncodeNote(source.audioFormat)}</p>}
        <DownloadPlaylistTarget api={playlists} value={source.playlistId} onChange={(playlistId) => api.update(source.id, { playlistId })} /></>}
    </div>
    {api.errors[source.id] && <p role="alert">Could not check this source: {api.errors[source.id]} Your review list has been kept.</p>}
    {source.pending.length > 0 && <>
      <div className="flex gap-2 items-center flex-wrap"><label><input type="checkbox" aria-label={`Select all items from ${source.title}`} checked={all} onChange={() => setSelected(all ? new Set() : new Set(available.map((e) => e.url)))} /> Select all available items</label>
        <button className="btn small primary" disabled={!ready || !!api.working || !picked.length} onClick={() => void api.download(source.id, picked)}>Download selected ({picked.length})</button>
        <button className="btn small" disabled={!picked.length || !!api.working} onClick={() => { api.dismiss(source.id, picked); setSelected(new Set()); }}>Mark selected reviewed</button>
        <button className="btn small" disabled={!!api.working} onClick={() => { api.dismiss(source.id, source.pending.map((e) => e.url)); setSelected(new Set()); }}>Mark all reviewed</button>
      </div>
      <ul className="m-0 p-0" style={{ listStyle: "none", maxHeight: 300, overflowY: "auto" }} aria-label={`Review items from ${source.title}`}>
        {source.pending.map((entry) => <li key={entry.url} className="flex gap-2 items-center py-1"><input type="checkbox" aria-label={`Select ${entry.title}`} disabled={entry.live} checked={selected.has(entry.url)} onChange={() => setSelected((old) => { const next = new Set(old); next.has(entry.url) ? next.delete(entry.url) : next.add(entry.url); return next; })} /><span className="truncate flex-1">{entry.title}</span>{entry.live && <span className="dim">Live or upcoming · check again later</span>}</li>)}
      </ul>
    </>}
  </article>;
}
