import { useCallback } from "react";
import type { useConfirm } from "../components/ConfirmDialog";
import type { BatchQuality } from "../components/SearchResults";
import type { DownloadChoice } from "../components/MediaCard";
import type { Page } from "../components/Sidebar";
import {
  checkFolder,
  errorText,
  preflightDownloads,
  previewCommand,
  type AudioExtras,
  type AudioFormat,
  type Clip,
  type CoverOptions,
  type LyricsMode,
  type MediaInfo,
  type MetaOptions,
  type PlaylistCtx,
  type Preset,
  type SearchResult,
  type SubtitleOptions,
} from "../lib/api";
import { buildExtra } from "../lib/extra";
import { clipKeyOf, clipLabel, formatBytes } from "../lib/format";
import { matchSiteRule } from "../lib/siteRules";
import type { HistoryItem, Settings } from "../lib/storage";
import { sameDownload, type DownloadItem, type EnqueueInput } from "./useDownloads";
import type { Listing } from "./useSearchFlow";

const LOW_DISK_BYTES = 2 * 1024 * 1024 * 1024;

/** Something to download: what the user asked for, before it becomes a queue item. */
export interface DownloadReq {
  url: string;
  title: string;
  thumbnail: string;
  preset: Preset;
  formatId: string | null;
  playlist?: PlaylistCtx | null;
  clip?: Clip | null;
  /** The title is only the link; yt-dlp supplies the real one once it starts. */
  placeholderTitle?: boolean;
  channel?: string;
  /** Subtitles picked for this one download; otherwise the settings decide (Advanced mode only). */
  subs?: SubtitleOptions | null;
  meta?: MetaOptions | null;
  cover?: CoverOptions | null;
  lyrics?: LyricsMode | null;
  audio?: AudioExtras | null;
  /** Where to save instead of the usual folder (also used by site rules and podcasts). */
  outDir?: string;
  audioFormat?: AudioFormat;
  estimatedBytes?: number;
  /** The site of the rule that changed this download, for saying so. */
  ruledBy?: string;
  /** Feed episodes keep their original audio and stay inside the podcast folder. */
  applySiteRules?: boolean;
}

const isFinishedStatus = (status: string) => status === "completed" || status === "error" || status === "cancelled";

interface Args {
  settings: Settings;
  settingsRef: React.MutableRefObject<Settings>;
  /** Where downloads are saved. */
  outDir: string;
  itemsRef: React.MutableRefObject<DownloadItem[]>;
  enqueue: (inputs: EnqueueInput[]) => void;
  confirm: ReturnType<typeof useConfirm>;
  history: HistoryItem[];
  historyRef: React.MutableRefObject<HistoryItem[]>;
  existing: Record<string, boolean>;
  openDownloaded: (path: string) => void;
  showFlash: (text: string, error?: boolean) => void;
  announce: (note: { title: string; subtitle?: string }) => void;
  setPage: (page: Page) => void;
  setErrorMessage: (message: string | null) => void;
  media: { url: string; info: MediaInfo } | null;
  search: Listing | null;
  checked: Set<string>;
  setChecked: (checked: Set<string>) => void;
  setBatchNotice: (notice: string | null) => void;
}

/** Everything that puts downloads in the queue: checks first (already queued, already on disk, disk space), then queues. */
export function useDownloadActions(a: Args) {
  const { settings, settingsRef, outDir, itemsRef, enqueue, confirm, historyRef, existing, openDownloaded, showFlash, announce, setPage, setErrorMessage, media, search } = a;

  /**
   * The one way downloads get queued. Skips what is already queued, asks before repeating something already on
   * disk, and warns when the drive is nearly full. Returns how many were added (0 if the user backed out).
   */
  const submitDownloads = async (asked: DownloadReq[], estimateBytes: number | null = null): Promise<number> => {
    // Site rules (Advanced mode) change what is downloaded and where it goes, before anything is compared or queued.
    const rules = settingsRef.current.mode === "advanced" ? settingsRef.current.siteRules : [];
    const reqs = asked.map((r): DownloadReq => {
      const rule = rules.length && r.applySiteRules !== false ? matchSiteRule(rules, r.url, r.channel) : null;
      if (!rule) return r;
      return { ...r, preset: rule.preset || r.preset, audioFormat: rule.audioFormat || undefined, outDir: rule.folder.trim() || undefined, ruledBy: rule.host.trim() };
    });
    if (!outDir) {
      setErrorMessage("Could not determine a download folder. Choose one in Settings.");
      return 0;
    }
    const keyOf = (r: DownloadReq) => ({ url: r.url, preset: r.preset, clipKey: clipKeyOf(r.clip ?? null) });

    const live = itemsRef.current.filter((i) => !isFinishedStatus(i.status));
    let todo = reqs.filter((r) => !live.some((i) => sameDownload(i, keyOf(r))));
    if (todo.length === 0) {
      announce({ title: "Already in Downloads", subtitle: reqs.length === 1 ? reqs[0].title : `${reqs.length} items` });
      return 0;
    }

    if (settingsRef.current.warnDuplicates) {
      const onDisk = (r: DownloadReq) =>
        historyRef.current.find((h) => sameDownload({ url: h.url, preset: h.preset, clipKey: h.clip }, keyOf(r)) && h.path && existing[h.path] !== false);
      const dupes = todo.filter((r) => onDisk(r));
      if (dupes.length > 0) {
        if (todo.length === 1) {
          const prior = onDisk(todo[0]);
          const choice = await confirm.ask({
            title: "You already downloaded this",
            body: (
              <p className="m-0">
                <b>{todo[0].title}</b> was downloaded{prior ? ` on ${new Date(prior.timestamp).toLocaleDateString()}` : ""}. Download it again?
              </p>
            ),
            buttons: [
              { id: "cancel", label: "Cancel" },
              ...(prior?.path ? [{ id: "open", label: "Open the file" }] : []),
              { id: "again", label: "Download again", primary: true },
            ],
          });
          if (choice === "open" && prior?.path) openDownloaded(prior.path);
          if (choice !== "again") return 0;
        } else {
          const choice = await confirm.ask({
            title: `${dupes.length} of these are already downloaded`,
            body: <p className="m-0">You have already downloaded {dupes.length} of the {todo.length} selected items. Skip those, or download everything again?</p>,
            buttons: [
              { id: "cancel", label: "Cancel" },
              { id: "all", label: "Download all anyway" },
              ...(dupes.length < todo.length ? [{ id: "skip", label: `Skip ${dupes.length} already downloaded`, primary: true }] : []),
            ],
          });
          if (choice === "skip") todo = todo.filter((r) => !dupes.includes(r));
          else if (choice !== "all") return 0;
        }
      }
    }

    // A rule's folder has to be usable; if it isn't, say so and use the usual folder rather than failing.
    const badFolders = new Map<string, string>();
    for (const folder of new Set(todo.flatMap((r) => (r.outDir ? [r.outDir] : [])))) {
      await checkFolder(folder).catch((err) => badFolders.set(folder, errorText(err)));
    }
    // Episodes must stay in their show folder. A failed folder check must not silently redirect them.
    const refusedEpisode = todo.find((r) => r.applySiteRules === false && r.outDir && badFolders.has(r.outDir));
    if (refusedEpisode?.outDir) {
      showFlash(badFolders.get(refusedEpisode.outDir)!, true);
      return 0;
    }
    if (badFolders.size > 0) showFlash(`A site rule's folder can't be used (${[...badFolders.values()][0]}). Saving in the usual folder instead.`, true);

    const inputs = todo.map((r) => ({
      url: r.url, title: r.title, thumbnail: r.thumbnail, preset: r.preset,
      outDir: r.outDir && !badFolders.has(r.outDir) ? r.outDir : outDir,
      extra: buildExtra(settings, r.formatId, { playlist: r.playlist, clip: r.clip, subs: r.subs, meta: r.meta, cover: r.cover, lyrics: r.lyrics, audio: r.audio, audioFormat: r.audioFormat }),
      estimatedBytes: r.estimatedBytes ?? (estimateBytes && Number.isSafeInteger(estimateBytes) && estimateBytes > 0 ? Math.ceil(estimateBytes / todo.length) : undefined),
      clipKey: clipKeyOf(r.clip ?? null), placeholderTitle: r.placeholderTitle, channel: r.channel,
    }));
    try {
      const groups = await preflightDownloads(inputs.map((r, i) => ({ id: `preflight-${i}`, url: r.url, preset: r.preset, out_dir: r.outDir, extra: r.extra, estimated_bytes: r.estimatedBytes })));
      for (const group of groups) {
        if (group.free < group.needed) throw new Error(`There isn't enough free disk space for ${group.folder}. Allow at least ${formatBytes(group.needed)} for downloads, conversion files and active jobs.`);
        if (group.free < LOW_DISK_BYTES || group.free < group.needed) {
          const choice = await confirm.ask({ title: "Low disk space", body: <p className="m-0">Only <b>{formatBytes(group.free)}</b> is free for <b>{group.folder}</b>. {group.estimated ? `Allow about ${formatBytes(group.needed)} for these downloads, temporary conversion files and active jobs.` : "The final download size is unknown."} Continue anyway?</p>, buttons: [{ id: "go", label: "Download anyway" }, { id: "cancel", label: "Cancel", primary: true }], cancelId: "cancel" });
          if (choice !== "go") return 0;
        }
      }
    } catch (err) { showFlash(errorText(err), true); return 0; }
    enqueue(inputs);
    const ruled = todo.filter((r) => r.ruledBy);
    const what = todo.length === 1 ? todo[0].title : `${todo.length} items`;
    announce({ title: "Added to Downloads", subtitle: ruled.length > 0 ? `${what} · site rule for ${ruled[0].ruledBy}` : what });
    return todo.length;
  };

  const queueDownload = (target: string, title: string, thumbnail: string, preset: Preset, formatId: string | null, playlist?: PlaylistCtx | null, channel?: string) =>
    submitDownloads([{ url: target, title, thumbnail, preset, formatId, playlist, channel }]);

  /** Queues earlier downloads again, each in the format it had. Clips can't be repeated from what history keeps. */
  const downloadAgainMany = async (picked: HistoryItem[]) => {
    const whole = picked.filter((h) => !h.clip);
    if (whole.length < picked.length) showFlash(`${picked.length - whole.length} clip${picked.length - whole.length === 1 ? " was" : "s were"} skipped. Download clips again from their video.`);
    if (whole.length === 0) return;
    const added = await submitDownloads(whole.map((h) => ({ url: h.url, title: h.title, thumbnail: h.thumbnail, preset: h.preset, formatId: null, channel: h.channel })));
    if (added > 0) setPage("downloads");
  };

  /** The command a choice would run, for Advanced mode's "Show the command". */
  const previewChoice = async (choice: DownloadChoice): Promise<string> => {
    if (!media) return "";
    return previewCommand({
      id: "preview",
      url: media.url,
      preset: choice.preset,
      out_dir: outDir || "~/Downloads",
      extra: buildExtra(settings, choice.formatId, { clip: choice.clip, subs: choice.subs, meta: choice.meta, cover: choice.cover, lyrics: choice.lyrics, audio: choice.audio }),
    });
  };

  const downloadCurrent = async (choice: DownloadChoice) => {
    if (!media) return false;
    const key = clipKeyOf(choice.clip);
    const title = choice.clip ? `${media.info.title} (clip ${clipLabel(key)})` : media.info.title;
    const added = await submitDownloads(
      [{ url: media.url, title, thumbnail: media.info.thumbnail ?? "", preset: choice.preset, formatId: choice.formatId, clip: choice.clip, channel: media.info.uploader ?? undefined, subs: choice.subs, meta: choice.meta, cover: choice.cover, lyrics: choice.lyrics, audio: choice.audio }],
      choice.estimate,
    );
    return added > 0;
  };

  /** Playlist items remember their position, so their files can be numbered. */
  const listingCtx = useCallback(
    (r: SearchResult): PlaylistCtx | null =>
      search?.kind === "playlist" ? { title: search.title ?? "Playlist", index: search.items.indexOf(r) + 1, total: Math.max(search.total ?? 0, search.items.length) } : null,
    [search],
  );

  const requestsFor = (picked: SearchResult[], kind: "video" | "audio", quality: BatchQuality): DownloadReq[] =>
    picked.map((r) => ({
      url: r.url,
      title: r.title,
      thumbnail: r.thumbnail,
      preset: kind === "audio" ? "audio" : quality,
      formatId: null,
      playlist: listingCtx(r),
      placeholderTitle: search?.kind === "links",
      channel: r.channel ?? undefined,
    }));

  const downloadPicked = async (picked: SearchResult[], kind: "video" | "audio", quality: BatchQuality) => {
    const added = await submitDownloads(requestsFor(picked, kind, quality));
    if (added > 0) {
      a.setChecked(new Set());
      a.setBatchNotice(`Added ${added} ${kind === "audio" ? "audio" : "video"} download${added > 1 ? "s" : ""} to the queue.`);
    }
  };
  const downloadChecked = (kind: "video" | "audio", quality: BatchQuality) => {
    if (search) downloadPicked(search.items.filter((r) => a.checked.has(r.url)), kind, quality);
  };
  const downloadAll = (kind: "video" | "audio") => {
    if (search) downloadPicked(search.items, kind, "best");
  };

  return { submitDownloads, queueDownload, downloadAgainMany, previewChoice, downloadCurrent, listingCtx, downloadChecked, downloadAll };
}
