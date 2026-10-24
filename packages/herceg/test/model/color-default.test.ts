// The chart's default color sharing (model/identity.ts): a category field of
// one name is one mapping in a chart, its values' places following every
// table reading it in the order marks read them; named scales join or keep
// apart on purpose, and a scale of each panel's own maps values per subplot.
// Tables of value fields are named simply by the chart, or by the feature
// compiler, alike.
import { describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { grid } from "../../src/layout.ts";
import { area } from "../../src/marks/area.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { identityKey } from "../../src/model/identity.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type { LineGeometry, PointGeometry, Scene } from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";

function build(config: ChartConfig, compilers = true) {
  const [guides, features] = compilers ? staticCompilers() : [];
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    guides,
    features,
  );
  model.setSize(600, 300, 1);
  return model;
}

const strokes = (scene: Scene, panel = 0) =>
  scene.panels[panel]!.marks.filter((m) => m.kind === "line").map(
    (m) => (m as LineGeometry).stroke,
  );
const entries = (model: ChartModel) =>
  model.legendEntries().map(({ key, label, color }) => ({ key, label, color }));

describe("the default color mapping", () => {
  contractTest(
    "color.default.field-name",
    () => {
      // Model curves and observations, from two tables, both by site.
      const curves = table({ t: [0, 1, 0, 1], v: [1, 2, 3, 4], site: ["A", "A", "B", "B"] });
      const points = table({ t: [0, 1, 2], v: [1, 3, 5], site: ["B", "C", "A"] });
      const model = build({
        panels: panels([{ id: "fit" }, { id: "raw" }], grid({ columns: 2 })),
        y: { scope: "panel" },
        marks: [
          line(curves, { x: "t", y: "v", series: "site", panel: "fit" }),
          point(points, { x: "t", y: "v", color: "site", panel: "raw" }),
        ],
      });
      const scene = model.scene(estimateText);
      // One entry per site, the first table's dictionary first, then the second's new values.
      expect(entries(model).map(({ key }) => key)).toEqual(
        ["A", "B", "C"].map((v) => identityKey({ field: "site" }, v)),
      );
      const [a, b] = strokes(scene, 0);
      const fills = (scene.panels[1]!.marks as PointGeometry[]).map(({ fill }) => fill);
      // Points of B and A take the lines' colors, whatever their own table's order.
      expect(fills).toContain(a);
      expect(fills).toContain(b);
      expect(new Set(entries(model).map(({ color }) => color)).size).toBe(3);
    },
    "a field of one name colors its values alike across tables and panels",
  );

  contractTest(
    "color.default.names-apart",
    () => {
      const one = table({ t: [0, 1], v: [1, 2], site: ["A", "B"] });
      const two = table({ t: [0, 1], v: [3, 4], kind: ["A", "B"] });
      const model = build({
        marks: [
          line(one, { x: "t", y: "v", series: "site" }),
          line(two, { x: "t", y: "v", series: "kind" }),
        ],
      });
      const scene = model.scene(estimateText);
      expect(entries(model).map(({ key }) => key)).toEqual([
        identityKey({ field: "site" }, "A"),
        identityKey({ field: "site" }, "B"),
        identityKey({ field: "kind" }, "A"),
        identityKey({ field: "kind" }, "B"),
      ]);
      expect(new Set(strokes(scene)).size).toBe(4);
    },
    "fields of different names keep their own values apart",
  );

  contractTest(
    "color.default.scale-joins",
    () => {
      const one = table({ t: [0, 1], v: [1, 2], site: ["A", "B"] });
      const two = table({ t: [0, 1], v: [3, 4], plant: ["B", "A"] });
      const model = build({
        scales: { sites: { type: "ordinal" } },
        marks: [
          line(one, {
            x: "t",
            y: "v",
            series: "site",
            encode: { color: { field: "site", scale: "sites" } },
          }),
          line(two, {
            x: "t",
            y: "v",
            series: "plant",
            encode: { color: { field: "plant", scale: "sites" } },
          }),
        ],
      });
      const scene = model.scene(estimateText);
      expect(entries(model).map(({ key }) => key)).toEqual([
        identityKey({ scale: "sites" }, "A"),
        identityKey({ scale: "sites" }, "B"),
      ]);
      const [a, b, b2, a2] = strokes(scene);
      expect([a2, b2]).toEqual([a, b]);
    },
    "one named scale joins fields of different names",
  );
});

describe("scales of each panel's own", () => {
  const north = table({ t: [0, 1], v: [1, 2], region: ["us", "us"] }) as unknown as typeof all;
  const all = table({ t: [0, 1, 2], v: [1, 2, 3], region: ["eu", "us", "eu"] });
  const subplot = (data: typeof all, panel: string) =>
    line(data, {
      x: "t",
      y: "v",
      series: "region",
      encode: { color: { field: "region", scale: "regions" } },
      panel,
    });

  contractTest(
    "scale.ordinal.scope.panel",
    () => {
      const model = build({
        scales: { regions: { type: "ordinal", scope: "panel" } },
        panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 2 })),
        marks: [subplot(north, "a"), subplot(all, "b")],
      });
      const scene = model.scene(estimateText);
      // Each panel's values take the palette from its first: "us" first in a, second in b.
      const [us] = strokes(scene, 0);
      const [eu, usInB] = strokes(scene, 1);
      expect(us).toBe(eu);
      expect(usInB).not.toBe(us);
      expect(entries(model).map(({ key }) => key)).toEqual([
        identityKey({ scale: "regions", panel: "a" }, "us"),
        identityKey({ scale: "regions", panel: "b" }, "eu"),
        identityKey({ scale: "regions", panel: "b" }, "us"),
      ]);
      // Hiding a value in one panel leaves the other's alone.
      model.hidden.add(identityKey({ scale: "regions", panel: "a" }, "us"));
      const hidden = model.scene(estimateText);
      expect(strokes(hidden, 0)).toEqual([]);
      expect(strokes(hidden, 1)).toHaveLength(2);
    },
    "a scale of each panel's own maps values per subplot",
  );

  contractTest(
    "scale.ordinal.scope.refused",
    () => {
      const scales = { regions: { type: "ordinal", scope: "panel" } } as const;
      expect(() =>
        build({
          scales,
          panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 2 })),
          marks: [subplot(all, "*")],
        }),
      ).toThrow(
        'chart scales.regions.scope: "panel" maps values in each subplot, and line (mark 0) encode.color.scale is drawn in every panel; draw it in one subplot, or drop scope',
      );
    },
    "marks of every panel cannot read a scale of each panel's own",
  );
});

describe("names of tables of value fields", () => {
  const rows = () => table({ t: [0, 1], v: [1, 2], lo: [0, 1], hi: [2, 3] });

  contractTest(
    "identity.table-names.simple",
    () => {
      // Tables without names: the chart names them by place, with no compiler.
      const data = rows();
      const one = build(
        {
          marks: [
            line(data, { x: "t", y: "v", label: "v" }),
            area(data, { x: "t", y1: "lo", y2: "hi", label: "v" }),
            line(rows(), { x: "t", y: "v" }),
          ],
        },
        false,
      );
      expect(one.lacks()).toEqual([false, false]);
      one.scene(estimateText);
      expect(entries(one).map(({ key }) => key)).toEqual([
        identityKey({ table: { mark: 0 } }, "v"),
        identityKey({ table: { mark: 2 } }, "v"),
      ]);
      // A table keeps its name from the configuration before as marks
      // before it go, and a new table in its old place takes the next: two
      // tables of one place, which the feature compiler names.
      const named = table({ t: [0, 1], lo: [0, 1] }, { name: "named" });
      const model = build(
        { marks: [line(named, { x: "t", y: "lo" }), line(data, { x: "t", y: "v" })] },
        false,
      );
      model.scene(estimateText);
      const v = entries(model)[1]!;
      expect(v.key).toBe(identityKey({ table: { mark: 1 } }, "v"));
      model.update({ marks: [line(data, { x: "t", y: "v" }), line(rows(), { x: "t", y: "v" })] });
      expect(model.lacks()).toEqual([false, true]);
      model.use(undefined, staticCompilers()[1]);
      model.scene(estimateText);
      expect(entries(model).map(({ key }) => key)).toEqual([
        v.key,
        identityKey({ table: { mark: 1, n: 1 } }, "v"),
      ]);
      expect(entries(model)[0]!.color).toBe(v.color);
      // Left out of a configuration, it is named anew when it comes back.
      model.update({ marks: [line(named, { x: "t", y: "lo" })] });
      model.update({ marks: [line(rows(), { x: "t", y: "v" }), line(data, { x: "t", y: "v" })] });
      model.scene(estimateText);
      expect(entries(model).map(({ key }) => key)).toEqual([
        identityKey({ table: { mark: 0 } }, "v"),
        identityKey({ table: { mark: 1 } }, "v"),
      ]);
      // Two tables of one name are refused.
      const same = (value: number) => table({ t: [0], v: [value] }, { name: "same" });
      expect(() =>
        build({ marks: [line(same(1), { x: "t", y: "v" }), line(same(2), { x: "t", y: "v" })] }),
      ).toThrow(/marks\[1\]: its table is named "same"/);
    },
    "charts name tables of value fields by their places, kept from one configuration to the next",
  );
});
