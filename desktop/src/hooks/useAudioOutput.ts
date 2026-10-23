import { createContext, useCallback, useEffect, useRef, useState } from "react";
import type { PlayerEngine } from "../lib/audioEngine";
import type { Settings } from "../lib/storage";
import { errorText } from "../lib/api";

type OutputDevices = MediaDevices & { selectAudioOutput?: (options?: { deviceId?: string }) => Promise<MediaDeviceInfo> };

export function useAudioOutput(engine: PlayerEngine, settings: Settings, ready: boolean, change: (patch: Partial<Settings>) => void) {
  const media = navigator.mediaDevices as OutputDevices | undefined;
  const supported = typeof HTMLMediaElement.prototype.setSinkId === "function" && !!media?.enumerateDevices;
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [active, setActive] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const selecting = useRef(false);
  const preference = useRef(settings.audioOutputId); preference.current = settings.audioOutputId;
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!supported || selecting.current) return;
    const token = ++generation.current;
    try {
      const outputs = (await media!.enumerateDevices()).filter((d) => d.kind === "audiooutput");
      if (!alive.current || token !== generation.current || selecting.current) return;
      setDevices(outputs);
      const preferred = preference.current;
      const next = preferred !== "default" && outputs.some((d) => d.deviceId === preferred) ? preferred : "";
      await engine.setOutputDevice(next);
      if (!alive.current || token !== generation.current) return;
      setActive(next);
      setMessage(preferred && next !== preferred ? "Preferred output is disconnected or needs permission. Using the system default; your preference is saved." : "");
    } catch (e) {
      if (alive.current && token === generation.current) { setActive(""); setMessage(`Using the system default. ${errorText(e)}`); }
    }
  }, [engine, media, supported]);

  useEffect(() => {
    alive.current = true;
    if (ready) void refresh();
    const changed = () => void refresh(); media?.addEventListener("devicechange", changed);
    return () => { alive.current = false; generation.current++; media?.removeEventListener("devicechange", changed); };
  }, [ready, settings.audioOutputId, refresh, media]);

  const choose = async (id?: string) => {
    if (selecting.current || !supported) return;
    selecting.current = true; generation.current++; setBusy(true); setMessage("");
    let routing = false;
    try {
      // The permission prompt is only opened directly from a user action. No microphone permission is requested.
      const chosen = id === undefined ? await media!.selectAudioOutput!({ deviceId: preference.current || undefined }) : devices.find((d) => d.deviceId === id);
      const selected = id ?? chosen!.deviceId;
      const next = selected === "default" ? "" : selected;
      routing = true;
      await engine.setOutputDevice(next);
      if (!alive.current) return;
      setActive(next);
      preference.current = next;
      change({ audioOutputId: next, audioOutputLabel: chosen?.label || (next ? "Audio output" : "System default") });
    } catch (e) { if (alive.current) { if (routing) setActive(""); setMessage(`Could not select the output: ${errorText(e)}`); } }
    finally { selecting.current = false; if (alive.current) setBusy(false); }
  };
  return { supported, devices, active, message, busy, refresh, choose, canPrompt: !!media?.selectAudioOutput, preferredLabel: settings.audioOutputLabel };
}

export const PlaybackServicesContext = createContext<{ output: ReturnType<typeof useAudioOutput>; locate: (path: string) => Promise<void> } | null>(null);
