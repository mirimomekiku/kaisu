import { useEffect, useMemo, useRef, useState } from "react";
import { albumReleaseSearch, albumReleaseTracks, errorText } from "../lib/api";
import { compareAlbum, type AlbumRelease, type AlbumTracklist } from "../lib/albumCompletion";
import type { Album } from "../lib/library";
import Sheet from "./Sheet";

const labels = { present: "Present", missing: "Missing", unavailable: "File unavailable", review: "Review match", conflict: "Conflicting title" };
export default function AlbumCompletion({ album, onClose, onSearch }: { album: Album; onClose: () => void; onSearch: (query: string) => void }) {
  const [title, setTitle] = useState(album.title); const [artist, setArtist] = useState(album.artist);
  const [allowed, setAllowed] = useState(false); const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<AlbumRelease[]>([]); const [searched, setSearched] = useState(false);
  const [tracklist, setTracklist] = useState<AlbumTracklist | null>(null); const [error, setError] = useState("");
  const request = useRef(0); useEffect(() => () => { request.current++; }, []);
  const anchor = album.tracks.find((t) => !t.missing)?.path;
  const comparison = useMemo(() => tracklist ? compareAlbum(tracklist.tracks, album.tracks) : null, [tracklist, album.tracks]);
  const search = async () => {
    if (!anchor) return; const token = ++request.current; setBusy(true); setError(""); setTracklist(null); setResults([]); setSearched(false);
    try { const found = await albumReleaseSearch(anchor, title, artist, allowed); if (token === request.current) { setResults(found); setSearched(true); } }
    catch (e) { if (token === request.current) setError(errorText(e)); }
    finally { if (token === request.current) setBusy(false); }
  };
  const review = async (release: AlbumRelease) => {
    if (!anchor) return; const token = ++request.current; setBusy(true); setError(""); setTracklist(null);
    try { const list = await albumReleaseTracks(anchor, release.id, allowed); if (token === request.current) setTracklist(list); }
    catch (e) { if (token === request.current) setError(errorText(e)); }
    finally { if (token === request.current) setBusy(false); }
  };
  return <Sheet title="Album completion assistant" onClose={onClose} wide footer={<button type="button" className="btn" onClick={onClose}>Done</button>}>
    <p>Compare your local album with a specific MusicBrainz release. Standard, deluxe, regional, and reissue editions can have different tracklists. Choose the edition you want to collect.</p>
    <label className="flex gap-2 items-start"><input type="checkbox" checked={allowed} disabled={busy} onChange={(e) => setAllowed(e.target.checked)} />Allow sending the album title, artist, and selected release ID to MusicBrainz. Audio files and local paths stay on this computer.</label>
    <div className="grid gap-2 my-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}><label>Album title<input className="field w-full" aria-label="Album lookup title" maxLength={200} disabled={busy} value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>Album artist<input className="field w-full" aria-label="Album lookup artist" maxLength={200} disabled={busy} value={artist} onChange={(e) => setArtist(e.target.value)} /></label></div>
    <button type="button" className="btn" disabled={busy || !allowed || !anchor || !title.trim()} onClick={() => void search()}>{busy ? "Looking up album…" : "Find release editions"}</button>
    {!anchor && <p role="alert">At least one available local song is needed to look up this album.</p>}
    {error && <p role="alert">{error}</p>}{searched && !results.length && <p role="status">No releases found. Try another album title or artist spelling.</p>}
    {results.length > 0 && <details open={!tracklist}><summary>Release editions ({results.length})</summary><ul className="list-none p-0 max-h-56 overflow-auto" aria-label="Album release editions">{results.map((r) => <li key={r.id} className="border rounded p-2 my-1"><b>{r.title}</b> — {r.artist}<p className="m-0 dim">{[r.date, r.country, r.edition, r.status, r.formats.join(" / "), `${r.track_count} tracks`, `Search score ${r.score}/100`].filter(Boolean).join(" · ")}</p><button type="button" className="btn small" disabled={busy || !allowed} aria-label={`Compare release ${r.id}`} onClick={() => void review(r)}>Compare this edition</button></li>)}</ul></details>}
    {tracklist && comparison && <section aria-label="Album completion report" className="mt-3">
      <h3>{tracklist.release.title} — {tracklist.release.date} {tracklist.release.country}</h3>
      <p>{comparison.rows.filter((r) => r.status === "present").length} present · {comparison.rows.filter((r) => r.status === "missing").length} missing · {comparison.rows.filter((r) => r.status !== "present" && r.status !== "missing").length} need review</p>
      {!tracklist.complete && <p role="alert">MusicBrainz has an incomplete tracklist for this edition. Completion cannot be confirmed.</p>}
      <p className="dim">Matches use titles, numbering, artist credits, and duration. They do not verify audio identity or release provenance. No tags or files are changed. Search opens your selected music source for manual review.</p>
      <ol className="list-none p-0" aria-label="Expected album tracks">{comparison.rows.map((row, i) => <li key={`${row.expected.disc}:${row.expected.position}:${i}`} className="border rounded p-2 my-1">
        <b>{row.expected.disc}.{row.expected.number || row.expected.position} {row.expected.title}</b><span className="ml-2">{labels[row.status]}</span><p className="m-0 dim">{row.note}</p>
        {row.local.length > 0 && <p className="m-0 selectable break-words">{row.local.map((t) => t.title).join(" / ")}</p>}
        {row.status !== "present" && <button type="button" className="btn small" disabled={busy} aria-label={`Search for ${row.expected.title}`} onClick={() => onSearch(`${row.expected.artist || tracklist.release.artist} ${row.expected.title}`.trim())}>Search for this track</button>}
      </li>)}</ol>
      {comparison.extras.length > 0 && <details><summary>Local tracks without a confirmed place in this edition ({comparison.extras.length})</summary><ul>{comparison.extras.map((t) => <li key={t.path}>{t.title}{t.missing ? " (file unavailable)" : ""}</li>)}</ul></details>}
    </section>}
  </Sheet>;
}
