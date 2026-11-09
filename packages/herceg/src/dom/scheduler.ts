// One animation-frame loop for every chart on the page. Updates requested
// during a frame (data appends, resizes, pointer moves) are coalesced into a
// single render per chart on the next frame, and charts outside the viewport
// wait until they scroll into view. Each frame reads input first, every
// chart's before any listener hears it, then reports it, then draws: what
// listeners of the input change draws in the input's frame.

export interface Scheduled {
  /**
   * Reads input against the frame on screen, before any chart draws or
   * reports it: what reports it, called once every chart due has read.
   * Charts its listeners change draw in the same frame.
   */
  read?(): (() => void) | undefined;
  /** Renders pending changes. Called at most once per frame. */
  flush(): void;
  /** False while the chart is outside the viewport. */
  readonly visible: boolean;
  /**
   * True until the chart has drawn: its first frame's one-time work
   * (measuring, compiling) is left out of the frame's time.
   */
  readonly cold?: boolean;
}

const pending = new Set<Scheduled>();
let frame = 0;
let frames = 0;
let lastFrame = 0;

function run() {
  frames++;
  // Input: every chart reads before any listener hears of it, and charts
  // listeners change join the frame (see `Scheduled.read`): until the
  // frame draws, `schedule` asks for no other.
  let took = performance.now();
  const reports = [...pending].map((item) => item.visible && attempt(() => item.read?.()));
  for (const tell of reports) if (tell) attempt(tell);
  frame = 0;
  took = performance.now() - took;
  const due = [...pending];
  pending.clear();
  for (const item of due) {
    // Invisible charts stay dirty and render when they become visible.
    if (!item.visible) continue;
    const { cold } = item;
    const started = performance.now();
    attempt(() => item.flush());
    if (!cold) took += performance.now() - started;
  }
  lastFrame = took;
}

/** What `work` returns, or undefined if it throws: one failing chart must not stop the others. */
function attempt<T>(work: () => T): T | undefined {
  try {
    return work();
  } catch (error) {
    report(error);
  }
}

/** How many frames have run: work asked for between two frames shares the count. */
export function frameCount(): number {
  return frames;
}

/** How long every chart's input and rendering took in the last frame, in milliseconds, first frames left out. */
export function lastFrameTime(): number {
  return lastFrame;
}

/** Reports an error without stopping the code that ran into it. */
export function report(error: unknown): void {
  if (typeof reportError === "function") reportError(error);
  else console.error(error);
}

export function schedule(item: Scheduled): void {
  pending.add(item);
  if (frame === 0) frame = requestAnimationFrame(run);
}

export function unschedule(item: Scheduled): void {
  pending.delete(item);
}

type VisibilityListener = (visible: boolean) => void;
let observer: IntersectionObserver | undefined;
const listeners = new Map<Element, VisibilityListener>();

/**
 * The observer's callback, made outside `observeVisibility`: made in it, it
 * would keep the first element and listener observed alive with the page.
 */
function intersected(entries: IntersectionObserverEntry[]) {
  for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
}

/** Reports when `element` enters or leaves the viewport. Returns a stop function. */
export function observeVisibility(element: Element, listener: VisibilityListener): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {};
  observer ??= new IntersectionObserver(intersected);
  listeners.set(element, listener);
  observer.observe(element);
  return () => {
    listeners.delete(element);
    observer?.unobserve(element);
  };
}
