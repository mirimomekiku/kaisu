import { GripVertical, Music, Volume2, X } from "lucide-react";
import { useState } from "react";
import { usePlayerState } from "../hooks/usePlayer";
import type { PlayerEngine } from "../lib/audioEngine";
import { formatClock } from "../lib/format";

/** The queue item being dragged, so a row knows whether a drop makes sense (the browser hides it until the drop). */
let dragging: number | null = null;

/** What is coming up: click a track to jump to it, drag to reorder, remove with the cross. */
export default function QueuePanel({ engine, onClose }: { engine: PlayerEngine; onClose: () => void }) {
  const { queue, index, playing } = usePlayerState(engine);
  const [over, setOver] = useState<number | null>(null);
  const total = queue.reduce((sum, t) => sum + (t.duration ?? 0), 0);

  return (
    <section className="queuepanel" aria-label="Play queue">
      <header className="qp-head">
        <b>Play queue</b>
        <span className="dim">
          {queue.length} track{queue.length === 1 ? "" : "s"}
          {total > 0 ? ` · ${formatClock(total)}` : ""}
        </span>
        <span className="flex-1" />
        <button className="btn small" onClick={() => engine.clear()} disabled={queue.length === 0}>
          Clear queue
        </button>
        <button className="row-btn" aria-label="Hide the queue" title="Hide the queue" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </button>
      </header>
      <ol className="qp-list" role="list" aria-label="Tracks in the queue">
        {queue.map((track, i) => (
          <li
            key={`${i}-${track.path}`}
            className={`qp-row ${i === index ? "current" : ""} ${over === i ? "over" : ""}`}
            aria-current={i === index ? "true" : undefined}
            draggable
            onDragStart={(e) => {
              dragging = i;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(i));
            }}
            onDragEnd={() => {
              dragging = null;
              setOver(null);
            }}
            onDragOver={(e) => {
              if (dragging !== null && dragging !== i) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOver(i);
              }
            }}
            onDragLeave={() => setOver((o) => (o === i ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragging;
              dragging = null;
              setOver(null);
              if (from !== null && from !== i) engine.move(from, i);
            }}
          >
            <GripVertical className="w-3 h-3 qp-grip" aria-hidden="true" />
            <span className="qp-num mono">{i === index ? playing ? <Volume2 className="w-3 h-3" aria-label="Playing" /> : <Music className="w-3 h-3" aria-label="Current" /> : i + 1}</span>
            <button className="qp-title link" aria-label={`Play ${track.title}`} title={`Play ${track.title}`} onClick={() => engine.jump(i)}>
              <span className="truncate">{track.title}</span>
              {track.artist && <span className="dim truncate"> — {track.artist}</span>}
            </button>
            <span className="mono dim qp-len">{track.duration ? formatClock(track.duration) : ""}</span>
            <button className="row-btn" aria-label={`Remove ${track.title} from the queue`} title="Remove from the queue" onClick={() => engine.remove(i)}>
              <X className="w-3 h-3" />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
