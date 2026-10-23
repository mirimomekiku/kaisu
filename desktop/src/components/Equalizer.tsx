import { createContext, useContext, useState, useSyncExternalStore } from "react";
import { usePlayerEngine } from "../hooks/usePlayer";
import { defaultEqualizer, EQ_LABELS, EQ_PRESETS, equalizerPreset, sanitizeEqualizer, type EqualizerSettings } from "../lib/equalizer";
import type { EqualizerStatus } from "../lib/equalizerGraph";
import Sheet from "./Sheet";

export const EqualizerContext = createContext<{ settings: EqualizerSettings; ready: boolean; change: (settings: EqualizerSettings) => void } | null>(null);
const unavailable: EqualizerStatus = { supported: false, active: false, error: null, effectivePreamp: 0 };
const noSubscribe = () => () => {};
const noStatus = () => unavailable;
const db = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;

export function EqualizerControls() {
  const service = useContext(EqualizerContext);
  const processing = usePlayerEngine()?.processing;
  const status = useSyncExternalStore(processing?.subscribe ?? noSubscribe, processing?.status ?? noStatus);
  if (!service) return null;
  const { settings, ready, change } = service;
  const disabled = !ready || !status.supported;
  const update = (patch: Partial<EqualizerSettings>) => change(sanitizeEqualizer({ ...settings, ...patch }));
  return <div className="equalizer" aria-label="Equalizer controls">
    <div className="eq-tools">
      <label><input type="checkbox" aria-label="Enable equalizer" disabled={disabled} checked={settings.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> Enable equalizer</label>
      <label>Preset<select className="field" aria-label="Equalizer preset" disabled={disabled} value={equalizerPreset(settings)} onChange={(e) => { const bands = EQ_PRESETS[e.target.value]; if (bands) update({ bands: [...bands], preamp: 0 }); }}><option value="Custom" disabled>Custom</option>{Object.keys(EQ_PRESETS).map((preset) => <option key={preset}>{preset}</option>)}</select></label>
      <button className="btn small" disabled={disabled} onClick={() => change({ ...defaultEqualizer(), enabled: settings.enabled })}>Reset equalizer</button>
    </div>
    <label className="eq-preamp">Preamp<input type="range" aria-label="Equalizer preamp" aria-valuetext={db(settings.preamp)} min={-12} max={12} step={0.5} disabled={disabled} value={settings.preamp} onChange={(e) => update({ preamp: Number(e.target.value) })} /><output>{db(settings.preamp)}</output></label>
    <div className="eq-bands">{EQ_LABELS.map((label, i) => <label className="eq-band" key={label}><output>{db(settings.bands[i])}</output><input type="range" aria-label={`Equalizer ${label}`} aria-valuetext={db(settings.bands[i])} min={-12} max={12} step={0.5} disabled={disabled} value={settings.bands[i]} onChange={(e) => { const bands = [...settings.bands]; bands[i] = Number(e.target.value); update({ bands }); }} /><span>{label}</span></label>)}</div>
    <label><input type="checkbox" aria-label="Equalizer automatic headroom" disabled={disabled} checked={settings.autoHeadroom} onChange={(e) => update({ autoHeadroom: e.target.checked })} /> Automatic headroom</label>
    <p className="dim m-0">Reduces output when frequencies are boosted to reduce clipping. Volume, loudness leveling and sleep fades still apply.</p>
    <p className="dim m-0" role="status">{!status.supported ? "Equalizer is unavailable in this system player." : !settings.enabled ? "Bypassed — saved adjustments are kept." : status.active ? `Equalizer active · effective preamp ${db(status.effectivePreamp)}` : "Ready — applies when playback starts."}</p>
    {status.error && <p role="alert">{status.error}</p>}
  </div>;
}

export default function EqualizerButton() {
  const [open, setOpen] = useState(false);
  return <><button className="btn small" onClick={() => setOpen(true)}>Equalizer</button>{open && <Sheet wide title="Audio equalizer" onClose={() => setOpen(false)} footer={<button className="btn" onClick={() => setOpen(false)}>Done</button>}><EqualizerControls /></Sheet>}</>;
}
