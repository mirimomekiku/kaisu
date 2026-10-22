import { Heart, Star } from "lucide-react";
import { useMusicPreferences } from "../hooks/useMusicPreferences";
export default function TrackPreferences({ path, title, compact = false }: { path: string; title: string; compact?: boolean }) {
  const api = useMusicPreferences();
  if (!api) return null;
  const p = api.preferences[path];
  return <span className="track-preferences" onDoubleClick={(e) => e.stopPropagation()}>
    <button className="row-btn favorite-button" disabled={!api.loaded} aria-label={`${p?.favorite ? "Unfavorite" : "Favorite"} ${title}`} title={p?.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={!!p?.favorite} onClick={() => api.toggleFavorite(path)}><Heart className="w-3.5 h-3.5" fill={p?.favorite ? "currentColor" : "none"} /></button>
    {!compact && <label className="track-rating" title="Rating (0 means unrated)"><Star className="w-3 h-3" aria-hidden="true" /><select disabled={!api.loaded} aria-label={`Rating for ${title}`} value={p?.rating ?? 0} onChange={(e) => api.setRating(path, Number(e.target.value))}><option value="0">0</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
  </span>;
}
