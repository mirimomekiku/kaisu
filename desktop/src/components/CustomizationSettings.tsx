import { useEffect, useRef, useState } from "react";
import { exportText, errorText } from "../lib/api";
import type { Settings } from "../lib/storage";
import { FEATURES } from "../lib/features";
import { builtinCustomizationPresets, COLOR_LABELS, contrast, customizationSnapshot, defaultAppearance, defaultCustomTheme, defaultSeek, defaultSidebar, exportTheme, importTheme, NAV_LABELS, themeProblem, type Appearance, type CustomTheme, type SidebarOptions, type ThemeColors } from "../lib/customization";

type Props = { settings: Settings; onChange: (patch: Partial<Settings>) => void };
function Option({ label, children }: { label: string; children: React.ReactNode }) { return <label className="customization-option"><span>{label}</span>{children}</label>; }
export function AppearanceControls({ settings, onChange }: Props) {
  const a = settings.appearance;
  const change = (patch: Partial<Appearance>) => onChange({ appearance: { ...a, ...patch } });
  return <div className="customization-controls">
    <Option label="Text size"><select className="field" aria-label="Interface text size" value={a.fontSize} onChange={(e) => change({ fontSize: Number(e.target.value) })}>{[11, 12, 13, 14, 15, 16].map((n) => <option key={n} value={n}>{n} px{n === 12 ? " (default)" : ""}</option>)}</select></Option>
    <Option label="Spacing"><select className="field" aria-label="Interface density" value={a.density} onChange={(e) => change({ density: e.target.value as Appearance["density"] })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></Option>
    <Option label="Artwork shape"><select className="field" aria-label="Artwork shape" value={a.artwork} onChange={(e) => change({ artwork: e.target.value as Appearance["artwork"] })}><option value="rounded">Rounded</option><option value="square">Square</option><option value="circle">Circle</option></select></Option>
    <label><input type="checkbox" aria-label="Reduce interface motion" checked={a.reducedMotion} onChange={(e) => change({ reducedMotion: e.target.checked })} /> Reduce interface motion</label>
    <p className="dim">Changes apply immediately. System reduced-motion preferences are also respected.</p>
    <button className="btn small w-fit" onClick={() => onChange({ appearance: defaultAppearance(), theme: "aqua", accent: "blue", customTheme: { ...settings.customTheme, enabled: false } })}>Reset appearance</button>
  </div>;
}
export function SidebarEditor({ settings, onChange, playlists, sources }: Props & { playlists: Array<{ id: string; name: string }>; sources: Array<{ id: string; title: string }> }) {
  const s = settings.sidebar;
  const change = (patch: Partial<SidebarOptions>) => onChange({ sidebar: { ...s, ...patch } });
  const order = s.order.filter((id) => id !== "podcasts" || FEATURES.podcasts);
  const move = (id: typeof order[number], direction: number) => {
    const at = s.order.indexOf(id), target = s.order.indexOf(order[order.indexOf(id) + direction]);
    const next = [...s.order]; [next[at], next[target]] = [next[target], next[at]]; change({ order: next });
  };
  const togglePin = (key: "playlistPins" | "sourcePins", id: string, checked: boolean) => change({ [key]: checked ? [...s[key], id].slice(0, 20) : s[key].filter((v) => v !== id) });
  return <div className="customization-controls">
    <p>Reorder sections or hide unused ones. Settings always remains visible; keyboard navigation still reaches hidden pages.</p>
    <ol className="sidebar-editor-list" aria-label="Sidebar section order">{order.map((id, i) => <li key={id}><label><input type="checkbox" aria-label={`Show ${NAV_LABELS[id]} in sidebar`} checked={!s.hidden.includes(id)} disabled={id === "settings"} onChange={(e) => change({ hidden: e.target.checked ? s.hidden.filter((v) => v !== id) : [...s.hidden, id] })} /> {NAV_LABELS[id]}</label><div className="flex gap-1"><button className="btn small" aria-label={`Move ${NAV_LABELS[id]} up`} disabled={i === 0} onClick={() => move(id, -1)}>↑</button><button className="btn small" aria-label={`Move ${NAV_LABELS[id]} down`} disabled={i === order.length - 1} onClick={() => move(id, 1)}>↓</button></div></li>)}</ol>
    <Option label="Sidebar width"><input className="field" aria-label="Sidebar width" type="range" min="160" max="280" step="10" value={s.width} onChange={(e) => change({ width: Number(e.target.value) })} /><output>{s.width} px</output></Option>
    <label><input type="checkbox" aria-label="Show sidebar artwork" checked={s.showArtwork} onChange={(e) => change({ showArtwork: e.target.checked })} /> Show artwork</label>
    <label><input type="checkbox" aria-label="Show sidebar counts" checked={s.showCounts} onChange={(e) => change({ showCounts: e.target.checked })} /> Show item counts</label>
    <details><summary>Pin playlists ({s.playlistPins.length}/20)</summary><div className="pin-options">{playlists.length ? playlists.map((p) => <label key={p.id}><input type="checkbox" aria-label={`Pin playlist ${p.name}`} checked={s.playlistPins.includes(p.id)} disabled={!s.playlistPins.includes(p.id) && s.playlistPins.length >= 20} onChange={(e) => togglePin("playlistPins", p.id, e.target.checked)} /> {p.name}</label>) : <p className="dim">Create a playlist in Library to pin it here.</p>}</div></details>
    <details><summary>Pin saved sources ({s.sourcePins.length}/20)</summary><div className="pin-options">{sources.length ? sources.map((p) => <label key={p.id}><input type="checkbox" aria-label={`Pin source ${p.title}`} checked={s.sourcePins.includes(p.id)} disabled={!s.sourcePins.includes(p.id) && s.sourcePins.length >= 20} onChange={(e) => togglePin("sourcePins", p.id, e.target.checked)} /> {p.title}</label>) : <p className="dim">Save a channel or playlist to pin it here. Source pins open in Search.</p>}</div></details>
    {(s.playlistPins.some((id) => !playlists.some((p) => p.id === id)) || s.sourcePins.some((id) => !sources.some((p) => p.id === id))) && <button className="btn small w-fit" onClick={() => change({ playlistPins: s.playlistPins.filter((id) => playlists.some((p) => p.id === id)), sourcePins: s.sourcePins.filter((id) => sources.some((p) => p.id === id)) })}>Remove unavailable pins</button>}
    <button className="btn small w-fit" onClick={() => onChange({ sidebar: defaultSidebar() })}>Reset sidebar</button>
  </div>;
}
export function SeekSettings({ settings, onChange }: Props) {
  const s = settings.seekPreferences;
  const change = (patch: Partial<typeof s>) => onChange({ seekPreferences: { ...s, ...patch } });
  return <div className="customization-controls">
    <p>J seeks backward and L seeks forward while browsing or using the full-screen player. Text fields and other dialogs keep their own keys. Arrow keys use these intervals when a seek bar is focused. Hold Shift for fine seeking. Applies to the main, full-screen and mini-player.</p>
    <Option label="Backward interval"><select className="field" aria-label="Seek backward seconds" value={s.backward} onChange={(e) => change({ backward: Number(e.target.value) })}>{[...new Set([1, 5, 10, 15, 30, 60, 120, s.backward])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} seconds</option>)}</select></Option>
    <Option label="Forward interval"><select className="field" aria-label="Seek forward seconds" value={s.forward} onChange={(e) => change({ forward: Number(e.target.value) })}>{[...new Set([1, 5, 10, 15, 30, 60, 120, s.forward])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} seconds</option>)}</select></Option>
    <Option label="Fine interval (Shift)"><select className="field" aria-label="Fine seek seconds" value={s.fine} onChange={(e) => change({ fine: Number(e.target.value) })}>{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} second{n > 1 ? "s" : ""}</option>)}</select></Option>
    <Option label="Mouse wheel over seek bar"><select className="field" aria-label="Seek bar mouse wheel" value={s.wheel} onChange={(e) => change({ wheel: e.target.value as typeof s.wheel })}><option value="off">Scroll normally (default)</option><option value="seek">Seek using intervals</option></select></Option>
    <label><input type="checkbox" aria-label="Reverse seek wheel direction" disabled={s.wheel === "off"} checked={s.wheelInverted} onChange={(e) => change({ wheelInverted: e.target.checked })} /> Reverse wheel direction</label>
    <button className="btn small w-fit" onClick={() => onChange({ seekPreferences: defaultSeek() })}>Reset seek preferences</button>
  </div>;
}
export function ThemeEditor({ settings, onChange }: Props) {
  const [draft, setDraft] = useState<CustomTheme>(settings.customTheme);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(settings.customTheme); }, [settings.customTheme]);
  const problem = themeProblem(draft), c = draft.colors;
  const preview = Object.fromEntries((Object.keys(COLOR_LABELS) as Array<keyof ThemeColors>).map((key) => [key, /^#[0-9a-f]{6}$/i.test(c[key]) ? c[key] : defaultCustomTheme().colors[key]])) as ThemeColors;
  const setColor = (key: keyof ThemeColors, value: string) => { setDraft({ ...draft, colors: { ...c, [key]: value } }); setNotice(""); };
  const exportIt = async () => {
    try {
      if (await exportText("Export Kaisu theme", "kaisu-theme.json", "json", exportTheme(draft))) setNotice("Theme exported.");
    } catch (e) { setError(errorText(e)); }
  };
  return <div className="customization-controls">
    <p>Preview colors, then apply them across the app. Custom palettes replace the base theme’s color filters. Exports contain only the theme name and colors.</p>
    <Option label="Theme name"><input className="field" aria-label="Custom theme name" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Option>
    <div className="theme-color-grid">{(Object.keys(COLOR_LABELS) as Array<keyof ThemeColors>).map((key) => <label key={key}><span>{COLOR_LABELS[key]}</span><div className="flex gap-2"><input type="color" aria-label={`${COLOR_LABELS[key]} color`} value={/^#[0-9a-f]{6}$/i.test(c[key]) ? c[key] : "#000000"} onChange={(e) => setColor(key, e.target.value)} /><input className="field" aria-label={`${COLOR_LABELS[key]} hex`} maxLength={7} value={c[key]} onChange={(e) => setColor(key, e.target.value)} /></div></label>)}</div>
    <div className="theme-preview" role="region" aria-label="Custom theme preview" style={{ background: preview.window, color: preview.text, borderColor: preview.border }}><aside style={{ background: preview.sidebar, borderColor: preview.border }}>Library<br /><span style={{ background: preview.accent, color: preview.selectionText, display: "block", padding: 8 }}>My playlist</span></aside><div style={{ background: preview.surface }}><b>{draft.name || "My theme"}</b><p style={{ color: preview.muted }}>Artist · Album · 12 songs</p><span style={{ background: preview.accent, color: preview.selectionText, padding: "4px 10px", borderRadius: 4 }}>Play</span></div></div>
    <p className="dim">Text contrast: {contrast(preview.text, preview.surface).toFixed(1)}:1 · Selection contrast: {contrast(preview.selectionText, preview.accent).toFixed(1)}:1</p>
    {problem && <p role="status">{problem}</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="flex gap-2 flex-wrap"><button className="btn primary" disabled={!!problem} onClick={() => { onChange({ customTheme: { ...draft, enabled: true } }); setNotice("Custom theme applied."); }}>Apply custom theme</button><button className="btn" disabled={!settings.customTheme.enabled} onClick={() => onChange({ customTheme: { ...settings.customTheme, enabled: false } })}>Use base theme</button><button className="btn" onClick={() => { setDraft(settings.customTheme); setError(""); setNotice(""); }}>Discard theme edits</button></div>
    <div className="flex gap-2 flex-wrap"><button className="btn small" disabled={!!problem} onClick={() => void exportIt()}>Export theme</button><button className="btn small" onClick={() => file.current?.click()}>Import theme</button><button className="btn small" onClick={() => { const reset = defaultCustomTheme(); onChange({ customTheme: reset }); setDraft(reset); setError(""); setNotice(""); }}>Reset custom theme</button></div>
    <input ref={file} type="file" accept=".json,application/json" aria-label="Import theme file" className="sr-only" tabIndex={-1} onChange={async (e) => {
      const chosen = e.target.files?.[0]; e.target.value = "";
      if (!chosen) return;
      setError(""); setNotice("");
      try { if (chosen.size > 32768) throw new Error("Choose a theme JSON file under 32 KB."); setDraft(importTheme(await chosen.text())); setNotice("Theme imported into preview. Apply it when ready."); } catch (e) { setError(errorText(e)); }
    }} />
  </div>;
}
export function CustomizationPresets({ settings, onChange }: Props) {
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState("builtin-classic");
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const all = [...builtinCustomizationPresets(), ...settings.customizationPresets];
  const preset = all.find((p) => p.id === selected);
  const custom = preset && !preset.id.startsWith("builtin-");
  const matches = preset && JSON.stringify(customizationSnapshot(settings)) === JSON.stringify(preset.values);
  const checkName = () => {
    const value = title.trim();
    return !value || value.length > 80 ? "Use a preset name between 1 and 80 characters." : all.some((p) => p.name.toLowerCase() === value.toLowerCase()) ? "That preset name already exists." : settings.customizationPresets.length >= 20 ? "Save up to 20 custom presets." : "";
  };
  return <div className="customization-controls">
    <p>Save appearance, sidebar layout and pins, seek preferences, and custom theme together. Playback profiles and download settings are managed separately.</p>
    <Option label="Preset"><select className="field" aria-label="Customization preset" value={selected} onChange={(e) => { setSelected(e.target.value); setProblem(""); setNotice(""); }}>{all.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id.startsWith("builtin-") ? " (built-in)" : ""}</option>)}</select></Option>
    <p className="dim">{matches ? "Current customization matches this preset." : "Current customization differs from this preset."}</p>
    <div className="flex gap-2 flex-wrap"><button className="btn primary" disabled={!preset} onClick={() => { if (preset) onChange(customizationSnapshot(preset.values)); setNotice("Customization preset applied."); }}>Apply customization preset</button><button className="btn" disabled={!custom} onClick={() => { if (preset) onChange({ customizationPresets: settings.customizationPresets.map((p) => p.id === preset.id ? { ...p, values: customizationSnapshot(settings) } : p) }); setNotice("Preset updated with current customization."); }}>Update customization preset</button><button className="btn" disabled={!custom} onClick={() => { onChange({ customizationPresets: settings.customizationPresets.filter((p) => p.id !== selected) }); setSelected("builtin-classic"); setNotice("Preset deleted. Your current customization is kept."); }}>Delete customization preset</button></div>
    <Option label="New preset name"><input className="field" aria-label="New customization preset name" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></Option>
    <button className="btn small w-fit" onClick={() => {
      const error = checkName(); setProblem(error); if (error) return;
      const id = `custom-${crypto.randomUUID()}`;
      onChange({ customizationPresets: [...settings.customizationPresets, { id, name: title.trim(), values: customizationSnapshot(settings) }] }); setSelected(id); setTitle(""); setNotice("Customization preset saved.");
    }}>Save customization as new preset</button>
    {problem && <p role="alert">{problem}</p>}{notice && <p role="status">{notice}</p>}
  </div>;
}
