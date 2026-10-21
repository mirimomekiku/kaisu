import { AudioLines, Copy, FolderOpen, ListEnd, ListStart, MonitorPlay, Play, Trash2, TriangleAlert } from "lucide-react";
import { isAudioFile } from "../lib/mediaKind";
import { useMediaActions } from "../hooks/useMediaDialogs";

interface Props {
  path: string | null;
  /** undefined while still being checked. */
  exists: boolean | undefined;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
  /** Quick actions, when the page offers them. */
  onCopyPath?: (path: string) => void;
  onDelete?: (path: string) => void;
  /** Icon-only buttons, for tight rows. */
  iconOnly?: boolean;
  /** Keep "Open" labelled but show the secondary action as an icon (tables). */
  openLabelled?: boolean;
}

/** Open / show-in-folder buttons for a downloaded file, or a notice if it has been moved or deleted. */
export default function FileActions({ path, exists, onOpen, onReveal, onCopyPath, onDelete, iconOnly = false, openLabelled = false }: Props) {
  const media = useMediaActions();
  if (!path) return null;
  if (exists === false) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: "#9a6a00" }} title={path}>
        <TriangleAlert className="w-3.5 h-3.5 shrink-0" /> {iconOnly ? "" : "File moved or deleted"}
      </span>
    );
  }
  const cls = iconOnly ? "row-btn" : "btn small";
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <button type="button" onClick={() => onOpen(path)} title="Open file" aria-label="Open file" className={openLabelled ? "btn small" : cls}>
        <Play className="w-3 h-3" /> {(!iconOnly || openLabelled) && "Open"}
      </button>
      <button type="button" onClick={() => onReveal(path)} title="Show in folder" aria-label="Show in folder" className={openLabelled ? "row-btn" : cls}>
        <FolderOpen className="w-3 h-3" /> {!iconOnly && !openLabelled && "Show in folder"}
      </button>
      {media && (
        <>
          <button type="button" onClick={() => media.play(path)} title="Play in Kaisu" aria-label="Play in Kaisu" className="row-btn">
            <MonitorPlay className="w-3 h-3" />
          </button>
          {isAudioFile(path) && (
            <>
              <button type="button" onClick={() => media.queue([{ path }], "next")} title="Play next" aria-label="Play next" className="row-btn">
                <ListStart className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => media.queue([{ path }], "add")} title="Add to the queue" aria-label="Add to queue" className="row-btn">
                <ListEnd className="w-3 h-3" />
              </button>
            </>
          )}
          <button type="button" onClick={() => media.convert(path)} title="Make an audio copy" aria-label="Convert to audio" className="row-btn">
            <AudioLines className="w-3 h-3" />
          </button>
        </>
      )}
      {onCopyPath && (
        <button type="button" onClick={() => onCopyPath(path)} title="Copy the file's location" aria-label="Copy file location" className="row-btn">
          <Copy className="w-3 h-3" />
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={() => onDelete(path)} title="Delete the file from your computer" aria-label="Delete file" className="row-btn">
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}
