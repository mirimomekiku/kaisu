// Retrying failed downloads by playlist.
import { open, check, calls, nav, waitCalls, done } from "../harness.mjs";
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

await done();
