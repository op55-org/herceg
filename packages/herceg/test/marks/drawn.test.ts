// Drawn-mark records: what each frame drew of each mark in each panel, and
// what each primitive draws (marks/drawn.ts); layout marks' items picked
// through `itemAt`; ticks' values; and stack support as NaN edges.
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { selectionStore, selectRows } from "../../src/data/selection.ts";
import { Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { Polyline } from "../../src/lod/polyline.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { boxen } from "../../src/marks/boxen.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { candlestick } from "../../src/marks/candlestick.ts";
import { contour } from "../../src/marks/contour.ts";
import { dendrogram } from "../../src/marks/dendrogram.ts";
import type { DrawnMark, DrawnPart } from "../../src/marks/drawn.ts";
import { partReader } from "../../src/marks/drawn-parts.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { geopoint } from "../../src/marks/geopoint.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { line } from "../../src/marks/line.ts";
import { line3d } from "../../src/marks/line3d.ts";
import type { ChartMark, Mark } from "../../src/marks/mark.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { region } from "../../src/marks/region.ts";
import { rug } from "../../src/marks/rug.ts";
import { rule } from "../../src/marks/rule.ts";
import type { Series } from "../../src/marks/series.ts";
import { rowOf, yExtent } from "../../src/marks/series.ts";
import { text } from "../../src/marks/text.ts";
import { traceBand } from "../../src/marks/trace.ts";
import { violin } from "../../src/marks/violin.ts";
import { facet } from "../../src/model/facet.ts";
import { Highlighter } from "../../src/model/highlight.ts";
import { itemResolver } from "../../src/model/items.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { pickLayout as pickItem } from "../../src/model/pick.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { timeBreaks } from "../../src/scale/breaks.ts";
import { LinearScale } from "../../src/scale/scale.ts";
import type {
  AxisGuide,
  LineGeometry,
  PointGeometry,
  Rect,
  RectGeometry,
  SegmentGeometry,
} from "../../src/scene/scene.ts";
import { LOOKUPS as lookups } from "../helpers/picker.ts";

/** A panel of a chart drawn here, with its scales. */
type Panel = ReturnType<ChartModel["panels"]>[number];

function drawn(config: ChartConfig, width = 400, height = 300) {
  const model = new ChartModel({ locale: "en-US", timeZone: "UTC", ...config });
  model.setSize(width, height, 1);
  return { model, ...sceneOf(model) };
}

/** A scene of `model` and its records, each known by the mark that drew it. */
function sceneOf(model: ChartModel) {
  const scene = model.scene(estimateText);
  const records = model.drawnMarks();
  const marks = model.config.marks as Mark[];
  for (const record of records)
    owners.set(record, marks.find((mark, i) => (mark.spec.id ?? i) === record.mark)!);
  return { scene, records };
}

/** What primitives draw, read with the chart's code as a picker reads it. */
const { partOf } = partReader({ rowOf });

/** The marks of the chart each record was drawn by, by key, for `partOf`. */
const owners = new WeakMap<DrawnMark, Mark>();

/** What primitive `index` of geometry `g` of `record` draws. */
const partAt = (record: DrawnMark, g: number, index: number) =>
  partOf(owners.get(record)!, record, g, index);

/** Every part a record's geometry draws, by geometry index and primitive. */
function parts(record: DrawnMark, kind?: string): DrawnPart[] {
  const out: DrawnPart[] = [];
  record.geometry.forEach((g, i) => {
    if (kind && g.kind !== kind) return;
    const count = (g as { count?: number }).count ?? 1;
    for (let k = 0; k < count; k++) {
      const part = partAt(record, i, k);
      if (part) out.push(part);
    }
  });
  return out;
}

const rowsOf = (found: DrawnPart[]) =>
  found.map((part) => (part.kind === "row" ? part.position : part.kind));

describe("drawn-mark records", () => {
  it("keep what each mark drew in each panel, readable until its data or options change", () => {
    const sales = table({
      region: ["N", "S", "N", "S"],
      kind: ["a", "a", "b", "b"],
      v: [1, 2, 3, 4],
    });
    const config: ChartConfig = {
      marks: [bar(sales, { x: "region", y: "v", id: "bars" }), rule({ y: 2 })],
      facet: facet({ column: "kind" }),
    };
    const { model, records } = drawn(config);
    expect(records.map((r) => [r.mark, r.panel])).toEqual([
      ["bars", "a"],
      [1, "a"],
      ["bars", "b"],
      [1, "b"],
    ]);
    const [first] = records;
    expect(first!.frame).toBeDefined();
    expect(first!.series.length).toBeGreaterThan(0);
    expect(first!.revision).toBe(0);
    expect(first!.current()).toBe(true);
    sales.append({ region: ["N"], kind: ["a"], v: [5] });
    expect(first!.current()).toBe(false);
    model.revision = 3;
    model.scene(estimateText);
    const again = model.drawnMarks();
    expect(again[0]!.revision).toBe(3);
    expect(again[0]!.current()).toBe(true);
    // A later scene reuses its buffers, whatever changed: a view, nothing.
    model.scene(estimateText);
    expect(again[0]!.current()).toBe(false);
    const latest = model.drawnMarks();
    expect(latest[0]!.current()).toBe(true);
    model.update({ ...config, marks: [bar(sales, { x: "region", y: "v" })] });
    expect(latest[0]!.current()).toBe(false);
    model.scene(estimateText);
    const last = model.drawnMarks();
    model.dispose();
    expect(last[0]!.current()).toBe(false);
  });

  it("name the row each bar and point draws, with its series and position", () => {
    const data = table({ t: [1, 2, 3, 4], v: [5, Number.NaN, 7, 8], host: ["a", "b", "a", "b"] });
    const { records } = drawn({
      marks: [bar(data, { x: "t", y: "v" }), point(data, { x: "t", y: "v", series: "host" })],
    });
    const [bars, points] = records;
    // The missing value draws no bar: its row is passed over.
    expect(rowsOf(parts(bars!))).toEqual([0, 2, 3]);
    const found = parts(points!);
    expect(rowsOf(found)).toEqual([0, 2, 3]);
    const third = found[2]!;
    expect(third.kind === "row" && third.series).toMatchObject({ position: 1 });
    expect(third.kind === "row" && third.series!.series.key).toBe('[1,"b"]');
    expect(partAt(bars!, 0, 99)).toBeUndefined();
  });

  it("give lines and areas as traces of their series: eligible rows, runs, and their order", () => {
    const data = table({
      t: [1, 2, 3, 4, 5],
      v: [1, 2, Number.NaN, 4, 5],
      low: [0.5, 0.5, 0.5, 0.5, -1],
    });
    const { records } = drawn({
      marks: [line(data, { x: "t", y: "v" }), area(data, { x: "t", y1: "low", y2: "v" })],
      y: { type: "log" },
    });
    for (const record of records) {
      const part = partAt(record, 0, 0)!;
      expect(part.kind).toBe("trace");
      if (part.kind !== "trace") continue;
      expect(part.along).toBe("x");
      expect(part.order).toBeUndefined();
      expect(part.positions).toBeUndefined();
      expect([0, 1, 2, 3].map(part.eligible)).toEqual([true, true, false, true]);
      // A missing value breaks the run.
      expect(part.sameRun(0, 1)).toBe(true);
      expect(part.sameRun(1, 3)).toBe(false);
    }
    // The area's last row has a lower edge no log axis places.
    const band = partAt(records[1]!, 0, 0)!;
    expect(band.kind === "trace" && band.eligible(4)).toBe(false);
  });

  it("read traces as drawn: stacks' zeros on log axes, rows breaks hide", () => {
    // A filled stack's layers start at zero, which a log axis draws at its bottom.
    const shares = table({ t: [1, 2, 3], a: [1, 2, 3], b: [3, 2, 1] });
    const stacked = drawn({
      marks: [area(shares, { x: "t", y: ["a", "b"], stack: "fill" })],
      y: { type: "log" },
    });
    for (const g of [0, 1]) {
      const part = partAt(stacked.records[0]!, g, 0)!;
      expect(part.kind === "trace" && [0, 1, 2].map(part.eligible)).toEqual([true, true, true]);
    }
    // Rows a break hides are not drawn, and join the rows either side.
    const times = table({ t: time([1, 2, 3, 4]), v: [1, 2, 3, 4] });
    const broken = drawn({
      marks: [line(times, { x: "t", y: "v" })],
      x: { breaks: timeBreaks([{ from: 2, to: 3 }]), domain: [0, 5], nice: false },
    });
    const line_ = partAt(broken.records[0]!, 0, 0)!;
    expect(line_.kind === "trace" && [0, 1, 2, 3].map(line_.eligible)).toEqual([
      true,
      false,
      true,
      true,
    ]);
    expect(line_.kind === "trace" && line_.sameRun(0, 2)).toBe(true);
  });

  it("give unsorted lines each path point's position, steps' vertices as the point they leave", () => {
    const data = table({ x: [3, 1, 2], y: [1, 2, 3] });
    const { records } = drawn({
      marks: [line(data, { x: "y", y: "x", orient: "y", curve: "step-after" })],
    });
    const part = partAt(records[0]!, 0, 0)!;
    expect(part.kind === "trace" && part.along).toBe("y");
    // Along y, the rows are sorted by y already; across x they are not.
    const unsorted = drawn({ marks: [line(data, { x: "x", y: "y", curve: "step-after" })] });
    const trace = partAt(unsorted.records[0]!, 0, 0)!;
    if (trace.kind !== "trace") throw new Error("a trace");
    expect(Array.from(trace.positions ?? [])).toEqual([0, 0, 1, 1, 2]);
  });

  it("name histogram bins as groups, by their series and edges", () => {
    const data = table({ v: [1, 2, 2, 3, 9], host: ["a", "a", "b", "b", "a"] });
    const { records } = drawn({
      marks: [histogram(data, { x: "v", bins: [0, 5, 10], id: "h", series: "host" })],
    });
    // Each is the point of its series' bins it is, which its rows are read from.
    expect(parts(records[0]!)).toMatchObject([
      { kind: "group", key: '["h","a",[0,5]]', point: { position: 0 } },
      { kind: "group", key: '["h","a",[5,10]]', point: { position: 1 } },
      { kind: "group", key: '["h","b",[0,5]]', point: { position: 0 } },
    ]);
  });

  it("name annotations' rows, and places given alone by their index", () => {
    const events = table({ at: [1, 2, 3], name: ["a", "b", "c"], end: [2, 3, 4] });
    const { records } = drawn({
      marks: [
        line(table({ t: [0, 5], v: [0, 5] }), { x: "t", y: "v" }),
        rule(events, { x: "at" }),
        region(events, { x1: "at", x2: "end" }),
        text(events, { x: "at", y: 1, label: { field: "name" } }),
        rule({ y: 2, id: "two" }),
      ],
    });
    const [, rules, regions, labels, alone] = records;
    expect(rowsOf(parts(rules!))).toEqual([0, 1, 2]);
    expect(rowsOf(parts(regions!, "rect"))).toEqual([0, 1, 2]);
    expect(rowsOf(parts(labels!))).toEqual([0, 1, 2]);
    expect(parts(alone!)).toEqual([{ kind: "group", key: '["two",0]' }]);
  });

  it("follow copies to the geometry each primitive was made in", () => {
    // Clips and paint orders paint a mark's own geometry.
    const events = table({ at: [1, 2], end: [2, 3], name: ["a", "b"] });
    const sorted = table({ x: [0, 1, 2], y: [1, 2, 3] });
    const model = new ChartModel(
      {
        marks: [
          region(events, { x1: "at", x2: "end", clip: "plot", label: { field: "name" } }),
          text(events, { x: "at", y: 1, label: { field: "name" }, zIndex: 2 }),
          line(sorted, { x: "x", y: "y", markers: true, clip: "plot" }),
        ],
        locale: "en-US",
      },
      undefined,
      ...staticCompilers(),
    );
    model.setSize(400, 300, 1);
    const [regions, labels, lines] = sceneOf(model).records;
    expect(rowsOf(parts(regions!))).toEqual([0, 1, 0, 1]);
    expect(rowsOf(parts(labels!))).toEqual([0, 1]);
    expect(rowsOf(parts(lines!, "point"))).toEqual([0, 1, 2]);
  });

  it("name what a highlight's dimmed and lit parts draw", () => {
    const values = table({ v: [1, 11] }) as unknown as Table;
    const sorted = table({ x: [0, 1, 2], y: [1, 2, 3] }) as unknown as Table;
    const model = new ChartModel(
      {
        marks: [
          histogram(values, { x: "v", bins: [0, 10, 20], id: "h" }),
          line(sorted, { x: "x", y: "y", markers: true }),
        ],
        locale: "en-US",
      },
      undefined,
      ...staticCompilers(),
    );
    model.setSize(400, 300, 1);
    const stores = [selectionStore(values), selectionStore(sorted)];
    const highlighter = new Highlighter([
      { table: values, store: stores[0]!, channel: "focus" },
      { table: sorted, store: stores[1]!, channel: "focus" },
    ]);
    model.highlight = (mark, series, frame, key) =>
      highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
    stores[0]!.set("focus", selectRows(new RowSet(values).add(1)));
    stores[1]!.set("focus", selectRows(new RowSet(sorted).add(1)));
    const [bins, lines] = sceneOf(model).records;
    // The first bin's bar is dimmed whole; the second's lit whole.
    expect(parts(bins!)).toMatchObject([
      { kind: "group", key: '["h",[0,10]]' },
      { kind: "group", key: '["h",[10,20]]' },
    ]);
    // Markers dimmed apart from the selected one, lit over them.
    const markers = lines!.geometry.flatMap((g, i) =>
      g.kind === "point"
        ? [
            Array.from({ length: (g as unknown as { count: number }).count }, (_, k) =>
              partAt(lines!, i, k),
            ),
          ]
        : [],
    );
    expect(markers.map((found) => rowsOf(found as DrawnPart[]))).toEqual([[0, 2], [1]]);
    // Without markers, a lone selected observation is a dot of its own.
    const plain = new ChartModel({ marks: [line(sorted, { x: "x", y: "y" })], locale: "en-US" });
    plain.setSize(400, 300, 1);
    plain.highlight = model.highlight;
    const [record] = sceneOf(plain).records;
    expect(rowsOf(parts(record!, "point"))).toEqual([1]);
  });

  it("trace a highlight's selected values, and what it dims, as each path draws them", () => {
    const highlighted = (mark: ChartMark, rows: Table, selected: number[]) => {
      const model = new ChartModel(
        { marks: [mark], locale: "en-US" },
        undefined,
        ...staticCompilers(),
      );
      model.setSize(400, 300, 1);
      const store = selectionStore(rows);
      const highlighter = new Highlighter([{ table: rows, store, channel: "focus" }]);
      model.highlight = (m, series, frame, key) =>
        highlighter.geometry(m, series, frame, key) ?? m.geometry(series, frame, key);
      const set = new RowSet(rows);
      for (const row of selected) set.add(row);
      store.set("focus", selectRows(set));
      const [record] = sceneOf(model).records;
      // Each line's trace, the selected values' (a masked copy's) apart.
      const traces = (lit: boolean) =>
        record!.geometry.flatMap((g, i) =>
          g.kind === "line" && g.key.includes("\u0001on") === lit ? [partAt(record!, i, 0)!] : [],
        );
      return { lit: traces(true), dimmed: traces(false) };
    };
    // Unsorted, stepped: the selected rows' path has their three vertices.
    const unsorted = table({ x: [0, 2, 1, 3], y: [1, 1, 1, 1] }) as unknown as Table;
    const stepped = highlighted(
      line(unsorted, { x: "x", y: "y", curve: "step-after" }),
      unsorted,
      [1, 2],
    );
    const [path] = stepped.lit;
    expect(path?.kind === "trace" && Array.from(path.positions ?? [])).toEqual([1, 1, 2]);
    expect(path?.kind === "trace" && [0, 1, 2, 3].map(path.eligible)).toEqual([
      false,
      true,
      true,
      false,
    ]);
    // Rows at one x: the dimmed path runs on through them, the selected one stands alone.
    const repeated = table({ x: [0, 1, 1, 2], y: [1, 1, 1, 1] }) as unknown as Table;
    const gaps = highlighted(
      line(repeated, { x: "x", y: "y", continuity: { maxGap: 10 } }),
      repeated,
      [1],
    );
    const [whole] = gaps.dimmed;
    expect(whole?.kind === "trace" && whole.sameRun(0, 3)).toBe(true);
    const [alone] = gaps.lit;
    expect(alone?.kind === "trace" && alone.sameRun(0, 3)).toBe(false);
    expect(alone?.kind === "trace" && alone.eligible(1)).toBe(true);
  });

  it("name a dendrogram's merges by their rows", () => {
    const linkage = table({ first: [0, 2], second: [1, 3], height: [1, 2] });
    const { records } = drawn({
      marks: [
        dendrogram(linkage, {
          first: "first",
          second: "second",
          height: "height",
          leaves: ["a", "b", "c"],
        }),
      ],
    });
    expect(rowsOf(parts(records[0]!))).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it("pick cells, boxes, and candles through the marks' own lookups", () => {
    // A cell, which rows may share, is named by its column and row.
    const cells = table({ x: ["a", "b"], y: ["p", "p"], v: [1, 2] });
    const { records, model } = drawn({
      marks: [heatmap(cells, { x: "x", y: "y", color: "v", id: "cells" })],
    });
    const [panel] = model.panels();
    const mark = model.config.marks[0] as Mark;
    const at = { x: panel!.x.map(1), y: panel!.y.map(0), slop: 4, lookups };
    expect(mark.pickItem!(records[0]!, at)).toMatchObject({
      part: { kind: "group", key: '["cells","b","p"]' },
      names: ["b", "p"],
      distance: 0,
    });
    const summed = table({ x: [1, 1, 2], y: [5, 5, 5], v: [1, 2, 3] });
    const sums = drawn({
      marks: [heatmap(summed, { x: "x", y: "y", color: "v", reduce: "sum", id: "sums" })],
    });
    const q0 = sums.model.panels()[0]!;
    const sum = sums.model.config.marks[0] as Mark;
    expect(
      sum.pickItem!(sums.records[0]!, { x: q0.x.map(1), y: q0.y.map(5), slop: 4, lookups })?.part,
    ).toMatchObject({ kind: "group", key: '["sums",1,5]' });
    const samples = table({ g: ["a", "a", "b", "b"], v: [1, 3, 2, 4] });
    const boxes = drawn({ marks: [boxplot(samples, { x: "g", y: "v", id: "box" })] });
    const box = boxes.model.config.marks[0] as Mark;
    const p = boxes.model.panels()[0]!;
    expect(
      box.pickItem!(boxes.records[0]!, { x: p.x.map(1), y: p.y.map(3), slop: 4, lookups }),
    ).toMatchObject({
      part: { kind: "group", key: '["box","b"]' },
      names: ["b"],
    });
    const prices = table({ t: [1, 2], o: [1, 2], h: [3, 4], l: [0, 1], c: [2, 3] });
    const candles = drawn({
      marks: [candlestick(prices, { x: "t", open: "o", high: "h", low: "l", close: "c" })],
    });
    const candle = candles.model.config.marks[0] as Mark;
    const q = candles.model.panels()[0]!;
    expect(
      candle.pickItem!(candles.records[0]!, { x: q.x.map(2), y: q.y.map(2.5), slop: 4, lookups })
        ?.part,
    ).toMatchObject({ kind: "row", position: 1 });
    // Nothing past the reach of a shape, though a tooltip's lookup finds the nearest.
    const above = { x: q.x.map(2), y: q.y.map(4) - 20, slop: 4, lookups };
    expect(
      candle.pick!(candles.records[0]!.series, above.x, above.y, candles.records[0]!.frame!),
    ).toBeDefined();
    expect(candle.pickItem!(candles.records[0]!, above)).toBeUndefined();
    expect(
      candle.pickItem!(candles.records[0]!, { ...above, slop: 24, lookups })?.distance,
    ).toBeCloseTo(20);
  });

  it("name heatmap cells by their bands' values, whatever their labels", () => {
    const keys = (config: ChartConfig) => {
      const { model, records } = drawn(config);
      const mark = model.config.marks[0] as Mark;
      const [record] = records;
      const s = record!.series[0]!;
      return Array.from({ length: s.length }, (_, k) => {
        const [x, y] = mark.pointAnchor!(s, k, record!.frame!)!;
        const picked = mark.pickItem!(record!, { x, y, slop: 4, lookups })?.part;
        return picked?.kind === "group" ? picked.key : undefined;
      });
    };
    // Numbers in bands, whose labels round them alike, in any locale.
    const close = table({ x: [1.00001, 1.00002], y: ["p", "p"], v: [1, 2] });
    const bands = [heatmap(close, { x: "x", y: "y", color: "v", xBanded: true, id: "h" })];
    expect(keys({ marks: bands })).toEqual(['["h",1.00001,"p"]', '["h",1.00002,"p"]']);
    expect(keys({ marks: bands, locale: "de-DE" })).toEqual(keys({ marks: bands }));
    // A calendar's weekdays and months by name, its weeks by their start.
    const days = table({ day: time([Date.UTC(2024, 0, 1), Date.UTC(2024, 1, 3)]), n: [1, 2] });
    expect(keys({ marks: [heatmap(days, { date: "day", color: "n", id: "c" })] })).toEqual([
      `["c",${Date.UTC(2024, 0, 1)},"weekday:mon"]`,
      `["c",${Date.UTC(2024, 0, 29)},"weekday:sat"]`,
    ]);
    // Facet panels' cells, whose series are each panel's copies.
    const faceted = table({ x: ["a", "b"], y: ["p", "q"], v: [1, 2], g: ["u", "w"] });
    const heat = heatmap(faceted, { x: "x", y: "y", color: "v", id: "f" });
    expect(keys({ marks: [heat], facet: facet({ column: "g" }) })).toEqual(['["f","a","p"]']);
    const months = [heatmap(days, { date: "day", color: "n", calendar: "months", id: "m" })];
    expect(keys({ marks: months })).toEqual([
      `["m","day:1","month:${2024 * 12}"]`,
      `["m","day:3","month:${2024 * 12 + 1}"]`,
    ]);
  });

  it("bound what lookups pick as it is drawn", () => {
    /** What `config`'s mark picks at data values `x` and `y` (pixels offset by `dx`, `dy`), and its panel. */
    const pick = (config: ChartConfig, x: number, y: number, dx = 0, dy = 0) => {
      const { model, records } = drawn(config);
      const p = model.panels()[0]!;
      const mark = model.config.marks[0] as Mark;
      const at = { x: p.x.map(x) + dx, y: p.y.map(y) + dy, slop: 4, lookups };
      const picked = mark.pickItem!(records[0]!, at);
      expect(picked?.box, JSON.stringify(picked)).toBeDefined();
      const { box } = picked!;
      // What was picked is drawn where the pointer is.
      expect(at.x).toBeGreaterThanOrEqual(box.x - 4);
      expect(at.x).toBeLessThanOrEqual(box.x + box.width + 4);
      expect(at.y).toBeGreaterThanOrEqual(box.y - 4);
      expect(at.y).toBeLessThanOrEqual(box.y + box.height + 4);
      return { box, p };
    };
    const cells = table({ x: ["a", "b"], y: ["p", "q"], v: [1, 2] });
    const cell = pick({ marks: [heatmap(cells, { x: "x", y: "y", color: "v" })] }, 1, 1);
    expect(cell.box.width).toBeCloseTo(Math.abs(cell.p.x.bandwidth!));
    expect(cell.box.height).toBeCloseTo(Math.abs(cell.p.y.bandwidth!));
    expect(cell.box.x).toBeCloseTo(cell.p.x.map(1) - cell.box.width / 2);
    const numbers = table({ x: [1, 2, 3], y: [5, 5, 6], v: [1, 2, 3] });
    const numeric = pick({ marks: [heatmap(numbers, { x: "x", y: "y", color: "v" })] }, 2, 5);
    expect(numeric.box.width).toBeGreaterThan(10);
    const points = table({ t: [1, 1.2, 4, 4.5], v: [1, 1.1, 3, 3.5] });
    const bin = pick({ marks: [histogram(points, { x: "t", y: "v" })] }, 1.1, 1.05);
    expect(bin.box.width * bin.box.height).toBeGreaterThan(0);
    const samples = table({ g: ["a", "a", "b", "b"], v: [1, 3, 2, 4] });
    const box = pick({ marks: [boxplot(samples, { x: "g", y: "v" })] }, 1, 3);
    // With the pixel its strokes reach past its values.
    expect(box.box.y).toBeCloseTo(box.p.y.map(4) - 1);
    expect(box.box.y + box.box.height).toBeCloseTo(box.p.y.map(2) + 1);
    const prices = table({ t: [1, 2], o: [1, 2], h: [3, 4], l: [0, 1], c: [2, 3] });
    const ohlc = { x: "t", open: "o", high: "h", low: "l", close: "c" } as const;
    const candle = pick({ marks: [candlestick(prices, ohlc)] }, 2, 2.5);
    expect(candle.box.y).toBeCloseTo(candle.p.y.map(4));
    expect(candle.box.y + candle.box.height).toBeCloseTo(candle.p.y.map(1));
    expect(candle.box.width).toBeGreaterThan(0);
    const ranges = table({ t: [1, 2], lo: [1, 2], hi: [3, 4] });
    const range = pick(
      { marks: [errorbar(ranges, { x: "t", y1: "lo", y2: "hi" })], y: { domain: [0, 5] } },
      2,
      3,
    );
    // Painted 1.5 px strokes reach half that past the ends, inside the plot.
    expect(range.box.y).toBeCloseTo(range.p.y.map(4) - 0.75);
    expect(range.box.width).toBeGreaterThan(0);
    const ticks = table({ v: [1, 2, 3] });
    const tick = pick({ marks: [rug(ticks, { x: "v" })] }, 2, 0);
    expect(tick.box.width).toBe(1);
    expect(tick.box.height).toBeGreaterThan(0);
    const z: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    for (let j = 0; j < 21; j++)
      for (let i = 0; i < 21; i++) {
        const [u, v] = [i / 10 - 1, j / 10 - 1];
        xs.push(u);
        ys.push(v);
        z.push(10 * (1 - Math.min(1, Math.hypot(u, v))));
      }
    const cone = table({ x: xs, y: ys, z });
    const peak = { x: "x", y: "y", color: "z", thresholds: [2, 5, 8], variant: "bands" } as const;
    const region = pick({ marks: [contour(cone, peak)] }, 0.35, 0);
    // The band from 5 to 8: a ring between radii 0.2 and 0.5 about the center, bounded by its outer edge.
    const across = region.p.x.map(1) - region.p.x.map(-1);
    expect(region.box.width / across).toBeCloseTo(0.5, 1);
  });

  it("pick boxen on log axes at the median line drawn without the levels it drops", () => {
    const samples = table({ g: ["a", "a", "a", "a", "a"], v: [-2, -1, 1, 2, 3] });
    for (const horizontal of [false, true])
      for (const domain of [
        [0.1, 10],
        [10, 0.1],
      ] as [number, number][]) {
        const mark = horizontal
          ? boxen(samples, { y: "g", x: "v", outliers: false })
          : boxen(samples, { x: "g", y: "v", outliers: false });
        const value = { type: "log", domain, nice: false } as const;
        const { records, model } = drawn({
          marks: [mark],
          ...(horizontal ? { x: value } : { y: value }),
        });
        const p = model.panels()[0]!;
        // On the median line, at 1, 3 px off the center along it.
        const at = horizontal
          ? { x: p.x.map(1), y: p.y.map(0) + 3, slop: 4, lookups }
          : { x: p.x.map(0) + 3, y: p.y.map(1), slop: 4, lookups };
        const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
        const name = `${horizontal ? "across" : "up"} ${domain[0] > domain[1] ? "reversed" : ""}`;
        expect(found?.distance, name).toBe(0);
        const { box } = found!;
        expect(at.x >= box.x && at.x <= box.x + box.width, name).toBe(true);
        expect(at.y >= box.y && at.y <= box.y + box.height, name).toBe(true);
      }
    // A box across 0 and a negative median: the axis draws nothing of the group, and picks
    // nothing; nor of a box plot's whose upper whisker reaches 1 from a negative box.
    const across = table({ g: ["a", "a", "a", "a", "a"], v: [-2, -1, -0.5, 1, 2] });
    const below = table({ g: ["a", "a", "a", "a", "a"], v: [-2, -1, -0.5, -0.2, 1] });
    // Boxen levels of no width (no height, by area) at 1, over a box from -1 and a median of -1.
    const flat = table({
      g: Array.from({ length: 100 }, () => "a"),
      v: Array.from({ length: 100 }, (_, i) => (i < 60 ? -1 : 1)),
    });
    const leveled = { depth: 2, widthMethod: "area" } as const;
    for (const [make, values, options] of [
      [boxen, across, {}],
      [boxplot, below, {}],
      [boxen, flat, leveled],
    ] as const)
      for (const horizontal of [false, true])
        for (const domain of [
          [0.1, 10],
          [10, 0.1],
        ] as [number, number][]) {
          const own = { outliers: false, ...options } as const;
          const mark = horizontal
            ? make(values, { y: "g", x: "v", ...own })
            : make(values, { x: "g", y: "v", ...own });
          const value = { type: "log", domain, nice: false } as const;
          const { records, model } = drawn({
            marks: [mark],
            ...(horizontal ? { x: value } : { y: value }),
          });
          const drawnCount = records[0]!.geometry.reduce(
            (n, g) => n + ("count" in g ? (g.count as number) : 0),
            0,
          );
          expect(drawnCount, mark.spec.type).toBe(0);
          const p = model.panels()[0]!;
          const at = horizontal
            ? { x: p.x.map(1), y: p.y.map(0), slop: 4, lookups }
            : { x: p.x.map(0), y: p.y.map(1), slop: 4, lookups };
          expect(
            (model.config.marks[0] as Mark).pickItem!(records[0]!, at),
            mark.spec.type,
          ).toBeUndefined();
        }
  });

  it("pick a candle drawn beside the view, unclipped", () => {
    // The first candle, left of the view, draws its body into the margin.
    const prices = table({
      t: [-0.1, 0.5, 1],
      o: [6, 6, 6],
      h: [9, 9, 9],
      l: [1, 1, 1],
      c: [4, 4, 4],
    });
    for (const clip of [false, "chart"] as const) {
      const ohlc = { x: "t", open: "o", high: "h", low: "l", close: "c", clip } as const;
      const { model, records } = drawn(
        {
          marks: [candlestick(prices, ohlc)],
          x: { domain: [0, 1], nice: false },
          y: { domain: [0, 10], nice: false },
          padding: 100,
        },
        500,
        400,
      );
      const p = model.panels()[0]!;
      const plot = records[0]!.frame!.plot;
      // In its body, far enough left of the plot that no candle in view is centered near.
      const at = { x: plot.x - 45, y: p.y.map(5), slop: 0, lookups };
      const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
      expect(found?.part.kind === "row" && found.part.position, String(clip)).toBe(0);
    }
  });

  it("pick a falling candle's body over a coincident falling candle's wick", () => {
    // Geometry paints every falling wick, then every falling body.
    const prices = table({ t: [1, 1], o: [9, 4], h: [10, 10], l: [1, 1], c: [7, 2] });
    const { records, model } = drawn({
      marks: [candlestick(prices, { x: "t", open: "o", high: "h", low: "l", close: "c" })],
    });
    const p = model.panels()[0]!;
    const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, {
      x: p.x.map(1),
      y: p.y.map(8),
      slop: 0,
      lookups,
    });
    expect(found?.part.kind === "row" && found.part.position).toBe(0);
    // Bodies narrower than the wicks: beside the bodies, only wicks show, the last painted on top.
    const thin = table({
      t: [0.001, 0.001, 0, 1],
      o: [9, 4, 6, 6],
      h: [10, 10, 10, 10],
      l: [1, 1, 1, 1],
      c: [7, 2, 4, 4],
    });
    const { records: thinRecords, model: thinModel } = drawn({
      marks: [candlestick(thin, { x: "t", open: "o", high: "h", low: "l", close: "c" })],
      x: { domain: [0, 1], nice: false },
      y: { domain: [0, 10], nice: false },
    });
    const q = thinModel.panels()[0]!;
    const wick = (thinModel.config.marks[0] as Mark).pickItem!(thinRecords[0]!, {
      x: q.x.map(0.001) + 0.45,
      y: q.y.map(8),
      slop: 0,
      lookups,
    });
    expect(wick?.part.kind === "row" && wick.part.position).toBe(1);
  });

  it("pick a violin's median dot where it reaches into the plot past the values drawn", () => {
    const samples = table({ g: ["a", "a", "a", "a", "a"], v: [-10, -5, 0.001, 1, 2] });
    for (const horizontal of [false, true]) {
      const options = { bandwidth: 0.5, inner: "box" } as const;
      const mark = horizontal
        ? violin(samples, { y: "g", x: "v", ...options })
        : violin(samples, { x: "g", y: "v", ...options });
      // The median, 0.001, a pixel past the plot's end.
      const value = { type: "log", domain: [0.00001, 0.00098], nice: false } as const;
      const { records, model } = drawn({
        marks: [mark],
        ...(horizontal ? { x: value } : { y: value }),
      });
      const p = model.panels()[0]!;
      const plot = records[0]!.frame!.plot;
      const at = horizontal
        ? { x: plot.x + plot.width - 0.1, y: p.y.map(0), slop: 0, lookups }
        : { x: p.x.map(0), y: plot.y + 0.1, slop: 0, lookups };
      const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
      const name = horizontal ? "across" : "up";
      expect(found?.distance, name).toBe(0);
      const { box } = found!;
      expect(at.x >= box.x && at.x <= box.x + box.width, name).toBe(true);
      expect(at.y >= box.y && at.y <= box.y + box.height, name).toBe(true);
    }
  });

  it("pick violins on log axes by what the axis draws of them", () => {
    const samples = table({ g: ["a", "a", "a", "a", "a"], v: [-2, -1, 1, 2, 3] });
    const { records, model } = drawn({
      marks: [violin(samples, { x: "g", y: "v" })],
      y: { type: "log", domain: [0.1, 10] },
    });
    const mark = model.config.marks[0] as Mark;
    const record = records[0]!;
    // 2 px outside a sloping stretch of the drawn outline, away from the center.
    const outline = record.geometry.find(
      (g): g is LineGeometry => g.kind === "line" && (g as LineGeometry).path.count > 3,
    )!.path;
    const center = model.panels()[0]!.x.map(0);
    const plot = record.frame!.plot;
    // Inside the plot: below it, the outline is clipped away.
    const shown = (py: number) => py > plot.y + 4 && py < plot.y + plot.height - 4;
    let found = false;
    for (let i = 0; i < outline.count - 1 && !found; i++) {
      const [x0, y0, x1, y1] = outline.coords.subarray(i * 2, i * 2 + 4);
      if (!(x0! > center + 2 && Math.abs(x1! - x0!) > 0.5 && Math.abs(y1! - y0!) > 0.5)) continue;
      if (!(shown(y0!) && shown(y1!))) continue;
      const length = Math.hypot(x1! - x0!, y1! - y0!);
      const [nx, ny] = [(y1! - y0!) / length, -(x1! - x0!) / length];
      const sign = nx > 0 ? 1 : -1;
      const at = {
        x: (x0! + x1!) / 2 + sign * nx * 2,
        y: (y0! + y1!) / 2 + sign * ny * 2,
        slop: 4,
        lookups,
      };
      // 2 px from the outline's middle: 1.25 from its 1.5 px stroke.
      expect(mark.pickItem!(record, at)?.distance).toBeCloseTo(1.25, 1);
      found = true;
    }
    expect(found).toBe(true);
  });

  it("pick a highlight's selected error bars and rugs over the others they lie under", () => {
    const top = (data: Table, mark: ChartMark, x: number, y: number) => {
      const model = new ChartModel({ marks: [mark], locale: "en-US" });
      model.setSize(400, 300, 1);
      const store = selectionStore(data);
      const highlighter = new Highlighter([{ table: data, store, channel: "focus" }]);
      model.highlight = (m, series, frame, key) =>
        highlighter.geometry(m, series, frame, key) ?? m.geometry(series, frame, key);
      model.layoutHighlight = (t) => highlighter.selected(t);
      store.set("focus", selectRows(new RowSet(data).add(0)));
      const { records } = sceneOf(model);
      const p = model.panels()[0]!;
      const plot = records[0]!.frame!.plot;
      const at = {
        x: p.x.map(x),
        y: Number.isNaN(y) ? plot.y + plot.height - 2 : p.y.map(y),
        slop: 4,
        lookups,
      };
      return (model.config.marks[0] as Mark).pickItem!(records[0]!, at)?.part;
    };
    // Selected row 0 paints over row 1, of another series or its own.
    const twice = table({ v: [2, 2], lo: [1, 1], hi: [3, 3], g: ["a", "b"], t: [1, 1] });
    const same = table({ v: [2, 2], t: [1, 1], lo: [1, 1], hi: [3, 3] });
    for (const data of [twice, same] as unknown as Table[]) {
      const series = data === (twice as unknown as Table) ? { series: "g" } : {};
      const ticks = rug(data, { x: "v", ...series });
      const bars = errorbar(data, { x: "t", y1: "lo", y2: "hi", ...series });
      for (const [mark, x, y] of [
        [ticks, 2, Number.NaN],
        [bars, 1, 2],
      ] as const) {
        const part = top(data, mark, x, y);
        expect(part?.kind === "row" && part.position).toBe(0);
      }
    }
  });

  it("pick a highlight's selected candle drawn over its merged column", () => {
    const n = 1000;
    const same = (value: number) => Array.from({ length: n }, () => value);
    const prices = table({
      t: Array.from({ length: n }, (_, i) => i),
      o: same(2),
      h: same(4),
      l: same(1),
      c: same(3),
    }) as unknown as Table;
    const model = new ChartModel({
      marks: [candlestick(prices, { x: "t", open: "o", high: "h", low: "l", close: "c" })],
      locale: "en-US",
    });
    model.setSize(400, 300, 1);
    const store = selectionStore(prices);
    const highlighter = new Highlighter([{ table: prices, store, channel: "focus" }]);
    model.highlight = (m, series, frame, key) =>
      highlighter.geometry(m, series, frame, key) ?? m.geometry(series, frame, key);
    model.layoutHighlight = (t) => highlighter.selected(t);
    store.set("focus", selectRows(new RowSet(prices).add(499)));
    const { records } = sceneOf(model);
    const p = model.panels()[0]!;
    const mark = model.config.marks[0] as Mark;
    const at = (t: number) =>
      mark.pickItem!(records[0]!, { x: p.x.map(t), y: p.y.map(2.5), slop: 4, lookups });
    const lit = at(499)!;
    expect(lit.part.kind === "row" && lit.part.position).toBe(499);
    expect(lit.box.y).toBeCloseTo(p.y.map(4));
    // Elsewhere, the column's candle names an unselected row.
    const dimmed = at(100)!;
    expect(dimmed.part.kind === "row" && dimmed.part.position).not.toBe(499);
  });

  it("pick only error bars drawn, and only the caps they draw", () => {
    // An interval in an axis break is not drawn, nor picked at the seam.
    const times = table({ t: time([1, 2.5, 4]), lo: [1, 5, 1], hi: [2, 6, 2] });
    const broken = drawn({
      marks: [errorbar(times, { x: "t", y1: "lo", y2: "hi" })],
      x: { breaks: timeBreaks([{ from: 2, to: 3 }]), domain: [0, 5], nice: false },
    });
    const panel = broken.model.panels()[0]!;
    const seam = { x: panel.x.map(2.5), y: panel.y.map(5.5), slop: 4, lookups };
    const mark = broken.model.config.marks[0] as Mark;
    expect(mark.pickItem!(broken.records[0]!, seam)).toBeUndefined();
    // Without caps, a stem ends square at its ends.
    const ranges = table({ t: [1, 2], lo: [1, 2], hi: [3, 4] });
    const bare = drawn({
      marks: [errorbar(ranges, { x: "t", y1: "lo", y2: "hi", cap: 0, strokeWidth: 20 })],
      // Inside the plot, which would cut the stroke.
      x: { domain: [0, 3], nice: false },
    });
    const p = bare.model.panels()[0]!;
    const bars = bare.model.config.marks[0] as Mark;
    const above = (by: number) => ({ x: p.x.map(1), y: p.y.map(3) - by, slop: 4, lookups });
    expect(bars.pickItem!(bare.records[0]!, above(8))).toBeUndefined();
    const near = bars.pickItem!(bare.records[0]!, above(3))!;
    expect(near.distance).toBeCloseTo(3);
    expect(near.box.y).toBeCloseTo(p.y.map(3));
    expect(near.box.width).toBe(20);
  });

  it("pick error bars drawn past the plot where their clip lets them", () => {
    const tall = table({ t: [1], lo: [2], hi: [10.25] });
    const axes = {
      x: { domain: [0, 2] as [number, number], nice: false },
      y: { domain: [0, 10] as [number, number], nice: false },
    };
    for (const clip of [false, "chart", undefined] as const) {
      const { model, records } = drawn({
        marks: [
          errorbar(tall, { x: "t", y1: "lo", y2: "hi", ...(clip !== undefined && { clip }) }),
        ],
        ...axes,
      });
      const p = model.panels()[0]!;
      const mark = model.config.marks[0] as Mark;
      // On the stem and on the cap above the plot: drawn there unless cut to the plot.
      for (const at of [
        { x: p.x.map(1), y: p.y.map(10.2) },
        { x: p.x.map(1) + 2, y: p.y.map(10.25) },
      ]) {
        const found = mark.pickItem!(records[0]!, { ...at, slop: 4, lookups });
        if (clip === undefined) expect(found).toBeUndefined();
        else expect(found?.distance).toBe(0);
      }
    }
  });

  it("pick error bars' caps reaching into the plot from positions beside it", () => {
    for (const t of [
      [-0.01, 1],
      [1, -0.01],
    ]) {
      const ranges = table({ t, lo: [2, 2], hi: [5, 5] });
      const { model, records } = drawn({
        marks: [errorbar(ranges, { x: "t", y1: "lo", y2: "hi", cap: 12 })],
        x: { domain: [0, 2], nice: false },
      });
      const p = model.panels()[0]!;
      const plot = records[0]!.frame!.plot;
      const mark = model.config.marks[0] as Mark;
      const at = { x: plot.x + 1, y: p.y.map(5), slop: 4, lookups };
      const found = mark.pickItem!(records[0]!, at);
      expect(found?.distance).toBe(0);
      expect(found?.part.kind === "row" && found.part.position).toBe(t.indexOf(-0.01));
      expect(mark.pick!(records[0]!.series, at.x, at.y, records[0]!.frame!)?.distance).toBe(0);
    }
  });

  it("pick no cells of a drawing that shows none, and no candles geometry leaves out", () => {
    const points = table({ x: [0, 1], y: [0, 1], v: [1, 2] });
    const bins = { x: [-0.5, 0.5, 1.5], y: [-0.5, 0.5, 1.5] };
    const past = {
      x: { domain: [1.51, 2.5] as [number, number], nice: false },
      y: { domain: [-1, 2] as [number, number], nice: false },
    };
    for (const clip of [undefined, false, "chart"] as const)
      for (const mark of [
        heatmap(points, { x: "x", y: "y", color: "v", ...(clip !== undefined && { clip }) }),
        histogram(points, { x: "x", y: "y", bins, ...(clip !== undefined && { clip }) }),
      ]) {
        const { model, records } = drawn({ marks: [mark], ...past });
        const p = model.panels()[0]!;
        const picker = model.config.marks[0] as Mark;
        const at = { x: p.x.map(1.49), y: p.y.map(1), slop: 4, lookups };
        expect(records[0] && picker.pickItem!(records[0], at)).toBeUndefined();
      }
    // Row 0 is a neighbor's neighbor left of the view, which geometry draws none of.
    const prices = table({
      t: [-0.02, -0.01, 0, 1, 2],
      o: [2, 7, 7, 7, 7],
      h: [3, 9, 9, 9, 9],
      l: [1, 6, 6, 6, 6],
      c: [1.5, 8, 8, 8, 8],
    });
    for (const clip of [undefined, false] as const) {
      const ohlc = { x: "t", open: "o", high: "h", low: "l", close: "c" } as const;
      const { model, records } = drawn({
        marks: [candlestick(prices, { ...ohlc, ...(clip !== undefined && { clip }) })],
        x: { domain: [0, 2], nice: false },
        y: { domain: [0, 10], nice: false },
      });
      const plot = records[0]!.frame!.plot;
      const p = model.panels()[0]!;
      const picker = model.config.marks[0] as Mark;
      const at = { x: plot.x + 0.5, y: p.y.map(2), slop: 4, lookups };
      expect(picker.pickItem!(records[0]!, at)).toBeUndefined();
    }
  });

  it("pick no cell in the gaps between a highlight's cells and the image", () => {
    // Row 0 selected left of the view, drawn there unclipped; the cell above it is not drawn.
    const points = table({ x: [0, 0, 1], y: [0, 1, 2], v: [1, 2, 3] }) as unknown as Table;
    const bins = { x: [-0.5, 0.5, 1.5], y: [-0.5, 0.5, 1.5, 2.5] };
    for (const mark of [
      heatmap(points, { x: "x", y: "y", color: "v", clip: false }),
      histogram(points, { x: "x", y: "y", bins, clip: false }),
    ]) {
      const model = new ChartModel({
        marks: [mark],
        x: { domain: [0.51, 4], nice: false },
        y: { domain: [-1, 3], nice: false },
        locale: "en-US",
      });
      model.setSize(400, 300, 1);
      const store = selectionStore(points);
      const highlighter = new Highlighter([{ table: points, store, channel: "focus" }]);
      model.highlight = (m, series, frame, key) =>
        highlighter.geometry(m, series, frame, key) ?? m.geometry(series, frame, key);
      model.layoutHighlight = (t) => highlighter.selected(t);
      store.set("focus", selectRows(new RowSet(points).add(0)));
      const { records } = sceneOf(model);
      const p = model.panels()[0]!;
      const picker = model.config.marks[0] as Mark;
      const name = mark.spec.type;
      expect(
        picker.pickItem!(records[0]!, { x: p.x.map(0.4), y: p.y.map(1), slop: 0, lookups }),
        name,
      ).toBeUndefined();
      // The selected cell itself is picked where it is drawn, inside the chart.
      const lit = picker.pickItem!(records[0]!, {
        x: p.x.map(0.45),
        y: p.y.map(0),
        slop: 0,
        lookups,
      });
      expect(lit?.distance, name).toBe(0);
    }
  });

  it("pick the cell drawn at the plot's edge, not its neighbor past it", () => {
    for (const along of ["x", "y"] as const)
      for (const domain of [
        [-0.5, 0.5],
        [0.5, -0.5],
      ] as [number, number][]) {
        // Cells at 0 and 1 along one axis; the view shows the first, up to their shared edge.
        const points = table(
          along === "x" ? { x: [0, 1], y: [0, 0], v: [1, 2] } : { x: [0, 0], y: [0, 1], v: [1, 2] },
        );
        const edges = [-0.5, 0.5, 1.5];
        const bins = along === "x" ? { x: edges, y: [-0.5, 0.5] } : { x: [-0.5, 0.5], y: edges };
        for (const mark of [
          heatmap(points, { x: "x", y: "y", color: "v" }),
          histogram(points, { x: "x", y: "y", bins }),
        ]) {
          const { model, records } = drawn({
            marks: [mark],
            [along]: { domain, nice: false },
            [along === "x" ? "y" : "x"]: { domain: [-0.5, 0.5], nice: false },
          });
          const p = model.panels()[0]!;
          const at =
            along === "x"
              ? { x: p.x.map(0.5), y: p.y.map(0), slop: 4, lookups }
              : { x: p.x.map(0), y: p.y.map(0.5), slop: 4, lookups };
          const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
          const name = `${mark.spec.type} ${along} ${domain[0]}`;
          expect(found?.distance, name).toBe(0);
          expect(found?.box.width, name).toBeGreaterThan(0);
          expect(found?.box.height, name).toBeGreaterThan(0);
        }
      }
  });

  it("pick contour bands by the outline opaque bands are drawn with", () => {
    const xs = [0, 1, 2, 0, 1, 2, 0, 1, 2];
    const ys = [0, 0, 0, 1, 1, 1, 2, 2, 2];
    const { model, records } = drawn({
      marks: [
        contour(table({ x: xs, y: ys, z: ys }), {
          x: "x",
          y: "y",
          color: "z",
          thresholds: [0.5, 1.5],
          variant: "bands",
        }),
      ],
      x: { domain: [0, 2], nice: false },
      y: { domain: [0, 2], nice: false },
    });
    const p = model.panels()[0]!;
    const picker = model.config.marks[0] as Mark;
    // Above the band's top edge, at 1.5: the outline reaches a quarter pixel past it.
    const above = (dy: number, slop: number) =>
      picker.pickItem!(records[0]!, { x: p.x.map(1), y: p.y.map(1.5) - dy, slop, lookups });
    expect(above(0.1, 0)?.distance).toBe(0);
    expect(above(4.1, 4)?.distance).toBeCloseTo(3.85);
    expect(above(4.3, 4)).toBeUndefined();
    // Adjacent opaque bands: the upper one, painted later, outlines over the lower one's edge.
    const { model: two, records: drawnTwo } = drawn({
      marks: [
        contour(table({ x: xs, y: ys, z: ys }), {
          x: "x",
          y: "y",
          color: "z",
          thresholds: [0.5, 1.5, 2],
          variant: "bands",
        }),
      ],
      x: { domain: [0, 2], nice: false },
      y: { domain: [0, 2], nice: false },
    });
    const q = two.panels()[0]!;
    const covered = (two.config.marks[0] as Mark).pickItem!(drawnTwo[0]!, {
      x: q.x.map(1),
      y: q.y.map(1.5) + 0.1,
      slop: 0,
      lookups,
    });
    expect(covered?.distance).toBe(0);
    expect(covered?.part.kind === "group" && covered.part.key).toContain("1.5");
  });

  it("pick flat candles as drawn, a stroke across", () => {
    const flat = table({ t: [1], o: [2], h: [2], l: [2], c: [2] });
    for (const variant of ["candlestick", "ohlc"] as const) {
      const ohlc = { x: "t", open: "o", high: "h", low: "l", close: "c", variant } as const;
      const { model, records } = drawn({
        marks: [candlestick(flat, ohlc)],
        x: { domain: [0, 2], nice: false },
        y: { domain: [0, 4], nice: false },
      });
      const p = model.panels()[0]!;
      const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, {
        x: p.x.map(1),
        y: p.y.map(2),
        slop: 4,
        lookups,
      });
      expect(found?.distance).toBe(0);
      expect(found!.box.height).toBeGreaterThanOrEqual(1);
    }
  });

  it("pick distributions of one value as drawn, a stroke across", () => {
    // A group of one value repeated, and a group of one row.
    const groups = table({ g: ["a", "a", "a", "b"], v: [5, 5, 5, 3] });
    for (const make of [boxplot, violin, boxen] as const)
      for (const horizontal of [false, true]) {
        const mark = horizontal
          ? make(groups, { y: "g", x: "v" })
          : make(groups, { x: "g", y: "v" });
        const { model, records } = drawn({ marks: [mark] });
        const p = model.panels()[0]!;
        for (const [g, v] of [
          [0, 5],
          [1, 3],
        ]) {
          const at = horizontal
            ? { x: p.x.map(v!), y: p.y.map(g!), slop: 4, lookups }
            : { x: p.x.map(g!), y: p.y.map(v!), slop: 4, lookups };
          const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
          const name = `${mark.spec.type} ${horizontal ? "across" : "up"} at ${g}`;
          expect(found?.distance, name).toBe(0);
          expect(found!.box.width * found!.box.height, name).toBeGreaterThan(0);
        }
      }
  });

  it("pick straight contour lines where they are drawn", () => {
    const xs = [0, 1, 2, 0, 1, 2, 0, 1, 2];
    const ys = [0, 0, 0, 1, 1, 1, 2, 2, 2];
    // Across where z follows y, up where it follows x; between grid values and on them.
    for (const level of [1.5, 1])
      for (const [z, x, y] of [
        [ys, 0.5, level],
        [xs, level, 0.5],
      ] as const) {
        const field = table({ x: xs, y: ys, z: [...z] });
        const { model, records } = drawn({
          marks: [contour(field, { x: "x", y: "y", color: "z", thresholds: [level] })],
        });
        const p = model.panels()[0]!;
        const at = { x: p.x.map(x), y: p.y.map(y), slop: 4, lookups };
        const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
        expect(found?.distance, `${level} ${z === xs ? "up" : "across"}`).toBeCloseTo(0);
        expect(found!.box.width * found!.box.height).toBeGreaterThan(0);
      }
  });

  it("pick what clipping keeps: strokes past the plot, violins' shapes, bands within reach, error bars' bounds", () => {
    const at = (config: ChartConfig, point: (p: Panel, plot: Rect) => { x: number; y: number }) => {
      const { model, records } = drawn(config);
      const p = model.panels()[0]!;
      const where = point(p, records[0]!.frame!.plot);
      return (model.config.marks[0] as Mark).pickItem!(records[0]!, { ...where, slop: 4, lookups });
    };
    const xs = [0, 1, 2, 0, 1, 2, 0, 1, 2];
    const ys = [0, 0, 0, 1, 1, 1, 2, 2, 2];
    const field = table({ x: xs, y: ys, z: ys });
    // A thick contour line just below the plot: its stroke reaches 9.7 px inside.
    const thick = {
      marks: [contour(field, { x: "x", y: "y", color: "z", thresholds: [1], strokeWidth: 20 })],
      y: { domain: [1.001, 2] as [number, number], nice: false },
    };
    const inside = (by: number) => (p: Panel, plot: Rect) => ({
      x: p.x.map(1),
      y: plot.y + plot.height - by,
    });
    const kept = at(thick, inside(3));
    expect(kept?.distance).toBe(0);
    expect(kept!.box.height).toBeGreaterThan(9);
    expect(at(thick, inside(15))).toBeUndefined();
    // A violin whose wide body is below the plot and whose thin tail is in it.
    const values = [...Array.from({ length: 99 }, (_, i) => (i % 10) / 50), 10];
    const tail = table({ g: values.map(() => "a"), v: values });
    const violins = {
      marks: [violin(tail, { x: "g", y: "v", bandwidth: 0.2, inner: "none" })],
      y: { domain: [0.25, 10] as [number, number], nice: false },
    };
    const bottom = (dx: number) => (p: Panel, plot: Rect) => ({
      x: p.x.map(0) + dx,
      y: plot.y + plot.height - 1,
    });
    expect(at(violins, bottom(95))).toBeUndefined();
    expect(at(violins, bottom(0))?.distance).toBe(0);
    // A band from 1 to 2 is found 2 px below its edge (its outline a quarter pixel past it), not 6.
    const band = {
      marks: [contour(field, { x: "x", y: "y", color: "z", thresholds: [1, 2], variant: "bands" })],
    };
    const under = (by: number) => (p: Panel) => ({ x: p.x.map(1), y: p.y.map(1) + by });
    expect(at(band, under(2))?.distance).toBeCloseTo(1.75);
    expect(at(band, under(6))).toBeUndefined();
    // An interval past both ends of the plot is bounded by what it shows.
    const long = table({ t: [1], lo: [-10], hi: [20] });
    for (const horizontal of [false, true]) {
      const mark = horizontal
        ? errorbar(long, { y: "t", x1: "lo", x2: "hi" })
        : errorbar(long, { x: "t", y1: "lo", y2: "hi" });
      const value = { domain: [0, 10] as [number, number], nice: false };
      const { model, records } = drawn({
        marks: [mark],
        ...(horizontal ? { x: value } : { y: value }),
      });
      const p = model.panels()[0]!;
      const plot = records[0]!.frame!.plot;
      const point = horizontal
        ? { x: p.x.map(5), y: p.y.map(1) }
        : { x: p.x.map(1), y: p.y.map(5) };
      const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, {
        ...point,
        slop: 4,
        lookups,
      });
      expect(found?.distance).toBe(0);
      const { box } = found!;
      expect(box.x).toBeGreaterThanOrEqual(plot.x);
      expect(box.y).toBeGreaterThanOrEqual(plot.y);
      expect(box.x + box.width).toBeLessThanOrEqual(plot.x + plot.width);
      expect(box.y + box.height).toBeLessThanOrEqual(plot.y + plot.height);
      // The stem alone shows: its stroke wide, the caps cut away.
      expect(horizontal ? box.height : box.width).toBeCloseTo(1.5);
    }
  });

  it("pick round stroke ends, outlier dots, and rug ticks as painted inside the clip", () => {
    const picked = (
      config: ChartConfig,
      point: (p: Panel, plot: Rect) => { x: number; y: number },
    ) => {
      const { model, records } = drawn(config);
      const where = point(model.panels()[0]!, records[0]!.frame!.plot);
      return (model.config.marks[0] as Mark).pickItem!(records[0]!, { ...where, slop: 4, lookups });
    };
    // A thick contour line's round end at the grid's left edge, drawn past the plot.
    const xs = [0, 1, 2, 0, 1, 2, 0, 1, 2];
    const ys = [0, 0, 0, 1, 1, 1, 2, 2, 2];
    const level = {
      marks: [
        contour(table({ x: xs, y: ys, z: ys }), {
          x: "x",
          y: "y",
          color: "z",
          thresholds: [1.5],
          strokeWidth: 20,
          clip: false,
        }),
      ],
      x: { domain: [0, 2] as [number, number], nice: false },
    };
    const end = (dx: number, dy: number) => (p: Panel) => ({
      x: p.x.map(0) + dx,
      y: p.y.map(1.5) + dy,
    });
    // 15.8 px from the end, 5.8 past its cap; a square end would reach within 3.
    expect(picked(level, end(-9, 13))).toBeUndefined();
    expect(picked(level, end(-9, 4))?.distance).toBe(0);
    // An outlier just below the plot, part of its dot inside.
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 10];
    const outlying = table({ g: values.map(() => "a"), v: values });
    for (const horizontal of [false, true]) {
      const value = { domain: [10.06, 20] as [number, number], nice: false };
      const mark = horizontal
        ? boxplot(outlying, { y: "g", x: "v" })
        : boxplot(outlying, { x: "g", y: "v" });
      const config = { marks: [mark], ...(horizontal ? { x: value } : { y: value }) };
      const found = picked(config, (p, plot) =>
        horizontal
          ? { x: plot.x + 0.25, y: p.y.map(0) }
          : { x: p.x.map(0), y: plot.y + plot.height - 0.25 },
      );
      expect(found?.distance, horizontal ? "across" : "up").toBe(0);
    }
    // A thick rug tick at the plot's left edge: only its right half is drawn.
    const ticks = {
      marks: [rug(table({ v: [0, 1] }), { x: "v", strokeWidth: 20 })],
      x: { domain: [0, 1] as [number, number], nice: false },
    };
    expect(
      picked(ticks, (_, plot) => ({ x: plot.x - 8, y: plot.y + plot.height - 4 })),
    ).toBeUndefined();
    const tick = picked(ticks, (_, plot) => ({ x: plot.x + 2, y: plot.y + plot.height - 4 }));
    expect(tick?.distance).toBe(0);
    expect(tick!.box.width).toBeCloseTo(10);
  });

  it("pick thin candles, stems at the plot's edge, and clipped median dots as painted", () => {
    const picked = (
      config: ChartConfig,
      point: (p: Panel, plot: Rect) => { x: number; y: number },
    ) => {
      const { model, records } = drawn(config);
      const where = point(model.panels()[0]!, records[0]!.frame!.plot);
      return (model.config.marks[0] as Mark).pickItem!(records[0]!, { ...where, slop: 4, lookups });
    };
    // Falling candles just above the plot: bodies a pixel tall down from their tops, and a
    // wide OHLC bar's ticks 2 px wide, reach a fifth of a pixel into it; merged OHLC bars'
    // ticks, a pixel wide, do not. One candle, and 1,000 merged.
    const prices = (n: number) =>
      table({
        t: Array.from({ length: n }, (_, i) => (n === 1 ? 1 : (2 * i) / n)),
        o: Array.from({ length: n }, () => 10.03),
        h: Array.from({ length: n }, () => 10.03),
        l: Array.from({ length: n }, () => 10.029),
        c: Array.from({ length: n }, () => 10.029),
      });
    const axes = {
      x: { domain: [0, 2] as [number, number], nice: false },
      y: { domain: [0, 10] as [number, number], nice: false },
    };
    for (const n of [1, 1000])
      for (const variant of ["candlestick", "ohlc"] as const) {
        const ohlc = { x: "t", open: "o", high: "h", low: "l", close: "c", variant } as const;
        // An OHLC bar's open tick is left of its line.
        const dx = variant === "ohlc" && n === 1 ? -2 : 0;
        const found = picked({ marks: [candlestick(prices(n), ohlc)], ...axes }, (p, plot) => ({
          x: p.x.map(1) + dx,
          y: plot.y + 0.1,
        }));
        if (variant === "ohlc" && n > 1) expect(found, `${n} ${variant}`).toBeUndefined();
        else expect(found?.distance, `${n} ${variant}`).toBe(0);
      }
    // A stem whose stroke only touches the plot's left edge, and one drawn inside it.
    const value = { domain: [0, 10] as [number, number], nice: false };
    const stems = (xs: number[]) =>
      errorbar(table({ t: xs, lo: [2, 2], hi: [8, 8] }), {
        x: "t",
        y1: "lo",
        y2: "hi",
        cap: 0,
        strokeWidth: 1,
      });
    const { records: sized } = drawn({ marks: [stems([5, 5])], x: value, y: value });
    const unit = sized[0]!.frame!.plot.width / 10;
    const edge = picked(
      { marks: [stems([-0.5 / unit, 1.8 / unit])], x: value, y: value },
      (p, plot) => ({
        x: plot.x + 0.1,
        y: p.y.map(5),
      }),
    );
    expect(edge?.distance).toBeCloseTo(1.2);
    // A median dot centered below a log axis: 6 px right of it is beyond its visible part.
    const values = [-10, -5, 0.001, 1, 2];
    const samples = table({ g: values.map(() => "a"), v: values });
    const dot = picked(
      {
        marks: [violin(samples, { x: "g", y: "v", bandwidth: 0.5, inner: "box" })],
        y: { type: "log", domain: [0.0011, 10], nice: false },
      },
      (p, plot) => ({ x: p.x.map(0) + 6, y: plot.y + plot.height - 0.1 }),
    );
    expect(dot).toBeUndefined();
  });

  it("draw and pick candles' wicks on a reversed value axis", () => {
    const prices = (n: number, open: number, close: number) =>
      table({
        t: Array.from({ length: n }, (_, i) => (n === 1 ? 1 : (2 * i) / n)),
        o: Array.from({ length: n }, () => open),
        h: Array.from({ length: n }, () => 9),
        l: Array.from({ length: n }, () => 1),
        c: Array.from({ length: n }, () => close),
      });
    // Falling and rising, one candle and 1,000 merged.
    for (const [open, close] of [
      [6, 4],
      [4, 6],
    ] as const)
      for (const n of [1, 1000])
        for (const variant of ["candlestick", "ohlc"] as const) {
          const ohlc = { x: "t", open: "o", high: "h", low: "l", close: "c", variant } as const;
          const { model, records, scene } = drawn({
            marks: [candlestick(prices(n, open, close), ohlc)],
            x: { domain: [0, 2], nice: false },
            y: { domain: [10, 0], nice: false },
          });
          const p = model.panels()[0]!;
          const name = `${open} to ${close}, ${n} ${variant}`;
          // Drawn from the high, at 9: some stroke reaches its pixel.
          const strokes = scene.panels[0]!.marks.flatMap((g) =>
            g.kind === "segments"
              ? [(g as SegmentGeometry).coords.slice(0, (g as SegmentGeometry).count * 4)]
              : [],
          );
          const reach = strokes.some((coords) =>
            Array.from(coords).some((v, i) => i % 2 === 1 && Math.abs(v - p.y.map(9)) < 0.5),
          );
          expect(reach, name).toBe(true);
          // On the wick, between the high and the body (at 8).
          const at = { x: p.x.map(1), y: p.y.map(8), slop: 4, lookups };
          const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
          expect(found?.distance, name).toBe(0);
        }
  });

  it("pick no contour line of no width", () => {
    const field = table({ x: [0, 1, 0, 1], y: [0, 0, 1, 1], z: [0, 1, 1, 2] });
    for (const strokeWidth of [0, 1]) {
      const { model, records } = drawn({
        marks: [contour(field, { x: "x", y: "y", color: "z", thresholds: [0.8], strokeWidth })],
      });
      const p = model.panels()[0]!;
      // On the diagonal from (0.8, 0) to (0, 0.8).
      const at = { x: p.x.map(0.4), y: p.y.map(0.4), slop: 4, lookups };
      const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
      if (strokeWidth === 0) expect(found).toBeUndefined();
      else expect(found?.distance).toBeCloseTo(0);
    }
  });

  it("pick coincident candles by what is painted last: falling over rising", () => {
    const prices = table({ t: [1, 1], o: [6, 4], h: [9, 9], l: [1, 1], c: [4, 6] });
    for (const variant of ["candlestick", "ohlc"] as const) {
      const ohlc = { x: "t", open: "o", high: "h", low: "l", close: "c", variant } as const;
      const { model, records } = drawn({
        marks: [candlestick(prices, ohlc)],
        x: { domain: [0, 2], nice: false },
        y: { domain: [0, 10], nice: false },
      });
      const p = model.panels()[0]!;
      const at = { x: p.x.map(1), y: p.y.map(8), slop: 4, lookups };
      const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
      expect(found?.part, variant).toMatchObject({ kind: "row", position: 0 });
    }
  });

  it("pick a highlighted violin by the selection's shape drawn over it", () => {
    // Each series 99 zeros and a 10; only series a's 10 selected, its median dot drawn at 10.
    const values = [...Array.from({ length: 99 }, () => 0), 10];
    const both = [...values, ...values];
    const data = table({
      g: both.map(() => "c"),
      s: both.map((_, i) => (i < values.length ? "a" : "b")),
      v: both,
    }) as unknown as Table;
    for (const options of [{}, { series: "s" }, { series: "s", split: true }] as const) {
      const one = Object.keys(options).length === 0;
      const rows = one
        ? (table({ g: values.map(() => "c"), v: values }) as unknown as Table)
        : data;
      const model = new ChartModel({
        marks: [violin(rows, { x: "g", y: "v", bandwidth: 0.2, ...options })],
        locale: "en-US",
      });
      model.setSize(400, 300, 1);
      const store = selectionStore(rows);
      const highlighter = new Highlighter([{ table: rows, store, channel: "focus" }]);
      model.highlight = (m, series, frame, key) =>
        highlighter.geometry(m, series, frame, key) ?? m.geometry(series, frame, key);
      model.layoutHighlight = (t) => highlighter.selected(t);
      store.set("focus", selectRows(new RowSet(rows).add(99)));
      const { records } = sceneOf(model);
      const p = model.panels()[0]!;
      // The selection's median dot, as drawn.
      const dots = records[0]!.geometry
        .filter((g): g is PointGeometry => g.kind === "point")
        .filter((g) => g.count > 0 && Math.abs(g.coords[1]! - p.y.map(10)) < 0.5);
      expect(dots).toHaveLength(1);
      const [dot] = dots;
      const at = { x: dot!.coords[0]! + 6, y: dot!.coords[1]!, slop: 4, lookups };
      const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
      const name = JSON.stringify(options);
      expect(found?.distance, name).toBeCloseTo(6 - dot!.radius);
      expect(found?.part.kind, name).toBe("group");
      // Series a's group, not b's beside it.
      if (!one) expect((found!.part as { key: string }).key, name).toContain('"a"');
    }
  });

  it("pick a highlighted split violin's selected half over the dimmed one on their shared stroke", () => {
    const data = table({
      g: ["c", "c", "c", "c", "c", "c"],
      s: ["a", "a", "a", "b", "b", "b"],
      v: [0, 1, 2, 0, 1, 2],
    }) as unknown as Table;
    for (const horizontal of [false, true]) {
      const options = { series: "s", split: true, inner: "none", bandwidth: 0.5 } as const;
      const mark = horizontal
        ? violin(data, { y: "g", x: "v", ...options })
        : violin(data, { x: "g", y: "v", ...options });
      const model = new ChartModel({ marks: [mark], locale: "en-US" });
      model.setSize(400, 300, 1);
      const store = selectionStore(data);
      const highlighter = new Highlighter([{ table: data, store, channel: "focus" }]);
      model.highlight = (m, series, frame, key) =>
        highlighter.geometry(m, series, frame, key) ?? m.geometry(series, frame, key);
      model.layoutHighlight = (t) => highlighter.selected(t);
      // All of series a selected: its half is painted over b's, the center stroke shared.
      store.set("focus", selectRows(new RowSet(data).add(0).add(1).add(2)));
      const { records } = sceneOf(model);
      const p = model.panels()[0]!;
      const at = horizontal
        ? { x: p.x.map(1), y: p.y.map(0), slop: 4, lookups }
        : { x: p.x.map(0), y: p.y.map(1), slop: 4, lookups };
      const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
      expect(found?.distance).toBe(0);
      expect((found!.part as { key: string }).key, horizontal ? "across" : "up").toContain('"a"');
    }
  });

  it("pick no stroke the clip keeps only an edge of, before a stroke it shows", () => {
    const xs = [0, 1, 2, 0, 1, 2, 0, 1, 2];
    const ys = [0, 0, 0, 1, 1, 1, 2, 2, 2];
    const field = table({ x: xs, y: ys, z: ys });
    const y = { domain: [0.5, 2] as [number, number], nice: false };
    const lines = (thresholds: number[]) => ({
      marks: [contour(field, { x: "x", y: "y", color: "z", thresholds, strokeWidth: 20 })],
      y,
    });
    const { records: sized } = drawn(lines([1]));
    const plot = sized[0]!.frame!.plot;
    const unit = plot.height / 1.5;
    // One stroke 10 px below the plot, touching its bottom; one 13 px above it.
    const { model, records } = drawn(lines([0.5 - 10 / unit, 0.5 + 13 / unit]));
    const p = model.panels()[0]!;
    const at = { x: p.x.map(1), y: plot.y + plot.height - 1, slop: 4, lookups };
    const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
    expect(found?.distance).toBeCloseTo(2);
  });

  it("pick no band the clip keeps only a point or an edge of", () => {
    const xs = [0, 1, 2, 0, 1, 2, 0, 1, 2];
    const ys = [0, 0, 0, 1, 1, 1, 2, 2, 2];
    const pick = (
      z: number[],
      axes: object,
      point: (plot: Rect) => { x: number; y: number },
      fillOpacity = 0.5,
    ) => {
      const field = table({ x: xs, y: ys, z });
      // Translucent bands, drawn without an outline, unless opaque.
      const bands = { thresholds: [0, 1], variant: "bands", fillOpacity } as const;
      const { model, records } = drawn({
        marks: [contour(field, { x: "x", y: "y", color: "z", ...bands })],
        ...axes,
      });
      const at = { ...point(records[0]!.frame!.plot), slop: 4, lookups };
      return (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
    };
    const window = { domain: [0.5, 1.5] as [number, number], nice: false };
    // A triangle below x + y = 1, meeting the plot at its bottom-left corner.
    const sum = xs.map((x, i) => x + ys[i]!);
    const corner = (plot: Rect) => ({ x: plot.x + 1, y: plot.y + plot.height - 1 });
    expect(pick(sum, { x: window, y: window }, corner)).toBeUndefined();
    // A band left of x = 1, meeting the plot along its left side.
    const side = { x: { domain: [1, 2] as [number, number], nice: false } };
    const middle = (dx: number) => (plot: Rect) => ({
      x: plot.x + dx,
      y: plot.y + plot.height / 2,
    });
    expect(pick(xs, side, middle(1))).toBeUndefined();
    expect(pick(xs, side, middle(-2))).toBeUndefined();
    // Opaque, its outline paints a quarter pixel into the plot along that side.
    expect(pick(xs, side, middle(1), 1)?.distance).toBeCloseTo(0.75);
    // Drawn a few pixels into the plot, it is found there and beside it.
    const into = { x: { domain: [0.99, 2] as [number, number], nice: false } };
    expect(pick(xs, into, middle(1))?.distance).toBe(0);
    expect(pick(xs, into, middle(6))).toBeDefined();
  });

  it("pick only contour lines geometry draws, and bands thinner than a pixel", () => {
    // Lines at 48, which geometry leaves out of the view from 50, and at 60.
    const xs: number[] = [];
    const ys: number[] = [];
    for (let j = 0; j <= 100; j++)
      for (let i = 0; i <= 2; i++) {
        xs.push(i);
        ys.push(j);
      }
    const tall = table({ x: xs, y: ys, z: ys });
    for (const thresholds of [[48], [48, 60]]) {
      const { model, records } = drawn({
        marks: [contour(tall, { x: "x", y: "y", color: "z", thresholds, strokeWidth: 30 })],
        y: { domain: [50, 100], nice: false },
      });
      const p = model.panels()[0]!;
      const plot = records[0]!.frame!.plot;
      const mark = model.config.marks[0] as Mark;
      const pick = (y: number) =>
        mark.pickItem!(records[0]!, { x: p.x.map(1), y, slop: 4, lookups });
      expect(records[0]!.geometry.length).toBe(thresholds.length - 1);
      expect(pick(plot.y + plot.height - 1), `${thresholds}`).toBeUndefined();
      if (thresholds.length > 1) expect(pick(p.y.map(60))?.distance).toBe(0);
    }
    // A band from 1 to 1.001 over a value axis from 1: a quarter pixel tall at its bottom.
    const small = table({ x: xs.slice(0, 9), y: ys.slice(0, 9), z: ys.slice(0, 9) });
    const { model, records } = drawn({
      marks: [
        contour(small, { x: "x", y: "y", color: "z", thresholds: [1, 1.001], variant: "bands" }),
      ],
      y: { domain: [1, 2], nice: false },
    });
    const p = model.panels()[0]!;
    const plot = records[0]!.frame!.plot;
    const mark = model.config.marks[0] as Mark;
    const below = (by: number) =>
      mark.pickItem!(records[0]!, {
        x: p.x.map(1),
        y: plot.y + plot.height + by,
        slop: 4,
        lookups,
      });
    expect(below(3.5)?.distance).toBeCloseTo(3.5);
    expect(below(3.9)?.distance).toBeCloseTo(3.9);
    expect(below(4.5)).toBeUndefined();
    // A band below the view, in the chart's margin where its clip would show it: not drawn.
    for (const clip of [false, "chart"] as const) {
      const { model, records } = drawn({
        marks: [
          contour(tall, {
            x: "x",
            y: "y",
            color: "z",
            thresholds: [45, 46],
            variant: "bands",
            clip,
          }),
        ],
        y: { domain: [50, 100], nice: false },
      });
      const p = model.panels()[0]!;
      expect(records[0]!.geometry).toHaveLength(0);
      const at = { x: p.x.map(1), y: p.y.map(45.5), slop: 4, lookups };
      expect((model.config.marks[0] as Mark).pickItem!(records[0]!, at), `${clip}`).toBeUndefined();
    }
  });

  it("pick candles narrower than their wicks by the wicks as painted", () => {
    // Candles a third of a pixel wide; their wicks a pixel wide.
    const prices = table({
      t: [0, 0.001, 1],
      o: [6, 6, 6],
      h: [9, 9, 9],
      l: [1, 1, 1],
      c: [4, 4, 4],
    });
    // A hollow body's sides reach half a stroke past it.
    const rising = table({
      t: [0, 0.001, 1],
      o: [4, 4, 4],
      h: [9, 9, 9],
      l: [1, 1, 1],
      c: [6, 6, 6],
    });
    {
      const ohlc = { x: "t", open: "o", high: "h", low: "l", close: "c" } as const;
      const { model, records } = drawn({
        marks: [candlestick(rising, ohlc)],
        x: { domain: [0, 1], nice: false },
        y: { domain: [0, 10], nice: false },
      });
      const p = model.panels()[0]!;
      const mark = model.config.marks[0] as Mark;
      const strokes = records[0]!.geometry.find((g) => g.kind === "segments") as SegmentGeometry;
      // The right side of the bodies at 0 and 0.001, as drawn, and its stroke's edge.
      const xs = Array.from(strokes.coords.slice(0, strokes.count * 4)).filter(
        (_, i) => i % 2 === 0,
      );
      const edge = Math.max(...xs.filter((x) => x < p.x.map(0.5))) + 0.5;
      const pick = (dx: number) =>
        mark.pickItem!(records[0]!, { x: edge + dx, y: p.y.map(5), slop: 4, lookups });
      expect(pick(3.9)?.distance).toBeCloseTo(3.9);
      expect(pick(4.1)).toBeUndefined();
    }
    for (const variant of ["candlestick", "ohlc"] as const) {
      const ohlc = { x: "t", open: "o", high: "h", low: "l", close: "c", variant } as const;
      const { model, records } = drawn({
        marks: [candlestick(prices, ohlc)],
        x: { domain: [0, 1], nice: false },
        y: { domain: [0, 10], nice: false },
      });
      const p = model.panels()[0]!;
      const mark = model.config.marks[0] as Mark;
      const pick = (dx: number, slop: number) =>
        mark.pickItem!(records[0]!, { x: p.x.map(0.001) + dx, y: p.y.map(8), slop, lookups });
      const inside = pick(0.45, 0);
      expect(inside?.distance, variant).toBe(0);
      // Bounded on the right by the wick's painted edge (on the left, by the plot).
      expect(inside!.box.x + inside!.box.width).toBeCloseTo(p.x.map(0.001) + 0.5);
      expect(pick(0.5 + 3.9, 4)?.distance, variant).toBeCloseTo(3.9);
    }
  });

  it("pick highlighted box plots and boxen by the selection's statistics drawn over them", () => {
    const values = [...Array.from({ length: 99 }, () => 0), 10];
    const data = table({ g: values.map(() => "c"), v: values }) as unknown as Table;
    for (const make of [boxplot, boxen] as const)
      for (const horizontal of [false, true]) {
        const options = { outliers: false } as const;
        const mark = horizontal
          ? make(data, { y: "g", x: "v", ...options })
          : make(data, { x: "g", y: "v", ...options });
        // A value axis showing 10, which the whole's statistics do not reach.
        const value = { domain: [-1, 12] as [number, number], nice: false };
        const model = new ChartModel({
          marks: [mark],
          locale: "en-US",
          ...(horizontal ? { x: value } : { y: value }),
        });
        model.setSize(400, 300, 1);
        const store = selectionStore(data);
        const highlighter = new Highlighter([{ table: data, store, channel: "focus" }]);
        model.highlight = (m, series, frame, key) =>
          highlighter.geometry(m, series, frame, key) ?? m.geometry(series, frame, key);
        model.layoutHighlight = (t) => highlighter.selected(t);
        // Only the 10 selected: its statistics are drawn at 10, far from the whole's at 0.
        store.set("focus", selectRows(new RowSet(data).add(99)));
        const { records } = sceneOf(model);
        const p = model.panels()[0]!;
        const at = horizontal
          ? { x: p.x.map(10), y: p.y.map(0), slop: 4, lookups }
          : { x: p.x.map(0), y: p.y.map(10), slop: 4, lookups };
        const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
        const name = `${mark.spec.type} ${horizontal ? "across" : "up"}`;
        expect(found?.distance, name).toBe(0);
        const { box } = found!;
        // Bounded by the whole and the selection's statistics drawn over it.
        expect(at.x >= box.x && at.x <= box.x + box.width, name).toBe(true);
        expect(at.y >= box.y && at.y <= box.y + box.height, name).toBe(true);
        // Beside the selection's statistics, drawn narrower than the whole's.
        const reach = Math.max(
          ...records[0]!.geometry
            .filter((g): g is SegmentGeometry => g.kind === "segments")
            .flatMap((g) => {
              const c = Array.from(g.coords.slice(0, g.count * 4));
              const across = c.filter((_, i) => i % 2 === (horizontal ? 0 : 1));
              const along = c.filter((_, i) => i % 2 === (horizontal ? 1 : 0));
              const atTen = horizontal ? p.x.map(10) : p.y.map(10);
              return along.filter((_, i) => Math.abs(across[i]! - atTen) < 1);
            }),
        );
        const beside = horizontal
          ? { x: p.x.map(10), y: reach + 10, slop: 4, lookups }
          : { x: reach + 10, y: p.y.map(10), slop: 4, lookups };
        expect(
          (model.config.marks[0] as Mark).pickItem!(records[0]!, beside),
          name,
        ).toBeUndefined();
      }
  });

  it("pick outlier dots wider than their box plots' and boxen's narrow slots", () => {
    // 1,000 groups of one 0, but group 500's nine zeros and an outlying 10.
    const groups = Array.from({ length: 1000 }, (_, i) => `c${i}`);
    const g = [...groups, ...Array.from({ length: 9 }, () => "c500")];
    const v = [
      ...groups.map((_, i) => (i === 500 ? 10 : 0)),
      ...Array.from({ length: 9 }, () => 0),
    ];
    const data = table({ g, v }) as unknown as Table;
    for (const make of [boxplot, boxen] as const)
      for (const horizontal of [false, true])
        for (const highlighted of [false, true]) {
          const mark = horizontal ? make(data, { y: "g", x: "v" }) : make(data, { x: "g", y: "v" });
          const value = { domain: [-1, 12] as [number, number], nice: false };
          const model = new ChartModel({
            marks: [mark],
            locale: "en-US",
            ...(horizontal ? { x: value } : { y: value }),
          });
          model.setSize(400, 300, 1);
          if (highlighted) {
            // Group 500's rows selected: its statistics drawn over it, narrower.
            const store = selectionStore(data);
            const highlighter = new Highlighter([{ table: data, store, channel: "focus" }]);
            model.highlight = (m, series, frame, key) =>
              highlighter.geometry(m, series, frame, key) ?? m.geometry(series, frame, key);
            model.layoutHighlight = (t) => highlighter.selected(t);
            const rows = new RowSet(data).add(500);
            for (let row = 1000; row < 1009; row++) rows.add(row);
            store.set("focus", selectRows(rows));
          }
          const { records } = sceneOf(model);
          const p = model.panels()[0]!;
          const pick = (beside: number, slop: number) =>
            (model.config.marks[0] as Mark).pickItem!(
              records[0]!,
              horizontal
                ? { x: p.x.map(10), y: p.y.map(500) + beside, slop, lookups }
                : { x: p.x.map(500) + beside, y: p.y.map(10), slop, lookups },
            );
          const name = `${mark.spec.type} ${horizontal ? "across" : "up"}${highlighted ? " lit" : ""}`;
          // Inside the dot, 2.5 px in radius, and 3.5 px past its edge.
          expect(pick(2, 0)?.distance, name).toBe(0);
          expect(pick(-6, 4)?.distance, name).toBeCloseTo(3.5);
          expect(pick(-6, 3), name).toBeUndefined();
        }
  });

  it("bound narrow violins by their inner boxes, wider than their slots", () => {
    // 1,000 groups of three 10s, but group 500's 0, 1, and 2.
    const groups = Array.from({ length: 1000 }, (_, i) => `c${i}`);
    const g = groups.flatMap((name) => [name, name, name]);
    const v = groups.flatMap((_, i) => (i === 500 ? [0, 1, 2] : [10, 10, 10]));
    const data = table({ g, v }) as unknown as Table;
    for (const horizontal of [false, true]) {
      const options = { bandwidth: 0.5 } as const;
      const mark = horizontal
        ? violin(data, { y: "g", x: "v", ...options })
        : violin(data, { x: "g", y: "v", ...options });
      const { model, records } = drawn({ marks: [mark] });
      const p = model.panels()[0]!;
      // Inside the inner box, 3 px wide, 1.4 px off the center of a slot 0.4 px wide.
      const at = horizontal
        ? { x: p.x.map(0.75), y: p.y.map(500) + 1.4, slop: 0, lookups }
        : { x: p.x.map(500) + 1.4, y: p.y.map(0.75), slop: 0, lookups };
      const found = (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
      const name = horizontal ? "across" : "up";
      expect(found?.distance, name).toBe(0);
      const { box } = found!;
      expect(at.x >= box.x && at.x <= box.x + box.width, name).toBe(true);
      expect(at.y >= box.y && at.y <= box.y + box.height, name).toBe(true);
    }
  });

  it("pick a band's hole by the band around it", () => {
    const z: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    for (let j = 0; j < 21; j++)
      for (let i = 0; i < 21; i++) {
        const [u, v] = [i / 10 - 1, j / 10 - 1];
        xs.push(u);
        ys.push(v);
        z.push(10 * (1 - Math.min(1, Math.hypot(u, v))));
      }
    const cone = table({ x: xs, y: ys, z });
    // A ring from 2 to 7.5, whose hole about the center ends at radius 0.25 on the x axis.
    const ring = { x: "x", y: "y", color: "z", thresholds: [2, 7.5], variant: "bands" } as const;
    const { model, records } = drawn({ marks: [contour(cone, ring)] });
    const p = model.panels()[0]!;
    const mark = model.config.marks[0] as Mark;
    const pick = (x: number) => mark.pickItem!(records[0]!, { x, y: p.y.map(0), slop: 4, lookups });
    const edge = p.x.map(0.25);
    expect(pick(p.x.map(0))).toBeUndefined();
    // Two pixels inside the hole (a little less to the ring's traced corners), the ring outside it.
    const near = pick(edge - 2);
    expect(near?.distance).toBeGreaterThan(1.5);
    expect(near!.distance).toBeLessThanOrEqual(2);
    expect(near!.part).toEqual(pick(edge + 2)!.part);
  });

  it("pick nothing clipping takes away: merged candles, distributions, contour lines", () => {
    const underneath = (marks: ChartMark[], axes: object, horizontal = false) => {
      const { model, records } = drawn({ marks, ...axes });
      const plot = records[0]!.frame!.plot;
      const p = model.panels()[0]!;
      // One pixel inside the plot, beside the clipped shapes.
      const at = horizontal
        ? { x: plot.x + 1, y: p.y.map(0), slop: 4, lookups }
        : { x: p.x.map(0), y: plot.y + plot.height - 1, slop: 4, lookups };
      return (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
    };
    const n = 1000;
    const below = (value: number) => Array.from({ length: n }, () => value);
    const prices = table({
      t: Array.from({ length: n }, (_, i) => i),
      o: below(-0.05),
      h: below(-0.04),
      l: below(-0.06),
      c: below(-0.05),
    });
    const ohlc = { x: "t", open: "o", high: "h", low: "l", close: "c" } as const;
    expect(
      underneath([candlestick(prices, ohlc)], { y: { domain: [0, 10], nice: false } }),
    ).toBeUndefined();
    const samples = table({ g: ["a", "a", "a"], v: [-0.05, -0.05, -0.05] });
    for (const make of [boxplot, violin] as const) {
      const vertical = make(samples, { x: "g", y: "v" });
      expect(underneath([vertical], { y: { domain: [0, 10], nice: false } })).toBeUndefined();
      const horizontal = make(samples, { y: "g", x: "v" });
      expect(
        underneath([horizontal], { x: { domain: [0, 10], nice: false } }, true),
      ).toBeUndefined();
    }
    const field = table({ x: [0, 1, 0, 1, 0, 1], y: [0, 0, 1, 1, 2, 2], z: [0, 0, 1, 1, 2, 2] });
    const lines = contour(field, { x: "x", y: "y", color: "z", thresholds: [1] });
    expect(
      underneath([lines], {
        x: { domain: [0, 1], nice: false },
        y: { domain: [1.01, 2], nice: false },
      }),
    ).toBeUndefined();
  });

  it("pick only the parts of cells drawn in the plot", () => {
    const axes = {
      x: { domain: [0.51, 2] as [number, number], nice: false },
      y: { domain: [-1, 2] as [number, number], nice: false },
    };
    const points = table({ x: [0, 1], y: [0, 1], v: [1, 2] });
    const bins = { x: [-0.5, 0.5, 1.5], y: [-0.5, 0.5, 1.5] };
    for (const clip of [undefined, false, "chart"] as const)
      for (const mark of [
        heatmap(points, { x: "x", y: "y", color: "v", ...(clip !== undefined && { clip }) }),
        histogram(points, { x: "x", y: "y", bins, ...(clip !== undefined && { clip }) }),
      ]) {
        const { model, records } = drawn({ marks: [mark], ...axes });
        const p = model.panels()[0]!;
        const plot = records[0]!.frame!.plot;
        const picker = model.config.marks[0] as Mark;
        // The cell at (0, 0) ends left of the plot, where its image does too
        // whatever the clip; the one at (1, 1) is drawn.
        expect(
          picker.pickItem!(records[0]!, { x: plot.x + 1, y: p.y.map(0), slop: 4, lookups }),
        ).toBeUndefined();
        expect(
          picker.pickItem!(records[0]!, { x: p.x.map(0.49), y: p.y.map(0), slop: 4, lookups }),
        ).toBeUndefined();
        const drawnCell = picker.pickItem!(records[0]!, {
          x: p.x.map(1),
          y: p.y.map(1),
          slop: 4,
          lookups,
        });
        expect(drawnCell?.distance).toBe(0);
        // Cut to the plot, or painted whole past it where the clip lets it be.
        const left = clip === undefined ? plot.x : p.x.map(0.5);
        expect(drawnCell!.box.x).toBeCloseTo(left);
      }
  });

  it("pick heatmap and 2D histogram cells within the query's reach of their edges", () => {
    const one = table({ x: [1], y: [1], v: [1] });
    const axes = {
      x: { domain: [0, 3] as [number, number], nice: false },
      y: { domain: [0, 3] as [number, number], nice: false },
    };
    const cells = drawn({ marks: [heatmap(one, { x: "x", y: "y", color: "v" })], ...axes });
    const p = cells.model.panels()[0]!;
    const mark = cells.model.config.marks[0] as Mark;
    const box = mark.pickItem!(cells.records[0]!, {
      x: p.x.map(1),
      y: p.y.map(1),
      slop: 4,
      lookups,
    })!.box;
    const right = box.x + box.width;
    const at = (x: number, y: number, slop = 4) =>
      mark.pickItem!(cells.records[0]!, { x, y, slop, lookups })?.distance;
    expect(at(right + 2, p.y.map(1))).toBeCloseTo(2);
    expect(at(right + 2, box.y - 2)).toBeCloseTo(Math.hypot(2, 2));
    expect(at(right + 2, p.y.map(1), 1)).toBeUndefined();
    expect(at(right + 6, p.y.map(1))).toBeUndefined();
    // As far as the query reaches, on either side, edges included.
    expect(at(right + 4, p.y.map(1))).toBeCloseTo(4);
    expect(at(box.x - 4, p.y.map(1))).toBeCloseTo(4);
    // On a reversed axis too.
    const reversed = drawn({
      marks: [heatmap(one, { x: "x", y: "y", color: "v" })],
      ...axes,
      x: { domain: [3, 0] as [number, number], nice: false },
    });
    const r = reversed.model.panels()[0]!;
    const flipped = reversed.model.config.marks[0] as Mark;
    const cell = flipped.pickItem!(reversed.records[0]!, {
      x: r.x.map(1),
      y: r.y.map(1),
      slop: 4,
      lookups,
    })!.box;
    for (const x of [cell.x - 4, cell.x + cell.width + 4])
      expect(
        flipped.pickItem!(reversed.records[0]!, { x, y: r.y.map(1), slop: 4, lookups })?.distance,
      ).toBeCloseTo(4);
    // Two bins with a gap between: the nearer.
    const points = table({ x: [0.1, 0.2, 2.8, 2.9], y: [0.1, 0.2, 2.8, 2.9] });
    const bins = drawn({
      marks: [histogram(points, { x: "x", y: "y", bins: { x: [0, 1, 2, 3], y: [0, 1, 2, 3] } })],
      ...axes,
    });
    const q = bins.model.panels()[0]!;
    const binned = bins.model.config.marks[0] as Mark;
    const found = binned.pickItem!(bins.records[0]!, {
      x: q.x.map(1) + 2,
      y: q.y.map(0.5),
      slop: 4,
      lookups,
    });
    expect(found?.distance).toBeCloseTo(2);
    expect(found?.names).toEqual([
      [0, 1],
      [0, 1],
    ]);
    expect(
      binned.pickItem!(bins.records[0]!, { x: q.x.map(1.5), y: q.y.map(0.5), slop: 4, lookups }),
    ).toBeUndefined();
  });

  it("pick the violin nearest as drawn among those within reach", () => {
    const values = [
      ...Array.from({ length: 50 }, () => -5),
      ...Array.from({ length: 50 }, () => 5),
      ...Array.from({ length: 100 }, (_, i) => (i - 49.5) / 50),
    ];
    const samples = table({ g: values.map((_, i) => (i < 100 ? "A" : "B")), v: values });
    const { model, records } = drawn(
      { marks: [violin(samples, { x: "g", y: "v", bandwidth: 0.2, inner: "none" })] },
      96,
      300,
    );
    const p = model.panels()[0]!;
    const mark = model.config.marks[0] as Mark;
    // Between the two at 0: A narrows to nothing there, B is widest.
    const at = { x: (p.x.map(0) + p.x.map(1)) / 2, y: p.y.map(0), slop: 4, lookups };
    const found = mark.pickItem!(records[0]!, at)!;
    expect(found.names).toEqual(["B"]);
    expect(found.distance).toBeLessThan(4);
  });

  it("bound heatmap cells after an axis break where they are drawn", () => {
    const cells = table({ t: time([1, 4, 6]), y: ["a", "a", "a"], v: [1, 2, 3] });
    const { model, records } = drawn({
      marks: [heatmap(cells, { x: "t", y: "y", color: "v" })],
      x: { breaks: timeBreaks([{ from: 2, to: 3 }]), domain: [0, 8], nice: false },
    });
    const p = model.panels()[0]!;
    const mark = model.config.marks[0] as Mark;
    const found = mark.pickItem!(records[0]!, { x: p.x.map(6), y: p.y.map(0), slop: 4, lookups })!;
    // The cell at 6 spans 5 to 7, halfway to its neighbors.
    expect(found.box.x).toBeCloseTo(p.x.map(5));
    expect(found.box.x + found.box.width).toBeCloseTo(p.x.map(7));
  });

  it("pick violins by the vertices and inner marks they draw below the density's first positive sample", () => {
    const samples = table({ g: ["a", "a", "a", "a", "a"], v: [-10, -5, 0.001, 1, 2] });
    const draw = (inner: "box" | "quartiles") => {
      const { records, model } = drawn({
        marks: [violin(samples, { x: "g", y: "v", bandwidth: 0.5, inner })],
        y: { type: "log", domain: [0.0001, 10] },
      });
      const record = records[0]!;
      const at = (key: string) => {
        const g = record.geometry.find((g) => g.key.endsWith(key))!;
        return g.kind === "point" ? (g as PointGeometry).coords : (g as LineGeometry).path.coords;
      };
      const pick = (x: number, y: number) =>
        (model.config.marks[0] as Mark).pickItem!(record, { x, y, slop: 4, lookups });
      return { at, pick };
    };
    // The median dot, which no box or whisker around it is drawable to reach.
    const boxed = draw("box");
    const [dx, dy] = boxed.at("|median");
    expect(boxed.pick(dx!, dy!)?.distance).toBe(0);
    // The median line, which the outline reaches down to.
    const lined = draw("quartiles");
    const [x0, y0, x1] = lined.at("|median-line");
    expect(lined.pick((x0! + x1!) / 2, y0!)?.distance).toBe(0);
    expect(lined.pick(x1!, y0!)?.distance).toBe(0);
  });

  it("pick split violins' inner boxes where they are drawn", () => {
    const values = [
      ...Array.from({ length: 50 }, () => 0),
      ...Array.from({ length: 50 }, () => 10),
    ];
    const samples = table({
      g: values.map(() => "a"),
      s: values.map((_, i) => (i % 2 ? "l" : "r")),
      v: values,
    });
    for (const horizontal of [false, true]) {
      const spec = horizontal
        ? ({ y: "g", x: "v", series: "s", split: true, bandwidth: 0.2 } as const)
        : ({ x: "g", y: "v", series: "s", split: true, bandwidth: 0.2 } as const);
      const { records, model } = drawn({ marks: [violin(samples, spec)] });
      const mark = model.config.marks[0] as Mark;
      const record = records[0]!;
      // The middle of each drawn inner box, between the two densities' bulges.
      const rects = record.geometry.filter((g): g is RectGeometry => g.kind === "rect");
      expect(rects.length, `${horizontal}`).toBeGreaterThan(0);
      for (const { rects: boxes, count } of rects)
        for (let k = 0; k < count; k++) {
          const [x, y, w, h] = boxes.subarray(k * 4, k * 4 + 4);
          const at = { x: x! + w! / 2, y: y! + h! / 2, slop: 4, lookups };
          expect(mark.pickItem!(record, at)?.distance, `${horizontal} ${k}`).toBe(0);
        }
    }
  });

  it("reach past painted strokes, as far as the query reaches", () => {
    const pickAt = (mark: ChartMark, x: number, y: number, dx: number, slop: number) => {
      const { model, records } = drawn({ marks: [mark] });
      const p = model.panels()[0]!;
      const at = { x: p.x.map(x) + dx, y: p.y.map(y), slop, lookups };
      return (model.config.marks[0] as Mark).pickItem!(records[0]!, at);
    };
    // 8 px from the middles of 20 px strokes, inside the plot: on them.
    const ranges = table({ t: [1, 2], lo: [1, 2], hi: [3, 4] });
    const bars = errorbar(ranges, { x: "t", y1: "lo", y2: "hi", strokeWidth: 20 });
    expect(pickAt(bars, 2, 3, -8, 4)?.distance).toBe(0);
    // A rug's ticks stand on the plot's bottom edge.
    const ticks = table({ v: [1, 2, 3] });
    const rugs = drawn({ marks: [rug(ticks, { x: "v", strokeWidth: 20 })] });
    const plot = rugs.records[0]!.frame!.plot;
    const tick = {
      x: rugs.model.panels()[0]!.x.map(2) + 8,
      y: plot.y + plot.height - 3,
      slop: 4,
      lookups,
    };
    expect((rugs.model.config.marks[0] as Mark).pickItem!(rugs.records[0]!, tick)?.distance).toBe(
      0,
    );
    // A contour line 7 px away, within a touch's reach.
    const z: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    for (let j = 0; j < 21; j++)
      for (let i = 0; i < 21; i++) {
        const [u, v] = [i / 10 - 1, j / 10 - 1];
        xs.push(u);
        ys.push(v);
        z.push(10 * (1 - Math.min(1, Math.hypot(u, v))));
      }
    const cone = table({ x: xs, y: ys, z });
    const level = contour(cone, { x: "x", y: "y", color: "z", thresholds: [5] });
    const touched = pickAt(level, 0.5, 0, 7, 8);
    expect(touched?.distance).toBeGreaterThan(0);
    expect(touched?.distance).toBeLessThanOrEqual(8);
    expect(pickAt(level, 0.5, 0, 7, 2)).toBeUndefined();
  });

  it("pick candles merged per pixel column as drawn", () => {
    // 1,000 candles over a plot of a few hundred columns, alternating between two ranges.
    const n = 1000;
    const t = Array.from({ length: n }, (_, i) => i);
    const low = t.map((i) => (i % 2 ? 2 : 8));
    const prices = table({
      t,
      o: low.map((l) => l + 0.2),
      h: low.map((l) => l + 1),
      l: low,
      c: low.map((l) => l + 0.8),
    });
    const { records, model } = drawn({
      marks: [candlestick(prices, { x: "t", open: "o", high: "h", low: "l", close: "c" })],
    });
    const mark = model.config.marks[0] as Mark;
    const p = model.panels()[0]!;
    const plot = records[0]!.frame!.plot;
    // The middle of a merged candle: between the two ranges, inside what is drawn.
    const at = { x: plot.x + 100.5, y: p.y.map(5.5), slop: 4, lookups };
    const picked = mark.pickItem!(records[0]!, at);
    expect(picked?.part.kind).toBe("row");
    expect(picked?.distance).toBe(0);
    expect(picked!.box.y).toBeCloseTo(p.y.map(9));
    expect(picked!.box.y + picked!.box.height).toBeCloseTo(p.y.map(2));
    // Its pixel column, and the strokes of a hollow body's sides half a pixel past it.
    expect(picked!.box.width).toBeLessThanOrEqual(2);
  });

  it("pick the merged candle painted over a rising column's hollow body beside it", () => {
    // Rising candles but for rows 140 to 142, falling: filled bodies painted after hollow ones.
    const n = 1000;
    const t = Array.from({ length: n }, (_, i) => i);
    const falls = (i: number) => i >= 140 && i <= 142;
    const prices = table({
      t,
      o: t.map((i) => (falls(i) ? 3 : 2)),
      h: t.map(() => 4),
      l: t.map(() => 1),
      c: t.map((i) => (falls(i) ? 2 : 3)),
    });
    const { records, model } = drawn({
      marks: [candlestick(prices, { x: "t", open: "o", high: "h", low: "l", close: "c" })],
      x: { domain: [0, 999], nice: false },
      y: { domain: [0, 5], nice: false },
    });
    const p = model.panels()[0]!;
    const plot = records[0]!.frame!.plot;
    const picked = (model.config.marks[0] as Mark).pickItem!(records[0]!, {
      x: plot.x + 51.2,
      y: p.y.map(2.5),
      slop: 0,
      lookups,
    });
    expect(picked?.distance).toBe(0);
    const part = picked!.part;
    expect(part.kind === "row" && falls(part.position)).toBe(true);
  });

  it("pick what is painted on top of what lies under it, and ticks to their square ends", () => {
    const top = (mark: ChartMark, x: number, y: number) => {
      const { model, records } = drawn({ marks: [mark] });
      const p = model.panels()[0]!;
      const plot = records[0]!.frame!.plot;
      const at = {
        x: p.x.map(x),
        y: Number.isNaN(y) ? plot.y + plot.height - 2 : p.y.map(y),
        slop: 4,
        lookups,
      };
      const part = (model.config.marks[0] as Mark).pickItem!(records[0]!, at)?.part;
      return part?.kind === "row" ? [part.series?.series.key, part.position] : undefined;
    };
    // Coincident rows of two series, then of one: the later ones paint on top.
    const twice = table({ v: [2, 2], lo: [1, 1], hi: [3, 3], g: ["a", "b"], t: [1, 1] });
    expect(top(rug(twice, { x: "v", series: "g" }), 2, Number.NaN)?.[0]).toContain('"b"');
    expect(top(errorbar(twice, { x: "t", y1: "lo", y2: "hi", series: "g" }), 1, 2)?.[0]).toContain(
      '"b"',
    );
    const same = table({ v: [2, 2], t: [1, 1], lo: [1, 1], hi: [3, 3] });
    expect(top(rug(same, { x: "v" }), 2, Number.NaN)?.[1]).toBe(1);
    expect(top(errorbar(same, { x: "t", y1: "lo", y2: "hi" }), 1, 2)?.[1]).toBe(1);
    // A tick 8 px long and 20 wide ends square: nothing 8 px past its end.
    const ticks = table({ v: [1, 2, 3] });
    const { model, records } = drawn({ marks: [rug(ticks, { x: "v", strokeWidth: 20 })] });
    const plot = records[0]!.frame!.plot;
    const x = model.panels()[0]!.x.map(2);
    const inner = plot.y + plot.height - 8;
    const mark = model.config.marks[0] as Mark;
    expect(mark.pickItem!(records[0]!, { x, y: inner - 8, slop: 4, lookups })).toBeUndefined();
    expect(
      mark.pickItem!(records[0]!, { x, y: inner - 3, slop: 4, lookups })?.distance,
    ).toBeCloseTo(3);
    expect(
      mark.pickItem!(records[0]!, { x: x + 12, y: inner - 3, slop: 4, lookups })?.distance,
    ).toBeCloseTo(Math.hypot(2, 3));
  });

  it("pick nothing of series the legend hid", () => {
    const prices = table({ t: [1, 2], o: [1, 2], h: [3, 4], l: [0, 1], c: [2, 3] });
    const ranges = table({ t: [1, 2], lo: [1, 2], hi: [3, 4] });
    for (const mark of [
      candlestick(prices, { x: "t", open: "o", high: "h", low: "l", close: "c" }),
      errorbar(ranges, { x: "t", y1: "lo", y2: "hi" }),
    ]) {
      const model = new ChartModel({ marks: [mark], locale: "en-US" });
      model.setSize(400, 300, 1);
      for (const s of model.series()) model.hidden.add(s.key);
      model.scene(estimateText);
      const p = model.panels()[0]!;
      const record = model.drawnMarks()[0]!;
      const at = { x: p.x.map(2), y: p.y.map(3), slop: 4, lookups };
      expect((mark as unknown as Mark).pickItem!(record, at)).toBeUndefined();
    }
  });

  it("pick a violin by its silhouette, not the box its values span", () => {
    // 99 values near zero and one at 10: a long narrow tail above a wide base.
    const values = [...Array.from({ length: 99 }, (_, i) => (i % 10) / 50), 10];
    const samples = table({ g: values.map(() => "a"), v: values });
    const { records, model } = drawn({
      marks: [violin(samples, { x: "g", y: "v", bandwidth: 0.2, inner: "none", id: "v" })],
    });
    const mark = model.config.marks[0] as Mark;
    const p = model.panels()[0]!;
    const center = p.x.map(0);
    const base = mark.pickItem!(records[0]!, { x: center + 5, y: p.y.map(0.1), slop: 4, lookups });
    expect(base?.part).toMatchObject({ kind: "group", key: '["v","a"]' });
    // Beside the tail, inside the span of its values and the violin's width.
    const beside = { x: center + 40, y: p.y.map(6), slop: 4, lookups };
    expect(mark.pick!(records[0]!.series, beside.x, beside.y, records[0]!.frame!)?.distance).toBe(
      0,
    );
    expect(mark.pickItem!(records[0]!, beside)).toBeUndefined();
    // Beside a sloping stretch of the outline, measured square to it.
    const outline = records[0]!.geometry.find(
      (g): g is LineGeometry => g.kind === "line" && (g as LineGeometry).path.count > 3,
    )!.path;
    const point = (i: number) => [outline.coords[i * 2]!, outline.coords[i * 2 + 1]!] as const;
    let i = 0;
    for (; i < outline.count - 1; i++) {
      const [[x0, y0], [x1, y1]] = [point(i), point(i + 1)];
      if (x0 > center + 2 && Math.abs(x1 - x0) > 1 && Math.abs(y1 - y0) > 1) break;
    }
    const [[x0, y0], [x1, y1]] = [point(i), point(i + 1)];
    const length = Math.hypot(x1 - x0, y1 - y0);
    // Outward: away from the center.
    const [nx, ny] = [(y1 - y0) / length, -(x1 - x0) / length];
    const sign = nx > 0 ? 1 : -1;
    const near = (d: number) => ({
      x: (x0 + x1) / 2 + sign * nx * d,
      y: (y0 + y1) / 2 + sign * ny * d,
      slop: 4,
      lookups,
    });
    // Measured from the outline's 1.5 px stroke.
    expect(mark.pickItem!(records[0]!, near(3))?.distance).toBeCloseTo(2.25, 1);
    expect(mark.pickItem!(records[0]!, near(6))).toBeUndefined();
    expect(mark.pickItem!(records[0]!, near(-1))?.distance).toBe(0);
  });

  it("pick layout marks' items through itemAt, named by their keys", () => {
    const shares = table({ fruit: ["apple", "pear"], n: [3, 1] });
    const { records } = drawn({
      marks: [pie(shares, { category: "fruit", value: "n", id: "fruit" })],
    });
    const [record] = records;
    expect(record).toMatchObject({ mark: "fruit", panel: "", frame: undefined, series: [] });
    expect(partAt(record!, 0, 0)).toBeUndefined();
    const item = record!.layout!.item(0);
    const picked = pickItem(record!, { x: item.px, y: item.py, slop: 4, lookups });
    expect(picked).toEqual({
      part: { kind: "group", key: item.key },
      names: (JSON.parse(item.key) as unknown[]).slice(1),
      box: { x: item.px, y: item.py, width: 0, height: 0 },
      distance: 0,
    });
    expect(pickItem(record!, { x: -100, y: -100, slop: 4, lookups })).toBeUndefined();
  });

  it("pick the rows of a map of one layer", () => {
    const places = table({ lon: [0, 40], lat: [0, 20], id: ["a", "b"] });
    const { records } = drawn({
      marks: [geopoint(places, { longitude: "lon", latitude: "lat", itemKey: "id", id: "only" })],
    });
    const [record] = records;
    const item = record!.layout!.item(1);
    const picked = pickItem(record!, { x: item.px, y: item.py, slop: 4, lookups });
    expect(picked?.part).toMatchObject({ kind: "row", table: places, position: 1 });
    expect(picked?.mark ?? record!.mark).toBe("only");
  });

  it("pick the rows of layout marks whose items are rows, with their layer's mark", () => {
    const places = table({ lon: [0, 40], lat: [0, 20], id: ["a", "b"] });
    const others = table({ lon: [-60, -30], lat: [-10, 30], id: ["c", "d"] });
    const { records } = drawn({
      marks: [
        geopoint(places, { longitude: "lon", latitude: "lat", id: "near" }),
        geopoint(others, { longitude: "lon", latitude: "lat", itemKey: "id", id: "far" }),
      ],
    });
    const [record] = records;
    expect(record!.layoutMark?.layers).toHaveLength(2);
    for (let k = 0; k < record!.layout!.count; k++) {
      const item = record!.layout!.item(k);
      const picked = pickItem(record!, { x: item.px, y: item.py, slop: 4, lookups });
      expect(picked?.part).toMatchObject({ kind: "row", position: item.row });
      const layer = record!.layoutMark!.layers![item.layer!]!;
      expect(picked?.part).toMatchObject({ table: layer.table });
      expect(picked?.mark ?? record!.mark).toBe(layer.spec.id);
    }
  });
  it("pick a 3D line's samples as rows, alone and with 3D points, by name across resets", () => {
    const path = new Table({ x: [0, 1, 2], y: [0, 1, 0], z: [0, 1, 2], id: ["a", "b", "c"] });
    const sampled = () => line3d(path, { x: "x", y: "y", z: "z", itemKey: "id", id: "path" });
    for (const marks of [
      [sampled()],
      [sampled(), point3d(path, { x: "x", y: "y", z: "z", id: "dots" })],
    ]) {
      const { records } = drawn({ marks });
      const [record] = records;
      expect(record!.layout!.count).toBeGreaterThan(0);
      for (let k = 0; k < record!.layout!.count; k++) {
        const item = record!.layout!.item(k);
        const picked = pickItem(record!, { x: item.px, y: item.py, slop: 4, lookups });
        expect(picked?.part).toMatchObject({ kind: "row", table: path, position: item.row });
      }
    }
    const mark = sampled() as unknown as Mark;
    const items = itemResolver([{ mark, key: "path" }]);
    const key = items.keyOfRow("path", { table: path, position: 1 });
    expect(key).toBe('["path","b"]');
    path.reset({ x: [5, 6], y: [0, 0], z: [1, 1], id: ["b", "d"] });
    expect(Array.from(items.rowsOf(key, path))).toEqual([0]);
  });
});

describe("axis ticks", () => {
  it("carry their values: numbers, times, and band indices", () => {
    const data = table({ region: ["N", "S"], v: [10, 20] });
    const { scene } = drawn({ marks: [bar(data, { x: "region", y: "v" })] });
    const axes = scene.panels[0]!.axes as AxisGuide[];
    const x = axes.find((a) => a.scale === "x")!;
    const y = axes.find((a) => a.scale === "y")!;
    expect(x.ticks.map((t) => [t.value, t.label])).toEqual([
      [0, "N"],
      [1, "S"],
    ]);
    expect(y.ticks.every((t) => String(t.value) === t.label.replace(/,/g, ""))).toBe(true);
  });
});

describe("stack support", () => {
  // Unsupported positions have NaN edges in every layer; a break between
  // supported ones is an extra NaN entry at the later position.
  const layer = (top: number[], bottom: number[]): Series =>
    ({
      key: "layer",
      label: "layer",
      color: "#000",
      x: Float64Array.of(0, 1, 2, 2, 3),
      y: Float64Array.from(top),
      y0: Float64Array.from(bottom),
      values: Float64Array.from(top),
      range: false,
      rows: undefined,
      length: 5,
      sorted: true,
    }) as Series;
  const s = layer([1, 2, Number.NaN, 3, 4], [0, 1, Number.NaN, 1, 2]);
  const polylines = new Map<string, Polyline>();
  const frame = {
    x: new LinearScale([0, 3], [0, 300]),
    y: new LinearScale([0, 4], [400, 0]),
    plot: { x: 0, y: 0, width: 300, height: 400 },
    pixelRatio: 1,
    polyline: (key: string, stage: string) =>
      polylines.get(`${stage}|${key}`) ??
      polylines.set(`${stage}|${key}`, new Polyline()).get(`${stage}|${key}`)!,
  } as unknown as Parameters<typeof traceBand>[3];

  it("is drawn as gaps between bands", () => {
    const { upper, lower } = traceBand(s, s.y, s.y0!, frame, undefined);
    expect(upper.starts.length).toBe(2);
    expect(lower.starts.length).toBe(2);
  });

  it("leaves NaN edges out of domains", () => {
    expect(yExtent(s, 0, 3)).toEqual([1, 4]);
  });
});
