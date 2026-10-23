import { useRef, useState } from "react";
import type { Playlist } from "../lib/playlists";
import type { PlaylistsApi } from "../hooks/usePlaylists";

export default function PlaylistCoverEditor({ playlist, api }: { playlist: Playlist; api: PlaylistsApi }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const choose = async (file?: File) => {
    if (!file) return;
    setError(""); setBusy(true);
    let bitmap: ImageBitmap | undefined;
    try {
      if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error("Choose a JPEG or PNG up to 8 MB.");
      bitmap = await createImageBitmap(file);
      if (bitmap.width > 4096 || bitmap.height > 4096) throw new Error("Choose an image up to 4096 pixels on each side.");
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
      const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Could not prepare the cover.");
      const side = Math.min(bitmap.width, bitmap.height);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 256, 256);
      ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
      api.setCover(playlist.id, canvas.toDataURL("image/jpeg", 0.75));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read the cover."); }
    finally { bitmap?.close(); setBusy(false); if (input.current) input.current.value = ""; }
  };
  return <div className="playlist-cover-editor">
    {playlist.cover && <img className="playlist-cover large" src={playlist.cover} alt={`Cover for ${playlist.name}`} />}
    <input ref={input} type="file" accept="image/jpeg,image/png" aria-label="Playlist cover image" hidden onChange={(e) => void choose(e.target.files?.[0])} />
    <button className="btn small" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Reading image…" : "Choose playlist cover"}</button>
    {playlist.cover && <button className="btn small" onClick={() => api.setCover(playlist.id)}>Remove cover</button>}
    {error && <span role="alert">{error}</span>}
  </div>;
}
