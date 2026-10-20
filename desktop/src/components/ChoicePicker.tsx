import { useState } from "react";
import { Download, Music, Video } from "lucide-react";
import type { Preset } from "../lib/api";

interface Props {
  advanced: boolean;
  audioLabel: string;
  onChoose: (preset: Preset) => void;
}

/** A compact video-or-audio chooser for downloading something again (no format list needed). */
export default function ChoicePicker({ advanced, audioLabel, onChoose }: Props) {
  const [kind, setKind] = useState<"video" | "audio">("video");
  const [quality, setQuality] = useState<"best" | "p1080" | "p720">("best");

  return (
    <div className="flex items-center gap-2 flex-wrap" aria-label="Download again options">
      <div className="seg blue small" role="radiogroup" aria-label="Download type">
        {(["video", "audio"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
            {k === "video" ? <Video className="w-3 h-3" /> : <Music className="w-3 h-3" />}
            {k === "video" ? "Video" : `Audio (${audioLabel})`}
          </button>
        ))}
      </div>
      {kind === "video" && (
        <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)} className="field" aria-label="Video quality">
          <option value="best">Best available</option>
          {advanced && <option value="p1080">1080p</option>}
          <option value="p720">{advanced ? "720p" : "Smaller file (720p)"}</option>
        </select>
      )}
      <button type="button" onClick={() => onChoose(kind === "audio" ? "audio" : quality)} className="btn primary small">
        <Download className="w-3 h-3" /> Download {kind}
      </button>
    </div>
  );
}
