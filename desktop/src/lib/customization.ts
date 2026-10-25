/** Local customization values. Imported colors are hex only, never arbitrary CSS. */
export const NAV_ITEMS = ["search", "downloads", "sources", "history", "library", "podcasts", "settings"] as const;
export type NavItem = typeof NAV_ITEMS[number];
export const NAV_LABELS: Record<NavItem, string> = { search: "Search", downloads: "Downloads", sources: "Saved sources", history: "History", library: "Library", podcasts: "Podcasts", settings: "Settings" };
export interface Appearance { fontSize: number; density: "compact" | "comfortable"; artwork: "rounded" | "square" | "circle"; reducedMotion: boolean }
export interface SidebarOptions { order: NavItem[]; hidden: NavItem[]; width: number; showArtwork: boolean; showCounts: boolean; playlistPins: string[]; sourcePins: string[] }
export interface SeekPreferences { backward: number; forward: number; fine: number; wheel: "off" | "seek"; wheelInverted: boolean }
export const COLOR_LABELS = { window: "Window background", surface: "Content background", text: "Text", muted: "Secondary text", accent: "Accent", selectionText: "Selection text", sidebar: "Sidebar background", border: "Borders" };
export type ThemeColors = Record<keyof typeof COLOR_LABELS, string>;
export interface CustomTheme { enabled: boolean; name: string; colors: ThemeColors }
export interface CustomizationValues {
  theme: "system" | "aqua" | "graphite" | "dark";
  accent: "blue" | "orange" | "green" | "purple" | "pink" | "red" | "teal";
  appearance: Appearance; sidebar: SidebarOptions; seekPreferences: SeekPreferences; customTheme: CustomTheme;
}
export interface CustomizationPreset { id: string; name: string; values: CustomizationValues }
export const defaultAppearance = (): Appearance => ({ fontSize: 12, density: "comfortable", artwork: "rounded", reducedMotion: false });
export const defaultSidebar = (): SidebarOptions => ({ order: [...NAV_ITEMS], hidden: [], width: 198, showArtwork: true, showCounts: true, playlistPins: [], sourcePins: [] });
export const defaultSeek = (): SeekPreferences => ({ backward: 10, forward: 10, fine: 1, wheel: "off", wheelInverted: false });
export const defaultCustomTheme = (): CustomTheme => ({ enabled: false, name: "My theme", colors: { window: "#ececec", surface: "#ffffff", text: "#1c1c1c", muted: "#4b4b4b", accent: "#2b5ea6", selectionText: "#ffffff", sidebar: "#dfe5ee", border: "#8e8e8e" } });
export const defaultCustomization = (): CustomizationValues => ({ theme: "aqua", accent: "blue", appearance: defaultAppearance(), sidebar: defaultSidebar(), seekPreferences: defaultSeek(), customTheme: defaultCustomTheme() });
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const choice = <T extends string>(value: unknown, choices: readonly T[], fallback: T): T => choices.includes(value as T) ? value as T : fallback;
const number = (value: unknown, min: number, max: number, fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
const bool = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;
const name = (value: unknown, fallback: string) => typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : fallback;
const ids = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && /^[a-z0-9_-]{1,128}$/i.test(id)))].slice(0, 20) : [];
export function sanitizeAppearance(raw: unknown): Appearance {
  const r = obj(raw), d = defaultAppearance();
  return { fontSize: number(r.fontSize, 11, 16, d.fontSize), density: choice(r.density, ["compact", "comfortable"], d.density), artwork: choice(r.artwork, ["rounded", "square", "circle"], d.artwork), reducedMotion: bool(r.reducedMotion, false) };
}
export function sanitizeSidebar(raw: unknown): SidebarOptions {
  const r = obj(raw), d = defaultSidebar();
  const order = Array.isArray(r.order) ? [...new Set(r.order.filter((key): key is NavItem => NAV_ITEMS.includes(key as NavItem)))] : [];
  return { order: [...order, ...NAV_ITEMS.filter((key) => !order.includes(key))], hidden: Array.isArray(r.hidden) ? [...new Set(r.hidden.filter((key): key is NavItem => NAV_ITEMS.includes(key as NavItem) && key !== "settings"))] : [], width: number(r.width, 160, 280, d.width), showArtwork: bool(r.showArtwork, true), showCounts: bool(r.showCounts, true), playlistPins: ids(r.playlistPins), sourcePins: ids(r.sourcePins) };
}
export function sanitizeSeek(raw: unknown): SeekPreferences {
  const r = obj(raw), d = defaultSeek();
  return { backward: number(r.backward, 1, 120, d.backward), forward: number(r.forward, 1, 120, d.forward), fine: number(r.fine, 1, 10, d.fine), wheel: choice(r.wheel, ["off", "seek"], "off"), wheelInverted: bool(r.wheelInverted, false) };
}
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  };
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
export function themeProblem(theme: CustomTheme): string | null {
  if (!theme.name.trim() || theme.name.length > 80) return "Use a theme name between 1 and 80 characters.";
  if (Object.keys(COLOR_LABELS).some((key) => !/^#[0-9a-f]{6}$/i.test(theme.colors[key as keyof ThemeColors] ?? ""))) return "Use six-digit hex colors, such as #235a91.";
  const c = theme.colors;
  if ([c.surface, c.window, c.sidebar].some((bg) => contrast(c.text, bg) < 4.5) || [c.surface, c.window, c.sidebar].some((bg) => contrast(c.muted, bg) < 4.5) || contrast(c.accent, c.surface) < 4.5 || contrast(c.selectionText, c.accent) < 4.5) return "Increase contrast: text needs a 4.5:1 ratio against its background, including selections and secondary text.";
  return null;
}
export function sanitizeCustomTheme(raw: unknown): CustomTheme {
  const r = obj(raw), d = defaultCustomTheme(), colors = obj(r.colors);
  const theme: CustomTheme = { enabled: bool(r.enabled, false), name: name(r.name, d.name), colors: { ...d.colors } };
  for (const key of Object.keys(COLOR_LABELS) as Array<keyof ThemeColors>) if (typeof colors[key] === "string" && /^#[0-9a-f]{6}$/i.test(colors[key])) theme.colors[key] = colors[key].toLowerCase();
  if (themeProblem(theme)) theme.enabled = false;
  return theme;
}
export function sanitizeCustomization(raw: unknown): CustomizationValues {
  const r = obj(raw);
  return { theme: choice(r.theme, ["system", "aqua", "graphite", "dark"], "aqua"), accent: choice(r.accent, ["blue", "orange", "green", "purple", "pink", "red", "teal"], "blue"), appearance: sanitizeAppearance(r.appearance), sidebar: sanitizeSidebar(r.sidebar), seekPreferences: sanitizeSeek(r.seekPreferences), customTheme: sanitizeCustomTheme(r.customTheme) };
}
export function customizationSnapshot(values: CustomizationValues): CustomizationValues { return sanitizeCustomization(values); }
export function sanitizeCustomizationPresets(raw: unknown): CustomizationPreset[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(), names = new Set<string>();
  return raw.slice(0, 100).flatMap((value) => {
    const r = obj(value), title = name(r.name, "");
    if (typeof r.id !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(r.id) || r.id.startsWith("builtin-") || !title || seen.has(r.id) || names.has(title.toLowerCase()) || !r.values || seen.size >= 20) return [];
    seen.add(r.id); names.add(title.toLowerCase());
    return [{ id: r.id, name: title, values: sanitizeCustomization(r.values) }];
  });
}
export function builtinCustomizationPresets(): CustomizationPreset[] {
  const classic = defaultCustomization(), compact = defaultCustomization(), study = defaultCustomization();
  compact.appearance.density = "compact"; compact.sidebar.width = 170; compact.sidebar.showArtwork = false;
  study.theme = "dark"; study.appearance.fontSize = 14; study.appearance.reducedMotion = true; study.seekPreferences = { ...defaultSeek(), backward: 10, forward: 30 }; study.sidebar.order = ["library", "search", "downloads", "sources", "history", "podcasts", "settings"];
  return [{ id: "builtin-classic", name: "Classic", values: classic }, { id: "builtin-compact", name: "Compact", values: compact }, { id: "builtin-study", name: "Study", values: study }];
}
export function exportTheme(theme: CustomTheme): string { return JSON.stringify({ kind: "kaisu-theme", version: 1, name: theme.name, colors: theme.colors }, null, 2); }
export function importTheme(text: string): CustomTheme {
  if (text.length > 32768) throw new Error("Choose a theme JSON file under 32 KB.");
  const r = obj(JSON.parse(text));
  if (r.kind !== "kaisu-theme" || r.version !== 1 || typeof r.name !== "string") throw new Error("This is not a supported Kaisu theme file.");
  const theme = { enabled: true, name: r.name, colors: obj(r.colors) as ThemeColors };
  const problem = themeProblem(theme);
  if (problem) throw new Error(problem);
  return sanitizeCustomTheme(theme);
}
