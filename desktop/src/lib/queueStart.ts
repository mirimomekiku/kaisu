import { hostOf } from "./links";

export interface Startable { id: string; url: string; status: string; retryAt?: number }
const isActive = (status: string) => status === "downloading" || status === "processing";

/**
 * Which queued items may start now. `items` is newest-first, so the oldest queued item is last. Items waiting to
 * retry sit out until due, a website in cooldown is skipped, and one website can be limited to a few at a time.
 */
export function pickStartable<T extends Startable>(items: T[], opts: { free: number; now: number; cooldowns: ReadonlyMap<string, number>; perSite: number; started: ReadonlySet<string> }): T[] {
  const perHost = new Map<string, number>();
  for (const it of items) if (isActive(it.status)) perHost.set(hostOf(it.url), (perHost.get(hostOf(it.url)) ?? 0) + 1);
  const picked: T[] = [];
  for (const it of items.slice().reverse()) {
    if (picked.length >= opts.free) break;
    if (it.status !== "queued" || opts.started.has(it.id) || (it.retryAt ?? 0) > opts.now) continue;
    const host = hostOf(it.url);
    if ((opts.cooldowns.get(host) ?? 0) > opts.now) continue;
    if (opts.perSite > 0 && (perHost.get(host) ?? 0) >= opts.perSite) continue;
    perHost.set(host, (perHost.get(host) ?? 0) + 1);
    picked.push(it);
  }
  return picked;
}

/**
 * Speed and connection budgets are divided between queue slots, so after they change, running transfers are
 * restarted with their new share. Nothing new starts until those have stopped: `draining` until `running` is 0.
 */
export interface ResourceGate { key: string; draining: boolean }
export function resourceGate(prev: ResourceGate, key: string, running: number): { gate: ResourceGate; canStart: boolean } {
  const draining = prev.key !== key ? running > 0 : prev.draining && running > 0;
  return { gate: { key, draining }, canStart: !draining };
}
