// Lineage: charts of groups or derivations following a selection of the source's rows.

import { count, mean, sum } from "../../src/data/aggregations.ts";
import { category } from "../../src/data/column.ts";
import { relationTo } from "../../src/data/contributors.ts";
import { deriveTable } from "../../src/data/derive.ts";
import { col } from "../../src/data/expr.ts";
import { groupRows } from "../../src/data/groups.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { rowView } from "../../src/data/row-view.ts";
import { selectionStore, selectRows, selectWhere } from "../../src/data/selection.ts";
import { type Table, table } from "../../src/data/table.ts";
import { rowTotals } from "../../src/data/totals.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { type Coverage, coverageOf, coverageWork } from "../../src/model/coverage.ts";
import { lineage as lineageReader } from "../../src/model/lineage-kit.ts";
import { membershipOf } from "../../src/model/memberships.ts";
import { ChartModel } from "../../src/model/model.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { measure } from "./shared.ts";

export async function run(): Promise<void> {
  // Lineage: charts of a groups table or a derivation following a selection
  // of the source's rows (data/contributors.ts, model/coverage.ts). Each case
  // times its phases apart (the source's change and the groups following it,
  // the membership's evaluation, coverage taking the change in), and reports
  // the incidences coverage read and the array-buffer bytes the membership
  // and coverage made a step (JavaScript objects uncounted). Capacity crossings, where the membership's bytes move to a larger array,
  // are counted apart. After each case, coverage is checked against counts
  // made again from the rows.
  {
    const M = 1_000_000;
    const GROUPS = 1000;
    const salesOf = (n: number, maxRows?: number) =>
      table(
        {
          x: Float64Array.from({ length: n }, () => Math.random() * 100),
          v: Float64Array.from({ length: n }, () =>
            Math.random() < 0.05 ? Number.NaN : Math.random() * 10,
          ),
          g: category(Array.from({ length: n }, (_, i) => `g${i % GROUPS}`)),
          h: category(Array.from({ length: n }, (_, i) => `h${i % 10}`)),
        },
        maxRows === undefined ? {} : { maxRows },
      ) as unknown as Table;
    const batchOf = (n: number, from: number) => ({
      x: Float64Array.from({ length: n }, () => Math.random() * 100),
      v: Float64Array.from({ length: n }, () => Math.random() * 10),
      g: Array.from({ length: n }, (_, i) => `g${(from + i) % GROUPS}`),
      h: Array.from({ length: n }, (_, i) => `h${(from + i) % 10}`),
    });
    const gc = (globalThis as { gc?: () => void }).gc;
    /**
     * Bytes of array buffers `run` makes, read from the process after two
     * collections, the second finishing the first's freeing (which runs
     * beside the program), so none of earlier garbage is freed during it.
     * Typed arrays of 64 bytes or fewer, kept in the JavaScript heap, and
     * JavaScript objects are uncounted.
     */
    const made = (run: () => void): number => {
      gc?.();
      gc?.();
      const before = process.memoryUsage().arrayBuffers;
      run();
      return process.memoryUsage().arrayBuffers - before;
    };
    const ms = (times: number[]) => {
      const sorted = [...times].sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1]!;
      const mad = sorted.map((t) => Math.abs(t - median)).sort((a, b) => a - b)[
        sorted.length >> 1
      ]!;
      return median < 0.1
        ? `${(median * 1000).toFixed(1)} µs ± ${(mad * 1000).toFixed(1)}`
        : `${median.toFixed(3)} ms ± ${mad.toFixed(3)}`;
    };
    const average = (times: number[]) => times.reduce((a, b) => a + b, 0) / times.length;
    /**
     * A lineage case: `step` changes the source or the selection (its time
     * reported as `changed`), then the membership and each coverage read
     * every target. Bytes are those the membership and coverages make; of
     * appends (`appends`), steps whose membership crossed its capacity count
     * apart.
     */
    const lineage = (
      name: string,
      step: (i: number) => void,
      membership: { selected: Uint8Array },
      coverages: readonly { coverage: Coverage; field: string | undefined }[],
      { warmup = 5, samples = 30, appends = false } = {},
    ) => {
      // What earlier cases left is collected first, not during this one.
      gc?.();
      const read = () => {
        for (const { coverage, field } of coverages)
          for (let t = 0; t < coverage.relation.targets; t++) {
            coverage.selected(t);
            if (field !== undefined) coverage.measure(t, field);
          }
      };
      let i = 0;
      for (let w = 0; w < warmup; w++) {
        step(i++);
        void membership.selected;
        read();
      }
      const times = {
        changed: [] as number[],
        membership: [] as number[],
        coverage: [] as number[],
      };
      const work = { incidences: 0, rebuilds: 0, bytes: 0, crossings: 0, crossed: 0 };
      for (let k = 0; k < samples; k++) {
        let t0 = performance.now();
        step(i++);
        times.changed.push(performance.now() - t0);
        const [incidences, rebuilds] = [coverageWork.incidences, coverageWork.rebuilds];
        t0 = performance.now();
        void membership.selected;
        times.membership.push(performance.now() - t0);
        t0 = performance.now();
        read();
        times.coverage.push(performance.now() - t0);
        work.incidences += coverageWork.incidences - incidences;
        work.rebuilds += coverageWork.rebuilds - rebuilds;
      }
      // Bytes, on steps of their own: collections before each would slow the steps timed.
      let last = membership.selected.buffer;
      for (let k = 0; k < samples; k++) {
        step(i++);
        let crossed = false;
        const bytes = made(() => {
          const after = membership.selected.buffer;
          crossed = appends && after !== last;
          last = after;
          read();
        });
        if (crossed) {
          work.crossings++;
          work.crossed += bytes;
        } else work.bytes += bytes;
      }
      const plain = samples - work.crossings;
      console.log(
        `${name.padEnd(48)} change ${ms(times.changed)}; membership ${ms(times.membership)}; ` +
          `coverage ${ms(times.coverage)} (mean ${average(times.coverage).toFixed(3)} ms); ` +
          `${Math.round(work.incidences / samples).toLocaleString("en-US")} incidences, ${work.rebuilds} rebuilds in ${samples}; ` +
          `${(plain ? work.bytes / plain / 1024 : 0).toFixed(1)} KB made a step` +
          (work.crossings
            ? `, ${work.crossings} crossings of ${(work.crossed / work.crossings / 2 ** 20).toFixed(2)} MB`
            : ""),
      );
    };
    /** Checks a coverage of groups by `field`'s finite values against counts made again from the rows. */
    const verify = (
      coverage: Coverage,
      keyOf: (target: number) => string,
      key: string,
      field: string | undefined,
    ) => {
      const source = coverage.relation.source;
      const bytes = coverage.membership.selected;
      const { codes, dictionary } = source.categories(key as never);
      const values = field === undefined ? null : source.numbers(field as never);
      const want = new Map<string, [number, number, number]>();
      for (let p = 0; p < source.length; p++) {
        if (values && !Number.isFinite(values[p]!)) continue;
        const k = dictionary[codes[p]!]!;
        const at = want.get(k) ?? [0, 0, 0];
        at[1]++;
        if (bytes[p]) {
          at[0]++;
          at[2] += values ? values[p]! : 0;
        }
        want.set(k, at);
      }
      for (let t = 0; t < coverage.relation.targets; t++) {
        const [selected, total, summed] = want.get(keyOf(t)) ?? [0, 0, 0];
        const measure = field === undefined ? undefined : coverage.measure(t, "s");
        if (
          coverage.selected(t) !== selected ||
          coverage.total(t) !== total ||
          (measure && Math.abs(measure.selected - summed) > 1e-9 * Math.max(1, Math.abs(summed)))
        )
          throw new Error(`lineage: coverage of target ${t} differs from the rows' counts`);
      }
    };

    // A brush moving over x, a bar of 1,000 groups' sums following.
    {
      const sales = salesOf(M);
      const store = selectionStore(sales);
      const groups = groupRows(rowView(sales), { by: ["g"], ops: { s: sum("v"), n: count() } });
      const coverage = coverageOf(relationTo(groups.table, sales)!, "s", store, "brush");
      const membership = membershipOf(store, "brush");
      const brushAt = (i: number) => {
        const a = 10 + (i % 20);
        store.set(
          "brush",
          selectWhere(
            col("x")
              .ge(a)
              .and(col("x").le(a + 30)),
          ),
        );
      };
      lineage("lineage: brush 1M rows, a bar of 1,000 groups follows", brushAt, membership, [
        { coverage, field: "s" },
      ]);
      verify(coverage, (t) => groups.keyOf(t)[0] as string, "g", "v");

      // A click selecting one row more, a sparse delta.
      const sets = Array.from({ length: 64 }, (_, i) =>
        selectRows(new RowSet(sales).addAll([5, 1000 + i * 13_001])),
      );
      store.set("click", sets[0]!);
      const clicked = coverageOf(relationTo(groups.table, sales)!, "s", store, "click");
      lineage(
        "lineage: click one row of 1M (a sparse delta)",
        (i) => store.set("click", sets[i % 64]!),
        membershipOf(store, "click"),
        [{ coverage: clicked, field: "s" }],
      );
      verify(clicked, (t) => groups.keyOf(t)[0] as string, "g", "v");
    }

    // Through charts: a scatter of 1M rows brushed, and bars of 1,000 groups'
    // sums and means bound to the scatter's store with the lineage reader,
    // drawing their next scenes (sums' parts from their bases, means in the
    // partial look). The membership, coverage, and drawing are timed apart:
    // the brush and membership, then coverage read alone, then the bars' scenes.
    {
      const sales = salesOf(M);
      const store = selectionStore(sales);
      const groups = groupRows(rowView(sales), {
        by: ["g"],
        ops: { s: sum("v"), m: mean("v") },
      });
      const target = groups.table as unknown as Table;
      const stops: (() => void)[] = [];
      const charts = (["s", "m"] as const).map((y) => {
        const selection = rowSelection({ store, channel: "brush", lineage: lineageReader });
        const chart = new ChartModel({
          marks: [bar(target, { x: "g", y })],
          rowSelection: selection,
        });
        chart.setSize(1200, 400, 1);
        stops.push(selection.highlight(chart));
        return chart;
      });
      const scatter = new ChartModel({
        marks: [point(sales, { x: "x", y: "v" })],
        rowSelection: rowSelection({ store, channel: "brush" }),
      });
      scatter.setSize(600, 400, 1);
      stops.push(scatter.config.rowSelection!.highlight(scatter));
      const brushMembership = membershipOf(store, "brush");
      let at = 0;
      const brush = () => {
        const a = 10 + (at++ % 20);
        store.set(
          "brush",
          selectWhere(
            col("x")
              .ge(a)
              .and(col("x").le(a + 30)),
          ),
        );
      };
      brush();
      for (const chart of [scatter, ...charts]) chart.scene(estimateText, true);
      measure(
        "lineage chart: brush 1M rows, scatter and two bars of 1,000 groups draw",
        () => {
          brush();
          for (const chart of [scatter, ...charts]) chart.scene(estimateText, true);
        },
        { warmup: 5, samples: 30 },
      );
      measure(
        "lineage chart: the same brush, the bars alone draw",
        () => {
          brush();
          void brushMembership.selected;
          for (const chart of charts) chart.scene(estimateText, true);
        },
        { warmup: 5, samples: 30 },
      );
      measure(
        "lineage chart: the same brush, membership alone",
        () => {
          brush();
          void brushMembership.selected;
        },
        { warmup: 5, samples: 30 },
      );
      measure(
        "lineage chart: the bars' next scenes, the selection unchanged",
        () => {
          for (const chart of charts) chart.scene(estimateText, true);
        },
        { warmup: 5, samples: 30 },
      );
      // Gone before the cases after it, which a million rows held would slow.
      for (const stop of stops) stop();
      for (const chart of [scatter, ...charts]) chart.dispose();
    }

    /**
     * A gesture to its frame, its parts apart: the brush (`brush`, the
     * store's set), the membership it changes, the bars' coverage (each
     * group's counts and sums), their scenes (the series split into parts,
     * and their geometry), and their text alternatives.
     */
    const phases = (
      name: string,
      brush: () => void,
      membership: { selected: Uint8Array },
      coverages: readonly Coverage[],
      field: string,
      charts: readonly ChartModel[],
      { warmup = 5, samples = 30 } = {},
    ) => {
      gc?.();
      const times = {
        brush: [] as number[],
        membership: [] as number[],
        coverage: [] as number[],
        scenes: [] as number[],
        text: [] as number[],
        whole: [] as number[],
      };
      for (let k = 0; k < warmup + samples; k++) {
        const t0 = performance.now();
        brush();
        const t1 = performance.now();
        void membership.selected;
        const t2 = performance.now();
        for (const coverage of coverages)
          for (let t = 0; t < coverage.relation.targets; t++) {
            coverage.selected(t);
            coverage.measure(t, field);
          }
        const t3 = performance.now();
        for (const chart of charts) chart.scene(estimateText, true);
        const t4 = performance.now();
        for (const chart of charts) chart.config.rowSelection!.describe(chart.config);
        const t5 = performance.now();
        if (k < warmup) continue;
        times.brush.push(t1 - t0);
        times.membership.push(t2 - t1);
        times.coverage.push(t3 - t2);
        times.scenes.push(t4 - t3);
        times.text.push(t5 - t4);
        times.whole.push(t5 - t0);
      }
      console.log(
        `${name.padEnd(48)} whole ${ms(times.whole)}: brush ${ms(times.brush)}; membership ${ms(times.membership)}; ` +
          `coverage ${ms(times.coverage)}; scenes ${ms(times.scenes)}; text ${ms(times.text)}`,
      );
    };

    // The data guide's dashboard at 365,000 rows (a day and region a row): a
    // brush of days, bars of the regions' and the months' revenue bound to
    // the source's store through lineage following it.
    {
      const DAYS = 91_250;
      const AREAS = ["North", "South", "East", "West"];
      const n = DAYS * AREAS.length;
      const days = new Float64Array(n);
      const revenue = new Float64Array(n);
      const region = new Array<string>(n);
      const month = new Array<string>(n);
      for (let d = 0, i = 0; d < DAYS; d++)
        for (const area of AREAS) {
          days[i] = d * 86_400_000;
          region[i] = area;
          month[i] = `m${Math.floor(d / 30)}`;
          revenue[i] = 4000 + ((i * 7919) % 3000);
          i++;
        }
      const sales = table({
        time: days,
        region: category(region),
        month: category(month),
        revenue,
      }) as unknown as Table;
      const store = selectionStore(sales);
      const view = rowView(sales);
      const byRegion = groupRows(view, { by: ["region"], ops: { revenue: sum("revenue") } });
      const byMonth = groupRows(view, { by: ["month"], ops: { revenue: sum("revenue") } });
      const stops: (() => void)[] = [];
      const bars = (
        [
          [byRegion, "region"],
          [byMonth, "month"],
        ] as const
      ).map(([groups, x]) => {
        const selection = rowSelection({ store, channel: "days", lineage: lineageReader });
        const chart = new ChartModel({
          marks: [bar(groups.table as unknown as Table, { x: x as never, y: "revenue" })],
          rowSelection: selection,
        });
        chart.setSize(800, 300, 1);
        stops.push(selection.highlight(chart));
        return chart;
      });
      const coverages = [byRegion, byMonth].map((groups) =>
        coverageOf(relationTo(groups.table as unknown as Table, sales)!, "revenue", store, "days"),
      );
      let at = 0;
      const brush = () => {
        const from = (at++ % 20) * 1000;
        store.set(
          "days",
          selectWhere(
            col("time")
              .ge(from * 86_400_000)
              .and(col("time").le((from + 30_000) * 86_400_000)),
          ),
        );
      };
      phases(
        "lineage dashboard: brush 365,000 rows, bars of 4 regions and 3,042 months follow",
        brush,
        membershipOf(store, "days"),
        coverages,
        "revenue",
        bars,
      );
      // Gone before the cases after it, which its 365,000 rows would slow.
      for (const stop of stops) stop();
      for (const chart of bars) chart.dispose();
    }

    // The data guide's cross-filtered dashboard at 365,000 rows, declared:
    // each panel a view of the rows every other panel's channel leaves, the
    // days', regions', and months' groups of three of them, and each chart
    // bound to its channel through lineage. A filter step sets the orders'
    // brush: three views filter again, and the groups of two follow, within
    // the set (`brush`); then the brush's membership, the scenes (the orders'
    // line counting its days' coverage and drawing them highlighted), and
    // the text. Then the same step with charts that highlight nothing, and
    // the same three views over a store of their own, read after each set,
    // which time the views' filtering alone.
    {
      const DAYS = 91_250;
      const AREAS = ["North", "South", "East", "West"];
      const n = DAYS * AREAS.length;
      const days = new Float64Array(n);
      const revenue = new Float64Array(n);
      const orders = new Float64Array(n);
      const region = new Array<string>(n);
      const month = new Array<string>(n);
      for (let d = 0, i = 0; d < DAYS; d++)
        for (const area of AREAS) {
          days[i] = d * 86_400_000;
          region[i] = area;
          month[i] = `m${Math.floor(d / 30)}`;
          revenue[i] = 4000 + ((i * 7919) % 3000);
          orders[i] = 80 + ((i * 104_729) % 60);
          i++;
        }
      const sales = table({
        time: days,
        region: category(region),
        month: category(month),
        revenue,
        orders,
      });
      const store = selectionStore(sales);
      const made: { dispose(): void }[] = [];
      const rowsFor = (own: string, of = store) => {
        const view = rowView(sales, { selection: { store: of, excluding: own } });
        made.push(view);
        return view;
      };
      const byDay = groupRows(rowsFor("orders"), { by: ["time"], ops: { orders: sum("orders") } });
      const byRegion = groupRows(rowsFor("regions"), {
        by: ["region"],
        ops: { revenue: sum("revenue") },
      });
      const byMonth = groupRows(rowsFor("months"), {
        by: ["month"],
        ops: { revenue: sum("revenue") },
      });
      const stops: (() => void)[] = [];
      const shown = rowsFor("revenue");
      const panels = () =>
        [
          [line(shown as never, { x: "time", y: "revenue", color: "region" }), "revenue"],
          [line(byDay.table as unknown as Table, { x: "time", y: "orders" }), "orders"],
          [bar(byRegion.table as unknown as Table, { x: "region", y: "revenue" }), "regions"],
          [bar(byMonth.table as unknown as Table, { x: "month", y: "revenue" }), "months"],
        ] as const;
      const charts = panels().map(([mark, channel]) => {
        const selection = rowSelection({ store, channel, lineage: lineageReader });
        const chart = new ChartModel({ marks: [mark as never], rowSelection: selection });
        chart.setSize(800, 300, 1);
        stops.push(selection.highlight(chart));
        return chart;
      });
      for (const chart of charts) chart.scene(estimateText, true);
      let at = 0;
      const range = () => {
        const from = (at++ % 20) * 1000;
        return selectWhere(
          col("time")
            .ge(from * 86_400_000)
            .and(col("time").le((from + 30_000) * 86_400_000)),
        );
      };
      // The charts' coverage is theirs to count, in their scenes: the orders'
      // line's of its 91,250 days, followed by the rows the brush moved over.
      phases(
        "cross-filter: a filter step, 365,000 rows, four panels, declared views",
        () => store.set("orders", range()),
        membershipOf(store as never, "orders"),
        [],
        "orders",
        charts,
      );
      for (const stop of stops.splice(0)) stop();
      for (const chart of charts) chart.dispose();
      // The same step with charts that highlight nothing: the views and groups, and the scenes.
      const plain = panels().map(([mark]) => {
        const chart = new ChartModel({ marks: [mark as never] });
        chart.setSize(800, 300, 1);
        chart.scene(estimateText, true);
        return chart;
      });
      measure(
        "cross-filter: the same step, the charts highlighting nothing",
        () => {
          store.set("orders", range());
          for (const chart of plain) chart.scene(estimateText, true);
        },
        { warmup: 5, samples: 30 },
      );
      for (const chart of plain) chart.dispose();
      const alone = selectionStore(sales);
      const views = ["revenue", "regions", "months"].map((own) => rowsFor(own, alone));
      measure(
        "cross-filter: three views filter again, 365,000 rows, no groups",
        () => {
          alone.set("orders", range());
          for (const view of views) void view.length;
        },
        { warmup: 5, samples: 30 },
      );
      // Gone before the cases after it, which its 365,000 rows and 91,250 groups would slow.
      for (const groups of [byDay, byRegion, byMonth]) groups.dispose();
      for (const view of made) view.dispose();
      gc?.();
    }

    // Batches of 1,000 rows appended to a brushed table, which grows, then to one keeping its last million.
    for (const rolling of [false, true]) {
      const sales = salesOf(M, rolling ? M : undefined);
      const store = selectionStore(sales);
      store.set("brush", selectWhere(col("x").ge(20).and(col("x").le(50))));
      const groups = groupRows(rowView(sales), { by: ["g"], ops: { s: sum("v") } });
      const coverage = coverageOf(relationTo(groups.table, sales)!, "s", store, "brush");
      let next = 0;
      lineage(
        rolling
          ? "lineage: a rolling window of 1M rows dropping 1,000 a batch"
          : "lineage: append 1,000 rows to a brushed 1M table, groups follow",
        () => {
          sales.append(batchOf(1000, next) as never);
          next += 1000;
        },
        membershipOf(store, "brush"),
        [{ coverage, field: "s" }],
        { samples: 100, appends: true },
      );
      verify(coverage, (t) => groups.keyOf(t)[0] as string, "g", "v");
    }

    // A new predicate, three marks following one evaluation: bars of 1,000 and of 10 groups, and the totals.
    {
      const sales = salesOf(M);
      const store = selectionStore(sales);
      const view = rowView(sales);
      const byG = groupRows(view, { by: ["g"], ops: { s: sum("v") } });
      const byH = groupRows(view, { by: ["h"], ops: { s: sum("v"), n: count() } });
      const totals = rowTotals(view, { ops: { s: sum("v") } });
      const coverages = [
        { coverage: coverageOf(relationTo(byG.table, sales)!, "s", store, "brush"), field: "s" },
        {
          coverage: coverageOf(relationTo(byH.table, sales)!, "n", store, "brush"),
          field: undefined,
        },
        { coverage: coverageOf(relationTo(totals.table, sales)!, "s", store, "brush"), field: "s" },
      ];
      lineage(
        "lineage: a new predicate over 1M rows, three marks follow",
        (i) => store.set("brush", selectWhere(col("v").lt(4 + (i % 8) * 0.25))),
        membershipOf(store, "brush"),
        coverages,
      );
      verify(coverages[0]!.coverage, (t) => byG.keyOf(t)[0] as string, "g", "v");
      verify(coverages[1]!.coverage, (t) => byH.keyOf(t)[0] as string, "h", undefined);

      // A pipeline that aggregates twice: its targets' rows counted, no measure.
      const twice = deriveTable(sales, [
        { aggregate: [{ op: "sum", field: "v", as: "s" }], by: ["g", "h"] },
        {
          aggregate: [
            { op: "sum", field: "s", as: "t" },
            { op: "count", as: "n" },
          ],
          by: ["g"],
        },
      ]);
      const nested = relationTo(twice, sales)!;
      if (nested.measureOf("t") || nested.measureOf("n"))
        throw new Error("lineage: a nested aggregate has no measure");
      const ofTwice = coverageOf(nested, "t", store, "brush");
      lineage(
        "lineage: a pipeline aggregating twice follows a new predicate",
        (i) => store.set("brush", selectWhere(col("v").lt(4 + (i % 8) * 0.25))),
        membershipOf(store, "brush"),
        [{ coverage: ofTwice, field: undefined }],
        { samples: 10, warmup: 2 },
      );
      verify(ofTwice, (t) => twice.value("g" as never, t) as string, "g", "v");
    }
  }
}
