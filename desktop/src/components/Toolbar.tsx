import type { RefObject } from "react";
import type { SearchSource } from "../lib/api";
import { SEARCH_SOURCES } from "../lib/sources";
import type { ViewMode } from "../lib/storage";
import Lcd, { type LcdState } from "./Lcd";
import SearchField from "./SearchField";
import ViewSwitcher from "./ViewSwitcher";
import WindowControls from "./WindowControls";

interface Props {
  /** The Settings page shows its title here instead of the layout switcher. */
  title: string | null;
  view: ViewMode;
  viewOptions: ViewMode[];
  onView: (view: ViewMode) => void;
  lcd: LcdState;
  source: SearchSource;
  onSource: (source: SearchSource) => void;
  sourceName: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  busy: boolean;
}

/** The bar across the top: layout switcher, status display, and the search box with its source. */
export default function Toolbar({ title, view, viewOptions, onView, lcd, source, onSource, sourceName, value, onChange, onSubmit, inputRef, busy }: Props) {
  return (
    <header className="toolbar" data-tauri-drag-region>
      <WindowControls />
      <div className="toolbar-group" data-tauri-drag-region>
        {title === null ? (
          <ViewSwitcher value={view} options={viewOptions} onChange={onView} label="Layout" />
        ) : (
          <span className="font-bold text-[13px]" data-tauri-drag-region style={{ textShadow: "0 1px 0 rgba(255,255,255,.7)" }}>
            {title}
          </span>
        )}
      </div>

      <Lcd {...lcd} />

      <div className="toolbar-group end" data-tauri-drag-region>
        <select value={source} onChange={(e) => onSource(e.target.value as SearchSource)} className="source-select" aria-label="Search source" title="Where to search">
          {SEARCH_SOURCES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <SearchField value={value} onChange={onChange} onSubmit={onSubmit} inputRef={inputRef} busy={busy} placeholder={`Search ${sourceName} or paste a link`} sourceName={sourceName} />
      </div>
    </header>
  );
}
