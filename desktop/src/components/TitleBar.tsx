import WindowControls from "./WindowControls";

/** A slim title bar for screens that have no toolbar (first-run setup, loading). Dragging it moves the window. */
export default function TitleBar({ title = "Kaisu" }: { title?: string }) {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <WindowControls />
      <span className="title" data-tauri-drag-region>
        {title}
      </span>
    </div>
  );
}
