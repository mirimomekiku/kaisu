// Experimental MTP phones in portable sync: offered as devices, clearly labelled, created only on request.
import { open, check, calls, nav, chooseMenu, done } from "../harness.mjs";
const song = { path: "/home/u/Music/a.mp3", title: "a", artist: "Band", album_artist: "", album: "Album", genre: "", year: 2001, track: 1, disc: 1, duration: 180, bitrate: 192, sample_rate: 44100, bit_depth: null, channels: 2, format: "MP3", size: 1000, modified: 1, added: 1, has_cover: false, loudness: -18 };
const phone = { id: "mtp:usb#vid_18d1#abc|s10001", label: "Pixel — Internal storage (MTP, experimental)", location: "", transport: "mtp" };
const page = await open({ mock: { library: [song], portableDevices: [phone] } });
await nav(page, "Library").click(); await chooseMenu(page, "Library tools", "Portable collection sync");
const sync = page.getByRole("dialog", { name: "Portable collection sync", exact: true });
await sync.getByText(phone.label, { exact: true }).waitFor();
check("mtp: a phone is listed but nothing is created or written by detecting it", (await calls(page, "portable_sync_create")).length === 0 && (await calls(page, "portable_sync_apply")).length === 0);
check("mtp: the list explains the experimental limits", (await sync.innerText()).includes("only adds new files, never replaces one"));
await sync.getByRole("button", { name: "Create profile for this device", exact: true }).click();
await sync.getByLabel("Portable profile name", { exact: true }).waitFor();
check("mtp: the profile is made for the chosen storage", (await calls(page, "portable_sync_create")).at(-1).args.deviceId === phone.id);
check("mtp: the profile says device, not folder", await sync.getByRole("status").filter({ hasText: "Device connected" }).count() === 1);
await page.context().close();
await done();
