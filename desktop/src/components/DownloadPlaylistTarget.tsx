import { useState } from "react";
import type { PlaylistsApi } from "../hooks/usePlaylists";
import PlaylistPicker from "./PlaylistPicker";

export default function DownloadPlaylistTarget({ api, value, onChange }: { api: PlaylistsApi; value: string; onChange: (id: string) => void }) {
  const [choosing, setChoosing] = useState(false);
  const selected = api.playlists.find((p) => p.id === value && !p.smart);
  return <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full" aria-label="Audio download playlist">
    <span className="dim">After audio downloads:</span>
    <button className="btn small max-w-full truncate" disabled={!api.loaded} onClick={() => setChoosing(true)}>{selected ? `Add to ${selected.name}` : "Choose a library playlist…"}</button>
    {value && <button className="btn small" onClick={() => onChange("")}>No playlist</button>}
    {selected && <span className="dim">Added after the file is verified.</span>}
    {choosing && <PlaylistPicker what="finished audio downloads" playlists={api.playlists.filter((p) => !p.smart)} onClose={() => setChoosing(false)}
      onPick={(id) => { onChange(id); setChoosing(false); }} onCreate={(name) => {
        const result = api.create(name);
        if ("problem" in result) return result.problem;
        onChange(result.playlist.id); setChoosing(false); return null;
      }} />}
  </div>;
}
