import { open, check, calls, waitCalls, box, nav, results, details, submit, done } from "../harness.mjs";

const PL = "https://www.youtube.com/playlist?list=PLabc123";

// ================= playlists =================
let page = await open();
await submit(page, PL);
await page.waitForSelector("text=Playlist video 1");
check("playlist: link is classified first", (await calls(page, "classify_link")).at(-1).args.url === PL);
check("playlist: listing requested with a page of 200", (await calls(page, "get_playlist")).at(-1).args.limit === 200);
check("playlist: title and count in the heading", await results(page).locator("h3", { hasText: "Road Trip: Mix / 2026 · 7 videos" }).count() === 1);
check("playlist: all 7 videos listed", await results(page).locator("tbody tr").count() === 7);
check("playlist: no video inspected", (await calls(page, "get_media_info")).length === 0);
check("playlist: Download all button", await results(page).getByRole("button", { name: "Download all 7 videos" }).count() === 1);
check("playlist: sidebar/status bar count", await page.locator("footer").locator("text=7 results").count() === 1);

await results(page).getByRole("button", { name: "Download all 7 videos" }).click();
await waitCalls(page, "start_download", 7, 30000);
const all = (await calls(page, "start_download")).map((c) => c.args.req);
check("playlist: 7 downloads queued", all.length === 7);
check("playlist: each carries the playlist folder + position", all.every((r) => r.extra.playlist && r.extra.playlist.title === "Road Trip: Mix / 2026" && r.extra.playlist.total === 7));
check("playlist: positions are 1..7 in order", JSON.stringify(all.map((r) => r.extra.playlist.index).sort((a, b) => a - b)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7]));
check("playlist: right videos", all.some((r) => r.url.endsWith("pl000000003") && r.extra.playlist.index === 4));
check("playlist: default output prefs sent", all[0].extra.output.playlist_folder === true && all[0].extra.output.playlist_numbering === true && all[0].extra.output.layout === "flat");

// a ticked subset keeps its original positions; audio too
page = await open();
await submit(page, PL);
await page.waitForSelector("text=Playlist video 1");
await results(page).getByLabel(/^Select Playlist video 3$/).check();
await results(page).getByLabel(/^Select Playlist video 6$/).check();
await page.getByRole("region", { name: "Selected videos" }).getByRole("button", { name: /Download 2 audio/ }).click();
await waitCalls(page, "start_download", 2);
const subset = (await calls(page, "start_download")).map((c) => c.args.req);
check("playlist subset: audio preset", subset.every((r) => r.preset === "audio"));
check("playlist subset: original positions 3 and 6", JSON.stringify(subset.map((r) => r.extra.playlist.index).sort()) === JSON.stringify([3, 6]));

// channel: no playlist folder context, listing kind differs
page = await open();
await submit(page, "https://www.youtube.com/@blender");
await page.waitForSelector("text=Playlist video 1");
check("channel: listed with its name", await results(page).locator("h3", { hasText: "Blender Channel" }).count() === 1);
await results(page).getByRole("button", { name: "Download all 7 videos" }).click();
await waitCalls(page, "start_download", 1);
check("channel: items have no playlist context", (await calls(page, "start_download")).every((c) => c.args.req.extra.playlist === null));

// limit note + load more
page = await open({ mock: { playlistTotal: 1200 } });
await submit(page, PL);
await page.waitForSelector("text=Playlist video 1");
check("playlist: limit note when the list is longer than what was loaded", await results(page).locator("text=Showing the first 200 of 1200 videos.").count() === 1);
await results(page).getByRole("button", { name: "Show more results" }).click();
await page.waitForFunction(() => window.__mock.calls.filter((c) => c.cmd === "get_playlist").length >= 2);
check("playlist: show more asks for 400", (await calls(page, "get_playlist")).at(-1).args.limit === 400);

// single video that belongs to a playlist
page = await open();
await submit(page, "https://www.youtube.com/watch?v=abcdefghijk&list=PLabc123");
await details(page).waitFor();
check("video in a playlist: note offered", await page.locator("text=This video is part of a playlist.").count() === 1);
await page.getByRole("button", { name: "View playlist" }).click();
await page.waitForSelector("text=Playlist video 1");
check("video in a playlist: View playlist lists it", (await calls(page, "get_playlist")).at(-1).args.url.includes("playlist?list=PLabc123"));
page = await open();
await submit(page, "https://www.youtube.com/watch?v=abcdefghijk&list=RDabc");
await details(page).waitFor();
check("auto-generated mixes are not offered as playlists", await page.locator("text=This video is part of a playlist.").count() === 0);

// ================= several links at once =================
page = await open({ mock: { metaTitle: "The Real Title" } });
await submit(page, "https://www.youtube.com/watch?v=aaaaaaaaaaa https://youtu.be/bbbbbbbbbbb");
await page.waitForSelector("text=2 links");
check("links: listed with a heading, no lookup", await results(page).locator("tbody tr").count() === 2 && (await calls(page, "get_media_info")).length === 0);
check("links: all pre-selected", await page.getByRole("region", { name: "Selected videos" }).locator("text=2 selected").count() === 1);
await page.getByRole("region", { name: "Selected videos" }).getByRole("button", { name: "Download 2 videos" }).click();
await waitCalls(page, "start_download", 2);
await nav(page, "Downloads").click();
await page.waitForSelector("text=The Real Title");
check("links: placeholder titles are replaced by the real one from yt-dlp", await page.locator("td", { hasText: "The Real Title" }).count() === 2);
check("links: no 'links' playlist context", (await calls(page, "start_download")).every((c) => c.args.req.extra.playlist === null));

// ================= pause / resume / persistence =================
page = await open({ mock: { dlDelay: 500 } });
await submit(page, "https://www.youtube.com/watch?v=pasted00001");
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
await nav(page, "Downloads").click();
await page.getByRole("button", { name: "Pause download" }).first().click();
await page.getByText(/Paused/).filter({ visible: true }).first().waitFor();
check("pause: asks the backend to stop the process", (await calls(page, "cancel_download")).length === 1);
check("pause: row shows Paused with a Resume button", await page.getByRole("button", { name: "Resume download" }).count() === 1);
check("pause: sidebar badge is not 'active'", await nav(page, "Downloads").locator(".count.hot").count() === 0);
await page.getByLabel("Status display").locator("text=Downloads paused").waitFor({ timeout: 8000 });   // after the "Added" note has had its moment
check("pause: display says paused", true);
check("pause: not marked as cancelled/failed", await page.getByText("Cancelled", { exact: true }).filter({ visible: true }).count() === 0);
await page.getByRole("button", { name: "Resume download" }).click();
await waitCalls(page, "start_download", 2);
check("resume: the same download starts again", (await calls(page, "start_download"))[0].args.req.id === (await calls(page, "start_download"))[1].args.req.id);
await page.waitForSelector("text=Done", { timeout: 20000 });
check("resume: it finishes", true);

// pause all / resume all, from the status bar and from the tray menu
page = await open({ mock: { dlDelay: 600 } });
await submit(page, "lofi beats");
await page.waitForSelector("text=lofi beats — result 1");
for (const n of [1, 2, 3]) await results(page).getByLabel(new RegExp(`^Select lofi beats — result ${n}$`)).check();
await page.getByRole("region", { name: "Selected videos" }).getByRole("button", { name: "Download 3 videos" }).click();
await waitCalls(page, "start_download", 2);
await nav(page, "Downloads").click();
await page.getByRole("button", { name: "Pause all" }).click();
await page.waitForFunction(() => document.querySelectorAll("[aria-label='Resume download']").length === 3, null, { timeout: 8000 });
check("pause all: all three paused (running and waiting)", true);
check("pause all: button becomes Resume all", await page.getByRole("button", { name: "Resume all" }).count() === 1);
await page.getByRole("button", { name: "Resume all" }).click();
await page.waitForFunction(() => document.querySelectorAll("[aria-label='Pause download']").length >= 2, null, { timeout: 8000 });
check("resume all: downloading again", true);
await page.evaluate(() => window.__events["tray-action"]({ payload: "pause_all" }));
await page.waitForFunction(() => document.querySelectorAll("[aria-label='Resume download']").length === 3, null, { timeout: 8000 });
check("tray menu: Pause all works", true);
await page.evaluate(() => window.__events["tray-action"]({ payload: "resume_all" }));
await page.waitForFunction(() => document.querySelectorAll("[aria-label='Pause download']").length >= 2, null, { timeout: 8000 });
check("tray menu: Resume all works", true);

// survive a restart
page = await open({ mock: { dlDelay: 700 } });
await submit(page, "https://www.youtube.com/watch?v=restart0001");
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "start_download", 1);
await page.waitForTimeout(1600);               // the queue is saved at most once a second
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("__store")).queue);
check("persistence: unfinished download was saved", saved.length === 1 && saved[0].url.endsWith("restart0001") && saved[0].status !== "completed");
await page.reload();
await page.waitForSelector("text=unfinished when Kaisu last closed");
check("persistence: banner offers to resume", await page.getByRole("button", { name: "Resume" }).count() === 1);
check("persistence: nothing started by surprise", (await calls(page, "start_download")).length === 0);
await nav(page, "Downloads").click();
check("persistence: restored as paused", await page.locator("tr", { hasText: "Paused" }).count() === 1);
await page.getByRole("button", { name: "Resume", exact: true }).click();   // the banner is visible on every page
await waitCalls(page, "start_download", 1);
check("persistence: Resume restarts it", (await calls(page, "start_download")).at(-1).args.req.url.endsWith("restart0001"));
await page.waitForSelector("text=unfinished when Kaisu last closed", { state: "detached" });

// discard
page = await open({ mock: { dlDelay: 700 } });
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("__store")); s.queue = [{ id: "q1", title: "Old one", url: "https://www.youtube.com/watch?v=old00000001", thumbnail: "", preset: "best", outDir: "/home/u/Downloads", extra: {}, status: "downloading", progress: 40 }]; localStorage.setItem("__store", JSON.stringify(s)); });
await page.reload();
await page.waitForSelector("text=unfinished when Kaisu last closed");
await page.getByRole("button", { name: "Remove them" }).click();
await nav(page, "Downloads").click();
check("persistence: Remove them empties the queue", await page.locator("text=No downloads").count() === 1);

await done();
