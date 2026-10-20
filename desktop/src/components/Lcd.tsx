export interface LcdState {
  title: string;
  subtitle?: string;
  /** 0-100, or null for "no progress to show". */
  progress: number | null;
  /** Show a moving bar for work of unknown length (searching, looking a link up). */
  busy?: boolean;
}

/** The recessed display in the middle of the toolbar: what Kaisu is doing right now. */
export default function Lcd({ title, subtitle, progress, busy }: LcdState) {
  return (
    <div className="lcd" role="status" aria-live="polite" aria-label="Status display" data-tauri-drag-region>
      <div className="lcd-title" title={title} data-tauri-drag-region>
        {title}
      </div>
      <div className="lcd-sub" data-tauri-drag-region>
        {subtitle ?? "\u00a0"}
      </div>
      {(busy || progress !== null) && (
        <div className={`lcd-bar ${busy ? "busy" : ""}`} data-tauri-drag-region>
          <i style={{ width: `${progress ?? 0}%` }} />
        </div>
      )}
    </div>
  );
}
