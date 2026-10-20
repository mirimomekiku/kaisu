// Stand-in for @tauri-apps/api/window: records what the title bar asks the OS to do.
const w = window as any;
const rec = (name: string) => { (w.__mock ??= { calls: [] }).windowCalls ??= []; w.__mock.windowCalls.push(name); };
export function getCurrentWindow() {
  return {
    close: async () => rec("close"),
    minimize: async () => rec("minimize"),
    toggleMaximize: async () => { rec("toggleMaximize"); w.__mock.maximized = !w.__mock.maximized; w.__resized?.(); },
    isMaximized: async () => !!w.__mock?.maximized,
    onFocusChanged: async (cb: (e: { payload: boolean }) => void) => { w.__focus = cb; return () => {}; },
    onResized: async (cb: () => void) => { w.__resized = cb; return () => {}; },
  };
}
