import { useContext } from "react";
import { PlaybackServicesContext } from "../hooks/useAudioOutput";

export default function AudioOutputPicker() {
  const output = useContext(PlaybackServicesContext)?.output;
  if (!output) return null;
  if (!output.supported) return <p className="dim">Output selection is unavailable in this system player. Choose your output in the operating system's sound settings.</p>;
  return <div className="flex flex-col gap-2">
    <label>Audio output<select className="field" aria-label="Audio output" disabled={output.busy} value={output.active} onChange={(e) => void output.choose(e.target.value)}>
      <option value="">System default</option>{output.devices.filter((d) => d.deviceId && d.deviceId !== "default").map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Output ${i + 1}`}</option>)}
    </select></label>
    <div className="flex gap-2 flex-wrap">{output.canPrompt && <button className="btn small" disabled={output.busy} onClick={() => void output.choose()}>Choose output device</button>}<button className="btn small" disabled={output.busy} onClick={() => void output.refresh()}>Refresh audio outputs</button></div>
    <span className="dim">Preferred: {output.preferredLabel}. Device changes apply to both songs during crossfade.</span>
    {!output.canPrompt && !output.devices.some((d) => d.deviceId && d.deviceId !== "default") && <span className="dim">This player has not exposed other outputs. Choose a device in the operating system's sound settings.</span>}
    {output.message && <span role="status">{output.message}</span>}
  </div>;
}
