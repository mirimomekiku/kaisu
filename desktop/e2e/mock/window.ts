// Stand-in for @tauri-apps/api/window: records what the title bar asks the OS to do.
const w = window as any;
const rec = (name: string) => { (w.__mock ??= { calls: [] }).windowCalls ??= []; w.__mock.windowCalls.push(name); };
export function getCurrentWindow() {
  return {
    close: async () => rec("close"),
    minimize: async () => rec("minimize"),
    toggleMaximize: async () => { rec("toggleMaximize"); w.__mock.maximized = !w.__mock.maximized; w.__resized?.(); },
    isMaximized: async () => !!w.__mock?.maximized,
    isFullscreen: async () => !!w.__mock?.fullscreen,
    setFullscreen: async (value: boolean) => { if (w.__mock.fullscreenFail) throw new Error("Fullscreen unavailable"); rec(`setFullscreen:${value}`); w.__mock.fullscreen = value; w.__resized?.(); },
    onFocusChanged: async (cb: (e: { payload: boolean }) => void) => { w.__focus = cb; return () => {}; },
    onResized: async (cb: () => void) => { const listeners = (w.__resizeListeners ??= new Set()); listeners.add(cb); w.__resized = () => { for (const listener of listeners) listener(); }; return () => listeners.delete(cb); },
  };
}
