// Step 4 of the music player: lyrics, the tag editor and playlists.
import { chooseMenu, open, check, calls, waitCalls, nav, now, done } from "../harness.mjs";

const DL = "/home/u/Downloads";
const DAY = 86_400_000;
const H = (id, title, path, ageDays = 1) => ({ id, url: `https://www.youtube.com/watch?v=${id.padEnd(11, "0")}`, title, thumbnail: "", preset: "audio", path, timestamp: now - ageDays * DAY });
const SONGS = [H("s1", "First Song", `${DL}/First Song.mp3`, 1), H("s2", "Second Song", `${DL}/Second Song.mp3`, 2), H("s3", "Third Song", `${DL}/Third Song.mp3`, 3)];
const bar = (page) => page.getByRole("region", { name: "Music player" });
const playOnRow = (page, title) => page.locator("tr", { hasText: title }).first().getByRole("button", { name: "Play in Kaisu" }).click();
const dialog = (page) => page.getByRole("alertdialog");

// ================= lyrics =================
const SYNCED = { synced: "[00:00.50] First line\n[00:02.00] Second line\n[00:04.00] Third line", plain: null, source: "file" };
const PLAIN = { synced: null, plain: "Just words\nwithout timing", source: "tags" };
const lyricsMock = { [`${DL}/First Song.mp3`]: SYNCED, [`${DL}/Second Song.mp3`]: PLAIN };

let page = await open({ history: SONGS, store: { warnDuplicates: false, lyricsConsent: false }, mock: { audioSeconds: 60, lyrics: lyricsMock } });
await nav(page, "History").click();
await playOnRow(page, "First Song");
await bar(page).waitFor();
const panel = () => page.getByRole("region", { name: "Lyrics" });
check("lyrics: nothing is shown until asked for", (await panel().count()) === 0);
await bar(page).getByRole("button", { name: "Show the lyrics" }).click();
await panel().getByRole("list", { name: "Synced lyrics" }).waitFor();
check("lyrics: the song's own lyrics are read, not fetched", (await calls(page, "lyrics_read")).at(-1).args.path === `${DL}/First Song.mp3` && (await calls(page, "lyrics_find")).length === 0);
check("lyrics: every timed line is listed", (await panel().getByRole("listitem").count()) === 3);
await page.waitForFunction(() => document.querySelector(".ly-lines li.current")?.textContent === "First line", null, { timeout: 8000 });
check("lyrics: the line being sung is highlighted", true);
await page.waitForFunction(() => document.querySelector(".ly-lines li.current")?.textContent === "Second line", null, { timeout: 8000 });
check("lyrics: …and moves on with the music", (await panel().locator("li.past").count()) === 1);
await panel().getByRole("button", { name: "Third line" }).click();
await page.waitForFunction(() => document.querySelector(".ly-lines li.current")?.textContent === "Third line", null, { timeout: 8000 });
check("lyrics: clicking a line goes to it", true);

// a different panel replaces it, and a different track brings different lyrics
await bar(page).getByRole("button", { name: "Show the queue" }).click();
check("lyrics: the queue and the lyrics share one place", (await panel().count()) === 0 && (await page.getByRole("region", { name: "Play queue" }).count()) === 1);
await bar(page).getByRole("button", { name: "Show the lyrics" }).click();
check("lyrics: toggling back shows them again", (await panel().count()) === 1 && (await page.getByRole("region", { name: "Play queue" }).count()) === 0);
await page.locator("tr", { hasText: "Second Song" }).first().getByRole("button", { name: "Play in Kaisu" }).click();
await panel().locator("pre.ly-plain").waitFor();
check("lyrics: untimed lyrics are shown as plain text", (await panel().locator("pre.ly-plain").innerText()).includes("without timing"));
await bar(page).getByRole("button", { name: "Hide the lyrics" }).or(panel().getByRole("button", { name: "Hide the lyrics" })).first().click();
check("lyrics: they can be hidden", (await panel().count()) === 0);
await page.context().close();

// no lyrics, and looking them up
page = await open({ history: SONGS, store: { warnDuplicates: false, lyricsConsent: false }, mock: { audioSeconds: 60 } });
await nav(page, "History").click();
await playOnRow(page, "Third Song");
await bar(page).getByRole("button", { name: "Show the lyrics" }).click();
await panel().getByText("There are no lyrics saved for this song.").waitFor();
check("lyrics: a song without any says so, and what looking them up sends", (await panel().innerText()).includes("artist and title"));
await panel().getByRole("button", { name: "Find lyrics online" }).click();
await dialog(page).waitFor();
check("lyrics: looking them up asks first", /LRCLIB/.test(await dialog(page).innerText()));
await dialog(page).getByRole("button", { name: "No lyrics" }).click();
check("lyrics: 'no' looks nothing up", (await calls(page, "lyrics_find")).length === 0);
await panel().getByRole("button", { name: "Find lyrics online" }).click();
await dialog(page).getByRole("button", { name: "Allow lookup" }).click();
await panel().getByRole("list", { name: "Synced lyrics" }).waitFor();
check("lyrics: 'allow' looks the song up and shows what was found", (await calls(page, "lyrics_find")).at(-1).args.path === `${DL}/Third Song.mp3` && (await panel().innerText()).includes("Found line one"));
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).settings.lyricsConsent === true);
check("lyrics: the agreement is remembered", true);
await page.context().close();

page = await open({ history: SONGS, store: { warnDuplicates: false, lyricsConsent: true }, mock: { audioSeconds: 60, lyricsFindFail: true } });
await nav(page, "History").click();
await playOnRow(page, "Third Song");
await bar(page).getByRole("button", { name: "Show the lyrics" }).click();
await panel().getByRole("button", { name: "Find lyrics online" }).click();
await panel().getByRole("alert").waitFor();
check("lyrics: with consent already given it just looks, and a miss is explained", (await dialog(page).count()) === 0 && (await panel().getByRole("alert").innerText()).includes("No lyrics were found"));
check("lyrics: it can be tried again", (await panel().getByRole("button", { name: "Find lyrics online" }).isEnabled()));
await page.context().close();

// ================= the tag editor =================
const T = (title, artist, album, track, year, extra = {}) => ({
  path: `${DL}/${artist}/${album}/${String(track).padStart(2, "0")} ${title}.mp3`,
  title, artist, album_artist: "", album, track, disc: null, year, genre: "", duration: 200 + track, bitrate: 192, sample_rate: 44100,
  bit_depth: null, channels: 2, format: "MP3", size: 1_000_000, modified: 1000 + track, has_cover: false, loudness: null, ...extra,
});
const LIB = [
  T("Da Funk", "Daft Punk", "Homework", 1, 1997, { genre: "Electronic" }),
  T("Revolution 909", "Daft Punk", "Homework", 2, 1997, { genre: "House" }),
  T("Around the World", "Daft Punk", "Homework", 3, 1997, { genre: "House" }),
  T("Formation", "Beyoncé", "Lemonade", 12, 2016),
];
const library = (page) => page.getByRole("region", { name: "Music library" });
const editor = (page, name) => page.getByRole("dialog", { name });
const titles = (page) => page.evaluate(() => [...document.querySelectorAll(".library [aria-label=Songs] .lib-title")].map((e) => e.textContent));
const edits = (page) => page.evaluate(() => window.__mock.tagEdits ?? []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

page = await open({ store: { warnDuplicates: false }, mock: { library: LIB } });
await nav(page, "Library").click();
await library(page).getByRole("list", { name: "Songs" }).waitFor();
await chooseMenu(page, "Actions for Da Funk", "Edit tags of Da Funk");
const ed = () => editor(page, "Edit tags");
await ed().waitFor();
check("tags: the editor starts with the song's own tags", (await ed().getByLabel("Title").inputValue()) === "Da Funk" && (await ed().getByLabel("Artist", { exact: true }).inputValue()) === "Daft Punk" && (await ed().getByLabel("Year").inputValue()) === "1997" && (await ed().getByLabel("Track number").inputValue()) === "1");
check("tags: nothing to save until something changes", await ed().getByRole("button", { name: "Save" }).isDisabled());
await ed().getByLabel("Year").fill("99");
check("tags: a bad year is explained and can't be saved", (await ed().getByRole("alert").innerText()).includes("1000 to 2999") && (await ed().getByRole("button", { name: "Save" }).isDisabled()));
await ed().getByLabel("Year").fill("1997");
check("tags: putting it back leaves nothing to save", await ed().getByRole("button", { name: "Save" }).isDisabled());
await ed().getByLabel("Title").fill("Da Funk (Remastered)");
await ed().getByLabel("Genre").fill("");
await ed().getByRole("button", { name: "Save" }).click();
await waitCalls(page, "library_edit_tags", 1);
check("tags: only the changed fields are sent, an emptied one as empty", same((await edits(page))[0], { paths: [LIB[0].path], edit: { title: "Da Funk (Remastered)", genre: "" } }), JSON.stringify((await edits(page))[0]));
await ed().waitFor({ state: "detached" });
check("tags: the dialog closes and the list shows the new title", (await titles(page)).includes("Da Funk (Remastered)") && !(await titles(page)).includes("Da Funk"));
await page.context().close();

// cancelling changes nothing
page = await open({ store: { warnDuplicates: false }, mock: { library: LIB } });
await nav(page, "Library").click();
await chooseMenu(page, "Actions for Formation", "Edit tags of Formation");
await ed().getByLabel("Title").fill("Something else");
await ed().getByRole("button", { name: "Cancel" }).click();
check("tags: cancel sends nothing", (await calls(page, "library_edit_tags")).length === 0 && (await titles(page)).includes("Formation"));
await page.context().close();

// a whole album
page = await open({ store: { warnDuplicates: false }, mock: { library: LIB } });
await nav(page, "Library").click();
await page.getByLabel("Library view", { exact: true }).selectOption("albums");
await library(page).getByRole("button", { name: "Open Homework by Daft Punk" }).click();
await library(page).getByRole("button", { name: "Edit album" }).click();
const many = () => editor(page, "Edit 3 songs");
await many().waitFor();
check("album: the fields that belong to one song are left out", (await many().getByLabel("Title").count()) === 0 && (await many().getByLabel("Track number").count()) === 0);
check("album: what the songs share is filled in", (await many().getByLabel("Artist", { exact: true }).inputValue()) === "Daft Punk" && (await many().getByLabel("Album", { exact: true }).inputValue()) === "Homework" && (await many().getByLabel("Year").inputValue()) === "1997");
check("album: what differs is empty and says so", (await many().getByLabel("Genre").inputValue()) === "" && (await many().getByLabel("Genre").getAttribute("placeholder")) === "Different in each song");
await many().getByLabel("Album", { exact: true }).fill("Homework (Deluxe)");
await many().getByRole("button", { name: "Save" }).click();
await waitCalls(page, "library_edit_tags", 1);
const sent = (await edits(page))[0];
check("album: every song in it is changed, with just what was typed", sent.paths.length === 3 && same(sent.edit, { album: "Homework (Deluxe)" }), JSON.stringify(sent));
await many().waitFor({ state: "detached" });
check("album: the album shows its new name", (await library(page).innerText()).includes("Homework (Deluxe)"));
await page.context().close();

// some files can't be changed
page = await open({ store: { warnDuplicates: false }, mock: { library: LIB, tagFail: [LIB[1].path] } });
await nav(page, "Library").click();
await page.getByLabel("Library view", { exact: true }).selectOption("albums");
await library(page).getByRole("button", { name: "Open Homework by Daft Punk" }).click();
await library(page).getByRole("button", { name: "Edit album" }).click();
await many().getByLabel("Artist", { exact: true }).fill("Daft Punk & Co");
await many().getByRole("button", { name: "Save" }).click();
await many().getByRole("alert").filter({ hasText: "couldn't be changed" }).waitFor();
check("failure: a file that can't be changed is named, with why", (await many().innerText()).includes("1 of 3 couldn't be changed") && (await many().innerText()).includes("Revolution 909") && (await many().innerText()).includes("Access is denied"));
check("failure: the dialog stays open", (await many().count()) === 1);
await many().getByRole("button", { name: "Cancel" }).click();
await page.getByLabel("Library view", { exact: true }).selectOption("songs");
const artistsNow = await page.evaluate(() => [...document.querySelectorAll(".library [aria-label=Songs] [role=listitem]")].map((r) => r.textContent));
check("failure: the files that did work show their change", artistsNow.filter((t) => t.includes("Daft Punk & Co")).length === 2);
await page.context().close();

// ================= playlists =================
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__store") ?? "{}").playlists ?? null);
const picker = (page) => page.getByRole("dialog", { name: "Add to playlist" });
const plTitles = (page) => page.evaluate(() => [...document.querySelectorAll(".library [aria-label=Tracks] .lib-title, .library [aria-label=Tracks] .dim.truncate")].map((e) => e.textContent));

page = await open({ store: { warnDuplicates: false }, mock: { library: LIB } });
await nav(page, "Library").click();
await library(page).getByRole("list", { name: "Songs" }).waitFor();
await page.getByLabel("Library view", { exact: true }).selectOption("playlists");
check("playlists: with none, it says how to start one", (await library(page).innerText()).includes("No playlists yet"));
await page.getByLabel("Library view", { exact: true }).selectOption("songs");
await chooseMenu(page, "Actions for Da Funk", "Add Da Funk to a playlist");
await picker(page).waitFor();
check("playlists: a new name is needed before creating", await picker(page).getByRole("button", { name: "Create and add" }).isDisabled());
await picker(page).getByLabel("New playlist name").fill("Road trip");
await picker(page).getByRole("button", { name: "Create and add" }).click();
await picker(page).waitFor({ state: "detached" });
check("playlists: creating one adds the song and is saved", same((await saved(page))?.map((p) => [p.name, p.paths]), [["Road trip", [LIB[0].path]]]), JSON.stringify(await saved(page)));

// a second song, then a duplicate, then a name that is taken
await chooseMenu(page, "Actions for Revolution 909", "Add Revolution 909 to a playlist");
await picker(page).getByRole("button", { name: "Add to Road trip" }).click();
await picker(page).waitFor({ state: "detached" });
await chooseMenu(page, "Actions for Revolution 909", "Add Revolution 909 to a playlist");
await picker(page).getByRole("button", { name: "Add to Road trip" }).click();
check("playlists: adding a song twice keeps one copy", (await saved(page))[0].paths.length === 2);
await chooseMenu(page, "Actions for Formation", "Add Formation to a playlist");
await picker(page).getByLabel("New playlist name").fill("road TRIP");
await picker(page).getByRole("button", { name: "Create and add" }).click();
check("playlists: a taken name is explained", (await picker(page).getByRole("alert").innerText()).includes("already"));
await picker(page).getByRole("button", { name: "Cancel" }).click();

// a whole album
await page.getByLabel("Library view", { exact: true }).selectOption("albums");
await library(page).getByRole("button", { name: "Open Homework by Daft Punk" }).click();
await library(page).getByRole("button", { name: "Add to playlist" }).click();
await picker(page).getByRole("button", { name: "Add to Road trip" }).click();
await picker(page).waitFor({ state: "detached" });
check("playlists: a whole album can be added, without repeats", (await saved(page))[0].paths.length === 3);

// the playlist
await page.getByLabel("Library view", { exact: true }).selectOption("playlists");
await library(page).getByRole("button", { name: "Open Road trip" }).click();
check("playlists: it lists its songs in order", same(await plTitles(page), ["Da Funk", "Revolution 909", "Around the World"]), JSON.stringify(await plTitles(page)));
await library(page).getByRole("button", { name: "Move Around the World up" }).click();
check("playlists: a song can be moved", same(await plTitles(page), ["Da Funk", "Around the World", "Revolution 909"]) && same((await saved(page))[0].paths.map((x) => x.split("/").pop()), ["01 Da Funk.mp3", "03 Around the World.mp3", "02 Revolution 909.mp3"]));
await library(page).getByRole("button", { name: "Remove Da Funk from the playlist" }).click();
check("playlists: a song can be removed", same(await plTitles(page), ["Around the World", "Revolution 909"]));
await library(page).getByRole("button", { name: "Play playlist" }).click();
check("playlists: Play playlist starts the first song", (await bar(page).locator(".pb-title").innerText()) === "Around the World");
check("playlists: and queues the rest", (await bar(page).getByRole("button", { name: "Show the queue" }).innerText()).includes("2"));

// export
await library(page).getByRole("button", { name: "Export .m3u8" }).click();
await page.waitForFunction(() => window.__mock.exports?.length === 1);
const exp = await page.evaluate(() => window.__mock.exports[0]);
check("playlists: the export is an extended M3U with the songs in order", exp.contents.startsWith("#EXTM3U\n#PLAYLIST:Road trip\n#EXTINF:203,Daft Punk - Around the World\n") && exp.contents.trimEnd().endsWith("02 Revolution 909.mp3"), exp.contents);

// rename
await library(page).getByRole("button", { name: "Rename", exact: true }).click();
await page.getByRole("dialog", { name: "Rename playlist" }).getByLabel("Playlist name").fill("Drive");
await page.getByRole("dialog", { name: "Rename playlist" }).getByRole("button", { name: "Rename", exact: true }).click();
check("playlists: renaming shows and saves the new name", (await library(page).innerText()).includes("Drive") && (await saved(page))[0].name === "Drive");

// delete needs a second click
await library(page).getByRole("button", { name: "Delete playlist" }).click();
check("playlists: delete asks first", (await saved(page)).length === 1);
await library(page).getByRole("button", { name: "Yes, delete it" }).click();
check("playlists: and then removes it", (await saved(page)).length === 0 && (await library(page).innerText()).includes("No playlists yet"));
await page.context().close();

// saved playlists come back, and a file that left the library is shown as missing
page = await open({ store: { warnDuplicates: false }, mock: { library: LIB } });
await page.evaluate((path) => {
  const st = JSON.parse(localStorage.getItem("__store"));
  st.playlists = [{ id: "pl-x", name: "Old", paths: [path, "/gone/Lost.mp3"], updated: 1 }];
  localStorage.setItem("__store", JSON.stringify(st));
}, LIB[3].path);
await page.reload();
await nav(page, "Library").click();
await page.getByLabel("Library view", { exact: true }).selectOption("playlists");
await library(page).getByRole("button", { name: "Open Old" }).click();
check("playlists: a saved playlist is there after a restart", (await plTitles(page))[0] === "Formation");
check("playlists: a file that is gone is shown as missing", (await library(page).innerText()).includes("Lost (missing)") && (await library(page).innerText()).includes("1 not in the library now"));
await page.context().close();

await done();
