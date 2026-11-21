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
  Rect,
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

  it("names the row of the nearest run holding the point, and reaches a run by its edge alone", () => {
    // Runs at 8 drawn opposite ways cancel; the fill below 2 holds (4, 1),
    // named by its own edge, upright or lying.
    const along = [0, 10, Number.NaN, 0, 10, Number.NaN, 10, 0];
    const at = [8, 8, Number.NaN, 2, 2, Number.NaN, 8, 8];
    for (const orient of ["x", "y"] as const) {
      const lying = orient === "y";
      const runs = table(lying ? { x: at, y: along } : { x: along, y: at });
      const model = build({
        marks: [area(runs, { x: "x", y: "y", orient, line: false })],
        x: { domain: [0, 10], nice: false },
        y: { domain: [0, 10], nice: false },
      });
      const [px, py] = lying ? pixel(model, 1, 4) : pixel(model, 4, 1);
      expect(pickAt(model, px, py), orient).toEqual({ mark: 0, row: 3 });
    }
    // A run of one place (an upright edge) before a run whose end is there:
    // the second, reached on its closing edge.
    const edged = build({
      marks: [
        area(table({ x: [5, 5, Number.NaN, 0, 5], y: [2, 8, Number.NaN, 8, 8] }), {
          x: "x",
          y: "y",
          line: false,
        }),
      ],
      x: { domain: [0, 10], nice: false },
      y: { domain: [0, 10], nice: false },
    });
    expect(pickAt(edged, ...pixel(edged, 5, 4))).toEqual({ mark: 0, row: 4 });
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

  describe("inside several strokes", () => {
    // Lines are 2 px wide: a point within a pixel of a line's centre is
    // inside its stroke, at distance 0 from it.

    it("takes the stroke whose centre line is nearest, painted over or under (pick-band's case)", () => {
      // The point 0.016 px from one line's centre, 0.809 px from the line painted over it.
      const [near, over] = [below(0.016), below(-0.809)];
      expect(at(chart([flat(near), flat(over)]), px, py)?.mark).toBe(0);
      expect(at(chart([flat(over), flat(near)]), px, py)?.mark).toBe(1);
      // Of one mark's series.
      const both = table({ x: [0, 10], near: [near, near], over: [over, over] });
      const lines = chart([line(both, { x: "x", y: ["near", "over"] })]);
      expect(at(lines, px, py)?.series).toBe(JSON.stringify([0, "near"]));
      // Nearer the other's centre, the other.
      expect(at(lines, px, py - 0.8)?.series).toBe(JSON.stringify([0, "over"]));
    });

    it("takes each of a crowd of lines inside each other at its centre, of one mark or many", () => {
      // Twelve lines half a pixel apart: a point on one is inside up to four others.
      const names = Array.from({ length: 12 }, (_, k) => `s${k}`);
      const crowd = table({
        x: [0, 10],
        ...Object.fromEntries(names.map((name, k) => [name, [below(-0.5 * k), below(-0.5 * k)]])),
      });
      const one = chart([line(crowd, { x: "x", y: names as never })]);
      const many = chart(names.map((name) => line(crowd, { x: "x", y: name as never })));
      for (const [k, name] of names.entries()) {
        expect(at(one, px, py - 0.5 * k)?.series, name).toBe(JSON.stringify([0, name]));
        expect(at(many, px, py - 0.5 * k + 0.1)?.mark, name).toBe(k);
      }
      // Midway between two centres, they tie: the one painted over.
      expect(at(many, px, py - 0.25)?.mark).toBe(1);
    });

    it("compares centres within a thousandth of a pixel as equal, walking from the top", () => {
      // Centres 0.4992, 0.4996, and 0.5 px off, the last on top: the top.
      const close = [0.4992, 0.4996, 0.5].map((d) => flat(below(d)));
      expect(at(chart(close), px, py)?.mark).toBe(2);
      // The middle one nearer than the top by more than that, the lowest
      // not nearer than the middle by as much: the middle.
      const apart = [0.4978, 0.4985, 0.5].map((d) => flat(below(d)));
      expect(at(chart(apart), px, py)?.mark).toBe(1);
    });

    it("takes a rule inside a thick line where its centre is nearer, and the line past the rule's stroke", () => {
      // A line 10 px wide, a rule a pixel wide 3 px under the line's centre.
      const thick = line(table({ x: [0, 10], y: [5, 5] }), { x: "x", y: "y", strokeWidth: 10 });
      const ruled = rule({ y: below(3), strokeWidth: 1 });
      for (const marks of [
        [thick, ruled],
        [ruled, thick],
      ]) {
        const model = chart(marks);
        const r = marks.indexOf(ruled);
        expect(at(model, px, py + 3)?.mark).toBe(r);
        expect(at(model, px, py + 3.4)?.mark).toBe(r);
        // Outside the rule's stroke, inside the line's: the line.
        expect(at(model, px, py + 1.5)?.mark).toBe(1 - r);
        expect(at(model, px, py + 4.5)?.mark).toBe(1 - r);
      }
    });

    it("measures square ends as drawn: a rule ending short of the point does not hold it", () => {
      // A rule 2 px wide along y = 5 ending 0.2 px short of the point, under a line 0.8 px above.
      const end = { data: xScale(probe)!.invert(px - 0.2) };
      const short = rule({ y: 5, span: [{ data: 0 }, end], strokeWidth: 2 });
      const model = chart([short, flat(below(-0.8))]);
      expect(at(model, px, py)?.mark).toBe(1);
      // A pixel back, inside it: the rule, its centre nearer.
      expect(at(model, px - 1, py)?.mark).toBe(0);
      // An area's outline ends square too, where it has no isolated points.
      const ending = area(table({ x: [0, end.data], y: [5, 5] }), {
        x: "x",
        y: "y",
        stroke: "#000000",
        strokeWidth: 2,
      });
      const outlined = chart([ending, flat(below(-0.8))]);
      expect(at(outlined, px, py)?.mark).toBe(1);
      expect(at(outlined, px - 1, py)?.mark).toBe(0);
    });

    it("measures past a square end from its corners", () => {
      // A rule 10 px wide ending 3 px short of the point: 8 px across, 4.24
      // px from its corner, out of reach; 7.5 px across, 3.9 px.
      const end = { data: xScale(probe)!.invert(px - 3) };
      const model = chart([rule({ y: 5, span: [{ data: 0 }, end], strokeWidth: 10 })]);
      expect(at(model, px, py - 8)).toBeUndefined();
      const reached = picker.pick(model, { x: px, y: py - 7.5, slop: 4 });
      expect(reached?.item.distance).toBeCloseTo(Math.hypot(3, 2.5), 3);
    });

    it("leaves out a rule or segment of no length, which square ends paint nothing of", () => {
      const none = rule({ y: 5, span: [{ data: 4 }, { data: 4 }], strokeWidth: 2 });
      expect(at(chart([none, flat(below(-0.8))]), px, py)?.mark).toBe(1);
    });

    it("measures a curved area's square end across the way its outline leaves it", () => {
      // A curved outline 10 px wide rising from (2, 2): the point 3.4 px
      // before its first vertex and 2.5 px above, inside the stroke there; a
      // line 10 px wide under it, its centre 4.8 px off.
      const rising = area(table({ x: [2, 5, 8], y: [2, 8, 2] }), {
        x: "x",
        y: "y",
        curve: "monotone",
        stroke: "#000000",
        strokeWidth: 10,
      });
      const [vx, vy] = pixel(chart([rising]), 2, 2);
      const [qx, qy] = [vx - 3.4, vy - 2.5];
      const under = line(
        table({ x: [0, 10], y: [0, 0].map(() => yScale(probe)!.invert(qy + 4.8)) }),
        { x: "x", y: "y", strokeWidth: 10 },
      );
      expect(at(chart([under, rising]), qx, qy)?.mark).toBe(1);
    });

    it("measures a rounded bar's outline round at its corners", () => {
      // A bar rounded by 20 px at its top, outlined 2 px wide; a rule 2 px wide painted over it.
      const options = {
        legend: false,
        y: { domain: [0, 10] as [number, number], nice: false },
        theme: { style: { bar: { radius: 20 } } },
      };
      const outlined = bar(table({ c: ["a"], v: [5] }), {
        x: "c",
        y: "v",
        strokeWidth: 2,
        stroke: "#000000",
      });
      const alone = build({ marks: [outlined], ...options });
      const { rects } = alone.drawnMarks()[0]!.geometry[0] as RectGeometry;
      const [left, top] = [rects[0]!, rects[1]!];
      // A pixel in from its left edge and 0.1 px over its top, where the corner leaves nothing.
      const [x, y] = [left + 1, top - 0.1];
      expect(at(alone, x, y)).toBeUndefined();
      const ruled = build({
        marks: [outlined, rule({ y: yScale(alone)!.invert(y - 0.8), strokeWidth: 2 })],
        ...options,
      });
      expect(at(ruled, x, y)?.mark).toBe(1);
      // On the corner's arc, the bar.
      const [ox, oy] = [left + 20, top + 20];
      expect(at(alone, ox - 20 * Math.SQRT1_2, oy - 20 * Math.SQRT1_2)?.mark).toBe(0);
    });

    it("measures a square bar's outline mitered at its corners", () => {
      // Outlined 6 px wide, unrounded: 2.8 px past its top right corner both
      // ways is inside the mitered corner, outside a round one.
      const square = build({
        marks: [
          bar(table({ c: ["a"], v: [5] }), { x: "c", y: "v", strokeWidth: 6, stroke: "#000000" }),
        ],
        legend: false,
        y: { domain: [0, 10], nice: false },
        theme: { style: { bar: { radius: 0 } } },
      });
      const { rects } = square.drawnMarks()[0]!.geometry[0] as RectGeometry;
      const [right, top] = [rects[0]! + rects[2]!, rects[1]!];
      expect(picker.pick(square, { x: right + 2.8, y: top - 2.8, slop: 4 })?.item.distance).toBe(0);
    });

    it("measures a mitered corner's centre from its sides' centre lines, not past their ends", () => {
      // Outlined 8 px wide: 2.8 px past its top right corner both ways, 3.96
      // px from the corner; a rule 8 px wide painted over it, its centre 3.2
      // px off: the rule.
      const options = {
        legend: false,
        y: { domain: [0, 10] as [number, number], nice: false },
        theme: { style: { bar: { radius: 0 } } },
      };
      const outlined = bar(table({ c: ["a"], v: [5] }), {
        x: "c",
        y: "v",
        strokeWidth: 8,
        stroke: "#000000",
      });
      const alone = build({ marks: [outlined], ...options });
      const { rects } = alone.drawnMarks()[0]!.geometry[0] as RectGeometry;
      const [x, y] = [rects[0]! + rects[2]! + 2.8, rects[1]! - 2.8];
      const ruled = build({
        marks: [outlined, rule({ y: yScale(alone)!.invert(y - 3.2), strokeWidth: 8 })],
        ...options,
      });
      expect(at(ruled, x, y)?.mark).toBe(1);
    });

    it("measures a mitered corner the plot shows only the miter of", () => {
      // An outline 8 px wide whose bar ends 3 px left of and above the plot:
      // its bottom right miter reaches into the plot, its sides' round
      // footprints do not.
      const options = {
        legend: false,
        x: { domain: [0, 10] as [number, number], nice: false },
        y: { domain: [-10, -30 / 267] as [number, number], nice: false },
        theme: { style: { bar: { radius: 0 } } },
      };
      const outlined = bar(table({ x: [(-35 / 552) * 10], v: [1] }), {
        x: "x",
        y: "v",
        strokeWidth: 8,
        stroke: "#000000",
      });
      const alone = build({ marks: [outlined], ...options });
      const drawn = alone.drawnMarks()[0]!;
      const { rects } = drawn.geometry[0] as RectGeometry;
      const { plot } = drawn.frame!;
      expect(plot.x - rects[0]! - rects[2]!).toBeCloseTo(3, 4);
      expect(plot.y - rects[1]! - rects[3]!).toBeCloseTo(3, 4);
      const [x, y] = [plot.x + 0.5, plot.y + 0.5];
      expect(picker.pick(alone, { x, y, slop: 4 })?.item.distance).toBe(0);
      // Its sides' centre lines, unextended, are not shown there: a rule 10 px
      // wide under it, holding the point 4.2 px from its centre, is taken.
      const ruled = build({
        marks: [rule({ y: yScale(alone)!.invert(y + 4.2), strokeWidth: 10 }), outlined],
        ...options,
      });
      expect(at(ruled, x, y)?.mark).toBe(0);
    });

    it("measures a short rounded bar's corners as arcs past its middle", () => {
      // A bar 10 px tall rounded by up to 20 px at its top: its arcs reach
      // below its middle. A rule 2 px wide painted over it.
      const options = {
        legend: false,
        y: { domain: [0, 10] as [number, number], nice: false },
        theme: { style: { bar: { radius: 20 } } },
      };
      const probeBar = build({
        marks: [bar(table({ c: ["a"], v: [1] }), { x: "c", y: "v" })],
        ...options,
      });
      const v = yScale(probeBar)!.invert(yScale(probeBar)!.map(0) - 10);
      const outlined = bar(table({ c: ["a"], v: [v] }), {
        x: "c",
        y: "v",
        strokeWidth: 2,
        stroke: "#000000",
      });
      const alone = build({ marks: [outlined], ...options });
      const { rects } = alone.drawnMarks()[0]!.geometry[0] as RectGeometry;
      // 0.1 px left of it, 55% of the way down, where its corner leaves nothing.
      const [x, y] = [rects[0]! - 0.1, rects[1]! + 0.55 * rects[3]!];
      const ruled = build({
        marks: [outlined, rule({ y: yScale(alone)!.invert(y - 0.8), strokeWidth: 2 })],
        ...options,
      });
      expect(at(ruled, x, y)?.mark).toBe(1);
      // 5 px in from its left edge and 2 px above its bottom, inside the
      // outline's bottom side (6 px wide), outside its arc: a rule 6 px wide
      // painted over it, its centre 2.5 px off, comes second.
      const thick = bar(table({ c: ["a"], v: [v] }), {
        x: "c",
        y: "v",
        strokeWidth: 6,
        stroke: "#000000",
      });
      const [bx, by] = [rects[0]! + 5, rects[1]! + rects[3]! - 2];
      const over = build({
        marks: [thick, rule({ y: yScale(alone)!.invert(by - 2.5), strokeWidth: 6 })],
        ...options,
      });
      expect(at(over, bx, by)?.mark).toBe(0);
    });

    it("measures an area outline's square ends behind repeated points and short pieces", () => {
      const ending = (xs: number[], ys: number[], strokeWidth: number) =>
        area(table({ x: xs, y: ys }), {
          x: "x",
          y: "y",
          curve: "monotone",
          stroke: "#000000",
          strokeWidth,
        });
      // Starting at (2, 5) twice, 2 px wide: 0.2 px before its start, under a line 0.8 px off.
      const [sx, sy] = pixel(probe, 2, 5);
      const repeated = ending([2, 2, 8], [5, 5, 5], 2);
      expect(at(chart([repeated, flat(below(-0.8))]), sx - 0.2, sy)?.mark).toBe(1);
      // Curving sharply within a few pixels of its start, 10 px wide: 0.2 px
      // before its start, under a line 10 px wide 4.8 px off.
      const sharp = ending([2, 2.05, 2.1], [5, 5.1, 5], 10);
      const thick = line(
        table({ x: [0, 10], y: [0, 0].map(() => yScale(probe)!.invert(sy + 4.8)) }),
        {
          x: "x",
          y: "y",
          strokeWidth: 10,
        },
      );
      expect(at(chart([sharp, thick]), sx - 0.2, sy)?.mark).toBe(1);
    });

    it("measures an area outline's pieces and joins where each paints, whatever its ends", () => {
      // A V pointing down, its pieces 1.5 px long, 10 px wide: 0.6 px over
      // its start and 0.2 px before it, its second piece paints the point;
      // level with its start, nothing does. A line 10 px wide painted over
      // it, its centre 4.8 px off.
      const vee = area(table({ x: [2, 2.02, 2.04], y: [5, 4.96, 5] }), {
        x: "x",
        y: "y",
        stroke: "#000000",
        strokeWidth: 10,
      });
      const [sx, sy] = pixel(probe, 2, 5);
      const over = (y: number) =>
        line(table({ x: [0, 10], y: [5, 5].map(() => yScale(probe)!.invert(y - 4.8)) }), {
          x: "x",
          y: "y",
          strokeWidth: 10,
        });
      expect(at(chart([vee, over(sy - 0.6)]), sx - 0.2, sy - 0.6)?.mark).toBe(0);
      expect(at(chart([vee, over(sy)]), sx - 0.2, sy)?.mark).toBe(1);
    });

    it("measures an area outline through many repeated points in time linear in them", () => {
      // 40,000 points at one place, drawn unsorted: the piece after them looks
      // back past them once, and pieces of no length are not measured.
      const n = 40_000;
      const model = chart([
        area(
          table({
            x: [1, ...new Array<number>(n).fill(5), 0],
            y: new Array<number>(n + 2).fill(5),
          }),
          {
            x: "x",
            y: "y",
            stroke: "#000000",
            strokeWidth: 2,
          },
        ),
      ]);
      const [x, y] = pixel(model, 5, 5);
      // 4 px above it, outside its stroke and its fill.
      const query = { x, y: y - 4, slop: 4 };
      picker.pick(model, query);
      const start = performance.now();
      const picked = picker.pick(model, query);
      expect(performance.now() - start).toBeLessThan(100);
      expect(picked?.item.distance).toBeCloseTo(3, 4);
    });

    it("lets a rule's label cover its own stroke", () => {
      // A rule 4 px wide with a label, and a line 6 px wide painted over it.
      const labelled = rule({ y: 5, strokeWidth: 4, label: "limit" });
      const alone = chart([labelled]);
      const drawn = alone.drawnMarks()[0]!;
      const geometry = drawn.geometry[0] as RuleGeometry;
      const draw = geometry.draw as unknown as {
        labelBox(rule: RuleGeometry, size: number): Rect | undefined;
      };
      const box = draw.labelBox(geometry, drawn.frame!.theme.fontSize)!;
      // In the label, 1.5 px over the rule's centre: inside its stroke too.
      const [x, y] = [box.x + box.width / 2, geometry.y1 - 1.5];
      expect(y >= box.y && y <= box.y + box.height).toBe(true);
      expect(at(alone, x, y)?.mark).toBe(0);
      const thick = line(table({ x: [0, 10], y: [5, 5].map(() => yScale(alone)!.invert(y - 2)) }), {
        x: "x",
        y: "y",
        strokeWidth: 6,
      });
      // The line's centre 2 px off, the rule's 1.5 px under its label: the line.
      expect(at(chart([labelled, thick]), x, y)?.mark).toBe(1);
    });

    it("leaves a glyph or fill covering the strokes under it, and a stroke over it taken", () => {
      // The point 0.2 px from a lower line's centre, 0.6 px from an upper one's.
      const [lower, upper] = [flat(below(0.2)), flat(below(-0.6))];
      expect(at(chart([lower, upper]), px, py)?.mark).toBe(0);
      const glyph = point(table({ x: [4], y: [5] }), { x: "x", y: "y", radius: 6 });
      const band = region({ x1: 2, x2: 6 });
      const filled = area(table({ x: [0, 10], y: [below(-4), below(-4)] }), { x: "x", y: "y" });
      for (const cover of [glyph, band, filled]) {
        // Under the upper line, over the lower: the upper line, the cover hiding the lower.
        expect(at(chart([lower, cover, upper]), px, py)?.mark).toBe(2);
        // Over both lines: the cover.
        expect(at(chart([lower, upper, cover]), px, py)?.mark).toBe(2);
      }
      // An area's outline is a stroke over its fill: the lower line under the fill stays covered.
      const outlined = area(table({ x: [0, 10], y: [below(-0.6), below(-0.6)] }), {
        x: "x",
        y: "y",
        stroke: "#000000",
        strokeWidth: 2,
      });
      expect(at(chart([lower, outlined]), px, py)?.mark).toBe(1);
    });

    it("measures a bar's outline as a stroke", () => {
      // A bar outlined 6 px wide, and a rule 2 px wide a pixel over its top, painted under it.
      const bars = table({ c: ["a"], v: [5] });
      const outlined = bar(bars, { x: "c", y: "v", strokeWidth: 6, stroke: "#000000" });
      const options = { legend: false, y: { domain: [0, 10] as [number, number], nice: false } };
      const [middle, top] = barAt(build({ marks: [outlined], ...options }), 0);
      const value = yScale(build({ marks: [outlined], ...options }))!.invert(top - 1);
      const model = build({ marks: [rule({ y: value, strokeWidth: 2 }), outlined], ...options });
      // Above the bar, inside both strokes: the rule nearer its centre, the bar nearer its outline's.
      expect(at(model, middle, top - 0.75)?.mark).toBe(0);
      expect(at(model, middle, top - 0.25)?.mark).toBe(1);
    });

    it("takes the segment of a folded path whose centre is nearer, as its own row", () => {
      // From (0, 5) to (10, 5) and back to (0, 5) a pixel and a half above:
      // at x = 4 the way back runs 0.9 px above the way out.
      const folded = chart([
        line(table({ x: [0, 10, 0], y: [5, 5, below(-1.5)] }), { x: "x", y: "y" }),
      ]);
      expect(at(folded, px, py)?.row).toBe(0);
      expect(at(folded, px, py - 0.9)?.row).toBe(2);
    });

    it("takes the custom stroke whose centre is nearest, of one mark or across marks", () => {
      // Each row a horizontal stroke 2 px wide through its point.
      const strokes = (ys: number[]) =>
        custom(table({ x: ys.map(() => 4), y: ys }), {
          x: "x",
          y: "y",
          draw({ series, x, y, item, line: stroke }) {
            for (const s of series)
              for (let k = 0; k < s.length; k++) {
                const row = s.rowAt(k);
                const [cx, cy] = [x(s.x[row]!), y(s.y[row]!)];
                item(s, row, () => stroke(cx - 20, cy, cx + 20, cy, { strokeWidth: 2 }));
              }
          },
        });
      // Row 0 0.2 px under the point, row 1 painted over it 0.6 px above.
      const two = chart([strokes([below(0.2), below(-0.6)])]);
      expect(at(two, px, py)).toMatchObject({ mark: 0, row: 0 });
      expect(at(two, px, py - 0.6)).toMatchObject({ mark: 0, row: 1 });
      // A line under a custom stroke, nearer: the line.
      expect(at(chart([flat(below(0.2)), strokes([below(-0.6)])]), px, py)?.mark).toBe(0);
      expect(at(chart([flat(below(-0.6)), strokes([below(0.2)])]), px, py)?.mark).toBe(1);
    });

    it("measures a custom stroke's centre where its stroke paints the point, not past a butt end", () => {
      // Row 1, over: a path whose first piece ends half a pixel short of the
      // point along its centre line, and whose second, 8 px wide, has its
      // centre 3 px under it; row 0, under: a stroke 4 px wide a pixel above.
      const shapes = custom(table({ x: [4, 4], y: [5, 5] }), {
        x: "x",
        y: "y",
        draw({ series, x, y, item, path }) {
          for (const s of series)
            for (let k = 0; k < s.length; k++) {
              const row = s.rowAt(k);
              const [cx, cy] = [x(s.x[row]!), y(s.y[row]!)];
              item(s, row, () =>
                row === 1
                  ? path(
                      `M${cx - 20} ${cy}L${cx - 0.5} ${cy}M${cx - 20} ${cy + 3}L${cx + 20} ${cy + 3}`,
                      {
                        stroke: "#000000",
                        strokeWidth: 8,
                        fill: "none",
                      },
                    )
                  : path(`M${cx - 20} ${cy - 1}L${cx + 20} ${cy - 1}`, {
                      stroke: "#000000",
                      strokeWidth: 4,
                      fill: "none",
                    }),
              );
            }
        },
      });
      expect(at(chart([shapes]), px, py)).toMatchObject({ mark: 0, row: 0 });
    });
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

  it("takes a filled custom path on its thick outline's outer half, before a line under it the point is beside", () => {
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
    // On the outline's outer half (its centre line 2 px off), a line 2 px
    // off, its stroke a pixel off: the path.
    expect(at(outlined(6), px, py + 8)?.mark).toBe(1);
    // The point inside that line's stroke too, its centre a pixel off: the
    // line, whose centre line is nearer.
    expect(at(outlined(7), px, py + 8)?.mark).toBe(0);
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
