// Channels compiled through one compiler (marks/features/channels.ts):
// identity scales, a field's values drawn as they are, checked per channel
// and standing for nothing (no series, no legend entries); points' colors,
// sizes, opacities, and shapes through named scales, identity scales, and
// conditions.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { SYMBOLS, symbolPath } from "../../src/draw/symbols.ts";
import { estimateText } from "../../src/layout/text.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type { LineGeometry, PointGeometry } from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";
import { keysOf } from "../helpers/guides.ts";

function build(config: ChartConfig) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    ...staticCompilers(),
  );
  model.setSize(600, 300, 1);
  return { model, scene: model.scene(estimateText) };
}

const lines = (config: ChartConfig) =>
  build(config).scene.panels[0]!.marks.filter((m): m is LineGeometry => m.kind === "line");

const rows = table({
  t: [0, 1, 0, 1],
  v: [1, 2, 3, 4],
  site: ["A", "A", "B", "B"],
  paint: ["#d62728", "#d62728", "teal", "teal"],
  w: [1, 1, 3, 3],
});

describe("identity scales on lines", () => {
  it("paint each series the color its rows hold, listing the series as they are", () => {
    const { model, scene } = build({
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          series: "site",
          encode: { color: { field: "paint", scale: { type: "identity" } } },
        }),
      ],
    });
    const drawn = scene.panels[0]!.marks as LineGeometry[];
    expect(drawn.map(({ stroke }) => stroke)).toEqual(["#d62728", "teal"]);
    expect(model.legendEntries().map(({ label, color }) => [label, color])).toEqual([
      ["A", "#d62728"],
      ["B", "teal"],
    ]);
  });

  it("split no series by the field they read", () => {
    const one = table({ t: [0, 1, 2], v: [1, 2, 3], paint: ["teal", "teal", "teal"] });
    const drawn = lines({
      marks: [
        line(one, {
          x: "t",
          y: "v",
          encode: { color: { field: "paint", scale: { type: "identity" } } },
        }),
      ],
    });
    expect(drawn.map(({ stroke }) => stroke)).toEqual(["teal"]);
  });

  it("of the chart's, refuse to name series inferred from the field they read", () => {
    expect(() =>
      build({
        scales: { paints: { type: "identity" } },
        marks: [
          line(rows, { x: "t", y: "v", encode: { color: { field: "paint", scale: "paints" } } }),
        ],
      }),
    ).toThrow(
      'line (mark 0) encode.color.scale: "paints" is an identity scale, whose colors split no series; give series, or series: false',
    );
    const drawn = lines({
      scales: { paints: { type: "identity" } },
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          series: "site",
          encode: { color: { field: "paint", scale: "paints" } },
        }),
      ],
    });
    expect(drawn.map(({ stroke }) => stroke)).toEqual(["#d62728", "teal"]);
  });

  it("refuse values their channel cannot draw, and number fields for colors", () => {
    const bad = table({ t: [0, 1], v: [1, 2], paint: ["red", "nope"], w: [1, 2] });
    expect(() =>
      build({
        marks: [
          line(bad, {
            x: "t",
            y: "v",
            series: false,
            encode: { color: { field: "paint", scale: { type: "identity" } } },
          }),
        ],
      }),
    ).toThrow('line (mark 0) encode.color.field: expected a CSS color; received "nope"');
    expect(() =>
      build({
        marks: [
          line(bad, {
            x: "t",
            y: "v",
            encode: { color: { field: "w" as never, scale: { type: "identity" } } },
          }),
        ],
      }),
    ).toThrow(/encode\.color\.field: field "w" holds number values/);
  });

  it("read widths a number field holds, one per series", () => {
    const drawn = lines({
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          series: "site",
          encode: { strokeWidth: { field: "w", scale: { type: "identity" } } },
        }),
      ],
    });
    expect(drawn.map(({ strokeWidth }) => strokeWidth)).toEqual([1, 3]);
  });
});

const points = (config: ChartConfig) =>
  build(config).scene.panels[0]!.marks.filter((m): m is PointGeometry => m.kind === "point");

/** Each drawn point's fill, from its geometry. */
const fills = (g: PointGeometry) =>
  Array.from({ length: g.count }, (_, i) =>
    g.colors ? g.colors.palette[g.colors.index[i]!] : g.fill,
  );

describe("points' channels", () => {
  const events = table({
    t: [0, 1, 2, 3],
    v: [1, 2, 3, 4],
    kind: ["Optimal", "Threshold", "Optimal", "Other"],
    badge: ["#d62728", "#1f77b4", "teal", "#d62728"],
    area: [16, 64, Number.NaN, 100],
  });

  contractTest(
    "channel.point.identity.colors",
    () => {
      // More colors than a byte indexes keep their own.
      const n = 300;
      const paint = Array.from(
        { length: n },
        (_, i) => `#${(i * 997).toString(16).padStart(6, "0")}`,
      );
      const many = table({
        x: Array.from({ length: n }, (_, i) => i),
        y: Array.from({ length: n }, (_, i) => i),
        paint,
      });
      const { model, scene } = build({
        marks: [
          point(many, { x: "x", y: "y", color: { field: "paint", scale: { type: "identity" } } }),
        ],
      });
      const [g] = scene.panels[0]!.marks as PointGeometry[];
      expect(fills(g!)).toEqual(paint);
      // No series, and no key of the colors.
      expect(keysOf(scene)).toEqual([]);
      expect(model.legendEntries()).toHaveLength(1);
    },
    "colors a field holds, as many as there are, drawn exactly",
  );

  contractTest(
    "channel.point.scale.named",
    () => {
      const { scene } = build({
        scales: {
          shapes: { type: "ordinal", map: { Optimal: "circle", Threshold: "triangle-down" } },
          sizes: { type: "ordinal", map: { Optimal: 36, Threshold: 64 }, unknown: 16 },
        },
        marks: [
          point(events, {
            x: "t",
            y: "v",
            series: false,
            symbol: { field: "kind", scale: "shapes" },
            size: { field: "kind", scale: "sizes" },
          }),
        ],
      });
      const [g] = scene.panels[0]!.marks as PointGeometry[];
      const shapes = Array.from(g!.symbols!.subarray(0, g!.count), (i) => SYMBOLS[i]);
      // "Other" is outside the shapes' map, and the default shapes cycle.
      expect(shapes).toEqual(["circle", "triangle-down", "circle", SYMBOLS[2]]);
      expect(Array.from(g!.radii!.subarray(0, g!.count))).toEqual(
        [36, 64, 36, 16].map((area) => Math.fround(Math.sqrt(area / Math.PI))),
      );
      // Keys of shapes and sizes, by value.
      expect(keysOf(scene).map((key) => key.title.text)).toEqual(["kind", "kind"]);
    },
    "points read named ordinal scales for their shapes and sizes",
  );

  contractTest(
    "channel.point.scale.identity",
    () => {
      const [g] = points({
        marks: [
          point(events, {
            x: "t",
            y: "v",
            size: { field: "area", scale: { type: "identity" } },
            encode: { color: { field: "badge", scale: { type: "identity" } } },
          }),
        ],
      });
      // Areas in square pixels; a row without one is not drawn.
      expect(g!.count).toBe(3);
      expect(Array.from(g!.radii!.subarray(0, 3))).toEqual(
        [16, 64, 100].map((area) => Math.fround(Math.sqrt(area / Math.PI))),
      );
      expect(fills(g!)).toEqual(["#d62728", "#1f77b4", "#d62728"]);
      expect(() =>
        build({
          marks: [
            point(table({ t: [0], v: [1], area: [-4] }), {
              x: "t",
              y: "v",
              size: { field: "area", scale: { type: "identity" } },
            }),
          ],
        }),
      ).toThrow(
        "point (mark 0) size.field: expected an area of 0 or more square pixels; received -4",
      );
      expect(() =>
        build({
          marks: [
            point(events, {
              x: "t",
              y: "v",
              symbol: { field: "kind", scale: { type: "identity" } },
            }),
          ],
        }),
      ).toThrow(/point \(mark 0\) symbol.field: expected a shape: .*; received "Optimal"/);
    },
    "points read sizes, colors, and shapes a field holds, checked as their channel draws them",
  );

  contractTest(
    "channel.point.condition",
    () => {
      const [g] = points({
        marks: [
          point(events, {
            x: "t",
            y: "v",
            color: {
              // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
              condition: { when: [">", ["field", "v"], 2], then: "#d62728", otherwise: "#999999" },
            },
            fillOpacity: {
              // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
              condition: { when: [">", ["field", "v"], 2], then: 1, otherwise: 0.25 },
            },
          }),
        ],
      });
      expect(fills(g!)).toEqual(["#999999", "#999999", "#d62728", "#d62728"]);
      expect(Array.from(g!.opacities!.subarray(0, 4))).toEqual([0.25, 0.25, 1, 1]);
    },
    "points take colors and opacities by a condition on each row",
  );

  it("stand for values through the scales their color names, flat or in encode", () => {
    const kinds = table({ t: [0, 1], v: [1, 2], kind: ["A", "B"] });
    const { model } = build({
      scales: {
        left: { type: "ordinal", map: { A: "#d62728", B: "#2ca02c" } },
        right: { type: "ordinal", map: { A: "#1f77b4", B: "#9467bd" } },
      },
      marks: [
        point(kinds, { x: "t", y: "v", color: { field: "kind", scale: "left" } }),
        point(kinds, { x: "t", y: "v", encode: { color: { field: "kind", scale: "right" } } }),
      ],
    });
    expect(model.legendEntries().map(({ key, color }) => [key, color])).toEqual([
      ['{"scale":"left","value":"A"}', "#d62728"],
      ['{"scale":"left","value":"B"}', "#2ca02c"],
      ['{"scale":"right","value":"A"}', "#1f77b4"],
      ['{"scale":"right","value":"B"}', "#9467bd"],
    ]);
  });

  it("take series' colors from the chart's color scale whatever else they encode", () => {
    const [g] = points({
      scales: { color: { type: "ordinal", map: { Optimal: "#2ca02c" } } },
      marks: [point(events, { x: "t", y: "v", series: "kind", symbol: "kind" })],
    });
    expect(g!.fill).toBe("#2ca02c");
  });

  it("take a fill set flat over their color, as other marks do", () => {
    const [g] = points({
      marks: [
        point(events, {
          x: "t",
          y: "v",
          fill: "#2ca02c",
          color: {
            // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
            condition: { when: [">", ["field", "v"], 2], then: "#d62728", otherwise: "#999999" },
          },
        }),
      ],
    });
    expect(g!.colors).toBeUndefined();
    expect(g!.fill).toBe("#2ca02c");
  });

  it("refuse what their channels cannot read", () => {
    const refused = (options: object) => () =>
      build({ marks: [point(events, { x: "t", y: "v", ...options } as never)] });
    expect(refused({ size: { field: "kind" } })).toThrow(
      'point (mark 0) size.field: field "kind" holds categories, which sizes read through a scale mapping them; give scale, the name of one of the chart\'s scales',
    );
    expect(refused({ encode: { size: { series: true, scale: "s" } }, series: "kind" })).toThrow(
      /encode\.size: \{ series: true \} names series through a scale/,
    );
    expect(refused({ encode: { stroke: { field: "badge" } } })).toThrow(
      "point encode.stroke: points of a mark draw one outline; give { value }, or stroke",
    );
    expect(refused({ fillOpacity: 0.5, encode: { opacity: { value: 1 } } })).toThrow(
      "point encode.opacity: set as fillOpacity and as encode.opacity; give one",
    );
  });

  it("name what their channels read in a row's text", () => {
    const { model } = build({
      scales: { sizes: { type: "ordinal", map: { Optimal: 36, Threshold: 64, Other: 9 } } },
      marks: [
        point(events, {
          x: "t",
          y: "v",
          series: false,
          size: { field: "kind", scale: "sizes" },
          encode: { color: { field: "badge", scale: { type: "identity" } } },
        }),
      ],
    });
    const at = model.inspect(model.xScale()!.map(1), model.yScale()!.map(2))!;
    expect(at.points[0]!.color).toBe("#1f77b4");
  });

  it("key a shape field's values in the shapes points draw", () => {
    const { scene } = build({
      marks: [point(events, { x: "t", y: "v", series: false, symbol: "kind" })],
    });
    const [key] = keysOf(scene);
    expect(key!.entries.map((e) => e.label.text)).toEqual(["Optimal", "Threshold", "Other"]);
    const circle = symbolPath("circle", 0, 0, 4.5);
    expect(key!.entries[0]!.glyph).toBe(circle);
  });
});
