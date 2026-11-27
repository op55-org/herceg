import { describe, expect, it } from "vitest";
import { count, max, mean, min, sum } from "../../src/data/aggregations.ts";
import { type ContributorRelation, relationTo } from "../../src/data/contributors.ts";
import { deriveTable } from "../../src/data/derive.ts";
import { groupRows } from "../../src/data/groups.ts";
import { pivotRows } from "../../src/data/pivot.ts";
import { rowView } from "../../src/data/row-view.ts";
import { type Table, table } from "../../src/data/table.ts";
import { rowTotals } from "../../src/data/totals.ts";
import type { AggregateOp, TransformSpec } from "../../src/spec/spec.ts";

/** A table read by field name at run time, as lineage reads it. */
const untyped = (...args: Parameters<typeof table>) => table(...args) as unknown as Table;

// Contributor oracles: what each target's rows stand for, recomputed from
// the source by a reference that carries, for every row, the source rows
// behind each of its values, step by step.

type Value = number | string | null;

/** A reference row: its values, the source rows it stands for, and those behind each value. */
interface Ref {
  values: Record<string, Value>;
  own: Set<number>;
  of: Record<string, Set<number>>;
}

const FINITE = new Set(["count", "sum", "mean", "median", "min", "max", "stdev", "variance"]);
const finite = (v: Value) => typeof v === "number" && Number.isFinite(v);
const union = (sets: Iterable<Set<number>>) => {
  const out = new Set<number>();
  for (const set of sets) for (const x of set) out.add(x);
  return out;
};

/** The source's rows as reference rows. */
function refsOf(source: Table): Ref[] {
  return Array.from({ length: source.length }, (_, p) => ({
    values: Object.fromEntries(source.fields().map((f) => [f, source.value(f as never, p)])),
    own: new Set([p]),
    of: {},
  }));
}

/** Whether a row's x is below `value`; missing values are below nothing. */
const below = (row: Ref, value: number) => typeof row.values.x === "number" && row.values.x < value;

const behind = (row: Ref, field: string | undefined) =>
  field === undefined ? row.own : (row.of[field] ?? row.own);

/** A step as a transform and as the reference does it. */
interface Step {
  spec: TransformSpec;
  ref(rows: Ref[]): Ref[];
}

const filterStep = (field: string, below: number): Step => ({
  spec: { filter: ["<", ["field", field], below] },
  ref: (rows) =>
    rows.filter((r) => typeof r.values[field] === "number" && (r.values[field] as number) < below),
});

const calculateStep = (as: string, field: string): Step => ({
  spec: { calculate: ["*", ["field", field], 2], as },
  ref: (rows) =>
    rows.map((r) => {
      const v = r.values[field];
      return {
        ...r,
        values: { ...r.values, [as]: typeof v === "number" ? v * 2 : Number.NaN },
        of: { ...r.of, [as]: r.own },
      };
    }),
});

const sortStep = (field: string): Step => ({
  spec: { sort: field },
  ref: (rows) =>
    rows
      .map((r, i) => [r, i] as const)
      .sort(([a, i], [b, j]) => {
        const [x, y] = [a.values[field] as number, b.values[field] as number];
        const missing = (v: number) => !Number.isFinite(v);
        if (missing(x) || missing(y))
          return missing(x) === missing(y) ? i - j : missing(x) ? 1 : -1;
        return x - y || i - j;
      })
      .map(([r]) => r),
});

const aggregateStep = (
  by: string[],
  ops: { op: AggregateOp; field?: string; as: string }[],
): Step => ({
  spec: { aggregate: ops, by },
  ref: (rows) => {
    const keys = new Map<string, Ref[]>();
    for (const r of rows) {
      const key = JSON.stringify(by.map((f) => r.values[f]));
      keys.set(key, [...(keys.get(key) ?? []), r]);
    }
    if (by.length === 0 && keys.size === 0) keys.set("[]", []);
    return [...keys.values()].map((members) => {
      const values: Record<string, Value> = {};
      const of: Record<string, Set<number>> = {};
      for (const f of by) values[f] = members[0]!.values[f]!;
      for (const { op, field, as } of ops) {
        values[as] = 0;
        const reading =
          field === undefined
            ? members
            : FINITE.has(op)
              ? members.filter((m) => finite(m.values[field]!))
              : members;
        of[as] = union(reading.map((m) => behind(m, field)));
      }
      return { values, own: union(members.map((m) => m.own)), of };
    });
  },
});

const rollingStep = (size: number, by: string[], field: string, as: string): Step => ({
  spec: { rolling: [{ op: "sum", field, as }], size, by },
  ref: (rows) => {
    const seen = new Map<string, number[]>();
    return rows.map((r, i) => {
      const key = JSON.stringify(by.map((f) => r.values[f]));
      const list = [...(seen.get(key) ?? []), i];
      seen.set(key, list);
      const window = list.slice(-size).map((k) => rows[k]!);
      return {
        ...r,
        values: { ...r.values, [as]: 0 },
        of: {
          ...r.of,
          [as]: union(window.filter((w) => finite(w.values[field]!)).map((w) => behind(w, field))),
        },
      };
    });
  },
});

/** Every target's contributors for `field`, as the relation visits them; each visited once. */
function visited(relation: ContributorRelation, field?: string): number[][] {
  return Array.from({ length: relation.targets }, (_, t) => {
    const out: number[] = [];
    relation.contributors(t, (p) => out.push(p), field);
    expect(new Set(out).size, `target ${t} visits a row twice`).toBe(out.length);
    return out.sort((a, b) => a - b);
  });
}

/** Checks a relation against reference sets by target, both ways, with counts and incidences. */
function agrees(relation: ContributorRelation, expected: Set<number>[], field?: string) {
  expect(relation.targets).toBe(expected.length);
  const sorted = expected.map((set) => [...set].sort((a, b) => a - b));
  expect(visited(relation, field)).toEqual(sorted);
  for (let t = 0; t < expected.length; t++)
    expect(relation.count(t, field)).toBe(expected[t]!.size);
  // Each source row's targets, and its group where the relation is a partition.
  const rows = relation.source.length;
  for (let p = 0; p < rows; p++) {
    const targets: number[] = [];
    relation.targetsOf(p, (t) => targets.push(t), field);
    const want = sorted.flatMap((set, t) => (set.includes(p) ? [t] : []));
    expect(
      targets.sort((a, b) => a - b),
      `row ${p}`,
    ).toEqual(want);
    if (relation.partition) expect(relation.groupAt(p, field)).toBe(want[0] ?? -1);
  }
  const pairs: string[] = [];
  relation.incidences((p, g) => pairs.push(`${p}:${g}`), field);
  expect(pairs.sort()).toEqual(sorted.flatMap((set, t) => set.map((p) => `${p}:${t}`)).sort());
}

/** A source of `n` rows with missing values here and there, by a seed. */
function sourceOf(n: number, seed: number) {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
  return untyped(
    {
      g: Array.from({ length: n }, () => ["a", "b", "c", null][Math.floor(random() * 4)]!),
      h: Array.from({ length: n }, () => ["x", "y"][Math.floor(random() * 2)]!),
      x: Float64Array.from({ length: n }, () => (random() < 0.1 ? Number.NaN : random() * 10)),
      v: Float64Array.from({ length: n }, () =>
        random() < 0.15 ? Number.NaN : Math.round(random() * 20 - 5),
      ),
    },
    { name: "sales" },
  );
}

describe("contributor relations of derived tables", () => {
  const pipelines: [string, Step[], string[]][] = [
    ["a filter", [filterStep("x", 6)], ["v", undefined as never]],
    ["a filter and a sort", [filterStep("x", 8), sortStep("v")], ["v"]],
    [
      "a filter and an aggregate",
      [
        filterStep("x", 7),
        aggregateStep(
          ["g"],
          [
            { op: "sum", field: "v", as: "s" },
            { op: "count", as: "n" },
            { op: "mean", field: "x", as: "m" },
            { op: "first", field: "v", as: "f" },
          ],
        ),
      ],
      ["s", "n", "m", "f", "g"],
    ],
    [
      "an aggregate of a calculation",
      [calculateStep("w", "v"), aggregateStep(["h"], [{ op: "sum", field: "w", as: "s" }])],
      ["s"],
    ],
    [
      "a pipeline that aggregates twice",
      [
        aggregateStep(
          ["g", "h"],
          [
            { op: "sum", field: "v", as: "s" },
            { op: "max", field: "x", as: "top" },
          ],
        ),
        aggregateStep(
          ["g"],
          [
            { op: "sum", field: "s", as: "t" },
            { op: "count", as: "n" },
            { op: "mean", field: "top", as: "m" },
          ],
        ),
      ],
      ["t", "n", "m", "g"],
    ],
    ["overlapping rolling windows", [sortStep("x"), rollingStep(3, ["h"], "v", "r")], ["r", "v"]],
    [
      "an aggregate of rolling windows",
      [rollingStep(4, [], "v", "r"), aggregateStep(["g"], [{ op: "sum", field: "r", as: "s" }])],
      ["s", "g"],
    ],
    [
      "an aggregate without groups",
      [aggregateStep([], [{ op: "sum", field: "v", as: "s" }])],
      ["s"],
    ],
  ];

  it.each(pipelines)("visit what %s reads of the source", (_, steps, fields) => {
    const source = sourceOf(60, 7);
    const derived = deriveTable(
      source,
      steps.map((s) => s.spec),
    );
    const relation = relationTo(derived, source)!;
    expect(relation.target).toBe(derived);
    let refs = refsOf(source);
    for (const step of steps) refs = step.ref(refs);
    for (const field of [...fields, undefined])
      agrees(
        relation,
        refs.map((r) => behind(r, field)),
        field,
      );
  });

  it("follow their source: appends, drops, and recomputations", () => {
    const source = untyped({ x: [1, 9, 2], v: [1, 2, 3] }, { maxRows: 4 });
    const filtered = deriveTable(source, [{ filter: ["<", ["field", "x"], 5] }]);
    const relation = relationTo(filtered, source)!;
    expect(relation.single && relation.partition).toBe(true);
    agrees(relation, [new Set([0]), new Set([2])]);
    const layout = relation.layout;
    source.append({ x: [3, 4], v: [4, 5] });
    // Rows 1, 3, 4 now: the first dropped, so targets were renumbered.
    expect(relation.layout).not.toBe(layout);
    agrees(relation, [new Set([1]), new Set([2]), new Set([3])]);
    const aggregated = deriveTable(source, [{ aggregate: [{ op: "count", as: "n" }] }]);
    const counted = relationTo(aggregated, source)!;
    agrees(counted, [new Set([0, 1, 2, 3])]);
    const revision = counted.revision;
    source.set("x", 0, 50);
    expect(counted.revision).not.toBe(revision);
    agrees(counted, [new Set([0, 1, 2, 3])]);
  });

  it("visit each row once through rolling windows of rolling windows", () => {
    const source = untyped({ v: [1, 2, 3, 4] });
    const derived = deriveTable(source, [
      { rolling: [{ op: "sum", field: "v", as: "a" }], size: 2, by: [] },
      { rolling: [{ op: "sum", field: "a", as: "b" }], size: 2, by: [] },
    ]);
    const relation = relationTo(derived, source)!;
    const sets = (...lists: number[][]) => lists.map((list) => new Set(list));
    agrees(relation, sets([0], [0, 1], [0, 1, 2], [1, 2, 3]), "b");
    agrees(relation, sets([0], [0, 1], [1, 2], [2, 3]), "a");
    agrees(relation, sets([0], [1], [2], [3]), "v");
  });

  it("catch up with their source when read before it reached them", () => {
    const source = untyped({ g: ["a", "a"] });
    const seen: [number, number[]][] = [];
    // Heard before the derivation hears the same change.
    source.subscribe(() => {
      const relation = relationTo(derived, source)!;
      const targets: number[] = [];
      relation.targetsOf(2, (t) => targets.push(t));
      seen.push([relation.targets, targets]);
    });
    const derived = deriveTable(source, [{ aggregate: [{ op: "count", as: "n" }], by: ["g"] }]);
    source.append({ g: ["b"] });
    expect(seen).toEqual([[2, [1]]]);
  });

  it("catch up a chain of derivations from the source up when read before they heard", () => {
    const source = untyped({ g: ["a", "a"] });
    const seen: number[][] = [];
    // Heard before either derivation hears the same change.
    source.subscribe(() => {
      const visited: number[] = [];
      relationTo(summed, source)!.contributors(0, (p) => visited.push(p));
      seen.push(visited.sort());
    });
    const counted = deriveTable(source, [{ aggregate: [{ op: "count", as: "n" }], by: ["g"] }]);
    const summed = deriveTable(counted, [
      { aggregate: [{ op: "sum", field: "n", as: "s" }], by: [] },
    ]);
    relationTo(summed, source)!.count(0);
    source.append({ g: ["b"] });
    expect(seen).toEqual([[0, 1, 2]]);
  });

  it("are none for tables no lineage connects", () => {
    const a = untyped({ x: [1] });
    const b = untyped({ x: [1] });
    expect(relationTo(b, a)).toBeUndefined();
    expect(relationTo(a, a)).toBeUndefined();
  });
});

describe("contributor relations of groups, totals, and pivots", () => {
  it("give each group the rows the view shows of its key, by level, finite for each aggregate", () => {
    const source = sourceOf(80, 3);
    const view = rowView(source, { filter: ["<", ["field", "x"], 8] });
    const groups = groupRows(view, {
      by: ["g", "h"],
      ops: { s: sum("v"), n: count(), m: mean("x"), top: max("v"), low: min("x") },
    });
    const shown = refsOf(source).filter((r) => below(r, 8));
    for (const [depth, level] of [
      [0, groups.tableOf("g") as unknown as Table],
      [1, groups.table as unknown as Table],
    ] as const) {
      const relation = relationTo(level, source)!;
      expect(relation.partition).toBe(true);
      const key = (r: Ref) =>
        JSON.stringify(["g", "h"].slice(0, depth + 1).map((f) => r.values[f]));
      for (const [field, operand] of [
        ["s", "v"],
        ["n", undefined],
        ["m", "x"],
        ["top", "v"],
        [undefined, undefined],
      ] as const) {
        const expected = Array.from({ length: groups.countAt(depth) }, (_, g) => {
          const k = JSON.stringify(groups.keyOf(g, depth));
          return new Set(
            shown
              .filter((r) => key(r) === k && (operand === undefined || finite(r.values[operand]!)))
              .map((r) => [...r.own][0]!),
          );
        });
        agrees(relation, expected, field);
      }
    }
  });

  it("give totals every row the view shows", () => {
    const source = sourceOf(40, 11);
    const totals = rowTotals(rowView(source, { filter: ["<", ["field", "x"], 5] }), {
      ops: { s: sum("v"), n: count() },
    });
    const relation = relationTo(totals.table, source)!;
    const shown = refsOf(source).filter((r) => below(r, 5));
    agrees(relation, [new Set(shown.map((r) => [...r.own][0]!))], "n");
    agrees(
      relation,
      [new Set(shown.filter((r) => finite(r.values.v!)).map((r) => [...r.own][0]!))],
      "s",
    );
  });

  it("give a pivot's cells and rows theirs, and an absent cell none", () => {
    const source = untyped({
      region: ["N", "N", "S", "S", "E"],
      kind: ["a", "b", "a", "a", "b"],
      v: [1, 2, 3, 4, 5],
    });
    const pivot = pivotRows(rowView(source), {
      rows: "region",
      pivot: "kind",
      ops: { n: count(), s: sum("v") },
      zeroFill: "count",
    });
    const crosstab = pivot.read();
    const cells = relationTo(pivot.table, source)!;
    const rows = relationTo(pivot.rowTable, source)!;
    const rowOf = (region: string) =>
      [...Array(crosstab.rowCount).keys()].find((r) => crosstab.rowKey(r) === region)!;
    const at = (region: string, kind: string) =>
      crosstab.cell(rowOf(region), crosstab.indexOf(kind));
    const members = (relation: ContributorRelation, target: number) => {
      const out: number[] = [];
      relation.contributors(target, (p) => out.push(p));
      return out.sort();
    };
    expect(members(cells, at("S", "a"))).toEqual([2, 3]);
    expect(members(cells, at("N", "b"))).toEqual([1]);
    // S has no b: no cell, so no contributors; its count reads 0 as filled.
    expect(at("S", "b")).toBe(-1);
    expect(crosstab.value(rowOf("S"), crosstab.indexOf("b"), "n")).toBe(0);
    expect(members(rows, rowOf("S"))).toEqual([2, 3]);
    expect(cells.measureOf("s")).toEqual({ op: "sum", field: "v" });
  });

  it("compose through chains of tables", () => {
    const source = sourceOf(70, 5);
    const filtered = deriveTable(source, [{ filter: ["<", ["field", "x"], 9] }]);
    const groups = groupRows(rowView(filtered), { by: ["g"], ops: { s: sum("v"), n: count() } });
    const relation = relationTo(groups.table, source)!;
    expect(relation.partition).toBe(true);
    const shown = refsOf(source).filter((r) => below(r, 9));
    for (const [field, operand] of [
      ["s", "v"],
      ["n", undefined],
    ] as const) {
      const expected = Array.from({ length: groups.length }, (_, g) => {
        const [key] = groups.keyOf(g);
        return new Set(
          shown
            .filter(
              (r) => r.values.g === key && (operand === undefined || finite(r.values[operand]!)),
            )
            .map((r) => [...r.own][0]!),
        );
      });
      agrees(relation, expected, field);
    }
    expect(relationTo(groups.table, source)).toBe(relation);
    expect(relationTo(groups.table, filtered)).not.toBe(relation);
  });
});

describe("measures", () => {
  const source = sourceOf(30, 9);

  it("are stated for one count or sum over the ancestor's field, reached row by row", () => {
    const derived = deriveTable(source, [
      { filter: ["<", ["field", "x"], 9] },
      { sort: "x" },
      {
        aggregate: [
          { op: "sum", field: "v", as: "s" },
          { op: "count", as: "n" },
          { op: "count", field: "v", as: "nv" },
          { op: "mean", field: "v", as: "m" },
        ],
        by: ["g"],
      },
      { filter: [">", ["field", "n"], 0] },
    ]);
    const relation = relationTo(derived, source)!;
    expect(relation.measureOf("s")).toEqual({ op: "sum", field: "v" });
    expect(relation.measureOf("n")).toEqual({ op: "count" });
    expect(relation.measureOf("nv")).toEqual({ op: "count", field: "v" });
    expect(relation.measureOf("m")).toBeUndefined();
    expect(relation.measureOf("g")).toBeUndefined();
    const groups = groupRows(rowView(source), { by: ["g"], ops: { s: sum("v"), m: mean("v") } });
    const grouped = relationTo(groups.table, source)!;
    expect(grouped.measureOf("s")).toEqual({ op: "sum", field: "v" });
    expect(grouped.measureOf("m")).toBeUndefined();
    const through = groupRows(
      rowView(deriveTable(source, [{ filter: ["<", ["field", "x"], 9] }])),
      {
        by: ["g"],
        ops: { s: sum("v"), n: count() },
      },
    );
    expect(relationTo(through.table, source)!.measureOf("s")).toEqual({ op: "sum", field: "v" });
    expect(relationTo(through.table, source)!.measureOf("n")).toEqual({ op: "count" });
  });

  it("are none for nested aggregates, rolling windows, sums after a calculation, and fields of tables between", () => {
    const nested = deriveTable(source, [
      { aggregate: [{ op: "sum", field: "v", as: "s" }], by: ["g", "h"] },
      {
        aggregate: [
          { op: "sum", field: "s", as: "t" },
          { op: "count", as: "n" },
        ],
        by: ["g"],
      },
    ]);
    expect(relationTo(nested, source)!.measureOf("t")).toBeUndefined();
    expect(relationTo(nested, source)!.measureOf("n")).toBeUndefined();
    const rolled = deriveTable(source, [
      { rolling: [{ op: "sum", field: "v", as: "r" }], size: 3 },
    ]);
    expect(relationTo(rolled, source)!.measureOf("r")).toBeUndefined();
    const ofRolled = deriveTable(source, [
      { rolling: [{ op: "sum", field: "v", as: "r" }], size: 3 },
      {
        aggregate: [
          { op: "sum", field: "r", as: "s" },
          { op: "sum", field: "v", as: "sv" },
        ],
        by: ["g"],
      },
    ]);
    expect(relationTo(ofRolled, source)!.measureOf("s")).toBeUndefined();
    // A field a rolling step passes through still sums its rows.
    expect(relationTo(ofRolled, source)!.measureOf("sv")).toEqual({ op: "sum", field: "v" });
    const calculated = deriveTable(source, [
      { calculate: ["*", ["field", "v"], 2], as: "w" },
      { aggregate: [{ op: "sum", field: "w", as: "s" }], by: ["g"] },
    ]);
    expect(relationTo(calculated, source)!.measureOf("s")).toBeUndefined();
    const after = deriveTable(source, [
      { aggregate: [{ op: "sum", field: "v", as: "s" }], by: ["g"] },
      { calculate: ["*", ["field", "s"], 2], as: "s2" },
    ]);
    expect(relationTo(after, source)!.measureOf("s2")).toBeUndefined();
    expect(relationTo(after, source)!.measureOf("s")).toEqual({ op: "sum", field: "v" });
    const between = deriveTable(source, [{ calculate: ["*", ["field", "v"], 2], as: "w" }]);
    const groups = groupRows(rowView(between), { by: ["g"], ops: { s: sum("w"), sv: sum("v") } });
    expect(relationTo(groups.table, source)!.measureOf("s")).toBeUndefined();
    expect(relationTo(groups.table, between)!.measureOf("s")).toEqual({ op: "sum", field: "w" });
    expect(relationTo(groups.table, source)!.measureOf("sv")).toEqual({ op: "sum", field: "v" });
  });
});
