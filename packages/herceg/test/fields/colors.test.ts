// Field displays' colors: thresholds and mapping colors read by marks
// coloring by a field without a scale, the colors of category values
// wherever the chart colors by them, legends' keys of them, gauges' bands,
// rules and regions at thresholds, tooltip fields' colors, and `displayOf`.
import { describe, expect, it } from "vitest";
import { category } from "../../src/data/column.ts";
import { derive } from "../../src/data/derive.ts";
import { col } from "../../src/data/expr.ts";
import { table } from "../../src/data/table.ts";
import { displayOf, type FieldDisplays, type MissingDisplay } from "../../src/fields.ts";
import { legend } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import type { DrawnMark } from "../../src/marks/drawn.ts";
import { partReader } from "../../src/marks/drawn-parts.ts";
import { gauge } from "../../src/marks/gauge.ts";
import { graph } from "../../src/marks/graph.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { SWATCH } from "../../src/marks/key-legend.ts";
import { line } from "../../src/marks/line.ts";
import type { Mark } from "../../src/marks/mark.ts";
import { point } from "../../src/marks/point.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { rowOf } from "../../src/marks/series.ts";
import { tooltipWriters } from "../../src/marks/tooltip-writers.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import {
  type ArcGeometry,
  type LabelsGeometry,
  LEGEND_SWATCH,
  type PointGeometry,
  type RasterGeometry,
  type RectGeometry,
  type RuleGeometry,
  type Scene,
  type TextGeometry,
} from "../../src/scene/scene.ts";
import { keysOf, legendOf } from "../helpers/guides.ts";
import { xScale, yScale } from "../helpers/scales.ts";

function build(config: ChartConfig, width = 640, height = 360) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    staticCompilers(),
  );
  model.writers = tooltipWriters;
  model.setSize(width, height, 1);
  return { model, scene: model.scene(estimateText) };
}

/** The legend's keys: their titles, and each entry's text and color. */
const keys = (scene: Scene) =>
  keysOf(scene).map((key) => ({
    title: key.title.text,
    entries: key.entries.map((entry) => ({ label: entry.label.text, fill: entry.fill })),
  }));

/** Each rectangle's fill, in the order drawn. */
const rectFills = (scene: Scene) =>
  scene.panels[0]!.marks.filter((m): m is RectGeometry => m.kind === "rect").flatMap((g) =>
    Array.from({ length: g.count }, () => g.fill),
  );

const GREEN = "#2e7d32";
const AMBER = "#f9a825";
const RED = "#c62828";

const STEPS = {
  base: GREEN,
  steps: [
    { value: 200, color: AMBER },
    { value: 500, color: RED },
  ],
};

const latency: FieldDisplays = {
  p99: { format: { duration: "millisecond" }, min: 0, max: 1_000, thresholds: STEPS },
};

const services = () =>
  table({
    service: category(["auth", "cart", "edge", "feed", "geo"]),
    p99: [120, 200, 499, 500, 900],
  });

describe("display colors", () => {
  it("color bars by step without a scale, steps taking their own value", () => {
    const { scene } = build({
      fields: latency,
      marks: [bar(services(), { x: "service", y: "p99", encode: { color: { field: "p99" } } })],
    });
    expect(rectFills(scene)).toEqual([GREEN, AMBER, AMBER, RED, RED]);
  });

  it("refuse a number field without a scale or display colors, naming both fixes", () => {
    expect(() =>
      build({
        fields: { p99: { label: "p99" } },
        marks: [bar(services(), { x: "service", y: "p99", encode: { color: { field: "p99" } } })],
      }),
    ).toThrow(
      'bar (mark 0) encode.color.field: field "p99" holds numbers, and fields give it no colors; name a channel scale (a scale of the chart\'s with a range), take its values as colors (scale: { type: "identity" }), or give fields.p99 thresholds or mappings with colors',
    );
  });

  it("list a key of the steps in the bars' legend", () => {
    const { scene } = build({
      fields: latency,
      marks: [bar(services(), { x: "service", y: "p99", encode: { color: { field: "p99" } } })],
    });
    expect(keys(scene)).toEqual([
      {
        title: "p99",
        entries: [
          { label: "< 200ms", fill: GREEN },
          { label: "200ms – 500ms", fill: AMBER },
          { label: "≥ 500ms", fill: RED },
        ],
      },
    ]);
  });

  it("draw rows without a display color in the theme's muted color, as a scale's unmapped values", () => {
    const { scene } = build({
      fields: { p99: { thresholds: { steps: [{ value: 500, color: RED }] } } },
      marks: [bar(services(), { x: "service", y: "p99", encode: { color: { field: "p99" } } })],
    });
    const { muted } = scene.theme;
    expect(rectFills(scene)).toEqual([muted, muted, muted, RED, RED]);
  });

  it("draw rows missing the value in the missing color, where the display gives one", () => {
    const rows = table({ service: category(["a", "b"]), n: [1, 2], p99: [120, Number.NaN] });
    const fills = (missing: string | MissingDisplay) =>
      rectFills(
        build({
          fields: { p99: { ...latency.p99, missing } },
          marks: [bar(rows, { x: "service", y: "n", encode: { color: { field: "p99" } } })],
        }).scene,
      );
    expect(fills({ text: "n/a", color: "#9e9e9e" })).toEqual([GREEN, "#9e9e9e"]);
    expect(fills("n/a")[1]).not.toBe(GREEN);
  });

  it("list a key for display colors outlining marks, once for a field filling and outlining them", () => {
    const outlined = (encode: object) =>
      keys(
        build({
          fields: latency,
          marks: [bar(services(), { x: "service", y: "p99", encode })],
        }).scene,
      ).map((key) => key.entries.map((entry) => entry.fill));
    expect(outlined({ stroke: { field: "p99" } })).toEqual([[GREEN, AMBER, RED]]);
    expect(outlined({ color: { field: "p99" }, stroke: { field: "p99" } })).toEqual([
      [GREEN, AMBER, RED],
    ]);
  });

  it("show a mark's key in the legends that list the mark: a subplot's, or one including its colors", () => {
    const shown = (config: Partial<ChartConfig>) =>
      keys(
        build({
          fields: latency,
          // Only the legends guides list.
          legend: false,
          ...config,
          marks: [
            bar(services(), {
              x: "service",
              y: "p99",
              encode: { color: { field: "p99" } },
              id: "lat",
              panel: "a",
            }),
            line(services(), { x: "service", y: "p99", id: "plain", panel: "b" }),
          ],
        }).scene,
      ).map((key) => key.entries.length);
    expect(
      shown({ panels: panels([{ id: "a" }, { id: "b" }]), guides: [legend({ panel: "a" })] }),
    ).toEqual([3]);
    expect(
      shown({ panels: panels([{ id: "a" }, { id: "b" }]), guides: [legend({ panel: "b" })] }),
    ).toEqual([]);
    expect(
      shown({
        panels: panels([{ id: "a" }, { id: "b" }]),
        guides: [legend({ include: [{ mark: "lat", channel: "color" }] })],
      }),
    ).toEqual([3]);
  });

  it("color rows missing a category in the missing color, where the display gives one", () => {
    const rows = table({
      service: category(["a", "b", "c"]),
      n: [1, 2, 3],
      status: category(["ok", null, "ok"]),
    });
    const { scene } = build({
      fields: {
        status: { mappings: [{ value: "ok", color: GREEN }], missing: { color: "#9e9e9e" } },
      },
      marks: [
        bar(rows, {
          x: "service",
          y: "n",
          series: "service",
          encode: { color: { field: "status" } },
        }),
      ],
    });
    expect(rectFills(scene)).toEqual([GREEN, "#9e9e9e", GREEN]);
  });

  it("let guides name the color of marks keyed by display colors, marks left out of legends too", () => {
    const keyed = (spec: { legend?: false }, guides?: ChartConfig["guides"]) =>
      keys(
        build({
          fields: latency,
          guides,
          marks: [
            line(services(), {
              x: "service",
              y: "p99",
              encode: { color: { field: "p99" } },
              id: "lat",
              ...spec,
            }),
          ],
        }).scene,
      ).length;
    const naming = [legend({ include: [{ mark: "lat", channel: "color" }] })];
    expect(keyed({}, naming)).toBe(1);
    expect(keyed({ legend: false })).toBe(0);
    expect(keyed({ legend: false }, naming)).toBe(1);
  });

  it('write a step\'s open end as a mapping before it leaves it: "> 500ms" where the mapping takes 500ms', () => {
    const { scene } = build({
      fields: {
        p99: { ...latency.p99, mappings: [{ between: [null, 500], color: "#0000ff" }] },
      },
      marks: [bar(services(), { x: "service", y: "p99", encode: { color: { field: "p99" } } })],
    });
    expect(keys(scene)[0]!.entries.map((entry) => [entry.label, entry.fill])).toEqual([
      ["≤ 500ms", "#0000ff"],
      ["> 500ms", RED],
    ]);
  });

  it("list a range mapping of one value in keys, as a value mapping", () => {
    const { scene } = build({
      fields: {
        p99: {
          ...latency.p99,
          mappings: [{ between: [500, 500], text: "limit", color: "#000000" }],
        },
      },
      marks: [bar(services(), { x: "service", y: "p99", encode: { color: { field: "p99" } } })],
    });
    expect(keys(scene)[0]!.entries.map((entry) => [entry.label, entry.fill])).toEqual([
      ["limit", "#000000"],
      ["< 200ms", GREEN],
      ["200ms – 500ms", AMBER],
      ["≥ 500ms", RED],
    ]);
  });

  it("leave keys without entries mappings take whole", () => {
    const { scene } = build({
      fields: {
        p99: {
          ...latency.p99,
          mappings: [{ between: [150, 600], text: "normal", color: "#000000" }],
        },
      },
      marks: [bar(services(), { x: "service", y: "p99", encode: { color: { field: "p99" } } })],
    });
    const [key] = keys(scene);
    // The step from 200 to 500 lies inside the mapping's range: no value takes its color.
    expect(key!.entries.map((entry) => entry.fill)).toEqual(["#000000", GREEN, RED]);
    expect(key!.entries[0]!.label).toBe("normal");
  });

  it("let a declared color scale color its values whole", () => {
    const data = table({ status: category(["200", "503"]), count: [1, 2] });
    const { scene } = build({
      fields: { status: { mappings: [{ value: "503", color: RED }] } },
      scales: { color: { type: "ordinal", map: { "200": "#111111", "503": "#222222" } } },
      marks: [bar(data, { x: "status", y: "count", color: "status" })],
    });
    expect(rectFills(scene)).toEqual(["#111111", "#222222"]);
  });

  it("list the same key for lines and areas colored by display colors", () => {
    const data = table({ t: [0, 1, 2, 3, 4], p99: [120, 200, 499, 500, 900] });
    for (const mark of [line, area]) {
      const { scene } = build({
        fields: latency,
        marks: [mark(data, { x: "t", y: "p99", encode: { color: { field: "p99" } } })],
      });
      expect(keys(scene)).toEqual([
        {
          title: "p99",
          entries: [
            { label: "< 200ms", fill: GREEN },
            { label: "200ms – 500ms", fill: AMBER },
            { label: "≥ 500ms", fill: RED },
          ],
        },
      ]);
    }
  });

  it("size keys' swatches as the legend's other swatches", () => {
    // The key's layout imports nothing of the chart's (marks/key-legend.ts).
    expect(SWATCH).toBe(LEGEND_SWATCH);
  });

  it("color series of a category field by their values' mapping colors", () => {
    const data = table({
      t: [0, 1, 0, 1],
      status: category(["200", "200", "503", "503"]),
      count: [1, 2, 3, 4],
    });
    const { scene } = build({
      fields: { status: { mappings: [{ value: "503", text: "Unavailable", color: RED }] } },
      marks: [line(data, { x: "t", y: "count", series: "status" })],
    });
    const legend = legendOf(scene);
    expect(legend.map((e) => [e.label, e.color])).toEqual([
      ["200", expect.any(String)],
      ["Unavailable", RED],
    ]);
    expect(legend[0]!.color).not.toBe(RED);
  });

  it("refuse a value two displays of one identity color differently", () => {
    const data = table({ status: category(["200", "503"]), count: [1, 2] });
    // A derived table's status stands for the same values as its source's.
    const busy = derive(data).filter(col("count").gt(1)).table({ name: "busy" });
    const config = (color: string): ChartConfig => ({
      fields: [
        { match: "status", mappings: [{ value: "503", color: RED }] },
        { match: { table: "busy" }, mappings: [{ value: "503", color }] },
      ],
      marks: [
        bar(data, { x: "status", y: "count", color: "status" }),
        bar(busy, { x: "status", y: "count", color: "status" }),
      ],
    });
    expect(() => build(config("#ff0000"))).toThrow(
      'chart fields: "503" of "status" is "#c62828" (fields[0]) and "#ff0000" (fields[1]); one value has one color',
    );
    expect(() => build(config(RED))).not.toThrow();
  });
});

describe("points and heatmaps", () => {
  const readings = () =>
    table({ x: [0, 1, 2, 3, 4], y: [0, 1, 2, 3, 4], p99: [120, 200, 499, 500, Number.NaN] });

  /** Each point's color, in the order drawn. */
  const pointColors = (scene: Scene) =>
    scene.panels[0]!.marks.filter((m): m is PointGeometry => m.kind === "point").flatMap((g) =>
      Array.from(g.colors!.index.subarray(0, g.count), (i) => g.colors!.palette[i]),
    );

  it("take a number color field's display colors where they give no ramp of their own", () => {
    const { scene } = build({
      fields: latency,
      marks: [point(readings(), { x: "x", y: "y", color: "p99" })],
    });
    // A point missing the value it is colored by is not drawn, as with a ramp.
    expect(pointColors(scene)).toEqual([GREEN, AMBER, AMBER, RED]);
    expect(keys(scene).map((key) => key.entries.map((entry) => entry.fill))).toEqual([
      [GREEN, AMBER, RED],
    ]);
  });

  it("keep their ramp where they give colors, a domain, or a midpoint", () => {
    for (const own of [
      { colorDomain: [0, 1000] as const },
      { colorMidpoint: 300 },
      { colors: ["#000000", "#ffffff"] },
    ]) {
      const { scene } = build({
        fields: latency,
        marks: [point(readings(), { x: "x", y: "y", color: "p99", ...own })],
      });
      expect(pointColors(scene)).not.toContain(AMBER);
      expect(keys(scene)).toEqual([]);
    }
  });

  it("draw values without a display color in the theme's muted color", () => {
    const { scene } = build({
      fields: { p99: { thresholds: { steps: [{ value: 500, color: RED }] } } },
      marks: [point(readings(), { x: "x", y: "y", color: "p99" })],
    });
    expect(pointColors(scene)).toEqual([...Array(3).fill(scene.theme.muted), RED]);
  });

  it("leave points missing the value undrawn, whatever color the display gives missing values", () => {
    const { scene } = build({
      fields: { p99: { ...latency.p99, missing: { color: "#0000ff" } } },
      marks: [point(readings(), { x: "x", y: "y", color: "p99" })],
    });
    expect(pointColors(scene)).toEqual([GREEN, AMBER, AMBER, RED]);
  });

  it("paint heatmap cells in their display colors, cells without one transparent", () => {
    const cells = table({ x: [0, 1, 2], y: [0, 0, 0], p99: [100, 300, 700] });
    const { scene } = build({
      fields: {
        p99: {
          thresholds: {
            steps: [
              { value: 200, color: "#ff0000" },
              { value: 500, color: "#0000ff" },
            ],
          },
        },
      },
      marks: [heatmap(cells, { x: "x", y: "y", color: "p99" })],
    });
    const raster = scene.panels[0]!.marks.find((m): m is RasterGeometry => m.kind === "raster")!;
    const colors = new Set<string>();
    for (let i = 0; i < raster.pixels.length; i += 4)
      colors.add(Array.from(raster.pixels.subarray(i, i + 4)).join());
    expect([...colors].sort()).toEqual(["0,0,0,0", "0,0,255,255", "255,0,0,255"]);
  });

  /** Each color the heatmap's raster paints, as "r,g,b,a". */
  const rasterColors = (scene: Scene) => {
    const raster = scene.panels[0]!.marks.find((m): m is RasterGeometry => m.kind === "raster")!;
    const colors = new Set<string>();
    for (let i = 0; i < raster.pixels.length; i += 4)
      colors.add(Array.from(raster.pixels.subarray(i, i + 4)).join());
    return [...colors].sort();
  };

  it("paint heatmap cells in display colors of any CSS form, and again as the displays change", () => {
    const cells = table({ x: [0, 1, 2], y: [0, 0, 0], p99: [100, 300, 700] });
    const config = (low: string, high: string): ChartConfig => ({
      fields: { p99: { thresholds: { base: low, steps: [{ value: 500, color: high }] } } },
      marks: [heatmap(cells, { x: "x", y: "y", color: "p99" })],
    });
    const { model, scene } = build(config("red", "hsl(240 100% 50%)"));
    expect(rasterColors(scene)).toEqual(["0,0,255,255", "255,0,0,255"]);
    model.update(config("rgb(0 128 0 / 50%)", "blue"));
    expect(rasterColors(model.scene(estimateText))).toEqual(["0,0,255,255", "0,128,0,128"]);
  });

  it("keep a heatmap's image across frames where points read the same field", () => {
    const cells = table({ x: [0, 1, 2], y: [0, 0, 0], p99: [100, 300, 700] });
    const { model, scene } = build({
      fields: latency,
      marks: [
        heatmap(cells, { x: "x", y: "y", color: "p99" }),
        point(cells, { x: "x", y: "y", color: "p99" }),
      ],
    });
    const image = (scene: Scene) =>
      scene.panels[0]!.marks.find((m): m is RasterGeometry => m.kind === "raster")!;
    // A byte an unchanged frame keeps, as it paints nothing again.
    image(scene).pixels[3] = 7;
    expect(image(model.scene(estimateText)).pixels[3]).toBe(7);
    // As where another chart draws the same displays between its frames.
    build({ fields: latency, marks: [heatmap(cells, { x: "x", y: "y", color: "p99" })] });
    expect(image(model.scene(estimateText)).pixels[3]).toBe(7);
  });

  it("paint points in row order where a display color is translucent", () => {
    const opaque = (color: string) =>
      build({
        fields: { p99: { thresholds: { base: GREEN, steps: [{ value: 300, color }] } } },
        marks: [point(readings(), { x: "x", y: "y", color: "p99" })],
      })
        .scene.panels[0]!.marks.filter((m): m is PointGeometry => m.kind === "point")
        .map((g) => g.opaque);
    expect(opaque(RED)).toEqual([true]);
    expect(opaque("rgba(198, 40, 40, 0.5)")).toEqual([false]);
  });
});

describe("gauges", () => {
  const arcs = (scene: Scene, key: string) =>
    scene.panels[0]!.marks.find((m): m is ArcGeometry => m.kind === "arc" && m.key === key);

  it("take a band per step within their ends, and color the value by its step", () => {
    const at = (value: number) =>
      build({ fields: latency, marks: [gauge(table({ p99: [value] }), { value: "p99" })] }).scene;
    const scene = at(200);
    const bands = arcs(scene, "gauge-bands")!;
    expect(bands.count).toBe(3);
    expect(Array.from(bands.colorIndex, (i) => bands.colors[i])).toEqual([GREEN, AMBER, RED]);
    // 200 is the 200 step's, not the band ending there.
    expect(arcs(scene, "gauge-dial")!.colors[1]).toBe(AMBER);
    expect(arcs(at(199), "gauge-dial")!.colors[1]).toBe(GREEN);
    expect(arcs(at(1_500), "gauge-dial")!.colors[1]).toBe(RED);
  });

  it("keep bands of their own", () => {
    const { scene } = build({
      fields: latency,
      marks: [
        gauge(table({ p99: [200] }), {
          value: "p99",
          bands: [
            { to: 200, color: "#000000" },
            { to: 1_000, color: "#ffffff" },
          ],
        }),
      ],
    });
    expect(arcs(scene, "gauge-dial")!.colors[1]).toBe("#000000");
  });
});

describe("rules and regions at thresholds", () => {
  const data = () => table({ t: [0, 1, 2], p99: [100, 250, 300] });
  const of = <G>(scene: Scene, kind: string) =>
    scene.panels[0]!.marks.filter((m) => m.kind === kind) as G[];
  /** The text of every label of rules and regions: on rules, and drawn apart. */
  const labels = (scene: Scene) =>
    scene.panels[0]!.marks.flatMap((g) =>
      g.kind === "rule"
        ? ((g as RuleGeometry).label ?? [])
        : g.kind === "text"
          ? (g as TextGeometry).labels
          : g.kind === "labels"
            ? (g as LabelsGeometry).items.map((item) => item.text)
            : [],
    );
  /** The parts each record of `model`'s last scene draws, read as a picker reads them. */
  const partsOf = (model: ChartModel, id: string) => {
    const { partOf } = partReader({ rowOf });
    const mark = (model.config.marks as Mark[]).find((m) => m.spec.id === id)!;
    const record = model.drawnMarks().find((r: DrawnMark) => r.mark === id)!;
    return record.geometry.flatMap((g, i) =>
      Array.from({ length: (g as { count?: number }).count ?? 1 }, (_, k) =>
        partOf(mark, record, i, k),
      ),
    );
  };

  it("draw a rule at each step in its color, its values counting toward the domain where they say", () => {
    const { model, scene } = build({
      fields: latency,
      marks: [
        line(data(), { x: "t", y: "p99" }),
        rule({ y: { thresholds: "p99" }, contributeDomain: true, id: "slo" }),
      ],
    });
    const rules = of<RuleGeometry>(scene, "rule");
    expect(rules.map((r) => [r.key, r.stroke])).toEqual([
      ['"slo":200', AMBER],
      ['"slo":500', RED],
    ]);
    const y = yScale(model)!;
    expect(y.domain[1]).toBeGreaterThanOrEqual(500);
    expect(rules[1]!.y1).toBeCloseTo(y.map(500), 6);
    // Its rules stand for its steps, by key, as events report them.
    expect(partsOf(model, "slo")).toEqual([
      { kind: "group", key: '["slo","200"]' },
      { kind: "group", key: '["slo","500"]' },
    ]);
  });

  it("describe their steps in the text alternative", () => {
    const { model } = build({
      fields: latency,
      marks: [
        line(data(), { x: "t", y: "p99" }),
        rule({ y: { thresholds: "p99" }, contributeDomain: true }),
        region({ y: { thresholds: "p99" } }),
      ],
    });
    expect(model.annotationSummaries()).toEqual([
      "Rules: y 200ms, y 500ms.",
      "Regions: y up to 200ms, y 200ms to 500ms, y from 500ms.",
    ]);
    const labeled = build({
      fields: latency,
      marks: [
        line(data(), { x: "t", y: "p99" }),
        region({ y: { thresholds: "p99" }, label: { content: ["Step ", { value: true }] } }),
      ],
    });
    expect(labeled.model.annotationSummaries()).toEqual([
      "Regions: Step  (y up to 200ms), Step 200ms (y 200ms to 500ms), Step 500ms (y from 500ms).",
    ]);
  });

  it("keep the place they were given as the object given changes", () => {
    const place = { thresholds: "p99" };
    const slo = rule({ y: place, contributeDomain: true, id: "slo" });
    place.thresholds = "p50";
    const { scene } = build({ fields: latency, marks: [line(data(), { x: "t", y: "p99" }), slo] });
    expect(of<RuleGeometry>(scene, "rule").map((r) => r.stroke)).toEqual([AMBER, RED]);
  });

  it("keep each rule's key as steps are added", () => {
    const keysOf = (steps: { value: number; color: string }[]) =>
      of<RuleGeometry>(
        build({
          fields: { p99: { thresholds: { steps } } },
          marks: [
            line(data(), { x: "t", y: "p99" }),
            rule({ y: { thresholds: "p99" }, contributeDomain: true, id: "slo" }),
          ],
        }).scene,
        "rule",
      ).map((r) => [r.key, r.stroke]);
    expect(keysOf(STEPS.steps)).toEqual([
      ['"slo":200', AMBER],
      ['"slo":500', RED],
    ]);
    expect(keysOf([STEPS.steps[0]!, { value: 300, color: GREEN }, STEPS.steps[1]!])).toEqual([
      ['"slo":200', AMBER],
      ['"slo":300', GREEN],
      ['"slo":500', RED],
    ]);
  });

  it("leave steps out of view undrawn, and take their stroke where they give one", () => {
    const { model, scene } = build({
      fields: latency,
      marks: [
        line(data(), { x: "t", y: "p99" }),
        rule({ y: { thresholds: "p99" }, stroke: "#000000" }),
      ],
    });
    expect(yScale(model)!.domain[1]).toBeLessThan(500);
    expect(of<RuleGeometry>(scene, "rule").map((r) => [r.key.split(":")[1], r.stroke])).toEqual([
      ["200", "#000000"],
    ]);
  });

  it("write a step's value through the field's display in labels", () => {
    const { scene } = build({
      fields: latency,
      marks: [
        line(table({ t: [0, 1, 2], p99: [100, 250, 640] }), { x: "t", y: "p99" }),
        rule({
          y: { thresholds: "p99" },
          contributeDomain: true,
          label: { content: ["p99 ", { value: true }] },
        }),
        region({ y: { thresholds: "p99" }, label: { content: [{ value: true }] } }),
      ],
    });
    // The base band writes nothing.
    expect(labels(scene).sort()).toEqual(["200ms", "500ms", "p99 200ms", "p99 500ms"]);
  });

  it("shade a band from each step to the next, the last to the plot's end, the base from its start", () => {
    const { model, scene } = build({
      fields: latency,
      marks: [
        line(table({ t: [0, 1, 2], p99: [100, 250, 640] }), { x: "t", y: "p99" }),
        region({ y: { thresholds: "p99" }, contributeDomain: true, id: "bands" }),
      ],
    });
    const { plot } = scene.panels[0]!;
    const y = yScale(model)!;
    const bands = of<RectGeometry>(scene, "rect");
    expect(bands.map((b) => [b.key.slice(b.key.lastIndexOf("|") + 1), b.fill])).toEqual([
      ["base", GREEN],
      ["200", AMBER],
      ["500", RED],
    ]);
    // [x, y, width, height]: the base band up from the plot's bottom, the last to its top.
    const [base, middle, top] = bands.map((b) => Array.from(b.rects.subarray(0, 4)));
    expect(base![1]! + base![3]!).toBeCloseTo(plot.y + plot.height, 6);
    expect(base![1]).toBeCloseTo(y.map(200), 6);
    expect(middle![1]).toBeCloseTo(y.map(500), 6);
    expect(top![1]).toBeCloseTo(plot.y, 6);
    // Open ends are the view's, not the bands' own, and count toward no domain.
    expect(y.domain[1]).toBeLessThan(1_000);
    expect(partsOf(model, "bands")).toEqual([
      { kind: "group", key: '["bands","base"]' },
      { kind: "group", key: '["bands","200"]' },
      { kind: "group", key: '["bands","500"]' },
    ]);
  });

  it("take percent steps by each table's bounds, keyed by percent, and need a table where tables disagree", () => {
    const a = table({ t: [0, 1], cpu: [10, 20] }, { name: "a" });
    const b = table({ t: [0, 1], cpu: [30, 40] }, { name: "b" });
    const fields: FieldDisplays = [
      { match: "cpu", thresholds: { mode: "percent", steps: [{ value: 70, color: RED }] } },
      { match: { table: "a" }, min: 0, max: 100 },
      { match: { table: "b" }, min: 0, max: 50 },
    ];
    const marks = (place: object) => [
      line(a, { x: "t", y: "cpu" }),
      line(b, { x: "t", y: "cpu" }),
      rule({ y: place as never, contributeDomain: true, id: "hot" }),
    ];
    expect(() => build({ fields, marks: marks({ thresholds: "cpu" }) })).toThrow(
      'rule "hot" y.thresholds: "cpu" of "a" and of "b" take different thresholds; give table',
    );
    for (const [table, at] of [
      ["b", 35],
      [a, 70],
    ] as const) {
      const { model, scene } = build({ fields, marks: marks({ thresholds: "cpu", table }) });
      const [hot] = of<RuleGeometry>(scene, "rule");
      expect(hot!.key).toBe('"hot":70');
      expect(hot!.y1).toBeCloseTo(yScale(model)!.map(at), 6);
    }
  });

  it("find a table by name among every table marks read, a network's nodes too", () => {
    const links = table({ from: ["a", "b"], to: ["b", "c"] });
    const people = table({ name: ["a", "b", "c"], weight: [1, 5, 9] }, { name: "nodes" });
    const { scene } = build({
      fields: { weight: { thresholds: { steps: [{ value: 200, color: RED }] } } },
      panels: panels([{ id: "net" }, { id: "plot" }]),
      marks: [
        graph(links, { source: "from", target: "to", nodes: people, node: "name", panel: "net" }),
        line(data(), { x: "t", y: "p99", panel: "plot" }),
        rule({ y: { thresholds: "weight", table: "nodes" }, panel: "plot", id: "heavy" }),
      ],
    });
    const rules = scene.panels.flatMap((panel) =>
      panel.marks.filter((m): m is RuleGeometry => m.kind === "rule"),
    );
    expect(rules.map((r) => [r.key, r.stroke])).toEqual([['"heavy":200', RED]]);
  });

  it("refuse places at fields without thresholds, and tables that do not hold the field", () => {
    const line0 = line(data(), { x: "t", y: "p99" });
    const at = (place: object, fields?: FieldDisplays) => () =>
      build({ ...(fields && { fields }), marks: [line0, rule({ y: place as never })] });
    expect(at({ thresholds: "p99" })).toThrow(
      'rule (mark 1) y.thresholds: fields give "p99" no thresholds; give fields.p99.thresholds, or place the rule at a value',
    );
    expect(at({ thresholds: "p99" }, { p99: { label: "p99" } })).toThrow(
      'fields give "p99" no thresholds',
    );
    expect(at({ thresholds: "p99", table: "nope" }, latency)).toThrow(
      `rule (mark 1) y.thresholds.table: the chart's marks read no table "nope"; give the name of one`,
    );
    expect(at({ thresholds: "p99", table: table({ q: [1] }, { name: "other" }) }, latency)).toThrow(
      'rule (mark 1) y.thresholds: table "other" has no field "p99"; give a table whose p99 has thresholds',
    );
    expect(() => rule({ y: { thresholds: 3 } as never })).toThrow(
      "rule y.thresholds: expected a field's name; received 3",
    );
    expect(() => rule({ y: { thresholds: "p99" }, drag: true } as never)).toThrow(
      "rule drag: a dragged rule stands at a number or a date along its axis; give y one",
    );
    expect(() => region({ y: { thresholds: "p99" }, y1: 0, y2: 1 } as never)).toThrow(
      "region: y places bands at thresholds, and y1 and y2 a range; give one",
    );
  });
});

describe("tooltip fields", () => {
  it("give each field's value its display color, and none where the display gives none", () => {
    const { model } = build({
      fields: latency,
      marks: [
        bar(services(), {
          x: "service",
          y: "p99",
          tooltip: { fields: ["p99", "service"] },
        }),
      ],
    });
    const fieldsAt = (index: number) =>
      model.inspect(xScale(model)!.map(index), yScale(model)!.map(0))!.points[0]!.fields;
    expect(fieldsAt(1)).toEqual([
      { field: "p99", label: "p99", kind: "number", value: 200, text: "200ms", color: AMBER },
      { field: "service", label: "service", kind: "category", value: "cart", text: "cart" },
    ]);
    expect(fieldsAt(0)![0]!.color).toBe(GREEN);
  });
});

describe("displayOf colors", () => {
  it("color values by mapping, then step, missing values by missing", () => {
    const p99 = displayOf(
      [
        {
          match: "p99",
          missing: { text: "n/a", color: "#9e9e9e" },
          mappings: [
            { value: 0, text: "idle" },
            { between: [600, 700], color: "#000000" },
          ],
          thresholds: STEPS,
        },
      ],
      { field: "p99", kind: "number" },
    );
    expect([0, 199.9, 200, 499, 500, 650, Number.NaN].map((v) => p99.color(v))).toEqual([
      GREEN,
      GREEN,
      AMBER,
      AMBER,
      RED,
      "#000000",
      "#9e9e9e",
    ]);
    expect(p99.text(0)).toBe("idle");
    expect(p99.text(Number.NaN)).toBe("n/a");
  });

  it("place percent steps at the bounds at 0 and 100 percent, and between bounds near the largest numbers", () => {
    const at = (min: number, max: number) =>
      displayOf(
        { v: { min, max, thresholds: { mode: "percent", steps: [{ value: 50, color: RED }] } } },
        { field: "v", kind: "number" },
      );
    expect([4e306, 5e306].map((v) => at(0, 1e307).color(v))).toEqual([undefined, RED]);
    expect([-1, 0].map((v) => at(-1e308, 1e308).color(v))).toEqual([undefined, RED]);
    const near = (value: number) =>
      displayOf(
        {
          v: {
            min: -1e308,
            max: 1e308,
            thresholds: { mode: "percent", steps: [{ value, color: RED }] },
          },
        },
        { field: "v", kind: "number" },
      );
    expect([7.9e307, 8.1e307].map((v) => near(90).color(v))).toEqual([undefined, RED]);
    expect([9e307, 1e308].map((v) => near(100).color(v))).toEqual([undefined, RED]);
    const beyond = displayOf(
      {
        v: {
          min: -1e308,
          max: -9e307,
          thresholds: { mode: "percent", steps: [{ value: 200, color: RED }] },
        },
      },
      { field: "v", kind: "number" },
    );
    expect([-8.1e307, -7.9e307].map((v) => beyond.color(v))).toEqual([undefined, RED]);
    const far = displayOf(
      {
        v: {
          min: -1e308,
          max: -9e307,
          thresholds: { mode: "percent", steps: [{ value: 1900, color: RED }] },
        },
      },
      { field: "v", kind: "number" },
    );
    expect([8.9e307, 9.1e307].map((v) => far.color(v))).toEqual([undefined, RED]);
    const percentAt = (min: number, max: number, value: number) =>
      displayOf(
        { v: { min, max, thresholds: { mode: "percent", steps: [{ value, color: RED }] } } },
        { field: "v", kind: "number" },
      );
    // The bounds themselves at 0 and 100 percent, however their span rounds.
    expect(percentAt(-0.1, 0.2, 100).color(0.2)).toBe(RED);
    expect(percentAt(-0.1, 0.2, 0).color(-0.1)).toBe(RED);
    expect([1.9e306, 2.1e306].map((v) => percentAt(-1, 1, 1e308).color(v))).toEqual([
      undefined,
      RED,
    ]);
  });
});
