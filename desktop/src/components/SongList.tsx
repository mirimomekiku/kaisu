import { ActionMenu, FilterDropdown } from "./Dropdown";
import { Play } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useMusicPreferences } from "../hooks/useMusicPreferences";
import { useVirtualRows } from "../hooks/useVirtualRows";
import type { LibTrack } from "../lib/api";
import { formatClock } from "../lib/format";
import { qualityLabel } from "../lib/library";
import { MAX_TRACKS as MAX_PLAYLIST_TRACKS } from "../lib/playlists";
import { emptySelection, pruneSelection, selectSong } from "../lib/songSelection";
import { modLabel } from "../lib/shortcuts";
import TrackPreferences from "./TrackPreferences";

const ROW_HEIGHT = 28;
const MAX_BATCH = 500;
const CONTROL = "button, input, select, label, a";
const hasOpenDialog = () => !!document.querySelector("[role=alertdialog], [role=dialog][aria-modal=true], [role=menu]");

interface Props {
  tracks: LibTrack[];
  onLocate: (path: string) => void;
  onPlay: (list: LibTrack[], from: number) => void;
  onNext: (list: LibTrack[]) => void;
  onAdd: (list: LibTrack[]) => void;
  onReveal: (path: string) => void;
  onEdit: (tracks: LibTrack[]) => void;
  onAutoTag: (tracks: LibTrack[]) => void;
  onLyrics?: (track: LibTrack) => void;
  onPlaylist: (tracks: LibTrack[]) => void;
  announce: (note: { title: string; subtitle?: string }) => void;
}

export default function SongList({ tracks, onLocate, onPlay, onNext, onAdd, onReveal, onEdit, onAutoTag, onLyrics, onPlaylist, announce }: Props) {
  const preferences = useMusicPreferences();
  const rows = useVirtualRows(tracks.length, ROW_HEIGHT);
  const [selection, setSelection] = useState(emptySelection);
  const order = useMemo(() => tracks.map((t) => t.path), [tracks]);
  const visible = useMemo(() => new Set(order), [order]);
  const selected = useMemo(() => tracks.filter((t) => selection.paths.has(t.path)), [tracks, selection]);
  const available = selected.filter((t) => !t.missing);
  const missing = selected.length - available.length;
  const all = tracks.length > 0 && selected.length === tracks.length;
  const selectAllBox = useRef<HTMLInputElement>(null);
  const rowElements = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<string | null>(null);
  const [, requestFocus] = useState(0);
  const previousOrder = useRef(order);

  useEffect(() => { setSelection((old) => pruneSelection(old, visible)); }, [visible]);
  useLayoutEffect(() => {
    if (selectAllBox.current) selectAllBox.current.indeterminate = selected.length > 0 && !all;
  }, [selected.length, all]);
  useLayoutEffect(() => {
    const old = previousOrder.current;
    if (old.length !== order.length || old.some((p, i) => p !== order[i])) {
      if (rows.ref.current) rows.ref.current.scrollTop = 0;
      previousOrder.current = order;
    }
  }, [order, rows.ref]);
  useLayoutEffect(() => {
    const path = pendingFocus.current;
    if (path === null) return;
    if (!visible.has(path)) { pendingFocus.current = null; return; }
    const element = rowElements.current.get(path);
    if (element) { pendingFocus.current = null; element.focus({ preventScroll: true }); }
  });

  const selectAll = () => setSelection({ paths: new Set(order), anchor: order[0] ?? null });
  const clear = () => setSelection(emptySelection());
  const select = (path: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, checkbox = false) => {
    const mod = e.ctrlKey || e.metaKey;
    setSelection((old) => selectSong(pruneSelection(old, visible), order, path, { range: e.shiftKey, toggle: mod || checkbox, additive: mod || checkbox }));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Text fields and open dialogs retain their own shortcuts, including text selection and Escape.
    if (hasOpenDialog() || (e.target as HTMLElement).closest("input:not([type=checkbox]), textarea, select, [contenteditable=true], [role=dialog]")) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a") {
      e.preventDefault(); e.stopPropagation(); selectAll();
    } else if (e.key === "Escape" && selected.length > 0) {
      e.preventDefault(); e.stopPropagation(); clear();
    }
  };

  const rowKeyDown = (e: KeyboardEvent<HTMLDivElement>, path: string, index: number) => {
    if (hasOpenDialog() || e.target !== e.currentTarget || e.altKey || e.isDefaultPrevented()) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === " " && !(mod && e.shiftKey)) {
      e.preventDefault(); e.stopPropagation(); select(path, e, true);
    } else if (e.key === "Enter" && !mod && !e.shiftKey) {
      e.preventDefault(); if (!tracks[index].missing) onPlay(tracks, index);
    } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      const next = e.key === "Home" ? 0 : e.key === "End" ? tracks.length - 1 : Math.max(0, Math.min(tracks.length - 1, index + (e.key === "ArrowUp" ? -1 : 1)));
      if (!mod || e.shiftKey) select(order[next], e);
      pendingFocus.current = order[next];
      const viewport = rows.ref.current;
      if (viewport) {
        const top = next * ROW_HEIGHT;
        if (top < viewport.scrollTop) viewport.scrollTop = top;
        else if (top + ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight - 22) viewport.scrollTop = top - viewport.clientHeight + ROW_HEIGHT + 22;
      }
      requestFocus((n) => n + 1);
    }
  };

  const rowClick = (e: MouseEvent<HTMLDivElement>, path: string) => {
    if ((e.target as HTMLElement).closest(CONTROL)) return;
    select(path, e);
    e.currentTarget.focus({ preventScroll: true });
  };

  const setFavorite = (favorite: boolean) => {
    preferences?.updateMany(selected.map((t) => t.path), { favorite });
    announce({ title: favorite ? "Added to favorites" : "Removed from favorites", subtitle: `${selected.length} songs` });
  };
  const playableBatch = available.length > 0 && available.length <= MAX_BATCH;

  return <div className="song-list" onKeyDown={onKeyDown}>
    <div className="song-selection-bar" role="group" aria-label="Song selection">
      <span role="status" aria-live="polite">{selected.length} selected{missing > 0 ? ` · ${missing} missing` : ""}</span>
      {selected.length > 0 ? <>
        <button className="btn small" onClick={selectAll} disabled={all}>Select all shown</button>
        <button className="btn small" onClick={clear}>Clear selection</button>
        <button className="btn small primary" disabled={!playableBatch} onClick={() => onPlay(available, 0)}><Play className="w-3 h-3" /> Play selected</button>
        <ActionMenu label="Selected actions" items={[
          { label: "Play selected next", onSelect: () => onNext(available), disabled: !playableBatch },
          { label: "Add selected to queue", onSelect: () => onAdd(available), disabled: !playableBatch },
          { label: "Add selected to playlist", onSelect: () => onPlaylist(selected), disabled: selected.length > MAX_PLAYLIST_TRACKS },
          { kind: "separator" },
          { label: "Edit selected tags", onSelect: () => onEdit(available), disabled: !playableBatch },
          { label: "Auto-tag selected songs", onSelect: () => onAutoTag(available), disabled: !playableBatch },
          { label: "Favorite selected", onSelect: () => setFavorite(true), disabled: !preferences?.loaded },
          { label: "Unfavorite selected", onSelect: () => setFavorite(false), disabled: !preferences?.loaded },
        ]} />
        <FilterDropdown label="Rate selected">
          <label>Rating<select className="field" aria-label="Set rating for selected songs" value="" disabled={!preferences?.loaded} onChange={(e) => {
            preferences?.updateMany(selected.map((t) => t.path), { rating: Number(e.target.value) });
            announce({ title: Number(e.target.value) === 0 ? "Ratings cleared" : `Rated ${e.target.value} star${e.target.value === "1" ? "" : "s"}`, subtitle: `${selected.length} songs` });
          }}><option value="" disabled>Choose a rating…</option><option value="0">Unrated</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} star{n === 1 ? "" : "s"}</option>)}</select></label>
        </FilterDropdown>
        {missing > 0 && <span className="song-selection-note">Playback and tag edits use available songs only.</span>}
        {available.length > MAX_BATCH && <span className="song-selection-note">Select up to {MAX_BATCH} available songs for playback or tag edits.</span>}
        {selected.length > MAX_PLAYLIST_TRACKS && <span className="song-selection-note">Select up to {MAX_PLAYLIST_TRACKS.toLocaleString()} songs for a playlist.</span>}
      </> : <span className="dim">Click a row to select; {modLabel}+click toggles, Shift+click selects a range.</span>}
    </div>
    <div className="lib-scroll" ref={rows.ref}>
      <div className="song-table">
        <div className="lib-row lib-head">
          <input ref={selectAllBox} type="checkbox" aria-label="Select all shown songs" checked={all} onChange={() => all ? clear() : selectAll()} />
          <span>Title</span><span>Artist</span><span>Album</span><span className="num">Year</span><span className="num">Time</span><span>Quality</span><span />
        </div>
        <div role="list" aria-label="Songs" style={{ paddingTop: rows.padTop, paddingBottom: rows.padBottom }}>
          {tracks.slice(rows.start, rows.end).map((t, i) => {
            const index = rows.start + i;
            return <div key={t.path} ref={(element) => { if (element) rowElements.current.set(t.path, element); else rowElements.current.delete(t.path); }} role="listitem" tabIndex={0} aria-label={t.title}
              className="lib-row" data-selected={selection.paths.has(t.path)} style={{ height: ROW_HEIGHT }}
              onKeyDown={(e) => rowKeyDown(e, t.path, index)} onClick={(e) => rowClick(e, t.path)}
              onClickCapture={(e) => {
                if ((e.ctrlKey || e.metaKey || e.shiftKey) && (e.target as HTMLElement).closest(".lib-title")) { e.preventDefault(); e.stopPropagation(); select(t.path, e); e.currentTarget.focus({ preventScroll: true }); }
              }}
              onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest(CONTROL) && !e.ctrlKey && !e.metaKey && !e.shiftKey && !t.missing) onPlay(tracks, index); }}>
              <span className="song-select-cell">
                <input type="checkbox" aria-label={`Select ${t.title}`} checked={selection.paths.has(t.path)} onClick={(e) => { select(t.path, e, true); }} onChange={() => {}} />
                <span className="num dim mono">{index + 1}</span>
              </span>
              <div className="song-title-preferences"><button type="button" className="lib-title link truncate" disabled={!!t.missing} aria-label={`Play ${t.title}`} title={t.missing ? t.path : `Play ${t.title}`} onClick={() => onPlay(tracks, index)}>{t.title}</button><TrackPreferences path={t.path} title={t.title} /></div>
              <span className="truncate">{t.artist || <span className="dim">Unknown artist</span>}</span>
              <span className="truncate">{t.album || <span className="dim">Unknown album</span>}</span>
              <span className="num">{t.year ?? ""}</span>
              <span className="num mono">{t.duration > 0 ? formatClock(t.duration) : ""}</span>
              <span className="dim truncate">{t.missing ? "Missing file" : qualityLabel(t)}</span>
              <span className="lib-actions">
                {t.missing ? <button className="btn small" aria-label={`Locate ${t.title}`} onClick={() => onLocate(t.path)}>Locate file</button> : <ActionMenu compact label={`Actions for ${t.title}`} items={[
                  { label: `Play ${t.title} next`, onSelect: () => onNext([t]) },
                  { label: `Add ${t.title} to the queue`, onSelect: () => onAdd([t]) },
                  { label: `Add ${t.title} to a playlist`, onSelect: () => onPlaylist([t]) },
                  { kind: "separator" },
                  { label: `Edit tags of ${t.title}`, onSelect: () => onEdit([t]) },
                  ...(onLyrics ? [{ label: `Edit lyrics of ${t.title}`, onSelect: () => onLyrics(t) }] : []),
                  { label: `Show ${t.title} in its folder`, onSelect: () => onReveal(t.path) },
                ]} />}
              </span>
            </div>;
          })}
        </div>
      </div>
    </div>
  </div>;
}
