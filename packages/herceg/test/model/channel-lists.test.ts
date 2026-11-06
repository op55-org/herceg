// Channels' three forms beyond one channel: lists tried in order (the first
// entry giving a drawn item an output wins), conditions without
// `otherwise`, and rank tests over a mark's rows. Lists split no series;
// one ending in the series' color (their names, or the series field)
// colors the series and the items its other entries leave without one; a
// scale read in a list shows a key of its values.
// biome-ignore-all lint/suspicious/noThenProperty: conditions' branches, as specs name them.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { category } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { rowView } from "../../src/data/row-view.ts";
import { table } from "../../src/data/table.ts";
import { legend } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { custom } from "../../src/marks/custom.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { region } from "../../src/marks/region.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type { LineGeometry, PointGeometry, RectGeometry, Scene } from "../../src/scene/scene.ts";
import { validateSpec } from "../../src/spec/validate.ts";
import { LIGHT } from "../../src/theme.ts";
import { contractTest } from "../helpers/contracts.ts";
import { keysOf, legendOf } from "../helpers/guides.ts";

function build(config: ChartConfig) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    staticCompilers(),
  );
  model.setSize(600, 300, 1);
  return { model, scene: model.scene(estimateText) };
}

const marksOf = <G>(scene: Scene, kind: string) =>
  scene.panels[0]!.marks.filter((m) => m.kind === kind) as G[];
/** Each bar's fill, in its series' row order: the rects of each look, left to right. */
const barFills = (scene: Scene) =>
  marksOf<RectGeometry>(scene, "rect")
    .flatMap((g) => Array.from({ length: g.count }, (_, i) => [g.rects[i * 4]!, g.fill] as const))
    .sort((a, b) => a[0] - b[0])
    .map(([, fill]) => fill);
const pointFills = (scene: Scene) =>
  marksOf<PointGeometry>(scene, "point").flatMap((g) =>
    Array.from({ length: g.count }, (_, i) =>
      g.colors ? g.colors.palette[g.colors.index[i]!] : g.fill,
    ),
  );
const strokes = (scene: Scene) =>
  marksOf<LineGeometry>(scene, "line").map((g) => [g.key, g.stroke]);

const services = table({
  service: ["auth", "cart", "feed", "mail", "pay"],
  p99: [5, 9, 9, 2, 7],
  errors: [0.01, 0.2, 0.03, 0.1, 0],
  tier: ["web", "web", "core", "core", "core"],
});
const RED = "#c62828";
const AMBER = "#ff9800";
const GREY = "#90a4ae";

describe("channel lists", () => {
  contractTest(
    "channel.list.first-output",
    () => {
      const { scene, model } = build({
        marks: [
          bar(services, {
            x: "service",
            y: "p99",
            encode: {
              color: [
                { condition: { when: { top: 2, field: "p99" }, then: RED } },
                { condition: { when: col("errors").gt(0.05), then: AMBER } },
                { value: GREY },
              ],
            },
          }),
        ],
      });
      // cart and feed tie for the top two; mail fails often; the rest take the constant.
      expect(barFills(scene)).toEqual([GREY, RED, RED, AMBER, GREY]);
      // A list splits no series: one entry, in the muted color rows of their own looks show.
      expect(model.legendEntries().map(({ label, color }) => [label, color])).toEqual([
        ["p99", LIGHT.muted],
      ]);
    },
    "give each bar the first entry's output it has",
  );

  contractTest(
    "channel.condition.without-otherwise",
    () => {
      const alone = build({
        marks: [
          bar(services, {
            x: "service",
            y: "p99",
            encode: { color: { condition: { when: col("errors").gt(0.05), then: AMBER } } },
          }),
        ],
      }).scene;
      expect(barFills(alone)).toEqual([LIGHT.muted, AMBER, LIGHT.muted, AMBER, LIGHT.muted]);
      // "transparent" is an output, which the next entry does not replace.
      const listed = build({
        marks: [
          bar(services, {
            x: "service",
            y: "p99",
            encode: {
              color: [
                { condition: { when: col("errors").gt(0.05), then: "transparent" } },
                { condition: { when: col("p99").gt(6), then: RED } },
              ],
            },
          }),
        ],
      }).scene;
      expect(barFills(listed)).toEqual([LIGHT.muted, "transparent", RED, "transparent", RED]);
    },
    "leave rows no entry gives an output the mark's fallback, as a condition without otherwise does",
  );

  contractTest(
    "channel.list.series",
    () => {
      const tiers = {
        tiers: { type: "ordinal", map: { web: "#1565c0", core: "#2e7d32" } },
      } as const;
      const alone = build({
        scales: tiers,
        marks: [
          bar(services, {
            x: "service",
            y: "p99",
            series: "tier",
            encode: { color: { field: "tier", scale: "tiers" } },
          }),
        ],
      });
      const listed = build({
        scales: tiers,
        marks: [
          bar(services, {
            x: "service",
            y: "p99",
            series: "tier",
            encode: {
              color: [
                { condition: { when: { top: 1, field: "errors" }, then: RED } },
                { field: "tier", scale: "tiers" },
              ],
            },
          }),
        ],
      });
      expect(barFills(listed.scene)).toEqual(["#1565c0", RED, "#2e7d32", "#2e7d32", "#2e7d32"]);
      // Series, their entries, and their colors are the same with and without the list.
      const entries = (model: ChartModel) =>
        model.legendEntries().map(({ key, label, color }) => [key, label, color]);
      expect(entries(listed.model)).toEqual(entries(alone.model));
      expect(entries(listed.model).map(([, label, color]) => [label, color])).toEqual([
        ["web", "#1565c0"],
        ["core", "#2e7d32"],
      ]);
      expect(keysOf(listed.scene)).toEqual([]);
    },
    "color series by the entry ending them that names their colors, as alone",
  );

  it("read the series' names in marks of several y fields, per item", () => {
    const wide = table({ day: ["a", "b", "c"], low: [1, 4, 2], high: [3, 8, 5] });
    const fields = {
      fields: { type: "ordinal", map: { low: "#1565c0", high: "#6a1b9a" } },
    } as const;
    const { scene, model } = build({
      scales: fields,
      marks: [
        bar(wide, {
          x: "day",
          y: ["low", "high"],
          encode: {
            color: [
              { condition: { when: col("day").eq("b"), then: RED } },
              { series: true, scale: "fields" },
            ],
          },
        }),
      ],
    });
    // Each day's two bars: the condition reads the row, the series' names each bar's series.
    expect(barFills(scene)).toEqual(["#1565c0", "#6a1b9a", RED, RED, "#1565c0", "#6a1b9a"]);
    expect(model.legendEntries().map(({ label, color }) => [label, color])).toEqual([
      ["low", "#1565c0"],
      ["high", "#6a1b9a"],
    ]);
  });

  contractTest(
    "channel.list.line-runs",
    () => {
      const sites = table({
        t: [0, 1, 2, 3, 0, 1, 2, 3],
        v: [1, 5, 2, 3, 2, 3, 9, 1],
        site: ["A", "A", "A", "A", "B", "B", "B", "B"],
      });
      const scales = { sites: { type: "ordinal", map: { A: "#1565c0", B: "#2e7d32" } } } as const;
      const listed = build({
        scales,
        marks: [
          line(sites, {
            x: "t",
            y: "v",
            series: "site",
            encode: {
              color: [
                { condition: { when: { top: 2, field: "v" }, then: RED } },
                { series: true, scale: "sites" },
              ],
            },
          }),
        ],
      });
      // A piece of line takes the look of the observation it arrives at.
      expect(strokes(listed.scene)).toEqual([
        ['[0,"A"]|run0', RED],
        ['[0,"A"]|run1', "#1565c0"],
        ['[0,"B"]|run0', "#2e7d32"],
        ['[0,"B"]|run1', RED],
        ['[0,"B"]|run2', "#2e7d32"],
      ]);
      const alone = build({
        scales,
        marks: [
          line(sites, {
            x: "t",
            y: "v",
            series: "site",
            encode: { color: { series: true, scale: "sites" } },
          }),
        ],
      });
      const entries = (model: ChartModel) =>
        model.legendEntries().map(({ key, label, color }) => [key, label, color]);
      expect(entries(listed.model)).toEqual(entries(alone.model));
      // Hiding a series hides it whole, as without the list.
      listed.model.hidden.add(listed.model.series()[0]!.key);
      expect(strokes(listed.model.scene(estimateText)).map(([key]) => key)).toEqual([
        '[0,"B"]|run0',
        '[0,"B"]|run1',
        '[0,"B"]|run2',
      ]);
    },
    "draw lines per observation, in runs, their series' colors kept",
  );

  it("draw a series whose observations all take one entry's output in it, its legend entry in its color", () => {
    const sites = table({
      t: [0, 1, 2, 0, 1, 2],
      v: [1, 2, 3, -1, -2, -3],
      site: ["A", "A", "A", "B", "B", "B"],
    });
    const { model, scene } = build({
      scales: { sites: { type: "ordinal", map: { A: "#1565c0", B: "#6a1b9a" } } },
      marks: [
        line(sites, {
          x: "t",
          y: "v",
          series: "site",
          encode: {
            color: [
              { condition: { when: col("v").gt(0), then: RED } },
              { series: true, scale: "sites" },
            ],
          },
        }),
      ],
    });
    const drawn = (s: Scene) => strokes(s).map(([, stroke]) => stroke);
    const entries = (s: Scene) => legendOf(s).map((item) => [item.label, item.color]);
    expect(drawn(scene)).toEqual([RED, "#6a1b9a"]);
    expect(entries(scene)).toEqual([
      ["A", "#1565c0"],
      ["B", "#6a1b9a"],
    ]);
    // Mixed looks along A keep its entry's color too.
    sites.append({ t: [3], v: [-4], site: ["A"] });
    const next = model.scene(estimateText);
    expect(drawn(next)).toEqual([RED, "#1565c0", "#6a1b9a"]);
    expect(entries(next)).toEqual(entries(scene));
  });

  contractTest(
    "channel.list.legend-key",
    () => {
      const runs = table({
        t: [0, 1, 2, 3],
        v: [1, 2, 3, 4],
        state: ["ok", "ok", "down", "ok"],
      });
      const { scene, model } = build({
        scales: { states: { type: "ordinal", map: { ok: "#2e7d32", down: RED } } },
        marks: [
          line(runs, {
            x: "t",
            y: "v",
            encode: {
              color: [
                { condition: { when: col("v").gt(3), then: AMBER } },
                { field: "state", scale: "states" },
              ],
            },
          }),
        ],
      });
      expect(model.legendEntries().map(({ label }) => label)).toEqual(["v"]);
      const [key] = keysOf(scene);
      expect(key!.entries.map((e) => [e.label.text, e.fill])).toEqual([
        ["ok", "#2e7d32"],
        ["down", RED],
      ]);
      expect(strokes(scene).map(([, stroke]) => stroke)).toEqual(["#2e7d32", RED, AMBER]);
    },
    "show a key of a scale a line reads in a list, splitting no series by it",
  );

  it("show a key of a scale bars read in a list, and the series' entries", () => {
    const { scene, model } = build({
      marks: [
        bar(services, {
          x: "service",
          y: "p99",
          encode: {
            color: [
              { condition: { when: { top: 1, field: "errors" }, then: RED } },
              { field: "tier" },
            ],
          },
        }),
      ],
    });
    const [key] = keysOf(scene);
    expect(key!.title.text).toBe("tier");
    expect(key!.entries.map((e) => e.label.text)).toEqual(["web", "core"]);
    // An explanatory key: no entries to toggle, and the mark's one series apart from it.
    expect(legendOf(scene).map((item) => item.label)).toEqual([]);
    expect(model.legendEntries().map(({ label }) => label)).toEqual(["p99"]);
  });

  contractTest(
    "channel.list.points",
    () => {
      const scales = {
        tiers: { type: "ordinal", map: { web: "#1565c0", core: "#2e7d32" } },
      } as const;
      const tailed = build({
        scales,
        marks: [
          point(services, {
            x: "errors",
            y: "p99",
            series: "tier",
            color: [
              { condition: { when: { bottom: 1, field: "p99" }, then: RED } },
              { series: true, scale: "tiers" },
            ],
          }),
        ],
      });
      // Points by series (web, then core), each row its own entry's color or its series'.
      expect(pointFills(tailed.scene)).toEqual(["#1565c0", "#1565c0", "#2e7d32", RED, "#2e7d32"]);
      expect(tailed.model.legendEntries().map(({ label, color }) => [label, color])).toEqual([
        ["web", "#1565c0"],
        ["core", "#2e7d32"],
      ]);
      // Without such an entry, rows no entry colors take the muted color, drawn.
      const untailed = build({
        marks: [
          point(services, {
            x: "errors",
            y: "p99",
            encode: { color: [{ condition: { when: col("p99").gt(8), then: RED } }] },
          }),
        ],
      }).scene;
      expect(pointFills(untailed)).toEqual([LIGHT.muted, RED, RED, LIGHT.muted, LIGHT.muted]);
    },
    "color points by entries, their series by the entry ending the list",
  );

  contractTest(
    "channel.list.regions",
    () => {
      const spans = table({ start: [0, 2, 4], end: [1, 3, 5], level: [3, 9, 5] });
      const scene = build({
        x: { domain: [0, 5] },
        marks: [
          region(spans, {
            x1: "start",
            x2: "end",
            encode: {
              fill: [
                { condition: { when: { top: 1, field: "level" }, then: RED } },
                { value: GREY },
              ],
            },
          }),
        ],
      }).scene;
      expect(marksOf<RectGeometry>(scene, "rect").flatMap((g) => [g.fill])).toContain(RED);
      expect(() =>
        build({
          scales: { s: { type: "ordinal" } },
          marks: [
            region(spans, {
              x1: "start",
              x2: "end",
              encode: {
                fill: [
                  { condition: { when: col("level").gt(4), then: RED } },
                  // @ts-expect-error regions have no series
                  { series: true, scale: "s" },
                ],
              },
            }),
          ],
        }),
      ).toThrow(
        "region (mark 0) encode.fill[1]: regions have no series whose names it could read; give a field, a value, or a condition",
      );
    },
    "paint regions per row, refusing the series' names in a list",
  );

  contractTest(
    "channel.list.custom",
    () => {
      const wide = table({ t: [0, 1, 2], a: [1, 5, 2], b: [4, 2, 6] });
      const read: (string | undefined)[][] = [];
      build({
        scales: { fields: { type: "ordinal", map: { a: "#1565c0", b: "#6a1b9a" } } },
        marks: [
          custom(wide, {
            x: "t",
            y: ["a", "b"],
            encode: {
              color: [
                { condition: { when: col("t").eq(1), then: RED } },
                { series: true, scale: "fields" },
              ],
            },
            draw({ series, encoded }) {
              for (const s of series)
                for (let k = 0; k < s.length; k++)
                  read.push([
                    s.label,
                    encoded("color", s.rowAt(k), s),
                    encoded("color", s.rowAt(k)),
                  ]);
            },
          }),
        ],
      });
      expect(read).toEqual([
        ["a", "#1565c0", undefined],
        ["a", RED, RED],
        ["a", "#1565c0", undefined],
        ["b", "#6a1b9a", undefined],
        ["b", RED, RED],
        ["b", "#6a1b9a", undefined],
      ]);
    },
    "give custom marks a list's outputs by row, and its series' colors for their items",
  );

  contractTest(
    "channel.list.unreachable",
    () => {
      const after = (first: object) =>
        build({
          scales: { s: { type: "ordinal" } },
          marks: [
            bar(services, {
              x: "service",
              y: "p99",
              encode: { color: [first, { value: GREY }] as never },
            }),
          ],
        });
      const message =
        "bar (mark 0) encode.color[1]: the channel before it always gives an output (a constant, the series' names, or a condition with otherwise); move it first, or drop it";
      expect(() => after({ value: RED })).toThrow(message);
      expect(() => after({ series: true, scale: "s" })).toThrow(message);
      expect(() =>
        after({ condition: { when: col("p99").gt(5), then: RED, otherwise: AMBER } }),
      ).toThrow(message);
      expect(() => after({ condition: { when: col("p99").gt(5), then: RED } })).not.toThrow();
      // Every entry is checked, reached or not.
      expect(() =>
        build({
          marks: [
            bar(services, {
              x: "service",
              y: "p99",
              encode: {
                color: [{ value: RED }, { condition: { when: col("nope").gt(1), then: GREY } }],
              },
            }),
          ],
        }),
      ).toThrow('bar (mark 0) encode.color[1].condition.when: expression: no field "nope"');
      expect(() =>
        build({ marks: [bar(services, { x: "service", y: "p99", encode: { color: [] } })] }),
      ).toThrow(
        "bar (mark 0) encode.color: expected a channel, or channels tried in order; received an empty list",
      );
    },
    "refuse an entry after one that always gives an output",
  );

  contractTest(
    "channel.list.spec",
    () => {
      const spec = (color: unknown) => ({
        data: { s: { columns: { x: ["a", "b"], v: [1, 2] } } },
        marks: [{ type: "bar", data: "s", x: "x", y: "v", encode: { color } }],
      });
      expect(() =>
        validateSpec(
          spec([{ condition: { when: { top: 1, field: "v" }, then: RED } }, { value: GREY }]),
        ),
      ).not.toThrow();
      expect(() => validateSpec(spec([{ value: GREY }, { value: RED }]))).toThrow(
        "marks[0].encode.color[1]: the channel before it always gives an output (a constant, the series' names, or a condition with otherwise); move it first, or drop it",
      );
      expect(() =>
        validateSpec(spec([{ condition: { when: { top: 0, field: "v" }, then: RED } }])),
      ).toThrow(
        "marks[0].encode.color[0].condition.when.top: expected a whole number of rows from 1; received 0",
      );
      expect(() =>
        validateSpec(spec({ condition: { when: { top: 1, bottom: 1, field: "v" }, then: RED } })),
      ).toThrow(
        "marks[0].encode.color.condition.when: a rank test takes top or bottom, not both; drop one",
      );
      expect(() => validateSpec(spec([[{ value: RED }]]))).toThrow(
        "marks[0].encode.color[0]: expected a channel; a list's entries are channels, so give them in one list",
      );
      expect(() =>
        validateSpec({
          data: { s: { columns: { x: [0, 1], y: [0, 1], v: [1, 2] } } },
          marks: [
            {
              type: "heatmap",
              data: "s",
              x: "x",
              y: "y",
              color: "v",
              encode: { color: { value: RED } },
            },
          ],
        }),
      ).toThrow(
        "marks[0].encode: a heatmap takes color as a field; its cells reduce several rows, which conditions and lists do not read; drop encode",
      );
    },
    "are checked in specs as the compiler checks them",
  );
});

describe("channel lists' edges", () => {
  const GREEN = "#2e7d32";
  const BLUE = "#1565c0";
  const PURPLE = "#6a1b9a";

  it("read entries before the series' color by row, the series field's through another scale too", () => {
    const sites = table({ t: [0, 1, 0, 1], v: [1, 2, 3, 4], site: ["A", "A", "B", "B"] });
    const { scene } = build({
      scales: {
        first: { type: "ordinal", domain: ["A"], map: { A: GREEN } },
        tail: { type: "ordinal", map: { A: BLUE, B: PURPLE } },
      },
      marks: [
        line(sites, {
          x: "t",
          y: "v",
          series: "site",
          encode: {
            color: [
              { field: "site", scale: "first" },
              { series: true, scale: "tail" },
            ],
          },
        }),
      ],
    });
    expect(strokes(scene).map(([, stroke]) => stroke)).toEqual([GREEN, PURPLE]);
    expect(legendOf(scene).map((item) => [item.label, item.color])).toEqual([
      ["A", BLUE],
      ["B", PURPLE],
    ]);
  });

  it("go on to the next entry for values a scale does not map", () => {
    const kinds = table({ k: ["a", "b", "a"], x: [0, 1, 2], v: [1, 2, 3] });
    const color = [{ field: "k", scale: "s" }, { value: RED }] as const;
    const scales = { s: { type: "ordinal" as const, domain: ["a"], map: { a: GREEN } } };
    const bars = build({ scales, marks: [bar(kinds, { x: "x", y: "v", encode: { color } })] });
    expect(barFills(bars.scene)).toEqual([GREEN, RED, GREEN]);
    const points = build({ scales, marks: [point(kinds, { x: "x", y: "v", color })] });
    expect(pointFills(points.scene)).toEqual([GREEN, RED, GREEN]);
    const lines = build({ scales, marks: [line(kinds, { x: "x", y: "v", encode: { color } })] });
    expect(strokes(lines.scene).map(([, stroke]) => stroke)).toEqual([RED, GREEN]);
  });

  it("of one entry are lists: rows it gives no output take the mark's, and it splits no series", () => {
    const kinds = table({ k: ["a", null, "a"], x: [0, 1, 2], v: [1, 2, 3] });
    const points = build({ marks: [point(kinds, { x: "x", y: "v", color: [{ field: "k" }] })] });
    // The missing category draws in the mark's color, where the field alone leaves it out.
    expect(pointFills(points.scene)).toHaveLength(3);
    const lines = build({
      marks: [line(kinds, { x: "x", y: "v", encode: { color: [{ field: "k" }] } })],
    });
    expect(lines.model.legendEntries().map(({ label }) => label)).toEqual(["v"]);
    expect(keysOf(lines.scene).map((key) => key.entries.map((e) => e.label.text))).toEqual([["a"]]);
  });

  it("give series the palette's places they have without the entries before their color", () => {
    const wide = table({ x: ["p", "q"], a: [1, 2], b: [3, 4], other: [null, "z"] });
    const long = table({
      x: [0, 1, 2, 3],
      v: [1, 2, 3, 4],
      k: ["A", "B", "A", "B"],
      other: [null, "z", null, null],
    });
    const tail = { series: true, scale: "s" } as const;
    const prefix = { field: "other", scale: "s" } as const;
    const colors = (mark: ChartConfig["marks"][number]) =>
      legendOf(build({ scales: { s: { type: "ordinal" } }, marks: [mark] }).scene).map(
        (item) => item.color,
      );
    // Marks of several y fields, the series field, points' flat color, and a view's rows.
    const y = ["a", "b"] as const;
    expect(colors(bar(wide, { x: "x", y, encode: { color: [prefix, tail] } }))).toEqual(
      colors(bar(wide, { x: "x", y, encode: { color: tail } })),
    );
    expect(colors(line(wide, { x: "x", y, encode: { color: [prefix, tail] } }))).toEqual(
      colors(line(wide, { x: "x", y, encode: { color: tail } })),
    );
    expect(colors(point(long, { x: "x", y: "v", series: "k", color: [prefix, tail] }))).toEqual(
      colors(point(long, { x: "x", y: "v", series: "k", color: tail })),
    );
    const view = rowView(long, { filter: col("k").eq("B") });
    const failing = { condition: { when: col("v").gt(10), then: RED } };
    const drawn = (color: object) =>
      build({
        scales: { s: { type: "ordinal" } },
        marks: [bar(view, { x: "x", y: "v", series: "k", encode: { color: color as never } })],
      }).model.series()[0]!.color;
    expect(drawn([failing, tail])).toBe(drawn(tail));
  });

  it("keep series' colors and legend guides' scales with a series field ending a list", () => {
    const sites = table({ t: [0, 1, 0, 1], v: [1, 2, 3, 4], site: ["A", "A", "B", "B"] });
    const failing = { condition: { when: col("v").gt(10), then: RED } };
    const chart = (color: object) =>
      build({
        scales: { s: { type: "ordinal", map: { A: BLUE, B: PURPLE } } },
        guides: [legend({ include: [{ mark: "l", channel: "color" }] })],
        marks: [
          line(sites, {
            id: "l",
            x: "t",
            y: "v",
            series: "site",
            encode: { color: color as never },
          }),
        ],
      }).scene;
    const field = { field: "site", scale: "s" };
    const entries = (scene: Scene) => legendOf(scene).map((item) => [item.label, item.color]);
    expect(entries(chart([failing, field]))).toEqual(entries(chart(field)));
  });

  it("keep the series' color in legends where all a series' rows take an entry's output", () => {
    const sites = table({ t: [0, 1, 0, 1], v: [1, 2, 3, 4], site: ["A", "A", "B", "B"] });
    const always = { condition: { when: col("v").gt(0), then: RED } };
    const tail = { series: true, scale: "s" } as const;
    const scales = { s: { type: "ordinal" as const, map: { A: BLUE, B: PURPLE } } };
    // A stack's layers draw in it, their entries in the series' colors.
    const stacked = build({
      scales,
      marks: [
        area(sites, {
          x: "t",
          y: "v",
          series: "site",
          stack: true,
          encode: { color: [always, tail] },
        }),
      ],
    }).scene;
    const fills = marksOf<{ fill: string }>(stacked, "area").map((g) => g.fill);
    expect(fills).toEqual([RED, RED]);
    expect(legendOf(stacked).map((item) => item.color)).toEqual([BLUE, PURPLE]);
    // Style maps and the mark's own outline keep theirs.
    const styled = build({
      scales,
      marks: [
        area(sites, {
          x: "t",
          y: "v",
          series: "site",
          stack: true,
          stroke: "#000000",
          encode: { color: [always, tail] },
          style: { by: { map: { A: { fill: GREEN } } } },
        }),
      ],
    }).scene;
    const layers = marksOf<{ fill: string; stroke: string | null }>(styled, "area");
    expect(layers.map((g) => [g.fill, g.stroke])).toEqual([
      [GREEN, "#000000"],
      [RED, "#000000"],
    ]);
    expect(legendOf(styled).map((item) => item.color)).toEqual([GREEN, PURPLE]);
    // Bars' swatches of marks' looks show the series' color, as a mixed series' do.
    const bars = build({
      scales,
      legend: { swatches: "mark" },
      marks: [bar(sites, { x: "t", y: "v", series: "site", encode: { color: [always, tail] } })],
    }).scene;
    expect(legendOf(bars)[0]!.sample!.items[0]).toMatchObject({ fill: BLUE });
  });

  it("key each scale a list reads, in bars and custom marks", () => {
    const rows = table({
      x: [0, 1, 2],
      x2: [1, 2, 3],
      v: [1, 2, 3],
      a: ["p", null, null],
      b: [null, "q", "r"],
      s: ["m", "n", "n"],
    });
    const color = [
      { field: "a", scale: "as" },
      { field: "b", scale: "bs" },
    ] as const;
    const scales = {
      as: { type: "ordinal" as const, map: { p: GREEN } },
      bs: { type: "ordinal" as const, map: { q: BLUE, r: PURPLE } },
    };
    const titles = (scene: Scene) =>
      keysOf(scene).map((key) => key.entries.map((e) => e.label.text));
    expect(
      titles(build({ scales, marks: [bar(rows, { x: "x", y: "v", encode: { color } })] }).scene),
    ).toEqual([["p"], ["q", "r"]]);
    expect(
      titles(
        build({
          scales,
          marks: [custom(rows, { x: "x", y: "v", series: "s", encode: { color }, draw() {} })],
        }).scene,
      ),
    ).toEqual([["p"], ["q", "r"]]);
  });

  it("key a list's series field read through another scale, and an outline's list", () => {
    const sites = table({ x: ["p", "q"], v: [1, 2], site: ["A", "B"], k: ["m", "n"] });
    const scales = {
      first: { type: "ordinal" as const, domain: ["A"], map: { A: GREEN } },
      s: { type: "ordinal" as const, map: { A: BLUE, B: PURPLE } },
      ks: { type: "ordinal" as const, map: { m: GREEN, n: BLUE } },
    };
    const titles = (scene: Scene) => keysOf(scene).map((key) => key.title.text);
    const tail = { series: true, scale: "s" } as const;
    expect(
      titles(
        build({
          scales,
          marks: [
            bar(sites, {
              x: "x",
              y: "v",
              series: "site",
              encode: { color: [{ field: "site", scale: "first" }, tail] },
            }),
          ],
        }).scene,
      ),
    ).toEqual(["site"]);
    expect(
      titles(
        build({
          scales,
          marks: [
            bar(sites, { x: "x", y: "v", encode: { stroke: [{ field: "k", scale: "ks" }] } }),
          ],
        }).scene,
      ),
    ).toEqual(["k"]);
  });

  it("key the scales an area's outline list reads", () => {
    const kinds = table({ t: [0, 1, 2], v: [1, 2, 3], kind: ["m", "n", "m"] });
    const { scene } = build({
      scales: { ks: { type: "ordinal", map: { m: GREEN, n: BLUE } } },
      marks: [
        area(kinds, { x: "t", y: "v", encode: { stroke: [{ field: "kind", scale: "ks" }] } }),
      ],
    });
    expect(keysOf(scene).map((key) => key.title.text)).toEqual(["kind"]);
  });

  it("let legend guides name the scales lists read, with rows or none", () => {
    const scales = {
      s: { type: "ordinal" as const, map: { m: GREEN, n: BLUE } },
      sizes: { type: "ordinal" as const, map: { m: 20, n: 80 } },
      shapes: { type: "ordinal" as const, map: { m: "square", n: "circle" } },
    };
    for (const rows of [
      table({ x: [0, 1], v: [1, 2], k: ["m", "n"] }),
      table({ x: [] as number[], v: [] as number[], k: category([]) }),
    ]) {
      const points = (channel: "color" | "size" | "symbol", given: object) =>
        build({
          scales,
          guides: [legend({ include: [{ mark: "m", channel }] })],
          marks: [point(rows, { id: "m", x: "x", y: "v", series: false, [channel]: given })],
        });
      expect(() => points("color", [{ field: "k", scale: "s" }])).not.toThrow();
      expect(() => points("size", [{ field: "k", scale: "sizes" }])).not.toThrow();
      expect(() => points("symbol", [{ field: "k", scale: "shapes" }])).not.toThrow();
      const bars = (encode: object) =>
        build({
          scales,
          guides: [legend({ include: [{ mark: "m", channel: "color" }] })],
          marks: [bar(rows, { id: "m", x: "x", y: "v", encode: encode as never })],
        });
      expect(() => bars({ color: [{ field: "k", scale: "s" }] })).not.toThrow();
      expect(() => bars({ stroke: [{ field: "k", scale: "s" }] })).not.toThrow();
    }
  });

  it("let guides name a points' size or shape list reading the series field, which keys it", () => {
    const rows = table({ x: [0, 1], v: [1, 2], k: ["m", "n"] });
    const scales = {
      sizes: { type: "ordinal" as const, map: { m: 20, n: 80 } },
      shapes: { type: "ordinal" as const, map: { m: "square", n: "circle" } },
    };
    for (const [channel, given] of [
      ["size", [{ field: "k", scale: "sizes" }]],
      ["symbol", [{ field: "k", scale: "shapes" }]],
    ] as const) {
      const mark = () => point(rows, { id: "m", x: "x", y: "v", series: "k", [channel]: given });
      expect(keysOf(build({ scales, marks: [mark()] }).scene).map((key) => key.title.text)).toEqual(
        ["k"],
      );
      expect(() =>
        build({ scales, guides: [legend({ include: [{ mark: "m", channel }] })], marks: [mark()] }),
      ).not.toThrow();
    }
  });

  it("let guides name the color of marks keying a list's scale, with rows, emptied, or none", () => {
    const scales = { s: { type: "ordinal" as const, map: { m: GREEN, n: BLUE } } };
    const color = [{ field: "k", scale: "s" }] as const;
    const rowsOf = (n: number) =>
      table({ x: [0, 1].slice(0, n), v: [1, 2].slice(0, n), k: category(["m", "n"].slice(0, n)) });
    type Rows = ReturnType<typeof rowsOf>;
    const marks = {
      line: (rows: Rows) => line(rows, { id: "m", x: "x", y: "v", encode: { color } }),
      area: (rows: Rows) => area(rows, { id: "m", x: "x", y: "v", encode: { color } }),
      region: (rows: Rows) => region(rows, { id: "m", x1: "x", x2: "v", encode: { fill: color } }),
      custom: (rows: Rows) =>
        custom(rows, { id: "m", x: "x", y: "v", encode: { color }, draw() {} }),
    };
    for (const [type, mark] of Object.entries(marks)) {
      const full = rowsOf(2);
      for (const rows of [full, rowsOf(0)]) {
        const { model, scene } = build({
          scales,
          guides: [legend({ include: [{ mark: "m", channel: "color" }] })],
          marks: [mark(rows)],
        });
        expect(keysOf(scene).length, type).toBe(rows === full ? 1 : 0);
        if (rows === full) {
          full.dropFirst(full.length);
          expect(() => model.scene(estimateText), type).not.toThrow();
        }
      }
    }
  });

  it("refuse a missing scale ending a list at its index", () => {
    const rows = () => table({ x: [0, 1], v: [1, 2], k: ["m", "n"] });
    const big = { condition: { when: col("v").gt(5), then: RED } };
    const missing = { series: true, scale: "missing" } as const;
    expect(() =>
      build({
        marks: [line(rows(), { x: "x", y: "v", series: "k", encode: { stroke: [big, missing] } })],
      }),
    ).toThrow(/encode\.stroke\[1\]\.scale: the chart has no scale "missing"/);
    expect(() =>
      build({
        marks: [
          point(rows(), {
            x: "x",
            y: "v",
            series: "k",
            color: [big, { field: "k", scale: "missing" }],
          }),
        ],
      }),
    ).toThrow(/color\[1\]\.scale: the chart has no scale "missing"/);
  });

  it("give custom marks' rows read alone the color of a series field ending a list", () => {
    const rows = table({ x: [0, 1, 2], v: [1, 5, 2], site: ["A", "A", "B"] });
    const scales = { sites: { type: "ordinal" as const, map: { A: GREEN, B: BLUE } } };
    const tail = { field: "site", scale: "sites" } as const;
    for (const color of [[tail], [{ condition: { when: col("v").gt(4), then: RED } }, tail]]) {
      const read: (string | undefined)[][] = [];
      build({
        scales,
        marks: [
          custom(rows, {
            x: "x",
            y: "v",
            series: "site",
            encode: { color },
            draw({ series, encoded }) {
              for (const s of series)
                for (let k = 0; k < s.length; k++)
                  read.push([encoded("color", s.rowAt(k), s), encoded("color", s.rowAt(k))]);
            },
          }),
        ],
      });
      const big = color.length > 1 ? RED : GREEN;
      expect(read).toEqual([
        [GREEN, GREEN],
        [big, big],
        [BLUE, BLUE],
      ]);
    }
  });

  it("refuse a list entry's identity colors at its index", () => {
    const rows = table({ x: [0, 1], v: [1, 2], paint: ["red", "not a color"] });
    const color = [
      { condition: { when: col("v").gt(5), then: RED } },
      { field: "paint", scale: { type: "identity" } },
    ] as const;
    const scene = (mark: object) => () =>
      build({ errorMode: "throw", marks: [mark as never] } as ChartConfig);
    for (const mark of [
      line(rows, { x: "x", y: "v", encode: { color } }),
      bar(rows, { x: "x", y: "v", encode: { color } }),
      point(rows, { x: "x", y: "v", color }),
      custom(rows, {
        x: "x",
        y: "v",
        encode: { color },
        draw({ series, encoded }) {
          for (const s of series) for (let k = 0; k < s.length; k++) encoded("color", s.rowAt(k));
        },
      }),
    ])
      expect(scene(mark), mark.spec.type).toThrow(/color\[1\]\.field/);
  });

  it("refuse a missing field in a points' size or opacity list at its entry", () => {
    const rows = table({ x: [0, 1], v: [1, 2] });
    for (const given of [{ size: [{ field: "zz" }] }, { fillOpacity: [{ field: "zz" }] }])
      expect(() =>
        build({ marks: [point(rows, { x: "x", y: "v", ...(given as object) })] }),
      ).toThrow(/\[0\]\.field: no field "zz"; the table has "x", "v"/);
  });

  it("key a listed region's outline list", () => {
    const spans = table({ a: [0, 2], b: [1, 3], kind: ["m", "n"], name: ["first", "second"] });
    const { scene } = build({
      scales: { ks: { type: "ordinal", map: { m: GREEN, n: BLUE } } },
      marks: [
        region(spans, {
          x1: "a",
          x2: "b",
          label: { field: "name" },
          legend: true,
          strokeWidth: 2,
          encode: { stroke: [{ field: "kind", scale: "ks" }] },
        }),
      ],
    });
    expect(keysOf(scene).map((key) => key.title.text)).toEqual(["kind"]);
  });

  it("key display colors a custom mark's list reads", () => {
    const rows = table({ x: [0, 1], v: [100, 600], s: ["m", "n"] });
    const { scene } = build({
      fields: { v: { thresholds: { base: GREEN, steps: [{ value: 500, color: RED }] } } },
      marks: [
        custom(rows, {
          x: "x",
          y: "v",
          series: "s",
          encode: { color: [{ field: "v" }] },
          draw() {},
        }),
      ],
    });
    expect(keysOf(scene).length + legendOf(scene).length).toBeGreaterThan(0);
    expect(JSON.stringify(scene.guides)).toContain(RED);
  });

  it("give custom marks' widths and opacities numbers where a list ends in the series field", () => {
    const wide = table({ t: [0, 1], v: [1, 2], site: ["A", "B"] });
    const read: (number | undefined)[] = [];
    build({
      scales: { alpha: { type: "ordinal", map: { A: 0.5, B: 0.25 } } },
      marks: [
        custom(wide, {
          x: "t",
          y: "v",
          series: "site",
          encode: {
            opacity: [
              { condition: { when: col("v").gt(5), then: 1 } },
              { field: "site", scale: "alpha" },
            ],
          },
          draw({ series, encoded }) {
            for (const s of series) read.push(encoded("opacity", s.rowAt(0), s));
          },
        }),
      ],
    });
    expect(read).toEqual([0.5, 0.25]);
  });

  it("take an output of 0 from a list's entry, as any other", () => {
    const rows = table({ t: [0, 1], v: [1, 2] });
    const read: (number | undefined)[] = [];
    build({
      marks: [
        custom(rows, {
          x: "t",
          y: "v",
          encode: {
            opacity: [{ condition: { when: col("v").gt(1), then: 0 } }, { value: 0.5 }],
          },
          draw({ series, encoded }) {
            for (const s of series)
              for (let k = 0; k < 2; k++) read.push(encoded("opacity", s.rowAt(k), s));
          },
        }),
      ],
    });
    expect(read).toEqual([0.5, 0]);
  });

  it("refuse points' sizes and shapes by the series' names in a list too", () => {
    expect(() =>
      build({
        scales: { s: { type: "ordinal" } },
        marks: [
          point(services, {
            x: "p99",
            y: "errors",
            series: "tier",
            size: [
              { condition: { when: col("p99").gt(5), then: 40 } },
              { series: true, scale: "s" } as never,
            ],
          }),
        ],
      }),
    ).toThrow(
      "point (mark 0) size[1]: { series: true } names series through a scale, which points' sizes and opacities do not read; give a field",
    );
  });
});

describe("rank tests", () => {
  const ranked = (data: object, when: object, mark = "bar") =>
    build({
      marks: [
        mark === "bar"
          ? bar(
              data as never,
              { x: "k", y: "v", encode: { color: { condition: { when, then: RED } } } } as never,
            )
          : line(
              data as never,
              { x: "k", y: "v", encode: { color: { condition: { when, then: RED } } } } as never,
            ),
      ],
    });

  contractTest(
    "channel.rank.ties",
    () => {
      const values = table({
        k: ["a", "b", "c", "d", "e", "f"],
        v: [3, Number.NaN, 8, Number.POSITIVE_INFINITY, 8, 1],
      });
      // Bars are drawn where their value is finite: a, c, e, f.
      expect(barFills(ranked(values, { top: 1, field: "v" }).scene)).toEqual([
        LIGHT.muted,
        RED,
        RED,
        LIGHT.muted,
      ]);
      expect(barFills(ranked(values, { bottom: 2, field: "v" }).scene)).toEqual([
        RED,
        LIGHT.muted,
        LIGHT.muted,
        RED,
      ]);
      // More than there are finite values: every finite one.
      expect(barFills(ranked(values, { top: 10, field: "v" }).scene)).toEqual([RED, RED, RED, RED]);
    },
    "hold for the n largest or smallest, ties with the nth in, missing and infinite values out",
  );

  it("rank times, and refuse categories and counts below one", () => {
    const times = table({
      k: ["a", "b", "c"],
      v: [1, 2, 3],
      at: [new Date(5), new Date(1), new Date(9)],
    });
    const scene = build({
      marks: [
        bar(times, {
          x: "k",
          y: "v",
          encode: { color: { condition: { when: { top: 1, field: "at" }, then: RED } } },
        }),
      ],
    }).scene;
    expect(barFills(scene)).toEqual([LIGHT.muted, LIGHT.muted, RED]);
    expect(() => ranked(times, { top: 1, field: "k" })).toThrow(
      'bar (mark 0) encode.color.condition.when.field: field "k" holds categories; ranks are of numbers and times',
    );
    expect(() => ranked(times, { top: 1.5, field: "v" })).toThrow(
      "bar (mark 0) encode.color.condition.when.top: expected a whole number of rows from 1; received 1.5",
    );
    expect(() => ranked(times, { field: "v" })).toThrow(
      'bar (mark 0) encode.color.condition.when: expected an expression, or a rank test ({ top, field } or { bottom, field }); received {"field":"v"}',
    );
  });

  it("rank a view's rows, and every row again once the view shows them all", () => {
    const values = table({ k: ["a", "b", "c"], v: [1, 2, 10] });
    const view = rowView(values, { filter: col("v").lt(5) });
    const { model } = ranked(view, { top: 1, field: "v" });
    const fills = () => barFills(model.scene(estimateText));
    expect(fills()).toEqual([LIGHT.muted, RED]);
    view.setQuery({});
    expect(fills()).toEqual([LIGHT.muted, LIGHT.muted, RED]);
  });

  contractTest(
    "channel.rank.streaming",
    () => {
      const stream = table({ k: [0, 1, 2], v: [1, 5, 2] });
      const { model } = ranked(stream, { top: 1, field: "v" }, "line");
      // A piece of line takes the look of the observation it arrives at.
      const colors = () => strokes(model.scene(estimateText)).map(([, stroke]) => stroke);
      expect(colors()).toEqual([RED, LIGHT.muted]);
      // A larger value appended takes the top from rows already drawn.
      stream.append({ k: [3], v: [9] });
      expect(colors()).toEqual([LIGHT.muted, RED]);
      stream.append({ k: [4], v: [2] });
      expect(colors()).toEqual([LIGHT.muted, RED, LIGHT.muted]);
      // Rows dropped that are not the top keep it.
      stream.dropFirst(3);
      stream.append({ k: [5], v: [7] });
      expect(colors()).toEqual([LIGHT.muted]);
      // Dropping the top row ranks the rest again.
      stream.dropFirst(1);
      expect(colors()).toEqual([RED]);
      stream.reset({ k: [0, 1, 2], v: [4, 6, 1] });
      expect(colors()).toEqual([RED, LIGHT.muted]);
    },
    "follow appends, drops, and resets while streaming",
  );

  it("follow bars' rows as they stream", () => {
    const stream = table({ k: ["a", "b"], v: [5, 1] });
    const { model } = ranked(stream, { top: 1, field: "v" });
    const fills = () => barFills(model.scene(estimateText));
    expect(fills()).toEqual([RED, LIGHT.muted]);
    stream.append({ k: ["c"], v: [7] });
    expect(fills()).toEqual([LIGHT.muted, LIGHT.muted, RED]);
    stream.dropFirst(1);
    stream.append({ k: ["d"], v: [7] });
    // Ties with the nth are in.
    expect(fills()).toEqual([LIGHT.muted, RED, RED]);
  });
});

describe("lists and ranks in static output", () => {
  const options = () => ({
    width: 600,
    height: 300,
    marks: [
      bar(services, {
        x: "service",
        y: "p99",
        encode: {
          color: [
            { condition: { when: { top: 2, field: "p99" }, then: RED } },
            { condition: { when: col("errors").gt(0.05), then: AMBER } },
            { value: GREY },
          ],
        },
      }),
    ],
  });

  /** How many bars each color fills in SVG: one path per fill, a subpath per bar. */
  function svgBars(svg: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [, d, fill] of svg.matchAll(/<path d="([^"]*)" fill="(#[0-9a-f]{6})"/g))
      if ([RED, AMBER, GREY].includes(fill!))
        counts[fill!] = (counts[fill!] ?? 0) + (d!.match(/M/g) ?? []).length;
    return counts;
  }

  /** How many bars each color fills in a PDF: one path per fill, a subpath (a move) per bar. */
  function pdfBars(pdf: Uint8Array): Record<string, number> {
    const text = Buffer.from(pdf).toString("latin1");
    let content = "";
    for (const match of text.matchAll(/\/FlateDecode \/Length (\d+) >>\nstream\n/g)) {
      const at = match.index + match[0].length;
      content += inflateSync(Buffer.from(text.slice(at, at + Number(match[1])), "latin1")).toString(
        "latin1",
      );
    }
    const pdfColor = (hex: string) =>
      [1, 3, 5]
        .map((i) => Number((Number.parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)))
        .join(" ");
    const counts: Record<string, number> = {};
    for (const color of [RED, AMBER, GREY])
      for (const [, path] of content.matchAll(
        new RegExp(`q ${pdfColor(color)} rg\n([^Q]*?)f\nQ`, "g"),
      ))
        counts[color] = (counts[color] ?? 0) + (path!.match(/ m\n/g) ?? []).length;
    return counts;
  }

  contractTest(
    "channel.list.pdf",
    () => {
      const expected = { [GREY]: 2, [RED]: 2, [AMBER]: 1 };
      expect(svgBars(renderToSVG(options()))).toEqual(expected);
      expect(pdfBars(renderToPDF(options()))).toEqual(expected);
    },
    "draw each bar's first output in SVG and PDF alike",
  );
});
