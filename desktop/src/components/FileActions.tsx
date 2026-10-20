import { FolderOpen, Play, TriangleAlert } from "lucide-react";

interface Props {
  path: string | null;
  /** undefined while still being checked. */
  exists: boolean | undefined;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
  /** Icon-only buttons, for tight rows. */
  iconOnly?: boolean;
  /** Keep "Open" labelled but show the secondary action as an icon (tables). */
  openLabelled?: boolean;
}

/** Open / show-in-folder buttons for a downloaded file, or a notice if it has been moved or deleted. */
export default function FileActions({ path, exists, onOpen, onReveal, iconOnly = false, openLabelled = false }: Props) {
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
    </span>
  );
}
