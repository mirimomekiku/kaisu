import type { CustomizationValues } from "./customization";
const customVariables = ["--window", "--paper", "--stripe", "--ink", "--ink-2", "--ink-3", "--ink-inv", "--hairline", "--edge", "--edge-dark", "--blue-1", "--blue-2", "--blue-3", "--blue-4", "--blue-edge", "--select-1", "--select-2", "--custom-sidebar"];
export function applyCustomization(root: HTMLElement, settings: CustomizationValues) {
  const { appearance: a, sidebar, customTheme: t } = settings;
  root.dataset.density = a.density;
  root.dataset.artworkShape = a.artwork;
  root.dataset.reducedMotion = String(a.reducedMotion);
  root.style.setProperty("--ui-font-size", `${a.fontSize}px`);
  root.style.setProperty("--sidebar-width", `${sidebar.width}px`);
  root.dataset.customTheme = String(t.enabled);
  if (!t.enabled) { for (const key of customVariables) root.style.removeProperty(key); root.style.removeProperty("color-scheme"); return; }
  const c = t.colors;
  const values = [c.window, c.surface, c.window, c.text, c.muted, c.muted, c.selectionText, c.border, c.border, c.border, c.accent, c.accent, c.accent, c.accent, c.accent, c.accent, c.accent, c.sidebar];
  customVariables.forEach((key, i) => root.style.setProperty(key, values[i]));
  const rgb = [1, 3, 5].map((i) => parseInt(c.surface.slice(i, i + 2), 16));
  root.style.colorScheme = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 < 128 ? "dark" : "light";
}
