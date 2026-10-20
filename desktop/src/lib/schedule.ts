/**
 * Bandwidth schedule: rules that limit the download speed, or pause downloads altogether, at certain times.
 *
 * A rule covers some days of the week between two clock times. Days are the day the window STARTS, so a rule for
 * Friday 22:00 to 06:00 also covers the early hours of Saturday. Equal start and end times mean "all day". The first
 * matching rule wins.
 */
export interface ScheduleRule {
  id: string;
  /** 0 = Sunday ... 6 = Saturday */
  days: number[];
  /** "HH:MM", 24-hour */
  from: string;
  to: string;
  action: "limit" | "pause";
  /** Speed limit for "limit" rules, like 500K or 2M. */
  limit: string;
}

export interface ScheduleState {
  rule: ScheduleRule | null;
  /** Downloads shouldn't run right now. */
  paused: boolean;
  /** The speed limit to apply right now, if a limit rule is active. */
  limit: string | null;
}

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const LIMIT_PATTERN = /^\d+(\.\d+)?[KkMm]?$/;

export function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export function ruleMatches(rule: ScheduleRule, at: Date): boolean {
  const from = minutesOf(rule.from);
  const to = minutesOf(rule.to);
  if (from === null || to === null) return false;
  const now = at.getHours() * 60 + at.getMinutes();
  const today = at.getDay();
  const yesterday = (today + 6) % 7;

  if (from === to) return rule.days.includes(today); // all day
  if (from < to) return rule.days.includes(today) && now >= from && now < to;
  // Overnight: the evening part belongs to today's rule, the morning part to yesterday's.
  return (rule.days.includes(today) && now >= from) || (rule.days.includes(yesterday) && now < to);
}

export function evaluate(rules: ScheduleRule[], at: Date): ScheduleState {
  const rule = rules.find((r) => ruleMatches(r, at)) ?? null;
  return {
    rule,
    paused: rule?.action === "pause",
    limit: rule?.action === "limit" && rule.limit.trim() ? rule.limit.trim() : null,
  };
}

const keyOf = (s: ScheduleState) => `${s.paused}|${s.limit ?? ""}`;

/** The next minute at which the schedule's effect changes, within a week. Null if it never does. */
export function nextChange(rules: ScheduleRule[], from: Date): Date | null {
  if (rules.length === 0) return null;
  const start = new Date(from);
  start.setSeconds(0, 0);
  const current = keyOf(evaluate(rules, start));
  for (let i = 1; i <= 7 * 24 * 60; i++) {
    const t = new Date(start.getTime() + i * 60_000);
    if (keyOf(evaluate(rules, t)) !== current) return t;
  }
  return null;
}

/** Why a rule can't be used, or null when it is fine. */
export function validateRule(rule: ScheduleRule): string | null {
  if (rule.days.length === 0) return "Pick at least one day.";
  if (minutesOf(rule.from) === null || minutesOf(rule.to) === null) return "Enter both times, like 09:00.";
  if (rule.action === "limit" && !LIMIT_PATTERN.test(rule.limit.trim())) return "Speed limit must look like 500K or 2M.";
  return null;
}

/** "Mon-Fri 09:00-17:00: limit to 500K" */
export function describeRule(rule: ScheduleRule): string {
  const days = [...rule.days].sort((a, b) => a - b);
  const consecutive = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const dayText = days.length === 7 ? "Every day" : consecutive ? `${DAY_NAMES[days[0]]}-${DAY_NAMES[days[days.length - 1]]}` : days.map((d) => DAY_NAMES[d]).join(", ");
  const time = rule.from === rule.to ? "all day" : `${rule.from}-${rule.to}`;
  return `${dayText} ${time}: ${rule.action === "pause" ? "no downloads" : `limit to ${rule.limit.trim() || "?"}`}`;
}

let counter = 0;
export const newRuleId = () => `rule-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const blankRule = (): ScheduleRule => ({ id: newRuleId(), days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00", action: "limit", limit: "500K" });
