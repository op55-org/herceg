// What items stand for (model/provenance.ts): each mark's groups (its
// position's category or bin, its series, a node's path, a link's ends, its
// `itemKey` value, its panel's facet values), the condition its rows meet on
// its mark's table (a view's filter included; none for rows named by their
// identity or a restricted view), that condition through derived tables,
// and its rows, which the condition names wherever it says them.
import { describe, expect, it } from "vitest";
import { sum } from "../../src/data/aggregations.ts";
import { derive } from "../../src/data/derive.ts";
import { col } from "../../src/data/expr.ts";
import { compileExpression, type Expression } from "../../src/data/expression.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { rowView } from "../../src/data/row-view.ts";
import { type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { funnel } from "../../src/marks/funnel.ts";
import { geopoint } from "../../src/marks/geopoint.ts";
import { graph } from "../../src/marks/graph.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { binGroup } from "../../src/marks/histogram2d.ts";
import type { Mark, MarkKey } from "../../src/marks/mark.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { sankey } from "../../src/marks/sankey.ts";
import type { Series } from "../../src/marks/series.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { violin } from "../../src/marks/violin.ts";
import { facet } from "../../src/model/facet.ts";
import { itemResolver } from "../../src/model/items.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { Picker } from "../../src/model/pick.ts";
import { provenanceOf, rowsOfItem } from "../../src/model/provenance.ts";
import type { RectGeometry } from "../../src/scene/scene.ts";
import { pickKit } from "../helpers/picker.ts";
import { xScale, yScale } from "../helpers/scales.ts";

function build(config: ChartConfig) {
  const model = new ChartModel({ locale: "en-US", timeZone: "UTC", ...config });
  model.setSize(600, 300, 1);
  model.scene(estimateText);
  return model;
}

const picker = new Picker(pickKit);

/** The rows of `t` where `condition` holds. */
function where(t: object, condition: Expression | null | undefined): number[] {
  const of = t as Table;
  const holds = compileExpression(condition as Expression, of);
  return Array.from({ length: of.length }, (_, i) => i).filter((i) => holds.at(i));
}

/**
 * What the item keyed `key` of mark `index`, drawn in `panel`, stands for,
 * and its rows now, as `picked` says (see `rowsOfItem`).
 */
function standsFor(
  model: ChartModel,
  index: number,
  key: string,
  panel = "",
  picked?: { series: Series; position: number } | "group",
) {
  const marks = model.config.marks as Mark[];
  const resolver = itemResolver(
    marks.map((mark, i) => ({ mark, key: (mark.spec.id ?? i) as MarkKey })),
  );
  const mark = marks[index]!;
  return {
    ...provenanceOf(model, mark, key, panel),
    rows: rowsOfItem(model, resolver, mark, key, panel, picked),
  };
}

/** What the item picked at pixel (x, y) stands for, as a click's target says it. */
function clicked(model: ChartModel, x: number, y: number) {
  const picked = picker.pick(model, { x, y, slop: 4 });
  if (!picked) throw new Error(`nothing at ${x}, ${y}`);
  const marks = model.config.marks as Mark[];
  const index =
    typeof picked.key === "number" ? picked.key : marks.findIndex((m) => m.spec.id === picked.key);
  const { part } = picked.item;
  const resolver = itemResolver(
    marks.map((mark, i) => ({ mark, key: (mark.spec.id ?? i) as MarkKey })),
  );
  const key =
    part.kind === "group"
      ? part.key
      : resolver.keyOfRow(picked.key, {
          table: part.table,
          position: part.position,
          series: picked.series,
        });
  return standsFor(
    model,
    index,
    key,
    picked.drawn.panel,
    part.kind === "group" ? (part.point ?? "group") : undefined,
  );
}

/** The center of rectangle `i` of the first rectangles mark `m` drew in its panel. */
function rectAt(model: ChartModel, i: number, m = 0): [number, number] {
  const rects = (model.drawnMarks()[m]!.geometry.find((g) => g.kind === "rect") as RectGeometry)
    .rects;
  return [rects[i * 4]! + rects[i * 4 + 2]! / 2, rects[i * 4 + 1]! + rects[i * 4 + 3]! / 2];
}

/** That the item's rows are those its condition names. */
function expectRowsMatch(item: ReturnType<typeof standsFor>, of: object) {
  expect([...item.rows!().positions]).toEqual(where(of, item.condition));
}

describe("rows marks", () => {
  const sales = () =>
    table({
      month: ["Jan", "Jan", "Feb", "Feb", "Jan"],
      region: ["N", "S", "N", "S", "N"],
      revenue: [5, 6, 7, 8, 2],
    });

  it("name a bar by its position and series, holding every row stacked there", () => {
    const data = sales();
    const model = build({
      marks: [bar(data, { x: "month", y: "revenue", series: "region", stack: true })],
    });
    const item = clicked(model, ...rectAt(model, 0));
    expect(item.groups).toEqual([
      { field: "month", value: "Jan" },
      { field: "region", value: "N" },
    ]);
    expect(item.rows!().positions).toEqual(Uint32Array.of(0, 4));
    expectRowsMatch(item, data);
    expect(item.source).toBeUndefined();
  });

  it("name a row by its itemKey value, and a row without one by nothing a condition says", () => {
    const data = table({ id: ["a", "b", "a"], x: [0, 5, 10], y: [0, 5, 10] });
    const keyed = build({ marks: [point(data, { x: "x", y: "y", itemKey: "id" })] });
    const at = (model: ChartModel, x: number, y: number) =>
      clicked(model, xScale(model)!.map(x), yScale(model)!.map(y));
    const named = at(keyed, 10, 10);
    expect(named).toMatchObject({ groups: [{ field: "id", value: "a" }] });
    // A shared name is one item: both its rows.
    expect([...named.rows!().positions]).toEqual([0, 2]);
    expectRowsMatch(named, data);
    const plain = at(build({ marks: [point(data, { x: "x", y: "y" })] }), 5, 5);
    expect(plain).toMatchObject({ groups: [], condition: null, source: undefined });
    expect([...plain.rows!().positions]).toEqual([1]);
  });

  it("add a view's filter, and say nothing for a view restricted to rows", () => {
    const data = sales();
    const view = rowView(data, { filter: col("revenue").gt(4) });
    const model = build({ marks: [bar(view, { x: "month", y: "revenue", series: "region" })] });
    const item = clicked(model, ...rectAt(model, 0));
    expect(item.condition).toEqual([
      "and",
      ["and", ["==", ["field", "month"], "Jan"], ["==", ["field", "region"], "N"]],
      [">", ["field", "revenue"], 4],
    ]);
    // Row 4 (Jan, N) is filtered out.
    expect([...item.rows!().positions]).toEqual([0]);
    expectRowsMatch(item, data);
    const restricted = rowView(data);
    restricted.restrict(new RowSet(data).addAll([0, 1]));
    const only = build({
      marks: [bar(restricted, { x: "month", y: "revenue", series: "region" })],
    });
    const held = clicked(only, ...rectAt(only, 0));
    expect(held.condition).toBeNull();
    expect([...held.rows!().positions]).toEqual([0]);
  });

  it("add the facet values of the panel an item is drawn in", () => {
    const data = sales();
    const model = build({
      marks: [bar(data, { x: "month", y: "revenue" })],
      facet: facet("region"),
    });
    const panel = model.drawnMarks().find((d) => d.panel === "S")!;
    const rects = (panel.geometry.find((g) => g.kind === "rect") as RectGeometry).rects;
    const item = clicked(model, rects[0]! + rects[2]! / 2, rects[1]! + rects[3]! / 2);
    expect(item.groups).toEqual([
      { field: "month", value: "Jan" },
      { field: "region", value: "S" },
    ]);
    expect([...item.rows!().positions]).toEqual([1]);
    expectRowsMatch(item, data);
  });
});

describe("aggregates", () => {
  it("name a histogram's bins by their intervals, the last holding its right edge", () => {
    const data = table({ v: [0, 1, 2, 3, 4, 10], w: [1, 1, Number.NaN, 1, -1, 1] });
    const model = build({ marks: [histogram(data, { x: "v", bins: [0, 5, 10] })] });
    const first = clicked(model, ...rectAt(model, 0));
    expect(first.groups).toEqual([{ field: "v", from: 0, to: 5 }]);
    expectRowsMatch(first, data);
    const last = clicked(model, ...rectAt(model, 1));
    expect(last.groups).toEqual([{ field: "v", from: 5, to: 10, closed: true }]);
    expect([...last.rows!().positions]).toEqual([5]);
    // Weighted bins hold rows of a usable weight; cumulative ones run from the first edge.
    const weighted = build({
      marks: [histogram(data, { x: "v", bins: [0, 5, 10], weight: "w", cumulative: true })],
    });
    const whole = clicked(weighted, ...rectAt(weighted, 1));
    expect(whole.groups).toEqual([
      { field: "v", from: 0, to: 10, closed: true },
      { field: "w", from: 0, to: Number.MAX_VALUE, closed: true },
    ]);
    expect([...whole.rows!().positions]).toEqual([0, 1, 3, 5]);
    expectRowsMatch(whole, data);
  });

  it("name heatmap cells, boxes, and violins by their categories and series, of rows with values", () => {
    const data = table({
      day: ["Mon", "Mon", "Tue", "Tue", "Tue", "Tue"],
      hour: ["9", "10", "9", "9", "9", "9"],
      load: [1, 2, 3, 4, Number.NaN, Number.POSITIVE_INFINITY],
      site: ["a", "b", "a", "b", "b", "b"],
    });
    const finite = { field: "load", from: -Number.MAX_VALUE, to: Number.MAX_VALUE, closed: true };
    const cells = build({ marks: [heatmap(data, { x: "day", y: "hour", color: "load" })] });
    const cell = standsFor(cells, 0, JSON.stringify([0, "Tue", "9"]));
    expect(cell.groups).toEqual([
      { field: "day", value: "Tue" },
      { field: "hour", value: "9" },
      finite,
    ]);
    expect([...cell.rows!().positions]).toEqual([2, 3]);
    expectRowsMatch(cell, data);
    for (const make of [boxplot, violin]) {
      const model = build({ marks: [make(data, { x: "day", y: "load", series: "site" })] });
      const box = standsFor(model, 0, JSON.stringify([0, "b", "Tue"]));
      expect(box.groups).toEqual([
        { field: "day", value: "Tue" },
        { field: "site", value: "b" },
        finite,
      ]);
      expect([...box.rows!().positions]).toEqual([3]);
      expectRowsMatch(box, data);
    }
    // A precomputed box is a row of its five statistics.
    const stats = table({
      day: ["Mon", "Tue", "Tue"],
      low: [0, 1, Number.NaN],
      q1: [1, 2, 2],
      median: [2, 3, 3],
      q3: [3, 4, 4],
      high: [4, 5, 5],
    });
    const spec = { x: "day", low: "low", q1: "q1", median: "median", q3: "q3", high: "high" };
    const boxes = build({ marks: [boxplot(stats, spec as never)] });
    const box = standsFor(boxes, 0, JSON.stringify([0, "Tue"]));
    expect(box.groups.map((g) => g.field)).toEqual(["day", "q1", "median", "q3", "low", "high"]);
    expect([...box.rows!().positions]).toEqual([1]);
    expectRowsMatch(box, stats);
    // Boxes sharing a category are each their row, which no group names.
    const repeated = table({
      day: ["Tue", "Tue"],
      low: [0, 10],
      q1: [1, 11],
      median: [2, 12],
      q3: [3, 13],
      high: [4, 14],
    });
    const two = build({ marks: [boxplot(repeated, spec as never)] });
    const first = standsFor(two, 0, JSON.stringify([0, "Tue"]));
    expect(first.groups).toEqual([]);
    expect(first.condition).toBeNull();
  });

  it("give a bin panels bin otherwise no condition, and the rows it counts in its panel", () => {
    const data = table({
      v: [10, 15, 20, 0, 12, 20, 30],
      site: ["a", "a", "a", "b", "b", "b", "b"],
    });
    const model = build({
      marks: [histogram(data, { x: "v", bins: { step: 10 } })],
      facet: facet("site"),
      x: { scope: "panel" },
    });
    // Panel a's one bin, 10 to 20, holds 20; panel b's 10 to 20 does not.
    const binOf = (panel: string, i: number) => {
      const drawn = model.drawnMarks().find((d) => d.panel === panel)!;
      const rects = (drawn.geometry.find((g) => g.kind === "rect") as RectGeometry).rects;
      return clicked(model, rects[i * 4]! + rects[i * 4 + 2]! / 2, rects[i * 4 + 1]! + 2);
    };
    const [a, b] = [binOf("a", 0), binOf("b", 1)];
    for (const bin of [a, b]) {
      expect(bin.condition).toBeNull();
      expect(bin.groups).toEqual([]);
    }
    expect([...a.rows!().positions]).toEqual([0, 1, 2]);
    expect([...b.rows!().positions]).toEqual([4]);
  });

  it("name a bin only where every panel's binning bins it alike", () => {
    const [field, bin] = ["v", [10, 20] as const];
    const last = Float64Array.of(0, 10, 20);
    const middle = Float64Array.of(0, 10, 20, 30);
    expect(binGroup(field, bin, [last])).toEqual({ field, from: 10, to: 20, closed: true });
    expect(binGroup(field, bin, [middle, middle])).toEqual({ field, from: 10, to: 20 });
    // One panel's last bin, another's middle one: no one interval says both.
    expect(binGroup(field, bin, [last, middle])).toBeUndefined();
    // Cumulative bins start at each binning's first edge.
    expect(binGroup(field, bin, [middle, Float64Array.of(5, 10, 20, 30)], true)).toBeUndefined();
    expect(binGroup(field, [40, 50], [middle])).toBeUndefined();
  });
});

describe("layout items", () => {
  /** The key of the item labelled `label` of the chart's one layout. */
  const keyOf = (model: ChartModel, label: string) => {
    const layout = model.drawnMarks().find((d) => d.layout)!.layout!;
    for (let i = 0; i < layout.count; i++) {
      const item = layout.item(i);
      if (item.label === label) return item.key;
    }
    throw new Error(`no item ${label}`);
  };

  it("name a slice by its category, of rows with a positive value", () => {
    const data = table({ region: ["N", "S", "N", "N"], revenue: [3, 4, -1, 5] });
    const model = build({ marks: [pie(data, { category: "region", value: "revenue" })] });
    const slice = standsFor(model, 0, keyOf(model, "N"), "", "group");
    expect(slice.groups).toEqual([
      { field: "region", value: "N" },
      { field: "revenue", from: Number.MIN_VALUE, to: Number.MAX_VALUE, closed: true },
    ]);
    expect([...slice.rows!().positions]).toEqual([0, 3]);
    expectRowsMatch(slice, data);
    const stages = build({ marks: [funnel(data, { category: "region", value: "revenue" })] });
    const stage = standsFor(stages, 0, keyOf(stages, "N"), "", "group");
    expect(stage.groups).toEqual([{ field: "region", value: "N" }]);
    expectRowsMatch(stage, data);
  });

  it("name a tree's node by its path, holding every row under it", () => {
    const data = table({
      region: ["Europe", "Europe", "Asia", "Europe"],
      country: ["France", "Spain", "Japan", "France"],
      sales: [1, 2, 3, 4],
    });
    const model = build({
      marks: [treemap(data, { path: ["region", "country"], value: "sales" })],
    });
    const node = standsFor(model, 0, JSON.stringify([0, "Europe"]), "", "group");
    expect(node.groups).toEqual([{ field: "region", value: "Europe" }]);
    expect([...node.rows!().positions]).toEqual([0, 1, 3]);
    const leaf = standsFor(model, 0, JSON.stringify([0, "Europe", "France"]), "", "group");
    expect(leaf.groups).toEqual([
      { field: "region", value: "Europe" },
      { field: "country", value: "France" },
    ]);
    expectRowsMatch(leaf, data);
  });

  it("name a Sankey link by its ends, and a node by the links drawn into and out of it", () => {
    const data = table({
      from: ["a", "a", "b", "c", "a"],
      to: ["b", "c", "c", "a", "b"],
      flow: [1, 2, 3, 4, -1],
    });
    const model = build({ marks: [sankey(data, { source: "from", target: "to", value: "flow" })] });
    const link = standsFor(model, 0, JSON.stringify([0, "a", "b"]), "", "group");
    expect(link.groups).toEqual([
      { field: "from", value: "a" },
      { field: "to", value: "b" },
      { field: "flow", from: Number.MIN_VALUE, to: Number.MAX_VALUE, closed: true },
    ]);
    expect([...link.rows!().positions]).toEqual([0]);
    expectRowsMatch(link, data);
    // c to a closes a cycle and is not drawn: node a holds a to b and a to c.
    const node = standsFor(model, 0, JSON.stringify([0, "a"]), "", "group");
    expect(node.groups).toEqual([]);
    expect([...node.rows!().positions]).toEqual([0, 1]);
    expectRowsMatch(node, data);
  });
});

describe("items of other tables and of rows", () => {
  it("give a network's node its row of the nodes table, and a map's point its row", () => {
    const links = table({ source: ["a", "b"], target: ["b", "c"] });
    const nodes = table({ node: ["a", "b", "c"], group: ["x", "y", "x"] });
    const network = build({
      marks: [graph(links, { source: "source", target: "target", nodes, node: "node" })],
    });
    const layout = network.drawnMarks().find((d) => d.layout)!.layout!;
    let key = "";
    for (let i = 0; i < layout.count; i++)
      if (layout.item(i).label === "b") key = layout.item(i).key;
    const node = standsFor(network, 0, key, "", "group");
    expect(node.rows!().table).toBe(nodes);
    expect([...node.rows!().positions]).toEqual([1]);
    const places = table({ lon: [2, 13], lat: [48, 52] });
    const map = build({ marks: [geopoint(places, { longitude: "lon", latitude: "lat" })] });
    const marks = map.config.marks as Mark[];
    const resolver = itemResolver(marks.map((mark, i) => ({ mark, key: i as MarkKey })));
    const row = { table: places as unknown as Table, position: 1 };
    const point = standsFor(map, 0, resolver.keyOfRow(0, row), "");
    expect([...point.rows!().positions]).toEqual([1]);
  });
});

describe("through derived tables", () => {
  it("write a monthly bar's rows on the day table, filters included", () => {
    const days = table(
      {
        day: [0, 1, 2, 31, 32, 40],
        region: ["N", "S", "N", "N", "S", "N"],
        revenue: [5, 6, 7, 8, 9, 1],
      },
      { name: "days" },
    );
    const monthly = derive(days)
      .filter(col("revenue").gt(2))
      .bin("day", { bins: { step: 30 }, as: "month" })
      .aggregate({ by: ["month", "region"], ops: { revenue: sum("revenue") } })
      .table();
    const model = build({
      marks: [bar(monthly, { x: "month", y: "revenue", series: "region", itemKey: "month" })],
    });
    const at = monthly.length - 1;
    const item = standsFor(model, 0, JSON.stringify([0, monthly.value("month", at)]));
    expect(item.source?.table).toBe("days");
    // The second month's days (30 to 60) of a revenue above 2: rows 3 and 4, not 5.
    expect(where(days, item.source!.condition)).toEqual([3, 4]);
  });
});
