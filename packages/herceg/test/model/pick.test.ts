// The picker (model/pick.ts): the topmost item the frame on screen drew
// within reach of a point. Marks are tested in paint order, each kind by
// its reach (points by radius, lines by stroke, bars and regions by
// containment), within the clip, and paths resolve to the observations
// they draw.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { candlestick } from "../../src/marks/candlestick.ts";
import { custom } from "../../src/marks/custom.ts";
import type { DrawnPart } from "../../src/marks/drawn.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { line } from "../../src/marks/line.ts";
import type { Mark } from "../../src/marks/mark.ts";
import { point } from "../../src/marks/point.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { violin } from "../../src/marks/violin.ts";
import { facet } from "../../src/model/facet.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { Picker } from "../../src/model/pick.ts";
import type {
  LabelsGeometry,
  LineGeometry,
  PointGeometry,
  RectGeometry,
  RuleGeometry,
} from "../../src/scene/scene.ts";
import { pickKit } from "../helpers/picker.ts";
import { xScale, yScale } from "../helpers/scales.ts";
import { setViewport } from "../helpers/views.ts";

function build(config: ChartConfig) {
  const model = new ChartModel({ locale: "en-US", timeZone: "UTC", ...config });
  model.setSize(600, 300, 1);
  model.scene(estimateText);
  return model;
}

const picker = new Picker(pickKit);

/** What is picked at (x, y) with `slop` pixels of reach (4 for a mouse, 8 for touch): its mark and row. */
function pickAt(model: ChartModel, x: number, y: number, slop = 4) {
  const picked = picker.pick(model, { x, y, slop });
  return picked && { mark: picked.key, row: rowOfPart(picked.item.part) };
}

const rowOfPart = (part: Exclude<DrawnPart, { kind: "trace" }>) =>
  part.kind === "row" ? part.position : part.key;

/** The pixel (x, y) of data (x, y) in the chart's one panel. */
function pixel(model: ChartModel, x: number, y: number): [number, number] {
  return [xScale(model)!.map(x), yScale(model)!.map(y)];
}

/** The center of bar `i` of the chart's first mark, and its top. */
function barAt(model: ChartModel, i: number): [number, number] {
  const { rects } = model.drawnMarks()[0]!.geometry[0] as RectGeometry;
  return [rects[i * 4]! + rects[i * 4 + 2]! / 2, rects[i * 4 + 1]!];
}

describe("reach", () => {
  it("reaches points within their radius plus 4 px, 8 px for touch", () => {
    const data = table({ x: [0, 5, 10], y: [0, 5, 10] });
    const model = build({ marks: [point(data, { x: "x", y: "y" })] });
    const [px, py] = pixel(model, 5, 5);
    // The glyph's reach: its radius, and half its outline.
    const mark = model.config.marks[0] as Mark;
    const radius = mark.reach!(1, model.drawnMarks()[0]!.series[0]!);
    expect(pickAt(model, px + radius + 3, py)).toEqual({ mark: 0, row: 1 });
    expect(pickAt(model, px + radius + 6, py)).toBeUndefined();
    expect(pickAt(model, px + radius + 6, py, 8)).toEqual({ mark: 0, row: 1 });
  });

  it("reaches lines between their vertices, within half the stroke plus 4 px, as their nearer observation", () => {
    const model = build({ marks: [line(table({ x: [0, 10], y: [0, 10] }), { x: "x", y: "y" })] });
    const [x0, y0] = pixel(model, 0, 0);
    const [x1, y1] = pixel(model, 10, 10);
    const { strokeWidth } = model.drawnMarks()[0]!.geometry[0] as LineGeometry;
    // Off the segment, at right angles to it.
    const length = Math.hypot(x1 - x0, y1 - y0);
    const [nx, ny] = [(y1 - y0) / length, -(x1 - x0) / length];
    const along = (t: number, off: number) =>
      pickAt(model, x0 + (x1 - x0) * t + nx * off, y0 + (y1 - y0) * t + ny * off);
    expect(along(0.3, strokeWidth / 2 + 3)).toEqual({ mark: 0, row: 0 });
    expect(along(0.7, strokeWidth / 2 + 3)).toEqual({ mark: 0, row: 1 });
    expect(along(0.5, strokeWidth / 2 + 5)).toBeUndefined();
  });

  it("reaches glyphs by their edges: inside a big bubble, before a smaller point whose center is nearer", () => {
    const sized = (x: number[]) =>
      build({
        marks: [point(table({ x, y: [5, 5], size: [1, 100] }), { x: "x", y: "y", size: "size" })],
        x: { domain: [0, 100] },
      });
    const probe = sized([40, 60]);
    const mark = probe.config.marks[0] as Mark;
    const series = probe.drawnMarks()[0]!.series[0]!;
    const [small, big] = [mark.reach!(0, series), mark.reach!(1, series)];
    // Apart by more than both reach, by less than twice the bubble's.
    const apart = (small + big - 1 + 2 * big - 2) / 2;
    const unit = xScale(probe)!.map(1) - xScale(probe)!.map(0);
    const model = sized([40, 40 + apart / unit]);
    const [bx, by] = pixel(model, 40 + apart / unit, 5);
    // A pixel inside the bubble's edge, toward the small point.
    const [qx, qy] = [bx - big + 1, by];
    expect(Math.abs(qx - pixel(model, 40, 5)[0])).toBeLessThan(big - 1);
    expect(pickAt(model, qx, qy)).toEqual({ mark: 0, row: 1 });
  });

  it("reaches points where they are drawn, spread across their band", () => {
    const strip = table({ day: ["thu", "thu", "thu"], tip: [1, 2, 3] });
    const model = build({
      marks: [point(strip, { x: "day", y: "tip", jitter: { width: 1, seed: 3 } })],
    });
    const { coords } = model.drawnMarks()[0]!.geometry[0] as PointGeometry;
    for (const row of [0, 1, 2]) {
      const [px, py] = [coords[row * 2]!, coords[row * 2 + 1]!];
      const picked = picker.pick(model, { x: px, y: py, slop: 4 })!;
      expect(rowOfPart(picked.item.part)).toBe(row);
      // Its box is centered on the point drawn, not on its band.
      const { x, y, width, height } = picked.item.box;
      expect(x + width / 2).toBeCloseTo(px, 3);
      expect(y + height / 2).toBeCloseTo(py, 3);
    }
  });

  it("reaches an outlined area's edge as a line, and its fill inside it", () => {
    const data = table({ x: [0, 10], y: [5, 5] });
    const at = (line: boolean) => {
      const model = build({
        marks: [area(data, { x: "x", y: "y", line })],
        y: { domain: [0, 10] },
      });
      const [px, py] = pixel(model, 5, 5);
      return [pickAt(model, px, py - 3), pickAt(model, px, py + 20)];
    };
    expect(at(true)).toEqual([
      { mark: 0, row: 0 },
      { mark: 0, row: 0 },
    ]);
    expect(at(false)).toEqual([undefined, { mark: 0, row: 0 }]);
  });

  it("reaches every run an area fills, and the dots it draws isolated points as", () => {
    // Two runs over the same x, filled to 2 and to 8.
    const runs = table({ x: [0, 10, Number.NaN, 0, 10], y: [2, 2, Number.NaN, 8, 8] });
    const model = build({
      marks: [area(runs, { x: "x", y: "y", line: false })],
      y: { domain: [0, 10] },
    });
    const [px, py] = pixel(model, 5, 6);
    expect(pickAt(model, px, py)).toEqual({ mark: 0, row: 3 });
    // Filled as drawn, by the nonzero rule: a run doubling back fills under
    // both its edges; two runs drawn opposite ways cancel.
    const back = build({
      marks: [area(table({ x: [0, 10, 0], y: [2, 2, 8] }), { x: "x", y: "y", line: false })],
      y: { domain: [0, 10] },
    });
    expect(pickAt(back, ...pixel(back, 5, 4))?.mark).toBe(0);
    const opposite = build({
      marks: [
        area(table({ x: [0, 10, Number.NaN, 10, 0], y: [8, 8, Number.NaN, 8, 8] }), {
          x: "x",
          y: "y",
          line: false,
        }),
      ],
      y: { domain: [0, 10] },
    });
    expect(pickAt(opposite, ...pixel(opposite, 5, 4))).toBeUndefined();
    const one = build({
      marks: [area(table({ x: [5], y: [5] }), { x: "x", y: "y", line: false })],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
    });
    const [dx, dy] = pixel(one, 5, 5);
    expect(pickAt(one, dx, dy)).toEqual({ mark: 0, row: 0 });
    expect(pickAt(one, dx + 20, dy)).toBeUndefined();
  });

  it("reaches an area along y across y, its rows in order or not", () => {
    const model = build({
      marks: [
        area(table({ x: [5, 5, 5], y: [0, 10, 5] }), { x: "x", y: "y", orient: "y", line: false }),
      ],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
    });
    expect(pickAt(model, ...pixel(model, 2, 2))?.mark).toBe(0);
    expect(pickAt(model, ...pixel(model, 8, 2))).toBeUndefined();
  });

  it("reaches a histogram's outline along y across y", () => {
    for (const element of ["step", "poly"] as const) {
      const model = build({
        marks: [histogram(table({ v: [1, 3, 5] }), { y: "v", bins: [0, 2, 4, 6], element })],
      });
      expect(pickAt(model, ...pixel(model, 0.5, 3))?.mark).toBe(0);
    }
  });

  it("names the row nearer the query of the segment of an unordered area it is under", () => {
    const model = build({
      marks: [area(table({ x: [0, 10, 0], y: [2, 2, 8] }), { x: "x", y: "y", line: false })],
      y: { domain: [0, 10] },
    });
    expect(pickAt(model, ...pixel(model, 5, 4))).toEqual({ mark: 0, row: 1 });
  });

  it("reaches a custom mark's points within a few pixels", () => {
    const model = build({
      marks: [
        custom(table({ x: [0, 5, 10], y: [0, 5, 10] }), {
          x: "x",
          y: "y",
          draw({ series, x, y, circle }) {
            for (const s of series)
              for (let i = 0; i < s.length; i++) circle(x(s.x[i]!), y(s.y[i]!), 3);
          },
        }),
      ],
    });
    const [px, py] = pixel(model, 5, 5);
    expect(pickAt(model, px + 6, py)).toEqual({ mark: 0, row: 1 });
    expect(pickAt(model, px + 9, py)).toBeUndefined();
  });

  it("reaches a curve as drawn, within a quarter pixel, however large", () => {
    const model = new ChartModel({
      locale: "en-US",
      timeZone: "UTC",
      marks: [line(table({ x: [0, 1, 2], y: [0, 10, 0] }), { x: "x", y: "y", curve: "monotone" })],
      // Room above the peak, which the curve bends under.
      y: { domain: [0, 11] },
    });
    model.setSize(1920, 1080, 1);
    model.scene(estimateText);
    const { path, strokeWidth } = model.drawnMarks()[0]!.geometry[0] as LineGeometry;
    const { coords, controls } = path;
    // The first segment's curve, and a flattening of it into 16 chords.
    const [ax, ay, bx, by] = [coords[0]!, coords[1]!, coords[2]!, coords[3]!];
    const [c1x, c1y, c2x, c2y] = [controls[4]!, controls[5]!, controls[6]!, controls[7]!];
    const at = (t: number): [number, number] => {
      const u = 1 - t;
      const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      return [a * ax + b * c1x + c * c2x + d * bx, a * ay + b * c1y + c * c2y + d * by];
    };
    // Where the chords stray furthest: midway along one, off its chord.
    let far = { t: 0, by: 0 };
    for (let k = 0; k < 16; k++) {
      const t = (k + 0.5) / 16;
      const [p, q] = [at(k / 16), at((k + 1) / 16)];
      const [mx, my] = at(t);
      const off = Math.hypot(mx - (p[0] + q[0]) / 2, my - (p[1] + q[1]) / 2);
      if (off > far.by) far = { t, by: off };
    }
    expect(far.by).toBeGreaterThan(1);
    // Just within reach of the curve, on its outer side.
    const [mx, my] = at(far.t);
    const [p, q] = [at(far.t - 1 / 32), at(far.t + 1 / 32)];
    const [chordX, chordY] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const length = Math.hypot(mx - chordX, my - chordY);
    const reach = strokeWidth / 2 + 3.8;
    const [qx, qy] = [mx + ((mx - chordX) / length) * reach, my + ((my - chordY) / length) * reach];
    const picked = picker.pick(model, { x: qx, y: qy, slop: 4 });
    expect(picked?.key).toBe(0);
  });

  it("reaches bars and regions inside them, and rules within 4 px", () => {
    const model = build({
      marks: [
        bar(table({ c: ["a", "b"], v: [4, 8] }), { x: "c", y: "v" }),
        rule({ y: 9 }),
        region({ y1: 10, y2: 12 }),
      ],
      y: { domain: [0, 12] },
    });
    const [middle, top] = barAt(model, 1);
    expect(pickAt(model, middle, top + 2)).toEqual({ mark: 0, row: 1 });
    expect(pickAt(model, middle, top - 3)).toBeUndefined();
    const [, ruled] = pixel(model, 0, 9);
    expect(pickAt(model, middle, ruled + 4)?.mark).toBe(1);
    expect(pickAt(model, middle, ruled + 6)).toBeUndefined();
    expect(pickAt(model, middle, pixel(model, 0, 11)[1])?.mark).toBe(2);
  });
});

describe("strokes", () => {
  it("are reached as the clip shows them: not at all when wholly clipped away", () => {
    const at = (y: number) => {
      const model = build({
        marks: [line(table({ x: [0, 10], y: [y, y] }), { x: "x", y: "y", strokeWidth: 1 })],
        y: { domain: [0, 10] },
      });
      const { plot } = model.panels()[0]!;
      return pickAt(model, plot.x + plot.width / 2, plot.y + 0.2);
    };
    // Its middle 2.6 px above the plot, the whole stroke is outside it.
    expect(at(10.1)).toBeUndefined();
    // Its middle on the plot's edge, half of it shows.
    expect(at(10)).toEqual({ mark: 0, row: 0 });
  });

  it("reach a dot at the clip's corner only where it shows, round as it is", () => {
    const at = (x: number, y: number) => {
      const model = build({
        marks: [line(table({ x: [x], y: [y] }), { x: "x", y: "y", strokeWidth: 10 })],
        x: { domain: [0, 10] },
        y: { domain: [0, 10] },
      });
      const { plot } = model.panels()[0]!;
      return pickAt(model, plot.x + 1, plot.y + 1);
    };
    // Off the corner diagonally: within the square around the plot, not the round one.
    expect(at(-0.07, 10.15)).toBeUndefined();
    // On the corner, a quarter of it shows.
    expect(at(0, 10)).toEqual({ mark: 0, row: 0 });
  });

  it("are not reached where they have no width, which draws nothing", () => {
    const model = build({
      marks: [
        point(table({ x: [5], y: [5] }), { x: "x", y: "y" }),
        line(table({ x: [0, 10], y: [5, 5] }), { x: "x", y: "y", strokeWidth: 0 }),
      ],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
    });
    expect(pickAt(model, ...pixel(model, 5, 5))).toEqual({ mark: 0, row: 0 });
  });

  it("leave a rule's label reached, drawn whatever its line's width", () => {
    const model = build({
      marks: [rule({ y: 5, strokeWidth: 0, label: "g" })],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
    });
    const { x1, x2, y1 } = model.drawnMarks()[0]!.geometry[0] as RuleGeometry;
    // On the label, at the right end above the line; not on the line away from it.
    expect(pickAt(model, x2 - 7, y1 - 6)?.mark).toBe(0);
    expect(pickAt(model, (x1 + x2) / 2, y1)).toBeUndefined();
  });
});

describe("text", () => {
  it("is reached on every line of styled text, its point placing the first", () => {
    const model = build({
      marks: [
        text({ x: 5, y: 5, label: { text: "First\nMiddle\nLast", style: { fontSize: 20 } } }),
      ],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
    });
    // Styled, it is a text item, whose point is its first line's middle.
    const { x, y, paint } = (model.drawnMarks()[0]!.geometry[0] as LabelsGeometry).items[0]!;
    for (const line of [0, 1, 2])
      expect(pickAt(model, x, y + line * paint.lineHeight)?.mark).toBe(0);
    expect(pickAt(model, x, y + 3 * paint.lineHeight)).toBeUndefined();
  });
});

describe("order", () => {
  const data = table({ c: ["a"], v: [4] });

  it("takes what is painted last: marks as listed, then by zIndex", () => {
    const listed = build({
      marks: [bar(data, { x: "c", y: "v" }), point(data, { x: "c", y: "v" })],
    });
    const [at, py] = barAt(listed, 0);
    expect(pickAt(listed, at, py)?.mark).toBe(1);
    const lifted = build({
      marks: [bar(data, { x: "c", y: "v", zIndex: 1 }), point(data, { x: "c", y: "v" })],
    });
    expect(pickAt(lifted, at, py + 1)?.mark).toBe(0);
  });

  it("passes over marks that leave picking (pick: false)", () => {
    const model = build({
      marks: [bar(data, { x: "c", y: "v" }), point(data, { x: "c", y: "v", pick: false })],
    });
    const [at, py] = barAt(model, 0);
    expect(pickAt(model, at, py + 1)?.mark).toBe(0);
  });

  it("takes a line over a region it crosses, and the region under it off the line", () => {
    const model = build({
      marks: [region({ x1: 2, x2: 6 }), line(table({ x: [0, 10], y: [5, 5] }), { x: "x", y: "y" })],
    });
    const [px, py] = pixel(model, 4, 5);
    expect(pickAt(model, px, py)).toEqual({ mark: 1, row: 0 });
    expect(pickAt(model, px, py + 40)?.mark).toBe(0);
    expect(pickAt(model, pixel(model, 8, 5)[0], py + 40)).toBeUndefined();
  });
});

describe("the rule", () => {
  // The nearest stroke or point within reach, down to the first fill the
  // point is inside, which covers what is painted under it; ties to the
  // topmost.
  /** A chart of x and y from 0 to 10, without a legend, so that charts of other marks place alike. */
  const chart = (marks: ChartConfig["marks"]) =>
    build({
      marks,
      legend: false,
      x: { domain: [0, 10], nice: false },
      y: { domain: [0, 10], nice: false },
    });
  /** A horizontal line at data value `y`. */
  const flat = (y: number) => line(table({ x: [0, 10], y: [y, y] }), { x: "x", y: "y" });
  // Charts of these marks share its plot: their axes are alike.
  const probe = chart([flat(5)]);
  /** The pixel of (4, 5), where the tests point. */
  const [px, py] = pixel(probe, 4, 5);
  /** The data value drawn `pixels` below the point (above it for a negative number). */
  const below = (pixels: number) => yScale(probe)!.invert(py + pixels);
  /** What is picked at (x, y): its mark, row, and series key. */
  const at = (model: ChartModel, x: number, y: number) => {
    const picked = picker.pick(model, { x, y, slop: 4 });
    const { part } = picked?.item ?? {};
    return (
      picked && {
        mark: picked.key,
        row: part?.kind === "row" ? part.position : undefined,
        series: picked.series?.key,
      }
    );
  };

  it("takes the line of a crowd the point is on, not one painted over it within reach", () => {
    // Twelve lines of one mark, a pixel and a quarter apart.
    const names = Array.from({ length: 12 }, (_, k) => `s${k}`);
    const crowd = table({
      x: [0, 10],
      ...Object.fromEntries(names.map((name, k) => [name, [below(-1.25 * k), below(-1.25 * k)]])),
    });
    const model = chart([line(crowd, { x: "x", y: names as never })]);
    for (const [k, name] of names.entries())
      expect(at(model, px, py - 1.25 * k)?.series, name).toBe(JSON.stringify([0, name]));
  });

  it("takes the nearer of two lines of two marks, the later painted over the earlier", () => {
    // On the first's pixels, the second 2 px away: the first.
    expect(at(chart([flat(5), flat(below(2))]), px, py)?.mark).toBe(0);
    // Between them, 1 px from one and 3 px from the other.
    const two = chart([flat(5), flat(below(4))]);
    expect(at(two, px, py + 1)?.mark).toBe(0);
    expect(at(two, px, py + 3)?.mark).toBe(1);
  });

  it("ties to the topmost: lines drawn over each other, and glyphs the point is inside", () => {
    const same = chart([flat(5), flat(5)]);
    expect(at(same, px, py)?.mark).toBe(1);
    expect(at(same, px, py + 2)?.mark).toBe(1);
    const dots = chart([
      point(table({ x: [4], y: [5] }), { x: "x", y: "y", radius: 6 }),
      point(table({ x: [4], y: [below(2)] }), { x: "x", y: "y", radius: 6 }),
    ]);
    expect(at(dots, px, py + 1)?.mark).toBe(1);
  });

  it("takes the nearer of two marks' points, whichever is painted later", () => {
    // Glyphs of radius 3, their edges 2 px and 3 px from the point.
    const dots = chart([
      point(table({ x: [4], y: [below(5)] }), { x: "x", y: "y", radius: 3 }),
      point(table({ x: [4], y: [below(-6)] }), { x: "x", y: "y", radius: 3 }),
    ]);
    expect(at(dots, px, py)?.mark).toBe(0);
  });

  it("takes a line over a band within its reach, inside the band too", () => {
    const model = chart([region({ x1: 2, x2: 6 }), flat(5)]);
    expect(at(model, px, py)?.mark).toBe(1);
    expect(at(model, px, py + 2)?.mark).toBe(1);
    expect(at(model, px, py + 30)?.mark).toBe(0);
  });

  it("lets a fill painted over a stroke cover it, and a stroke over a fill reach into it", () => {
    const bars = table({ c: ["a"], v: [6] });
    const under = build({
      marks: [bar(bars, { x: "c", y: "v" }), rule({ y: 4 })],
      y: { domain: [0, 10] },
    });
    const [middle] = barAt(under, 0);
    const over = build({
      marks: [rule({ y: 4 }), bar(bars, { x: "c", y: "v" })],
      y: { domain: [0, 10] },
    });
    const [, ruled] = pixel(over, 0, 4);
    expect(at(over, middle, ruled + 2)?.mark).toBe(1);
    expect(at(over, middle, ruled)?.mark).toBe(1);
    expect(at(under, middle, ruled + 2)?.mark).toBe(1);
    expect(at(under, middle, ruled + 20)?.mark).toBe(0);
  });

  it("reaches an area's outline over its own fill, and covers what is under the fill", () => {
    const top = table({ x: [0, 10], y: [5, 5] });
    // A line under the area, a pixel from the point inside its fill.
    const covered = chart([flat(below(4)), area(top, { x: "x", y: "y" })]);
    expect(at(covered, px, py + 3)?.mark).toBe(1);
    // A line over it: the nearer of it and the outline.
    const reached = chart([area(top, { x: "x", y: "y" }), flat(below(4))]);
    expect(at(reached, px, py + 1)?.mark).toBe(0);
    expect(at(reached, px, py + 3)?.mark).toBe(1);
  });

  it("takes a custom mark's stroke over its own fill, never another mark's line under it", () => {
    // Each row an item: a filled square, then a stroke across it 2 px over the point.
    const rows = table({ x: [4, 4], y: [5, 5] });
    const model = chart([
      flat(below(1)),
      custom(rows, {
        x: "x",
        y: "y",
        draw({ series, x, y, item, rect, line: stroke }) {
          for (const s of series)
            for (let k = 0; k < s.length; k++) {
              const row = s.rowAt(k);
              const [cx, cy] = [x(s.x[row]!), y(s.y[row]!)];
              item(s, row, () =>
                row === 0
                  ? rect(cx - 20, cy - 20, 40, 40, { fill: "#cccccc" })
                  : stroke(cx - 20, cy - 2, cx + 20, cy - 2, { stroke: "#000000" }),
              );
            }
        },
      }),
    ]);
    expect(at(model, px, py)).toMatchObject({ mark: 1, row: 1 });
    // Away from the stroke, inside the square: the square, over the line still.
    expect(at(model, px, py + 10)).toMatchObject({ mark: 1, row: 0 });
    expect(at(chart([flat(below(1))]), px, py)?.mark).toBe(0);
  });

  it("takes a filled custom path on its thick outline's outer half, before a line under it", () => {
    // A square whose top edge is 10 px under the point, its outline 8 px wide.
    const outlined = (lineAt: number) =>
      chart([
        flat(below(lineAt)),
        custom(table({ x: [4], y: [5] }), {
          x: "x",
          y: "y",
          draw({ series, x, y, item, rect }) {
            for (const s of series)
              item(s, s.rowAt(0), () =>
                rect(x(s.x[0]!) - 30, y(s.y[0]!) + 10, 60, 40, {
                  fill: "#cccccc",
                  stroke: "#000000",
                  strokeWidth: 8,
                }),
              );
          },
        }),
      ]);
    // On the outline's outer half, a line a pixel off: the path.
    expect(at(outlined(7), px, py + 8)?.mark).toBe(1);
    // 3 px past the outline, the line a pixel off: the line.
    expect(at(outlined(4), px, py + 3)?.mark).toBe(0);
    // Inside its fill, the line a pixel off under it: the path.
    expect(at(outlined(29), px, py + 30)?.mark).toBe(1);
  });

  it("measures a box plot by what it draws: its box covers, its whiskers are strokes", () => {
    const samples = table({ g: ["a", "a", "a", "a", "a"], v: [1, 4, 5, 6, 9] });
    const boxes = (over: number) =>
      build({
        marks: [boxplot(samples, { x: "g", y: "v" }), rule({ y: over })],
        legend: false,
        y: { domain: [0, 10], nice: false },
      });
    const model = boxes(8);
    const [, ruled] = pixel(model, 0, 8);
    const center = pixel(model, 0, 5)[0];
    // On the whisker, the rule 3 px off: the box plot.
    expect(at(model, center, ruled + 3)?.mark).toBe(0);
    // Beside the whisker, inside the plot's box around it, 3 px from the rule: the rule.
    expect(at(model, center + 8, ruled + 3)?.mark).toBe(1);
    // Inside the box, the rule within reach over it: the rule; far from it, the box.
    const low = boxes(5.5);
    const [, inside] = pixel(low, 0, 5.5);
    expect(at(low, center + 8, inside + 3)?.mark).toBe(1);
    expect(at(low, center + 8, pixel(low, 0, 4.5)[1])?.mark).toBe(0);
    // On the median, the rule 2 px over it: the median, a stroke over the box.
    const [, median] = pixel(model, 0, 5);
    expect(at(boxes(yScale(model)!.invert(median - 2)), center + 8, median)?.mark).toBe(0);
    // Just past the box's side, where its whisker is far: nothing.
    const box = model.drawnMarks()[0]!.geometry.find((g) => g.kind === "rect") as RectGeometry;
    const side = box.rects[0]! + box.rects[2]!;
    expect(at(model, side + 1, pixel(model, 0, 8)[1] + 10)).toBeUndefined();
  });

  it("takes the box plot group whose stroke is nearest, as drawn, in the query's series", () => {
    // A hundred groups, a few pixels apart: beside group 0's box, at its whisker's height.
    const groups = Array.from({ length: 100 }, (_, i) => `g${String(i).padStart(2, "0")}`);
    const samples = table({
      g: groups.flatMap((g) => [g, g, g, g, g]),
      v: groups.flatMap((_, i) => (i === 1 ? [1, 7, 8, 9, 9] : [1, 3, 5, 7, 9])),
    });
    const model = build({
      marks: [boxplot(samples, { x: "g", y: "v" })],
      legend: false,
      y: { domain: [0, 10], nice: false },
    });
    const { rects } = model.drawnMarks()[0]!.geometry[0] as RectGeometry;
    const center = rects[0]! + rects[2]! / 2;
    const [, y8] = pixel(model, 0, 8);
    // Group 1's box edge, nearer than group 0's whisker (half its stroke off).
    const edge = rects[4]!;
    const picked = picker.pick(model, { x: center + 2.6, y: y8, slop: 4 });
    expect(picked?.item.names).toEqual(["g01"]);
    expect(picked?.item.distance).toBeCloseTo(edge - (center + 2.6) - 0.75, 2);
    // Nearer group 0's whisker: group 0.
    expect(picker.pick(model, { x: center + 1, y: y8, slop: 4 })?.item.names).toEqual(["g00"]);
    // A query for a series of none of the mark's finds nothing of it.
    expect(picker.pick(model, { x: center, y: y8, slop: 4, series: "none" })).toBeUndefined();
  });

  it("picks what a zoomed box plot shows of its box and whiskers", () => {
    const samples = table({ g: ["a", "a", "a", "a", "a"], v: [1, 3, 5, 7, 9] });
    const zoomed = (y: [number, number]) => {
      const model = build({ marks: [boxplot(samples, { x: "g", y: "v" })], legend: false });
      setViewport(model, { y });
      model.scene(estimateText);
      return model;
    };
    // The box's middle out of view: its visible inside, beside the center.
    const inBox = zoomed([6, 8]);
    const center = pixel(inBox, 0, 5)[0];
    expect(at(inBox, center + 20, pixel(inBox, 0, 6.6)[1])?.mark).toBe(0);
    // The whisker's middle out of view: its visible part.
    const whisker = zoomed([8.2, 9.2]);
    expect(at(whisker, center, pixel(whisker, 0, 8.5)[1])?.mark).toBe(0);
  });

  it("covers what a violin holds, its outline, whisker, and median dot strokes over it", () => {
    const samples = table({ g: ["a", "a", "a", "a", "a"], v: [1, 3, 5, 7, 9] });
    // A line at 4 under the violin, and a rule over it.
    const violins = (over: number) =>
      build({
        marks: [
          line(table({ g: ["a", "a"], y: [4, 4] }), { x: "g", y: "y" }),
          violin(samples, { x: "g", y: "v" }),
          rule({ y: over }),
        ],
        legend: false,
        y: { domain: [0, 10], nice: false },
      });
    const model = violins(0.5);
    const [center, median] = pixel(model, 0, 5);
    const [, low] = pixel(model, 0, 4);
    const above = (y: number, pixels: number) => yScale(model)!.invert(y - pixels);
    // On the median's dot, the rule 2 px over it: the violin; on its inner
    // box, which covers its whisker, the rule.
    expect(at(violins(above(median, 2)), center, median)?.mark).toBe(1);
    const [, inBox] = pixel(model, 0, 6);
    expect(at(violins(above(inBox, 2)), center, inBox)?.mark).toBe(2);
    // Inside its body, away from its inner box: the violin over the line;
    // with the rule 2 px over, the rule.
    expect(at(model, center + 30, low)?.mark).toBe(1);
    expect(at(violins(above(low, 2)), center + 30, low)?.mark).toBe(2);
  });

  it("names a box plot's outlier for its own group beside a narrow neighbour", () => {
    // 125 groups 4.45 px apart; g010's outlier at 30, the others' whiskers reaching 35.
    const groups = Array.from({ length: 125 }, (_, i) => `g${String(i).padStart(3, "0")}`);
    const samples = table({
      g: groups.flatMap((g) => Array.from({ length: 10 }, () => g)),
      v: groups.flatMap((_, i) =>
        i === 10 ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 30] : [1, 4, 8, 12, 16, 20, 24, 28, 30, 35],
      ),
    });
    const model = build({
      marks: [boxplot(samples, { x: "g", y: "v" })],
      legend: false,
      y: { domain: [0, 40], nice: false },
    });
    const dots = model.drawnMarks()[0]!.geometry.find((g) => g.kind === "point") as PointGeometry;
    const [dx, dy] = [dots.coords[0]!, dots.coords[1]!];
    const picked = picker.pick(model, { x: dx + 2.4, y: dy, slop: 4 });
    expect(picked?.item.names).toEqual(["g010"]);
  });

  it("covers a notched box's inside, upright or lying", () => {
    const samples = table({
      g: Array.from({ length: 40 }, () => "a"),
      v: Array.from({ length: 40 }, (_, i) => i % 10),
    });
    for (const horizontal of [false, true]) {
      const marks = [
        rule(horizontal ? { x: 4 } : { y: 4 }),
        boxplot(
          samples,
          horizontal ? { x: "v", y: "g", notch: true } : { x: "g", y: "v", notch: true },
        ),
      ];
      const model = build({ marks, legend: false });
      const [px, py] = horizontal ? pixel(model, 4, 0) : pixel(model, 0, 4);
      // 20 px beside the box's center, a pixel past the rule under it: the box.
      const [x, y] = horizontal ? [px + 1, py + 20] : [px + 20, py + 1];
      expect(at(model, x, y)?.mark, horizontal ? "lying" : "upright").toBe(1);
    }
  });

  it("covers what a falling candle's body hides: its wick is no stroke inside it", () => {
    const prices = table({ t: [0, 1, 2], o: [7, 7, 7], h: [9, 9, 9], l: [1, 1, 1], c: [3, 3, 3] });
    const candles = (over: number) =>
      build({
        marks: [
          candlestick(prices, { x: "t", open: "o", high: "h", low: "l", close: "c" }),
          rule({ y: over }),
        ],
        legend: false,
        y: { domain: [0, 10], nice: false },
      });
    const model = candles(5);
    const [cx, y5] = pixel(model, 1, 5);
    // In the body, the rule 2 px off over it: the rule, not the wick under the body.
    const near = candles(yScale(model)!.invert(y5 - 2));
    expect(at(near, cx, y5)?.mark).toBe(1);
    // Far from the rule, the candle.
    expect(at(candles(9.5), cx, y5)?.mark).toBe(0);
    // A rising candle painted over it: its wick, on the point, over the rule 2 px off.
    const rising = table({ t: [1], o: [2], h: [9], l: [1], c: [4] });
    const over = build({
      marks: [
        candlestick(prices, { x: "t", open: "o", high: "h", low: "l", close: "c" }),
        candlestick(rising, { x: "t", open: "o", high: "h", low: "l", close: "c" }),
        rule({ y: yScale(model)!.invert(y5 - 2) }),
      ],
      legend: false,
      x: { domain: [0, 2], nice: false },
      y: { domain: [0, 10], nice: false },
    });
    const [wick] = pixel(over, 1, 5);
    expect(at(over, wick, y5)?.mark).toBe(1);
  });

  it("reaches a hollow candle's body at its outline, its inside picking what is under it", () => {
    const rising = table({ t: [4], o: [2], h: [9], l: [1], c: [8] });
    const model = chart([
      flat(5),
      candlestick(rising, { x: "t", open: "o", high: "h", low: "l", close: "c" }),
    ]);
    const [cx, y5] = pixel(model, 4, 5);
    expect(at(model, cx, y5)?.mark).toBe(0);
    expect(at(model, cx, pixel(model, 4, 8)[1])?.mark).toBe(1);
  });

  it("reaches a rectangle's outline on each of its sides", () => {
    const bars = table({ c: ["a"], v: [6] });
    const model = build({
      marks: [bar(bars, { x: "c", y: "v", stroke: "#000000", strokeWidth: 6 })],
      legend: false,
      y: { domain: [-4, 10], nice: false },
    });
    const { rects } = model.drawnMarks()[0]!.geometry[0] as RectGeometry;
    const [x0, y0, w, h] = [rects[0]!, rects[1]!, rects[2]!, rects[3]!];
    const [cx, cy] = [x0 + w / 2, y0 + h / 2];
    // 2 px past each side's edge, within the outline's outer half and the reach.
    for (const [x, y] of [
      [cx, y0 - 4],
      [x0 + w + 4, cy],
      [cx, y0 + h + 4],
      [x0 - 4, cy],
    ] as const)
      expect(at(model, x, y)?.mark, `${x} ${y}`).toBe(0);
  });

  it("leaves fills with pick: false covering nothing", () => {
    const model = chart([flat(5), region({ x1: 2, x2: 6, pick: false })]);
    expect(at(model, px, py + 2)?.mark).toBe(0);
    expect(at(model, px, py + 30)).toBeUndefined();
  });

  it("takes a custom shape the point is inside before one beside it, and one beside it where none holds it", () => {
    // Two squares 20 px wide 3 px apart; the later one's edge 2 px from a point inside the earlier.
    const squares = (gap: number) =>
      custom(table({ x: [4, 4], y: [5, 5] }), {
        x: "x",
        y: "y",
        draw({ series, x, y, item, rect }) {
          for (const s of series)
            for (let k = 0; k < s.length; k++) {
              const row = s.rowAt(k);
              const left = x(s.x[row]!) + (row === 0 ? -20 : gap);
              item(s, row, () => rect(left, y(s.y[row]!) - 10, 20, 20));
            }
        },
      });
    const model = chart([squares(3)]);
    expect(at(model, px - 1, py)).toMatchObject({ row: 0 });
    // Between them: the nearer.
    expect(at(model, px + 2.5, py)).toMatchObject({ row: 1 });
    // Beside a square, a line farther off: the square; nearer, the line.
    expect(at(chart([flat(below(3)), squares(3)]), px + 1, py)).toMatchObject({ mark: 1, row: 0 });
    expect(at(chart([squares(3), flat(below(0.5))]), px + 1.5, py)?.mark).toBe(1);
  });
});

describe("paths", () => {
  it("resolve in a panel of categories of its own to the row drawn there, along x or y", () => {
    const data = table({
      c: ["a", "b", "c", "d", "e", "f"],
      v: [1, 2, 3, 4, 5, 6],
      g: ["eu", "eu", "eu", "us", "us", "us"],
    });
    for (const along of ["x", "y"] as const) {
      const model = build({
        marks: [line(data, along === "x" ? { x: "c", y: "v" } : { x: "v", y: "c" })],
        facet: facet("g"),
        [along]: { scope: "panel" },
      });
      const us = model.panels()[1]!.key;
      const drawn = model.drawnMarks().find((d) => d.panel === us)!;
      const { coords } = (drawn.geometry[0] as LineGeometry).path;
      // The vertex of e, the second of the panel's.
      expect(pickAt(model, coords[2]!, coords[3]!)).toEqual({ mark: 0, row: 4 });
    }
  });

  it("resolve a reduced line's vertices to the source rows nearest them along x", () => {
    const n = 20_000;
    const xs = Float64Array.from({ length: n }, (_, i) => i);
    const ys = Float64Array.from(xs, (i) => Math.sin(i / 50) * 10 + ((i * 7919) % 13));
    const model = build({ marks: [line(table({ x: xs, y: ys }), { x: "x", y: "y" })] });
    const { path } = model.drawnMarks()[0]!.geometry[0] as LineGeometry;
    // Drawn reduced: fewer vertices than rows.
    expect(path.count).toBeLessThan(n / 4);
    for (const k of [10, Math.floor(path.count / 2), path.count - 10]) {
      const [vx, vy] = [path.coords[k * 2]!, path.coords[k * 2 + 1]!];
      const picked = pickAt(model, vx, vy);
      expect(picked?.mark).toBe(0);
      // A real row, not the bucket's corner: one of the column the vertex draws.
      const row = picked!.row as number;
      expect(Number.isInteger(row) && row >= 0 && row < n).toBe(true);
      expect(Math.abs(xScale(model)!.map(xs[row]!) - vx)).toBeLessThan(0.5);
    }
  });

  it("pick no cell of a lookup past the clip, though it was drawn there", () => {
    const cells = table({ x: [0, 1, 2, 3], y: [0, 0, 0, 0], v: [1, 2, 3, 4] });
    const model = build({
      marks: [heatmap(cells, { x: "x", y: "y", color: "v" })],
      x: { domain: [0.5, 2.5] },
    });
    const { plot } = model.inspectorOf("")!.frame;
    const y = plot.y + plot.height / 2;
    expect(pickAt(model, plot.x - 2, y)).toBeUndefined();
    expect(pickAt(model, plot.x + 2, y)?.mark).toBe(0);
  });

  it("are not picked past the clip, though their strokes were drawn there", () => {
    const model = build({
      marks: [line(table({ x: [0, 10], y: [0, 20] }), { x: "x", y: "y" })],
      y: { domain: [0, 10] },
    });
    const { plot } = model.inspectorOf("")!.frame;
    // The line leaves the plot's top at x 5, and is drawn on toward (10, 20).
    const [px] = pixel(model, 5.4, 10.8);
    const [, top] = pixel(model, 0, 10);
    expect(top).toBeCloseTo(plot.y);
    expect(pickAt(model, px, plot.y - 4)).toBeUndefined();
    const [inX, inY] = pixel(model, 4.5, 9);
    expect(pickAt(model, inX, inY)).toEqual({ mark: 0, row: 0 });
  });
});

describe("records", () => {
  it("pick nothing from a frame whose data changed since it was drawn", () => {
    const data = table({ x: [0, 10], y: [0, 10] });
    const model = build({ marks: [point(data, { x: "x", y: "y" })] });
    const [px, py] = pixel(model, 10, 10);
    expect(pickAt(model, px, py)).toEqual({ mark: 0, row: 1 });
    data.append({ x: [5], y: [5] });
    expect(pickAt(model, px, py)).toBeUndefined();
    model.scene(estimateText);
    expect(pickAt(model, px, py)?.row).toBe(1);
  });
});
