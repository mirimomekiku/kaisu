import { sanitizePlayer, type SavedPlayer } from "./storage";
export const MAX_SESSIONS = 30;
export const MAX_SESSION_TRACKS = 500;
export interface ListeningSession { id: string; name: string; started: number; updated: number; seconds: number; player: SavedPlayer; omitted: number }
export function sessionPlayer(player: SavedPlayer): { player: SavedPlayer; omitted: number } | null {
  const safe = sanitizePlayer(player); if (!safe) return null;
  const start = Math.min(Math.max(0, safe.index - 250), Math.max(0, safe.queue.length - MAX_SESSION_TRACKS));
  return { omitted: Math.max(0, player.queue.length - MAX_SESSION_TRACKS), player: { ...safe, truncated: undefined,
    queue: safe.queue.slice(start, start + MAX_SESSION_TRACKS).map(({ cover: _cover, ...track }) => track), index: safe.index - start } };
}
export function sanitizeSessions(raw: unknown): ListeningSession[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  return raw.slice(0, MAX_SESSIONS).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const r = value as Partial<ListeningSession>;
    if (typeof r.id !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(r.id) || ids.has(r.id) || typeof r.name !== "string" || !r.player || !Number.isFinite(r.started) || !Number.isFinite(r.updated)) return [];
    const snapshot = sessionPlayer(r.player); if (!snapshot) return [];
    ids.add(r.id);
    return [{ id: r.id, name: r.name.trim().slice(0, 80) || "Listening session", started: r.started!, updated: r.updated!,
      seconds: typeof r.seconds === "number" && Number.isFinite(r.seconds) ? Math.max(0, r.seconds) : 0,
      player: snapshot.player, omitted: typeof r.omitted === "number" && Number.isFinite(r.omitted) ? Math.max(0, Math.floor(r.omitted)) : snapshot.omitted }];
  });
}
export function relocateSessions(sessions: ListeningSession[], from: string, to: string): ListeningSession[] {
  return sessions.map((s) => ({ ...s, player: { ...s.player, queue: s.player.queue.map((t) => t.path === from ? { ...t, path: to, cover: undefined } : t) } }));
}
