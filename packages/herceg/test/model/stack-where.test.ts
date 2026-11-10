// Stacked areas take `where`: rows it leaves out end their series' runs,
// so the whole stack breaks there, as at a `continuity` break; a series it
// leaves out wholly is no layer, and a condition on the series field alone
// picks layers before stacking. Stacks of fields offset the rows it keeps.
import { describe, expect, it } from "vitest";
import { encodedCategory } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { facet } from "../../src/model/facet.ts";
import { type AxisInspection, type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { Picker } from "../../src/model/pick.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type { AreaGeometry, LabelsGeometry, Scene } from "../../src/scene/scene.ts";
import { loadSpec } from "../../src/spec/load.ts";
import { contractTest } from "../helpers/contracts.ts";
import { pickKit } from "../helpers/picker.ts";
import { xScale, yScale } from "../helpers/scales.ts";

function build(config: ChartConfig, width = 600) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", legend: false, ...config },
    undefined,
    staticCompilers(),
  );
  model.setSize(width, 300, 1);
  return { model, scene: model.scene(estimateText) };
}

const areasOf = (scene: Scene, panel = 0) =>
  scene.panels[panel]!.marks.filter((g): g is AreaGeometry => g.kind === "area");

/** Each run of an area's top edge: its first and last x, in data units. */
function spans(model: ChartModel, geometry: AreaGeometry): [number, number][] {
  const x = xScale(model)!;
  const { upper } = geometry;
  const at = (point: number) => Math.round(x.invert(upper.coords[point * 2]!) * 100) / 100;
  return upper.starts.flatMap((start, r) =>
    upper.runEnd(r) > start ? [[at(start), at(upper.runEnd(r) - 1)] as [number, number]] : [],
  );
}

/** Each layer of the chart's stack as drawn: its name, positions, tops, and bottoms. */
const edgesOf = (model: ChartModel) =>
  model
    .series()
    .map((s) => [
      s.label,
      s.edges && [...s.edges.x],
      s.edges && [...s.edges.top],
      s.edges?.bottom && [...s.edges.bottom],
    ]);

type Rows = { t: "number"; v: "number"; s: "category" };
/** A stack of `s`'s series of `v` over `t`. */
const stacked = (data: object, options: Record<string, unknown> = {}) =>
  area(data as Table<Rows>, { x: "t", y: "v", series: "s", stack: true, ...options });

/** Two pumps: a from 0 to 6, b at 2, 3, 4 and 8. */
const pumps = () =>
  table({
    t: [0, 1, 2, 3, 4, 5, 6, 2, 3, 4, 8],
    v: [1, 1, 1, 1, 1, 1, 1, 10, 10, 10, 90],
    s: [..."aaaaaaabbbb"],
  });

/** Every series' rows interleaved by time, as one table of observations holds them. */
function observations(names: readonly string[], count: number) {
  const t: number[] = [];
  const codes: number[] = [];
  const v: number[] = [];
  for (let i = 0; i < count; i++)
    for (const [code] of names.entries()) {
      t.push(i);
      codes.push(code);
      v.push(code + 1 + (i % 3));
    }
  return { t, codes, v };
}

describe("stacked areas with where", () => {
  contractTest(
    "stack.where.layers",
    () => {
      const names = ["pump-a", "flow", "pump-b", "temp"];
      const { t, codes, v } = observations(names, 6);
      const all = table({ t, v, s: encodedCategory(Int32Array.from(codes), names) });
      const pumpsOnly = codes.flatMap((code, i) => (names[code]?.startsWith("pump") ? [i] : []));
      const own = table({
        t: pumpsOnly.map((i) => t[i]!),
        v: pumpsOnly.map((i) => v[i]!),
        s: encodedCategory(
          Int32Array.from(pumpsOnly, (i) => codes[i]!),
          names,
        ),
      });
      const where = col("s").isIn("pump-a", "pump-b");
      const picked = build({ marks: [stacked(all, { where })] });
      const theirs = build({ marks: [stacked(own)] });
      // The other series are no layers, nor series: the stack is the pumps' own.
      expect(picked.model.series().map((s) => s.label)).toEqual(["pump-a", "pump-b"]);
      expect(edgesOf(picked.model)).toEqual(edgesOf(theirs.model));
      expect(yScale(picked.model)!.domain).toEqual(yScale(theirs.model)!.domain);
      // Read by their rows of the whole table, sparse among the others'.
      const x = xScale(picked.model)!;
      const plot = picked.scene.panels[0]!.plot;
      const at = picked.model.inspect(x.map(4), plot.y + 5) as AxisInspection;
      expect(at.points.map((p) => [p.label, p.value, all.numbers("v")[p.row!]])).toEqual([
        ["pump-a", 2, 2],
        ["pump-b", 4, 4],
      ]);
      // Hidden, a picked layer drops out as without `where`.
      picked.model.hidden.add(picked.model.series()[0]!.key);
      theirs.model.hidden.add(theirs.model.series()[0]!.key);
      picked.model.scene(estimateText);
      theirs.model.scene(estimateText);
      expect(edgesOf(picked.model)).toEqual(edgesOf(theirs.model));
    },
    "a condition on the series field picks a stack's layers, as a table of theirs would stack",
  );

  contractTest(
    "stack.where.breaks",
    () => {
      // b's row at 3 is left out: the whole stack breaks there, as at a continuity break.
      const where = col("t").ne(3).or(col("s").ne("b"));
      for (const [support, expected] of [
        [
          "union",
          [
            [0, 2],
            [4, 8],
          ],
        ],
        [
          "intersection",
          [
            [2, 2],
            [4, 6],
          ],
        ],
      ] as const) {
        const { model, scene } = build({
          marks: [stacked(pumps(), { where, stack: { support } })],
        });
        expect(areasOf(scene).map((g) => spans(model, g))).toEqual([expected, expected]);
        // Nothing is read inside the break, as for a line of each layer.
        const x = xScale(model)!;
        const plot = scene.panels[0]!.plot;
        const read = (t: number) =>
          (model.inspect(x.map(t), plot.y + 5) as AxisInspection | undefined)?.points.map(
            (p) => p.label,
          ) ?? [];
        expect(read(3)).toEqual([]);
      }
      // A row left out where no other layer has one breaks the stack too.
      const lone = table({
        t: [0, 1, 2, 3, 0, 1, 1.5, 2, 3],
        v: [1, 1, 1, 1, 10, 10, -1, 10, 10],
        s: [..."aaaabbbbb"],
      });
      const { model, scene } = build({ marks: [stacked(lone, { where: col("v").ge(0) })] });
      expect(areasOf(scene).map((g) => spans(model, g))).toEqual([
        [
          [0, 1],
          [2, 3],
        ],
        [
          [0, 1],
          [2, 3],
        ],
      ]);
      // A series every row of which is left out is no layer, and breaks nothing.
      const wholly = build({
        marks: [stacked(lone, { where: col("s").ne("b").or(col("v").ge(0)).and(col("t").ne(9)) })],
      });
      expect(wholly.model.series().map((s) => s.label)).toEqual(["a", "b"]);
      const empty = build({ marks: [stacked(pumps(), { where: col("v").lt(5) })] });
      expect(empty.model.series().map((s) => s.label)).toEqual(["a"]);
      expect(areasOf(empty.scene).map((g) => spans(empty.model, g))).toEqual([[[0, 6]]]);
    },
    "rows left out break the whole stack; a series left out wholly is no layer",
  );

  contractTest(
    "stack.where.facets",
    () => {
      const data = table({
        t: [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2],
        v: [1, 1, 1, 5, 5, 5, 1, 1, 1, 5, 5, 5],
        s: [..."aaabbbaaabbb"],
        region: [..."NNNNNNSSSSSS"],
      });
      // In the south, b's rows are all left out: there it is no layer, and a stands unbroken.
      const { model, scene } = build({
        facet: facet("region"),
        x: { domain: [0, 2], nice: false },
        marks: [
          area(data as never, {
            x: "t",
            y: "v",
            series: "s",
            where: col("region").ne("S").or(col("s").ne("b")),
            stack: { support: "intersection" },
          }),
        ],
      });
      // Its own layer draws nothing there.
      const tops = (panel: number) =>
        areasOf(scene, panel).flatMap((g) => {
          if (g.upper.count === 0) return [];
          const y = model.inspectorOf(model.panels()[panel]!.key)!.frame.y;
          return [
            Array.from({ length: g.upper.count }, (_, k) =>
              Math.round(y.invert(g.upper.coords[k * 2 + 1]!)),
            ),
          ];
        });
      expect(tops(0)).toEqual([
        [1, 1, 1],
        [6, 6, 6],
      ]);
      expect(tops(1)).toEqual([[1, 1, 1]]);
    },
    "a facet's panel stacks the layers its rows keep",
  );

  contractTest(
    "stack.where.targets",
    () => {
      // b's last row is left out: its label stands at its last kept row, and nothing is picked there.
      const where = col("t").ne(8);
      const { model, scene } = build({
        marks: [stacked(pumps(), { where, labels: { at: "last" } })],
      });
      const labels = scene.panels[0]!.marks.flatMap((g) =>
        g.kind === "labels"
          ? [...(g as LabelsGeometry).items].map((item) => [
              item.text,
              Math.round(xScale(model)!.invert(item.x)),
            ])
          : [],
      );
      expect(labels.sort()).toEqual([
        ["a", 6],
        ["b", 4],
      ]);
      const picker = new Picker(pickKit);
      const pick = (t: number, v: number) => {
        const part = picker.pick(model, {
          x: xScale(model)!.map(t),
          y: yScale(model)!.map(v),
          slop: 4,
        })?.item.part;
        return part?.kind === "row" ? part.position : part?.kind;
      };
      // b's fill over a at 3: its row there.
      expect(pick(3, 6)).toBe(8);
      // At 8, where b's row is left out, nothing.
      expect(pick(8, 40)).toBeUndefined();
    },
    "labels and picking read a stacked layer's kept rows",
  );

  contractTest(
    "stack.where.streaming",
    () => {
      const make = (data: object, where: object) =>
        stacked(data, {
          where,
          continuity: { maxGap: 2 },
          stack: { gaps: "interpolate", support: "intersection" },
        });
      for (const where of [col("s").ne("c"), col("v").ne(7).and(col("s").ne("c"))]) {
        const live = orderedTable(
          { t: [0, 1, 2, 6, 0, 6, 0], v: [1, 1, 1, 1, 10, 10, 5], s: [..."aaaabbc"] },
          { orderBy: "t", maxRows: 14 },
        );
        const chart = build({ marks: [make(live as unknown as Table, where as never)] });
        for (const late of [
          { t: [4], v: [10], s: ["b"] },
          { t: [2, 4, 3, 1], v: [10, 1, 1, 7], s: ["b", "a", "a", "c"] },
          { t: [5, 7, 8], v: [7, 10, 1], s: ["a", "b", "a"] },
          { t: [6.5, 3.5, 9], v: [2, 2, 2], s: ["b", "c", "a"] },
        ]) {
          live.append(late);
          chart.model.scene(estimateText);
          // As a stack of the same rows from scratch.
          const copy = table({
            t: Array.from(live.numbers("t")),
            v: Array.from(live.numbers("v")),
            s: encodedCategory(Int32Array.from(live.categories("s").codes), [
              ...live.categories("s").dictionary,
            ]),
          });
          const again = build({ marks: [make(copy, where as never)] });
          expect(edgesOf(chart.model)).toEqual(edgesOf(again.model));
        }
      }
    },
    "follows ordered merges and appends, as a stack of the same rows from scratch",
  );

  it("breaks and ends layers along x, rows out of order or not", () => {
    // a's row at 1 is left out: last of a's rows in the table, between its others along x.
    const where = col("t").ne(1).or(col("s").ne("a"));
    const ordered = table({ t: [0, 1, 2, 0, 1, 2], v: [1, 1, 1, 5, 5, 5], s: [..."aaabbb"] });
    const shuffled = table({ t: [0, 2, 1, 0, 1, 2], v: [1, 1, 1, 5, 5, 5], s: [..."aaabbb"] });
    const drawn = (data: object) => {
      const { model, scene } = build({ marks: [stacked(data, { where })] });
      return areasOf(scene).map((g) => spans(model, g));
    };
    expect(drawn(shuffled)).toEqual(drawn(ordered));
    expect(drawn(ordered)[0]).toEqual([
      [0, 0],
      [2, 2],
    ]);
    // Left out at its end along x, though not at the table's end of its rows, a row
    // shortens its layer and breaks nothing: b runs on through 2.
    const late = build({
      marks: [stacked(shuffled, { where: col("t").ne(2).or(col("s").ne("a")) })],
    });
    expect(areasOf(late.scene).map((g) => spans(late.model, g))).toEqual([[[0, 2]], [[0, 2]]]);
    expect(late.model.series()[0]!.rows).toEqual(Uint32Array.of(0, 2));
  });

  it("breaks at a row left out between kept rows of one position, in panels or not", () => {
    // a's second row at 0 is left out, after its first there and before its row at 1.
    const rows = { t: [0, 0, 1, 2, 0, 1, 2], ok: [1, 0, 1, 1, 1, 1, 1], v: [1, 1, 1, 1, 5, 5, 5] };
    const where = col("ok").eq(1);
    const drawn = (order: number[], config: Partial<ChartConfig> = {}) => {
      const pick = <T>(values: readonly T[]) => order.map((i) => values[i]!);
      const data = table({
        t: pick(rows.t),
        ok: pick(rows.ok),
        v: pick(rows.v),
        s: pick([..."aaaabbb"]),
        all: order.map(() => "all"),
      });
      const { model, scene } = build({ ...config, marks: [stacked(data, { where })] });
      return areasOf(scene).map((g) => spans(model, g));
    };
    const ordered = drawn([0, 1, 2, 3, 4, 5, 6]);
    expect(ordered[0]).toEqual([
      [0, 0],
      [1, 2],
    ]);
    expect(drawn([0, 1, 2, 3, 4, 5, 6], { facet: facet("all") })).toEqual(ordered);
    expect(drawn([3, 0, 2, 1, 4, 5, 6])).toEqual(ordered);
  });

  it("follows appends that put a series' rows out of order", () => {
    for (const where of [col("s").ne("c"), col("v").ne(7)]) {
      const live = table({ t: [0, 1, 2, 0, 2], v: [1, 1, 1, 5, 5], s: [..."aaabb"] });
      const chart = build({ marks: [stacked(live, { where })] });
      live.append({ t: [0.5], v: [4], s: ["a"] });
      chart.model.scene(estimateText);
      const again = build({
        marks: [
          stacked(table({ t: [0, 1, 2, 0, 2, 0.5], v: [1, 1, 1, 5, 5, 4], s: [..."aaabba"] }), {
            where,
          }),
        ],
      });
      expect(edgesOf(chart.model)).toEqual(edgesOf(again.model));
      expect(edgesOf(chart.model)[0]![1]).toEqual([0, 0.5, 1, 2]);
    }
    // A kept row appended past the rows left out at a layer's end takes them in, out of order.
    const rows = {
      t: [0, 1, 2, 4, 3, 0, 2],
      v: [10, 10, 10, 1, 1, 1, 1],
      ok: [1, 1, 1, 0, 0, 1, 0],
      s: [..."bbbaaaa"],
    };
    const where = col("ok").eq(1);
    const live = table(rows);
    const chart = build({ marks: [stacked(live, { where })] });
    live.append({ t: [5], v: [1], ok: [1], s: ["a"] });
    chart.model.scene(estimateText);
    const again = build({
      marks: [
        stacked(
          table({ t: [...rows.t, 5], v: [...rows.v, 1], ok: [...rows.ok, 1], s: [...rows.s, "a"] }),
          { where },
        ),
      ],
    });
    expect(edgesOf(chart.model)).toEqual(edgesOf(again.model));
  });

  it("leaves out a series whose rows where and continuity.defined both leave out", () => {
    const data = table({
      t: [0, 1, 2, 0, 1, 2],
      v: [1, 1, 1, 10, 10, 10],
      ok: [1, 1, 1, 0, 0, 0],
      s: [..."aaabbb"],
    });
    const { model, scene } = build({
      marks: [
        stacked(data, {
          where: col("v").lt(5),
          continuity: { defined: col("ok").eq(1) },
          stack: { support: "intersection" },
        }),
      ],
    });
    expect(model.series().map((s) => s.label)).toEqual(["a"]);
    expect(areasOf(scene).map((g) => spans(model, g))).toEqual([[[0, 2]]]);
  });

  it("picks layers under a monotone curve, which a condition on rows refuses", () => {
    const { model } = build({
      marks: [stacked(pumps(), { where: col("s").eq("a"), curve: "monotone" })],
    });
    expect(model.series().map((s) => s.label)).toEqual(["a"]);
    expect(() =>
      build({ marks: [stacked(pumps(), { where: col("v").lt(5), curve: "monotone" })] }),
    ).toThrow(
      "area (mark 0) where: monotone curves cannot meet a condition where it changes; give a linear or step curve",
    );
  });

  it("offsets a stack of fields over the rows it keeps", () => {
    const rows = { t: [0, 1, 2, 3, 4], a: [1, 2, -5, 3, 1], b: [2, 1, 9, 1, 2] };
    const kept = { t: [0, 1, 3, 4], a: [1, 2, 3, 1], b: [2, 1, 1, 2] };
    for (const offset of ["fill", "center", "wiggle"] as const) {
      const fields = (data: Record<string, number[]>, where?: object) =>
        build({
          marks: [
            area(table(data), {
              x: "t",
              y: ["a", "b"],
              series: false,
              stack: { offset },
              ...(where && { where: where as never }),
            }),
          ],
        }).model.series();
      // Row 2's negative share is left out, and stands in no offset.
      const left = fields(rows, col("t").ne(2));
      const own = fields(kept);
      const at = [0, 1, 3, 4];
      for (const [l, s] of left.entries()) {
        expect(at.map((row) => s.y[row])).toEqual([0, 1, 2, 3].map((k) => own[l]!.y[k]));
        expect(Number.isNaN(s.y[2]!)).toBe(true);
      }
      // Keeping every row, it stacks as without.
      const all = fields(kept, col("t").ge(0));
      for (const [l, s] of all.entries()) expect([...s.y]).toEqual([...own[l]!.y]);
    }
  });

  it("loads from a spec, and refuses fields its table lacks", () => {
    const columns = { t: [0, 1, 0, 1, 0, 1], v: [1, 1, 2, 2, 3, 3], s: [..."aabbcc"] };
    const where = ["in", ["field", "s"], "a", "c"];
    const loaded = build(
      loadSpec({
        data: { d: { columns } },
        marks: [{ type: "area", data: "d", x: "t", y: "v", series: "s", stack: true, where }],
      } as never).config,
    );
    const built = build({
      marks: [stacked(table(columns), { where: col("s").isIn("a", "c") })],
    });
    expect(edgesOf(loaded.model)).toEqual(edgesOf(built.model));
    expect(loaded.model.series().map((s) => s.label)).toEqual(["a", "c"]);
    expect(() =>
      build({ marks: [stacked(table(columns), { where: col("region").eq("N") })] }),
    ).toThrow('area (mark 0) where: expression: no field "region"; the table has "t", "v", "s"');
  });
});
