// Bulk auto-tag: consent first, nothing written before review, close matches ticked, others left for the user.
import { open, check, calls, nav, chooseMenu, done } from "../harness.mjs";
const song = (title, extra = {}) => ({ path: `/home/u/Music/${title}.mp3`, title, artist: "Band", album_artist: "", album: "", genre: "", year: null, track: null, disc: null, duration: 180, bitrate: 192, sample_rate: 44100, bit_depth: null, channels: 2, format: "MP3", size: 1000, modified: 1000, added: 1000, has_cover: false, loudness: -18, ...extra });
const ids = { one: "11111111-1111-4111-8111-111111111111", two: "22222222-2222-4222-8222-222222222222" };
const rel = "33333333-3333-4333-8333-333333333333";
const candidate = (id, title, score, duration) => [{ id, title, artist: "Band", duration, score, releases: [{ id: rel, title: "Debut", date: "2001-05-01", country: "US", edition: "" }] }];
const mock = {
  library: [song("one"), song("two"), song("three")],
  identifyByTitle: { one: candidate(ids.one, "One", 99, 181), two: candidate(ids.two, "Two", 70, 181), three: [] },
  identifyTagsById: {
    [ids.one]: { title: "One", artist: "Band", album: "Debut", album_artist: "Band", track: "1", disc: "1", year: "2001", genre: null },
    [ids.two]: { title: "Two", artist: "Band", album: "Debut", album_artist: "Band", track: "2", disc: "1", year: "2001", genre: null },
  },
};
const page = await open({ mock });
await nav(page, "Library").click();
await page.getByRole("checkbox", { name: "Select all shown songs", exact: true }).check();
await page.getByRole("button", { name: "Selected actions", exact: true }).click();
await page.getByRole("menuitem", { name: "Auto-tag selected songs", exact: true }).click();
const dialog = page.getByRole("dialog", { name: "Auto-tag songs", exact: true });
await dialog.waitFor();
check("bulk: lookup needs consent first", await dialog.getByRole("button", { name: /^Look up 3 songs/ }).isDisabled() && (await calls(page, "identify_search")).length === 0);
await dialog.getByRole("checkbox", { name: /^Allow sending/ }).check();
await dialog.getByRole("button", { name: /^Look up 3 songs/ }).click();
await dialog.getByRole("table", { name: "Proposed tag changes" }).waitFor();
check("bulk: every song is searched by title and artist, never by path", (await calls(page, "identify_search")).length === 3 && (await calls(page, "identify_search")).every((c) => c.args.artist === "Band"));
check("bulk: nothing is written during lookup", (await calls(page, "library_edit_tags")).length === 0);
const useBox = (t) => dialog.getByRole("checkbox", { name: `Apply changes to ${t}`, exact: true });
check("bulk: a close match is ticked and a weak one is not", await useBox("one").isChecked() && !(await useBox("two").isChecked()));
check("bulk: songs without a match are listed as unchanged", (await dialog.locator("details").textContent()).includes("three — No match found"));
check("bulk: the second song reuses the first song's release", (await calls(page, "identify_details")).every((c) => c.args.releaseId === rel));
await dialog.getByRole("button", { name: "Apply to 1 song", exact: true }).click();
await dialog.getByText("Updated 1 song.", { exact: true }).waitFor();
const edits = await calls(page, "library_edit_tags");
check("bulk: only the ticked song is written, with its own tags", edits.length === 1 && edits[0].args.paths[0].endsWith("one.mp3") && edits[0].args.edit.album === "Debut" && edits[0].args.edit.track === "1");
check("bulk: a missing cover is fetched once for the ticked song and saved with its tags", (await calls(page, "identify_cover")).length === 1 && edits[0].args.edit.artwork?.token === "identified-cover");
await page.context().close();

// ---- covers can be left alone, and a release without a cover does not block the tags ----
const plain = await open({ mock });
await nav(plain, "Library").click();
await plain.getByRole("checkbox", { name: "Select all shown songs", exact: true }).check();
await plain.getByRole("button", { name: "Selected actions", exact: true }).click();
await plain.getByRole("menuitem", { name: "Auto-tag selected songs", exact: true }).click();
const d3 = plain.getByRole("dialog", { name: "Auto-tag songs", exact: true });
await d3.getByRole("checkbox", { name: /^Allow sending/ }).check();
await d3.getByLabel("Front covers", { exact: true }).selectOption("none");
await d3.getByRole("button", { name: /^Look up 3 songs/ }).click();
await d3.getByRole("table", { name: "Proposed tag changes" }).waitFor();
await d3.getByRole("button", { name: "Apply to 1 song", exact: true }).click();
await d3.getByText("Updated 1 song.", { exact: true }).waitFor();
check("bulk: leaving covers alone fetches none", (await calls(plain, "identify_cover")).length === 0 && !(await calls(plain, "library_edit_tags"))[0].args.edit.artwork);
await plain.context().close();

const nocover = await open({ mock: { ...mock, identifyCoverFail: true } });
await nav(nocover, "Library").click();
await nocover.getByRole("checkbox", { name: "Select all shown songs", exact: true }).check();
await nocover.getByRole("button", { name: "Selected actions", exact: true }).click();
await nocover.getByRole("menuitem", { name: "Auto-tag selected songs", exact: true }).click();
const d4 = nocover.getByRole("dialog", { name: "Auto-tag songs", exact: true });
await d4.getByRole("checkbox", { name: /^Allow sending/ }).check();
await d4.getByRole("button", { name: /^Look up 3 songs/ }).click();
await d4.getByRole("table", { name: "Proposed tag changes" }).waitFor();
await d4.getByRole("button", { name: "Apply to 1 song", exact: true }).click();
await d4.getByText("Updated 1 song.", { exact: true }).waitFor();
check("bulk: a missing cover is reported and the tags are still saved", (await d4.getByRole("status", { name: "Cover notes" }).innerText()).includes("no front cover") && (await calls(nocover, "library_edit_tags")).length === 1);
await nocover.context().close();

const refused = await open({ mock: { ...mock, identifyFail: true } });
await nav(refused, "Library").click();
await refused.getByRole("checkbox", { name: "Select all shown songs", exact: true }).check();
await refused.getByRole("button", { name: "Selected actions", exact: true }).click();
await refused.getByRole("menuitem", { name: "Auto-tag selected songs", exact: true }).click();
const d2 = refused.getByRole("dialog", { name: "Auto-tag songs", exact: true });
await d2.getByRole("checkbox", { name: /^Allow sending/ }).check();
await d2.getByRole("button", { name: /^Look up 3 songs/ }).click();
await d2.getByRole("alert").waitFor();
check("bulk: an unreachable service stops the run instead of failing every song", (await calls(refused, "identify_search")).length === 1);
await refused.context().close();
await done();
