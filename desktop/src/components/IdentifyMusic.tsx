import { useEffect, useRef, useState } from "react";
import { errorText, identifyCover, identifyDetails, identifySearch, libraryArtworkPreview, libraryDiscardArtwork, type ArtworkChoice } from "../lib/api";
import { identificationEdit, suggestedForm, type IdentificationCandidate, type SuggestedTags } from "../lib/identification";
import { FIELDS, LABEL, type Field, type TagEditRequest, type TagForm } from "../lib/tagEdit";
import { formatClock } from "../lib/format";
import Sheet from "./Sheet";

export default function IdentifyMusic({ path, current, duration, onUse, onClose }: {
  path: string; current: TagForm; duration: number;
  onUse: (edit: TagEditRequest, artwork?: ArtworkChoice) => void; onClose: () => void;
}) {
  const [title, setTitle] = useState(current.title);
  const [artist, setArtist] = useState(current.artist);
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<IdentificationCandidate[]>([]);
  const [editions, setEditions] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<SuggestedTags | null>(null);
  const [release, setRelease] = useState<string | null>(null);
  const [selected, setSelected] = useState(new Set<Field>());
  const [cover, setCover] = useState<(ArtworkChoice & { url: string }) | null>(null);
  const coverRef = useRef<typeof cover>(null);
  const request = useRef(0);
  const dropCover = () => { const old = coverRef.current; coverRef.current = null; if (old) { URL.revokeObjectURL(old.url); void libraryDiscardArtwork(old.token).catch(() => {}); } setCover(null); };
  useEffect(() => () => { request.current++; const old = coverRef.current; if (old) { URL.revokeObjectURL(old.url); void libraryDiscardArtwork(old.token).catch(() => {}); } }, []);
  const search = async () => {
    const token = ++request.current; setBusy(true); setError(""); setTags(null); setResults([]); setSearched(false); dropCover();
    try { const found = await identifySearch(path, title, artist, allowed); if (token === request.current) { setResults(found); setSearched(true); } }
    catch (e) { if (token === request.current) setError(errorText(e)); }
    finally { if (token === request.current) setBusy(false); }
  };
  const review = async (candidate: IdentificationCandidate) => {
    const token = ++request.current; const releaseId = editions[candidate.id] ?? candidate.releases[0]?.id ?? "";
    setBusy(true); setError(""); setTags(null); dropCover();
    try {
      const proposed = await identifyDetails(path, candidate.id, releaseId || null, allowed);
      if (token !== request.current) return;
      const form = suggestedForm(proposed);
      setSelected(new Set(FIELDS.filter((f) => form[f] !== undefined && form[f] !== current[f].trim())));
      setTags(proposed); setRelease(releaseId || null);
    } catch (e) { if (token === request.current) setError(errorText(e)); }
    finally { if (token === request.current) setBusy(false); }
  };
  const artwork = async () => {
    if (!release) return;
    const token = ++request.current; setBusy(true); setError(""); let chosen: ArtworkChoice | undefined;
    try {
      chosen = await identifyCover(path, release, allowed);
      const bytes = await libraryArtworkPreview(chosen.token);
      if (token !== request.current) { void libraryDiscardArtwork(chosen.token); return; }
      dropCover(); const next = { ...chosen, url: URL.createObjectURL(new Blob([bytes])) }; coverRef.current = next; setCover(next);
    } catch (e) { if (chosen) void libraryDiscardArtwork(chosen.token).catch(() => {}); if (token === request.current) setError(errorText(e)); }
    finally { if (token === request.current) setBusy(false); }
  };
  const edit = tags ? identificationEdit(current, tags, selected) : {};
  const use = () => {
    const chosen = coverRef.current;
    if (chosen) { coverRef.current = null; URL.revokeObjectURL(chosen.url); }
    onUse({ ...edit, ...(chosen ? { artwork: { action: "replace", token: chosen.token } as const } : {}) }, chosen ?? undefined);
  };
  const proposed = tags ? suggestedForm(tags) : {};
  return <Sheet title="Identify music" onClose={onClose} wide footer={<>
    <button type="button" className="btn" onClick={onClose}>Cancel</button>
    <button type="button" className="btn primary" disabled={busy || !tags || (!Object.keys(edit).length && !cover)} onClick={use}>Use selected changes</button>
  </>}>
    <p>Search MusicBrainz using the title and artist. Review the recording and release edition before choosing changes. Search scores indicate relevance, not a guaranteed match.</p>
    <label className="flex items-start gap-2"><input type="checkbox" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} />Allow sending the entered title and artist to MusicBrainz, and selected release IDs to the Cover Art Archive for artwork. Audio files and local file paths stay on this computer.</label>
    <div className="grid gap-2 my-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
      <label>Song title<input className="field w-full" aria-label="Identification title" maxLength={200} value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Artist (optional)<input className="field w-full" aria-label="Identification artist" maxLength={200} value={artist} disabled={busy} onChange={(e) => setArtist(e.target.value)} /></label>
    </div>
    <button type="button" className="btn" disabled={!allowed || !title.trim() || busy} onClick={() => void search()}>{busy ? "Looking up music…" : "Search MusicBrainz"}</button>
    {duration > 0 && <p className="dim">Your file: {formatClock(duration)}</p>}
    {error && <p role="alert">{error}</p>}
    {searched && results.length === 0 && <p role="status">No matches found. Try a shorter title or a different artist.</p>}
    {results.length > 0 && <ul className="list-none p-0 flex flex-col gap-2" aria-label="Identification matches">{results.map((candidate) => <li key={candidate.id} className="p-2 border rounded">
      <b>{candidate.title}</b> — {candidate.artist || "Artist unavailable"}
      <p className="dim m-0">Search score {candidate.score}/100{candidate.duration != null ? ` · ${formatClock(candidate.duration)}` : ""}{candidate.duration != null && duration > 0 && Math.abs(duration - candidate.duration) > 10 ? " · Different duration: check the version carefully" : ""}</p>
      <div className="flex flex-wrap gap-2 mt-1">
        <select className="field max-w-full" aria-label={`Release edition for ${candidate.title}`} disabled={busy} value={editions[candidate.id] ?? candidate.releases[0]?.id ?? ""} onChange={(e) => setEditions((old) => ({ ...old, [candidate.id]: e.target.value }))}>
          {candidate.releases.map((r) => <option key={r.id} value={r.id}>{[r.title, r.date, r.country, r.edition].filter(Boolean).join(" · ")}</option>)}
          <option value="">Recording only (keep album details)</option>
        </select>
        <button type="button" className="btn small" disabled={busy || !allowed} aria-label={`Review ${candidate.title}`} onClick={() => void review(candidate)}>Review match</button>
      </div>
    </li>)}</ul>}
    {tags && <section aria-label="Proposed tag changes">
      <h3>Review changes</h3><p>Only checked fields will be placed in the tag editor. Your file changes when you save that editor.</p>
      <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Use</th><th>Field</th><th>Current</th><th>Suggested</th></tr></thead><tbody>{FIELDS.filter((f) => proposed[f] !== undefined).map((f) => <tr key={f}>
        <td><input type="checkbox" aria-label={`Use suggested ${LABEL[f]}`} checked={selected.has(f)} disabled={proposed[f] === current[f].trim() || busy} onChange={(e) => setSelected((old) => { const next = new Set(old); e.target.checked ? next.add(f) : next.delete(f); return next; })} /></td>
        <th>{LABEL[f]}</th><td className="break-words">{current[f] || "—"}</td><td className="break-words">{proposed[f]}</td>
      </tr>)}</tbody></table></div>
      {release && <div className="mt-3"><button type="button" className="btn small" disabled={!allowed || busy} onClick={() => void artwork()}>Preview release cover</button>{cover && <div className="flex items-center gap-2 mt-2"><img src={cover.url} alt="Suggested front cover" width={96} height={96} /><span>This front cover will replace the embedded artwork when saved.</span><button type="button" className="btn small" onClick={dropCover}>Keep current cover</button></div>}</div>}
    </section>}
  </Sheet>;
}
