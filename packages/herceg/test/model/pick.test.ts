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
  return [model.xScale()!.map(x), model.yScale()!.map(y)];
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
    const unit = probe.xScale()!.map(1) - probe.xScale()!.map(0);
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
      expect(Math.abs(model.xScale()!.map(xs[row]!) - vx)).toBeLessThan(0.5);
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
