// The queue is kept newest first, and the oldest waiting download starts first. These helpers work on that list.

interface Entry {
  id: string;
  status: string;
}

/**
 * Puts `id` where `targetId` is among the waiting downloads. The waiting ones keep their places in the list and only swap
 * who sits in them, so running and finished downloads never move. Returns the same array when nothing changes.
 */
export function reorderWaiting<T extends Entry>(items: T[], id: string, targetId: string): T[] {
  const slots = items.flatMap((x, i) => (x.status === "queued" ? [i] : []));
  const waiting = slots.map((i) => items[i]);
  const from = waiting.findIndex((x) => x.id === id);
  const to = waiting.findIndex((x) => x.id === targetId);
  if (from < 0 || to < 0 || from === to) return items;
  const moved = waiting.slice();
  moved.splice(to, 0, moved.splice(from, 1)[0]);
  const next = items.slice();
  slots.forEach((slot, k) => (next[slot] = moved[k]));
  return next;
}

/** Each waiting download's place in line: 1 is the one that starts next. */
export function queuePositions(items: Entry[]): Map<string, number> {
  const positions = new Map<string, number>();
  let place = 0;
  for (const item of items.slice().reverse()) if (item.status === "queued") positions.set(item.id, ++place);
  return positions;
}
