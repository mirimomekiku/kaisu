import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePlayerEngine } from "../hooks/usePlayer";
import { errorText, lyricsEditRead, lyricsEditSave } from "../lib/api";
import { lyricProblem, shiftLyrics, stampLyricLine, type LyricsDocument } from "../lib/lyricsEdit";
import { parseLrc } from "../lib/lrc";
import { formatClock } from "../lib/format";
import Sheet from "./Sheet";

const idleTime = { position: 0, duration: 0 };
const noSubscribe = () => () => {};
export default function LyricsEditor({ path, title, artist, onClose, onSaved }: { path: string; title: string; artist?: string; onClose: () => void; onSaved?: () => void }) {
  const supportsEmbedding = /\.(mp3|m4a|flac|ogg|oga|opus|wav)$/i.test(path);
  const engine = usePlayerEngine();
  const playingPath = useSyncExternalStore(engine?.subscribe ?? noSubscribe, () => engine?.current?.path ?? null);
  const time = useSyncExternalStore(engine?.subscribeTime ?? noSubscribe, engine?.getTime ?? (() => idleTime));
  const [document, setDocument] = useState<LyricsDocument | null>(null);
  const [text, setText] = useState(""); const [baseline, setBaseline] = useState("");
  const [embed, setEmbed] = useState(supportsEmbedding); const [sidecar, setSidecar] = useState(true);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [discard, setDiscard] = useState<"close" | "reload" | null>(null);
  const [shift, setShift] = useState("0");
  const input = useRef<HTMLTextAreaElement>(null); const alive = useRef(true);
  const reading = useRef(0);
  const dirty = text !== baseline;
  const lines = useMemo(() => parseLrc(text), [text]);
  const load = async () => {
    const token = ++reading.current;
    setLoading(true); setError(""); setMessage("");
    try { const saved = await lyricsEditRead(path); if (alive.current && token === reading.current) { setDocument(saved); setText(saved.text); setBaseline(saved.text); } }
    catch (e) { if (alive.current && token === reading.current) setError(errorText(e)); }
    finally { if (alive.current && token === reading.current) setLoading(false); }
  };
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; reading.current++; }; }, [path]);
  const close = () => { if (busy) return; dirty ? setDiscard("close") : onClose(); };
  const save = async () => {
    if (!document) return;
    setBusy(true); setError(""); setMessage("");
    const release = embed ? engine?.releaseFiles([path]) : undefined;
    try {
      const saved = await lyricsEditSave(path, text, document.revision, embed, sidecar);
      if (!alive.current) return;
      if (saved.document) setDocument(saved.document);
      else setDocument(null);
      setMessage([saved.sidecar ? "Saved .lrc file" : "", saved.embedded ? "Embedded lyrics" : ""].filter(Boolean).join(" · "));
      if (saved.warnings.length) setError(saved.warnings.join("\n")); else setBaseline(text);
      window.dispatchEvent(new CustomEvent("kaisu:lyrics-saved", { detail: path }));
      onSaved?.();
    } catch (e) { if (alive.current) setError(errorText(e)); }
    finally { release?.(); if (alive.current) setBusy(false); }
  };
  const stamp = () => {
    if (!input.current || playingPath !== path || !engine) return;
    const line = text.slice(0, input.current.selectionStart).split("\n").length - 1;
    try {
      const result = stampLyricLine(text, line, engine.getTime().position);
      setText(result.text); setError(""); setMessage("");
      requestAnimationFrame(() => {
        const rows = result.text.split("\n"); const at = rows.slice(0, result.next).reduce((n, s) => n + s.length + 1, 0);
        input.current?.focus(); input.current?.setSelectionRange(at, at + (rows[result.next]?.length ?? 0));
      });
    } catch (e) { setError(errorText(e)); }
  };
  const problem = lyricProblem(text);
  return <Sheet title="Edit lyrics" onClose={close} wide footer={<>
    <button type="button" className="btn" disabled={busy} onClick={close}>Done</button>
    <button type="button" className="btn primary" disabled={loading || busy || !document || !!problem || (!embed && !sidecar)} onClick={() => void save()}>{busy ? "Saving lyrics…" : "Save lyrics"}</button>
  </>}>
    <p><b>{title}</b>{artist ? ` — ${artist}` : ""}</p>
    <p>Edit plain text or LRC timestamps. Changes stay in this editor until you save. Saving a sidecar replaces this song’s .lrc file; any .txt file stays in place.</p>
    {loading ? <p role="status">Reading saved lyrics…</p> : <>
      <label className="block">Lyrics text<textarea ref={input} className="field w-full mono block" aria-label="Lyrics text" rows={9} spellCheck={false} value={text} disabled={busy || !document} onChange={(e) => { setText(e.target.value); setMessage(""); }} style={{ minHeight: 160, resize: "vertical" }} /></label>
      {problem && text.trim() && <p role="status">{problem}</p>}
      <div className="flex flex-wrap gap-2 items-center my-2">
        <label>Timing shift (seconds)<input className="field w-24 ml-2" type="number" step="0.1" min={-600} max={600} aria-label="Timing shift in seconds" value={shift} disabled={busy || !document} onChange={(e) => setShift(e.target.value)} /></label>
        <button type="button" className="btn small" disabled={busy || !document || !lines.length || !shift.trim()} onClick={() => { try { setText(shiftLyrics(text, Number(shift))); setError(""); setMessage(""); } catch (e) { setError(errorText(e)); } }}>Apply timing shift</button>
      </div><p className="dim">Positive shifts make lyrics appear later; negative shifts make them earlier. Times below zero become zero. Existing LRC offsets are folded into the timestamps.</p>
      {engine && <div className="flex gap-2 flex-wrap items-center">
        {playingPath === path ? <><span role="status">Playback: {formatClock(time.position)}</span><button type="button" className="btn small" disabled={busy || !document} onClick={() => engine.toggle()}>Play / pause timing</button><button type="button" className="btn small" disabled={busy || !document} onClick={stamp}>Stamp selected line at playback</button></> : <button type="button" className="btn small" disabled={busy || !document} onClick={() => engine.play([{ path, title, artist }], 0)}>Play this song for timing</button>}
      </div>}
      <p className="dim">Place the text cursor on a lyric line, then stamp it while listening. The next line is selected automatically.</p>
      <div className="flex flex-wrap gap-3 my-2"><label><input type="checkbox" checked={sidecar} disabled={busy} onChange={(e) => setSidecar(e.target.checked)} />Save .lrc beside audio</label><label><input type="checkbox" checked={embed} disabled={busy || !supportsEmbedding} onChange={(e) => setEmbed(e.target.checked)} />Embed in audio file</label></div>
      {!supportsEmbedding && <p className="dim">Embedding is unavailable for this audio format. You can save a .lrc file beside it.</p>}
      {document?.sidecar && !sidecar && <p role="status">The player prefers existing sidecar lyrics over embedded lyrics. Save both to keep playback and the audio tags in agreement.</p>}
      <button type="button" className="btn small" disabled={busy} onClick={() => dirty ? setDiscard("reload") : void load()}>Reload saved lyrics</button>
      {lines.length > 0 && <details className="mt-2"><summary>Timing preview ({lines.length} lines)</summary><ol className="max-h-44 overflow-auto" aria-label="Lyrics timing preview">{lines.slice(0, 300).map((line, i) => <li key={i}><button type="button" className="link" disabled={busy || playingPath !== path} onClick={() => engine?.seek(line.time)}>{formatClock(line.time)} — {line.text || "♪"}</button></li>)}</ol>{lines.length > 300 && <p>Showing the first 300 timed lines; all lines are saved.</p>}</details>}
    </>}
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="whitespace-pre-wrap">{error}</p>}
    {discard && <div role="alert"><p>Discard your unsaved lyrics changes?</p><button type="button" className="btn" onClick={() => { const action = discard; setDiscard(null); if (action === "close") onClose(); else void load(); }}>Discard changes</button><button type="button" className="btn" onClick={() => setDiscard(null)}>Keep editing</button></div>}
  </Sheet>;
}
