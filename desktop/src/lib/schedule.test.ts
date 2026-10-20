import { describe, expect, it } from "vitest";
import { blankRule, describeRule, evaluate, minutesOf, nextChange, ruleMatches, validateRule, type ScheduleRule } from "./schedule";

const rule = (over: Partial<ScheduleRule> = {}): ScheduleRule => ({ id: "r", days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00", action: "limit", limit: "500K", ...over });
/** A local time: day 0 = Sunday. 2026-10-18 is a Sunday. */
const at = (day: number, hh: number, mm = 0) => new Date(2026, 9, 18 + day, hh, mm, 0, 0);

describe("minutesOf", () => {
  it("reads HH:MM", () => {
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("9:05")).toBe(545);
    expect(minutesOf("23:59")).toBe(1439);
  });
  it("rejects nonsense", () => {
    for (const bad of ["", "24:00", "12:60", "noon", "9", "09:5", "-1:00"]) expect(minutesOf(bad), bad).toBeNull();
  });
});

describe("ruleMatches", () => {
  it("covers its days and hours, end exclusive", () => {
    const r = rule();
    expect(ruleMatches(r, at(1, 9, 0))).toBe(true);
    expect(ruleMatches(r, at(1, 16, 59))).toBe(true);
    expect(ruleMatches(r, at(1, 17, 0))).toBe(false);
    expect(ruleMatches(r, at(1, 8, 59))).toBe(false);
    expect(ruleMatches(r, at(0, 12))).toBe(false); // Sunday
    expect(ruleMatches(r, at(6, 12))).toBe(false); // Saturday
  });

  it("handles windows that cross midnight", () => {
    const night = rule({ days: [5], from: "22:00", to: "06:00" }); // Friday night
    expect(ruleMatches(night, at(5, 21, 59))).toBe(false);
    expect(ruleMatches(night, at(5, 22, 0))).toBe(true);
    expect(ruleMatches(night, at(5, 23, 59))).toBe(true);
    expect(ruleMatches(night, at(6, 0, 0))).toBe(true); // the early hours of Saturday belong to Friday's rule
    expect(ruleMatches(night, at(6, 5, 59))).toBe(true);
    expect(ruleMatches(night, at(6, 6, 0))).toBe(false);
    expect(ruleMatches(night, at(6, 22, 30))).toBe(false); // Saturday evening is not covered
    expect(ruleMatches(night, at(5, 3, 0))).toBe(false); // Friday's small hours belong to Thursday's rule
  });

  it("treats equal start and end as the whole day", () => {
    const all = rule({ days: [0], from: "00:00", to: "00:00" });
    expect(ruleMatches(all, at(0, 0, 0))).toBe(true);
    expect(ruleMatches(all, at(0, 23, 59))).toBe(true);
    expect(ruleMatches(all, at(1, 12))).toBe(false);
  });

  it("never matches a rule with unreadable times", () => {
    expect(ruleMatches(rule({ from: "oops" }), at(1, 10))).toBe(false);
  });
});

describe("evaluate", () => {
  const rules = [rule({ id: "work", action: "limit", limit: "300K" }), rule({ id: "all", days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "00:00", action: "limit", limit: "2M" })];

  it("the first matching rule wins", () => {
    expect(evaluate(rules, at(1, 10))).toMatchObject({ limit: "300K", paused: false });
    expect(evaluate(rules, at(1, 20))).toMatchObject({ limit: "2M" });
  });
  it("pause rules block downloads and carry no limit", () => {
    const s = evaluate([rule({ action: "pause" })], at(2, 12));
    expect(s.paused).toBe(true);
    expect(s.limit).toBeNull();
  });
  it("is quiet when nothing matches", () => {
    expect(evaluate([rule()], at(0, 12))).toEqual({ rule: null, paused: false, limit: null });
    expect(evaluate([], at(1, 12))).toEqual({ rule: null, paused: false, limit: null });
  });
});

describe("nextChange", () => {
  it("finds when a window starts and ends", () => {
    const r = [rule({ action: "pause" })];
    expect(nextChange(r, at(1, 8, 30))).toEqual(at(1, 9, 0));
    expect(nextChange(r, at(1, 12, 15))).toEqual(at(1, 17, 0));
  });
  it("looks past a weekend", () => {
    expect(nextChange([rule({ action: "pause" })], at(5, 18))).toEqual(at(8, 9, 0)); // Friday evening -> Monday 09:00
  });
  it("is null when nothing ever changes", () => {
    expect(nextChange([], at(1, 12))).toBeNull();
    expect(nextChange([rule({ days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "00:00", action: "pause" })], at(1, 12))).toBeNull();
  });
  it("seconds don't matter", () => {
    const t = new Date(2026, 9, 19, 8, 59, 45);
    expect(nextChange([rule({ action: "pause" })], t)).toEqual(at(1, 9, 0));
  });
});

describe("validateRule", () => {
  it("accepts a good rule", () => {
    expect(validateRule(rule())).toBeNull();
    expect(validateRule(rule({ action: "pause", limit: "" }))).toBeNull();
  });
  it("explains what is wrong", () => {
    expect(validateRule(rule({ days: [] }))).toMatch(/day/);
    expect(validateRule(rule({ from: "" }))).toMatch(/times/);
    expect(validateRule(rule({ limit: "fast" }))).toMatch(/500K or 2M/);
    expect(validateRule(rule({ limit: "5MB" }))).not.toBeNull();
    expect(validateRule(rule({ limit: "1.5M" }))).toBeNull();
  });
});

describe("describeRule", () => {
  it("reads naturally", () => {
    expect(describeRule(rule())).toBe("Mon-Fri 09:00-17:00: limit to 500K");
    expect(describeRule(rule({ days: [0, 6], action: "pause" }))).toBe("Sun, Sat 09:00-17:00: no downloads");
    expect(describeRule(rule({ days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "00:00", limit: "1M" }))).toBe("Every day all day: limit to 1M");
  });
  it("a fresh rule is valid", () => {
    expect(validateRule(blankRule())).toBeNull();
  });
});
