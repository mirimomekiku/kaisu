import { Captions, ListMusic, Loader2, Minimize2, Music, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";
import { usePlayerState } from "../hooks/usePlayer";
import { useMediaActions } from "../hooks/useMediaDialogs";
import { RATES, type PlayerEngine, type RepeatMode } from "../lib/audioEngine";
import { CoverArt } from "./Picture";
import Seek from "./PlayerSeek";
import TrackPreferences from "./TrackPreferences";
import LyricsPanel from "./LyricsPanel";
import QueuePanel from "./QueuePanel";
import PlaybackDetails from "./PlaybackDetails";
import AudioOutputPicker from "./AudioOutputPicker";
import { FilterDropdown } from "./Dropdown";

const nextRepeat: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };

/** A listening room: album and track on the left, lyrics or queue on the right, transport below. */
export default function FullScreenPlayer({ engine, onClose }: { engine: PlayerEngine; onClose: () => void }) {
  const state = usePlayerState(engine);
  const track = state.queue[state.index];
  const media = useMediaActions();
  const [tab, setTab] = useState<"lyrics" | "queue">("lyrics");
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Keep app dialogs (including lyric lookup consent) usable above this view.
    const background = Array.from(document.querySelectorAll<HTMLElement>(".app > *")).filter((el) => !el.matches(".backdrop") && !el.querySelector('[aria-modal="true"]') && !el.inert);
    background.forEach((el) => { el.inert = true; });
    root.current?.querySelector<HTMLElement>(".full-play")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest(".filter-dropdown")) return;
      if ([...document.querySelectorAll('[aria-modal="true"]')].some((el) => el !== root.current && el.getClientRects().length > 0)) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close.current(); }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && [" ", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
        if (e.key === " ") engine.toggle(); else if (e.key === "ArrowLeft") engine.previous(); else engine.next();
      } else if (e.key === "Tab") {
        const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]') ?? [])].filter((el) => el.getClientRects().length > 0);
        const at = controls.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey ? at <= 0 : at < 0 || at === controls.length - 1) { e.preventDefault(); (e.shiftKey ? controls[controls.length - 1] : controls[0])?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); background.forEach((el) => { el.inert = false; }); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [engine]);
  if (!track) return null;
  return createPortal(<div ref={root} role="dialog" aria-modal="true" aria-label="Full-screen player" className="full-player">
    <header className="full-header" data-tauri-drag-region>
      <button className="btn" aria-label="Exit full-screen player" onClick={onClose}><Minimize2 className="w-4 h-4" />Back to Kaisu</button>
      <div className="full-heading"><span>Now playing</span><b>Kaisu</b></div>
      <div role="tablist" aria-label="Player view" className="seg blue">
        <button id={`${id}-lyrics`} role="tab" aria-selected={tab === "lyrics"} aria-controls={`${id}-panel`} tabIndex={tab === "lyrics" ? 0 : -1} onClick={() => setTab("lyrics")} onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); setTab("queue"); document.getElementById(`${id}-queue`)?.focus(); } }}><Captions className="w-4 h-4" />Lyrics</button>
        <button id={`${id}-queue`} role="tab" aria-selected={tab === "queue"} aria-controls={`${id}-panel`} tabIndex={tab === "queue" ? 0 : -1} onClick={() => setTab("queue")} onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); setTab("lyrics"); document.getElementById(`${id}-lyrics`)?.focus(); } }}><ListMusic className="w-4 h-4" />Up next <span className="dim">{state.queue.length}</span></button>
      </div>
    </header>
    <main className="full-body">
      <section className="full-record" aria-label="Current song">
        <div className="full-cover"><CoverArt path={track.path} fallback={<Music aria-label="No album artwork" />} /></div>
        <div className="full-track" aria-live="polite"><span className="full-kicker">{track.album || "Your music"}</span><h1 title={track.title}>{track.title}</h1><p>{track.artist || "Unknown artist"}</p></div>
      </section>
      <section id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className={`full-panel full-${tab}`}>
        {tab === "lyrics" ? <LyricsPanel key={track.path} engine={engine} track={track} embedded askConsent={media?.lyricsConsent ?? (async () => false)} onClose={() => setTab("queue")} /> : <QueuePanel engine={engine} onClose={() => setTab("lyrics")} />}
      </section>
    </main>
    <footer className="full-transport">
      <PlaybackDetails engine={engine} />
      <div className="full-seek"><Seek engine={engine} /></div>
      <div className="full-controls">
        <div className="full-volume"><button className="row-btn" aria-label={state.volume === 0 ? "Unmute" : "Mute"} onClick={() => engine.setVolume(state.volume === 0 ? 1 : 0)}>{state.volume === 0 ? <VolumeX /> : <Volume2 />}</button><input type="range" aria-label="Volume" min="0" max="1" step="0.01" value={state.volume} onChange={(e) => engine.setVolume(Number(e.target.value))} /></div>
        <div className="full-buttons">
          <button className="row-btn" aria-label="Shuffle" aria-pressed={state.shuffle} onClick={() => engine.toggleShuffle()}><Shuffle /></button>
          <button className="row-btn" aria-label="Previous track" onClick={() => engine.previous()}><SkipBack /></button>
          <button className="btn primary full-play" aria-label={state.playing || state.loading ? "Pause" : "Play"} onClick={() => engine.toggle()}>{state.loading ? <Loader2 className="animate-spin" /> : state.playing ? <Pause /> : <Play />}</button>
          <button className="row-btn" aria-label="Next track" disabled={state.index >= state.queue.length - 1 && state.repeat !== "all"} onClick={() => engine.next()}><SkipForward /></button>
          <button className="row-btn" aria-label={`Repeat: ${state.repeat}`} aria-pressed={state.repeat !== "off"} onClick={() => engine.setRepeat(nextRepeat[state.repeat])}>{state.repeat === "one" ? <Repeat1 /> : <Repeat />}</button>
        </div>
        <div className="full-options"><FilterDropdown label="Audio output"><AudioOutputPicker /></FilterDropdown><TrackPreferences path={track.path} title={track.title} compact /><select className="field" aria-label="Playback speed" value={state.rate} onChange={(e) => engine.setRate(Number(e.target.value))}>{RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></div>
      </div>
    </footer>
  </div>, document.body);
}
