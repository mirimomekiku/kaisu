import { libraryCover } from "./api";
import { createImageLoader } from "./imageLoader";

/** Album covers: each sound file's own picture, or a cover.jpg beside it, looked up by the file's path. */
export const covers = createImageLoader(libraryCover, { maxParallel: 3 });
