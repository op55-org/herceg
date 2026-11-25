// Ties along an axis in proportion to the distance. Every reader along an
// axis (the pointer and `inspect`, shared snapping, the keyboard's Up and
// Down, picking a line's observation) measures on screen from the
// pointer's own pixel, walks outward through every point that may tie, and
// ties two distances only where they differ by at most a ten-thousandth of
// the nearer; of ties the earliest is read. 2D keeps 0.001 px.
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { placeAt, rowOf } from "../../src/marks/series.ts";
import { orderAt } from "../../src/model/keyboard.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { earliest, TIE_RATIO } from "../../src/model/nearest.ts";
import { Picker } from "../../src/model/pick.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { timeBreaks } from "../../src/scale/breaks.ts";
import { LinearScale } from "../../src/scale/scale.ts";
import type { Snap } from "../../src/spec/spec.ts";
import { pickKit } from "../helpers/picker.ts";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function build(config: ChartConfig, width = 1100) {
  // With the compilers of line features (continuity) and coordinates (offsets).
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    staticCompilers(),
  );
  model.setSize(width, 400, 1);
  model.scene(estimateText);
  return model;
}

const frameOf = (model: ChartModel) => model.inspectorOf("")!.frame;

/** The rows read at pixel `px` along x, halfway down the plot. */
function rowsAt(model: ChartModel, px: number, snap?: Snap) {
  const { plot } = frameOf(model);
  const found = model.inspect(px, plot.y + plot.height / 2, undefined, undefined, snap);
  return found?.points.map((p) => p.row);
}

/** The position the keyboard's Up and Down land on in the first series, at pixel `place` along x. */
function keyed(model: ChartModel, place: number, height = 0) {
  const panel = model.panels()[0]!;
  const [visit] = orderAt(model, panel.key, "x", place, height, { placeAt, rowOf, earliest });
  return visit?.position;
}

const picker = new Picker(pickKit);

/** The row picking names at (x, y), where a line is. */
function picked(model: ChartModel, x: number, y: number) {
  const part = picker.pick(model, { x, y, slop: 4 })?.item.part;
  return part?.kind === "row" ? part.position : undefined;
}

describe("A7's near-tie", () => {
  // Chiller's observations 130 ms apart about 11:32 (study A7), with others
  // a minute either side; the cursor 0.48 ms past their midpoint.
  const T = Date.UTC(2026, 9, 1, 11, 32);
  const chiller = table({
    t: time([T - MINUTE, T - 65, T + 65, T + MINUTE]),
    v: [500, 500, 500, 500],
  });
  const views: [string, [number, number]][] = [
    ["30 minutes", [Date.UTC(2026, 9, 1, 11, 30), Date.UTC(2026, 9, 1, 12)]],
    ["1 second", [T - 500, T + 500]],
    ["1 day", [T - 12 * HOUR, T + 12 * HOUR]],
  ];

  it("reads the nearer observation, at the 30-minute, 1-second, and 1-day views", () => {
    for (const [name, domain] of views)
      for (const snap of ["each", "shared"] as const) {
        const model = build({
          marks: [line(chiller, { x: "t", y: "v" })],
          x: { domain, nice: false },
          y: { domain: [0, 1000] },
          inspection: { mode: "nearest-x", snap, within: { milliseconds: 30 * SECOND } },
        });
        const { x, y } = frameOf(model);
        const at = (ms: number) => x.map(T + ms);
        const read = (ms: number) => rowsAt(model, at(ms));
        // The later is nearer by 0.96 ms of 65 ms: read wherever it is drawn.
        expect(read(0.48), `${name} ${snap}`).toEqual([2]);
        expect(read(-0.48), `${name} ${snap}`).toEqual([1]);
        // The midpoint ties: the earlier. A pointer within 1/20,000 of the
        // distance from it (0.00325 ms) still ties; past that, the nearer.
        expect(read(0), `${name} ${snap}`).toEqual([1]);
        expect(read(0.0029), `${name} ${snap}`).toEqual([1]);
        expect(read(0.0035), `${name} ${snap}`).toEqual([2]);
        // The keyboard's Up and Down, and picking the line, alike.
        expect(keyed(model, at(0.48)), name).toBe(2);
        expect(keyed(model, at(0)), name).toBe(1);
        expect(picked(model, at(0.48), y.map(500)), name).toBe(2);
        expect(picked(model, at(0), y.map(500)), name).toBe(1);
      }
  });

  it("is measured from the pointer's own pixel: a view of 1 ms per 100 px", () => {
    // A value of 2026 has 2.4e-4 ms in its last place, 0.024 px here: what
    // a pointer's value mapped back would carry.
    const t = Array.from({ length: 11 }, (_, k) => T + k);
    const model = build(
      {
        marks: [line(table({ t: time(t), v: t.map(() => 500) }), { x: "t", y: "v" })],
        x: { domain: [T, T + 10], nice: false },
        inspection: { mode: "nearest-x", snap: "each" },
      },
      1100,
    );
    const { x } = frameOf(model);
    expect(x.map(T + 1) - x.map(T)).toBeGreaterThan(90);
    const wrong: string[] = [];
    for (let k = 0; k < 10; k++) {
      const mid = x.map(T + k + 0.5);
      // About 50 px from each, ties within 0.0025 px of the midpoint.
      for (const [dx, row] of [
        [0, k],
        [-0.004, k],
        [0.004, k + 1],
      ] as const)
        if (rowsAt(model, mid + dx)?.[0] !== row) wrong.push(`${k} ${dx}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("midpoints", () => {
  // 500 values about 100 apart, each moved by a whole number (study A7's
  // repro): their midpoints in whole units tie.
  const steps = Array.from({ length: 500 }, (_, i) => i * 100 + ((i * 37) % 71) - 35);

  /** Of each pair of neighbors with a midpoint in whole units, those whose midpoint reads the later, by every reader. */
  function later(x: readonly number[], config: Partial<ChartConfig> = {}) {
    const data = table({ x: [...x], v: x.map(() => 500) });
    const wrong: string[] = [];
    let ties = 0;
    for (const snap of ["each", "shared"] as const) {
      const model = build({
        marks: [line(data, { x: "x", y: "v" })],
        y: { domain: [0, 1000] },
        ...config,
        inspection: { mode: "nearest-x", snap },
      });
      const { x: scale, y } = frameOf(model);
      for (let k = 0; k + 1 < x.length; k++) {
        if ((x[k]! + x[k + 1]!) % 2) continue;
        if (snap === "each") ties++;
        const px = scale.map((x[k]! + x[k + 1]!) / 2);
        if (rowsAt(model, px)?.[0] !== k) wrong.push(`${snap} ${k}`);
        if (snap !== "each") continue;
        if (keyed(model, px) !== k) wrong.push(`keyboard ${k}`);
        if (picked(model, px, y.map(500)) !== k) wrong.push(`pick ${k}`);
      }
    }
    return { ties, wrong };
  }

  it("read the earlier on domains far from 0 and on reversed ranges", () => {
    for (const offset of [1e9, 1e12]) {
      const x = steps.map((s) => offset + s);
      const { ties, wrong } = later(x);
      expect(ties).toBeGreaterThan(200);
      expect(wrong).toEqual([]);
      const [lo, hi] = [x[0]!, x.at(-1)!];
      expect(later(x, { x: { domain: [hi, lo], nice: false } }).wrong).toEqual([]);
    }
  });

  it("read the earlier where the pointer's value rounds onto the later ([1e15, 1e15 + 1])", () => {
    // 1e15 has 0.125 in its last place: the midpoint's pixel inverts to the
    // later observation, which a search by value alone finds at both ends.
    const [a, b] = [1e15 + 0.125, 1e15 + 0.25];
    const data = table({ x: [a, b], v: [500, 500] });
    const config = (snap: Snap): ChartConfig => ({
      marks: [line(data, { x: "x", y: "v" })],
      x: { domain: [1e15, 1e15 + 1], nice: false },
      y: { domain: [0, 1000] },
      inspection: { mode: "nearest-x", snap },
    });
    const model = build(config("each"));
    const { x, y } = frameOf(model);
    const mid = (x.map(a) + x.map(b)) / 2;
    expect(x.invert(mid)).toBe(b);
    expect(rowsAt(model, mid)).toEqual([0]);
    expect(rowsAt(build(config("shared")), mid)).toEqual([0]);
    expect(keyed(model, mid)).toBe(0);
    expect(picked(model, mid, y.map(500))).toBe(0);
    // Directional snaps keep their values: at or before, and at or after, the value.
    expect(rowsAt(build(config("previous")), mid, "previous")).toEqual([1]);
    expect(rowsAt(build(config("next")), mid, "next")).toEqual([1]);
  });

  it("tie however the range's ends round them (LinearScale([0, 1], [2000, 0]))", () => {
    // 0.9999979 and 0.999998 stand 1e-4 px either side of their midpoint,
    // which their distances from tell apart by 2.3e-13 px.
    const [a, b] = [0.9999979, 0.999998];
    const scale = new LinearScale([0, 1], [2000, 0]);
    const p = scale.map((a + b) / 2);
    const [da, db] = [a, b].map((v) => Math.abs(scale.map(v) - p)) as [number, number];
    expect(da).not.toBe(db);
    expect(Math.abs(da - db) / Math.min(da, db)).toBeLessThan(TIE_RATIO);
    const read = earliest((take) => {
      take(1, db, b);
      take(0, da, a);
    });
    expect(read).toBe(0);
    // In a chart, on a reversed domain.
    const model = build({
      marks: [line(table({ x: [a, b], v: [500, 500] }), { x: "x", y: "v" })],
      x: { domain: [1, 0], nice: false },
      inspection: { mode: "nearest-x", snap: "each" },
    });
    expect(rowsAt(model, frameOf(model).x.map((a + b) / 2))).toEqual([0]);
  });

  it("tie on a log axis zoomed to [1000, 1000.001], and the nearer is read past the band", () => {
    const [a, b] = [1000.0002, 1000.0006];
    const model = build({
      marks: [line(table({ x: [a, b], v: [500, 500] }), { x: "x", y: "v" })],
      x: { type: "log", domain: [1000, 1000.001], nice: false },
      inspection: { mode: "nearest-x", snap: "each" },
    });
    const { x } = frameOf(model);
    // Midway on screen: 10 to the mean of their logarithms.
    const mid = x.map(10 ** ((Math.log10(a) + Math.log10(b)) / 2));
    const half = (x.map(b) - x.map(a)) / 2;
    expect(rowsAt(model, mid)).toEqual([0]);
    expect(rowsAt(model, mid + half * 2e-5)).toEqual([0]);
    expect(rowsAt(model, mid + half * 1e-3)).toEqual([1]);
    expect(rowsAt(model, mid - half * 1e-3)).toEqual([0]);
  });
});

describe("the walk through the tie band", () => {
  it("finds a tie past the points either side: 0, 0.00005, and 2, by every reader", () => {
    // From 1, 0.00005 is nearer than 0 and 2 by a twenty-thousandth: all
    // three tie, and 0 is read.
    const x = [0, 0.00005, 2];
    const config = (data: ChartConfig["marks"], snap: Snap = "each"): ChartConfig => ({
      marks: data,
      x: { domain: [0, 2], nice: false },
      y: { domain: [0, 1000] },
      inspection: { mode: "nearest-x", snap },
    });
    const sorted = table({ x, v: [500, 500, 500] });
    const model = build(config([line(sorted, { x: "x", y: "v" })]));
    const { x: scale, y } = frameOf(model);
    const at = scale.map(1);
    expect(rowsAt(model, at)).toEqual([0]);
    expect(rowsAt(build(config([line(sorted, { x: "x", y: "v" })], "shared")), at)).toEqual([0]);
    expect(keyed(model, at)).toBe(0);
    expect(picked(model, at, y.map(500))).toBe(0);
    // Unsorted rows, by the scan: 0 is row 2.
    const unsorted = table({ x: [2, 0.00005, 0], v: [500, 500, 500] });
    for (const snap of ["each", "shared"] as const) {
      const scanned = build(config([point(unsorted, { x: "x", y: "v" })], snap));
      expect(rowsAt(scanned, at)).toEqual([2]);
    }
    expect(keyed(build(config([point(unsorted, { x: "x", y: "v" })])), at)).toBe(2);
  });

  it("hands a run of equal values met from its end its first drawn point", () => {
    const data = table({ x: [0, 5, 5, 10], v: [1, 2, 3, 4] });
    for (const snap of ["each", "shared"] as const) {
      const model = build({
        marks: [line(data, { x: "x", y: "v" })],
        inspection: { mode: "nearest-x", snap },
      });
      expect(rowsAt(model, frameOf(model).x.map(6))).toEqual([1]);
    }
  });

  it("reads one row of equal values whose first ones are not drawn, past the walk (Sol's case)", () => {
    // 1,027 rows at 0.5, the first 1,025 not drawn: more than a walk steps over.
    const x = [0, ...Array.from({ length: 1027 }, () => 0.5), 1];
    const v = x.map((_, k) => (k >= 1 && k <= 1025 ? Number.NaN : 500));
    const config = (snap: Snap): ChartConfig => ({
      marks: [line(table({ x, v }), { x: "x", y: "v" })],
      x: { domain: [0, 1], nice: false },
      y: { domain: [0, 1000] },
      inspection: { mode: "nearest-x", snap },
    });
    const model = build(config("each"));
    const { x: scale, y } = frameOf(model);
    // Met from its end, past it, and at its value.
    for (const value of [0.6, 0.5]) {
      const at = scale.map(value);
      expect(rowsAt(model, at), `${value}`).toEqual([1026]);
      expect(rowsAt(build(config("shared")), at), `${value}`).toEqual([1026]);
      expect(keyed(model, at), `${value}`).toBe(1026);
    }
    expect(picked(model, scale.map(0.6), y.map(500))).toBe(1026);
    // Before it, the walk gives up inside the rows not drawn: 0 is read.
    expect(rowsAt(model, scale.map(0.45))).toEqual([0]);
    expect(rowsAt(build(config("shared")), scale.map(0.45))).toEqual([0]);
  });

  it("does not look past more than 1,024 points in a row not drawn (Sol's case)", () => {
    // Drawn -1 and 0.2, 1,025 rows not drawn between 0.001 and 0.1: from 0,
    // 0.2 is nearer, but the walk gives up before it and -1 is read.
    const between = Array.from({ length: 1025 }, (_, k) => 0.001 + (k * 0.099) / 1024);
    const x = [-1, ...between, 0.2];
    const v = x.map((_, k) => (k === 0 || k === x.length - 1 ? 500 : Number.NaN));
    for (const snap of ["each", "shared"] as const) {
      const model = build({
        marks: [line(table({ x, v }), { x: "x", y: "v" })],
        x: { domain: [-1, 1], nice: false },
        inspection: { mode: "nearest-x", snap },
      });
      expect(rowsAt(model, frameOf(model).x.map(0))).toEqual([0]);
    }
  });

  it("is bounded: of a million points within 0.1 px, the earliest of the 1,024 nearest the pointer", () => {
    const n = 1_000_000;
    const x = Float64Array.from({ length: n }, (_, k) => k * 5e-11);
    const model = build({
      marks: [line(table({ x, v: new Float64Array(n).fill(500) }), { x: "x", y: "v" })],
      x: { domain: [0, 1], nice: false },
      inspection: { mode: "nearest-x", snap: "each" },
    });
    const at = frameOf(model).x.map(1);
    expect(rowsAt(model, at)).toEqual([n - 1024]);
    expect(keyed(model, at)).toBe(n - 1024);
  });

  it("walks no more than 1,024 drawn points each way, picking as the other readers (Sol's case)", () => {
    // Points 1e-10 apart near 0, and 2: from 1, all tie, and the walk left
    // reaches the earliest of the 1,024 nearest the pointer.
    for (const [count, row] of [
      [1024, 0],
      [1025, 1],
    ] as const) {
      const x = [...Array.from({ length: count }, (_, k) => k * 1e-10), 2];
      const model = build({
        marks: [line(table({ x, v: x.map(() => 500) }), { x: "x", y: "v" })],
        x: { domain: [0, 2], nice: false },
        y: { domain: [0, 1000] },
        inspection: { mode: "nearest-x", snap: "each" },
      });
      const { x: scale, y } = frameOf(model);
      const at = scale.map(1);
      expect(rowsAt(model, at), `${count}`).toEqual([row]);
      expect(keyed(model, at), `${count}`).toBe(row);
      expect(picked(model, at, y.map(500)), `${count}`).toBe(row);
    }
  });

  it("walks only while points may tie with the nearer of the two around the pointer (Sol's case)", () => {
    // 1,100 points near 0 that tie with one another, and 0.6 under the
    // pointer: none of them is walked.
    const x = [...Array.from({ length: 1100 }, (_, k) => k * 1e-10), 0.6];
    for (const snap of ["each", "shared"] as const) {
      const model = build({
        marks: [line(table({ x, v: x.map(() => 500) }), { x: "x", y: "v" })],
        x: { domain: [0, 1], nice: false },
        inspection: { mode: "nearest-x", snap },
      });
      const inspector = model.inspectorOf("")!;
      const drawn = inspector.drawn.bind(inspector);
      let visits = 0;
      inspector.drawn = (series, row) => {
        visits++;
        return drawn(series, row);
      };
      const at = frameOf(model).x.map(0.6);
      expect(rowsAt(model, at), snap).toEqual([1100]);
      expect(visits, snap).toBeLessThan(8);
      visits = 0;
      expect(keyed(model, at), snap).toBe(1100);
      expect(visits, snap).toBeLessThan(8);
    }
    // With "shared", over every series': B's 0.6 is under the pointer, and
    // none of A's points near 0 is walked.
    const model = build({
      marks: [
        line(table({ x: x.slice(0, -1), v: x.slice(0, -1).map(() => 500) }), {
          x: "x",
          y: "v",
          label: "A",
        }),
        line(table({ x: [0.6], v: [600] }), { x: "x", y: "v", label: "B" }),
      ],
      x: { domain: [0, 1], nice: false },
      inspection: { mode: "nearest-x", snap: "shared" },
    });
    const inspector = model.inspectorOf("")!;
    const drawn = inspector.drawn.bind(inspector);
    let visits = 0;
    inspector.drawn = (series, row) => {
      visits++;
      return drawn(series, row);
    };
    const { x: scale, plot } = frameOf(model);
    const found = model.inspect(scale.map(0.6), plot.y + plot.height / 2);
    expect(found?.axis !== "item" && found?.value).toBe(0.6);
    expect(visits).toBeLessThan(12);
  });

  it("picks walking back only while rows may tie (Sol's case)", () => {
    // 1,100 rows not drawn, then 0.6, 0.8, and 1: on the segment from 0.6,
    // none of the rows before it may tie, so picking checks none of them
    // past the 1,024 the span's own bracket looks at.
    const x = [...Array.from({ length: 1100 }, (_, k) => k * 0.0001), 0.6, 0.8, 1];
    const v = x.map((_, k) => (k < 1100 ? Number.NaN : 500));
    const model = build({
      marks: [line(table({ x, v }), { x: "x", y: "v" })],
      x: { domain: [0, 1], nice: false },
      y: { domain: [0, 1000] },
      inspection: { mode: "nearest-x", snap: "each" },
    });
    let rows = 0;
    const counted = new Picker({
      ...pickKit,
      rowOf: (series, position) => {
        rows++;
        return pickKit.rowOf(series, position);
      },
    });
    const { x: scale, y } = frameOf(model);
    const part = counted.pick(model, { x: scale.map(0.61), y: y.map(500), slop: 4 })?.item.part;
    expect(part?.kind === "row" && part.position).toBe(1100);
    expect(rows).toBeLessThan(1100);
  });

  it("searches by value on a log axis, past 2,048 observations it cannot place", () => {
    const x = [...Array.from({ length: 2048 }, (_, k) => k - 2048), 1, 10, 100];
    const config = (snap: Snap): ChartConfig => ({
      marks: [line(table({ x, v: x.map(() => 500) }), { x: "x", y: "v" })],
      x: { type: "log", domain: [1, 100], nice: false },
      y: { domain: [0, 1000] },
      inspection: { mode: "nearest-x", snap },
    });
    const model = build(config("each"));
    const { x: scale, y } = frameOf(model);
    for (const [value, row] of [
      [1, 2048],
      [Math.sqrt(10), 2048],
      [3.3, 2049],
      [10, 2049],
      [100, 2050],
    ] as const) {
      const at = scale.map(value);
      expect(rowsAt(model, at), `${value}`).toEqual([row]);
      expect(rowsAt(build(config("shared")), at), `${value}`).toEqual([row]);
      expect(keyed(model, at), `${value}`).toBe(row);
      if (value > 1 && value < 100) expect(picked(model, at, y.map(500)), `${value}`).toBe(row);
    }
  });
});

describe("shared snapping", () => {
  // Sol's case: from the pointer, A's -0.009 stands 10.0009 px off and its
  // 200 10 px off, which tie; B's value, drawn 100 px left of its place,
  // 9.9995 px off. Of every series' points, the least is B's, and A's 200
  // ties with it and is earlier: A's 200 is read. Reducing each series to
  // its own winner first hands on A's -0.009, which does not tie with B's.
  function offsetSeries(sorted: boolean) {
    const base: ChartConfig = {
      marks: [],
      x: { domain: [-100, 1000], nice: false },
      y: { domain: [0, 1000] },
      legend: false,
      inspection: { mode: "nearest-x" },
    };
    // The frame, laid out as with the series (fixed domains), to place them by pixels.
    const placeholder = line(table({ x: [0], v: [0] }), { x: "x", y: "v" });
    const { x, plot } = frameOf(build({ ...base, marks: [placeholder] }));
    const pointer = plot.x + 300;
    const [early, late] = [x.invert(pointer - 10.0009), x.invert(pointer + 10)];
    const b = x.invert(pointer + 9.9995 + 100);
    const a = sorted
      ? line(table({ x: [early, late], v: [500, 500] }), { x: "x", y: "v", label: "A" })
      : point(table({ x: [late, early], v: [500, 500] }), { x: "x", y: "v", label: "A" });
    const model = build({
      ...base,
      marks: [
        a,
        line(table({ x: [b], v: [600] }), {
          x: { field: "x", offset: -100 },
          y: "v",
          label: "B",
        }),
      ],
    });
    expect(frameOf(model).plot).toEqual(plot);
    const { plot: p } = frameOf(model);
    return { found: model.inspect(pointer, p.y + p.height / 2), late };
  }

  it("is one search over every series' points: an offset series beside a sorted one", () => {
    const { found, late } = offsetSeries(true);
    expect(found?.axis !== "item" && found?.value).toBe(late);
    expect(found?.points.map((p) => [p.label, p.row])).toEqual([["A", 1]]);
  });

  it("is one search over every series' points: an offset series beside an unsorted one", () => {
    const { found, late } = offsetSeries(false);
    expect(found?.axis !== "item" && found?.value).toBe(late);
    expect(found?.points.map((p) => [p.label, p.row])).toEqual([["A", 0]]);
  });
});

describe("other axes", () => {
  it("read a reversed domain's nearer point, of ties the earlier", () => {
    const x = Array.from({ length: 11 }, (_, k) => k);
    const model = build({
      marks: [line(table({ x, v: x.map(() => 500) }), { x: "x", y: "v" })],
      x: { domain: [10, 0], nice: false },
      inspection: { mode: "nearest-x", snap: "each" },
    });
    const { x: scale } = frameOf(model);
    for (let k = 0; k < 10; k++) {
      expect(rowsAt(model, scale.map(k + 0.5))).toEqual([k]);
      expect(rowsAt(model, scale.map(k + 0.501))).toEqual([k + 1]);
      expect(keyed(model, scale.map(k + 0.501))).toBe(k + 1);
    }
  });

  it("read the nearer across a break, past the band at its seam", () => {
    const data = table({ x: time([5 * SECOND, 95 * SECOND]), v: [500, 500] });
    const model = build({
      marks: [line(data, { x: "x", y: "v" })],
      x: {
        domain: [0, 100 * SECOND],
        nice: false,
        breaks: timeBreaks([{ from: 10 * SECOND, to: 90 * SECOND }]),
      },
      inspection: { mode: "nearest-x", snap: "each" },
    });
    const { x } = frameOf(model);
    const seam = (x.map(5 * SECOND) + x.map(95 * SECOND)) / 2;
    const half = (x.map(95 * SECOND) - x.map(5 * SECOND)) / 2;
    expect(rowsAt(model, seam)).toEqual([0]);
    expect(rowsAt(model, seam + half * 2e-5)).toEqual([0]);
    expect(rowsAt(model, seam + half * 1e-3)).toEqual([1]);
    expect(keyed(model, seam + half * 1e-3)).toBe(1);
  });

  it("tie across a break as every reader reads them, past the rows it hides (Sol's case)", () => {
    // 9.99995 s and 90.00005 s either side of a break from 10 s to 90 s,
    // 2,048 rows inside it: from 100 s, they tie, and the earlier is read.
    const inside = Array.from(
      { length: 2048 },
      (_, k) => 10 * SECOND + ((k + 1) * 80 * SECOND) / 2049,
    );
    const x = [0, 9999.95, ...inside, 90000.05, 200 * SECOND];
    const model = build({
      marks: [line(table({ x: time(x), v: x.map(() => 500) }), { x: "x", y: "v" })],
      x: {
        domain: [0, 200 * SECOND],
        nice: false,
        breaks: timeBreaks([{ from: 10 * SECOND, to: 90 * SECOND }]),
      },
      y: { domain: [0, 1000] },
      inspection: { mode: "nearest-x", snap: "each" },
    });
    const { x: scale, y } = frameOf(model);
    const at = scale.map(100 * SECOND);
    expect(rowsAt(model, at)).toEqual([1]);
    expect(keyed(model, at)).toBe(1);
    expect(picked(model, at, y.map(500))).toBe(1);
  });

  it("read the nearer band's middle, of ties the earlier", () => {
    const data = table({ c: ["a", "b", "c"], v: [1, 2, 3] });
    const model = build({
      marks: [line(data, { x: "c", y: "v" })],
      inspection: { mode: "nearest-x", snap: "each" },
    });
    const { x } = frameOf(model);
    for (const k of [0, 1]) {
      const between = (x.map(k) + x.map(k + 1)) / 2;
      const half = (x.map(k + 1) - x.map(k)) / 2;
      expect(rowsAt(model, between)).toEqual([k]);
      expect(rowsAt(model, between + half * 1e-3)).toEqual([k + 1]);
    }
  });
});

describe("2D", () => {
  it('keeps 0.001 px: in "nearest", a point 0.005 px nearer is read, not the one on top', () => {
    const base: ChartConfig = {
      marks: [],
      x: { domain: [0, 1000], nice: false },
      y: { domain: [0, 1000], nice: false },
      legend: false,
      inspection: { mode: "nearest" },
    };
    const placeholder = point(table({ x: [0], v: [0] }), { x: "x", y: "v" });
    const { x, plot } = frameOf(build({ ...base, marks: [placeholder] }));
    const pointer = plot.x + 400;
    // The nearer after the pointer, the farther before it.
    const near = x.invert(pointer + 100);
    const far = x.invert(pointer - 100.005);
    const model = build({
      ...base,
      marks: [
        point(table({ x: [near], v: [500] }), { x: "x", y: "v", label: "under" }),
        point(table({ x: [far], v: [500] }), { x: "x", y: "v", label: "over" }),
      ],
    });
    const { y } = frameOf(model);
    expect(model.inspect(pointer, y.map(500))?.points.map((p) => p.label)).toEqual(["under"]);
    // Along x, the two distances tie, and the earlier is read.
    expect(model.inspect(pointer, y.map(500), "nearest-x")?.points.map((p) => p.label)).toEqual([
      "over",
    ]);
  });
});
