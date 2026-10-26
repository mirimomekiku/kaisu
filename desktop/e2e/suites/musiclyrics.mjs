import { open, check, calls, waitCalls, details, submit, nav, done } from "../harness.mjs";
const sourceSubmit = async (page, text) => { const input = page.getByLabel(/^Search .* or paste a link$/); await input.fill(text); await input.press("Enter"); };
const start = async (source, consent) => {
  const page = await open({ store: { searchSource: source, lyricsConsent: consent, warnDuplicates: false }, mock: { manualDownloads: true } });
  await sourceSubmit(page, "https://www.youtube.com/watch?v=pasted00001");
  await details(page).getByRole("radio", { name: /Audio only/ }).click();
  return page;
};
let page = await start("youtube_music", false);
check("lyrics: YouTube Music explains automatic file saving and embedding in Simple mode", (await details(page).innerText()).includes("save the lyrics file and embed lyrics automatically") && await details(page).getByLabel("Lyrics", { exact: true }).count() === 0);
await details(page).getByRole("button", { name: "Download audio", exact: true }).click();
await page.getByRole("alertdialog").getByRole("button", { name: "Allow lookup", exact: true }).click();
await waitCalls(page, "start_download", 1);
check("lyrics: accepting consent queues both a lyrics file and embedded lyrics", (await calls(page, "start_download"))[0].args.req.extra.lyrics === "both");
await page.context().close();

page = await start("youtube_music", false);
await details(page).getByRole("button", { name: "Download audio", exact: true }).click();
await page.getByRole("alertdialog").getByRole("button", { name: "No lyrics", exact: true }).click();
await waitCalls(page, "start_download", 1);
check("lyrics: declining online consent still downloads audio without lyrics", (await calls(page, "start_download"))[0].args.req.extra.lyrics === "off");
await page.context().close();

page = await start("youtube", true);
await details(page).getByLabel("Lyrics", { exact: true }).selectOption("embed");
await details(page).getByRole("button", { name: "Download audio", exact: true }).click();
await waitCalls(page, "start_download", 1);
check("lyrics: other sources respect a user-selected option in Simple mode", (await calls(page, "start_download"))[0].args.req.extra.lyrics === "embed");
await page.context().close();

page = await open({ store: { searchSource: "soundcloud", lyricsConsent: true, warnDuplicates: false }, mock: { manualDownloads: true } });
await sourceSubmit(page, "lofi beats");
await page.getByLabel("Batch audio lyrics", { exact: true }).selectOption("file");
await page.getByRole("checkbox", { name: /^Select .*result 1 \(SC\)$/ }).check();
const selected = page.getByRole("region", { name: "Selected videos" });
await selected.getByRole("button", { name: /audio/i }).click();
await waitCalls(page, "start_download", 1);
check("lyrics: batch downloads from other sources preserve the selected lyrics-file option", (await calls(page, "start_download"))[0].args.req.extra.lyrics === "file");
await nav(page, "Downloads").click();
await page.context().close();
await done();
