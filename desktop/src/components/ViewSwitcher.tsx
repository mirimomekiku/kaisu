import { LayoutGrid, List, Rows3, Table2, type LucideIcon } from "lucide-react";
import type { ViewMode } from "../lib/storage";

const VIEWS: Record<ViewMode, { icon: LucideIcon; label: string }> = {
  details: { icon: Table2, label: "Details" },
  list: { icon: List, label: "List" },
  grid: { icon: LayoutGrid, label: "Grid" },
  compact: { icon: Rows3, label: "Compact" },
};

interface Props {
  value: ViewMode;
  options: ViewMode[];
  onChange: (view: ViewMode) => void;
  label: string;
}

/** Segmented icon buttons for picking a layout. `value` falls back to the first option if unsupported here. */
export default function ViewSwitcher({ value, options, onChange, label }: Props) {
  const current = options.includes(value) ? value : options[0];
  return (
    <div role="radiogroup" aria-label={label} className="seg">
      {options.map((view) => {
        const { icon: Icon, label: text } = VIEWS[view];
        return (
          <button
            key={view}
            type="button"
            role="radio"
            aria-checked={view === current}
            aria-label={`${text} view`}
            title={`${text} view`}
            onClick={() => onChange(view)}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );
}

/** The layout to actually use: a saved choice may not exist for this list. */
export const effectiveView = (value: ViewMode, options: ViewMode[]): ViewMode => (options.includes(value) ? value : options[0]);
