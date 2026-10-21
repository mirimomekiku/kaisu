import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import ConvertDialog from "../components/ConvertDialog";
import PlayerDialog from "../components/PlayerDialog";
import { convertAudio, discardPreview, errorText, fileUrl, playInApp, previewClip, type AudioTarget } from "../lib/api";
import type { PlayerEngine } from "../lib/audioEngine";
import { baseName, isAudioFile } from "../lib/mediaKind";

/** What the buttons on a downloaded file (and on a video's card) can ask for. */
export interface MediaActions {
  /** Play a downloaded file inside Kaisu. */
  play: (path: string, title?: string) => void;
  /** Watch a short, low-quality preview of a video before downloading it. */
  preview: (url: string, title: string) => void;
  /** Make an audio copy of a downloaded file. */
  convert: (path: string, title?: string) => void;
  /** Queue sound files: play them now (replacing the queue), after the current track, or at the end. */
  queue: (items: Array<{ path: string; title?: string }>, mode: "play" | "next" | "add") => void;
}

export const MediaActionsContext = createContext<MediaActions | null>(null);
/** The media actions, or null where the page isn't wrapped in them. */
export const useMediaActions = () => useContext(MediaActionsContext);

/** What the video window shows: a downloaded file, or a preview. */
interface Viewer {
  title: string;
  /** Where to play from; null while getting ready. */
  src: string | null;
  audio: boolean;
  /** A downloaded file (can be handed to the system player). */
  path?: string;
  preview?: boolean;
}

interface Args {
  showFlash: (text: string, error?: boolean) => void;
  announce: (note: { title: string; subtitle?: string }) => void;
  openDownloaded: (path: string) => void;
  /** A conversion made `newPath` from `fromPath`. */
  onConverted: (fromPath: string, newPath: string) => void;
  /** The music player: sound files play there, so they carry on while you browse. */
  player: PlayerEngine;
}

/** The player and the converter: their state, their dialogs, and the actions that open them. */
export function useMediaDialogs({ showFlash, announce, openDownloaded, onConverted, player }: Args) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [converting, setConverting] = useState<{ path: string; title: string } | null>(null);
  /** The preview being fetched or shown, so closing early (or asking again) cleans up the right one. */
  const previewToken = useRef(0);
  const previewPath = useRef<string | null>(null);

  const dropPreview = useCallback(() => {
    previewToken.current++;
    const path = previewPath.current;
    previewPath.current = null;
    if (path) discardPreview(path).catch(() => {});
  }, []);

  const close = useCallback(() => {
    dropPreview();
    setViewer(null);
  }, [dropPreview]);

  const play = useCallback(
    async (path: string, title?: string) => {
      dropPreview();
      if (isAudioFile(path)) {
        setViewer(null);
        player.play([{ path, title: title ?? baseName(path) }]);
        return;
      }
      setViewer({ title: title ?? baseName(path), src: null, audio: false, path });
      try {
        await playInApp(path);
        setViewer((v) => (v?.path === path ? { ...v, src: fileUrl(path) } : v));
      } catch (e) {
        setViewer(null);
        showFlash(errorText(e), true);
      }
    },
    [dropPreview, player, showFlash],
  );

  const preview = useCallback(
    async (url: string, title: string) => {
      dropPreview();
      const token = previewToken.current;
      setViewer({ title: `Preview: ${title}`, src: null, audio: false, preview: true });
      try {
        const path = await previewClip(url);
        if (token !== previewToken.current) {
          // Closed (or replaced) while it was downloading.
          discardPreview(path).catch(() => {});
          return;
        }
        previewPath.current = path;
        setViewer((v) => (v?.preview ? { ...v, src: fileUrl(path) } : v));
      } catch (e) {
        if (token === previewToken.current) {
          setViewer(null);
          showFlash(errorText(e), true);
        }
      }
    },
    [dropPreview, showFlash],
  );

  const queue = useCallback(
    (items: Array<{ path: string; title?: string }>, mode: "play" | "next" | "add") => {
      const tracks = items.filter((i) => isAudioFile(i.path)).map((i) => ({ path: i.path, title: i.title ?? baseName(i.path) }));
      if (tracks.length === 0) return showFlash("Only sound files can go in the play queue.", true);
      if (mode === "play") player.play(tracks);
      else if (mode === "next") player.playNext(tracks);
      else player.enqueue(tracks);
      if (mode !== "play") announce({ title: mode === "next" ? "Playing next" : "Added to the queue", subtitle: tracks.length === 1 ? tracks[0].title : `${tracks.length} tracks` });
    },
    [announce, player, showFlash],
  );

  const convert = useCallback((path: string, title?: string) => setConverting({ path, title: title ?? baseName(path) }), []);

  const doConvert = async (format: AudioTarget) => {
    if (!converting) return;
    const result = await convertAudio(converting.path, format);
    onConverted(converting.path, result.path);
    announce({ title: `Converted to ${format.toUpperCase()}`, subtitle: baseName(result.path) });
    setConverting(null);
  };

  const dialogs = (
    <>
      {viewer && (
        <PlayerDialog
          key={`${viewer.path ?? "preview"}|${viewer.title}`}
          title={viewer.title}
          src={viewer.src}
          audio={viewer.audio}
          waiting={viewer.preview ? "Getting a short preview… this takes a few seconds." : undefined}
          onClose={close}
          onOpenExternally={viewer.path ? () => openDownloaded(viewer.path as string) : undefined}
        />
      )}
      {converting && <ConvertDialog title={converting.title} path={converting.path} onConvert={doConvert} onClose={() => setConverting(null)} />}
    </>
  );

  const actions = useMemo<MediaActions>(() => ({ play, preview, convert, queue }), [play, preview, convert, queue]);
  return { actions, dialogs };
}
