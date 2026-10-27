import { useEffect, useMemo, useRef, useState } from "react";
import { errorText, identifyCover, identifyDetails, identifySearch, type ArtworkChoice, type EditResult, type LibTrack } from "../lib/api";
import { chooseMatch, estimateSeconds, MAX_BULK, proposedEdit, type Confidence } from "../lib/bulkIdentify";
import { baseName } from "../lib/mediaKind";
import { LABEL, FIELDS, startForm, type Field, type TagEditRequest } from "../lib/tagEdit";
import { tagKeys } from "../lib/identification";
import Sheet from "./Sheet";

interface Row { track: LibTrack; edit: TagEditRequest; confidence: Confidence; score: number; found: string; releaseId: string | null; cover: boolean }
type Stage = "idle" | "looking" | "review" | "applying" | "done";

const changed = (edit: TagEditRequest) => FIELDS.filter((f) => edit[tagKeys[f]] !== undefined);
const clock = (s: number) => (s < 90 ? `${s} seconds` : `${Math.round(s / 60)} minutes`);

/** Looks up many songs on MusicBrainz, shows every proposed change, and writes only the rows the user ticks. */
export default function BulkIdentify({ tracks, onEdit, onClose }: { tracks: LibTrack[]; onEdit: (paths: string[], edit: TagEditRequest) => Promise<EditResult[]>; onClose: () => void }) {
  const queue = useMemo(() => tracks.filter((t) => !t.missing).slice(0, MAX_BULK), [tracks]);
  const [allowed, setAllowed] = useState(false);
  const [covers, setCovers] = useState<"none" | "missing" | "all">("missing");
  const [stage, setStage] = useState<Stage>("idle");
  const [done, setDone] = useState(0);
  const [current, setCurrent] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [unmatched, setUnmatched] = useState<Array<{ track: LibTrack; reason: string }>>([]);
  const [ticked, setTicked] = useState(new Set<string>());
  const [problem, setProblem] = useState("");
  const [failures, setFailures] = useState<EditResult[]>([]);
  const [saved, setSaved] = useState(0);
  const [coverNotes, setCoverNotes] = useState<string[]>([]);
  const run = useRef(0);
  useEffect(() => () => { run.current++; }, []);

  const start = async () => {
    const token = ++run.current;
    const preferred = new Set<string>();
    const found: Row[] = [];
    const missed: Array<{ track: LibTrack; reason: string }> = [];
    setStage("looking"); setProblem(""); setRows([]); setUnmatched([]); setDone(0);
    for (const track of queue) {
      if (token !== run.current) return;
      setCurrent(track.title || baseName(track.path));
      try {
        const title = (track.title || baseName(track.path).replace(/\.[^.]+$/, "")).slice(0, 200);
        const match = chooseMatch(await identifySearch(track.path, title, track.artist.slice(0, 200), allowed), track, preferred);
        if (token !== run.current) return;
        if (!match) missed.push({ track, reason: "No match found" });
        else {
          const tags = await identifyDetails(track.path, match.candidate.id, match.releaseId, allowed);
          if (token !== run.current) return;
          if (match.releaseId) preferred.add(match.releaseId);
          const edit = proposedEdit(track, tags);
          const cover = !!match.releaseId && (covers === "all" || (covers === "missing" && !track.has_cover));
          if (changed(edit).length === 0 && !cover) missed.push({ track, reason: "Already matches" });
          else found.push({ track, edit, confidence: match.confidence, score: match.candidate.score, found: `${match.candidate.title} — ${match.candidate.artist}`, releaseId: match.releaseId, cover });
        }
      } catch (e) {
        if (token !== run.current) return;
        const message = errorText(e);
        // A busy or unreachable service will fail every remaining song the same way.
        if (/busy|reach|consent|Allow/i.test(message)) { setProblem(message); break; }
        missed.push({ track, reason: message });
      }
      setDone((n) => n + 1);
    }
    if (token !== run.current) return;
    setRows(found); setUnmatched(missed);
    setTicked(new Set(found.filter((r) => r.confidence === "high").map((r) => r.track.path)));
    setStage("review");
  };
  const stop = () => { run.current++; setStage("idle"); };

  const apply = async () => {
    const token = ++run.current;
    setStage("applying"); setFailures([]);
    let ok = 0;
    const bad: EditResult[] = [];
    const notes: string[] = [];
    // Songs of one release are saved together so a single download of its cover is reused (the backend keeps only a few).
    const chosen = rows.filter((r) => ticked.has(r.track.path)).sort((a, b) => (a.releaseId ?? "").localeCompare(b.releaseId ?? ""));
    let fetched: { release: string; artwork: ArtworkChoice | null } | null = null;
    for (const row of chosen) {
      if (token !== run.current) return;
      try {
        let edit = row.edit;
        if (row.cover && row.releaseId) {
          if (fetched?.release !== row.releaseId) {
            const release: string = row.releaseId;
            fetched = { release, artwork: await identifyCover(row.track.path, release, allowed).catch(() => null) };
          }
          if (fetched.artwork) edit = { ...edit, artwork: { action: "replace", token: fetched.artwork.token } };
          else notes.push(`${row.track.title || baseName(row.track.path)}: no front cover was available`);
        }
        if (Object.keys(edit).length === 0) continue;
        const [result] = await onEdit([row.track.path], edit);
        if (result?.ok) ok++;
        else bad.push(result ?? { path: row.track.path, ok: false, error: "No result", track: null });
      } catch (e) { bad.push({ path: row.track.path, ok: false, error: errorText(e), track: null }); }
    }
    if (token !== run.current) return;
    setSaved(ok); setFailures(bad); setCoverNotes(notes); setStage("done");
  };
  const toggle = (path: string, on: boolean) => setTicked((old) => { const next = new Set(old); if (on) next.add(path); else next.delete(path); return next; });
  const before = (row: Row, f: Field) => startForm([row.track]).values[f] || "—";

  return <Sheet title="Auto-tag songs" onClose={onClose} wide footer={<>
    <button type="button" className="btn" onClick={onClose}>{stage === "done" ? "Close" : "Cancel"}</button>
    {stage === "review" && <button type="button" className="btn primary" disabled={ticked.size === 0} onClick={() => void apply()}>Apply to {ticked.size} song{ticked.size === 1 ? "" : "s"}</button>}
  </>}>
    {(stage === "idle" || stage === "looking") && <>
      <p>Look up {queue.length} song{queue.length === 1 ? "" : "s"} on MusicBrainz and propose tags. Nothing is written until you review the changes. {tracks.length > MAX_BULK && `Only the first ${MAX_BULK} of ${tracks.length} selected songs are included in one run.`}</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={allowed} disabled={stage === "looking"} onChange={(e) => setAllowed(e.target.checked)} />Allow sending each song's title and artist to MusicBrainz, and release IDs to the Cover Art Archive for covers. Audio files and file paths stay on this computer.</label>
      <label className="block my-2">Front covers<select className="field block" aria-label="Front covers" value={covers} disabled={stage === "looking"} onChange={(e) => setCovers(e.target.value as typeof covers)}><option value="missing">Add to songs without a cover</option><option value="all">Replace every cover</option><option value="none">Leave covers alone</option></select></label>
      <p className="dim">MusicBrainz allows one request per second, so this takes about {clock(estimateSeconds(queue.length))}.</p>
      {stage === "idle" && <button type="button" className="btn primary" disabled={!allowed || queue.length === 0} onClick={() => void start()}>Look up {queue.length} song{queue.length === 1 ? "" : "s"}</button>}
      {stage === "looking" && <div><p role="status">Looking up {Math.min(done + 1, queue.length)} of {queue.length}: {current}</p><progress max={queue.length} value={done} aria-label="Lookup progress" /> <button type="button" className="btn small" onClick={stop}>Stop</button></div>}
      {problem && <p role="alert">{problem}</p>}
    </>}
    {stage === "review" && <>
      {problem && <p role="alert">{problem} Showing what was found before it stopped.</p>}
      <p>{rows.length} song{rows.length === 1 ? "" : "s"} with suggested changes. Close matches are ticked; check the others yourself before ticking them.</p>
      {rows.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left" aria-label="Proposed tag changes"><thead><tr><th>Use</th><th>Song</th><th>Changes</th><th>Match</th></tr></thead><tbody>{rows.map((row) => <tr key={row.track.path}>
        <td><input type="checkbox" aria-label={`Apply changes to ${row.track.title || baseName(row.track.path)}`} checked={ticked.has(row.track.path)} onChange={(e) => toggle(row.track.path, e.target.checked)} /></td>
        <td className="break-words">{row.track.title || baseName(row.track.path)}<div className="dim">{row.track.artist}</div></td>
        <td className="break-words">{changed(row.edit).map((f) => <div key={f}>{LABEL[f]}: <span className="dim">{before(row, f)}</span> → {row.edit[tagKeys[f]] || "(removed)"}</div>)}{row.cover && <div>Front cover: <span className="dim">{row.track.has_cover ? "embedded" : "none"}</span> → Cover Art Archive (fetched when you apply)</div>}</td>
        <td>{row.confidence === "high" ? "Close match" : "Check carefully"} <span className="dim">· {row.score}/100<br />{row.found}</span></td>
      </tr>)}</tbody></table></div>}
      {unmatched.length > 0 && <details><summary>{unmatched.length} song{unmatched.length === 1 ? "" : "s"} left unchanged</summary><ul>{unmatched.map((u) => <li key={u.track.path}>{u.track.title || baseName(u.track.path)} — {u.reason}</li>)}</ul></details>}
    </>}
    {stage === "applying" && <p role="status">Saving tags…</p>}
    {stage === "done" && <>
      <p role="status">Updated {saved} song{saved === 1 ? "" : "s"}.{failures.length > 0 && ` ${failures.length} could not be changed.`}</p>
      {coverNotes.length > 0 && <ul role="status" aria-label="Cover notes">{coverNotes.map((n) => <li key={n}>{n}</li>)}</ul>}
      {failures.length > 0 && <ul role="alert">{failures.map((f) => <li key={f.path}>{baseName(f.path)} — {f.error}</li>)}</ul>}
    </>}
  </Sheet>;
}
