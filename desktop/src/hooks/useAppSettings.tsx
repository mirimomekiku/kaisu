import { applyCustomization } from "../lib/customizationDom";
import { PROFILE_SETTINGS } from "../lib/playbackProfiles";
import { useCallback, useEffect, useRef, useState } from "react";
import type { useConfirm } from "../components/ConfirmDialog";
import { setLyricsConsent, setProxy } from "../lib/api";
import { DEFAULT_SETTINGS, saveSettings, type Settings } from "../lib/storage";

/**
 * The settings, saved as they change, with the two guarded changes that ask first: turning on lyrics (which sends the
 * artist and title to a lyrics service) and turning on automatic deletion (which removes files for good).
 */
export function useAppSettings(confirm: ReturnType<typeof useConfirm>) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // The theme is a setting on the page itself; "system" follows the operating system's light or dark choice.
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      const t = settings.theme === "system" ? (media?.matches ? "dark" : "aqua") : settings.theme;
      document.documentElement.dataset.theme = t;
    };
    apply();
    if (settings.theme !== "system" || !media) return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);
  useEffect(() => {
    document.documentElement.dataset.accent = settings.accent;
  }, [settings.accent]);

  useEffect(() => { applyCustomization(document.documentElement, settings); }, [settings.appearance, settings.sidebar, settings.customTheme]);

  const changeSettings = useCallback((patch: Partial<Settings>) => {
    if (patch.activePlaybackProfile === undefined && PROFILE_SETTINGS.some((key) => key in patch)) patch = { ...patch, activePlaybackProfile: "" };
    const next = { ...settingsRef.current, ...patch };
    if (patch.proxy !== undefined) setProxy(patch.proxy);
    if (patch.lyricsConsent !== undefined) setLyricsConsent(patch.lyricsConsent);
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
  }, []);

  /** Takes the settings read from disk at start-up. */
  const applyLoaded = useCallback((loaded: Settings) => {
    setProxy(loaded.proxy);
    setLyricsConsent(loaded.lyricsConsent);
    setSettings(loaded);
    setSettingsLoaded(true);
  }, []);

  /** Looking up lyrics sends the artist and title to LRCLIB, so ask before the first time. Resolves to whether lyrics may be used. */
  const ensureLyricsConsent = useCallback(async () => {
    if (settingsRef.current.lyricsConsent) return true;
    const answer = await confirm.ask({
      title: "Look up lyrics online?",
      body: (
        <p className="m-0">
          To find lyrics, Kaisu sends the song's <b>artist and title</b> to <b>LRCLIB</b> (lrclib.net), a free lyrics service run by someone else. Nothing else is sent. You can stop at
          any time by choosing "No lyrics".
        </p>
      ),
      buttons: [
        { id: "cancel", label: "No lyrics", primary: true },
        { id: "allow", label: "Allow lookup" },
      ],
      cancelId: "cancel",
    });
    if (answer !== "allow") return false;
    changeSettings({ lyricsConsent: true });
    return true;
  }, [confirm, changeSettings]);

  // Lyrics that were switched on before Kaisu asked: ask once now, and turn them off if the answer is no.
  const askedAboutOldLyrics = useRef(false);
  useEffect(() => {
    if (!settingsLoaded || settings.lyricsMode === "off" || settings.lyricsConsent || askedAboutOldLyrics.current) return;
    askedAboutOldLyrics.current = true;
    void ensureLyricsConsent().then((agreed) => {
      if (!agreed) changeSettings({ lyricsMode: "off" });
    });
  }, [settingsLoaded, settings.lyricsMode, settings.lyricsConsent, ensureLyricsConsent, changeSettings]);

  /** Settings changes from the Settings page: the ones that need a yes first get asked about. */
  const changeSettingsGuarded = useCallback(
    async (patch: Partial<Settings>) => {
      if (patch.lyricsMode !== undefined && patch.lyricsMode !== "off" && !(await ensureLyricsConsent())) return;
      const days = patch.autoDeleteDays;
      const permanent = patch.cleanupPermanent ?? settingsRef.current.cleanupPermanent;
      if ((days !== undefined && days > 0 && settingsRef.current.autoDeleteDays === 0) || (patch.cleanupPermanent === true && !settingsRef.current.cleanupPermanent)) {
        const answer = await confirm.ask({
          title: patch.cleanupPermanent === true ? "Permanently delete during cleanup?" : "Delete old downloads automatically?",
          body: (
            <p className="m-0">
              Downloads older than <b>{days ?? (settingsRef.current.autoDeleteDays || "the selected number of")} days</b> and their subtitle and lyrics files {permanent ? "will be permanently deleted. This can't be undone." : "will be moved to the Recycle Bin or Trash, where you can restore them. Space is reclaimed when you empty it."} Only files Kaisu downloaded are touched.
            </p>
          ),
          buttons: [
            { id: "cancel", label: "Cancel", primary: true },
            { id: "yes", label: "Turn on" },
          ],
          cancelId: "cancel",
        });
        if (answer !== "yes") return;
      }
      changeSettings(patch);
    },
    [changeSettings, confirm, ensureLyricsConsent],
  );

  return { settings, settingsRef, settingsLoaded, changeSettings, changeSettingsGuarded, ensureLyricsConsent, applyLoaded };
}
