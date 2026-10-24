// Style runs (marks/features/runs.ts, run-paths.ts): a line's or area's
// looks changing along a series, where channels read rows. A piece of line
// takes the look of the observation it arrives at, a step's flat run the
// look of the observation whose value it holds; each run draws its own
// stretch of the path, cut where another meets it, so the series stays one
// series and every part of its stroke is painted once.
import { describe, expect, it } from "vitest";
import { encodedCategory } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { selectionStore, selectRows } from "../../src/data/selection.ts";
import { type Table, table } from "../../src/data/table.ts";
import { lineDrawing } from "../../src/draw/line.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { outputCheck, rowReader } from "../../src/marks/features/channels.ts";
import { StyleRuns } from "../../src/marks/features/runs.ts";
import { translucent } from "../../src/marks/features/series-styles.ts";
import { line } from "../../src/marks/line.ts";
import type { Series } from "../../src/marks/series.ts";
import { facet } from "../../src/model/facet.ts";
import { Highlighter } from "../../src/model/highlight.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderSvg } from "../../src/render/svg.ts";
import type {
  AreaGeometry,
  Drawing,
  Geometry,
  LineGeometry,
  PointGeometry,
  Scene,
} from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";

function model(config: ChartConfig) {
  const made = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    ...staticCompilers(),
  );
  made.setSize(600, 300, 1);
  return made;
}

type Point = [number, number];

const linesOf = (scene: Scene) =>
  scene.panels[0]!.marks.filter((m): m is LineGeometry => m.kind === "line");

const areasOf = (scene: Scene) =>
  scene.panels[0]!.marks.filter((m): m is AreaGeometry => m.kind === "area");

/** A line's or area outline's points. */
const pointsOf = (g: LineGeometry | AreaGeometry): Point[] => {
  const path = g.kind === "line" ? g.path : g.upper;
  return Array.from({ length: path.count }, (_, i) => [
    path.coords[i * 2]!,
    path.coords[i * 2 + 1]!,
  ]);
};

/** A piece's points without what it reaches past a boundary: those within its holes. */
const ownPoints = (g: LineGeometry | AreaGeometry): Point[] =>
  pointsOf(g).filter((p) => !(g.draw.holes ?? []).some((hole) => inside(hole, p)));

/** Whether `p` is within polygon `hole` (x, y pairs), not on its edge. */
function inside(hole: readonly number[], p: Point): boolean {
  const [x, y] = p;
  let within = false;
  let edge = Number.POSITIVE_INFINITY;
  for (let i = 0, j = hole.length - 2; i < hole.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [hole[i]!, hole[i + 1]!, hole[j]!, hole[j + 1]!];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
    edge = Math.min(edge, distance(p, [xi, yi], [xj, yj]));
  }
  return within && edge > 1e-3;
}

/** Whether a straight-segment line paints `p`: within half its stroke of its path, outside its holes. */
function paints(g: LineGeometry, p: Point): boolean {
  if ((g.draw.holes ?? []).some((hole) => inside(hole, p))) return false;
  const points = pointsOf(g);
  let near = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i++)
    near = Math.min(near, distance(p, points[i - 1]!, points[i]!));
  return near <= g.strokeWidth / 2;
}

/** The distance from `p` to segment [a, b]. */
function distance([x, y]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const [dx, dy] = [bx - ax, by - ay];
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

const close = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;

/** Forecast: observed to t = 3, forecast after, the forecast's rows flagged. */
const forecast = table({
  t: [0, 1, 2, 3, 4, 5],
  v: [1, 3, 2, 4, 5, 6],
  estimated: [false, false, false, false, true, true].map(String),
});
const dotted = {
  dash: {
    condition: {
      when: col("estimated").eq("true"),
      // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
      then: ":" as const,
      otherwise: "-" as const,
    },
  },
};
const reddened = {
  color: {
    condition: {
      when: col("estimated").eq("true"),
      // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
      then: "#d62728",
      otherwise: "#1f77b4",
    },
  },
};

/** An identity color channel over field `paint`. */
const painted = { color: { field: "paint" as const, scale: { type: "identity" as const } } };

describe("style runs", () => {
  contractTest(
    "line.style-runs.arrival",
    () => {
      const chart = model({ marks: [line(forecast, { x: "t", y: "v", encode: dotted })] });
      const scene = chart.scene(estimateText);
      const at = (t: number): Point => [
        chart.xScale()!.map(t),
        chart.yScale()!.map(forecast.numbers("v")[t]!),
      ];
      const [solid, dots] = linesOf(scene);
      // The piece into t = 4, the first estimate, is dotted: the solid run ends at t = 3.
      expect(solid!.dash ?? []).toEqual([]);
      expect(dots!.dash!.length).toBeGreaterThan(0);
      expect(ownPoints(solid!).every((p, i) => close(p, at(i)))).toBe(true);
      expect(ownPoints(solid!)).toHaveLength(4);
      expect(ownPoints(dots!).map((p, i) => close(p, at(3 + i)))).toEqual([true, true, true]);
      // One series, one legend entry, whatever its runs.
      expect(chart.legendEntries()).toHaveLength(1);
      expect(solid!.of).toBe(dots!.of);
    },
    "a piece of line takes the look of the observation it arrives at",
  );

  contractTest(
    "line.style-runs.steps",
    () => {
      const boundary = (curve: "step-after" | "step-before" | "step") => {
        const chart = model({
          marks: [line(forecast, { x: "t", y: "v", curve, encode: dotted })],
        });
        const [solid, dots] = linesOf(chart.scene(estimateText));
        const end = ownPoints(solid!).at(-1)!;
        expect(close(ownPoints(dots!)[0]!, end)).toBe(true);
        return { end, x: (t: number) => chart.xScale()!.map(t), y: chart.yScale()!.map(4) };
      };
      // After: the flat run from t = 3 holds 3's value (solid); the jump at 4 is 4's.
      const after = boundary("step-after");
      expect(after.end[0]).toBeCloseTo(after.x(4));
      expect(after.end[1]).toBeCloseTo(after.y);
      // Before: the jump at 3 leads to 4's value, and is 4's.
      const before = boundary("step-before");
      expect(before.end[0]).toBeCloseTo(before.x(3));
      expect(before.end[1]).toBeCloseTo(before.y);
      // Mid steps: the first half hold is 3's, the jump and second half 4's.
      const mid = boundary("step");
      expect(mid.end[0]).toBeCloseTo((mid.x(3) + mid.x(4)) / 2);
      expect(mid.end[1]).toBeCloseTo(mid.y);
    },
    "a step's flat run takes the look of the observation whose value it holds",
  );

  contractTest(
    "line.style-runs.repeated-positions",
    () => {
      const drawn = (t: number[], v: number[], paint: string[]) => {
        const chart = model({
          marks: [line(table({ t, v, paint }), { x: "t", y: "v", encode: painted })],
        });
        const pieces = linesOf(chart.scene(estimateText));
        const at = (i: number): Point => [chart.xScale()!.map(t[i]!), chart.yScale()!.map(v[i]!)];
        return { pieces, at };
      };
      // The vertical edge at t = 1 arrives at the blue observation: blue, whole.
      const two = drawn([0, 1, 1, 2], [0, 0, 1, 1], ["red", "red", "blue", "blue"]);
      const [red, blue] = two.pieces;
      expect([red!.stroke, blue!.stroke]).toEqual(["red", "blue"]);
      const corner = two.at(1);
      const up: Point = [corner[0], (corner[1] + two.at(2)[1]) / 2];
      expect(paints(blue!, up)).toBe(true);
      expect(paints(red!, up)).toBe(false);
      // A run that is one vertical edge alone draws it.
      const three = drawn(
        [0, 1, 1, 1, 2],
        [0, 0, 1, 2, 2],
        ["red", "red", "blue", "green", "green"],
      );
      expect(three.pieces.map((g) => g.stroke)).toEqual(["red", "blue", "green"]);
      const middle = three.pieces[1]!;
      expect(ownPoints(middle).map((p) => [p[0], p[1]])).toEqual([three.at(1), three.at(2)]);
      const half: Point = [three.at(1)[0], (three.at(1)[1] + three.at(2)[1]) / 2];
      expect(three.pieces.map((g) => paints(g, half))).toEqual([false, true, false]);
    },
    "observations sharing a position are joined by edges in their arriving looks",
  );

  contractTest(
    "line.style-runs.seams",
    () => {
      // A corner where two translucent runs meet, wide, so the join is large.
      const rows = table({
        t: [0, 1, 2],
        v: [0, 0, 1],
        o: [0.5, 0.5, 0.5],
        paint: ["#ff0000", "#ff0000", "#0000ff"],
      });
      const chart = model({
        marks: [
          line(rows, {
            x: "t",
            y: "v",
            encode: { ...painted, strokeWidth: { value: 12 } },
          }),
        ],
      });
      const [red, blue] = linesOf(chart.scene(estimateText));
      const [cx, cy] = [chart.xScale()!.map(1), chart.yScale()!.map(0)];
      // Every point of the stroke about the corner is painted by one run, none by both.
      // Off the grid of whole pixels, so no point lies on a cut.
      for (let dx = -9.13; dx <= 9; dx += 0.47)
        for (let dy = -9.21; dy <= 9; dy += 0.47) {
          const p: Point = [cx + dx, cy + dy];
          const by = [paints(red!, p), paints(blue!, p)].filter(Boolean).length;
          const full = Math.min(
            distance(p, [chart.xScale()!.map(0), cy], [cx, cy]),
            distance(p, [cx, cy], [chart.xScale()!.map(2), chart.yScale()!.map(1)]),
          );
          // Points on the cut itself may fall to either side.
          if (Math.abs(full - 6) > 0.1) expect(by, `${dx}, ${dy}`).toBe(full < 6 ? 1 : 0);
        }
    },
    "where two runs meet, each paints its half of the join, and none paints it twice",
  );

  contractTest(
    "line.style-runs.dash-phase",
    () => {
      // One dash pattern along the series, colors changing: the dash goes on across.
      const chart = model({
        marks: [line(forecast, { x: "t", y: "v", dash: ":", encode: reddened })],
      });
      const [blue, red] = linesOf(chart.scene(estimateText));
      const own = ownPoints(blue!);
      let length = 0;
      for (let i = 1; i < own.length; i++)
        length += Math.hypot(own[i]![0] - own[i - 1]![0], own[i]![1] - own[i - 1]![1]);
      // The red piece begins half a stroke before the boundary, as far less into the pattern.
      expect(blue!.dashOffset ?? 0).toBe(0);
      expect(red!.dashOffset).toBeCloseTo(length - red!.strokeWidth / 2, 3);
      // A pattern changing starts again where it does.
      const [, dots] = linesOf(
        model({ marks: [line(forecast, { x: "t", y: "v", encode: dotted })] }).scene(estimateText),
      );
      expect(dots!.dashOffset).toBeCloseTo(-dots!.strokeWidth / 2);
    },
    "dashes carry on across boundaries their pattern stays over",
  );

  contractTest(
    "line.style-runs.level-of-detail",
    () => {
      const n = 100_000;
      const dense = table({
        t: Array.from({ length: n }, (_, i) => i),
        v: Array.from({ length: n }, (_, i) => Math.sin(i / 50)),
        tail: Array.from({ length: n }, (_, i) => String(i >= n - 50 || i === n / 2)),
      });
      const chart = model({
        marks: [
          line(dense, {
            x: "t",
            y: "v",
            encode: {
              color: {
                // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
                condition: { when: col("tail").eq("true"), then: "#d62728", otherwise: "#1f77b4" },
              },
            },
          }),
        ],
      });
      const pieces = linesOf(chart.scene(estimateText));
      // Reduced to about four points a pixel column, and the boundaries kept.
      expect(pieces.reduce((sum, g) => sum + g.path.count, 0)).toBeLessThan(n / 10);
      const red = pieces.filter((g) => g.stroke === "#d62728");
      const x = (t: number) => chart.xScale()!.map(t);
      // One observation alone: the edge into it, from the one before, then
      // past it (dense, the runs are not cut: the one after paints over).
      expect(red[0]!.draw.holes).toBeUndefined();
      const lone = pointsOf(red[0]!).map(([px]) => px);
      expect(lone).toHaveLength(3);
      expect(lone[0]).toBeCloseTo(x(n / 2 - 1), 3);
      expect(lone[1]).toBeCloseTo(x(n / 2), 3);
      // The tail: from the last observation before it on.
      const tail = ownPoints(red[1]!);
      expect(tail[0]![0]).toBeCloseTo(x(n - 51), 3);
      expect(tail.at(-1)![0]).toBeCloseTo(x(n - 1), 3);
    },
    "level of detail keeps every run, however short",
  );

  it("read rows appended alone, and only the edge into them", () => {
    const n = 1000;
    const rows = table(
      {
        t: Array.from({ length: n }, (_, i) => i),
        v: Array.from({ length: n }, () => 1),
        kind: Array.from({ length: n }, () => "a"),
      },
      { maxRows: 2 * n },
    );
    let reads = 0;
    const categories = rows.categories.bind(rows);
    rows.categories = ((field: never) => {
      const found = categories(field);
      if (field !== "kind") return found;
      const codes = new Proxy(found.codes, {
        get: (target, key) => {
          if (typeof key === "string" && /^\d+$/.test(key)) reads++;
          return Reflect.get(target, key);
        },
      });
      return { ...found, codes };
    }) as typeof rows.categories;
    const chart = model({
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          series: false,
          encode: { color: { field: "kind", scale: "kinds" } },
        }),
      ],
      scales: { kinds: { type: "ordinal", map: { a: "#000000", b: "#d62728" } } },
    });
    chart.scene(estimateText);
    reads = 0;
    rows.append({ t: [n, n + 1], v: [1, 1], kind: ["a", "b"] });
    const pieces = linesOf(chart.scene(estimateText));
    expect(reads).toBeLessThan(20);
    expect(pieces.map((g) => g.stroke)).toEqual(["#000000", "#d62728"]);
  });

  it("forget the runs of rows a rolling window drops", () => {
    const rows = table({ t: [0, 1], v: [1, 1], flag: ["#ff0000", "#ff0000"] }, { maxRows: 2 });
    const chart = model({
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          series: false,
          encode: { color: { field: "flag", scale: { type: "identity" } } },
        }),
      ],
    });
    chart.scene(estimateText);
    // Every row read so far goes at once.
    rows.append({ t: [2, 3], v: [1, 1], flag: ["#0000ff", "#0000ff"] });
    expect(linesOf(chart.scene(estimateText)).map((g) => [g.stroke, g.draw.holes])).toEqual([
      ["#0000ff", undefined],
    ]);
  });

  contractTest(
    "line.style-runs.identity",
    () => {
      const rows = table(
        { t: [0, 1], v: [1, 2], group: ["G", "G"], flag: ["actual", "actual"] },
        { maxRows: 3 },
      );
      const config: ChartConfig = {
        marks: [
          line(rows, { x: "t", y: "v", series: "group", encode: { color: { field: "flag" } } }),
        ],
      };
      const chart = model(config);
      const keys = () => {
        chart.scene(estimateText);
        return chart.legendEntries().map(({ key }) => key);
      };
      // Its flag the same at every observation: the series stands for it.
      expect(keys()).toEqual(['{"field":"flag","value":"actual"}']);
      // Flags changing along it: it stands for itself, drawn in runs.
      rows.append({ t: [2], v: [3], group: ["G"], flag: ["forecast"] });
      expect(keys()).toEqual(['{"field":"group","value":"G"}']);
      expect(chart.series()).toHaveLength(1);
      // Built again from the same rows, it stands for the same.
      chart.update({ ...config, title: "Again" });
      expect(keys()).toEqual(['{"field":"group","value":"G"}']);
      // Once the actual rows roll away, the forecast is all it has.
      rows.append({ t: [3, 4], v: [3, 4], group: ["G", "G"], flag: ["forecast", "forecast"] });
      expect(keys()).toEqual(['{"field":"flag","value":"forecast"}']);
      // A missing value is not the same value: a series starting without one stands for itself.
      const missing = model({
        marks: [
          line(
            table({
              t: [0, 1],
              v: [1, 2],
              group: ["G", "G"],
              flag: encodedCategory(Int32Array.from([-1, 0]), ["actual"]),
            }),
            { x: "t", y: "v", series: "group", encode: { color: { field: "flag" } } },
          ),
        ],
      });
      missing.scene(estimateText);
      expect(missing.legendEntries().map(({ key }) => key)).toEqual([
        '{"field":"group","value":"G"}',
      ]);
    },
    "a line colored by another field stands for its value while every observation has it",
  );

  it("list values of one color apart where series stand for them", () => {
    const rows = table({
      t: [0, 1, 0, 1],
      v: [1, 2, 3, 4],
      host: ["a", "a", "b", "b"],
      region: ["east", "east", "west", "west"],
    });
    const chart = model({
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          series: "host",
          encode: { color: { field: "region", scale: "regions" } },
        }),
      ],
      scales: { regions: { type: "ordinal", map: { east: "#000000", west: "#000000" } } },
    });
    chart.scene(estimateText);
    expect(chart.legendEntries().map(({ label }) => label)).toEqual(["east", "west"]);
  });

  it("run along positions in band order, however the position is given", () => {
    // Bands in the dictionary's order, a, b, c; rows b, a, c.
    const rows = table({
      c: encodedCategory(Int32Array.from([1, 0, 2]), ["a", "b", "c"]),
      v: [1, 2, 3],
      paint: ["#ff0000", "#0000ff", "#00ff00"],
    });
    for (const x of ["c", { field: "c" }, { field: "c", scale: "x" }] as const) {
      const chart = model({
        marks: [line(rows, { x, y: "v", series: false, encode: painted })],
      });
      // a (blue, where the line begins), then b (red), then c (green): each edge its arrival's.
      const pieces = linesOf(chart.scene(estimateText));
      expect(pieces.map((g) => g.stroke)).toEqual(["#ff0000", "#00ff00"]);
      const band = (name: string) =>
        chart.xScale()!.map(rows.categories("c").dictionary.indexOf(name));
      expect(ownPoints(pieces[0]!).map(([px]) => px)).toEqual([band("a"), band("b")]);
    }
  });

  it("take each observation's own look for markers, where observations share a place", () => {
    const rows = table({
      t: [0, 1, 1, 2],
      v: [1, 2, 3, 4],
      paint: ["#ff0000", "#ff0000", "#0000ff", "#0000ff"],
    });
    const markers = model({
      marks: [line(rows, { x: "t", y: "v", markers: true, encode: painted })],
    })
      .scene(estimateText)
      .panels[0]!.marks.filter((m): m is PointGeometry => m.kind === "point");
    expect(markers.map((m) => [m.fill, m.count])).toEqual([
      ["#ff0000", 2],
      ["#0000ff", 2],
    ]);
  });

  it("draw markers in their observations' looks, and as the line's style map draws it", () => {
    const markers = (options: object) =>
      model({ marks: [line(forecast, { x: "t", y: "v", markers: true, ...options })] })
        .scene(estimateText)
        .panels[0]!.marks.filter((m): m is PointGeometry => m.kind === "point");
    expect(markers({ encode: reddened }).map((m) => [m.fill, m.count])).toEqual([
      ["#1f77b4", 4],
      ["#d62728", 2],
    ]);
    const rows = table({
      t: [0, 1, 2, 3],
      v: [1, 2, 3, 4],
      g: ["G", "G", "G", "G"],
      paint: ["#ff0000", "#ff0000", "#0000ff", "#0000ff"],
    });
    const styled = model({
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          series: "g",
          markers: true,
          style: { by: { map: { G: { stroke: "#2ca02c", opacity: 0.5 } } } },
          encode: painted,
        }),
      ],
    })
      .scene(estimateText)
      .panels[0]!.marks.filter((m): m is PointGeometry => m.kind === "point");
    expect(styled.map((m) => [m.fill, m.fillOpacity])).toEqual([
      ["#2ca02c", 0.5],
      ["#2ca02c", 0.5],
    ]);
  });

  it("run along y for lines along y", () => {
    const chart = model({
      marks: [line(forecast, { x: "v", y: "t", orient: "y", encode: dotted })],
    });
    const [solid, dots] = linesOf(chart.scene(estimateText));
    const at: Point = [chart.xScale()!.map(4), chart.yScale()!.map(3)];
    expect(close(ownPoints(solid!).at(-1)!, at)).toBe(true);
    expect(close(ownPoints(dots!)[0]!, at)).toBe(true);
  });

  it("fall back to what the mark draws where a row gives a channel nothing", () => {
    const rows = table({
      t: [0, 1, 2, 3],
      v: [1, 2, 3, 4],
      o: [0.4, 0.4, Number.NaN, 0.6],
      w: [6, 6, Number.NaN, 4],
      paint: encodedCategory(Int32Array.from([0, 0, -1, 1]), ["#ff0000", "#0000ff"]),
    });
    const drawn = (encode: object) =>
      linesOf(model({ marks: [line(rows, { x: "t", y: "v", encode })] }).scene(estimateText));
    expect(
      drawn({ opacity: { field: "o", scale: { type: "identity" } } }).map(
        (g) => g.draw.opacity ?? 1,
      ),
    ).toEqual([0.4, 1, 0.6]);
    expect(
      drawn({ strokeWidth: { field: "w", scale: { type: "identity" } } }).map((g) => g.strokeWidth),
    ).toEqual([6, 2, 4]);
    // Colors read from rows fall back to the muted color, as rows without one do everywhere.
    const [, muted] = drawn(painted);
    expect(muted!.stroke).not.toBe("#ff0000");
    expect(muted!.stroke).not.toBe("#0000ff");
  });

  it("read a number field's values only for rows appended", () => {
    const n = 1000;
    const rows = table(
      {
        t: Array.from({ length: n }, (_, i) => i),
        v: Array.from({ length: n }, () => 1),
        w: Array.from({ length: n }, (_, i) => 1 + (i % 2)),
      },
      { maxRows: 2 * n },
    );
    let reads = 0;
    const numbers = rows.numbers.bind(rows);
    rows.numbers = ((field: never) => {
      const found = numbers(field);
      if (field !== "w") return found;
      return new Proxy(found, {
        get: (target, key) => {
          if (typeof key === "string" && /^\d+$/.test(key)) reads++;
          return Reflect.get(target, key);
        },
      });
    }) as typeof rows.numbers;
    const chart = model({
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          encode: { strokeWidth: { field: "w", scale: { type: "identity" } } },
        }),
      ],
    });
    chart.scene(estimateText);
    reads = 0;
    rows.append({ t: [n], v: [1], w: [3] });
    chart.scene(estimateText);
    expect(reads).toBeLessThan(20);
  });

  it("let go of looks once fewer are taken, as a window streams new ones", () => {
    const n = 1000;
    const rows = table(
      { o: Array.from({ length: n }, (_, i) => (i + 1) / (n + 1)) },
      { maxRows: n },
    );
    const runs = new StyleRuns(
      rows as unknown as Table,
      [
        {
          name: "opacity",
          read: (now) =>
            rowReader(
              { kind: "identity", field: "o", numbers: true },
              now,
              [],
              1,
              outputCheck("opacity", () => true),
              "line encode.opacity",
              false,
            ),
        },
      ],
      undefined,
      true,
    );
    const whole = () => ({ key: "s", length: rows.length }) as Series;
    expect(runs.of(whole(), undefined).count).toBe(n);
    // The same look streams in until it fills the window.
    for (let i = 0; i < n; i += 100) {
      rows.append({ o: Array.from({ length: 100 }, () => 1) });
      runs.of(whole(), undefined);
    }
    rows.append({ o: [1] });
    // Of the thousand looks, no more are kept than a few hundred at most.
    const [look] = runs.of(whole(), undefined).looks;
    expect(look).toBeLessThan(256);
    // Ever new looks streaming through a short window keep few.
    for (let i = 0; i < 2000; i++) {
      rows.append({ o: [(i % 1999) / 2000] });
      runs.of(whole(), undefined);
    }
    expect(Math.max(...runs.of(whole(), undefined).looks)).toBeLessThan(2 * n + 256);
  });

  it("draw a series of many looks and gaps in pieces as many as its runs", () => {
    const n = 1000;
    const rows = table({
      t: Array.from({ length: n }, (_, i) => i),
      v: Array.from({ length: n }, (_, i) => (i % 3 === 2 ? Number.NaN : Math.sin(i / 10))),
      o: Array.from({ length: n }, (_, i) => (i + 1) / n),
    });
    const many = model({
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          encode: { opacity: { field: "o", scale: { type: "identity" } } },
        }),
      ],
    }).scene(estimateText);
    const pieces = linesOf(many);
    // Each edge its own run's: a piece each, a stroke past each boundary at most.
    expect(pieces.length).toBeLessThanOrEqual(n);
    expect(pieces.every((g) => g.path.count <= 4)).toBe(true);
  });

  contractTest(
    "area.style-runs.fills",
    () => {
      const chart = model({
        marks: [
          area(forecast, {
            x: "t",
            y: "v",
            stroke: "#000000",
            encode: {
              opacity: {
                // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
                condition: { when: col("estimated").eq("true"), then: 0.4, otherwise: 1 },
              },
            },
          }),
        ],
      });
      const [fill, forecastFill, outline, forecastOutline] = areasOf(chart.scene(estimateText));
      // Fills meet at t = 3, sharing the edge across the band there.
      const x3 = chart.xScale()!.map(3);
      expect(pointsOf(fill!).at(-1)![0]).toBeCloseTo(x3);
      expect(pointsOf(forecastFill!)[0]![0]).toBeCloseTo(x3);
      expect([fill!.strokeWidth, forecastFill!.strokeWidth]).toEqual([0, 0]);
      expect(forecastFill!.fillOpacity).toBeCloseTo(fill!.fillOpacity * 0.4);
      // Outlines over them, cut as lines are, at their runs' opacities.
      expect([outline!.fillOpacity, forecastOutline!.fillOpacity]).toEqual([0, 0]);
      expect([outline!.strokeOpacity, forecastOutline!.strokeOpacity]).toEqual([1, 0.4]);
      expect(outline!.draw.holes).toHaveLength(1);
      // A band curved as one keeps its boundaries too.
      const band = model({
        marks: [
          area(
            table({
              t: [0, 1, 2, 3, 4],
              lo: [0, 1, 0, 1, 0],
              hi: [2, 3, 2, 3, 2],
              paint: ["#ff0000", "#ff0000", "#ff0000", "#0000ff", "#0000ff"],
            }),
            {
              x: "t",
              y1: "lo",
              y2: "hi",
              curve: "monotone",
              encode: painted,
            },
          ),
        ],
      });
      const fills = areasOf(band.scene(estimateText)).filter((g) => g.fillOpacity > 0);
      expect(fills.map((g) => g.fill)).toEqual(["#ff0000", "#0000ff"]);
      const x2 = band.xScale()!.map(2);
      expect(pointsOf(fills[0]!).at(-1)![0]).toBeCloseTo(x2);
      expect(pointsOf(fills[1]!)[0]![0]).toBeCloseTo(x2);
    },
    "an area's runs fill between their boundaries, their outlines cut as lines are",
  );

  it("fill each run of an area along y down to its baseline", () => {
    const chart = model({
      marks: [
        area(
          table({
            t: [1, 3, 6, 9],
            v: [8, 8, 8, 8],
            paint: ["#ff0000", "#ff0000", "#0000ff", "#0000ff"],
          }),
          { x: "v", y: "t", orient: "y", encode: painted },
        ),
      ],
    });
    const fills = areasOf(chart.scene(estimateText)).filter((g) => g.fillOpacity > 0);
    expect(fills.map((g) => g.fill)).toEqual(["#ff0000", "#0000ff"]);
    // Each closes at the baseline (x = 0) between its own ends.
    const [x0, y] = [chart.xScale()!.map(0), (t: number) => chart.yScale()!.map(t)];
    const ends = [
      [1, 3],
      [3, 9],
    ];
    fills.forEach((g, i) => {
      const [from, to] = ends[i] as [number, number];
      const lower = g.lower!;
      expect(lower.count).toBe(2);
      expect([lower.coords[0], lower.coords[2]]).toEqual([x0, x0]);
      expect(lower.coords[1]).toBeCloseTo(y(from));
      expect(lower.coords[3]).toBeCloseTo(y(to));
    });
  });

  it("keep a line's own start where its first observation alone has another look", () => {
    const chart = model({
      x: { domain: [0, 10] },
      marks: [
        line(table({ t: [2, 8], v: [5, 5], paint: ["#ff0000", "#0000ff"] }), {
          x: "t",
          y: "v",
          encode: { ...painted, strokeWidth: { value: 20 } },
        }),
      ],
    });
    // The one edge arrives at blue: one piece, round at both ends, cut nowhere.
    const [blue, ...rest] = linesOf(chart.scene(estimateText));
    expect(rest).toEqual([]);
    expect(blue!.stroke).toBe("#0000ff");
    expect(blue!.draw.holes).toBeUndefined();
    const start: Point = [chart.xScale()!.map(2) - 5, chart.yScale()!.map(5)];
    expect(paints(blue!, start)).toBe(true);
  });

  it("paint a run turning sharply back over the run before it", () => {
    const chart = model({
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
      marks: [
        line(table({ t: [5, 5, 5], v: [2, 8, 2], paint: ["#ff0000", "#ff0000", "#0000ff"] }), {
          x: "t",
          y: "v",
          encode: { ...painted, strokeWidth: { value: 20 } },
        }),
      ],
    });
    const [red, blue] = linesOf(chart.scene(estimateText));
    // The way back is blue from its turn on, uncut, drawn over the red way
    // up, which ends past the turn as its join does.
    const [x, top] = [chart.xScale()!.map(5), chart.yScale()!.map(8)];
    expect([red!.draw.holes, blue!.draw.holes]).toEqual([undefined, undefined]);
    expect(close(pointsOf(blue!)[0]!, [x, top])).toBe(true);
    expect(paints(blue!, [x, top + 10])).toBe(true);
    expect(paints(red!, [x, top - 8])).toBe(true);
    expect(paints(blue!, [x, top - 12])).toBe(false);
  });

  it("cut where runs meet only where the path near them is the two segments meeting there", () => {
    const drawn = (t: number[], v: number[], paint: string[], curve?: "monotone") => {
      const chart = model({
        x: { domain: [0, 10] },
        y: { domain: [0, 10] },
        marks: [
          line(table({ t, v, paint }), {
            x: "t",
            y: "v",
            ...(curve && { curve }),
            encode: { ...painted, strokeWidth: { value: 20 } },
          }),
        ],
      });
      const at = (tt: number, vv: number): Point => [
        chart.xScale()!.map(tt),
        chart.yScale()!.map(vv),
      ];
      return { pieces: linesOf(chart.scene(estimateText)), at };
    };
    // Up, then back down through the boundary: the way back is blue there,
    // over the red way up, which a cut would have left out.
    const back = drawn([5, 5, 5, 5], [2, 5, 8, 2], ["red", "red", "blue", "blue"]);
    const [red, blue] = back.pieces;
    expect([red!.draw.holes, blue!.draw.holes]).toEqual([undefined, undefined]);
    const [x, y] = back.at(5, 5);
    expect(paints(blue!, [x, y + 10])).toBe(true);
    // A corner of long straight segments is cut; the same as a curve is not.
    const corner = drawn([1, 5, 9], [2, 2, 8], ["red", "red", "blue"]);
    expect(corner.pieces.map((g) => g.draw.holes?.length)).toEqual([1, 1]);
    const curved = drawn([1, 5, 9], [2, 2, 8], ["red", "red", "blue"], "monotone");
    expect(curved.pieces.map((g) => g.draw.holes)).toEqual([undefined, undefined]);
    // Segments shorter than a cut reaches are not cut either.
    const short = drawn([4.6, 5, 5.4], [5, 5, 5.4], ["red", "red", "blue"]);
    expect(short.pieces.map((g) => g.draw.holes)).toEqual([undefined, undefined]);
  });

  it("run along each panel's rows of a series alone", () => {
    const chart = model({
      legend: false,
      facet: facet("g"),
      marks: [
        line(
          table({
            t: [0, 0, 1, 1, 2, 2],
            v: [1, 5, 2, 6, 3, 7],
            g: ["A", "B", "A", "B", "A", "B"],
            paint: ["#ff0000", "#0000ff", "#ff0000", "#0000ff", "#ff0000", "#0000ff"],
          }),
          { x: "t", y: "v", encode: painted },
        ),
      ],
    });
    const panels = chart.scene(estimateText).panels;
    const strokes = panels.map((panel) =>
      panel.marks.flatMap((g) => (g.kind === "line" ? [(g as LineGeometry).stroke] : [])),
    );
    expect(strokes).toEqual([["#ff0000"], ["#0000ff"]]);
  });

  it("keep their cuts under a selection, and draw a series' selected values once", () => {
    const highlighted = (rows: Table, selected: number[], filled = false) => {
      const store = selectionStore(rows);
      const highlighter = new Highlighter([{ table: rows, store, channel: "focus" }]);
      const options = { x: "t", y: "v", encode: painted } as const;
      const chart = model({
        marks: [
          filled
            ? area(rows, { ...options, stroke: "#000000" })
            : line(rows, { ...options, markers: true }),
        ],
      });
      chart.highlight = (mark, series, frame, key) =>
        highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
      store.set("focus", selectRows(new RowSet(rows).addAll(selected)));
      return chart.scene(estimateText).panels[0]!.marks;
    };
    // Selected whole, each run's piece drawn inside the selection keeps its cut.
    const two = table({
      t: [0, 1, 2, 3],
      v: [0, 2, 1, 3],
      paint: ["red", "red", "blue", "blue"],
    }) as unknown as Table;
    const lit = highlighted(two, [0, 1, 2, 3]).filter(
      (g) => g.kind === "line" && g.key.includes("\u0001on"),
    );
    expect(lit.map((g) => g.draw.holes?.length)).toEqual([1, 1]);
    // An area's outlines too, dimmed outside the selection and drawn inside
    // it, over every fill, dimmed or not, as the area paints them.
    const pieces = highlighted(two, [0, 1], true).filter((g) => g.kind === "area");
    const outline = (g: Geometry) => (g as AreaGeometry).fillOpacity === 0;
    const outlines = pieces.filter(outline);
    expect(outlines.length).toBeGreaterThan(2);
    expect(outlines.every((g) => g.draw.holes?.length === 1)).toBe(true);
    expect(pieces.findIndex(outline)).toBe(pieces.length - outlines.length);
    const shared = table({
      t: [1, 3, 3, 7, 7, 9],
      v: [4, 4, 6, 6, 4, 4],
      paint: ["red", "red", "blue", "blue", "blue", "blue"],
    }) as unknown as Table;
    const masked = highlighted(shared, [2, 3], true).filter((g) => g.kind === "area");
    expect(masked.findIndex(outline)).toBe(masked.length - masked.filter(outline).length);
    // Looks alternating where observations share positions: the selected
    // rows' values are drawn once over the series' dimmed pieces, not once
    // over each.
    const n = 48;
    const many = table({
      t: Array.from({ length: n }, (_, i) => Math.floor(i / 2)),
      v: Array.from({ length: n }, (_, i) => i % 3),
      paint: Array.from({ length: n }, (_, i) => (i % 2 ? "blue" : "red")),
    }) as unknown as Table;
    const drawn = highlighted(
      many,
      Array.from({ length: n }, (_, i) => i).filter((i) => i % 4 < 2),
    ).filter((g) => g.kind === "line");
    const on = drawn.filter((g) => g.key.includes("\u0001on"));
    expect(on.length).toBeGreaterThan(0);
    expect(on.length).toBeLessThan(n);
    expect(drawn.length - on.length).toBeLessThan(n);
    // Markers in their looks too: each look's selected markers once.
    const markers = highlighted(
      many,
      Array.from({ length: n }, (_, i) => i).filter((i) => i % 4 < 2),
    ).filter((g) => g.kind === "point" && g.key.includes("\u0001on"));
    expect(markers.length).toBeLessThanOrEqual(2);
  });

  it("light the markers of selected rows, however near others stand, as level of detail keeps them", () => {
    /** The centers of `rows`' markers, lit and dimmed, with `selected` rows selected. */
    const marked = (rows: Table, selected: number[]) => {
      const store = selectionStore(rows);
      const highlighter = new Highlighter([{ table: rows, store, channel: "focus" }]);
      const chart = model({
        legend: false,
        x: { domain: [0, 10], nice: false },
        y: { domain: [0, 10], nice: false },
        marks: [line(rows, { x: "t", y: "v", strokeWidth: 0, markers: true, encode: painted })],
      });
      chart.highlight = (mark, series, frame, key) =>
        highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
      store.set("focus", selectRows(new RowSet(rows).addAll(selected)));
      const points = chart
        .scene(estimateText)
        .panels[0]!.marks.filter((g): g is PointGeometry => g.kind === "point");
      const centers = (lit: boolean) =>
        points
          .filter((g) => g.key.includes("\u0001on") === lit)
          .flatMap((g) =>
            Array.from({ length: g.count }, (_, i) => [g.coords[i * 2]!, g.coords[i * 2 + 1]!]),
          );
      return { lit: centers(true), dimmed: centers(false) };
    };
    // A blue observation a thousandth from a selected red one stays dimmed.
    const near = table({
      t: [2, 5, 5.001, 8],
      v: [5, 5, 5, 5],
      paint: ["#ff0000", "#ff0000", "#0000ff", "#0000ff"],
    }) as unknown as Table;
    const { lit, dimmed } = marked(near, [1]);
    const xs = [...lit, ...dimmed].map(([x]) => x!).sort((a, b) => a - b);
    expect(lit.map(([x]) => x)).toEqual([xs[1]]);
    expect(dimmed).toHaveLength(3);
    // Rows level of detail reduces to a column's first, lowest, highest, and
    // last (0, 40, and 63): the highest selected, odd rows about it too.
    const n = 64;
    const dense = table({
      t: Float64Array.from({ length: n }, (_, i) => 5 + i / 1e5),
      v: Float64Array.from({ length: n }, (_, i) => (i === 40 ? 9 : 1 + (i % 7) / 10)),
      paint: Array.from({ length: n }, () => "#ff0000"),
    }) as unknown as Table;
    const odd = Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 && i !== n - 1);
    const reduced = marked(dense, [40, ...odd]);
    expect(reduced.dimmed).toHaveLength(2);
    expect(reduced.lit).toHaveLength(1);
    // The highest: above the others.
    expect(reduced.lit[0]![1]).toBeLessThan(Math.min(...reduced.dimmed.map(([, y]) => y!)));
  });

  it("keep what a trace records of its points from scene to scene", () => {
    // A long line traced whole (its positions do not ascend), with continuity.
    const n = 20_000;
    const rows = table({
      t: Float64Array.from({ length: n }, (_, i) => (i * 7919) % n),
      v: Float64Array.from({ length: n }, (_, i) => i % 10),
    });
    const chart = model({
      marks: [line(rows, { x: "t", y: "v", continuity: { maxGap: n } })],
    });
    chart.scene(estimateText);
    /** Elements of typed arrays of a quarter of the rows or more, made drawing a scene. */
    const made = (draw: () => void) => {
      const kinds = ["Float64Array", "Float32Array", "Int32Array"] as const;
      const saved = kinds.map((kind) => globalThis[kind]);
      let elements = 0;
      kinds.forEach((kind, i) => {
        (globalThis as Record<string, unknown>)[kind] = new Proxy(saved[i]!, {
          construct(target, args, newTarget) {
            const array = Reflect.construct(target, args, newTarget) as ArrayLike<number>;
            if (typeof args[0] === "number" && array.length >= n / 4) elements += array.length;
            return array;
          },
        });
      });
      try {
        draw();
      } finally {
        kinds.forEach((kind, i) => {
          (globalThis as Record<string, unknown>)[kind] = saved[i];
        });
      }
      return elements;
    };
    // Traced again at another width: in the buffers the last scene grew.
    chart.setSize(401, 300, 1);
    chart.scene(estimateText);
    expect(
      made(() => {
        chart.setSize(400, 300, 1);
        chart.scene(estimateText);
      }),
    ).toBe(0);
  });

  it("reduce a panel's rows of one look as one", () => {
    const n = 100_000;
    const chart = model({
      legend: false,
      facet: facet("g"),
      marks: [
        line(
          table({
            t: Float64Array.from({ length: n }, (_, i) => Math.floor(i / 2)),
            v: Float64Array.from({ length: n }, (_, i) => Math.sin(i / 7) + (i % 2) * 3),
            g: Array.from({ length: n }, (_, i) => (i % 2 ? "B" : "A")),
            paint: Array.from({ length: n }, (_, i) => (i % 2 ? "#0000ff" : "#ff0000")),
          }),
          { x: "t", y: "v", encode: painted },
        ),
      ],
    });
    for (const panel of chart.scene(estimateText).panels) {
      const lines = panel.marks.filter((g): g is LineGeometry => g.kind === "line");
      expect(lines).toHaveLength(1);
      // Reduced to the pixels it covers, as a line of one look is.
      expect(lines[0]!.path.count).toBeLessThan(5_000);
    }
  });

  it("draw isolated observations of areas as dots in their runs' looks, and refuse a stack's", () => {
    const dots = model({
      marks: [
        area(
          table({
            t: [0, 1, 2, 3, 4],
            v: [1, Number.NaN, 2, Number.NaN, 3],
            o: [0.4, 0.4, 1, 1, 1],
          }),
          { x: "t", y: "v", encode: { opacity: { field: "o", scale: { type: "identity" } } } },
        ),
      ],
    });
    const outlines = areasOf(dots.scene(estimateText)).filter((g) => g.fillOpacity === 0);
    expect(outlines.map((g) => [g.upper.count, g.strokeOpacity])).toEqual([
      [1, 0.4],
      [1, 1],
      [1, 1],
    ]);
    const stacked = table({
      t: [0, 1, 0, 1],
      v: [1, 2, 3, 4],
      g: ["a", "a", "b", "b"],
      flag: ["red", "blue", "red", "red"],
    });
    expect(() =>
      model({
        marks: [
          area(stacked, {
            x: "t",
            y: "v",
            series: "g",
            stack: true,
            encode: { color: { field: "flag", scale: { type: "identity" } } },
          }),
        ],
      }).scene(estimateText),
    ).toThrow(/stacked areas take one look per layer/);
  });

  it("outline areas in each run's color, ending where no outline meets them", () => {
    // Without a stroke of the options, each run's outline is its own color.
    const automatic = model({
      marks: [
        area(table({ t: [1, 5, 9], v: [5, 5, 5], paint: ["#ff0000", "#ff0000", "#0000ff"] }), {
          x: "t",
          y: "v",
          encode: painted,
        }),
      ],
    });
    const outlines = areasOf(automatic.scene(estimateText)).filter((g) => g.fillOpacity === 0);
    expect(outlines.map((g) => g.stroke)).toEqual(["#ff0000", "#0000ff"]);
    // A run drawing no outline leaves the one before it whole: no cut, no
    // stroke carried past their boundary.
    const lone = model({
      marks: [
        area(table({ t: [1, 5, 5], v: [2, 2, 8], edge: ["#ff0000", "#ff0000", undefined] }), {
          x: "t",
          y: "v",
          line: false,
          strokeWidth: 20,
          fillOpacity: 0,
          encode: { stroke: { field: "edge", scale: { type: "identity" } } },
        }),
      ],
    });
    const [kept] = areasOf(lone.scene(estimateText)).filter((g) => g.stroke !== null);
    expect(kept!.draw.holes ?? []).toEqual([]);
    // Its two points, ending at the corner.
    expect(pointsOf(kept!)).toHaveLength(2);
  });

  it("dim areas' dots standing alone outside a selection", () => {
    const rows = table({
      t: [1, 3, 5, 7, 9],
      v: [2, Number.NaN, 4, Number.NaN, 6],
      paint: ["#ff0000", "#ff0000", "#0000ff", "#0000ff", "#00ff00"],
    }) as unknown as Table;
    const store = selectionStore(rows);
    const highlighter = new Highlighter([{ table: rows, store, channel: "focus" }]);
    const chart = model({
      marks: [area(rows, { x: "t", y: "v", line: false, encode: painted })],
    });
    chart.highlight = (mark, series, frame, key) =>
      highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
    store.set("focus", selectRows(new RowSet(rows).addAll([0])));
    const dots = areasOf(chart.scene(estimateText)).filter(
      (g) => g.fillOpacity === 0 && g.fill !== "#ff0000",
    );
    expect(dots.length).toBe(2);
    expect(dots.every((g) => (g.strokeOpacity ?? 1) < 1)).toBe(true);
    // The selected one is lit over its dimmed self, in its own look.
    const lit = chart
      .scene(estimateText)
      .panels[0]!.marks.filter((g): g is PointGeometry => g.kind === "point");
    expect(lit.map((g) => [g.fill, g.fillOpacity, g.count])).toEqual([["#ff0000", 1, 1]]);
  });

  it("light a selected dot of an area with no outline, painted in its fill", () => {
    // Two observations at one x and a third: dots of no outline, painted in their fills.
    const rows = table({
      t: [1, 1, 5],
      v: [2, 4, 6],
      paint: ["#ff0000", "#0000ff", "#00ff00"],
    }) as unknown as Table;
    const store = selectionStore(rows);
    const highlighter = new Highlighter([{ table: rows, store, channel: "focus" }]);
    const chart = model({
      marks: [area(rows, { x: "t", y: "v", line: false, encode: painted })],
    });
    chart.highlight = (mark, series, frame, key) =>
      highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
    store.set("focus", selectRows(new RowSet(rows).addAll([0])));
    expect(() => chart.scene(estimateText)).not.toThrow();
  });

  it("light lines' lone selected rows in their observations' looks", () => {
    const rows = table({
      t: [1, 5, 9],
      v: [5, 5, 5],
      paint: ["#ff0000", "#ff0000", "#0000ff"],
    }) as unknown as Table;
    const store = selectionStore(rows);
    const highlighter = new Highlighter([{ table: rows, store, channel: "focus" }]);
    const chart = model({
      marks: [line(rows, { x: "t", y: "v", opacity: 0.5, encode: painted })],
    });
    chart.highlight = (mark, series, frame, key) =>
      highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
    store.set("focus", selectRows(new RowSet(rows).addAll([2])));
    const marks = chart.scene(estimateText).panels[0]!.marks;
    const dots = marks.filter((g): g is PointGeometry => g.kind === "point");
    expect(dots.map((g) => [g.fill, g.fillOpacity, g.count])).toEqual([["#0000ff", 0.5, 1]]);
    // Over its series' dimmed strokes, which are drawn whole, as points draw over lines.
    expect(marks.indexOf(dots[0]!)).toBe(marks.length - 1);
  });

  it("name selected runs' clips apart where the same spans run along the other axis", () => {
    const rows = table({ t: [1, 3, 7, 9] }) as unknown as Table;
    const ids = (["x", "y"] as const).map((orient) => {
      const store = selectionStore(rows);
      const highlighter = new Highlighter([{ table: rows, store, channel: "focus" }]);
      const [along, across] = [{ domain: [0, 10] as const }, { domain: [0, 20] as const }];
      const chart = model({
        legend: false,
        x: { ...(orient === "x" ? along : across), show: false, grid: false, nice: false },
        y: { ...(orient === "y" ? along : across), show: false, grid: false, nice: false },
        marks: [line(rows, { x: "t", y: "t", orient })],
      });
      chart.setSize(300, 292, 1);
      chart.highlight = (mark, series, frame, key) =>
        highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
      store.set("focus", selectRows(new RowSet(rows).addAll([1, 2])));
      // A square plot: spans along either axis are the same pixels.
      return new Set(renderSvg(chart.scene(estimateText)).match(/herceg-runs-\w+/g));
    });
    expect(ids[0]!.size).toBeGreaterThan(0);
    expect([...ids[0]!].filter((id) => ids[1]!.has(id))).toEqual([]);
  });

  it("keep drawings of a few hundred opacities a drawing, however many stream in", () => {
    const drawing = lineDrawing as Drawing<Geometry>;
    const half = translucent(drawing, 0.5);
    expect(translucent(drawing, 0.5)).toBe(half);
    // A thousand opacities, as a stream of rows of their own: the first ones' drawings go.
    for (let i = 1; i <= 1000; i++) translucent(drawing, i / 1001);
    expect(translucent(drawing, 0.5)).not.toBe(half);
  });

  it("find a series' selected runs once, whatever widths its pieces and markers are drawn at, along either axis", () => {
    /**
     * Positions placed by highlighting n rows of widths of their own (with
     * markers, a group of them a width), in runs of two selected.
     */
    const placings = (n: number, orient: "x" | "y", markers: boolean) => {
      const rows = table({
        t: Float64Array.from({ length: n }, (_, i) => i),
        v: Float64Array.from({ length: n }, () => 5),
        w: Float64Array.from({ length: n }, (_, i) => 1 + i / n),
        paint: Array.from({ length: n }, (_, i) => (i % 2 ? "#ff0000" : "#0000ff")),
      }) as unknown as Table;
      const store = selectionStore(rows);
      const highlighter = new Highlighter([{ table: rows, store, channel: "focus" }]);
      const [along, across] = [{ domain: [0, n] as const }, { domain: [0, 10] as const }];
      const chart = model({
        legend: false,
        x: { ...(orient === "x" ? along : across), nice: false },
        y: { ...(orient === "y" ? along : across), nice: false },
        marks: [
          line(rows, {
            ...(orient === "x" ? { x: "t", y: "v" } : { x: "v", y: "t" }),
            orient,
            opacity: 0.5,
            markers,
            encode: { ...painted, strokeWidth: { field: "w", scale: { type: "identity" } } },
          }),
        ],
      });
      let count = 0;
      chart.highlight = (mark, series, frame, key) => {
        const scale = frame[orient];
        const counted = new Proxy(scale, {
          get: (target, name) =>
            name === "map"
              ? (value: number) => {
                  count++;
                  return target.map(value);
                }
              : Reflect.get(target, name),
        });
        const placed = { ...frame, [orient]: counted };
        return (
          highlighter.geometry(mark, series, placed, key) ?? mark.geometry(series, placed, key)
        );
      };
      const on = Array.from({ length: n }, (_, i) => i).filter((i) => i % 3 !== 2);
      store.set("focus", selectRows(new RowSet(rows).addAll(on)));
      chart.scene(estimateText);
      return count;
    };
    // Four times the rows, about four times the work: not a pass over every run per width.
    for (const orient of ["x", "y"] as const)
      for (const markers of [false, true])
        expect(
          placings(1024, orient, markers) / placings(256, orient, markers),
          `${orient}${markers ? " with markers" : ""}`,
        ).toBeLessThan(6);
  });

  it("draw a series' dots where it is drawn, before later series, where none of its strokes reach the plot", () => {
    const rows = table({
      t: [-0.1, 0, 1],
      v: [5, 5, 5],
      s: ["A", "B", "B"],
      paint: ["#ff0000", "#0000ff", "#0000ff"],
      w: [1, 20, 20],
    }) as unknown as Table;
    const store = selectionStore(rows);
    const highlighter = new Highlighter([{ table: rows, store, channel: "focus" }]);
    const chart = model({
      legend: false,
      theme: { style: { line: { strokeWidth: 20 } } },
      x: { domain: [0, 10], nice: false },
      y: { domain: [0, 10], nice: false },
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          series: "s",
          encode: { ...painted, strokeWidth: { field: "w", scale: { type: "identity" } } },
        }),
      ],
    });
    chart.highlight = (mark, series, frame, key) =>
      highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
    store.set("focus", selectRows(new RowSet(rows).addAll([0, 1, 2])));
    const marks = chart.scene(estimateText).panels[0]!.marks;
    const dots = marks.findIndex((g) => g.kind === "point");
    const b = marks.findIndex((g) => g.kind === "line" && (g.of ?? g.key).includes('"B"'));
    expect(dots).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(dots);
  });

  it("draw a series' lone selected rows as one geometry, in their order, and its pieces by the spans they reach", () => {
    const n = 512;
    const rows = table({
      t: Float64Array.from({ length: n }, (_, i) => i),
      v: Float64Array.from({ length: n }, () => 5),
      paint: Array.from({ length: n }, (_, i) => (i % 2 ? "#ff0000" : "#0000ff")),
    }) as unknown as Table;
    const store = selectionStore(rows);
    const highlighter = new Highlighter([{ table: rows, store, channel: "focus" }]);
    const chart = model({
      x: { domain: [0, n], nice: false },
      marks: [line(rows, { x: "t", y: "v", opacity: 0.5, encode: painted })],
    });
    chart.highlight = (mark, series, frame, key) =>
      highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
    // Runs of two rows selected, then a row alone: spans and dots both.
    const on = Array.from({ length: n }, (_, i) => i).filter((i) => i % 6 < 2 || i % 6 === 4);
    store.set("focus", selectRows(new RowSet(rows).addAll(on)));
    const marks = chart.scene(estimateText).panels[0]!.marks;
    const [dots, ...more] = marks.filter((g): g is PointGeometry => g.kind === "point");
    expect(more).toHaveLength(0);
    // Every lone row, each in its observation's color, in their order.
    const lone = on.filter((i) => i % 6 === 4);
    expect(dots!.count).toBe(lone.length);
    const colors = Array.from({ length: dots!.count }, (_, i) =>
      dots!.colors ? dots!.colors.palette[dots!.colors.index[i]!] : dots!.fill,
    );
    expect(colors).toEqual(lone.map((i) => (i % 2 ? "#ff0000" : "#0000ff")));
    // Each piece clipped by the few spans it reaches, not by every span of its series.
    const rects = marks.reduce((sum, g) => sum + (g.draw.clip?.length ?? 0) / 4, 0);
    expect(rects).toBeLessThan(8 * n);
  });

  it("light a wide area's selected dot whole, at its own opacity", () => {
    const rows = table({
      t: [1, 3, 5, 7, 9],
      v: [2, Number.NaN, 4, Number.NaN, 6],
      paint: ["#ff0000", "#ff0000", "#0000ff", "#0000ff", "#00ff00"],
    }) as unknown as Table;
    const store = selectionStore(rows);
    const highlighter = new Highlighter([{ table: rows, store, channel: "focus" }]);
    const chart = model({
      marks: [
        area(rows, {
          x: "t",
          y: "v",
          line: false,
          strokeWidth: 20,
          opacity: 0.5,
          encode: painted,
        }),
      ],
    });
    chart.highlight = (mark, series, frame, key) =>
      highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
    store.set("focus", selectRows(new RowSet(rows).addAll([2])));
    const [dot] = chart
      .scene(estimateText)
      .panels[0]!.marks.filter((g): g is PointGeometry => g.kind === "point");
    // As wide as the dot drawn under it, which it covers, at the area's opacity.
    expect([dot!.fill, dot!.fillOpacity, dot!.count, dot!.radius]).toEqual(["#0000ff", 0.5, 1, 10]);
  });

  it("outline runs an area of no outline width gives one through its series' style", () => {
    const chart = model({
      marks: [
        area(
          table({
            t: [1, 3, 5, 7],
            v: [5, 5, 5, 5],
            g: ["G", "G", "G", "G"],
            paint: ["#ff0000", "#ff0000", "#0000ff", "#0000ff"],
          }),
          {
            x: "t",
            y: "v",
            series: "g",
            strokeWidth: 0,
            fillOpacity: 0,
            encode: painted,
            style: { by: { field: "g", map: { G: { stroke: "#008000", strokeWidth: 20 } } } },
          },
        ),
      ],
    });
    const outlines = areasOf(chart.scene(estimateText)).filter((g) => g.key.includes("outline"));
    expect(outlines.map((g) => [g.stroke, g.strokeWidth])).toEqual([
      ["#008000", 20],
      ["#008000", 20],
    ]);
  });

  it("outline rows without an outline value as the area outlines itself", () => {
    const chart = model({
      marks: [
        area(table({ t: [1, 5, 9], v: [5, 5, 5], edge: ["#ff0000", "#ff0000", undefined] }), {
          x: "t",
          y: "v",
          fill: "#0000ff",
          encode: { stroke: { field: "edge", scale: { type: "identity" } } },
        }),
      ],
    });
    const outlines = areasOf(chart.scene(estimateText)).filter((g) => g.fillOpacity === 0);
    expect(outlines.map((g) => g.stroke)).toEqual(["#ff0000", "#0000ff"]);
  });

  it("refuse looks changing along positions that do not ascend", () => {
    const back = table({ t: [0, 1, 0.5], v: [1, 2, 3], flag: ["a", "a", "b"] });
    expect(() =>
      model({
        marks: [
          line(back, {
            x: "t",
            y: "v",
            encode: {
              dash: {
                // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
                condition: { when: col("flag").eq("b"), then: ":", otherwise: "-" },
              },
            },
          }),
        ],
      }).scene(estimateText),
    ).toThrow(
      "line (mark 0) encode: looks change within the series, whose positions do not ascend",
    );
  });

  it("write each cut's clip in SVG, named by what it cuts", () => {
    const svgOf = () =>
      renderSvg(
        model({ marks: [line(forecast, { x: "t", y: "v", encode: dotted })] }).scene(estimateText),
      );
    const svg = svgOf();
    const ids = [...svg.matchAll(/<clipPath id="(herceg-cut-[^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    // The same chart drawn again names its clips alike.
    expect([...svgOf().matchAll(/<clipPath id="(herceg-cut-[^"]+)"/g)].map((m) => m[1])).toEqual(
      ids,
    );
  });
});
