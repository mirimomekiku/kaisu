export interface Command {
  id: string;
  title: string;
  /** Where it lives in the app ("Go to", "Downloads", "Library"…); also searchable. */
  group: string;
  /** Extra words that should find it. */
  keywords?: string;
  run: () => void;
}

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The commands that match every word typed, best first: a title starting with the query, then a title word starting with
 * a typed word, then anything else. Equal scores keep their original order. An empty query lists everything.
 */
export function rankCommands(commands: Command[], query: string): Command[] {
  const typed = words(query);
  if (typed.length === 0) return commands;
  const scored: Array<{ command: Command; score: number; at: number }> = [];
  commands.forEach((command, at) => {
    const title = command.title.toLowerCase();
    const haystack = `${title} ${command.group.toLowerCase()} ${(command.keywords ?? "").toLowerCase()}`;
    if (!typed.every((word) => haystack.includes(word))) return;
    const titleWords = words(command.title);
    let score = title.startsWith(typed.join(" ")) ? 4 : 0;
    for (const word of typed) score += titleWords.some((w) => w.startsWith(word)) ? 2 : title.includes(word) ? 1 : 0;
    scored.push({ command, score, at });
  });
  return scored.sort((a, b) => b.score - a.score || a.at - b.at).map((s) => s.command);
}
