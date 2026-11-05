// Field displays in layout marks' text: items' names through the displays
// of the fields they are values of (slices, stages, tree nodes, Sankey and
// network nodes, map regions and points, radar spokes and series), sums in
// the value field's format, and fields named by their labels, in legends,
// labels, tooltips, summaries, and events, while keys, drills, and hiding
// keep the raw values.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { type FeatureCollection, fromGeoJSON } from "../../src/data/geojson.ts";
import { type Table, table } from "../../src/data/table.ts";
import { chartFields } from "../../src/fields/chart.ts";
import type { CategoryFieldDisplay, FieldDisplays } from "../../src/fields.ts";
import { colorbar, legend } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { funnel } from "../../src/marks/funnel.ts";
import { geopoint } from "../../src/marks/geopoint.ts";
import { geoshape } from "../../src/marks/geoshape.ts";
import { graph } from "../../src/marks/graph.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import { radar } from "../../src/marks/radar.ts";
import { sankey } from "../../src/marks/sankey.ts";
import { sunburst } from "../../src/marks/sunburst.ts";
import { TreeData } from "../../src/marks/tree-data.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { describeChart } from "../../src/model/describe.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { type ChartConfig, ChartModel, type ItemInspection } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type { LabelsGeometry, Scene, TextGeometry } from "../../src/scene/scene.ts";
import { keysOf, legendOf, rampsOf } from "../helpers/guides.ts";

function build(config: ChartConfig, width = 600, height = 400) {
  const model = new ChartModel({ locale: "en-US", ...config }, undefined, staticCompilers());
  model.setSize(width, height, 1);
  return { model, scene: model.scene(estimateText) };
}

/** Every item, in keyboard order. */
function items(model: ChartModel): ItemInspection[] {
  const out: ItemInspection[] = [];
  let key = model.stepItem(undefined, 1);
  while (key !== undefined && !out.some((item) => item.key === key)) {
    out.push(model.inspectItem(key) as ItemInspection);
    key = model.stepItem(key, 1);
  }
  return out;
}

const labels = (model: ChartModel) => items(model).map((item) => item.points[0]!.label);
/** Legend entries: the raw value each stands for (its identity's), and its label. */
const entries = (scene: Scene) =>
  legendOf(scene).map((entry) => [(JSON.parse(entry.key) as { value: string }).value, entry.label]);
/** The text a PDF draws, its streams inflated. */
function pdfText(pdf: Uint8Array): string {
  const latin1 = Buffer.from(pdf).toString("latin1");
  return [...latin1.matchAll(/\/FlateDecode[^>]*>>\nstream\n/g)]
    .map((match) => {
      const start = match.index + match[0].length;
      const end = latin1.indexOf("\nendstream", start);
      return inflateSync(Buffer.from(pdf.subarray(start, end))).toString("latin1");
    })
    .join("");
}
const drawn = (scene: Scene) =>
  scene.panels[0]!.marks.flatMap((m) => (m.kind === "text" ? (m as TextGeometry).labels : []));

const USD = { style: "currency", currency: "USD", maximumFractionDigits: 0 } as const;
const sales = () =>
  table(
    {
      region: ["eu", "as", "eu", "am"],
      country: ["fr", "jp", "es", "us"],
      revenue: [40_000, 30_000, 20_000, 10_000],
    },
    { name: "sales" },
  );
const fields: FieldDisplays = {
  region: {
    label: "Region",
    mappings: [
      { value: "eu", text: "Europe" },
      { value: "as", text: "Asia" },
      { value: "am", text: "Americas" },
    ],
  },
  country: {
    label: "Country",
    mappings: [
      { value: "fr", text: "France" },
      { value: "es", text: "Spain" },
    ],
  },
  revenue: { label: "Revenue", format: USD },
};

describe("pie slices through the displays", () => {
  const slices = () => pie(sales(), { category: "region", value: "revenue" });

  it("name slices, sum them in the value's format, and keep their keys raw", () => {
    const { model, scene } = build({ marks: [slices()], fields });
    expect(entries(scene)).toEqual([
      ["eu", "Europe"],
      ["as", "Asia"],
      ["am", "Americas"],
    ]);
    const [europe] = items(model);
    expect(europe!.key).toBe('[0,"eu"]');
    expect(europe!.label).toBe("Revenue");
    expect(europe!.points[0]).toMatchObject({ label: "Europe", text: "$60,000 (60%)" });
    expect(model.layoutSummary()).toBe(
      "Pie of Revenue by Region: 3 slices totaling $100,000. Largest: Europe 60%, Asia 30%, Americas 10%.",
    );
    expect(drawn(scene)).toEqual(expect.arrayContaining(["Europe", "Asia"]));
  });

  it("hide and pick slices by their raw values", () => {
    const data = sales();
    const { model, scene } = build({
      marks: [pie(data, { category: "region", value: "revenue" })],
      fields,
    });
    model.hidden.add(legendOf(scene)[1]!.key);
    model.scene(estimateText);
    expect(labels(model)).toEqual(["Europe", "Americas"]);
    expect(Array.from(model.items!.result()!.rowsOf?.('[0,"eu"]', data as never) ?? [])).toEqual([
      0, 2,
    ]);
  });

  it("write names as they are without displays, or where the field has none", () => {
    const plain = build({ marks: [slices()] });
    expect(labels(plain.model)).toEqual(["eu", "as", "am"]);
    expect(plain.model.layoutSummary()).toMatch(/^Pie of revenue by region: .* totaling 100,000\./);
    const other = build({ marks: [slices()], fields: { country: fields.country! } });
    expect(labels(other.model)).toEqual(["eu", "as", "am"]);
  });

  it("draw the same names in static SVG and PDF", () => {
    const svg = renderToSVG({ marks: [slices()], fields, width: 600, height: 400 });
    expect(svg).toContain(">Europe<");
    expect(svg).not.toContain(">eu<");
    const pdf = pdfText(renderToPDF({ marks: [slices()], fields, width: 600, height: 400 }));
    expect(pdf).toContain("Europe");
    expect(pdf).not.toMatch(/\(eu\)/);
  });
});

describe("layout marks' legends through the displays", () => {
  it("list the written names and titles where getLegend and the text alternative read them", () => {
    const { model } = build({
      marks: [pie(sales(), { category: "region", value: "revenue" })],
      fields,
    });
    expect(model.legendEntries().map(({ label }) => label)).toEqual(["Europe", "Asia", "Americas"]);
  });

  it("list them so with the legend off, as applications drawing their own legend read them", () => {
    const { model } = build({
      marks: [pie(sales(), { category: "region", value: "revenue" })],
      fields,
      legend: false,
    });
    expect(model.legendEntries().map(({ label }) => label)).toEqual(["Europe", "Asia", "Americas"]);
  });

  it("name an entry several layout marks share only where they write its value alike", () => {
    const north = table({ region: ["eu", "as"], revenue: [3, 1] }, { name: "north" });
    const south = table({ region: ["eu", "am"], revenue: [2, 2] }, { name: "south" });
    const two = (rules: FieldDisplays) =>
      build({
        panels: panels([{ id: "n" }, { id: "s" }]),
        marks: [
          pie(north, { category: "region", value: "revenue", panel: "n" }),
          pie(south, { category: "region", value: "revenue", panel: "s" }),
        ],
        fields: rules,
      }).model.legendEntries();
    const label = (entries: ReturnType<typeof two>, value: string) =>
      entries.find(({ key }) => (JSON.parse(key) as { value: string }).value === value)?.label;
    const europe = { value: "eu", text: "Europe" };
    // Alike in both: written; told apart by table, or written by one alone: raw.
    expect(label(two({ region: { mappings: [europe] } }), "eu")).toBe("Europe");
    const apartRules: FieldDisplays = [
      { match: { table: "north", field: "region" }, mappings: [europe] },
      { match: { table: "south", field: "region" }, mappings: [{ value: "eu", text: "EU" }] },
    ];
    const apart = two(apartRules);
    expect(label(apart, "eu")).toBe("eu");
    const one = two([{ match: { table: "north", field: "region" }, mappings: [europe] }]);
    expect(label(one, "eu")).toBe("eu");
    // A series listed first, naming it through its own display, changes nothing.
    const withLine = (rules: FieldDisplays, lineFirst: boolean) => {
      const marks = [
        line(north, { x: "revenue", y: "revenue", series: "region", panel: "n" }),
        pie(south, { category: "region", value: "revenue", panel: "s" }),
      ];
      return build({
        panels: panels([{ id: "n" }, { id: "s" }]),
        marks: lineFirst ? marks : marks.reverse(),
        fields: rules,
      }).model.legendEntries();
    };
    for (const lineFirst of [true, false]) {
      expect(label(withLine(apartRules, lineFirst), "eu")).toBe("eu");
      expect(label(withLine({ region: { mappings: [europe] } }, lineFirst), "eu")).toBe("Europe");
    }
    // A series' own label parts keep naming its entries, whatever they say.
    const labeled = (parts: string[], rules: FieldDisplays) =>
      build({
        panels: panels([{ id: "n" }, { id: "s" }]),
        marks: [
          line(north, { x: "revenue", y: "revenue", series: "region", label: parts, panel: "n" }),
          pie(south, { category: "region", value: "revenue", panel: "s" }),
        ],
        fields: rules,
      }).model.legendEntries();
    const mapped = labeled(["eu"], {
      region: { mappings: [europe, { value: "am", text: "Americas" }] },
    });
    expect(label(mapped, "eu")).toBe("eu");
    expect(label(mapped, "am")).toBe("Americas");
    const southern = [{ match: { table: "south", field: "region" }, mappings: [europe] }];
    expect(label(labeled(["Europe"], southern), "eu")).toBe("Europe");
    // An entry one mark alone names is written through its display.
    expect(label(apart, "as")).toBe("as");
    expect(label(two({ region: { mappings: [{ value: "am", text: "Americas" }] } }), "am")).toBe(
      "Americas",
    );
  });
});

describe("what layout marks' values measure", () => {
  it("label a field they measure, never a name of their own", () => {
    const heading = (config: ChartConfig) => items(build(config).model)[0]!.label;
    const counted = table({ region: ["eu", "as"], Count: [1, 2] });
    const fields = { Count: { label: "Tally" }, score: { label: "Score" } };
    expect(heading({ marks: [pie(counted, { category: "region" })], fields })).toBe("Count");
    expect(heading({ marks: [pie(counted, { category: "region", value: "Count" })], fields })).toBe(
      "Tally",
    );
    const scores = table({ skill: ["sp", "po", "ra"], score: [0.8, 0.5, 0.7] });
    const named = radar(scores, { category: "skill", value: "score", label: "score" });
    expect(heading({ marks: [named], fields })).toBe("score");
    // An empty label is the field's label too.
    const unlabeled = { Count: { label: "" } };
    expect(
      heading({ marks: [pie(counted, { category: "region", value: "Count" })], fields: unlabeled }),
    ).toBe("");
  });
});

describe("funnels through the displays", () => {
  it("name stages and write their amounts in the value's format", () => {
    const steps = table({ stage: ["v", "s", "p"], users: [1_000, 400, 100] });
    const { model } = build({
      marks: [funnel(steps, { category: "stage", value: "users" })],
      fields: {
        stage: {
          mappings: [
            { value: "v", text: "Visited" },
            { value: "s", text: "Signed up" },
            { value: "p", text: "Paid" },
          ],
        },
        users: { label: "Users", format: { number: "~s" } },
      },
    });
    expect(labels(model)).toEqual(["Visited", "Signed up", "Paid"]);
    expect(items(model)[0]!.key).toBe('[0,"v"]');
    expect(items(model)[0]!.points[0]!.text).toMatch(/^1k\b/);
    expect(model.layoutSummary()).toContain("Users");
  });
});

describe("trees through the displays", () => {
  const tree = (make = treemap) =>
    make(sales(), { path: ["region", "country"], value: "revenue" } as never);

  it("name each level's nodes through its own field, keyed by raw paths", () => {
    const { model, scene } = build({ marks: [tree()], fields });
    const all = items(model);
    const france = all.find((item) => item.key === '[0,"eu","fr"]')!;
    expect(france.points[0]!.label).toBe("Europe / France");
    expect(france.points[0]!.text).toMatch(/^\$40,000 /);
    // A country without a mapping keeps its value.
    expect(all.map((item) => item.points[0]!.label)).toContain("Asia / jp");
    expect(entries(scene)).toEqual([
      ["eu", "Europe"],
      ["as", "Asia"],
      ["am", "Americas"],
    ]);
    expect(model.layoutSummary()).toMatch(/^Treemap of Revenue by Region \/ Country/);
    expect(drawn(scene)).toEqual(expect.arrayContaining(["Europe", "France"]));
    expect(drawn(scene)).not.toContain("eu");
  });

  it("drill by raw names, reporting raw paths, with the drawn crumbs as written", () => {
    const { model } = build({ marks: [tree()], fields, interaction: { zoom: true } });
    expect(model.items!.setDrillRoot(["eu"])).toEqual({
      key: '[0,"eu"]',
      path: [{ key: '[0,"eu"]', label: "eu" }],
    });
    const scene = model.scene(estimateText);
    const crumbs = model.items!.result()!.drill!.crumbs;
    expect(crumbs.map(({ label }) => label)).toEqual(["All", "Europe"]);
    expect(drawn(scene)).toContain("Europe");
    expect(labels(model)).toEqual(["Europe / France", "Europe / Spain"]);
  });

  it("name the steps drilled into for announcements, breadcrumbs drawn or not", () => {
    for (const breadcrumbs of [true, false]) {
      const plain = build({
        marks: [treemap(sales(), { path: ["region", "country"], value: "revenue", breadcrumbs })],
        interaction: { zoom: true },
      });
      plain.model.items!.setDrillRoot(["eu", "fr"]);
      plain.model.scene(estimateText);
      expect(plain.model.items!.result()!.drill!.labels).toEqual(["eu", "fr"]);
      const { model } = build({
        marks: [treemap(sales(), { path: ["region", "country"], value: "revenue", breadcrumbs })],
        interaction: { zoom: true },
        fields,
      });
      model.items!.setDrillRoot(["eu", "fr"]);
      model.scene(estimateText);
      expect(model.items!.result()!.drill!.labels).toEqual(["Europe", "France"]);
    }
  });

  it("write a node's and its parent's fields in labels through each field's own display", () => {
    const staff = table({ id: ["a", "b", "c"], boss: [null, "a", "a"], pay: [0, 5, 3] });
    const { scene } = build({
      marks: [
        treemap(staff, {
          node: "id",
          parent: "boss",
          value: "pay",
          labels: { content: [{ field: "id" }, " under ", { field: "boss" }] },
        } as never),
      ],
      fields: {
        id: { mappings: [{ value: "b", text: "Bo" }] },
        boss: { mappings: [{ value: "a", text: "Manager Ana" }] },
      },
    });
    // Labels of parts draw each part apart.
    const parts = scene.panels[0]!.marks.flatMap((m) =>
      m.kind === "labels" ? (m as LabelsGeometry).items.map(({ text }) => text) : [],
    );
    expect(parts.join("")).toContain("Bo under Manager Ana");
  });

  it("write a tree's names once per view, so caches keyed by views keep", () => {
    const data = sales() as unknown as Table;
    const displays = chartFields(fields, GUIDE_KIT, "en-US", "UTC");
    const view = new TreeData(
      data,
      { path: ["region", "country"], value: "revenue" },
      "treemap",
    ).view();
    const encoding = { path: ["region", "country"] };
    const written = displays.items(data).tree(view, encoding);
    expect(written.tree.names).toContain("Europe");
    expect(displays.items(data).tree(view, encoding)).toBe(written);
  });

  it("name sunburst sectors and their center the same way", () => {
    const { model, scene } = build({ marks: [tree(sunburst as never)], fields });
    expect(labels(model)).toContain("Europe / Spain");
    expect(drawn(scene)).toContain("Europe");
    expect(model.layoutSummary()).toMatch(/^Sunburst of Revenue by Region \/ Country/);
  });
});

describe("Sankey diagrams and networks through the displays", () => {
  const flows = () =>
    table({ from: ["a", "a", "b"], to: ["b", "c", "c"], amount: [5_000, 3_000, 2_000] });
  const names: FieldDisplays = [
    {
      match: { field: ["from", "to"] },
      mappings: [
        { value: "a", text: "Coal" },
        { value: "b", text: "Power" },
        { value: "c", text: "Homes" },
      ],
    },
    { match: "amount", label: "Energy", format: { si: "Wh" } },
  ];

  it("name a Sankey diagram's nodes where its source and target displays agree", () => {
    const { model, scene } = build({
      marks: [sankey(flows(), { source: "from", target: "to", value: "amount" })],
      fields: names,
    });
    const all = items(model);
    expect(all.map((item) => item.points[0]!.label)).toEqual(
      expect.arrayContaining(["Coal", "Power", "Coal → Power"]),
    );
    expect(all.find((item) => item.points[0]!.label === "Coal → Power")!.key).toBe('[0,"a","b"]');
    expect(drawn(scene).join(" ")).toContain("Coal");
    expect(model.layoutSummary()).toContain("Energy");
    // Where they disagree, names stay as they are.
    const apart = build({
      marks: [sankey(flows(), { source: "from", target: "to", value: "amount" })],
      fields: { from: { mappings: [{ value: "b", text: "Power" }] } },
    });
    expect(labels(apart.model)).toContain("b");
  });

  it("name a network's nodes, groups, and link labels, keyed raw", () => {
    const links = table({ from: ["a", "b"], to: ["b", "c"], kind: ["m", "m"] });
    const people = table({ name: ["a", "b", "c"], team: ["d", "d", "s"] });
    const { model, scene } = build({
      marks: [
        graph(links, {
          source: "from",
          target: "to",
          nodes: people,
          node: "name",
          color: "team",
          linkLabelField: "kind",
        }),
      ],
      fields: [
        {
          match: { field: ["from", "to", "name"] },
          mappings: [
            { value: "a", text: "Ana" },
            { value: "b", text: "Bo" },
            { value: "c", text: "Cy" },
          ],
        },
        {
          match: "team",
          label: "Team",
          mappings: [
            { value: "d", text: "Data" },
            { value: "s", text: "Sales" },
          ],
        },
        { match: "kind", mappings: [{ value: "m", text: "mentors" }] },
      ],
    });
    expect(entries(scene)).toEqual([
      ["d", "Data"],
      ["s", "Sales"],
    ]);
    const ana = items(model).find((item) => item.key === '[0,"a"]')!;
    expect(ana.points[0]!.label).toBe("Ana");
    expect(ana.points[0]!.text).toContain("Team Data");
    const link = items(model).find((item) => item.key === '[0,"a","b"]')!;
    expect(link.points[0]!.label).toBe("Ana — Bo");
    expect(link.points[0]!.text).toMatch(/^mentors: /);
  });
});

describe("maps through the displays", () => {
  const ring = (x: number) => [
    [x, 0],
    [x + 10, 0],
    [x + 10, 10],
    [x, 10],
    [x, 0],
  ];
  const world = (): FeatureCollection => ({
    type: "FeatureCollection",
    features: [
      ["ad", 1_500, "n"],
      ["be", 4_200, "s"],
    ].map(([name, gdp, zone], i) => ({
      type: "Feature" as const,
      properties: { name, gdp, zone },
      geometry: { type: "Polygon", coordinates: [ring(i * 10)] },
    })),
  });
  const shown: FieldDisplays = {
    name: {
      mappings: [
        { value: "ad", text: "Adria" },
        { value: "be", text: "Belor" },
      ],
    },
    gdp: { label: "GDP", format: USD },
    zone: {
      label: "Zone",
      mappings: [
        { value: "n", text: "North" },
        { value: "s", text: "South" },
      ],
    },
  };

  it("name regions, write their values, and title the ramp by the field's label", () => {
    const { model, scene } = build({
      projection: "equirectangular",
      marks: [geoshape(fromGeoJSON(world()), { labelField: "name", color: "gdp" })],
      fields: shown,
    });
    const [adria] = items(model);
    expect(adria!.points[0]).toMatchObject({ label: "Adria", text: "$1,500" });
    expect(adria!.label).toBe("GDP");
    expect(rampsOf(scene)[0]!.title!.text).toBe("GDP");
    expect(model.layoutSummary()).toContain("GDP");
    // The text alternative describes the ramp as drawn.
    const described = model.legendSummaries().join(" ");
    expect(described).toContain("GDP");
    expect(described).not.toContain("gdp");
  });

  it("keep a map's ramp in its subplot's legend, written there", () => {
    const at = (rules?: FieldDisplays) => {
      const { model, scene } = build({
        panels: panels([{ id: "map" }, { id: "other" }]),
        marks: [
          geoshape(fromGeoJSON(world()), { labelField: "name", color: "gdp", panel: "map" }),
          pie(sales(), { category: "region", value: "revenue", panel: "other" }),
        ],
        guides: [legend({ panel: "map" })],
        projection: "equirectangular",
        ...(rules && { fields: rules }),
      });
      const [ramp] = rampsOf(scene);
      return { ramp: ramp!, described: model.legendSummaries().join(" ") };
    };
    const plain = at();
    const written = at(shown);
    expect(written.ramp.title.text).toBe("GDP");
    // Where the subplot's legend puts it: the title, a wider one, starts it.
    expect([written.ramp.y, written.ramp.title.x]).toEqual([plain.ramp.y, plain.ramp.title.x]);
    expect(written.described).toContain("GDP");
  });

  it("write a ramp two maps share only where their displays write it alike", () => {
    const titles = (rules: (a: Table, b: Table) => FieldDisplays) => {
      const [a, b] = [fromGeoJSON(world()), fromGeoJSON(world())] as unknown as [Table, Table];
      const { scene } = build({
        projection: "equirectangular",
        panels: panels([{ id: "a" }, { id: "b" }]),
        marks: [
          geoshape(a as never, { color: "gdp", panel: "a" }),
          geoshape(b as never, { color: "gdp", panel: "b" }),
        ],
        fields: rules(a, b),
      });
      return rampsOf(scene).map(({ title, low }) => [title.text, low.text]);
    };
    expect(titles(() => ({ gdp: { label: "GDP", format: USD } }))).toEqual([["GDP", "$1,500"]]);
    expect(
      titles((a, b) => [
        { match: { table: a, field: "gdp" }, label: "GDP", format: USD },
        { match: { table: b, field: "gdp" }, label: "Output", format: { style: "percent" } },
      ]),
    ).toEqual([["gdp", "1,500"]]);
    // Alike in label and ends, apart in format: a colorbar would write the ticks between apart.
    expect(
      titles((a, b) => [
        { match: "gdp", label: "GDP" },
        { match: { table: a, field: "gdp" }, format: { maximumFractionDigits: 0 } },
        { match: { table: b, field: "gdp" }, format: { maximumFractionDigits: 2 } },
      ]),
    ).toEqual([["gdp", "1,500"]]);
  });

  it("write a colorbar naming the map's scale in the color field's format", () => {
    const svg = renderToSVG({
      projection: "equirectangular",
      marks: [
        geoshape(fromGeoJSON(world()), { id: "countries", labelField: "name", color: "gdp" }),
      ],
      guides: [colorbar({ scale: { mark: "countries", channel: "color" } })],
      fields: shown,
      width: 600,
      height: 400,
    });
    expect(svg).toMatch(/>\$[\d,]+</);
  });

  it("name regions' legend entries by a category color's display", () => {
    const { scene } = build({
      projection: "equirectangular",
      marks: [geoshape(fromGeoJSON(world()), { labelField: "name", color: "zone" })],
      fields: shown,
    });
    expect(legendOf(scene).map((entry) => entry.label)).toEqual(["North", "South"]);
  });

  it("name regions and points missing a name by the display's missing text, else by place", () => {
    const named = (name: CategoryFieldDisplay | undefined) => {
      const places = table({ lon: [2, 12], lat: [5, 5], city: [null, "r"] });
      const { model } = build({
        projection: "equirectangular",
        marks: [geopoint(places, { longitude: "lon", latitude: "lat", labelField: "city" })],
        ...(name && { fields: { city: name } }),
      });
      return labels(model);
    };
    expect(named({ missing: "Unknown" })).toEqual(["Unknown", "r"]);
    expect(named({ missing: "" })).toEqual(["", "r"]);
    expect(named({ label: "City" })).toEqual(["Point 1", "r"]);
    expect(named(undefined)).toEqual(["Point 1", "r"]);
  });

  it("name points and write their sizes in the size key and items", () => {
    const cities = table({
      lon: [2, 12],
      lat: [5, 5],
      city: ["p", "r"],
      people: [2_100_000, 2_800_000],
    });
    const { model, scene } = build({
      projection: "equirectangular",
      marks: [
        geopoint(cities, { longitude: "lon", latitude: "lat", labelField: "city", size: "people" }),
      ],
      fields: {
        city: {
          mappings: [
            { value: "p", text: "Paris" },
            { value: "r", text: "Rome" },
          ],
        },
        people: { label: "Population", format: { number: "~s" } },
      },
    });
    const all = items(model);
    expect(all.map((item) => item.points[0]!.label)).toEqual(["Paris", "Rome"]);
    expect(all[0]!.points[0]!.text).toBe("2.1M");
    expect(all[0]!.label).toBe("Population");
    const [size] = keysOf(scene);
    expect(size!.title!.text).toBe("Population");
    expect(size!.entries.every((entry) => /M$/.test(entry.label.text))).toBe(true);
    expect(model.layoutSummary()).toContain("sized by Population; largest Rome (2.8M)");
  });
});

describe("radars through the displays", () => {
  it("name spokes and series, and write each spoke's values", () => {
    const scores = table({
      skill: ["sp", "po", "ra", "sp", "po", "ra"],
      player: ["a", "a", "a", "b", "b", "b"],
      score: [0.8, 0.5, 0.7, 0.4, 0.9, 0.6],
    });
    const { model, scene } = build({
      marks: [radar(scores, { category: "skill", value: "score", series: "player" })],
      fields: {
        skill: {
          label: "Skill",
          mappings: [
            { value: "sp", text: "Speed" },
            { value: "po", text: "Power" },
            { value: "ra", text: "Range" },
          ],
        },
        player: {
          mappings: [
            { value: "a", text: "Ana" },
            { value: "b", text: "Bo" },
          ],
        },
        score: { label: "Score", format: { style: "percent" } },
      },
    });
    expect(entries(scene)).toEqual([
      ["a", "Ana"],
      ["b", "Bo"],
    ]);
    expect(drawn(scene)).toEqual(expect.arrayContaining(["Speed", "Power", "Range"]));
    const [first] = items(model);
    expect(first!.points[0]).toMatchObject({ label: "Ana" });
    expect(first!.points[0]!.text).toBe("Speed: 80% (of 0% to 100%)");
    expect(describeChart(model)).toContain("Radar of Score by Skill");
    expect(model.layoutSummary()).toContain("from 0% at the center to 100% at the rim");
    // The rings' values in the score's format.
    expect(drawn(scene)).toEqual(expect.arrayContaining(["40%", "100%"]));
  });

  it("name the fields of a radar with too few spokes by their labels", () => {
    const scores = table({ skill: ["sp", "po", "ra"], score: [0.8, 0.5, 0.7] });
    const { model } = build({
      marks: [radar(scores, { category: "skill", value: "score" })],
      fields: { skill: { label: "Skill" }, score: { label: "Score" } },
    });
    // An update leaves two spokes.
    scores.reset({ skill: ["sp", "po"], score: [0.8, 0.5] });
    model.scene(estimateText);
    expect(model.layoutSummary()).toMatch(/^Radar of Score by Skill, with 2 spokes/);
  });

  it("name one polygon without a series field by its value field's label", () => {
    const scores = table({ skill: ["sp", "po", "ra"], score: [0.8, 0.5, 0.7] });
    const { model } = build({
      marks: [radar(scores, { category: "skill", value: "score" })],
      fields: { score: { label: "Score" } },
    });
    expect(labels(model)[0]).toBe("Score");
    expect(model.legendEntries().map(({ label }) => label)).toEqual(["Score"]);
  });

  it("name the spokes of value fields by their labels", () => {
    const players = table({ name: ["a"], speed: [3], power: [4], range: [5] });
    const { scene } = build({
      marks: [radar(players, { fields: ["speed", "power", "range"], series: "name" })],
      fields: { speed: { label: "Speed" }, power: { label: "Power" } },
    });
    expect(drawn(scene)).toEqual(expect.arrayContaining(["Speed", "Power", "range"]));
  });
});
