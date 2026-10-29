// Legends composed of what the chart's options name: annotations listed by
// their labels, entries of your own after the chart's, scales by name and
// marks whole, targets that hide marks whole or rows by value, legends
// stacked in the order the guides list them, and colorbars of maps.
import { describe, expect, it } from "vitest";
import { category } from "../../src/data/column.ts";
import { type FeatureCollection, fromGeoJSON } from "../../src/data/geojson.ts";
import { table } from "../../src/data/table.ts";
import { colorbar, legend } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { geoshape } from "../../src/marks/geoshape.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import {
  guidesOf,
  type LegendItem,
  type PointGeometry,
  type RectGeometry,
  type Scene,
  type TextItem,
} from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";

function build(config: ChartConfig, width = 640, height = 360) {
  const model = new ChartModel({ locale: "en-US", ...config }, undefined, ...staticCompilers());
  model.setSize(width, height, 1);
  return { model, scene: model.scene(estimateText) };
}

const entriesOf = (scene: Scene): LegendItem[] =>
  guidesOf(scene, "legend").flatMap((g) => [...g.entries]);
const labelsOf = (scene: Scene) => entriesOf(scene).map(({ label }) => label);
const captionsOf = (scene: Scene) =>
  guidesOf(scene, "caption").flatMap(({ items }) =>
    items.flatMap((item) => (item.type === "text" ? [(item as TextItem).text] : [])),
  );

const sales = table({
  t: [0, 1, 2, 0, 1, 2],
  v: [1, 2, 3, 2, 3, 4],
  region: ["eu", "eu", "eu", "us", "us", "us"],
});
const byRegion = line(sales, { x: "t", y: "v", series: "region", id: "sales" });

describe("legends of annotations", () => {
  contractTest(
    "annotation.legend.entries",
    () => {
      const { model, scene } = build({
        marks: [
          byRegion,
          rule({ y: 2.5, label: "SLO", legend: true }),
          region({ x1: 0.5, x2: 1.5, label: "Maintenance", legend: true, fill: "#ff0000" }),
          rule({ y: 1.5, label: "Unlisted" }),
        ],
      });
      // After the series, in the order the marks come: listed annotations only.
      expect(labelsOf(scene)).toEqual(["eu", "us", "SLO", "Maintenance"]);
      const [, , slo, maintenance] = entriesOf(scene);
      // Each a button hiding its annotation whole, by its place.
      expect(slo!.key).toBe('{"mark":1}');
      expect(maintenance!.key).toBe('{"mark":2}');
      // Swatches as they draw: a dashed rule, a faint red box.
      expect(slo!.sample!.items[0]).toMatchObject({ type: "segments" });
      expect(maintenance!.sample!.items[0]).toMatchObject({ type: "rect", fill: "#ff0000" });
      const zones = () =>
        model
          .scene(estimateText)
          .panels[0]!.marks.flatMap((m) => (m.kind === "rect" ? [(m as RectGeometry).count] : []));
      expect(zones()).toEqual([1]);
      model.hidden.add(maintenance!.key);
      expect(zones()).toEqual([0]);
      // A text annotation lists its own text.
      const noted = build({
        marks: [byRegion, text({ x: 1, y: 2, label: "Launch", legend: true })],
      });
      expect(labelsOf(noted.scene)).toEqual(["eu", "us", "Launch"]);
    },
    "annotations listed by their labels are legend entries that hide them whole",
  );

  it("refuse an annotation listed without a label", () => {
    expect(() => rule({ y: 1, legend: true })).toThrow(
      "rule legend: true lists the rule by its label; give it a label, or drop legend",
    );
  });

  it("show annotations even beside one series, which alone needs no legend", () => {
    const { scene } = build({
      marks: [line(sales, { x: "t", y: "v" }), rule({ y: 2.5, label: "SLO", legend: true })],
    });
    expect(labelsOf(scene)).toEqual(["v", "SLO"]);
  });
});

describe("legends composed", () => {
  contractTest(
    "legend.entries.append",
    () => {
      const { scene } = build({
        marks: [byRegion],
        legend: {
          entries: [
            { key: "target", label: "Target", swatch: { type: "line", stroke: "#000000" } },
            {
              key: "eu-only",
              label: "Europe",
              swatch: { type: "rect", fill: "#0000ff" },
              targets: [{ mark: "sales", field: "region", values: ["eu"] }],
            },
          ],
        },
      });
      // The chart's entries, then your own; one explaining, one toggling.
      expect(labelsOf(scene)).toEqual(["eu", "us", "Europe"]);
      expect(captionsOf(scene)).toEqual(["Target"]);
      expect(() =>
        build({
          marks: [byRegion],
          legend: {
            entries: [
              { key: "a", label: "A" },
              { key: "a", label: "B" },
            ],
          },
        }),
      ).toThrow('chart legend.entries[1].key: "a" is the key of another of the legend\'s entries');
    },
    "a legend's own entries come after the chart's, each with a key of its own",
  );

  contractTest(
    "legend.include.scale",
    () => {
      const north = table({ t: [0, 1], v: [1, 2], site: ["a", "a"] });
      const south = table({ t: [0, 1], v: [3, 4], site: ["b", "b"] });
      const other = table({ t: [0, 1], v: [5, 6], kind: ["x", "x"] });
      const { scene } = build({
        scales: { sites: { type: "ordinal" } },
        marks: [
          line(north, { x: "t", y: "v", encode: { color: { field: "site", scale: "sites" } } }),
          line(south, { x: "t", y: "v", encode: { color: { field: "site", scale: "sites" } } }),
          line(other, { x: "t", y: "v", series: "kind" }),
        ],
        legend: false,
        guides: [legend({ include: [{ scale: "sites" }] }), legend({ include: [] })],
      });
      // The sites, whichever tables hold them; not the other mark's kinds.
      expect(guidesOf(scene, "legend").map((g) => g.entries.map(({ label }) => label))).toEqual([
        ["a", "b"],
      ]);
      expect(() =>
        build({ marks: [byRegion], guides: [legend({ include: [{ scale: "nowhere" }] })] }),
      ).toThrow('chart guides[0].include[0].scale: the chart has no scale of categories "nowhere"');
    },
    "a legend lists the values of a scale it names, across marks",
  );

  it("list a scale's declared domain whole, in its order, whatever the marks draw now", () => {
    const penguins = () =>
      table({ x: [1, 2, 3], y: [1, 2, 3], species: ["Gentoo", "Chinstrap", "Gentoo"] });
    const domain = ["Adelie", "Chinstrap", "Gentoo"];
    const scales = { color: { type: "ordinal", domain } } as const;
    const species = (data: ReturnType<typeof penguins>) =>
      line(data, { x: "x", y: "y", series: "species", color: "species" });
    // Named, and in the automatic legend of every scale.
    for (const guides of [[legend({ include: [{ scale: "color" }] })], undefined]) {
      const data = penguins();
      const { scene, model } = build({ scales, marks: [species(data)], ...(guides && { guides }) });
      expect(labelsOf(scene)).toEqual(domain);
      // An entry of a value nothing draws yet is shown, in the scale's color for it.
      const [adelie, chinstrap] = entriesOf(scene);
      expect(adelie!.hidden).toBe(false);
      expect(adelie!.color).not.toBe(chinstrap!.color);
      // Hiding it hides the rows that bring the value later.
      model.hidden.add(adelie!.key);
      data.append({ x: [4], y: [4], species: ["Adelie"] });
      expect(entriesOf(model.scene(estimateText)).map(({ hidden }) => hidden)).toEqual([
        true,
        false,
        false,
      ]);
    }
    // A filter leaving no rows of a value keeps the key.
    const gentoo = table({ x: [1], y: [1], species: ["Gentoo"] });
    expect(labelsOf(build({ scales, marks: [species(gentoo)], legend: true }).scene)).toEqual(
      domain,
    );
    // Values drawn outside the domain (in its unknown color) follow it.
    const emperor = table({ x: [1, 2], y: [1, 2], species: ["Emperor", "Gentoo"] });
    expect(labelsOf(build({ scales, marks: [species(emperor)] }).scene)).toEqual([
      ...domain,
      "Emperor",
    ]);
    // A key of the colors rows take lists the domain too.
    const islands = table({
      x: [1, 2],
      y: [1, 2],
      species: ["Gentoo", "Gentoo"],
      island: ["a", "b"],
    });
    const key = guidesOf(
      build({
        scales,
        marks: [point(islands, { x: "x", y: "y", series: "island", color: "species" })],
      }).scene,
      "key",
    )[0]!;
    const written = key.items.flatMap((item) =>
      item.type === "text" ? [(item as TextItem).text] : [],
    );
    expect(written).toEqual(["species", ...domain]);
    // Without a declared domain, a scale lists the values its marks draw.
    const found = build({
      scales: { color: { type: "ordinal" } },
      marks: [species(gentoo)],
      legend: true,
    });
    expect(labelsOf(found.scene)).toEqual(["Gentoo"]);
  });

  it("list a declared domain where its marks are listed: none for marks left out, in panels' own legends", () => {
    const rows = table({ x: [1, 2], y: [1, 2], species: ["Chinstrap", "Chinstrap"] });
    const domain = ["Adelie", "Chinstrap", "Gentoo"];
    const species = (options: { legend?: false; panel?: string; id?: string } = {}) =>
      line(rows, { x: "x", y: "y", series: "species", color: "species", ...options });
    const scales = { color: { type: "ordinal", domain } } as const;
    const listed = (config: ChartConfig) =>
      guidesOf(build(config).scene, "legend").map(({ entries }) =>
        entries.map(({ label }) => label),
      );
    expect(listed({ scales, marks: [species({ legend: false })], legend: true })).toEqual([]);
    // A legend naming such a mark lists it whole.
    expect(
      listed({
        scales,
        marks: [species({ legend: false, id: "m" })],
        guides: [legend({ include: [{ mark: "m" }] })],
      }),
    ).toEqual([domain]);
    // A panel's own legend lists the domain its marks draw from, and the chart's leaves it.
    const subplots = panels([{ id: "a" }, { id: "b" }]);
    expect(
      listed({
        scales,
        marks: [species({ panel: "a" })],
        panels: subplots,
        guides: [legend({ panel: "a" })],
      }),
    ).toEqual([domain]);
    // Each panel's legend lists it whole, whatever other panels draw, and
    // whether its own marks draw rows or not.
    const of = (drawn: string[], panel: string) =>
      line(
        table({ x: drawn.map((_, i) => i), y: drawn.map((_, i) => i), species: category(drawn) }),
        {
          x: "x",
          y: "y",
          series: "species",
          color: "species",
          panel,
        },
      );
    expect(
      listed({
        scales,
        marks: [of(["Chinstrap"], "a"), of(["Gentoo"], "b"), of([], "c")],
        panels: panels([{ id: "a" }, { id: "b" }, { id: "c" }]),
        guides: ["a", "b", "c"].map((panel) => legend({ panel })),
      }),
    ).toEqual([domain, domain, domain]);
    // Every mark of a panel reading it owns it there, and a pie's slices list it too.
    const one = (drawn: string, id: string) =>
      line(table({ x: [1], y: [1], species: [drawn] }), {
        x: "x",
        y: "y",
        series: "species",
        color: "species",
        panel: "p",
        id,
      });
    expect(
      listed({
        scales,
        marks: [one("Chinstrap", "m1"), one("Chinstrap", "m2")],
        panels: panels([{ id: "p" }]),
        guides: [legend({ panel: "p", include: [{ mark: "m2" }] })],
      }),
    ).toEqual([domain]);
    const slices = table({ species: ["Chinstrap"], n: [3] });
    expect(
      listed({
        scales,
        marks: [pie(slices, { category: "species", value: "n", panel: "p" })],
        panels: panels([{ id: "p" }]),
        guides: [legend({ panel: "p", include: [{ scale: "color" }] })],
      }),
    ).toEqual([domain]);
    // A legend naming the mark lists it, and no other legend does.
    expect(
      listed({
        scales,
        marks: [species({ id: "m" })],
        guides: [legend({ include: [{ mark: "m" }] })],
      }),
    ).toEqual([domain]);
    // A scale of each subplot lists its domain in each.
    const each = { color: { type: "ordinal", domain, scope: "panel" } } as const;
    expect(
      listed({ scales: each, marks: [species({ panel: "a" })], panels: subplots, legend: true }),
    ).toEqual([domain]);
  });

  contractTest(
    "legend.include.mark",
    () => {
      const hidden = line(sales, {
        x: "t",
        y: "v",
        series: "region",
        id: "quiet",
        legend: false,
      });
      const { scene } = build({
        marks: [hidden, rule({ y: 2, label: "Floor", id: "floor" })],
        guides: [legend({ include: [{ mark: "quiet" }, { mark: "floor" }] })],
      });
      // Named whole, a mark left out of legends shows in this one, and an annotation by its label.
      expect(guidesOf(scene, "legend").map((g) => g.entries.map(({ label }) => label))).toEqual([
        ["eu", "us", "Floor"],
      ]);
      expect(() =>
        build({
          marks: [byRegion, rule({ y: 2, id: "bare" })],
          guides: [legend({ include: [{ mark: "bare" }] })],
        }),
      ).toThrow('mark "bare" is an annotation without a label');
    },
    "a legend lists a mark it names whole, whatever its own legend setting",
  );
});

describe("targets", () => {
  contractTest(
    "legend.targets.rows",
    () => {
      const rows = table({ t: [0, 1, 2, 3], v: [1, 2, 3, 4], kind: ["a", "b", "a", "b"] });
      const { model } = build({
        marks: [point(rows, { x: "t", y: "v", id: "p" })],
        legend: {
          entries: [
            {
              key: "only-b",
              label: "Hide a",
              targets: [{ mark: "p", field: "kind", values: ["a"] }],
            },
          ],
        },
      });
      const drawn = () =>
        model
          .scene(estimateText)
          .panels[0]!.marks.filter((m): m is PointGeometry => m.kind === "point")
          .reduce((sum, g) => sum + g.count, 0);
      expect(drawn()).toBe(4);
      const entry = entriesOf(model.scene(estimateText)).find(({ label }) => label === "Hide a")!;
      expect(entry.targets).toEqual(['{"mark":"p","field":"kind","equals":"a"}']);
      model.hidden.add(entry.targets![0]!);
      expect(drawn()).toBe(2);
      // Bars side by side hide rows too; stacked, their series.
      const bars = build({
        marks: [bar(rows, { x: "t", y: "v", id: "b" })],
        legend: {
          entries: [
            { key: "k", label: "a", targets: [{ mark: "b", field: "kind", values: ["a"] }] },
          ],
        },
      });
      const rects = () =>
        bars.model
          .scene(estimateText)
          .panels[0]!.marks.flatMap((m) => (m.kind === "rect" ? [(m as RectGeometry).count] : []))
          .reduce((sum, count) => sum + count, 0);
      expect(rects()).toBe(4);
      bars.model.hidden.add('{"mark":"b","field":"kind","equals":"a"}');
      expect(rects()).toBe(2);
      expect(() =>
        build({
          marks: [bar(rows, { x: "t", y: "v", series: "kind", stack: true, id: "s" })],
          legend: {
            entries: [
              { key: "k", label: "t", targets: [{ mark: "s", field: "t", values: ["0"] }] },
            ],
          },
        }),
      ).toThrow('bar "s" stacks its bars by series');
    },
    "a legend entry hides the rows of a mark whose field holds its values",
  );

  it("hide series by their field's values, and a scale's values in every mark", () => {
    const { model } = build({
      marks: [byRegion],
      legend: {
        include: [],
        entries: [
          { key: "eu", label: "EU", targets: [{ mark: "sales", field: "region", values: ["eu"] }] },
        ],
      },
    });
    const [eu] = entriesOf(model.scene(estimateText));
    // A series field's values are its series.
    const series = model.series().find(({ label }) => label === "eu")!;
    expect(eu!.targets ?? [eu!.key]).toEqual([series.key]);
    const scaled = build({
      scales: { regions: { type: "ordinal" } },
      marks: [
        line(sales, { x: "t", y: "v", encode: { color: { field: "region", scale: "regions" } } }),
      ],
      legend: {
        include: [],
        entries: [{ key: "us", label: "US", targets: [{ scale: "regions", values: ["us"] }] }],
      },
    });
    const [us] = entriesOf(scaled.scene);
    expect(us!.targets).toEqual(['{"scale":"regions","value":"us"}']);
  });
});

describe("legends listed in guides", () => {
  contractTest(
    "legend.stack.order",
    () => {
      const { scene } = build({
        marks: [byRegion, rule({ y: 2, label: "Floor", id: "floor" })],
        legend: false,
        guides: [
          legend({ include: [{ mark: "sales" }], place: { side: "top" } }),
          legend({ include: [{ mark: "floor" }], place: { side: "top" } }),
        ],
      });
      const [first, second] = guidesOf(scene, "legend");
      // Listed first, nearest the plot: below the second on top.
      expect(first!.entries[0]!.y).toBeGreaterThan(second!.entries[0]!.y);
      const below = build({
        marks: [byRegion, rule({ y: 2, label: "Floor", id: "floor" })],
        legend: false,
        guides: [
          legend({ include: [{ mark: "sales" }], place: { side: "bottom" } }),
          legend({ include: [{ mark: "floor" }], place: { side: "bottom" } }),
        ],
      });
      const [near, far] = guidesOf(below.scene, "legend");
      expect(near!.entries[0]!.y).toBeLessThan(far!.entries[0]!.y);
    },
    "legends the guides list stack nearest the plots in the order listed",
  );
});

/** Two square regions, the second without a value. */
const squares = (): FeatureCollection => ({
  type: "FeatureCollection",
  features: [
    ["Ada", 10, 0],
    ["Bel", null, 10],
  ].map(([name, gdp, x]) => ({
    type: "Feature" as const,
    properties: { name, gdp },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [x as number, 0],
          [(x as number) + 10, 0],
          [(x as number) + 10, 10],
          [x as number, 10],
          [x as number, 0],
        ],
      ],
    },
  })),
});

describe("colorbars of maps", () => {
  it("show a map's color ramp named by its id, and wait for a map of no values", () => {
    const { scene } = build({
      projection: "equirectangular",
      marks: [geoshape(fromGeoJSON(squares()), { color: "gdp", id: "map" })],
      guides: [colorbar({ scale: { mark: "map", channel: "color" } })],
    });
    expect(guidesOf(scene, "colorbar")).toHaveLength(1);
    // A map whose regions have no values yet: its colorbar waits for some.
    const none = squares();
    for (const feature of none.features) feature.properties!.gdp = null;
    const empty = build({
      projection: "equirectangular",
      marks: [geoshape(fromGeoJSON(none), { color: "gdp" })],
      guides: [colorbar()],
    });
    expect(guidesOf(empty.scene, "colorbar")).toHaveLength(0);
  });
});

describe("targets as values", () => {
  const pointsOf = (model: ChartModel) =>
    model
      .scene(estimateText)
      .panels[0]!.marks.filter((m): m is PointGeometry => m.kind === "point")
      .reduce((sum, g) => sum + g.count, 0);

  it("hide the rows of marks reading a scale through a field of their own", () => {
    const rows = table({ t: [0, 1, 2, 3], v: [1, 2, 3, 4], kind: ["a", "b", "a", "b"] });
    for (const channel of ["color", "symbol"] as const) {
      const { model } = build({
        scales: { cats: { type: "ordinal" } },
        marks: [
          point(rows, {
            x: "t",
            y: "v",
            series: false,
            encode: { [channel]: { field: "kind", scale: "cats" } },
          }),
        ],
        legend: {
          entries: [{ key: "a", label: "A", targets: [{ scale: "cats", values: ["a"] }] }],
        },
      });
      const entry = entriesOf(model.scene(estimateText)).find(({ key }) => key === "a")!;
      for (const key of entry.targets!) model.hidden.add(key);
      expect(pointsOf(model), channel).toBe(2);
    }
  });

  it("hide what marks split by the field a scale reads, where the series stand for that field", () => {
    const rows = table({ t: [0, 1, 2, 3], v: [1, 2, 3, 4], kind: ["a", "b", "a", "b"] });
    for (const channel of ["symbol", "size", "opacity"] as const) {
      const { model } = build({
        scales: {
          cats: { type: "ordinal", ...(channel !== "symbol" && { map: { a: 0.5, b: 1 } }) },
        },
        marks: [
          point(rows, {
            x: "t",
            y: "v",
            series: "kind",
            encode: { [channel]: { field: "kind", scale: "cats" } },
          }),
        ],
        legend: {
          entries: [{ key: "x", label: "A", targets: [{ scale: "cats", values: ["a"] }] }],
        },
      });
      const entry = entriesOf(model.scene(estimateText)).find(({ key }) => key === "x")!;
      for (const key of entry.targets!) model.hidden.add(key);
      expect(pointsOf(model), channel).toBe(2);
    }
  });

  it("keep hiding what they name as the marks gain series", () => {
    const rows = table({ t: [0, 1], v: [1, 2], kind: ["a", "a"] }, { maxRows: 10 });
    const { model } = build({
      marks: [point(rows, { x: "t", y: "v", series: "kind", id: "p" })],
      legend: {
        include: [],
        entries: [
          {
            key: "ab",
            label: "A and B",
            targets: [{ mark: "p", field: "kind", values: ["a", "b"] }],
          },
          { key: "all", label: "All", targets: [{ mark: "p" }] },
        ],
      },
    });
    const [ab, all] = entriesOf(model.scene(estimateText));
    for (const key of ab!.targets!) model.hidden.add(key);
    rows.append({ t: [2, 3], v: [3, 4], kind: ["b", "c"] });
    // "b" came after the entry hid its values; "c" it never named.
    expect(pointsOf(model)).toBe(1);
    model.hidden.clear();
    for (const key of all!.targets!) model.hidden.add(key);
    rows.append({ t: [4], v: [5], kind: ["d"] });
    expect(pointsOf(model)).toBe(0);
    expect(entriesOf(model.scene(estimateText)).find(({ key }) => key === "all")!.hidden).toBe(
      true,
    );
  });

  it("show entries as what they name is drawn, and show all of it when shown", () => {
    const rows = table({ t: [0, 1, 2, 3], v: [1, 2, 3, 4], kind: ["a", "b", "a", "b"] });
    const { model } = build({
      marks: [point(rows, { x: "t", y: "v", series: "kind", id: "p" })],
      legend: { entries: [{ key: "all", label: "All", targets: [{ mark: "p" }] }] },
    });
    model.hidden.add('{"mark":"p"}');
    const entries = entriesOf(model.scene(estimateText));
    expect(entries.map(({ label, hidden }) => [label, hidden])).toEqual([
      ["a", true],
      ["b", true],
      ["All", true],
    ]);
    // Showing a series' entry lets go of the mark hidden whole, as the
    // legend's button does: the series is drawn.
    const a = entries.find(({ label }) => label === "a")!;
    expect(a.shows).toEqual([a.key, '{"mark":"p"}']);
    for (const key of a.shows!) model.hidden.delete(key);
    expect(pointsOf(model)).toBe(4);
    // A predicate hiding rows of a series leaves its entry shown in part.
    model.hidden.add(JSON.stringify({ mark: "p", field: "t", equals: "0" }));
    const mixed = entriesOf(model.scene(estimateText)).find(({ label }) => label === "a")!;
    expect([mixed.hidden, mixed.mixed]).toEqual([false, true]);
    expect(mixed.shows).toContain('{"mark":"p","field":"t","equals":"0"}');
  });

  it("show a series hidden as all of its rows are, by predicates of other fields", () => {
    const rows = table({ t: [0, 1, 2, 3], v: [1, 2, 3, 4], kind: ["a", "b", "a", "b"] });
    const { model } = build({ marks: [point(rows, { x: "t", y: "v", series: "kind", id: "p" })] });
    for (const t of ["0", "2"])
      model.hidden.add(JSON.stringify({ mark: "p", field: "t", equals: t }));
    const a = entriesOf(model.scene(estimateText)).find(({ label }) => label === "a")!;
    expect([a.hidden, a.mixed]).toEqual([true, undefined]);
    expect(pointsOf(model)).toBe(2);
  });

  it("restore all a mark's entry names, and of rows' entries the rows other predicates hid", () => {
    const rows = table({ t: [0, 1, 2, 3], v: [1, 2, 3, 4], kind: ["a", "b", "a", "b"] });
    const { model } = build({
      marks: [point(rows, { x: "t", y: "v", series: "kind", id: "p" })],
      legend: {
        entries: [
          { key: "all", label: "All", targets: [{ mark: "p" }] },
          { key: "a", label: "Rows a", targets: [{ mark: "p", field: "kind", values: ["a"] }] },
          { key: "zero", label: "At 0", targets: [{ mark: "p", field: "t", values: ["0"] }] },
        ],
      },
    });
    const entry = (key: string) => entriesOf(model.scene(estimateText)).find((e) => e.key === key)!;
    // Its series' entry hidden, then the mark whole: showing the mark shows both series.
    const a = model.series().find((s) => s.label === "a")!;
    model.hidden.add(a.entry ?? a.key);
    model.hidden.add('{"mark":"p"}');
    for (const key of entry("all").shows!) model.hidden.delete(key);
    expect(pointsOf(model)).toBe(4);
    expect(entry("all").hidden).toBe(false);
    // Rows of "a", and the row at 0 (one of them): showing "a" shows both of its rows.
    for (const key of [...entry("a").targets!, ...entry("zero").targets!]) model.hidden.add(key);
    for (const key of entry("a").shows!) model.hidden.delete(key);
    expect(pointsOf(model)).toBe(4);
    expect([entry("a").hidden, entry("a").mixed]).toEqual([false, undefined]);
  });

  it("give a scale's values no say in what its readers hide by rows", () => {
    const rows = table({ t: [0, 1, 2, 3], v: [1, 2, 3, 4], kind: ["a", "b", "a", "b"] });
    const { model } = build({
      scales: { cats: { type: "ordinal" } },
      marks: [
        point(rows, {
          x: "t",
          y: "v",
          series: false,
          id: "p",
          encode: { symbol: { field: "kind", scale: "cats" } },
        }),
      ],
      legend: {
        include: [],
        entries: [
          { key: "scale", label: "By scale", targets: [{ scale: "cats", values: ["a"] }] },
          { key: "rows", label: "By rows", targets: [{ mark: "p", field: "kind", values: ["a"] }] },
        ],
      },
    });
    const entry = (key: string) => entriesOf(model.scene(estimateText)).find((e) => e.key === key)!;
    for (const key of entry("rows").targets!) model.hidden.add(key);
    // The scale's own key names nothing drawn; the rows it names are hidden.
    expect([entry("scale").hidden, entry("scale").mixed]).toEqual([true, undefined]);
  });

  it("let go of a mark hidden whole where an entry names its rows twice over", () => {
    const rows = table({ t: [0, 1, 2, 3], v: [1, 2, 3, 4], kind: ["a", "b", "a", "b"] });
    const { model } = build({
      scales: { cats: { type: "ordinal" } },
      marks: [
        point(rows, {
          x: "t",
          y: "v",
          series: false,
          id: "p",
          encode: { symbol: { field: "kind", scale: "cats" } },
        }),
      ],
      legend: {
        include: [],
        entries: [
          {
            key: "a",
            label: "A",
            targets: [
              { scale: "cats", values: ["a"] },
              { mark: "p", field: "kind", values: ["a"] },
            ],
          },
        ],
      },
    });
    model.hidden.add('{"mark":"p"}');
    const [entry] = entriesOf(model.scene(estimateText));
    expect(entry!.shows).toContain('{"mark":"p"}');
    for (const key of entry!.shows!) model.hidden.delete(key);
    expect(pointsOf(model)).toBe(4);
  });

  it("hide the series of a scale other than the one they stand for", () => {
    const rows = table({ t: [0, 1, 2, 3], v: [1, 2, 3, 4], kind: ["a", "b", "a", "b"] });
    const { model } = build({
      scales: {
        first: { type: "ordinal", map: { a: "#111111", b: "#222222" } },
        second: { type: "ordinal", map: { a: "#ff0000", b: "#0000ff" } },
      },
      marks: [
        area(rows, {
          x: "t",
          y: "v",
          series: "kind",
          id: "p",
          encode: {
            fill: { field: "kind", scale: "first" },
            stroke: { field: "kind", scale: "second" },
          },
        }),
      ],
      legend: {
        include: [],
        entries: [{ key: "A", label: "A", targets: [{ scale: "second", values: ["a"] }] }],
      },
    });
    const [entry] = entriesOf(model.scene(estimateText));
    for (const key of entry!.targets!) model.hidden.add(key);
    const areas = model.scene(estimateText).panels[0]!.marks.filter((g) => g.kind === "area");
    expect(areas.map((g) => g.key)).toEqual(['["p","b"]']);
    expect(entriesOf(model.scene(estimateText))[0]!.hidden).toBe(true);
  });

  it("hide a mark whole whatever its id", () => {
    const rows = table({ t: [0, 1, 2, 3], v: [1, 2, 3, 4], kind: ["a", "b", "a", "b"] });
    const { model } = build({
      marks: [point(rows, { x: "t", y: "v", series: "kind", id: "field" })],
      legend: { entries: [{ key: "all", label: "All", targets: [{ mark: "field" }] }] },
    });
    model.hidden.add('{"mark":"field"}');
    expect(pointsOf(model)).toBe(0);
    expect(entriesOf(model.scene(estimateText)).map(({ hidden }) => hidden)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("read no rows for entries where hidden values are none of a category's", () => {
    const n = 1000;
    const rows = table({
      t: Float64Array.from({ length: n }, (_, i) => i),
      v: Float64Array.from({ length: n }, (_, i) => i % 7),
      kind: Array.from({ length: n }, () => "current"),
    });
    const { model } = build({
      marks: [point(rows, { x: "t", y: "v", series: false, id: "p" })],
      legend: { columns: 1 },
    });
    for (let i = 0; i < 50; i++)
      model.hidden.add(JSON.stringify({ mark: "p", field: "kind", equals: `gone-${i}` }));
    let reads = 0;
    const value = rows.value.bind(rows);
    rows.value = ((field: never, row: number) => {
      reads++;
      return value(field, row);
    }) as typeof rows.value;
    model.scene(estimateText);
    expect(reads).toBe(0);
  });

  it("read a mark's rows once for an entry naming many of a field's values", () => {
    const n = 1000;
    const rows = table({
      x: Float64Array.from({ length: n }, (_, i) => i),
      y: Float64Array.from({ length: n }, (_, i) => i % 7),
      kind: Array.from({ length: n }, (_, i) => `cat-${i % 100}`),
    });
    /** Reads of the table drawing a scene whose entry (or entries, one a value) names `count` values of `field`. */
    const readsFor = (field: string, count: number, apart = false) => {
      const values = Array.from({ length: count }, (_, i) =>
        field === "x" ? String(i) : `cat-${i}`,
      );
      const { model } = build({
        marks: [point(rows, { x: "x", y: "y", series: false, id: "p" })],
        legend: {
          include: [],
          entries: apart
            ? values.map((value) => ({
                key: `one-${value}`,
                label: value,
                targets: [{ mark: "p", field, values: [value] }],
              }))
            : [{ key: "many", label: "Many", targets: [{ mark: "p", field, values }] }],
        },
      });
      // Some rows hidden by another field, whose rows are read for what hides them.
      for (let i = 0; i < 50; i++)
        model.hidden.add(JSON.stringify({ mark: "p", field: "kind", equals: `cat-${i}` }));
      let reads = 0;
      const own = rows as unknown as Record<string, unknown>;
      for (const name of ["value", "numbers", "categories"] as const) {
        const read = (rows[name] as (...args: never[]) => unknown).bind(rows);
        own[name] = (...args: never[]) => {
          reads++;
          return read(...args);
        };
      }
      const [entry] = entriesOf(model.scene(estimateText));
      for (const name of ["value", "numbers", "categories"]) delete own[name];
      expect(entry!.hidden || entry!.mixed || apart, field).toBe(true);
      return reads;
    };
    // As many reads for a hundred values as for one, in one entry or a hundred: each is counted from one pass.
    for (const field of ["x", "kind"]) {
      expect(readsFor(field, 100), field).toBe(readsFor(field, 1));
      expect(readsFor(field, 100, true), field).toBe(readsFor(field, 1, true));
    }
  });

  it("read a mark's rows once for entries shown past what its panel sets, in the chart's legend and the panel's", () => {
    const n = 1000;
    const rows = table({
      x: Float64Array.from({ length: n }, (_, i) => i),
      y: Float64Array.from({ length: n }, (_, i) => i % 7),
      value: Float64Array.from({ length: n }, (_, i) => Math.floor(i / 2) % 100),
      shade: Array.from({ length: n }, (_, i) => (i % 2 ? "on" : "off")),
    });
    /** Reads of the table drawing a scene of `count` entries, a value each, hidden or mixed by the panel's settings. */
    const readsFor = (count: number, where: "chart" | "panel", hide: string) => {
      const entries = Array.from({ length: count }, (_, i) => ({
        key: `v${i}`,
        label: `V${i}`,
        targets: [{ mark: "p", field: "value", values: [String(i)] }],
      }));
      const own = { include: [], entries };
      const { model } = build({
        marks: [point(rows, { x: "x", y: "y", series: false, id: "p", panel: "a" })],
        panels: panels([{ id: "a" }]),
        legend: where === "chart" ? own : false,
        guides: where === "panel" ? [legend({ panel: "a", ...own })] : [],
      });
      model.hidden.panels = new Map([["a", new Map([[hide, true]])]]);
      // Values read: each row's, and each element of the columns handed out.
      let reads = 0;
      const counted = <T extends object>(array: T): T =>
        new Proxy(array, {
          get(target, key) {
            if (typeof key === "string" && /^\d+$/.test(key)) reads++;
            return Reflect.get(target, key, target);
          },
        });
      const table = rows as unknown as Record<string, (...args: never[]) => unknown>;
      const [value, numbers, categories] = [rows.value, rows.numbers, rows.categories].map((read) =>
        read.bind(rows),
      ) as [typeof rows.value, typeof rows.numbers, typeof rows.categories];
      table.value = (...args: Parameters<typeof value>) => {
        reads++;
        return value(...args);
      };
      table.numbers = (field: never) => counted(numbers(field));
      table.categories = (field: never) => {
        const found = categories(field);
        return { ...found, codes: counted(found.codes) };
      };
      model.scene(estimateText);
      for (const name of ["value", "numbers", "categories"]) delete table[name];
      return reads;
    };
    // Each entry's showing is read again as it would leave the panel's settings,
    // from the rows of its value, found once: a hundred entries' values hold
    // every row, which are read a few times in all, not a pass per entry.
    for (const where of ["chart", "panel"] as const)
      for (const hide of ['{"mark":"p"}', '{"mark":"p","field":"shade","equals":"off"}'])
        expect(
          readsFor(100, where, hide) - readsFor(1, where, hide),
          `${where} ${hide}`,
        ).toBeLessThan(5 * n);
  });

  it("keep no rows for a value most rows hold, showing it past what its panel sets", () => {
    const n = 20_000;
    const rows = table({
      x: Float64Array.from({ length: n }, (_, i) => i),
      y: new Float64Array(n).fill(1),
      value: new Float64Array(n),
    });
    /** Int32Array elements made drawing a scene of `entries`, the mark hidden whole in its panel. */
    const made = (entries: number) => {
      const { model } = build({
        marks: [point(rows, { x: "x", y: "y", series: false, id: "p", panel: "a" })],
        panels: panels([{ id: "a" }]),
        legend: {
          include: [],
          entries: Array.from({ length: entries }, (_, i) => ({
            key: `v${i}`,
            label: "Zero",
            targets: [{ mark: "p", field: "value", values: ["0"] }],
          })),
        },
      });
      model.hidden.panels = new Map([["a", new Map([['{"mark":"p"}', true]])]]);
      model.scene(estimateText);
      const Int32 = globalThis.Int32Array;
      let elements = 0;
      globalThis.Int32Array = new Proxy(Int32, {
        construct(target, args, newTarget) {
          const array = Reflect.construct(target, args, newTarget) as Int32Array;
          elements += array.length;
          return array;
        },
      });
      try {
        const [entry] = entriesOf(model.scene(estimateText));
        if (entries > 0) expect(entry!.shows).toContain('{"mark":"p"}');
      } finally {
        globalThis.Int32Array = Int32;
      }
      return elements;
    };
    // Every row holds 0: its rows are read in a pass where showing it is read, not kept.
    expect(made(1) - made(0)).toBeLessThan(n / 8);
  });

  it('name missing numbers by "null" only, apart and together', () => {
    const rows = table({ x: [0, 1], y: [1, 2], n: [Number.NaN, 1] });
    for (const names of [["null"], ["NaN"], ["null", "NaN"], ["NaN", "null"]]) {
      const { model } = build({
        marks: [point(rows, { x: "x", y: "y", series: false, id: "p" })],
        legend: {
          include: [],
          entries: names.map((name) => ({
            key: name,
            label: name,
            targets: [{ mark: "p", field: "n", values: [name] }],
          })),
        },
      });
      model.hidden.add('{"mark":"p","field":"n","equals":"null"}');
      const entries = entriesOf(model.scene(estimateText));
      const entry = (key: string) => entries.find((e) => e.key === key);
      if (names.includes("null")) expect(entry("null")!.hidden, names.join()).toBe(true);
      // "NaN" names no row: nothing drawn has it, so it has no say.
      if (names.includes("NaN")) {
        expect(entry("NaN")!.hidden, names.join()).toBe(false);
        expect(entry("NaN")!.shows, names.join()).toBeUndefined();
      }
    }
  });

  it("count values of a field of many split into many series, and what hides their rows only", () => {
    const n = 3000;
    const rows = table({
      x: Float64Array.from({ length: n }, (_, i) => i),
      y: Float64Array.from({ length: n }, (_, i) => i % 7),
      kind: Array.from({ length: n }, (_, i) => `series-${i % 30}`),
      unique: Array.from({ length: n }, (_, i) => `value-${i}`),
      half: Array.from({ length: n }, (_, i) => (i % 2 ? "odd" : "even")),
    });
    const { model } = build({
      marks: [point(rows, { x: "x", y: "y", series: "kind", id: "p" })],
      legend: {
        include: [],
        entries: [
          {
            key: "one",
            label: "One",
            targets: [{ mark: "p", field: "unique", values: ["value-0"] }],
          },
          { key: "two", label: "Two", targets: [{ mark: "p", field: "x", values: ["0", "1"] }] },
        ],
      },
    });
    // Half the rows hidden by another field, and the row at 1 by x.
    model.hidden.add('{"mark":"p","field":"half","equals":"even"}');
    model.hidden.add('{"mark":"p","field":"x","equals":"1"}');
    const entry = (key: string) => entriesOf(model.scene(estimateText)).find((e) => e.key === key)!;
    // value-0 is the row at 0, an even one, and hidden; both rows of "two" are.
    expect(entry("one").hidden).toBe(true);
    expect(entry("one").shows).toEqual([
      '{"mark":"p","field":"unique","equals":"value-0"}',
      '{"mark":"p","field":"half","equals":"even"}',
    ]);
    expect(entry("two").hidden).toBe(true);
    expect([...entry("two").shows!].sort()).toEqual([
      '{"mark":"p","field":"half","equals":"even"}',
      '{"mark":"p","field":"x","equals":"0"}',
      '{"mark":"p","field":"x","equals":"1"}',
    ]);
  });

  it("load the guide compiler where marks or rows are hidden, which the default legend shows", () => {
    const rows = table({ t: [0, 1, 2, 3], v: [1, 2, 3, 4], kind: ["a", "b", "a", "b"] });
    const lacking = new ChartModel({
      marks: [point(rows, { x: "t", y: "v", series: "kind", id: "p" })],
    });
    expect(lacking.lacks()[0]).toBe(false);
    lacking.hidden.add('{"mark":"p"}');
    expect(lacking.lacks()[0]).toBe(true);
    // With it, the default legend's entries are hidden as drawn, and showing one lets go of the mark.
    const { model } = build({ marks: [point(rows, { x: "t", y: "v", series: "kind", id: "p" })] });
    model.hidden.add('{"mark":"p"}');
    const [a] = entriesOf(model.scene(estimateText));
    expect(a!.hidden).toBe(true);
    for (const key of a!.shows!) model.hidden.delete(key);
    expect(pointsOf(model)).toBe(4);
  });

  it("keep scales of different names apart where their keys look alike", () => {
    const rows = table({ t: [0, 1], v: [1, 2], kind: ["a", "b"] });
    const shaped = (scale: string) =>
      point(rows, { x: "t", y: "v", series: false, symbol: { field: "kind", scale } });
    const { scene } = build({
      scales: { first: { type: "ordinal" }, second: { type: "ordinal" } },
      marks: [shaped("first"), shaped("second")],
      legend: false,
      guides: [legend({ include: [{ scale: "second" }] })],
    });
    expect(guidesOf(scene, "key")).toHaveLength(1);
  });

  it("refuse references to what the chart lacks at their paths, as its errors", () => {
    const refusal = (config: ChartConfig) => {
      try {
        build(config);
      } catch (error) {
        return error as { code?: string; path?: string };
      }
      throw new Error("expected a refusal");
    };
    const rows = table({ t: [0, 1], v: [1, 2], kind: ["a", "b"] });
    const scaled = refusal({
      marks: [point(rows, { x: "t", y: "v" })],
      guides: [legend({ include: [{ scale: "nowhere" }] })],
    });
    expect([scaled.code, scaled.path]).toEqual(["unknown-reference", "guides[0].include[0].scale"]);
    const field = refusal({
      marks: [point(rows, { x: "t", y: "v", id: "p" })],
      legend: {
        entries: [{ key: "k", label: "K", targets: [{ mark: "p", field: "nope", values: ["a"] }] }],
      },
    });
    expect([field.code, field.path]).toEqual([
      "unknown-field",
      "legend.entries[0].targets[0].field",
    ]);
  });

  it("write annotations' entries as their labels are", () => {
    const rows = table({ y: [1, 2], n: [1234, 5678] });
    const { scene } = build({
      marks: [
        line(sales, { x: "t", y: "v", series: "region" }),
        rule(rows, { y: "y", label: { field: "n", format: { number: ".1f" } }, legend: true }),
      ],
    });
    expect(labelsOf(scene)).toEqual(expect.arrayContaining(["1234.0", "5678.0"]));
  });
});

describe("maps in legends", () => {
  it("list a map's ramp as legends list what marks own, of an unnamed map too", () => {
    const mapped = (guides?: ChartConfig["guides"]) =>
      build({
        projection: "equirectangular",
        scales: { other: { type: "ordinal" } },
        marks: [geoshape(fromGeoJSON(squares()), { color: "gdp" })],
        legend: { include: [] },
        ...(guides && { guides }),
      }).scene;
    // Legends of nothing they include, or of another scale, show no ramp.
    expect(guidesOf(mapped(), "ramp")).toHaveLength(0);
    expect(guidesOf(mapped([legend({ include: [{ scale: "other" }] })]), "ramp")).toHaveLength(0);
    expect(guidesOf(mapped([legend({})]), "ramp")).toHaveLength(1);
  });
});
