import type { SearchSource } from "./api";

/** Sites the search box can search. Only sources that were checked against the real service are listed. */
export const SEARCH_SOURCES: Array<{ id: SearchSource; label: string }> = [
  { id: "youtube", label: "YouTube" },
  { id: "soundcloud", label: "SoundCloud" },
];

export const sourceLabel = (id: SearchSource) => SEARCH_SOURCES.find((s) => s.id === id)?.label ?? "YouTube";

/** Settings may hold a source from a newer or older version; fall back to YouTube. */
export const knownSource = (id: string): SearchSource => (SEARCH_SOURCES.some((s) => s.id === id) ? (id as SearchSource) : "youtube");
