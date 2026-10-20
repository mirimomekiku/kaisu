import { Plus, Trash2 } from "lucide-react";
import { DAY_NAMES, blankRule, describeRule, validateRule, type ScheduleRule, type ScheduleState } from "../lib/schedule";

interface Props {
  rules: ScheduleRule[];
  onChange: (rules: ScheduleRule[]) => void;
  /** What the schedule does right now. */
  state: ScheduleState;
}

/** The list of bandwidth rules. The first rule that matches the current time wins. */
export default function ScheduleEditor({ rules, onChange, state }: Props) {
  const update = (id: string, patch: Partial<ScheduleRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const toggleDay = (rule: ScheduleRule, day: number) =>
    update(rule.id, { days: rule.days.includes(day) ? rule.days.filter((d) => d !== day) : [...rule.days, day] });

  return (
    <div className="flex flex-col" aria-label="Schedule rules">
      <div className="pref-row" role="status" aria-label="Schedule right now">
        <span>
          Right now:{" "}
          <b>{state.rule ? (state.paused ? "downloads are paused" : `limited to ${state.limit}/s`) : "no rule applies"}</b>
        </span>
      </div>
      {rules.map((rule, i) => {
        const problem = validateRule(rule);
        return (
          <div key={rule.id} className="pref-row" style={{ display: "block" }} role="group" aria-label={`Rule ${i + 1}`}>
            <div className="flex items-center gap-1 flex-wrap">
              {DAY_NAMES.map((name, day) => (
                <label key={name} className="flex items-center gap-1 mr-1">
                  <input type="checkbox" checked={rule.days.includes(day)} onChange={() => toggleDay(rule, day)} aria-label={`${name} (rule ${i + 1})`} />
                  {name}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              <label className="flex items-center gap-1.5">
                From
                <input type="time" value={rule.from} onChange={(e) => update(rule.id, { from: e.target.value })} className="field" aria-label={`From (rule ${i + 1})`} />
              </label>
              <label className="flex items-center gap-1.5">
                to
                <input type="time" value={rule.to} onChange={(e) => update(rule.id, { to: e.target.value })} className="field" aria-label={`To (rule ${i + 1})`} />
              </label>
              <select value={rule.action} onChange={(e) => update(rule.id, { action: e.target.value as ScheduleRule["action"] })} className="field" aria-label={`Action (rule ${i + 1})`}>
                <option value="limit">Limit speed to</option>
                <option value="pause">Don't download</option>
              </select>
              {rule.action === "limit" && (
                <input
                  value={rule.limit}
                  onChange={(e) => update(rule.id, { limit: e.target.value })}
                  placeholder="500K"
                  spellCheck={false}
                  className="field mono"
                  style={{ width: 80 }}
                  aria-label={`Speed limit (rule ${i + 1})`}
                />
              )}
              <button className="row-btn" title="Delete this rule" aria-label={`Delete rule ${i + 1}`} onClick={() => onChange(rules.filter((r) => r.id !== rule.id))}>
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            <p className="pref-hint mt-1 mb-0" style={problem ? { color: "#b3261e" } : undefined} role={problem ? "alert" : undefined}>
              {problem ?? describeRule(rule)}
            </p>
          </div>
        );
      })}
      <div className="pref-row">
        <button className="btn small" onClick={() => onChange([...rules, blankRule()])}>
          <Plus className="w-3 h-3" /> Add a rule
        </button>
        <span className="pref-hint">Equal start and end times mean all day. The first matching rule wins.</span>
      </div>
    </div>
  );
}
