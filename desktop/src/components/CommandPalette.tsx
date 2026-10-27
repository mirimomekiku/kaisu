import { useEffect, useMemo, useRef, useState } from "react";
import { rankCommands, type Command } from "../lib/commands";
import Sheet from "./Sheet";

const MAX_SHOWN = 40;

/** Type to find any action in the app and run it with Enter. */
export default function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const matches = useMemo(() => rankCommands(commands, query).slice(0, MAX_SHOWN), [commands, query]);
  const at = Math.min(active, Math.max(0, matches.length - 1));
  useEffect(() => { list.current?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "nearest" }); }, [at, matches]);
  const run = (command: Command | undefined) => { if (!command) return; onClose(); command.run(); };
  return <Sheet title="Command palette" onClose={onClose}>
    <input className="field w-full" role="combobox" aria-label="Search commands" aria-expanded="true" aria-controls="command-list" aria-activedescendant={matches[at] ? `command-${matches[at].id}` : undefined}
      placeholder="Type a command, page or setting…" value={query} autoComplete="off" spellCheck={false}
      onChange={(e) => { setQuery(e.target.value); setActive(0); }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(at + 1, matches.length - 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(at - 1, 0)); }
        else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); run(matches[at]); }
      }} />
    <ul ref={list} id="command-list" role="listbox" aria-label="Commands" className="palette-list">
      {matches.map((command, i) => <li key={command.id} id={`command-${command.id}`} role="option" aria-selected={i === at} className={`palette-item${i === at ? " active" : ""}`}
        onMouseMove={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => run(command)}>
        <span className="flex-1 min-w-0 truncate">{command.title}</span><span className="dim">{command.group}</span>
      </li>)}
    </ul>
    {matches.length === 0 && <p role="status" className="dim">No command matches “{query}”.</p>}
  </Sheet>;
}
