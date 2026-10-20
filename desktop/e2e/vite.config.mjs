// Serves the real app with the Tauri bindings swapped for scripted stand-ins (./mock), so the whole UI can be
// driven in a normal browser. Used by e2e/run.mjs; it never touches the production build.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const mock = (file) => resolve(here, "mock", file);

export default defineConfig({
  root: resolve(here, ".."),
  cacheDir: resolve(here, ".vite-cache"),
  logLevel: "warn",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@tauri-apps/api/core": mock("core.ts"),
      "@tauri-apps/api/window": mock("window.ts"),
      "@tauri-apps/api/event": mock("event.ts"),
      "@tauri-apps/plugin-store": mock("store.ts"),
      "@tauri-apps/plugin-dialog": mock("dialog.ts"),
      "@tauri-apps/plugin-clipboard-manager": mock("clipboard.ts"),
      "@tauri-apps/plugin-notification": mock("notification.ts"),
    },
  },
  server: { fs: { strict: false } },
});
