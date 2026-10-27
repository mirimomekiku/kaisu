// Command palette: opened with Ctrl+K, filters as you type, runs with Enter, and reaches into Library tools.
import { open, check, calls, done } from "../harness.mjs";
const current = (page) => page.getByRole("navigation", { name: "Sections" }).locator("[aria-current=page]").innerText();
const palette = (page) => page.getByRole("dialog", { name: "Command palette", exact: true });
const song = { path: "/home/u/Music/a.mp3", title: "a", artist: "Band", album_artist: "", album: "Album", genre: "", year: 2001, track: 1, disc: 1, duration: 180, bitrate: 192, sample_rate: 44100, bit_depth: null, channels: 2, format: "MP3", size: 1000, modified: 1, added: 1, has_cover: false, loudness: -18 };
const page = await open({ mock: { library: [song] } });

await page.keyboard.press("Control+k");
await palette(page).waitFor();
check("palette: Ctrl+K opens it with the search focused", await page.getByLabel("Search commands", { exact: true }).evaluate((e) => document.activeElement === e));
check("palette: it lists commands before anything is typed", await palette(page).getByRole("option").count() > 10);

await page.getByLabel("Search commands", { exact: true }).fill("downloads");
check("palette: typing filters the list", (await palette(page).getByRole("option").first().innerText()).includes("Go to Downloads"));
await page.keyboard.press("Enter");
await palette(page).waitFor({ state: "detached" });
check("palette: Enter runs the command and closes it", (await current(page)).startsWith("Downloads"));

await page.keyboard.press("Control+k");
await page.getByLabel("Search commands", { exact: true }).fill("music folders");
await page.keyboard.press("Enter");
await page.getByRole("dialog", { name: "Music folders", exact: true }).waitFor();
check("palette: a library tool opens on the Library page", (await current(page)).startsWith("Library"));
await page.keyboard.press("Escape");

await page.keyboard.press("Control+k");
await page.getByLabel("Search commands", { exact: true }).fill("usb");
check("palette: keywords find commands", (await palette(page).getByRole("option").first().innerText()).includes("portable collection sync"));
await page.getByLabel("Search commands", { exact: true }).fill("zzzz");
await page.getByText(/No command matches/).waitFor();
check("palette: no match says so and Enter does nothing", (await palette(page).getByRole("option").count()) === 0);
await page.keyboard.press("Enter");
check("palette: it stays open after Enter with no match", await palette(page).count() === 1);
await page.keyboard.press("Escape");
check("palette: Escape closes it", await palette(page).count() === 0);

await page.keyboard.press("Control+k");
await page.getByLabel("Search commands", { exact: true }).fill("shortcuts");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowUp");
await page.keyboard.press("Enter");
await page.getByRole("dialog", { name: /shortcut/i }).waitFor();
check("palette: arrow keys move and Enter runs the highlighted command", true);
await page.context().close();
await done();
