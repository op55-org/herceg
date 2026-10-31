// Channel scales (marks/features/channel-scales.ts): continuous scales of
// the chart's `scales` mapping number fields onto widths, opacities,
// sizes, and colors, for every mark whose channels read rows; their
// domains span every field read through them, and values out of the
// domain or missing take each channel's rule.
import { describe, expect, it } from "vitest";
import { type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { ChannelScale } from "../../src/marks/features/channel-scales.ts";
import { rowReader } from "../../src/marks/features/channels.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type { LineGeometry, PointGeometry, RectGeometry } from "../../src/scene/scene.ts";
import { loadSpec } from "../../src/spec/load.ts";
import { contractTest } from "../helpers/contracts.ts";

function build(config: ChartConfig) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    ...staticCompilers(),
  );
  model.setSize(600, 300, 1);
  return { model, scene: model.scene(estimateText) };
}

const drawn = <G>(config: ChartConfig, kind: string) =>
  build(config).scene.panels[0]!.marks.filter((m) => m.kind === kind) as G[];

/** Each drawn point's opacity and area. */
const opacities = (g: PointGeometry) =>
  Array.from({ length: g.count }, (_, i) => (g.opacities ? g.opacities[i]! : g.fillOpacity));
const areas = (g: PointGeometry) =>
  Array.from({ length: g.count }, (_, i) => Math.PI * (g.radii ? g.radii[i]! : g.radius) ** 2);
const fills = (g: PointGeometry) =>
  Array.from({ length: g.count }, (_, i) =>
    g.colors ? g.colors.palette[g.colors.index[i]!] : g.fill,
  );

const rows = table({
  x: [0, 1, 2, 3, 4],
  y: [1, 2, 3, 4, 5],
  age: [0, 10, 20, 30, 40],
  share: [0, 0.25, 0.5, 0.75, 1],
});

describe("channel scales", () => {
  contractTest(
    "channel.scale.continuous.numbers",
    () => {
      const [g] = drawn<PointGeometry>(
        {
          scales: {
            fade: { type: "linear", domain: [0, 30], range: [1, 0.4] },
            sizes: { type: "linear", range: [16, 64] },
          },
          marks: [
            point(rows, {
              x: "x",
              y: "y",
              encode: {
                opacity: { field: "age", scale: "fade" },
                size: { field: "age", scale: "sizes" },
              },
            }),
          ],
        },
        "point",
      );
      // Past the domain's end, opacities extend it, kept from 0 to 1.
      expect(opacities(g!).map((o) => Number(o.toFixed(3)))).toEqual([1, 0.8, 0.6, 0.4, 0.2]);
      // Without a domain, the field's extent maps onto the range.
      expect(areas(g!).map((a) => Math.round(a))).toEqual([16, 28, 40, 52, 64]);
    },
    "number fields map onto opacities and sizes through a scale of the chart's",
  );

  contractTest(
    "channel.scale.continuous.clamp",
    () => {
      const scales = (clamp: boolean) => ({
        widths: { type: "linear", domain: [10, 30], range: [1, 5], clamp } as const,
      });
      const widths = (clamp: boolean) =>
        drawn<RectGeometry>(
          {
            scales: scales(clamp),
            marks: [
              bar(rows, {
                x: "x",
                y: "y",
                stroke: "#000000",
                encode: { strokeWidth: { field: "age", scale: "widths" } },
              }),
            ],
          },
          "rect",
        )
          .map((g) => g.edge?.width ?? 0)
          .sort((a, b) => a - b);
      // Inputs past the domain extend it (widths from 0, which draw no
      // outline), or with clamp stay at its ends: a geometry per width.
      expect(widths(false)).toEqual([0, 1, 3, 5, 7]);
      expect(widths(true)).toEqual([1, 3, 5]);
    },
    "inputs past the domain extend it, or with clamp take its ends' outputs",
  );

  contractTest(
    "channel.scale.continuous.colors",
    () => {
      const [g] = drawn<PointGeometry>(
        {
          scales: { heat: { type: "linear", range: ["#000000", "#ffffff"] } },
          marks: [
            point(rows, { x: "x", y: "y", encode: { color: { field: "share", scale: "heat" } } }),
          ],
        },
        "point",
      );
      expect(fills(g!)).toEqual(["#000000", "#404040", "#808080", "#bfbfbf", "#ffffff"]);
    },
    "number fields map onto a ramp of colors",
  );

  contractTest(
    "channel.scale.continuous.missing",
    () => {
      const gaps = table({ x: [0, 1, 2, 3], y: [1, 2, 3, 4], v: [1, Number.NaN, 0, 100] });
      const scales = { logs: { type: "log", range: [0.2, 1] } } as const;
      // Points leave out rows a channel has no output for: missing, or a log's zero.
      const [g] = drawn<PointGeometry>(
        {
          scales,
          marks: [
            point(gaps, { x: "x", y: "y", encode: { opacity: { field: "v", scale: "logs" } } }),
          ],
        },
        "point",
      );
      expect(g!.count).toBe(2);
      expect(opacities(g!).map((o) => Number(o.toFixed(3)))).toEqual([0.2, 1]);
      // Bars draw them with the mark's own paint (opaque).
      const bars = drawn<RectGeometry>(
        {
          scales,
          marks: [
            bar(gaps, { x: "x", y: "y", encode: { opacity: { field: "v", scale: "logs" } } }),
          ],
        },
        "rect",
      );
      expect(bars.reduce((n, b) => n + b.count, 0)).toBe(4);
      expect(bars.map((b) => [b.count, Number(b.fillOpacity.toFixed(3))])).toEqual([
        [1, 0.2],
        [2, 1],
        [1, 1],
      ]);
    },
    "missing values, and values a log scale cannot take, have no output",
  );

  contractTest(
    "channel.scale.continuous.shared",
    () => {
      const small = table({ x: [0, 1], y: [1, 2], w: [0, 1] });
      const large = table({ x: [0, 1], y: [3, 4], w: [1, 3] });
      const widths = { type: "linear", range: [1, 4] } as const;
      const lines = drawn<LineGeometry>(
        {
          scales: { widths },
          marks: [
            line(small, {
              x: "x",
              y: "y",
              encode: { strokeWidth: { field: "w", scale: "widths" } },
            }),
            line(large, {
              x: "x",
              y: "y",
              encode: { strokeWidth: { field: "w", scale: "widths" } },
            }),
          ],
        },
        "line",
      );
      // One domain over both marks' fields, 0 to 3: each line's piece takes
      // the width of the observation it arrives at, 1 and 3 there.
      expect(lines.map((l) => l.strokeWidth)).toEqual([2, 4]);
    },
    "a scale's domain spans every field read through it, in every mark",
  );

  contractTest(
    "channel.scale.continuous.refused",
    () => {
      const named = (scale: object, encode: object) => () =>
        build({
          scales: { s: scale } as never,
          marks: [point(rows, { x: "x", y: "y", encode } as never)],
        });
      expect(
        named({ type: "linear", range: [0, 1] }, { color: { field: "age", scale: "s" } }),
      ).toThrow(
        "chart scales.s.range[0] (read by point (mark 0) encode.color): expected a CSS color; received 0",
      );
      expect(
        named({ type: "linear", range: [0, 2] }, { opacity: { field: "age", scale: "s" } }),
      ).toThrow(
        "chart scales.s.range[1] (read by point (mark 0) encode.opacity): expected a number from 0 to 1; received 2",
      );
      expect(named({ type: "log", domain: [0, 10], range: [0, 1] }, {})).toThrow(
        "chart scales.s.domain: expected two different positive finite numbers; received [0,10]",
      );
      expect(named({ type: "linear", range: ["red", "#ffffff"] }, {})).toThrow(
        'chart scales.s.range[0]: expected a "#rrggbb" color; received "red"',
      );
      const kinds = table({ x: [0], y: [1], kind: ["a"] });
      expect(() =>
        build({
          scales: { s: { type: "linear", range: [0, 1] } },
          marks: [
            point(kinds, { x: "x", y: "y", encode: { opacity: { field: "kind", scale: "s" } } }),
          ],
        }),
      ).toThrow(
        'point (mark 0) encode.opacity.field: field "kind" holds categories, and "s" is a channel scale, which maps numbers; give a number field, or name a scale of categories',
      );
      expect(() =>
        build({
          scales: { s: { type: "linear", range: ["#000000", "#ffffff"] } },
          marks: [
            point(kinds, { x: "x", y: "y", encode: { color: { series: true, scale: "s" } } }),
          ],
        }),
      ).toThrow(
        'point (mark 0) encode.color.scale: "s" is a channel scale, mapping numbers, which maps no series\' names; name an ordinal scale',
      );
      // Under the name of a default scale, which marks read categories through unnamed.
      expect(() =>
        build({
          scales: { color: { type: "linear", range: ["#000000", "#ffffff"] } },
          marks: [line(rows, { x: "x", y: "y" })],
        }),
      ).toThrow(
        'chart scales.color: "color" is the scale marks read categories through by default, which a scale with a range does not map; give the channel scale another name, and name it in encode',
      );
    },
    "malformed channel scales and channels they cannot serve are refused at the option",
  );

  it("keep points whose size reaches into the plot, from the values the scale can take", () => {
    // A log scale takes 1e-10 (an area well past the range's 100π, a radius
    // of 33 px) and not -1; the point at -0.05 reaches 5 px into the plot.
    const sized = table({
      x: [-0.05, -0.04, -0.03, 0.5, 1],
      y: [0.5, 0.5, 0.5, 0.5, 0.5],
      s: [1e-10, 1, 1, -1, 10],
    });
    const [g] = drawn<PointGeometry>(
      {
        x: { domain: [0, 1], nice: false },
        y: { domain: [0, 1], nice: false },
        scales: { area: { type: "log", domain: [1, 10], range: [100 * Math.PI, Math.PI] } },
        marks: [point(sized, { x: "x", y: "y", encode: { size: { field: "s", scale: "area" } } })],
      },
      "point",
    );
    expect(Math.max(...areas(g!))).toBeCloseTo(1090 * Math.PI, 3);
  });

  it("place values across domains from the largest numbers to the smallest", () => {
    const outputs = (domain: [number, number]) =>
      new ChannelScale("s", { type: "linear", domain, range: [0, 1] }).numberOutputs([0, 1]);
    const huge = outputs([-1e308, 1e308]);
    expect([-1e308, 0, 1e308].map(huge)).toEqual([0, 0.5, 1]);
    const tiny = outputs([0, 1e-320]);
    expect([0, 5e-321, 1e-320].map(tiny)).toEqual([0, 0.5, 1]);
    // Past the domain, either way round, a value as far off as the largest numbers.
    const widths = (domain: [number, number]) =>
      new ChannelScale("s", { type: "linear", domain, range: [1, 2] }).numberOutputs([0, Infinity]);
    expect(widths([-1e308, -9e307])(1e308)).toBeCloseTo(21, 9);
    expect(widths([-9e307, -1e308])(1e308)).toBe(0);
    expect(widths([-9e307, -1e308])(-1.7e308)).toBeCloseTo(9, 9);
    // Each end of the range exactly, and a constant range everywhere.
    const sizes = new ChannelScale("s", { type: "linear", domain: [0, 1], range: [1e16, 1] });
    expect([0, 1].map(sizes.numberOutputs([0, Infinity]))).toEqual([1e16, 1]);
    expect(widths([-1e308, 1e308])(0)).toBe(1.5);
    // A value whose place overflows (1e308 over a domain of 1e-320) still
    // takes a constant range's output; a missing one still has none.
    const flat = new ChannelScale("s", { type: "linear", domain: [0, 1e-320], range: [1, 1] });
    const constant = flat.numberOutputs([0, Infinity]);
    expect(constant(1e308)).toBe(1);
    expect(constant(Number.NaN)).toBeNaN();
    const least = Number.MIN_VALUE;
    expect([0, least].map(outputs([0, least]))).toEqual([0, 1]);
    expect([-least, 0, least].map(outputs([-least, least]))).toEqual([0, 0.5, 1]);
  });

  it("number rows' looks by output, a ramp's at most its steps", () => {
    const n = 100_000;
    const values = table({ v: Float64Array.from({ length: n }, (_, i) => i / n) });
    const heat = new ChannelScale("heat", {
      type: "linear",
      domain: [0, 1],
      range: ["#000000", "#ffffff"],
    });
    heat.update((color) => color, "chart scales.heat");
    const reader = rowReader(
      { kind: "scaled", field: "v", scale: heat, limits: [0, Infinity] },
      values as unknown as Table,
      [],
      undefined,
      () => undefined,
      "point encode.color",
    );
    // 256 steps, and rows without an output.
    expect(reader.count).toBe(257);
    expect(reader.at(0)).toBe(reader.at(1));
    expect(reader.output(n - 1)).toBe("#ffffff");
    // Lines' and areas' readers, which number no rows, key rows by step too:
    // the looks their runs keep by key stay as few as the steps.
    const uncounted = rowReader(
      { kind: "scaled", field: "v", scale: heat, limits: [0, Infinity] },
      values as unknown as Table,
      [],
      undefined,
      () => undefined,
      "line encode.color",
      false,
    );
    const keys = new Set(Array.from({ length: n }, (_, row) => uncounted.at(row)));
    expect(keys.size).toBe(256);
  });

  it("are refused as position scales, whose range an axis sets", () => {
    expect(() =>
      build({
        scales: { x: { type: "linear", domain: [0, 100], range: [1, 4] } as never },
        marks: [line(rows, { x: "x", y: "y" })],
      }),
    ).toThrow(
      "chart scales.x: places values on an axis, which a range does not set; give the channel scale another name, and name it in encode",
    );
  });

  it("are read from specs, and refused there when malformed", () => {
    const spec = {
      data: { r: { columns: { x: [0, 1], y: [1, 2], w: [0, 1] } } },
      scales: { widths: { type: "sqrt", range: [1, 4] } },
      marks: [
        {
          type: "line",
          data: "r",
          x: "x",
          y: "y",
          encode: { strokeWidth: { field: "w", scale: "widths" } },
        },
      ],
    };
    const loaded = loadSpec(spec as never);
    const [g] = build(loaded.config).scene.panels[0]!.marks.filter((m) => m.kind === "line");
    // A square root's outputs: the domain 0 to 1 onto widths 1 to 4, the line's piece at 1.
    expect((g as LineGeometry).strokeWidth).toBe(4);
    expect(() =>
      loadSpec({ ...spec, scales: { color: { type: "linear", range: [1, 4] } } } as never),
    ).toThrow(/^scales\.color: "color" is the scale marks read categories through by default/);
    expect(() => loadSpec({ ...spec, scales: { widths: { type: "sqrt" } } } as never)).toThrow(
      'scales.widths.range: required, as a "sqrt" scale maps numbers onto a channel; give range, its outputs at the domain\'s ends',
    );
  });
});
