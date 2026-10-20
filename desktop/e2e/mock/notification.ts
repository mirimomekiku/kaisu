const w = window as any;
export async function isPermissionGranted() { return true; }
export async function requestPermission() { return "granted"; }
export function sendNotification(n: { title: string; body?: string }) { (w.__mock.notifications ??= []).push(n); }
