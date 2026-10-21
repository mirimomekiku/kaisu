import { open } from "@tauri-apps/plugin-dialog";
import { Plus, Trash2 } from "lucide-react";
import { AUDIO_FORMATS, blankSiteRule, describeSiteRule, validateSiteRule, type SiteRule } from "../lib/siteRules";

interface Props {
  rules: SiteRule[];
  onChange: (rules: SiteRule[]) => void;
}

const MAX_RULES = 50;

/** The list of site rules. The first rule that matches a download wins. */
export default function SiteRulesEditor({ rules, onChange }: Props) {
  const update = (id: string, patch: Partial<SiteRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const choose = async (rule: SiteRule) => {
    const dir = await open({ directory: true, multiple: false, defaultPath: rule.folder || undefined });
    if (typeof dir === "string") update(rule.id, { folder: dir });
  };

  return (
    <div className="flex flex-col" aria-label="Site rules">
      {rules.map((rule, i) => {
        const problem = validateSiteRule(rule);
        const n = i + 1;
        return (
          <div key={rule.id} className="pref-row" style={{ display: "block" }} role="group" aria-label={`Site rule ${n}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5">
                Site
                <input value={rule.host} onChange={(e) => update(rule.id, { host: e.target.value })} placeholder="youtube.com" spellCheck={false} className="field mono" style={{ width: 160 }} aria-label={`Site (rule ${n})`} aria-invalid={!!problem && !rule.host.trim()} />
              </label>
              <label className="flex items-center gap-1.5">
                Channel
                <input value={rule.channel} onChange={(e) => update(rule.id, { channel: e.target.value })} placeholder="any" spellCheck={false} className="field" style={{ width: 130 }} aria-label={`Channel (rule ${n})`} />
              </label>
              <button className="row-btn" title="Delete this rule" aria-label={`Delete site rule ${n}`} onClick={() => onChange(rules.filter((r) => r.id !== rule.id))}>
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              <label className="flex items-center gap-1.5">
                Download as
                <select value={rule.preset} onChange={(e) => update(rule.id, { preset: e.target.value as SiteRule["preset"] })} className="field" aria-label={`Download as (rule ${n})`}>
                  <option value="">what I asked for</option>
                  <option value="best">best video</option>
                  <option value="p1080">1080p video</option>
                  <option value="p720">720p video</option>
                  <option value="audio">audio only</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                Audio format
                <select value={rule.audioFormat} onChange={(e) => update(rule.id, { audioFormat: e.target.value as SiteRule["audioFormat"] })} className="field" aria-label={`Audio format (rule ${n})`}>
                  <option value="">from Settings</option>
                  {AUDIO_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              <label className="flex items-center gap-1.5 flex-1 min-w-0">
                Save in
                <input value={rule.folder} onChange={(e) => update(rule.id, { folder: e.target.value })} placeholder="the usual download folder" spellCheck={false} className="field mono flex-1 min-w-0" aria-label={`Folder (rule ${n})`} />
              </label>
              <button className="btn small" onClick={() => void choose(rule)} aria-label={`Choose folder (rule ${n})`}>
                Choose…
              </button>
            </div>
            <p className="pref-hint mt-1 mb-0" style={problem ? { color: "#b3261e" } : undefined} role={problem ? "alert" : undefined}>
              {problem ?? describeSiteRule(rule)}
            </p>
          </div>
        );
      })}
      <div className="pref-row">
        <button className="btn small" disabled={rules.length >= MAX_RULES} onClick={() => onChange([...rules, blankSiteRule()])}>
          <Plus className="w-3 h-3" /> Add a rule
        </button>
        <span className="pref-hint">The first matching rule wins. Files saved in a rule's folder aren't moved or cleaned up by Kaisu.</span>
      </div>
    </div>
  );
}
