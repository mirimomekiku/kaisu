import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { checkSpeedLimit } from "../lib/validate";
import { errorText, type AudioFormat, type Preset } from "../lib/api";
import type { QueueEdit } from "../lib/queueEdit";
import { AUDIO_FORMAT_IDS, audioFormatName, lossyEncodeNote } from "../lib/audioFormats";
import Sheet from "./Sheet";

export default function BulkDownloadEditor({ count, onSave, onClose }: { count: number; onSave: (edit: QueueEdit) => void; onClose: () => void }) {
  const [preset, setPreset] = useState("");
  const [audioFormat, setAudioFormat] = useState("");
  const [outDir, setOutDir] = useState("");
  const [changeLimit, setChangeLimit] = useState(false);
  const [limit, setLimit] = useState("");
  const [error, setError] = useState("");
  const problem = changeLimit ? checkSpeedLimit(limit) : null;
  const changed = !!preset || !!audioFormat || !!outDir || changeLimit;
  const save = () => {
    if (!changed || problem || count === 0) return;
    onSave({ ...(preset ? { preset: preset as Preset } : {}), ...(audioFormat ? { audioFormat: audioFormat as AudioFormat } : {}), ...(outDir ? { outDir } : {}), ...(changeLimit ? { rateLimit: limit.trim() || null } : {}) }); onClose();
  };
  return <Sheet title="Edit waiting downloads" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!changed || !!problem || count === 0} onClick={save}>Apply changes</button></>}>
    <div className="flex flex-col gap-2">
      <p>{count} selected waiting downloads. Items that start before you apply will be skipped. Changing quality or destination may start a fresh file.</p>
      <label>Quality<select className="field" aria-label="Bulk download quality" value={preset} onChange={(e) => setPreset(e.target.value)}><option value="">Keep each quality</option><option value="best">Best video</option><option value="p1080">1080p video</option><option value="p720">720p video</option><option value="audio">Audio only</option></select></label>
      <label>Audio format<select className="field" aria-label="Bulk audio format" value={audioFormat} onChange={(e) => setAudioFormat(e.target.value)}><option value="">Keep each format</option>{AUDIO_FORMAT_IDS.map((f) => <option key={f} value={f}>{audioFormatName(f)}</option>)}</select></label>
      {lossyEncodeNote(audioFormat as AudioFormat) && <p className="pref-hint m-0" role="note">{lossyEncodeNote(audioFormat as AudioFormat)}</p>}
      <span className="dim">Audio format applies to audio downloads.</span>
      <button className="btn" onClick={async () => { try { const path = await open({ directory: true, multiple: false }); if (typeof path === "string") setOutDir(path); } catch (e) { setError(errorText(e)); } }}>Choose bulk destination</button>
      {outDir && <div className="flex gap-2 min-w-0"><span className="truncate" title={outDir}>{outDir}</span><button className="btn small" onClick={() => setOutDir("")}>Keep original destinations</button></div>}
      <label><input type="checkbox" checked={changeLimit} onChange={(e) => setChangeLimit(e.target.checked)} /> Change speed limit</label>
      {changeLimit && <label>Speed limit<input className="field" aria-label="Bulk speed limit" placeholder="Empty removes the limit; e.g. 500K" value={limit} onChange={(e) => setLimit(e.target.value)} /></label>}
      {(problem || error) && <p role="alert">{problem || error}</p>}
    </div>
  </Sheet>;
}
