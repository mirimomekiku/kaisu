const data: Record<string, unknown> = JSON.parse(localStorage.getItem("__store") ?? "{}");
export type Store = unknown;
export async function load() {
  return {
    get: async (k: string) => {
      const delay = (window as any).__mock?.storeDelays?.[k];
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return data[k];
    },
    set: async (k: string, v: unknown) => { data[k] = v; localStorage.setItem("__store", JSON.stringify(data)); },
    save: async () => { localStorage.setItem("__store", JSON.stringify(data)); },
  };
}
