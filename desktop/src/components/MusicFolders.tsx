import { useState } from "react";
import type { LibraryManagement } from "../hooks/useLibrary";
import Sheet from "./Sheet";

export default function MusicFolders({ management: m, onClose }: { management: LibraryManagement; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } finally { setBusy(false); } };
  return <Sheet title="Music folders" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>} wide>
    <p>Files stay in their existing folders. Adding a folder lets Kaisu play and edit its music. Automatic download cleanup does not delete imported music.</p>
    <button className="btn" disabled={busy} onClick={() => void run(m.addFolder)}>Add music folder</button>
    <ul className="music-folders" aria-label="Imported music folders">{m.folders.map((folder) => <li key={folder.path}>
      <span className="flex-1 min-w-0 selectable break-words">{folder.path}<span className="block dim">{folder.available ? "Available" : "Folder missing or drive disconnected"}</span></span>
      <button className="btn small" disabled={busy} aria-label={`Remove folder ${folder.path}`} onClick={() => void run(() => m.removeFolder(folder.path))}>Remove from library</button>
    </li>)}</ul>
    {m.folders.length === 0 && <p className="dim">Your download folders are already included. Add other folders to import your existing collection.</p>}
    <label className="flex items-center gap-2"><input type="checkbox" checked={m.watching} onChange={(e) => m.setWatching(e.target.checked)} />Watch music folders for changes</label>
    <p className="dim">Checks every 15 seconds while Kaisu is open, and when you return to the window. Missing files stay listed so you can locate them. Removing a folder from the library keeps its files.</p>
  </Sheet>;
}
