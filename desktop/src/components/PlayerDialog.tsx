import { Loader2 } from "lucide-react";
import { useState } from "react";
import Sheet from "./Sheet";

interface Props {
  title: string;
  /** Where to play from, or null while the file is being got ready. */
  src: string | null;
  audio: boolean;
  /** Wording for the wait before `src` is known. */
  waiting?: string;
  onClose: () => void;
  /** Hand the file to the system's own player, for formats this one can't play. */
  onOpenExternally?: () => void;
}

/** Plays a downloaded file (or a preview) inside Kaisu. */
export default function PlayerDialog({ title, src, audio, waiting = "Getting the file ready…", onClose, onOpenExternally }: Props) {
  const [failed, setFailed] = useState(false);
  const common = {
    src: src ?? undefined,
    controls: true,
    autoPlay: true,
    onError: () => setFailed(true),
    "aria-label": title,
  };
  return (
    <Sheet
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          {failed && onOpenExternally && (
            <button type="button" className="btn" onClick={onOpenExternally}>
              Open in your player
            </button>
          )}
          <button type="button" className="btn primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {src === null ? (
        <p className="m-0 flex items-center gap-2" role="status">
          <Loader2 className="w-4 h-4 animate-spin" /> {waiting}
        </p>
      ) : audio ? (
        <audio {...common} className="w-full" />
      ) : (
        <video {...common} className="w-full max-h-[60vh] bg-black rounded-[3px]" />
      )}
      {failed && (
        <p className="mt-2 mb-0" role="alert" style={{ color: "#b3261e" }}>
          This file can't be played here (the format or its codecs aren't supported by Kaisu's player).{onOpenExternally ? " Your own player may handle it." : ""}
        </p>
      )}
    </Sheet>
  );
}
