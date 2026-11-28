// Input as the page receives it. The runner dispatches every pointer,
// wheel, and key event through the browser driver (runner/input.ts), never
// as synthetic DOM events; this module, which the page entry imports before
// any library code, listens on the window in the capture phase so it hears
// each event first, and records when it arrived. Timings start at that
// arrival.

/** An event the page received: where, when, and whether the browser made it (`isTrusted`). */
export interface Arrival {
  type: string;
  isTrusted: boolean;
  /** Client coordinates (pointer and wheel events). */
  x: number;
  y: number;
  /** Pressed buttons (pointer events). */
  buttons: number;
  /** The key (keyboard events). */
  key: string;
  /** `performance.now()` in the first listener: the arrival timings start at. */
  at: number;
  /** The event's own time stamp, which may lead `at` by the time the event waited to be dispatched. */
  timeStamp: number;
}

const TYPES = ["pointermove", "pointerdown", "pointerup", "wheel", "keydown", "keyup"] as const;

let log: Arrival[] | undefined;
/** Events received by type, which the driver reads to know an input has arrived (runner/input.ts). */
const counts = new Map<string, number>();
const waiting = new Set<{ match: (arrival: Arrival) => boolean; resolve: (a: Arrival) => void }>();

function heard(event: Event): void {
  const pointer = event as PointerEvent;
  const arrival: Arrival = {
    type: event.type,
    isTrusted: event.isTrusted,
    x: pointer.clientX ?? 0,
    y: pointer.clientY ?? 0,
    buttons: pointer.buttons ?? 0,
    key: (event as KeyboardEvent).key ?? "",
    at: performance.now(),
    timeStamp: event.timeStamp,
  };
  counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  log?.push(arrival);
  for (const waiter of waiting)
    if (waiter.match(arrival)) {
      waiting.delete(waiter);
      waiter.resolve(arrival);
    }
}

for (const type of TYPES) addEventListener(type, heard, { capture: true, passive: true });
(window as unknown as { benchInput: { count(type: string): number } }).benchInput = {
  count: (type) => counts.get(type) ?? 0,
};

/**
 * The next trusted event `match` accepts. Untrusted events never match: a
 * benchmark's input must come from the driver.
 */
export function nextArrival(match: (arrival: Arrival) => boolean): Promise<Arrival> {
  return new Promise((resolve) =>
    waiting.add({ match: (arrival) => arrival.isTrusted && match(arrival), resolve }),
  );
}

/** Starts recording every event of the types above; returns the record, which fills as events arrive. */
export function recordArrivals(): Arrival[] {
  log = [];
  return log;
}

export function stopRecording(): void {
  log = undefined;
}
