import type { LibTrack } from "./api";
import type { Track } from "./audioEngine";

// Grouping, searching and sorting the music library. All plain functions over the list the backend scanned.

export type { LibTrack };

export const UNKNOWN_ARTIST = "Unknown artist";
export const UNKNOWN_ALBUM = "Unknown album";

/** The name an album or track is filed under: the album artist if there is one, else the artist. */
export const artistOf = (t: LibTrack) => t.album_artist.trim() || t.artist.trim() || UNKNOWN_ARTIST;
export const albumOf = (t: LibTrack) => t.album.trim() || UNKNOWN_ALBUM;

/** Lower case, accents removed, so "Beyoncé" is found by "beyonce". */
export const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

export const isLossless = (format: string) => ["FLAC", "WAV"].includes(format.toUpperCase());

/** "FLAC · 44.1 kHz · 16-bit" or "MP3 · 192 kbps". */
export function qualityLabel(t: LibTrack): string {
  const parts = [t.format];
  if (isLossless(t.format)) {
    if (t.sample_rate) parts.push(`${Math.round((t.sample_rate / 1000) * 10) / 10} kHz`);
    if (t.bit_depth) parts.push(`${t.bit_depth}-bit`);
  } else if (t.bitrate) {
    parts.push(`${t.bitrate} kbps`);
  }
  return parts.join(" · ");
}

/** What the player needs to know about a track. */
export const toPlayerTrack = (t: LibTrack): Track => ({ path: t.path, title: t.title, artist: t.artist || undefined, album: t.album || undefined, duration: t.duration > 0 ? t.duration : undefined });

// ---- searching and sorting ---------------------------------------------------------------------

export type SortKey = "title" | "artist" | "album" | "year" | "duration" | "added";
export interface Filter {
  query: string;
  /** Only this format ("" = all). */
  format: string;
  /** Only an artist's tracks ("" = all). */
  artist: string;
}

/** Every word of the search has to be somewhere in the title, artist, album or genre. */
export function filterTracks(tracks: LibTrack[], f: Filter): LibTrack[] {
  const words = normalize(f.query).split(/\s+/).filter(Boolean);
  return tracks.filter((t) => {
    if (f.format && t.format !== f.format) return false;
    if (f.artist && artistOf(t) !== f.artist) return false;
    if (words.length === 0) return true;
    const hay = normalize(`${t.title} ${t.artist} ${t.album_artist} ${t.album} ${t.genre}`);
    return words.every((w) => hay.includes(w));
  });
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function sortTracks(tracks: LibTrack[], key: SortKey, desc = false): LibTrack[] {
  const value = (t: LibTrack): string | number => {
    switch (key) {
      case "title":
        return t.title;
      case "artist":
        return artistOf(t);
      case "album":
        return `${albumOf(t)}\u0000${String(t.disc ?? 0).padStart(3, "0")}${String(t.track ?? 0).padStart(4, "0")}`;
      case "year":
        return t.year ?? 0;
      case "duration":
        return t.duration;
      case "added":
        return t.modified;
    }
  };
  const out = tracks.slice().sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    const c = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
    return c || collator.compare(a.title, b.title) || a.path.localeCompare(b.path);
  });
  return desc ? out.reverse() : out;
}

/** The formats present, for the filter. */
export const formatsOf = (tracks: LibTrack[]) => [...new Set(tracks.map((t) => t.format))].sort();

// ---- albums and artists ------------------------------------------------------------------------

export interface Album {
  /** Unique: artist and album together. */
  key: string;
  title: string;
  artist: string;
  year: number | null;
  tracks: LibTrack[];
  /** Seconds. */
  duration: number;
}

export interface Artist {
  name: string;
  albums: number;
  tracks: number;
}

/** Tracks of an album in the order they were meant to be heard. */
export const albumOrder = (a: LibTrack, b: LibTrack) => (a.disc ?? 0) - (b.disc ?? 0) || (a.track ?? 9999) - (b.track ?? 9999) || collator.compare(a.title, b.title);

export function albumsOf(tracks: LibTrack[]): Album[] {
  const map = new Map<string, Album>();
  for (const t of tracks) {
    const artist = artistOf(t);
    const title = albumOf(t);
    // Singles with no album tag shouldn't all be lumped into one huge "Unknown album".
    const key = title === UNKNOWN_ALBUM ? `${artist}\u0000${UNKNOWN_ALBUM}` : `${artist}\u0000${title}`;
    const album = map.get(key) ?? { key, title, artist, year: null, tracks: [], duration: 0 };
    album.tracks.push(t);
    album.duration += t.duration;
    album.year = album.year ?? t.year;
    map.set(key, album);
  }
  const albums = [...map.values()];
  for (const a of albums) a.tracks.sort(albumOrder);
  return albums.sort((x, y) => collator.compare(x.artist, y.artist) || (x.year ?? 0) - (y.year ?? 0) || collator.compare(x.title, y.title));
}

export function artistsOf(tracks: LibTrack[]): Artist[] {
  const map = new Map<string, { tracks: number; albums: Set<string> }>();
  for (const t of tracks) {
    const name = artistOf(t);
    const entry = map.get(name) ?? { tracks: 0, albums: new Set<string>() };
    entry.tracks++;
    entry.albums.add(albumOf(t));
    map.set(name, entry);
  }
  return [...map].map(([name, e]) => ({ name, albums: e.albums.size, tracks: e.tracks })).sort((a, b) => collator.compare(a.name, b.name));
}

export function totalDuration(tracks: LibTrack[]): number {
  return tracks.reduce((sum, t) => sum + t.duration, 0);
}
