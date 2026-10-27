# Send to Kaisu (browser extension)

Sends the page, link, video or audio you are looking at to the Kaisu desktop app. Kaisu opens with the address ready to
review; **nothing downloads until you choose**. The extension has no server, no account and no network access: it only
opens a `kaisu://add?url=...` link on your computer.

## Use
- Click the toolbar button to send the current page.
- Right-click a page, link, video or audio > **Send to Kaisu**.
- Right-click the toolbar button > **Send all tabs in this window to Kaisu**.

## Set up
1. In Kaisu: Settings > **Let the browser extension send links to Kaisu**. This adds a per-user `kaisu://` link type
   (Windows registry for your user, or a Linux desktop entry) that points at the Kaisu you are running. Turn it off to remove it.
2. Load the extension:
   - Chrome or Edge: open `chrome://extensions` (or `edge://extensions`), enable Developer mode, **Load unpacked**, choose this folder.
   - Firefox: open `about:debugging#/runtime/this-firefox`, **Load Temporary Add-on**, choose `manifest.json`.
3. The first time, the browser asks whether it may open Kaisu. Allow it (tick "always" if offered).

Only `http` and `https` addresses without a username or password are sent, up to 20 per link. Kaisu applies its own
checks again and ignores anything else.

## Permissions
`contextMenus` (the right-click items), `activeTab` and `scripting` (open the link from the page you chose),
`tabs` (read tab addresses for "all tabs").

## Test
`node --test extension/kaisu-link.test.mjs` runs the link-building tests.
