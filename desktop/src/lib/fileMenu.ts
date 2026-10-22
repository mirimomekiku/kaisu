import type { MenuEntry } from "../components/ContextMenu";
import type { MediaActions } from "../hooks/useMediaDialogs";
import { isAudioFile } from "./mediaKind";

/** Identical file operations in a row's dropdown and its right-click menu. */
export function fileMenu(path: string | null, exists: boolean | undefined, media: MediaActions | null, actions: {
  onOpen: (path: string) => void; onReveal: (path: string) => void; onCopyPath?: (path: string) => void; onDelete?: (path: string) => void;
}): MenuEntry[] {
  if (!path) return [];
  const missing = exists === false;
  return [
    ...(media ? [{ label: "Play in Kaisu", onSelect: () => media.play(path), disabled: missing }] : []),
    { label: "Open file", onSelect: () => actions.onOpen(path), disabled: missing },
    { label: "Show in folder", onSelect: () => actions.onReveal(path), disabled: missing },
    ...(media && isAudioFile(path) ? [
      { label: "Play next", onSelect: () => media.queue([{ path }], "next"), disabled: missing },
      { label: "Add to queue", onSelect: () => media.queue([{ path }], "add"), disabled: missing },
    ] : []),
    ...(media ? [{ label: "Convert to audio", onSelect: () => media.convert(path), disabled: missing }] : []),
    ...(actions.onCopyPath ? [{ label: "Copy file location", onSelect: () => actions.onCopyPath!(path) }] : []),
    ...(actions.onDelete ? [{ kind: "separator" as const }, { label: "Delete file", onSelect: () => actions.onDelete!(path), disabled: missing }] : []),
  ];
}
