import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { AudioTarget } from "../lib/api";
import { extensionOf } from "../lib/mediaKind";
import Sheet from "./Sheet";

const FORMATS: Array<{ id: AudioTarget; label: string; hint: string }> = [
  { id: "mp3", label: "MP3", hint: "plays everywhere" },
  { id: "m4a", label: "M4A (AAC)", hint: "good for phones and Apple devices" },
  { id: "opus", label: "Opus", hint: "small files, high quality" },
  { id: "flac", label: "FLAC", hint: "lossless, large" },
  { id: "wav", label: "WAV", hint: "uncompressed, very large" },
];

interface Props {
  title: string;
  path: string;
  /** Makes the copy; rejects with the reason. */
  onConvert: (format: AudioTarget) => Promise<void>;
  onClose: () => void;
}

/** Chooses an audio format and makes a copy of a finished download in it. The original is kept. */
export default function ConvertDialog({ title, path, onConvert, onClose }: Props) {
  const same = extensionOf(path);
  const options = FORMATS.filter((f) => f.id !== same);
  const [format, setFormat] = useState<AudioTarget>(options[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConvert(format);
    } catch (e) {
      setError(typeof e === "string" ? e : e instanceof Error ? e.message : "Couldn't convert it.");
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Convert to audio"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={run}>
            {busy ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> Converting…
              </>
            ) : (
              "Convert"
            )}
          </button>
        </>
      }
    >
      <p className="m-0 mb-2 truncate" title={title}>
        Make an audio copy of <b>{title}</b>. The original stays where it is.
      </p>
      <div role="radiogroup" aria-label="Convert to" className="flex flex-col gap-1">
        {options.map((f) => (
          <label key={f.id} className="flex items-center gap-2">
            <input type="radio" name="convert-format" checked={format === f.id} disabled={busy} onChange={() => setFormat(f.id)} />
            <b>{f.label}</b> <span className="dim">{f.hint}</span>
          </label>
        ))}
      </div>
      {busy && (
        <p className="mt-2 mb-0 dim" role="status">
          This can take a minute for a long file.
        </p>
      )}
      {error && (
        <p className="mt-2 mb-0" role="alert" style={{ color: "#b3261e" }}>
          {error}
        </p>
      )}
    </Sheet>
  );
}
