export async function open(opts: any = {}) {
  if (opts?.filters?.length) return (globalThis as any).__mock?.pickedFile ?? "/home/u/cover.jpg";
  return "/home/u/Videos";
}

export async function save() { return "/home/u/export.csv"; }
