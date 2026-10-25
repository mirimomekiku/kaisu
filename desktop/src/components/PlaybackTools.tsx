import { lazy, Suspense, useState } from "react";
import { usePlayerState, usePlayerTime } from "../hooks/usePlayer";
import type { PlayerEngine } from "../lib/audioEngine";
import { formatClock } from "../lib/format";
import Sheet from "./Sheet";
const ListeningSessions = lazy(() => import("./ListeningSessions"));

import { usePlaybackTools } from "../hooks/usePlaybackTools";

export function ProfilePicker() {
  const tools = usePlaybackTools(); if (!tools) return null;
  return <label className="flex gap-2 items-center flex-wrap">Playback profile<select className="field max-w-full" aria-label="Playback profile" value={tools.profiles.active} onChange={(e) => tools.profiles.apply(e.target.value)}>
    <option value="">Custom settings</option>{tools.profiles.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
  </select></label>;
}
export function ProfileSettings() {
  const tools = usePlaybackTools();
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState(""); const [problem, setProblem] = useState<string | null>(null);
  if (!tools) return null;
  const api = tools.profiles;
  const selected = api.profiles.find((p) => p.id === (editingId || api.active));
  return <div className="pref-row flex flex-col gap-2">
    <ProfilePicker />
    <p className="dim m-0">Profiles apply speed, EQ, transitions, volume leveling and long-track resume. Changing those controls switches to Custom settings.</p>
    <form className="flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); const error = api.save(name); setProblem(error); if (!error) setName(""); }}>
      <input className="field min-w-0" aria-label="New playback profile name" value={name} onChange={(e) => { setName(e.target.value); setProblem(null); }} placeholder="New profile name" maxLength={80} />
      <button className="btn small" disabled={!name.trim()}>Save current as new profile</button>
    </form>
    <label>Profile to update<select className="field" aria-label="Profile to update" value={selected?.id ?? ""} onChange={(e) => setEditingId(e.target.value)}><option value="">Choose a saved profile</option>{api.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="flex gap-2 flex-wrap">
      <button className="btn small" disabled={!selected} onClick={() => { if (selected) setProblem(api.save(selected.name, selected.id)); }}>Update saved profile</button>
      <button className="btn small" disabled={!selected} onClick={() => { if (selected) api.remove(selected.id); setEditingId(""); }}>Delete saved profile</button>
    </div>
    {problem && <span role="alert">{problem}</span>}
  </div>;
}
export function LoopControls({ engine }: { engine: PlayerEngine }) {
  const { loop, sleep } = usePlayerState(engine); const time = usePlayerTime(engine);
  const [problem, setProblem] = useState("");
  const finishTrack = sleep?.kind === "track" || sleep?.kind === "timer" && sleep.finishTrack;
  const point = (key: "a" | "b") => { if (!engine.setLoopPoint(key)) setProblem(key === "a" ? "Wait until the track length is known." : "Set B at least 0.25 seconds after A."); else setProblem(""); };
  return <fieldset className="ab-controls"><legend>A–B loop</legend>
    <div className="flex gap-2 items-center flex-wrap">
      <button className="btn small" disabled={!time.duration} onClick={() => point("a")}>Set A</button><span aria-label="Loop start">A: {loop.a === null ? "—" : `${formatClock(loop.a)} (${loop.a.toFixed(2)}s)`}</span>
      <button className="btn small" disabled={!time.duration || loop.a === null} onClick={() => point("b")}>Set B</button><span aria-label="Loop end">B: {loop.b === null ? "—" : `${formatClock(loop.b)} (${loop.b.toFixed(2)}s)`}</span>
    </div>
    <label><input type="checkbox" aria-label="Enable A–B loop" checked={loop.enabled} disabled={loop.a === null || loop.b === null || !!finishTrack} onChange={(e) => { if (!engine.enableLoop(e.target.checked)) setProblem("Choose valid A and B points first."); }} /> Repeat between A and B</label>
    <button className="btn small" disabled={loop.a === null && loop.b === null} onClick={() => { engine.clearLoop(); setProblem(""); }}>Clear loop</button>
    <span className="dim">Crossfade pauses during a loop. Seeking outside it turns looping off. Changing tracks clears the points.</span>
    {finishTrack && <span className="dim">Finish-track sleep takes priority. Turn it off before enabling a loop.</span>}
    {problem && <span role="alert">{problem}</span>}
  </fieldset>;
}
export default function PlaybackTools({ engine }: { engine: PlayerEngine }) {
  const tools = usePlaybackTools(); const [history, setHistory] = useState(false);
  return <><ProfilePicker /><LoopControls engine={engine} />
    {tools && <button className="btn small" onClick={() => setHistory(true)}>Listening sessions</button>}
    {history && <Sheet title="Listening sessions" wide onClose={() => setHistory(false)}><Suspense fallback={<p role="status">Reading sessions…</p>}><ListeningSessions /></Suspense></Sheet>}
  </>;
}
