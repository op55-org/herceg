// Field displays in charts' text: axes where the fields on them agree,
// series' names and value writers, legends, tooltips, labels, gauges, and
// the text alternative, each surface's own options over the displays.
import { describe, expect, it } from "vitest";
import { category, time } from "../../src/data/column.ts";
import { type Table, table } from "../../src/data/table.ts";
import { chartFields } from "../../src/fields/chart.ts";
import type { FieldDisplays } from "../../src/fields.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { candlestick } from "../../src/marks/candlestick.ts";
import { contour } from "../../src/marks/contour.ts";
import { custom } from "../../src/marks/custom.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { featureCompiler } from "../../src/marks/features/compile.ts";
import { gauge } from "../../src/marks/gauge.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { rule } from "../../src/marks/rule.ts";
import { tooltipWriters } from "../../src/marks/tooltip-writers.ts";
import { describeChart } from "../../src/model/describe.ts";
import { facet } from "../../src/model/facet.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import type { AxisInspection } from "../../src/model/inspect.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderToSVG } from "../../src/render/static.ts";
import { type AxisGuide, guidesOf, type Scene } from "../../src/scene/scene.ts";
import { keysOf, legendOf, rampsOf } from "../helpers/guides.ts";
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

/** What a tooltip says of the point nearest data values `x` and `y` in a panel of the last scene. */
function tip(model: ChartModel, x: number, y: number, panel = 0) {
  const { key } = model.panels()[panel]!;
  const { frame } = model.inspectorOf(key)!;
  const at = model.inspect(frame.x.map(x), frame.y.map(y), "nearest-x", key) as AxisInspection;
  return at.points[0]?.text;
}

const axis = (scene: Scene, name: string) =>
  scene.panels[0]!.axes.find((a): a is AxisGuide => a.kind === "axis" && a.scale === name)!;
const ticks = (scene: Scene, name: string) => axis(scene, name).ticks.map((t) => t.label);

const HOUR = 3_600_000;
const start = Date.UTC(2026, 0, 19);
const requests = () =>
  table(
    {
      time: time([start, start + HOUR, start + 2 * HOUR, start + 3 * HOUR]),
      service: category(["auth", "api", "auth", "api"]),
      latency: [120, 340, 180, 2_400],
      p50: [80, 150, 90, 700],
      memory: [1_048_576, 2_097_152, 1_572_864, 3_145_728],
    },
    { name: "requests" },
  );
const fields: FieldDisplays = {
  latency: { label: "Latency", format: { duration: "millisecond" } },
  p50: { label: "Median", format: { duration: "millisecond" } },
  memory: { label: "Memory", format: { binary: "B" } },
  service: {
    label: "Service",
    mappings: [
      { value: "auth", text: "Sign-in" },
      { value: "api", text: "API" },
    ],
  },
};

describe("loading", () => {
  it("needs the display code for fields and for series named by parts, and nothing more", () => {
    const data = requests();
    const plain = new ChartModel({ marks: [line(data, { x: "time", y: ["latency", "p50"] })] });
    expect(plain.lacks()).toEqual([false, false, false, false]);
    const named = new ChartModel({
      marks: [line(data, { x: "time", y: "latency", label: [{ label: "latency" }, " p99"] })],
    });
    expect(named.lacks()).toEqual([false, true, true, false]);
    const shown = new ChartModel({ fields, marks: [line(data, { x: "time", y: "latency" })] });
    expect(shown.lacks()).toEqual([true, true, true, false]);
    shown.use(staticCompilers());
    expect(shown.lacks()).toEqual([false, false, false, false]);
  });
});

describe("axes", () => {
  it("write ticks in the format the fields on a number axis agree on", () => {
    const data = requests();
    const { scene } = build({
      fields,
      marks: [line(data, { x: "time", y: ["latency", "p50"] })],
    });
    expect(ticks(scene, "y")).toContain("2s");
    expect(ticks(scene, "y")).toContain("500ms");
  });

  it("keep the default where the fields disagree, and the axis' own format over both", () => {
    const data = requests();
    const disagree = build({
      fields,
      marks: [line(data, { x: "time", y: ["latency", "memory"] })],
    });
    expect(ticks(disagree.scene, "y")).toContain("1M");
    const own = build({
      fields,
      y: { format: { number: ",.0f", suffix: " ms" } },
      marks: [line(data, { x: "time", y: "latency" })],
    });
    expect(ticks(own.scene, "y")).toContain("2,000 ms");
  });

  it("agree across the chart by scale name: in every facet, and over every subplot", () => {
    const data = requests();
    const yTicks = (scene: Scene) =>
      scene.panels.map((panel) =>
        panel.axes
          .filter((a): a is AxisGuide => a.kind === "axis" && a.scale === "y")
          .flatMap((a) => a.ticks.map((t) => t.label)),
      );
    // Facets draw the same fields in each panel: each axis writes their format.
    const faceted = build({
      fields,
      facet: facet("service"),
      marks: [line(data, { x: "time", y: "latency" })],
    });
    const each = yTicks(faceted.scene).filter((labels) => labels.length > 0);
    expect(each.length).toBeGreaterThan(0);
    for (const labels of each) expect(labels.some((label) => label.endsWith("s"))).toBe(true);
    // Subplots placing fields that disagree on y write the default in each,
    // though one subplot's fields agree among themselves.
    const subplots = build({
      fields,
      panels: panels([{ id: "a" }, { id: "b" }]),
      marks: [
        line(data, { x: "time", y: "latency", panel: "a" }),
        line(data, { x: "time", y: "memory", panel: "b" }),
      ],
    });
    for (const labels of yTicks(subplots.scene).filter((one) => one.length > 0))
      expect(labels.some((label) => /ms|B$/.test(label))).toBe(false);
  });

  it("write categories through mappings the fields on the axis agree on", () => {
    const data = requests();
    const { model, scene } = build({ fields, marks: [bar(data, { x: "service", y: "latency" })] });
    expect(ticks(scene, "x")).toEqual(["Sign-in", "API"]);
    // Scales, panels, and what inspection and events read keep the raw categories.
    const [panel] = model.panels();
    expect(panel!.x.categories).toEqual(["auth", "api"]);
    expect(xScale(model)!.categories).toEqual(["auth", "api"]);
  });

  it("title parts name fields by their labels", () => {
    const data = requests();
    const { scene } = build({
      fields,
      y: { title: [{ label: "latency" }, " (p99)"] },
      marks: [line(data, { x: "time", y: "latency" })],
    });
    expect(axis(scene, "y").title?.text).toBe("Latency (p99)");
  });
});

describe("series", () => {
  it("of wide data are named by their fields' labels", () => {
    const data = requests();
    const { scene } = build({ fields, marks: [line(data, { x: "time", y: ["latency", "p50"] })] });
    expect(legendOf(scene).map((e) => e.label)).toEqual(["Latency", "Median"]);
  });

  it("keep a name the mark gives, though it is the field's name", () => {
    const data = requests();
    const { model } = build({
      fields,
      marks: [line(data, { x: "time", y: "latency", label: "latency" })],
    });
    expect(model.legendEntries().map((entry) => entry.label)).toEqual(["latency"]);
  });

  it("of long data are named by their values' mapped text, keyed by the raw values", () => {
    const data = requests();
    const { model, scene } = build({
      fields,
      marks: [line(data, { x: "time", y: "latency", series: "service" })],
    });
    expect(legendOf(scene).map((e) => e.label)).toEqual(["Sign-in", "API"]);
    const keys = model.inspectorOf(model.panels()[0]!.key)!.marks[0]!.series.map((s) => s.key);
    expect(keys.join()).toContain('"auth"');
    expect(keys.join()).not.toContain("Sign-in");
  });

  it("are named by parts: their series, fields' labels, and text", () => {
    const data = requests();
    const { scene } = build({
      fields,
      marks: [
        line(data, {
          x: "time",
          y: "latency",
          series: "service",
          label: [{ series: true }, " ", { label: "latency" }],
        }),
      ],
    });
    expect(legendOf(scene).map((e) => e.label)).toEqual(["Sign-in Latency", "API Latency"]);
  });

  it("agree on entries again after a dictionary is compacted to the same length, grows, or is reset", () => {
    const named = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => `${prefix}${i}`);
    const a = table({
      t: Array.from({ length: 100 }, (_, i) => i),
      region: category(named("a", 100)),
    });
    const b = table({ t: [0], region: category(["other"]) });
    const mappings = (prefix: string) =>
      ["a0", "n0", "m0", "added"].map((value) => ({ value, text: prefix + value }));
    const displays = chartFields(
      [
        { match: { table: a, field: "region" }, mappings: mappings("A:") },
        { match: { table: b, field: "region" }, mappings: mappings("B:") },
      ],
      GUIDE_KIT,
      "en-US",
      "UTC",
    );
    // As the feature compiler hands them over: each mark's table and field.
    const reads: [Table, string][] = [
      [a as unknown as Table, "region"],
      [b as unknown as Table, "region"],
    ];
    expect(displays.entry(reads, "a0")).toBe("A:a0");
    // Dropping every row and appending as many new categories keeps the
    // dictionary's object and length: only its revision says it changed.
    const before = a.categories("region");
    a.dropBefore("t", 100);
    a.append({ t: Array.from({ length: 100 }, (_, i) => 100 + i), region: named("n", 100) });
    const after = a.categories("region");
    expect(after.dictionary).toBe(before.dictionary);
    expect(after.dictionary).toHaveLength(100);
    expect(displays.entry(reads, "n0")).toBe("A:n0");
    b.append({ t: [1], region: ["a0"] });
    expect(displays.entry(reads, "a0")).toBe("B:a0");
    a.append({ t: [200], region: ["added"] });
    expect(displays.entry(reads, "added")).toBe("A:added");
    a.reset({ t: Array.from({ length: 100 }, (_, i) => i), region: category(named("m", 100)) });
    expect(displays.entry(reads, "m0")).toBe("A:m0");
  });

  it("name an entry shared through a color field by its raw value where marks write it differently", () => {
    const of = (host: string) =>
      table({
        t: [0, 1],
        ms: [1, 2],
        host: category([host, host]),
        region: category(["eu", "eu"]),
      });
    const [a, b] = [of("db-1"), of("db-2")];
    const marks = [a, b].map((data) =>
      line(data, { x: "t", y: "ms", series: "host", color: "region" }),
    );
    const entries = (displays: FieldDisplays) =>
      build({ fields: displays, marks })
        .model.legendEntries()
        .map((e) => e.label);
    const europe = (data: typeof a, text: string) => ({
      match: { table: data, field: "region" },
      mappings: [{ value: "eu", text }],
    });
    expect(entries([europe(a, "Europe"), europe(b, "Europe")])).toEqual(["Europe"]);
    expect(entries([europe(a, "Europe"), europe(b, "EU")])).toEqual(["eu"]);
    // Each entry by the text its marks write it with: a value only one maps differs.
    const more = {
      ...europe(a, "Europe"),
      mappings: [...europe(a, "Europe").mappings, { value: "us", text: "USA" }],
    };
    expect(entries([more, europe(b, "Europe")])).toEqual(["Europe"]);
  });

  it("read a name field missing throughout a series as its missing text", () => {
    const hosts = table({
      t: [0, 1, 0, 1],
      ms: [1, 2, 3, 4],
      host: category(["db-1", "db-1", "db-2", "db-2"]),
      region: category(["eu-west", "eu-west", null, null]),
    });
    const { model } = build({
      fields: { region: { missing: "Unknown" } },
      marks: [
        line(hosts, {
          x: "t",
          y: "ms",
          series: "host",
          color: "region",
          label: [{ series: true }, " (", { field: "region" }, ")"],
        }),
      ],
    });
    const names = model.inspectorOf(model.panels()[0]!.key)!.marks[0]!.series.map((s) => s.label);
    expect(names).toEqual(["db-1 (eu-west)", "db-2 (Unknown)"]);
  });

  it("write their values through their value field's display in tooltips", () => {
    const data = requests();
    const { model } = build({ fields, marks: [line(data, { x: "time", y: "latency" })] });
    const at = model.inspect(xScale(model)!.map(start + 3 * HOUR), yScale(model)!.map(2_400))!;
    expect(at.points[0]!.label).toBe("Latency");
    expect(at.points[0]!.text).toBe("2s 400ms");
  });

  it("write values in their subplot's own tooltipFormat, and through callbacks with mappings", () => {
    const data = requests();
    const subplots = build({
      fields,
      panels: panels([{ id: "a", y: { tooltipFormat: { number: ",.1f", suffix: " axis" } } }]),
      marks: [line(data, { x: "time", y: "latency", panel: "a" })],
    });
    expect(tip(subplots.model, start + 3 * HOUR, 2_400)).toBe("2,400.0 axis");
    // A callback writes values, mappings and missing text still apply, and
    // ticks keep the format the fields agree on.
    const mapped: FieldDisplays = {
      latency: { format: { duration: "millisecond" }, mappings: [{ value: 0, text: "idle" }] },
    };
    const idle = table({ time: time([start, start + HOUR]), latency: [2_400, 0] });
    const called = build({
      fields: mapped,
      y: { tooltipFormat: (value: number) => `${value} ms` },
      marks: [line(idle, { x: "time", y: "latency" })],
    });
    expect([tip(called.model, start, 2_400), tip(called.model, start + HOUR, 0)]).toEqual([
      "2400 ms",
      "idle",
    ]);
    const series = called.model.inspectorOf(called.model.panels()[0]!.key)!.marks[0]!.series[0]!;
    expect(series.write!()(Number.NaN)).toBe("–");
    expect(ticks(called.scene, "y")).toContain("2s");
  });

  it("write values in the axis' tooltipFormat over the field's format", () => {
    const data = requests();
    const { model } = build({
      fields,
      y: { tooltipFormat: { number: ",.1f" } },
      marks: [line(data, { x: "time", y: "latency" })],
    });
    const at = model.inspect(xScale(model)!.map(start + 3 * HOUR), yScale(model)!.map(2_400))!;
    expect(at.points[0]!.text).toBe("2,400.0");
  });
});

describe("tooltips", () => {
  it("head a category axis' values with their mapped text, keeping the raw ones in the scale", () => {
    const data = requests();
    const { model } = build({ fields, marks: [bar(data, { x: "service", y: "latency" })] });
    const at = model.inspect(xScale(model)!.map(0), yScale(model)!.map(120)) as AxisInspection;
    expect(at.label).toBe("Sign-in");
    expect(xScale(model)!.categories).toEqual(["auth", "api"]);
  });

  it("keep mappings on a mark in every subplot, each writing in its own axis' formats", () => {
    const data = table({ t: [0, 1], ms: [2_000, 3_000] });
    const { model } = build({
      fields: {
        ms: { format: { duration: "millisecond" }, mappings: [{ value: 2_000, text: "two" }] },
      },
      panels: panels([
        { id: "a", y: { tooltipFormat: { number: ".1f", suffix: " axis" } } },
        { id: "b" },
      ]),
      marks: [line(data, { x: "t", y: "ms", panel: "*" })],
    });
    expect([tip(model, 0, 2_000, 0), tip(model, 0, 2_000, 1)]).toEqual(["two", "two"]);
    expect([tip(model, 1, 3_000, 0), tip(model, 1, 3_000, 1)]).toEqual(["3000.0 axis", "3s"]);
  });

  it("leave a subplot's own tooltipFormat to it alone, where the fields on the axis disagree", () => {
    const data = table({ t: [0, 1], ms: [2_000, 3_000], bytes: [1, 2] });
    const { model } = build({
      fields: { ms: { format: { duration: "millisecond" } }, bytes: { format: { binary: "B" } } },
      panels: panels([
        { id: "a", y: { tooltipFormat: { number: ".1f", suffix: " axis" } } },
        { id: "b" },
      ]),
      marks: [
        line(data, { x: "t", y: "ms", panel: "*" }),
        line(data, { x: "t", y: "bytes", panel: "*" }),
      ],
    });
    expect([tip(model, 1, 3_000, 0), tip(model, 1, 3_000, 1)]).toEqual(["3000.0 axis", "3s"]);
  });

  it("write each end of a range through its own field's display", () => {
    const data = table({ x: [0, 1], low: [1_000, 2_000], high: [3_000, 4_000] });
    const displays: FieldDisplays = {
      low: { mappings: [{ value: 2_000, text: "low" }] },
      high: {
        mappings: [
          { value: 2_000, text: "wrong" },
          { value: 4_000, text: "high" },
        ],
      },
    };
    const bars = build({
      fields: displays,
      marks: [errorbar(data, { x: "x", y1: "low", y2: "high" })],
    });
    expect(tip(bars.model, 1, 4_000)).toBe("low – high");
    const band = build({
      fields: displays,
      marks: [area(data, { x: "x", y1: "low", y2: "high" })],
    });
    expect(tip(band.model, 1, 4_000)).toBe("low – high");
    // A band's edge labels write their own edge's field.
    const svg = renderToSVG({
      width: 640,
      height: 360,
      locale: "en-US",
      fields: displays,
      marks: [
        area(data, {
          x: "x",
          y1: "low",
          y2: "high",
          labels: { at: "last", edge: "y1", content: [{ value: true }] },
        }),
      ],
    });
    expect(svg).toContain(">low<");
  });

  it("write a stack's shares as the axis does and its values through their field's display", () => {
    const data = table({
      x: category(["a", "a"]),
      ms: [2_000, 2_000],
      kind: category(["read", "write"]),
    });
    const { model } = build({
      fields: { ms: { format: { duration: "millisecond" } } },
      marks: [bar(data, { x: "x", y: "ms", series: "kind", stack: "fill" })],
    });
    expect(tip(model, 0, 0.25)).toBe("0.5 share (2s raw)");
  });

  it("name and write box plots by the field they summarize, in tooltips, facets, and summaries", () => {
    const data = table({
      g: category(["a", "a", "a", "b", "b", "b"]),
      ms: [1_000, 2_000, 3_000, 4_000, 5_000, 6_000],
      median: [0, 0, 0, 0, 0, 0],
    });
    const displays: FieldDisplays = {
      ms: { format: { duration: "millisecond" }, mappings: [{ value: 2_000, text: "two" }] },
      median: { label: "Wrong" },
    };
    const { model } = build({ fields: displays, marks: [boxplot(data, { x: "g", y: "ms" })] });
    expect(model.series().map((s) => s.label)).toEqual(["ms"]);
    expect(tip(model, 0, 2_000)).toMatch(/^median two, quartiles /);
    expect(describeChart(model)).toContain("ms: 2 boxes, medians from two (a) to 5s (b)");
    const named = build({
      fields: { ...displays, g: { mappings: [{ value: "a", text: "Alpha" }] } },
      marks: [boxplot(data, { x: "g", y: "ms" })],
    });
    expect(describeChart(named.model)).toContain("medians from two (Alpha) to 5s (b)");
    const faceted = build({
      fields: displays,
      facet: facet("g"),
      marks: [boxplot(data, { x: "g", y: "ms" })],
    });
    expect(describeChart(faceted.model)).toContain("medians from two (a) to 5s (b)");
  });

  it("write a custom mark's values and ranges' ends through the displays", () => {
    const data = table({ t: [0, 1], ms: [2_000, 3_000], lo: [1_000, 2_000], hi: [3_000, 4_000] });
    const displays: FieldDisplays = {
      ms: { mappings: [{ value: 2_000, text: "two" }] },
      lo: { mappings: [{ value: 1_000, text: "low" }] },
      hi: { format: { duration: "millisecond" } },
    };
    const draw = () => {};
    const values = build({ fields: displays, marks: [custom(data, { x: "t", y: "ms", draw })] });
    expect(tip(values.model, 0, 2_000)).toBe("two");
    const ranges = build({
      fields: displays,
      marks: [custom(data, { x: ["lo", "hi"], y: "ms", draw })],
    });
    // Read where the pointer finds a drawn item; this mark draws none.
    const [s] = ranges.model.series();
    const write = (value: number) => String(value);
    expect(ranges.model.markOf(s!)!.pointText!(s!, 0, { x: write, y: write, value: write })).toBe(
      "low – 3s",
    );
  });

  it("write a heatmap's cell edges through their fields' displays", () => {
    const cells = table({ a: [3_000], b: [4_000], c: [1_000], d: [2_000], v: [5] });
    const { model } = build({
      fields: {
        a: { mappings: [{ value: 3_000, text: "left" }] },
        b: { mappings: [{ value: 4_000, text: "right" }] },
        c: { mappings: [{ value: 1_000, text: "bottom" }] },
        d: { mappings: [{ value: 2_000, text: "top" }] },
      },
      marks: [heatmap(cells, { x1: "a", x2: "b", y1: "c", y2: "d", color: "v" })],
    });
    const at = model.inspect(xScale(model)!.map(3_500), yScale(model)!.map(1_500))!;
    expect([at.points[0]!.label, at.points[0]!.text]).toEqual(["bottom – top", "left – right: 5"]);
  });

  it("write a candle's prices through their fields' displays, and agree on the y axis", () => {
    const prices = table({
      t: [0, 1],
      o: [1_000, 2_000],
      h: [3_000, 4_000],
      l: [500, 1_000],
      c: [2_000, 3_000],
    });
    const ms = { format: { duration: "millisecond" } } as const;
    const { model, scene } = build({
      fields: { o: { ...ms, mappings: [{ value: 1_000, text: "opened" }] }, h: ms, l: ms, c: ms },
      marks: [candlestick(prices, { x: "t", open: "o", high: "h", low: "l", close: "c" })],
    });
    expect(tip(model, 0, 1_000)).toBe("open opened, high 3s, low 500ms, close 2s");
    expect(ticks(scene, "y")).toContain("2s");
    expect(describeChart(model)).toContain("prices from 500ms to 4s; the last opened at 2s");
    // The axis' own tooltipFormat over the fields' formats; mappings stay.
    const own = build({
      fields: { o: { ...ms, mappings: [{ value: 1_000, text: "opened" }] }, h: ms, l: ms, c: ms },
      y: { tooltipFormat: { number: ".1f", suffix: " price" } },
      marks: [candlestick(prices, { x: "t", open: "o", high: "h", low: "l", close: "c" })],
    });
    expect(tip(own.model, 0, 1_000)).toBe(
      "open opened, high 3000.0 price, low 500.0 price, close 2000.0 price",
    );
  });

  it("write a contour's levels, name, and description through its color field's display", () => {
    const n = 9;
    const [x, y, z]: [number[], number[], number[]] = [[], [], []];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const [u, v] = [(i / (n - 1)) * 2 - 1, (j / (n - 1)) * 2 - 1];
        x.push(u);
        y.push(v);
        z.push(10_000 * (1 - Math.min(1, Math.hypot(u, v))));
      }
    const { model, scene } = build({
      fields: {
        z: { label: "Latency", format: { duration: "millisecond" }, description: "Time taken." },
      },
      marks: [
        contour(table({ x, y, z }), {
          x: "x",
          y: "y",
          color: "z",
          thresholds: [2_000, 5_000, 8_000],
          variant: "bands",
        }),
      ],
    });
    expect(model.series().map((s) => s.label)).toEqual(["2s – 5s", "5s – 8s"]);
    // Keyed by the raw thresholds.
    expect(model.series()[0]!.key).toContain("2000|5000");
    expect(keysOf(scene)[0]!.title.text).toBe("Latency");
    expect(describeChart(model)).toContain("Latency 2s – 5s: 1 region");
    expect(describeChart(model)).toContain("Time taken.");
    // The field's bounds are the colors' default domain, as `colorDomain` would be.
    const colors = (displays?: FieldDisplays, colorDomain?: [number, number]) =>
      build({
        ...(displays && { fields: displays }),
        marks: [
          contour(table({ x, y, z }), {
            x: "x",
            y: "y",
            color: "z",
            thresholds: [2_000, 5_000, 8_000],
            variant: "bands",
            ...(colorDomain && { colorDomain }),
          }),
        ],
      })
        .model.series()
        .map((s) => s.color);
    const bounded = colors({ z: { min: 0, max: 20_000 } });
    expect(bounded).toEqual(colors(undefined, [0, 20_000]));
    expect(bounded).not.toEqual(colors());
  });

  it("write a precomputed box's statistics through their own fields, and agree on the axis", () => {
    const ms = { format: { duration: "millisecond" } } as const;
    const boxes = table({
      group: category(["a"]),
      lo: [1_000],
      q1: [2_000],
      mid: [3_000],
      q3: [4_000],
      hi: [5_000],
    });
    const { model, scene } = build({
      fields: {
        lo: { ...ms, mappings: [{ value: 1_000, text: "low" }] },
        q1: ms,
        mid: ms,
        q3: ms,
        hi: ms,
      },
      marks: [
        boxplot(boxes, { x: "group", low: "lo", q1: "q1", median: "mid", q3: "q3", high: "hi" }),
      ],
    });
    expect(tip(model, 0, 3_000)).toBe("median 3s, quartiles 2s to 4s, whiskers low to 5s");
    expect(ticks(scene, "y")).toContain("3s");
    // Statistics of fields without displays are written as the axis writes them.
    const median = build({
      fields: { mid: { ...ms, mappings: [{ value: 1_000, text: "median only" }] } },
      marks: [
        boxplot(boxes, { x: "group", low: "lo", q1: "q1", median: "mid", q3: "q3", high: "hi" }),
      ],
    });
    expect(tip(median.model, 0, 3_000)).toBe(
      "median 3s, quartiles 2,000 to 4,000, whiskers 1,000 to 5,000",
    );
  });

  it("write times without a format as dates, on an axis of numbers and in points' channels", () => {
    const data = table({ k: category(["a", "b"]), at: time([start, start + HOUR]), y: [1, 2] });
    const displays: FieldDisplays = {
      at: { label: "When", mappings: [{ value: start, text: "start" }] },
    };
    const bars = build({ fields: displays, marks: [bar(data, { x: "k", y: "at" })] });
    expect(tip(bars.model, 1, start + HOUR)).toBe("Jan 19, 2026, 1:00 AM");
    // A display giving only a label writes times as times too.
    const labeled = build({
      fields: { at: { label: "When" } },
      marks: [bar(data, { x: "k", y: "at" })],
    });
    expect(tip(labeled.model, 1, start + HOUR)).toBe("Jan 19, 2026, 1:00 AM");
    expect(describeChart(labeled.model)).toContain("from Jan 19, 2026, 12:00 AM to");
    const points = build({
      fields: displays,
      marks: [point(data, { x: "y", y: "y", encode: { color: { field: "at" } } })],
    });
    expect(tip(points.model, 2, 2)).toBe("2, When Jan 19, 2026, 1:00 AM");
  });

  it("write values on a named scale in its axis guide's format, below the field's own", () => {
    const data = requests();
    const on = (displays: FieldDisplays) =>
      build({
        fields: displays,
        scales: { alt: { type: "linear" } },
        guides: [
          {
            type: "axis",
            scale: "alt",
            place: { side: "right" },
            format: { number: ".1f", suffix: " axis" },
          },
        ],
        marks: [line(data, { x: "time", y: { field: "latency", scale: "alt" } })],
      }).model;
    const missingOnly = on({ latency: { missing: "none" } });
    const p = missingOnly.inspectorOf(missingOnly.panels()[0]!.key)!;
    const s = p.marks[0]!.series[0]!;
    expect(s.write!(p.marks[0]!.formats!.y!)(2_400)).toBe("2400.0 axis");
    const formatted = on({ latency: { format: { duration: "millisecond" } } });
    const q = formatted.inspectorOf(formatted.panels()[0]!.key)!;
    expect(q.marks[0]!.series[0]!.write!(q.marks[0]!.formats!.y!)(2_400)).toBe("2s 400ms");
  });

  it("write time values through their mappings and formats", () => {
    const data = table({ t: [0, 1], at: time([start, start + HOUR]) });
    const { model } = build({
      fields: { at: { mappings: [{ value: start, text: "start" }], format: { time: "%H:%M" } } },
      marks: [line(data, { x: "t", y: "at" })],
    });
    expect([tip(model, 0, start), tip(model, 1, start + HOUR)]).toEqual(["start", "01:00"]);
  });
});

describe("legends", () => {
  it("name and write category keys and color ramps through the displays", () => {
    const data = requests();
    const keyed = build({
      fields,
      marks: [point(data, { x: "time", y: "latency", encode: { symbol: { field: "service" } } })],
    });
    const [key] = keysOf(keyed.scene);
    expect(key?.title.text).toBe("Service");
    expect(key?.entries.map((e) => e.label.text)).toEqual(["Sign-in", "API"]);
    const ramped = build({
      fields,
      marks: [point(data, { x: "time", y: "p50", color: "memory" })],
    });
    const [ramp] = rampsOf(ramped.scene);
    expect(ramp?.title.text).toBe("Memory");
    expect(ramp?.low.text).toBe("1 MiB");
    expect(ramp?.high.text).toBe("3 MiB");
  });

  it("take a color ramp's default domain from the field's bounds", () => {
    const grid = table({ x: [0, 1], y: [0, 0], load: [0.2, 0.6] });
    const { scene } = build({
      fields: { load: { min: 0, max: 1, format: { number: ".0%" } } },
      marks: [heatmap(grid, { x: "x", y: "y", color: "load" })],
    });
    const [ramp] = rampsOf(scene);
    expect([ramp?.low.text, ramp?.high.text]).toEqual(["0%", "100%"]);
  });

  it("key series' shapes by their raw values, whatever their names", () => {
    const data = requests();
    const draw = (displays?: FieldDisplays) =>
      build({
        ...(displays && { fields: displays }),
        scales: {
          shapes: { type: "ordinal", map: { auth: "square", api: "triangle" } },
        },
        marks: [
          point(data, {
            x: "time",
            y: "latency",
            series: "service",
            encode: { symbol: { field: "service", scale: "shapes" } },
          }),
        ],
      }).scene;
    const glyphs = (scene: Scene) => legendOf(scene).map((entry) => entry.glyph);
    expect(glyphs(draw(fields))).toEqual(glyphs(draw()));
    expect(legendOf(draw(fields)).map((entry) => entry.label)).toEqual(["Sign-in", "API"]);
  });

  it("name a declared domain's entries without rows through the displays", () => {
    const data = table({ t: [0, 1], ms: [1, 2], service: category(["auth", "auth"]) });
    const { model } = build({
      fields,
      scales: { color: { type: "ordinal", domain: ["auth", "api"] } },
      marks: [line(data, { x: "t", y: "ms", series: "service" })],
    });
    expect(model.legendEntries().map((entry) => entry.label)).toEqual(["Sign-in", "API"]);
  });

  it("write a colorbar of a time field as times, in its display's format", () => {
    const data = table({
      t: [0, 1, 2],
      y: [1, 2, 3],
      at: time([start, start + HOUR, start + 2 * HOUR]),
    });
    const { scene } = build({
      fields: { at: { label: "When", format: { time: "%H:%M" } } },
      marks: [point(data, { id: "p", x: "t", y: "y", color: "at" })],
      guides: [{ type: "colorbar", scale: { mark: "p", channel: "color" } }],
    });
    const labels = guidesOf(scene, "colorbar").flatMap((bar) =>
      bar.items.flatMap((item) => (item.type === "text" ? [item.text] : [])),
    );
    expect(labels.length).toBeGreaterThan(1);
    expect(labels.filter((text) => text !== "When").every((text) => /^\d\d:\d\d$/.test(text))).toBe(
      true,
    );
  });

  it("name an entry by the marks holding its value, whatever others write of it", () => {
    const of = (region: string) =>
      table({ t: [0, 1], ms: [1, 2], region: category([region, region]) });
    const [a, b] = [of("eu"), of("us")];
    const { model } = build({
      fields: [
        { match: { table: a, field: "region" }, mappings: [{ value: "eu", text: "Europe" }] },
        { match: { table: b, field: "region" }, mappings: [{ value: "us", text: "USA" }] },
      ],
      marks: [a, b].map((data) => line(data, { x: "t", y: "ms", series: "region" })),
    });
    expect(model.legendEntries().map((entry) => entry.label)).toEqual(["Europe", "USA"]);
  });

  it("name and write points' encoded fields in tooltips through their displays", () => {
    const data = requests();
    const { model } = build({
      fields,
      marks: [
        point(data, {
          x: "time",
          y: "latency",
          size: "memory",
          encode: { symbol: { field: "service" } },
        }),
      ],
    });
    expect(tip(model, start + HOUR, 340)).toBe("340ms, Memory 2 MiB, Service API");
  });

  it("write encoded points' values in the text alternative through the displays", () => {
    const data = table({
      t: [0, 1],
      ms: [2_000, 3_000],
      size: [1, 2],
      group: category(["a", "b"]),
    });
    const displays: FieldDisplays = {
      ms: { format: { duration: "millisecond" }, mappings: [{ value: 3_000, text: "three" }] },
    };
    const sized = build({
      fields: displays,
      marks: [point(data, { x: "t", y: "ms", size: "size" })],
    });
    expect(describeChart(sized.model)).toContain("from 2s to three, last three");
    const across = build({ fields: displays, marks: [point(data, { x: "ms", y: "group" })] });
    expect(describeChart(across.model)).toContain("x from 2s to three");
  });

  it("write numeric bands from their values through the display", () => {
    const grid = table({ x: [2_000, 3_000], y: [0, 0], load: [1, 2] });
    const { scene, model } = build({
      fields: {
        x: { format: { duration: "millisecond" }, mappings: [{ value: 2_000, text: "two" }] },
      },
      marks: [heatmap(grid, { x: "x", y: "y", color: "load", xBanded: true })],
    });
    expect(ticks(scene, "x")).toEqual(["two", "3s"]);
    expect(model.panels()[0]!.x.categories).toEqual(["2,000", "3,000"]);
  });

  it("keep each chart's displays where charts share a mark", () => {
    const grid = table({ x: [0, 1], y: [0, 0], load: [0.2, 0.6] });
    const cells = heatmap(grid, { x: "x", y: "y", color: "load" });
    const percent = build({ fields: { load: { format: { number: ".0%" } } }, marks: [cells] });
    build({ marks: [cells] });
    expect(tip(percent.model, 0, 0)).toBe("20%");
    const loads = table({ load: [1_200, 3_400] });
    const dial = gauge(loads, { value: "load", bands: [{ to: 1_000 }, { to: 5_000 }] });
    const svg = (config: ChartConfig) =>
      renderToSVG({ width: 300, height: 200, locale: "en-US", ...config });
    const displays: ChartConfig = {
      fields: { load: { max: 5_000, label: "Load" } },
      marks: [dial],
    };
    svg(displays);
    // Without displays, the dial's ends are 0 and 100, which its bands leave.
    expect(() => svg({ marks: [dial] })).toThrow(
      "gauge bands: expected ends above min 0 and at most max 100",
    );
    const again = svg(displays);
    expect([">Load<", ">5,000<"].every((text) => again.includes(text))).toBe(true);
  });

  it("write a heatmap's cells as their color field's display does, in tooltips and the summary", () => {
    const grid = table({ x: [0, 1], y: [0, 0], load: [0.2, 0.6] });
    const { model } = build({
      fields: { load: { format: { number: ".0%" } } },
      marks: [heatmap(grid, { x: "x", y: "y", color: "load" })],
    });
    const at = model.inspect(xScale(model)!.map(0), yScale(model)!.map(0))!;
    expect(at.points[0]!.text).toBe("20%");
    expect(describeChart(model)).toContain("lowest 20%");
  });
});

describe("labels and annotations", () => {
  it("write value and label parts through the displays", () => {
    const data = requests();
    const svg = renderToSVG({
      width: 640,
      height: 360,
      locale: "en-US",
      fields,
      marks: [
        bar(data, {
          x: "service",
          y: "latency",
          labels: { content: [{ label: "latency" }, ": ", { value: true }] },
        }),
      ],
    });
    expect(svg).toContain(">Latency: 2s 400ms<");
    // A value part's own format writes over the display's; its mappings stay.
    const mapped = renderToSVG({
      width: 640,
      height: 360,
      locale: "en-US",
      fields: { latency: { mappings: [{ value: 2_400, text: "slowest" }] } },
      marks: [
        bar(data, {
          x: "service",
          y: "latency",
          labels: { content: [{ value: true, format: { number: ",.1f" } }] },
        }),
      ],
    });
    expect(mapped).toContain(">slowest<");
    expect(mapped).toContain(">120.0<");
  });

  it("write a time value part through its field's display of times", () => {
    const data = table({ t: [0, 1], at: time([start, start + HOUR]) });
    const svg = (displays: FieldDisplays) =>
      renderToSVG({
        width: 640,
        height: 360,
        locale: "en-US",
        timeZone: "UTC",
        fields: displays,
        marks: [
          line(data, { x: "t", y: "at", labels: { at: "last", content: [{ value: true }] } }),
        ],
      });
    expect(svg({ at: { mappings: [{ value: start + HOUR, text: "mapped time" }] } })).toContain(
      ">mapped time<",
    );
    expect(svg({ at: { format: { time: "%H:%M" } } })).toContain(">01:00<");
  });

  it("write a stack's shares in a value part, not in the value field's format", () => {
    const data = table({
      x: category(["a", "a"]),
      ms: [1_000, 1_000],
      kind: category(["read", "write"]),
    });
    const svg = renderToSVG({
      width: 640,
      height: 360,
      locale: "en-US",
      fields: { ms: { format: { duration: "millisecond" } } },
      marks: [
        bar(data, {
          x: "x",
          y: "ms",
          series: "kind",
          stack: "fill",
          labels: { content: [{ value: true }] },
        }),
      ],
    });
    expect(svg).not.toContain("µs");
    expect(svg).toContain(">0.5<");
  });

  it("write a rule's field label through its display", () => {
    const limits = table({ at: [1_500], name: category(["auth"]) });
    const svg = renderToSVG({
      width: 640,
      height: 360,
      locale: "en-US",
      fields: { name: { mappings: [{ value: "auth", text: "Sign-in" }] } },
      marks: [
        line(requests(), { x: "time", y: "latency" }),
        rule(limits, { y: "at", label: { field: "name" } }),
      ],
    });
    expect(svg).toContain(">Sign-in<");
  });
});

describe("gauges", () => {
  it("are checked against the field's ends once the display code is here, not before", () => {
    const loads = table({ load: [1_200, 3_400] });
    const config: ChartConfig = {
      fields: { load: { max: 5_000 } },
      marks: [gauge(loads, { value: "load", bands: [{ to: 1_000 }, { to: 5_000 }] })],
    };
    // The feature compiler of a page whose display code is still loading.
    const waiting = featureCompiler({ ...GUIDE_KIT, loaded: [], isColor: () => false });
    expect(() => new ChartModel(config, undefined, [staticCompilers()[0], waiting])).not.toThrow();
    expect(renderToSVG({ width: 300, height: 200, locale: "en-US", ...config })).toContain(
      ">5,000<",
    );
  });

  it("take the field's label, format, and the ends the gauge does not give", () => {
    const data = requests();
    const svg = renderToSVG({
      width: 300,
      height: 200,
      locale: "en-US",
      fields: {
        latency: { label: "p99", format: { duration: "millisecond" }, min: 0, max: 5_000 },
      },
      marks: [gauge(data, { value: "latency", max: 4_000 })],
    });
    expect(svg).toContain(">p99<");
    expect(svg).toContain(">2s 400ms<");
    expect(svg).toContain(">4s<");
    expect(svg).toContain(">0ms<");
  });

  it("refuse ends that cross the field's, naming where each is given", () => {
    const data = requests();
    expect(() =>
      build({
        fields: { latency: { min: 5_000 } },
        marks: [gauge(data, { value: "latency", max: 4_000 })],
      }),
    ).toThrow(
      "chart marks[0].max: 4000 is not above min 5000 (fields.latency.min); give max above min",
    );
  });
});

describe("bar labels", () => {
  it("write each series' values through its own value field's display", () => {
    const data = requests();
    const svg = renderToSVG({
      width: 640,
      height: 360,
      locale: "en-US",
      fields,
      marks: [bar(data, { x: "service", y: ["latency", "memory"], labels: true })],
    });
    expect(svg).toContain(">2s 400ms<");
    expect(svg).toContain(">3 MiB<");
  });

  it("write time values through the value field's display of times", () => {
    const data = table({ k: category(["a", "b"]), at: time([start, start + HOUR]) });
    const svg = renderToSVG({
      width: 640,
      height: 360,
      locale: "en-US",
      timeZone: "UTC",
      fields: { at: { format: { time: "%H:%M" }, mappings: [{ value: start, text: "start" }] } },
      marks: [bar(data, { x: "k", y: "at", labels: true })],
    });
    expect(svg).toContain(">start<");
    expect(svg).toContain(">01:00<");
  });

  it("write a field they label with through its display, stacked to shares too", () => {
    const data = table({
      x: category(["a", "a"]),
      ms: [1_000, 2_000],
      kind: category(["read", "write"]),
    });
    const svg = renderToSVG({
      width: 640,
      height: 360,
      locale: "en-US",
      fields: { ms: { format: { duration: "millisecond" } } },
      marks: [
        bar(data, { x: "x", y: "ms", series: "kind", stack: "fill", labels: { field: "ms" } }),
      ],
    });
    expect(svg).toContain(">1s<");
    expect(svg).toContain(">2s<");
  });

  it("write a stack's shares of times as numbers", () => {
    const data = table({
      x: category(["a", "a"]),
      at: time([start, start]),
      kind: category(["read", "write"]),
    });
    const svg = renderToSVG({
      width: 640,
      height: 360,
      locale: "en-US",
      timeZone: "UTC",
      fields: { at: { format: { time: "%H:%M" } } },
      marks: [
        bar(data, {
          x: "x",
          y: "at",
          series: "kind",
          stack: "fill",
          labels: { content: [{ value: true }] },
        }),
      ],
    });
    expect(svg).toContain(">0.5<");
    expect(svg).not.toContain("1970");
  });
});

describe("the text alternative", () => {
  it("names series and writes their values through the displays", () => {
    const data = requests();
    const { model } = build({ fields, marks: [line(data, { x: "time", y: "latency" })] });
    expect(describeChart(model)).toContain("Latency: 4 points, from 120ms to 2s 400ms");
  });

  it("writes times through their displays as dates, where the display gives no format", () => {
    const data = table({ t: [0, 1], at: time([start, start + HOUR]) });
    const { model } = build({
      fields: { at: { mappings: [{ value: start, text: "start" }] } },
      marks: [line(data, { x: "t", y: "at" })],
    });
    expect(describeChart(model)).toContain(
      "from start to Jan 19, 2026, 1:00 AM, last Jan 19, 2026, 1:00 AM",
    );
  });

  it("reads a value field's description once, after its first series", () => {
    const data = requests();
    const { model } = build({
      fields: { ...fields, latency: { ...fields.latency, description: "Time to last byte." } },
      marks: [line(data, { x: "time", y: "latency", series: "service" })],
    });
    const text = describeChart(model);
    expect(text).toContain(
      "Sign-in: 2 points, from 120ms to 180ms, last 180ms. Time to last byte. API:",
    );
    expect(text.split("Time to last byte.").length).toBe(2);
  });
});
