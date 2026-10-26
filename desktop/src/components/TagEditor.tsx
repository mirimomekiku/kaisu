import ArtworkEditor from "./ArtworkEditor";
import type { ArtworkEdit } from "../lib/tagEdit";
import { useMemo, useState } from "react";
import type { ArtworkChoice, EditResult, LibTrack } from "../lib/api";
import IdentifyMusic from "./IdentifyMusic";
import LyricsEditor from "./LyricsEditor";
import { tagKeys } from "../lib/identification";
import { baseName } from "../lib/mediaKind";
import { FIELDS, LABEL, SINGLE_ONLY, buildEdit, startForm, validateForm, type Field, type TagEditRequest, type TagForm } from "../lib/tagEdit";
import Sheet from "./Sheet";

interface Props {
  /** The songs being edited: one, or several to change together (an album). */
  tracks: LibTrack[];
  /** Makes the change; resolves to how it went for each file. */
  onSave: (edit: TagEditRequest) => Promise<EditResult[]>;
  onClose: () => void;
}

const NUMERIC: Field[] = ["track", "disc", "year"];

/** Edits the title, artist, album and other tags of a song, or the shared ones of several songs. */
export default function TagEditor({ tracks, onSave, onClose }: Props) {
  const many = tracks.length > 1;
  const start = useMemo(() => startForm(tracks), [tracks]);
  const [form, setForm] = useState<TagForm>(start.values);
  const [choosingArtwork, setChoosingArtwork] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [editingLyrics, setEditingLyrics] = useState(false);
  const [identifiedArtwork, setIdentifiedArtwork] = useState<ArtworkChoice>();
  const [artwork, setArtwork] = useState<ArtworkEdit | undefined>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<EditResult[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const problems = validateForm(form);
  const edit = { ...buildEdit(start, form), ...(artwork ? { artwork } : {}) };
  const changed = Object.keys(edit).length > 0;
  const fields = FIELDS.filter((f) => !many || !SINGLE_ONLY.includes(f));

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const results = await onSave(edit);
      const bad = results.filter((r) => !r.ok);
      setFailed(bad);
      if (bad.length === 0) onClose();
    } catch (e) {
      setProblem(typeof e === "string" ? e : e instanceof Error ? e.message : "Couldn't save the tags.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <><Sheet
      title={many ? `Edit ${tracks.length} songs` : "Edit tags"}
      onClose={() => !busy && !choosingArtwork && !identifying && !editingLyrics && onClose()}
      footer={
        <>
          <button type="button" className="btn" disabled={busy || choosingArtwork} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy || choosingArtwork || !changed || Object.keys(problems).length > 0} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed && Object.keys(problems).length === 0 && !busy && !choosingArtwork) void save();
        }}
      >
        <p className="m-0 truncate" title={many ? undefined : tracks[0]?.path}>
          {many ? (
            <>
              Changes apply to all <b>{tracks.length}</b> songs. Fields that differ between them are empty: leave one empty to keep each song's own.
            </>
          ) : (
            <>
              <b>{baseName(tracks[0].path)}</b>
            </>
          )}
        </p>
        {!many && <button type="button" className="btn w-fit" disabled={busy || choosingArtwork || tracks[0].missing} onClick={() => setIdentifying(true)}>Identify music online</button>}
        {!many && <button type="button" className="btn w-fit" disabled={busy || choosingArtwork || tracks[0].missing} onClick={() => setEditingLyrics(true)}>Edit lyrics</button>}
        <ArtworkEditor path={tracks[0].path} count={tracks.length} value={artwork} externalChoice={identifiedArtwork} onChange={setArtwork} onBusy={setChoosingArtwork} disabled={busy} />
        <div className="grid gap-x-3 gap-y-2" style={{ gridTemplateColumns: "auto 1fr" }}>
          {fields.map((f) => (
            <label key={f} className="contents">
              <span className="self-center">{LABEL[f]}</span>
              <span className="flex flex-col gap-0.5 min-w-0">
                <input
                  className="field"
                  aria-label={LABEL[f]}
                  aria-invalid={!!problems[f]}
                  inputMode={NUMERIC.includes(f) ? "numeric" : undefined}
                  value={form[f]}
                  placeholder={start.mixed.has(f) ? "Different in each song" : ""}
                  disabled={busy}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f]: e.target.value }))}
                />
                {problems[f] && (
                  <span role="alert" style={{ color: "#b3261e" }}>
                    {problems[f]}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
        <p className="m-0 dim">The file is rewritten carefully: if anything looks wrong, it is left exactly as it was.</p>
        {problem && (
          <p className="m-0" role="alert" style={{ color: "#b3261e" }}>
            {problem}
          </p>
        )}
        {failed.length > 0 && (
          <div role="alert" style={{ color: "#b3261e" }}>
            <b>
              {failed.length} of {tracks.length} couldn't be changed:
            </b>
            <ul className="m-0 pl-4">
              {failed.slice(0, 5).map((r) => (
                <li key={r.path}>
                  {baseName(r.path)}: {r.error}
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </Sheet>
    {editingLyrics && <LyricsEditor path={tracks[0].path} title={tracks[0].title} artist={tracks[0].artist} onClose={() => setEditingLyrics(false)} />}
    {identifying && <IdentifyMusic path={tracks[0].path} current={form} duration={tracks[0].duration} onClose={() => setIdentifying(false)} onUse={(edit, choice) => {
      setForm((old) => ({ ...old, ...Object.fromEntries(FIELDS.flatMap((f) => edit[tagKeys[f]] !== undefined ? [[f, edit[tagKeys[f]]]] : [])) }));
      if (edit.artwork) { setArtwork(edit.artwork); setIdentifiedArtwork(choice); }
      setIdentifying(false);
    }} />}</>
  );
}
