// The page of the pointer-interaction benchmark (run.ts): mounts one of its
// fixtures and times each pointer move from its first event to the frame
// after the move's effect was drawn. A move's effect counts only from
// reports made after its input arrived, and as drawn once a `render` of the
// revision its change made has come (the interaction guide's "Causes and
// revisions"). Once per block, untimed, `verify` checks the drawn result
// itself: the chart's SVG, or the pixels of a screenshot.

import {
  type Anchor,
  anchor,
  type Chart,
  createChart,
  histogram,
  line,
  rowSelection,
  rule,
  selectionStore,
  table,
  text,
  time,
} from "herceg";

/** A pointer position in the page's CSS pixels. */
export interface Point {
  x: number;
  y: number;
}

/** What run.ts drives: where to press (drags) and where each move goes. */
export interface Fixture {
  press?: Point;
  moves: Point[];
  /** Whether `verify` reads a screenshot of the page (in CSS pixels). */
  screenshot?: boolean;
}

export type FixtureName =
  | "hover-listener"
  | "pan-labels"
  | "anchor-pan"
  | "cross-filter"
  | "crosshair-dashboard";

declare global {
  interface Window {
    interaction: {
      mount(name: FixtureName, moves: number): Promise<Fixture>;
      /** Times move `index`: `result` resolves with ms to the frame after its effect, or null after 1 s. */
      arm(index: number): void;
      result(): Promise<number | null>;
      /** What is wrong with the drawn result of the moves so far, if anything. */
      verify(screenshot?: string): Promise<string | undefined>;
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
/** The fixture's per-move state, cleared as each move is armed. */
let reset: () => void = () => {};
let verify: (screenshot?: string) => Promise<string | undefined> = async () => undefined;
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

/** The pixels of a PNG screenshot taken in CSS pixels. */
async function pixels(base64: string) {
  const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
  const image = await createImageBitmap(blob);
  const context = new OffscreenCanvas(image.width, image.height).getContext("2d")!;
  context.drawImage(image, 0, 0);
  const { data, width } = context.getImageData(0, 0, image.width, image.height);
  return (x: number, y: number) => {
    const i = (Math.round(y) * width + Math.round(x)) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!] as const;
  };
}

/**
 * One chart of 8 series x 2,000 minutes with a rule at the hovered minute,
 * which a `hover` listener writes: the move's effect is the rule drawn
 * there, in the move's frame.
 */
async function hoverListener(count: number): Promise<Fixture> {
  const { data, names } = walks(8, 2_000, 1);
  const marker = table({ t: time(Float64Array.of(START)) });
  const chart = createChart(host(800, 400), {
    marks: [
      line(data, { x: "t", y: names }),
      rule(marker, { x: "t", stroke: MARKED, strokeWidth: 3 }),
    ],
    timeZone: "UTC",
  });
  charts = [chart];
  await chart.loading;
  await until(chart);
  const moves = sweep(chart, count, 0.1, 0.9, 0.5);
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
      if (moving() && at(chart, pointer, moves[armed!.index])) needed = chart.revision;
    }),
    chart.on("render", ({ revision }) => {
      if (revision >= needed) drawn();
    }),
  );
  verify = async () => {
    const x = chart.toPixel(written, { axis: "x" });
    const line = /<line x1="([\d.]+)"[^>]*stroke="#ff00ff"/.exec(chart.toSVG());
    if (x === undefined || !line) return "the rule is not drawn";
    if (Math.abs(Number(line[1]) - x) > 1)
      return `the rule is drawn at ${line[1]} px, not at the hovered minute's ${x.toFixed(1)}`;
  };
  return { moves };
}

/**
 * One chart of 8 series x 5,000 minutes zoomed to a fifth, labelled at the
 * first and last observation of each series in view, panned by dragging:
 * the move's effect is a frame of the moved view.
 */
async function panLabels(count: number): Promise<Fixture> {
  const { data, names } = walks(8, 5_000, 2);
  const chart = createChart(host(800, 400), {
    marks: [
      line(data, { id: "lines", x: "t", y: names, labels: { at: "visible-end" } }),
      text({ from: { mark: "lines", at: "visible-start" }, label: "start" }),
    ],
    interaction: { zoom: "x" },
    timeZone: "UTC",
  });
  charts = [chart];
  await chart.loading;
  chart.setViewport([START + 2_000 * MINUTE, START + 3_000 * MINUTE]);
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
  verify = async () => {
    const { plot } = chart.getPanels()[0]!;
    const texts = [...chart.toSVG().matchAll(/<text x="([\d.]+)"[^>]*>([^<]*)<\/text>/g)];
    const within = (x: string, from: number, to: number) =>
      Number(x) >= plot.x + from * plot.width && Number(x) <= plot.x + to * plot.width + 40;
    const starts = texts.filter(([, x, label]) => label === "start" && within(x!, 0, 0.25));
    const ends = texts.filter(([, x, label]) => names.includes(label!) && within(x!, 0.75, 1));
    if (starts.length !== names.length || ends.length !== names.length)
      return `${starts.length} labels at the view's start and ${ends.length} at its end, not ${names.length} each`;
  };
  const press = inPlot(chart, 0.5, 0.5);
  // Right and back by 20 px: every move moves the view.
  return {
    press,
    moves: Array.from({ length: count }, (_, i) => ({ x: press.x + (i % 2 ? 0 : 20), y: press.y })),
  };
}

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
  verify = async () => {
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
    }
    // Where anchors fit, some at the plot's top went below their place: the fixture flips.
    if (held.some(({ side }) => side !== undefined) && !held.some(({ side }) => side === "bottom"))
      return "no anchor went below its place; the fixture no longer exercises fitting";
  };
  const press = inPlot(chart, 0.5, 0.5);
  // Right and back by 20 px: every move moves the view.
  return {
    press,
    moves: Array.from({ length: count }, (_, i) => ({ x: press.x + (i % 2 ? 0 : 20), y: press.y })),
  };
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
      marks: [histogram(rows, { x: field, bins: { start: 0, step: 5 } })],
      interaction: { brush: "x" },
      rowSelection: binding,
    }),
  );
  await Promise.all(charts.map((chart) => chart.loading));
  await Promise.all(charts.map(until));
  const unbrushed = charts.map((chart) => chart.toSVG());
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
  verify = async () => {
    const same = charts.findIndex((chart, k) => k > 0 && chart.toSVG() === unbrushed[k]);
    if (same > 0) return `histogram ${same + 1} draws no highlighted rows`;
  };
  const first = charts[0]!;
  return { press: inPlot(first, 0.2, 0.5), moves: sweep(first, count, 0.4, 0.8, 0.5) };
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
      if (at(first, pointer, moves[armed!.index])) own = inspection.value;
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
  verify = async (screenshot) => {
    const pixel = await pixels(screenshot!);
    for (const [k, chart] of charts.entries()) {
      if (k === 0) continue;
      const x = chart.toPixel(own, { axis: "x" });
      const box = chart.root.getBoundingClientRect();
      const { plot } = chart.getPanels()[0]!;
      let marked = 0;
      for (let y = plot.y; y < plot.y + plot.height; y += 4) {
        // The crosshair's magenta, antialiased into the columns beside it.
        const near = [-2, -1, 0, 1, 2].some((dx) => {
          const [r, g, b] = pixel(box.left + x! + dx, box.top + y);
          return r - g > 60 && b - g > 60;
        });
        if (near) marked++;
      }
      if (x === undefined || marked < plot.height / 8)
        return `chart ${k + 1} draws no crosshair at the first chart's minute`;
    }
  };
  return { moves, screenshot: true };
}

const FIXTURES: Record<FixtureName, (count: number) => Promise<Fixture>> = {
  "hover-listener": hoverListener,
  "pan-labels": panLabels,
  "anchor-pan": anchorPan,
  "cross-filter": crossFilter,
  "crosshair-dashboard": crosshairDashboard,
};

window.interaction = {
  mount: (name, count) => FIXTURES[name](count),
  arm(index) {
    armed?.cancel();
    reset();
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
  verify: (screenshot) => verify(screenshot),
  unmount() {
    armed?.cancel();
    for (const stop of stops) stop();
    for (const chart of charts) chart.destroy();
    stops = [];
    charts = [];
    reset = () => {};
    verify = async () => undefined;
    document.getElementById("stage")!.replaceChildren();
  },
};
