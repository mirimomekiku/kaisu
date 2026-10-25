import { useMemo, useState } from "react";
import { blankSmartRule, operators, SMART_FIELDS, SMART_SORTS, SMART_SORT_LABELS, SMART_PRESETS, smartTracks, smartProblem, type SmartField, type SmartRules } from "../lib/smartPlaylists";
import Sheet from "./Sheet";
import type { LibTrack } from "../lib/api";
import type { Listening } from "../lib/listening";
import type { MusicPreferences } from "../lib/musicPreferences";

const names: Record<string, string> = { folder: "File folder (includes subfolders)", duration: "Duration (seconds)", title: "Title", artist: "Artist", album: "Album", genre: "Genre", format: "Format", year: "Year", plays: "Play count", added: "Added recently", played: "Listening status", favorite: "Favorite", rating: "Rating" };
const opNames: Record<string, string> = { contains: "contains", is: "is", at_least: "at least", at_most: "at most", within_days: "within days" };
export default function SmartPlaylistEditor({ tracks, listening, preferences, initial, initialName = "", onSave, onClose }: { tracks: LibTrack[]; listening: Listening; preferences?: MusicPreferences; initial?: SmartRules; initialName?: string; onSave: (name: string, rules: SmartRules) => string | null; onClose: () => void }) {
  const [name, setName] = useState(initialName);
  const [smart, setSmart] = useState<SmartRules>(initial ?? { match: "all", rules: [blankSmartRule()] });
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => smartTracks(tracks, smart, listening, Date.now(), preferences), [tracks, smart, listening, preferences]);
  const problem = smartProblem(smart);
  const save = () => { const problem = smartProblem(smart) ?? onSave(name, smart); setError(problem); if (!problem) onClose(); };
  return <Sheet title={initial ? "Edit smart playlist" : "New smart playlist"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save smart playlist</button></>} wide>
    <div className="smart-editor">
      <label>Start from a preset<select className="field" aria-label="Smart playlist preset" value="" onChange={(e) => {
        const preset = SMART_PRESETS.find((p) => p.name === e.target.value);
        if (preset) { setSmart(structuredClone(preset.smart)); if (!name.trim()) setName(preset.name); setError(null); }
      }}><option value="">Custom rules</option>{SMART_PRESETS.map((p) => <option key={p.name}>{p.name}</option>)}</select></label>
      <label>Playlist name<input className="field" aria-label="Playlist name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>Match<select className="field" aria-label="Match rules" value={smart.match} onChange={(e) => setSmart({ ...smart, match: e.target.value as "all" | "any" })}><option value="all">All rules</option><option value="any">Any rule</option></select></label>
      <p className="dim">Songs update automatically as your library and listening history change. A play is counted when a track finishes.</p>
      {smart.rules.map((r, i) => <div className="smart-rule" key={i}>
        <select className="field" aria-label={`Rule ${i + 1} field`} value={r.field} onChange={(e) => setSmart({ ...smart, rules: smart.rules.map((v, n) => n === i ? blankSmartRule(e.target.value as SmartField) : v) })}>{SMART_FIELDS.map((f) => <option key={f} value={f}>{names[f]}</option>)}</select>
        <select className="field" aria-label={`Rule ${i + 1} operator`} value={r.op} onChange={(e) => setSmart({ ...smart, rules: smart.rules.map((v, n) => n === i ? { ...v, op: e.target.value } : v) })}>{operators(r.field).map((o) => <option key={o} value={o}>{opNames[o]}</option>)}</select>
        {r.field === "favorite" ? <select className="field" aria-label={`Rule ${i + 1} value`} value={r.value} onChange={(e) => setSmart({ ...smart, rules: smart.rules.map((v, n) => n === i ? { ...v, value: e.target.value } : v) })}><option value="yes">Favorite</option><option value="no">Not favorite</option></select> : r.field === "played" ? <select className="field" aria-label={`Rule ${i + 1} value`} value={r.value} onChange={(e) => setSmart({ ...smart, rules: smart.rules.map((v, n) => n === i ? { ...v, value: e.target.value } : v) })}><option value="never">Never played</option><option value="played">Played</option></select> : <input className="field" aria-label={`Rule ${i + 1} value`} type={["year", "plays", "added", "rating", "duration"].includes(r.field) ? "number" : "text"} value={r.value} onChange={(e) => setSmart({ ...smart, rules: smart.rules.map((v, n) => n === i ? { ...v, value: e.target.value } : v) })} />}
        <button className="btn small" aria-label={`Remove rule ${i + 1}`} disabled={smart.rules.length === 1} onClick={() => setSmart({ ...smart, rules: smart.rules.filter((_, n) => n !== i) })}>Remove</button>
      </div>)}
      <button className="btn small w-fit" disabled={smart.rules.length >= 20} onClick={() => setSmart({ ...smart, rules: [...smart.rules, blankSmartRule()] })}>Add rule</button>
      <div className="smart-options">
        <label>Order by<select className="field" aria-label="Smart playlist order" value={smart.sort ?? "title"} onChange={(e) => setSmart({ ...smart, sort: e.target.value as typeof SMART_SORTS[number] })}>{SMART_SORTS.map((key) => <option key={key} value={key}>{SMART_SORT_LABELS[key]}</option>)}</select></label>
        <label>Direction<select className="field" aria-label="Smart playlist direction" value={smart.descending ? "desc" : "asc"} onChange={(e) => setSmart({ ...smart, descending: e.target.value === "desc" })}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
        <label>Maximum songs<input className="field" aria-label="Smart playlist limit" type="number" min="1" max="5000" value={Number.isNaN(smart.limit) ? "" : smart.limit ?? 5000} onChange={(e) => setSmart({ ...smart, limit: e.target.value === "" ? NaN : Number(e.target.value) })} /></label>
      </div>
      <section className="smart-preview" aria-label="Smart playlist preview" aria-live="polite">
        {problem ? <p>{problem}</p> : <><p><b>{preview.length} matching song{preview.length === 1 ? "" : "s"}</b> · Preview in playlist order{preview.length >= (smart.limit ?? 5000) ? " · limit reached" : ""}</p>
          {preview.length === 0 ? <p className="dim">No songs match yet. New matching songs will appear automatically.</p> : <ol>{preview.slice(0, 5).map((t) => <li key={t.path}>{t.title} <span className="dim">· {t.artist || "Unknown artist"}</span></li>)}</ol>}
          {preview.length > 5 && <p className="dim">And {preview.length - 5} more.</p>}</>}
      </section>
      {error && <p role="alert">{error}</p>}
    </div>
  </Sheet>;
}
