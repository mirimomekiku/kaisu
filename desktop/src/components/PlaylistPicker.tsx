import { useState } from "react";
import type { Playlist } from "../lib/playlists";
import Sheet from "./Sheet";

interface Props {
  /** What is being added, for the heading: a song title or "3 songs". */
  what: string;
  playlists: Playlist[];
  onPick: (id: string) => void;
  /** Makes a new playlist holding the songs; returns why not, or null. */
  onCreate: (name: string) => string | null;
  onClose: () => void;
}

/** Choose a playlist to add songs to, or start a new one. */
export default function PlaylistPicker({ what, playlists, onPick, onCreate, onClose }: Props) {
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <Sheet
      title="Add to playlist"
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="m-0 truncate">
          Adding <b>{what}</b>
        </p>
        {playlists.length > 0 && (
          <ul className="m-0 p-0 flex flex-col gap-1" style={{ listStyle: "none", maxHeight: 220, overflowY: "auto" }} aria-label="Your playlists">
            {playlists.map((p) => (
              <li key={p.id}>
                <button type="button" className="btn w-full justify-between" aria-label={`Add to ${p.name}`} onClick={() => onPick(p.id)}>
                  <span className="truncate">{p.name}</span>
                  <span className="dim">{p.paths.length}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex gap-2 items-start"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) setProblem(onCreate(name));
          }}
        >
          <span className="flex flex-col gap-0.5 flex-1 min-w-0">
            <input
              className="field"
              aria-label="New playlist name"
              aria-invalid={!!problem}
              placeholder="New playlist"
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
          </span>
          <button type="submit" className="btn primary" disabled={!name.trim()}>
            Create and add
          </button>
        </form>
      </div>
    </Sheet>
  );
}
