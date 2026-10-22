import { open, check, calls, waitCalls, nav, done } from "../harness.mjs";

const URL = "https://example.com/feed.xml";
const episode = (id) => ({ id, title: `Episode ${id}`, url: `https://cdn.example.com/${id}.mp3`, published: "Fri, 02 Jan 2026 10:00:00 +0000", duration: 754, size: 1234 });
const feed = { title: "Our Show", image: "https://cdn.example.com/cover.jpg", episodes: [episode("2"), episode("1")] };
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__store")).podcasts ?? []);
const region = (page) => page.getByRole("region", { name: "Podcasts", exact: true });
const checkFeeds = async (page) => {
  await page.waitForFunction(() => !document.querySelector(".podcast-add button[type=button]")?.disabled);
  await region(page).getByRole("button", { name: "Check feeds" }).click();
  await page.waitForFunction(() => !document.querySelector(".podcast-add button[type=button]")?.disabled);
};

let page = await open({ store: { warnDuplicates: false, proxy: "http://proxy.example.com:8080", mode: "advanced", siteRules: [{ id: "r", host: "cdn.example.com", channel: "", preset: "audio", audioFormat: "flac", folder: "/elsewhere" }] }, mock: { feeds: { [URL]: feed }, dlDelay: 800 } });
await nav(page, "Podcasts").click();
check("podcasts: explains website contact and recurring checks", (await region(page).innerText()).includes("Subscribing contacts that website") && (await region(page).innerText()).includes("six hours"));
await region(page).getByLabel("RSS feed address").fill(URL);
await region(page).getByRole("button", { name: "Subscribe", exact: true }).click();
await region(page).getByRole("heading", { name: "Our Show" }).waitFor();
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).podcasts?.length === 1);
check("subscribe: episodes are listed with duration", await region(page).getByRole("listitem").count() === 2 && (await region(page).innerText()).includes("12:34"));
check("subscribe: existing episodes are seen and nothing auto-downloads", (await saved(page))[0].seen.length === 2 && (await calls(page, "start_download")).length === 0);
check("subscribe: auto-download starts off", !(await region(page).getByLabel("Download new episodes automatically").isChecked()));
check("subscribe: feed request uses current proxy", (await calls(page, "podcast_fetch")).at(-1).args.proxy === "http://proxy.example.com:8080");

await region(page).getByRole("button", { name: "Download Episode 2", exact: true }).click();
await waitCalls(page, "start_download", 1);
const req = (await calls(page, "start_download"))[0].args.req;
check("download: keeps the original audio and the podcast folder despite site rules", req.preset === "best" && req.out_dir === "/home/u/Downloads/Podcasts/Our Show" && req.extra.audio === null && req.extra.format_id === null, JSON.stringify(req));
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).queue?.length > 0);
const queued = await page.evaluate(() => JSON.parse(localStorage.getItem("__store")).queue[0]);
check("download: carries episode title and artwork into the queue", queued.title === "Episode 2" && queued.thumbnail === feed.image);

await region(page).getByLabel("RSS feed address").fill(URL);
await region(page).getByRole("button", { name: "Subscribe", exact: true }).click();
check("subscribe: duplicate subscriptions are not added", (await saved(page)).length === 1);
await region(page).getByLabel("Download new episodes automatically").check();
await page.evaluate(([url, ep]) => window.__mock.feeds[url].episodes.unshift(ep), [URL, episode("3")]);
await checkFeeds(page);
await waitCalls(page, "start_download", 2);
check("auto: only the new episode downloads", (await calls(page, "start_download")).length === 2 && (await calls(page, "start_download"))[1].args.req.url.endsWith("/3.mp3"));
await checkFeeds(page);
check("auto: checking again does not repeat an episode", (await calls(page, "start_download")).length === 2);
check("auto: preference and new episode ids persist", (await saved(page))[0].auto && (await saved(page))[0].seen.includes("3"));

// Turning automation off keeps new episodes visible without adding downloads.
await region(page).getByLabel("Download new episodes automatically").uncheck();
await page.evaluate(([url, ep]) => window.__mock.feeds[url].episodes.unshift(ep), [URL, episode("4")]);
await checkFeeds(page);
check("manual: new episode has a badge without downloading", (await region(page).locator(".podcast-new").count()) === 1 && (await calls(page, "start_download")).length === 2);
if (process.env.KAISU_E2E_SCREENSHOT) await page.screenshot({ path: process.env.KAISU_E2E_SCREENSHOT, fullPage: true });
await page.evaluate(() => window.__mock.feedFail = true);
await checkFeeds(page);
check("failure: shows the feed error and preserves subscriptions", (await region(page).getByRole("alert").innerText()).includes("podcast feed") && (await saved(page)).length === 1);
await page.evaluate(() => window.__mock.feedFail = false);
await checkFeeds(page);
check("failure: next successful check clears the error", await region(page).getByRole("alert").count() === 0);

await page.reload();
await nav(page, "Podcasts").click();
await region(page).getByRole("heading", { name: "Our Show" }).waitFor();
await region(page).getByRole("list", { name: "Episodes" }).waitFor();
check("restart: subscription and seen ids return without repeating downloads", (await saved(page))[0].seen.includes("3"));
await region(page).getByRole("button", { name: "Unsubscribe", exact: true }).click();
await region(page).getByRole("heading", { name: "No podcasts yet" }).waitFor();
check("unsubscribe: saved subscription is removed", (await saved(page)).length === 0);
check("unsubscribe: downloaded files are kept", (await calls(page, "delete_files")).length === 0);
await region(page).getByLabel("RSS feed address").fill("https://example.com/bad.xml");
await region(page).getByRole("button", { name: "Subscribe", exact: true }).click();
await page.getByText("That isn't a podcast feed.", { exact: true }).waitFor();
check("bad feed: shows an error without saving it", (await saved(page)).length === 0);
await page.context().close();

// Background checks run on startup and every six hours, without needing the Podcasts page open.
page = await open({ clock: true, mock: { feeds: { [URL]: feed } } });
await nav(page, "Podcasts").click();
await region(page).getByLabel("RSS feed address").fill(URL);
await region(page).getByRole("button", { name: "Subscribe", exact: true }).click();
await region(page).getByRole("heading", { name: "Our Show" }).waitFor();
await region(page).getByLabel("Download new episodes automatically").check();
await page.evaluate(([url, ep]) => window.__mock.feeds[url].episodes.unshift(ep), [URL, episode("5")]);
await nav(page, "Search").click();
await page.clock.fastForward(6 * 60 * 60 * 1000);
await waitCalls(page, "start_download", 1);
check("background: six-hour check downloads a new episode away from the page", (await calls(page, "start_download"))[0].args.req.url.endsWith("/5.mp3"));
await page.context().close();

// A saved automatic subscription checks on startup, and a refused submission stays eligible for a later check.
page = await open({ mock: { feeds: { [URL]: { ...feed, episodes: [episode("6"), ...feed.episodes] } }, folderProblem: "Folder is unavailable" } });
await page.evaluate((url) => {
  const store = JSON.parse(localStorage.getItem("__store"));
  store.podcasts = [{ id: "startup", url, title: "Our Show", auto: true, seen: ["1", "2"], checked: 0 }];
  localStorage.setItem("__store", JSON.stringify(store));
}, URL);
await page.reload();
await nav(page, "Podcasts").click();
await region(page).getByRole("list", { name: "Episodes" }).waitFor();
await page.waitForFunction(() => !document.querySelector(".podcast-add button[type=button]")?.disabled);
check("startup: saved subscriptions are checked automatically", (await calls(page, "podcast_fetch")).length === 1);
check("auto: a refused download is not marked seen", !(await saved(page))[0].seen.includes("6") && (await calls(page, "start_download")).length === 0);
await page.evaluate(() => { window.__mock.folderProblem = null; window.__mock.badFolders = ["/home/u/Downloads/Podcasts/Our Show"]; });
await checkFeeds(page);
check("auto: an unavailable show folder does not fall back to the main folder", !(await saved(page))[0].seen.includes("6") && (await calls(page, "start_download")).length === 0);
await page.evaluate(() => window.__mock.badFolders = []);
await checkFeeds(page);
await waitCalls(page, "start_download", 1);
check("auto: a later successful submission is remembered", (await saved(page))[0].seen.includes("6"));

// Removing a show during an in-flight request must not recreate it when that request finishes.
await page.evaluate(() => window.__mock.feedDelay = 250);
await region(page).getByRole("button", { name: "Check feeds" }).click();
check("checking: another check is disabled while the first runs", await region(page).getByRole("button", { name: "Check feeds" }).isDisabled());
await region(page).getByRole("button", { name: "Unsubscribe", exact: true }).click();
await page.waitForTimeout(350);
check("unsubscribe: an in-flight response cannot bring the show back", (await saved(page)).length === 0 && await region(page).getByRole("heading", { name: "No podcasts yet" }).count() === 1);
await page.keyboard.press("Control+1");
await page.keyboard.press("Control+6");
check("navigation: Ctrl+6 opens Podcasts", await region(page).count() === 1);
await page.context().close();

// A removed show waiting behind another request is not contacted at all.
const OTHER = "https://example.com/other.xml";
page = await open({ mock: { feeds: { [URL]: feed, [OTHER]: { ...feed, title: "Other Show" } }, feedDelay: 1000 } });
await page.evaluate(([first, second]) => {
  const store = JSON.parse(localStorage.getItem("__store"));
  store.podcasts = [
    { id: "first", url: first, title: "Our Show", auto: false, seen: ["1", "2"], checked: 0 },
    { id: "second", url: second, title: "Other Show", auto: false, seen: ["1", "2"], checked: 0 },
  ];
  localStorage.setItem("__store", JSON.stringify(store));
}, [URL, OTHER]);
await page.reload();
await nav(page, "Podcasts").click();
await page.getByRole("navigation", { name: "Podcast subscriptions" }).getByRole("button", { name: "Other Show", exact: true }).click();
await region(page).getByRole("button", { name: "Unsubscribe", exact: true }).click();
await page.waitForFunction(() => !document.querySelector(".podcast-add button[type=button]")?.disabled);
check("unsubscribe: a queued feed check is skipped", (await calls(page, "podcast_fetch")).every((c) => c.args.url !== OTHER) && (await saved(page)).length === 1);
await page.context().close();

await done();
