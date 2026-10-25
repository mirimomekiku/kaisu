import { useSeekControls } from "../hooks/useSeekControls";
import { usePlayerState, usePlayerTime } from "../hooks/usePlayer";
import type { PlayerEngine } from "../lib/audioEngine";
import { usePlaybackTools } from "../hooks/usePlaybackTools";
import { useWaveform } from "../hooks/useWaveform";
import { formatClock } from "../lib/format";

export default function PlayerSeek({ engine }: { engine: PlayerEngine }) {
  const { position, duration } = usePlayerTime(engine);
  const seekControls = useSeekControls(engine);
  const state = usePlayerState(engine);
  const track = state.queue[state.index];
  const tools = usePlaybackTools();
  const wave = useWaveform(track?.path, track?.fileRevision, tools?.waveformEnabled === true);
  const loop = state.loop;
  const peaks = wave.data?.peaks;
  const known = duration > 0 && Number.isFinite(duration);
  return (
    <>
      <span className="pb-time mono" aria-label="Position">
        {formatClock(position)}
      </span>
      <div className={`seek-surface ${peaks ? "has-waveform" : ""}`} title={wave.error ? `${wave.error} Using the regular seek bar.` : undefined}>
      {peaks && <svg className="seek-waveform" viewBox={`0 0 ${peaks.length} 40`} preserveAspectRatio="none" aria-label="Audio waveform" role="img">
        <path d={peaks.map((peak, i) => `M${i} ${20 - peak * 18}V${20 + peak * 18}`).join("")} fill="none" stroke="currentColor" strokeWidth="1" />
        <rect width={known ? Math.min(position / duration, 1) * peaks.length : 0} height="40" fill="currentColor" opacity=".15" />
        {loop.a !== null && known && <line x1={loop.a / duration * peaks.length} x2={loop.a / duration * peaks.length} y1="0" y2="40" className="wave-loop-marker" />}
        {loop.b !== null && known && <line x1={loop.b / duration * peaks.length} x2={loop.b / duration * peaks.length} y1="0" y2="40" className="wave-loop-marker" />}
      </svg>}
      <input
        {...seekControls}
        type="range"
        className="pb-seek"
        aria-label="Seek"
        min={0}
        max={known ? duration : 0}
        step={1}
        value={known ? Math.min(position, duration) : 0}
        disabled={!known}
        onChange={(e) => engine.seek(Number(e.target.value))}
      />
      {tools?.waveformEnabled && !peaks && <span className="waveform-status" role="status">{wave.error ? "Waveform unavailable" : "Reading waveform…"}</span>}
      {loop.enabled && <span className="loop-seek-label">A–B loop</span>}
      </div>
      <span className="pb-time mono" aria-label="Length">
        {known ? formatClock(duration) : "--:--"}
      </span>
    </>
  );
}
