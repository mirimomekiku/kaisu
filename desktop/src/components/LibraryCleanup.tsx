import { useMemo, useRef, useState } from "react";
import type { LibTrack } from "../lib/api";
import { errorText } from "../lib/api";
import type { LibraryManagement } from "../hooks/useLibrary";
import { cleanupReport, ISSUE_LABELS, METADATA_ISSUES, type MetadataIssue } from "../lib/libraryCleanup";
import { normalize } from "../lib/library";
import Sheet from "./Sheet";

const PAGE_SIZE = 100;
const MAX_SELECTED = 500;
type Tab = "missing" | "unreadable" | "metadata";
interface Props {
  tracks: LibTrack[];
  management: LibraryManagement;
  scanning: boolean;
  onScan: () => void;
  onLocate: (path: string) => Promise<void>;
  onEdit: (tracks: LibTrack[]) => void;
  onReveal: (path: string) => void;
  onDuplicates: () => void;
  onClose: () => void;
}

export default function LibraryCleanup({ tracks, management, scanning, onScan, onLocate, onEdit, onReveal, onDuplicates, onClose }: Props) {
  const report = useMemo(() => cleanupReport(tracks), [tracks]);
  const problems = report.missing.length + report.unreadable.length + report.metadata.length;
  const issuesByPath = useMemo(() => new Map(report.metadata.map((r) => [r.track.path, r.issues])), [report]);
  const [tab, setTab] = useState<Tab>("missing");
  const [issue, setIssue] = useState<MetadataIssue | "any">("any");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [failures, setFailures] = useState<Array<{ path: string; error: string | null }>>([]);
  const rows = useMemo(() => {
    const candidates = tab === "missing" ? report.missing : tab === "unreadable" ? report.unreadable : report.metadata.filter((r) => issue === "any" || r.issues.includes(issue)).map((r) => r.track);
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return candidates.filter((t) => words.every((word) => normalize(`${t.title} ${t.artist} ${t.path}`).includes(word)));
  }, [tab, issue, report, query]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
  const visible = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  // Selections only apply to the current filtered result, including when a rescan or edit changes it.
  const chosen = rows.filter((t) => selected.has(t.path));
  const changeFilters = () => { setPage(0); setSelected(new Set()); setReview(null); setError(""); setNotice(""); setFailures([]); };
  const toggle = (path: string, checked: boolean) => {
    setReview(null);
    setSelected((old) => { const next = new Set(old); if (checked && chosen.length < MAX_SELECTED) next.add(path); else next.delete(path); return next; });
  };
  const forget = async () => {
    if (!review || working.current) return;
    working.current = true; setBusy(true); setError(""); setFailures([]); setNotice("");
    try {
      const results = await management.forgetMissing(review);
      const removed = results.filter((r) => r.ok);
      setSelected(new Set()); setReview(null);
      setNotice(`${removed.length} missing entr${removed.length === 1 ? "y" : "ies"} removed from the library.`);
      setFailures(results.filter((r) => !r.ok));
    } catch (e) { setError(errorText(e)); }
    finally { working.current = false; setBusy(false); }
  };
  const locate = async (path: string) => {
    if (working.current) return;
    working.current = true; setBusy(true); setReview(null);
    try { await onLocate(path); } finally { working.current = false; setBusy(false); }
  };
  return <Sheet title="Library cleanup" wide onClose={() => { if (!working.current) onClose(); }} footer={<button className="btn primary" disabled={busy} onClick={onClose}>Done</button>}>
    <div className="cleanup">
      <p>One place for what needs attention in your library: missing files, files that cannot be read, incomplete metadata, and exact duplicates. Rescan first to refresh the report.</p>
      <p role="status" aria-label="Library health"><b>{problems === 0 ? "No problems found in the last scan." : `${problems} file${problems === 1 ? "" : "s"} need${problems === 1 ? "s" : ""} attention.`}</b> {tracks.length.toLocaleString()} songs checked.</p>
      <div className="cleanup-summary">
        {([["missing", report.missing.length, "missing files"], ["unreadable", report.unreadable.length, "unreadable files"], ["metadata", report.metadata.length, "with incomplete metadata"]] as const).map(([key, count, label]) => <button key={key} className={`btn small${tab === key ? " primary" : ""}`} disabled={busy} aria-pressed={tab === key} onClick={() => { setTab(key); changeFilters(); }}><span><b>{count}</b> {label}</span></button>)}
      </div>
      <div className="flex gap-2 flex-wrap"><button className="btn small" disabled={busy || scanning} onClick={() => { setReview(null); onScan(); }}>{scanning ? "Scanning…" : "Rescan library"}</button><button className="btn small" disabled={busy} onClick={onDuplicates}>Review exact duplicates</button></div>
      <fieldset disabled={busy} className="cleanup-controls">
        <label>Review<select className="field" aria-label="Cleanup category" value={tab} onChange={(e) => { setTab(e.target.value as Tab); changeFilters(); }}><option value="missing">Missing files ({report.missing.length})</option><option value="unreadable">Unreadable files ({report.unreadable.length})</option><option value="metadata">Incomplete metadata ({report.metadata.length})</option></select></label>
        {tab === "metadata" && <label>Issue<select className="field" aria-label="Metadata issue" value={issue} onChange={(e) => { setIssue(e.target.value as typeof issue); changeFilters(); }}><option value="any">Any issue</option>{METADATA_ISSUES.map((key) => <option key={key} value={key}>{ISSUE_LABELS[key]} ({report.counts[key]})</option>)}</select></label>}
        <label>Search<input className="field" aria-label="Search cleanup results" value={query} onChange={(e) => { setQuery(e.target.value); changeFilters(); }} /></label>
      </fieldset>
      <p className="dim">{tab === "unreadable" ? "Kaisu could not read these files (damaged, empty, or not really audio). Show one in its folder to repair, replace or delete it yourself; Kaisu does not delete them." : tab === "missing" ? "Locate moved files or remove selected library entries. Removing entries keeps playlists and listening history. Files on unavailable music folders must be reconnected before removal." : "Select songs to edit shared tags, or edit one song at a time. Embedded artwork, genre, and year are optional. Folder covers are not counted as embedded artwork. Filename-derived titles may hide absent title tags."}</p>
      <div className="flex gap-2 flex-wrap">
        <button className="btn small" disabled={busy || visible.length === 0} onClick={() => { setReview(null); setSelected(() => new Set([...chosen.map((t) => t.path), ...visible.map((t) => t.path)].filter((p, i, all) => all.indexOf(p) === i).slice(0, MAX_SELECTED))); }}>Select this page</button>
        <button className="btn small" disabled={busy || selected.size === 0} onClick={() => { setSelected(new Set()); setReview(null); }}>Clear selection</button>
        {tab === "unreadable" ? null : tab === "missing" ? <button className="btn small" disabled={busy || scanning || chosen.length === 0} onClick={() => setReview(chosen.map((t) => t.path))}>Review entry removal ({chosen.length})</button> : <button className="btn small" disabled={busy || chosen.length === 0} onClick={() => onEdit(chosen)}>Edit selected tags ({chosen.length})</button>}
      </div>
      <span className="dim">{chosen.length} of {MAX_SELECTED} selected maximum · {rows.length} result{rows.length === 1 ? "" : "s"}</span>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {failures.length > 0 && <div role="alert"><p>{failures.length} entries were kept:</p><ul>{failures.map((r) => <li key={r.path}><span className="break-words selectable">{r.path}</span> — {r.error}</li>)}</ul></div>}
      {review && <div className="duplicate-review" role="region" aria-label="Review missing entry removal"><p>Remove {review.length} missing entr{review.length === 1 ? "y" : "ies"} from the library? This updates the library index only. Files, playlists, and listening history are kept. Each file’s absence will be checked again.</p><ul>{review.map((path) => <li className="break-words selectable" key={path}>{path}</li>)}</ul><div className="flex gap-2"><button className="btn danger" disabled={busy || scanning} onClick={() => void forget()}>Remove missing entries</button><button className="btn" disabled={busy} onClick={() => setReview(null)}>Cancel removal</button></div></div>}
      <ul className="cleanup-results" aria-label="Cleanup results">
        {visible.map((t) => <li key={t.path} className="cleanup-row">
          <label className="cleanup-song"><input type="checkbox" aria-label={`Select ${t.path}`} checked={selected.has(t.path)} disabled={busy || (!selected.has(t.path) && chosen.length >= MAX_SELECTED)} onChange={(e) => toggle(t.path, e.target.checked)} /><b>{t.title || "Untitled"}</b><span className="dim">{t.artist || "Unknown artist"}</span></label>
          <div className="selectable break-words dim">{t.path}</div>
          {tab === "metadata" && <div className="dim">{issuesByPath.get(t.path)?.map((key) => ISSUE_LABELS[key]).join(" · ")}</div>}
          <div className="flex gap-2">{tab !== "unreadable" && <button className="btn small" disabled={busy} onClick={() => tab === "missing" ? void locate(t.path) : onEdit([t])}>{tab === "missing" ? "Locate file" : "Edit tags"}</button>}{tab !== "missing" && <button className="btn small" disabled={busy} onClick={() => onReveal(t.path)}>Show in folder</button>}</div>
        </li>)}
      </ul>
      {rows.length === 0 && <p role="status">No {tab === "missing" ? "missing files" : tab === "unreadable" ? "unreadable files" : "metadata issues"} match this view.</p>}
      {rows.length > PAGE_SIZE && <div className="flex gap-2 items-center"><button className="btn small" disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous page</button><span>Page {currentPage + 1} of {Math.ceil(rows.length / PAGE_SIZE)}</span><button className="btn small" disabled={busy || (currentPage + 1) * PAGE_SIZE >= rows.length} onClick={() => setPage(currentPage + 1)}>Next page</button></div>}
    </div>
  </Sheet>;
}
