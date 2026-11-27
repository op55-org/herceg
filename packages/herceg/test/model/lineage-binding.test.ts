import { describe, expect, it } from "vitest";
import { count, max, mean, min, sum } from "../../src/data/aggregations.ts";
import type { ColumnInput } from "../../src/data/column.ts";
import { contributorsOf } from "../../src/data/contributor-records.ts";
import { relationTo } from "../../src/data/contributors.ts";
import { deriveTable } from "../../src/data/derive.ts";
import { col } from "../../src/data/expr.ts";
import { groupRows } from "../../src/data/groups.ts";
import { pivotRows } from "../../src/data/pivot.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { rowView } from "../../src/data/row-view.ts";
import { selectionStore, selectRows, selectWhere } from "../../src/data/selection.ts";
import { type Table, table as typed } from "../../src/data/table.ts";
import { rowTotals } from "../../src/data/totals.ts";
import { copied } from "../../src/dom/grid-copy.ts";
import { createGridModel } from "../../src/grid/model.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { line } from "../../src/marks/line.ts";
import type { ChartMark } from "../../src/marks/mark.ts";
import { DIM } from "../../src/marks/mark.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { type LineageKit, lineage } from "../../src/model/lineage-kit.ts";
import { ChartModel } from "../../src/model/model.ts";
import { rowSelection, type SelectionBinding } from "../../src/model/row-selection.ts";
import type { Geometry, RectGeometry } from "../../src/scene/scene.ts";
import type { ChartError } from "../../src/spec/errors.ts";
import { contractTest } from "../helpers/contracts.ts";
import { withPicker } from "../helpers/picker.ts";

/** Tables as charts read them, whatever their fields. */
const table = (columns: Record<string, ColumnInput>, name = "sales"): Table =>
  typed(columns, { name }) as unknown as Table;

/** Sales of three regions, North's revenue 10 + 20 + 30, South's 5 + 15, East's 40. */
function sales() {
  return table({
    region: ["North", "North", "North", "South", "South", "East"],
    kind: ["a", "b", "a", "b", "a", "b"],
    day: [1, 2, 3, 1, 2, 3],
    revenue: [10, 20, 30, 5, 15, 40],
    margin: [1, -2, 3, 4, 5, 6],
  });
}

function drawn(marks: ChartMark[], binding: SelectionBinding) {
  const selection = rowSelection(binding);
  const model = withPicker(
    new ChartModel({ locale: "en-US", timeZone: "UTC", marks, rowSelection: selection }),
  );
  model.setSize(600, 400, 1);
  selection.highlight(model);
  const geometry = () => model.scene(estimateText).panels[0]!.marks;
  geometry();
  return { model, geometry };
}

/** A rect geometry's bars as [x, y, width, height]. */
const boxes = (g: Geometry) => {
  const r = g as RectGeometry;
  return Array.from({ length: r.count }, (_, i) => Array.from(r.rects.subarray(i * 4, i * 4 + 4)));
};

describe("a bar of groups bound to their source's store", () => {
  contractTest(
    "selection.lineage.parts",
    () => {
      const source = sales();
      const store = selectionStore(source);
      const byRegion = groupRows(rowView(source), {
        by: ["region"],
        ops: { revenue: sum("revenue") },
      });
      store.set("days", selectWhere(col("day").le(2)));
      const { model, geometry } = drawn(
        [bar(byRegion.table as unknown as Table, { x: "region", y: "revenue" })],
        { store, channel: "days", lineage },
      );
      const parts = geometry().filter((g) => g.kind === "rect");
      const key = (g: Geometry) => g.key.split("\u0001")[1];
      const [panel] = model.panels();
      const y = panel!.y;
      const lower = parts.find((g) => key(g) === "lower")!;
      const upper = parts.find((g) => key(g) === "upper")!;
      // North: 30 of 60 selected; South: all of it; East: none.
      expect(
        boxes(lower).map(([, top, , height]) => [y.invert(top!), y.invert(top! + height!)]),
      ).toEqual([[30, 0]]);
      expect(
        boxes(upper).map(([, top, , height]) => [
          Math.round(y.invert(top!)),
          Math.round(y.invert(top! + height!)),
        ]),
      ).toEqual([[60, 30]]);
      expect((upper as RectGeometry).fillOpacity).toBeCloseTo(DIM);
      expect(parts.find((g) => key(g) === "on")!.key).toContain("on");
      expect(boxes(parts.find((g) => key(g) === "off")!)).toHaveLength(1);
    },
    "draws each group's selected sum from its base, the rest dimmed above it",
  );

  contractTest(
    "selection.lineage.opt-in",
    () => {
      const source = sales();
      const byRegion = groupRows(rowView(source), { by: ["region"], ops: { n: count() } });
      expect(() =>
        drawn([bar(byRegion.table as unknown as Table, { x: "region", y: "n" })], {
          store: selectionStore(source),
          channel: "days",
        }),
      ).toThrow(
        /rowSelection lineage: bar \(mark 0\) reads .*, which comes from "sales"; give rowSelection\(\{ store, channel, lineage \}\), with import \{ lineage \} from "herceg"/,
      );
    },
    "refuses the binding without the lineage reader, naming the import",
  );

  contractTest(
    "selection.lineage.partial",
    () => {
      const source = sales();
      const store = selectionStore(source);
      const byRegion = groupRows(rowView(source), {
        by: ["region"],
        ops: { average: mean("revenue") },
      });
      store.set("days", selectWhere(col("day").le(2)));
      const { geometry } = drawn(
        [bar(byRegion.table as unknown as Table, { x: "region", y: "average" })],
        { store, channel: "days", lineage },
      );
      const partial = geometry().find((g) => g.key.endsWith("\u0001partial")) as RectGeometry;
      expect(partial.count).toBe(1);
      expect(partial.edge).toMatchObject({ width: 1.5, opacity: 1 });
      expect(partial.fillOpacity).toBeCloseTo(DIM);
    },
    "draws means some of whose rows are selected in the partial look",
  );

  it("draws in the partial look what no selected part measures", () => {
    const source = sales();
    const store = selectionStore(source);
    store.set("days", selectWhere(col("day").le(2)));
    /** The parts a bar of `y` over `target` draws, by region: North's first. */
    const partsOf = (target: Table, y: string) => {
      const { geometry } = drawn([bar(target, { x: "region", y })], {
        store,
        channel: "days",
        lineage,
      });
      return geometry()
        .filter((g) => g.kind === "rect")
        .map((g) => g.key.split("\u0001")[1])
        .sort();
    };
    // A sum with a negative contribution: North's margins 1, -2, and 3.
    const margins = groupRows(rowView(source), { by: ["region"], ops: { margin: sum("margin") } });
    expect(partsOf(margins.table as unknown as Table, "margin")).toEqual(["off", "on", "partial"]);
    // A sum of sums: nested aggregates.
    const nested = deriveTable(source, [
      { aggregate: [{ op: "sum", field: "revenue", as: "revenue" }], by: ["region", "kind"] },
      { aggregate: [{ op: "sum", field: "revenue", as: "revenue" }], by: ["region"] },
    ]);
    expect(partsOf(nested, "revenue")).toEqual(["off", "on", "partial"]);
    // A sum of a calculated field.
    const doubled = deriveTable(source, [
      { calculate: ["*", ["field", "revenue"], 2], as: "doubled" },
      { aggregate: [{ op: "sum", field: "doubled", as: "doubled" }], by: ["region"] },
    ]);
    expect(partsOf(doubled, "doubled")).toEqual(["off", "on", "partial"]);
    // A rolling window's sums, two rows of a region each: North's last of days 2 and 3.
    const rolled = deriveTable(source, [
      { rolling: [{ op: "sum", field: "revenue", as: "rolled" }], size: 2, by: ["region"] },
    ]);
    expect(partsOf(rolled, "rolled")).toContain("partial");
    expect(partsOf(rolled, "rolled")).not.toContain("lower");
  });

  it("draws each stacked or normalized segment's selected part from its own base", () => {
    const source = sales();
    const store = selectionStore(source);
    store.set("days", selectWhere(col("day").le(2)));
    // North's a: 10 of 40 selected, under its b: 20, all selected.
    const byKind = groupRows(rowView(source), {
      by: ["region", "kind"],
      ops: { revenue: sum("revenue") },
    });
    const target = byKind.table as unknown as Table;
    for (const stack of [true, "fill"] as const) {
      const { model, geometry } = drawn(
        [bar(target, { x: "region", y: "revenue", series: "kind", stack })],
        { store, channel: "days", lineage },
      );
      const y = model.panels()[0]!.y;
      const ends = (name: string) => {
        const g = geometry().find((g) => g.kind === "rect" && g.key.endsWith(`\u0001${name}`))!;
        return boxes(g).map(([, top, , height]) => [y.invert(top! + height!), y.invert(top!)]);
      };
      const [[base, middle]] = ends("lower") as [[number, number]];
      const [[from, top]] = ends("upper") as [[number, number]];
      expect(base).toBeCloseTo(0);
      expect(from).toBeCloseTo(middle);
      // A quarter of the segment, from its base: 10 of 40, or 10 of 60's share.
      expect(middle / top).toBeCloseTo(0.25);
      expect(top).toBeCloseTo(stack === "fill" ? 40 / 60 : 40);
    }
  });
});

const noKeys = { shiftKey: false, ctrlKey: false, metaKey: false };

/** A chart of `marks` mounted as its row selection sees it, without a DOM. */
function mounted(marks: ChartMark[], binding: SelectionBinding, brush?: "x" | "y" | "lasso") {
  const selection = rowSelection(binding);
  const errors: unknown[] = [];
  const model = withPicker(
    new ChartModel({
      locale: "en-US",
      timeZone: "UTC",
      marks,
      rowSelection: selection,
      ...(brush && { interaction: { brush } }),
    }),
  );
  model.setSize(600, 400, 1);
  model.report = (error) => errors.push(error);
  const host = { selection: null, clear() {}, render() {} };
  const live = { textContent: "" as string | null };
  const link = selection.mount(
    undefined,
    model,
    host,
    { emit() {} },
    () => {},
    () => 0,
    () => null,
    live,
  );
  const geometry = () => model.scene(estimateText).panels[0]!.marks;
  geometry();
  return { model, link, selection, geometry, errors };
}

/** What a channel holds, as positions, or its condition. */
function held(store: ReturnType<typeof selectionStore>, channel: string) {
  const selection = store.get(channel);
  return selection?.kind === "rows" ? Array.from(selection.rows.positions()) : selection;
}

describe("gestures on a bar of groups through lineage", () => {
  const setup = (brush?: "x" | "y" | "lasso") => {
    const source = sales();
    const store = selectionStore(source);
    const byRegion = groupRows(rowView(source), {
      by: ["region"],
      ops: { revenue: sum("revenue") },
    });
    const target = byRegion.table as unknown as Table;
    const chart = mounted(
      [bar(target, { x: "region", y: "revenue" })],
      { store, channel: "regions", lineage },
      brush,
    );
    const [panel] = chart.model.panels();
    // A bar's middle, by its region's band and half its value.
    const at = (region: number, value: number) =>
      [panel!.x.map(region), panel!.y.map(value / 2)] as const;
    return { source, store, target, ...chart, at };
  };

  contractTest(
    "selection.lineage.click",
    () => {
      const { store, link, at } = setup();
      link.clicked(...at(0, 60), noKeys)?.();
      expect(held(store, "regions")).toEqual([0, 1, 2]);
      link.clicked(...at(2, 40), { ...noKeys, shiftKey: true })?.();
      expect(held(store, "regions")).toEqual([0, 1, 2, 5]);
      link.clicked(...at(0, 60), { ...noKeys, metaKey: true })?.();
      expect(held(store, "regions")).toEqual([5]);
    },
    "writes a click's contributors as rows: Shift adds, Ctrl or Cmd toggles",
  );

  contractTest(
    "selection.lineage.brush",
    () => {
      const { store, link } = setup("x");
      link.brushed(
        { kind: "brush", x: [0.6, 2.4], y: null, lasso: null },
        null,
        true,
        "pointer",
        0,
      );
      expect(held(store, "regions")).toEqual([3, 4, 5]);
    },
    "writes a brush along its groups' axis as the rows of the groups it holds",
  );

  contractTest(
    "selection.lineage.items",
    () => {
      const { store, link } = setup();
      link.brushed({ kind: "items", items: ['[0,"revenue","South"]'] }, null, true, "pointer", 0);
      expect(held(store, "regions")).toEqual([3, 4]);
      link.brushed({ kind: "series", series: ['[0,"revenue"]'] }, null, true, "pointer", 0);
      expect(held(store, "regions")).toEqual([0, 1, 2, 3, 4, 5]);
    },
    "writes items' and series' rows behind them",
  );

  it("writes a lasso's items' rows behind them", () => {
    const { store, link } = setup("lasso");
    // Around South's bar: its band, from below its base to above its top.
    const around = [
      [0.6, -5],
      [1.4, -5],
      [1.4, 30],
      [0.6, 30],
    ] as const;
    link.brushed({ kind: "brush", x: null, y: null, lasso: around }, null, true, "pointer", 0);
    expect(held(store, "regions")).toEqual([3, 4]);
  });

  contractTest(
    "selection.lineage.brush.refused",
    () => {
      expect(() => setup("y")).toThrow(
        `bar brush: its y axis holds aggregates of "sales"'s rows, which a brush selects none of; brush along x, or click its items`,
      );
    },
    "refuses a brush along the aggregates' axis",
  );

  contractTest(
    "inspection.coverage",
    () => {
      const { store, model, at, geometry } = setup();
      store.set("regions", selectWhere(col("day").le(2)));
      geometry();
      const [point] = model.inspect(...at(0, 60))!.points;
      expect(point!.coverage).toEqual({
        selected: 2,
        total: 3,
        state: "partial",
        measure: { field: "revenue", selected: 30, total: 60 },
        channel: "regions",
      });
      expect(point!.text).toBe("60; 2 of 3 rows selected, revenue 30 of 60");
    },
    "inspects a bar with what the channel holds of its rows",
  );

  contractTest(
    "selection.lineage.description",
    () => {
      const { store, selection, model } = setup();
      store.set("regions", selectWhere(col("day").le(2)));
      expect(selection.describe(model.config)).toBe("4 of 6 rows of sales selected.");
    },
    "says how many rows of the source the channel holds",
  );
});

describe("bindings through lineage", () => {
  contractTest(
    "selection.lineage.condition",
    () => {
      const source = sales();
      const store = selectionStore(source);
      const byRegion = deriveTable(source, [
        { aggregate: [{ op: "sum", field: "revenue", as: "revenue" }], by: ["region"] },
      ]);
      const { link } = mounted(
        [bar(byRegion, { x: "region", y: "revenue" })],
        { store, channel: "regions", lineage },
        "x",
      );
      link.brushed(
        { kind: "brush", x: [-0.4, 0.4], y: null, lasso: null },
        null,
        true,
        "pointer",
        0,
      );
      expect(store.get("regions")).toEqual({
        kind: "predicate",
        expression: ["in", ["field", "region"], "North"],
      });
    },
    "write a brush through a derivation's aggregates as a condition on the source",
  );

  contractTest(
    "selection.lineage.ambiguous",
    () => {
      const source = sales();
      const byRegion = groupRows(rowView(source), { by: ["region"], ops: { n: count() } });
      const target = byRegion.table as unknown as Table;
      const model = () =>
        new ChartModel({
          marks: [bar(target, { x: "region", y: "n" })],
          rowSelection: rowSelection(
            { store: selectionStore(source), channel: "a", lineage },
            { store: selectionStore(target), channel: "b" },
          ),
        });
      expect(model).toThrow(
        /^rowSelection: bar \(mark 0\) reads .*, which comes from "sales", whose store is bound, and binds a store of .* too; bind one of them$/,
      );
    },
    "refuse a mark reaching two bound stores",
  );

  contractTest(
    "selection.lineage.unrelated",
    () => {
      const source = sales();
      const fits = table({ x: [1], y: [2] }, "fits");
      expect(
        () =>
          new ChartModel({
            marks: [bar(fits, { x: "x", y: "y" })],
            rowSelection: rowSelection({ store: selectionStore(source), channel: "a", lineage }),
          }),
      ).toThrow(
        'rowSelection store: bar (mark 0) reads "fits", whose rows no lineage connects to "sales"; bind a store of "fits" (channel "a")',
      );
    },
    "refuse a store of a table no mark's rows come from",
  );

  contractTest(
    "selection.lineage.budget",
    () => {
      const n = 20_000;
      const source = typed(
        {
          g: Array.from({ length: n }, (_, i) => `g${i % 100}`),
          v: Float64Array.from({ length: n }, (_, i) => i % 7),
        },
        { name: "sales" },
      ) as unknown as Table;
      const store = selectionStore(source);
      store.set("c", selectWhere(col("v").lt(3)));
      const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
      const target = groups.table as unknown as Table;
      const marks = [bar(target, { x: "g", y: "s" })];
      let refused: ChartError | undefined;
      try {
        mounted(marks, { store, channel: "c", lineage, budget: 1000 });
      } catch (error) {
        refused = error as ChartError;
      }
      expect(refused).toMatchObject({ code: "unsupported", path: "rowSelection.budget" });
      expect(refused!.message).toMatch(
        /^rowSelection budget: highlighting the chart's table through "sales" needs \d+\.\d MiB of indexes, past 0\.0 MiB \(its budget\); give a larger budget, or bind a store of the chart's table$/,
      );
      const chart = mounted(marks, { store, channel: "c", lineage, budget: 128 * 1024 });
      expect(chart.errors).toEqual([]);
      source.append({
        g: Array.from({ length: n }, (_, i) => `new${i}`),
        v: Float64Array.from({ length: n }, () => 1),
      });
      const drawn = chart.geometry();
      expect(chart.errors).toHaveLength(1);
      expect(chart.errors[0]).toMatchObject({ code: "unsupported", phase: "render" });
      // Drawn as it is, saying why.
      expect(drawn.every((g) => !g.key.includes("\u0001"))).toBe(true);
      expect(chart.selection.describe(chart.model.config)).toMatch(
        /stopped because its selection indexes passed the budget\.$/,
      );
      chart.geometry();
      expect(chart.errors).toHaveLength(1);
    },
    "refuse a binding past its budget when made, and stop when tables grow past it later",
  );

  contractTest(
    "selection.lineage.release",
    () => {
      const source = typed(
        { region: ["a", "b", "a", "b"], v: [1, 2, 3, 4] },
        { name: "sales", maxRows: 4 },
      ) as unknown as Table;
      const store = selectionStore(source);
      store.set("c", selectWhere(col("v").le(2)));
      const groups = groupRows(rowView(source), { by: ["region"], ops: { s: sum("v") } });
      const target = groups.table as unknown as Table;
      const record = contributorsOf(target)!;
      const relation = relationTo(target, source)!;
      const chart = mounted([bar(target, { x: "region", y: "s" })], {
        store,
        channel: "c",
        lineage,
      });
      // A table dropping rows keeps a log of them while coverage holds its relation.
      expect(record.kind === "links" && record.log).toBeTruthy();
      chart.link.dispose();
      expect(record.kind === "links" && record.log).toBe(null);
      expect(relation.byteLength).toBe(0);
    },
    "let go of what they hold when the chart goes, without a collection",
  );

  it("let go of what they hold when the binding is replaced", () => {
    const source = typed(
      { region: ["a", "b", "a", "b"], v: [1, 2, 3, 4] },
      { name: "sales", maxRows: 4 },
    ) as unknown as Table;
    const store = selectionStore(source);
    store.set("c", selectWhere(col("v").le(2)));
    const groups = groupRows(rowView(source), { by: ["region"], ops: { s: sum("v") } });
    const target = groups.table as unknown as Table;
    const record = contributorsOf(target)!;
    const chart = mounted([bar(target, { x: "region", y: "s" })], { store, channel: "c", lineage });
    const other = rowSelection({ store, channel: "d", lineage });
    other.mount(
      chart.link,
      chart.model,
      { selection: null, clear() {}, render() {} },
      { emit() {} },
      () => {},
      () => 0,
      () => null,
      { textContent: "" },
    );
    expect(record.kind === "links" && record.log).toBe(null);
  });
});

describe("layout marks of groups bound to their source's store", () => {
  contractTest(
    "selection.lineage.layout",
    () => {
      const source = sales();
      const store = selectionStore(source);
      const byRegion = groupRows(rowView(source), {
        by: ["region"],
        ops: { revenue: sum("revenue"), average: mean("revenue") },
      });
      const target = byRegion.table as unknown as Table;
      store.set("days", selectWhere(col("day").le(2)));
      const text = (value: string) => {
        const { model } = drawn([pie(target, { category: "region", value })], {
          store,
          channel: "days",
          lineage,
        });
        const items = model.items!;
        const result = items.result(items.panels[0]!.key)!;
        return Array.from({ length: result.count }, (_, i) => result.item(i).text);
      };
      // North 30 of 60, East none of 40, South all 20, largest first.
      expect(text("revenue")).toEqual([
        "60 (50%); 2 of 3 rows selected, revenue 30 of 60",
        "40 (33.3%); 0 of 1 row selected, revenue 0 of 40",
        "20 (16.7%); 2 of 2 rows selected, revenue 20 of 20",
      ]);
      // A mean's part cannot be drawn: none of it is, though its rows are counted.
      expect(text("average")).toContain("20 (28.6%); 2 of 3 rows selected");
      expect(text("average").join()).not.toContain("average");
    },
    "draw a slice's selected sum, and say how many of its rows are selected",
  );
});

describe("grids of groups bound to their source's store", () => {
  const setup = () => {
    const source = sales();
    const store = selectionStore(source);
    const byRegion = groupRows(rowView(source), {
      by: ["region"],
      ops: { revenue: sum("revenue") },
    });
    const view = rowView(byRegion.table as unknown as Table);
    const grid = createGridModel({
      data: view,
      columns: [{ field: "region" }, { field: "revenue" }],
      selectionStore: store,
      channel: "regions",
      lineage,
    });
    return { source, store, grid };
  };

  contractTest(
    "selection.lineage.grid",
    () => {
      const { store, grid } = setup();
      grid.select(0);
      expect(held(store, "regions")).toEqual([0, 1, 2]);
      grid.select(2, "toggle");
      expect(held(store, "regions")).toEqual([0, 1, 2, 5]);
      grid.select(2, "toggle");
      expect(held(store, "regions")).toEqual([0, 1, 2]);
      store.set("regions", selectWhere(col("day").le(2)));
      expect([0, 1, 2].map((i) => grid.selectionState(i))).toEqual(["some", "all", "none"]);
      expect([0, 1, 2].map((i) => grid.selectionNote?.(i))).toEqual([
        "2 of 3 rows selected",
        undefined,
        undefined,
      ]);
      expect(grid.selectedCount).toBe(4);
    },
    "select the rows behind the rows clicked, and show what the channel holds of each",
  );

  it("select ranges and every row of a sorted view, copy rows held whole, and stop when disposed", () => {
    const { source, store, grid } = setup();
    grid.setSort([{ field: "revenue", order: "descending" }]);
    // Shown: North (rows 0 to 2, 60), East (row 5, 40), South (rows 3 and 4, 20).
    grid.select(1);
    expect(held(store, "regions")).toEqual([5]);
    grid.select(2, "range");
    expect(held(store, "regions")).toEqual([3, 4, 5]);
    store.set("regions", selectWhere(col("day").le(1)));
    grid.select(0, "addRange");
    expect(held(store, "regions")).toEqual([0, 1, 2, 3, 5]);
    expect([0, 1, 2].map((i) => grid.selectionState(i))).toEqual(["all", "all", "some"]);
    expect(copied(grid, { maxCells: 100, maxBytes: 1e5, escapeFormulas: false }).text).toBe(
      "North\t60\r\nEast\t40",
    );
    expect(() => grid.select(3)).toThrow("Row 3 is not among the grid's 3 rows");
    grid.selectAll();
    expect(held(store, "regions")).toEqual([0, 1, 2, 3, 4, 5]);
    expect(grid.selectedCount).toBe(6);
    let heard = 0;
    grid.subscribe(() => heard++);
    grid.dispose();
    source.replace(1, { day: [1] });
    expect(heard).toBe(0);
  });

  it("clear on a toggling click where the row's rows are all the channel holds", () => {
    const source = sales();
    const store = selectionStore(source);
    const byRegion = groupRows(rowView(source), { by: ["region"], ops: { n: count() } });
    const grid = createGridModel({
      data: rowView(byRegion.table as unknown as Table),
      columns: [{ field: "region" }],
      selection: { click: "toggle" },
      selectionStore: store,
      channel: "regions",
      lineage,
    });
    grid.click(2);
    expect(held(store, "regions")).toEqual([5]);
    grid.click(2);
    expect(store.get("regions")).toBeNull();
    grid.dispose();
  });

  it("refuse a store of another table without the lineage reader", () => {
    const source = sales();
    const byRegion = groupRows(rowView(source), { by: ["region"], ops: { n: count() } });
    expect(() =>
      createGridModel({
        data: rowView(byRegion.table as unknown as Table),
        columns: [{ field: "region" }],
        selectionStore: selectionStore(source) as never,
      }),
    ).toThrow(
      "grid selectionStore: the store is of another table; give a store of the view's table, or lineage for a table it comes from",
    );
  });
});

describe("bindings through lineage, from review", () => {
  it("redraw as the source changes what the channel holds, the groups unchanged", () => {
    const source = sales();
    const store = selectionStore(source);
    store.set("days", selectWhere(col("day").le(1)));
    const byRegion = groupRows(rowView(source), {
      by: ["region"],
      ops: { revenue: sum("revenue") },
    });
    let redrawn = 0;
    const selection = rowSelection({ store, channel: "days", lineage });
    const model = withPicker(
      new ChartModel({
        marks: [bar(byRegion.table as unknown as Table, { x: "region", y: "revenue" })],
        rowSelection: selection,
      }),
    );
    model.setSize(600, 400, 1);
    const link = selection.mount(
      undefined,
      model,
      { selection: null, clear() {}, render() {} },
      { emit() {} },
      () => redrawn++,
      () => 0,
      () => null,
      { textContent: "" },
    );
    model.scene(estimateText);
    // Day, which no group reads, moves North's third row into the selection.
    source.replace(2, { day: [1] });
    expect(redrawn).toBeGreaterThan(0);
    model.scene(estimateText);
    const [panel] = model.panels();
    const [point] = model.inspect(panel!.x.map(0), panel!.y.map(30))!.points;
    expect(point!.coverage).toMatchObject({ selected: 2, total: 3 });
    link.dispose();
  });

  it("write the rows behind the series chosen, each of its own field", () => {
    // a's values on even rows, b's on odd: their groups' rows differ.
    const source = table({
      g: ["x", "x", "x", "x"],
      a: [1, Number.NaN, 2, Number.NaN],
      b: [Number.NaN, 3, Number.NaN, 4],
    });
    const store = selectionStore(source);
    const groups = groupRows(rowView(source), { by: ["g"], ops: { a: sum("a"), b: sum("b") } });
    const { link } = mounted(
      [bar(groups.table as unknown as Table, { x: "g", y: ["a", "b"] })],
      { store, channel: "c", lineage },
      "lasso",
    );
    link.brushed({ kind: "series", series: ['[0,"b"]'] }, null, true, "pointer", 0);
    expect(held(store, "c")).toEqual([1, 3]);
    link.brushed({ kind: "items", items: ['[0,"a","x"]'] }, null, true, "pointer", 0);
    expect(held(store, "c")).toEqual([0, 2]);
  });

  it("keep grouped bars in their slots while their series are drawn in parts", () => {
    const source = sales();
    const store = selectionStore(source);
    const byRegion = groupRows(rowView(source), {
      by: ["region"],
      ops: { revenue: sum("revenue"), margin: sum("margin") },
    });
    const target = byRegion.table as unknown as Table;
    const widths = () => {
      const { geometry } = drawn([bar(target, { x: "region", y: ["revenue", "margin"] })], {
        store,
        channel: "days",
        lineage,
      });
      return geometry()
        .filter((g) => g.kind === "rect")
        .flatMap((g) => boxes(g).map(([x, , width]) => [Math.round(x!), Math.round(width!)]))
        .sort((p, q) => p[0]! - q[0]!);
    };
    const whole = widths();
    // East's revenue selected, its margin too: every bar keeps its place and width.
    store.set("days", selectWhere(col("region").eq("East")));
    expect(widths()).toEqual(whole);
  });

  it("refuse what the selection through lineage does not highlight yet", () => {
    const source = sales();
    const store = selectionStore(source);
    const byRegion = deriveTable(source, [
      { aggregate: [{ op: "sum", field: "revenue", as: "revenue" }], by: ["region"] },
    ]);
    // A summary of the groups' values: its bins are not their rows.
    expect(() =>
      drawn([histogram(byRegion, { x: "revenue" })], { store, channel: "c", lineage }),
    ).toThrow(
      "rowSelection lineage: histogram (mark 0) summarizes its table, which a selection through lineage does not highlight yet; bind a store of its table",
    );
    // Layout items of rows sharing contributors.
    const rolled = deriveTable(source, [
      { rolling: [{ op: "sum", field: "revenue", as: "rolled" }], size: 2, by: ["region"] },
    ]);
    expect(() =>
      drawn([pie(rolled, { category: "region", value: "rolled" })], {
        store,
        channel: "c",
        lineage,
      }),
    ).toThrow(
      /pie \(mark 0\) draws items of .*, whose rows share contributors \(rolling aggregates\),/,
    );
  });

  it("refuse brushes along aggregates, however their axes name them", () => {
    const source = sales();
    const store = selectionStore(source);
    const byRegion = groupRows(rowView(source), { by: ["region"], ops: { s: sum("revenue") } });
    expect(() =>
      mounted(
        [bar(byRegion.table as unknown as Table, { x: "region", y: { field: "s" } })],
        { store, channel: "c", lineage },
        "y",
      ),
    ).toThrow("bar brush: its y axis holds aggregates");
    // Values calculated from an aggregate, and aggregates of aggregates.
    for (const steps of [
      [
        { aggregate: [{ op: "sum", field: "revenue", as: "s" }], by: ["region"] },
        { calculate: ["*", ["field", "s"], 2], as: "doubled" },
      ],
      [
        { aggregate: [{ op: "sum", field: "revenue", as: "s" }], by: ["region", "day"] },
        { aggregate: [{ op: "count", as: "doubled" }], by: ["region"] },
      ],
    ] as const) {
      const derived = deriveTable(source, steps as never);
      expect(() =>
        mounted(
          [bar(derived, { x: "region", y: "doubled" })],
          { store, channel: "c", lineage },
          "y",
        ),
      ).toThrow("bar brush: its y axis holds aggregates");
    }
  });

  it("keep a mark's partial look", () => {
    const source = sales();
    const byRegion = groupRows(rowView(source), { by: ["region"], ops: { s: sum("revenue") } });
    const mark = bar(byRegion.table as unknown as Table, {
      x: "region",
      y: "s",
      partial: { fill: "red" },
    });
    expect(mark.spec.partial).toEqual({ fill: "red" });
  });

  it("let go of what gestures walked when the chart goes", () => {
    const source = sales();
    const store = selectionStore(source);
    const byRegion = deriveTable(source, [
      { filter: [">", ["field", "revenue"], 0] },
      { aggregate: [{ op: "sum", field: "revenue", as: "revenue" }], by: ["region"] },
    ]);
    const relation = relationTo(byRegion, source)!;
    const { link, at } = (() => {
      const chart = mounted([bar(byRegion, { x: "region", y: "revenue" })], {
        store,
        channel: "c",
        lineage,
        effect: "none",
      });
      const [panel] = chart.model.panels();
      return {
        ...chart,
        at: (i: number, v: number) => [panel!.x.map(i), panel!.y.map(v / 2)] as const,
      };
    })();
    link.clicked(...at(0, 60), noKeys)?.();
    expect(held(store, "c")).toEqual([0, 1, 2]);
    expect(relation.byteLength).toBeGreaterThan(0);
    link.dispose();
    expect(relation.byteLength).toBe(0);
  });
});

describe("grids bound through lineage, from review", () => {
  it("follow the source, count every row in their budget, and refuse groups later", () => {
    const source = sales();
    const store = selectionStore(source);
    store.set("regions", selectWhere(col("day").le(1)));
    const byRegion = groupRows(rowView(source), {
      by: ["region"],
      ops: { revenue: sum("revenue") },
    });
    const view = rowView(byRegion.table as unknown as Table);
    const grid = createGridModel({
      data: view,
      columns: [{ field: "region" }, { field: "revenue" }],
      selectionStore: store,
      channel: "regions",
      lineage,
    });
    expect(grid.selectionNote?.(0)).toBe("1 of 3 rows selected");
    let heard = 0;
    grid.subscribe(() => heard++);
    source.replace(1, { day: [1] });
    expect(heard).toBeGreaterThan(0);
    expect(grid.selectionNote?.(0)).toBe("2 of 3 rows selected");
    expect(() => grid.setGroups(groupRows(view, { by: ["region"], ops: {} }) as never)).toThrow(
      "grid selectionStore: groups of a grid bound through lineage are not shown yet; drop groups",
    );
    grid.dispose();
  });

  it("refuse a grid past its budget when made, and report it once tables grow past it", () => {
    // Every row its own group: about 23 bytes a row of indexes, past 16.
    const rows = (n: number, from = 0) => ({
      g: Array.from({ length: n }, (_, i) => `g${from + i}`),
      v: Float64Array.from({ length: n }, (_, i) => i),
    });
    let groups: Table | undefined;
    const grid = (source: Table) => {
      groups = deriveTable(source, [
        { aggregate: [{ op: "sum", field: "v", as: "v" }], by: ["g"] },
      ]);
      return createGridModel({
        data: rowView(groups),
        columns: [{ field: "g" }, { field: "v" }],
        selectionStore: selectionStore(source),
        channel: "c",
        lineage,
      });
    };
    expect(() => grid(table(rows(10_000)))).toThrow(
      `grid selectionStore: highlighting the view's table through "sales" needs 0.2 MiB of indexes, past 0.2 MiB (16 bytes a row of "sales"); bind a store of the view's table`,
    );
    const source = table(rows(2000));
    const model = grid(source);
    const reported: unknown[] = [];
    const error = console.error;
    console.error = (e: unknown) => reported.push(e);
    try {
      source.append(rows(8000, 2000));
      source.append(rows(10, 10_000));
    } finally {
      console.error = error;
    }
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ code: "unsupported", path: "grid selectionStore" });
    // Stopped, it shows nothing selected; a click still writes the rows behind
    // the row clicked, keeping nothing it walked.
    model.select(5);
    expect(held(model.selectionStore as never, "c")).toEqual([5]);
    expect(model.selectionState(5)).toBe("none");
    expect(relationTo(groups!, source)!.byteLength).toBe(0);
    model.dispose();
  });
});

describe("bindings through lineage, from review, round 2", () => {
  /** a's values on even rows, b's on odd: two sums whose contributors differ. */
  const split = () =>
    table({
      g: ["p", "p", "q", "q"],
      k: ["u", "u", "u", "u"],
      a: [1, Number.NaN, 2, Number.NaN],
      b: [Number.NaN, 3, Number.NaN, 4],
    });

  it("draw a bar beside a split one whole, and select its rows on a click", () => {
    const source = sales();
    const store = selectionStore(source);
    const byRegion = groupRows(rowView(source), {
      by: ["region"],
      ops: { revenue: sum("revenue") },
    });
    const { model, link, geometry } = mounted(
      [bar(byRegion.table as unknown as Table, { x: "region", y: "revenue" })],
      { store, channel: "c", lineage },
    );
    const whole = boxes(geometry().find((g) => g.kind === "rect")!).map(([, , , h]) => h);
    store.set("c", selectWhere(col("day").le(2)));
    // North split at 30 of 60; South's bar all selected, as tall as it was.
    const on = geometry().find((g) => g.key.endsWith("\u0001on"))!;
    expect(boxes(on).map(([, , , h]) => h)).toEqual([whole[1]]);
    const [panel] = model.panels();
    link.clicked(panel!.x.map(1), panel!.y.map(5), noKeys)?.();
    expect(held(store, "c")).toEqual([3, 4]);
  });

  it("draw each line by its own field's rows", () => {
    const source = split();
    const store = selectionStore(source);
    const groups = groupRows(rowView(source), { by: ["g"], ops: { a: sum("a"), b: sum("b") } });
    const { geometry } = drawn(
      [line(groups.table as unknown as Table, { x: "g", y: ["a", "b"] })],
      {
        store,
        channel: "c",
        lineage,
      },
    );
    // b's contributors, none of a's.
    store.set("c", selectRows(new RowSet(source).addAll([1, 3])));
    const lit = geometry().filter((g) => g.key.includes("\u0001on"));
    expect(lit.map((g) => g.key.slice(0, 7))).toEqual(['[0,"b"]']);
  });

  it("write the rows behind the series of the mark chosen, and of the series a brush shows", () => {
    const source = split();
    const store = selectionStore(source);
    const groups = groupRows(rowView(source), {
      by: ["g", "k"],
      ops: { a: sum("a"), b: sum("b") },
    });
    const target = groups.table as unknown as Table;
    const { link, model } = mounted(
      [bar(target, { x: "g", y: "a", series: "k" }), bar(target, { x: "g", y: "b", series: "k" })],
      { store, channel: "c", lineage },
      "x",
    );
    // A series named by its category, of the first bar: a's rows alone.
    link.brushed({ kind: "series", series: ['[0,"u"]'] }, null, true, "pointer", 0);
    expect(held(store, "c")).toEqual([0, 2]);
    // A brush over both groups, the second bar's series hidden.
    model.hidden.add('[1,"u"]');
    model.scene(estimateText);
    link.brushed({ kind: "brush", x: [0, 600], y: null, lasso: null }, null, true, "pointer", 0);
    expect(held(store, "c")).toEqual([0, 2]);
  });

  it("write the rows a plane's lasso holds, behind every field drawn", () => {
    const source = sales();
    const store = selectionStore(source);
    const kept = deriveTable(source, [{ filter: [">", ["field", "revenue"], 0] }]);
    const route = (lineage as unknown as LineageKit).route(
      kept,
      { store, table: source, channel: "c", lineage, budget: undefined, at: "rowSelection" },
      [],
    );
    // A map's or network's lasso reports rows and no fields.
    const written = route.written({ kind: "brush", x: null, y: null, lasso: [] }, () =>
      selectRows(new RowSet(kept).addAll([0, 3])),
    );
    expect(written?.kind === "rows" && Array.from(written.rows.positions())).toEqual([0, 3]);
    route.release();
  });

  it("select the rows behind a slice's value on a click", () => {
    const source = split();
    const store = selectionStore(source);
    const groups = groupRows(rowView(source), { by: ["k"], ops: { a: sum("a"), b: sum("b") } });
    const { link, model } = mounted(
      [pie(groups.table as unknown as Table, { category: "k", value: "a" })],
      { store, channel: "c", lineage },
    );
    const { plot } = model.items!.panels[0]!;
    link.clicked(plot.x + plot.width / 2 + 10, plot.y + plot.height / 2, noKeys)?.();
    expect(held(store, "c")).toEqual([0, 2]);
  });

  it("refuse brushes along ranges of aggregates, and take them along positions", () => {
    const source = sales();
    const store = selectionStore(source);
    const ranges = groupRows(rowView(source), {
      by: ["region"],
      ops: { lo: min("revenue"), hi: max("revenue") },
    });
    const target = ranges.table as unknown as Table;
    for (const mark of [
      area(target, { x: "region", y1: "lo", y2: "hi" }),
      errorbar(target, { x: "region", y1: "lo", y2: "hi" }),
    ])
      expect(() => mounted([mark], { store, channel: "c", lineage }, "y")).toThrow(
        "brush: its y axis holds aggregates",
      );
    // A rolling sum against the source's days: days are positions, the sums not.
    const rolled = deriveTable(source, [
      { rolling: [{ op: "sum", field: "revenue", as: "rolled" }], size: 2 },
    ]);
    const rolling = () => point(rolled, { x: "day", y: "rolled" });
    expect(() => mounted([rolling()], { store, channel: "c", lineage }, "x")).not.toThrow();
    expect(() => mounted([rolling()], { store, channel: "c", lineage }, "y")).toThrow(
      "point brush: its y axis holds aggregates",
    );
    // A bin's ends, a group's keys, are positions.
    const binned = deriveTable(source, [
      { bin: "day", bins: { step: 1, start: 0 }, as: "from", end: "to" },
      { aggregate: [{ op: "count", as: "n" }], by: ["from", "to"] },
    ]);
    expect(() =>
      mounted([point(binned, { x: "to", y: "n" })], { store, channel: "c", lineage }, "x"),
    ).not.toThrow();
  });

  it("check a grid's budget as its table grows, its source the same", () => {
    const n = 10_000;
    const source = table({
      g: Array.from({ length: n }, (_, i) => `g${i}`),
      v: Float64Array.from({ length: n }, (_, i) => i),
    });
    // A hundred groups of a filtered view, sorted and summed again.
    const view = rowView(source, { filter: ["<", ["field", "v"], 100] });
    const groups = groupRows(view, { by: ["g"], ops: { v: sum("v") } });
    const target = deriveTable(groups.table as unknown as Table, [
      { sort: "v" },
      { aggregate: [{ op: "sum", field: "v", as: "v" }], by: ["g"] },
    ]);
    const grid = createGridModel({
      data: rowView(target),
      columns: [{ field: "g" }, { field: "v" }],
      selectionStore: selectionStore(source),
      channel: "c",
      lineage,
    });
    const reported: unknown[] = [];
    const error = console.error;
    console.error = (e: unknown) => reported.push(e);
    try {
      view.setQuery({});
    } finally {
      console.error = error;
    }
    expect(target.length).toBe(n);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ code: "unsupported", path: "grid selectionStore" });
    grid.dispose();
  });

  it("let go of what a replaced binding's gestures walked", () => {
    const source = sales();
    const store = selectionStore(source);
    const byRegion = deriveTable(source, [
      { filter: [">", ["field", "revenue"], 0] },
      { aggregate: [{ op: "sum", field: "revenue", as: "revenue" }], by: ["region"] },
    ]);
    const relation = relationTo(byRegion, source)!;
    const marks = [bar(byRegion, { x: "region", y: "revenue" })];
    const chart = mounted(marks, { store, channel: "c", lineage, effect: "none" });
    const [panel] = chart.model.panels();
    chart.link.clicked(panel!.x.map(0), panel!.y.map(30), noKeys)?.();
    expect(relation.byteLength).toBeGreaterThan(0);
    const next = rowSelection({ store, channel: "other", lineage, effect: "none" });
    chart.model.update({ ...chart.model.config, rowSelection: next });
    const replaced = next.mount(
      chart.link,
      chart.model,
      { selection: null, clear() {}, render() {} },
      { emit() {} },
      () => {},
      () => 0,
      () => null,
      { textContent: "" },
    );
    expect(relation.byteLength).toBe(0);
    replaced.dispose();
  });
});

describe("bindings through lineage, from review, round 3", () => {
  /** a's values on even rows, b's on odd: two sums whose contributors differ. */
  const split = () =>
    table({
      g: ["p", "p", "q", "q"],
      a: [1, Number.NaN, 2, Number.NaN],
      b: [Number.NaN, 3, Number.NaN, 4],
    });

  it("draw and select a band's or error bar's rows, both its ends'", () => {
    const source = split();
    const store = selectionStore(source);
    const groups = groupRows(rowView(source), { by: ["g"], ops: { a: sum("a"), b: sum("b") } });
    const target = groups.table as unknown as Table;
    const { geometry } = drawn(
      [bar(target, { x: "g", y: "a" }), area(target, { x: "g", y1: "a", y2: "b" })],
      { store, channel: "c", lineage },
    );
    // b's contributors, none of a's: the band's groups each hold one of their rows.
    store.set("c", selectRows(new RowSet(source).addAll([1, 3])));
    const lit = geometry().filter((g) => g.key.startsWith("[1,") && g.key.includes("\u0001on"));
    expect(lit.length).toBeGreaterThan(0);
    const { link } = mounted([errorbar(target, { x: "g", y1: "a", y2: "b" })], {
      store,
      channel: "c",
      lineage,
    });
    // The error bars' series, named after its high end, stands for every row behind them.
    link.brushed({ kind: "series", series: ['[0,"b"]'] }, null, true, "pointer", 0);
    expect(held(store, "c")).toEqual([0, 1, 2, 3]);
  });

  it("refuse brushes along counts of groups of groups", () => {
    const source = sales();
    const store = selectionStore(source);
    const byBoth = groupRows(rowView(source), {
      by: ["region", "kind"],
      ops: { revenue: sum("revenue") },
    });
    const byKind = groupRows(rowView(byBoth.table as unknown as Table), {
      by: ["kind"],
      ops: { n: count() },
    });
    const marks = () => [bar(byKind.table as unknown as Table, { x: "kind", y: "n" })];
    expect(() => mounted(marks(), { store, channel: "c", lineage }, "y")).toThrow(
      "bar brush: its y axis holds aggregates",
    );
    expect(() => mounted(marks(), { store, channel: "c", lineage }, "x")).not.toThrow();
  });

  it("check the budget of a binding that draws nothing as its gestures walk", () => {
    const rows = (n: number, from = 0) => ({
      g: Array.from({ length: n }, (_, i) => `g${from + i}`),
      v: Float64Array.from({ length: n }, () => 1),
    });
    const source = table(rows(4));
    const store = selectionStore(source);
    const groups = deriveTable(source, [
      { aggregate: [{ op: "sum", field: "v", as: "v" }], by: ["g"] },
    ]);
    const relation = relationTo(groups, source)!;
    const chart = mounted([bar(groups, { x: "g", y: "v" })], {
      store,
      channel: "c",
      lineage,
      effect: "none",
      budget: 2048,
    });
    source.append(rows(10_000, 4));
    chart.geometry();
    chart.link.brushed({ kind: "series", series: ['[0,"v"]'] }, null, true, "pointer", 0);
    chart.link.brushed({ kind: "series", series: ['[0,"v"]'] }, null, true, "pointer", 0);
    expect(chart.errors).toHaveLength(1);
    expect(chart.errors[0]).toMatchObject({ code: "unsupported", path: "rowSelection.budget" });
    expect(relation.byteLength).toBe(0);
  });

  it("let go of what gestures walked when the marks they walked go", () => {
    const source = sales();
    const store = selectionStore(source);
    const byRegion = deriveTable(source, [
      { filter: [">", ["field", "revenue"], 0] },
      { aggregate: [{ op: "sum", field: "revenue", as: "revenue" }], by: ["region"] },
    ]);
    const relation = relationTo(byRegion, source)!;
    const chart = mounted([bar(byRegion, { x: "region", y: "revenue" })], {
      store,
      channel: "c",
      lineage,
      effect: "none",
    });
    const [panel] = chart.model.panels();
    chart.link.clicked(panel!.x.map(0), panel!.y.map(30), noKeys)?.();
    expect(relation.byteLength).toBeGreaterThan(0);
    // The same binding, the source's points in place of the groups' bars.
    chart.model.update({
      ...chart.model.config,
      marks: [point(source, { x: "day", y: "revenue" })],
    });
    const again = chart.selection.mount(
      chart.link,
      chart.model,
      { selection: null, clear() {}, render() {} },
      { emit() {} },
      () => {},
      () => 0,
      () => null,
      { textContent: "" },
    );
    expect(again).toBe(chart.link);
    expect(relation.byteLength).toBe(0);
    again.dispose();
  });
});

describe("bindings through lineage, from review, round 4", () => {
  it("inspect an error bar with its rows, both its ends'", () => {
    // a's values on even rows, b's on odd: p's a is row 0's, its b row 1's.
    const source = table({
      g: ["p", "p", "q", "q"],
      a: [1, Number.NaN, 2, Number.NaN],
      b: [Number.NaN, 3, Number.NaN, 4],
    });
    const store = selectionStore(source);
    const groups = groupRows(rowView(source), { by: ["g"], ops: { a: sum("a"), b: sum("b") } });
    const { model } = drawn(
      [errorbar(groups.table as unknown as Table, { x: "g", y1: "a", y2: "b" })],
      {
        store,
        channel: "c",
        lineage,
      },
    );
    store.set("c", selectRows(new RowSet(source).add(0)));
    model.scene(estimateText);
    const [panel] = model.panels();
    const [point] = model.inspect(panel!.x.map(0), panel!.y.map(2))!.points;
    expect(point!.coverage).toEqual({ selected: 1, total: 2, state: "partial", channel: "c" });
    expect(point!.text).toContain("; 1 of 2 rows selected");
  });

  it.each([
    [
      "groups",
      (view: ReturnType<typeof rowView>) =>
        groupRows(view, { by: ["region"], ops: { n: count() } }).table,
    ],
    [
      "totals",
      (view: ReturnType<typeof rowView>) => rowTotals(view, { ops: { n: count() } }).table,
    ],
    [
      "a pivot's rows",
      (view: ReturnType<typeof rowView>) =>
        pivotRows(view, { rows: "region", pivot: "kind", ops: { n: count() } }).rowTable,
    ],
    [
      "a derivation",
      (view: ReturnType<typeof rowView>) =>
        deriveTable(view.source, [{ aggregate: [{ op: "count", as: "n" }], by: ["region"] }]),
    ],
  ])("refuse a brush along counts of %s", (_, of) => {
    const source = sales();
    const counts = of(rowView(source)) as unknown as Table;
    const x = counts.has("region") ? "region" : "n";
    expect(() =>
      mounted(
        [bar(counts, { x, y: "n" })],
        { store: selectionStore(source), channel: "c", lineage },
        "y",
      ),
    ).toThrow("bar brush: its y axis holds aggregates");
  });

  it("refuse a brush along counts of a pivot that stopped at a limit", () => {
    const source = sales();
    const byBoth = groupRows(rowView(source), {
      by: ["region", "kind"],
      ops: { revenue: sum("revenue") },
    });
    const view = rowView(byBoth.table as unknown as Table);
    const pivot = pivotRows(view, {
      rows: "region",
      pivot: "kind",
      ops: { n: count() },
      limits: { generatedColumns: 2 },
    });
    // A third kind passes the limit: the pivot stops, its counts as they were.
    source.append({ region: ["West"], kind: ["c"], day: [4], revenue: [1], margin: [1] });
    pivot.read();
    expect(pivot.failure).not.toBeNull();
    const marks = () => [bar(pivot.rowTable as unknown as Table, { x: "region", y: "n" })];
    const binding = { store: selectionStore(source), channel: "c", lineage };
    expect(() => mounted(marks(), binding, "y")).toThrow("bar brush: its y axis holds aggregates");
    expect(() => mounted(marks(), binding, "x")).not.toThrow();
  });

  it("report a binding that draws nothing once its tables grow past its budget after a gesture", () => {
    const rows = (n: number, from = 0) => ({
      g: Array.from({ length: n }, (_, i) => `g${from + i}`),
      v: Float64Array.from({ length: n }, () => 1),
    });
    const source = table(rows(4));
    const store = selectionStore(source);
    const groups = deriveTable(source, [
      { filter: [">", ["field", "v"], 0] },
      { aggregate: [{ op: "sum", field: "v", as: "v" }], by: ["g"] },
    ]);
    const relation = relationTo(groups, source)!;
    const chart = mounted([bar(groups, { x: "g", y: "v" })], {
      store,
      channel: "c",
      lineage,
      effect: "none",
      budget: 2048,
    });
    const [panel] = chart.model.panels();
    chart.link.clicked(panel!.x.map(0), panel!.y.map(0.5), noKeys)?.();
    expect(held(store, "c")).toEqual([0]);
    expect(relation.byteLength).toBeGreaterThan(0);
    // No gesture follows: the tables' growth finds the budget passed.
    source.append(rows(10_000, 4));
    expect(chart.errors).toHaveLength(1);
    expect(chart.errors[0]).toMatchObject({ code: "unsupported", path: "rowSelection.budget" });
    expect(relation.byteLength).toBe(0);
    source.append(rows(10, 10_004));
    chart.geometry();
    expect(chart.errors).toHaveLength(1);
  });
});
