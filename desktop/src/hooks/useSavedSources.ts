import { useCallback, useEffect, useRef, useState } from "react";
import { classifyLink, errorText, getPlaylist, type PlaylistInfo } from "../lib/api";
import { persist, readStored } from "../lib/storage";
import { MAX_SAVED_SOURCES, refreshSource, sanitizeSavedSources, SOURCE_CHECK_LIMIT, sourceUrl, type SavedSource } from "../lib/savedSources";
import type { DownloadReq } from "./useDownloadActions";
import { canonicalUrl } from "../lib/links";

export function useSavedSources(ready: boolean, submit: (requests: DownloadReq[], estimate?: number | null, accepted?: (urls: string[]) => void) => Promise<number>, flash: (text: string, error?: boolean) => void) {
  const [sources, setSources] = useState<SavedSource[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const latest = useRef(sources), busy = useRef(false), alive = useRef(true);
  const current = useRef({ ready, submit, flash }); current.current = { ready: ready && loaded, submit, flash };
  useEffect(() => { alive.current = true; let stale = false; void readStored("savedSources").then((raw) => {
    if (!stale) { latest.current = sanitizeSavedSources(raw); setSources(latest.current); setLoaded(true); }
  }, () => { if (!stale) setLoaded(true); }); return () => { stale = true; alive.current = false; }; }, []);
  const commit = useCallback((next: SavedSource[]) => {
    latest.current = next; setSources(next); void persist("savedSources", next).catch(() => {});
  }, []);
  const save = useCallback(async (text: string, existing?: PlaylistInfo) => {
    if (busy.current || !current.current.ready) return false;
    const url = sourceUrl(text);
    if (!url) { current.current.flash("Use a public channel or playlist link without a login or signed-link credentials.", true); return false; }
    if (latest.current.some((s) => s.url === url)) { current.current.flash("That source is already saved."); return true; }
    if (latest.current.length >= MAX_SAVED_SOURCES) { current.current.flash(`You can save up to ${MAX_SAVED_SOURCES} sources.`, true); return false; }
    busy.current = true; setWorking("new");
    try {
      if (!existing && await classifyLink(url) === "video") throw new Error("Paste a channel or playlist link rather than an individual video.");
      const listing = existing ?? await getPlaylist(url, SOURCE_CHECK_LIMIT);
      if (!alive.current) return false;
      const source = refreshSource({ id: crypto.randomUUID(), url, title: listing.title, kind: listing.kind === "channel" ? "channel" : "playlist", preset: "best", audioFormat: "mp3", playlistId: "", seen: [], pending: [], checked: 0, total: null }, listing);
      commit([...latest.current, source]); current.current.flash("Source saved. Review its items before downloading."); return true;
    } catch (e) { current.current.flash(errorText(e), true); return false; }
    finally { busy.current = false; if (alive.current) setWorking(null); }
  }, [commit]);
  const check = useCallback(async (id?: string) => {
    if (busy.current || !current.current.ready) return;
    busy.current = true;
    try {
      for (const source of [...latest.current].filter((s) => !id || s.id === id)) {
        if (!alive.current || !current.current.ready) break;
        setWorking(source.id);
        try {
          const listing = await getPlaylist(source.url, SOURCE_CHECK_LIMIT);
          if (!alive.current) break;
          const updated = latest.current.find((s) => s.id === source.id);
          if (updated) { commit(latest.current.map((s) => s.id === source.id ? refreshSource(updated, listing) : s)); setErrors((old) => ({ ...old, [source.id]: "" })); }
        } catch (e) { if (alive.current) setErrors((old) => ({ ...old, [source.id]: errorText(e) })); }
      }
    } finally { busy.current = false; if (alive.current) setWorking(null); }
  }, [commit]);
  const update = useCallback((id: string, patch: Partial<Pick<SavedSource, "preset" | "audioFormat" | "playlistId">>) => commit(latest.current.map((s) => s.id === id ? { ...s, ...patch } : s)), [commit]);
  const remove = useCallback((id: string) => commit(latest.current.filter((s) => s.id !== id)), [commit]);
  const dismiss = useCallback((id: string, urls: string[]) => { const keys = new Set(urls.map(canonicalUrl)); commit(latest.current.map((s) => s.id === id ? { ...s, pending: s.pending.filter((item) => !keys.has(canonicalUrl(item.url))) } : s)); }, [commit]);
  const download = useCallback(async (id: string, urls: string[]) => {
    if (busy.current || !current.current.ready) return;
    const source = latest.current.find((s) => s.id === id); if (!source) return;
    const selected = new Set(urls);
    const entries = source.pending.filter((e) => selected.has(e.url) && !e.live);
    busy.current = true; setWorking(id);
    try {
      await current.current.submit(entries.map((entry): DownloadReq => ({ url: entry.url, title: entry.title, thumbnail: entry.thumbnail, channel: entry.channel ?? undefined, preset: source.preset, audioFormat: source.audioFormat, libraryPlaylistId: source.playlistId, formatId: null, applySiteRules: false })), null, (accepted) => dismiss(id, accepted));
    } catch (e) { current.current.flash(errorText(e), true); }
    finally { busy.current = false; if (alive.current) setWorking(null); }
  }, [dismiss]);
  return { sources, loaded, working, errors, save, check, update, remove, dismiss, download };
}
export type SavedSourcesApi = ReturnType<typeof useSavedSources>;
