/** Sound-only file types Kaisu produces. Anything else it treats as video. */
const AUDIO_EXTENSIONS = ["mp3", "m4a", "opus", "ogg", "oga", "flac", "wav", "aac", "wma"];

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export const extensionOf = (path: string) => fileName(path).split(".").pop()?.toLowerCase() ?? "";

/** Whether a file is sound only (so it gets an audio player, and can't be "converted to audio" as video can). */
export const isAudioFile = (path: string) => AUDIO_EXTENSIONS.includes(extensionOf(path));

/** The file's name without its folder or extension. */
export const baseName = (path: string) => fileName(path).replace(/\.[^.]+$/, "");
