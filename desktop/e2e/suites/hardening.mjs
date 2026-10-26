// Production frontend handling of secrets returned by a native attempt.
import { open, check, calls, nav, waitCalls, details, submit, done } from "../harness.mjs";

const secret = "private-extractor-marker";
const customArgs = `--extractor-args 'youtube:po_token=web+${secret}' --embed-chapters`;
const start = async () => {
  const page = await open({ store: { mode: "advanced", viewQueue: "list", customArgs, warnDuplicates: false }, mock: { manualDownloads: true } });
  await submit(page, "https://www.youtube.com/watch?v=pasted00001");
  await details(page).getByRole("button", { name: "Download video", exact: true }).click();
  await waitCalls(page, "start_download", 1);
  await nav(page, "Downloads").click();
  const req = (await calls(page, "start_download"))[0].args.req;
  check("credentials: live request retains the extractor token", req.extra.custom_args.includes(secret));
  return { page, req };
};
const emit = (page, req, event) => page.evaluate(([id, e]) => {
  const control = window.__mock.downloadControls[id];
  control.send(e);
  if (["done", "error"].includes(e.kind)) control.resolve();
}, [req.id, event]);

let { page, req } = await start();
await emit(page, req, { kind: "log", line: `parsed token '${secret}'; --embed-chapters; format webm` });
await emit(page, req, { kind: "warning", message: `Extractor returned token ${secret}` });
await emit(page, req, { kind: "checked", ok: false, note: `verification ${secret}` });
await emit(page, req, { kind: "done", path: "/home/u/Downloads/private-test.mp4" });
await page.getByRole("button", { name: "Toggle log", exact: true }).click();
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).history?.length === 1);
const body = await page.locator("main").innerText();
check("credentials: log and warning payloads are hidden", !body.includes(secret) && body.includes("[REDACTED]"));
check("credentials: ordinary diagnostics survive", body.includes("--embed-chapters") && body.includes("webm"));
check("credentials: history and queue persist no extractor payload", await page.evaluate((marker) => !localStorage.getItem("__store").includes(marker), secret));
await page.context().close();

({ page, req } = await start());
await emit(page, req, { kind: "error", message: `Extractor failed with '${secret}'` });
await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
check("credentials: terminal error payload is hidden", !(await page.locator("main").innerText()).includes(secret));
await page.waitForTimeout(1200);
check("credentials: failed queue persists no extractor payload", await page.evaluate((marker) => !localStorage.getItem("__store").includes(marker), secret));
await page.context().close();
await done();
