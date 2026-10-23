import { safeConcurrency } from "./downloadValidation";
import { checkSpeedLimit } from "./validate";
export function rateBytes(value?: string | null): number | null {
  if (!value || !/^\d+(\.\d+)?[kKmM]?$/.test(value)) return null;
  const n = parseFloat(value) * (/k$/i.test(value) ? 1024 : /m$/i.test(value) ? 1048576 : 1);
  return Number.isFinite(n) && n >= 1 && n <= 1e12 ? Math.floor(n) : null;
}
/** Reserve equal shares per queue slot; idle slots leave headroom rather than exceeding the total. */
export function networkAllocation(concurrency: number, fragmentBudget = 8, globalRate = "") {
  const budget = Number.isFinite(fragmentBudget) ? Math.max(1, Math.min(24, Math.floor(fragmentBudget))) : 8;
  const total = rateBytes(globalRate);
  const slots = Math.min(safeConcurrency(concurrency), budget, total ?? 6);
  const share = total == null ? null : Math.floor(total / slots);
  return { error: checkSpeedLimit(globalRate), slots, fragments: Math.max(1, Math.min(4, Math.floor(budget / slots))), rate: (own?: string | null) => {
    const local = rateBytes(own);
    return share == null ? own ?? null : String(local == null ? share : Math.min(share, local));
  } };
}
