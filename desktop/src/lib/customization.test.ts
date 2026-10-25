import { describe, expect, it } from "vitest";
import { applyCustomization } from "./customizationDom";
import { builtinCustomizationPresets, contrast, customizationSnapshot, defaultCustomization, defaultCustomTheme, exportTheme, importTheme, NAV_ITEMS, sanitizeAppearance, sanitizeCustomTheme, sanitizeCustomization, sanitizeCustomizationPresets, sanitizeSeek, sanitizeSidebar, themeProblem } from "./customization";

describe("customization validation", () => {
  it("keeps old settings on defaults and bounds imported interface and seek options", () => {
    expect(sanitizeCustomization({})).toEqual(defaultCustomization());
    expect(sanitizeAppearance({ fontSize: 1000, density: "bad", artwork: "bad" })).toMatchObject({ fontSize: 16, density: "comfortable", artwork: "rounded" });
    expect(sanitizeSeek({ backward: -1, forward: Infinity, fine: 99, wheel: "script" })).toMatchObject({ backward: 1, forward: 10, fine: 10, wheel: "off" });
  });
  it("restores unknown/missing sidebar sections, keeps Settings reachable, deduplicates and caps pins", () => {
    const s = sanitizeSidebar({ order: ["library", "library", "unknown"], hidden: ["settings", "history", "history", "unknown"], width: -20, playlistPins: ["bad/id", ...Array.from({ length: 30 }, (_, i) => `p-${i}`)] });
    expect(s.order[0]).toBe("library"); expect(new Set(s.order).size).toBe(NAV_ITEMS.length);
    expect(s.hidden).toEqual(["history"]); expect(s.width).toBe(160); expect(s.playlistPins).toHaveLength(20);
  });
  it("only accepts hex colors and disables unreadable saved palettes", () => {
    const d = defaultCustomTheme();
    expect(themeProblem(d)).toBeNull(); expect(contrast("#000000", "#ffffff")).toBe(21);
    expect(sanitizeCustomTheme({ ...d, enabled: true, colors: { ...d.colors, text: "url(https://example.com)" } }).colors.text).toBe(d.colors.text);
    expect(sanitizeCustomTheme({ ...d, enabled: true, colors: { ...d.colors, text: "#ffffff" } }).enabled).toBe(false);
  });
  it("round-trips portable themes and rejects arbitrary CSS, poor contrast and unsupported files", () => {
    const theme = defaultCustomTheme();
    expect(importTheme(exportTheme(theme))).toEqual({ ...theme, enabled: true });
    for (const raw of ["{}", "not json", JSON.stringify({ kind: "kaisu-theme", version: 2, name: "x" }), exportTheme({ ...theme, colors: { ...theme.colors, accent: "#ffffff" } }), exportTheme({ ...theme, colors: { ...theme.colors, border: "red;display:none" } }), " ".repeat(32769)]) expect(() => importTheme(raw)).toThrow();
  });
  it("preset snapshots are isolated and contain no download or playback settings", () => {
    const settings = { ...defaultCustomization(), proxy: "private", outDir: "private", waveformSeek: true, rate: 2 };
    const snapshot = customizationSnapshot(settings);
    expect(Object.keys(snapshot).sort()).toEqual(Object.keys(defaultCustomization()).sort());
    snapshot.sidebar.order.reverse(); expect(settings.sidebar.order[0]).toBe("search");
    const builtins = builtinCustomizationPresets(); expect(builtins.map((p) => p.name)).toEqual(["Classic", "Compact", "Study"]);
    expect(builtins[2].values.seekPreferences.forward).toBe(30);
  });
  it("deduplicates custom presets and prevents overriding built-ins", () => {
    const values = defaultCustomization(), a = { id: "p1", name: "One", values };
    expect(sanitizeCustomizationPresets([a, a, { id: "p2", name: "one", values }, { id: "builtin-classic", name: "Override", values }, null])).toEqual([a]);
    expect(sanitizeCustomizationPresets(Array.from({ length: 25 }, (_, i) => ({ ...a, id: `p${i}`, name: `Name ${i}` })))).toHaveLength(20);
  });
  it("removes custom CSS variables when switching back to a base theme", () => {
    const properties = new Map<string, string>();
    const root = { dataset: {}, style: { setProperty: (key: string, value: string) => properties.set(key, value), removeProperty: (key: string) => properties.delete(key) } } as unknown as HTMLElement;
    const values = defaultCustomization(); values.customTheme.enabled = true; applyCustomization(root, values);
    expect(properties.get("--paper")).toBe("#ffffff"); expect(root.dataset.customTheme).toBe("true");
    values.customTheme.enabled = false; applyCustomization(root, values);
    expect(properties.has("--paper")).toBe(false); expect(root.dataset.customTheme).toBe("false"); expect(properties.get("--ui-font-size")).toBe("12px");
  });
});
