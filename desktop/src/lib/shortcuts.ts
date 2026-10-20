export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** What the cheat sheet shows. The key handling itself lives in App, next to the actions it triggers. */
export const SHORTCUT_GROUPS: Array<{ title: string; items: Array<{ keys: string[]; action: string }> }> = [
  {
    title: "Search",
    items: [
      { keys: ["Mod", "F"], action: "Focus the search box (also Mod+L, Mod+K)" },
      { keys: ["Mod", "A"], action: "Select all results" },
      { keys: ["Esc"], action: "Clear the selection, or leave the search box" },
      { keys: ["Menu key"], action: "Open the context menu on the focused result (or Shift+F10)" },
    ],
  },
  {
    title: "Downloading",
    items: [
      { keys: ["Mod", "D"], action: "Download the open video" },
      { keys: ["Mod", "Shift", "D"], action: "Download the open video as audio" },
      { keys: ["Mod", "Shift", "P"], action: "Pause or resume all downloads" },
      { keys: ["Mod", "O"], action: "Open the download folder" },
    ],
  },
  {
    title: "Go to",
    items: [
      { keys: ["Mod", "1"], action: "Search" },
      { keys: ["Mod", "2"], action: "Downloads" },
      { keys: ["Mod", "3"], action: "History" },
      { keys: ["Mod", "4"], action: "Settings (also Mod+,)" },
      { keys: ["F1"], action: "Show this list (also Mod+/)" },
    ],
  },
];

export const modLabel = IS_MAC ? "⌘" : "Ctrl";
