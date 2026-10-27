// In-app updater: offered only when the app can verify updates, installs without restarting, and restarts on request.
import { open, check, nav, done } from "../harness.mjs";
const banner = (p) => p.getByRole("status", { name: "Kaisu update available" });

let page = await open({ mock: { appLatest: "0.0.5", appInstallable: true } });
await banner(page).waitFor();
check("update: a verifiable release offers Install update beside the release notes", await page.getByRole("button", { name: "Install update", exact: true }).count() === 1 && await page.getByRole("button", { name: "See what's new", exact: true }).count() === 1);
check("update: nothing is installed until asked", await page.evaluate(() => !(window.__mock.appInstalls ?? []).length));
await page.getByRole("button", { name: "Install update", exact: true }).click();
await page.getByRole("button", { name: "Restart Kaisu", exact: true }).waitFor();
check("update: the chosen version is the one installed", await page.evaluate(() => JSON.stringify(window.__mock.appInstalls)) === '["0.0.5"]');
check("update: installing does not restart by itself", await page.evaluate(() => !window.__mock.appRestarted));
check("update: the banner says the new version is installed", (await banner(page).innerText()).includes("Kaisu 0.0.5 is installed"));
await page.getByRole("button", { name: "Restart Kaisu", exact: true }).click();
check("update: restarting is a separate, explicit step", await page.evaluate(() => window.__mock.appRestarted === true));
await page.context().close();

page = await open({ mock: { appLatest: "0.0.5" } });
await banner(page).waitFor();
check("update: without a configured key only the releases page is offered", await page.getByRole("button", { name: "Install update", exact: true }).count() === 0 && await page.getByRole("button", { name: "See what's new", exact: true }).count() === 1);
await page.context().close();

page = await open({ mock: { appLatest: "0.0.5", appInstallable: true, appInstallFail: "The update's signature did not match, so it was not installed." } });
await banner(page).waitFor();
await page.getByRole("button", { name: "Install update", exact: true }).click();
await page.getByRole("alert").filter({ hasText: "signature did not match" }).waitFor();
check("update: a refused update shows why and can be tried again or read about", await page.getByRole("button", { name: "Install update", exact: true }).count() === 1 && await page.getByRole("button", { name: "Restart Kaisu", exact: true }).count() === 0);
await page.context().close();

page = await open({ mock: { appLatest: "0.0.5", appInstallable: true }, store: { appUpdateDismissed: "0.0.5", appUpdateLastCheck: 0 } });
await nav(page, "Settings").click();
await page.getByLabel("Settings section", { exact: true }).selectOption("All settings");
await page.getByRole("button", { name: "Check Kaisu for updates", exact: true }).click();
const settings = page.getByRole("main", { name: "settings" });
await settings.getByRole("button", { name: "Install update", exact: true }).waitFor();
await settings.getByRole("button", { name: "Install update", exact: true }).click();
await page.getByText("Kaisu 0.0.5 is installed. Restart to start using it.").first().waitFor();
check("update: Settings can install a dismissed release too", true);
await page.context().close();
await done();
