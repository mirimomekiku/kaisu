import { AlertTriangle, Link2, X } from "lucide-react";
import { formatBytes } from "../lib/format";
import { shortLink } from "../lib/links";

interface Props {
  /** Some helper tools are missing. */
  toolsMissing: boolean;
  onFixTools: () => void;
  /** A sleep or shut-down countdown is running. */
  countdown: { action: "sleep" | "shutdown"; seconds: number } | null;
  onCancelCountdown: () => void;
  /** Downloads that were unfinished when Kaisu last closed, waiting for a decision. */
  restored: { count: number; onResume: () => void; onRemove: () => void; onLater: () => void } | null;
  /** A link found on the clipboard. */
  clipboard: { link: string; onLookUp: () => void; onDismiss: () => void } | null;
  flash: { text: string; error: boolean } | null;
  onDismissFlash: () => void;
  /** Unfinished downloads (`.part` files) found in the download folder. */
  leftovers: { count: number; bytes: number; resumable: number; onResume: (kind: "video" | "audio") => void; onClear: () => void; onLater: () => void } | null;
}

/** The strips under the toolbar: things that need attention but aren't part of any one page. */
export default function AppBanners({ toolsMissing, onFixTools, countdown, onCancelCountdown, restored, clipboard, flash, onDismissFlash, leftovers }: Props) {
  return (
    <>
      {toolsMissing && (
        <div className="banner">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Some helper tools are missing, so downloads may not work properly.</span>
          <button onClick={onFixTools} className="link border-0 bg-transparent p-0" style={{ font: "inherit" }}>
            Fix now
          </button>
        </div>
      )}

      {countdown && (
        <div role="alert" className="banner countdown">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>
            Downloads finished. Kaisu will {countdown.action === "sleep" ? "put the computer to sleep" : "shut the computer down"} in {countdown.seconds} second
            {countdown.seconds === 1 ? "" : "s"}.
          </span>
          <button className="btn small" onClick={onCancelCountdown}>
            Cancel
          </button>
        </div>
      )}

      {restored && (
        <div role="status" className="banner">
          <span>
            {restored.count} download{restored.count === 1 ? " was" : "s were"} unfinished when Kaisu last closed.
          </span>
          <button className="btn small primary" onClick={restored.onResume}>
            Resume
          </button>
          <button className="btn small" onClick={restored.onRemove}>
            Remove them
          </button>
          <button className="row-btn" aria-label="Decide later" title="Decide later" onClick={restored.onLater}>
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {leftovers && (
        <div role="status" aria-label="Unfinished downloads" className="banner">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>
            {leftovers.count} unfinished download{leftovers.count === 1 ? "" : "s"} ({formatBytes(leftovers.bytes)}) found in your download folder.
          </span>
          {leftovers.resumable > 0 && (
            <>
              <button className="btn small primary" onClick={() => leftovers.onResume("video")} title="Ask for these videos again; yt-dlp carries on from where it stopped when it can">
                Resume as video
              </button>
              <button className="btn small" onClick={() => leftovers.onResume("audio")}>
                Resume as audio
              </button>
            </>
          )}
          <button className="btn small" onClick={leftovers.onClear}>
            Delete them
          </button>
          <button className="row-btn" aria-label="Not now" title="Not now" onClick={leftovers.onLater}>
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {clipboard && (
        <div role="status" className="banner" style={{ background: "linear-gradient(#eef5ff,#dcebff)", borderColor: "#9fbde8", color: "#1d3f73" }}>
          <Link2 className="w-3.5 h-3.5" />
          <span>
            You copied a link: <b className="selectable">{shortLink(clipboard.link)}</b>
          </span>
          <button className="btn small primary" onClick={clipboard.onLookUp}>
            Look it up
          </button>
          <button className="row-btn" aria-label="Dismiss" title="Dismiss" onClick={clipboard.onDismiss}>
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {flash && (
        <div role="status" className={`banner ${flash.error ? "bad" : "ok"}`}>
          <span>{flash.text}</span>
          <button onClick={onDismissFlash} aria-label="Dismiss" className="row-btn">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </>
  );
}
