import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText, findLeftovers, removeLeftovers, type Leftover, type Preset } from "../lib/api";
import { resumableVideos, totalBytes } from "../lib/leftovers";
import type { DownloadReq } from "./useDownloadActions";

interface Args {
  /** Folders are registered and the saved queue is back, so the download folder can be looked at. */
  ready: boolean;
  /** Nothing is downloading or waiting, so any `.part` file is a leftover rather than work in progress. */
  idle: boolean;
  showFlash: (text: string, error?: boolean) => void;
  announce: (note: { title: string; subtitle?: string }) => void;
  submitDownloads: (reqs: DownloadReq[]) => Promise<number>;
}

/**
 * Unfinished downloads left in the download folder (after a crash, a power cut, or a cancelled download). Looked for once,
 * when Kaisu has nothing running. They can be asked for again (yt-dlp carries on from the `.part` file when the format is
 * the same) or cleared away.
 */
export function useLeftovers({ ready, idle, showFlash, announce, submitDownloads }: Args) {
  const [found, setFound] = useState<Leftover[]>([]);
  const looked = useRef(false);

  useEffect(() => {
    if (!ready || !idle || looked.current) return;
    looked.current = true;
    findLeftovers().then(setFound, () => {});
  }, [ready, idle]);

  const videos = useMemo(() => resumableVideos(found), [found]);

  /** Asks for the videos again, as video or as audio. */
  const resume = useCallback(
    async (kind: "video" | "audio") => {
      const preset: Preset = kind === "audio" ? "audio" : "best";
      const added = await submitDownloads(
        videos.map((v) => ({
          url: `https://www.youtube.com/watch?v=${v.id}`,
          title: v.title,
          thumbnail: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
          preset,
          formatId: null,
        })),
      );
      if (added > 0) setFound((prev) => prev.filter((l) => !l.video_id));
    },
    [submitDownloads, videos],
  );

  /** Deletes the leftover files (the caller asks first). */
  const clear = useCallback(async () => {
    try {
      const results = await removeLeftovers(found.map((l) => l.path));
      const gone = new Set(results.filter((r) => r.ok).map((r) => r.path));
      setFound((prev) => prev.filter((l) => !gone.has(l.path)));
      announce({ title: `Removed ${gone.size} unfinished download${gone.size === 1 ? "" : "s"}` });
      const failed = results.find((r) => !r.ok);
      if (failed) showFlash(failed.error ?? "Some files couldn't be removed.", true);
    } catch (e) {
      showFlash(errorText(e), true);
    }
  }, [found, announce, showFlash]);

  const dismiss = useCallback(() => setFound([]), []);

  return { found, resumable: videos.length, bytes: totalBytes(found), resume, clear, dismiss };
}
