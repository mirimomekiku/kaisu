import { useState, useSyncExternalStore } from "react";
import { storageIssues, subscribeStorage } from "../lib/storageHealth";

export default function StorageNotice() {
  const issues = useSyncExternalStore(subscribeStorage, storageIssues);
  const [busy, setBusy] = useState(false);
  if (!issues.length) return null;
  return <div className="banner bad flex-wrap" role="alert" aria-label="Storage problem">
    <span>{issues[0].message}{issues.length > 1 ? ` (${issues.length} storage problems)` : ""}</span>
    <button className="btn small" disabled={busy} onClick={async () => {
      setBusy(true); try { await Promise.allSettled(issues.map((i) => i.retry())); } finally { setBusy(false); }
    }}>{busy ? "Retrying…" : "Retry saving or loading"}</button>
  </div>;
}
