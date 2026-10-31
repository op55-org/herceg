// Custom marks taking part in the chart's services through their items
// (the customisation study's A2 range comets): the legend and colors from
// the chart's scales, tooltips and picking by the shapes drawn, in paint
// order and inside the clip, selections dimming the items they leave out,
// the keyboard and its announcements, and static output.
import { describe, expect, it } from "vitest";
import { compileExpression } from "../../src/data/expression.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { type RowView, rowView } from "../../src/data/row-view.ts";
import { selectionStore, selectRows } from "../../src/data/selection.ts";
import { type Table, table } from "../../src/data/table.ts";
import { fieldReader } from "../../src/dom/tooltip-content.ts";
import { estimateText } from "../../src/layout/text.ts";
import { type CustomDataOptions, custom, type DataDrawContext } from "../../src/marks/custom.ts";
import { DIM } from "../../src/marks/mark.ts";
import { describeChart } from "../../src/model/describe.ts";
import { facet } from "../../src/model/facet.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { brushedRows } from "../../src/model/selected-rows.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderSvg } from "../../src/render/svg.ts";
import { guidesOf, type PathShape, type ShapesGeometry } from "../../src/scene/scene.ts";
import {
  CATEGORIES,
  COLORS,
  COMET_SCALES,
  type Comet,
  comets,
  cometTable,
  scatteredComets,
} from "../helpers/comets.ts";
import { contractTest } from "../helpers/contracts.ts";
import { legendOf } from "../helpers/guides.ts";
import { readKeys } from "../helpers/keyboard.ts";
import { withPicker } from "../helpers/picker.ts";

function build(config: ChartConfig, width = 600, height = 400) {
  const model = withPicker(
    new ChartModel(
      { locale: "en-US", timeZone: "UTC", ...config },
      undefined,
      ...staticCompilers(),
    ),
  );
  // As a chart does once it has loaded what reads tooltips' fields.
  model.fields = fieldReader;
  model.setSize(width, height, 1);
  return { model, scene: model.scene(estimateText) };
}

type CometSchema = ReturnType<typeof cometTable> extends Table<infer S> ? S : never;

/** Four comets apart from each other, one per category but fx, along x or y. */
const FOUR: Comet[] = [
  { id: "A", x0: 10, y0: 20, x1: 40, y1: 20, confidence: 1, category: "energy", age: 0 },
  { id: "B", x0: 90, y0: 80, x1: 60, y1: 80, confidence: 0, category: "metals", age: 30 },
  { id: "C", x0: 20, y0: 60, x1: 20, y1: 90, confidence: 0.5, category: "grains", age: 15 },
  { id: "D", x0: 80, y0: 10, x1: 80, y1: 40, confidence: 0.5, category: "rates", age: 0 },
];

const chart = (rows: readonly Comet[] = FOUR, config: Partial<ChartConfig> = {}): ChartConfig => ({
  x: { domain: [0, 100], nice: false },
  y: { domain: [0, 100], nice: false },
  scales: COMET_SCALES,
  marks: [comets(cometTable(rows))],
  ...config,
});

const shapesOf = (scene: ReturnType<typeof build>["scene"]) =>
  scene.panels[0]!.marks.filter((m): m is ShapesGeometry => m.kind === "shapes");

/** The pixel of a value pair on the first panel's scales. */
function pixel(model: ChartModel, x: number, y: number): [number, number] {
  const [panel] = model.panels();
  return [panel!.x.map(x), panel!.y.map(y)];
}

describe("custom marks' items", () => {
  contractTest(
    "custom.items.legend",
    () => {
      const { model, scene } = build(chart());
      // A series per category of the scale, each in its color.
      expect(legendOf(scene).map(({ label, color }) => [label, color])).toEqual(
        CATEGORIES.map((c, i) => [c, COLORS[i]]),
      );
      // Each comet painted from its row: color, then opacity through the age scale.
      const shapes = shapesOf(scene)[0]!.shapes as PathShape[];
      expect(shapes.map((s) => [s.fill, Number(s.opacity!.toFixed(3))])).toEqual(
        [
          [COLORS[0], 1],
          [COLORS[1], 0.35],
          [COLORS[2], 0.675],
          [COLORS[3], 1],
        ].flatMap((look) => [look, look]),
      );
      // Hidden through the legend, a category's comets are not drawn.
      model.hidden.add(model.legendEntries()[1]!.key);
      const shown = shapesOf(model.scene(estimateText))[0]!.shapes as PathShape[];
      expect(shown).toHaveLength(6);
      expect(shown.some((s) => s.fill === COLORS[1])).toBe(false);
    },
    "a custom mark's series take the legend's entries and the colors of the chart's scales",
  );

  contractTest(
    "custom.items.tooltip",
    () => {
      const { model } = build(chart());
      // On comet A's tail, a third along: its row's tooltip, by its shape.
      const [x, y] = pixel(model, 20, 20);
      const at = model.inspect(x, y)!;
      expect(at.points.map((p) => [p.label, p.text])).toEqual([["energy", "(10, 20) – (40, 20)"]]);
      expect(at.points[0]!.fields?.map((f) => [f.label, f.text])).toEqual([
        ["id", "A"],
        ["confidence", "1"],
        ["age", "0"],
      ]);
      // Three pixels off the tail (7 px wide there at most), inside its box: nothing.
      expect(model.inspect(x, y + 3 + 3.5)).toBeUndefined();
      // Comet C, along y.
      const [cx, cy] = pixel(model, 20, 70);
      expect(model.inspect(cx, cy)!.points[0]!.text).toBe("(20, 60) – (20, 90)");
    },
    "tooltips read the item under the pointer by its shapes, not its box",
  );

  it("are picked by their shapes, the last painted on top, and not outside the clip", () => {
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
    // Where they cross, the later row's comet, painted over the other.
    expect(picked(35, 50)).toBe(1);
    expect(picked(20, 50)).toBe(0);
    // Past the plot's edge, where the comet is cut, nothing.
    expect(picked(95, 20)).toBe(2);
    const [px, py] = pixel(model, 100, 20);
    expect(model.picker!(px + 6, py)).toBeUndefined();
  });

  contractTest(
    "custom.items.selection",
    () => {
      const data = cometTable(FOUR);
      const store = selectionStore(data);
      const selection = rowSelection({ store, channel: "focus" });
      const { model } = build({ ...chart(), marks: [comets(data)], rowSelection: selection });
      selection.highlight(model);
      const opacities = () =>
        (shapesOf(model.scene(estimateText))[0]!.shapes as PathShape[]).map((s) =>
          Number(s.opacity!.toFixed(4)),
        );
      const before = opacities();
      store.set("focus", selectRows(new RowSet(data).addAll([2])));
      // The selected comet as it was; the others dimmed, still drawn.
      expect(opacities()).toEqual(
        before.map((o, i) => (Math.floor(i / 2) === 2 ? o : Number((o * DIM).toFixed(4)))),
      );
      store.set("focus", null);
      expect(opacities()).toEqual(before);
    },
    "a selection dims the items of rows it leaves out",
  );

  it("draw a selection in their one geometry, their items still picked as drawn", () => {
    const data = cometTable(FOUR);
    const store = selectionStore(data);
    const selection = rowSelection({ store, channel: "focus" });
    const { model } = build({ ...chart(), marks: [comets(data)], rowSelection: selection });
    selection.highlight(model);
    const [x, y] = pixel(model, 20, 20);
    const picked = () => {
      const found = model.picker!(x, y);
      return found?.item.part.kind === "row" ? found.item.part.position : undefined;
    };
    expect(picked()).toBe(0);
    store.set("focus", selectRows(new RowSet(data).addAll([2])));
    const marks = model.scene(estimateText).panels[0]!.marks;
    // No layers of the selected and the rest, as lines draw them: the mark dims its own items.
    expect(marks.map((m) => [m.kind, (m as { opacity?: number }).opacity])).toEqual([
      ["shapes", undefined],
    ]);
    expect(picked()).toBe(0);
  });

  it("brush the rows whose ranges the brush meets", () => {
    const data = cometTable(FOUR);
    const { model } = build({ ...chart(), marks: [comets(data)] });
    const brushed = (x: readonly [number, number] | null, y: readonly [number, number] | null) => {
      const held = brushedRows(model, data as unknown as Table, { x, y, lasso: null }, null);
      if (held?.kind !== "predicate")
        return held?.kind === "rows" ? [...held.rows.positions()] : [];
      const { at } = compileExpression(held.expression, data);
      return FOUR.map((_, row) => row).filter((row) => at(row) === true);
    };
    // A's x runs 10 to 40, B's 60 to 90 (from 90): each meets a brush across its span.
    expect(brushed([30, 35], null)).toEqual([0]);
    expect(brushed([65, 70], null)).toEqual([1]);
    expect(brushed([65, 95], [70, 90])).toEqual([1]);
  });

  it("tell draw which rows a selection holds, and refuse series and rows not its own", () => {
    const data = cometTable(FOUR);
    const store = selectionStore(data);
    const selection = rowSelection({ store, channel: "focus" });
    const seen: (string | undefined)[] = [];
    const reader = custom(data, {
      x: ["x0", "x1"],
      y: "y0",
      draw({ series, selection: of }) {
        seen.length = 0;
        for (let row = 0; row < data.length; row++) seen.push(of(series[0]!, row));
      },
    });
    const { model } = build({ ...chart(), marks: [reader], rowSelection: selection });
    selection.highlight(model);
    expect(seen).toEqual([undefined, undefined, undefined, undefined]);
    store.set("focus", selectRows(new RowSet(data).addAll([1])));
    model.scene(estimateText);
    expect(seen).toEqual(["unselected", "selected", "unselected", "unselected"]);
    const stranger = { ...model.series()[0]!, rowAt: (k: number) => k } as never;
    const bad = (draw: CustomDataOptions<CometSchema>["draw"]) => () =>
      build({ ...chart(), marks: [custom(data, { x: ["x0", "x1"], y: "y0", draw })] });
    expect(bad(({ item }) => item(stranger, 0, () => {}))).toThrow(
      "custom item: the series is not one of this draw's series; pass one of context.series",
    );
    expect(bad(({ item, series }) => item(series[0]!, 9, () => {}))).toThrow(
      'custom item: row 9 is not a row of series "x0 – x1"; pass a row from series.rowAt',
    );
    expect(
      bad(({ item, series }) => item(series[0]!, 0, () => item(series[0]!, 1, () => {}))),
    ).toThrow("custom item: called inside another item's draw; draw each item apart");
  });

  contractTest(
    "custom.items.keyboard",
    () => {
      const fifth: Comet = { ...FOUR[0]!, id: "E", x0: 50, x1: 70, y0: 30, y1: 30 };
      const { model } = build(chart([...FOUR, fifth]));
      // The keys step a series' items in row order, each read as its tooltip.
      expect(readKeys(model, ["ArrowRight", "ArrowRight", "ArrowLeft"])).toEqual([
        "10. energy: (10, 20) – (40, 20)",
        "50. energy: (50, 30) – (70, 30)",
        "10. energy: (10, 20) – (40, 20)",
      ]);
      // Each series is a stop of its own.
      expect(readKeys(model, ["ArrowRight"], "", 1)).toEqual(["90. metals: (90, 80) – (60, 80)"]);
    },
    "the keyboard steps through a custom mark's items, announcing each as its tooltip",
  );

  it("place rows on a band axis by a category field, as A2's rows do", () => {
    const rows = table({
      id: ["F-1", "F-2", "F-3"],
      start: [20, 80, 25],
      end: [70, 30, -12],
      category: ["energy", "metals", "energy"],
    });
    const seen: number[][] = [];
    const { model } = build({
      scales: COMET_SCALES,
      marks: [
        custom(rows, {
          x: ["start", "end"],
          y: "id",
          series: "category",
          draw({ series, x, y, item, path }) {
            const end = rows.numbers("end");
            for (const s of series)
              for (let k = 0; k < s.length; k++) {
                const row = s.rowAt(k);
                seen.push([row, s.y[row]!]);
                item(s, row, () =>
                  path(`M${x(s.x[row]!)} ${y(s.y[row]!) - 3}H${x(end[row]!)}v6H${x(s.x[row]!)}Z`),
                );
              }
          },
        }),
      ],
    });
    expect(model.yScale()!.type).toBe("band");
    expect(seen.sort()).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    // Both ends count toward x: the third row's end is the domain's low end.
    expect(model.xScale()!.domain[0]).toBeLessThanOrEqual(-12);
    const [x, y] = [model.xScale()!.map(0), model.yScale()!.map(2)];
    expect(model.inspect(x, y)!.points.map((p) => [p.label, p.text])).toEqual([
      ["energy", "25 – -12"],
    ]);
    // The text alternative counts each series' ranges and categories, and
    // the extent of both ends, rather than the bands' indices.
    const text = describeChart(model);
    expect(text).toContain("energy: 2 ranges in 2 categories, x from -12 to 70");
    expect(text).toContain("metals: 1 range in 1 category, x from 30 to 80");
    // Ranges along both axes give both extents.
    expect(describeChart(build(chart()).model)).toContain(
      "energy: 1 range, x from 10 to 40, y from 20 to 20",
    );
  });

  it("refuse the series' names for widths and opacities, which draw reads by row", () => {
    for (const name of ["strokeWidth", "opacity"])
      expect(() =>
        build({
          scales: COMET_SCALES,
          marks: [
            custom(cometTable(FOUR), {
              x: ["x0", "x1"],
              y: ["y0", "y1"],
              series: "category",
              encode: { [name]: { series: true, scale: "categories" } } as never,
              draw() {},
            }),
          ],
        }),
      ).toThrow(
        `custom (mark 0) encode.${name}: the series' names give each series one ${name}, and draw reads it by row; give a field, a value, or a condition`,
      );
  });

  it("place rows on a band x axis by a category field, alone and in series", () => {
    const rows = table({ kind: ["a", "b", "a"], value: [1, 3, 2], group: ["g", "h", "h"] });
    for (const series of [undefined, "group"] as const) {
      const seen: number[][] = [];
      const { model } = build({
        marks: [
          custom(rows, {
            x: "kind",
            y: "value",
            ...(series && { series }),
            draw({ series: drawn }) {
              for (const s of drawn)
                for (let k = 0; k < s.length; k++) seen.push([s.rowAt(k), s.x[s.rowAt(k)]!]);
            },
          }),
        ],
      });
      expect(model.xScale()!.type).toBe("band");
      // Each row at its category's band: "a" first, "b" second.
      expect(seen.sort()).toEqual([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
    }
    // Along category y, the text alternative counts categories and reads x's values.
    const { model } = build({ marks: [custom(rows, { x: "value", y: "kind", draw() {} })] });
    expect(describeChart(model)).toContain("kind: 3 points in 2 categories, x from 1 to 3");
  });

  it("place rows on each panel's own categories, along x and along y", () => {
    // N holds b and d, S a and c: chart bands b, a, d, c, each panel two of
    // its own, one row of each kind.
    const products = ["b", "a", "d", "c"];
    const sales = table({
      region: ["N", "S", "N", "S"],
      product: products,
      kind: ["p", "p", "q", "q"],
      low: [1, 2, 3, 4],
      high: [2, 3, 4, 5],
    });
    for (const axis of ["x", "y"] as const) {
      const drawn: [string, number][][] = [];
      // The places each draw's series read, one column shared by all of them.
      const columns: Set<ArrayLike<number>>[] = [];
      const { model } = build({
        facet: facet("region"),
        [axis]: { scope: "panel" },
        marks: [
          custom(sales, {
            // A point per row along x, a range per row along y.
            ...(axis === "x" ? { x: "product", y: "high" } : { x: ["low", "high"], y: "product" }),
            series: "kind",
            draw({ series, x, y, item, rect }: DataDrawContext<never>) {
              const at: [string, number][] = [];
              drawn.push(at);
              columns.push(new Set(series.map((s) => s[axis])));
              const [low, high] = [sales.numbers("low"), sales.numbers("high")];
              for (const s of series)
                for (let k = 0; k < s.length; k++) {
                  const row = s.rowAt(k);
                  at.push([products[row]!, axis === "x" ? x(s.x[row]!) : y(s.y[row]!)]);
                  // Ranges are read by their items: a bar from low to high.
                  if (axis === "y")
                    item(s, row, () =>
                      rect(x(low[row]!), y(s.y[row]!) - 4, x(high[row]!) - x(low[row]!), 8),
                    );
                }
            },
          } as never),
        ],
      });
      const panels = model.panels();
      expect(panels.map((p) => p[axis].categories)).toEqual([
        ["b", "d"],
        ["a", "c"],
      ]);
      expect(columns.slice(-panels.length).map((c) => c.size)).toEqual([1, 1]);
      // Each panel's draw, as the last scene drew them.
      expect(drawn.slice(-panels.length)).toEqual(
        panels.map((p) => p[axis].categories!.map((c, i) => [c, p[axis].map(i)])),
      );
      // The pointer on S's c reads its row: its point, or its bar.
      const s = panels[1]!;
      const [px, py] = axis === "x" ? [s.x.map(1), s.y.map(5)] : [s.x.map(4.5), s.y.map(1)];
      expect(model.inspect(px, py, "nearest", "S")!.points.map((p) => [p.row, p.text])).toEqual([
        [3, axis === "x" ? "5" : "4 – 5"],
      ]);
    }
  });

  it('are picked wherever their clip shows them, past the plot with clip: "chart"', () => {
    // A square left of the plot, in the chart's padding: the same found
    // among few items (searched in turn) and many (through the grid).
    for (const count of [1, 257]) {
      const rows = table({ x: new Array(count).fill(0.5), y: new Array(count).fill(0.5) });
      const { model } = build(
        {
          padding: { left: 400 },
          marks: [
            custom(rows, {
              x: "x",
              y: "y",
              clip: "chart",
              draw({ series, item, rect }) {
                for (const s of series)
                  for (let k = 0; k < s.length; k++)
                    item(s, s.rowAt(k), () => rect(10, 100, 10, 10));
              },
            }),
          ],
        },
        600,
        300,
      );
      expect(model.panels()[0]!.plot.x).toBeGreaterThan(400);
      const found = model.picker!(15, 105);
      expect(found?.item.part.kind === "row" && found.item.part.position, `${count}`).toBe(
        count - 1,
      );
    }
  });

  it("draw items over a sorted view as fast as over a table of its rows", () => {
    // 32,000 items in a view sorted against its table's order: each item
    // call finds its row's position without scanning the series.
    const n = 32_000;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    const y = Float64Array.from({ length: n }, (_, i) => (i * 7919) % 1000);
    const whole = table({ x, y });
    type XY = typeof whole extends Table<infer S> ? S : never;
    const descending = rowView(whole, { sort: [{ field: "x", order: "descending" }] });
    const reversed = table({ x: x.slice().reverse(), y: y.slice().reverse() });
    const squares = (data: Table<XY> | RowView<XY>) =>
      custom(data, {
        x: "x",
        y: "y",
        draw({ series, x: px, y: py, item, rect }) {
          for (const s of series)
            for (let k = 0; k < s.length; k++) {
              const row = s.rowAt(k);
              item(s, row, () => rect(px(s.x[row]!), py(s.y[row]!), 2, 2));
            }
        },
      });
    const fastest = (data: Table<XY> | RowView<XY>) => {
      const { model } = build({ marks: [squares(data)] });
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        model.setSize(600 + (i % 2), 400, 1);
        const start = performance.now();
        model.scene(estimateText);
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };
    const [overTable, overView] = [fastest(reversed), fastest(descending)];
    expect(overView).toBeLessThan(4 * overTable + 25);
  });

  it("draw 2,000 comets and find the one under the pointer by its shape", () => {
    const rows = scatteredComets(2000);
    const { model, scene } = build(chart(rows), 960, 640);
    expect((shapesOf(scene)[0]!.shapes as PathShape[]).length).toBe(4000);
    // A point 40% along each of 50 comets' tails inside the plot finds that
    // comet, or one painted over it there.
    const [panel] = model.panels();
    const inside = (v: number) => v > 1 && v < 99;
    const tested = rows
      .map((c, i) => [c, i] as const)
      .filter(([c]) => [c.x0, c.y0, c.x1, c.y1].every(inside))
      .slice(0, 50);
    let own = 0;
    for (const [c, i] of tested) {
      const [x, y] = [
        panel!.x.map(c.x0 + (c.x1 - c.x0) * 0.4),
        panel!.y.map(c.y0 + (c.y1 - c.y0) * 0.4),
      ];
      const found = model.picker!(x, y);
      expect(found, `comet ${c.id}`).toBeDefined();
      const row = found!.item.part.kind === "row" ? found!.item.part.position : -1;
      expect(row).toBeGreaterThanOrEqual(i);
      if (row === i) own++;
    }
    expect(own).toBeGreaterThan(25);
  });

  contractTest(
    "custom.items.export",
    () => {
      const data = cometTable(FOUR);
      const store = selectionStore(data);
      const selection = rowSelection({ store, channel: "focus" });
      const { model } = build({ ...chart(), marks: [comets(data)], rowSelection: selection });
      selection.highlight(model);
      store.set("focus", selectRows(new RowSet(data).addAll([1])));
      model.hidden.add(model.legendEntries()[0]!.key);
      const scene = model.scene(estimateText);
      const svg = renderSvg(scene);
      // Drawn as shown: the hidden category's comets left out, its entry
      // faded; the selected comet as it is, the others dimmed.
      const label = guidesOf(scene, "legend")[0]!.items.find(
        (item) => item.type === "text" && item.text === "energy",
      );
      expect(label?.type === "text" && label.opacity).toBe(0.4);
      expect(svg).not.toMatch(/<path[^>]*fill="#1f77b4"/);
      expect(svg).toMatch(/<path[^>]*fill="#ff7f0e" fill-opacity="0.35"/);
      expect(svg).toMatch(/<path[^>]*fill="#2ca02c" fill-opacity="0.16875"/);
    },
    "static output draws the items as shown: hidden series left out, selections dimming the rest",
  );
});
