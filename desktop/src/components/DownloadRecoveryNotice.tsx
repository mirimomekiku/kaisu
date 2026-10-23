import { useEffect, useState } from "react";
import { downloadRecovery, discardDownloadRecovery, errorText, preflightDownloads, type DownloadRecovery } from "../lib/api";
import { sanitizeDownloadQueue } from "../lib/downloadValidation";
import type { DownloadItem, EnqueueInput } from "../hooks/useDownloads";

export default function DownloadRecoveryNotice({ ready, items, enqueue }: { ready: boolean; items: DownloadItem[]; enqueue: (inputs: EnqueueInput[]) => void }) {
  const [records, setRecords] = useState<DownloadRecovery[]>([]);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!ready) return; let live = true; downloadRecovery().then((r) => { if (live) setRecords(r); }, (e) => { if (live) setError(errorText(e)); }); return () => { live = false; }; }, [ready]);
  const available = records.filter((r) => !items.some((i) => (i.recoveryId ?? i.id) === r.id));
  const recover = async () => {
    setBusy(true); setError("");
    try {
      const valid = sanitizeDownloadQueue(available.map((r) => ({ id: r.id, recoveryId: r.id, url: r.request.url, title: r.request.url, placeholderTitle: true, outDir: r.request.out_dir, preset: r.request.preset, extra: r.request.extra, estimatedBytes: r.request.estimated_bytes, expectedVolume: r.request.expected_volume })));
      if (valid.length !== available.length) throw new Error("Some recovery records have invalid choices. Discard those records or download the links again.");
      const groups = await preflightDownloads(valid.map((r) => ({ id: r.id, url: r.url, out_dir: r.outDir, preset: r.preset, extra: r.extra, estimated_bytes: r.estimatedBytes, expected_volume: r.expectedVolume })));
      if (groups.some((g) => g.free < g.needed)) throw new Error("There isn't enough free disk space for recovery. Free some space and try again.");
      enqueue(valid.map((r) => ({ ...r, extra: r.extra })));
      setRecords((old) => old.filter((r) => !available.some((a) => a.id === r.id)));
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const discard = async () => {
    setBusy(true); setError("");
    try { await discardDownloadRecovery(available.map((r) => r.id)); setRecords([]); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  if (hidden || (!available.length && !error)) return null;
  return <section className="download-recovery" aria-label="Recover downloads">
    {available.length > 0 && <>
      <b>{available.length} interrupted download{available.length === 1 ? "" : "s"} can be recovered</b>
      <p>Recovery keeps the original link, format and destination. It reuses compatible partial files; unavailable or changed files may restart.</p>
      {available.some((r) => r.request.extra.credentials_required) && <p>Private headers and signed-link credentials are omitted from recovery files. Those downloads need a fresh link and headers before they can run again.</p>}
      <ul>{available.map((r) => <li key={r.id}><span className="selectable">{r.request.url}</span><span className="dim"> → {r.request.out_dir}</span></li>)}</ul>
      <div className="flex gap-2 flex-wrap">
        <button className="btn small" disabled={busy} onClick={() => void recover()}>Recover original downloads</button>
        <button className="btn small" disabled={busy} onClick={() => void discard()}>Discard recovery records</button>
        <button className="btn small" disabled={busy} onClick={() => setHidden(true)}>Later</button>
      </div>
      <p className="dim">Discarding records keeps all downloaded and partial files.</p>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
