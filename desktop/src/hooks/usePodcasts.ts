import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, podcastFetch, type PodcastEpisode, type PodcastFeed } from "../lib/api";
import { CHECK_EVERY_MS, feedUrl, MAX_SUBSCRIPTIONS, newEpisodes, podcastFolder, rememberEpisodes, type PodcastSubscription } from "../lib/podcasts";
import { loadPodcasts, savePodcasts } from "../lib/storage";
import type { DownloadReq } from "./useDownloadActions";

interface Args {
  ready: boolean;
  outDir: string;
  submitDownloads: (requests: DownloadReq[]) => Promise<number>;
  showFlash: (text: string, error?: boolean) => void;
}

/** Lives in App, so subscriptions keep checking even when their page is closed. */
export function usePodcasts(args: Args) {
  const [subscriptions, setSubscriptions] = useState<PodcastSubscription[]>([]);
  const [feeds, setFeeds] = useState<Record<string, PodcastFeed>>({});
  const [fresh, setFresh] = useState<Record<string, string[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState(false);
  const latest = useRef<PodcastSubscription[]>([]);
  const current = useRef(args);
  current.current = args;
  const busy = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let stale = false;
    void loadPodcasts().then((saved) => {
      if (stale) return;
      latest.current = saved;
      setSubscriptions(saved);
      setLoaded(true);
    });
    return () => { stale = true; alive.current = false; };
  }, []);

  const commit = useCallback((next: PodcastSubscription[]) => {
    latest.current = next;
    setSubscriptions(next);
    void savePodcasts(next);
  }, []);

  const update = useCallback((id: string, fn: (s: PodcastSubscription) => PodcastSubscription) => {
    commit(latest.current.map((s) => s.id === id ? fn(s) : s));
  }, [commit]);

  const queueEpisode = useCallback(async (id: string, episode: PodcastEpisode) => {
    const show = latest.current.find((s) => s.id === id);
    const a = current.current;
    if (!show || !a.ready || !a.outDir) return false;
    const added = await a.submitDownloads([{
      url: episode.url, title: episode.title, thumbnail: show.image ?? "", preset: "best", formatId: null,
      outDir: podcastFolder(a.outDir, show.title), applySiteRules: false,
      subs: null, meta: null, cover: null, lyrics: "off", audio: null,
    }]);
    if (!alive.current || !latest.current.some((s) => s.id === id)) return false;
    if (added > 0) {
      update(id, (s) => ({ ...s, seen: rememberEpisodes([episode.id], s.seen) }));
      setFresh((prev) => ({ ...prev, [id]: (prev[id] ?? []).filter((x) => x !== episode.id) }));
    }
    return added > 0;
  }, [update]);

  const checkAll = useCallback(async () => {
    if (busy.current || !current.current.ready) return;
    busy.current = true;
    setWorking(true);
    try {
      for (const saved of [...latest.current]) {
        if (!alive.current || !current.current.ready) break;
        if (!latest.current.some((s) => s.id === saved.id)) continue;
        try {
          const feed = await podcastFetch(saved.url);
          let show = latest.current.find((s) => s.id === saved.id);
          if (!alive.current || !show) continue;
          const episodes = newEpisodes(feed, show.seen);
          setFeeds((prev) => ({ ...prev, [saved.id]: feed }));
          setErrors((prev) => ({ ...prev, [saved.id]: "" }));
          setFresh((prev) => ({ ...prev, [saved.id]: rememberEpisodes(episodes.map((e) => e.id), prev[saved.id] ?? []) }));
          update(show.id, (s) => ({ ...s, title: feed.title, image: feed.image ?? undefined, checked: Date.now() }));
          if (show.auto) {
            // Queue oldest first; only accepted episodes become seen, so a cancelled or failed submission can be retried.
            for (const episode of episodes.slice().reverse()) {
              show = latest.current.find((s) => s.id === saved.id);
              if (!alive.current || !show?.auto || !current.current.ready) break;
              if (!(await queueEpisode(show.id, episode))) break;
            }
          } else {
            update(show.id, (s) => ({ ...s, seen: rememberEpisodes(feed.episodes.map((e) => e.id), s.seen) }));
          }
        } catch (e) {
          if (alive.current && latest.current.some((s) => s.id === saved.id)) setErrors((prev) => ({ ...prev, [saved.id]: errorText(e) }));
        }
      }
    } finally {
      busy.current = false;
      if (alive.current) setWorking(false);
    }
  }, [queueEpisode, update]);

  useEffect(() => {
    if (!loaded || !args.ready) return;
    void checkAll();
    const timer = setInterval(() => void checkAll(), CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [loaded, args.ready, checkAll]);

  const subscribe = useCallback(async (text: string): Promise<string | null> => {
    if (busy.current || !current.current.ready) return null;
    const url = feedUrl(text);
    if (!url) { current.current.showFlash("Enter a full http or https feed address without a login.", true); return null; }
    const prior = latest.current.find((s) => s.url === url);
    if (prior) { current.current.showFlash("You already subscribe to that feed."); return prior.id; }
    if (latest.current.length >= MAX_SUBSCRIPTIONS) { current.current.showFlash(`You can subscribe to up to ${MAX_SUBSCRIPTIONS} shows.`, true); return null; }
    busy.current = true;
    setWorking(true);
    try {
      const feed = await podcastFetch(url);
      if (!alive.current) return null;
      const show: PodcastSubscription = {
        id: crypto.randomUUID(), url, title: feed.title, image: feed.image ?? undefined, auto: false,
        seen: rememberEpisodes(feed.episodes.map((e) => e.id), []), checked: Date.now(),
      };
      commit([...latest.current, show]);
      setFeeds((prev) => ({ ...prev, [show.id]: feed }));
      return show.id;
    } catch (e) {
      current.current.showFlash(errorText(e), true);
      return null;
    } finally {
      busy.current = false;
      if (alive.current) setWorking(false);
    }
  }, [commit]);

  const unsubscribe = useCallback((id: string) => {
    commit(latest.current.filter((s) => s.id !== id));
    setFeeds((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setFresh((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
  }, [commit]);

  const setAuto = useCallback((id: string, auto: boolean) => update(id, (s) => ({ ...s, auto })), [update]);
  const download = useCallback(async (id: string, episode: PodcastEpisode) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    try { await queueEpisode(id, episode); }
    catch (e) { current.current.showFlash(errorText(e), true); }
    finally { busy.current = false; if (alive.current) setWorking(false); }
  }, [queueEpisode]);

  return { subscriptions, feeds, fresh, errors, loaded, working, subscribe, unsubscribe, setAuto, checkAll, download };
}

export type PodcastsApi = ReturnType<typeof usePodcasts>;
