import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import ConvertDialog from "../components/ConvertDialog";
import PlayerDialog from "../components/PlayerDialog";
import { convertAudio, discardPreview, errorText, fileUrl, playInApp, previewClip, type AudioTarget } from "../lib/api";
import { baseName, isAudioFile } from "../lib/mediaKind";

/** What the buttons on a downloaded file (and on a video's card) can ask for. */
export interface MediaActions {
  /** Play a downloaded file inside Kaisu. */
  play: (path: string, title?: string) => void;
  /** Watch a short, low-quality preview of a video before downloading it. */
  preview: (url: string, title: string) => void;
  /** Make an audio copy of a downloaded file. */
  convert: (path: string, title?: string) => void;
}

export const MediaActionsContext = createContext<MediaActions | null>(null);
/** The media actions, or null where the page isn't wrapped in them. */
export const useMediaActions = () => useContext(MediaActionsContext);

interface Player {
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
}

/** The player and the converter: their state, their dialogs, and the actions that open them. */
export function useMediaDialogs({ showFlash, announce, openDownloaded, onConverted }: Args) {
  const [player, setPlayer] = useState<Player | null>(null);
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
    setPlayer(null);
  }, [dropPreview]);

  const play = useCallback(
    async (path: string, title?: string) => {
      dropPreview();
      setPlayer({ title: title ?? baseName(path), src: null, audio: isAudioFile(path), path });
      try {
        await playInApp(path);
        setPlayer((p) => (p?.path === path ? { ...p, src: fileUrl(path) } : p));
      } catch (e) {
        setPlayer(null);
        showFlash(errorText(e), true);
      }
    },
    [dropPreview, showFlash],
  );

  const preview = useCallback(
    async (url: string, title: string) => {
      dropPreview();
      const token = previewToken.current;
      setPlayer({ title: `Preview: ${title}`, src: null, audio: false, preview: true });
      try {
        const path = await previewClip(url);
        if (token !== previewToken.current) {
          // Closed (or replaced) while it was downloading.
          discardPreview(path).catch(() => {});
          return;
        }
        previewPath.current = path;
        setPlayer((p) => (p?.preview ? { ...p, src: fileUrl(path) } : p));
      } catch (e) {
        if (token === previewToken.current) {
          setPlayer(null);
          showFlash(errorText(e), true);
        }
      }
    },
    [dropPreview, showFlash],
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
      {player && (
        <PlayerDialog
          key={`${player.path ?? "preview"}|${player.title}`}
          title={player.title}
          src={player.src}
          audio={player.audio}
          waiting={player.preview ? "Getting a short preview… this takes a few seconds." : undefined}
          onClose={close}
          onOpenExternally={player.path ? () => openDownloaded(player.path as string) : undefined}
        />
      )}
      {converting && <ConvertDialog title={converting.title} path={converting.path} onConvert={doConvert} onClose={() => setConverting(null)} />}
    </>
  );

  const actions = useMemo<MediaActions>(() => ({ play, preview, convert }), [play, preview, convert]);
  return { actions, dialogs };
}
