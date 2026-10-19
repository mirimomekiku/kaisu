import { useState } from "react";
import { AlertCircle, Check, CircleDashed, Copy, Download, Film, Loader2, Wrench } from "lucide-react";
import { errorText, runSetup, type ComponentId, type EngineInfo, type SetupInfo } from "../lib/api";

interface Props {
  info: SetupInfo;
  /** Called with the refreshed engine state once setup succeeds. */
  onDone: (engine: EngineInfo) => void;
  /** Offered when the essentials work but an optional helper is still missing. */
  onSkip?: () => void;
}

const PARTS: Array<{ id: ComponentId; name: string; detail: string }> = [
  { id: "ytdlp", name: "Video downloader", detail: "yt-dlp: finds and downloads the video" },
  { id: "ffmpeg", name: "Media converter", detail: "ffmpeg: joins video and audio, makes MP3s" },
  { id: "js", name: "YouTube helper", detail: "Deno: lets the downloader read YouTube" },
];

function osLabel(p: SetupInfo["platform"]): string {
  const os = p.os === "windows" ? "Windows" : p.os === "linux" ? "Linux" : p.os;
  const distro = p.os === "linux" && p.distro ? ` (${p.distro[0].toUpperCase()}${p.distro.slice(1)})` : "";
  const arch = p.arch === "x86_64" ? "64-bit" : p.arch === "aarch64" ? "ARM 64-bit" : p.arch;
  return `${os}${distro}, ${arch}`;
}

type Phase = "idle" | "running" | "failed";

export default function SetupScreen({ info, onDone, onSkip }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Partial<Record<ComponentId, number>>>({});
  const [label, setLabel] = useState<Partial<Record<ComponentId, string>>>({});
  const [finished, setFinished] = useState<Partial<Record<ComponentId, boolean>>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const ready = (id: ComponentId) => info.engine[id].ready || finished[id] === true;
  const missing = PARTS.filter((p) => !info.engine[p.id].ready);
  const essentialsReady = info.engine.ytdlp.ready;

  const start = async () => {
    setPhase("running");
    setError(null);
    try {
      const engine = await runSetup((e) => {
        if (e.kind === "step") {
          setLabel((prev) => ({ ...prev, [e.component]: e.label }));
          // A component that has started is done once the next one begins.
          setFinished((prev) => {
            const order: ComponentId[] = ["ytdlp", "ffmpeg", "js"];
            const next = { ...prev };
            for (const id of order.slice(0, order.indexOf(e.component))) next[id] = true;
            return next;
          });
        } else if (e.kind === "progress") {
          setProgress((prev) => ({ ...prev, [e.component]: e.pct }));
        }
      });
      onDone(engine);
    } catch (e) {
      setError(errorText(e));
      setPhase("failed");
    }
  };

  const copy = (text: string) => {
    const command = text.split("    (")[0];
    navigator.clipboard?.writeText(command).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-neutral-900/60 border border-neutral-800 rounded-2xl p-8 shadow-2xl flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-600 to-rose-400 flex items-center justify-center shadow-lg shadow-rose-950/50">
            <Film className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Let's get Kaisu ready</h1>
            <p className="text-xs text-neutral-400">
              {missing.length === PARTS.length
                ? "First time here? Kaisu needs a few helper tools to download videos."
                : "A few helper tools are missing. This will fix that."}
            </p>
          </div>
        </div>

        <ul className="flex flex-col gap-2.5">
          {PARTS.map((part) => {
            const isReady = ready(part.id);
            const pct = progress[part.id];
            const active = phase === "running" && !isReady && label[part.id] !== undefined;
            return (
              <li key={part.id} className="bg-neutral-950/60 border border-neutral-800/80 rounded-xl p-3.5 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <span className="shrink-0">
                    {isReady ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : active ? (
                      <Loader2 className="w-4 h-4 text-rose-400 animate-spin" />
                    ) : (
                      <CircleDashed className="w-4 h-4 text-neutral-600" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-neutral-100">{part.name}</div>
                    <div className="text-[11px] text-neutral-500">{active ? label[part.id] : part.detail}</div>
                  </div>
                  <span className="text-[11px] text-neutral-500 shrink-0">
                    {isReady ? "Ready" : active && pct !== undefined ? `${Math.round(pct)}%` : "Needed"}
                  </span>
                </div>
                {active && pct !== undefined && (
                  <div className="h-1.5 rounded-full bg-neutral-900 border border-neutral-800 overflow-hidden">
                    <div className="h-full bg-rose-500 transition-all duration-200" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {error && (
          <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="break-words whitespace-pre-wrap select-text">{error}</div>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          {info.platform.auto_install ? (
            <button
              onClick={start}
              disabled={phase === "running"}
              className="bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-xl text-sm flex items-center gap-2 transition cursor-pointer shadow-lg shadow-rose-950/40"
            >
              {phase === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {phase === "running" ? "Setting up…" : phase === "failed" ? "Try again" : "Set up automatically"}
            </button>
          ) : (
            <span className="text-xs text-amber-300 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5" /> Automatic setup isn't available for {osLabel(info.platform)}. Use the steps below.
            </span>
          )}
          {onSkip && essentialsReady && phase !== "running" && (
            <button onClick={onSkip} className="text-xs text-neutral-400 hover:text-white underline cursor-pointer">
              Skip for now
            </button>
          )}
        </div>

        {info.platform.auto_install && phase === "idle" && (
          <p className="text-[11px] text-neutral-500 -mt-3">
            Detected {osLabel(info.platform)}. Downloads roughly 100–200 MB from the official project pages, verified before use.
            Nothing is installed system-wide.
          </p>
        )}

        <details className="text-xs text-neutral-400 group" open={!info.platform.auto_install}>
          <summary className="cursor-pointer hover:text-neutral-200 select-none">Prefer to install them yourself?</summary>
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-neutral-500">
              Run {info.manual_steps.length > 1 ? "these" : "this"} in a terminal, then reopen Kaisu:
            </p>
            {info.manual_steps.map((step) => (
              <div key={step} className="flex items-center gap-2 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2">
                <code className="flex-1 font-mono text-[11px] text-neutral-300 break-all select-text">{step}</code>
                {/^(sudo|winget|curl)/.test(step) && (
                  <button onClick={() => copy(step)} className="text-neutral-500 hover:text-white cursor-pointer shrink-0" title="Copy">
                    {copied === step ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            ))}
            <p className="text-[11px] text-neutral-600">
              Tools Kaisu installs itself go in <span className="font-mono select-text">{info.managed_dir}</span>
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
