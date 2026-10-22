// Step 5 of the music player: keeping the volume even between songs.
import { open, check, calls, nav, done } from "../harness.mjs";

const DL = "/home/u/Downloads";
const T = (title, track, extra = {}) => ({
  path: `${DL}/Band/Album/0${track} ${title}.mp3`,
  title, artist: "Band", album_artist: "", album: "Album", track, disc: null, year: 2000, genre: "", duration: 200 + track, bitrate: 192, sample_rate: 44100,
  bit_depth: null, channels: 2, format: "MP3", size: 1_000_000, modified: 1000 + track, has_cover: false, loudness: null, ...extra,
});
const LIB = [T("Loud One", 1, { loudness: -10 }), T("Quiet One", 2, { loudness: -22 }), T("Unknown One", 3)];
const library = (page) => page.getByRole("region", { name: "Music library" });
const bar = (page) => page.getByRole("region", { name: "Music player" });
const volumes = (page) => page.evaluate(() => (window.__vol ?? []).filter((r) => !r.audio.paused).map((r) => r.value));
const watchVolume = (page) =>
  page.evaluate(() => {
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
    window.__vol = [];
    Object.defineProperty(HTMLMediaElement.prototype, "volume", {
      configurable: true,
      get: d.get,
      set(v) {
        window.__vol.push({ audio: this, value: v });
        d.set.call(this, v);
      },
    });
  });
const lastVolume = async (page) => (await volumes(page)).at(-1);
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 0.005;

// turned down when on, left alone when off
let page = await open({ store: { warnDuplicates: false, levelVolume: true }, mock: { library: LIB, loudness: { [LIB[2].path]: -8 } } });
await nav(page, "Library").click();
await library(page).getByRole("list", { name: "Songs" }).waitFor();
await watchVolume(page);
await library(page).getByRole("button", { name: "Play Loud One", exact: true }).click();
await bar(page).locator(".pb-title").filter({ hasText: "Loud One" }).waitFor();
await page.waitForTimeout(200);
check("level: a loud song is turned down to the target", near(await lastVolume(page), Math.pow(10, -6 / 20)), String(await lastVolume(page)));
check("level: a song that is already measured isn't measured again", (await calls(page, "library_analyze")).length === 0 || !(await page.evaluate(() => window.__mock.analyzed ?? [])).flat().includes(LIB[0].path));
await library(page).getByRole("button", { name: "Play Quiet One", exact: true }).click();
await bar(page).locator(".pb-title").filter({ hasText: "Quiet One" }).waitFor();
await page.waitForTimeout(200);
check("level: a quiet song is not boosted", near(await lastVolume(page), 1), String(await lastVolume(page)));

// a song nobody measured is measured when it plays
await library(page).getByRole("button", { name: "Play Unknown One", exact: true }).click();
await bar(page).locator(".pb-title").filter({ hasText: "Unknown One" }).waitFor();
await page.waitForFunction(() => (window.__mock.analyzed ?? []).length > 0);
check("level: an unmeasured song is measured as it starts", (await page.evaluate(() => window.__mock.analyzed.flat())).includes(LIB[2].path));
await page.waitForTimeout(300);
check("level: and then leveled with the result", near(await lastVolume(page), Math.pow(10, -8 / 20)), String(await lastVolume(page)));
await page.context().close();

// off: nothing is measured or changed
page = await open({ store: { warnDuplicates: false, levelVolume: false }, mock: { library: LIB } });
await nav(page, "Library").click();
await library(page).getByRole("list", { name: "Songs" }).waitFor();
await watchVolume(page);
await library(page).getByRole("button", { name: "Play Loud One", exact: true }).click();
await bar(page).locator(".pb-title").filter({ hasText: "Loud One" }).waitFor();
await library(page).getByRole("button", { name: "Play Unknown One", exact: true }).click();
await bar(page).locator(".pb-title").filter({ hasText: "Unknown One" }).waitFor();
await page.waitForTimeout(300);
check("level off: the volume stays as it is", near(await lastVolume(page), 1), String(await lastVolume(page)));
check("level off: nothing is measured on the side", ((await page.evaluate(() => window.__mock.analyzed ?? [])).length) === 0);

// measuring the whole library
await page.getByRole("button", { name: "Measure loudness (1)" }).click();
await page.waitForFunction(() => (window.__mock.analyzed ?? []).length > 0);
await page.getByRole("button", { name: /^Measure loudness/ }).waitFor({ state: "detached" });
check("measure: the button measures what is missing and goes away", (await page.evaluate(() => window.__mock.analyzed.flat())).length === 1);
await page.context().close();

// the setting
page = await open({ store: { warnDuplicates: false }, mock: { library: LIB } });
await nav(page, "Settings").click();
const box = page.getByLabel(/even volume/);
check("setting: it starts off", !(await box.isChecked()));
await box.check();
check("setting: it can be turned on", await box.isChecked());
await page.context().close();

// A failed measurement is not offered repeatedly during the same session.
page = await open({ mock: { library: [LIB[2]], analyzeFail: [LIB[2].path] } });
await nav(page, "Library").click();
await page.getByRole("button", { name: "Measure loudness (1)" }).click();
await page.getByRole("button", { name: /^Measure loudness/ }).waitFor({ state: "detached" });
check("measure: an unreadable song leaves the pending count", (await page.evaluate(() => window.__mock.analyzed.flat())).length === 1);
await library(page).getByRole("radio", { name: "Playlists" }).click();
check("playlists: unrelated filters are hidden", await library(page).getByLabel("Search the library").count() === 0 && await library(page).getByLabel("Format", { exact: true }).count() === 0);
await page.context().close();

await done();
