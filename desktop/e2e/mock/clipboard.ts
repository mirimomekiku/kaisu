const w = window as any;
export async function readText() { return w.__mock?.clipboard ?? ""; }
