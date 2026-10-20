import { useEffect, useRef, useState } from "react";
import { extractUrls } from "../lib/links";

interface Handlers {
  onLink: (link: string) => void;
  onLinks: (links: string[]) => void;
  onNothing: () => void;
}

/** Lets links be dropped on the window. Returns true while a link is being dragged over it (for the overlay). */
export function useDropLinks(handlers: Handlers) {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    let depth = 0;
    const hasLink = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).some((t) => t === "text/uri-list" || t === "text/plain" || t === "text/html");
    const onEnter = (e: DragEvent) => {
      if (!hasLink(e)) return;
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasLink(e)) e.preventDefault(); // allows dropping here
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const text = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain") || "";
      const links = extractUrls(text);
      if (links.length === 1) latest.current.onLink(links[0]);
      else if (links.length > 1) latest.current.onLinks(links);
      else latest.current.onNothing();
    };
    document.addEventListener("dragenter", onEnter);
    document.addEventListener("dragover", onOver);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, []);

  return dragging;
}
