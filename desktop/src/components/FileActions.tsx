import { MonitorPlay, Play, TriangleAlert } from "lucide-react";
import { fileMenu } from "../lib/fileMenu";
import { useMediaActions } from "../hooks/useMediaDialogs";
import { ActionMenu } from "./Dropdown";

interface Props {
  path: string | null;
  /** undefined while still being checked. */
  exists: boolean | undefined;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
  onCopyPath?: (path: string) => void;
  onDelete?: (path: string) => void;
  iconOnly?: boolean;
  openLabelled?: boolean;
}

/** Keep opening and playback visible; group file management and queue operations. */
export default function FileActions({ path, exists, onOpen, onReveal, onCopyPath, onDelete, iconOnly = false, openLabelled = false }: Props) {
  const media = useMediaActions();
  if (!path) return null;
  if (exists === false) return <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: "#9a6a00" }} title={path}><TriangleAlert className="w-3.5 h-3.5 shrink-0" />{iconOnly ? "" : "File moved or deleted"}</span>;
  const items = fileMenu(path, exists, media, { onOpen, onReveal, onCopyPath, onDelete }).filter((item) => item.kind === "separator" || item.label !== "Open file" && item.label !== "Play in Kaisu");
  return <span className="inline-flex items-center gap-1.5 shrink-0">
    <button type="button" onClick={() => onOpen(path)} title="Open in your system's default app" aria-label="Open file" className={!iconOnly || openLabelled ? "btn small" : "row-btn"}><Play className="w-3 h-3" />{(!iconOnly || openLabelled) && "Open"}</button>
    {media && <button type="button" onClick={() => media.play(path)} title="Play in Kaisu" aria-label="Play in Kaisu" className="btn small"><MonitorPlay className="w-3 h-3" />Play</button>}
    <ActionMenu label="File actions" compact items={items} />
  </span>;
}
