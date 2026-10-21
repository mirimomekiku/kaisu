// Operations on a play queue: a list of items and the place in it. They never change what they are given.

/** Inserts `items` right after position `index` (at the front when nothing is playing). */
export function insertAfter<T>(queue: T[], index: number, items: T[]): T[] {
  const at = Math.min(Math.max(index + 1, 0), queue.length);
  return [...queue.slice(0, at), ...items, ...queue.slice(at)];
}

/** Moves the item at `from` to `to`, shifting the ones between. Returns the new list and where the playing item ended up. */
export function moveItem<T>(queue: T[], current: number, from: number, to: number): { queue: T[]; current: number } {
  if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return { queue, current };
  const next = queue.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  let place = current;
  if (current === from) place = to;
  else if (from < current && to >= current) place = current - 1;
  else if (from > current && to <= current) place = current + 1;
  return { queue: next, current: place };
}

/** Removes the item at `at`. The playing position follows the same item; if the playing item itself is removed it moves to the one after it. */
export function removeAt<T>(queue: T[], current: number, at: number): { queue: T[]; current: number; removedCurrent: boolean } {
  if (at < 0 || at >= queue.length) return { queue, current, removedCurrent: false };
  const next = queue.filter((_, i) => i !== at);
  if (at < current) return { queue: next, current: current - 1, removedCurrent: false };
  if (at === current) return { queue: next, current: Math.min(current, next.length - 1), removedCurrent: true };
  return { queue: next, current, removedCurrent: false };
}

/** A shuffled copy (Fisher–Yates). `random` is injectable so tests are exact. */
export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Puts the playing item first and shuffles the rest. */
export function shuffleAround<T>(queue: T[], current: number, random?: () => number): { queue: T[]; current: number } {
  if (current < 0 || current >= queue.length) return { queue: shuffled(queue, random), current: -1 };
  const rest = queue.filter((_, i) => i !== current);
  return { queue: [queue[current], ...shuffled(rest, random)], current: 0 };
}

/** Back to the original order after a shuffle: keeps only what is still queued, and finds the playing item in it. */
export function unshuffle<T>(queue: T[], current: number, original: T[]): { queue: T[]; current: number } {
  const playing = queue[current];
  const present = new Set(queue);
  const restored = original.filter((t) => present.has(t));
  // Anything added since the shuffle goes on the end.
  const known = new Set(restored);
  for (const t of queue) if (!known.has(t)) restored.push(t);
  return { queue: restored, current: playing === undefined ? -1 : restored.indexOf(playing) };
}
