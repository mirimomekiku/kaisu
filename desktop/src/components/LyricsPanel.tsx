import { Loader2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlayerTime } from "../hooks/usePlayer";
import { errorText, lyricsFind, lyricsRead, type SongLyrics } from "../lib/api";
import type { PlayerEngine, Track } from "../lib/audioEngine";
import { lineAt, parseLrc } from "../lib/lrc";

type State = { status: "loading" } | { status: "ready"; lyrics: SongLyrics } | { status: "none" } | { status: "error"; message: string };

/** Lyrics for the playing track. When they are timed, the line being sung is highlighted and follows the music; click a line to go there. */
export default function LyricsPanel({ engine, track, askConsent, onClose }: { engine: PlayerEngine; track: Track; askConsent: () => Promise<boolean>; onClose: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [finding, setFinding] = useState(false);
  const path = track.path;

  useEffect(() => {
    let stale = false;
    setState({ status: "loading" });
    lyricsRead(path).then(
      (lyrics) => !stale && setState(lyrics.synced || lyrics.plain ? { status: "ready", lyrics } : { status: "none" }),
      (e) => !stale && setState({ status: "error", message: errorText(e) }),
    );
    return () => {
      stale = true;
    };
  }, [path]);

  const find = async () => {
    if (!(await askConsent())) return;
    setFinding(true);
    try {
      setState({ status: "ready", lyrics: await lyricsFind(path) });
    } catch (e) {
      setState({ status: "error", message: errorText(e) });
    } finally {
      setFinding(false);
    }
  };

  return (
    <section className="lyricspanel" aria-label="Lyrics">
      <header className="qp-head">
        <b>Lyrics</b>
        <span className="dim truncate">{track.title}</span>
        <span className="flex-1" />
        <button className="row-btn" aria-label="Hide the lyrics" title="Hide the lyrics" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </button>
      </header>
      <div className="ly-body">
        {state.status === "loading" && (
          <p className="m-0 flex items-center gap-2" role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking for lyrics…
          </p>
        )}
        {state.status === "ready" && (state.lyrics.synced ? <SyncedLines engine={engine} text={state.lyrics.synced} /> : <pre className="ly-plain">{state.lyrics.plain}</pre>)}
        {(state.status === "none" || state.status === "error") && (
          <div className="flex flex-col gap-2 items-start">
            <p className="m-0" role={state.status === "error" ? "alert" : undefined} style={state.status === "error" ? { color: "#b3261e" } : undefined}>
              {state.status === "error" ? state.message : "There are no lyrics saved for this song."}
            </p>
            <button className="btn small" disabled={finding} onClick={() => void find()} title="Looks the song up on LRCLIB and saves the lyrics next to it">
              {finding ? "Looking…" : "Find lyrics online"}
            </button>
            <span className="dim">This sends the song's artist and title to LRCLIB (lrclib.net).</span>
          </div>
        )}
      </div>
    </section>
  );
}

function SyncedLines({ engine, text }: { engine: PlayerEngine; text: string }) {
  const lines = useMemo(() => parseLrc(text), [text]);
  const { position } = usePlayerTime(engine);
  const current = lineAt(lines, position);
  const currentRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [current]);

  if (lines.length === 0) return <p className="m-0">These lyrics have no timing.</p>;
  return (
    <ol className="ly-lines" aria-label="Synced lyrics">
      {lines.map((line, i) => (
        <li key={i} ref={i === current ? currentRef : undefined} aria-current={i === current ? "true" : undefined} className={i === current ? "current" : i < current ? "past" : ""}>
          <button type="button" className="link" title="Go to this line" onClick={() => engine.seek(line.time)}>
            {line.text || "♪"}
          </button>
        </li>
      ))}
    </ol>
  );
}
