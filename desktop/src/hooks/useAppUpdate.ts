import { useCallback, useEffect, useRef, useState } from "react";
import { checkAppUpdate, errorText, installAppUpdate, restartApp, type AppUpdate } from "../lib/api";
import type { Settings } from "../lib/storage";

const DAY = 24 * 60 * 60 * 1000;

export type AppUpdateStatus = { kind: "idle" } | { kind: "checking" } | { kind: "current"; version: string } | { kind: "available"; update: AppUpdate } | { kind: "error"; message: string };

export type InstallState = { kind: "idle" } | { kind: "installing"; percent: number } | { kind: "ready"; version: string } | { kind: "failed"; message: string };

/** Whether a background check is due: switched on, and not tried in the last day. */
export const updateCheckDue = (settings: Pick<Settings, "appUpdateChecks" | "appUpdateLastCheck">, now: number) =>
  settings.appUpdateChecks && !(now - settings.appUpdateLastCheck < DAY && now >= settings.appUpdateLastCheck);

/**
 * Announces a newer Kaisu release. It only reads the version number from the public releases page, at most once a day,
 * and can be switched off in Settings. A release the user dismissed is not announced again.
 */
export function useAppUpdate(settingsLoaded: boolean, settingsRef: { current: Settings }, changeSettings: (patch: Partial<Settings>) => void) {
  const [status, setStatus] = useState<AppUpdateStatus>({ kind: "idle" });
  const running = useRef(false);
  const [install, setInstall] = useState<InstallState>({ kind: "idle" });
  const installing = useRef(false);

  const check = useCallback(async (manual: boolean) => {
    if (running.current) return;
    running.current = true;
    if (manual) setStatus({ kind: "checking" });
    try {
      const update = await checkAppUpdate();
      changeSettings({ appUpdateLastCheck: Date.now() });
      if (update.newer && (manual || settingsRef.current.appUpdateDismissed !== update.latest)) setStatus({ kind: "available", update });
      else if (manual) setStatus({ kind: "current", version: update.current });
    } catch (e) {
      // A quiet background check that fails (offline, say) tries again tomorrow rather than nagging.
      if (manual) setStatus({ kind: "error", message: errorText(e) });
    } finally {
      running.current = false;
    }
  }, [changeSettings, settingsRef]);

  useEffect(() => {
    if (settingsLoaded && updateCheckDue(settingsRef.current, Date.now())) void check(false);
  }, [settingsLoaded, settingsRef, check]);

  const dismiss = useCallback(() => {
    if (status.kind !== "available") return;
    if (status.update.latest) changeSettings({ appUpdateDismissed: status.update.latest });
    setStatus({ kind: "idle" });
  }, [status, changeSettings]);

  /** Downloads, verifies and installs the announced release. The new version starts only when `restart` is used. */
  const installUpdate = useCallback(async () => {
    if (status.kind !== "available" || !status.update.installable || !status.update.latest || installing.current) return;
    installing.current = true;
    const version = status.update.latest;
    setInstall({ kind: "installing", percent: 0 });
    try {
      await installAppUpdate(version, (percent) => setInstall((now) => (now.kind === "installing" ? { kind: "installing", percent: Math.round(percent) } : now)));
      setInstall({ kind: "ready", version });
    } catch (e) {
      setInstall({ kind: "failed", message: errorText(e) });
    } finally {
      installing.current = false;
    }
  }, [status]);

  const restart = useCallback(() => { restartApp().catch((e) => setInstall({ kind: "failed", message: errorText(e) })); }, []);

  return { status, checkNow: () => check(true), dismiss, install, installUpdate, restart, clearInstallError: () => setInstall((now) => (now.kind === "failed" ? { kind: "idle" } : now)) };
}
