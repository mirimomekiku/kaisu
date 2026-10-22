import type { LibTrack } from "./api";

// The tag editor's form: filling it in from one song or several, working out what changed, and checking it.

export const FIELDS = ["title", "artist", "album", "albumArtist", "genre", "track", "disc", "year"] as const;
export type Field = (typeof FIELDS)[number];
export type TagForm = Record<Field, string>;

/** What the backend takes: only the fields that change; an empty string removes a field. */
export interface TagEditRequest {
  title?: string;
  artist?: string;
  album?: string;
  album_artist?: string;
  genre?: string;
  track?: string;
  disc?: string;
  year?: string;
}

/** Fields that only make sense for one song at a time. */
export const SINGLE_ONLY: Field[] = ["title", "track", "disc"];

export const LABEL: Record<Field, string> = { title: "Title", artist: "Artist", album: "Album", albumArtist: "Album artist", genre: "Genre", track: "Track number", disc: "Disc number", year: "Year" };

const valueOf = (t: LibTrack, f: Field): string => {
  switch (f) {
    case "title":
      return t.title;
    case "artist":
      return t.artist;
    case "album":
      return t.album;
    case "albumArtist":
      return t.album_artist;
    case "genre":
      return t.genre;
    case "track":
      return t.track === null ? "" : String(t.track);
    case "disc":
      return t.disc === null ? "" : String(t.disc);
    case "year":
      return t.year === null ? "" : String(t.year);
  }
};

export interface FormStart {
  values: TagForm;
  /** Fields whose value differs between the songs being edited: they start empty and are only changed if something is typed. */
  mixed: Set<Field>;
}

/** The form for these songs: each field shows what they all have, or is left empty and marked "mixed" when they disagree. */
export function startForm(tracks: LibTrack[]): FormStart {
  const values = {} as TagForm;
  const mixed = new Set<Field>();
  for (const f of FIELDS) {
    const first = tracks[0] ? valueOf(tracks[0], f) : "";
    if (tracks.every((t) => valueOf(t, f) === first)) values[f] = first;
    else {
      values[f] = "";
      mixed.add(f);
    }
  }
  return { values, mixed };
}

/** Only what the user changed. A mixed field is left alone unless something was typed in it. */
export function buildEdit(start: FormStart, form: TagForm): TagEditRequest {
  const edit: TagEditRequest = {};
  const key: Record<Field, keyof TagEditRequest> = { title: "title", artist: "artist", album: "album", albumArtist: "album_artist", genre: "genre", track: "track", disc: "disc", year: "year" };
  for (const f of FIELDS) {
    const now = form[f].trim();
    if (start.mixed.has(f) ? now === "" : now === start.values[f].trim()) continue;
    edit[key[f]] = now;
  }
  return edit;
}

/** What is wrong with the form, by field. */
export function validateForm(form: TagForm): Partial<Record<Field, string>> {
  const problems: Partial<Record<Field, string>> = {};
  const whole = (f: Field, lo: number, hi: number) => {
    const v = form[f].trim();
    if (v === "") return;
    const n = Number(v);
    if (!/^\d+$/.test(v) || n < lo || n > hi) problems[f] = `${LABEL[f]} must be a whole number from ${lo} to ${hi}.`;
  };
  whole("year", 1000, 2999);
  whole("track", 1, 999);
  whole("disc", 1, 99);
  for (const f of ["title", "artist", "album", "albumArtist", "genre"] as const) if (form[f].trim().length > 200) problems[f] = `${LABEL[f]} is too long (up to 200 characters).`;
  return problems;
}
