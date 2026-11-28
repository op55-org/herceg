import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { count, mean, sum } from "../../src/data/aggregations.ts";
import { type ContributorRelation, relationTo } from "../../src/data/contributors.ts";
import { deriveTable } from "../../src/data/derive.ts";
import { col } from "../../src/data/expr.ts";
import { compileExpression, type Expression } from "../../src/data/expression.ts";
import { groupRows } from "../../src/data/groups.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { pivotRows } from "../../src/data/pivot.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { rowView } from "../../src/data/row-view.ts";
import {
  type DataSelection,
  type SelectionStore,
  selectionStore,
  selectRows,
  selectWhere,
} from "../../src/data/selection.ts";
import { type Table, table } from "../../src/data/table.ts";
import { rowTotals } from "../../src/data/totals.ts";
import {
  BUDGET_PER_ROW,
  budgetRefusal,
  type Coverage,
  coverageOf,
  coverageWork,
  lineageCost,
} from "../../src/model/coverage.ts";
import { historyBytes } from "../../src/model/membership-changes.ts";
import { membershipOf } from "../../src/model/memberships.ts";

/** A table read by field name at run time, as lineage reads it. */
const untyped = (...args: Parameters<typeof table>) => table(...args) as unknown as Table;

/** A seeded random number generator. */
function randoms(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

/** Which rows a selection holds, by position, as tested row by row. */
function held(source: Table, selection: DataSelection | null): Uint8Array {
  const out = new Uint8Array(source.length);
  if (!selection) return out;
  if (selection.kind === "rows") {
    for (const p of selection.rows.positions()) out[p] = 1;
    return out;
  }
  const { at } = compileExpression(selection.expression, source);
  for (let p = 0; p < source.length; p++) out[p] = at(p) === true ? 1 : 0;
  return out;
}

/** The source rows of each target, as `rowsOf(target)` says them, recomputed from the source. */
type Oracle = (target: number) => number[];

/** Checks coverage of every target against `rows`, with sums of `measured` where given. */
function covers(
  coverage: Coverage,
  rows: Oracle,
  selection: Uint8Array,
  measured?: { field: string; values: ArrayLike<number> },
) {
  const relation = coverage.relation;
  // Read all at once, as lines and bars of many groups read them, and one by one.
  const counts = coverage.counts();
  for (let t = 0; t < relation.targets; t++) {
    const of = rows(t);
    const selected = of.filter((p) => selection[p]).length;
    expect([t, counts.selected(t), counts.total(t)]).toEqual([t, selected, of.length]);
    expect([t, coverage.selected(t), coverage.total(t)]).toEqual([t, selected, of.length]);
    expect(coverage.state(t)).toBe(
      selected === 0 ? "none" : selected === of.length ? "all" : "partial",
    );
    if (!measured) continue;
    const measure = coverage.measure(t, measured.field)!;
    const want = of.filter((p) => selection[p]).reduce((s, p) => s + measured.values[p]!, 0);
    expect(measure.selected).toBeCloseTo(want, 9);
    const negatives = of.filter((p) => measured.values[p]! < 0).length;
    expect(coverage.negatives(t)).toBe(negatives);
  }
}

const finite = (values: ArrayLike<number>, p: number) => Number.isFinite(values[p]!);

/** Rows of `source` whose `field` is `key` (a label, a number, or null), among `rows`. */
function keyed(source: Table, field: string, key: string | number | null, among: number[]) {
  return among.filter((p) => source.value(field as never, p) === key);
}

/** Positions of the rows a view of `x < below` shows. */
function shown(source: Table, below: number) {
  const x = source.numbers("x" as never);
  return Array.from({ length: source.length }, (_, p) => p).filter((p) => x[p]! < below);
}

/** A table of sales with missing values, `n` rows. */
function salesOf(n: number, seed: number, maxRows?: number) {
  const random = randoms(seed);
  return untyped(
    {
      g: Array.from({ length: n }, () => ["a", "b", "c"][Math.floor(random() * 3)]!),
      x: Float64Array.from({ length: n }, () => (random() < 0.1 ? Number.NaN : random() * 10)),
      v: Float64Array.from({ length: n }, () =>
        random() < 0.15 ? Number.NaN : Math.round(random() * 20 - 5),
      ),
      w: Float64Array.from({ length: n }, () => (random() < 0.3 ? Number.NaN : random())),
    },
    maxRows === undefined ? { name: "sales" } : { name: "sales", maxRows },
  );
}

describe("coverage", () => {
  it("counts what a channel holds of each group, through any chain, against recomputation", () => {
    const source = salesOf(200, 1);
    const store = selectionStore(source);
    store.set("brush", selectWhere(col("v").ge(3)));
    const groups = groupRows(rowView(source, { filter: ["<", ["field", "x"], 7] }), {
      by: ["g"],
      ops: { s: sum("v"), n: count() },
    });
    const relation = relationTo(groups.table, source)!;
    const rows = (field: "v" | null) => (g: number) => {
      const among = keyed(source, "g", groups.keyOf(g)[0]!, shown(source, 7));
      const v = source.numbers("v");
      return field ? among.filter((p) => finite(v, p)) : among;
    };
    const values = source.numbers("v");
    covers(coverageOf(relation, "s", store, "brush"), rows("v"), held(source, store.get("brush")), {
      field: "s",
      values,
    });
    covers(coverageOf(relation, "n", store, "brush"), rows(null), held(source, store.get("brush")));
    store.set("brush", selectRows(new RowSet(source).addAll([0, 5, 9, 40])));
    covers(coverageOf(relation, "s", store, "brush"), rows("v"), held(source, store.get("brush")), {
      field: "s",
      values,
    });
  });

  it("keeps two stores under one channel name apart", () => {
    const source = salesOf(50, 2);
    const [a, b] = [selectionStore(source), selectionStore(source)];
    a.set("focus", selectWhere(col("x").lt(3)));
    b.set("focus", selectWhere(col("x").ge(3)));
    const groups = groupRows(rowView(source), { by: ["g"], ops: { n: count() } });
    const relation = relationTo(groups.table, source)!;
    const [ca, cb] = [coverageOf(relation, "n", a, "focus"), coverageOf(relation, "n", b, "focus")];
    expect(ca).not.toBe(cb);
    const rows = (g: number) =>
      keyed(source, "g", groups.keyOf(g)[0]!, shown(source, 100).concat());
    const all = (g: number) =>
      Array.from({ length: source.length }, (_, p) => p).filter(
        (p) => source.value("g", p) === groups.keyOf(g)[0],
      );
    void rows;
    covers(ca, all, held(source, a.get("focus")));
    covers(cb, all, held(source, b.get("focus")));
  });

  it("counts different finite values for two value fields of one group, and shares one entry per field read", () => {
    const source = salesOf(120, 3);
    const store = selectionStore(source);
    store.set("c", selectWhere(col("x").lt(5)));
    const groups = groupRows(rowView(source), {
      by: ["g"],
      ops: { sv: sum("v"), mv: mean("v"), sw: sum("w") },
    });
    const relation = relationTo(groups.table, source)!;
    const byV = coverageOf(relation, "sv", store, "c");
    expect(coverageOf(relation, "mv", store, "c")).toBe(byV);
    const byW = coverageOf(relation, "sw", store, "c");
    expect(byW).not.toBe(byV);
    const rows = (field: "v" | "w") => (g: number) => {
      const values = source.numbers(field);
      return Array.from({ length: source.length }, (_, p) => p).filter(
        (p) => source.value("g", p) === groups.keyOf(g)[0] && finite(values, p),
      );
    };
    const selection = held(source, store.get("c"));
    covers(byV, rows("v"), selection, { field: "sv", values: source.numbers("v") });
    covers(byW, rows("w"), selection, { field: "sw", values: source.numbers("w") });
    expect(byV.measure(0, "mv")).toBeUndefined();
    expect(byV.total(0)).not.toBe(byW.total(0));
  });

  it("shares coverage groups between targets with the same contributors", () => {
    // A packed relation, as Express's are: a group per source row, and targets naming theirs.
    const source = untyped({ x: [1, 2, 3, 4, 5, 6] });
    const groupOfRow = Int32Array.of(0, 0, 1, 1, 1, -1);
    const groupOfTarget = Int32Array.of(0, 0, 0, 1, 1);
    const members = (g: number) => [...groupOfRow.keys()].filter((p) => groupOfRow[p] === g);
    const packed: ContributorRelation = {
      source,
      target: untyped({ y: [0, 0, 0, 0, 0] }),
      revision: 0,
      layout: 0,
      targets: 5,
      groups: 2,
      groupOf: (t) => groupOfTarget[t]!,
      partition: true,
      single: false,
      contributors: (t, visit) => members(groupOfTarget[t]!).forEach(visit),
      targetsOf: (p, visit) => {
        for (let t = 0; t < 5; t++) if (groupOfTarget[t] === groupOfRow[p]) visit(t);
      },
      representative: (g) => groupOfTarget.indexOf(g),
      groupAt: (p) => groupOfRow[p]!,
      count: (t) => members(groupOfTarget[t]!).length,
      classOf: () => null,
      operandOf: () => undefined,
      measureOf: () => undefined,
      incidences: (visit) => {
        for (let p = 0; p < 6; p++) if (groupOfRow[p]! >= 0) visit(p, groupOfRow[p]!);
      },
      removed: () => false,
      retain: () => {},
      byteLength: 0,
      estimate: () => 0,
      owned: 0,
      hold: () => () => {},
    };
    const store = selectionStore(source);
    store.set("c", selectRows(new RowSet(source).addAll([0, 3])));
    const coverage = coverageOf(packed, undefined, store, "c");
    expect([0, 1, 2, 3, 4].map((t) => coverage.selected(t))).toEqual([1, 1, 1, 1, 1]);
    const before = coverageWork.incidences;
    // A toggle of one row updates one group's counter, which every target reads.
    store.set("c", selectRows(new RowSet(source).addAll([0, 3, 4])));
    expect([0, 1, 2, 3, 4].map((t) => coverage.selected(t))).toEqual([1, 1, 1, 2, 2]);
    expect(coverageWork.incidences - before).toBe(1);
  });

  it("read targets of one source row each from the membership, at once as one by one", () => {
    const source = salesOf(60, 4);
    const kept = deriveTable(source, [{ filter: [">=", ["field", "x"], 4] }]);
    const store = selectionStore(source);
    store.set("c", selectWhere(col("v").ge(3)));
    const coverage = coverageOf(relationTo(kept, source)!, undefined, store, "c");
    const counts = coverage.counts();
    const each = Array.from({ length: kept.length }, (_, t) => [
      counts.selected(t),
      counts.total(t),
    ]);
    expect(each).toEqual(each.map((_, t) => [coverage.selected(t), coverage.total(t)]));
    expect(each.some(([selected]) => selected === 1)).toBe(true);
    expect(each.some(([selected]) => selected === 0)).toBe(true);
  });

  it("counts a coverage group again by one of its targets", () => {
    // Targets 0 and 1 share group 0, target 2 is group 1; field "f" reads x's finite values.
    const source = untyped({ x: [1, 2, 3, 4, 5, 6] });
    const groupOfRow = Int32Array.of(0, 0, 1, 1, 1, -1);
    const groupOfTarget = Int32Array.of(0, 0, 1);
    const reads = (p: number, field?: string) =>
      groupOfRow[p]! >= 0 && (field !== "f" || Number.isFinite(source.numbers("x")[p]!));
    const packed: ContributorRelation = {
      source,
      target: untyped({ y: [0, 0, 0] }),
      revision: 0,
      layout: 0,
      targets: 3,
      groups: 2,
      groupOf: (t) => groupOfTarget[t]!,
      representative: (g) => groupOfTarget.indexOf(g),
      partition: true,
      single: false,
      contributors: (t, visit, field) => {
        for (let p = 0; p < 6; p++)
          if (groupOfRow[p] === groupOfTarget[t] && reads(p, field)) visit(p);
      },
      targetsOf: (p, visit, field) => {
        for (let t = 0; t < 3; t++)
          if (groupOfTarget[t] === groupOfRow[p] && reads(p, field)) visit(t);
      },
      groupAt: (p, field) => (reads(p, field) ? groupOfRow[p]! : -1),
      count: () => 0,
      classOf: (field) => (field === "f" ? "x" : null),
      operandOf: (field) => (field === "f" ? "x" : undefined),
      measureOf: () => undefined,
      incidences: (visit, field) => {
        for (let p = 0; p < 6; p++) if (reads(p, field)) visit(p, groupOfRow[p]!);
      },
      removed: () => false,
      retain: () => {},
      byteLength: 0,
      estimate: () => 0,
      owned: 0,
      hold: () => () => {},
    };
    const store = selectionStore(source);
    store.set("c", selectRows(new RowSet(source).addAll([0, 1, 2])));
    const coverage = coverageOf(packed, "f", store, "c");
    expect([2].map((t) => [coverage.selected(t), coverage.total(t)])).toEqual([[1, 3]]);
    // Row 3's x goes missing: group 1, read through target 2, has two rows, one selected.
    source.set("x", 3, Number.NaN);
    expect([0, 2].map((t) => [coverage.selected(t), coverage.total(t)])).toEqual([
      [2, 2],
      [1, 2],
    ]);
  });

  it("counts groups appended since, from zero", () => {
    const source = untyped({ g: ["a", "a"], v: [1, 2] });
    const store = selectionStore(source);
    store.set("c", selectWhere(true));
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
    const coverage = coverageOf(relationTo(groups.table, source)!, "s", store, "c");
    expect(coverage.of(0)).toMatchObject({ selected: 2, total: 2, state: "all" });
    source.append({ g: ["b", "b"], v: [3, 4] });
    expect(coverage.of(1)).toMatchObject({ selected: 2, total: 2, state: "all" });
    expect(coverage.measure(1, "s")).toMatchObject({ selected: 7, total: 7 });
  });

  it("counts again rather than take away rows edited, then dropped, before a read", () => {
    for (const edit of [10, Number.NaN]) {
      const source = untyped({ g: ["a", "a", "a", "a"], v: [1, 2, 3, 4] }, { maxRows: 4 });
      const store = selectionStore(source);
      store.set("c", selectRows(new RowSet(source).addAll([0, 1])));
      const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
      const coverage = coverageOf(relationTo(groups.table, source)!, "s", store, "c");
      expect(coverage.measure(0, "s")?.selected).toBe(3);
      source.set("v", 0, edit);
      source.append({ g: ["a"], v: [5] });
      // Row 1 alone is selected now (v = 2), of the rows holding 2, 3, 4, 5.
      expect([coverage.selected(0), coverage.total(0)]).toEqual([1, 4]);
      expect(coverage.measure(0, "s")?.selected).toBe(2);
    }
  });

  it("give a measure only of the field named, whichever field of a class came first", () => {
    const source = untyped({ g: ["a", "a"], v: [1, 2] });
    const store = selectionStore(source);
    store.set("c", selectRows(new RowSet(source).addAll([0])));
    const groups = groupRows(rowView(source), { by: ["g"], ops: { m: mean("v"), s: sum("v") } });
    const relation = relationTo(groups.table, source)!;
    const byMean = coverageOf(relation, "m", store, "c");
    expect(coverageOf(relation, "s", store, "c")).toBe(byMean);
    expect(byMean.of(0)).not.toHaveProperty("measure");
    expect(byMean.of(0, "s").measure).toMatchObject({ selected: 1, total: 3 });
    expect(byMean.of(0, "m").measure).toBeUndefined();
  });

  it("keep a class of no rows apart from a field's finite values, whatever the field's name", () => {
    const source = untyped({ "": [1, Number.NaN], g: ["a", "a"] });
    const store = selectionStore(source);
    store.set("c", selectWhere(true));
    const groups = groupRows(rowView(source), { by: ["g"], ops: { n: count(), s: sum("") } });
    const relation = relationTo(groups.table, source)!;
    const rows = coverageOf(relation, "n", store, "c");
    const values = coverageOf(relation, "s", store, "c");
    expect(values).not.toBe(rows);
    expect([rows.total(0), values.total(0)]).toEqual([2, 1]);
  });

  it("measure nothing of stopped producers' targets", () => {
    const source = untyped({ g: ["a", "a"], v: [1, 2] });
    const store = selectionStore(source);
    store.set("c", selectWhere(true));
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
    const totals = rowTotals(rowView(source), { ops: { s: sum("v") } });
    const coverages = [groups.table as unknown as Table, totals.table as unknown as Table].map(
      (table) => coverageOf(relationTo(table, source)!, "s", store, "c"),
    );
    for (const coverage of coverages) expect(coverage.measure(0, "s")?.selected).toBe(3);
    groups.dispose();
    totals.dispose();
    // Stopped producers' values follow no rows: they measure nothing.
    for (const coverage of coverages) {
      expect(coverage.of(0, "s")).toEqual({ selected: 0, total: 0, state: "none" });
      expect(coverage.measure(0, "s")).toBeUndefined();
    }
  });

  it("measure nothing of frozen groups' targets, whose values no longer follow the rows", () => {
    const source = untyped({ r: ["R", "R"], k: ["x", "x"], v: [1, 2] }, { maxRows: 2 });
    const store = selectionStore(source);
    store.set("c", selectWhere(true));
    const pivot = pivotRows(rowView(source), {
      rows: "r",
      pivot: "k",
      ops: { s: sum("v") },
      limits: { generatedColumns: 1 },
    });
    const coverage = coverageOf(relationTo(pivot.table, source)!, "s", store, "c");
    expect(coverage.measure(0, "s")).toMatchObject({ selected: 3, total: 3 });
    // A second generated column passes the limit: the pivot stops as it was.
    source.append({ r: ["R"], k: ["y"], v: [5] });
    expect(pivot.failure?.limit).toBe("generatedColumns");
    expect(coverage.measure(0, "s")).toBeUndefined();
    expect(coverage.of(0, "s")).toEqual({ selected: 1, total: 1, state: "all" });
  });

  it("measure nothing of a pivot frozen by a change heard before it heard it", () => {
    const source = untyped({ r: ["R", "R"], k: ["x", "x"], v: [1, 2] }, { maxRows: 2 });
    const measured: unknown[] = [];
    // Heard before the pivot hears the same change.
    source.subscribe(() => measured.push(relation.measureOf("s")));
    const pivot = pivotRows(rowView(source), {
      rows: "r",
      pivot: "k",
      ops: { s: sum("v") },
      limits: { generatedColumns: 1 },
    });
    const relation = relationTo(pivot.table, source)!;
    expect(relation.measureOf("s")).toEqual({ op: "sum", field: "v" });
    source.append({ r: ["R"], k: ["y"], v: [5] });
    expect(pivot.failure?.limit).toBe("generatedColumns");
    expect(measured).toEqual([undefined]);
  });

  it("count every incidence once for a first read of a sum", () => {
    const n = 10_000;
    const source = untyped({
      g: Array.from({ length: n }, (_, i) => `g${i % 100}`),
      v: Float64Array.from({ length: n }, (_, i) => i),
    });
    const store = selectionStore(source);
    store.set("c", selectWhere(col("v").lt(5000)));
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
    const coverage = coverageOf(relationTo(groups.table, source)!, "s", store, "c");
    const [rebuilds, incidences] = [coverageWork.rebuilds, coverageWork.incidences];
    expect(coverage.measure(0, "s")?.selected).toBe(
      Array.from({ length: 50 }, (_, i) => i * 100).reduce((a, b) => a + b, 0),
    );
    expect([coverageWork.rebuilds - rebuilds, coverageWork.incidences - incidences]).toEqual([
      1,
      n,
    ]);
  });

  it("measure what the rows hold when read before the producer heard of them", () => {
    const source = untyped({ v: [1, 2] });
    const store = selectionStore(source);
    store.set("c", selectWhere(true));
    const seen: unknown[] = [];
    // Heard before the derivation hears the same change.
    source.subscribe(() => seen.push(byValue.measure(0, "s"), byRow.measure(0, "n")));
    const derived = deriveTable(source, [
      {
        aggregate: [
          { op: "sum", field: "v", as: "s" },
          { op: "count", as: "n" },
        ],
        by: [],
      },
    ]);
    const relation = relationTo(derived, source)!;
    const byValue = coverageOf(relation, "s", store, "c");
    const byRow = coverageOf(relation, "n", store, "c");
    byValue.measure(0, "s");
    byRow.measure(0, "n");
    source.append({ v: [3] });
    expect(seen).toEqual([
      { field: "s", selected: 6, total: 6 },
      { field: "n", selected: 3, total: 3 },
    ]);
  });

  it("follows appends, drops, and edits at what they touch, rebuilding only when it must", () => {
    const source = salesOf(1000, 4, 1000);
    const store = selectionStore(source);
    store.set("brush", selectWhere(col("x").lt(4)));
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
    const relation = relationTo(groups.table, source)!;
    const coverage = coverageOf(relation, "s", store, "brush");
    const rows = (g: number) => {
      const v = source.numbers("v");
      return Array.from({ length: source.length }, (_, p) => p).filter(
        (p) => source.value("g", p) === groups.keyOf(g)[0] && finite(v, p),
      );
    };
    const check = () =>
      covers(coverage, rows, held(source, store.get("brush")), {
        field: "s",
        values: source.numbers("v"),
      });
    check();
    const random = randoms(9);
    const rebuilds = coverageWork.rebuilds;
    for (let batch = 0; batch < 5; batch++) {
      const before = coverageWork.incidences;
      source.append({
        g: Array.from({ length: 20 }, () => ["a", "b", "c"][Math.floor(random() * 3)]!),
        x: Float64Array.from({ length: 20 }, () => random() * 10),
        v: Float64Array.from({ length: 20 }, () => Math.round(random() * 20 - 5)),
        w: new Float64Array(20),
      });
      check();
      // Twenty rows dropped and twenty appended, some of each selected.
      expect(coverageWork.incidences - before).toBeLessThan(100);
    }
    // An edit of a summed value counts its group again; one of a group key, every group.
    source.set("v", 10, 99);
    check();
    expect(coverageWork.rebuilds).toBe(rebuilds);
    source.set("g", 10, "c");
    check();
    expect(coverageWork.rebuilds).toBe(rebuilds + 1);
  });

  it("subtracts a row from the group it was counted in when it leaves or is dropped", () => {
    const source = untyped({ g: ["a", "b", "a"], v: [1, -2, 3] }, { maxRows: 3 });
    const store = selectionStore(source);
    store.set("c", selectWhere(true));
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
    const coverage = coverageOf(relationTo(groups.table, source)!, "s", store, "c");
    expect([coverage.measure(0, "s")!.selected, coverage.negatives(1)]).toEqual([4, 1]);
    // Row 0 (a, 1) and row 1 (b, -2) drop; their groups lose them.
    source.append({ g: ["b", "a"], v: [5, 1] });
    expect(groups.keyOf(0)).toEqual(["a"]);
    expect([coverage.selected(0), coverage.total(0), coverage.measure(0, "s")!.selected]).toEqual([
      2, 2, 4,
    ]);
    expect([
      coverage.selected(1),
      coverage.negatives(1),
      coverage.measure(1, "s")!.selected,
    ]).toEqual([1, 0, 5]);
  });

  it("rebuilds after a new target layout, and for windows after a drop", () => {
    const source = untyped({ g: ["a", "b", "c"], v: [1, 2, 3] }, { maxRows: 3 });
    const store = selectionStore(source);
    store.set("c", selectWhere(col("v").ge(2)));
    const groups = groupRows(rowView(source), { by: ["g"], ops: { n: count() } });
    const relation = relationTo(groups.table, source)!;
    const coverage = coverageOf(relation, "n", store, "c");
    expect(coverage.selected(1)).toBe(1);
    const layout = relation.layout;
    // Group a empties and the groups are renumbered: b is now group 0.
    source.append({ g: ["b"], v: [4] });
    expect(relation.layout).not.toBe(layout);
    expect([coverage.selected(0), coverage.total(0)]).toEqual([2, 2]);
  });
});

describe("coverage under random mutations", () => {
  /** A step against every coverage: appends past `maxRows`, edits, resets, selection changes. */
  function run(seed: number, ordered: boolean) {
    const random = randoms(seed);
    const rowsOf = (n: number, t0: number) => ({
      t: Float64Array.from({ length: n }, (_, i) => t0 + i + (ordered && random() < 0.3 ? -3 : 0)),
      g: Array.from({ length: n }, () => ["a", "b", "c", null][Math.floor(random() * 4)]!),
      x: Float64Array.from({ length: n }, () => (random() < 0.1 ? Number.NaN : random() * 10)),
      v: Float64Array.from({ length: n }, () =>
        random() < 0.15 ? Number.NaN : Math.round(random() * 20 - 8),
      ),
    });
    let time = 0;
    const first = rowsOf(60, time);
    time += 60;
    const source = (ordered
      ? orderedTable(first, { orderBy: "t", maxRows: 80 })
      : table(first, { maxRows: 80 })) as unknown as Table;
    const stores: SelectionStore[] = [selectionStore(source), selectionStore(source)];
    const view = rowView(source, { filter: ["<", ["field", "x"], 7] });
    const groups = groupRows(view, { by: ["g"], ops: { s: sum("v"), n: count(), m: mean("v") } });
    const totals = rowTotals(view, { ops: { s: sum("v"), n: count() } });
    const derived = deriveTable(source, [
      { filter: ["<", ["field", "x"], 7] },
      {
        aggregate: [
          { op: "sum", field: "v", as: "s" },
          { op: "count", as: "n" },
        ],
        by: ["g"],
      },
    ]);
    const relations = {
      groups: relationTo(groups.table, source)!,
      totals: relationTo(totals.table, source)!,
      derived: relationTo(derived, source)!,
    };
    const v = () => source.numbers("v" as never);
    const among = () => shown(source, 7);
    const oracles: Record<keyof typeof relations, (field: "v" | null) => Oracle> = {
      groups: (field) => (g) =>
        keyed(source, "g", groups.keyOf(g)[0]!, among()).filter((p) => !field || finite(v(), p)),
      totals: (field) => () => among().filter((p) => !field || finite(v(), p)),
      derived: (field) => (t) =>
        keyed(source, "g", derived.value("g" as never, t), among()).filter(
          (p) => !field || finite(v(), p),
        ),
    };
    const coverages = Object.entries(relations).flatMap(([name, relation]) =>
      stores.flatMap((store, i) =>
        (["s", "n"] as const).map((field) => ({
          name: name as keyof typeof relations,
          field,
          channel: i === 0 ? "c" : "d",
          store,
          coverage: coverageOf(relation, field, store, i === 0 ? "c" : "d"),
        })),
      ),
    );
    const select = (store: SelectionStore, channel: string) => {
      const kind = random();
      if (kind < 0.4) store.set(channel, selectWhere(col("v").ge(Math.round(random() * 10 - 5))));
      else if (kind < 0.8) {
        const rows = new RowSet(source);
        for (let p = 0; p < source.length; p++) if (random() < 0.3) rows.add(p);
        store.set(channel, selectRows(rows));
      } else store.set(channel, null);
    };
    for (const [i, store] of stores.entries()) select(store, i === 0 ? "c" : "d");
    for (let step = 0; step < 120; step++) {
      const action = random();
      if (action < 0.35) {
        const n = 1 + Math.floor(random() * 12);
        source.append(rowsOf(n, time) as never);
        time += n;
      } else if (action < 0.5 && source.length > 0) {
        const at = Math.floor(random() * source.length);
        const field = ["v", "x", "g"][Math.floor(random() * 3)]!;
        const value = field === "g" ? "b" : random() < 0.2 ? Number.NaN : Math.round(random() * 9);
        source.replace(at, { [field]: [value] } as never);
      } else if (action < 0.53) {
        source.reset(rowsOf(30, time) as never);
        time += 30;
      } else {
        const i = Math.floor(random() * 2);
        select(stores[i]!, i === 0 ? "c" : "d");
      }
      // Readers read in turns, so some lag behind others.
      for (const { name, field, store, channel, coverage } of coverages) {
        if (random() < 0.3) continue;
        const selection = held(source, store.get(channel));
        covers(
          coverage,
          oracles[name](field === "s" ? "v" : null),
          selection,
          field === "s" ? { field: "s", values: v() } : undefined,
        );
      }
    }
  }

  it.each([1, 2, 3, 4])("agree with recomputation after every step (seed %i)", (seed) =>
    run(seed, false),
  );
  it.each([5, 6])(
    "agree with recomputation on an ordered table, with insertions (seed %i)",
    (seed) => run(seed, true),
  );
});

describe("lineage budgets", () => {
  it("count what a binding builds before it is made, and refuse past the budget", () => {
    const n = 100_000;
    const source = untyped(
      {
        g: Array.from({ length: n }, (_, i) => `g${i % 1000}`),
        v: Float64Array.from({ length: n }, (_, i) => i % 7),
      },
      { name: "sales", maxRows: n },
    );
    const store = selectionStore(source);
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
    const relation = relationTo(groups.table, source)!;
    const cost = lineageCost(relation, ["s"], store, "c");
    // A byte a row and a quarter more room, transitions up to half a byte a
    // row, the rows dropped remembered (12 B each of a sixteenth), and 36 B
    // a group for counts and sums.
    const membership = n + n / 4 + 4 * (n / 8);
    const removals = 12 * Math.ceil(n / 16);
    expect(cost.required).toBe(membership + removals + 1000 * 36);
    expect(cost.required / n).toBeLessThan(BUDGET_PER_ROW);
    expect(cost.additional).toBe(cost.required);
    expect(cost.owned).toBe(groups.byteLength);
    // Once built, the same bytes are required and nothing more is.
    store.set("c", selectWhere(col("v").ge(3)));
    const coverage = coverageOf(relation, "s", store, "c");
    coverage.measure(0, "s");
    const built = lineageCost(relation, ["s"], store, "c");
    // What remains is room for transitions, kept as they happen.
    expect(built.required).toBe(cost.required);
    expect(built.additional).toBeLessThanOrEqual(4 * (n / 8));
    expect(
      budgetRefusal(cost, undefined, { target: '"byRegion"', source: '"sales"', rows: n }),
    ).toBeNull();
    const refused = budgetRefusal(cost, 2 ** 17, {
      target: '"byRegion"',
      source: '"sales"',
      rows: n,
    });
    expect(refused?.code).toBe("unsupported");
    expect(refused?.message).toBe(
      `rowSelection budget: highlighting "byRegion" through "sales" needs ${(cost.required / 2 ** 20).toFixed(1)} MiB of indexes, past 0.1 MiB (its budget); give a larger budget, or bind a store of "byRegion"`,
    );
  });

  it("count a derivation's trace by the rows its steps saw, before an aggregate builds it", () => {
    const n = 50_000;
    const source = untyped({
      g: Array.from({ length: n }, (_, i) => `g${i % 10}`),
      v: Float64Array.from({ length: n }, (_, i) => (i % 2 === 0 ? i : Number.NaN)),
    });
    const store = selectionStore(source);
    const aggregate = { aggregate: [{ op: "sum", field: "v", as: "s" }], by: ["g"] } as const;
    const filtered = relationTo(
      deriveTable(source, [{ filter: ["<", ["field", "v"], 1e9] }, aggregate]),
      source,
    )!;
    const sorted = relationTo(deriveTable(source, [{ sort: "v" }, aggregate]), source)!;
    // The membership (its bytes and room, transitions up to an eighth of the
    // rows), counts and sums of each group (36 B; the even rows kept hold
    // five of the ten), and the trace: an aggregate's group and list per row
    // it reads (8 B), a start per group, and a mask of v (1 B), after a
    // filter's rows kept (4 B each, of 25,000), or a sort's rows and their
    // inverse (4 B and 4 B).
    const membership = 62_500 + 4 * (n / 8);
    const kept = n / 2;
    const filteredCost = lineageCost(filtered, ["s"], store, "c");
    expect(filteredCost.required).toBe(membership + 5 * 36 + 4 * kept + 8 * kept + 4 * 6 + kept);
    expect(
      budgetRefusal(filteredCost, undefined, { target: "d", source: "s", rows: n }),
    ).toBeNull();
    const sortedCost = lineageCost(sorted, ["s"], store, "c");
    expect(sortedCost.required).toBe(membership + 10 * 36 + 8 * n + 8 * n + 4 * 11 + n);
    expect(
      budgetRefusal(sortedCost, undefined, { target: "d", source: "s", rows: n }),
    ).not.toBeNull();
    // The traces once made and read: their arrays, at most what was estimated.
    for (const relation of [filtered, sorted]) {
      store.set("c", selectWhere(col("v").ge(100)));
      coverageOf(relation, "s", store, "c").selected(0);
      expect(relation.byteLength).toBeGreaterThan(0);
      expect(relation.byteLength).toBeLessThanOrEqual(relation.estimate());
    }
  });
});

describe("lineage costs of derivations", () => {
  it("build nothing to count, and count the stamps and lists traversals make", () => {
    const n = 10_000;
    const source = untyped({
      g: Array.from({ length: n }, (_, i) => `g${i % 5000}`),
      v: Float64Array.from({ length: n }, (_, i) => i),
    });
    const store = selectionStore(source);
    const rolled = relationTo(
      deriveTable(source, [
        { rolling: [{ op: "sum", field: "v", as: "r" }], size: 3, by: [] },
        { aggregate: [{ op: "sum", field: "r", as: "s" }], by: ["g"] },
      ]),
      source,
    )!;
    const counted = relationTo(
      deriveTable(source, [{ aggregate: [{ op: "count", as: "n" }], by: ["g"] }]),
      source,
    )!;
    for (const [relation, field] of [
      [rolled, "s"],
      [counted, "n"],
    ] as const) {
      lineageCost(relation, [field], store, "c");
      expect(relation.byteLength, "counted before anything is made").toBe(0);
      expect(relation.targets).toBe(5000);
      const estimate = relation.estimate();
      for (let t = 0; t < relation.targets; t++) relation.count(t, field);
      for (let p = 0; p < 100; p++) relation.targetsOf(p, () => {}, field);
      expect(relation.byteLength).toBeGreaterThan(0);
      expect(relation.byteLength).toBeLessThanOrEqual(estimate);
    }
  });
});

describe("lineage costs as built", () => {
  const retained = (coverage: Coverage, store: SelectionStore, channel: string) => {
    const membership = membershipOf(store, channel);
    return (
      membership.byteLength +
      historyBytes(membership) +
      coverage.relation.byteLength +
      coverage.byteLength
    );
  };

  it("count coverage's room for groups appended", () => {
    const n = 10_000;
    const source = untyped({
      g: Array.from({ length: n }, (_, i) => `g${i % 3000}`),
      v: Float64Array.from({ length: n }, (_, i) => i),
    });
    const store = selectionStore(source);
    store.set("c", selectWhere(col("v").lt(5000)));
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
    const relation = relationTo(groups.table, source)!;
    const coverage = coverageOf(relation, "s", store, "c");
    coverage.measure(0, "s");
    source.append({ g: ["new"], v: [1] });
    // Asked before coverage grows into its room.
    const cost = lineageCost(relation, ["s"], store, "c");
    coverage.measure(3000, "s");
    expect(cost.required).toBeGreaterThanOrEqual(retained(coverage, store, "c"));
  });

  it("count a membership's growth past its room before it grows", () => {
    const n = 10_000;
    const source = untyped({
      g: Array.from({ length: n }, (_, i) => `g${i % 100}`),
      v: Float64Array.from({ length: n }, (_, i) => i),
    });
    const store = selectionStore(source);
    store.set("c", selectWhere(col("v").lt(5000)));
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
    const relation = relationTo(groups.table, source)!;
    const coverage = coverageOf(relation, "s", store, "c");
    coverage.selected(0);
    const membership = membershipOf(store, "c");
    const extra = membership.room - n + 1;
    source.append({
      g: Array.from({ length: extra }, () => "g0"),
      v: Float64Array.from({ length: extra }, () => 1),
    });
    const cost = lineageCost(relation, ["s"], store, "c");
    coverage.selected(0);
    expect(membership.room).toBeGreaterThanOrEqual(source.length);
    expect(cost.required).toBeGreaterThanOrEqual(retained(coverage, store, "c"));
  });

  it("count sums a shared coverage holds, though only a count is asked for", () => {
    const n = 10_000;
    const source = untyped({
      g: Array.from({ length: n }, (_, i) => `g${i % 3000}`),
      v: Float64Array.from({ length: n }, (_, i) => i),
    });
    const store = selectionStore(source);
    store.set("c", selectWhere(col("v").lt(5000)));
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v"), k: count("v") } });
    const relation = relationTo(groups.table, source)!;
    // One coverage for both: they read v's finite values.
    const coverage = coverageOf(relation, "s", store, "c");
    expect(coverageOf(relation, "k", store, "c")).toBe(coverage);
    coverage.measure(0, "s");
    source.append({ g: ["new"], v: [1] });
    const cost = lineageCost(relation, ["k"], store, "c");
    coverage.measure(3000, "s");
    expect(cost.required).toBeGreaterThanOrEqual(retained(coverage, store, "c"));
  });

  it("count a membership's growth once rows dropped from the front move its start", () => {
    const n = 10_000;
    const source = untyped(
      {
        g: Array.from({ length: n }, (_, i) => `g${i % 2550}`),
        v: Float64Array.from({ length: n }, (_, i) => i),
      },
      { maxRows: n },
    );
    const store = selectionStore(source);
    store.set("c", selectWhere(col("v").lt(5000)));
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
    const relation = relationTo(groups.table, source)!;
    const coverage = coverageOf(relation, "s", store, "c");
    coverage.measure(0, "s");
    const batch = (rows: number) =>
      source.append({
        g: Array.from({ length: rows }, () => "g0"),
        v: Float64Array.from({ length: rows }, () => 1),
      });
    batch(2500);
    coverage.measure(0, "s");
    // The drop moves the bytes' start past their room, though `room` is as before.
    batch(1);
    const cost = lineageCost(relation, ["s"], store, "c");
    coverage.measure(0, "s");
    expect(cost.required).toBeGreaterThanOrEqual(retained(coverage, store, "c"));
  });

  it("count a chain's derivations as of the rows they will read, asked before they heard of them", () => {
    const source = untyped({ g: ["a"], v: [1] });
    const store = selectionStore(source);
    store.set("c", selectWhere(true));
    const asked: [number, number][] = [];
    // Heard before either derivation hears the same change.
    source.subscribe(() => {
      const cost = lineageCost(relation, ["t"], store, "c");
      coverage.measure(0, "t");
      asked.push([cost.required, retained(coverage, store, "c")]);
    });
    const counts = deriveTable(source, [{ aggregate: [{ op: "count", as: "n" }], by: ["g"] }]);
    const total = deriveTable(counts, [
      { aggregate: [{ op: "sum", field: "n", as: "t" }], by: [] },
    ]);
    const relation = relationTo(total, source)!;
    const coverage = coverageOf(relation, "t", store, "c");
    coverage.selected(0);
    source.append({
      g: Array.from({ length: 1000 }, (_, i) => `n${i}`),
      v: Float64Array.from({ length: 1000 }, () => 1),
    });
    const [[required, kept]] = asked as [[number, number]];
    expect(required).toBeGreaterThanOrEqual(kept);
  });

  it("count a log kept for one relation and a trace another builds", () => {
    const n = 10_000;
    const source = untyped(
      {
        g: Array.from({ length: n }, (_, i) => `g${i % 7000}`),
        v: Float64Array.from({ length: n }, (_, i) => i % 13),
      },
      { maxRows: n },
    );
    const store = selectionStore(source);
    store.set("c", selectWhere(col("v").lt(6)));
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
    const direct = coverageOf(relationTo(groups.table, source)!, "s", store, "c");
    direct.selected(0);
    const ranked = deriveTable(groups.table as unknown as Table, [
      { sort: "s" },
      { aggregate: [{ op: "sum", field: "s", as: "t" }], by: [] },
    ]);
    const chain = relationTo(ranked, source)!;
    const cost = lineageCost(chain, ["t"], store, "c");
    const coverage = coverageOf(chain, "t", store, "c");
    coverage.selected(0);
    expect(cost.required).toBeGreaterThanOrEqual(retained(coverage, store, "c"));
  });
});

describe("disposal", () => {
  v8.setFlagsFromString("--expose-gc");
  const gc = vm.runInNewContext("gc") as () => void;
  const collected = async (ref: WeakRef<object>) => {
    for (let i = 0; i < 10 && ref.deref(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      gc();
    }
    return ref.deref() === undefined;
  };

  it("lets a store's memberships and coverages go with the store or the binding", async () => {
    const source = untyped({ g: ["a", "b"], v: [1, 2] });
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
    const relation = relationTo(groups.table, source)!;
    const refs = (() => {
      const store = selectionStore(source);
      store.set("c", selectWhere(true));
      const coverage = coverageOf(relation, "s", store, "c");
      coverage.selected(0);
      return [new WeakRef(store), new WeakRef(coverage), new WeakRef(membershipOf(store, "c"))];
    })();
    for (const ref of refs) expect(await collected(ref)).toBe(true);
    // A binding's coverage goes once no reader holds it, though the store stays.
    const store = selectionStore(source);
    const coverage = (() => new WeakRef(coverageOf(relation, "s", store, "c")))();
    expect(await collected(coverage)).toBe(true);
  });

  it("lets a derived table's trace go with it", async () => {
    const source = untyped({ g: ["a", "b", "a"], v: [1, 2, 3] });
    const traced = (() => {
      const derived = deriveTable(source, [{ aggregate: [{ op: "count", as: "n" }], by: ["g"] }]);
      relationTo(derived, source)!.count(0);
      return new WeakRef(derived);
    })();
    expect(await collected(traced)).toBe(true);
  });

  it("hold no table a relation was asked of in vain", async () => {
    const target = untyped({ x: [1] });
    const other = (() => {
      const unrelated = untyped({ x: [2] });
      expect(relationTo(target, unrelated)).toBeUndefined();
      return new WeakRef(unrelated);
    })();
    expect(await collected(other)).toBe(true);
  });

  it("let what readers built go once no coverage holds it, though the tables stay", async () => {
    const source = untyped({ g: ["a", "b", "a"], v: [1, 2, 3] }, { maxRows: 3 });
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
    const derived = deriveTable(source, [
      { aggregate: [{ op: "sum", field: "v", as: "s" }], by: ["g"] },
    ]);
    const byGroups = relationTo(groups.table, source)!;
    const byDerived = relationTo(derived, source)!;
    const store = selectionStore(source);
    const membership = membershipOf(store, "c");
    store.set("c", selectWhere(true));
    const coverages = (() =>
      [byGroups, byDerived].map((relation) => {
        const coverage = coverageOf(relation, "s", store, "c");
        coverage.selected(0);
        return new WeakRef(coverage);
      }))();
    store.set("c", selectWhere(col("v").gt(1)));
    for (const ref of coverages) ref.deref()!.selected(0);
    // The groups' log of dropped rows, the derivation's trace, the membership's history.
    expect([byGroups.byteLength, byDerived.byteLength, historyBytes(membership)]).not.toContain(0);
    for (const ref of coverages) expect(await collected(ref)).toBe(true);
    for (let i = 0; i < 10 && byGroups.byteLength + byDerived.byteLength > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      gc();
    }
    expect([byGroups.byteLength, byDerived.byteLength, historyBytes(membership)]).toEqual([
      0, 0, 0,
    ]);
  });

  it("keep the log every level of groups shares while one level's coverage holds it", async () => {
    const n = 1000;
    const source = untyped(
      {
        a: Array.from({ length: n }, (_, i) => `a${i % 10}`),
        b: Array.from({ length: n }, (_, i) => `b${i % 7}`),
        v: Float64Array.from({ length: n }, (_, i) => i),
      },
      { maxRows: n },
    );
    const store = selectionStore(source);
    store.set("c", selectWhere(col("v").lt(500)));
    const groups = groupRows(rowView(source), { by: ["a", "b"], ops: { s: sum("v") } });
    const parent = coverageOf(relationTo(groups.tableOf("a"), source)!, "s", store, "c");
    parent.selected(0);
    const leaf = (() => {
      const coverage = coverageOf(relationTo(groups.table, source)!, "s", store, "c");
      coverage.selected(0);
      return new WeakRef(coverage);
    })();
    expect(await collected(leaf)).toBe(true);
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      gc();
    }
    const rebuilds = coverageWork.rebuilds;
    source.append({ a: ["a0"], b: ["b0"], v: [1] });
    parent.selected(0);
    expect(coverageWork.rebuilds).toBe(rebuilds);
  });

  it("leaves disposed groups' targets without contributors", () => {
    const source = untyped({ g: ["a", "b"], v: [1, 2] });
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v") } });
    const relation = relationTo(groups.table, source)!;
    const revision = relation.revision;
    groups.dispose();
    expect(relation.revision).not.toBe(revision);
    const visited: number[] = [];
    relation.contributors(0, (p) => visited.push(p));
    expect(visited).toEqual([]);
    expect(relation.count(0)).toBe(0);
    expect(relation.groupAt(0)).toBe(-1);
  });
});

/** Keeps `Expression` imported for conditions written as arrays. */
export type { Expression };
