// Cross-filtering through one live channel, as the study's B2 (three
// histograms) and B5 (a scatter plot matrix) need: a brush's previews are
// highlighted in every chart in the frame the brush moves.
import "./interactive.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { selectionStore } from "../../src/data/selection.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, createChart } from "../../src/dom/chart.ts";
import { grid } from "../../src/layout.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { point } from "../../src/marks/point.ts";
import { panels } from "../../src/model/panels.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { MOUSE } from "./helpers.ts";

let host: HTMLDivElement;
const charts: Chart[] = [];

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "display:flex;width:390px";
  document.body.append(host);
});

afterEach(() => {
  for (const chart of charts.splice(0)) chart.destroy();
  host.remove();
});

/** The animation frame being run, which every callback of one frame shares. */
const now = () => document.timeline.currentTime as number;
/** The next frame, by its time as `now` reads it there. */
const frame = () => new Promise<number>((resolve) => requestAnimationFrame(() => resolve(now())));

/** 2,000 rows of three fields, seeded. */
function flights() {
  let seed = 42;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const n = 2000;
  const make = (scale: number) => Float64Array.from({ length: n }, () => next() * scale);
  return table({ distance: make(5000), delay: make(400), time: make(24) });
}

function mount(element: HTMLElement, options: Parameters<typeof createChart>[1]): Chart {
  const chart = createChart(element, { errorMode: "throw", renderer: "canvas", ...options });
  charts.push(chart);
  return chart;
}

/** Sends pointer event `type` at data (x, y) in `chart`'s panel `key` (its first without). */
function at(chart: Chart, type: string, x: number, y?: number, key?: string) {
  const rect = chart.root.getBoundingClientRect();
  const panelOf = chart.getPanels().find((p) => key === undefined || p.key === key)!;
  const { plot } = panelOf;
  const target = { panel: panelOf.key };
  chart.root.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: rect.left + chart.toPixel(x, { ...target, axis: "x" })!,
      clientY:
        rect.top +
        (y === undefined ? plot.y + plot.height / 2 : chart.toPixel(y, { ...target, axis: "y" })!),
      pointerId: MOUSE,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    }),
  );
}

describe("a live channel", () => {
  it("shows a brush's previews in every histogram in the frame it moves (B2)", async () => {
    const source = flights();
    const store = selectionStore(source);
    const fields = ["distance", "delay", "time"] as const;
    const views = fields.map((field) => {
      const element = document.createElement("div");
      // Small enough that all three are on screen: charts off it wait to draw.
      element.style.cssText = "width:130px;height:160px";
      host.append(element);
      return mount(element, {
        marks: [histogram(source, { x: field, unselected: { fill: "#dddddd", opacity: 1 } })],
        interaction: { brush: { shape: "x", edit: true } },
        rowSelection: rowSelection({ store, channel: "brush", live: true }),
      });
    });
    await Promise.all(views.map((chart) => chart.loading));
    const drawn: number[][] = views.map(() => []);
    for (const [i, chart] of views.entries()) chart.on("render", () => drawn[i]!.push(now()));
    const [first, second] = views as [Chart, Chart];
    const phases: string[] = [];
    second.on("rowSelection", ({ phase, cause }) => phases.push(`${cause} ${phase}`));
    const latencies: number[] = [];
    at(first, "pointerdown", 1000);
    for (const x of [1500, 2000, 2500, 3000, 2500]) {
      at(first, "pointermove", x);
      const moved = performance.now();
      const ticked = await frame();
      latencies.push(performance.now() - moved);
      // Every chart drew the preview in that frame.
      expect(drawn.map((marks) => marks.at(-1))).toEqual(views.map(() => ticked));
    }
    at(first, "pointerup", 2500);
    expect(store.get("brush")?.kind).toBe("predicate");
    // Charts hearing the brush's rows report them in its phases.
    expect(new Set(phases)).toEqual(new Set(["sync preview", "sync commit"]));
    console.info(`B2 brush to three histograms drawn: ${latencies.map((t) => t.toFixed(1))} ms`);
  });

  it("shows a brush's previews in every panel of a matrix in the frame it moves (B5)", async () => {
    const source = flights();
    const store = selectionStore(source);
    const fields = ["distance", "delay", "time"] as const;
    const cells = fields.flatMap((y, i) => fields.map((x, j) => ({ x, y, id: `${i},${j}` })));
    const element = document.createElement("div");
    element.style.cssText = "width:390px;height:390px";
    host.append(element);
    const chart = mount(element, {
      panels: panels(
        cells.map(({ id }) => ({ id })),
        grid({ columns: 3 }),
      ),
      x: { scope: "column" },
      y: { scope: "row" },
      marks: cells.map(({ x, y, id }) =>
        point(source, { x, y, panel: id, radius: 2, unselected: { fill: "#000000" } }),
      ),
      interaction: { brush: "xy" },
      rowSelection: rowSelection({ store, channel: "brush", live: true }),
    });
    await chart.loading;
    const renders: number[] = [];
    chart.on("render", () => renders.push(now()));
    // Cell 0,0 plots distance against itself.
    at(chart, "pointerdown", 1000, 1000, "0,0");
    for (const [x, y] of [
      [2000, 2000],
      [3000, 3000],
    ] as const) {
      at(chart, "pointermove", x, y, "0,0");
      const ticked = await frame();
      expect(renders.at(-1)).toBe(ticked);
      expect(chart.drawnRevision).toBe(chart.revision);
    }
    at(chart, "pointerup", 3000, 3000, "0,0");
    expect(store.get("brush")?.kind).toBe("predicate");
  });
});
