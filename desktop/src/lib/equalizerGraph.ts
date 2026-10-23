import type { AudioLike } from "./audioEngine";
import { defaultEqualizer, EQ_FREQUENCIES, equalizerHeadroom, sanitizeEqualizer, type EqualizerSettings } from "./equalizer";

export interface EqualizerStatus { supported: boolean; active: boolean; error: string | null; effectivePreamp: number }
export interface AudioProcessing {
  configure: (settings: EqualizerSettings) => void;
  activate: () => Promise<void>;
  attach: (audio: AudioLike) => void;
  detach: (audio: AudioLike) => void;
  setOutput: (id: string) => Promise<void>;
  status: () => EqualizerStatus;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
}
type RoutedContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

/** One mixer for both playback decks. Flat bypass keeps source ownership and device routing stable. */
export class EqualizerGraph implements AudioProcessing {
  private context: RoutedContext | null = null;
  private filters: BiquadFilterNode[] = [];
  private preamp: GainNode | null = null;
  private sources = new Map<AudioLike, MediaElementAudioSourceNode>();
  private retired = new WeakMap<AudioLike, MediaElementAudioSourceNode>();
  private settings = defaultEqualizer();
  private listeners = new Set<() => void>();
  private state: EqualizerStatus;
  private bridge: HTMLAudioElement | null = null;
  private usingBridge = false;
  private stream: MediaStreamAudioDestinationNode | null = null;
  private disposed = false;
  constructor(private factory: (() => AudioContext) | null = typeof AudioContext === "undefined" ? null : () => new AudioContext(), private createOutput: () => HTMLAudioElement = () => new Audio()) {
    this.state = { supported: !!factory, active: false, error: null, effectivePreamp: 0 };
  }
  status = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<EqualizerStatus>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }

  private ensure() {
    if (this.context || !this.factory || this.disposed) return;
    try {
      const context = this.factory(); this.context = context;
      this.filters = EQ_FREQUENCIES.map((frequency) => {
        const filter = context.createBiquadFilter(); filter.type = "peaking";
        filter.frequency.value = Math.min(frequency, context.sampleRate * 0.49); filter.Q.value = Math.SQRT2;
        return filter;
      });
      this.preamp = context.createGain();
      for (let i = 0; i < this.filters.length - 1; i++) this.filters[i].connect(this.filters[i + 1]);
      this.filters[this.filters.length - 1].connect(this.preamp); this.preamp.connect(context.destination);
      context.onstatechange = () => this.publish({ active: this.settings.enabled && context.state === "running" });
      this.apply();
    } catch (e) {
      void this.context?.close().catch(() => {}); this.context = null; this.factory = null;
      this.publish({ supported: false, active: false, error: `Equalizer unavailable: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  configure(settings: EqualizerSettings) { this.settings = sanitizeEqualizer(settings); this.apply(); }
  private apply() {
    if (!this.context || !this.preamp) return;
    // Compute response at target gains on separate filters: live AudioParams are smoothed below.
    const probes = EQ_FREQUENCIES.map((frequency, i) => {
      const filter = this.context!.createBiquadFilter(); filter.type = "peaking"; filter.frequency.value = Math.min(frequency, this.context!.sampleRate * 0.49); filter.Q.value = Math.SQRT2;
      filter.gain.value = this.settings.enabled ? this.settings.bands[i] : 0; return filter;
    });
    const effective = equalizerHeadroom(probes, this.context.sampleRate, this.settings);
    for (let i = 0; i < this.filters.length; i++) this.smooth(this.filters[i].gain, this.settings.enabled ? this.settings.bands[i] : 0);
    this.smooth(this.preamp.gain, Math.pow(10, effective / 20));
    this.publish({ active: this.settings.enabled && this.context.state === "running", effectivePreamp: effective });
  }
  private smooth(param: AudioParam, value: number) {
    const at = this.context!.currentTime;
    param.cancelScheduledValues(at); param.setTargetAtTime(value, at, 0.015);
  }
  async activate() {
    this.ensure(); if (!this.context || this.disposed) return;
    if (this.context.state !== "running") await this.context.resume();
    if (this.usingBridge) await this.bridge!.play();
  }
  attach(audio: AudioLike) {
    this.ensure(); if (!this.context || this.sources.has(audio)) return;
    const source = this.retired.get(audio) ?? this.context.createMediaElementSource(audio as HTMLAudioElement);
    source.connect(this.filters[0]); this.sources.set(audio, source); this.retired.delete(audio);
  }
  detach(audio: AudioLike) {
    const source = this.sources.get(audio); if (!source) return;
    source.disconnect(); this.sources.delete(audio); this.retired.set(audio, source);
  }
  async setOutput(id: string) {
    if (!this.context || !this.preamp) return;
    if (this.context.setSinkId) { await this.context.setSinkId(id); return; }
    // WebKitGTK can use the default destination. Where only media-element output selection exists,
    // a single stream bridge preserves the same device choice for the whole processed mix.
    if (!id) {
      this.usingBridge = false;
      this.preamp.disconnect(); this.preamp.connect(this.context.destination);
      this.bridge?.pause(); return;
    }
    if (!this.bridge) { this.stream = this.context.createMediaStreamDestination(); this.bridge = this.createOutput(); this.bridge.srcObject = this.stream.stream; this.bridge.volume = 1; }
    if (!this.bridge.setSinkId) throw new Error("The system player cannot select a separate output for processed audio. Use the system default.");
    await this.bridge.setSinkId(id); await this.bridge.play();
    this.preamp.disconnect(); this.preamp.connect(this.stream!);
    this.usingBridge = true;
  }
  dispose() {
    this.disposed = true;
    for (const source of this.sources.values()) source.disconnect(); this.sources.clear();
    this.bridge?.pause(); if (this.bridge) this.bridge.srcObject = null;
    this.context && (this.context.onstatechange = null); void this.context?.close().catch(() => {});
    this.listeners.clear();
  }
}
