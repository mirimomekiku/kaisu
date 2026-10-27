import { useEffect, useMemo, useRef, useState } from "react";
import { errorText, portableSyncApply, portableSyncCancel, portableSyncCreate, portableSyncDevices, portableSyncForget, portableSyncPlan, portableSyncProfiles, portableSyncSave, type LibTrack } from "../lib/api";
import { portableSelection, type PortableDevice, type PortableProfile, type SyncPlan, type SyncProgress, type SyncResult } from "../lib/portableSync";
import type { Playlist } from "../lib/playlists";
import type { Listening } from "../lib/listening";
import { useMusicPreferences } from "../hooks/useMusicPreferences";
import { albumsOf } from "../lib/library";
import { formatBytes } from "../lib/format";
import Sheet from "./Sheet";

export default function PortableSync({ tracks, playlists, listening, onClose }: { tracks: LibTrack[]; playlists: Playlist[]; listening: Listening; onClose: () => void }) {
  const preferences = useMusicPreferences()?.preferences ?? {};
  const [profiles, setProfiles] = useState<PortableProfile[]>([]);
  const [devices, setDevices] = useState<PortableDevice[]>([]);
  const [profile, setProfile] = useState<PortableProfile | null>(null);
  const current = useRef(profile); current.current = profile;
  const [newName, setNewName] = useState("Portable collection");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [removeOld, setRemoveOld] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState("");
  const [discoveryError, setDiscoveryError] = useState("");
  const [forgetting, setForgetting] = useState(false);
  const session = useRef<string | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; let checking = false;
    const refresh = async () => {
      if (checking) return; checking = true;
      try {
        const [profiles, devices] = await Promise.all([portableSyncProfiles(), portableSyncDevices()]);
        if (!alive.current) return;
        setProfiles(profiles); setDevices(devices); setDiscoveryError("");
        const old = current.current;
        if (!old && profiles[0]) setProfile(profiles[0]);
        else if (old) { const found = profiles.find((p) => p.id === old.id); if (found) setProfile((p) => p?.id === found.id ? { ...p, available: found.available, message: found.message } : p); }
      } catch (e) { if (alive.current) setDiscoveryError(errorText(e)); }
      finally { checking = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 5000);
    const focus = () => void refresh(); window.addEventListener("focus", focus);
    return () => { alive.current = false; generation.current++; clearInterval(timer); window.removeEventListener("focus", focus); if (session.current) void portableSyncCancel(session.current).catch(() => {}); };
  }, []);
  const invalidate = () => { generation.current++; if (session.current) void portableSyncCancel(session.current).catch(() => {}); session.current = null; setPlan(null); setResult(null); setRemoveOld(false); setError(""); setForgetting(false); };
  const patch = (patch: Partial<PortableProfile>) => { invalidate(); setProfile((p) => p ? { ...p, ...patch } : p); };
  const selection = useMemo(() => profile ? portableSelection(profile, tracks, playlists, listening, preferences) : { paths: [], playlists: [] }, [profile, tracks, playlists, listening, preferences]);
  const choices = profile?.source_kind === "albums" ? albumsOf(tracks.filter((t) => !t.missing)).map((a) => ({ id: a.key, name: `${a.artist} - ${a.title}` })) : playlists.map((p) => ({ id: p.id, name: p.name }));
  const add = async (deviceId: string | null) => {
    invalidate(); setBusy(true);
    try { const added = await portableSyncCreate(newName, deviceId); if (added && alive.current) { setProfiles((p) => [...p, added]); setProfile(added); } }
    catch (e) { if (alive.current) setError(errorText(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  const preview = async () => {
    if (!profile) return; invalidate(); const token = generation.current; const id = crypto.randomUUID(); session.current = id; setBusy(true); setProgress(null);
    try {
      const saved = await portableSyncSave(profile);
      if (token !== generation.current || !alive.current) return;
      setProfile(saved); setProfiles((p) => p.map((old) => old.id === saved.id ? saved : old));
      const plan = await portableSyncPlan(saved.id, id, selection.paths, selection.playlists, (p) => { if (alive.current && token === generation.current) setProgress(p); });
      if (alive.current && token === generation.current) setPlan(plan);
    } catch (e) { if (alive.current && token === generation.current) { setError(errorText(e)); void portableSyncCancel(id).catch(() => {}); session.current = null; } }
    finally { if (alive.current && token === generation.current) { setBusy(false); setProgress(null); } }
  };
  const apply = async () => {
    if (!plan) return; const token = generation.current; setBusy(true); setError(""); setProgress(null);
    try { const result = await portableSyncApply(plan.id, removeOld, (p) => { if (alive.current && token === generation.current) setProgress(p); }); if (alive.current && token === generation.current) { setResult(result); setPlan(null); } }
    catch (e) { if (alive.current && token === generation.current) { setError(errorText(e)); setPlan(null); } }
    finally { if (alive.current && token === generation.current) { setBusy(false); setProgress(null); session.current = null; } }
  };
  const cancel = () => { if (session.current) void portableSyncCancel(session.current).catch((e) => setError(errorText(e))); };
  const forget = async () => {
    if (!profile) return; setBusy(true);
    try { await portableSyncForget(profile.id); invalidate(); const next = profiles.filter((p) => p.id !== profile.id); setProfiles(next); setProfile(next[0] ?? null); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet title="Portable collection sync" onClose={() => { if (!busy) onClose(); }} wide footer={<>
    {busy ? <button type="button" className="btn" onClick={cancel} disabled={!session.current}>Cancel operation</button> : <button type="button" className="btn" onClick={onClose}>Done</button>}
    {plan && <button type="button" className="btn primary" disabled={busy || !profile?.available || plan.free_bytes < plan.needed_bytes} onClick={() => void apply()}>Sync reviewed collection</button>}
  </>}>
    <p>Keep a collection on a mounted USB drive, SD card, or folder. Originals stay on this computer. Kaisu writes inside a separate profile folder and exports UTF-8 playlists with relative paths.</p>
    {discoveryError && <p role="alert">Device detection: {discoveryError}</p>}
    <section aria-label="Detected portable devices"><b>Detected removable devices</b><p className="dim">Detection refreshes every five seconds. Phones and tablets on Windows appear as "MTP, experimental" when they are unlocked and set to File transfer; Kaisu only adds new files, never replaces one, and removes only its own verified copies. On Linux, mount Android storage first. USB disks reported as fixed drives can be chosen manually.</p>
      {devices.length ? <ul>{devices.map((d) => <li key={d.id} className="flex flex-wrap gap-2 my-1"><span className="flex-1 break-words">{d.label}</span><button type="button" className="btn small" disabled={busy} onClick={() => void add(d.id)}>{d.transport === "mtp" ? "Create profile for this device" : `Create profile for ${d.location}`}</button></li>)}</ul> : <p className="dim">No removable devices detected. You can still choose a mounted folder below.</p>}
      <div className="flex flex-wrap gap-2"><input className="field flex-1 min-w-0" aria-label="New portable profile name" maxLength={80} value={newName} onChange={(e) => setNewName(e.target.value)} disabled={busy} /><button type="button" className="btn" disabled={busy || !newName.trim()} onClick={() => void add(null)}>Choose device folder</button></div>
    </section>
    {profile && <section aria-label="Portable profile options" className="mt-3">
      <label>Device profile<select className="field block w-full" aria-label="Portable device profile" disabled={busy} value={profile.id} onChange={(e) => { invalidate(); setProfile(profiles.find((p) => p.id === e.target.value) ?? null); }}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{!p.available ? " (disconnected)" : ""}</option>)}</select></label>
      <p role="status">{profile.available ? (profile.transport === "mtp" ? "Device connected" : "Device folder connected") : profile.message || "Device disconnected"}</p><p className="selectable break-words">{profile.folder}</p>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <label>Profile name<input className="field w-full" aria-label="Portable profile name" maxLength={80} value={profile.name} disabled={busy} onChange={(e) => patch({ name: e.target.value })} /></label>
        <label>Audio copies<select className="field w-full" aria-label="Portable audio format" value={profile.format} disabled={busy} onChange={(e) => patch({ format: e.target.value as PortableProfile["format"] })}><option value="original">Keep original formats</option><option value="mp3">Convert copies to MP3</option></select></label>
        {profile.format === "mp3" && <label>MP3 bitrate<select className="field w-full" aria-label="Portable MP3 bitrate" value={profile.bitrate} disabled={busy} onChange={(e) => patch({ bitrate: Number(e.target.value) })}>{[128,192,256,320].map((n) => <option key={n} value={n}>{n} kbps</option>)}</select></label>}
        <label>Collection source<select className="field w-full" aria-label="Portable collection source" value={profile.source_kind} disabled={busy} onChange={(e) => patch({ source_kind: e.target.value as PortableProfile["source_kind"], source_ids: [] })}><option value="library">Entire available library</option><option value="playlists">Selected playlists</option><option value="albums">Selected albums</option></select></label>
      </div>
      {profile.source_kind !== "library" && <div className="max-h-44 overflow-auto my-2 border rounded p-2" aria-label="Portable source selection">{choices.length ? choices.map((c) => <label key={c.id} className="flex gap-2 py-1"><input type="checkbox" aria-label={`Sync ${c.name}`} checked={profile.source_ids.includes(c.id)} disabled={busy} onChange={(e) => patch({ source_ids: e.target.checked ? [...profile.source_ids, c.id] : profile.source_ids.filter((id) => id !== c.id) })} /><span>{c.name}</span></label>) : <p>No available {profile.source_kind}.</p>}</div>}
      <p>{selection.paths.length} available songs selected · {selection.playlists.length} selected playlists/albums plus a Collection playlist. Missing files are excluded. Smart playlists are evaluated when you preview.</p>
      <div className="flex gap-2 flex-wrap"><button type="button" className="btn primary" disabled={busy || !profile.available || !profile.name.trim() || !selection.paths.length || selection.paths.length > 5000} onClick={() => void preview()}>Preview portable sync</button><button type="button" className="btn" disabled={busy} onClick={() => setForgetting(true)}>Forget profile</button></div>
      {forgetting && <div role="alert"><p>Forget this profile? Its device files and original music will remain in place.</p><button type="button" className="btn" disabled={busy} onClick={() => void forget()}>Forget profile and keep files</button><button type="button" className="btn" onClick={() => setForgetting(false)}>Keep profile</button></div>}
    </section>}
    {busy && <div role="status" className="mt-3"><b>{progress?.phase || "Preparing portable sync…"}</b>{progress && <><p className="break-words">{progress.title}</p><progress className="w-full" value={progress.done} max={Math.max(1, progress.total)} />{progress.done} of {progress.total}</>}</div>}
    {error && <p role="alert">{error}</p>}
    {plan && <section aria-label="Portable sync preview" className="mt-3"><h3>Review device changes</h3><p className="selectable break-words">{plan.destination}</p><p>{plan.additions.length} files to add · {plan.unchanged} unchanged files · {plan.removals.length} old managed copies</p><p>{formatBytes(plan.needed_bytes)} required{plan.conversion ? " (conversion estimate)" : ""}, {formatBytes(plan.free_bytes)} free.</p>
      {plan.free_bytes < plan.needed_bytes && <p role="alert">Free more device space and preview again before syncing.</p>}
      <details><summary>Files to add ({plan.additions.length})</summary><ul className="max-h-44 overflow-auto">{plan.additions.map((name, i) => <li key={i}>{name}</li>)}</ul></details>
      {plan.removals.length > 0 && <><label className="flex gap-2 my-2"><input type="checkbox" aria-label="Remove old Kaisu-managed device copies" checked={removeOld} disabled={busy} onChange={(e) => setRemoveOld(e.target.checked)} />Remove these old Kaisu-managed copies from this device after all new files are verified. This permanently removes only the listed device copies; originals stay in place.</label><details><summary>Old device copies ({plan.removals.length})</summary><ul className="max-h-44 overflow-auto">{plan.removals.map((name, i) => <li key={i}>{name}</li>)}</ul></details></>}
      {plan.protected.length > 0 && <p role="status">{plan.protected.length} device files were modified outside Kaisu and will be kept.</p>}
      <p className="dim">Unrelated device files are kept. Cancelling keeps completed, verified copies; preview again to reuse them. Old versions are retained unless you select removal.</p>
    </section>}
    {result && <section role="status"><h3>Portable sync finished</h3><p>{result.copied} files copied and verified · {result.unchanged} unchanged · {result.removed} old device copies removed.</p>{result.warnings.length > 0 && <ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}<p>Close any files playing from the device, then eject it through your operating system.</p></section>}
  </Sheet>;
}
