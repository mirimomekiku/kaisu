import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface ConfirmButton {
  id: string;
  label: string;
  primary?: boolean;
}

export interface ConfirmConfig {
  title: string;
  body: ReactNode;
  buttons: ConfirmButton[];
  /** The button Escape stands for. Defaults to the one with id "cancel", else the first. Never the primary action. */
  cancelId?: string;
}

function ConfirmDialog({ config, onChoose }: { config: ConfirmConfig; onChoose: (id: string) => void }) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const cancelId = config.cancelId ?? config.buttons.find((b) => b.id === "cancel")?.id ?? config.buttons[0]?.id ?? "cancel";

  useEffect(() => {
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onChoose(cancelId);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cancelId, onChoose]);

  return (
    <div className="backdrop" role="presentation">
      <div className="sheet" role="alertdialog" aria-modal="true" aria-label={config.title}>
        <div className="sheet-head">
          <h2 className="m-0 text-[15px] font-bold">{config.title}</h2>
        </div>
        <div className="sheet-body">{config.body}</div>
        <div className="sheet-foot">
          {config.buttons.map((b) => (
            <button key={b.id} ref={b.primary ? primaryRef : undefined} type="button" className={`btn ${b.primary ? "primary" : ""}`} onClick={() => onChoose(b.id)}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** `const { ask, dialog } = useConfirm();  const choice = await ask({...});`  Render `dialog` somewhere in the tree. */
export function useConfirm() {
  const [open, setOpen] = useState<{ config: ConfirmConfig; resolve: (id: string) => void } | null>(null);

  const ask = useCallback(
    (config: ConfirmConfig) => new Promise<string>((resolve) => setOpen({ config, resolve })),
    [],
  );
  const choose = useCallback(
    (id: string) => {
      open?.resolve(id);
      setOpen(null);
    },
    [open],
  );

  return { ask, dialog: open ? <ConfirmDialog config={open.config} onChoose={choose} /> : null };
}
