import { useEffect, useMemo, useRef, useState } from "react";
import { errorText, lyricsFind, lyricsRead, type LibTrack } from "../lib/api";
import { emptyTally, LYRICS_PAUSE_MS, lyricsFailure, lyricsOutcome, lyricsTargets, MAX_LYRICS_RUN, type LyricsTally } from "../lib/bulkLyrics";
import { baseName } from "../lib/mediaKind";
import Sheet from "./Sheet";

type Stage = "idle" | "running" | "done";
const name = (t: LibTrack) => t.title || baseName(t.path);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Looks up lyrics on LRCLIB for many songs and saves each one beside its song. Songs that already have lyrics are never touched. */
export default function BulkLyrics({ tracks, onClose }: { tracks: LibTrack[]; onClose: () => void }) {
  const queue = useMemo(() => lyricsTargets(tracks), [tracks]);
  const [allowed, setAllowed] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [done, setDone] = useState(0);
  const [current, setCurrent] = useState("");
  const [tally, setTally] = useState<LyricsTally>(emptyTally());
  const [notes, setNotes] = useState<string[]>([]);
  const [problem, setProblem] = useState("");
  const run = useRef(0);
  useEffect(() => () => { run.current++; }, []);

  const start = async () => {
    const token = ++run.current;
    const counts = emptyTally();
    const missed: string[] = [];
    setStage("running"); setDone(0); setProblem(""); setNotes([]); setTally(counts);
    let finished = 0;
    for (const track of queue) {
      if (token !== run.current) return;
      setCurrent(name(track));
      try {
        const existing = await lyricsRead(track.path);
        if (existing.synced || existing.plain) counts.has++;
        else {
          const found = await lyricsFind(track.path);
          counts[lyricsOutcome(found)]++;
          if (token === run.current) await pause(LYRICS_PAUSE_MS);
        }
      } catch (e) {
        const message = errorText(e);
        const kind = lyricsFailure(message);
        if (kind === "stop") { setProblem(message); break; }
        if (kind === "none") counts.none++;
        else { counts.failed++; missed.push(`${name(track)} — ${message}`); }
      }
      finished++;
      if (token !== run.current) return;
      setDone(finished); setTally({ ...counts });
    }
    if (token !== run.current) return;
    setTally({ ...counts }); setNotes(missed); setStage("done");
  };
  const stop = () => { run.current++; setStage("done"); };

  const added = tally.timed + tally.plain;
  return <Sheet title="Find lyrics" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>{stage === "running" ? "Close and stop" : "Close"}</button>}>
    {stage === "idle" && <>
      <p>Look up lyrics for {queue.length} song{queue.length === 1 ? "" : "s"} on LRCLIB and save each one beside its song (a .lrc file when it has timestamps, otherwise .txt). Songs that already have lyrics are skipped, and your music files themselves are not changed. {tracks.length > MAX_LYRICS_RUN && `Only the first ${MAX_LYRICS_RUN} of ${tracks.length} selected songs are included in one run.`}</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} />Allow sending each song's artist, title and length to LRCLIB. Audio files and file paths stay on this computer.</label>
      <button type="button" className="btn primary mt-3" disabled={!allowed || queue.length === 0} onClick={() => void start()}>Find lyrics for {queue.length} song{queue.length === 1 ? "" : "s"}</button>
    </>}
    {stage === "running" && <div><p role="status">Looking up {Math.min(done + 1, queue.length)} of {queue.length}: {current}</p><progress max={queue.length} value={done} aria-label="Lyrics progress" /> <button type="button" className="btn small" onClick={stop}>Stop</button></div>}
    {stage !== "idle" && <ul aria-label="Lyrics results" className="mt-2">
      <li>{added} saved ({tally.timed} timed, {tally.plain} plain)</li>
      <li>{tally.has} already had lyrics</li>
      <li>{tally.none} not found</li>
      {tally.failed > 0 && <li>{tally.failed} could not be saved</li>}
    </ul>}
    {problem && <p role="alert">{problem} The run stopped; songs not yet looked up are untouched, so you can run it again later.</p>}
    {stage === "done" && notes.length > 0 && <details><summary>Problems ({notes.length})</summary><ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul></details>}
  </Sheet>;
}
