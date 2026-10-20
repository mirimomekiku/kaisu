import type { ReactNode } from "react";

interface Props {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}

/** The gradient bar along the bottom: item counts in the middle, small actions at the sides. */
export default function StatusBar({ left, center, right }: Props) {
  return (
    <footer className="statusbar">
      <div className="side">{left}</div>
      <div className="mid" aria-live="polite">
        {center}
      </div>
      <div className="side end">{right}</div>
    </footer>
  );
}
