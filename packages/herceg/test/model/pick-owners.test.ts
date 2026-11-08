// Marks picked by what they draw (candlesticks, box plots, boxen:
// `Mark.pickDrawn`) name each shape's own item, however densely they are
// drawn: a pick names an item only where a shape of that item lies at the
// distance it reports. Each test probes every shape, on it and 0.4 px to
// either side; whose shape it is follows from the drawing order of items
// drawn alike (every candle rising, every group of the same values).
import { describe, expect, it } from "vitest";
import { RowSet } from "../../src/data/row-set.ts";
import { selectionStore, selectRows } from "../../src/data/selection.ts";
import { type Schema, type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { boxen } from "../../src/marks/boxen.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { candlestick } from "../../src/marks/candlestick.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { type Picked, Picker } from "../../src/model/pick.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import type {
  AreaGeometry,
  Geometry,
  PointGeometry,
  RectGeometry,
  SegmentGeometry,
} from "../../src/scene/scene.ts";
import { channelHighlighter } from "../helpers/highlight.ts";
import { pickKit } from "../helpers/picker.ts";
import { xScale, yScale } from "../helpers/scales.ts";

const picker = new Picker(pickKit);
/** About as wide as the plot of a 600 px chart. */
const PLOT = 540;

function build(config: ChartConfig) {
  const model = new ChartModel({ locale: "en-US", timeZone: "UTC", legend: false, ...config });
  model.setSize(600, 300, 1);
  model.scene(estimateText);
  return model;
}

/** A shape drawn: whose it is, how far a point is from it as picking measures, and where to probe it. */
interface Shape {
  owner: number;
  distance: (x: number, y: number) => number;
  probes: (readonly [number, number])[];
}

/** How far (x, y) is from segment i of `coords`, past half its stroke. */
function toSegment(x: number, y: number, coords: Float32Array, i: number, half: number) {
  const [x1, y1, x2, y2] = [
    coords[i * 4]!,
    coords[i * 4 + 1]!,
    coords[i * 4 + 2]!,
    coords[i * 4 + 3]!,
  ];
  const [dx, dy] = [x2 - x1, y2 - y1];
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.max(0, Math.hypot(x - x1 - t * dx, y - y1 - t * dy) - half);
}

/** Whether (x, y) is inside the polygon of `points`, by crossings. */
function insidePolygon(x: number, y: number, points: readonly (readonly [number, number])[]) {
  let inside = false;
  for (let a = 0, z = points.length - 1; a < points.length; z = a++) {
    const [[xa, ya], [xz, yz]] = [points[a]!, points[z]!];
    if (ya > y !== yz > y && x < ((xz - xa) * (y - ya)) / (yz - ya) + xa) inside = !inside;
  }
  return inside;
}

/**
 * The shapes of a chart's first mark, each owned as `ownerOf` says (by its
 * geometry and index); a notched area's runs are its boxes, in order.
 */
function shapesOf(model: ChartModel, ownerOf: (geometry: Geometry, i: number) => number): Shape[] {
  const out: Shape[] = [];
  for (const g of model.drawnMarks()[0]!.geometry) {
    if (g.kind === "segments") {
      const { coords, count, strokeWidth } = g as SegmentGeometry;
      for (let i = 0; i < count; i++) {
        const [mx, my] = [
          (coords[i * 4]! + coords[i * 4 + 2]!) / 2,
          (coords[i * 4 + 1]! + coords[i * 4 + 3]!) / 2,
        ];
        const upright =
          Math.abs(coords[i * 4]! - coords[i * 4 + 2]!) <
          Math.abs(coords[i * 4 + 1]! - coords[i * 4 + 3]!);
        const [dx, dy] = upright ? [0.4, 0] : [0, 0.4];
        out.push({
          owner: ownerOf(g, i),
          distance: (x, y) => toSegment(x, y, coords, i, strokeWidth / 2),
          probes: [
            [mx, my],
            [mx - dx, my - dy],
            [mx + dx, my + dy],
          ],
        });
      }
    } else if (g.kind === "rect") {
      const { rects, count } = g as RectGeometry;
      for (let i = 0; i < count; i++) {
        const [rx, ry, rw, rh] = [
          rects[i * 4]!,
          rects[i * 4 + 1]!,
          rects[i * 4 + 2]!,
          rects[i * 4 + 3]!,
        ];
        const held = (x: number, y: number) =>
          x >= rx - 1e-3 && x <= rx + rw + 1e-3 && y >= ry - 1e-3 && y <= ry + rh + 1e-3;
        out.push({
          owner: ownerOf(g, i),
          distance: (x, y) => (held(x, y) ? 0 : Number.POSITIVE_INFINITY),
          probes: [
            [rx + rw / 2, ry + rh / 2],
            [rx + rw * 0.2, ry + rh / 3],
            [rx + rw * 0.8, ry + (2 * rh) / 3],
          ],
        });
      }
    } else if (g.kind === "point") {
      const { coords, count, radius } = g as PointGeometry;
      for (let i = 0; i < count; i++) {
        const [cx, cy] = [coords[i * 2]!, coords[i * 2 + 1]!];
        out.push({
          owner: ownerOf(g, i),
          distance: (x, y) => Math.max(0, Math.hypot(x - cx, y - cy) - radius),
          probes: [
            [cx, cy],
            [cx - radius * 0.8, cy],
            [cx + radius * 0.8, cy],
          ],
        });
      }
    } else if (g.kind === "area") {
      const { upper, lower } = g as AreaGeometry;
      const [u, l] = [upper.coords, lower!.coords];
      const at = (c: ArrayLike<number>, i: number) => [c[i * 2]!, c[i * 2 + 1]!] as const;
      for (let b = 0; b < upper.starts.length; b++) {
        const run = Array.from({ length: 5 }, (_, j) => upper.starts[b]! + j);
        const outline = [...run.map((i) => at(u, i)), ...run.reverse().map((i) => at(l, i))];
        // Beside the middle of the box's lower half, on either side.
        const [[ux, uy], [lx]] = [at(u, upper.starts[b]! + 1), at(l, upper.starts[b]! + 1)];
        const [mx, half] = [(ux + lx) / 2, Math.abs(ux - lx) / 2];
        out.push({
          owner: ownerOf(g, upper.starts[b]!),
          distance: (x, y) => (insidePolygon(x, y, outline) ? 0 : Number.POSITIVE_INFINITY),
          probes: [
            [mx - half * 0.7, uy],
            [mx + half * 0.7, uy],
          ],
        });
      }
    }
  }
  return out;
}

/**
 * Probes every shape; returns how many probes there were and how many
 * picks named an item with no shape at the distance reported.
 */
function probe(model: ChartModel, shapes: Shape[], nameOf: (picked: Picked) => number | undefined) {
  let probes = 0;
  let unowned = 0;
  for (const shape of shapes)
    for (const [x, y] of shape.probes) {
      probes++;
      const picked = picker.pick(model, { x, y, slop: 4 });
      if (!picked) continue;
      const named = nameOf(picked);
      const owns = shapes.some(
        (s) => s.owner === named && Math.abs(s.distance(x, y) - picked.item.distance) <= 1e-3,
      );
      if (!owns) unowned++;
    }
  return { probes, unowned };
}

/** Of items drawn alike, `n` of them: shape i of a geometry drawing `count` is item i * n / count's. */
const alike = (n: number) => (geometry: Geometry, i: number) =>
  Math.floor(
    (i * n) / ((geometry as { count?: number }).count ?? (geometry as AreaGeometry).upper.count),
  );

/** Rising candles at t = 0, 1, ..., n - 1, from 3 to 7 between 1 and 9. */
function risingCandles(n: number, options?: { maxRows?: number }) {
  return table(
    {
      t: Float64Array.from({ length: n }, (_, i) => i),
      o: new Float64Array(n).fill(3),
      c: new Float64Array(n).fill(7),
      h: new Float64Array(n).fill(9),
      l: new Float64Array(n).fill(1),
    },
    options,
  );
}
const candles = (prices: ReturnType<typeof risingCandles>) =>
  candlestick(prices, { x: "t", open: "o", high: "h", low: "l", close: "c" });
/** A row's table row, as a candle's item names it. */
const rowOfPicked = (picked: Picked) =>
  picked.item.part.kind === "row" ? picked.item.part.position : undefined;
/** The group a box plot's or boxen's item names, by its number ("g042": 42). */
const groupOfPicked = (picked: Picked) => {
  const name = picked.item.names?.[0];
  return typeof name === "string" ? Number(name.slice(1)) : undefined;
};
/** Groups g000, g001, ... of `values` each. */
function groups(n: number, values: readonly number[]) {
  const names = Array.from({ length: n }, (_, i) => `g${String(i).padStart(3, "0")}`);
  return table({
    g: names.flatMap((g) => values.map(() => g)),
    v: names.flatMap(() => [...values]),
  });
}

/** A chart of `config` highlighting the rows of `source` that `rows` selects, as a chart bound to a store draws them. */
function selecting<S extends Schema>(source: Table<S>, rows: number[], config: ChartConfig) {
  const store = selectionStore(source);
  const selection = rowSelection({ store, channel: "focus" });
  const model = new ChartModel({
    locale: "en-US",
    timeZone: "UTC",
    legend: false,
    rowSelection: selection,
    ...config,
  });
  model.setSize(600, 300, 1);
  selection.highlight(model);
  store.set("focus", selectRows(new RowSet(source).addAll(rows)));
  model.scene(estimateText);
  return model;
}

describe("dense shapes", () => {
  it("name their own candles at 1.5 and 2.2 px a candle", () => {
    for (const slot of [1.5, 2.2]) {
      const n = Math.round(PLOT / slot);
      const model = build({
        marks: [candles(risingCandles(n))],
        x: { domain: [-0.5, n - 0.5], nice: false },
        y: { domain: [0, 10], nice: false },
      });
      const { probes, unowned } = probe(model, shapesOf(model, alike(n)), rowOfPicked);
      expect(probes, `${slot} px`).toBeGreaterThan(n * 18 - 10);
      expect(unowned, `${slot} px`).toBe(0);
    }
  });

  it("name their own box plot groups: notched at 2 and 2.8 px, plain at 1.5 px", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 30];
    for (const [notch, slot] of [
      [true, 2],
      [true, 2.8],
      [false, 1.5],
    ] as const) {
      const n = Math.round(PLOT / slot);
      const model = build({
        marks: [boxplot(groups(n, values), { x: "g", y: "v", notch })],
        y: { domain: [0, 40], nice: false },
      });
      const { probes, unowned } = probe(model, shapesOf(model, alike(n)), groupOfPicked);
      expect(probes, `${slot} px`).toBeGreaterThan(n * 20);
      expect(unowned, `${notch ? "notched" : "plain"}, ${slot} px`).toBe(0);
    }
  });

  it("name their own boxen groups at 2 px", () => {
    const n = Math.round(PLOT / 2);
    const values = [...Array.from({ length: 24 }, (_, i) => 1 + i), 80];
    const model = build({
      marks: [boxen(groups(n, values), { x: "g", y: "v" })],
      y: { domain: [0, 90], nice: false },
    });
    const { probes, unowned } = probe(model, shapesOf(model, alike(n)), groupOfPicked);
    expect(probes).toBeGreaterThan(n * 20);
    expect(unowned).toBe(0);
  });

  it("name a selected candle among dense ones, drawn over them", () => {
    const n = Math.round(PLOT / 2.2);
    const prices = risingCandles(n);
    const store = selectionStore(prices);
    // The helper takes tables of any schema.
    const highlighter = channelHighlighter([
      { table: prices as never, store: store as never, channel: "focus" },
    ]);
    const model = new ChartModel({
      locale: "en-US",
      timeZone: "UTC",
      legend: false,
      marks: [candles(prices)],
      x: { domain: [-0.5, n - 0.5], nice: false },
      y: { domain: [0, 10], nice: false },
    });
    model.setSize(600, 300, 1);
    model.highlight = (mark, series, frame, key) =>
      highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
    const selected = 100;
    store.set("focus", selectRows(new RowSet(prices).add(selected)));
    model.scene(estimateText);
    // The selected candle's shapes are its own; the others', in order, skip it.
    const shapes = shapesOf(model, (geometry, i) => {
      if (geometry.key.includes("\u0001on")) return selected;
      const k = Math.floor(i / 6);
      return k < selected ? k : k + 1;
    });
    const { unowned } = probe(model, shapes, rowOfPicked);
    expect(unowned).toBe(0);
    // On each of its shapes' middles, the selected candle.
    for (const shape of shapes.filter(({ owner }) => owner === selected)) {
      const [x, y] = shape.probes[0]!;
      expect(rowOfPicked(picker.pick(model, { x, y, slop: 4 })!)).toBe(selected);
    }
  });

  it("stay their own candles' as a window rolls: after appends and a drop", () => {
    const n = Math.round(PLOT / 2.2);
    const prices = risingCandles(n, { maxRows: n });
    const model = build({ marks: [candles(prices)], y: { domain: [0, 10], nice: false } });
    // Forty candles arrive, pushing forty out; then ten more leave.
    prices.append({
      t: Float64Array.from({ length: 40 }, (_, i) => n + i),
      o: new Float64Array(40).fill(3),
      c: new Float64Array(40).fill(7),
      h: new Float64Array(40).fill(9),
      l: new Float64Array(40).fill(1),
    });
    prices.dropFirst(10);
    model.scene(estimateText);
    // Shapes in time order, from the first time held; picks named by their time.
    const first = prices.numbers("t")[0]!;
    const held = prices.length;
    const shapes = shapesOf(model, (geometry, i) => first + alike(held)(geometry, i));
    const times = prices.numbers("t");
    const { probes, unowned } = probe(model, shapes, (picked) => {
      const row = rowOfPicked(picked);
      return row === undefined ? undefined : times[row];
    });
    expect(first).toBe(50);
    expect(probes).toBeGreaterThan(held * 18 - 10);
    expect(unowned).toBe(0);
  });
  it("name a notched box dimmed under a selection, upright or lying", () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    const samples = table({
      g: [...values.map(() => "a"), ...values.map(() => "b")],
      v: [...values, ...values],
    });
    for (const lying of [false, true]) {
      // One of a's rows selected: b is drawn whole, dimmed.
      const model = selecting(samples, [0], {
        marks: [
          boxplot(
            samples,
            lying ? { x: "v", y: "g", notch: true } : { x: "g", y: "v", notch: true },
          ),
        ],
      });
      const [along, across] = lying
        ? [yScale(model)!, xScale(model)!]
        : [xScale(model)!, yScale(model)!];
      const [center, at] = [along.map(1)!, across.map(7)!];
      const [x, y] = lying ? [at, center + 4] : [center + 4, at];
      const picked = picker.pick(model, { x, y, slop: 4 });
      expect(picked?.item.names, lying ? "lying" : "upright").toEqual(["b"]);
    }
  });

  it("bound a merged candle column by the column's candle, its first row selected", () => {
    // 2,000 candles in 600 px, merged a pixel column at a time; every fourth
    // reaches 90, the rest 9. The view shows 50 to 100: only those reaching 90.
    const n = 2000;
    const prices = table({
      t: Float64Array.from({ length: n }, (_, i) => i),
      o: new Float64Array(n).fill(3),
      c: new Float64Array(n).fill(7),
      h: Float64Array.from({ length: n }, (_, i) => (i % 4 === 2 ? 90 : 9)),
      l: new Float64Array(n).fill(1),
    });
    const config: ChartConfig = {
      marks: [candles(prices as ReturnType<typeof risingCandles>)],
      x: { domain: [0, n - 1], nice: false },
      y: { domain: [50, 100], nice: false },
    };
    const plain = build(config);
    const plot = plain.scene(estimateText).panels[0]!.plot;
    const x = xScale(plain)!;
    const columnOf = (row: number) => Math.floor(x.map(row)! - plot.x);
    // A column's first row, which reaches only 9.
    let first = 1000;
    while (columnOf(first) === columnOf(first - 1) || first % 4 === 2) first++;
    const model = selecting(prices, [first], config);
    const center = plot.x + columnOf(first) + 0.5;
    const picked = picker.pick(model, { x: center, y: yScale(model)!.map(60)!, slop: 4 });
    expect(picked).toBeDefined();
    const box = picked!.item.box;
    expect(box.y).toBeLessThanOrEqual(yScale(model)!.map(60)!);
    expect(box.y + box.height).toBeGreaterThanOrEqual(yScale(model)!.map(60)!);
  });
});
