// The order of bands on category axes: the first table's dictionary order by
// default, which views and groups do not change; `domain` lists categories in
// the order their bands take, each keeping its band without rows, with the
// categories it leaves out after them.
import { describe, expect } from "vitest";
import { sum } from "../../src/data/aggregations.ts";
import { category } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { groupRows } from "../../src/data/groups.ts";
import { rowView } from "../../src/data/row-view.ts";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { inset, panel } from "../../src/layout.ts";
import { bar } from "../../src/marks/bar.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { surface } from "../../src/marks/surface.ts";
import { facet } from "../../src/model/facet.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { Picker } from "../../src/model/pick.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type { RectGeometry, Scene } from "../../src/scene/scene.ts";
import { loadSpec } from "../../src/spec/load.ts";
import { validateSpec } from "../../src/spec/validate.ts";
import { contractTest } from "../helpers/contracts.ts";
import { readKeys } from "../helpers/keyboard.ts";
import { pickKit } from "../helpers/picker.ts";
import { xScale } from "../helpers/scales.ts";

function build(config: ChartConfig, width = 600, height = 300) {
  const model = new ChartModel({ locale: "en-US", timeZone: "UTC", ...config });
  model.setSize(width, height, 1);
  return { model, scene: model.scene(estimateText) };
}

const REGIONS = ["North", "South", "East", "West"];

/** Two years of sales by region, each region's rows in REGIONS order. */
const sales = () =>
  table({
    region: category([...REGIONS, ...REGIONS]),
    year: category(["2024", "2024", "2024", "2024", "2025", "2025", "2025", "2025"]),
    revenue: [1, 2, 3, 4, 5, 6, 7, 8],
  });

/** Each bar a panel draws, left to right: its category and its height in values. */
function barsOf(model: ChartModel, scene: Scene, panel = 0) {
  const { x, y } = model.panels()[panel]!;
  return scene.panels[panel]!.marks.filter((m): m is RectGeometry => m.kind === "rect")
    .flatMap((rect) =>
      Array.from({ length: rect.count }, (_, k) => {
        const [left, top, width, height] = rect.rects.subarray(k * 4, k * 4 + 4);
        const band = Math.round(x.invert(left! + width! / 2));
        return {
          center: left! + width! / 2,
          category: x.categories![band]!,
          value: Math.round(Math.abs(y.invert(top!) - y.invert(top! + height!)) * 1000) / 1000,
        };
      }),
    )
    .sort((a, b) => a.center - b.center)
    .map(({ category, value }) => [category, value] as const);
}

/** A band's center on x, by its category. */
const center = (model: ChartModel, category: string, panel = 0) => {
  const { x } = model.panels()[panel]!;
  return x.map(x.categories!.indexOf(category));
};

describe("bands on category axes", () => {
  contractTest("axis.bands.order.default", () => {
    // The first table's dictionary order, whatever order a view sorts its rows in.
    const ranked = table({ name: category(["a", "b", "c"]), value: [1, 3, 2] });
    const sorted = rowView(ranked, { sort: [{ field: "value", order: "descending" }] });
    const { model } = build({ marks: [bar(sorted, { x: "name", y: "value" })] });
    expect(xScale(model)!.categories).toEqual(["a", "b", "c"]);
    // A second mark's categories follow the first's.
    const more = table({ name: category(["d", "b"]), value: [4, 5] });
    const both = build({
      marks: [bar(ranked, { x: "name", y: "value" }), line(more, { x: "name", y: "value" })],
    });
    expect(xScale(both.model)!.categories).toEqual(["a", "b", "c", "d"]);
  });

  contractTest("axis.bands.order.listed", () => {
    const { model, scene } = build({
      x: { domain: ["West", "East", "South", "North"] },
      marks: [bar(sales(), { x: "region", y: "revenue", series: "year" })],
    });
    expect(xScale(model)!.categories).toEqual(["West", "East", "South", "North"]);
    const bars = barsOf(model, scene);
    expect(bars.map(([region]) => region)).toEqual([
      "West",
      "West",
      "East",
      "East",
      "South",
      "South",
      "North",
      "North",
    ]);
    // On y, the listed order runs from the top.
    const across = build({
      y: { domain: ["West", "North"] },
      marks: [bar(sales(), { x: "revenue", y: "region" })],
    }).model;
    const { y } = across.panels()[0]!;
    expect(y.categories).toEqual(["West", "North", "South", "East"]);
    expect(y.map(0)).toBeLessThan(y.map(1));
    // Options in code are not checked as specs are (validateSpec refuses
    // the repeat): a category listed twice keeps its first place.
    const twice = build({
      x: { domain: ["West", "North", "West"] },
      marks: [bar(sales(), { x: "region", y: "revenue" })],
    }).model;
    expect(xScale(twice)!.categories).toEqual(["West", "North", "South", "East"]);
  });

  contractTest("axis.bands.order.empty", () => {
    // A category without rows keeps its band, as wide as the others, with nothing in it.
    const { model, scene } = build({
      x: { domain: ["North", "South", "Central", "East", "West"] },
      marks: [bar(sales(), { x: "region", y: "revenue" })],
    });
    const x = xScale(model)!;
    expect(x.categories).toEqual(["North", "South", "Central", "East", "West"]);
    expect([...new Set(barsOf(model, scene).map(([region]) => region))]).toEqual([
      "North",
      "South",
      "East",
      "West",
    ]);
    expect(x.map(2) - x.map(1)).toBeCloseTo(x.map(3) - x.map(2), 6);
    // A chart whose rows all leave keeps every listed band.
    const none = rowView(sales(), { filter: false });
    const empty = build({
      x: { domain: REGIONS },
      marks: [bar(none, { x: "region", y: "revenue" })],
    });
    expect(xScale(empty.model)!.categories).toEqual(REGIONS);
  });

  contractTest("axis.bands.order.unlisted", () => {
    // Categories the list leaves out follow it, in the order they take without it.
    const { model } = build({
      x: { domain: ["East"] },
      marks: [bar(sales(), { x: "region", y: "revenue" })],
    });
    expect(xScale(model)!.categories).toEqual(["East", "North", "South", "West"]);
  });

  contractTest("axis.bands.order.groups", () => {
    // Groups a filter empties leave their table and come back in the place
    // their keys first took; bars over a listed domain stay where they were.
    const rows = rowView(sales());
    const byRegion = groupRows(rows, { by: ["region"], ops: { revenue: sum("revenue") } });
    const byYear = groupRows(rows, { by: ["year"], ops: { revenue: sum("revenue") } });
    const draw = (listed: boolean) => {
      const regions = build({
        x: listed ? { domain: REGIONS } : {},
        marks: [bar(byRegion.table, { x: "region", y: "revenue" })],
      });
      const years = build({
        x: listed ? { domain: ["2024", "2025"] } : {},
        marks: [bar(byYear.table, { x: "year", y: "revenue" })],
      });
      return {
        regions: xScale(regions.model)!.categories,
        years: xScale(years.model)!.categories,
        bars: barsOf(regions.model, regions.scene),
      };
    };
    const before = draw(true);
    expect(before.regions).toEqual(REGIONS);
    expect(before.bars).toEqual([
      ["North", 6],
      ["South", 8],
      ["East", 10],
      ["West", 12],
    ]);
    rows.setQuery({ filter: col("year").eq("2025").and(col("region").eq("West")) });
    const filtered = draw(true);
    expect(filtered.regions).toEqual(REGIONS);
    expect(filtered.bars).toEqual([["West", 8]]);
    rows.setQuery({ filter: true });
    const cleared = draw(true);
    expect(cleared).toEqual(before);
    // Without a domain too, the groups are back in their places.
    expect(draw(false).regions).toEqual(REGIONS);
    expect(draw(false).years).toEqual(["2024", "2025"]);
  });

  contractTest("axis.bands.order.ranked", () => {
    // Ranked bars: the domain lists the categories in the order of a view sorted by value.
    const ranked = table({ name: category(["a", "b", "c"]), value: [1, 3, 2] });
    const sorted = rowView(ranked, { sort: [{ field: "value", order: "descending" }] });
    const { indices, length } = sorted.read();
    const positions = indices?.subarray(0, length) ?? Array.from({ length }, (_, i) => i);
    const domain = Array.from(positions).flatMap((row) => ranked.value("name", row) ?? []);
    const { model, scene } = build({
      x: { domain },
      marks: [bar(ranked, { x: "name", y: "value" })],
    });
    expect(barsOf(model, scene)).toEqual([
      ["b", 3],
      ["c", 2],
      ["a", 1],
    ]);
  });

  contractTest("axis.bands.order.marks", () => {
    // Every mark on the axis takes the listed order: points, lines, heatmap cells.
    const data = sales();
    const { model } = build({
      x: { domain: ["West", "North"] },
      y: { domain: ["2025", "2024"] },
      marks: [heatmap(data, { x: "region", y: "year", color: "revenue" })],
    });
    const { x, y } = model.panels()[0]!;
    expect([x.categories, y.categories]).toEqual([
      ["West", "North", "South", "East"],
      ["2025", "2024"],
    ]);
    const marks = build({
      x: { domain: ["West", "East", "South", "North"] },
      marks: [
        point(data, { x: "region", y: "revenue", series: "year" }),
        line(data, { x: "region", y: "revenue", series: "year" }),
      ],
    }).model;
    // The line runs through its bands in their order: West first.
    const at = marks.inspect(center(marks, "West"), 150, "nearest-x")!;
    expect(at.label).toBe("West");
    expect(at.points.map(({ value }) => value)).toEqual([4, 8, 4, 8]);
  });

  contractTest("axis.bands.order.panels", () => {
    // Facets share the chart's order; panels with scales of their own keep
    // every listed band, those their rows lack too, in the listed order.
    const data = sales();
    const shared = build({
      x: { domain: ["West", "East", "South", "North"] },
      facet: facet("year"),
      marks: [bar(data, { x: "region", y: "revenue" })],
    }).model;
    expect(shared.panels().map(({ x }) => x.categories)).toEqual([
      ["West", "East", "South", "North"],
      ["West", "East", "South", "North"],
    ]);
    const half = rowView(data, {
      filter: col("year")
        .eq("2024")
        .and(col("region").isIn("North", "South"))
        .or(col("year").eq("2025")),
    });
    const own = build({
      x: { domain: ["South", "Central"], scope: "column" },
      facet: facet("year"),
      marks: [bar(half, { x: "region", y: "revenue" })],
    }).model;
    expect(own.panels().map(({ x }) => x.categories)).toEqual([
      ["South", "Central", "North"],
      ["South", "Central", "North", "East", "West"],
    ]);
    // Subplots: a panel's own list orders its axis; the chart's lists join them in one order.
    const subplots = build({
      panels: panels([
        { id: "a", x: { domain: ["West", "North"] } },
        { id: "b", x: { domain: ["2025"] } },
      ]),
      marks: [
        bar(data, { x: "region", y: "revenue", panel: "a" }),
        bar(data, { x: "year", y: "revenue", panel: "b" }),
      ],
    }).model;
    expect(subplots.panels().map(({ x }) => x.categories)).toEqual([
      ["West", "North", "South", "East"],
      ["2025", "2024"],
    ]);
    expect(() =>
      build({
        panels: panels([
          { id: "a", x: { domain: ["West", "North"] } },
          { id: "b", x: { domain: ["North", "West"] } },
        ]),
        marks: [
          bar(data, { x: "region", y: "revenue", panel: "a" }),
          bar(data, { x: "region", y: "revenue", panel: "b" }),
        ],
      }),
    ).toThrow(
      'panels: the x domains list "North" before "West" and after it; list the categories in one order',
    );
    // Lists that one order keeps join in it, though none lists all its
    // categories, and every panel takes it: b, which r lists before c, falls
    // between p's a and c. A category a list repeats keeps its first place.
    const letters = table({ k: category(["a", "b", "c"]), v: [1, 2, 3] });
    const joined = build({
      panels: panels([
        { id: "p", x: { domain: ["a", "c"] } },
        { id: "q", x: { domain: ["b", "c", "b"] } },
        { id: "r", x: { domain: ["a", "b"] } },
      ]),
      marks: ["p", "q", "r"].map((id) => bar(letters, { x: "k", y: "v", panel: id })),
    }).model;
    expect(joined.panels().map(({ x }) => x.categories)).toEqual([
      ["a", "b", "c"],
      ["a", "b", "c"],
      ["a", "b", "c"],
    ]);
    // An inset beside its parent: each panel's bands in the one order.
    const inner = build({
      panels: panels(
        panel({ id: "main", x: { domain: ["West", "North"] } }, [inset({ id: "zoom" })]),
      ),
      marks: [
        bar(data, { x: "region", y: "revenue", panel: "main" }),
        bar(rowView(data, { filter: col("region").eq("North") }), {
          x: "region",
          y: "revenue",
          panel: "zoom",
        }),
      ],
    }).model;
    expect(inner.panels().map(({ x }) => x.categories)).toEqual([
      ["West", "North", "South", "East"],
      ["North"],
    ]);
  });

  contractTest("axis.bands.order.inspect", () => {
    // Inspection, the keyboard, and picking read bands in the listed order.
    const { model } = build({
      x: { domain: ["West", "East", "South", "North"] },
      marks: [
        bar(sales(), { id: "bars", x: "region", y: "revenue", series: "year", dodge: false }),
      ],
    });
    const at = model.inspect(center(model, "East"), 150, "nearest-x")!;
    expect([at.label, at.points.map(({ value }) => value)]).toEqual(["East", [3, 7]]);
    const steps = readKeys(model, ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight"]);
    expect(steps.map((read) => read.split(".")[0])).toEqual(["West", "East", "South", "North"]);
    const { y } = model.panels()[0]!;
    const picked = new Picker(pickKit).pick(model, {
      x: center(model, "South"),
      y: y.map(1),
      slop: 4,
    });
    const part = picked?.item.part;
    expect(part?.kind === "row" ? sales().value("region", part.position) : undefined).toBe("South");
  });

  contractTest("axis.bands.order.static", () => {
    // A static export orders bands as the live model does.
    const config: ChartConfig = {
      x: { domain: ["West", "Central", "North"] },
      marks: [bar(sales(), { x: "region", y: "revenue" })],
    };
    const svg = renderToSVG({ ...config, width: 600, height: 300 });
    const labels = [...svg.matchAll(/<text[^>]*>(North|South|East|West|Central)<\/text>/g)].map(
      (m) => m[1],
    );
    expect(labels).toEqual(xScale(build(config).model)!.categories);
  });

  contractTest("axis.bands.order.spec", () => {
    // Specs take the list; it orders the axis as options do.
    const spec = {
      version: 1,
      data: { sales: { columns: { region: ["a", "b", "c"], v: [1, 2, 3] } } },
      x: { domain: ["c", "zzz", "a"] },
      marks: [{ type: "bar", data: "sales", x: "region", y: "v" }],
    };
    expect(() => validateSpec(spec)).not.toThrow();
    const { config } = loadSpec(spec as never, []);
    const model = new ChartModel({ locale: "en-US", timeZone: "UTC", ...config });
    model.setSize(600, 300, 1);
    model.scene(estimateText);
    expect(xScale(model)!.categories).toEqual(["c", "zzz", "a", "b"]);
  });

  contractTest("axis.bands.order.three-d", () => {
    // 3D category axes take the listed order too.
    const svg = renderToSVG({
      width: 600,
      height: 600,
      x: { domain: ["West", "North"] },
      marks: [surface(sales(), { x: "region", y: "year", z: "revenue" })],
    });
    const labels = [...svg.matchAll(/>(North|South|East|West)</g)].map((m) => m[1]);
    expect([...new Set(labels)]).toEqual(["West", "North", "South", "East"]);
  });

  contractTest("axis.bands.order.refused", () => {
    const bars = [bar(sales(), { x: "region", y: "revenue" })];
    const refused = (config: ChartConfig) => () => build(config);
    expect(refused({ x: { domain: [0, 3] }, marks: bars })).toThrow(
      "chart x.domain: the axis shows categories; list them in order, or drop domain",
    );
    expect(refused({ y: { domain: ["North"] }, marks: bars })).toThrow(
      "chart y.domain: the axis shows numbers or times; give its two ends, or drop domain",
    );
    const numbers = table({ t: [0, 1, 2], v: [1, 2, 3] });
    expect(
      refused({
        x: { domain: ["a"] },
        y: { domain: ["a"] },
        marks: [heatmap(numbers, { x: "t", y: "v", color: "v", xBanded: true, yBanded: true })],
      }),
    ).toThrow("chart x.domain: the axis shows bands of numbers or times; drop domain");
    // Only on the scale the list orders: a subplot with an x of its own bands
    // numbers beside one listing categories; in the same subplot, it is refused.
    const cells = heatmap(numbers, { x: "t", y: "v", color: "v", xBanded: true, panel: "two" });
    const regions = bar(sales(), { x: "region", y: "revenue", panel: "one" });
    const ordered = { id: "one", x: { domain: ["West", "North"] } };
    const apart = build({
      x: { scope: "panel" },
      panels: panels([ordered, { id: "two" }]),
      marks: [regions, cells],
    }).model;
    expect(apart.panels().map(({ x }) => x.categories?.slice(0, 2))).toEqual([
      ["West", "North"],
      ["0", "1"],
    ]);
    expect(
      refused({
        x: { scope: "panel" },
        panels: panels([ordered, { id: "two", x: { domain: ["a"] } }]),
        marks: [regions, cells],
      }),
    ).toThrow("panels[1].x.domain: the axis shows bands of numbers or times; drop domain");
    // A y every subplot shares takes its first panel's settings, as x does.
    const across = (y: object) => ({
      y: { scope: "chart" as const, domain: [0, 100] as const },
      panels: panels([
        { id: "p", y },
        { id: "q", y },
      ]),
      marks: ["p", "q"].map((id) => bar(sales(), { x: "revenue", y: "region", panel: id })),
    });
    expect(
      build(across({ domain: ["West", "North"] }))
        .model.panels()
        .map(({ y }) => y.categories),
    ).toEqual([
      ["West", "North", "South", "East"],
      ["West", "North", "South", "East"],
    ]);
    expect(refused(across({ domain: [0, 3] }))).toThrow(
      "chart y.domain: the axis shows categories; list them in order, or drop domain",
    );
    // ...from the first panel drawing on that side: p draws only on the right.
    const letters = table({ k: category(["a", "b"]), v: [1, 2] });
    const sides = build({
      y: { scope: "chart", domain: [0, 100] },
      panels: panels([{ id: "p" }, { id: "q", y: { domain: ["b", "a"] } }]),
      marks: [
        bar(letters, { x: "v", y: "v", axis: "right", panel: "p" }),
        bar(letters, { x: "v", y: "k", panel: "q" }),
      ],
    }).model;
    expect(sides.panels()[1]!.y.categories).toEqual(["b", "a"]);
    // A list on the left y of a panel drawing only on the right orders nothing.
    const unused = build({
      y: { scope: "chart" },
      panels: panels([
        { id: "p", y: { domain: ["a", "b"] } },
        { id: "q", y: { domain: ["b", "a"] } },
      ]),
      marks: [
        bar(letters, { x: "v", y: "v", axis: "right", panel: "p" }),
        bar(letters, { x: "v", y: "k", panel: "q" }),
      ],
    }).model;
    expect(unused.panels()[1]!.y.categories).toEqual(["b", "a"]);
    // A list in one panel leaves another's bands of numbers rising.
    const rising = (own?: { domain: string[] }) => {
      const { model } = build({
        panels: panels([own ? { id: "p", y: own } : { id: "p" }, { id: "q" }]),
        marks: [
          bar(rowView(letters, { filter: false }), { x: "v", y: "k", panel: "p" }),
          heatmap(table({ x: [0, 1], y: [1, 2], v: [1, 2] }), {
            x: "x",
            y: "y",
            color: "v",
            yBanded: true,
            panel: "q",
          }),
        ],
      });
      const scale = model.panels()[1]!.y;
      return scale.map(0) > scale.map(1);
    };
    expect([rising(), rising({ domain: ["b", "a"] })]).toEqual([true, true]);
    // Scales of the chart's own are continuous.
    expect(() =>
      renderToSVG({
        width: 400,
        height: 300,
        scales: { depth: { type: "linear", domain: ["a"] } },
        marks: [line(numbers, { x: { field: "t", scale: "depth" }, y: "v" })],
      }),
    ).toThrow(
      expect.objectContaining({
        name: "ChartError",
        code: "invalid-option",
        path: "scales.depth.domain",
        message:
          "chart scales.depth.domain: the axis shows numbers or times; give its two ends, or drop domain",
      }),
    );
    expect(() =>
      renderToSVG({
        width: 400,
        height: 300,
        x: { domain: [0, 1] },
        marks: [surface(sales(), { x: "region", y: "year", z: "revenue" })],
      }),
    ).toThrow("chart x.domain: the axis shows categories; list them in order");
  });

  contractTest("axis.bands.order.refused.spec", () => {
    const spec = (x: object) => ({
      version: 1,
      data: { sales: { columns: { region: ["a", "b"], v: [1, 2] } } },
      x,
      marks: [{ type: "bar", data: "sales", x: "region", y: "v" }],
    });
    expect(() => validateSpec(spec({ domain: ["a", "a"] }))).toThrow(
      "x.domain: expected each category once; received an array",
    );
    expect(() => validateSpec(spec({ domain: ["a", 2] }))).toThrow(
      "x.domain[1]: expected a string; received 2",
    );
    // An axis of a continuous type takes two ends.
    expect(() => validateSpec(spec({ type: "linear", domain: ["a"] }))).toThrow(
      'x.domain[0]: expected a finite number; received "a"',
    );
    expect(() => validateSpec(spec({ domain: [1, 2, 3] }))).toThrow(
      "x.domain: expected two numbers, or categories in their order; received an array",
    );
    expect(() => validateSpec({ ...spec({}), scales: { x: { domain: ["a", "a"] } } })).toThrow(
      "scales.x.domain: expected each category once; received an array",
    );
  });
});
