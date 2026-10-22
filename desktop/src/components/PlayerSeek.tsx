import { usePlayerTime } from "../hooks/usePlayer";
import type { PlayerEngine } from "../lib/audioEngine";
import { formatClock } from "../lib/format";

export default function PlayerSeek({ engine }: { engine: PlayerEngine }) {
  const { position, duration } = usePlayerTime(engine);
  const known = duration > 0 && Number.isFinite(duration);
  return (
    <>
      <span className="pb-time mono" aria-label="Position">
        {formatClock(position)}
      </span>
      <input
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
      <span className="pb-time mono" aria-label="Length">
        {known ? formatClock(duration) : "--:--"}
      </span>
    </>
  );
}
