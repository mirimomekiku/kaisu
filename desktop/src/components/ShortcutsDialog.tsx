import { useEffect, useRef } from "react";
import { SHORTCUT_GROUPS, modLabel } from "../lib/shortcuts";

/** The keyboard cheat sheet. */
export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
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
    <div className="backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" style={{ maxWidth: 560 }}>
        <div className="sheet-head">
          <h2 className="m-0 text-[15px] font-bold">Keyboard shortcuts</h2>
        </div>
        <div className="sheet-body flex flex-col gap-3">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title} aria-label={g.title}>
              <div className="source-header" style={{ padding: "4px 0 3px" }}>
                {g.title}
              </div>
              <ul className="m-0 p-0 list-none flex flex-col gap-1">
                {g.items.map((item) => (
                  <li key={item.action} className="flex items-center justify-between gap-4">
                    <span>{item.action.replace(/Mod/g, modLabel)}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {item.keys.map((k) => (
                        <kbd key={k} className="kbd">
                          {k === "Mod" ? modLabel : k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="sheet-foot">
          <button ref={closeRef} type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
