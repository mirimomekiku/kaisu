import { useEffect, useRef } from "react";
import { usePlayerState } from "../hooks/usePlayer";
import type { PlayerEngine } from "../lib/audioEngine";

export function QueueUndoButton({ engine }: { engine: PlayerEngine }) {
  const { queueUndoLabel } = usePlayerState(engine);
  return <button className="btn small" aria-label="Undo queue edit" disabled={!queueUndoLabel}
    title={queueUndoLabel ? `Undo: ${queueUndoLabel}` : "No queue edit to undo"}
    onClick={() => engine.undoQueue()}>Undo{queueUndoLabel ? `: ${queueUndoLabel}` : ""}</button>;
}

export default function QueueUndoNotice({ engine }: { engine: PlayerEngine }) {
  const { queue, queueUndoLabel } = usePlayerState(engine);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!queue.length && queueUndoLabel && document.activeElement === document.body)
      ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [queue.length, queueUndoLabel]);
  if (queue.length || !queueUndoLabel) return null;
  return <div ref={ref} className="queue-undo-notice" role="status" onKeyDown={(e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); e.stopPropagation(); engine.undoQueue(); }
  }}>
    <span>Queue cleared. Undo restores it paused.</span><QueueUndoButton engine={engine} />
  </div>;
}
