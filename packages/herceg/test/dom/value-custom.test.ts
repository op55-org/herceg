// Custom marks moving to changed values: what a chart keeps of their
// tables, how items match, and the values their `draw` reads in frames
// between, evaluated at explicit times.

import { afterEach, describe, expect, it, vi } from "vitest";
import { type RowView, rowView } from "../../src/data/row-view.ts";
import { type Schema, type Table, table } from "../../src/data/table.ts";
import { keepCustom, type ShownCustom } from "../../src/dom/value-custom.ts";
import {
  followedOf,
  frameAt,
  MOVING_ITEMS,
  plan,
  positionsOf,
  sidesOf,
  snapshot,
  type Tween,
} from "../../src/dom/value-transition.ts";
import { estimateText } from "../../src/layout/text.ts";
import { Polyline } from "../../src/lod/polyline.ts";
import { bar } from "../../src/marks/bar.ts";
import { monotonePolyline } from "../../src/marks/curve.ts";
import { type CustomDataOptions, custom } from "../../src/marks/custom.ts";
import { point } from "../../src/marks/point.ts";
import { planAxis } from "../../src/model/axis.ts";
import { axisGuide } from "../../src/model/axis-guide.ts";
import { facet } from "../../src/model/facet.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type { Scene, ShapesGeometry } from "../../src/scene/scene.ts";

const clock = vi.hoisted(() => ({ frame: 0 }));
vi.mock("../../src/dom/scheduler.ts", () => ({ lastFrameTime: () => clock.frame }));

afterEach(() => {
  clock.frame = 0;
});

const BUILDERS = { planAxis, axisGuide, Polyline, monotonePolyline, measure: estimateText };

/** A chart model drawn at 600 x 300 that animates values. */
function chart(config: Partial<ChartConfig> & Pick<ChartConfig, "marks">) {
  const model = new ChartModel(
    { locale: "en-US", animation: { values: true, duration: 200 }, ...config },
    undefined,
    staticCompilers(),
  );
  model.setSize(600, 300, 1);
  return model;
}

/** How `model`'s custom marks move to its next scene after `edit`, linearly, from what it kept. */
function change(model: ChartModel, edit: () => void): Tween | undefined {
  const scene = model.scene(estimateText);
  const shown = snapshot(scene, model.panels(), 0);
  if (!shown) return undefined;
  shown.custom = keepCustom(scene, undefined, MOVING_ITEMS);
  edit();
  const tween = plan(
    shown,
    model.scene(estimateText),
    model.panels(),
    200,
    BUILDERS,
    sidesOf(model.config),
    followedOf(model.config),
    positionsOf(model.config),
  );
  if (tween) tween.ease = (t) => t;
  return tween;
}

/** What each `draw` read of its rows, by row: the end, and the stroke width `encode` gives. */
type Read = Map<string, { end: number; width: number | undefined }>;

/** A2's comets: a range from `start` to `end` per forecast, recording what `draw` reads. */
function comets<S extends Schema>(
  data: Table<S> | RowView<S>,
  reads: Read[],
  options: Partial<CustomDataOptions<never>> = {},
) {
  return custom(data as unknown as Table, {
    x: ["start", "end"],
    y: "id",
    itemKey: "id",
    encode: { strokeWidth: { field: "confidence", scale: "widths" } },
    draw({ table: rows, series, x, y, item, path, encoded }) {
      const end = rows.numbers("end");
      const read: Read = new Map();
      reads.push(read);
      for (const s of series)
        for (let k = 0; k < s.length; k++) {
          const row = s.rowAt(k);
          const width = encoded("strokeWidth", row);
          read.set(rows.value("id", row) as string, { end: end[row]!, width });
          item(s, row, () => path(`M${x(s.x[row]!)} ${y(s.y[row]!)}H${x(end[row]!)}`));
        }
    },
    ...(options as object),
  });
}

const SCALES = { widths: { type: "linear", domain: [0, 1], range: [2, 6] } } as const;

const forecasts = () =>
  table({
    id: ["a", "b", "c"],
    start: [0, 10, 20],
    end: [40, 50, 60],
    confidence: [0, 0.5, 1],
    group: ["x", "x", "y"],
  });

const shapes = (scene: Scene) =>
  scene.panels.flatMap((panel) => panel.marks).find((m) => m.kind === "shapes") as ShapesGeometry;

describe("custom marks changing values", () => {
  it("draw again with their declared fields between, encodings through the scales", () => {
    const data = forecasts();
    const reads: Read[] = [];
    const model = chart({ marks: [comets(data, reads)], scales: SCALES, x: { domain: [0, 100] } });
    const tween = change(model, () =>
      data.replace(0, { end: [60, 50, 80], confidence: [1, 0.5, 0] }),
    );
    expect(tween).toBeDefined();
    reads.length = 0;
    frameAt(tween!, 100);
    // Half way: ends and widths between, the unchanged row as it is.
    expect(Object.fromEntries(reads.at(-1)!)).toEqual({
      a: { end: 50, width: 4 },
      b: { end: 50, width: 4 },
      c: { end: 70, width: 4 },
    });
    frameAt(tween!, 50);
    expect(reads.at(-1)!.get("a")).toEqual({ end: 45, width: 3 });
    // The frame's shapes are the draw's, at the values between.
    const frame = shapes(frameAt(tween!, 100));
    const destination = shapes(tween!.scene);
    expect(frame).not.toBe(destination);
    expect(frame.redraw).toBe(destination.redraw);
    const x = model.panels()[0]!.x;
    expect((frame.shapes[0] as { d: string }).d).toMatch(new RegExp(`H${x.map(50)}$`));
    expect((destination.shapes[0] as { d: string }).d).toMatch(new RegExp(`H${x.map(60)}$`));
    // The table stays as written: frames read buffers of their own.
    expect(data.value("end", 0)).toBe(60);
  });

  it("match by item key, showing items that enter, repeat, or change class at once", () => {
    const data = table({
      id: ["a", "b", "c"],
      start: [0, 10, 20],
      end: [40, 50, 60],
      confidence: [0, 0.5, 1],
      group: ["x", "x", "y"],
      lane: [0, 1, 2],
    });
    const reads: Read[] = [];
    // Lanes along a numeric y, which items entering leave as it is.
    const model = chart({
      marks: [comets(data, reads, { series: "group", y: "lane" } as never)],
      scales: SCALES,
      x: { domain: [0, 100] },
      y: { domain: [0, 5] },
    });
    const tween = change(model, () =>
      data.reset({
        // Rows in another order: "c" moves, "d" enters, "b" changes group, two "e" repeat.
        id: ["c", "d", "a", "b", "e", "e"],
        start: [20, 0, 0, 10, 0, 0],
        end: [80, 90, 60, 70, 10, 20],
        confidence: [1, 1, 0, 0.5, 1, 1],
        group: ["y", "y", "x", "y", "x", "x"],
        lane: [2, 3, 0, 1, 4, 4],
      }),
    );
    reads.length = 0;
    frameAt(tween!, 100);
    const ends = Object.fromEntries(
      reads.flatMap((read) => [...read].map(([id, { end }]) => [id, end])),
    );
    expect(ends).toEqual({ a: 50, b: 70, c: 70, d: 90, e: 20 });
  });

  it("match by row identity without a key, so not across a reset", () => {
    const data = forecasts();
    const reads: Read[] = [];
    const model = chart({
      marks: [comets(data, reads, { itemKey: undefined } as never)],
      scales: SCALES,
      x: { domain: [0, 100] },
    });
    const moved = change(model, () => data.replace(1, { end: [70] }));
    reads.length = 0;
    frameAt(moved!, 100);
    expect(reads.at(-1)!.get("b")!.end).toBe(60);
    // A reset makes new rows, which show at once: nothing moves.
    const reset = {
      id: ["a", "b", "c"],
      start: [0, 10, 20],
      end: [41, 51, 61],
      confidence: [0, 0.5, 1],
      group: ["x", "x", "y"],
    };
    expect(change(model, () => data.reset(reset))).toBe(undefined);
  });

  it("show items missing a value at either end at once, and others move", () => {
    const data = forecasts();
    const reads: Read[] = [];
    const model = chart({ marks: [comets(data, reads)], scales: SCALES, x: { domain: [0, 100] } });
    const tween = change(model, () => data.replace(0, { end: [Number.NaN, 70, 70] }));
    reads.length = 0;
    frameAt(tween!, 100);
    const read = reads.at(-1)!;
    expect(read.get("a")?.end ?? Number.NaN).toBeNaN();
    expect(read.get("b")!.end).toBe(60);
    expect(read.get("c")!.end).toBe(65);
  });

  it("show rows a mark drew none of before at once, its series empty then", () => {
    const data = forecasts();
    const ends: Map<string, number>[] = [];
    // Of a view filtering out every row at first, the mark draws a backdrop only.
    const view = rowView(data, { filter: [">", ["field", "end"], 65] });
    const mark = custom(view as unknown as Table, {
      x: ["start", "end"],
      y: "confidence",
      series: "group",
      itemKey: "id",
      draw({ table: rows, series, x, y, path, rect }) {
        rect(0, 0, 4, 4);
        const end = rows.numbers("end");
        const read = new Map<string, number>();
        ends.push(read);
        for (const s of series)
          for (let k = 0; k < s.length; k++) {
            const row = s.rowAt(k);
            read.set(rows.value("id", row) as string, end[row]!);
            path(`M${x(s.x[row]!)} ${y(s.y[row]!)}H${x(end[row]!)}`);
          }
      },
    });
    // Points of every row keep the axes, and move; without a legend, which
    // the series coming would bring, the plot stays.
    const model = chart({
      marks: [mark, point(data, { x: "end", y: "confidence" })],
      legend: false,
      x: { domain: [0, 100] },
      y: { domain: [0, 1] },
    });
    const tween = change(model, () => data.replace(0, { end: [80, 70] }));
    ends.length = 0;
    frameAt(tween!, 100);
    expect(Object.fromEntries(ends.at(-1)!)).toEqual({ a: 80, b: 70 });
  });

  it("keep one copy of a table for every view and panel of it", () => {
    const data = forecasts();
    const reads: Read[] = [];
    const views = [rowView(data, { filter: true }), rowView(data, { sort: [{ field: "end" }] })];
    const model = chart({
      marks: views.map((view, i) => comets(view as never, reads, { id: `view${i}` } as never)),
      scales: SCALES,
      x: { domain: [0, 100] },
    });
    const kept = keepCustom(model.scene(estimateText), undefined, MOVING_ITEMS)!;
    // end, start, confidence as numbers; id as the key; one copy for both marks.
    expect(new Set(kept.columns.values()).size).toBe(1);
    expect(kept.bytes).toBe(3 * 3 * 8 + 3 * 4);
    // Facets split the mark's rows: one copy still, each panel's rows drawn.
    const faceted = chart({
      marks: [comets(data, reads)],
      scales: SCALES,
      facet: facet("group"),
      x: { domain: [0, 100] },
    });
    const split = keepCustom(faceted.scene(estimateText), undefined, MOVING_ITEMS)!;
    expect(new Set(split.columns.values()).size).toBe(1);
    const panels = [...split.drawn.values()][0]!;
    expect([...panels.values()].map((rows) => [...rows!])).toEqual([
      [1, 1, 0],
      [0, 0, 1],
    ]);
    // Frames draw each panel's rows at the values between.
    const tween = change(faceted, () => data.replace(0, { end: [60, 70, 80] }));
    reads.length = 0;
    frameAt(tween!, 100);
    expect(
      reads.map((read) => Object.fromEntries([...read].map(([id, r]) => [id, r.end]))),
    ).toEqual([{ a: 50, b: 60 }, { c: 70 }]);
  });

  it("keep each table's own copy, however alike two tables are", () => {
    const reads: Read[] = [];
    const [near, far] = [40, 400].map((end) =>
      table({ id: ["a"], start: [0], end: [end], confidence: [0] }),
    );
    const model = chart({
      marks: [
        comets(near!, reads, { id: "near" } as never),
        comets(far!, reads, { id: "far" } as never),
      ],
      scales: SCALES,
      x: { domain: [0, 500] },
    });
    // Both tables at one version and generation, with the same fields.
    expect(near!.version).toBe(far!.version);
    const first = keepCustom(model.scene(estimateText), undefined, MOVING_ITEMS)!;
    const again = keepCustom(model.scene(estimateText), first, MOVING_ITEMS)!;
    expect([...again.columns.values()].map((c) => Array.from(c.numbers.get("end")!))).toEqual([
      [40],
      [400],
    ]);
  });

  it("keep nothing past the chart's budget of moving items, and show changes at once", () => {
    const rows = (length: number) =>
      table({
        id: Array.from({ length }, (_, i) => `r${i}`),
        start: new Float64Array(length),
        end: Float64Array.from({ length }, (_, i) => i),
        confidence: new Float64Array(length),
      });
    const reads: Read[] = [];
    // Three marks of 700 rows each: 2,100 rows to draw in every frame.
    const tables = [rows(700), rows(700), rows(700)];
    const model = chart({
      marks: tables.map((data, i) => comets(data, reads, { id: `m${i}` } as never)),
      scales: SCALES,
    });
    expect(keepCustom(model.scene(estimateText), undefined, MOVING_ITEMS)).toBeDefined();
    expect(snapshot(model.scene(estimateText), model.panels(), 0)).toBeUndefined();
    // Two fit.
    const two = chart({
      marks: tables.slice(0, 2).map((data, i) => comets(data, reads, { id: `m${i}` } as never)),
      scales: SCALES,
    });
    expect(change(two, () => tables[0]!.replace(0, { end: [5] }))).toBeDefined();
    // A table longer than the budget is not kept, though a view of it draws a few rows.
    const long = rows(MOVING_ITEMS + 1);
    const few = chart({
      marks: [comets(rowView(long, { filter: [">=", ["field", "end"], 1990] }) as never, reads)],
      scales: SCALES,
    });
    expect(keepCustom(few.scene(estimateText), undefined, MOVING_ITEMS)!.columns.size).toBe(0);
    // Nor does a table that grew past it since it was kept move: its change shows at once.
    const growing = rows(1);
    const one = chart({
      marks: [comets(rowView(growing, { filter: ["==", ["field", "id"], "r0"] }) as never, reads)],
      scales: SCALES,
      x: { domain: [0, 10] },
    });
    const grown = rows(MOVING_ITEMS + 1);
    expect(
      change(one, () =>
        growing.reset({
          id: grown.categories("id").dictionary,
          start: grown.numbers("start"),
          end: new Float64Array(MOVING_ITEMS + 1).fill(5),
          confidence: grown.numbers("confidence"),
        }),
      ),
    ).toBeUndefined();
  });

  it("keep what a scene drew in a transaction, not a copy from before its writes", () => {
    const data = forecasts();
    const reads: Read[] = [];
    const model = chart({ marks: [comets(data, reads)], scales: SCALES, x: { domain: [0, 100] } });
    const before = keepCustom(model.scene(estimateText), undefined, MOVING_ITEMS)!;
    data.transaction(() => {
      data.replace(0, { end: [45] });
      // The version stays until the transaction ends; the scene draws the new value.
      const kept = keepCustom(model.scene(estimateText), before, MOVING_ITEMS)!;
      expect(Array.from([...kept.columns.values()][0]!.numbers.get("end")!)).toEqual([45, 50, 60]);
    });
    // Rows dropped or added in one leave the version too, and rows' places
    // change: a view drawing "b" draws it at another row.
    const rows = forecasts();
    const only = chart({
      marks: [comets(rowView(rows, { filter: ["==", ["field", "id"], "b"] }) as never, reads)],
      scales: SCALES,
      x: { domain: [0, 100] },
    });
    const after = keepCustom(only.scene(estimateText), undefined, MOVING_ITEMS)!;
    const ends = (kept: ShownCustom) =>
      Array.from([...kept.columns.values()][0]!.numbers.get("end")!);
    rows.transaction(() => {
      rows.dropFirst(1);
      const kept = keepCustom(only.scene(estimateText), after, MOVING_ITEMS)!;
      expect(ends(kept)).toEqual([50, 60]);
      expect([...[...kept.drawn.values()][0]!.values()].map((drawn) => [...drawn!])).toEqual([
        [1, 0],
      ]);
      rows.append({ id: ["d"], start: [30], end: [70], confidence: [0], group: ["y"] });
      expect(ends(keepCustom(only.scene(estimateText), kept, MOVING_ITEMS)!)).toEqual([50, 60, 70]);
    });
  });

  it("show items whose category an encoding reads changed at once, as points do", () => {
    const data = table({ id: ["a", "b"], start: [0, 0], end: [40, 50], kind: ["old", "old"] });
    const reads: Read[] = [];
    const model = chart({
      marks: [comets(data, reads, { encode: { color: { field: "kind" } } } as never)],
      x: { domain: [0, 100] },
    });
    const tween = change(model, () => data.replace(0, { end: [80, 90], kind: ["new", "old"] }));
    reads.length = 0;
    frameAt(tween!, 100);
    expect(reads.at(-1)!.get("a")!.end).toBe(80);
    expect(reads.at(-1)!.get("b")!.end).toBe(70);
  });

  it("count custom marks' rows with bars coming and going toward one budget, in either order", () => {
    // 800 keyed bars all replaced: 1,600 to draw, coming and going.
    const keys = (prefix: string) => Array.from({ length: 800 }, (_, i) => `${prefix}${i}`);
    const positions = Float64Array.from({ length: 800 }, (_, i) => i);
    const bars = table({ k: keys("a"), x: positions, v: new Float64Array(800).fill(1) });
    const lanes = table({
      id: Array.from({ length: 600 }, (_, i) => `r${i}`),
      start: new Float64Array(600),
      end: new Float64Array(600).fill(10),
      confidence: new Float64Array(600),
      lane: new Float64Array(600).fill(1),
    });
    const reads: Read[] = [];
    const marks = [
      bar(bars, { x: "x", y: "v", itemKey: "k" }),
      comets(lanes, reads, { y: "lane" } as never),
    ];
    for (const order of [marks, [...marks].reverse()]) {
      bars.reset({ k: keys("a"), x: positions, v: new Float64Array(800).fill(1) });
      const model = chart({ marks: order, scales: SCALES, x: { domain: [0, 800] } });
      const tween = change(model, () => {
        bars.reset({ k: keys("b"), x: positions, v: new Float64Array(800).fill(1) });
        lanes.setColumn("end", new Float64Array(600).fill(20));
      });
      expect(tween).toBeUndefined();
    }
  });

  it("move fields along log axes evenly in log space", () => {
    const data = table({ id: ["a"], start: [1], end: [10] });
    const reads: Read[] = [];
    const model = chart({
      marks: [comets(data, reads, { encode: undefined } as never)],
      x: { type: "log", domain: [1, 10_000] },
    });
    const tween = change(model, () => data.replace(0, { end: [1000] }));
    reads.length = 0;
    frameAt(tween!, 100);
    expect(reads.at(-1)!.get("a")!.end).toBeCloseTo(100, 9);
    // A condition reading the field does not keep it from log space.
    const tested = chart({
      marks: [
        comets(data, reads, {
          encode: {
            opacity: {
              // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
              condition: { when: [">", ["field", "end"], 0], then: 1, otherwise: 0.5 },
            },
          },
        } as never),
      ],
      x: { type: "log", domain: [1, 10_000] },
    });
    const conditioned = change(tested, () => data.replace(0, { end: [10] }));
    reads.length = 0;
    frameAt(conditioned!, 100);
    expect(reads.at(-1)!.get("a")!.end).toBeCloseTo(100, 9);
  });

  it("keep values that do not change as they are, however small or large", () => {
    for (const [value, type] of [
      [Number.MIN_VALUE, "linear"],
      [Number.MAX_VALUE, "log"],
    ] as const) {
      const data = table({ id: ["a"], at: [10], v: [value] });
      const seen: number[] = [];
      const mark = custom(data, {
        x: "at",
        y: "v",
        itemKey: "id",
        draw({ table: rows, series, x, y, path }) {
          seen.push(rows.numbers("v")[0]!);
          for (const s of series) path(`M${x(s.x[0]!)} ${y(s.y[0]!)}h1`);
        },
      });
      const model = chart({
        marks: [mark],
        x: { domain: [0, 100] },
        y: { type, domain: type === "log" ? [1, Number.MAX_VALUE] : [0, 1] },
      });
      // Only the other field changes.
      const tween = change(model, () => data.replace(0, { at: [90] }));
      seen.length = 0;
      frameAt(tween!, 100);
      expect(seen, type).toEqual([value]);
    }
  });

  it("move between the largest finite values without overflowing", () => {
    const data = table({ id: ["a"], start: [0], v: [-1e308] });
    const seen: number[] = [];
    const mark = custom(data, {
      x: "start",
      y: "id",
      itemKey: "id",
      // Declared through an encoding; draw reads it as it is.
      encode: { strokeWidth: { field: "v", scale: { type: "identity" } } },
      draw({ table: rows, series, x, y, path }) {
        seen.push(rows.numbers("v")[0]!);
        for (const s of series) path(`M${x(s.x[0]!)} ${y(s.y[0]!)}h1`);
      },
    });
    const model = chart({ marks: [mark], x: { domain: [0, 1] } });
    const tween = change(model, () => data.replace(0, { v: [1e308] }));
    for (const [elapsed, v] of [
      [0, -1e308],
      [100, 0],
    ] as const) {
      seen.length = 0;
      frameAt(tween!, elapsed);
      expect(seen).toEqual([v]);
    }
  });

  it("move evenly in log space only where every panel drawing the mark is logarithmic", () => {
    const data = table({ id: ["a"], at: [1], v: [1] });
    const vs: number[] = [];
    const mark = custom(data, {
      x: "at",
      y: "v",
      itemKey: "id",
      panel: "*",
      draw({ table: rows, series, x, y, circle }) {
        vs.push(rows.numbers("v")[0]!);
        for (const s of series) circle(x(s.x[0]!), y(s.y[0]!), 2);
      },
    });
    const model = chart({
      marks: [mark],
      x: { domain: [0, 2] },
      panels: panels([
        { id: "log", y: { type: "log", domain: [1, 1000] } },
        { id: "linear", y: { domain: [0, 1000] } },
      ]),
    });
    const tween = change(model, () => data.replace(0, { v: [100] }));
    vs.length = 0;
    frameAt(tween!, 100);
    expect(vs).toEqual([50.5, 50.5]);
  });

  it("draw marks without a table again on the frame's scales", () => {
    const points = table({ x: [0, 1, 2], y: [0, 5, 10] });
    const ys: number[] = [];
    const model = chart({
      marks: [
        point(points, { x: "x", y: "y" }),
        custom({
          draw({ y, plot, circle }) {
            ys.push(y(10));
            circle(plot.x, y(10), 3);
          },
        }),
      ],
    });
    model.scene(estimateText);
    const before = model.panels()[0]!.y.map(10);
    const tween = change(model, () => points.setColumn("y", [0, 10, 20]));
    const after = model.panels()[0]!.y.map(10);
    expect(after).not.toBe(before);
    ys.length = 0;
    frameAt(tween!, 100);
    // Between where 10 was and where it is: the y axis moves under it.
    expect(ys.at(-1)!).toBeGreaterThan(Math.min(before, after));
    expect(ys.at(-1)!).toBeLessThan(Math.max(before, after));
  });
});
