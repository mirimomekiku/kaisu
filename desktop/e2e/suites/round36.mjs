// Lyrics in bulk: consent first, existing lyrics untouched, per-song outcomes, and a service outage stops the run.
import { open, check, calls, nav, done } from "../harness.mjs";
const song = (title) => ({ path: `/home/u/Music/${title}.mp3`, title, artist: "Band", album_artist: "", album: "Debut", genre: "", year: 2001, track: 1, disc: 1, duration: 180, bitrate: 192, sample_rate: 44100, bit_depth: null, channels: 2, format: "MP3", size: 1000, modified: 1, added: 1, has_cover: false, loudness: -18 });
const names = ["have", "found", "nothing", "broken"];
const base = { library: names.map(song), lyrics: { "/home/u/Music/have.mp3": { synced: null, plain: "Already here", source: "file" } }, lyricsFailFor: { "/home/u/Music/nothing.mp3": "No lyrics were found for Band - nothing.", "/home/u/Music/broken.mp3": "Couldn't save the lyrics: Access is denied" }, lyricsDelay: 5 };
async function openRun(mock) {
  const page = await open({ mock });
  await nav(page, "Library").click();
  await page.getByRole("checkbox", { name: "Select all shown songs", exact: true }).check();
  await page.getByRole("button", { name: "Selected actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Find lyrics for selected songs", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Find lyrics", exact: true });
  await dialog.waitFor();
  return { page, dialog };
}
let { page, dialog } = await openRun(base);
check("lyrics: lookup needs consent first", await dialog.getByRole("button", { name: /^Find lyrics for 4 songs/ }).isDisabled() && (await calls(page, "lyrics_find")).length === 0);
await dialog.getByRole("checkbox", { name: /^Allow sending/ }).check();
await dialog.getByRole("button", { name: /^Find lyrics for 4 songs/ }).click();
const results = dialog.getByRole("list", { name: "Lyrics results" });
await results.getByText("1 already had lyrics").waitFor({ timeout: 15000 });
await dialog.getByText("Problems (1)").waitFor({ timeout: 15000 });
const text = await results.innerText();
check("lyrics: a found song is saved as timed lyrics", text.includes("1 saved (1 timed, 0 plain)"));
check("lyrics: a song with no lyrics is counted, not treated as an error", text.includes("1 not found"));
check("lyrics: a save failure is reported for that song only", text.includes("1 could not be saved") && (await dialog.locator("details").textContent()).includes("broken — Couldn't save the lyrics"));
const asked = (await calls(page, "lyrics_find")).map((c) => c.args.path);
check("lyrics: songs that already have lyrics are never looked up again", !asked.includes("/home/u/Music/have.mp3") && asked.length === 3);
await page.context().close();

({ page, dialog } = await openRun({ ...base, lyricsFailFor: { "/home/u/Music/found.mp3": "Couldn't reach the lyrics service: timed out" } }));
await dialog.getByRole("checkbox", { name: /^Allow sending/ }).check();
await dialog.getByRole("button", { name: /^Find lyrics for 4 songs/ }).click();
await dialog.getByRole("alert").waitFor({ timeout: 15000 });
check("lyrics: an unreachable service stops the run before the remaining songs", !(await calls(page, "lyrics_find")).some((c) => c.args.path.endsWith("nothing.mp3")) && (await dialog.getByRole("alert").innerText()).includes("Couldn't reach the lyrics service"));
await page.context().close();
await done();
