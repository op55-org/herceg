// A dashboard of subplots against one panel drawing the same marks: the
// time a layout of nested columns with an inset adds to rendering,
// resizing, and the pointer. Pointer moves are trusted input the runner
// sends (run.ts); the page times each from its arrival.
import { type Chart, type ChartMark, createChart, line, panels, table } from "herceg";
import { columns, inset, panel, rows } from "herceg/layout";
import { type Point, readoutText } from "../page/adapter.ts";
import { writesFor } from "../page/expect.ts";
import { nextArrival } from "../page/input.ts";
import { Incorrect, watchFrames } from "../page/verify.ts";

export type Shape = "single" | "dashboard";

export interface Sample {
  /** createChart through its first frame, drawn synchronously. */
  mounts: number[];
  /** A new size, drawn synchronously. */
  resizes: number[];
  /**
   * A pointer move's work: its event (from its arrival in the page to a
   * listener after the chart's), then the chart's part of the next frame,
   * which draws the crosshair and tooltip (to when a callback asked for
   * after the chart's runs, from the frame's timestamp or, when the move was
   * dispatched in that frame, from the end of its handling).
   */
  pointers: number[];
  /**
   * Further moves to the first targets, each from its arrival to the end of
   * the first frame whose pre-paint check saw the tooltip write series s0's
   * value at a minute under the pointer, of the panel's table.
   */
  shown: number[];
}

/** What a page measured itself, and where the runner moves the pointer next. */
export type Mounted = Omit<Sample, "pointers" | "shown"> & { targets: Point[] };

const POINTS = 2_000;
const SERIES = 3;
const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

/** A table of three series of `POINTS` points, offset by `seed`. */
function metrics(seed: number) {
  const n = POINTS * SERIES;
  return table({
    t: Float64Array.from({ length: n }, (_, i) => i % POINTS),
    v: Float64Array.from(
      { length: n },
      (_, i) => Math.sin((i % POINTS) / 40 + seed + Math.floor(i / POINTS)) * 10 + seed,
    ),
    service: Array.from({ length: n }, (_, i) => `s${Math.floor(i / POINTS)}`),
  });
}

const tables = [0, 1, 2, 3, 4].map(metrics);

/** The marks of the five plots: in panels, or all in the one panel. */
function marksOf(shape: Shape): ChartMark[] {
  const ids = ["latency", "errors", "traffic", "saturation", "detail"];
  return tables.map((data, i) =>
    line(data, {
      x: "t",
      y: "v",
      color: "service",
      ...(shape === "dashboard" && { panel: ids[i]! }),
    }),
  );
}

function optionsOf(shape: Shape) {
  return {
    marks: marksOf(shape),
    locale: "en-US",
    renderer: "canvas" as const,
    ...(shape === "dashboard" && {
      panels: panels(
        columns(
          [2, 1],
          [
            rows(
              [2, 1],
              [
                panel({ id: "latency", title: "Latency" }, [
                  inset({ id: "detail", x: { domain: [400, 600] } }, { indicator: true }),
                ]),
                panel({ id: "errors", title: "Errors" }),
              ],
            ),
            rows(
              [1, 1],
              [
                panel({ id: "traffic", title: "Traffic" }),
                panel({ id: "saturation", title: "Saturation" }),
              ],
            ),
          ],
        ),
      ),
    }),
  };
}

const MOVES = 120;
const IDS = ["latency", "errors", "traffic", "saturation", "detail"];
/** Series s0's value of table `k` at minute `t`, as `metrics` makes it. */
const valueAt = (k: number, t: number) => Math.sin(t / 40 + k) * 10 + k;

let chart: Chart | undefined;
let move: Promise<number> | undefined;
let panelOf: number[] = [];
let shownMove: Promise<number | { error: string }> | undefined;

/** Mounts and resizes as before (all synchronous), and returns where the pointer moves go. */
async function mount(shape: Shape): Promise<Mounted> {
  const host = document.querySelector<HTMLElement>("#chart")!;
  const out: Mounted = { mounts: [], resizes: [], targets: [] };
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    const created = createChart(host, optionsOf(shape));
    created.render();
    out.mounts.push(performance.now() - start);
    await created.loading;
    if (i < 19) created.destroy();
    else chart = created;
  }
  for (let i = 0; i < 40; i++) {
    host.style.width = `${i % 2 ? 1000 : 900}px`;
    const start = performance.now();
    chart!.render();
    out.resizes.push(performance.now() - start);
    await frame();
  }
  host.style.width = "1000px";
  chart!.render();
  const rect = chart!.root.getBoundingClientRect();
  const plots = chart!.getPanels().map(({ plot }) => plot);
  panelOf = [];
  for (let i = 0; i < MOVES; i++) {
    const plot = plots[i % plots.length]!;
    panelOf.push(i % plots.length);
    out.targets.push({
      x: rect.left + plot.x + ((i * 37) % plot.width),
      y: rect.top + plot.y + plot.height / 2,
    });
  }
  return out;
}

/** Waits for a frame, then for the move the runner sends next; `pointer()` resolves with its work. */
async function arm(): Promise<void> {
  await frame();
  // After the chart's listeners: the window's, in the bubbling phase.
  const handled = new Promise<number>((resolve) =>
    addEventListener("pointermove", () => resolve(performance.now()), { once: true }),
  );
  move = (async () => {
    const arrival = await nextArrival((a) => a.type === "pointermove");
    const end = await handled;
    // Chrome dispatches a trusted move at the start of a frame, after its
    // timestamp and before its animation frame callbacks: the chart's part
    // of that frame starts where the event's handling ended.
    const drawn = await new Promise<number>((resolve) =>
      requestAnimationFrame((at) => resolve(performance.now() - Math.max(at, end))),
    );
    return end - arrival.at + drawn;
  })();
}

async function pointer(): Promise<number> {
  return move!;
}

const tooltipOf = (root: Element) =>
  [...root.children].find(
    (el): el is HTMLElement => el instanceof HTMLDivElement && el.style.pointerEvents === "none",
  );

/**
 * Waits for a frame, then times the move the runner sends next to target
 * `i` to its verified frame (see `Sample.shown`); `shown()` resolves with it.
 */
async function armShown(i: number, target: Point): Promise<void> {
  await frame();
  const panel = chart!.getPanels()[panelOf[i]!]!;
  const rect = chart!.root.getBoundingClientRect();
  const [x0, x1] = panel.x!.domain;
  const perPixel = (x1 - x0) / panel.plot.width;
  const at = x0 + (target.x - rect.left - panel.plot.x) * perPixel;
  // The panel's table where its id names it; the one panel shows every table.
  const k = IDS.indexOf(panel.key);
  const tables = k >= 0 ? [k] : [0, 1, 2, 3, 4];
  const values: number[] = [];
  for (let t = Math.ceil(at - 1.5 * perPixel); t <= at + 1.5 * perPixel; t++)
    if (t >= 0 && t < POINTS) for (const table of tables) values.push(valueAt(table, t));
  const check = () => {
    const tooltip = tooltipOf(chart!.root);
    if (!tooltip || tooltip.style.display === "none") return "no tooltip shown";
    const text = readoutText(tooltip);
    return values.some((value) => writesFor({ text }, "s0", value))
      ? undefined
      : `the tooltip "${text}" writes no value of series s0 under the pointer`;
  };
  shownMove = nextArrival(
    (a) =>
      a.type === "pointermove" && Math.abs(a.x - target.x) <= 1 && Math.abs(a.y - target.y) <= 1,
  )
    .then(async (arrival) => (await watchFrames(arrival.at, check, () => true, 2000).shown).time)
    .catch((error) => {
      if (error instanceof Incorrect) return { error: `incorrect: ${error.message}` };
      throw error;
    });
}

async function shown(): Promise<number | { error: string }> {
  return shownMove!;
}

function unmount(): void {
  chart?.destroy();
  chart = undefined;
}

const api = { mount, arm, pointer, armShown, shown, unmount };
declare global {
  interface Window {
    layouts: typeof api;
  }
}
window.layouts = api;
