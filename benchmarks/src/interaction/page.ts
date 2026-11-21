// The page of the pointer-interaction benchmark (run.ts): mounts one of its
// fixtures and times each pointer move from its first event to the frame
// after the move's effect was drawn. A move's effect counts only from
// reports made after its input arrived, and as drawn once a `render` of the
// revision its change made has come (the interaction guide's "Causes and
// revisions"). After the measured moves, untimed, a few check moves go
// where no measured move went, and `verify` checks what each drew as the
// page shows it: the live DOM, the text painted on the chart's canvas, or
// the pixels of a screenshot, against what the fixture's data says.

import {
  type Anchor,
  anchor,
  type Chart,
  createChart,
  custom,
  histogram,
  line,
  rowSelection,
  rule,
  selectionStore,
  table,
  text,
  time,
} from "herceg";
import {
  type BarPart,
  barWrong,
  type ColumnLabel,
  misplacedLabel,
  over,
  type RGB,
  shadeWrong,
} from "./checks.ts";

/** A pointer position in the page's CSS pixels. */
export interface Point {
  x: number;
  y: number;
}

/** What run.ts drives: where to press (drags), where each timed move goes, and the check moves after them. */
export interface Fixture {
  press?: Point;
  moves: Point[];
  /** Untimed moves after `moves`, each to a place no move before it went; `verify` checks each one's result. */
  checks: Point[];
  /** Whether `verify` reads a screenshot of the page (in CSS pixels). */
  screenshot?: boolean;
}

export type FixtureName =
  | "hover-listener"
  | "hover-headings"
  | "custom-hover"
  | "pan-labels"
  | "pan-view-labels"
  | "anchor-pan"
  | "cross-filter"
  | "crosshair-dashboard";

declare global {
  interface Window {
    interaction: {
      mount(name: FixtureName, moves: number): Promise<Fixture>;
      /**
       * Times move `index`, of the fixture's moves and then its checks:
       * `result` resolves with ms to the frame after its effect, or null after 1 s.
       */
      arm(index: number): void;
      result(): Promise<number | null>;
      /** What is wrong with what check move `index` (counted as `arm` counts) drew, if anything. */
      verify(index: number, screenshot?: string): Promise<string | undefined>;
      unmount(): void;
    };
  }
}

const MINUTE = 60_000;
const START = Date.UTC(2026, 0, 1);
const MARKED = "#ff00ff";

/** A seeded generator, so every build draws the same data. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `series` random walks of `points` minutes. */
function walks(series: number, points: number, seed: number) {
  const next = random(seed);
  const columns: Record<string, Float64Array | ReturnType<typeof time>> = {
    t: time(Float64Array.from({ length: points }, (_, i) => START + i * MINUTE)),
  };
  const names = Array.from({ length: series }, (_, s) => `s${s}`);
  for (const name of names) {
    const values = new Float64Array(points);
    let value = 50 + next() * 50;
    for (let i = 0; i < points; i++) values[i] = value += next() - 0.5;
    columns[name] = values;
  }
  return { data: table(columns), names };
}

function host(width: number, height: number): HTMLElement {
  const element = document.createElement("div");
  element.style.cssText = `width:${width}px;height:${height}px;display:inline-block;vertical-align:top`;
  document.getElementById("stage")!.append(element);
  return element;
}

/** Page pixels of a fraction of the first panel's plot. */
function inPlot(chart: Chart, fx: number, fy: number): Point {
  const box = chart.root.getBoundingClientRect();
  const { plot } = chart.getPanels()[0]!;
  return { x: box.left + plot.x + fx * plot.width, y: box.top + plot.y + fy * plot.height };
}

/** Back and forth across a span of the plot, so each move lands somewhere new. */
function sweep(chart: Chart, count: number, from: number, to: number, fy: number): Point[] {
  const steps = 12;
  return Array.from({ length: count }, (_, i) => {
    const k = i % (2 * steps);
    const f = k < steps ? k / steps : (2 * steps - k) / steps;
    return inPlot(chart, from + (to - from) * f, fy);
  });
}

/** Whether a pointer in a chart's pixels is at a move's page position. */
const at = (chart: Chart, pointer: { x: number } | undefined, move: Point | undefined) =>
  pointer !== undefined &&
  move !== undefined &&
  Math.abs(chart.root.getBoundingClientRect().left + pointer.x - move.x) < 1;

const until = (chart: Chart) =>
  new Promise<void>((resolve) => {
    const stop = chart.on("render", () => {
      stop();
      resolve();
    });
    chart.render();
  });

/** The armed move: its index, and what ends it once its effect is drawn. */
let armed: { index: number; started: boolean; done: () => void; cancel: () => void } | undefined;
let charts: Chart[] = [];
let stops: (() => void)[] = [];
/** The fixture's per-move state, cleared as each move (its index) is armed. */
let reset: (index: number) => void = () => {};
let verify: (index: number, screenshot?: string) => Promise<string | undefined> = async () =>
  "the fixture checks nothing";
let timing: Promise<number | null> = Promise.resolve(null);

/** Whether a report belongs to the armed move: made after its input arrived. */
const moving = () => armed?.started === true;

/** Ends the armed move: its effect has been drawn. */
function drawn() {
  if (moving()) armed!.done();
}

/**
 * Runs `then` once the next animation frame has been produced: a message
 * posted from its requestAnimationFrame runs after its style, layout, and
 * paint, as the suite's harness times frames.
 */
function afterFrame(then: () => void) {
  requestAnimationFrame(() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      then();
    };
    channel.port2.postMessage(null);
  });
}

/** A screenshot's color at a page position. */
type Pixels = (x: number, y: number) => RGB;

/** A #rrggbb color's channels; undefined for other colors. */
function rgb(color: string): RGB | undefined {
  if (!/^#[\da-f]{6}$/i.test(color)) return undefined;
  const channel = (i: number) => Number.parseInt(color.slice(i, i + 2), 16);
  return [channel(1), channel(3), channel(5)];
}

/** The pixels of a PNG screenshot taken in CSS pixels. */
async function pixels(base64: string): Promise<Pixels> {
  const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
  const image = await createImageBitmap(blob);
  const context = new OffscreenCanvas(image.width, image.height).getContext("2d")!;
  context.drawImage(image, 0, 0);
  const { data, width } = context.getImageData(0, 0, image.width, image.height);
  return (x, y) => {
    const i = (Math.round(y) * width + Math.round(x)) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  };
}

/**
 * Whether a pixel is `MARKED`'s, at least half of it over the plot's
 * white: no series color is (the palette's pink is about 196, 72, 155).
 */
const isMarked = ([r, g, b]: readonly [number, number, number]) => r >= 235 && b >= 235 && g <= 150;

/**
 * What is wrong with the `MARKED` vertical line a chart draws across its
 * plot at page x `x`, if anything: it shows within 3 px of `x` in at
 * least a third of the plot's rows (lines, points, and the tooltip cover
 * the rest), and nowhere else in them.
 */
function markedLine(pixel: Pixels, chart: Chart, x: number): string | undefined {
  const box = chart.root.getBoundingClientRect();
  const { plot } = chart.getPanels()[0]!;
  const [left, right] = [box.left + plot.x, box.left + plot.x + plot.width];
  let rows = 0;
  let shown = 0;
  for (let y = box.top + plot.y + 2; y < box.top + plot.y + plot.height - 2; y += 4) {
    rows++;
    let near = false;
    for (let column = Math.ceil(left); column < right; column++) {
      if (!isMarked(pixel(column, y))) continue;
      if (Math.abs(column - x) > 3)
        return `is drawn at ${(column - box.left).toFixed(0)} px, not only at ${(x - box.left).toFixed(1)}`;
      near = true;
    }
    if (near) shown++;
  }
  if (shown < rows / 3)
    return `is not drawn at ${(x - box.left).toFixed(1)} px (${shown} of ${rows} rows)`;
}

/**
 * A text a canvas painted: its text and fill, its font's size, the width
 * of the halo stroked under it (0 without one), and its box and middle
 * (half its x-height above the baseline) in page pixels.
 */
interface PaintedText {
  text: string;
  fill: string;
  size: number;
  halo: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  middle: number;
}

/**
 * Records the text the canvases in `root` paint from now until `stop`: a
 * list from each time one is cleared, so the last list is what the canvas
 * shows. Started for check moves only, so timed moves paint as they would
 * without it.
 */
function recordCanvasText(root: Element) {
  const prototype = CanvasRenderingContext2D.prototype;
  const { clearRect, fillText, strokeText } = prototype;
  const paints: PaintedText[][] = [];
  // The last text stroked: a halo, where the same text is then filled there.
  let stroked:
    | { context: CanvasRenderingContext2D; text: string; x: number; y: number; width: number }
    | undefined;
  prototype.clearRect = function (this: CanvasRenderingContext2D, x, y, width, height) {
    if (root.contains(this.canvas)) paints.push([]);
    clearRect.call(this, x, y, width, height);
  };
  prototype.strokeText = function (this: CanvasRenderingContext2D, text, x, y, maxWidth) {
    if (maxWidth === undefined) strokeText.call(this, text, x, y);
    else strokeText.call(this, text, x, y, maxWidth);
    stroked = { context: this, text, x, y, width: this.lineWidth };
  };
  prototype.fillText = function (this: CanvasRenderingContext2D, text, x, y, maxWidth) {
    if (maxWidth === undefined) fillText.call(this, text, x, y);
    else fillText.call(this, text, x, y, maxWidth);
    if (!root.contains(this.canvas)) return;
    const m = this.getTransform();
    const box = this.canvas.getBoundingClientRect();
    const scale = box.width / this.canvas.width;
    const page = (px: number, py: number) => [
      box.left + (m.a * px + m.c * py + m.e) * scale,
      box.top + (m.b * px + m.d * py + m.f) * scale,
    ];
    const metrics = this.measureText(text);
    const [left, top] = page(
      x - metrics.actualBoundingBoxLeft,
      y - metrics.actualBoundingBoxAscent,
    );
    const [right, bottom] = page(
      x + metrics.actualBoundingBoxRight,
      y + metrics.actualBoundingBoxDescent,
    );
    const [, middle] = page(x, y - this.measureText("x").actualBoundingBoxAscent / 2);
    const halo =
      stroked?.context === this && stroked.text === text && stroked.x === x && stroked.y === y
        ? stroked.width
        : 0;
    paints.at(-1)?.push({
      text,
      fill: String(this.fillStyle),
      size: Number(/([\d.]+)px/.exec(this.font)?.[1]),
      halo,
      left: left!,
      right: right!,
      top: top!,
      bottom: bottom!,
      middle: middle!,
    });
  };
  return {
    paints,
    stop: () => {
      Object.assign(prototype, { clearRect, fillText, strokeText });
    },
  };
}

/** How many of a painted text's pixels in a screenshot are near its fill: whether the page shows it there. */
function shownPixels(pixel: Pixels, text: PaintedText): number {
  const fill = rgb(text.fill);
  if (!fill) return 0;
  let near = 0;
  for (let y = Math.floor(text.top); y <= Math.ceil(text.bottom); y++)
    for (let x = Math.floor(text.left); x <= Math.ceil(text.right); x++) {
      const color = pixel(x, y);
      if (Math.hypot(...color.map((c, i) => c - fill[i]!)) < 60) near++;
    }
  return near;
}

/**
 * One chart of 8 series x 2,000 minutes with a rule at the hovered minute,
 * which a `hover` listener writes: the move's effect is the rule drawn
 * there, in the move's frame. With `headed`, the lines' tooltip has heading
 * parts, which every point read writes though the tooltip of eight points
 * shows its place (`hover-headings`).
 */
async function hoverListener(count: number, headed = false): Promise<Fixture> {
  const { data, names } = walks(8, 2_000, 1);
  const marker = table({ t: time(Float64Array.of(START)) });
  const heading = [{ series: true }, " at ", { field: "t", format: { time: "%H:%M" } }] as const;
  const chart = createChart(host(800, 400), {
    marks: [
      line(data, { x: "t", y: names, ...(headed && { tooltip: { heading } }) }),
      rule(marker, { x: "t", stroke: MARKED, strokeWidth: 3 }),
    ],
    timeZone: "UTC",
  });
  charts = [chart];
  await chart.loading;
  await until(chart);
  const moves = sweep(chart, count, 0.1, 0.9, 0.5);
  // Between the sweep's steps, and far apart.
  const checks = [0.27, 0.81, 0.46].map((fx) => inPlot(chart, fx, 0.5));
  const all = [...moves, ...checks];
  let written = Number.NaN;
  let needed = Number.POSITIVE_INFINITY;
  reset = () => {
    needed = Number.POSITIVE_INFINITY;
  };
  stops.push(
    // The application's listener: the rule to the hovered minute.
    chart.on("hover", ({ cause, pointer, inspection }) => {
      if (cause !== "pointer" || inspection?.axis !== "x" || inspection.value === written) return;
      written = inspection.value;
      marker.set("t", 0, written);
      if (moving() && at(chart, pointer, all[armed!.index])) needed = chart.revision;
    }),
    chart.on("render", ({ revision }) => {
      if (revision >= needed) drawn();
    }),
  );
  verify = async (index, screenshot) => {
    // A minute is under a third of a pixel wide: the hovered one is at the pointer.
    const { x } = all[index]!;
    const wrong = markedLine(await pixels(screenshot!), chart, x);
    if (wrong) return `the rule ${wrong}, the pointer's minute`;
    if (!headed) return;
    // Every point read carries its heading where the build writes them; the box keeps the place.
    const box = chart.root.getBoundingClientRect();
    const read = chart.inspect(x - box.left, chart.getPanels()[0]!.plot.y + 10)!;
    const heads = read.points.map((point) => point.heading?.map((run) => run.text).join(""));
    if (heads.some((text) => text !== undefined && !/^s\d at \d\d:\d\d$/.test(text)))
      return `points read carry headings ${heads.join(", ")}`;
    const shown = tooltipBox(chart)?.firstElementChild?.textContent;
    if (shown !== read.label) return `the tooltip is headed "${shown}", not by its place`;
  };
  return { moves, checks, screenshot: true };
}

/** The chart's tooltip box, where it shows. */
const tooltipBox = (chart: Chart) =>
  [...chart.root.children].find(
    (child): child is HTMLDivElement =>
      child instanceof HTMLDivElement &&
      child.style.padding === "8px 10px" &&
      child.style.display === "block",
  );

/**
 * A2's comets: 2,000 custom range items from (x0, y0) to (x1, y1), read
 * by the one nearest the pointer, their tooltip headed by the comet's own
 * id and category and its row written from parts. The move's effect is the
 * tooltip showing the comet under the pointer.
 */
async function customHover(count: number): Promise<Fixture> {
  const n = 2_000;
  const next = random(4);
  const categories = ["rates", "fx", "credit", "equity"];
  const x0 = Float64Array.from({ length: n }, () => next() * 100);
  const y0 = Float64Array.from({ length: n }, () => next() * 100);
  const comets = table({
    id: Array.from({ length: n }, (_, i) => `C-${String(i).padStart(4, "0")}`),
    x0,
    y0,
    x1: x0.map((x) => x + 2 + next() * 6),
    y1: y0.map((y) => y + (next() - 0.5) * 6),
    confidence: Float64Array.from({ length: n }, () => 0.5 + next() / 2),
    category: Array.from({ length: n }, () => categories[Math.floor(next() * 4)]!),
  });
  const chart = createChart(host(800, 400), {
    inspection: { mode: "nearest" },
    marks: [
      custom(comets, {
        x: ["x0", "x1"],
        y: ["y0", "y1"],
        series: "category",
        itemKey: "id",
        tooltip: {
          heading: [{ field: "id", style: { fontWeight: 600 } }, " (", { field: "category" }, ")"],
          content: [{ field: "id" }, " ", { series: true }, ": ", { value: true }],
          fields: ["confidence"],
        },
        draw({ table: t, series, x, y, item, path, circle }) {
          const [ex, ey] = [t.numbers("x1"), t.numbers("y1")];
          for (const s of series)
            for (let k = 0; k < s.length; k++) {
              const row = s.rowAt(k);
              const [ax, ay, bx, by] = [x(s.x[row]!), y(s.y[row]!), x(ex[row]!), y(ey[row]!)];
              item(s, row, () => {
                // A tail tapering to the head's point.
                path(`M${ax},${ay - 3}L${bx},${by}L${ax},${ay + 3}Z`, {
                  fill: s.color,
                  opacity: 0.7,
                });
                circle(ax, ay, 3, { fill: s.color });
              });
            }
        },
      }),
    ],
  });
  charts = [chart];
  await chart.loading;
  await until(chart);
  // Each move at a comet's start, and what the tooltip shows there: the comet read nearest.
  const box = chart.root.getBoundingClientRect();
  const all: Point[] = [];
  const expected: string[] = [];
  const add = (row: number) => {
    const px = chart.toPixel(x0[row]!, { axis: "x" })!;
    const py = chart.toPixel(y0[row]!, { axis: "y" })!;
    const [read] = chart.inspect(px, py)!.points;
    all.push({ x: box.left + px, y: box.top + py });
    expected.push(comets.value("id", read!.row!) as string);
  };
  for (let i = 0; i < count; i++) add((i * 83) % n);
  // Three comets no move read (389 and n share no factor: every row, once).
  const read = new Set(expected);
  for (let row = 41, tried = 0; all.length < count + 3; row = (row + 389) % n) {
    if (++tried > n) throw new Error("custom-hover: the moves read every comet; use fewer");
    add(row);
    const id = expected.at(-1)!;
    if (!read.has(id)) {
      read.add(id);
      continue;
    }
    all.pop();
    expected.pop();
  }
  const observer = new MutationObserver(() => {
    if (!moving() || !tooltipBox(chart)?.textContent?.includes(expected[armed!.index]!)) return;
    drawn();
  });
  observer.observe(chart.root, { subtree: true, childList: true, characterData: true });
  stops.push(() => observer.disconnect());
  verify = async (index) => {
    const shown = tooltipBox(chart);
    const id = expected[index]!;
    if (!shown?.textContent?.includes(id))
      return `the tooltip does not show ${id}, the comet under the pointer`;
    // Where the build writes headings, the comet's own heads its tooltip.
    const move = all[index]!;
    const [read] = chart.inspect(move.x - box.left, move.y - box.top)!.points;
    const heading = read?.heading?.map((run) => run.text).join("");
    if (heading !== undefined && shown.firstElementChild!.textContent !== heading)
      return `the tooltip is headed "${shown.firstElementChild!.textContent}", not "${heading}"`;
  };
  return { moves: all.slice(0, count), checks: all.slice(count) };
}

/**
 * One chart of 8 series x 5,000 minutes zoomed to a fifth, labelled at the
 * first and last observation of each series in view (or, `view`, where
 * each line crosses the view's start and end), panned by dragging: the
 * move's effect is a frame of the moved view.
 */
async function panLabels(count: number, at: "visible" | "view" = "visible"): Promise<Fixture> {
  const { data, names } = walks(8, 5_000, 2);
  const chart = createChart(host(800, 400), {
    marks: [
      line(data, { id: "lines", x: "t", y: names, labels: { at: `${at}-end` } }),
      text({ from: { mark: "lines", at: `${at}-start` }, label: "start" }),
    ],
    interaction: { zoom: "x" },
    timeZone: "UTC",
  });
  charts = [chart];
  await chart.loading;
  chart.setViewport([START + 2_000 * MINUTE, START + 3_000 * MINUTE]);
  await until(chart);
  const press = inPlot(chart, 0.5, 0.5);
  // Right and back by 20 px: every move moves the view.
  const moves = Array.from({ length: count }, (_, i) => ({
    x: press.x + (i % 2 ? 0 : 20),
    y: press.y,
  }));
  // Three views no move showed.
  const checks = [45, -70, 110].map((dx) => ({ x: press.x + dx, y: press.y }));
  let canvasText: ReturnType<typeof recordCanvasText> | undefined;
  let needed = Number.POSITIVE_INFINITY;
  reset = (index) => {
    needed = Number.POSITIVE_INFINITY;
    if (index < moves.length || canvasText) return;
    canvasText = recordCanvasText(chart.root);
    stops.push(canvasText.stop);
  };
  stops.push(
    chart.on("viewport", ({ cause, revision }) => {
      if (moving() && cause === "pointer") needed = revision;
    }),
    chart.on("render", ({ revision }) => {
      if (revision >= needed) drawn();
    }),
  );
  verify = async (_, screenshot) => {
    const painted = canvasText!.paints.at(-1);
    if (!painted) return "the canvas was not painted";
    const box = chart.root.getBoundingClientRect();
    const { plot } = chart.getPanels()[0]!;
    const [left, right] = [box.left + plot.x, box.left + plot.x + plot.width];
    const [top, bottom] = [box.top + plot.y, box.top + plot.y + plot.height];
    // The labels at each end of the view: a column the layout keeps apart.
    const center = (label: PaintedText) => (label.left + label.right) / 2;
    const columns = {
      start: painted.filter((t) => center(t) < left + plot.width / 8),
      end: painted.filter((t) => center(t) > right - plot.width / 8),
    };
    // Each series' color, from its label at the view's end, which names it.
    const series = new Map<string, string>();
    for (const name of names) {
      const named = columns.end.filter((t) => t.text === name);
      if (named.length !== 1)
        return `${named.length} labels name ${name} at the view's end, not one`;
      series.set(named[0]!.fill, name);
    }
    if (series.size !== names.length) return "two series' labels share a color";
    for (const name of names) {
      const own = columns.start.filter((t) => t.text === "start" && series.get(t.fill) === name);
      if (own.length !== 1) return `${own.length} "start" labels in ${name}'s color, not one`;
    }
    // Every label of a column follows a series (in its color) from its
    // point at that end of the view: the first and last minute in view, or
    // where the line crosses the edge, between the minutes around it.
    const [from, to] = chart.getViewport().x!;
    const minutes = { start: (from - START) / MINUTE, end: (to - START) / MINUTE };
    const rows = {
      start: Math.ceil(minutes.start - 1e-6),
      end: Math.floor(minutes.end + 1e-6),
    };
    const valueAt = (name: string, minute: number) => {
      const before = Math.floor(minute);
      const [a, b] = [before, before + 1].map((row) => data.value(name, row) as number);
      return a! + (b! - a!) * (minute - before);
    };
    for (const side of ["start", "end"] as const) {
      const column: ColumnLabel[] = [];
      for (const label of columns[side]) {
        const name = series.get(label.fill);
        if (name === undefined)
          return `the label "${label.text}" at the view's ${side} is in no series' color`;
        const value =
          at === "view" ? valueAt(name, minutes[side]) : (data.value(name, rows[side]) as number);
        column.push({
          name: label.text === name ? `${name}'s label` : `${name}'s "${label.text}"`,
          point: box.top + chart.toPixel(value, { axis: "y" })!,
          // As the layout blocks it: a line of the theme's height, and its halo.
          height: Math.round(label.size * LINE_HEIGHT) + label.halo,
          at: label.middle,
        });
      }
      const wrong = misplacedLabel(column, top, bottom, side);
      if (wrong) return wrong;
    }
    // And the page shows them where the canvas painted them.
    const pixel = await pixels(screenshot!);
    const hidden = [...columns.start, ...columns.end].find((t) => shownPixels(pixel, t) < 8);
    if (hidden) return `the ${hidden.text} label painted in ${hidden.fill} is not on the screen`;
  };
  return { press, moves, checks, screenshot: true };
}

/** The theme's line height of text, a multiple of its size (theme.ts, `roles.text`). */
const LINE_HEIGHT = 1.25;

/**
 * A3's attached button twenty times: one chart of 3 series x 5,000 minutes
 * zoomed to a fifth, with a button anchored 8 px above the highest
 * observation of each of twenty stretches in and around the view (fitted,
 * as anchors are by default: those at the plot's top go below their
 * point), dragged 20 px right and back. The move's effect is a frame of the
 * moved view, its anchors placed with it.
 */
async function anchorPan(count: number): Promise<Fixture> {
  const { data, names } = walks(3, 5_000, 4);
  const value = (name: string, row: number) => data.value(name, row) as number;
  // The highest observation of each of 20 stretches in and around the
  // view, on a y axis that ends at the highest: those there have no room above.
  const places: { x: number; y: number }[] = [];
  let [low, high] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let k = 0; k < 20; k++) {
    let best = { x: 0, y: Number.NEGATIVE_INFINITY };
    for (let row = 1_900 + k * 63; row < 1_963 + k * 63; row++)
      for (const name of names) {
        const y = value(name, row);
        [low, high] = [Math.min(low, y), Math.max(high, y)];
        if (y > best.y) best = { x: START + row * MINUTE, y };
      }
    places.push(best);
  }
  const chart = createChart(host(800, 400), {
    marks: [line(data, { x: "t", y: names })],
    y: { domain: [low, high] },
    interaction: { zoom: "x" },
    timeZone: "UTC",
  });
  charts = [chart];
  await chart.loading;
  chart.setViewport([START + 2_000 * MINUTE, START + 3_000 * MINUTE]);
  const held: Anchor[] = places.map((at, k) => {
    const button = document.createElement("button");
    button.textContent = `#${k}`;
    button.style.cssText =
      "margin:0;padding:0;border:0;width:44px;height:32px;font:11px sans-serif";
    return anchor(chart, button, { at, side: "top", offset: 8 });
  });
  await until(chart);
  let needed = Number.POSITIVE_INFINITY;
  reset = () => {
    needed = Number.POSITIVE_INFINITY;
  };
  stops.push(
    chart.on("viewport", ({ cause, revision }) => {
      if (moving() && cause === "pointer") needed = revision;
    }),
    chart.on("render", ({ revision }) => {
      if (revision >= needed) drawn();
    }),
  );
  const press = inPlot(chart, 0.5, 0.5);
  // Right and back by 20 px: every move moves the view.
  const moves = Array.from({ length: count }, (_, i) => ({
    x: press.x + (i % 2 ? 0 : 20),
    y: press.y,
  }));
  // Three views no move showed.
  const checks = [45, -70, 110].map((dx) => ({ x: press.x + dx, y: press.y }));
  let flipped = false;
  verify = async (index) => {
    // A side chosen as an anchor shows is measured there in the next frame.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const root = chart.root.getBoundingClientRect();
    const { plot } = chart.getPanels()[0]!;
    for (const [k, at] of places.entries()) {
      const x = chart.toPixel(at.x, { axis: "x" })!;
      const y = chart.toPixel(at.y, { axis: "y" })!;
      const inView = x >= plot.x && x <= plot.x + plot.width;
      if (held[k]!.shown !== inView)
        return `anchor ${k} is ${held[k]!.shown ? "shown" : "hidden"} with its place ${inView ? "in" : "out of"} view`;
      if (!inView) continue;
      const box = held[k]!.element.getBoundingClientRect();
      const [left, top] = [box.left - root.left, box.top - root.top];
      const above = Math.abs(top + box.height - (y - 8)) <= 1;
      const below = Math.abs(top - (y + 8)) <= 1;
      if ((!above && !below) || x < left - 1 || x > left + box.width + 1)
        return `anchor ${k} stands at ${left.toFixed(1)},${top.toFixed(1)}, not 8 px from its place ${x.toFixed(1)},${y.toFixed(1)}`;
      // Where anchors fit (they say the side they took), inside the chart on that side.
      const side = held[k]!.side;
      if (side === undefined) continue;
      if (side !== (above ? "top" : "bottom"))
        return `anchor ${k} says it is on its ${side} side, and stands ${above ? "above" : "below"} its place`;
      if (top < -1 || top + box.height > root.height + 1)
        return `anchor ${k} crosses the chart's edge at ${top.toFixed(1)} px`;
      flipped ||= side === "bottom";
    }
    // Where anchors fit, some at the plot's top went below their place in
    // one of the views checked: the fixture flips.
    const fitting = held.some(({ side }) => side !== undefined);
    if (index === moves.length + checks.length - 1 && fitting && !flipped)
      return "no anchor went below its place; the fixture no longer exercises fitting";
  };
  return { press, moves, checks };
}

/**
 * Three histograms of one 50,000-row table sharing a live row selection:
 * brushing the first highlights the brushed rows in all three. The move's
 * effect is a frame of each chart drawing the channel as the move left it.
 */
async function crossFilter(count: number): Promise<Fixture> {
  const n = 50_000;
  const next = random(3);
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = next() * 100;
    b[i] = a[i]! * 0.6 + next() * 40;
    c[i] = 100 - a[i]! * 0.5 + next() * 30;
  }
  const rows = table({ a, b, c });
  const binding = rowSelection({
    store: selectionStore(rows),
    channel: "brush",
    events: ["brush"],
    live: true,
  });
  charts = (["a", "b", "c"] as const).map((field) =>
    createChart(host(420, 300), {
      marks: [histogram(rows, { x: field, bins: { start: 0, step: BIN } })],
      interaction: { brush: "x" },
      rowSelection: binding,
    }),
  );
  await Promise.all(charts.map((chart) => chart.loading));
  await Promise.all(charts.map(until));
  const needed = charts.map(() => Number.POSITIVE_INFINITY);
  const done = charts.map(() => false);
  reset = () => {
    needed.fill(Number.POSITIVE_INFINITY);
    done.fill(false);
  };
  stops.push(
    ...charts.flatMap((chart, k) => [
      chart.on("rowSelection", ({ revision }) => {
        if (moving()) needed[k] = revision;
      }),
      chart.on("render", ({ revision }) => {
        if (revision < needed[k]!) return;
        done[k] = true;
        if (done.every(Boolean)) drawn();
      }),
    ]),
  );
  const first = charts[0]!;
  const press = inPlot(first, 0.2, 0.5);
  const moves = sweep(first, count, 0.4, 0.8, 0.5);
  // Brushes no move made, between the sweep's steps.
  const checks = [0.55, 0.31, 0.9].map((fx) => inPlot(first, fx, 0.5));
  const all = [...moves, ...checks];
  verify = async (index, screenshot) => {
    const shown = await pixels(screenshot!);
    // The brushed range of a, from the press to the move; within a pixel
    // of its ends, rows may be in or out.
    const box = first.root.getBoundingClientRect();
    const value = (x: number) => first.fromPixel(x - box.left, { axis: "x" })!;
    const [p, q] = [value(press.x), value(all[index]!.x)];
    const [from, to] = [Math.min(p, q), Math.max(p, q)];
    const pixel = Math.abs(value(press.x + 1) - value(press.x));
    // The first chart shades the brushed range over its bars.
    const shaded = [Math.min(press.x, all[index]!.x), Math.max(press.x, all[index]!.x)] as const;
    for (const [k, values] of [a, b, c].entries()) {
      const wrong = highlighted(
        charts[k]!,
        values,
        a,
        [from + pixel, to - pixel],
        [from - pixel, to + pixel],
        shown,
        k === 0 ? shaded : undefined,
      );
      if (wrong) return `histogram ${k + 1}: ${wrong}`;
    }
  };
  return { press, moves, checks, screenshot: true };
}

/** The cross-filter's bins: `BIN` wide from 0. */
const BIN = 5;
/** A rectangle of a path as the SVG renderer writes it. */
const RECT = /M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v([\d.]+)h-[\d.]+Z/g;

/** How far, in pixels, the tooltip's shadow reaches past its box: 6 px down and 16 of blur (dom/tooltip.ts). */
const SHADOW = 24;

/**
 * What is wrong with the brushed rows a histogram of `values` highlights,
 * if anything: each bin's bar, as its live SVG draws it (layers of
 * rectangles: the brushed rows' opaque, the rest faint above them),
 * against its bin's edges on the x scale and its rows and those whose
 * `brushed` value is in `surely` (at least) or `perhaps` (at most) on the
 * y scale (`barWrong`); and each part as the screenshot `shown` shows it,
 * its fill composited over the plot's white, except under the tooltip
 * and its shadow and the page's x range `shaded` (a brush's shading).
 */
function highlighted(
  chart: Chart,
  values: Float64Array,
  brushed: Float64Array,
  surely: readonly [number, number],
  perhaps: readonly [number, number],
  shown: Pixels,
  shaded?: readonly [number, number],
): string | undefined {
  // By bin: rows, rows surely brushed, rows perhaps brushed.
  const counts = new Map<number, [number, number, number]>();
  for (let i = 0; i < values.length; i++) {
    const bin = Math.floor(values[i]! / BIN);
    const count = counts.get(bin) ?? [0, 0, 0];
    const v = brushed[i]!;
    count[0]++;
    if (v >= surely[0] && v <= surely[1]) count[1]++;
    if (v >= perhaps[0] && v <= perhaps[1]) count[2]++;
    counts.set(bin, count);
  }
  // By bin, its bar's rectangles; and the colors of opaque and faint parts.
  const bars = new Map<number, BarPart[]>();
  const colors = new Map<boolean, RGB>();
  for (const path of chart.root.querySelectorAll("svg path[data-kind=rect]")) {
    const d = path.getAttribute("d") ?? "";
    if (d.replace(RECT, "") !== "") return `bars this check cannot read: ${d.slice(0, 40)}`;
    const fill = rgb(path.getAttribute("fill") ?? "");
    if (!fill)
      return `bars filled with "${path.getAttribute("fill")}", which this check cannot read`;
    const opacity = Number(path.getAttribute("fill-opacity") ?? 1);
    const opaque = opacity > 0.75;
    colors.set(opaque, over(fill, opacity, [255, 255, 255]));
    for (const [, x, top, width, height] of d.matchAll(RECT)) {
      const [left, right] = [Number(x), Number(x) + Number(width)];
      const bin = Math.floor(chart.fromPixel((left + right) / 2, { axis: "x" })! / BIN);
      const parts = bars.get(bin) ?? [];
      parts.push({ left, right, top: Number(top), bottom: Number(top) + Number(height), opaque });
      bars.set(bin, parts);
    }
  }
  for (const bin of bars.keys())
    if (!counts.has(bin)) return `draws a bar for bin ${bin * BIN}, which holds no rows`;
  const y = (rows: number) => chart.toPixel(rows, { axis: "y" })!;
  const box = chart.root.getBoundingClientRect();
  const tip = tooltipBox(chart)?.getBoundingClientRect();
  const hidden = (x: number, at: number) =>
    (shaded && x > shaded[0] - 4 && x < shaded[1] + 4) ||
    (tip &&
      x > tip.left - SHADOW &&
      x < tip.right + SHADOW &&
      at > tip.top - SHADOW &&
      at < tip.bottom + SHADOW);
  for (const [bin, [rows, low, high]] of counts) {
    const range = `[${bin * BIN}, ${(bin + 1) * BIN})`;
    const edges = [bin * BIN, (bin + 1) * BIN].map((v) => chart.toPixel(v, { axis: "x" })!) as [
      number,
      number,
    ];
    const parts = bars.get(bin) ?? [];
    const wrong = barWrong(parts, rows, low, high, edges, y);
    if (wrong) return `the bar of bin ${range} ${wrong}`;
    for (const opaque of [true, false]) {
      const own = parts.filter((part) => part.opaque === opaque);
      const from = Math.min(...own.map((part) => part.top));
      const to = Math.max(...own.map((part) => part.bottom));
      // Parts of a few pixels are mostly their antialiased edges.
      if (own.length === 0 || to - from < 6) continue;
      // A quarter of the bin in from each edge, five rows down the part:
      // a grid line under a faint part shows in a row or two, never most.
      for (const across of [0.25, 0.75]) {
        const x = box.left + edges[0] + across * (edges[1] - edges[0]);
        const seen = [0.2, 0.35, 0.5, 0.65, 0.8]
          .map((down) => box.top + from + down * (to - from))
          .filter((at) => !hidden(x, at))
          .map((at) => shown(x, at));
        const off = seen.filter((color) => shadeWrong(color, colors.get(opaque)!));
        if (off.length > seen.length / 2)
          return `the ${opaque ? "opaque" : "faint"} part of bin ${range}'s bar shows ${off[0]!.join(",")} on the screen, not ${colors.get(opaque)!.map(Math.round).join(",")}`;
      }
    }
  }
}

/**
 * Ten charts of 15 series x 3,000 minutes sharing a cursor: a move over
 * the first shows the crosshair in the other nine, each reporting it once
 * drawn. The move's effect is all nine reports at the first's minute.
 */
async function crosshairDashboard(count: number): Promise<Fixture> {
  charts = Array.from({ length: 10 }, (_, k) => {
    const { data, names } = walks(15, 3_000, 10 + k);
    return createChart(host(600, 250), {
      marks: [line(data, { x: "t", y: names })],
      interaction: { sync: { cursor: "dashboard" } },
      theme: { style: { crosshair: { stroke: MARKED } } },
      timeZone: "UTC",
    });
  });
  await Promise.all(charts.map((chart) => chart.loading));
  await Promise.all(charts.map(until));
  const first = charts[0]!;
  const moves = sweep(first, count, 0.1, 0.9, 0.5);
  // Between the sweep's steps, and far apart.
  const checks = [0.27, 0.81, 0.46].map((fx) => inPlot(first, fx, 0.5));
  const all = [...moves, ...checks];
  let own = Number.NaN;
  const shown = charts.map(() => Number.NaN);
  reset = () => {
    own = Number.NaN;
    shown.fill(Number.NaN);
  };
  const check = () => {
    if (!Number.isNaN(own) && shown.every((value, k) => k === 0 || value === own)) drawn();
  };
  stops.push(
    first.on("hover", ({ cause, pointer, inspection }) => {
      if (!moving() || cause !== "pointer" || inspection?.axis !== "x") return;
      if (at(first, pointer, all[armed!.index])) own = inspection.value;
      check();
    }),
    ...charts.slice(1).map((chart, k) =>
      chart.on("hover", ({ cause, inspection }) => {
        if (!moving() || cause !== "sync" || inspection?.axis !== "x") return;
        shown[k + 1] = inspection.value;
        check();
      }),
    ),
  );
  verify = async (index, screenshot) => {
    const pixel = await pixels(screenshot!);
    // The minute under the pointer (a fifth of a pixel wide), wherever each chart places it.
    const minute = first.fromPixel(all[index]!.x - first.root.getBoundingClientRect().left, {
      axis: "x",
    })!;
    for (const [k, chart] of charts.entries()) {
      if (k === 0) continue;
      const x = chart.root.getBoundingClientRect().left + chart.toPixel(minute, { axis: "x" })!;
      const wrong = markedLine(pixel, chart, x);
      if (wrong) return `chart ${k + 1}'s crosshair ${wrong}, the first chart's minute`;
    }
  };
  return { moves, checks, screenshot: true };
}

const FIXTURES: Record<FixtureName, (count: number) => Promise<Fixture>> = {
  "hover-listener": hoverListener,
  "hover-headings": (count) => hoverListener(count, true),
  "custom-hover": customHover,
  "pan-labels": panLabels,
  "pan-view-labels": (count) => panLabels(count, "view"),
  "anchor-pan": anchorPan,
  "cross-filter": crossFilter,
  "crosshair-dashboard": crosshairDashboard,
};

window.interaction = {
  mount: (name, count) => FIXTURES[name](count),
  arm(index) {
    armed?.cancel();
    reset(index);
    timing = new Promise((resolve) => {
      let start = 0;
      const stop = () => {
        removeEventListener("pointermove", first, true);
        clearTimeout(timer);
        armed = undefined;
      };
      const first = () => {
        start = performance.now();
        removeEventListener("pointermove", first, true);
        if (armed) armed.started = true;
      };
      const timer = setTimeout(() => {
        stop();
        resolve(null);
      }, 1000);
      armed = {
        index,
        started: false,
        done: () => {
          stop();
          afterFrame(() => resolve(performance.now() - start));
        },
        cancel: () => {
          stop();
          resolve(null);
        },
      };
      addEventListener("pointermove", first, true);
    });
  },
  result: () => timing,
  verify: (index, screenshot) => verify(index, screenshot),
  unmount() {
    armed?.cancel();
    for (const stop of stops) stop();
    for (const chart of charts) chart.destroy();
    stops = [];
    charts = [];
    reset = () => {};
    verify = async () => "the fixture checks nothing";
    document.getElementById("stage")!.replaceChildren();
  },
};
