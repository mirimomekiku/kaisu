import TrackPreferences from "./TrackPreferences";
import FullScreenPlayer from "./FullScreenPlayer";
import Seek from "./PlayerSeek";
import { useFullscreenPlayer } from "../hooks/useFullscreenPlayer";
import { FilterDropdown } from "./Dropdown";
import { Captions, Maximize2, ListMusic, Loader2, Music, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePlayerState } from "../hooks/usePlayer";
import { RATES, type PlayerEngine, type RepeatMode, type Sleep } from "../lib/audioEngine";
import { CoverArt } from "./Picture";
import { covers } from "../lib/covers";
import LyricsPanel from "./LyricsPanel";
import QueuePanel from "./QueuePanel";
import { useMediaActions } from "../hooks/useMediaDialogs";
import PlaybackDetails from "./PlaybackDetails";
import AudioOutputPicker from "./AudioOutputPicker";
import EqualizerButton from "./Equalizer";

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };
const REPEAT_LABEL: Record<RepeatMode, string> = { off: "Repeat: off", all: "Repeat: the whole queue", one: "Repeat: this track" };

const SLEEP_MINUTES = [15, 30, 45, 60];

/** Minutes left on a sleep timer, rounded up. */
const minutesLeft = (sleep: Sleep, now: number) => (sleep?.kind === "timer" ? Math.max(1, Math.ceil((sleep.endsAt - now) / 60_000)) : 0);

function SleepPicker({ engine }: { engine: PlayerEngine }) {
  const { sleep } = usePlayerState(engine);
  // The countdown is shown in whole minutes, so it only needs to look again now and then.
  const [now, setNow] = useState(() => Date.now());
  const [fadeSeconds, setFadeSeconds] = useState(sleep?.fadeSeconds ?? 30);
  const [finishTrack, setFinishTrack] = useState(sleep?.kind === "timer" && !!sleep.finishTrack);
  useEffect(() => {
    if (sleep?.kind !== "timer") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [sleep]);

  const value = sleep === null ? "off" : sleep.kind === "track" ? "track" : "running";
  return (
    <div className="flex flex-col gap-1"><select
      className="field"
      aria-label="Sleep timer"
      title="Stop playing after a while"
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "off") engine.setSleep(null);
        else if (v === "track") engine.setSleep("track", fadeSeconds);
        else if (v !== "running") engine.setSleep({ minutes: Number(v), fadeSeconds, finishTrack });
      }}
    >
      <option value="off">Sleep: off</option>
      {sleep?.kind === "timer" && <option value="running">{minutesLeft(sleep, now)} min left</option>}
      {SLEEP_MINUTES.map((m) => (
        <option key={m} value={m}>
          {m} minutes
        </option>
      ))}
      <option value="track">End of this track</option>
    </select>
    <label>Fade out<select className="field" aria-label="Sleep fade duration" disabled={sleep !== null} value={fadeSeconds} onChange={(e) => setFadeSeconds(Number(e.target.value))}><option value="0">No fade</option><option value="10">10 seconds</option><option value="30">30 seconds</option><option value="60">60 seconds</option></select></label>
    <label><input type="checkbox" aria-label="Finish current song after timer" disabled={sleep !== null} checked={finishTrack} onChange={(e) => setFinishTrack(e.target.checked)} /> Finish current song after timer</label>
    <span className="dim">Choose options before starting a timer.</span></div>
  );
}

/** The player along the bottom of the window: what is playing, and the controls. */
export default function PlayerBar({ engine, onMini, miniBusy }: { engine: PlayerEngine; onMini?: () => void; miniBusy?: boolean }) {
  const state = usePlayerState(engine);
  const fullscreen = useFullscreenPlayer();
  const [panel, setPanel] = useState<"queue" | "lyrics" | null>(null);
  const media = useMediaActions();
  const track = state.queue[state.index];
  const path = track?.path;
  const hasCover = !!track?.cover;
  // The system's media overlay wants the picture's address, so the engine is told once it has loaded.
  useEffect(() => {
    if (!track || hasCover) return;
    let stale = false;
    void covers.load(track.path).then((url) => {
      if (!stale && url) engine.setCover(track, url);
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, path, hasCover, track?.coverRevision]);
  if (!track) return null;
  const last = state.index >= state.queue.length - 1;

  return (
    <>
    {fullscreen.expanded && <FullScreenPlayer engine={engine} onClose={() => void fullscreen.exit()} />}
    {panel === "queue" && <QueuePanel engine={engine} onClose={() => setPanel(null)} />}
    {panel === "lyrics" && <LyricsPanel engine={engine} track={track} askConsent={media?.lyricsConsent ?? (async () => false)} onClose={() => setPanel(null)} />}
    <section className="playerbar" aria-label="Music player">
      <div className="pb-now">
        <div className="thumb pb-art">
          <CoverArt path={track.path} fallback={<Music className="w-4 h-4" />} />
        </div>
        <div className="min-w-0">
          <div className="pb-title truncate" title={track.title}>
            {track.title}
          </div>
          <div className="pb-sub truncate" role={state.error ? "alert" : undefined} style={state.error ? { color: "#b3261e" } : undefined} title={state.error ?? undefined}>
            {state.error ?? (state.loading ? state.phase === "buffering" ? "Buffering…" : "Loading…" : [track.artist, track.album].filter(Boolean).join(" · ") || " ")}
          </div>
        </div>
      </div>

      <div className="pb-controls">
        <button className="row-btn" aria-label="Previous track" title="Previous track" onClick={() => engine.previous()}>
          <SkipBack className="w-3.5 h-3.5" />
        </button>
        <button className="btn small pb-play" aria-label={state.playing || state.loading ? "Pause" : "Play"} title={state.playing || state.loading ? "Pause" : "Play"} onClick={() => engine.toggle()}>
          {state.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : state.playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <button className="row-btn" aria-label="Next track" title="Next track" disabled={last && state.repeat !== "all"} onClick={() => engine.next()}>
          <SkipForward className="w-3.5 h-3.5" />
        </button>
        <button className="row-btn" aria-label="Shuffle" aria-pressed={state.shuffle} title={state.shuffle ? "Shuffle is on" : "Shuffle"} style={state.shuffle ? { background: "rgba(59,130,230,.25)" } : undefined} onClick={() => engine.toggleShuffle()}>
          <Shuffle className="w-3.5 h-3.5" />
        </button>
        <button className="row-btn" aria-label={REPEAT_LABEL[state.repeat]} title={REPEAT_LABEL[state.repeat]} style={state.repeat !== "off" ? { background: "rgba(59,130,230,.25)" } : undefined} onClick={() => engine.setRepeat(NEXT_REPEAT[state.repeat])}>
          {state.repeat === "one" ? <Repeat1 className="w-3.5 h-3.5" /> : <Repeat className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="pb-seekrow">
        <Seek engine={engine} />
      </div>

      <div className="pb-extras">
        <EqualizerButton />
        <button className="row-btn" aria-label="Open full-screen player" title="Full-screen player" disabled={fullscreen.busy} onClick={(e) => { setPanel(null); void fullscreen.enter(e.currentTarget); }}><Maximize2 className="w-3.5 h-3.5" /></button>
        <button className="row-btn" aria-label="Show the lyrics" aria-expanded={panel === "lyrics"} title="Lyrics" style={panel === "lyrics" ? { background: "rgba(59,130,230,.25)" } : undefined} onClick={() => setPanel((p) => (p === "lyrics" ? null : "lyrics"))}>
          <Captions className="w-3.5 h-3.5" />
        </button>
        <button className="row-btn" aria-label="Show the queue" aria-expanded={panel === "queue"} title={`Play queue (${state.queue.length})`} style={panel === "queue" ? { background: "rgba(59,130,230,.25)" } : undefined} onClick={() => setPanel((p) => (p === "queue" ? null : "queue"))}>
          <ListMusic className="w-3.5 h-3.5" /> {state.queue.length}
        </button>
        <FilterDropdown label="Playback options">
        {!state.error && <PlaybackDetails engine={engine} />}
        <AudioOutputPicker />
        <TrackPreferences path={track.path} title={track.title} compact />
        <label>Speed<select className="field" aria-label="Playback speed" title="Playback speed" value={state.rate} onChange={(e) => engine.setRate(Number(e.target.value))}>
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select></label>
        <div>Sleep timer<SleepPicker engine={engine} /></div>
        {onMini && <button className="btn small" disabled={miniBusy} aria-label="Open mini-player" title="Compact, always-on-top player" onClick={onMini}>Open mini-player</button>}
        {state.sleep && <span className="dim">{state.sleep.kind === "track" ? "Stops after this track." : `Stops in ${minutesLeft(state.sleep, Date.now())} minutes.`}</span>}
        </FilterDropdown>
        <button className="row-btn" aria-label={state.volume === 0 ? "Unmute" : "Mute"} title={state.volume === 0 ? "Unmute" : "Mute"} onClick={() => engine.setVolume(state.volume === 0 ? 1 : 0)}>
          {state.volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
        <input type="range" className="pb-volume" aria-label="Volume" min={0} max={1} step={0.01} value={state.volume} onChange={(e) => engine.setVolume(Number(e.target.value))} />
        <button className="row-btn" aria-label="Close the player" title="Close the player" onClick={() => engine.clear()}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </section>
    {(state.error || state.notice) && !fullscreen.expanded && <PlaybackDetails engine={engine} />}
    {fullscreen.error && <p className="player-window-error" role="alert">{fullscreen.error}</p>}
    </>
  );
}
