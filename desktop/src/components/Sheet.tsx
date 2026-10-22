import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons along the bottom edge. */
  footer?: ReactNode;
  /** More room, for something like a video. */
  wide?: boolean;
}

/** A dialog over the window, closed with Escape. Like the confirmation dialogs, but for anything with its own content. */
export default function Sheet({ title, onClose, children, footer, wide }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']") ?? []).filter((el) => el.getClientRects().length > 0);
    const first = dialog.current?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), textarea:not(:disabled)") ?? controls()[0];
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== dialog.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      } else if (e.key === "Tab") {
        const list = controls();
        const at = list.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey ? at <= 0 : at < 0 || at === list.length - 1) {
          e.preventDefault();
          (e.shiftKey ? list[list.length - 1] : list[0])?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (previous?.isConnected) previous.focus(); };
  }, []);

  return (
    <div className="backdrop" role="presentation">
      <div ref={dialog} className="sheet" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: "min(760px, 94vw)", maxWidth: "none" } : undefined}>
        <div className="sheet-head">
          <h2 className="m-0 text-[15px] font-bold truncate">{title}</h2>
          <button type="button" className="row-btn" aria-label="Dismiss dialog" title={`Close ${title}`} onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
