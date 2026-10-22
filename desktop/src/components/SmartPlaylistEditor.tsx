import { useState } from "react";
import { blankSmartRule, operators, SMART_FIELDS, smartProblem, type SmartField, type SmartRules } from "../lib/smartPlaylists";
import Sheet from "./Sheet";

const names: Record<string, string> = { title: "Title", artist: "Artist", album: "Album", genre: "Genre", format: "Format", year: "Year", plays: "Play count", added: "Added recently", played: "Listening status", favorite: "Favorite", rating: "Rating" };
const opNames: Record<string, string> = { contains: "contains", is: "is", at_least: "at least", at_most: "at most", within_days: "within days" };
export default function SmartPlaylistEditor({ initial, initialName = "", onSave, onClose }: { initial?: SmartRules; initialName?: string; onSave: (name: string, rules: SmartRules) => string | null; onClose: () => void }) {
  const [name, setName] = useState(initialName);
  const [smart, setSmart] = useState<SmartRules>(initial ?? { match: "all", rules: [blankSmartRule()] });
  const [error, setError] = useState<string | null>(null);
  const save = () => { const problem = smartProblem(smart) ?? onSave(name, smart); setError(problem); if (!problem) onClose(); };
  return <Sheet title={initial ? "Edit smart playlist" : "New smart playlist"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save smart playlist</button></>} wide>
    <div className="smart-editor">
      <label>Playlist name<input className="field" aria-label="Playlist name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>Match<select className="field" aria-label="Match rules" value={smart.match} onChange={(e) => setSmart({ ...smart, match: e.target.value as "all" | "any" })}><option value="all">All rules</option><option value="any">Any rule</option></select></label>
      <p className="dim">Songs update automatically as your library and listening history change. A play is counted when a track finishes.</p>
      {smart.rules.map((r, i) => <div className="smart-rule" key={i}>
        <select className="field" aria-label={`Rule ${i + 1} field`} value={r.field} onChange={(e) => setSmart({ ...smart, rules: smart.rules.map((v, n) => n === i ? blankSmartRule(e.target.value as SmartField) : v) })}>{SMART_FIELDS.map((f) => <option key={f} value={f}>{names[f]}</option>)}</select>
        <select className="field" aria-label={`Rule ${i + 1} operator`} value={r.op} onChange={(e) => setSmart({ ...smart, rules: smart.rules.map((v, n) => n === i ? { ...v, op: e.target.value } : v) })}>{operators(r.field).map((o) => <option key={o} value={o}>{opNames[o]}</option>)}</select>
        {r.field === "favorite" ? <select className="field" aria-label={`Rule ${i + 1} value`} value={r.value} onChange={(e) => setSmart({ ...smart, rules: smart.rules.map((v, n) => n === i ? { ...v, value: e.target.value } : v) })}><option value="yes">Favorite</option><option value="no">Not favorite</option></select> : r.field === "played" ? <select className="field" aria-label={`Rule ${i + 1} value`} value={r.value} onChange={(e) => setSmart({ ...smart, rules: smart.rules.map((v, n) => n === i ? { ...v, value: e.target.value } : v) })}><option value="never">Never played</option><option value="played">Played</option></select> : <input className="field" aria-label={`Rule ${i + 1} value`} type={["year", "plays", "added", "rating"].includes(r.field) ? "number" : "text"} value={r.value} onChange={(e) => setSmart({ ...smart, rules: smart.rules.map((v, n) => n === i ? { ...v, value: e.target.value } : v) })} />}
        <button className="btn small" aria-label={`Remove rule ${i + 1}`} disabled={smart.rules.length === 1} onClick={() => setSmart({ ...smart, rules: smart.rules.filter((_, n) => n !== i) })}>Remove</button>
      </div>)}
      <button className="btn small w-fit" disabled={smart.rules.length >= 20} onClick={() => setSmart({ ...smart, rules: [...smart.rules, blankSmartRule()] })}>Add rule</button>
      {error && <p role="alert">{error}</p>}
    </div>
  </Sheet>;
}
