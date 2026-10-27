// Retrying failed downloads by playlist.
import { open, check, calls, nav, waitCalls, results, done } from "../harness.mjs";
const failed = (id, playlist) => ({ id, url: `https://vimeo.com/${id}`, title: `Video ${id}`, thumbnail: "", preset: "audio", outDir: "/media/Music", extra: { audio_format: "mp3", ...(playlist ? { playlist: { title: playlist, index: 1, total: 9 } } : {}) }, status: "error", progress: 0 });
const page = await open({ queue: [failed("a1", "Road mix"), failed("a2", "Road mix"), failed("a3", "Road mix"), failed("s1", null)] });
await nav(page, "Downloads").click();
const panel = page.getByRole("region", { name: "Failed downloads", exact: true });
await panel.waitFor();
check("failed: the total is stated", (await panel.getByRole("status").innerText()).includes("4 downloads failed"));
check("failed: playlists are listed with their own counts", (await panel.innerText()).includes("Road mix · 3 failed") && (await panel.innerText()).includes("Single downloads · 1 failed"));
check("failed: nothing is retried until asked", (await calls(page, "start_download")).length === 0);
await panel.getByRole("button", { name: "Try 3 from Road mix again", exact: true }).click();
await waitCalls(page, "start_download", 3);
await page.waitForTimeout(300);
const started = (await calls(page, "start_download")).map((c) => c.args.req.url).sort();
check("failed: only that playlist's items are retried", started.length === 3 && started.every((u) => /a[123]$/.test(u)));
check("failed: the retried group leaves the panel", !(await panel.innerText()).includes("Road mix") && (await panel.innerText()).includes("1 download failed"));
await panel.getByRole("button", { name: "Remove 1 failed from Single downloads", exact: true }).click();
await page.waitForTimeout(100);
check("failed: removing clears the panel and keeps the others", await panel.count() === 0 && (await calls(page, "start_download")).length === 3);
await page.context().close();

// ---- links from a text or CSV file ----
const csv = ['title,url', 'One,"https://www.youtube.com/watch?v=aaaaaaaaaaa"', 'Two,https://vimeo.com/22', 'Repeat,https://vimeo.com/22'].join(String.fromCharCode(10));
let files = await open({ mock: { linkFile: { name: "watch-later.csv", text: csv } } });
await files.getByRole("button", { name: "Import links from a file", exact: true }).click();
await results(files).waitFor();
check("file: the links are listed together for review", (await results(files).innerText()).includes("2 links"));
check("file: the name, count and repeats are reported", (await files.getByText(/Found 2 links in watch-later\.csv \(1 repeated\)/).count()) > 0);
check("file: nothing is downloaded by importing", (await calls(files, "start_download")).length === 0);
await files.context().close();

files = await open({ mock: { linkFile: { name: "notes.txt", text: "no links here" } } });
await files.getByRole("button", { name: "Import links from a file", exact: true }).click();
await files.getByText("No web links were found in notes.txt.", { exact: true }).waitFor();
check("file: a file without links says so", true);
await files.context().close();

files = await open({ mock: { linkFileError: "That file is larger than 2 MB. Split it into smaller lists." } });
await files.getByRole("button", { name: "Import links from a file", exact: true }).click();
await files.getByText(/larger than 2 MB/).waitFor();
check("file: a refused file shows the reason", true);
await files.context().close();

files = await open({ mock: {} });
await files.getByRole("button", { name: "Import links from a file", exact: true }).click();
await files.waitForTimeout(200);
check("file: cancelling the chooser does nothing", (await calls(files, "pick_link_file")).length === 1 && await results(files).count() === 0);
await files.context().close();
await done();
