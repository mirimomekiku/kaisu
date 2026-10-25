import { describe, expect, it } from "vitest";
import { updateCheckDue } from "./useAppUpdate";

const HOUR = 3_600_000;
describe("update check schedule", () => {
  it("checks when switched on and never checked", () => expect(updateCheckDue({ appUpdateChecks: true, appUpdateLastCheck: 0 }, 1_000_000_000)).toBe(true));
  it("waits a day between checks", () => {
    const now = 10 * 24 * HOUR;
    expect(updateCheckDue({ appUpdateChecks: true, appUpdateLastCheck: now - 23 * HOUR }, now)).toBe(false);
    expect(updateCheckDue({ appUpdateChecks: true, appUpdateLastCheck: now - 25 * HOUR }, now)).toBe(true);
  });
  it("checks again when the clock moved backwards", () => expect(updateCheckDue({ appUpdateChecks: true, appUpdateLastCheck: 5e12 }, 1e12)).toBe(true));
  it("never checks when switched off", () => expect(updateCheckDue({ appUpdateChecks: false, appUpdateLastCheck: 0 }, 1e12)).toBe(false));
});
