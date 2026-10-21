import { useEffect, useState } from "react";
import { AlertCircle, Check, Circle, Copy, Download, Film, Loader2, Wrench } from "lucide-react";
import { errorText, runSetup, type ComponentId, type EngineInfo, type SetupInfo } from "../lib/api";
import { formatBytes } from "../lib/format";
import { checkProxy } from "../lib/validate";
import ProxyField from "./ProxyField";

interface Props {
  info: SetupInfo;
  /** Called with the refreshed engine state once setup succeeds. */
  onDone: (engine: EngineInfo) => void;
  /** Offered when the essentials work but an optional helper is still missing. */
  onSkip?: () => void;
  /** The proxy in use, so setup can go through it. */
  proxy: string;
  onProxy: (proxy: string) => void;
  /** Looks at the computer again (after the tools were installed by hand). */
  onRecheck: () => Promise<void>;
}

/** Roughly what each download weighs, so people know what to expect. */
const SIZE_HINT: Record<ComponentId, string> = { ytdlp: "about 35 MB", ffmpeg: "about 100 MB", js: "about 40 MB" };
/** Space needed for the downloads plus unpacking. */
const NEEDED_BYTES = 600 * 1024 * 1024;

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

export default function SetupScreen({ info, onDone, onSkip, proxy, onProxy, onRecheck }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Partial<Record<ComponentId, number>>>({});
  const [label, setLabel] = useState<Partial<Record<ComponentId, string>>>({});
  const [finished, setFinished] = useState<Partial<Record<ComponentId, boolean>>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [proxyText, setProxyText] = useState(proxy);
  const [checking, setChecking] = useState(false);
  const [recheckNote, setRecheckNote] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const proxyProblem = checkProxy(proxyText);
  const lowSpace = info.free_bytes !== null && info.free_bytes < NEEDED_BYTES;

  useEffect(() => {
    if (phase !== "running") return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const recheck = async () => {
    setChecking(true);
    setRecheckNote(null);
    try {
      await onRecheck();
      setRecheckNote("Looked again. If everything was found, this screen closes by itself.");
    } catch (e) {
      setRecheckNote(errorText(e));
    } finally {
      setChecking(false);
    }
  };

  const ready = (id: ComponentId) => info.engine[id].ready || finished[id] === true;
  const missing = PARTS.filter((p) => !info.engine[p.id].ready);
  const essentialsReady = info.engine.ytdlp.ready;

  const start = async () => {
    if (proxyProblem) return;
    onProxy(proxyText.trim());
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
    <div className="setup-bg">
      <div className="sheet" role="dialog" aria-label="Set up Kaisu">
        <div className="flex items-center gap-3 p-4" style={{ borderBottom: "1px solid #b9b9b9" }}>
          <div className="thumb" style={{ width: 44, height: 44, borderRadius: 10, background: "linear-gradient(#ff8a80,#d32f2f)", color: "#fff", border: "1px solid #8d1f1f" }}>
            <Film className="w-6 h-6" />
          </div>
          <div>
            <h1 className="m-0 text-[15px] font-bold">Let's get Kaisu ready</h1>
            <p className="m-0 dim">
              {missing.length === PARTS.length
                ? "First time here? Kaisu needs a few helper tools to download videos."
                : "A few helper tools are missing. This will fix that."}
            </p>
          </div>
        </div>

        <ul className="m-0 list-none p-4 flex flex-col gap-2">
          {PARTS.map((part) => {
            const isReady = ready(part.id);
            const pct = progress[part.id];
            const active = phase === "running" && !isReady && label[part.id] !== undefined;
            return (
              <li key={part.id} className="row-card p-2.5 flex flex-col gap-1.5">
                <div className="flex items-center gap-2.5">
                  <span className="shrink-0">
                    {isReady ? (
                      <Check className="w-4 h-4" style={{ color: "#2f8a2b" }} />
                    ) : active ? (
                      <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#2f66bf" }} />
                    ) : (
                      <Circle className="w-4 h-4" style={{ color: "#aaa" }} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">{part.name}</div>
                    <div className="dim">{active ? label[part.id] : `${part.detail} (${SIZE_HINT[part.id]})`}</div>
                  </div>
                  <span className="dim shrink-0">{isReady ? "Ready" : active && pct !== undefined ? `${Math.round(pct)}%` : "Needed"}</span>
                </div>
                {active && pct !== undefined && (
                  <div className="progress">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {error && (
          <div className="alert mx-4 mb-3">
            <AlertCircle className="w-4 h-4 shrink-0" style={{ color: "#b3261e" }} />
            <div className="break-words whitespace-pre-wrap selectable">{error}</div>
          </div>
        )}

        {lowSpace && (
          <div className="alert mx-4 mb-3" role="alert">
            <AlertCircle className="w-4 h-4 shrink-0" style={{ color: "#b3261e" }} />
            <div>
              Only {formatBytes(info.free_bytes ?? 0)} is free where the tools go. Setup needs about {formatBytes(NEEDED_BYTES)}. Free up some space first.
            </div>
          </div>
        )}

        <div className="px-4 pb-3 flex items-center gap-3 flex-wrap">
          {info.platform.auto_install ? (
            <button onClick={start} disabled={phase === "running"} className="btn primary" style={{ height: 24, padding: "0 18px" }}>
              {phase === "running" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {phase === "running" ? `Setting up… ${seconds}s` : phase === "failed" ? "Try again" : "Set up automatically"}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5" style={{ color: "#9a6a00" }}>
              <Wrench className="w-3.5 h-3.5" /> Automatic setup isn't available for {osLabel(info.platform)}. Use the steps below.
            </span>
          )}
          {onSkip && essentialsReady && phase !== "running" && (
            <button onClick={onSkip} className="btn">
              Skip for now
            </button>
          )}
        </div>

        {info.platform.auto_install && phase === "idle" && (
          <p className="dim px-4 mt-0 mb-3">
            Detected {osLabel(info.platform)}. Downloads roughly 100–200 MB from the official project pages, verified before use. Nothing is installed system-wide.
          </p>
        )}

        <details className="px-4 pb-3" open={phase === "failed" && !!proxyText}>
          <summary className="cursor-default select-none font-bold">Behind a proxy or firewall?</summary>
          <div className="mt-2 flex flex-col gap-1.5">
            <label className="flex items-center gap-2">
              Proxy
              <ProxyField value={proxyText} onChange={setProxyText} label="Setup proxy" invalid={!!proxyProblem} disabled={phase === "running"} className="field mono flex-1" />
            </label>
            {proxyProblem && (
              <p className="m-0" role="alert" style={{ color: "#b3261e" }}>
                {proxyProblem}
              </p>
            )}
            <p className="dim m-0">The downloads go through it. You can change it later in Settings.</p>
          </div>
        </details>

        <details className="px-4 pb-4" open={!info.platform.auto_install}>
          <summary className="cursor-default select-none font-bold">Prefer to install them yourself?</summary>
          <div className="mt-2 flex flex-col gap-1.5">
            <p className="dim m-0">Run {info.manual_steps.length > 1 ? "these" : "this"} in a terminal, then reopen Kaisu:</p>
            {info.manual_steps.map((step) => (
              <div key={step} className="flex items-center gap-2 panel px-2.5 py-1.5">
                <code className="flex-1 mono break-all selectable">{step}</code>
                {/^(sudo|winget|curl)/.test(step) && (
                  <button onClick={() => copy(step)} className="row-btn" title="Copy">
                    {copied === step ? <Check className="w-3 h-3" style={{ color: "#2f8a2b" }} /> : <Copy className="w-3 h-3" />}
                  </button>
                )}
              </div>
            ))}
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={recheck} disabled={checking} className="btn small">
                {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : null} I've installed them, check again
              </button>
              {recheckNote && (
                <span className="dim" role="status">
                  {recheckNote}
                </span>
              )}
            </div>
            <p className="dim m-0">
              Tools Kaisu installs itself go in <span className="mono selectable">{info.managed_dir}</span>
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
