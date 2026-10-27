// kaisu:// links from the browser: only offered for review, and registering is an explicit Settings choice.
import { open, check, calls, nav, box, results, done } from "../harness.mjs";
const section = (p, name) => p.getByLabel("Settings section", { exact: true }).selectOption(name);

// ---- links waiting at start-up are listed, never downloaded ----
let page = await open({ mock: { incomingLinks: ["https://example.com/a", "https://example.com/b"] } });
await results(page).waitFor();
check("links: two waiting links are listed together", (await results(page).innerText()).includes("2 links"));
check("links: nothing is started by the link", (await calls(page, "start_download")).length === 0);
check("links: the waiting links are collected once", (await calls(page, "take_incoming_links")).length >= 1);
await page.context().close();

// ---- a link sent while the app runs ----
page = await open();
await page.evaluate(() => { window.__mock.incomingLinks = ["https://www.youtube.com/watch?v=abc12345678"]; window.__events["kaisu-links"]({ payload: null }); });
await page.waitForFunction(() => window.__mock.calls.some((c) => c.cmd === "get_media_info"));
check("links: a single link is looked up for review", (await box(page).inputValue()) === "https://www.youtube.com/watch?v=abc12345678");
check("links: looking up does not download", (await calls(page, "start_download")).length === 0);
await page.context().close();

// ---- the Settings choice ----
page = await open();
await nav(page, "Settings").click(); await section(page, "All settings");
const box2 = page.getByLabel(/Let the browser extension send links to Kaisu/);
check("settings: the browser link starts switched off", !(await box2.isChecked()));
await box2.check();
await page.waitForFunction(() => window.__mock.linkHandler === true);
check("settings: switching it on registers the link type", await box2.isChecked() && (await calls(page, "link_handler_set")).at(-1)?.args.enabled === true);
await box2.uncheck();
await page.waitForFunction(() => window.__mock.linkHandler === false);
check("settings: switching it off removes it", !(await box2.isChecked()));
await page.context().close();
await done();
