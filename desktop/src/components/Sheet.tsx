import { useEffect, type ReactNode } from "react";

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop" role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: "min(760px, 94vw)", maxWidth: "none" } : undefined}>
        <div className="sheet-head">
          <h2 className="m-0 text-[15px] font-bold truncate">{title}</h2>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
