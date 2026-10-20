import { useEffect, useMemo, useState } from "react";
import { evaluate, type ScheduleRule, type ScheduleState } from "../lib/schedule";

const CHECK_EVERY_MS = 15_000;

/** The bandwidth schedule as it applies right now. Re-checked every few seconds so rules start and end on time. */
export function useSchedule(rules: ScheduleRule[], enabled: boolean): ScheduleState {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled || rules.length === 0) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [enabled, rules]);
  const state = useMemo(() => (enabled ? evaluate(rules, now) : { rule: null, paused: false, limit: null }), [enabled, rules, now]);
  // Keep the same object while nothing changed, so consumers don't see a "change".
  const key = `${state.rule?.id ?? ""}|${state.paused}|${state.limit ?? ""}`;
  return useMemo(() => state, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
