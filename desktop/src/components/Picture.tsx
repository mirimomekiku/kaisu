import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadThumbnail, peekThumbnail } from "../lib/thumbs";

/**
 * A thumbnail. It is fetched by Kaisu (through the proxy) once it scrolls near the screen, and `fallback` is shown when
 * there is no address or the picture can't be loaded. Put it inside the box that is the picture's frame: that box is
 * what is watched for coming into view.
 */
export default function Picture({ url, fallback }: { url: string | null | undefined; fallback: ReactNode }) {
  const marker = useRef<HTMLSpanElement>(null);
  const known = url ? peekThumbnail(url) : null;
  const [src, setSrc] = useState<string | null | undefined>(known);
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
    const hit = peekThumbnail(url);
    if (hit !== undefined) return setSrc(hit);
    setSrc(undefined);
    if (!near) return;
    let stale = false;
    loadThumbnail(url).then((loaded) => !stale && setSrc(loaded));
    return () => {
      stale = true;
    };
  }, [url, near]);

  return (
    <>
      <span ref={marker} hidden />
      {src ? <img src={src} alt="" /> : src === null ? fallback : null}
    </>
  );
}
