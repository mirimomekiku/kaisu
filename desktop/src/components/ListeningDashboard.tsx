import ListeningSessions from "./ListeningSessions";
import { useMemo } from "react";
import type { LibTrack } from "../lib/api";
import type { Listening } from "../lib/listening";
import { listeningDuration, listeningSummary } from "../lib/listeningDashboard";
export default function ListeningDashboard({ tracks, stats, onPlay }: { tracks: LibTrack[]; stats: Listening; onPlay: (track: LibTrack) => void }) {
  const summary = useMemo(() => listeningSummary(tracks, stats), [tracks, stats]);
  const songs = (list: typeof summary.top) => <ol className="listening-songs">{list.map((s) => <li key={s.path}><div className="min-w-0 flex-1"><button className="link truncate" disabled={!s.track || s.track.missing} aria-label={`Play ${s.title}`} onClick={() => s.track && onPlay(s.track)}>{s.title}</button><span className="block dim truncate">{s.artist}{!s.track || s.track.missing ? " (unavailable)" : ""}</span></div><span className="dim">{s.plays} plays</span><span className="dim">{s.seconds === undefined ? "--" : listeningDuration(s.seconds)}</span></li>)}</ol>;
  return <div className="lib-scroll listening-dashboard" role="region" aria-label="Listening dashboard">
    <h2>Your listening</h2>
    <ListeningSessions />
    <div className="listening-totals"><div><b>{summary.plays.toLocaleString()}</b><span>Completed plays</span></div><div><b>{listeningDuration(summary.seconds)}</b><span>Measured listening time</span></div><div><b>{summary.unique.toLocaleString()}</b><span>Different tracks</span></div></div>
    <p className="dim">All-time local statistics. Listening time is measured during playback from this version onward, including partial plays. Pauses, buffering and seeking are excluded. Earlier completed play counts are retained; their listening time is unknown.</p>
    {summary.unique === 0 && <p>Play some music to start your listening history.</p>}
    <div className="listening-columns"><section aria-label="Recently played"><h3>Recently played</h3>{summary.recent.length ? songs(summary.recent) : <p className="dim">Nothing played yet.</p>}</section><section aria-label="Most played"><h3>Most played songs</h3>{summary.top.length ? songs(summary.top) : <p className="dim">Finish a track to see it here.</p>}</section><section aria-label="Top artists"><h3>Top artists</h3><ol className="listening-songs">{summary.artists.map((a) => <li key={a.name}><b className="flex-1 truncate">{a.name}</b><span>{a.plays} plays</span><span>{a.seconds > 0 ? listeningDuration(a.seconds) : "--"}</span></li>)}</ol></section></div>
  </div>;
}
