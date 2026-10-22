import { useEffect, useRef, useState, type ReactNode } from "react";
import { covers } from "../lib/covers";
import type { ImageLoader } from "../lib/imageLoader";
import { thumbnails } from "../lib/thumbs";

interface Props {
  /** What to show: a web address for thumbnails, or a file's path for covers. */
  url: string | null | undefined;
  fallback: ReactNode;
  /** Where pictures come from: the thumbnails fetched from the web (the default), or covers from sound files. */
  source?: ImageLoader;
}

/**
 * A picture. It is fetched by Kaisu (through the proxy, if any) once it scrolls near the screen, and `fallback` is shown when
 * there is no address or the picture can't be loaded. Put it inside the box that is the picture's frame: that box is what is
 * watched for coming into view.
 */
export default function Picture({ url, fallback, source = thumbnails }: Props) {
  const marker = useRef<HTMLSpanElement>(null);
  const known = url ? source.peek(url) : null;
  const [src, setSrc] = useState<string | null | undefined>(known);
  const [revision, setRevision] = useState(0);
  useEffect(() => source.subscribe?.(() => setRevision((n) => n + 1)), [source]);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const frame = marker.current?.parentElement;
    if (!frame || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const watcher = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "300px" });
    watcher.observe(frame);
    return () => watcher.disconnect();
  }, []);

  useEffect(() => {
    if (!url) return setSrc(null);
    const hit = source.peek(url);
    if (hit !== undefined) return setSrc(hit);
    setSrc(undefined);
    if (!near) return;
    let stale = false;
    source.load(url).then((loaded) => !stale && setSrc(loaded));
    return () => {
      stale = true;
    };
  }, [url, near, source, revision]);

  return (
    <>
      <span ref={marker} hidden />
      {src ? <img src={src} alt="" /> : src === null ? fallback : null}
    </>
  );
}

/** The cover of a sound file, or `fallback`. */
export function CoverArt({ path, fallback }: { path: string | null | undefined; fallback: ReactNode }) {
  return <Picture url={path} fallback={fallback} source={covers} />;
}
