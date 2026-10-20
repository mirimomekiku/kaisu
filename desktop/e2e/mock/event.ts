// Stand-in for @tauri-apps/api/event: tests fire events through window.__events[name]({ payload }).
const w = window as any;
export async function listen(name: string, cb: (e: { payload: unknown }) => void) {
  (w.__events ??= {})[name] = cb;
  return () => { if (w.__events[name] === cb) delete w.__events[name]; };
}
