// The chart's inspection policy: which point of each series a mode along
// an axis reads (`snap`), how far from the pointer (`within`), where the
// crosshair stands, and what reads nothing: a series inside a gap its
// continuity leaves, and marks that leave inspection.
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { rug } from "../../src/marks/rug.ts";
import { facet } from "../../src/model/facet.ts";
import { type ChartConfig, ChartModel, type Inspection } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type { Snap } from "../../src/spec/spec.ts";

const SECOND = 1000;

function build(config: ChartConfig) {
  // With the compilers of line features, which continuity breaks paths with.
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    ...staticCompilers(),
  );
  model.setSize(600, 300, 1);
  model.scene(estimateText);
  return model;
}

/** The frame of the chart's one panel. */
const frameOf = (model: ChartModel) => model.inspectorOf("")!.frame;

/** Inspects at `time` along x, halfway down the plot. */
function at(model: ChartModel, time: number, snap?: Snap): Inspection | undefined {
  const { x, plot } = frameOf(model);
  return model.inspect(x.map(time), plot.y + plot.height / 2, undefined, undefined, snap);
}

/** What each point read is: its series' label and its row's time. */
function read(model: ChartModel, inspection: Inspection | undefined) {
  if (!inspection || inspection.axis === "item") return inspection;
  const { x } = frameOf(model);
  return Object.fromEntries(inspection.points.map((p) => [p.label, Math.round(x.invert(p.px))]));
}

/**
 * Two services sampled at their own times (A7): auth on the minute, api
 * at 20 s, 70 s, and 200 s; api's line breaks where it waits longer than a
 * minute, between 70 s and 200 s.
 */
const seconds = (...values: number[]) => time(values.map((s) => s * SECOND));
const auth = table({ t: seconds(0, 60, 120, 180), v: [1, 2, 3, 4] });
const api = table({ t: seconds(20, 70, 200), v: [5, 6, 7] });

function services(inspection: NonNullable<ChartConfig["inspection"]>, gaps = false) {
  return build({
    marks: [
      line(auth, { x: "t", y: "v", label: "auth" }),
      line(api, {
        x: "t",
        y: "v",
        label: "api",
        ...(gaps && { continuity: { maxGap: { milliseconds: 60 * SECOND } } }),
      }),
    ],
    inspection,
  });
}

describe("snap", () => {
  it('"shared" reads every series at the value nearest the pointer any series has', () => {
    const model = services({ mode: "nearest-x" });
    const inspection = at(model, 67 * SECOND);
    // api's 70 s is nearer than auth's 60 s, and auth has no point there.
    expect(read(model, inspection)).toEqual({ api: 70 * SECOND });
    expect(inspection?.value).toBe(70 * SECOND);
    expect(inspection?.axis !== "item" && inspection?.position).toBeCloseTo(
      frameOf(model).x.map(70 * SECOND),
    );
    // The chart's own snap is "shared": the same as asking for it.
    expect(at(model, 67 * SECOND, "shared")).toEqual(inspection);
  });

  it('"each" reads each series\' own nearest point, the crosshair at the pointer', () => {
    const model = services({ mode: "nearest-x", snap: "each" });
    const inspection = at(model, 67 * SECOND);
    expect(read(model, inspection)).toEqual({ auth: 60 * SECOND, api: 70 * SECOND });
    expect(inspection?.value).toBeCloseTo(67 * SECOND, -1);
    expect(inspection?.axis !== "item" && inspection?.position).toBeCloseTo(
      frameOf(model).x.map(67 * SECOND),
    );
  });

  it('"previous" and "next" read each series\' point before or after, the crosshair at the latest or earliest', () => {
    const model = services({ mode: "nearest-x", snap: "previous" });
    const previous = at(model, 67 * SECOND);
    expect(read(model, previous)).toEqual({ auth: 60 * SECOND, api: 20 * SECOND });
    expect(previous?.value).toBe(60 * SECOND);
    const next = at(model, 67 * SECOND, "next");
    expect(read(model, next)).toEqual({ auth: 120 * SECOND, api: 70 * SECOND });
    expect(next?.value).toBe(70 * SECOND);
    expect(next?.axis !== "item" && next?.position).toBeCloseTo(frameOf(model).x.map(70 * SECOND));
    // Before every point, nothing is previous.
    expect(at(model, -1, "previous")).toBeUndefined();
  });
});

describe("within", () => {
  it("bounds each series' point, from the pointer's value, in milliseconds on a time axis (A7)", () => {
    const within = { milliseconds: 30 * SECOND };
    const model = services({ mode: "nearest-x", snap: "each", within });
    // auth's 120 s is 30 s off; api's nearest, 70 s, is 80 s off.
    expect(read(model, at(model, 150 * SECOND))).toEqual({ auth: 120 * SECOND });
    expect(read(model, at(model, 25 * SECOND))).toEqual({ auth: 0, api: 20 * SECOND });
    const previous = services({ mode: "nearest-x", snap: "previous", within });
    // api's previous point, 20 s, is 47 s before.
    expect(read(previous, at(previous, 67 * SECOND))).toEqual({ auth: 60 * SECOND });
  });

  it('bounds the shared value with "shared"', () => {
    const model = services({ mode: "nearest-x", within: 5 * SECOND });
    expect(read(model, at(model, 64 * SECOND))).toEqual({ auth: 60 * SECOND });
    expect(at(model, 40 * SECOND)).toBeUndefined();
  });

  it('bounds "nearest" on screen, in pixels', () => {
    const data = table({ x: [0, 10], y: [0, 10] });
    const inspect = (within: number) => {
      const model = build({
        marks: [point(data, { x: "x", y: "y" })],
        inspection: { mode: "nearest", within: { px: within } },
      });
      const { x, y } = frameOf(model);
      return model.inspect(x.map(10) - 12, y.map(10))?.points.length ?? 0;
    };
    expect(inspect(8)).toBe(0);
    expect(inspect(16)).toBe(1);
  });
});

describe("points at one value", () => {
  it('read the last of them with "previous", the first otherwise', () => {
    const data = table({ x: [0, 5, 5, 10], y: [1, 2, 3, 4] });
    const rowAt = (snap: Snap) => {
      const model = build({
        marks: [line(data, { x: "x", y: "y" })],
        inspection: { mode: "nearest-x", snap },
      });
      return at(model, 5, snap)?.points.map((p) => p.row);
    };
    expect(rowAt("previous")).toEqual([2]);
    expect(rowAt("next")).toEqual([1]);
    expect(rowAt("each")).toEqual([1]);
  });
});

describe("marks along y", () => {
  it('read bins and error bars before or after the pointer with "previous" and "next"', () => {
    const values = table({ v: [1, 3, 3] });
    const ranges = table({ at: [1, 3], low: [0, 0], high: [2, 4] });
    const read = (snap: Snap, marks: ChartConfig["marks"]) => {
      const model = build({ marks, inspection: { mode: "nearest-y", snap } });
      const { y, plot } = frameOf(model);
      const found = model.inspect(plot.x + plot.width / 2, y.map(2), undefined, undefined, snap);
      return found?.points.map((p) => p.value);
    };
    const bins = [histogram(values, { y: "v", bins: [0, 2, 4] })];
    expect(read("previous", bins)).toEqual([1]);
    expect(read("next", bins)).toEqual([2]);
    const bars = [errorbar(ranges, { y: "at", x1: "low", x2: "high" })];
    expect(read("previous", bars)).toEqual([2]);
    expect(read("next", bars)).toEqual([4]);
  });
});

describe("marks with lookups of their own", () => {
  it('read their row before or after the pointer with "previous" and "next"', () => {
    const ticks = table({ v: [0, 10] });
    const rowAt = (snap: Snap, along: "x" | "y") => {
      const model = build({
        marks: [rug(ticks, along === "x" ? { x: "v" } : { y: "v" })],
        inspection: { mode: along === "x" ? "nearest-x" : "nearest-y", snap },
      });
      const { x, y, plot } = frameOf(model);
      const [px, py] =
        along === "x" ? [x.map(5), plot.y + plot.height / 2] : [plot.x + plot.width / 2, y.map(5)];
      return model.inspect(px, py, undefined, undefined, snap)?.points.map((p) => p.row);
    };
    for (const along of ["x", "y"] as const) {
      expect(rowAt("previous", along)).toEqual([0]);
      expect(rowAt("next", along)).toEqual([1]);
    }
  });
});

describe("continuity", () => {
  it("leaves a series nothing to read inside a gap it breaks at, under every snap (A7)", () => {
    for (const snap of ["shared", "each", "previous", "next"] as const) {
      const model = services({ mode: "nearest-x", snap }, true);
      // 75 s is inside api's gap from 70 s to 200 s.
      expect(Object.keys(read(model, at(model, 75 * SECOND)) ?? {})).toEqual(["auth"]);
    }
    const model = services({ mode: "nearest-x", snap: "each" }, true);
    expect(read(model, at(model, 67 * SECOND))).toEqual({ auth: 60 * SECOND, api: 70 * SECOND });
    // Whatever `within` keeps: api's 70 s is 5 s off, and still in the gap.
    const near = services(
      { mode: "nearest-x", snap: "each", within: { milliseconds: 40 * SECOND } },
      true,
    );
    expect(read(near, at(near, 75 * SECOND))).toEqual({ auth: 60 * SECOND });
  });

  it("reads a gap's ends out of view too, which still break the series", () => {
    const model = build({
      marks: [
        line(api, {
          x: "t",
          y: "v",
          label: "api",
          continuity: { maxGap: { milliseconds: 60 * SECOND } },
        }),
      ],
      inspection: { mode: "nearest-x", snap: "each" },
      x: { domain: [75 * SECOND, 210 * SECOND] },
    });
    // 70 s, where the gap starts, is out of view; 80 s is still in the gap.
    expect(at(model, 80 * SECOND)).toBeUndefined();
    expect(read(model, at(model, 205 * SECOND))).toEqual({ api: 200 * SECOND });
  });

  it("bounds what a mark's own lookup finds by within", () => {
    const data = table({ x: [0, 10], y: [1, 1] });
    const model = build({
      marks: [
        line(table({ x: [0, 10], y: [0, 0] }), { x: "x", y: "y" }),
        point(data, { x: "x", y: "y" }),
      ],
      inspection: { mode: "nearest-x", snap: "each", within: 1 },
    });
    const { x, plot } = frameOf(model);
    expect(model.inspect(x.map(5), plot.y + plot.height / 2)).toBeUndefined();
    expect(model.inspect(x.map(9.5), plot.y + plot.height / 2)?.points).toHaveLength(2);
  });
});

describe("inspect: false", () => {
  it("leaves the mark out of choosing the chart's mode", () => {
    const data = table({ x: [0, 1, 2], a: [1, 2, 3], b: [3, 2, 1] });
    const model = build({
      marks: [
        line(data, { x: "x", y: ["a", "b"] }),
        point(data, { x: "x", y: "a", inspect: false }),
      ],
    });
    expect(model.inspectorOf("")!.mode).toBe("nearest-x");
  });

  it("leaves a mark's points out of what inspection reads", () => {
    const data = table({ x: [0, 1, 2], y: [1, 2, 3] });
    const marks = (inspect: boolean) => [
      line(data, { x: "x", y: "y", label: "line" }),
      point(data, { x: "x", y: "y", label: "dots", inspect }),
    ];
    for (const mode of ["nearest-x", "nearest"] as const) {
      const shown = build({ marks: marks(true), inspection: { mode } });
      const left = build({ marks: marks(false), inspection: { mode } });
      const { x, y } = frameOf(left);
      const labels = (model: ChartModel) =>
        model.inspect(x.map(1), y.map(2))?.points.map((p) => p.label);
      expect(labels(shown)).toContain("dots");
      expect(labels(left)).toEqual(["line"]);
    }
  });
});

describe("panels with categories of their own", () => {
  it("read the category at the pointer, and either side of it, along y", () => {
    const data = table({ c: ["a", "b", "c"], v: [1, 2, 3], g: ["eu", "us", "us"] });
    const model = build({
      marks: [line(data, { x: "v", y: "c" })],
      facet: facet("g"),
      y: { scope: "panel" },
      inspection: { mode: "nearest-y" },
    });
    const us = model.panels()[1]!;
    expect(us.y.categories).toEqual(["b", "c"]);
    const rowsAt = (category: string, snap: Snap) => {
      const py = us.y.map(us.y.categories!.indexOf(category));
      const found = model.inspect(us.plot.x + us.plot.width / 2, py, undefined, us.key, snap);
      return found?.points.map((p) => p.row);
    };
    expect(rowsAt("c", "shared")).toEqual([2]);
    expect(rowsAt("c", "each")).toEqual([2]);
    expect(rowsAt("b", "previous")).toEqual([1]);
    expect(rowsAt("b", "next")).toEqual([1]);
  });

  it("read the category at the pointer, and either side of it, along x", () => {
    const data = table({ c: ["a", "b", "c"], v: [1, 2, 3], g: ["eu", "us", "us"] });
    const model = build({
      marks: [line(data, { x: "c", y: "v" })],
      facet: facet("g"),
      x: { scope: "panel" },
    });
    const us = model.panels()[1]!;
    expect(us.x.categories).toEqual(["b", "c"]);
    // In a band, past its middle (`by` of its width) toward the side read.
    const rowsAt = (category: string, snap: Snap, by = 0) => {
      const px = us.x.map(us.x.categories!.indexOf(category)) + by * us.x.bandwidth!;
      const found = model.inspect(px, us.plot.y + us.plot.height / 2, undefined, us.key, snap);
      return found?.points.map((p) => p.row);
    };
    for (const [category, row] of [
      ["b", 1],
      ["c", 2],
    ] as const) {
      expect(rowsAt(category, "shared")).toEqual([row]);
      expect(rowsAt(category, "each")).toEqual([row]);
      expect(rowsAt(category, "previous", 0.25)).toEqual([row]);
      expect(rowsAt(category, "next", -0.25)).toEqual([row]);
    }
  });
});

describe("unsorted series", () => {
  it("read nothing inside a gap their path leaves, but a point at the value", () => {
    // Drawn in their order, 0 to 100 and 100 to 10 are too far apart: three dots.
    const data = table({ x: [0, 100, 10], y: [1, 1, 1] });
    const model = build({
      marks: [line(data, { x: "x", y: "y", continuity: { maxGap: 20 } })],
    });
    for (const snap of ["shared", "each"] as const) {
      expect(at(model, 90, snap)).toBeUndefined();
      expect(at(model, 10, snap)?.points.map((p) => p.row)).toEqual([2]);
    }
    // Joined, the path crosses 90.
    const joined = build({ marks: [line(data, { x: "x", y: "y" })] });
    expect(at(joined, 90)?.points.map((p) => p.row)).toEqual([1]);
  });

  it("read their nearest end past their points, and where any segment crosses the value", () => {
    const rowsAt = (x: number[], value: number) => {
      const model = build({
        marks: [
          line(table({ x, y: x.map(() => 1) }), { x: "x", y: "y", continuity: { maxGap: 50 } }),
        ],
        x: { domain: [-5, 50] },
      });
      return at(model, value)?.points.map((p) => p.row);
    };
    // Past 10, the last point drawn, as an ascending series reads it.
    expect(rowsAt([10, 0], 12)).toEqual([0]);
    // 42 is between 45 and 0, which are joined; 40, its nearest point, ends there.
    expect(rowsAt([45, 0, 40], 42)).toEqual([2]);
  });
});
