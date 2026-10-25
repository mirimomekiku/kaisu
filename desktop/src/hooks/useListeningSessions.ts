import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerEngine } from "../lib/audioEngine";
import { persist, readStored, registerStorageFlush, type SavedPlayer } from "../lib/storage";
import { MAX_SESSIONS, relocateSessions, sanitizeSessions, sessionPlayer, type ListeningSession } from "../lib/listeningSessions";

export function useListeningSessions(engine: PlayerEngine, ready: boolean) {
  const [sessions, setSessions] = useState<ListeningSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<ListeningSession[]>([]), active = useRef<string | null>(null), keys = useRef<string[]>([]);
  const lastHeard = useRef(0), restoring = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canSave = useRef(false);
  useEffect(() => { let stale = false; void readStored("listeningSessions").then((raw) => {
    if (!stale) { latest.current = sanitizeSessions(raw); setSessions(latest.current); setLoaded(true); canSave.current = true; }
  }, () => { if (!stale) { setLoaded(true); canSave.current = true; } }); return () => { stale = true; }; }, []);
  const save = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (canSave.current) await persist("listeningSessions", latest.current);
  }, []);
  const commit = useCallback((next: ListeningSession[]) => {
    latest.current = next.slice(0, MAX_SESSIONS); setSessions(latest.current);
    if (!timer.current) timer.current = setTimeout(() => { void save().catch(() => {}); }, 1000);
  }, [save]);
  const capture = useCallback((force = false, heard = 0) => {
    if (!canSave.current || restoring.current) return;
    const state = engine.getState();
    if (!state.queue.length || state.index < 0) { active.current = null; keys.current = []; return; }
    const freshQueue = keys.current.length > 0 && !state.queueKeys.some((key) => keys.current.includes(key));
    const now = Date.now();
    if (freshQueue) { active.current = null; keys.current = state.queueKeys; }
    if (state.playing && (!active.current || freshQueue || now - lastHeard.current > 30 * 60_000)) active.current = crypto.randomUUID();
    if (!active.current && force) active.current = crypto.randomUUID();
    if (!active.current) return;
    keys.current = state.queueKeys;
    if (state.playing || heard || force) lastHeard.current = now;
    const raw: SavedPlayer = { queue: state.queue, index: state.index, position: engine.getTime().position, volume: state.volume, rate: state.rate, repeat: state.repeat, shuffle: state.shuffle };
    const snapshot = sessionPlayer(raw); if (!snapshot) return;
    const old = latest.current.find((s) => s.id === active.current);
    const session: ListeningSession = { id: active.current, name: old?.name ?? (state.queue[state.index].album?.slice(0, 80) || state.queue[state.index].title.slice(0, 80)), started: old?.started ?? now, updated: now, seconds: (old?.seconds ?? 0) + heard, ...snapshot };
    commit([session, ...latest.current.filter((s) => s.id !== session.id)]);
  }, [engine, commit]);
  useEffect(() => {
    if (!loaded || !ready) return;
    const state = engine.subscribe(() => capture());
    const listening = engine.subscribeListening((_track, seconds) => capture(false, seconds));
    if (engine.getState().playing) capture();
    const flush = registerStorageFlush(async () => { engine.flushListening(); capture(); await save(); });
    return () => { state(); listening(); flush(); };
  }, [loaded, ready, engine, capture, save]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const restore = useCallback((id: string) => {
    const session = latest.current.find((s) => s.id === id); if (!session) return;
    engine.pause(); capture();
    restoring.current = true;
    try { engine.applySettings(session.player); engine.restore(session.player.queue, session.player.index, session.player.position); active.current = id; keys.current = engine.getState().queueKeys; lastHeard.current = Date.now(); }
    finally { restoring.current = false; }
  }, [engine, capture]);
  const rename = useCallback((id: string, name: string): string | null => {
    if (!name.trim() || name.trim().length > 80) return "Use a name between 1 and 80 characters.";
    commit(latest.current.map((s) => s.id === id ? { ...s, name: name.trim() } : s)); return null;
  }, [commit]);
  const remove = useCallback((id: string) => { if (active.current === id) active.current = null; commit(latest.current.filter((s) => s.id !== id)); }, [commit]);
  const clear = useCallback(() => { active.current = null; commit([]); }, [commit]);
  const relocate = useCallback((from: string, to: string) => { commit(relocateSessions(latest.current, from, to)); }, [commit]);
  return { sessions, loaded, restore, rename, remove, clear, relocate, saveCurrent: () => { engine.flushListening(); capture(true); } };
}
export type ListeningSessionsApi = ReturnType<typeof useListeningSessions>;
