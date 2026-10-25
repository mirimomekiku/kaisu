import { Component, type ErrorInfo, type ReactNode } from "react";
import { resetSavedSettings } from "../lib/storage";

export default class AppRecovery extends Component<{ children: ReactNode }, { failed: boolean; problem: string }> {
  state = { failed: false, problem: "" };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Application rendering failed", error, info.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="page p-6" role="alert"><h1>Kaisu couldn’t open this view</h1>
      <p>Reload the app, or reset its settings. Your playlists, listening records, history and downloaded files are kept.</p>
      <div className="flex gap-2"><button className="btn" onClick={() => location.reload()}>Reload Kaisu</button>
        <button className="btn" onClick={async () => { try { await resetSavedSettings(); location.reload(); } catch { this.setState({ problem: "Settings could not be saved. Check that the app data folder is writable, then try again." }); } }}>Reset settings and reload</button></div>
      {this.state.problem && <p>{this.state.problem}</p>}
    </main>;
  }
}
