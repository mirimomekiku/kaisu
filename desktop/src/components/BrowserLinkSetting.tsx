import { useEffect, useState } from "react";
import { errorText, linkHandlerStatus, setLinkHandler, type LinkHandlerStatus } from "../lib/api";

/** Lets the browser extension (or any kaisu:// link) open Kaisu. Registering is a per-user choice made here, never automatic. */
export default function BrowserLinkSetting() {
  const [status, setStatus] = useState<LinkHandlerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    linkHandlerStatus().then((s) => live && setStatus(s), () => live && setError("Kaisu couldn't check the browser link setting."));
    return () => { live = false; };
  }, []);
  if (status && !status.supported) return <p className="pref-hint px-3 py-2 mb-0">Browser links aren't supported on this system yet.</p>;
  const change = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try { setStatus(await setLinkHandler(enabled)); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="pref-row">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={status?.registered ?? false} disabled={!status || busy} onChange={(e) => void change(e.target.checked)} />
        Let the browser extension send links to Kaisu (adds a kaisu:// link type for your user; links are only shown for you to review)
      </label>
      {error && <p role="alert" className="mt-1.5 mb-0" style={{ color: "#b3261e" }}>{error}</p>}
    </div>
  );
}
