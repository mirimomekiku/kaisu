import { Download, Loader2, Podcast, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { PodcastsApi } from "../hooks/usePodcasts";
import { formatClock } from "../lib/format";
import { episodeDate } from "../lib/podcasts";

export default function PodcastsPage({ api, ready }: { api: PodcastsApi; ready: boolean }) {
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const show = api.subscriptions.find((s) => s.id === selected) ?? api.subscriptions[0];
  const feed = show ? api.feeds[show.id] : undefined;
  const disabled = !api.loaded || !ready || api.working;
  return (
    <section className="podcasts" aria-label="Podcasts">
      <form className="podcast-add" onSubmit={(e) => {
        e.preventDefault();
        void api.subscribe(url).then((id) => { if (id) { setSelected(id); setUrl(""); } });
      }}>
        <label className="flex-1 min-w-0">RSS feed address
          <input className="field w-full" type="url" required aria-label="RSS feed address" placeholder="https://example.com/podcast.xml" value={url} onChange={(e) => setUrl(e.target.value)} disabled={disabled} />
        </label>
        <button className="btn" type="submit" disabled={disabled || !url.trim()}>Subscribe</button>
        <button className="btn" type="button" disabled={disabled || api.subscriptions.length === 0} onClick={() => void api.checkAll()}>
          {api.working ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Check feeds
        </button>
      </form>
      <p className="dim">Subscribing contacts that website. Subscribed feeds are checked when Kaisu starts and every six hours while it is open. Automatic downloads apply to new episodes only.</p>
      {!ready && <p role="status">Finish setup and choose a download folder to use podcasts.</p>}
      {!api.loaded ? <p role="status">Loading subscriptions…</p> : api.subscriptions.length === 0 ? (
        <div className="empty"><Podcast className="w-10 h-10" /><h2>No podcasts yet</h2><p>Add a show's RSS feed to see its episodes.</p></div>
      ) : (
        <div className="podcast-layout">
          <nav aria-label="Podcast subscriptions" className="podcast-shows">
            {api.subscriptions.map((s) => <button className="source" key={s.id} aria-current={s.id === show?.id ? "true" : undefined} onClick={() => setSelected(s.id)}>{s.title}</button>)}
          </nav>
          {show && <div className="podcast-episodes" key={show.id}>
            <h2 className="m-0">{show.title}</h2>
            <p className="dim selectable break-words">{show.url}</p>
            <label className="flex items-center gap-2"><input type="checkbox" checked={show.auto} onChange={(e) => api.setAuto(show.id, e.target.checked)} />Download new episodes automatically</label>
            <p className="dim">Episodes save in Podcasts inside your download folder, in their original audio format. Unsubscribing keeps downloaded files.</p>
            <button className="btn small" onClick={() => api.unsubscribe(show.id)}>Unsubscribe</button>
            {api.errors[show.id] && <p role="alert">{api.errors[show.id]}</p>}
            {!feed ? <p role="status">{api.working ? "Reading the feed…" : "Check feeds to load episodes."}</p> : feed.episodes.length === 0 ? <p>This feed has no audio episodes.</p> : (
              <ul className="podcast-list" aria-label="Episodes">
                {feed.episodes.map((episode) => {
                  const date = episodeDate(episode.published);
                  return <li key={episode.id} className="podcast-episode">
                    <div className="flex-1 min-w-0"><b>{episode.title}</b> {api.fresh[show.id]?.includes(episode.id) && <span className="podcast-new">New</span>}
                      <div className="dim">{date !== null ? new Date(date).toLocaleDateString() : "Date unknown"}{episode.duration !== null ? ` · ${formatClock(episode.duration)}` : ""}</div>
                    </div>
                    <button className="btn small" disabled={disabled} aria-label={`Download ${episode.title}`} onClick={() => void api.download(show.id, episode)}><Download className="w-3 h-3" />Download</button>
                  </li>;
                })}
              </ul>
            )}
          </div>}
        </div>
      )}
    </section>
  );
}
