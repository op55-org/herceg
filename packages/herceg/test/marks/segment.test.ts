// Segments: each row from one place to another (the customisation study's
// A2 comets, built in). Their outline (the taper, dots, arrowheads, short
// segments, both directions), and their taking part through the custom
// mark's core: picking by shape, tooltips writing ranges, totals refused,
// selection and dimming, the keyboard, the text alternative, the legend,
// row views, bands, times, panels and facets, static output, specs, and
// refusals on each surface.
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { compileExpression } from "../../src/data/expression.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { rowView } from "../../src/data/row-view.ts";
import { selectionStore, selectRows } from "../../src/data/selection.ts";
import { type Table, table } from "../../src/data/table.ts";
import { n } from "../../src/draw/markup.ts";
import { estimateText } from "../../src/layout/text.ts";
import { DIM } from "../../src/marks/mark.ts";
import { segment, segmentOutline } from "../../src/marks/segment.ts";
import { tooltipWriters } from "../../src/marks/tooltip-writers.ts";
import { describeChart } from "../../src/model/describe.ts";
import { facet } from "../../src/model/facet.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { brushedRows } from "../../src/model/selected-rows.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderSvg } from "../../src/render/svg.ts";
import type { PathShape, Scene, ShapesGeometry } from "../../src/scene/scene.ts";
import { loadSpec } from "../../src/spec/load.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import { CATEGORIES, COLORS, type Comet, cometTable } from "../helpers/comets.ts";
import { contractTest } from "../helpers/contracts.ts";
import { legendOf } from "../helpers/guides.ts";
import { readKeys } from "../helpers/keyboard.ts";
import { withPicker } from "../helpers/picker.ts";
import { xScale, yRightScale, yScale } from "../helpers/scales.ts";

function build(config: ChartConfig, width = 600, height = 400) {
  const model = withPicker(
    new ChartModel({ locale: "en-US", timeZone: "UTC", ...config }, undefined, staticCompilers()),
  );
  // As a chart does once it has loaded what reads tooltips' fields.
  model.writers = tooltipWriters;
  model.setSize(width, height, 1);
  return { model, scene: model.scene(estimateText) };
}

/** A2's scales: categories to colors, confidence to widths, age to opacity. */
const SCALES = {
  color: {
    type: "ordinal",
    domain: CATEGORIES,
    map: Object.fromEntries(CATEGORIES.map((c, i) => [c, COLORS[i]!])),
  },
  widths: { type: "linear", domain: [0, 1], range: [2, 7] },
  fade: { type: "linear", domain: [0, 30], range: [1, 0.35] },
} as const satisfies ChartConfig["scales"];

/** Four comets apart from each other, one per category but fx, along x or y. */
const FOUR: Comet[] = [
  { id: "A", x0: 10, y0: 20, x1: 40, y1: 20, confidence: 1, category: "energy", age: 0 },
  { id: "B", x0: 90, y0: 80, x1: 60, y1: 80, confidence: 0, category: "metals", age: 30 },
  { id: "C", x0: 20, y0: 60, x1: 20, y1: 90, confidence: 0.5, category: "grains", age: 15 },
  { id: "D", x0: 80, y0: 10, x1: 80, y1: 40, confidence: 0.5, category: "rates", age: 0 },
];

/** A2's comets as segments: a dot at the start, a tail tapering to 1 px at the arrowhead's base. */
const comets = (data: ReturnType<typeof cometTable>) =>
  segment(data, {
    id: "comets",
    itemKey: "id",
    x: ["x0", "x1"],
    y: ["y0", "y1"],
    color: "category",
    width: { from: { field: "confidence", scale: "widths" }, to: 1 },
    caps: { from: "dot", to: "arrow" },
    encode: { opacity: { field: "age", scale: "fade" } },
    tooltip: {
      heading: [{ field: "id" }],
      fields: [
        { field: "confidence", format: { maximumFractionDigits: 2 } },
        { field: "age", format: { maximumFractionDigits: 0 } },
      ],
    },
  });

const chart = (rows: readonly Comet[] = FOUR, config: Partial<ChartConfig> = {}): ChartConfig => ({
  x: { domain: [0, 100], nice: false },
  y: { domain: [0, 100], nice: false },
  scales: SCALES,
  marks: [comets(cometTable(rows))],
  ...config,
});

const shapesOf = (scene: Scene) =>
  scene.panels.flatMap((p) => p.marks).filter((m): m is ShapesGeometry => m.kind === "shapes");

/** The pixel of a value pair on the first panel's scales. */
function pixel(model: ChartModel, x: number, y: number): [number, number] {
  const [panel] = model.panels();
  return [panel!.x.map(x), panel!.y.map(y)];
}

/** Each subpath of path data: its points (arcs left as their ends), and the area it winds. */
function subpaths(d: string): { points: number[][]; area: number }[] {
  return d
    .split("M")
    .filter(Boolean)
    .map((part) => {
      const [first, ...rest] = part.replace(/Z$/, "").split(/[La]/);
      const points = [first!, ...rest.filter((p) => p.split(" ").length === 2)].map((p) =>
        p.trim().split(" ").map(Number),
      );
      // Clockwise on screen (y down) is a positive shoelace sum.
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i]!;
        const [x1, y1] = points[(i + 1) % points.length]!;
        area += x0! * y1! - x1! * y0!;
      }
      return { points, area: area / 2 };
    });
}

const DOT = { dot: 3 } as const;
const ARROW = { arrow: { length: 10, width: 8 } } as const;

describe("a segment's outline", () => {
  it("tapers its body from the start's width to the end's, at the arrowhead's base", () => {
    expect(segmentOutline(0, 0, 100, 0, 6, 1, DOT, ARROW)).toBe(
      // The body to the head's base at 90, 6 px wide at the start and 1 px at the base;
      // the head 10 px long and 8 px across, its tip at the end; the dot about the start.
      "M0 -3L90 -0.5L90 0.5L0 3ZM90 -4L100 0L90 4ZM-3 0a3 3 0 1 1 6 0a3 3 0 1 1 -6 0Z",
    );
    // One width for the whole segment, no caps: a band of that width.
    expect(segmentOutline(0, 0, 0, 50, 2, 2, undefined, undefined)).toBe("M1 0L1 50L-1 50L-1 0Z");
  });

  it("winds every piece alike, in every direction, so overlaps paint once", () => {
    for (let angle = 0; angle < 360; angle += 30) {
      const [x, y] = [
        50 * Math.cos((angle * Math.PI) / 180),
        50 * Math.sin((angle * Math.PI) / 180),
      ];
      const pieces = subpaths(segmentOutline(0, 0, x, y, 6, 1, ARROW, ARROW));
      expect(pieces).toHaveLength(3);
      for (const { area } of pieces) expect(area).toBeGreaterThan(0);
    }
    // Reversed, the same shape from the other end: its pieces mirrored about the middle.
    const right = segmentOutline(0, 0, 100, 0, 6, 1, undefined, ARROW);
    const left = segmentOutline(100, 0, 0, 0, 6, 1, undefined, ARROW);
    expect(left).toBe("M100 3L10 0.5L10 -0.5L100 -3ZM10 4L0 0L10 -4Z");
    expect(right).toBe("M0 -3L90 -0.5L90 0.5L0 3ZM90 -4L100 0L90 4Z");
  });

  it("draws a head alone where the segment is shorter than it, its base at the other end", () => {
    expect(segmentOutline(0, 0, 6, 0, 6, 1, DOT, ARROW)).toBe(
      "M0 -4L6 0L0 4ZM-3 0a3 3 0 1 1 6 0a3 3 0 1 1 -6 0Z",
    );
    // At the start instead.
    expect(segmentOutline(0, 0, 6, 0, 6, 1, ARROW, undefined)).toBe("M0 0L6 -4L6 4Z");
  });

  it("gives two heads longer than the segment together half of it each, bases meeting", () => {
    expect(segmentOutline(0, 0, 12, 0, 6, 1, ARROW, ARROW)).toBe("M6 -4L12 0L6 4ZM0 0L6 -4L6 4Z");
    // Heads that fit keep their lengths, the body between them.
    expect(segmentOutline(0, 0, 30, 0, 2, 2, ARROW, ARROW)).toBe(
      "M10 -1L20 -1L20 1L10 1ZM20 -4L30 0L20 4ZM0 0L10 -4L10 4Z",
    );
  });

  it("draws a segment of no length as its dots, one where both are, and no head", () => {
    expect(segmentOutline(5, 5, 5, 5, 6, 1, DOT, { dot: 5 })).toBe(
      "M0 5a5 5 0 1 1 10 0a5 5 0 1 1 -10 0Z",
    );
    expect(segmentOutline(5, 5, 5, 5, 6, 1, ARROW, ARROW)).toBe("");
    expect(segmentOutline(5, 5, 5, 5, 6, 1, DOT, ARROW)).toBe("M2 5a3 3 0 1 1 6 0a3 3 0 1 1 -6 0Z");
  });

  it("leaves out a body of no width, keeping its caps", () => {
    expect(segmentOutline(0, 0, 100, 0, 0, 0, undefined, ARROW)).toBe("M90 -4L100 0L90 4Z");
    // Tapering to nothing at one end, a body is a triangle.
    expect(subpaths(segmentOutline(0, 0, 100, 0, 4, 0, undefined, undefined))).toHaveLength(1);
  });
});

describe("segments", () => {
  it("color every series alike in the legend and the drawing, a color of the series' over the mark's", () => {
    const rows = table({ a: [1, 2, 3], b: [4, 5, 6], g: ["p", "q", "p"] });
    const scales = { hues: { type: "ordinal", map: { p: "#0000ff", q: "#00ff00" } } } as const;
    const hues = { field: "g", scale: "hues" } as const;
    // A field of the series' alone, in a list, or the series' names: each series' mapped color.
    for (const color of [hues, [hues], { series: true, scale: "hues" } as const]) {
      const { scene } = build({
        scales,
        marks: [
          segment(rows, { x: ["a", "b"], y: "a", series: "g", color: "red", encode: { color } }),
        ],
      });
      expect(legendOf(scene).map(({ label, color }) => [label, color])).toEqual([
        ["p", "#0000ff"],
        ["q", "#00ff00"],
      ]);
      const shapes = shapesOf(scene)[0]!.shapes as PathShape[];
      expect(shapes.map((s) => s.fill).sort()).toEqual(["#0000ff", "#0000ff", "#00ff00"]);
    }
    // Without one, the mark's color is every series'.
    const { scene } = build({
      marks: [segment(rows, { x: ["a", "b"], y: "a", series: "g", color: "red" })],
    });
    expect(legendOf(scene).map(({ color }) => color)).toEqual(["red", "red"]);
  });

  contractTest(
    "segment.items.legend",
    () => {
      const { model, scene } = build(chart());
      // A series per category of the chart's color scale, each in its color.
      expect(legendOf(scene).map(({ label, color }) => [label, color])).toEqual(
        CATEGORIES.map((c, i) => [c, COLORS[i]]),
      );
      // One outline per comet, painted from its row: its series' color, its age's opacity.
      const shapes = shapesOf(scene)[0]!.shapes as PathShape[];
      expect(shapes.map((s) => [s.fill, Number(s.opacity.toFixed(3))])).toEqual([
        [COLORS[0], 1],
        [COLORS[1], 0.35],
        [COLORS[2], 0.675],
        [COLORS[3], 1],
      ]);
      // Hidden through the legend, a category's comets are not drawn.
      model.hidden.add(model.legendEntries()[1]!.key);
      const shown = shapesOf(model.scene(estimateText))[0]!.shapes as PathShape[];
      expect(shown).toHaveLength(3);
      expect(shown.some((s) => s.fill === COLORS[1])).toBe(false);
    },
    "segments' series take the legend's entries and the colors of the chart's scales",
  );

  contractTest(
    "segment.items.tooltip",
    () => {
      const { model } = build(chart());
      // On comet A's tail, a third along: its row, read by its shape.
      const [x, y] = pixel(model, 20, 20);
      const at = model.inspect(x, y)!;
      expect(at.points.map((p) => [p.label, p.text])).toEqual([["energy", "(10, 20) – (40, 20)"]]);
      expect(at.points[0]!.heading?.map((run) => run.text)).toEqual(["A"]);
      expect(at.points[0]!.fields?.map((f) => [f.label, f.text])).toEqual([
        ["confidence", "1"],
        ["age", "0"],
      ]);
      // Inside the comet's box but off its taper (under 5 px wide there): nothing.
      expect(model.inspect(x, y + 3.5)).toBeUndefined();
      // Comet C, along y, and B, from right to left.
      const [cx, cy] = pixel(model, 20, 70);
      expect(model.inspect(cx, cy)!.points[0]!.text).toBe("(20, 60) – (20, 90)");
      const [bx, by] = pixel(model, 75, 80);
      expect(model.inspect(bx, by)!.points[0]!.text).toBe("(90, 80) – (60, 80)");
    },
    "tooltips read the segment under the pointer by its shape, writing its ends as a range",
  );

  it("are picked by their shapes, the later painted on top, and not past the plot", () => {
    const crossing: Comet[] = [
      { id: "under", x0: 10, y0: 50, x1: 60, y1: 50, confidence: 1, category: "energy", age: 0 },
      { id: "over", x0: 35, y0: 40, x1: 35, y1: 60, confidence: 1, category: "energy", age: 0 },
      { id: "edge", x0: 90, y0: 20, x1: 130, y1: 20, confidence: 1, category: "metals", age: 0 },
    ];
    const { model } = build(chart(crossing));
    const picked = (x: number, y: number) => {
      const [px, py] = pixel(model, x, y);
      const found = model.picker!(px, py);
      return found?.item.part.kind === "row" ? found.item.part.position : undefined;
    };
    expect(picked(35, 50)).toBe(1);
    expect(picked(20, 50)).toBe(0);
    // The dot at the start is the comet's too.
    expect(picked(10, 50)).toBe(0);
    // Past the plot's edge, where the comet is cut, nothing.
    expect(picked(95, 20)).toBe(2);
    const [px, py] = pixel(model, 100, 20);
    expect(model.picker!(px + 6, py)).toBeUndefined();
  });

  it("refuse totals at run time: their points are ranges", () => {
    const data = cometTable(FOUR);
    const totaled = segment(data, {
      x: ["x0", "x1"],
      y: "y0",
      tooltip: { total: true } as never,
    });
    // As the scene's inspector is made with the tooltip's writers.
    expect(() => build({ ...chart(), marks: [totaled] })).toThrow(
      "segment tooltip.total: its points are ranges, which have no total; drop total",
    );
  });

  contractTest(
    "segment.items.selection",
    () => {
      const data = cometTable(FOUR);
      const store = selectionStore(data);
      const selection = rowSelection({ store, channel: "focus" });
      const { model } = build({ ...chart(), marks: [comets(data)], rowSelection: selection });
      selection.highlight(model);
      const opacities = () =>
        (shapesOf(model.scene(estimateText))[0]!.shapes as PathShape[]).map((s) =>
          Number(s.opacity.toFixed(4)),
        );
      const before = opacities();
      store.set("focus", selectRows(new RowSet(data).addAll([2])));
      // The selected comet as it was; the others dimmed, still drawn.
      expect(opacities()).toEqual(
        before.map((o, i) => (i === 2 ? o : Number((o * DIM).toFixed(4)))),
      );
      store.set("focus", null);
      expect(opacities()).toEqual(before);
    },
    "a selection dims the segments of rows it leaves out",
  );

  it("brush the rows whose ends span the brush, along either axis", () => {
    const data = cometTable(FOUR);
    // One x field and a pair along y: each row's span along y, never a series per field.
    const { model } = build({
      ...chart(),
      marks: [segment(data, { x: "x0", y: ["y0", "y1"], itemKey: "id" })],
    });
    const brushed = (x: readonly [number, number] | null, y: readonly [number, number] | null) => {
      const held = brushedRows(model, data as unknown as Table, { x, y, lasso: null }, null);
      if (held?.kind !== "predicate")
        return held?.kind === "rows" ? [...held.rows.positions()] : [];
      const { at } = compileExpression(held.expression, data);
      return FOUR.map((_, row) => row).filter((row) => at(row) === true);
    };
    // C runs from 60 to 90 along y at x 20, D from 10 to 40 at x 80.
    expect(brushed(null, [65, 75])).toEqual([2]);
    expect(brushed([15, 25], [65, 75])).toEqual([2]);
    expect(brushed(null, [30, 35])).toEqual([3]);
  });

  it("brush a row by its ends' spans, and lasso it by its drawn box's middle", () => {
    // A diagonal from (10, 10) to (50, 50), its arrowhead at (50, 50).
    const diagonal: Comet[] = [{ ...FOUR[0]!, x0: 10, y0: 10, x1: 50, y1: 50 }];
    const data = cometTable(diagonal);
    const { model } = build({
      ...chart(),
      marks: [segment(data, { x: ["x0", "x1"], y: ["y0", "y1"], caps: { to: "arrow" } })],
    });
    const held = (selection: Parameters<typeof brushedRows>[2]) => {
      const rows = brushedRows(model, data as unknown as Table, selection, null);
      if (rows?.kind === "rows") return [...rows.rows.positions()];
      if (rows?.kind !== "predicate") return [];
      return compileExpression(rows.expression, data).at(0) === true ? [0] : [];
    };
    // A rectangle meeting both spans holds it, though the line passes nowhere near.
    expect(held({ x: [40, 50], y: [10, 20], lasso: null })).toEqual([0]);
    // A lasso holds it around its box's middle, (30, 30), not around its arrowhead alone.
    const around = (x: number, y: number): [number, number][] => [
      [x - 3, y - 3],
      [x + 3, y - 3],
      [x + 3, y + 3],
      [x - 3, y + 3],
    ];
    expect(held({ x: null, y: null, lasso: around(30, 30) })).toEqual([0]);
    expect(held({ x: null, y: null, lasso: around(49, 49) })).toEqual([]);
  });

  contractTest(
    "segment.items.keyboard",
    () => {
      const fifth: Comet = { ...FOUR[0]!, id: "E", x0: 50, x1: 70, y0: 30, y1: 30 };
      const { model } = build(chart([...FOUR, fifth]));
      // The keys step a series' segments in row order, each read as its tooltip.
      expect(readKeys(model, ["ArrowRight", "ArrowRight", "ArrowLeft"])).toEqual([
        "10. energy: (10, 20) – (40, 20)",
        "50. energy: (50, 30) – (70, 30)",
        "10. energy: (10, 20) – (40, 20)",
      ]);
      expect(readKeys(model, ["ArrowRight"], "", 1)).toEqual(["90. metals: (90, 80) – (60, 80)"]);
    },
    "the keyboard steps through segments, announcing each as its tooltip",
  );

  it('read a pair\'s second field named "" on either axis', () => {
    const rows = table({ a: [10], "": [40], b: [20] });
    for (const [x, y] of [
      [["a", ""], "b"],
      ["b", ["a", ""]],
    ] as const) {
      const { model, scene } = build({
        x: { domain: [0, 50], nice: false },
        y: { domain: [0, 50], nice: false },
        marks: [segment(rows, { x, y, caps: { to: "arrow" } } as never)],
      });
      // The arrowhead's tip at 40 along the paired axis.
      const tip = typeof x === "string" ? pixel(model, 20, 40) : pixel(model, 40, 20);
      const [shape] = shapesOf(scene)[0]!.shapes as PathShape[];
      expect(shape!.d).toContain(`L${n(tip[0])} ${n(tip[1])}L`);
    }
  });

  it("draw on the right axis, both ends counting toward its domain", () => {
    const rows = table({ t: [0, 10], from: [1, 200], to: [5, 400] });
    const { model, scene } = build({
      marks: [segment(rows, { x: "t", y: ["from", "to"], axis: "right", width: 2 })],
    });
    expect(yRightScale(model)!.domain[0]).toBeLessThanOrEqual(1);
    expect(yRightScale(model)!.domain[1]).toBeGreaterThanOrEqual(400);
    // The second segment's top end is on the right scale's 400.
    const top = yRightScale(model)!.map(400);
    const [, second] = shapesOf(scene)[0]!.shapes as PathShape[];
    const ys = second!.d
      .match(/-?[\d.]+/g)!
      .map(Number)
      .filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeCloseTo(top, 0);
  });

  it("place rows in a category's bands, both ends counting toward the other axis", () => {
    const rows = table({
      id: ["F-1", "F-2", "F-3"],
      start: [20, 80, 25],
      end: [70, 30, -12],
      category: ["energy", "metals", "energy"],
    });
    const { model, scene } = build({
      scales: SCALES,
      marks: [
        segment(rows, { x: ["start", "end"], y: "id", color: "category", caps: { to: "arrow" } }),
      ],
    });
    expect(yScale(model)!.type).toBe("band");
    expect(yScale(model)!.categories).toEqual(["F-1", "F-2", "F-3"]);
    expect(xScale(model)!.domain[0]).toBeLessThanOrEqual(-12);
    expect(xScale(model)!.domain[1]).toBeGreaterThanOrEqual(80);
    // Each on its band's middle, tip at its end.
    const [d] = (shapesOf(scene)[0]!.shapes as PathShape[]).map((s) => s.d);
    const [x, y] = [xScale(model)!.map(70), yScale(model)!.map(0)];
    expect(d).toContain(`L${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}L`);
    expect(model.inspect(xScale(model)!.map(0), yScale(model)!.map(2))!.points[0]!.text).toBe(
      "25 – -12",
    );
    // The text alternative counts segments and categories, and both ends' extent.
    const text = describeChart(model);
    expect(text).toContain("energy: 2 segments in 2 categories, x from -12 to 70");
    expect(text).toContain("metals: 1 segment in 1 category, x from 30 to 80");
  });

  it("take time fields as ends", () => {
    const day = 86_400_000;
    const rows = table({
      task: ["a", "b"],
      from: time([0, 2 * day]),
      to: time([3 * day, 5 * day]),
    });
    const { model } = build({ marks: [segment(rows, { x: ["from", "to"], y: "task", width: 4 })] });
    expect(xScale(model)!.type).toBe("time");
    const at = model.inspect(xScale(model)!.map(day), yScale(model)!.map(0))!;
    expect(at.points[0]!.text).toMatch(/^Jan 1, 1970.* – Jan 4, 1970/);
  });

  it("draw a row view's rows, following its filter", () => {
    const data = cometTable(FOUR);
    const view = rowView(data, { filter: ["<", ["field", "age"], 20] });
    const { model, scene } = build({ ...chart(), marks: [comets(view as never)] });
    expect((shapesOf(scene)[0]!.shapes as PathShape[]).length).toBe(3);
    view.setQuery({ filter: ["<", ["field", "age"], 10] });
    expect((shapesOf(model.scene(estimateText))[0]!.shapes as PathShape[]).length).toBe(2);
  });

  it("draw in their panel, and split by facets", () => {
    const data = cometTable(FOUR);
    const { model, scene } = build({
      ...chart(),
      panels: panels([{ id: "left" }, { id: "right" }]),
      marks: [segment(data, { x: ["x0", "x1"], y: ["y0", "y1"], panel: "right", width: 3 })],
    });
    const drawn = scene.panels.map((p) => p.marks.filter((m) => m.kind === "shapes").length);
    expect(drawn).toEqual([0, 1]);
    expect(model.panels()).toHaveLength(2);
    const faceted = build({
      ...chart(),
      facet: facet("category"),
      marks: [comets(data)],
    });
    // A panel per category, each drawing its one comet.
    expect(
      faceted.scene.panels.map(
        (p) => shapesOf({ ...faceted.scene, panels: [p] })[0]?.shapes.length,
      ),
    ).toEqual([1, 1, 1, 1]);
  });

  contractTest(
    "segment.items.export",
    () => {
      const { scene } = build(chart());
      const svg = renderSvg(scene);
      // Each outline in the static SVG, as the scene holds it.
      for (const shape of shapesOf(scene)[0]!.shapes as PathShape[])
        expect(svg).toContain(`d="${shape.d}"`);
    },
    "static SVG draws segments' outlines as the chart does",
  );

  it("load from specs as they are made in TypeScript", () => {
    const columns = Object.fromEntries(
      (["id", "x0", "y0", "x1", "y1", "confidence", "category", "age"] as const).map((f) => [
        f,
        FOUR.map((c) => c[f]),
      ]),
    );
    const spec = {
      data: { comets: { columns } },
      scales: SCALES,
      x: { domain: [0, 100], nice: false },
      y: { domain: [0, 100], nice: false },
      marks: [
        {
          type: "segment",
          id: "comets",
          itemKey: "id",
          x: ["x0", "x1"],
          y: ["y0", "y1"],
          color: "category",
          width: { from: { field: "confidence", scale: "widths" }, to: 1 },
          caps: { from: "dot", to: "arrow" },
          encode: { opacity: { field: "age", scale: "fade" } },
        },
      ],
    } as unknown as ChartSpec;
    const loaded = build({ ...loadSpec(spec).config, locale: "en-US" });
    const made = build(chart());
    expect((shapesOf(loaded.scene)[0]!.shapes as PathShape[]).map((s) => s.d)).toEqual(
      (shapesOf(made.scene)[0]!.shapes as PathShape[]).map((s) => s.d),
    );
  });
});

describe("segments refuse", () => {
  const data = cometTable(FOUR);
  const make = (options: object) => () =>
    segment(data, { x: ["x0", "x1"], y: "y0", ...options } as never);

  it("ends without a pair", () => {
    expect(() => segment(data, { x: "x0", y: "y0" })).toThrow(
      "segment x, y: a segment goes from one place to another; give x or y a pair of field names [from, to]",
    );
    expect(make({ x: ["x0"] })).toThrow(
      'segment x: expected a field, or a pair of fields [from, to]; received ["x0"]',
    );
    expect(make({ x: ["x0", "category"] })).toThrow("segment x");
  });

  it("an unknown cap, and sizes below 0", () => {
    expect(make({ caps: { to: "triangle" } })).toThrow(
      'segment caps.to: expected "dot", "arrow", { dot }, or { arrow }; received "triangle"',
    );
    expect(make({ caps: { to: { arrow: { width: -8 } } } })).toThrow(
      "segment caps.to.arrow.width: expected a number of at least 0; received -8",
    );
    expect(make({ caps: { from: { dot: { radius: -1 } } } })).toThrow(
      "segment caps.from.dot.radius: expected a number of at least 0; received -1",
    );
    expect(make({ width: -2 })).toThrow(
      "segment width: expected a number of at least 0; received -2",
    );
    expect(make({ width: { from: 2 } })).toThrow(
      "segment width.to: missing; { from, to } gives the widths at both ends, so give to, or one width for the whole segment",
    );
  });

  it("in specs, at their paths", () => {
    const columns = { a: [1, 2], b: [3, 4], id: ["p", "q"] };
    const load = (mark: object) => () =>
      loadSpec({ data: { t: { columns } }, marks: [{ type: "segment", ...mark }] } as never);
    expect(load({ x: "a", y: "id" })).toThrow(
      "marks[0]: segment x, y: a segment goes from one place to another; give x or y a pair of field names [from, to]",
    );
    expect(load({ x: ["a", "b"], y: "id", caps: { to: "triangle" } })).toThrow(
      'marks[0].caps.to: expected "dot", "arrow", { dot }, or { arrow }; received "triangle"',
    );
    expect(load({ x: ["a", "b"], y: "id", caps: { to: { arrow: { width: -8 } } } })).toThrow(
      "marks[0].caps.to.arrow.width: expected a number of at least 0; received -8",
    );
    expect(load({ x: ["a", "b"], y: "id", tooltip: { total: true } })).toThrow(
      "marks[0].tooltip.total: only lines, filled areas, bars, and points total their points; drop total",
    );
    expect(load({ x: ["a", "b", "a"], y: "id" })).toThrow(
      "marks[0].x: expected a field name, or a pair of field names [from, to]; received an array",
    );
    expect(load({ x: ["a", "b"], y: "id", width: { from: 1 } })).toThrow("marks[0].width");
    expect(load({ x: ["a", "b"], y: "id", width: { series: true } })).toThrow(
      "marks[0].width.series: each row has a width of its own; give a field, a value, or a condition",
    );
    // Opacity is each row's too; a color may be the series'.
    expect(load({ x: ["a", "b"], y: "id", encode: { opacity: { series: true } } })).toThrow(
      "marks[0].encode.opacity.series: each row has an opacity of its own; give a field, a value, or a condition",
    );
    expect(() =>
      loadSpec({
        data: { t: { columns } },
        scales: { hues: { type: "ordinal", map: { "a – b": "#ff0000" } } },
        marks: [
          {
            type: "segment",
            x: ["a", "b"],
            y: "id",
            encode: { color: { series: true, scale: "hues" } },
          },
        ],
      } as never),
    ).not.toThrow();
  });
});
