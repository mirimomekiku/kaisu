import { useState } from "react";
import type { DownloadItem } from "../hooks/useDownloads";
import { checkSpeedLimit } from "../lib/validate";
import Sheet from "./Sheet";

const QUICK = ["250K", "500K", "1M", "2M", "5M"];

interface Props {
  item: DownloadItem;
  /** `null` takes the limit off this download. */
  onSet: (id: string, limit: string | null) => void;
  onClose: () => void;
}

/** A speed limit for a single download, on top of (or instead of) the one in Settings. */
export default function SpeedLimitDialog({ item, onSet, onClose }: Props) {
  const [text, setText] = useState(item.extra.rate_limit ?? "");
  const problem = checkSpeedLimit(text);
  const save = () => {
    if (problem) return;
    onSet(item.id, text.trim() || null);
    onClose();
  };

  return (
    <Sheet
      title="Speed limit"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!!problem} onClick={save}>
            Set limit
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="m-0 truncate" title={item.title}>
          Slow down <b>{item.title}</b>. Other downloads keep their own speed.
        </p>
        <input className="field" aria-label="Speed limit" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="500K or 2M a second; empty means no limit" aria-invalid={!!problem} />
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button key={q} type="button" className="btn small" onClick={() => setText(q)}>
              {q}
            </button>
          ))}
          <button type="button" className="btn small" onClick={() => setText("")}>
            No limit
          </button>
        </div>
        {problem && (
          <p className="m-0" role="alert" style={{ color: "#b3261e" }}>
            {problem}
          </p>
        )}
        {item.status === "downloading" && <p className="m-0 dim">The download restarts for a moment and carries on from where it was.</p>}
      </form>
    </Sheet>
  );
}
