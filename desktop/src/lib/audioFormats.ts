import type { AudioFormat, AudioExtras } from "./api";

/** Every audio choice for "Audio only" downloads. `original` keeps the site's own audio without converting it. */
export const AUDIO_FORMAT_IDS: AudioFormat[] = ["mp3", "m4a", "opus", "flac", "wav", "original"];

export const AUDIO_FORMAT_LABEL: Record<AudioFormat, string> = {
  mp3: "MP3 (most compatible)",
  m4a: "M4A / AAC",
  opus: "Opus (small, high quality)",
  flac: "FLAC (lossless container)",
  wav: "WAV (uncompressed)",
  original: "Original audio (no conversion)",
};

/** A short name for a format, for labels: `MP3`, or `Original`. */
export const audioFormatName = (format: AudioFormat) => (format === "original" ? "Original" : format.toUpperCase());

export const isAudioFormat = (value: unknown): value is AudioFormat => AUDIO_FORMAT_IDS.includes(value as AudioFormat);

/** Formats that store the sound without throwing more away. Sites only offer lossy audio, so these do not add quality. */
export const isLosslessFormat = (format: AudioFormat) => format === "flac" || format === "wav";

/**
 * Encoding something that already lost detail as FLAC or WAV keeps what is left; it cannot bring the rest back.
 * The file just gets much bigger. Returns the sentence to show, or null for other formats.
 */
export function lossyEncodeNote(format: AudioFormat): string | null {
  if (!isLosslessFormat(format)) return null;
  return `${format.toUpperCase()} does not restore quality that the site already removed. Almost all sites serve compressed audio (AAC or Opus), so these files get much larger without sounding better. Choose Original audio to keep the site's own file.`;
}

/** Converting needs re-encoding, so the processing choices cannot apply to an unconverted file. */
export const originalIgnores = (audio: AudioExtras | null | undefined) => !!audio && (audio.normalize || audio.trim_silence || !!audio.quality?.trim());

/** The processing options an unconverted file cannot take, removed. Other formats keep their options as chosen. */
export const forFormat = (format: AudioFormat, audio: AudioExtras | null): AudioExtras | null =>
  format === "original" && audio ? { quality: null, normalize: false, trim_silence: false } : audio;
