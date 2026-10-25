export interface StorageIssue { key: string; message: string; retry: () => Promise<void> }
let issues: StorageIssue[] = [];
const listeners = new Set<() => void>();
export const storageIssues = () => issues;
export const subscribeStorage = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function storageProblem(key: string, message: string, retry: () => Promise<void>) {
  issues = [...issues.filter((i) => i.key !== key), { key, message, retry }];
  listeners.forEach((fn) => fn());
}
export function storageRecovered(key: string) {
  if (!issues.some((i) => i.key === key)) return;
  issues = issues.filter((i) => i.key !== key); listeners.forEach((fn) => fn());
}
