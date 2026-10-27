import { extractUrls } from "./links";

/** One run's limit, so a huge export does not flood the list. */
export const MAX_FILE_LINKS = 500;

export interface FileLinks {
  links: string[];
  /** Addresses found, before duplicates were dropped and the limit applied. */
  found: number;
  duplicates: number;
  truncated: boolean;
}

/**
 * The web addresses in a text, CSV or TSV file: one per line, several per line, or in any column. Spreadsheet quoting,
 * a byte-order mark and separators stuck to an address ("a.com/x,https://b.com") do not matter.
 */
export function linksFromFile(text: string): FileLinks {
  const prepared = text.replace(/^\uFEFF/, "").replace(/[,;|\t]+(?=https?:\/\/)/gi, " ");
  const all = prepared.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  const unique = extractUrls(prepared);
  const links = unique.filter((u) => { try { return !!new URL(u).hostname; } catch { return false; } });
  return { links: links.slice(0, MAX_FILE_LINKS), found: all.length, duplicates: Math.max(0, all.length - unique.length), truncated: links.length > MAX_FILE_LINKS };
}
