import type { Field, TagEditRequest, TagForm } from "./tagEdit";

export interface IdentificationRelease { id: string; title: string; date: string; country: string; edition: string }
export interface IdentificationCandidate { id: string; title: string; artist: string; duration: number | null; score: number; releases: IdentificationRelease[] }
export type SuggestedTags = Partial<Record<Exclude<keyof TagEditRequest, "artwork">, string | null>>;
export const tagKeys: Record<Field, Exclude<keyof TagEditRequest, "artwork">> = { title: "title", artist: "artist", album: "album", albumArtist: "album_artist", genre: "genre", track: "track", disc: "disc", year: "year" };
export function suggestedForm(tags: SuggestedTags): Partial<TagForm> {
  return Object.fromEntries(Object.entries(tagKeys).flatMap(([field, key]) => typeof tags[key] === "string" && tags[key]!.trim() ? [[field, tags[key]!.trim()]] : []));
}
export function identificationEdit(current: TagForm, tags: SuggestedTags, selected: ReadonlySet<Field>): TagEditRequest {
  const proposed = suggestedForm(tags);
  return Object.fromEntries([...selected].flatMap((field) => proposed[field] !== undefined && proposed[field] !== current[field].trim() ? [[tagKeys[field], proposed[field]]] : []));
}
