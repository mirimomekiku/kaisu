import { fetchThumbnail } from "./api";
import { createImageLoader } from "./imageLoader";

// The page may not load pictures from the internet itself, so thumbnails are fetched by Kaisu (through the proxy) and shown
// from memory.

/** Pictures already built into the app or held in memory need no fetching. */
export const thumbnails = createImageLoader(fetchThumbnail, { isLocal: (url) => /^(data:|blob:)/i.test(url) });

export const peekThumbnail = thumbnails.peek;
export const loadThumbnail = thumbnails.load;
