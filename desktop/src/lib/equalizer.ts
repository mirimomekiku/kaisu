export const EQ_FREQUENCIES = [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_LABELS = ["31 Hz", "63 Hz", "125 Hz", "250 Hz", "500 Hz", "1 kHz", "2 kHz", "4 kHz", "8 kHz", "16 kHz"];
export interface EqualizerSettings { enabled: boolean; bands: number[]; preamp: number; autoHeadroom: boolean }
export const defaultEqualizer = (): EqualizerSettings => ({ enabled: false, bands: EQ_FREQUENCIES.map(() => 0), preamp: 0, autoHeadroom: true });
const gain = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(-12, Math.min(12, value)) : 0;
export function sanitizeEqualizer(raw: unknown): EqualizerSettings {
  const value = raw as Partial<EqualizerSettings> | null;
  return { enabled: value?.enabled === true, preamp: gain(value?.preamp), autoHeadroom: value?.autoHeadroom !== false,
    bands: EQ_FREQUENCIES.map((_, i) => gain(Array.isArray(value?.bands) ? value.bands[i] : undefined)) };
}
export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Bass boost": [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  Vocals: [-3, -2, -1, 0, 2, 3, 4, 3, 0, -2],
  "Treble boost": [0, 0, 0, 0, 0, 1, 2, 3, 4, 5],
  Rock: [4, 3, 1, -1, -2, -1, 1, 3, 4, 3],
  Electronic: [5, 4, 1, 0, -2, 1, 0, 2, 4, 5],
};
export function equalizerPreset(settings: EqualizerSettings): string {
  return Object.keys(EQ_PRESETS).find((name) => settings.preamp === 0 && EQ_PRESETS[name].every((gain, i) => gain === settings.bands[i])) ?? "Custom";
}

/** Sample the combined filter response, so overlapping boosts are included in automatic headroom. */
export function equalizerHeadroom(filters: BiquadFilterNode[], sampleRate: number, settings: EqualizerSettings): number {
  if (!settings.enabled) return 0;
  if (!settings.autoHeadroom) return settings.preamp;
  const frequencies = new Float32Array([...EQ_FREQUENCIES, ...Array.from({ length: 512 }, (_, i) => 20 * Math.pow(Math.min(20000, sampleRate * 0.49) / 20, i / 511))].filter((hz) => hz < sampleRate / 2));
  const magnitude = new Float32Array(frequencies.length), phase = new Float32Array(frequencies.length);
  const combined = new Float32Array(frequencies.length).fill(1);
  for (const filter of filters) {
    filter.getFrequencyResponse(frequencies, magnitude, phase);
    for (let i = 0; i < combined.length; i++) combined[i] *= magnitude[i];
  }
  const peak = Math.max(0, ...Array.from(combined, (m) => Number.isFinite(m) && m > 0 ? 20 * Math.log10(m) : 0));
  return Math.min(settings.preamp, -peak);
}
