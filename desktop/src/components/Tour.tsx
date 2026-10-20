import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface Step {
  title: string;
  text: string;
  /** Finds the part of the screen to highlight. No target means a centred welcome card. */
  target?: () => HTMLElement | null;
  placement?: "below" | "right";
}

const sourceItem = (index: number) => () => document.querySelectorAll<HTMLElement>("nav[aria-label='Sections'] .source")[index] ?? null;

export const TOUR_STEPS: Step[] = [
  {
    title: "Welcome to Kaisu",
    text: "Download videos and music from YouTube and many other sites. This 30-second tour shows you where everything is.",
  },
  {
    title: "Search or paste a link",
    text: "Type to search, pick where to search with the source menu, paste a link, or drag one onto the window. Playlists and channels work too.",
    target: () => document.querySelector<HTMLElement>(".toolbar .searchfield"),
    placement: "below",
  },
  {
    title: "The status display",
    text: "Searches, look-ups and downloads show up here, with speed and time left.",
    target: () => document.querySelector<HTMLElement>(".toolbar .lcd"),
    placement: "below",
  },
  {
    title: "Downloads",
    text: "Everything in progress lives here. Pause, resume or cancel, and choose what happens when they finish.",
    target: sourceItem(1),
    placement: "right",
  },
  {
    title: "History",
    text: "Everything you download is kept here. Open it again, sort and filter it, or export the list.",
    target: sourceItem(2),
    placement: "right",
  },
  {
    title: "Settings",
    text: "Switch between Simple and Advanced, choose where files go, set a proxy or a speed schedule, and more. You can replay this tour from there any time.",
    target: sourceItem(3),
    placement: "right",
  },
];

interface Props {
  /** Called when the tour ends, whether finished or skipped. */
  onFinish: () => void;
}

const MARGIN = 12;
const PAD = 5;

/** A short guided tour: a spotlight on the real controls with a card explaining each. Keyboard friendly. */
export default function Tour({ onFinish }: Props) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardPos, setCardPos] = useState<{ left: number; top: number }>({ left: MARGIN, top: MARGIN });
  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  const next = useCallback(() => (last ? onFinish() : setIndex((i) => i + 1)), [last, onFinish]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Find the highlighted element and keep it measured as the window changes.
  useLayoutEffect(() => {
    const measure = () => setBox(step.target?.()?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [step]);

  // Place the card next to the highlight, or in the middle when there isn't one, and keep it on screen.
  useLayoutEffect(() => {
    const card = cardRef.current?.getBoundingClientRect();
    if (!card) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    if (!box) {
      left = (vw - card.width) / 2;
      top = (vh - card.height) / 2.4;
    } else if (step.placement === "right") {
      left = box.right + PAD + 16;
      top = box.top + box.height / 2 - 24;
    } else {
      left = box.left + box.width / 2 - card.width / 2;
      top = box.bottom + PAD + 14;
    }
    setCardPos({
      left: Math.max(MARGIN, Math.min(left, vw - card.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(top, vh - card.height - MARGIN)),
    });
  }, [box, step, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFinish();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") back();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [next, back, onFinish]);

  return (
    <>
      <div className="tour-block" aria-hidden="true" />
      {box ? (
        <div className="tour-spot" aria-hidden="true" style={{ left: box.left - PAD, top: box.top - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 }} />
      ) : (
        <div className="tour-dim" aria-hidden="true" />
      )}
      <div ref={cardRef} className="tour-card" role="dialog" aria-modal="true" aria-label="Quick tour" style={cardPos}>
        <div className="dim" style={{ fontSize: 10.5, marginBottom: 3 }}>
          Step {index + 1} of {TOUR_STEPS.length}
        </div>
        <h2 className="m-0 text-[15px] font-bold">{step.title}</h2>
        <p className="mt-1.5 mb-3" style={{ color: "#3a3a3a" }}>
          {step.text}
        </p>
        <div className="flex items-center justify-between gap-3">
          <div className="tour-dots" aria-hidden="true">
            {TOUR_STEPS.map((_, i) => (
              <i key={i} className={i === index ? "on" : ""} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!last && (
              <button type="button" className="btn small plain" onClick={onFinish}>
                Skip tour
              </button>
            )}
            {index > 0 && (
              <button type="button" className="btn small" onClick={back}>
                Back
              </button>
            )}
            <button type="button" className="btn small primary" onClick={next} autoFocus>
              {last ? "Done" : index === 0 ? "Start tour" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
