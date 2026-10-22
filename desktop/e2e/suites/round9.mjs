// The music library page: songs, albums and artists, searching and filtering, playing from it, covers, scanning and long lists.
import { open, check, calls, waitCalls, nav, details, submit, done } from "../harness.mjs";

const DL = "/home/u/Downloads";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const T = (title, artist, album, track, year, extra = {}) => ({
  path: `${DL}/${artist || "Loose"}/${album || "Singles"}/${String(track ?? 0).padStart(2, "0")} ${title}.mp3`,
  title, artist, album_artist: "", album, track, disc: null, year, genre: "", duration: 200 + (track ?? 0), bitrate: 192, sample_rate: 44100,
  bit_depth: null, channels: 2, format: "MP3", size: 1_000_000, modified: 1000 + (track ?? 0), has_cover: false, loudness: null, ...extra,
});
const LIB = [
  T("Da Funk", "Daft Punk", "Homework", 1, 1997),
  T("Around the World", "Daft Punk", "Homework", 3, 1997),
  T("Revolution 909", "Daft Punk", "Homework", 2, 1997),
  T("One More Time", "Daft Punk", "Discovery", 1, 2001, { format: "FLAC", bit_depth: 16, bitrate: null }),
  T("Formation", "Beyoncé", "Lemonade", 12, 2016),
  T("Loose Single", "", "", null, null),
];

const library = (page) => page.getByRole("region", { name: "Music library" });
const songs = (page) => library(page).getByRole("list", { name: "Songs" }).getByRole("listitem");
const titles = (page) => page.evaluate(() => [...document.querySelectorAll(".library [aria-label=Songs] .lib-title")].map((e) => e.textContent));
const bar = (page) => page.getByRole("region", { name: "Music player" });
const openLibrary = async (page) => {
  await nav(page, "Library").click();
  await library(page).waitFor();
};

// ================= the page and the list of songs =================
let page = await open({ store: { warnDuplicates: false }, mock: { library: LIB } });
await page.waitForFunction(() => window.__mock.calls.some((c) => c.cmd === "library_scan"));
check("library: looked at once at start-up: what was remembered, then a scan", (await calls(page, "library_load")).length === 1 && (await calls(page, "library_scan")).length === 1);
check("library: the sidebar shows how many songs there are", (await nav(page, "Library").innerText()).includes("6"));
await openLibrary(page);
check("library: every song is listed, with its name, artist and album", (await songs(page).count()) === 6 && (await songs(page).first().innerText()).includes("Daft Punk"));
check("library: the size is shown", (await library(page).getByLabel("Library size").innerText()).includes("6 songs"));
check("library: a song without tags says so", (await library(page).innerText()).includes("Unknown artist"));
check("library: quality is shown, lossless with its sample rate", (await library(page).innerText()).includes("MP3 · 192 kbps") && (await library(page).innerText()).includes("FLAC · 44.1 kHz · 16-bit"));
check("library: the page title replaces the layout switcher", (await page.locator("header.toolbar").innerText()).includes("Library"));

// searching, filtering and sorting
await library(page).getByLabel("Search the library").fill("beyonce");
check("library: search ignores accents and capitals", same(await titles(page), ["Formation"]) && (await library(page).getByLabel("Library size").innerText()).includes("1 of 6 songs"));
await library(page).getByLabel("Search the library").fill("daft homework");
check("library: every word has to match something", (await songs(page).count()) === 3);
await library(page).getByLabel("Search the library").fill("zzz nothing");
check("library: no match says so", (await library(page).innerText()).includes("Nothing matches"));
await library(page).getByRole("button", { name: "Clear the search" }).click();
check("library: the search can be cleared", (await songs(page).count()) === 6);
await library(page).getByLabel("Format", { exact: true }).selectOption("FLAC");
check("library: songs can be limited to a format", same(await titles(page), ["One More Time"]));
await library(page).getByLabel("Format", { exact: true }).selectOption("");
check("library: sorted by title to begin with", (await titles(page))[0] === "Around the World");
await library(page).getByLabel("Sort by").selectOption("album");
check("library: sorting by album keeps track order inside an album", same((await titles(page)).filter((t) => ["Da Funk", "Revolution 909", "Around the World"].includes(t)), ["Da Funk", "Revolution 909", "Around the World"]));
await library(page).getByLabel("Sort by").selectOption("title");

// playing from the list
await library(page).getByRole("button", { name: "Play Da Funk", exact: true }).click();
await bar(page).waitFor();
check("library: playing a song plays it", (await bar(page).locator(".pb-title").innerText()) === "Da Funk");
check("library: …and queues the rest of the list after it", (await bar(page).getByRole("button", { name: "Show the queue" }).innerText()).includes("5"));
check("library: the file is made available first", (await calls(page, "play_in_app"))[0].args.path === LIB[0].path);
await library(page).getByRole("button", { name: "Add Loose Single to the queue" }).click();
check("library: a song can be added to the queue", (await bar(page).getByRole("button", { name: "Show the queue" }).innerText()).includes("6"));
await library(page).getByRole("button", { name: "Play Formation next" }).click();
await bar(page).getByRole("button", { name: "Show the queue" }).click();
const queued = await page.evaluate(() => [...document.querySelectorAll(".qp-row .qp-title span:first-child")].map((e) => e.textContent));
check("library: …or played next, right after the current one", queued[1] === "Formation", JSON.stringify(queued));
await library(page).getByRole("button", { name: "Show Formation in its folder" }).click();
await waitCalls(page, "reveal_file", 1);
check("library: a song can be shown in its folder", (await calls(page, "reveal_file")).at(-1).args.path === LIB[4].path);
await page.context().close();

// ================= albums =================
page = await open({ store: { warnDuplicates: false }, mock: { library: LIB } });
await openLibrary(page);
await library(page).getByRole("radio", { name: "Albums" }).click();
const cards = library(page).getByRole("list", { name: "Albums" }).getByRole("listitem");
await cards.first().waitFor();
check("albums: one card for each album, singles kept separate", (await cards.count()) === 4);
check("albums: a card names the album, artist and year", (await library(page).getByRole("button", { name: "Open Homework by Daft Punk" }).innerText()).includes("1997"));
await page.waitForFunction(() => document.querySelectorAll(".album-card .thumb img").length >= 3);
check("albums: covers are shown", (await page.locator(".album-card .thumb img").count()) >= 3);
await library(page).getByRole("button", { name: "Open Homework by Daft Punk" }).click();
const tracks = library(page).getByRole("list", { name: "Tracks" });
check("albums: opening one lists its tracks in track order", same(await tracks.locator(".lib-title").allInnerTexts(), ["Da Funk", "Revolution 909", "Around the World"]));
check("albums: with how many songs and how long", (await library(page).innerText()).includes("3 songs"));
await library(page).getByRole("button", { name: "Play album" }).click();
await bar(page).waitFor();
check("albums: Play album starts at the first track", (await bar(page).locator(".pb-title").innerText()) === "Da Funk");
await bar(page).getByRole("button", { name: "Show the queue" }).click();
check("albums: …with the album in order", same(await page.evaluate(() => [...document.querySelectorAll(".qp-row .qp-title span:first-child")].map((e) => e.textContent)), ["Da Funk", "Revolution 909", "Around the World"]));
await library(page).getByRole("button", { name: "Add to queue" }).first().click();
check("albums: the whole album can be added again", (await bar(page).getByRole("button", { name: "Show the queue" }).innerText()).includes("6"));
await library(page).getByRole("button", { name: "Back to albums" }).click();
check("albums: Back returns to the albums", (await cards.count()) === 4);

// artists
await library(page).getByRole("radio", { name: "Artists" }).click();
const artistRows = library(page).getByRole("list", { name: "Artists" }).getByRole("listitem");
check("artists: each artist with their albums and songs", same(await artistRows.locator("b").allInnerTexts(), ["Beyoncé", "Daft Punk", "Unknown artist"]) && (await artistRows.nth(1).innerText()).includes("2 albums · 4 songs"));
await library(page).getByRole("button", { name: "Show Daft Punk" }).click();
check("artists: choosing one shows that artist's albums", (await library(page).getByRole("radio", { name: "Albums" }).getAttribute("aria-checked")) === "true" && (await cards.count()) === 2);
check("artists: …and says whose they are", (await library(page).getByRole("status").first().innerText()).includes("Daft Punk"));
await library(page).getByRole("button", { name: "Show all artists instead of Daft Punk" }).click();
check("artists: the choice can be undone", (await cards.count()) === 4);
await page.context().close();

// covers that aren't there
page = await open({ store: { warnDuplicates: false }, mock: { library: LIB, noCovers: true } });
await openLibrary(page);
await library(page).getByRole("radio", { name: "Albums" }).click();
await page.locator(".album-card").first().waitFor();
await page.waitForTimeout(600);
check("albums: without a cover a placeholder is shown instead", (await page.locator(".album-card .thumb img").count()) === 0 && (await page.locator(".album-card .thumb svg").count()) >= 3);
await page.context().close();

// ================= scanning =================
page = await open({ store: { warnDuplicates: false }, mock: { library: LIB.slice(0, 2), scanDelay: 400 } });
await openLibrary(page);
await page.waitForFunction(() => !window.__mock.scanning, null, { timeout: 8000 });
check("scan: songs found at start-up are listed", (await songs(page).count()) === 2);
await page.evaluate((all) => (window.__mock.library = all), LIB);
await library(page).getByRole("button", { name: "Rescan" }).click();
await library(page).getByRole("status", { name: "Scan progress" }).waitFor();
check("scan: progress is shown while it reads", (await library(page).getByRole("status", { name: "Scan progress" }).innerText()).includes("Reading"));
check("scan: Rescan waits until it is finished", await library(page).getByRole("button", { name: "Rescan" }).isDisabled());
await page.waitForFunction(() => document.querySelectorAll(".library [aria-label=Songs] [role=listitem]").length === 6, null, { timeout: 8000 });
check("scan: new songs appear once it is done", (await library(page).getByRole("status", { name: "Scan progress" }).count()) === 0);
check("scan: it asked the backend each time", (await calls(page, "library_scan")).length === 2);
await page.context().close();

// nothing yet
page = await open({ store: { warnDuplicates: false }, mock: { library: [] } });
await openLibrary(page);
await page.waitForFunction(() => !window.__mock.scanning);
await library(page).getByRole("heading", { name: "No music yet" }).waitFor();
check("empty: says there is no music yet", true);
await page.context().close();

// a new download makes it look again
page = await open({ store: { warnDuplicates: false }, mock: { library: LIB } });
await waitCalls(page, "library_scan", 1);
await submit(page, "https://www.youtube.com/watch?v=pasted00001");
await details(page).waitFor();
await details(page).getByRole("button", { name: "Download video" }).click();
await waitCalls(page, "library_scan", 2, 30000);
check("scan: it looks again after a download finishes", true);
await page.context().close();

// ================= a long list, and the shortcut =================
const MANY = Array.from({ length: 400 }, (_, i) => T(`Song ${String(i + 1).padStart(3, "0")}`, "Artist", "Album", (i % 50) + 1, 2000, { modified: 5000 + i }));
page = await open({ store: { warnDuplicates: false }, mock: { library: MANY } });
await page.locator("main").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("Control+5");
await library(page).waitFor();
check("library: Ctrl+5 opens it", true);
await songs(page).first().waitFor();
check("long list: only the rows near the screen are drawn", (await songs(page).count()) < 80 && (await library(page).getByLabel("Library size").innerText()).includes("400 songs"));
await page.locator(".library .lib-scroll").evaluate((el) => (el.scrollTop = el.scrollHeight));
await page.waitForFunction(() => [...document.querySelectorAll(".library [aria-label=Songs] .lib-title")].some((e) => e.textContent === "Song 400"));
check("long list: scrolling to the end shows the last song", (await songs(page).count()) < 80);
await library(page).getByRole("button", { name: "Play Song 400", exact: true }).click();
await bar(page).waitFor();
check("long list: playing near the end queues just what follows", (await bar(page).getByRole("button", { name: "Show the queue" }).innerText()).includes("1"));
await page.context().close();

await done();
