// Shared helpers for the UI suites. They run against the real React app, with the Tauri bindings replaced by the
// scripted stand-ins in ./mock (see vite.config.mjs), driven by a real Chrome through Playwright.
import { chromium } from "playwright-core";

/** Where the runner serves the app. */
export const BASE_URL = process.env.KAISU_E2E_URL ?? "http://localhost:1520/";
/** Chrome is used as installed (`channel: "chrome"`), so nothing needs downloading. KAISU_E2E_BROWSER overrides it. */
export const browser = await chromium.launch(
  process.env.KAISU_E2E_BROWSER
    ? { executablePath: process.env.KAISU_E2E_BROWSER, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] }
    : { channel: "chrome", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] },
);
export const errors = [];
export const tally = { passed: 0, failed: 0 };
export const check = (name, ok, extra = "") => { ok ? tally.passed++ : tally.failed++; if (!ok) console.log("FAIL", name, extra); };
export const now = Date.now();

export async function open({ mock = {}, store = {}, history = [], queue = [], ready = true, focus = true, clock = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1060, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(([r, mk, st, h, q, f]) => {
    window.__mock = { ready: r, calls: [], dlDelay: 80, missing: [], setupDelay: 50, notifications: [], ...mk };
    if (!f) document.hasFocus = () => false;
    if (!localStorage.getItem("__store")) localStorage.setItem("__store", JSON.stringify({ settings: { mode: "simple", tourSeen: true, ...st }, history: h, queue: q }));
  }, [ready, mock, store, history, queue, focus]);
  if (clock) await page.clock.install();
  await page.goto(BASE_URL);
  await page.waitForSelector("input[type=text]");
  return page;
}
export const calls = (page, cmd) => page.evaluate((c) => window.__mock.calls.filter((x) => x.cmd === c), cmd);
export const waitCalls = (page, cmd, n, t = 30000) => page.waitForFunction(([c, k]) => window.__mock.calls.filter((x) => x.cmd === c).length >= k, [cmd, n], { timeout: t });
export const box = (page) => page.getByLabel("Search YouTube or paste a link");
export const nav = (page, name) => page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: new RegExp(`^${name}`) });
export const results = (page) => page.locator("section[aria-label='Search results']");
export const details = (page) => page.locator("section[aria-label='Video details']");
export const submit = async (page, text) => { await box(page).fill(text); await box(page).press("Enter"); };
export const done = async () => {
  console.log("page errors:", errors);
  console.log(`${tally.passed} passed, ${tally.failed} failed`);
  process.exitCode = tally.failed > 0 || errors.length > 0 ? 1 : 0;
  await browser.close();
};
