// The music player: the bar, transport, seeking, speed, sleep timer, volume, remembered queue, media keys and the tray.
import { fileAction, open, check, calls, waitCalls, nav, now, done } from "../harness.mjs";

const DL = "/home/u/Downloads";
const DAY = 86_400_000;
const H = (id, title, path, ageDays = 1, extra = {}) => ({ id, url: `https://www.youtube.com/watch?v=${id.padEnd(11, "0")}`, title, thumbnail: "", preset: "audio", path, timestamp: now - ageDays * DAY, ...extra });
const SONGS = [H("s1", "First Song", `${DL}/First Song.mp3`, 1), H("s2", "Second Song", `${DL}/Second Song.mp3`, 2), H("s3", "Third Song", `${DL}/Third Song.mp3`, 3)];
const bar = (page) => page.getByRole("region", { name: "Music player" });
const playOnRow = async (page, title) => page.locator("tr", { hasText: title }).first().getByRole("button", { name: "Play in Kaisu" }).click();
const position = async (page) => {
  const text = (await bar(page).getByLabel("Position").innerText()).trim();
  const [m, s] = text.split(":").map(Number);
  return m * 60 + s;
};
const waitPosition = (page, atLeast, timeout = 15000) =>
  page.waitForFunction((n) => {
    const t = document.querySelector("[aria-label=Position]")?.textContent?.trim().split(":").map(Number) ?? [0, 0];
    return t[0] * 60 + t[1] >= n;
  }, atLeast, { timeout });
const lastTray = async (page) => (await calls(page, "set_tray_status")).at(-1)?.args;

// ================= the bar and the transport =================
let page = await open({ history: SONGS, store: { warnDuplicates: false } });
await nav(page, "History").click();
check("player: no bar until something plays", (await bar(page).count()) === 0);
await playOnRow(page, "Second Song");
await bar(page).waitFor();
check("player: playing a sound file opens the bar with its name", (await bar(page).innerText()).includes("Second Song"));
check("player: the file is made available first", (await calls(page, "play_in_app")).at(-1).args.path === `${DL}/Second Song.mp3`);
await waitPosition(page, 1);
check("player: it plays, and the time moves", (await bar(page).getByRole("button", { name: "Pause", exact: true }).count()) === 1 && (await position(page)) >= 1);
check("player: the length is shown", (await bar(page).getByLabel("Length").innerText()).trim() === "0:30");
await bar(page).getByRole("button", { name: "Pause", exact: true }).click();
await bar(page).getByRole("button", { name: "Play", exact: true }).waitFor();
const frozen = await position(page);
await page.waitForTimeout(1400);
check("player: pausing stops the time", (await position(page)) === frozen);
await bar(page).getByRole("button", { name: "Play", exact: true }).click();
await bar(page).getByRole("button", { name: "Pause", exact: true }).waitFor();
check("player: and play carries on", true);

// seeking
await bar(page).getByLabel("Seek").fill("20");
await waitPosition(page, 20);
check("player: seeking jumps to that place", (await position(page)) >= 20);

// the system's media controls
const session = await page.evaluate(() => ({ title: navigator.mediaSession.metadata?.title, state: navigator.mediaSession.playbackState }));
check("player: the system's media controls are told what is playing", session.title === "Second Song" && session.state === "playing", JSON.stringify(session));

// the tray knows music is playing (so closing the window keeps it going)
check("player: the tray is told music is playing", (await lastTray(page)).playing === true);
await bar(page).getByRole("button", { name: "Pause", exact: true }).click();
await page.waitForFunction(() => window.__mock.calls.filter((c) => c.cmd === "set_tray_status").at(-1)?.args.playing === false);
check("player: …and when it stops", (await lastTray(page)).playing === false);
check("player: the system is told it is paused", (await page.evaluate(() => navigator.mediaSession.playbackState)) === "paused");

// keyboard shortcut
await page.locator("main").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("Control+Shift+Space");
await bar(page).getByRole("button", { name: "Pause", exact: true }).waitFor();
check("player: Ctrl+Shift+Space plays", true);
await page.keyboard.press("Control+Shift+Space");
await bar(page).getByRole("button", { name: "Play", exact: true }).waitFor();
check("player: …and pauses", true);

// volume
await bar(page).getByLabel("Volume").fill("0");
check("player: volume at zero shows as muted", (await bar(page).getByRole("button", { name: "Unmute", exact: true }).count()) === 1);
await bar(page).getByRole("button", { name: "Unmute", exact: true }).click();
check("player: unmuting brings the sound back", (await bar(page).getByRole("button", { name: "Mute", exact: true }).count()) === 1 && (await bar(page).getByLabel("Volume").inputValue()) === "1");

// closing
await bar(page).getByRole("button", { name: "Close the player" }).click();
check("player: closing removes the bar", (await bar(page).count()) === 0);
check("player: …and the system's media controls", (await page.evaluate(() => navigator.mediaSession.playbackState)) === "none");
await page.context().close();

// ================= speed =================
page = await open({ history: SONGS, store: { warnDuplicates: false }, mock: { audioSeconds: 120 } });
await nav(page, "History").click();
await playOnRow(page, "First Song");
await bar(page).waitFor();
await waitPosition(page, 1);
await bar(page).getByRole("button", { name: "Playback options", exact: true }).click();
check("speed: it starts at normal speed", (await page.getByRole("dialog", { name: "Playback options", exact: true }).getByLabel("Playback speed").inputValue()) === "1");
await page.getByRole("dialog", { name: "Playback options", exact: true }).getByLabel("Playback speed").selectOption("2");
const t0 = await position(page);
await page.waitForTimeout(2500);
const gained = (await position(page)) - t0;
check("speed: at 2× the time moves about twice as fast", gained >= 3, `gained ${gained}s in 2.5s`);
await page.getByRole("dialog", { name: "Playback options", exact: true }).getByLabel("Playback speed").selectOption("0.5");
const t1 = await position(page);
await page.waitForTimeout(2500);
check("speed: at 0.5× it moves slowly", (await position(page)) - t1 <= 2);
await page.context().close();

// ================= sleep timer =================
page = await open({ history: SONGS, store: { warnDuplicates: false }, mock: { audioSeconds: 3 } });
await nav(page, "History").click();
await playOnRow(page, "First Song");
await bar(page).waitFor();
await bar(page).getByRole("button", { name: "Playback options", exact: true }).click();
check("sleep: off to begin with", (await page.getByRole("dialog", { name: "Playback options", exact: true }).getByLabel("Sleep timer").inputValue()) === "off");
await page.getByRole("dialog", { name: "Playback options", exact: true }).getByLabel("Sleep timer").selectOption("15");
check("sleep: a timer shows how long is left", (await page.getByRole("dialog", { name: "Playback options", exact: true }).getByLabel("Sleep timer").locator("option:checked").innerText()).includes("15 min left"));
await page.getByRole("dialog", { name: "Playback options", exact: true }).getByLabel("Sleep timer").selectOption("off");
check("sleep: it can be switched off", (await page.getByRole("dialog", { name: "Playback options", exact: true }).getByLabel("Sleep timer").inputValue()) === "off");
await page.getByRole("dialog", { name: "Playback options", exact: true }).getByLabel("Sleep timer").selectOption("track");
await bar(page).getByRole("button", { name: "Play", exact: true }).waitFor({ timeout: 12000 });
check("sleep: stops at the end of the track", (await page.getByRole("dialog", { name: "Playback options", exact: true }).getByLabel("Sleep timer").inputValue()) === "off");
check("sleep: …and stays on that track", (await bar(page).innerText()).includes("First Song"));
await page.context().close();

// ================= it remembers the queue =================
page = await open({ history: SONGS, store: { warnDuplicates: false }, mock: { audioSeconds: 60 } });
await nav(page, "History").click();
await playOnRow(page, "Third Song");
await bar(page).waitFor();
await bar(page).getByLabel("Seek").fill("25");
await waitPosition(page, 25);
await bar(page).getByRole("button", { name: "Pause", exact: true }).click();
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).player?.queue?.length === 1 && JSON.parse(localStorage.getItem("__store")).player.position >= 25, null, { timeout: 8000 });
check("remember: the queue and position are saved", true);
await page.reload();
await page.waitForSelector("input[type=text]");
await bar(page).waitFor();
check("remember: after a restart the track is back, paused", (await bar(page).innerText()).includes("Third Song") && (await bar(page).getByRole("button", { name: "Play", exact: true }).count()) === 1);
check("remember: at the place it was", (await position(page)) >= 25);
check("remember: nothing plays until asked", (await calls(page, "play_in_app")).length === 0);
await bar(page).getByRole("button", { name: "Play", exact: true }).click();
await bar(page).getByRole("button", { name: "Pause", exact: true }).waitFor();
await waitPosition(page, 26);
check("remember: play carries on from there", (await position(page)) >= 26);
check("remember: the file is made available when it is played", (await calls(page, "play_in_app")).at(-1).args.path === `${DL}/Third Song.mp3`);
await page.context().close();

// ================= trouble =================
page = await open({ history: SONGS, store: { warnDuplicates: false }, mock: { playRefused: true } });
await nav(page, "History").click();
await playOnRow(page, "First Song");
await bar(page).getByRole("alert").waitFor();
check("trouble: a file that can't be made available is explained in the bar", (await bar(page).getByRole("alert").innerText()).includes("isn't in a download folder"));
await page.context().close();

page = await open({ history: SONGS, store: { warnDuplicates: false }, mock: { unplayable: true } });
await nav(page, "History").click();
await playOnRow(page, "First Song");
await bar(page).getByRole("alert").waitFor();
check("trouble: a file the player can't decode is explained", (await bar(page).getByRole("alert").innerText()).includes("can't be played here"));
await page.context().close();

// ================= the play queue =================
const queuePanel = (page) => page.getByRole("region", { name: "Play queue" });
const queueTitles = (page) => page.evaluate(() => [...document.querySelectorAll(".qp-row .qp-title span:first-child")].map((e) => e.textContent));
const showingTitle = async (page) => (await bar(page).locator(".pb-title").innerText()).trim();
const VIDEO_ROW = H("v1", "A Movie", `${DL}/A Movie.mp4`, 4, { preset: "best" });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

page = await open({ history: [...SONGS, VIDEO_ROW], store: { warnDuplicates: false }, mock: { audioSeconds: 3 } });
await nav(page, "History").click();
await page.locator("tr", { hasText: "A Movie" }).first().getByRole("button", { name: "File actions", exact: true }).click();
check("queue: a video isn't offered to the music queue", (await page.getByRole("menu", { name: "File actions", exact: true }).getByRole("menuitem", { name: "Add to queue", exact: true }).count()) === 0);
await page.keyboard.press("Escape");
await playOnRow(page, "First Song");
await bar(page).waitFor();
await fileAction(page.locator("tr", { hasText: "Third Song" }).first(), "Add to queue");
await fileAction(page.locator("tr", { hasText: "Second Song" }).first(), "Play next");
await bar(page).getByRole("button", { name: "Show the queue" }).click();
await queuePanel(page).waitFor();
check("queue: the button shows how many tracks are queued", (await bar(page).getByRole("button", { name: "Show the queue" }).innerText()).includes("3"));
check("queue: 'play next' goes after the current track and 'add' at the end", same(await queueTitles(page), ["First Song", "Second Song", "Third Song"]), JSON.stringify(await queueTitles(page)));
check("queue: the current track is marked", (await queuePanel(page).locator("[aria-current=true]").innerText()).includes("First Song"));

// drag to reorder
await queuePanel(page).getByRole("listitem").nth(2).dragTo(queuePanel(page).getByRole("listitem").nth(1));
await page.waitForFunction(() => document.querySelectorAll(".qp-row .qp-title span:first-child")[1]?.textContent === "Third Song");
check("queue: dragging a track puts it in another's place", same(await queueTitles(page), ["First Song", "Third Song", "Second Song"]), JSON.stringify(await queueTitles(page)));
check("queue: …and the playing track keeps playing", (await showingTitle(page)) === "First Song" && (await bar(page).getByRole("button", { name: "Pause", exact: true }).count()) === 1);

// jump, remove
await queuePanel(page).getByRole("button", { name: "Play Second Song" }).click();
await page.waitForFunction(() => document.querySelector(".pb-title")?.textContent === "Second Song");
check("queue: clicking a track plays it", (await calls(page, "play_in_app")).at(-1).args.path === `${DL}/Second Song.mp3`);
await queuePanel(page).getByRole("button", { name: "Remove Third Song from the queue" }).click();
check("queue: a track can be removed", same(await queueTitles(page), ["First Song", "Second Song"]) && (await showingTitle(page)) === "Second Song");

// it goes on by itself, and stops at the end
await queuePanel(page).getByRole("button", { name: "Play First Song" }).click();
await page.waitForFunction(() => document.querySelector(".pb-title")?.textContent === "Second Song", null, { timeout: 12000 });
check("queue: when a track ends the next one starts by itself", true);
await bar(page).getByRole("button", { name: "Play", exact: true }).waitFor({ timeout: 12000 });
check("queue: at the end of the queue it stops, staying on the last track", (await showingTitle(page)) === "Second Song");

// repeat
const repeatBtn = () => bar(page).getByRole("button", { name: /^Repeat:/ });
check("queue: repeat starts off", (await repeatBtn().getAttribute("aria-label")) === "Repeat: off");
await repeatBtn().click();
check("queue: repeat the whole queue", (await repeatBtn().getAttribute("aria-label")) === "Repeat: the whole queue");
await repeatBtn().click();
check("queue: repeat this track", (await repeatBtn().getAttribute("aria-label")) === "Repeat: this track");
await repeatBtn().click();
await repeatBtn().click();
await queuePanel(page).getByRole("button", { name: "Play First Song" }).click();
await page.waitForFunction(() => document.querySelector(".pb-title")?.textContent === "Second Song", null, { timeout: 12000 });
await page.waitForFunction(() => document.querySelector(".pb-title")?.textContent === "First Song", null, { timeout: 12000 });
await bar(page).getByRole("button", { name: "Pause", exact: true }).waitFor({ timeout: 8000 });
check("queue: repeating the queue starts it over after the last track", true);

// shuffle
const shuffleBtn = () => bar(page).getByRole("button", { name: "Shuffle", exact: true });
await shuffleBtn().click();
check("queue: shuffle is shown as on, and the current track stays", (await shuffleBtn().getAttribute("aria-pressed")) === "true" && (await showingTitle(page)) === "First Song");
await shuffleBtn().click();
check("queue: turning it off puts the order back", (await shuffleBtn().getAttribute("aria-pressed")) === "false" && same(await queueTitles(page), ["First Song", "Second Song"]));

// keyboard next / previous
await page.locator("main").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("Control+Shift+ArrowRight");
await page.waitForFunction(() => document.querySelector(".pb-title")?.textContent === "Second Song");
check("queue: Ctrl+Shift+→ plays the next track", true);
await page.keyboard.press("Control+Shift+ArrowLeft");
await page.waitForFunction(() => document.querySelector(".pb-title")?.textContent === "First Song");
check("queue: Ctrl+Shift+← goes back", true);

// clearing
await queuePanel(page).getByRole("button", { name: "Clear queue" }).click();
check("queue: clearing it closes the bar", (await bar(page).count()) === 0 && (await queuePanel(page).count()) === 0);
await page.context().close();

// from a selection in History
page = await open({ history: [...SONGS, VIDEO_ROW], store: { warnDuplicates: false }, mock: { audioSeconds: 30 } });
await nav(page, "History").click();
await page.getByLabel('Select "First Song"').check();
await page.getByLabel('Select "A Movie"').check();
await page.getByLabel('Select "Third Song"').check();
const selection = page.getByRole("toolbar", { name: "Selected items" });
await selection.getByRole("button", { name: "Play 2 songs" }).click();
await bar(page).waitFor();
await bar(page).getByRole("button", { name: "Show the queue" }).click();
const picked = await queueTitles(page);
check("queue: ticked songs play together, leaving out the video", picked.length === 2 && picked.includes("First Song") && picked.includes("Third Song"), JSON.stringify(picked));
await page.getByLabel('Select "Second Song"').check();
await selection.getByRole("button", { name: "Add to queue" }).click();
await page.waitForFunction(() => document.querySelectorAll(".qp-row").length >= 3);
check("queue: ticked songs can be added to the end", (await queueTitles(page)).length >= 3);
await page.context().close();

// it comes back after a restart
page = await open({ history: SONGS, store: { warnDuplicates: false }, mock: { audioSeconds: 30 } });
await nav(page, "History").click();
await playOnRow(page, "First Song");
await bar(page).waitFor();
await fileAction(page.locator("tr", { hasText: "Second Song" }).first(), "Add to queue");
await fileAction(page.locator("tr", { hasText: "Third Song" }).first(), "Add to queue");
await bar(page).getByRole("button", { name: "Pause", exact: true }).click();
await page.waitForFunction(() => JSON.parse(localStorage.getItem("__store")).player?.queue?.length === 3, null, { timeout: 8000 });
await page.reload();
await page.waitForSelector("input[type=text]");
await bar(page).waitFor();
check("queue: the whole queue is back after a restart", (await bar(page).getByRole("button", { name: "Show the queue" }).innerText()).includes("3"));
await page.context().close();

await done();
