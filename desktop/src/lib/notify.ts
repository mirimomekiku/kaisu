import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

let permission: Promise<boolean> | null = null;

const allowed = () =>
  (permission ??= isPermissionGranted().then(async (granted) => granted || (await requestPermission()) === "granted").catch(() => false));

/** Shows a desktop notification. Quietly does nothing if the OS or the user doesn't allow them. */
export async function notify(title: string, body?: string): Promise<void> {
  try {
    if (await allowed()) sendNotification({ title, body });
  } catch (e) {
    console.warn("notification failed", e);
  }
}
