import type { LyricsMode } from "../lib/api";
export default function LyricsChoice({ value, automatic = false, onChange, label = "Lyrics" }: { value: LyricsMode; automatic?: boolean; onChange: (value: LyricsMode) => void; label?: string }) {
  return <div className="flex flex-col gap-1">
    {automatic ? <p className="m-0" role="status">YouTube Music audio: save the lyrics file and embed lyrics automatically when available.</p> : <label className="flex items-center gap-2">{label}<select className="field" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as LyricsMode)}><option value="off">No lyrics</option><option value="file">Save as a .lrc file</option><option value="embed">Put inside the song</option><option value="both">Both</option></select></label>}
    {(automatic || value !== "off") && <p className="m-0 dim">Online lookup uses LRCLIB after consent. Synced lyrics use .lrc; plain-only lyrics use .txt. Lyrics are embedded when the audio format supports them.</p>}
  </div>;
}
