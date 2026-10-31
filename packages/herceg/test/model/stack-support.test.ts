// Stacks of a series field stand only where every layer has support
// (`stack.support: "intersection"`), and break where a layer's
// `continuity` does: their edges are missing there, which drawing,
// inspection, labels, domains, and level of detail all read as a gap.
import { describe, expect, it } from "vitest";
import { encodedCategory, time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { type RowView, rowView } from "../../src/data/row-view.ts";
import { type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { partReader } from "../../src/marks/drawn-parts.ts";
import type { Mark } from "../../src/marks/mark.ts";
import { rowOf } from "../../src/marks/series.ts";
import { INDEXED_POINTS } from "../../src/marks/trace.ts";
import { facet } from "../../src/model/facet.ts";
import { type AxisInspection, type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { Picker } from "../../src/model/pick.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type { AreaGeometry, LabelsGeometry, Scene } from "../../src/scene/scene.ts";
import { loadSpec } from "../../src/spec/load.ts";
import { pickKit } from "../helpers/picker.ts";

function build(config: ChartConfig, width = 600) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", legend: false, ...config },
    undefined,
    ...staticCompilers(),
  );
  model.setSize(width, 300, 1);
  return { model, scene: model.scene(estimateText) };
}

const areasOf = (scene: Scene, panel = 0) =>
  scene.panels[panel]!.marks.filter((g): g is AreaGeometry => g.kind === "area");

/** Each run of an area's top edge: its first and last x, in data units (`unit`s of them). */
function spans(model: ChartModel, geometry: AreaGeometry, unit = 1): [number, number][] {
  const x = model.xScale()!;
  const { upper } = geometry;
  const at = (point: number) => Math.round((x.invert(upper.coords[point * 2]!) / unit) * 100) / 100;
  return upper.starts.flatMap((start, r) =>
    upper.runEnd(r) > start ? [[at(start), at(upper.runEnd(r) - 1)] as [number, number]] : [],
  );
}

/** Two pumps: a from 0 to 6, b from 2 to 8, with b's rows 4 apart between 4 and 8. */
const pumps = () =>
  table({
    t: [0, 1, 2, 3, 4, 5, 6, 2, 3, 4, 8],
    v: [1, 1, 1, 1, 1, 1, 1, 10, 10, 10, 90],
    s: [..."aaaaaaabbbb"],
  });

describe("stack support", () => {
  it("stands where any layer has rows, by default, and where every one does with intersection", () => {
    for (const support of ["union", "intersection"] as const) {
      const { model, scene } = build({
        marks: [area(pumps(), { x: "t", y: "v", series: "s", stack: { support } })],
      });
      const [a, b] = areasOf(scene);
      expect([spans(model, a!), spans(model, b!)]).toEqual(
        support === "union" ? [[[0, 8]], [[0, 8]]] : [[[2, 6]], [[2, 6]]],
      );
    }
  });

  it("breaks the whole stack where a layer's continuity breaks", () => {
    const { model, scene } = build({
      marks: [
        area(pumps(), {
          x: "t",
          y: "v",
          series: "s",
          continuity: { maxGap: 2 },
          stack: { support: "intersection" },
        }),
      ],
    });
    // b's rows at 4 and 8 do not connect: a has no support past 4 either.
    expect(areasOf(scene).map((g) => spans(model, g))).toEqual([[[2, 4]], [[2, 4]]]);
    // With union support a stands alone where b has no rows, but not inside b's break.
    const union = build({
      marks: [
        area(pumps(), { x: "t", y: "v", series: "s", continuity: { maxGap: 2 }, stack: true }),
      ],
    });
    expect(areasOf(union.scene).map((g) => spans(union.model, g))).toEqual([
      [
        [0, 4],
        [8, 8],
      ],
      [
        [0, 4],
        [8, 8],
      ],
    ]);
  });

  it("breaks a stack split by its color as one split by series, and fields' stacks as areas", () => {
    const colored = build({
      marks: [
        area(pumps(), { x: "t", y: "v", color: "s", continuity: { maxGap: 2 }, stack: true }),
      ],
    });
    expect(areasOf(colored.scene).map((g) => spans(colored.model, g))).toEqual([
      [
        [0, 4],
        [8, 8],
      ],
      [
        [0, 4],
        [8, 8],
      ],
    ]);
    const fields = build({
      marks: [
        area(table({ t: [0, 1, 2, 6, 7], a: [1, 1, 1, 1, 1], b: [2, 2, 2, 2, 2] }), {
          x: "t",
          y: ["a", "b"],
          series: false,
          continuity: { maxGap: 2 },
          stack: true,
        }),
      ],
    });
    expect(areasOf(fields.scene).map((g) => spans(fields.model, g))).toEqual([
      [
        [0, 2],
        [6, 7],
      ],
      [
        [0, 2],
        [6, 7],
      ],
    ]);
  });

  it("judges each row of a layer at one x on its own", () => {
    // a has two rows at t 1: the second is left out, or starts a new run.
    const rows = () =>
      table({
        t: [0, 1, 1, 2, 0, 1, 2],
        v: [1, 1, 1, 1, 10, 10, 10],
        q: [1, 1, 0, 1, 1, 1, 1],
        run: ["x", "x", "y", "y", "x", "x", "x"],
        s: [..."aaaabbb"],
      });
    const spansOf = (continuity: Record<string, unknown>) => {
      const { model, scene } = build({
        marks: [area(rows(), { x: "t", y: "v", series: "s", continuity, stack: true })],
      });
      return areasOf(scene).map((g) => spans(model, g));
    };
    expect(spansOf({ defined: col("q").gt(0.5) })).toEqual([
      [
        [0, 1],
        [2, 2],
      ],
      [
        [0, 1],
        [2, 2],
      ],
    ]);
    expect(spansOf({ breakBy: { field: "run" } })).toEqual([
      [
        [0, 1],
        [1, 2],
      ],
      [
        [0, 1],
        [1, 2],
      ],
    ]);
  });

  it("reads nothing inside a break, as a line of each layer would not", () => {
    const rows = table({
      t: [0, 1, 8, 9, 0, 1, 8, 9],
      v: [1, 1, 1, 1, 10, 10, 10, 10],
      s: [..."aaaabbbb"],
    });
    for (const stack of [true, { support: "intersection" as const }]) {
      const { model, scene } = build({
        marks: [area(rows, { x: "t", y: "v", series: "s", continuity: { maxGap: 2 }, stack })],
      });
      const x = model.xScale()!;
      const plot = scene.panels[0]!.plot;
      const at = (t: number) =>
        (model.inspect(x.map(t), plot.y + 5) as AxisInspection | undefined)?.points.length ?? 0;
      // Between the rows either side of the break nothing is read, as for a line.
      expect([at(0.6), at(1), at(4), at(8), at(8.4)]).toEqual([2, 2, 0, 2, 2]);
    }
    // A break of one layer is the whole stack's: a reads nothing there either.
    const { model, scene } = build({
      marks: [
        area(table({ t: [0, 1, 8, 9, 0, 8], v: [1, 1, 1, 1, 10, 10], s: [..."aaaabb"] }), {
          x: "t",
          y: "v",
          series: "s",
          continuity: { maxGap: 2 },
          stack: { gaps: "interpolate" },
        }),
      ],
    });
    const x = model.xScale()!;
    const found = model.inspect(x.map(4), scene.panels[0]!.plot.y + 5) as
      | AxisInspection
      | undefined;
    expect(found?.points ?? []).toEqual([]);
  });

  it("breaks between neighboring positions where a layer's run ends", () => {
    const data = table({
      t: [0, 1, 2, 3, 0, 1, 2, 3],
      v: [1, 1, 1, 1, 2, 2, 2, 2],
      s: [..."aaaabbbb"],
      shift: [..."ppppppqq"],
    });
    const { model, scene } = build({
      marks: [
        area(data, {
          x: "t",
          y: "v",
          series: "s",
          continuity: { breakBy: { field: "shift" } },
          stack: true,
        }),
      ],
    });
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
  });

  it("is not inspected, labeled, or in the domain where it has no support", () => {
    const config = (support: "union" | "intersection"): ChartConfig => ({
      marks: [
        area(pumps(), {
          x: "t",
          y: "v",
          series: "s",
          stack: { support },
          labels: { at: "last" },
        }),
      ],
    });
    const union = build(config("union"));
    const { model, scene } = build(config("intersection"));
    // b's 90 at x = 8 stands alone: in the union's domain, not the intersection's.
    expect(union.model.yScale()!.domain[1]).toBeGreaterThanOrEqual(90);
    expect(model.yScale()!.domain[1]).toBeLessThan(20);
    const x = model.xScale()!;
    const plot = scene.panels[0]!.plot;
    const at = (t: number) => {
      const found = model.inspect(x.map(t), plot.y + 5) as AxisInspection;
      return [found.label, ...found.points.map((p) => `${p.label} ${p.value}`)];
    };
    // Hovered beyond the stack, the nearest position it stands at answers.
    expect(at(0)).toEqual(["2", "a 1", "b 10"]);
    expect(at(8)).toEqual(["6", "a 1"]);
    expect(union.model.inspect(x.map(8), plot.y + 5)).toMatchObject({ label: "8" });
    // Each layer's label stands at its last row the stack stands at: b's
    // at 4, as it has none at 5 and 6.
    const labels = (built: typeof union) =>
      built.scene.panels[0]!.marks.flatMap((g) =>
        g.kind === "labels"
          ? [...(g as LabelsGeometry).items].map((item) => [
              item.text,
              Math.round(built.model.xScale()!.invert(item.x)),
            ])
          : [],
      ).sort();
    expect(labels({ model, scene })).toEqual([
      ["a", 6],
      ["b", 4],
    ]);
    expect(labels(union)).toEqual([
      ["a", 6],
      ["b", 8],
    ]);
  });

  it("draws gaps through level of detail, as many as without it", () => {
    const n = INDEXED_POINTS + 2000;
    const t = Float64Array.from({ length: 2 * n }, (_, i) => Math.floor(i / 2));
    const s = Array.from(t, (_, i) => (i % 2 ? "b" : "a"));
    // b skips every 1000th position, which a gap of 2 breaks.
    const kept = Array.from(t.keys()).filter((i) => !(i % 2 && t[i]! % 1000 === 500));
    const data = table({
      t: kept.map((i) => t[i]!),
      v: kept.map((i) => 1 + (t[i]! % 7)),
      s: kept.map((i) => s[i]!),
    });
    const { scene } = build({
      marks: [area(data, { x: "t", y: "v", series: "s", continuity: { maxGap: 1 }, stack: true })],
    });
    const breaks = Math.floor((n - 501) / 1000) + 1;
    for (const geometry of areasOf(scene)) {
      expect(geometry.upper.starts.length).toBe(breaks + 1);
      // Reduced, not one point per position.
      expect(geometry.upper.count).toBeLessThan(n / 4);
    }
  });

  it("picks a layer's observation along its stack order where its rows do not ascend", () => {
    const data = table({
      t: [10, 0, 1, ...Array.from({ length: 11 }, (_, i) => i)],
      v: [1, 1, 1, ...Array.from({ length: 11 }, () => 1)],
      s: [..."aaa", ..."b".repeat(11)],
    });
    const { model } = build({
      marks: [
        area(data, {
          x: "t",
          y: "v",
          series: "s",
          continuity: { maxGap: 20 },
          stack: { gaps: "interpolate" },
        }),
      ],
    });
    const picked = new Picker(pickKit).pick(model, {
      x: model.xScale()!.map(5.9),
      y: model.yScale()!.map(0.5),
      slop: 4,
    });
    const part = picked?.item.part;
    // The nearer of a's observations either side, at 10 (row 0), not at 1.
    expect(part?.kind === "row" && part.position).toBe(0);
  });

  it("reads rows after a break among a layer's rows at one x", () => {
    const rows = table({
      t: [0, 1, 1, 2, 0, 1, 2],
      v: [1, 1, 1, 1, 10, 10, 10],
      run: ["old", "old", "new", "new", "x", "x", "x"],
      s: [..."aaaabbb"],
    });
    const { model, scene } = build({
      marks: [
        area(rows, {
          x: "t",
          y: "v",
          series: "s",
          continuity: { breakBy: { field: "run" } },
          stack: true,
        }),
      ],
    });
    const x = model.xScale()!;
    const plot = scene.panels[0]!.plot;
    const at = (t: number) =>
      (model.inspect(x.map(t), plot.y + 5) as AxisInspection | undefined)?.points.length ?? 0;
    expect([at(0.5), at(1.5)]).toEqual([2, 2]);
  });

  it("gives pickers a layer's rows in x order where they do not ascend", () => {
    const data = table({ t: [2, 0, 1, 0, 1, 2], v: [1, 1, 1, 2, 2, 2], s: [..."aaabbb"] });
    const mark = area(data, { x: "t", y: "v", series: "s", stack: true });
    const { model } = build({ marks: [mark] });
    const [record] = model.drawnMarks();
    const orders = record!.geometry.map((_, g) => {
      const part = partReader({ rowOf }).partOf(mark as unknown as Mark, record!, g, 0);
      return part?.kind === "trace" ? part.order && Array.from(part.order) : "none";
    });
    expect(orders).toEqual([[1, 2, 0], undefined]);
  });

  it("follows late rows of an ordered table, as a stack of those rows from scratch", () => {
    const make = (data: Table | RowView) =>
      area(data as unknown as Table<{ t: "number"; v: "number"; s: "category" }>, {
        x: "t",
        y: "v",
        series: "s",
        continuity: { maxGap: 2 },
        stack: { gaps: "interpolate", support: "intersection" },
      });
    /** Each layer's edges as drawn: positions, tops, and bottoms. */
    const edgesOf = (model: ChartModel) =>
      model.series().map((s) => [s.label, s.edges && [...s.edges.x], s.edges && [...s.edges.top]]);
    const live = orderedTable(
      { t: [0, 1, 2, 6, 0, 6, 0], v: [1, 1, 1, 1, 10, 10, 5], s: [..."aaaabbc"] },
      { orderBy: "t", maxRows: 14 },
    );
    const shown = rowView(live as unknown as Table, { filter: col("s").ne("c") });
    const charts = [build({ marks: [make(live as never)] }), build({ marks: [make(shown)] })];
    for (const late of [
      { t: [4], v: [10], s: ["b"] },
      { t: [2, 4, 3, 1], v: [10, 1, 1, 7], s: ["b", "a", "a", "c"] },
      { t: [5, 7, 8], v: [1, 10, 1], s: ["a", "b", "a"] },
      { t: [6.5, 3.5, 9], v: [2, 2, 2], s: ["b", "c", "a"] },
    ]) {
      live.append(late);
      const rows = (keep: (s: string) => boolean) => {
        const at = Array.from({ length: live.length }, (_, i) => i).filter((i) =>
          keep(live.value("s", i) as string),
        );
        return table({
          t: at.map((i) => live.numbers("t")[i]!),
          v: at.map((i) => live.numbers("v")[i]!),
          // In the live table's order of series, whatever row comes first.
          s: encodedCategory(
            Int32Array.from(at, (i) => "abc".indexOf(live.value("s", i) as string)),
            ["a", "b", "c"],
          ),
        });
      };
      for (const [i, keep] of [() => true, (s: string) => s !== "c"].entries()) {
        charts[i]!.model.scene(estimateText);
        const again = build({ marks: [make(rows(keep) as unknown as Table)] });
        expect(edgesOf(charts[i]!.model)).toEqual(edgesOf(again.model));
      }
    }
  });

  it("stacks facet panels with their own support", () => {
    const data = table({
      t: [0, 1, 2, 1, 2, 0, 1, 2, 0, 1],
      v: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      s: [..."aaabbaaabb"],
      region: [..."NNNNNSSSSS"],
    });
    const { model, scene } = build({
      facet: facet("region"),
      x: { domain: [0, 2], nice: false },
      marks: [area(data, { x: "t", y: "v", series: "s", stack: { support: "intersection" } })],
    });
    // Each panel's run, in data units of its plot.
    const runsIn = (panel: number) => {
      const { plot } = scene.panels[panel]!;
      return areasOf(scene, panel).map((g) =>
        spans(model, g).length === 1
          ? [g.upper.coords[0]!, g.upper.coords[(g.upper.count - 1) * 2]!].map(
              (px) => Math.round(((px - plot.x) / plot.width) * 2 * 100) / 100,
            )
          : undefined,
      );
    };
    expect(runsIn(0)).toEqual([
      [1, 2],
      [1, 2],
    ]);
    expect(runsIn(1)).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it("refuses support where it means nothing", () => {
    const data = pumps();
    expect(() =>
      build({ marks: [area(data, { x: "t", y: ["v", "t"], stack: { support: "intersection" } })] }),
    ).toThrow("area stack.support: for stacks by a series field; give series, or drop support");
    expect(() =>
      build({
        marks: [area(data, { x: "t", y: "v", series: "s", stack: { support: "all" as never } })],
      }),
    ).toThrow('area stack.support: expected "union" or "intersection"; received "all"');
    expect(() =>
      build({ marks: [bar(data, { x: "t", y: "v", stack: { support: "union" } as never })] }),
    ).toThrow("bar stack support: bars stack at their positions; drop support");
    expect(() =>
      loadSpec({
        data: { d: { columns: { t: [0], v: [1] } } },
        marks: [{ type: "bar", data: "d", x: "t", y: "v", stack: { support: "union" } }],
      } as never),
    ).toThrow("bars stack at their positions; drop support");
    // `where` still leaves stacks alone.
    expect(() =>
      build({
        marks: [area(data, { x: "t", y: "v", series: "s", stack: true, where: col("v").gt(1) })],
      }),
    ).toThrow("where: stacked areas cannot leave rows out yet; drop it or the stack");
  });

  it("loads support and continuity on stacks from a spec", () => {
    const MINUTE = 60_000;
    const columns = {
      t: [0, MINUTE, 10 * MINUTE, 0, MINUTE, 10 * MINUTE],
      v: [1, 1, 1, 2, 2, 2],
      s: [..."aaabbb"],
    };
    const options = {
      x: "t",
      y: "v",
      series: "s",
      continuity: { maxGap: { milliseconds: 5 * MINUTE } },
      stack: { gaps: "interpolate", support: "intersection" },
    } as const;
    const loaded = build(
      loadSpec({
        data: { d: { columns: { ...columns, t: { type: "time", values: columns.t } } } },
        marks: [{ type: "area", data: "d", ...options }],
      }).config,
    );
    const built = build({
      marks: [area(table({ ...columns, t: time(columns.t) }), options)],
    });
    const spansOf = ({ model, scene }: typeof built) =>
      areasOf(scene).map((g) => spans(model, g, MINUTE));
    expect(spansOf(loaded)).toEqual(spansOf(built));
    expect(spansOf(built)[0]).toEqual([
      [0, 1],
      [10, 10],
    ]);
  });
});
