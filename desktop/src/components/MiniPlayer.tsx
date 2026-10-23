import { Maximize2, Music, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { PlayerEngine } from "../lib/audioEngine";
import { usePlayerState, usePlayerTime } from "../hooks/usePlayer";
import { formatClock } from "../lib/format";
import { CoverArt } from "./Picture";
import PlaybackDetails from "./PlaybackDetails";

export default function MiniPlayer({ engine, onRestore, busy, error }: { engine: PlayerEngine; onRestore: () => void; busy: boolean; error?: string }) {
  const state = usePlayerState(engine);
  const time = usePlayerTime(engine);
  const track = state.queue[state.index];
  return <section className="mini-player" aria-label="Mini-player">
    <header data-tauri-drag-region className="mini-header"><b data-tauri-drag-region>Kaisu · Mini-player</b><span className="flex-1" data-tauri-drag-region />
      <button className="btn small" disabled={busy} onClick={onRestore} aria-label="Return to full window"><Maximize2 className="w-3 h-3" /> Full window</button>
    </header>
    <div className="mini-track"><div className="mini-cover">{track ? <CoverArt path={track.path} fallback={<Music className="w-8 h-8" />} /> : <Music className="w-8 h-8" />}</div>
      <div className="min-w-0 flex-1"><b className="block truncate">{track?.title ?? "Nothing queued"}</b><div className="dim truncate">{track?.artist ?? "Choose music in the full window"}</div>
        <div className="mini-buttons"><button className="row-btn" disabled={!track} aria-label="Previous track" onClick={() => engine.previous()}><SkipBack className="w-4 h-4" /></button>
          <button className="btn" disabled={!track} aria-label={state.playing || state.loading ? "Pause" : "Play"} onClick={() => engine.toggle()}>{state.playing || state.loading ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
          <button className="row-btn" disabled={!track || (state.index >= state.queue.length - 1 && state.repeat !== "all")} aria-label="Next track" onClick={() => engine.next()}><SkipForward className="w-4 h-4" /></button>
          <label className="mini-volume">Volume<input type="range" aria-label="Volume" min={0} max={1} step={0.01} value={state.volume} onChange={(e) => engine.setVolume(Number(e.target.value))} /></label>
        </div>
      </div>
    </div>
    <div className="mini-seek"><span>{formatClock(time.position)}</span><input type="range" aria-label="Position" min={0} max={Math.max(1, time.duration)} step={0.1} value={Math.min(time.position, Math.max(1, time.duration))} disabled={!track || !time.duration} onChange={(e) => engine.seek(Number(e.target.value))} /><span>{formatClock(time.duration)}</span></div>
    {(error || state.error) && <p className="mini-error" role="alert">{error || state.error}</p>}
    {(state.loading || state.error) && <PlaybackDetails engine={engine} compact />}
  </section>;
}
