import { useState } from "react";
import { AlertCircle, Check, ChevronDown, FolderOpen, Loader2, RefreshCw, RotateCcw, ScrollText, X } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { DownloadItem } from "../hooks/useDownloads";
import { friendlyError } from "../lib/errors";
import { PRESET_LABEL, formatEta, formatSpeed } from "../lib/format";
import type { Mode } from "../lib/storage";

interface Props {
  item: DownloadItem;
  mode: Mode;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

const iconBtn =
  "p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-neutral-800 transition cursor-pointer";

export default function DownloadRow({ item, mode, onCancel, onRetry, onRemove }: Props) {
  const advanced = mode === "advanced";
  const [showLog, setShowLog] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const finished = item.status === "completed" || item.status === "error" || item.status === "cancelled";

  const barColor =
    item.status === "completed"
      ? "bg-emerald-500"
      : item.status === "processing"
        ? "bg-amber-500"
        : item.status === "error" || item.status === "cancelled"
          ? "bg-neutral-600"
          : "bg-rose-500";

  const friendly = item.status === "error" && item.errorMsg ? friendlyError(item.errorMsg) : null;

  return (
    <div className="bg-neutral-900/50 border border-neutral-800/80 rounded-xl p-3.5 flex flex-col gap-2 shadow-sm transition hover:border-neutral-700/80">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-neutral-200 truncate" title={item.title}>
            {item.title}
          </div>
          <div className="text-[11px] text-neutral-500">
            {item.preset === "audio" ? `Audio (${item.extra.audio_format.toUpperCase()})` : PRESET_LABEL[item.preset]}
            {advanced && item.extra.format_id && <span className="font-mono"> · {item.extra.format_id}</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {item.status === "queued" && <span className="text-[11px] text-neutral-500">Waiting…</span>}
          {item.status === "downloading" && (
            <span className="text-[11px] font-mono text-rose-400 flex items-center gap-2">
              {item.speed == null && <Loader2 className="w-3 h-3 animate-spin" />}
              {advanced ? formatSpeed(item.speed) : `${Math.round(item.progress)}%`}
              {item.eta != null && <span className="text-neutral-500">{formatEta(item.eta)}</span>}
            </span>
          )}
          {item.status === "processing" && (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 bg-amber-950/40 border border-amber-800/50 px-2 py-0.5 rounded-full">
              <RefreshCw className="w-3 h-3 animate-spin" /> Finishing up
            </span>
          )}
          {item.status === "completed" && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-2.5 py-0.5 rounded-full">
              <Check className="w-3 h-3" /> Done
            </span>
          )}
          {item.status === "cancelled" && <span className="text-[11px] text-neutral-500">Cancelled</span>}
          {item.status === "error" && (
            <span className="inline-flex items-center gap-1 text-[11px] text-red-400">
              <AlertCircle className="w-3 h-3" /> Failed
            </span>
          )}

          {advanced && item.log.length > 0 && (
            <button className={iconBtn} title={showLog ? "Hide log" : "Show log"} onClick={() => setShowLog((v) => !v)}>
              <ScrollText className="w-3.5 h-3.5" />
            </button>
          )}
          {item.status === "completed" && item.path && (
            <button
              className={iconBtn}
              title="Show in folder"
              onClick={() => revealItemInDir(item.path as string).catch((e) => console.warn(e))}
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          )}
          {(item.status === "error" || item.status === "cancelled") && (
            <button className={iconBtn} title="Try again" onClick={() => onRetry(item.id)}>
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          {!finished && (
            <button className={iconBtn} title="Cancel" onClick={() => onCancel(item.id)}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {finished && (
            <button className={iconBtn} title="Remove from list" onClick={() => onRemove(item.id)}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="w-full bg-neutral-950 rounded-full h-1.5 overflow-hidden border border-neutral-800/80">
        <div className={`h-full transition-all duration-300 ${barColor}`} style={{ width: `${item.progress}%` }} />
      </div>

      {advanced && item.status === "completed" && item.path && (
        <div className="text-[11px] font-mono text-neutral-500 truncate select-text" title={item.path}>
          {item.path}
        </div>
      )}

      {friendly && (
        <div className="text-[11px] flex flex-col gap-1">
          {advanced ? (
            <div className="text-red-300/90 whitespace-pre-wrap break-words select-text">{item.errorMsg}</div>
          ) : (
            <>
              <div className="text-red-300">{friendly.summary}</div>
              {friendly.hint && <div className="text-neutral-400">{friendly.hint}</div>}
              <button
                onClick={() => setShowDetails((v) => !v)}
                className="flex items-center gap-1 text-neutral-500 hover:text-neutral-300 w-fit cursor-pointer"
              >
                <ChevronDown className={`w-3 h-3 transition ${showDetails ? "rotate-180" : ""}`} /> Technical details
              </button>
              {showDetails && (
                <div className="text-neutral-500 whitespace-pre-wrap break-words select-text font-mono">{item.errorMsg}</div>
              )}
            </>
          )}
        </div>
      )}

      {advanced && showLog && (
        <pre className="max-h-48 overflow-auto bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-[10.5px] leading-relaxed text-neutral-400 font-mono whitespace-pre-wrap break-all select-text">
          {item.log.join("\n")}
        </pre>
      )}
    </div>
  );
}
