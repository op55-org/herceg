// Marks of rows placed by coordinates their fields give: shares of a frame,
// pixels from its edge, and offsets on their axis. Such places draw where
// they say, count toward no domain, stay put as the axes zoom, and are
// inspected and selected as they are drawn.
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { compileExpression } from "../../src/data/expression.ts";
import { rowView } from "../../src/data/row-view.ts";
import { selectionStore } from "../../src/data/selection.ts";
import { type Table, table } from "../../src/data/table.ts";
import { axis } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { grid } from "../../src/layout.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { boundFrame } from "../../src/marks/features/positions.ts";
import { line } from "../../src/marks/line.ts";
import type { Frame } from "../../src/marks/mark.ts";
import { point } from "../../src/marks/point.ts";
import { region } from "../../src/marks/region.ts";
import { bindRows, type RowBindings } from "../../src/marks/row-bindings.ts";
import { rule } from "../../src/marks/rule.ts";
import { placeAt, rowOf, samePositions } from "../../src/marks/series.ts";
import { type AxisContext, createScale } from "../../src/model/axis.ts";
import { facet } from "../../src/model/facet.ts";
import type { FeatureKit } from "../../src/model/features.ts";
import type { AxisInspection } from "../../src/model/inspect.ts";
import { inspectPosition, keyboardStops } from "../../src/model/keyboard.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { NAVIGATOR_PANEL, rangeNavigator } from "../../src/model/navigator.ts";
import { panels } from "../../src/model/panels.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { type Brushed, brushedRows } from "../../src/model/selected-rows.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { NO_PAGE } from "../../src/render/fallbacks.ts";
import type {
  AreaGeometry,
  LineGeometry,
  PointGeometry,
  Rect,
  RectGeometry,
  RuleGeometry,
  Scene,
  TextGeometry,
} from "../../src/scene/scene.ts";
import type { ScaleScope } from "../../src/spec/spec.ts";
import { contractTest } from "../helpers/contracts.ts";
import { gridAt } from "../helpers/grid.ts";
import { setViewport } from "../helpers/views.ts";

const rows = table({
  t: [0, 1, 2, 3],
  v: [10, 20, 30, 40],
  lane: [0.25, 0.25, 0.75, 0.75],
  px: [0, 10, 20, 30],
  kind: ["a", "b", "a", "b"],
});

function build(config: ChartConfig, width = 400, height = 200) {
  const model = new ChartModel(
    { locale: "en-US", legend: false, ...config },
    NO_PAGE,
    ...staticCompilers(),
  );
  model.setSize(width, height, 1);
  return { model, scene: model.scene(estimateText) };
}

/** A line's drawn points, as [x, y] pairs. */
function points(scene: Scene, index = 0): [number, number][] {
  const { path } = scene.panels[0]!.marks.filter((m) => m.kind === "line")[index] as LineGeometry;
  return Array.from({ length: path.count }, (_, i) => [
    path.coords[i * 2]!,
    path.coords[i * 2 + 1]!,
  ]);
}

const plotOf = (scene: Scene): Rect => scene.panels[0]!.plot;

describe("marks of rows placed by coordinates", () => {
  contractTest("position.binding.forms", () => {
    // Each position's field, and how each direction binds, as its first position does.
    const bind = (spec: object) => bindRows(spec, rows as never, "line", ["x", "y", "y1", "y2"]);
    expect(bind({ x: "t", y: "v" })).toEqual({ fields: { x: "t", y: "v" } });
    expect(bind({ x: { field: "t" }, y: { field: "v", scale: "y" } })).toEqual({
      fields: { x: "t", y: "v" },
      bound: {},
    });
    expect(bind({ x: { field: "t", offset: 2 }, y: { field: "v", scale: "depth" } })).toEqual({
      fields: { x: "t", y: "v" },
      bound: { x: { kind: "axis", offset: 2 }, y: { kind: "scale", scale: "depth", offset: 0 } },
    });
    expect(
      bind({
        x: { px: { field: "px" }, frame: "chart", offset: -4 },
        y1: { fraction: { field: "lane" } },
        y2: { fraction: { field: "lane" } },
      }),
    ).toEqual({
      fields: { x: "px", y1: "lane", y2: "lane" },
      bound: {
        x: { kind: "frame", unit: "px", frame: "chart", offset: -4 },
        y: { kind: "frame", unit: "fraction", frame: "plot", offset: 0 },
      },
    });
  });

  contractTest("position.fraction.rows", () => {
    // Lanes: each row's share of the plot's height, whatever y shows.
    const lanes = line(rows, { x: "t", y: { fraction: { field: "lane" } } });
    const values = line(rows, { x: "t", y: "v" });
    const { model, scene } = build({ marks: [values, lanes] });
    const plot = plotOf(scene);
    const at = (share: number) => plot.y + plot.height * (1 - share);
    expect(points(scene, 1).map(([, y]) => y)).toEqual(
      [0.25, 0.25, 0.75, 0.75].map((share) => expect.closeTo(at(share), 3)),
    );
    // The lanes' shares count toward no domain: y fits the values alone.
    const [lo, hi] = model.yScale()!.domain;
    expect(lo).toBeGreaterThan(1);
    expect(hi).toBeGreaterThanOrEqual(40);
    // Zooming y moves the values, not the lanes (scenes reuse their buffers).
    const first = points(scene, 0)[0]![1];
    setViewport(model, { y: [15, 25], yRight: null });
    const zoomed = model.scene(estimateText);
    expect(points(zoomed, 1).map(([, y]) => y)).toEqual(
      [0.25, 0.25, 0.75, 0.75].map((share) => expect.closeTo(at(share), 3)),
    );
    expect(points(zoomed, 0)[0]![1]).toBeGreaterThan(first + 40);
  });

  contractTest("position.pixels.rows", () => {
    // Pixels from the plot's left edge along x, from the chart's top along y.
    const marks = [
      point(rows, {
        x: { px: { field: "px" } },
        y: { px: { field: "px" }, frame: "chart", offset: 40 },
      }),
    ];
    const { scene } = build({ marks });
    const plot = plotOf(scene);
    const drawn = scene.panels[0]!.marks[0] as PointGeometry;
    expect(Array.from(drawn.coords.slice(0, 8))).toEqual([
      plot.x,
      40,
      plot.x + 10,
      50,
      plot.x + 20,
      60,
      plot.x + 30,
      70,
    ]);
  });

  contractTest("position.pixels.margins", () => {
    // Points placed in the chart's margins show where the mark is not cut to the plot.
    const two = table({ p: [10, 80], v: [0.5, 0.5] });
    const drawn = (clip?: "chart" | false) => {
      const { scene } = build({
        y: { domain: [0, 1] },
        marks: [
          point(two, {
            x: { px: { field: "p" }, frame: "chart" },
            y: "v",
            ...(clip === undefined ? {} : { clip }),
          }),
        ],
      });
      expect(plotOf(scene).x).toBeGreaterThan(20);
      const { coords, count } = scene.panels[0]!.marks[0] as PointGeometry;
      return Array.from({ length: count }, (_, i) => coords[i * 2]);
    };
    expect(drawn()).toEqual([80]);
    expect(drawn("chart")).toEqual([10, 80]);
    expect(drawn(false)).toEqual([10, 80]);
  });

  contractTest("position.offset.spread", () => {
    // Rows spread across a band moved out of the plot are drawn, and found,
    // where spreading puts them.
    const one = table({
      c: Array.from({ length: 20 }, () => "a"),
      v: new Float64Array(20).fill(0.5),
    });
    const { model, scene } = build(
      {
        y: { domain: [0, 1] },
        marks: [point(one, { x: { field: "c", offset: -200 }, y: "v", jitter: { width: 1 } })],
      },
      400,
      300,
    );
    const plot = plotOf(scene);
    const { coords, count } = scene.panels[0]!.marks[0] as PointGeometry;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
    for (let i = 0; i < count; i++) expect(coords[i * 2]).toBeGreaterThan(plot.x - 5);
    const found = model.inspect(coords[0]!, coords[1]!, "nearest");
    expect(found?.points[0]?.px).toBeCloseTo(coords[0]!, 3);
  });

  contractTest("position.offset.rows", () => {
    // An offset moves rows on their own axis, which their values still fit.
    const plain = build({ marks: [line(rows, { x: "t", y: "v" })] });
    const moved = build({ marks: [line(rows, { x: { field: "t", offset: 6 }, y: "v" })] });
    expect(moved.model.xScale()!.domain).toEqual(plain.model.xScale()!.domain);
    const before = points(plain.scene);
    expect(points(moved.scene)).toEqual(before.map(([x, y]) => [x + 6, y]));
  });

  contractTest("position.frame.fields", () => {
    const thrown = (make: () => unknown) => {
      try {
        make();
      } catch (error) {
        return error;
      }
      throw new Error("expected an error");
    };
    // A coordinate's field is named where it is given, as the mark is made.
    expect(
      thrown(() => line(rows, { x: "t", y: { px: { field: "none" as never } } })),
    ).toMatchObject({ code: "unknown-field", path: "y.px.field" });
    // The rest is checked as the chart compiles, at the mark's option.
    const refused = (mark: object) => thrown(() => build({ marks: [mark as never] }));
    // A share is a number field's.
    expect(
      refused(line(rows, { x: "t", y: { fraction: { field: "kind" as never } } })),
    ).toMatchObject({ code: "field-type", path: "marks[0].y.fraction.field" });
    // The ends of a band are placed alike.
    expect(
      refused(area(rows, { x: "t", y1: { fraction: { field: "lane" } }, y2: "v" } as never)),
    ).toMatchObject({ code: "unsupported", path: "marks[0].y2" });
    // A y on the other axis' scale, or off the right axis it is on.
    expect(refused(line(rows, { x: "t", y: { field: "v", scale: "x" } }))).toMatchObject({
      code: "invalid-option",
      path: "marks[0].y.scale",
    });
    expect(
      refused(line(rows, { x: "t", y: { fraction: { field: "lane" } }, axis: "right" })),
    ).toMatchObject({ code: "invalid-option", path: "marks[0].axis" });
    // A symmetric error bar's center is a field.
    expect(
      thrown(() =>
        errorbar(rows, { x: "t", y: { fraction: { field: "lane" } }, yError: "px" } as never),
      ),
    ).toMatchObject({ code: "invalid-option", path: "y" });
  });

  it("draws bars from a frame's base, and leaves y to the other marks", () => {
    // Bars a share of the plot tall stand on its bottom.
    const shares = bar(rows, { x: "t", y: { fraction: { field: "lane" } } });
    const { model, scene } = build({ marks: [line(rows, { x: "t", y: "v" }), shares] });
    const plot = plotOf(scene);
    const { rects: coords } = scene.panels[0]!.marks.find((m) => m.kind === "rect") as RectGeometry;
    // Each rectangle: x, y, width, height; the first a quarter of the plot tall.
    expect(coords[1]! + coords[3]!).toBeCloseTo(plot.y + plot.height, 3);
    expect(coords[3]).toBeCloseTo(plot.height * 0.25, 3);
    // No zero on y for bars measured off it.
    expect(model.yScale()!.domain[0]).toBeGreaterThan(0);
  });

  contractTest("position.inspect", () => {
    const lanes = point(rows, { x: "t", y: { fraction: { field: "lane" } } });
    const placed = point(rows, { x: { fraction: { field: "lane" } }, y: "v" });
    const values = line(rows, { x: "t", y: "v" });
    const { model, scene } = build({ marks: [values, lanes, placed] });
    const plot = plotOf(scene);
    const x = model.xScale()!.map(2);
    // Along x, points are read at the x snapped to: those of lanes there,
    // their values their shares; points placed off x are not on it.
    const along = model.inspect(x, plot.y + plot.height * 0.25, "nearest-x")!;
    expect(along.label).toBe("2");
    expect(along.points.map((p) => [p.mark, p.text])).toEqual([
      [0, "30"],
      [1, "0.75"],
    ]);
    // Nearest, a point placed off x is found where it is drawn, headed by its share.
    const shareX = plot.x + plot.width * 0.25;
    const near = model.inspect(shareX, model.yScale()!.map(20), "nearest")!;
    expect(near).toMatchObject({ axis: "x", value: 0.25, label: "0.25" });
    expect((near as AxisInspection).position).toBeCloseTo(shareX, 3);
    expect(near.points[0]).toMatchObject({ mark: 2, value: 20, text: "20" });
  });

  contractTest("position.keyboard", () => {
    // The keyboard reads a point placed off x alone, headed by its share.
    const placed = point(rows, { x: { fraction: { field: "lane" } }, y: "v" });
    const { model, scene } = build({ marks: [line(rows, { x: "t", y: "v" }), placed] });
    const panel = scene.panels[0]!;
    const inspector = model.inspectorOf(panel.key)!;
    const key = inspector.marks[1]!.visible[0]!.key;
    const read = inspectPosition(model, key, 2, undefined, { placeAt, rowOf })!;
    expect(read).toMatchObject({ axis: "x", value: 0.75, label: "0.75" });
    expect(read.points.map((p) => p.mark)).toEqual([1]);
    expect(read.position).toBeCloseTo(panel.plot.x + panel.plot.width * 0.75, 3);
    // A series of one table placed off x is a stop of its own, though its
    // field is another's x: it is read alone.
    const shares = table({ t: [0, 0.5, 1], v: [1, 2, 3] });
    const both = build({
      marks: [
        line(shares, { x: "t", y: "v" }),
        line(shares, { x: { fraction: { field: "t" } }, y: "v" }),
      ],
    });
    const stops = keyboardStops(both.model.inspectorOf(both.scene.panels[0]!.key), samePositions);
    expect(stops).toHaveLength(2);
  });

  contractTest("position.navigator", () => {
    // A strip draws lanes in its own box, and leaves out marks placed off x.
    const lanes = line(rows, { x: "t", y: { fraction: { field: "lane" } } });
    const placed = point(rows, { x: { fraction: { field: "lane" } }, y: "v" });
    const { scene } = build({
      marks: [line(rows, { x: "t", y: "v" }), lanes, placed],
      navigator: rangeNavigator(),
    });
    const strip = scene.panels.find(({ key }) => key === NAVIGATOR_PANEL)!;
    const drawn = strip.marks.filter((m) => m.kind === "line") as LineGeometry[];
    expect(drawn).toHaveLength(2);
    const ys = Array.from({ length: 4 }, (_, i) => drawn[1]!.path.coords[i * 2 + 1]!);
    const { y, height } = strip.plot;
    expect(ys).toEqual(
      [0.25, 0.25, 0.75, 0.75].map((s) => expect.closeTo(y + height * (1 - s), 3)),
    );
    expect(strip.marks.some((m) => m.kind === "point")).toBe(false);
    // Lanes in the chart's frame are in the strip's too: it is the overview's chart.
    const laneYs = (
      y: { fraction: { field: "lane" }; frame: "chart" } | { px: { field: "px" }; frame: "chart" },
    ) => {
      const { scene: drawn } = build({
        marks: [line(rows, { x: "t", y: "v" }), line(rows, { x: "t", y })],
        navigator: rangeNavigator(),
      });
      const at = drawn.panels.find(({ key }) => key === NAVIGATOR_PANEL)!;
      const lane = at.marks.filter((m) => m.kind === "line")[1] as LineGeometry | undefined;
      return lane && Array.from({ length: 4 }, (_, i) => lane.path.coords[i * 2 + 1]!);
    };
    expect(laneYs({ fraction: { field: "lane" }, frame: "chart" })).toEqual(ys);
    expect(laneYs({ px: { field: "px" }, frame: "chart" })).toEqual(
      [0, 10, 20, 30].map((p) => expect.closeTo(y + p, 3)),
    );
    // Nor do their values count toward its x: pixels, or another scale's.
    const far = table({ p: [10000, 20000], v: [1, 2] });
    const stripLine = (marks: ChartConfig["marks"]) => {
      const { scene: drawn } = build({
        marks: [line(rows, { x: "t", y: "v" }), ...marks],
        scales: { share: { type: "linear" } },
        navigator: rangeNavigator(),
      });
      const at = drawn.panels.find(({ key }) => key === NAVIGATOR_PANEL)!;
      return Array.from((at.marks.find((m) => m.kind === "line") as LineGeometry).path.coords);
    };
    const alone = stripLine([]);
    expect(stripLine([point(far, { x: { px: { field: "p" } }, y: "v" })])).toEqual(alone);
    expect(stripLine([point(far, { x: { field: "p", scale: "share" }, y: "v" })])).toEqual(alone);
  });

  contractTest("position.brush", () => {
    // Brushes select rows by their values on the axis: none for rows placed off it.
    const selection = rowSelection({ store: selectionStore(rows), channel: "picked" });
    const lanes = point(rows, { x: "t", y: { fraction: { field: "lane" } } });
    const brushed = (brush: "x" | "y" | "xy") => () =>
      build({ marks: [lanes], interaction: { brush }, rowSelection: selection });
    expect(brushed("y")).toThrow(/point brush: its y is not on the y axis/);
    expect(brushed("xy")).toThrow(/brush along x only/);
    expect(brushed("x")).not.toThrow();
  });

  contractTest("scale.position.own", () => {
    // A scale of the chart's own: its domain from what is placed on it,
    // over each plot's height, apart from y; tooltips write its values.
    const depth = table({ t: [0, 1, 2, 3], d: [100, 400, 250, 900] });
    const { model, scene } = build({
      marks: [
        line(rows, { x: "t", y: "v" }),
        line(depth, { x: "t", y: { field: "d", scale: "depth" } }),
      ],
      scales: { depth: { type: "linear" } },
    });
    const plot = plotOf(scene);
    const [, drawn] = [points(scene, 0), points(scene, 1)];
    // Rounded to [0, 1000]: 100 is a tenth of the way up, 900 nine tenths.
    expect(drawn[0]![1]).toBeCloseTo(plot.y + plot.height * 0.9, 3);
    expect(drawn[3]![1]).toBeCloseTo(plot.y + plot.height * 0.1, 3);
    expect(model.yScale()!.domain[1]).toBeLessThan(100);
    const near = model.inspect(drawn[3]![0], drawn[3]![1], "nearest")!;
    expect(near.points[0]).toMatchObject({ mark: 1, value: 900, text: "900" });
  });

  contractTest("scale.position.own.scope", () => {
    // As the axes' scales: subplots each their own by default, shared as a scope says.
    const one = table({ t: [0, 1], d: [0, 10] });
    const two = table({ t: [0, 1], d: [0, 1000] });
    const config = (scope?: ScaleScope): ChartConfig => ({
      panels: panels([{ id: "a" }, { id: "b" }]),
      marks: [
        line(one, { x: "t", y: { field: "d", scale: "depth" }, panel: "a" }),
        line(two, { x: "t", y: { field: "d", scale: "depth" }, panel: "b" }),
      ],
      scales: { depth: { type: "linear", ...(scope && { scope }) } },
    });
    const top = (scene: Scene, panel: number) => {
      const { path } = scene.panels[panel]!.marks[0] as LineGeometry;
      return path.coords[3]! - scene.panels[panel]!.plot.y;
    };
    const apart = build(config()).scene;
    expect(top(apart, 0)).toBeCloseTo(0, 3);
    expect(top(apart, 1)).toBeCloseTo(0, 3);
    for (const scope of ["chart", { panels: ["a", "b"] }] as const) {
      const shared = build(config(scope)).scene;
      expect(top(shared, 0)).toBeGreaterThan(shared.panels[0]!.plot.height * 0.9);
      expect(top(shared, 1)).toBeCloseTo(0, 3);
    }
  });

  contractTest("scale.position.own.axis", () => {
    // An axis guide shows a scale of the chart's own where it is placed.
    const depth = table({ t: [0, 1, 2, 3], d: [100, 400, 250, 900] });
    const marks = [
      line(rows, { x: "t", y: "v" }),
      line(depth, { x: "t", y: { field: "d", scale: "depth" } }),
    ];
    const scales = { depth: { type: "linear" as const } };
    const plain = build({ marks, scales }).scene;
    const { scene } = build({
      marks,
      scales,
      guides: [axis({ scale: "depth", place: { side: "right" }, title: "Depth" })],
    });
    const plot = plotOf(scene);
    const shown = scene.panels[0]!.axes.find((a) => a.scale === "depth")!;
    expect(shown.side).toBe("right");
    expect(shown.title?.text).toBe("Depth");
    // Its ticks where its scale places them, and room kept beside the plot.
    const ticks = shown.ticks.map((t) => [t.label, t.position]);
    expect(ticks[0]).toEqual(["0", expect.closeTo(plot.y + plot.height, 3)]);
    expect(ticks.at(-1)).toEqual(["1,000", expect.closeTo(plot.y, 3)]);
    expect(plot.width).toBeLessThan(plotOf(plain).width - 20);
    expect(() =>
      build({ marks, scales, guides: [axis({ scale: "depth", place: { side: "left" } })] }),
    ).toThrow(/goes on the "right" \(along y\) or the "top" \(along x\)/);
    // Any name is the chart's own, those every object has too.
    for (const name of ["constructor", "toString"]) {
      const named = build({
        marks: [marks[0]!, line(depth, { x: "t", y: { field: "d", scale: name } })],
        scales: { [name]: { type: "linear" as const } },
        guides: [axis({ scale: name, place: { side: "right" } })],
      }).scene;
      expect(named.panels[0]!.axes.find((a) => a.scale === name)?.side).toBe("right");
    }
  });

  contractTest("scale.position.own.axis.instances", () => {
    // An axis of a scale of the chart's own goes by each instance of it,
    // however the subplots share x and y.
    const [a, b] = [table({ n: [10], v: [1] }), table({ n: [1000], v: [2] })];
    const share = (scope?: ScaleScope) => ({
      share: { type: "linear" as const, ...(scope && { scope }) },
    });
    const axesOf = (config: ChartConfig) =>
      build(config).scene.panels.map(
        (p) => p.axes.find((shown) => shown.scale === "share")?.ticks.at(-1)?.label,
      );
    const subplots = (scope?: ScaleScope, repeat?: "all") =>
      axesOf({
        panels: panels([{ id: "a" }, { id: "b" }]),
        x: { scope: "chart" },
        marks: [
          point(a, { x: { field: "n", scale: "share" }, y: "v", panel: "a" }),
          point(b, { x: { field: "n", scale: "share" }, y: "v", panel: "b" }),
        ],
        scales: share(scope),
        guides: [axis({ scale: "share", place: { side: "top" }, ...(repeat && { repeat }) })],
      });
    // Each subplot its own instance, and its own axis over it.
    const apart = subplots();
    expect(apart[0]).not.toBe(apart[1]);
    expect(apart.every((label) => label !== undefined)).toBe(true);
    // One instance: one axis, over the first, or as repeat says.
    expect(subplots("chart")[1]).toBeUndefined();
    expect(subplots("chart", "all")[1]).toBe(subplots("chart")[0]);
    // Side by side, sharing y: an axis on the right of each instance.
    const beside = (scope?: ScaleScope) =>
      axesOf({
        panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 2 })),
        y: { scope: "chart" },
        marks: [
          point(a, { x: "v", y: { field: "n", scale: "share" }, panel: "a" }),
          point(b, { x: "v", y: { field: "n", scale: "share" }, panel: "b" }),
        ],
        scales: share(scope),
        guides: [axis({ scale: "share", place: { side: "right" } })],
      });
    const each = beside();
    expect(each[0]).not.toBe(each[1]);
    expect(each.every((label) => label !== undefined)).toBe(true);
    expect(beside("chart")[0]).toBeUndefined();
  });

  contractTest("position.off-axis.y-labels", () => {
    // Rows placed off x only, in a frame or on a scale of the chart's own,
    // still give y values to label and grid lines.
    const lanes = table({ f: [0.2, 0.8], n: [1, 2], v: [10, 20] });
    for (const x of [{ fraction: { field: "f" } }, { field: "n", scale: "share" }] as const) {
      const { scene } = build({
        marks: [point(lanes, { x, y: "v" })],
        scales: { share: { type: "linear" } },
      });
      const panel = scene.panels[0]!;
      const left = panel.axes.find((shown) => shown.side === "left")!;
      expect(left.ticks.map((t) => t.label)).toContain("16");
      expect(gridAt(panel, "y").length).toBeGreaterThan(0);
    }
  });

  contractTest("scale.position.own.axis.columns", () => {
    // A scale of each column of facets is not its rows': an axis on the
    // right of the last panel of a row would leave the others' unlabeled.
    const sites = table({ g: ["a", "b"], n: [10, 1000], v: [1, 2] });
    const config = (repeat?: "all"): ChartConfig => ({
      facet: facet("g", { columns: 2 }),
      marks: [point(sites, { x: "v", y: { field: "n", scale: "share" } })],
      scales: { share: { type: "linear", scope: "column" } },
      guides: [axis({ scale: "share", place: { side: "right" }, ...(repeat && { repeat }) })],
    });
    expect(() => build(config())).toThrow(
      /a y axis on the right stands beside each row's last panel/,
    );
    const each = build(config("all")).scene.panels.map((p) =>
      p.axes.some((shown) => shown.scale === "share"),
    );
    expect(each).toEqual([true, true]);
  });

  contractTest("scale.position.own.axis.rows", () => {
    // A scale of each row of facets is not its columns': an axis above the
    // first row would leave the others' unlabeled.
    const sites = table({ g: ["a", "b"], n: [10, 1000], v: [1, 2] });
    const config = (repeat?: "all"): ChartConfig => ({
      facet: facet({ row: "g" }),
      marks: [point(sites, { x: { field: "n", scale: "share" }, y: "v" })],
      scales: { share: { type: "linear", scope: "row" } },
      guides: [axis({ scale: "share", place: { side: "top" }, ...(repeat && { repeat }) })],
    });
    expect(() => build(config())).toThrow(
      /an x axis above the plots stands over each column's first panel, so the panels of a column must share share; give share scope "column" or "chart", or repeat "all" for one above every panel$/,
    );
    const each = build(config("all")).scene.panels.map((p) =>
      p.axes.some((shown) => shown.scale === "share"),
    );
    expect(each).toEqual([true, true]);
    // As x's own axis above the plots does, with a scale of each row.
    expect(() =>
      build({
        facet: facet({ row: "g" }),
        x: { scope: "row" },
        marks: [point(sites, { x: "n", y: "v" })],
        guides: [axis({ scale: "x", place: { side: "top" } })],
      }),
    ).toThrow(/give x scope "column" or "chart", repeat "all" for one above every panel/);
  });

  contractTest("scale.position.own.scope.facets", () => {
    // Facets share a scale of the chart's own by panel, row, or column only.
    const sites = table({ g: ["a", "b"], n: [10, 1000], v: [1, 2] });
    expect(() =>
      build({
        facet: facet("g"),
        marks: [point(sites, { x: "v", y: { field: "n", scale: "share" } })],
        scales: { share: { type: "linear", scope: { panels: ["a"] } } },
      }),
    ).toThrow(
      /^chart scales\.share\.scope: facets share a scale across the chart, by panel, row, or column; scopes naming layout grids or panels are for subplots$/,
    );
  });

  contractTest("scale.position.own.axis.format", () => {
    // Values on a scale of the chart's own are written as its axis writes
    // them, unless the scale gives a tooltipFormat.
    const rates = table({ t: [0, 1, 2, 3], r: [0.1, 0.25, 0.5, 0.75] });
    const read = (tooltipFormat?: { number: string }) => {
      const { model, scene } = build({
        marks: [
          line(rows, { x: "t", y: "v" }),
          line(rates, { x: "t", y: { field: "r", scale: "rate" } }),
        ],
        scales: { rate: { type: "linear", ...(tooltipFormat && { tooltipFormat }) } },
        guides: [axis({ scale: "rate", place: { side: "right" }, format: { number: ".0%" } })],
      });
      const shown = scene.panels[0]!.axes.find((a) => a.scale === "rate")!;
      const [x, y] = points(scene, 1)[1]!;
      const near = model.inspect(x, y, "nearest")!;
      return { labels: shown.ticks.map((t) => t.label), text: near.points[0]!.text };
    };
    const plain = read();
    expect(plain.labels).toContain("40%");
    expect(plain.text).toBe("25%");
    expect(read({ number: ".3f" }).text).toBe("0.250");
  });

  contractTest("scale.position.own.axis.top", () => {
    // Above categories along x, an axis of a numeric scale of the chart's
    // own, with a second layer, is measured and drawn on its own scale.
    const sites = table({ c: ["a", "b", "c"], v: [3, 5, 2], n: [0, 50, 100] });
    const { scene } = build({
      marks: [
        bar(sites, { x: "c", y: "v" }),
        point(sites, { x: { field: "n", scale: "share" }, y: "v" }),
      ],
      scales: { share: { type: "linear" } },
      guides: [
        axis({
          scale: "share",
          place: { side: "top" },
          layers: [{ id: "minor", ticks: { values: [25, 75] } }],
        }),
      ],
    });
    const plot = plotOf(scene);
    const top = scene.panels[0]!.axes.find((a) => a.scale === "share")!;
    expect(top.side).toBe("top");
    // Its own ticks (0 to 100, padded for the points' markers) across the plot.
    const at = new Map(top.ticks.map((t) => [t.label, t.position]));
    expect(at.get("0")).toBeGreaterThanOrEqual(plot.x);
    expect(at.get("100")).toBeLessThanOrEqual(plot.x + plot.width);
    expect(at.get("100")! - at.get("0")!).toBeGreaterThan(plot.width * 0.8);
  });

  contractTest("scale.position.own.unknown", () => {
    const marks = [line(rows, { x: "t", y: { field: "v", scale: "depth" } })];
    expect(() => build({ marks, scales: { other: { type: "linear" } } })).toThrow(
      expect.objectContaining({ code: "unknown-reference", path: "marks[0].y.scale" }),
    );
  });
});

describe("positions off their axis, as the review found them", () => {
  contractTest("position.off-axis.y-domain", () => {
    // A line placed along x on a scale of its own fits y with all its rows,
    // whatever the x axis shows; and so does one placed in a frame.
    const depth = table({ d: [100, 200], v: [10, 20] });
    const own = build({
      scales: { depth: { type: "linear" } },
      marks: [line(depth, { x: { field: "d", scale: "depth" }, y: "v" })],
    });
    const [lo, hi] = own.model.yScale()!.domain;
    expect(lo).toBeLessThanOrEqual(10);
    expect(hi).toBeGreaterThanOrEqual(20);
    const shares = table({ s: [0.2, 0.8], v: [10, 20] });
    const framed = build({
      marks: [
        line(rows, { x: "t", y: "v" }),
        line(shares, { x: { fraction: { field: "s" } }, y: "v" }),
      ],
    });
    setViewport(framed.model, [100, 200]);
    framed.model.scene(estimateText);
    expect(framed.model.yScale()!.domain[1]).toBeGreaterThanOrEqual(20);
  });

  contractTest("position.offset.inspect", () => {
    // Points moved 30 pixels are inspected, and snapped to, where they are drawn.
    const moved = point(rows, { x: { field: "t", offset: 30 }, y: "v" });
    const { model, scene } = build({ marks: [moved] });
    const drawn = scene.panels[0]!.marks[0] as PointGeometry;
    const [px, py] = [drawn.coords[2]!, drawn.coords[3]!];
    for (const mode of ["nearest", "nearest-x"] as const) {
      const found = model.inspect(px, py, mode) as AxisInspection;
      expect(found.value).toBe(1);
      expect(found.position).toBeCloseTo(px, 3);
    }
  });

  contractTest("position.offset.y-domain", () => {
    // Offsets move what is drawn, not what y fits: a row before the x
    // domain moved 60 pixels into the plot is drawn and inspected there...
    const marks = (y: number[]) => [
      point(table({ x: [-1, 0, 10], y }), { x: { field: "x", offset: 60 }, y: "y" }),
    ];
    const { model, scene } = build({ x: { domain: [0, 10] }, marks: marks([5, 1, 10]) });
    const drawn = scene.panels[0]!.marks[0] as PointGeometry;
    expect(drawn.coords[0]).toBeGreaterThan(plotOf(scene).x);
    const found = model.inspect(drawn.coords[0]!, drawn.coords[1]!, "nearest-x") as AxisInspection;
    expect(found.value).toBe(-1);
    expect(found.position).toBeCloseTo(drawn.coords[0]!, 3);
    // ...and y fits the rows the domain holds, however wide the plot.
    const wide = build({ x: { domain: [0, 10] }, marks: marks([100, 1, 1]) });
    expect(wide.model.yScale()!.domain[1]).toBeLessThan(100);
    const narrow = build({ x: { domain: [0, 10] }, marks: marks([100, 1, 1]) }, 200);
    expect(narrow.model.yScale()!.domain).toEqual(wide.model.yScale()!.domain);
  });

  contractTest("position.padding.y-domain", () => {
    // Padding around an x domain shows rows beyond it, which y does not
    // fit (shares and pixels alike): y fits the domain's rows, steadily.
    const rows = table({ x: [-1, 0, 5, 10], y: [1000, 1, 2, 1] });
    for (const padding of [{ px: 40 }, 0.2]) {
      const { model } = build({
        x: { domain: [0, 10], padding },
        marks: [line(rows, { x: "x", y: "y" })],
      });
      const first = model.yScale()!.domain;
      expect(first[1]).toBeLessThan(1000);
      model.scene(estimateText);
      expect(model.yScale()!.domain).toEqual(first);
    }
  });

  contractTest("position.offset.trace", () => {
    // Lines moved along their positions are drawn through the rows moved
    // into view, to the plot's edges, whichever way they move and run.
    const many = table({
      t: Array.from({ length: 31 }, (_, i) => i - 10),
      v: Array.from({ length: 31 }, (_, i) => (i % 2) * 10),
    });
    for (const offset of [100, -100])
      for (const orient of ["x", "y"] as const) {
        const along = orient === "x" ? "x" : "y";
        const { scene } = build({
          [along]: { domain: [0, 10] },
          marks: [
            line(many, {
              ...(orient === "x"
                ? { x: { field: "t", offset }, y: "v" }
                : { y: { field: "t", offset }, x: "v", orient: "y" }),
            }),
          ],
        });
        const plot = plotOf(scene);
        const across = points(scene).map(([x, y]) => (orient === "x" ? x : y));
        const [lo, hi] =
          orient === "x" ? [plot.x, plot.x + plot.width] : [plot.y, plot.y + plot.height];
        expect(Math.min(...across), `${orient} ${offset}`).toBeLessThanOrEqual(lo);
        expect(Math.max(...across), `${orient} ${offset}`).toBeGreaterThanOrEqual(hi);
      }
  });

  contractTest("position.frame.offset.trace", () => {
    // Lines placed by shares or pixels and moved are drawn through the
    // rows moved into view, to the plot's edges, whichever way they move.
    const many = table({
      f: Array.from({ length: 31 }, (_, i) => i / 10 - 1),
      p: Array.from({ length: 31 }, (_, i) => i * 40 - 400),
      v: Array.from({ length: 31 }, (_, i) => (i % 2) * 10),
    });
    for (const unit of ["fraction", "px"] as const)
      for (const offset of [100, -100])
        for (const orient of ["x", "y"] as const) {
          const place = { [unit]: { field: unit === "fraction" ? "f" : "p" }, offset };
          const { scene } = build({
            marks: [
              line(
                many,
                orient === "x"
                  ? { x: place as never, y: "v" }
                  : { y: place as never, x: "v", orient: "y" },
              ),
            ],
          });
          const plot = plotOf(scene);
          const across = points(scene).map(([x, y]) => (orient === "x" ? x : y));
          const [lo, hi] =
            orient === "x" ? [plot.x, plot.x + plot.width] : [plot.y, plot.y + plot.height];
          const name = `${unit} ${orient} ${offset}`;
          expect(Math.min(...across), name).toBeLessThanOrEqual(lo);
          expect(Math.max(...across), name).toBeGreaterThanOrEqual(hi);
        }
  });

  contractTest("position.frame.view", () => {
    // Every bound scale runs over the plot's pixels, its domain what they
    // show, and places values where its binding says.
    const plot = { x: 50, y: 20, width: 300, height: 150 };
    const chart = { x: 0, y: 0, width: 400, height: 200 };
    const linear = { type: "linear" } as AxisContext;
    const axes = {
      x: createScale(linear, [0, 10], [50, 350]),
      y: createScale(linear, [0, 100], [170, 20]),
    };
    const own = (axis: "x" | "y") =>
      createScale({ type: "log" } as AxisContext, [1, 1000], axis === "x" ? [50, 350] : [170, 20]);
    const kit = { createScale } as unknown as FeatureKit;
    const frame = { ...axes, plot, chart, scaleOf: (_: string, axis: "x" | "y") => own(axis) };
    const bindings: [string, (offset: number) => RowBindings[keyof RowBindings]][] = [
      ["axis", (offset) => ({ kind: "axis", offset })],
      ["scale", (offset) => ({ kind: "scale", scale: "depth", offset })],
      ["fraction plot", (offset) => ({ kind: "frame", unit: "fraction", frame: "plot", offset })],
      ["fraction chart", (offset) => ({ kind: "frame", unit: "fraction", frame: "chart", offset })],
      ["px plot", (offset) => ({ kind: "frame", unit: "px", frame: "plot", offset })],
      ["px chart", (offset) => ({ kind: "frame", unit: "px", frame: "chart", offset })],
    ];
    /** Where a value goes, as the binding says, independently of the scales. */
    const expected = (name: string, axis: "x" | "y", value: number, offset: number) => {
      const box = name.endsWith("chart") ? chart : plot;
      const [start, length] = axis === "x" ? [box.x, box.width] : [box.y, box.height];
      if (name === "axis") return axes[axis].map(value) + offset;
      if (name === "scale") return own(axis).map(value) + offset;
      if (name.startsWith("px")) return start + value + offset;
      return (axis === "x" ? start + value * length : start + length * (1 - value)) + offset;
    };
    for (const [name, bind] of bindings)
      for (const axis of ["x", "y"] as const)
        for (const offset of [-30, 0, 30]) {
          const scale = boundFrame(kit, frame as unknown as Frame, { [axis]: bind(offset) })[axis];
          const label = `${name} ${axis} ${offset}`;
          const pixels = axis === "x" ? [50, 350] : [20, 170];
          expect(
            [...scale.range].sort((a, b) => a - b),
            label,
          ).toEqual(pixels);
          scale.domain.forEach((end, i) => {
            expect(scale.map(end), label).toBeCloseTo(scale.range[i]!, 6);
          });
          for (const value of name === "scale" ? [2, 30, 500] : [0.1, 0.5, 40]) {
            expect(scale.map(value), label).toBeCloseTo(expected(name, axis, value, offset), 6);
            expect(scale.invert(scale.map(value)), label).toBeCloseTo(value, 6);
            const { origin, offset: at, factor, log } = scale.mapping();
            expect(at + ((log ? Math.log10(value) : value) - origin) * factor, label).toBeCloseTo(
              scale.map(value),
              6,
            );
          }
        }
  });

  contractTest("position.offset.area", () => {
    // Areas too: their edge reaches the plot's left edge through rows moved into view.
    const many = table({
      t: Array.from({ length: 31 }, (_, i) => i - 10),
      v: Array.from({ length: 31 }, (_, i) => (i % 2) * 10),
    });
    const { scene } = build({
      x: { domain: [0, 10] },
      marks: [area(many, { x: { field: "t", offset: 100 }, y: "v" })],
    });
    const { upper } = scene.panels[0]!.marks.find((m) => m.kind === "area") as AreaGeometry;
    expect(upper.coords[0]).toBeLessThanOrEqual(plotOf(scene).x);
  });

  contractTest("position.offset.brush", () => {
    // A brush along x selects the rows drawn under it, moved by their offset.
    const moved = point(rows, { x: { field: "t", offset: 60 }, y: "v" });
    const { model } = build({ marks: [moved] });
    const x = model.xScale()!;
    const at = x.invert(x.map(0) + 60);
    const picked = brushedRows(
      model,
      rows as unknown as Table,
      { x: [at - 0.05, at + 0.05], y: null, lasso: null },
      null,
    );
    expect(picked?.kind).toBe("predicate");
    const test = compileExpression(
      (picked as { expression: Parameters<typeof compileExpression>[0] }).expression,
      rows,
    );
    expect([0, 1, 2, 3].filter((row) => test.at(row))).toEqual([0]);
  });

  contractTest("position.offset.brush.bands", () => {
    // A brush over categories selects the rows drawn in their slots, moved by their offset.
    const kinds = table({ c: ["a", "b", "c"], v: [1, 2, 3] });
    const brushed = (mark: ChartConfig["marks"][number], brush: Brushed) => {
      const { model } = build({ marks: [mark] });
      const picked = brushedRows(model, kinds as unknown as Table, brush, null);
      const test = compileExpression(
        (picked as { expression: Parameters<typeof compileExpression>[0] }).expression,
        kinds,
      );
      return [0, 1, 2].filter((row) => test.at(row));
    };
    const points = point(kinds, { x: { field: "c", offset: 10 }, y: "v" });
    expect(brushed(points, { x: [0, 0], y: null, lasso: null })).toEqual([0]);
    expect(brushed(points, { x: [1, 2], y: null, lasso: null })).toEqual([1, 2]);
    const bars = bar(kinds, { x: "v", y: { field: "c", offset: 10 } });
    expect(brushed(bars, { x: null, y: [1, 1], lasso: null })).toEqual([1]);
  });

  contractTest("position.offset.brush.panels", () => {
    // Plots of other widths sharing x: an offset is more of x in the
    // narrower, and a brush selects the rows each panel draws under it.
    const two = table({ t: [3.4, 2.5], v: [1, 2] });
    const { model } = build({
      panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: [2, 1] })),
      x: { domain: [0, 10], scope: "chart" },
      marks: [point(two, { x: { field: "t", offset: 20 }, y: "v", panel: "*" })],
    });
    const under = model.panels().map(({ x }) =>
      [0, 1].filter((row) => {
        const at = x.invert(x.map(two.numbers("t")[row]!) + 20);
        return at >= 4 && at <= 5;
      }),
    );
    // Each panel draws a row of its own under the brush.
    expect(under).toEqual([[0], [1]]);
    const picked = brushedRows(
      model,
      two as unknown as Table,
      { x: [4, 5], y: null, lasso: null },
      null,
    );
    const test = compileExpression(
      (picked as { expression: Parameters<typeof compileExpression>[0] }).expression,
      two,
    );
    expect([0, 1].filter((row) => test.at(row))).toEqual([0, 1]);
  });

  contractTest("position.scale.own.zero", () => {
    // A scale's zero: false holds, though bars stand on it.
    const tall = table({ c: [0, 1, 2], v: [10, 20, 30] });
    const { scene } = build({
      scales: { depth: { type: "linear", zero: false, nice: false } },
      marks: [
        line(rows, { x: "t", y: "v" }),
        bar(tall, { x: "c", y: { field: "v", scale: "depth" } }),
      ],
    });
    const plot = plotOf(scene);
    const { rects } = scene.panels[0]!.marks.find((m) => m.kind === "rect") as RectGeometry;
    // The shortest bar's tip, 10, is the scale's low end: the plot's bottom.
    expect(rects[1]).toBeCloseTo(plot.y + plot.height, 3);
  });

  contractTest("position.scale.own.continuity", () => {
    // Times on a time scale of the chart's own break lines by day, as on x.
    const day = 86_400_000;
    const times = table({ at: time([0, day / 2, day * 1.5, day * 2]), v: [1, 2, 3, 4] });
    const { scene } = build({
      scales: { when: { type: "time" } },
      marks: [
        line(rows, { x: "t", y: "v" }),
        line(times, {
          x: { field: "at", scale: "when" },
          y: "v",
          continuity: { breakBy: "day" },
        }),
      ],
    });
    expect(scene.panels[0]!.marks.filter((m) => m.kind === "line").length).toBeGreaterThan(1);
  });

  contractTest("position.scale.own.log-where", () => {
    // A line's crossing where its rows stop meeting its condition is found
    // on the log scale of its own it is placed on, as it is drawn there:
    // halfway from 1 to 100 is 10, where the line reaches 50.
    const growth = table({ t: [1, 100], v: [0, 100] });
    const { model } = build({
      scales: { depth: { type: "log" } },
      marks: [line(growth, { x: { field: "t", scale: "depth" }, y: "v", where: col("t").lt(10) })],
    });
    expect(model.yScale()!.domain[1]).toBeGreaterThanOrEqual(50);
  });

  contractTest("position.scale.own.view", () => {
    // A view's rows changing, as many as before, change the domain.
    const depths = table({ t: [0, 1, 2, 3], d: [0, 10, 100, 1000] });
    const view = rowView(depths, { filter: col("d").lt(50) });
    const { model } = build({
      scales: { depth: { type: "linear", nice: false } },
      marks: [point(view, { x: "t", y: { field: "d", scale: "depth" } })],
    });
    const ys = () => {
      const drawn = model.scene(estimateText).panels[0]!.marks[0] as PointGeometry;
      return Array.from({ length: drawn.count }, (_, i) => drawn.coords[i * 2 + 1]!);
    };
    const shallow = ys();
    view.setQuery({ filter: col("d").gt(50) });
    expect(ys()).toEqual(shallow);
  });

  contractTest("position.scale.own.drawn", () => {
    // Domains of the chart's own scales hold what marks draw: not rows
    // their continuity leaves out.
    const spiky = table({ t: [0, 1, 2], v: [0, 10, 1000] });
    const { scene } = build({
      scales: { depth: { type: "linear", nice: false, padding: 0 } },
      marks: [
        line(rows, { x: "t", y: "v" }),
        line(spiky, {
          x: "t",
          y: { field: "v", scale: "depth" },
          continuity: { defined: col("v").lt(500) },
        }),
      ],
    });
    const plot = plotOf(scene);
    const ys = points(scene, 1).map(([, y]) => y);
    expect(Math.min(...ys)).toBeCloseTo(plot.y, 3);
    expect(Math.max(...ys)).toBeCloseTo(plot.y + plot.height, 3);
  });

  contractTest("position.scale.own.labels", () => {
    // Bars' labels at the end of a scale of the chart's own stay in the plot.
    const tall = table({ c: [0, 1, 2], v: [10, 20, 30] });
    const { scene } = build({
      scales: { depth: { type: "linear", nice: false } },
      marks: [
        line(rows, { x: "t", y: "v" }),
        bar(tall, { x: "c", y: { field: "v", scale: "depth" }, labels: true }),
      ],
    });
    const plot = plotOf(scene);
    const labels = scene.panels[0]!.marks.find((m) => m.kind === "text") as TextGeometry;
    // The tallest bar's label, its middle half a line below the plot's top.
    expect(labels.coords[5]).toBeGreaterThanOrEqual(plot.y + 6);
  });

  contractTest("position.scale.own.room", () => {
    // Automatic padding keeps room for points on the chart's own scales.
    const { scene } = build({
      scales: { depth: { type: "linear", nice: false } },
      marks: [
        line(rows, { x: "t", y: "v" }),
        point(rows, { x: "t", y: { field: "v", scale: "depth" }, radius: 10 }),
      ],
    });
    const plot = plotOf(scene);
    const drawn = scene.panels[0]!.marks.find((m) => m.kind === "point") as PointGeometry;
    const ys = Array.from({ length: drawn.count }, (_, i) => drawn.coords[i * 2 + 1]!);
    expect(Math.min(...ys)).toBeCloseTo(plot.y + 10, 3);
    expect(Math.max(...ys)).toBeCloseTo(plot.y + plot.height - 10, 3);
  });

  contractTest("position.coordinate.forms", () => {
    // One form per coordinate, with the options it takes, as the validator says.
    const refused = (y: object) => {
      try {
        build({ marks: [line(rows, { x: "t", y: y as never })] });
      } catch (error) {
        return error;
      }
      throw new Error("expected an error");
    };
    expect(refused({ field: "v", fraction: { field: "lane" } })).toMatchObject({
      code: "invalid-option",
      path: "marks[0].y",
    });
    expect(refused({ field: "v", frame: "chart" })).toMatchObject({
      code: "invalid-option",
      path: "marks[0].y.frame",
    });
    expect(refused({ fraction: { field: "lane" }, scale: "y" })).toMatchObject({
      code: "invalid-option",
      path: "marks[0].y.scale",
    });
  });
});

describe("annotations placed by coordinates", () => {
  contractTest("position.fraction.annotations", () => {
    // Rules at each row's share of the plot, and a region from a value to the plot's end.
    const marks = [
      line(rows, { x: "t", y: "v" }),
      rule(rows, { y: { fraction: { field: "lane" } } }),
      region({ x1: 2, x2: { fraction: 1 } }),
    ];
    const { model, scene } = build({ marks });
    const plot = plotOf(scene);
    const rules = scene.panels[0]!.marks.filter((m) => m.kind === "rule") as RuleGeometry[];
    expect(rules.map((r) => r.y1)).toEqual(
      [0.25, 0.25, 0.75, 0.75].map((share) =>
        expect.closeTo(plot.y + plot.height * (1 - share), 3),
      ),
    );
    const { rects } = scene.panels[0]!.marks.find((m) => m.kind === "rect") as RectGeometry;
    expect(rects[0]).toBeCloseTo(model.xScale()!.map(2), 3);
    expect(rects[0]! + rects[2]!).toBeCloseTo(plot.x + plot.width, 3);
  });

  contractTest("position.scale.annotations", () => {
    // A rule on a scale of the chart's own, which its value counts toward when it says so.
    const depth = table({ t: [0, 1], d: [0, 100] });
    const marks = (contributeDomain?: boolean) => [
      line(depth, { x: "t", y: { field: "d", scale: "depth" } }),
      rule({ y: { data: 400, scale: "depth" }, ...(contributeDomain && { contributeDomain }) }),
    ];
    const at = (contributeDomain?: boolean) => {
      const { scene } = build({
        marks: marks(contributeDomain),
        scales: { depth: { type: "linear" } },
      });
      const plot = plotOf(scene);
      const rule = scene.panels[0]!.marks.find((m) => m.kind === "rule") as
        | RuleGeometry
        | undefined;
      return rule && (plot.y + plot.height - rule.y1) / plot.height;
    };
    // Off the domain [0, 100], it is not drawn; counted, the domain reaches it.
    expect(at()).toBeUndefined();
    expect(at(true)).toBeCloseTo(1, 3);
  });
});
