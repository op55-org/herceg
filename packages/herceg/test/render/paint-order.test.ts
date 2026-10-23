// The order a panel paints in: its marks as declared, `zIndex` over that,
// grid lines at -1, whatever cuts each; the same in static SVG and PDF,
// and the topmost target picked where several are under the pointer.
import { inflateSync } from "node:zlib";
import { describe, expect } from "vitest";
import { col } from "../../src/data/expr.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { selectionStore, selectRows } from "../../src/data/selection.ts";
import { type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { facet } from "../../src/model/facet.ts";
import { ChartModel } from "../../src/model/model.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { clickedRows } from "../../src/model/selected-rows.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderToSVG, type StaticOptions } from "../../src/render/static.ts";
import type { PointGeometry, RectGeometry } from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";

const values = table({ x: [0, 1, 2], y: [1, 3, 2] });
const chart = (
  marks: StaticOptions["marks"],
  extra: Partial<StaticOptions> = {},
): StaticOptions => ({
  width: 300,
  height: 200,
  legend: false,
  marks,
  ...extra,
});
const red = (options: object = {}) =>
  line(values, { x: "x", y: "y", stroke: "#ff0000", ...options });
const green = (options: object = {}) => rule({ y: 2, stroke: "#00ff00", ...options });
const blue = (options: object = {}) =>
  line(values, { x: "x", y: "y", stroke: "#0000ff", ...options });

/** The order `colors` first appear in `output`, written as `as` writes each. */
function order(output: string, colors: readonly string[], as = (color: string) => color): string[] {
  return colors
    .map((color) => [color, output.indexOf(as(color))] as const)
    .filter(([, at]) => at >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([color]) => color);
}

const COLORS = ["#ff0000", "#00ff00", "#0000ff"];

describe("paint order", () => {
  contractTest("mark.z-index.order.spec", () => {
    // As declared: a rule between two lines paints between them, rules and
    // text no longer above all data.
    expect(order(renderToSVG(chart([red(), green(), blue()])), COLORS)).toEqual(COLORS);
    expect(order(renderToSVG(chart([green(), red(), blue()])), COLORS)).toEqual([
      "#00ff00",
      "#ff0000",
      "#0000ff",
    ]);
    // Higher zIndex above lower, ties as declared.
    expect(order(renderToSVG(chart([red({ zIndex: 1 }), green(), blue()])), COLORS)).toEqual([
      "#00ff00",
      "#0000ff",
      "#ff0000",
    ]);
    expect(order(renderToSVG(chart([red(), blue(), green({ zIndex: -2 })])), COLORS)).toEqual([
      "#00ff00",
      "#ff0000",
      "#0000ff",
    ]);
  });

  contractTest("mark.z-index.clip.spec", () => {
    // Clipping does not change the order: a line drawn whole (clip: false)
    // between two cut to the plot stays between them.
    const svg = renderToSVG(chart([red(), blue({ clip: false }), green({ clip: "plot" })]));
    expect(order(svg, COLORS)).toEqual(["#ff0000", "#0000ff", "#00ff00"]);
  });

  contractTest("axis.grid.z-index.order.spec", () => {
    const grid = (zIndex?: number) =>
      renderToSVG(
        chart([red()], {
          theme: { tokens: { grid: "#00ff00" } },
          x: { grid: false },
          ...(zIndex !== undefined && { y: { grid: { zIndex } } }),
        }),
      );
    // Under the marks by default (-1), above them at 1, ties under the marks of that zIndex.
    expect(order(grid(), ["#00ff00", "#ff0000"])).toEqual(["#00ff00", "#ff0000"]);
    expect(order(grid(1), ["#00ff00", "#ff0000"])).toEqual(["#ff0000", "#00ff00"]);
    expect(order(grid(0), ["#00ff00", "#ff0000"])).toEqual(["#00ff00", "#ff0000"]);
  });

  contractTest("mark.z-index.order.pdf", () => {
    const content = (options: StaticOptions) => {
      const pdf = Buffer.from(renderToPDF(options)).toString("latin1");
      return [...pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g)]
        .map((m) => inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1"))
        .find((s) => s.includes("/Figure"))!;
    };
    const stroke = (color: string) =>
      `${[1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16) / 255).join(" ")} RG`;
    expect(order(content(chart([red(), green(), blue()])), COLORS, stroke)).toEqual(COLORS);
    expect(order(content(chart([red({ zIndex: 1 }), green(), blue()])), COLORS, stroke)).toEqual([
      "#00ff00",
      "#0000ff",
      "#ff0000",
    ]);
  });

  contractTest("panel.paint.order.spec", () => {
    // Panels paint one after another, each its background and grid lines
    // and then its geometry: the second panel's go over the first's
    // drawings, even those not cut to its plot.
    const groups = table({ x: [0, 1, 0, 1], y: [1, 2, 2, 1], g: ["a", "a", "b", "b"] });
    const svg = renderToSVG(
      chart([line(groups, { x: "x", y: "y", stroke: "#ff0000", clip: false })], {
        facet: facet("g"),
        theme: { tokens: { grid: "#00ff00" } },
        x: { grid: false },
      }),
    );
    const runs = [...svg.matchAll(/#ff0000|#00ff00/g)]
      .map(([color]) => color)
      .filter((color, i, all) => color !== all[i - 1]);
    expect(runs).toEqual(["#00ff00", "#ff0000", "#00ff00", "#ff0000"]);
  });

  contractTest("mark.z-index.panels", () => {
    // A panel's paint plan is kept while it is drawn, and goes with it.
    const rows = table({ x: [0, 1, 0, 1], y: [1, 2, 1, 2], g: ["a", "a", "b", "b"] });
    const model = new ChartModel(
      {
        locale: "en-US",
        facet: facet("g"),
        marks: [
          line(rows, { x: "x", y: "y", zIndex: 2 }),
          point(rows, { x: "x", y: "y", zIndex: 1 }),
        ],
      },
      undefined,
      ...staticCompilers(),
    );
    model.setSize(400, 200, 1);
    const planOf = (key: string) =>
      model.scene(estimateText).panels.find((panel) => panel.key === key)?.paint;
    const first = planOf("b");
    expect(first).toBeDefined();
    expect(planOf("b")).toBe(first);
    rows.reset({ x: [0, 1], y: [1, 2], g: ["a", "a"] });
    expect(planOf("b")).toBeUndefined();
    rows.reset({ x: [0, 1, 0, 1], y: [1, 2, 1, 2], g: ["a", "a", "b", "b"] });
    const again = planOf("b");
    expect(again).toEqual(first);
    expect(again).not.toBe(first);
  });

  contractTest("mark.z-index.text.spec", () => {
    // Text paints in its place too: under a line declared after it.
    const label = text({ x: 1, y: 2, label: { text: "note", style: { color: "#00ff00" } } });
    const svg = renderToSVG(chart([label, blue()]));
    expect(order(svg, ["#00ff00", "#0000ff"])).toEqual(["#00ff00", "#0000ff"]);
  });

  contractTest("mark.z-index.pick", () => {
    // Two points at one place: the one painted on top is found; the
    // keyboard and descriptions keep the marks' declared order.
    const at = table({ x: [1], a: [2], b: [2] });
    const found = (zIndex?: number) => {
      const model = new ChartModel({
        locale: "en-US",
        marks: [
          point(at, { x: "x", y: "a", ...(zIndex !== undefined && { zIndex }) }),
          point(at, { x: "x", y: "b" }),
        ],
      });
      model.setSize(300, 200, 1);
      model.scene(estimateText);
      const x = model.xScale()!.map(1);
      const y = model.yScale()!.map(2);
      return model.inspect(x, y, "nearest")!.points[0]!.label;
    };
    expect(found()).toBe("b");
    expect(found(1)).toBe("a");
    expect(found(-1)).toBe("b");
  });

  contractTest("mark.z-index.click", () => {
    // Clicks take the rows of the mark painted on top, as hover does.
    const first = table({ x: [1], y: [2] });
    const second = table({ x: [1], y: [2] });
    const clicked = (zIndex?: number) => {
      const model = new ChartModel({
        locale: "en-US",
        marks: [
          point(first, { x: "x", y: "y", ...(zIndex !== undefined && { zIndex }) }),
          point(second, { x: "x", y: "y" }),
        ],
      });
      model.setSize(300, 200, 1);
      model.scene(estimateText);
      const tables = new Set([first, second] as unknown as Table[]);
      return clickedRows(model, tables, model.xScale()!.map(1), model.yScale()!.map(2))?.table;
    };
    expect(clicked()).toBe(second);
    expect(clicked(1)).toBe(first);
  });

  contractTest("mark.pick.ties", () => {
    // Within a mark too: of coincident points, the later series' is on top.
    const both = table({ x: [1, 1], y: [2, 2], s: ["first", "last"] });
    const model = new ChartModel({
      locale: "en-US",
      marks: [point(both, { x: "x", y: "y", series: "s" })],
    });
    model.setSize(300, 200, 1);
    model.scene(estimateText);
    const x = model.xScale()!.map(1);
    const y = model.yScale()!.map(2);
    expect(model.inspect(x, y, "nearest")!.points[0]!.label).toBe("last");
    // Opaque points of several colors paint color by color: the one in the
    // color painted later is on top, whichever row it is.
    const toned = table({ x: [1, 1], y: [2, 2], c: [100, 0] });
    const colored = new ChartModel({
      locale: "en-US",
      marks: [point(toned, { x: "x", y: "y", color: "c" })],
    });
    colored.setSize(300, 200, 1);
    const scene = colored.scene(estimateText);
    const drawn = scene.panels[0]!.marks[0] as PointGeometry;
    const tones = Array.from(drawn.colors!.index.subarray(0, 2));
    // Rows 0 and 1 drawn in that order; the higher tone paints later.
    const top = tones[0]! > tones[1]! ? 0 : 1;
    // Here the first row's color paints later: ties do not just go to the later row.
    expect(top).toBe(0);
    const [px, py] = [colored.xScale()!.map(1), colored.yScale()!.map(2)];
    expect(colored.inspect(px, py, "nearest")!.points[0]!.row).toBe(top);
    // A click selects the row on top too.
    const clicked = clickedRows(colored, new Set([toned as unknown as Table]), px, py);
    expect(Array.from(clicked!.rows)).toEqual([top]);
  });

  contractTest("mark.pick.ties.precision", () => {
    // A line's observation and a point drawn at one place tie, though points
    // are placed in 32-bit floats: the one painted on top is found.
    const same = table({ x: [0, 1, 3], a: [0, 1, 3], b: [0, 1, 3] });
    const found = (marks: StaticOptions["marks"]) => {
      const model = new ChartModel({
        locale: "en-US",
        x: { domain: [0, 3] },
        y: { domain: [0, 3] },
        marks,
      });
      model.setSize(400, 300, 1);
      const scene = model.scene(estimateText);
      const drawn = scene.panels[0]!.marks.find((m) => m.kind === "point") as PointGeometry;
      const [x, y] = [model.xScale()!.map(1), model.yScale()!.map(1)];
      // Where the point is drawn is not quite where the line's observation is.
      expect(drawn.coords[2]).not.toBe(x);
      return model.inspect(x + 0.4, y, "nearest")!.points[0]!.label;
    };
    const lined = (options: object = {}) => line(same, { x: "x", y: "a", ...options });
    const pointed = point(same, { x: "x", y: "b" });
    expect(found([lined(), pointed])).toBe("b");
    expect(found([pointed, lined()])).toBe("a");
    expect(found([lined({ zIndex: 1 }), pointed])).toBe("a");
  });

  contractTest("mark.pick.ties.dense", () => {
    // Observations closer together than ties reach: ties count from the
    // nearest, so hover finds the observation under the pointer.
    const n = 1_000_000;
    const flat = table({
      x: Float64Array.from({ length: n }, (_, i) => i),
      y: new Float64Array(n).fill(1),
    });
    const model = new ChartModel({
      locale: "en-US",
      x: { domain: [0, n] },
      marks: [line(flat, { x: "x", y: "y" })],
    });
    model.setSize(400, 300, 1);
    model.scene(estimateText);
    const found = model.inspect(model.xScale()!.map(0), model.yScale()!.map(1), "nearest");
    expect(found!.points[0]!.row).toBeLessThan(3);
  });

  contractTest("mark.pick.ties.settled", () => {
    // Observations at one x, walked back from the pointer: the farthest
    // first, the nearest last. Of those tying with the nearest, the later
    // row is on top, though the nearest is found after it.
    const model = (y: number[]) => {
      const built = new ChartModel({
        locale: "en-US",
        x: { domain: [0, 2] },
        y: { domain: [0, 3] },
        marks: [line(table({ x: [1, 1, 1], y }), { x: "x", y: "y" })],
      });
      built.setSize(400, 300, 1);
      built.scene(estimateText);
      return built;
    };
    const plain = model([1, 1, 1]);
    const [px, py] = [plain.xScale()!.map(1) + 1e-6, plain.yScale()!.map(1)];
    const away = [0.00001, 0.0009, 0.0018].map((d) => plain.yScale()!.invert(py - d));
    const found = model(away).inspect(px, py, "nearest");
    expect(found!.points[0]!.row).toBe(1);
  });

  contractTest("mark.pick.ties.symmetric", () => {
    // Points as far either way from the pointer tie, though their 32-bit
    // places round apart: the later row, on top, is found and clicked.
    const two = table({ x: [1, 1], y: [1, 2] });
    const model = new ChartModel({
      locale: "en-US",
      x: { domain: [0, 2] },
      y: { domain: [0, 11] },
      marks: [point(two, { x: "x", y: "y", radius: 20 })],
    });
    model.setSize(400, 301, 1);
    model.scene(estimateText);
    const [px, py] = [model.xScale()!.map(1), model.yScale()!.map(1.5)];
    expect(model.inspect(px, py, "nearest")!.points[0]!.row).toBe(1);
    const clicked = clickedRows(model, new Set([two as unknown as Table]), px, py);
    expect(Array.from(clicked!.rows)).toEqual([1]);
  });

  contractTest("bar.pick.looks", () => {
    // Overlapping bars paint look by look: a click takes the one painted last.
    const three = table({ x: [1, 2, 3], y: [5, 5, 5] });
    const model = new ChartModel(
      {
        locale: "en-US",
        x: { domain: [0, 10] },
        marks: [
          bar(three, {
            x: "x",
            y: "y",
            width: { px: 100 },
            encode: {
              // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
              opacity: { condition: { when: col("x").eq(2), then: 0.8, otherwise: 1 } },
            },
          }),
        ],
      },
      undefined,
      ...staticCompilers(),
    );
    model.setSize(300, 200, 1);
    const scene = model.scene(estimateText);
    // Row 1's look paints after the other rows'.
    const rects = scene.panels[0]!.marks.filter((g) => g.kind === "rect");
    expect(rects.map((g) => (g as RectGeometry).count)).toEqual([2, 1]);
    const [px, py] = [model.xScale()!.map(2), model.yScale()!.map(2)];
    const clicked = clickedRows(model, new Set([three as unknown as Table]), px, py);
    expect(Array.from(clicked!.rows)).toEqual([1]);
  });

  contractTest("mark.pick.ties.highlight", () => {
    // A highlighted selection's rows paint over the others: of coincident
    // points, the selected one is found and clicked, in one series or
    // before a later one.
    for (const series of [undefined, "s"] as const) {
      const both = table({ x: [1, 1], y: [2, 2], s: ["first", "last"] });
      const store = selectionStore(both);
      const selection = rowSelection({ store, channel: "focus" });
      const model = new ChartModel({
        locale: "en-US",
        marks: [point(both, { x: "x", y: "y", ...(series && { series }) })],
        rowSelection: selection,
      });
      model.setSize(300, 200, 1);
      selection.highlight(model);
      store.set("focus", selectRows(new RowSet(both).add(0)));
      model.scene(estimateText);
      const [px, py] = [model.xScale()!.map(1), model.yScale()!.map(2)];
      expect(model.inspect(px, py, "nearest")!.points[0]!.row, series).toBe(0);
      const clicked = clickedRows(model, new Set([both as unknown as Table]), px, py);
      expect(Array.from(clicked!.rows), series).toEqual([0]);
    }
    // Bars wider than their places overlap: a click takes the highlighted one, on top.
    const pair = table({ x: [1, 2], y: [5, 5] });
    const pairStore = selectionStore(pair);
    const pairSelection = rowSelection({ store: pairStore, channel: "focus" });
    const bars = new ChartModel({
      locale: "en-US",
      x: { domain: [0, 10] },
      marks: [bar(pair, { x: "x", y: "y", width: { px: 80 } })],
      rowSelection: pairSelection,
    });
    bars.setSize(300, 200, 1);
    pairSelection.highlight(bars);
    pairStore.set("focus", selectRows(new RowSet(pair).add(0)));
    bars.scene(estimateText);
    const [bx, by] = [bars.xScale()!.map(1.5), bars.yScale()!.map(2)];
    const onTop = clickedRows(bars, new Set([pair as unknown as Table]), bx, by);
    expect(Array.from(onTop!.rows)).toEqual([0]);
    // A line's highlighted observation is found over a coincident one.
    const walk = table({ x: [1, 1, 2], y: [5, 5, 0] });
    const walkStore = selectionStore(walk);
    const walkSelection = rowSelection({ store: walkStore, channel: "focus" });
    const walked = new ChartModel({
      locale: "en-US",
      marks: [line(walk, { x: "x", y: "y" })],
      rowSelection: walkSelection,
    });
    walked.setSize(300, 200, 1);
    walkSelection.highlight(walked);
    walkStore.set("focus", selectRows(new RowSet(walk).add(0)));
    walked.scene(estimateText);
    const [wx, wy] = [walked.xScale()!.map(1), walked.yScale()!.map(5)];
    expect(walked.inspect(wx, wy, "nearest")!.points[0]!.row).toBe(0);
    // Rows left out are dimmed, translucent: they paint in row order, not color by color.
    const toned = table({ x: [1, 1, 5], y: [2, 2, 5], c: [100, 0, 50] });
    const store = selectionStore(toned);
    const selection = rowSelection({ store, channel: "focus" });
    const model = new ChartModel({
      locale: "en-US",
      marks: [point(toned, { x: "x", y: "y", color: "c" })],
      rowSelection: selection,
    });
    model.setSize(300, 200, 1);
    selection.highlight(model);
    store.set("focus", selectRows(new RowSet(toned).add(2)));
    model.scene(estimateText);
    const [px, py] = [model.xScale()!.map(1), model.yScale()!.map(2)];
    expect(model.inspect(px, py, "nearest")!.points[0]!.row).toBe(1);
    const clicked = clickedRows(model, new Set([toned as unknown as Table]), px, py);
    expect(Array.from(clicked!.rows)).toEqual([1]);
  });
});
