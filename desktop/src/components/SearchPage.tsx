import { downloadPlan } from "../lib/downloadPlan";
import { audioFormatName } from "../lib/audioFormats";
import DownloadPlaylistTarget from "./DownloadPlaylistTarget";
import type { PlaylistsApi } from "../hooks/usePlaylists";
import { AlertCircle, Search } from "lucide-react";
import type { useDownloadActions } from "../hooks/useDownloadActions";
import { useMediaActions } from "../hooks/useMediaDialogs";
import { LISTING_MAX, LISTING_PAGE, SEARCH_MAX, SEARCH_PAGE_SIZE, type useSearchFlow } from "../hooks/useSearchFlow";
import { errorText, openUrl, type MediaInfo } from "../lib/api";
import { activeOptions } from "../lib/extra";
import { friendlyError } from "../lib/errors";
import { canonicalUrl, playlistOf } from "../lib/links";
import type { FormatPreset } from "../lib/presets";
import type { HistoryItem, Settings } from "../lib/storage";
import MediaCard from "./MediaCard";
import LyricsChoice from "./LyricsChoice";
import PageHeading from "./PageHeading";
import SearchResults from "./SearchResults";
import type { Page } from "./Sidebar";

interface Props {
  onImportLinks: () => void;
  onSaveSource?: () => Promise<void>;
  playlists: PlaylistsApi;
  playlistTarget: string;
  onPlaylistTarget: (id: string) => void;
  flow: ReturnType<typeof useSearchFlow>;
  actions: ReturnType<typeof useDownloadActions>;
  settings: Settings;
  /** The open video, once its details match what is in the search box. */
  visibleMedia: MediaInfo | null;
  history: HistoryItem[];
  existing: Record<string, boolean>;
  setPage: (page: Page) => void;
  openDownloaded: (path: string) => void;
  revealDownloaded: (path: string) => void;
  copyText: (text: string, what: string) => void;
  showFlash: (text: string, error?: boolean) => void;
  ensureLyricsConsent: () => Promise<boolean>;
  savePreset: (preset: Omit<FormatPreset, "id">) => string | null;
}

/** The Search page: the open video's card, search results or a playlist listing, and any message about the lookup. */
export default function SearchPage({ onImportLinks, onSaveSource, playlists, playlistTarget, onPlaylistTarget, flow, actions, settings, visibleMedia, history, existing, setPage, openDownloaded, revealDownloaded, copyText, showFlash, ensureLyricsConsent, savePreset }: Props) {
  const { url, media, search, errorMessage } = flow;
  const mediaActions = useMediaActions();
  const mode = settings.mode;
  const advanced = mode === "advanced";
  const audioLabel = advanced ? audioFormatName(settings.audioFormat) : "MP3";
  const isListing = search?.kind === "playlist" || search?.kind === "channel";
  const listingTitle =
    search?.kind === "playlist" || search?.kind === "channel" ? `${search.title ?? ""}${search.total ? ` · ${search.total} video${search.total === 1 ? "" : "s"}` : ""}` : search?.kind === "links" ? search.title : undefined;
  const partOfPlaylist = visibleMedia && media ? playlistOf(media.url) : null;
  const friendlyInputError = errorMessage ? friendlyError(errorMessage) : null;
  const previouslyDownloaded = history.find((h) => url.trim() && h.url === url.trim() && !h.clip);
  const downloadedUrls = new Set(history.map((h) => h.url));
  const downloadsOfCurrent = media
    ? history.filter((h) => canonicalUrl(h.url) === canonicalUrl(media.url)).map((item) => ({ item, exists: item.path ? existing[item.path] : undefined }))
    : [];

  return (
    <div className="page flush">
      <PageHeading title="Search" description="Find a video or paste a link, then choose video or audio.">
        <button type="button" className="btn small" onClick={onImportLinks}>Import links from a file</button>
      </PageHeading>
      {(visibleMedia || search) && <div className="px-3 py-2"><DownloadPlaylistTarget api={playlists} value={playlistTarget} onChange={onPlaylistTarget} /></div>}
      {(errorMessage && friendlyInputError) || (previouslyDownloaded && !visibleMedia) ? (
        <div className="px-4 pt-3 flex flex-col gap-2">
          {previouslyDownloaded && !visibleMedia && (
            <div className="alert note items-center">
              <span className="flex-1 min-w-0 truncate">
                You already downloaded this (<b>{previouslyDownloaded.title}</b>) on {new Date(previouslyDownloaded.timestamp).toLocaleDateString()}.
              </span>
              <button onClick={() => setPage("history")} className="link border-0 bg-transparent p-0 shrink-0" style={{ font: "inherit" }}>
                View in History
              </button>
            </div>
          )}
          {errorMessage && friendlyInputError && (
            <div className="alert">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#b3261e" }} />
              {advanced ? (
                <div className="break-words whitespace-pre-wrap selectable">{errorMessage}</div>
              ) : (
                <div className="flex flex-col gap-1 min-w-0">
                  <b>{friendlyInputError.summary}</b>
                  {friendlyInputError.hint && <span>{friendlyInputError.hint}</span>}
                  <button onClick={() => flow.setShowErrorDetails((v) => !v)} className="link border-0 bg-transparent p-0 w-fit text-left" style={{ font: "inherit" }}>
                    {flow.showErrorDetails ? "Hide" : "Show"} technical details
                  </button>
                  {flow.showErrorDetails && <div className="mono dim break-words whitespace-pre-wrap selectable">{errorMessage}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {onSaveSource && <div className="px-3 py-2"><button className="btn small" onClick={() => void onSaveSource()}>Save this channel or playlist</button></div>}
      {visibleMedia && partOfPlaylist && !isListing && (
        <div className="px-3 pt-3">
          <div className="alert note items-center">
            <span className="flex-1 min-w-0">This video is part of a playlist.</span>
            <button
              className="btn small"
              onClick={() => {
                flow.setUrl(partOfPlaylist.url);
                flow.setMedia(null);
                flow.loadListing(partOfPlaylist.url, LISTING_PAGE);
              }}
            >
              View playlist
            </button>
          </div>
        </div>
      )}

      {visibleMedia && (
        <div className="p-3">
          <MediaCard
            key={media?.url}
            info={visibleMedia}
            mode={mode}
            extras={{
              cover: advanced ? settings.coverMode : "default",
              lyrics: settings.searchSource === "youtube_music" ? "both" : advanced ? settings.lyricsMode : "off",
              audioQuality: advanced ? settings.audioQuality : "",
              normalize: advanced && settings.audioNormalize,
              trimSilence: advanced && settings.audioTrimSilence,
            }}
            presets={settings.presets}
            automaticLyrics={settings.searchSource === "youtube_music"}
            onSavePreset={savePreset}
            onPreview={advanced ? actions.previewChoice : undefined}
            onWatchPreview={mediaActions && media ? () => mediaActions.preview(media.url, visibleMedia.title) : undefined}
            onLyricsChoice={ensureLyricsConsent}
            hasCookies={advanced && !!settings.cookiesBrowser}
            subtitleDefaults={advanced ? { mode: settings.subtitleMode, langs: settings.subtitleLangs, auto: settings.subtitleAuto } : { mode: "off", langs: settings.subtitleLangs, auto: true }}
            audioLabel={audioLabel}
            activeOptions={activeOptions(settings)}
            plan={downloadPlan(settings, media?.url ?? visibleMedia.webpage_url ?? "", visibleMedia.uploader)}
            downloads={downloadsOfCurrent}
            onDownload={actions.downloadCurrent}
            onOpen={openDownloaded}
            onReveal={revealDownloaded}
          />
        </div>
      )}

      {search && (
        <><div className="px-3 pt-2"><LyricsChoice label="Batch audio lyrics" value={actions.batchLyrics} automatic={settings.searchSource === "youtube_music"} onChange={actions.setBatchLyrics} /></div><SearchResults
          query={search.query}
          heading={listingTitle}
          limitNote={isListing && search.total && search.total > search.items.length ? `Showing the first ${search.items.length} of ${search.total} videos.` : null}
          onDownloadAll={isListing ? actions.downloadAll : undefined}
          results={search.items}
          view={settings.viewSearch}
          openUrl={visibleMedia ? url.trim() : null}
          checked={flow.checked}
          downloadedUrls={downloadedUrls}
          loadingMore={flow.loadingMore}
          canLoadMore={isListing ? search.items.length >= search.limit && search.limit < LISTING_MAX : search.kind === "search" && search.items.length >= search.limit && search.limit < SEARCH_MAX}
          advanced={advanced}
          audioLabel={audioLabel}
          notice={flow.batchNotice}
          onOpen={flow.selectResult}
          onToggle={flow.toggleChecked}
          onToggleAll={flow.toggleAll}
          onLoadMore={() =>
            isListing && search.sourceUrl
              ? flow.loadListing(search.sourceUrl, Math.min(search.limit + LISTING_PAGE, LISTING_MAX))
              : flow.runSearch(search.query, Math.min(search.limit + SEARCH_PAGE_SIZE, SEARCH_MAX))
          }
          onDownloadChecked={actions.downloadChecked}
          onDownloadOne={(r, preset) => actions.queueDownload(r.url, r.title, r.thumbnail, preset, null, actions.listingCtx(r), r.channel ?? undefined)}
          onCopy={copyText}
          onOpenInBrowser={(u) => openUrl(u).catch((e) => showFlash(errorText(e), true))}
          onSearchFor={flow.searchFor}
          downloadedFile={(u) => {
            const h = history.find((x) => x.url === u && x.path && !x.clip);
            return h?.path ? { path: h.path, exists: existing[h.path] } : null;
          }}
          onOpenFile={openDownloaded}
          onRevealFile={revealDownloaded}
        /></>
      )}

      {!search && !visibleMedia && !errorMessage && (
        <div className="empty" style={{ minHeight: 340 }}>
          <div className="big">
            <Search className="w-14 h-14" strokeWidth={1.25} />
          </div>
          <h2>What would you like to download?</h2>
          <p className="m-0">Use the search box above. Choose a source, type a name or paste a link, and press Enter.</p>
        </div>
      )}
    </div>
  );
}
