import { GripVertical, Music, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { usePlayerState } from "../hooks/usePlayer";
import type { PlayerEngine } from "../lib/audioEngine";
import { formatClock } from "../lib/format";
import { emptySelection, pruneSelection, selectSong } from "../lib/songSelection";
import { ActionMenu } from "./Dropdown";
import { QueueUndoButton } from "./QueueUndo";

export default function QueuePanel({ engine, onClose }: { engine: PlayerEngine; onClose: () => void }) {
  const { queue, queueKeys, index, playing } = usePlayerState(engine);
  const [selection, setSelection] = useState(emptySelection);
  const [over, setOver] = useState<number | null>(null);
  const dragging = useRef<{ keys: string[]; from: number } | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const panel = useRef<HTMLElement>(null);
  const visible = useMemo(() => new Set(queueKeys), [queueKeys]);
  useEffect(() => setSelection((s) => pruneSelection(s, visible)), [visible]);
  const selected = queueKeys.filter((key) => selection.paths.has(key));
  const first = queueKeys.indexOf(selected[0]);
  const last = queueKeys.indexOf(selected[selected.length - 1]);
  const total = queue.reduce((sum, t) => sum + (t.duration ?? 0), 0);
  const choose = (key: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, checkbox = false) =>
    setSelection((s) => selectSong(s, queueKeys, key, { range: e.shiftKey, toggle: checkbox || e.ctrlKey || e.metaKey, additive: e.ctrlKey || e.metaKey }));
  const removeSelected = () => { panel.current?.focus(); engine.removeMany(selected); setSelection(emptySelection()); };
  const selectAll = () => setSelection({ paths: new Set(queueKeys), anchor: queueKeys[0] ?? null });
  const click = (e: MouseEvent, key: string) => {
    if ((e.target as HTMLElement).closest("button,input")) return;
    choose(key, e); rows.current.get(key)?.focus();
  };

  return (
    <section ref={panel} tabIndex={-1} className="queuepanel" aria-label="Play queue" onKeyDown={(e) => {
      if ((e.target as HTMLElement).closest("textarea,select,[contenteditable=true],input:not([type=checkbox])")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); e.stopPropagation(); selectAll(); }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); e.stopPropagation(); engine.undoQueue(); }
      else if (e.key === "Escape" && selected.length) { e.preventDefault(); e.stopPropagation(); setSelection(emptySelection()); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selected.length) { e.preventDefault(); e.stopPropagation(); removeSelected(); }
    }}>
      <header className="qp-head">
        <b>Play queue</b>
        <span className="dim">{queue.length} track{queue.length === 1 ? "" : "s"}{total > 0 ? ` · ${formatClock(total)}` : ""}</span>
        <span className="flex-1" />
        <QueueUndoButton engine={engine} />
        <button className="btn small" onClick={() => engine.clear()} disabled={!queue.length}>Clear queue</button>
        <button className="row-btn" aria-label="Hide the queue" title="Hide the queue" onClick={onClose}><X className="w-3.5 h-3.5" /></button>
      </header>
      <div className="qp-selection">
        <span role="status">{selected.length} selected</span>
        <button className="btn small" onClick={selectAll} disabled={!queue.length}>Select all queued</button>
        <button className="btn small" onClick={() => setSelection(emptySelection())} disabled={!selected.length}>Deselect queued</button>
        <ActionMenu label="Selected queue actions" disabled={!selected.length} items={[
          { label: "Move selected up", disabled: first <= 0, onSelect: () => engine.moveMany(selected, first - 1) },
          { label: "Move selected down", disabled: last >= queue.length - 1, onSelect: () => engine.moveMany(selected, last + 2) },
          { label: "Move selected to top", disabled: selected.every((key, i) => key === queueKeys[i]), onSelect: () => engine.moveMany(selected, 0) },
          { label: "Move selected to end", disabled: selected.every((key, i) => key === queueKeys[queue.length - selected.length + i]), onSelect: () => engine.moveMany(selected, queue.length) },
          { label: "Move selected next", disabled: !selected.some((key) => key !== queueKeys[index]), onSelect: () => engine.moveMany(selected.filter((key) => key !== queueKeys[index]), index + 1) },
          { kind: "separator" },
          { label: "Remove selected from queue", onSelect: removeSelected },
        ]} />
        <span className="dim qp-selection-hint">Select with checkboxes, Ctrl/Cmd-click or Shift-click. Drag selected tracks together.</span>
      </div>
      {queue.length > 2000 && <p className="dim">After a restart, Kaisu restores up to 2,000 tracks around the current song.</p>}
      <ol className="qp-list" role="list" aria-label="Tracks in the queue">
        {queue.map((track, i) => {
          const key = queueKeys[i];
          return <li key={key} ref={(el) => { if (el) rows.current.set(key, el); else rows.current.delete(key); }}
            className={`qp-row ${i === index ? "current" : ""} ${over === i ? "over" : ""}`}
            data-queue-key={key} data-selected={selection.paths.has(key)} aria-current={i === index ? "true" : undefined}
            tabIndex={0} onClick={(e) => click(e, key)}
            onClickCapture={(e) => {
              if ((e.shiftKey || e.ctrlKey || e.metaKey) && (e.target as HTMLElement).closest(".qp-title")) {
                e.preventDefault(); e.stopPropagation(); choose(key, e); rows.current.get(key)?.focus();
              }
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return;
              if (e.key === " ") { e.preventDefault(); e.stopPropagation(); setSelection((s) => selectSong(s, queueKeys, key, { toggle: true })); }
              else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); engine.jump(i); }
              else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
                e.preventDefault(); e.stopPropagation();
                const next = e.key === "Home" ? 0 : e.key === "End" ? queue.length - 1 : Math.max(0, Math.min(queue.length - 1, i + (e.key === "ArrowUp" ? -1 : 1)));
                rows.current.get(queueKeys[next])?.focus();
                if (e.shiftKey) setSelection((s) => selectSong(s.anchor ? s : { ...s, anchor: key }, queueKeys, queueKeys[next], { range: true }));
              }
            }}
            draggable onDragStart={(e) => {
              const keys = selection.paths.has(key) ? selected : [key];
              if (!selection.paths.has(key)) setSelection({ paths: new Set(keys), anchor: key });
              dragging.current = { keys, from: i }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key);
            }}
            onDragEnd={() => { dragging.current = null; setOver(null); }}
            onDragOver={(e) => {
              if (dragging.current && !dragging.current.keys.includes(key)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(i); }
            }}
            onDragLeave={() => setOver((o) => o === i ? null : o)}
            onDrop={(e) => {
              e.preventDefault(); const drag = dragging.current; dragging.current = null; setOver(null);
              if (drag && !drag.keys.includes(key)) engine.moveMany(drag.keys, i + (drag.from < i ? 1 : 0));
            }}>
            <GripVertical className="w-3 h-3 qp-grip" aria-hidden="true" />
            <input type="checkbox" aria-label={`Select queued ${track.title} (${i + 1})`} checked={selection.paths.has(key)}
              onChange={() => {}} onClick={(e) => choose(key, e, true)} />
            <span className="qp-num mono">{i === index ? playing ? <Volume2 className="w-3 h-3" aria-label="Playing" /> : <Music className="w-3 h-3" aria-label="Current" /> : i + 1}</span>
            <button className="qp-title link" aria-label={`Play ${track.title}`} title={`Play ${track.title}`} onClick={() => engine.jump(i)}>
              <span className="truncate">{track.title}</span>{track.artist && <span className="dim truncate"> — {track.artist}</span>}
            </button>
            <span className="mono dim qp-len">{track.duration ? formatClock(track.duration) : ""}</span>
            <button className="row-btn" aria-label={`Remove ${track.title} from the queue`} title="Remove from the queue" onClick={() => { panel.current?.focus(); engine.removeMany([key]); }}><X className="w-3 h-3" /></button>
          </li>;
        })}
      </ol>
    </section>
  );
}
