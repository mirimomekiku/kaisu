import { useContext, useState } from "react";
import { usePlayerState } from "../hooks/usePlayer";
import { PlaybackServicesContext } from "../hooks/useAudioOutput";
import type { PlayerEngine } from "../lib/audioEngine";
import { errorText } from "../lib/api";

export default function PlaybackDetails({ engine, compact = false }: { engine: PlayerEngine; compact?: boolean }) {
  const state = usePlayerState(engine);
  const services = useContext(PlaybackServicesContext);
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState("");
  const track = state.queue[state.index];
  if (!track) return null;
  const quality = [track.format, track.sampleRate ? `${track.sampleRate / 1000} kHz` : null, track.bitrate ? `${track.bitrate} kbps` : null, track.bitDepth ? `${track.bitDepth}-bit` : null].filter(Boolean).join(" · ");
  return <div className={`playback-details${compact ? " compact" : ""}`}>
    <span role="status" aria-label="Playback status">{state.phase === "buffering" ? "Buffering…" : state.phase === "loading" ? "Loading…" : state.phase === "failed" ? "Playback failed" : state.phase === "playing" ? "Playing" : "Paused"}{!compact && quality ? ` · ${quality}` : ""}</span>
    {state.notice && <p className="m-0" role="status">{state.notice}</p>}
    {state.error && <><p className="m-0" role="alert">{state.error}</p><div className="flex gap-2 flex-wrap">
      <button className="btn small" onClick={() => engine.retry()}>Retry playback</button>
      {services && <button className="btn small" disabled={locating} onClick={async () => { setLocating(true); setProblem(""); try { await services.locate(track.path); } catch (e) { setProblem(errorText(e)); } finally { setLocating(false); } }}>{locating ? "Locating…" : "Locate audio file"}</button>}
      <button className="btn small" disabled={state.queue.length < 2} onClick={() => engine.skipFailed()}>Skip unavailable track</button>
    </div></>}
    {problem && <p role="alert">{problem}</p>}
    {!compact && <details><summary>Playback details</summary><dl><dt>File</dt><dd className="break-all">{track.path}</dd><dt>Format</dt><dd>{quality || "Not available in library metadata"}</dd><dt>State</dt><dd>{state.phase}</dd></dl>{state.errorDetails && <pre className="playback-error-details">{state.errorDetails}</pre>}</details>}
  </div>;
}
