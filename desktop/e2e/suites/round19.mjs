// Native select text sizing and row context menus, including keyboard access and selection scope.
import { open, check, calls, nav, submit, details, results, waitCalls, done } from "../harness.mjs";
const root = "/home/u/Downloads";
const history = ["Alpha", "Beta", "Missing"].map((title, i) => ({ id: title, title, path: `${root}/${title}.mp3`, url: `https://example.com/${title}`, preset: "audio", thumbnail: "", timestamp: Date.now() - i * 1000 }));
const row = (page, id) => page.locator(`[data-history-id="${id}"]`);
const menu = (page) => page.getByRole("menu");
const fit = async (page) => page.locator("select").evaluateAll((elements) => elements.filter((el) => el.getClientRects().length > 0).map((el) => {
  const style = getComputedStyle(el); const canvas = document.createElement("canvas"); const ctx = canvas.getContext("2d"); ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const label = el.selectedOptions[0]?.textContent ?? "";
  const text = ctx.measureText(label).width;
  return { label, fits: el.clientWidth >= text + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) - 1 && el.clientHeight >= parseFloat(style.fontSize) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) - 1 };
}));
let page = await open({ history, mock: { missing: [`${root}/Missing.mp3`] }, store: { mode: "advanced", warnDuplicates: false } });
for (const width of [1060, 760]) {
  await page.setViewportSize({ width, height: 700 });
  for (const section of ["Search", "Downloads", "History", "Library", "Settings"]) {
    await nav(page, section).click();
    if (section === "Settings") await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
    const fields = await fit(page);
    check(`dropdowns: ${section} selected text fits at ${width}px`, fields.every((x) => x.fits), JSON.stringify(fields.filter((x) => !x.fits)));
    check(`dropdowns: ${section} frame fits at ${width}px`, await page.locator(".app").evaluate((el) => el.scrollWidth <= innerWidth && el.scrollHeight <= innerHeight));
  }
}
await nav(page, "Downloads").click(); await page.screenshot({ path: "src-tauri/target/dropdown-sizing.png" });
await nav(page, "History").click();
for (const view of ["Details", "List", "Grid", "Compact"]) {
  await page.getByRole("radio", { name: `${view} view`, exact: true }).click();
  await row(page, "Alpha").click({ button: "right" });
  check(`history context: right-click opens in ${view}`, await menu(page).getByRole("menuitem", { name: "Play in Kaisu", exact: true }).count() === 1);
  await page.keyboard.press("Escape");
  check(`history context: Escape returns row focus in ${view}`, await row(page, "Alpha").evaluate((el) => el === document.activeElement));
}
await row(page, "Alpha").focus(); await page.keyboard.press("Shift+F10");
check("history context: keyboard access uses the focused row", (await menu(page).innerText()).startsWith("ALPHA"));
await menu(page).getByRole("menuitem", { name: "Show in folder", exact: true }).click();
check("history context: operations use the right-clicked file", (await calls(page, "reveal_file")).at(-1).args.path === history[0].path);
await row(page, "Missing").click({ button: "right" });
check("history context: missing-file playback is disabled but its path can be copied", await menu(page).getByRole("menuitem", { name: "Play in Kaisu", exact: true }).isDisabled() && await menu(page).getByRole("menuitem", { name: "Copy file location", exact: true }).isEnabled());
await menu(page).getByRole("menuitem", { name: "Remove from history", exact: true }).click();
check("history context: removing an entry does not delete its file", (await calls(page, "delete_files")).length === 0 && await row(page, "Missing").count() === 0);
await page.getByRole("checkbox", { name: 'Select "Alpha"', exact: true }).check(); await page.getByRole("checkbox", { name: 'Select "Beta"', exact: true }).check();
await row(page, "Beta").getByRole("checkbox").click({ button: "right" });
check("history context: a selected checkbox exposes selection actions", await page.getByRole("menu", { name: "Selected history actions", exact: true }).count() === 1);
await menu(page).getByRole("menuitem", { name: "Play 2 songs", exact: true }).click();
await waitCalls(page, "play_in_app", 1);
check("history context: selection playback preserves both songs", (await page.evaluate(() => JSON.parse(localStorage.getItem("__store")).player.queue)).length === 2);
await row(page, "Beta").click({ button: "right" }); await menu(page).getByRole("menuitem", { name: "Remove selected from history", exact: true }).click();
check("history context: selection removal affects exactly the selected entries", await page.getByRole("heading", { name: "No downloads yet", exact: true }).count() === 1 && (await calls(page, "delete_files")).length === 0);
await page.context().close();

page = await open({ mock: { dlDelay: 20000 }, store: { mode: "advanced", concurrency: 1, warnDuplicates: false } });
await submit(page, "lofi beats"); await results(page).locator("tbody tr").first().waitFor();
for (const i of [0, 1, 2]) await results(page).locator("tbody tr").nth(i).getByRole("checkbox").check();
await page.getByRole("button", { name: /Download 3 videos/ }).click(); await waitCalls(page, "start_download", 1); await nav(page, "Downloads").click();
const download = (title) => page.locator("[data-download-id]").filter({ hasText: title }).first();
for (const view of ["Details", "List", "Grid", "Compact"]) {
  await page.getByRole("radio", { name: `${view} view`, exact: true }).click();
  await download("result 3").click({ button: "right" });
  check(`download context: waiting actions appear in ${view}`, await menu(page).getByRole("menuitem", { name: "Download this next", exact: true }).count() === 1);
  await page.keyboard.press("Escape");
}
await download("result 3").focus(); await page.keyboard.press("Shift+F10"); await menu(page).getByRole("menuitem", { name: "Download this next", exact: true }).click();
check("download context: waiting order can be changed", (await download("result 3").innerText()).includes("#1"));
await download("result 2").click({ button: "right" }); await menu(page).getByRole("menuitem", { name: "Speed limit", exact: true }).click();
await page.getByRole("dialog", { name: "Speed limit", exact: true }).getByLabel("Speed limit", { exact: true }).fill("500K");
await page.getByRole("button", { name: "Set limit", exact: true }).click();
check("download context: speed-limit changes apply to the chosen download", (await download("result 2").getByRole("button", { name: "Speed limit", exact: true }).getAttribute("title")).includes("500K"));
await download("result 1").click({ button: "right" }); await menu(page).getByRole("menuitem", { name: "Pause download", exact: true }).click();
await download("result 1").getByRole("button", { name: "Resume download", exact: true }).waitFor();
await download("result 1").click({ button: "right" });
check("download context: actions follow the latest status", await menu(page).getByRole("menuitem", { name: "Resume download", exact: true }).count() === 1 && await menu(page).getByRole("menuitem", { name: "Pause download", exact: true }).count() === 0);
await page.keyboard.press("Escape");
await download("result 2").click({ button: "right" }); await menu(page).getByRole("menuitem", { name: "Cancel download", exact: true }).click();
await download("result 2").click({ button: "right" });
check("download context: cancelled downloads expose retry and removal", await menu(page).getByRole("menuitem", { name: "Try again", exact: true }).count() === 1);
await menu(page).getByRole("menuitem", { name: "Remove from list", exact: true }).click();
check("download context: removal keeps the other downloads", await page.locator("[data-download-id]").count() === 2);
await page.context().close();

page = await open({ store: { warnDuplicates: false } });
await submit(page, "https://www.youtube.com/watch?v=pasted00001"); await details(page).waitFor(); await details(page).getByRole("button", { name: "Download video", exact: true }).click();
await nav(page, "Downloads").click(); await page.locator(".progress.done").waitFor();
await page.locator("[data-download-id]").click({ button: "right" });
check("download context: completed downloads expose file operations", await menu(page).getByRole("menuitem", { name: "Open file", exact: true }).count() === 1 && await menu(page).getByRole("menuitem", { name: "Cancel download", exact: true }).count() === 0);
await menu(page).getByRole("menuitem", { name: "Open file", exact: true }).click();
check("download context: opening uses the completed file", (await calls(page, "open_file")).length === 1);
await page.context().close();
await done();
