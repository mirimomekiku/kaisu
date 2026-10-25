import { useCallback, useEffect, useRef, useState } from "react";
import type { Page } from "../components/Sidebar";
import { classifyLink, errorText, getMediaInfo, getPlaylist, searchMedia, type LinkKind, type MediaInfo, type SearchResult } from "../lib/api";
import { extractUrls } from "../lib/links";
import { knownSource } from "../lib/sources";
import { checkDownloadUrl } from "../lib/validate";
import type { Settings } from "../lib/storage";

const AUTO_INSPECT_DELAY_MS = 700;
export const LOOKS_LIKE_URL = /^https?:\/\/\S+$/i;
export const SEARCH_PAGE_SIZE = 12;
export const SEARCH_MAX = 48;
export const LISTING_PAGE = 200;
export const LISTING_MAX = 500;

export type ListingKind = "search" | "playlist" | "channel" | "links";
export interface Listing {
  kind: ListingKind;
  query: string;
  items: SearchResult[];
  limit: number;
  title?: string;
  total?: number | null;
  sourceUrl?: string;
}

interface Args {
  settings: Settings;
  settingsLoaded: boolean;
  settingsRef: React.MutableRefObject<Settings>;
  engineReady: boolean;
  setPage: (page: Page) => void;
}

/**
 * Looking things up: the search box (a link is inspected, anything else is searched), the results and playlist listings,
 * the video that is open, and which results are ticked.
 */
export function useSearchFlow({ settings, settingsLoaded, settingsRef, engineReady, setPage }: Args) {
  const [url, setUrl] = useState("");
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [media, setMedia] = useState<{ url: string; info: MediaInfo } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [search, setSearch] = useState<Listing | null>(null);
  const [busyWhat, setBusyWhat] = useState<"search" | "list">("search");
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchNotice, setBatchNotice] = useState<string | null>(null);

  const inspectToken = useRef(0);
  const searchToken = useRef(0);
  const lastAutoInspected = useRef("");
  const invalidateLookups = () => {
    inspectToken.current++; searchToken.current++;
    setLoadingInfo(false); setSearching(false); setLoadingMore(false);
  };
  const mode = settings.mode;
  const advanced = mode === "advanced";

  // A new mode changes what "pasted link" does, so allow an immediate re-lookup.
  useEffect(() => {
    lastAutoInspected.current = "";
  }, [mode]);

  const loadListing = useCallback(async (link: string, limit: number) => {
    inspectToken.current++;
    setLoadingInfo(false);
    const token = ++searchToken.current;
    const more = limit > LISTING_PAGE;
    if (!more) {
      setChecked(new Set());
      setBatchNotice(null);
    }
    setBusyWhat("list");
    more ? setLoadingMore(true) : setSearching(true);
    setErrorMessage(null);
    setShowErrorDetails(false);
    try {
      const info = await getPlaylist(link, limit);
      if (token === searchToken.current) {
        setSearch({ kind: info.kind === "channel" ? "channel" : "playlist", query: link, items: info.entries, limit, title: info.title, total: info.total, sourceUrl: link });
      }
    } catch (err) {
      if (token === searchToken.current) setErrorMessage(errorText(err));
    } finally {
      if (token === searchToken.current) {
        setSearching(false);
        setLoadingMore(false);
      }
    }
  }, []);

  /** Looks a link up: a playlist or channel is listed, a single video gets its details card. */
  const handleFetchInfo = useCallback(
    async (arg?: string) => {
      const target = (arg ?? url).trim();
      if (!target) return;
      const problem = checkDownloadUrl(target);
      if (problem) { setErrorMessage(problem); return; }

      searchToken.current++;
      setSearching(false); setLoadingMore(false);
      const token = ++inspectToken.current;
      lastAutoInspected.current = target;
      setLoadingInfo(true);
      setErrorMessage(null);
      setShowErrorDetails(false);
      setMedia(null);
      try {
        const kind = await classifyLink(target).catch((): LinkKind => "video");
        if (token !== inspectToken.current) return;
        if (kind !== "video") {
          setLoadingInfo(false);
          await loadListing(target, LISTING_PAGE);
          return;
        }
        const info = await getMediaInfo(target, advanced ? settings.cookiesBrowser : null);
        if (token === inspectToken.current) setMedia({ url: target, info });
      } catch (err) {
        if (token === inspectToken.current) setErrorMessage(errorText(err));
      } finally {
        if (token === inspectToken.current) setLoadingInfo(false);
      }
    },
    [url, advanced, settings.cookiesBrowser, loadListing],
  );

  const runSearch = useCallback(async (query: string, limit: number) => {
    inspectToken.current++;
    setLoadingInfo(false);
    const token = ++searchToken.current;
    const more = limit > SEARCH_PAGE_SIZE;
    if (!more) {
      setChecked(new Set());
      setBatchNotice(null);
    }
    setBusyWhat("search");
    more ? setLoadingMore(true) : setSearching(true);
    setErrorMessage(null);
    setShowErrorDetails(false);
    try {
      const found = await searchMedia(query, limit, knownSource(settingsRef.current.searchSource));
      if (token === searchToken.current) setSearch({ kind: "search", query, items: found, limit });
    } catch (err) {
      if (token === searchToken.current) setErrorMessage(errorText(err));
    } finally {
      if (token === searchToken.current) {
        setSearching(false);
        setLoadingMore(false);
      }
    }
  }, [settingsRef]);

  /** Several links at once (a multi-link paste or drop): list them, all ticked, ready to download together. */
  const showLinks = useCallback(
    (urls: string[]) => {
      const entries: SearchResult[] = urls.map((u) => ({ id: u, title: u, url: u, channel: null, duration_secs: null, view_count: null, thumbnail: "", live: false }));
      invalidateLookups();
      setMedia(null);
      setErrorMessage(null);
      setSearch({ kind: "links", query: "", items: entries, limit: entries.length, title: `${entries.length} links` });
      setChecked(new Set(urls));
      setBatchNotice(null);
      setPage("search");
    },
    [setPage],
  );

  /** Look up one link from anywhere (clipboard offer, drop). */
  const submitLink = useCallback(
    (link: string) => {
      setUrl(link);
      setSearch(null);
      setPage("search");
      handleFetchInfo(link);
    },
    [handleFetchInfo, setPage],
  );

  /** Enter in the search box: links are looked up, anything else is searched. */
  const handleSubmit = () => {
    const text = url.trim();
    if (!text) return;
    setPage("search");
    const links = extractUrls(text);
    const onlyLinks = links.length > 0 && text.replace(/https?:\/\/\S+/gi, "").trim() === "";
    if (onlyLinks && links.length > 1) {
      showLinks(links);
    } else if (LOOKS_LIKE_URL.test(text)) {
      setSearch(null);
      handleFetchInfo();
    } else {
      setMedia(null);
      runSearch(text, SEARCH_PAGE_SIZE);
    }
  };

  const searchFor = (query: string) => {
    setUrl(query);
    setPage("search");
    setMedia(null);
    runSearch(query, SEARCH_PAGE_SIZE);
  };

  const selectResult = (result: SearchResult) => {
    setUrl(result.url);
    lastAutoInspected.current = result.url; // don't let simple mode's auto-lookup fire a second time
    handleFetchInfo(result.url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Simple mode: look the link up as soon as a complete one has been pasted.
  useEffect(() => {
    const target = url.trim();
    if (!settingsLoaded || mode !== "simple" || !engineReady) return;
    if (!LOOKS_LIKE_URL.test(target) || target === lastAutoInspected.current) return;
    const timer = setTimeout(() => {
      // Enter (or selecting a result) may have handled this link while the debounce was waiting.
      // Re-fetching would unmount its card and discard clip/tag edits made in the meantime.
      if (target === lastAutoInspected.current) return;
      setPage("search");
      handleFetchInfo();
    }, AUTO_INSPECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [url, mode, settingsLoaded, engineReady, handleFetchInfo, setPage]);

  const toggleChecked = (u: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(u) ? next.delete(u) : next.add(u);
      return next;
    });

  const toggleAll = (all: boolean) => setChecked(all && search ? new Set(search.items.map((r) => r.url)) : new Set());

  return {
    url,
    setUrl,
    media,
    setMedia,
    search,
    setSearch,
    loadingInfo,
    searching,
    loadingMore,
    busyWhat,
    errorMessage,
    setErrorMessage,
    showErrorDetails,
    setShowErrorDetails,
    checked,
    setChecked,
    batchNotice,
    setBatchNotice,
    loadListing,
    runSearch,
    handleFetchInfo,
    handleSubmit,
    showLinks,
    submitLink,
    searchFor,
    selectResult,
    toggleChecked,
    toggleAll,
  };
}
