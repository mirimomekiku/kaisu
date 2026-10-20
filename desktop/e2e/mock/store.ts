const data: Record<string, unknown> = JSON.parse(localStorage.getItem("__store") ?? "{}");
export type Store = unknown;
export async function load() {
  return {
    get: async (k: string) => data[k],
    set: async (k: string, v: unknown) => { data[k] = v; localStorage.setItem("__store", JSON.stringify(data)); },
  };
}
