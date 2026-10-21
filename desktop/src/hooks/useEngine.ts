import { useCallback, useEffect, useRef, useState } from "react";
import type { EngineState } from "../components/SettingsPage";
import { checkSetup, errorText, getEngineInfo, updateEngine, type EngineInfo, type SetupInfo } from "../lib/api";
import type { Settings } from "../lib/storage";

const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface Args {
  settingsLoaded: boolean;
  settingsRef: React.MutableRefObject<Settings>;
  changeSettings: (patch: Partial<Settings>) => void;
}

/** The helper tools (yt-dlp, ffmpeg, a JavaScript runtime): whether they are installed, first-run setup, and updates. */
export function useEngine({ settingsLoaded, settingsRef, changeSettings }: Args) {
  const [setupInfo, setSetupInfo] = useState<SetupInfo | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSkipped, setSetupSkipped] = useState(false);
  const [setupRequested, setSetupRequested] = useState(false);
  const [engineState, setEngineState] = useState<EngineState>({ kind: "idle" });
  const engine: EngineInfo | null = setupInfo?.engine ?? null;

  useEffect(() => {
    checkSetup()
      .then(setSetupInfo)
      .catch((e) => setSetupError(errorText(e)));
  }, []);

  const setEngine = useCallback((next: EngineInfo) => {
    setSetupInfo((prev) => (prev ? { ...prev, engine: next } : prev));
  }, []);

  const checkForUpdate = useCallback(
    async (silent: boolean) => {
      setEngineState({ kind: "updating" });
      try {
        const res = await updateEngine();
        changeSettings({ lastEngineCheck: Date.now() });
        setEngine(await getEngineInfo());
        setEngineState(
          res.updated
            ? { kind: "message", text: res.previous ? `Updated yt-dlp ${res.previous} → ${res.version}` : `Installed yt-dlp ${res.version}` }
            : silent
              ? { kind: "idle" }
              : { kind: "message", text: `yt-dlp ${res.version} is the latest version` },
        );
      } catch (e) {
        setEngineState(silent ? { kind: "idle" } : { kind: "message", text: errorText(e), error: true });
        if (silent) console.warn("Auto-update failed:", e);
      }
    },
    [changeSettings, setEngine],
  );

  const autoUpdateTried = useRef(false);
  useEffect(() => {
    if (!settingsLoaded || !engine?.ytdlp.ready || autoUpdateTried.current) return;
    autoUpdateTried.current = true;
    const s = settingsRef.current;
    if (s.autoUpdate && Date.now() - s.lastEngineCheck > AUTO_UPDATE_INTERVAL_MS) {
      checkForUpdate(true);
    }
  }, [settingsLoaded, engine, settingsRef, checkForUpdate]);

  /** The setup screen shows before the app when tools are missing (and wasn't skipped), or when asked for. */
  const needsSetup = setupInfo !== null && ((!setupInfo.engine.ready && !setupSkipped) || setupRequested);

  return { setupInfo, setSetupInfo, setupError, setSetupSkipped, setSetupRequested, engine, engineState, setEngineState, setEngine, checkForUpdate, needsSetup };
}
