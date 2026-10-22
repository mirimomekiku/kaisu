import { useEffect, useRef, useState } from "react";
import { Music } from "lucide-react";
import { errorText, libraryArtworkPreview, libraryChooseArtwork, libraryDiscardArtwork, type ArtworkChoice } from "../lib/api";
import type { ArtworkEdit } from "../lib/tagEdit";
import { CoverArt } from "./Picture";
export default function ArtworkEditor({ path, count, disabled, value, onChange, onBusy }: { path: string; count: number; disabled: boolean; value?: ArtworkEdit; onChange: (edit?: ArtworkEdit) => void; onBusy: (busy: boolean) => void }) {
  const [choice, setChoice] = useState<(ArtworkChoice & { url: string }) | null>(null);
  const selected = useRef<typeof choice>(null);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const discard = () => { const old = selected.current; selected.current = null; if (old) { URL.revokeObjectURL(old.url); void libraryDiscardArtwork(old.token).catch(() => {}); } };
  useEffect(() => { alive.current = true; return () => { alive.current = false; discard(); }; }, []);
  const choose = async () => {
    setBusy(true); onBusy(true); setError(""); let picked: ArtworkChoice | null = null;
    try {
      picked = await libraryChooseArtwork(); if (!picked) return;
      const bytes = await libraryArtworkPreview(picked.token);
      if (!alive.current) { void libraryDiscardArtwork(picked.token); return; }
      const next = { ...picked, url: URL.createObjectURL(new Blob([bytes])) };
      discard(); selected.current = next; setChoice(next); onChange({ action: "replace", token: next.token });
    } catch (e) { if (picked) void libraryDiscardArtwork(picked.token).catch(() => {}); if (alive.current) setError(errorText(e)); }
    finally { if (alive.current) { setBusy(false); onBusy(false); } }
  };
  return <section className="artwork-editor" aria-label="Artwork editor">
    <div className="artwork-preview">{value?.action === "replace" && choice ? <img src={choice.url} alt="Selected artwork" /> : value?.action === "remove" ? <Music aria-label="Embedded artwork will be removed" /> : <CoverArt path={path} fallback={<Music />} />}</div>
    <div className="flex-1 min-w-0"><b>Album artwork</b><p className="dim">{value?.action === "replace" ? `Replace front cover with ${choice?.name ?? "selected image"}` : value?.action === "remove" ? "Remove all embedded artwork" : "Keep existing artwork"}{count > 1 ? ` for all ${count} songs. Preview starts with the first song.` : "."}</p>
      <div className="flex gap-2 flex-wrap"><button type="button" className="btn small" disabled={disabled || busy} onClick={() => void choose()}>Choose image</button><button type="button" className="btn small" disabled={disabled || busy} onClick={() => onChange({ action: "remove" })}>Remove embedded artwork</button><button type="button" className="btn small" disabled={disabled || busy || !value} onClick={() => onChange(undefined)}>Keep current artwork</button></div>
      <p className="dim">JPEG or PNG, up to 8 MB and 4096 by 4096 pixels. Changes are embedded when you save. Folder cover files stay in place and may still be shown after embedded artwork is removed.</p>{error && <p role="alert">{error}</p>}
    </div>
  </section>;
}
