import { useEffect, useRef, useState } from "react";
import { libraryDuplicates, libraryRemoveDuplicates, errorText, type DuplicateGroup, type LibTrack } from "../lib/api";
import { formatBytes, formatClock } from "../lib/format";
import { baseName } from "../lib/mediaKind";
import { qualityLabel } from "../lib/library";
import { usePlayerEngine } from "../hooks/usePlayer";
import Sheet from "./Sheet";

export default function DuplicateFinder({ byPath, onChanged, onReveal, onClose }: { byPath: Map<string, LibTrack>; onChanged: () => void; onReveal: (path: string) => void; onClose: () => void }) {
  const player = usePlayerEngine();
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>({ done: 0, total: 0 });
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState("");
  const [keepers, setKeepers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<string | null>(null);
  const [permanent, setPermanent] = useState(false);
  const [removing, setRemoving] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let stale = false;
    void libraryDuplicates((done, total) => { if (!stale) setProgress({ done, total }); }).then((scan) => {
      if (stale) return;
      setGroups(scan.groups); setSkipped(scan.skipped); setProgress(null);
    }).catch((e) => { if (!stale) { setError(errorText(e)); setProgress(null); } });
    return () => { stale = true; alive.current = false; };
  }, []);
  const remove = async (group: DuplicateGroup) => {
    if (removing) return;
    const keep = keepers[group.hash] ?? group.paths[0];
    const paths = group.paths.filter((p) => p !== keep && selected.has(p));
    if (paths.length === 0) return;
    setRemoving(true); setError("");
    try {
      const results = await libraryRemoveDuplicates(keep, paths, group.hash, permanent);
      if (!alive.current) return;
      const removed = new Set(results.filter((r) => r.ok).map((r) => r.path));
      setGroups((old) => old.map((g) => ({ ...g, paths: g.paths.filter((p) => !removed.has(p)) })).filter((g) => g.paths.length > 1));
      setSelected((old) => new Set([...old].filter((p) => !removed.has(p))));
      setReview(null);
      setError(results.find((r) => !r.ok)?.error ?? "");
    } catch (e) { if (alive.current) setError(errorText(e)); }
    finally { onChanged(); if (alive.current) setRemoving(false); }
  };
  return <Sheet title="Find duplicate music" onClose={() => { if (!removing) onClose(); }} footer={<button className="btn primary" disabled={removing} onClick={onClose}>Done</button>} wide>
    <p>Only files with identical contents are grouped. Different encodings or different tags are not considered exact duplicates. Choose a copy to keep, then select up to 500 copies to remove at a time.</p>
    {progress ? <p role="status">Comparing files: {progress.done} of {progress.total}</p> : groups.length === 0 ? <p role="status">No exact duplicates found.</p> : <p>{groups.length} duplicate group{groups.length === 1 ? "" : "s"}</p>}
    {skipped > 0 && <p className="dim">{skipped} files could not be read or changed during comparison.</p>}
    {error && <p role="alert">{error}</p>}
    <label className="duplicate-method">Removal method<select className="field" aria-label="Duplicate removal method" disabled={removing} value={permanent ? "permanent" : "trash"} onChange={(e) => { setPermanent(e.target.value === "permanent"); setReview(null); }}><option value="trash">Recycle Bin or Trash</option><option value="permanent">Permanently delete</option></select></label>
    {groups.map((group, i) => {
      const keep = keepers[group.hash] ?? group.paths[0];
      const chosen = group.paths.filter((p) => p !== keep && selected.has(p));
      return <fieldset className="duplicate-group" key={group.hash} disabled={removing}><legend>Group {i + 1} · {formatBytes(group.size)} per copy</legend>
        {group.paths.map((path) => {
          const track = byPath.get(path);
          const title = track?.title ?? baseName(path);
          return <div className="duplicate-file" key={path}>
            <div className="flex gap-3"><label><input type="radio" name={`keeper-${group.hash}`} aria-label={`Keep ${path}`} checked={keep === path} onChange={() => { setKeepers((old) => ({ ...old, [group.hash]: path })); setSelected((old) => { const next = new Set(old); next.delete(path); return next; }); }} /> Keep</label>
              <label><input type="checkbox" aria-label={`Remove ${path}`} checked={selected.has(path)} disabled={keep === path || (!selected.has(path) && chosen.length >= 500)} onChange={(e) => setSelected((old) => { const next = new Set(old); if (e.target.checked) next.add(path); else next.delete(path); return next; })} /> Remove</label>
              <b>{title}</b></div>
            <div className="dim">{track ? `${track.artist || "Unknown artist"} · ${qualityLabel(track)} · ${formatClock(track.duration)} · ${new Date(track.modified * 1000).toLocaleDateString()}` : ""}</div>
            <div className="selectable break-words mono">{path}</div>
            <div className="flex gap-2"><button className="btn small" onClick={() => player?.play([{ path, title, artist: track?.artist }])}>Play copy</button><button className="btn small" onClick={() => onReveal(path)}>Show in folder</button></div>
          </div>;
        })}
        {review === group.hash ? <div className="duplicate-review" role="region" aria-label="Review duplicate removal">
          <p><b>Keep:</b> <span className="selectable break-words">{keep}</span></p>
          <p>{permanent ? "Permanently delete" : "Move to the Recycle Bin or Trash:"} {chosen.length} selected audio files ({formatBytes(chosen.length * group.size)})? Subtitles, lyrics and cover files will be kept. {permanent ? "This cannot be undone." : "Restore files from your system Recycle Bin or Trash. If recycling fails, the files stay in place."}</p>
          <ul>{chosen.map((p) => <li className="selectable break-words" key={p}>{p}</li>)}</ul>
          <button className="btn danger" disabled={chosen.length === 0 || removing} onClick={() => void remove(group)}>{permanent ? "Delete selected copies" : "Recycle selected copies"}</button> <button className="btn" disabled={removing} onClick={() => setReview(null)}>Cancel</button>
        </div> : <button className="btn small" disabled={chosen.length === 0} onClick={() => setReview(group.hash)}>Review removal ({chosen.length})</button>}
      </fieldset>;
    })}
  </Sheet>;
}
