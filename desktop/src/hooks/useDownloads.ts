import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelDownload,
  errorText,
  startDownload,
  type DownloadEvent,
  type ExtraOptions,
  type Preset,
} from "../lib/api";
import { isTransient, retryDelaySeconds, isRateLimited, retryAfterSeconds, RETRY } from "../lib/errors";
import { reorderWaiting } from "../lib/queueOrder";
import { sanitizeDownloadQueue } from "../lib/downloadValidation";
import { hostOf } from "../lib/links";
import { uniqueDownloads } from "../lib/downloadIdentity";
export { sameDownload } from "../lib/downloadIdentity";
import { networkAllocation } from "../lib/networkBudget";
import { pickStartable, resourceGate, type ResourceGate } from "../lib/queueStart";
import { customSecretValues, redactCustomText } from "../lib/redact";
import type { SavedDownload } from "../lib/storage";
import { editWaitingDownloads, type QueueEdit } from "../lib/queueEdit";

export type DownloadStatus = "queued" | "downloading" | "processing" | "paused" | "completed" | "error" | "cancelled";

export interface DownloadItem {
  cooldownUntil?: number;
  skipped?: boolean;
  stalledSeconds?: number;
  id: string;
  recoveryId?: string;
  estimatedBytes?: number;
  expectedVolume?: number;
  stage?: "preparing" | "downloading" | "converting" | "extras" | "verifying";
  indeterminate?: boolean;
  title: string;
  url: string;
  thumbnail: string;
  preset: Preset;
  outDir: string;
  extra: ExtraOptions;
  status: DownloadStatus;
  progress: number;
  speed: number | null;
  eta: number | null;
  path: string | null;
  errorMsg?: string;
  /** Recent yt-dlp output, newest last (capped). */
  log: string[];
  /** Set for partial downloads (e.g. "80-165"): part of the item's identity, so a clip isn't a duplicate of the whole video. */
  clipKey?: string;
  /** The title is only the link for now; yt-dlp will tell us the real one. */
  placeholderTitle?: boolean;
  /** Who published it (for history columns and sorting). */
  channel?: string;
  /** The finished file looked damaged or cut off. */
  warning?: string;
  /** How many times a network failure has been retried already. */
  attempt?: number;
  /** A retry is waiting until this time (ms since 1970). */
  retryAt?: number;
}

export interface EnqueueInput {
  recoveryId?: string;
  estimatedBytes?: number;
  expectedVolume?: number;
  url: string;
  title: string;
  thumbnail: string;
  preset: Preset;
  outDir: string;
  extra: ExtraOptions;
  clipKey?: string;
  placeholderTitle?: boolean;
  channel?: string;
}

const MAX_LOG_LINES = 400;

const isActive = (s: DownloadStatus) => s === "downloading" || s === "processing";
const isFinished = (s: DownloadStatus) => s === "completed" || s === "error" || s === "cancelled";

let nextId = 0;
const newId = () => `${Date.now().toString(36)}-${(nextId++).toString(36)}`;

export interface SchedulePolicy {
  /** Nothing should run right now (a pause rule is active). */
  blocked: boolean;
  /** Speed limit that replaces the one set on each download, while a limit rule is active. */
  limit: string | null;
}

const NO_POLICY: SchedulePolicy = { blocked: false, limit: null };

/** Download queue. Items wait as "queued" until a slot (`concurrency`) frees up; they can be paused and resumed. */
export interface QueueLimits {
  globalRate?: string;
  fragments?: number;
  /** Tries again this many times after a network failure. */
  retries: number;
  /** Most running downloads from one website (0 = no limit). */
  perSite: number;
}
const NO_LIMITS: QueueLimits = { retries: 0, perSite: 0 };

export function useDownloads(concurrency: number, onCompleted: (item: DownloadItem) => void, policy: SchedulePolicy = NO_POLICY, limits: QueueLimits = NO_LIMITS) {
  const limitsRef = useRef(limits);
  limitsRef.current = limits;
  // Bumped when a waiting retry becomes due, so the scheduler looks at the queue again.
  const [tick, setTick] = useState(0);
  const [items, setItems] = useState<DownloadItem[]>([]);
  const started = useRef(new Set<string>());
  const runs = useRef(new Map<string, { nativeId: string; terminal: boolean }>());
  const cooldowns = useRef(new Map<string, number>());
  const resourceKey = JSON.stringify([concurrency, limits.globalRate ?? "", limits.fragments ?? 8]);
  const gate = useRef<ResourceGate>({ key: resourceKey, draining: false });
  const lastResources = useRef(resourceKey);
  const stop = useCallback((id: string) => { const run = runs.current.get(id); return run ? cancelDownload(run.nativeId) : Promise.resolve(); }, []);
  const pausing = useRef(new Set<string>());
  /** Downloads the schedule stopped (or restarted to change their speed limit); they carry on by themselves. */
  const autoPaused = useRef(new Set<string>());
  /** Notes from the check of a finished file, kept until the completion arrives (they come one after the other). */
  const warnings = useRef(new Map<string, string>());
  const policyRef = useRef(policy);
  policyRef.current = policy;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  const patch = useCallback((id: string, update: (item: DownloadItem) => Partial<DownloadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id && !isFinished(it.status) ? { ...it, ...update(it) } : it)));
  }, []);

  const handleMissingOutput = (id: string) => patch(id, () => ({ status: "error", errorMsg: "The downloader exited without producing an output file.", speed: null, eta: null }));

  const handleEvent = useCallback(
    (id: string, e: DownloadEvent) => {
      switch (e.kind) {
        case "stalled":
          patch(id, () => e.seconds > 0 ? { stalledSeconds: e.seconds, speed: null, eta: null } : { stalledSeconds: undefined });
          break;
        case "stage":
          patch(id, (it) => it.status === "paused" ? {} : { stalledSeconds: undefined, stage: e.stage, status: e.stage === "preparing" ? "downloading" : "processing", indeterminate: true, speed: null, eta: null });
          break;
        case "warning":
          warnings.current.set(id, e.message);
          patch(id, () => ({ warning: e.message }));
          break;
        case "progress":
          patch(id, (it) => (it.status === "paused" ? {} : { status: "downloading", stage: "downloading", indeterminate: e.pct == null || !Number.isFinite(e.pct), progress: e.pct != null && Number.isFinite(e.pct) ? Math.max(it.progress, Math.min(99, Math.max(0, e.pct))) : it.progress, speed: e.speed != null && Number.isFinite(e.speed) && e.speed >= 0 ? e.speed : null, eta: e.eta != null && Number.isFinite(e.eta) && e.eta >= 0 ? e.eta : null }));
          break;
        case "processing":
          patch(id, (it) => (it.status === "paused" ? {} : { status: "processing", stage: "converting", indeterminate: true, progress: 99, speed: null, eta: null }));
          break;
        case "meta":
          patch(id, (it) => (it.placeholderTitle ? { title: e.title, placeholderTitle: false } : {}));
          break;
        case "log":
          patch(id, (it) => ({ log: [...it.log, e.line].slice(-MAX_LOG_LINES) }));
          break;
        case "skipped":
        case "done": {
          if (!e.path) { handleMissingOutput(id); break; }
          const done = itemsRef.current.find((it) => it.id === id);
          patch(id, () => ({ skipped: e.kind === "skipped", status: "completed", progress: 100, speed: null, eta: null, path: e.path }));
          if (done && !isFinished(done.status)) onCompletedRef.current({ ...done, path: e.path, warning: warnings.current.get(id) ?? done.warning });
          warnings.current.delete(id);
          break;
        }
        case "cancelled":
          // Pausing stops the process the same way cancelling does; the difference is what we keep.
          if (pausing.current.delete(id)) {
            if (autoPaused.current.has(id) && !policyRef.current.blocked) {
              autoPaused.current.delete(id);
              started.current.delete(id);
              patch(id, () => ({ status: "queued", speed: null, eta: null }));
            } else {
              patch(id, () => ({ status: "paused", speed: null, eta: null }));
            }
          }
          else patch(id, () => ({ status: "cancelled", speed: null, eta: null }));
          break;
        case "checked":
          if (!e.ok) {
            warnings.current.set(id, e.note ?? "This file may be damaged.");
            patch(id, () => ({ warning: e.note ?? "This file may be damaged." }));
          }
          break;
        case "error": {
          pausing.current.delete(id);
          const it = itemsRef.current.find((x) => x.id === id);
          const attempt = (it?.attempt ?? 0) + 1;
          const rateLimited = isRateLimited(e.message);
          const wait = Math.max(retryDelaySeconds(attempt, Math.random()), rateLimited ? RETRY.rateLimitCooldown : 0, retryAfterSeconds(e.message)) * 1000;
          if (it && rateLimited) {
            const host = hostOf(it.url), until = Math.max(cooldowns.current.get(hostOf(it.url)) ?? 0, Date.now() + wait);
            cooldowns.current.set(host, until);
            setItems((prev) => prev.map((item) => item.status === "queued" && hostOf(item.url) === host ? { ...item, cooldownUntil: until } : item));
            setTimeout(() => setTick((n) => n + 1), wait + 50);
          }
          if (it && attempt <= limitsRef.current.retries && isTransient(e.message)) {
            // A network hiccup: wait a little and go again, keeping what was downloaded.
            started.current.delete(id);
            patch(id, () => ({ status: "queued", speed: null, eta: null, attempt, retryAt: Date.now() + wait, cooldownUntil: cooldowns.current.get(hostOf(it.url)), errorMsg: undefined }));
            setTimeout(() => setTick((n) => n + 1), wait + 50);
          } else {
            patch(id, () => ({ status: "error", speed: null, eta: null, errorMsg: e.message, retryAt: undefined }));
          }
          break;
        }
      }
    },
    [patch],
  );

  // Scheduler: start queued items while there are free slots.
  useEffect(() => {
    if (policy.blocked) return;
    const running = items.filter((it) => isActive(it.status)).length;
    const opened = resourceGate(gate.current, resourceKey, running);
    gate.current = opened.gate;
    if (!opened.canStart) return;
    const allocation = networkAllocation(concurrency, limits.fragments, limits.globalRate);
    if (allocation.error) {
      if (items.some((item) => item.status === "queued")) setItems((prev) => prev.map((item) => item.status === "queued" ? { ...item, status: "error", errorMsg: `Total download speed: ${allocation.error}` } : item));
      return;
    }
    const free = Math.max(0, allocation.slots - running);
    if (free === 0) return;

    const toStart = pickStartable(items, { free, now: Date.now(), cooldowns: cooldowns.current, perSite: limits.perSite, started: started.current });
    if (toStart.length === 0) return;

    for (const it of toStart) started.current.add(it.id);
    const ids = new Set(toStart.map((it) => it.id));
    setItems((prev) => prev.map((it) => (ids.has(it.id) ? { ...it, status: "downloading", stage: "preparing", indeterminate: true, warning: undefined } : it)));

    for (const it of toStart) {
      warnings.current.delete(it.id);
      const run = { nativeId: newId(), terminal: false };
      runs.current.set(it.id, run);
      const secrets = customSecretValues(it.extra.custom_args);
      const safeText = (text: string) => redactCustomText(text, secrets);
      const receive = (e: DownloadEvent) => {
        if (runs.current.get(it.id) !== run || run.terminal) return;
        if (e.kind === "log") e = { ...e, line: safeText(e.line) };
        if (e.kind === "error" || e.kind === "warning") e = { ...e, message: safeText(e.message) };
        if (e.kind === "meta") e = { ...e, title: safeText(e.title) };
        if (e.kind === "checked" && e.note) e = { ...e, note: safeText(e.note) };
        if (["done", "skipped", "error", "cancelled"].includes(e.kind)) run.terminal = true;
        handleEvent(it.id, e);
      };
      startDownload(
        { id: run.nativeId, recovery_id: it.recoveryId ?? it.id, estimated_bytes: it.estimatedBytes, expected_volume: it.expectedVolume, url: it.url, preset: it.preset, out_dir: it.outDir, extra: { ...it.extra, managed_retries: limits.retries > 0, fragment_limit: allocation.fragments, rate_limit: allocation.rate(policy.limit ?? it.extra.rate_limit) } },
        receive,
      ).catch((err) => receive({ kind: "error", message: errorText(err) })).finally(() => {
        if (runs.current.get(it.id) === run) runs.current.delete(it.id);
      });
    }
  }, [items, concurrency, handleEvent, policy.blocked, policy.limit, limits.perSite, limits.globalRate, limits.fragments, resourceKey, tick]);

  // The schedule changed. A pause rule stops what is running (and brings it back afterwards); a new speed limit
  // only takes effect when a download starts, so running ones are restarted to pick it up.
  const lastPolicy = useRef(policy);
  useEffect(() => {
    const before = lastPolicy.current;
    lastPolicy.current = policy;
    const changedResources = lastResources.current !== resourceKey;
    lastResources.current = resourceKey;
    if (before.blocked === policy.blocked && before.limit === policy.limit && !changedResources) return;
    const running = itemsRef.current.filter((it) => isActive(it.status));
    if (policy.blocked) {
      for (const it of running) {
        autoPaused.current.add(it.id);
        pausing.current.add(it.id);
        stop(it.id).catch(() => pausing.current.delete(it.id));
      }
      return;
    }
    if (before.blocked) {
      // Resume what the pause rule stopped.
      for (const id of [...autoPaused.current]) {
        const it = itemsRef.current.find((x) => x.id === id);
        if (it?.status === "paused") {
          autoPaused.current.delete(id);
          started.current.delete(id);
          setItems((prev) => prev.map((x) => (x.id === id && x.status === "paused" ? { ...x, status: "queued", speed: null, eta: null } : x)));
        }
        // Still stopping: the "cancelled" event will bring it back, because we are no longer blocked.
      }
      return;
    }
    for (const it of running) {
      autoPaused.current.add(it.id);
      pausing.current.add(it.id);
      stop(it.id).catch(() => pausing.current.delete(it.id));
    }
  }, [policy, resourceKey]);

  const enqueue = useCallback((inputs: EnqueueInput | EnqueueInput[]) => {
    const list = uniqueDownloads(Array.isArray(inputs) ? inputs : [inputs], itemsRef.current.filter((i) => !isFinished(i.status)));
    const created: DownloadItem[] = list.map((input) => ({
      ...input,
      cooldownUntil: cooldowns.current.get(hostOf(input.url)),
      id: newId(),
      status: "queued",
      progress: 0,
      speed: null,
      eta: null,
      path: null,
      log: [],
    }));
    // Newest first, but a batch keeps its own order (the first one added runs first).
    itemsRef.current = [...created.slice().reverse(), ...itemsRef.current];
    setItems((prev) => [...uniqueDownloads(created, prev.filter((i) => !isFinished(i.status))).slice().reverse(), ...prev]);
    return created.length;
  }, []);

  const cancel = useCallback(
    (id: string) => {
      const it = itemsRef.current.find((x) => x.id === id);
      if (!it) return;
      if (it.status === "queued" || it.status === "paused") {
        started.current.add(id);
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status: "cancelled" } : x)));
      } else {
        stop(id).catch((e) => console.warn("cancel failed", e));
      }
    },
    [],
  );

  /** Stops a download but keeps what was downloaded so far; `resume` carries on from there. */
  const pause = useCallback((id: string) => {
    autoPaused.current.delete(id);
    const it = itemsRef.current.find((x) => x.id === id);
    if (!it) return;
    if (it.status === "queued") {
      started.current.add(id);
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status: "paused" } : x)));
    } else if (isActive(it.status)) {
      pausing.current.add(id);
      stop(id).catch((e) => {
        pausing.current.delete(id);
        console.warn("pause failed", e);
      });
    }
  }, []);

  const resume = useCallback((id: string) => {
    autoPaused.current.delete(id);
    started.current.delete(id);
    pausing.current.delete(id);
    setItems((prev) => prev.map((x) => (x.id === id && x.status === "paused" ? { ...x, status: "queued", speed: null, eta: null } : x)));
  }, []);

  /** Moves a waiting download to the front of the line (it starts next). */
  const runNext = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find((x) => x.id === id && x.status === "queued");
      if (!item) return prev;
      const rest = prev.filter((x) => x.id !== id);
      // The oldest waiting item is the one nearest the end of the list, so "next" goes after the last waiting item.
      let at = -1;
      rest.forEach((x, i) => {
        if (x.status === "queued") at = i;
      });
      return at < 0 ? prev : [...rest.slice(0, at + 1), item, ...rest.slice(at + 1)];
    });
  }, []);

  /** Moves a waiting download to the back of the line. */
  const runLater = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find((x) => x.id === id && x.status === "queued");
      if (!item) return prev;
      const rest = prev.filter((x) => x.id !== id);
      const first = rest.findIndex((x) => x.status === "queued");
      return first < 0 ? prev : [...rest.slice(0, first), item, ...rest.slice(first)];
    });
  }, []);

  /** Drag and drop: puts `id` where `targetId` is among the waiting downloads (see `reorderWaiting`). */
  const reorder = useCallback((id: string, targetId: string) => setItems((prev) => reorderWaiting(prev, id, targetId)), []);

  /** A speed limit for one download (`null` = the usual one). A running download is restarted to pick it up, carrying on from where it was. */
  const setRateLimit = useCallback((id: string, limit: string | null) => {
    const running = itemsRef.current.find((x) => x.id === id && isActive(x.status));
    setItems((prev) => prev.map((it) => (it.id === id && !isFinished(it.status) ? { ...it, extra: { ...it.extra, rate_limit: limit } } : it)));
    if (running) {
      autoPaused.current.add(id);
      pausing.current.add(id);
      stop(id).catch(() => pausing.current.delete(id));
    }
  }, []);

  const editWaiting = useCallback((ids: string[], edit: QueueEdit) => {
    const selected = new Set(ids);
    setItems((prev) => {
      const unavailable = new Set(prev.filter((item) => pausing.current.has(item.id) || (item.status === "queued" && started.current.has(item.id))).map((item) => item.id));
      return editWaitingDownloads(prev, selected, edit, unavailable);
    });
  }, []);

  const pauseAll = useCallback(() => itemsRef.current.forEach((x) => (x.status === "queued" || isActive(x.status)) && pause(x.id)), [pause]);
  const resumeAll = useCallback(() => {
    // Resume oldest first so the queue order is what it was.
    itemsRef.current
      .filter((x) => x.status === "paused")
      .reverse()
      .forEach((x) => resume(x.id));
  }, [resume]);

  const retry = useCallback((id: string) => {
    started.current.delete(id);
    setItems((prev) =>
      prev.map((it) =>
        it.id === id && (it.status === "error" || it.status === "cancelled")
          ? { ...it, status: "queued", progress: 0, speed: null, eta: null, stage: "preparing", indeterminate: true, errorMsg: undefined, log: [], attempt: 0, retryAt: undefined, warning: undefined }
          : it,
      ),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id || !isFinished(it.status)));
  }, []);

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((it) => !isFinished(it.status)));
  }, []);

  /** Puts back what was unfinished last time. Things that were running come back paused, so nothing starts by surprise. */
  const restore = useCallback((saved: SavedDownload[]) => {
    const restored: DownloadItem[] = sanitizeDownloadQueue(saved).map((s) => ({
      id: s.id,
      recoveryId: s.recoveryId ?? s.id, estimatedBytes: s.estimatedBytes, expectedVolume: s.expectedVolume,
      title: s.title,
      url: s.url,
      thumbnail: s.thumbnail,
      preset: s.preset,
      outDir: s.outDir,
      extra: s.extra,
      status: s.status === "error" || s.status === "cancelled" ? (s.status as DownloadStatus) : "paused",
      progress: s.progress,
      speed: null,
      eta: null,
      path: null,
      log: [],
      clipKey: s.clipKey,
      placeholderTitle: s.placeholderTitle,
      channel: s.channel,
    }));
    for (const r of restored) started.current.add(r.id);
    // Idempotent: restoring the same saved queue twice must not duplicate anything.
    setItems((prev) => {
      const have = new Set(prev.map((i) => i.id));
      return [...prev, ...restored.filter((r) => !have.has(r.id))];
    });
  }, []);

  const unfinished = items.filter((i) => i.status === "queued" || isActive(i.status)).length;

  return { items, enqueue, runNext, runLater, reorder, setRateLimit, editWaiting, cancel, pause, resume, pauseAll, resumeAll, retry, remove, clearFinished, restore, hasActive: unfinished > 0 };
}
