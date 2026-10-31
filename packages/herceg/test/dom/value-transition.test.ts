// Changes of values moving: bars and pie slices matched between two scenes
// and interpolated, evaluated at explicit times.

import { afterEach, describe, expect, it, vi } from "vitest";
import { category, encodedCategory, time } from "../../src/data/column.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { selectionStore, selectRows } from "../../src/data/selection.ts";
import { type Table, type TableChange, table } from "../../src/data/table.ts";
import {
  followedOf,
  frameAt,
  MOVING_ITEMS,
  MOVING_POINTS,
  plan,
  positionsOf,
  type Shown,
  sidesOf,
  snapshot,
  type Tween,
  ValueAnimation,
} from "../../src/dom/value-transition.ts";
import { guideCompiler } from "../../src/guides/compile.ts";
import { axis } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { inset, panel } from "../../src/layout.ts";
import { Polyline } from "../../src/lod/polyline.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { candlestick } from "../../src/marks/candlestick.ts";
import { monotonePolyline } from "../../src/marks/curve.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { gauge } from "../../src/marks/gauge.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import { PointMark, point } from "../../src/marks/point.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { planAxis } from "../../src/model/axis.ts";
import { axisGuide } from "../../src/model/axis-guide.ts";
import { facet } from "../../src/model/facet.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { Highlighter } from "../../src/model/highlight.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderSvg } from "../../src/render/svg.ts";
import { timeBreaks } from "../../src/scale/breaks.ts";
import type { PositionScale } from "../../src/scale/scale.ts";
import {
  type ArcGeometry,
  type AreaGeometry,
  type AxisGuide,
  CLOUD_POINTS,
  type Geometry,
  type LabelsGeometry,
  type LineGeometry,
  type PointGeometry,
  type PointItems,
  type RasterGeometry,
  type RectGeometry,
  type RuleGeometry,
  type Scene,
  type SegmentGeometry,
  type ShapesGeometry,
  type TextGeometry,
} from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";
import { gridAt } from "../helpers/grid.ts";

const clock = vi.hoisted(() => ({ frame: 0 }));
vi.mock("../../src/dom/scheduler.ts", () => ({ lastFrameTime: () => clock.frame }));

afterEach(() => {
  clock.frame = 0;
});

const VALUES = { duration: 200, values: true } as const;
const BUILDERS = { planAxis, axisGuide, Polyline, monotonePolyline, measure: estimateText };

/** A chart model drawn at 600 x 300 that animates values. */
function chart(config: Partial<ChartConfig> & Pick<ChartConfig, "marks">) {
  const model = new ChartModel(
    { locale: "en-US", animation: VALUES, ...config },
    undefined,
    ...staticCompilers(),
  );
  model.setSize(600, 300, 1);
  return model;
}

/** What `model` showed, and how it moves to its next scene after `change`. */
function change(model: ChartModel, edit: () => void): { shown: Shown; tween: Tween | undefined } {
  const shown = snapshot(model.scene(estimateText), model.panels(), 0);
  expect(shown).toBeDefined();
  edit();
  const scene = model.scene(estimateText);
  return {
    shown: shown!,
    tween: plan(
      shown!,
      scene,
      model.panels(),
      200,
      BUILDERS,
      sidesOf(model.config),
      followedOf(model.config),
      positionsOf(model.config),
    ),
  };
}

const bars = (scene: Scene) =>
  scene.panels[0]!.marks.filter((mark): mark is RectGeometry => mark.kind === "rect");
const rects = (mark: RectGeometry) =>
  Array.from({ length: mark.count }, (_, i) => Array.from(mark.rects.subarray(i * 4, i * 4 + 4)));
/** Rectangles alike to a thousandth of a pixel: frames compute them from rounded ends. */
function expectRects(actual: number[][], expected: number[][]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((rect, i) => {
    rect.forEach((value, k) => {
      expect(value).toBeCloseTo(expected[i]![k]!, 3);
    });
  });
}
const sectors = (scene: Scene) =>
  scene.panels[0]!.marks.find((m) => m.kind === "arc") as ArcGeometry;
const turns = (mark: ArcGeometry) =>
  Array.from({ length: mark.count }, (_, i) => [mark.arcs[i * 6 + 4]!, mark.arcs[i * 6 + 5]!]);

function barChart(values: number[]) {
  const data = table({ region: ["N", "S", "E"], sales: values });
  return { data, model: chart({ marks: [bar(data, { x: "region", y: "sales" })] }) };
}

describe("bars changing values", () => {
  it("start where they were, move their tips, and end as the new scene draws them", () => {
    // A fixed domain keeps the axis still while the values change.
    const data = table({ region: ["N", "S", "E"], sales: [10, 20, 30] });
    const model = chart({
      marks: [bar(data, { x: "region", y: "sales" })],
      y: { domain: [0, 40] },
    });
    const before = rects(bars(model.scene(estimateText))[0]!);
    const { tween } = change(model, () => data.setColumn("sales", [30, 20, 10]));
    const after = rects(bars(tween!.scene)[0]!);
    const at = (elapsed: number) => rects(bars(frameAt(tween!, elapsed))[0]!);
    expectRects(at(0), before);
    expectRects(at(200), after);
    // Half way in time, eased: seven eighths of the way, with bases and widths kept.
    const [n] = at(100);
    const [x, , width, height] = before[0]!;
    expect(n![0]).toBe(x);
    expect(n![2]).toBe(width);
    const grown = height! + (after[0]![3]! - height!) * 0.875;
    expect(n![3]).toBeCloseTo(grown, 3);
    expect(n![1]! + n![3]!).toBeCloseTo(before[0]![1]! + height!, 3);
  });

  it("match bars by category, not by row", () => {
    const data = table({ region: ["N", "S", "E"], sales: [10, 20, 30] });
    const model = chart({
      marks: [bar(data, { x: "region", y: "sales" })],
      y: { domain: [0, 40] },
    });
    const before = rects(bars(model.scene(estimateText))[0]!);
    // The same categories in another row order (with the same dictionary,
    // as Arrow and pandas give them), with S's value changed.
    const { tween } = change(model, () =>
      data.reset({
        region: encodedCategory(Int32Array.from([2, 0, 1]), ["N", "S", "E"]),
        sales: [30, 10, 25],
      }),
    );
    // Bars are matched by category: each starts where its category's was.
    const byX = (list: number[][]) => [...list].sort((a, b) => a[0]! - b[0]!);
    expectRects(byX(rects(bars(frameAt(tween!, 0))[0]!)), byX(before));
    const s = byX(rects(bars(frameAt(tween!, 200))[0]!))[1]!;
    expect(s[3]).toBeCloseTo(model.panels()[0]!.y.map(0) - model.panels()[0]!.y.map(25), 3);
  });

  it("shrink to their root and grow on its other side as values change sign", () => {
    const data = table({ region: ["N", "S"], sales: [10, -10] });
    const model = chart({
      marks: [bar(data, { x: "region", y: "sales" })],
      y: { domain: [-20, 20] },
      theme: { style: { bar: { radius: 4 } } },
    });
    const zero = model.scene(estimateText) && model.panels()[0]!.y.map(0);
    const { tween } = change(model, () => data.setColumn("sales", [-10, 10]));
    // The tip passes the root a little before half time (eased): t = 1 - 0.5^(1/3).
    const crossing = (1 - 0.5 ** (1 / 3)) * 200;
    const top = (elapsed: number) => {
      const mark = bars(frameAt(tween!, elapsed))[0]!;
      return { rect: rects(mark)[0]!, end: mark.rounded!.ends[0] };
    };
    const early = top(crossing - 10);
    const late = top(crossing + 10);
    // N stands on zero, above it, then below it, its rounded end at its tip.
    expect(early.rect[1]! + early.rect[3]!).toBeCloseTo(zero, 3);
    expect(late.rect[1]).toBeCloseTo(zero, 3);
    expect(early.end).not.toBe(late.end);
    expect(top(crossing).rect[3]).toBeCloseTo(0, 1);
  });

  it("grow new bars from their root and shrink bars that go to theirs", () => {
    const data = table({ region: ["N", "S", "E"], sales: [10, Number.NaN, 30] });
    const model = chart({
      marks: [bar(data, { x: "region", y: "sales" })],
      y: { domain: [0, 40] },
    });
    const { tween } = change(model, () => data.setColumn("sales", [Number.NaN, 20, 30]));
    const zero = model.panels()[0]!.y.map(0);
    // Both stay drawn while they move: S (coming) first in the new order, N (going) last.
    const start = bars(frameAt(tween!, 0))[0]!;
    expect(start.count).toBe(3);
    expect(rects(start)[0]![3]).toBe(0);
    expect(rects(start)[0]![1]).toBeCloseTo(zero, 3);
    const end = rects(bars(frameAt(tween!, 200))[0]!);
    expect(end[2]![3]).toBe(0);
    // The last frame is the new scene itself, without N.
    expect(bars(tween!.scene)[0]!.count).toBe(2);
  });

  it("move horizontal bars along x and grouped bars in their slots", () => {
    const data = table({ region: ["N", "S"], a: [10, 20], b: [5, 15] });
    const model = chart({
      marks: [bar(data, { x: ["a", "b"], y: "region" })],
      x: { domain: [0, 40] },
    });
    const before = bars(model.scene(estimateText)).map(rects);
    const { tween } = change(model, () => data.setColumn("b", [25, 15]));
    expect(tween!.panels[0]!.bars).toHaveLength(2);
    const [, b] = bars(frameAt(tween!, 100)).map(rects);
    // Lengths along x grow from the left; positions along y stay.
    expect(b![0]![0]).toBe(Math.fround(before[1]![0]![0]!));
    expect(b![0]![1]).toBe(Math.fround(before[1]![0]![1]!));
    expect(b![0]![2]).toBeGreaterThan(before[1]![0]![2]!);
  });

  it("do not move when the plot, the categories, or the series change", () => {
    // An automatic y domain grows past the width its labels had room for.
    const grows = barChart([10, 20, 30]);
    expect(change(grows.model, () => grows.data.setColumn("sales", [10, 20, 90_000])).tween).toBe(
      undefined,
    );
    // A new category changes the bands.
    const data = table({ region: ["N", "S"], sales: [10, 20] });
    const model = chart({
      marks: [bar(data, { x: "region", y: "sales" })],
      y: { domain: [0, 40] },
    });
    expect(
      change(model, () => data.reset({ region: ["N", "S", "E"], sales: [10, 20, 30] })).tween,
    ).toBe(undefined);
    // A series coming changes the slots.
    const split = table({ region: ["N", "S"], kind: ["a", "a"], sales: [10, 20] });
    const grouped = chart({
      marks: [bar(split, { x: "region", y: "sales", series: "kind" })],
      y: { domain: [0, 40] },
    });
    expect(
      change(grouped, () => split.reset({ region: ["N", "S"], kind: ["a", "b"], sales: [10, 20] }))
        .tween,
    ).toBe(undefined);
    // Nothing changed: nothing moves.
    const same = barChart([10, 20, 30]);
    expect(change(same.model, () => same.data.setColumn("sales", [10, 20, 30])).tween).toBe(
      undefined,
    );
  });

  it("do not move bars of one facet value to another's", () => {
    const data = table({ region: ["N", "S"], sales: [10, 20], group: ["old", "old"] });
    const model = chart({
      marks: [bar(data, { x: "region", y: "sales" })],
      facet: facet("group"),
      y: { domain: [0, 40] },
    });
    const { tween } = change(model, () =>
      data.reset({ region: ["N", "S"], sales: [30, 10], group: ["new", "new"] }),
    );
    expect(tween).toBeUndefined();
  });

  it("move stacks and labeled bars by position, bars on log axes in order, and not bars sharing a position", () => {
    const data = () => table({ region: ["N", "S"], a: [10, 20], b: [5, 15] });
    // A stack's layers move their roots and tips, so they stay on one another.
    const stacked = data();
    const stack = chart({
      marks: [bar(stacked, { x: "region", y: ["a", "b"], stack: true })],
      y: { domain: [0, 40] },
    });
    const { tween } = change(stack, () => stacked.setColumn("a", [20, 10]));
    expect(tween!.panels[0]!.bars).toHaveLength(2);
    const [lower, upper] = bars(frameAt(tween!, 100)).map(rects);
    lower!.forEach(([, top], i) => {
      const [, y, , height] = upper![i]!;
      expect(y! + height!).toBeCloseTo(top!, 3);
    });
    // Labels move with the bars they stand by.
    const labeled = data();
    const withLabels = chart({
      marks: [bar(labeled, { x: "region", y: "a", labels: true })],
      y: { domain: [0, 40] },
    });
    const moved = change(withLabels, () => labeled.setColumn("a", [20, 10])).tween!;
    expect(moved.panels[0]!.bars).toHaveLength(1);
    expect(moved.panels[0]!.lists.map(({ mark }) => mark.kind)).toEqual([
      expect.stringMatching(/text|labels/),
    ]);
    // On a log axis bars move as rectangles in their order.
    const logged = data();
    const log = chart({ marks: [bar(logged, { x: "region", y: "a" })], y: { type: "log" } });
    const ordered = change(log, () => logged.setColumn("a", [20, 10])).tween!;
    expect([ordered.panels[0]!.bars.length, ordered.panels[0]!.lists.length]).toEqual([0, 1]);
    // Two bars at one position have no identity: their series shows its new values.
    const twice = table({ region: ["N", "N", "S"], a: [10, 12, 20] });
    const model = chart({ marks: [bar(twice, { x: "region", y: "a" })], y: { domain: [0, 40] } });
    expect(change(model, () => twice.setColumn("a", [11, 13, 25])).tween).toBe(undefined);
  });

  it("move a highlight's dots with their series, or show them at once with it", () => {
    // The middle row selected alone: a dot over its observation, which
    // moves as the line or area does, or with labels following, not at
    // all, beside bars that move.
    for (const kind of ["line", "area"] as const)
      for (const followed of [false, true]) {
        const data = table({ x: [0, 1, 2], y: [2, 5, 2] }) as unknown as Table;
        const counts = table({ x: [0, 1, 2], v: [1, 2, 3] });
        const options = {
          x: "x",
          y: "y",
          stroke: "red",
          ...(followed && { labels: { at: "last" as const } }),
        };
        const model = chart({
          x: { domain: [0, 2], nice: false },
          y: { domain: [0, 10], nice: false },
          marks: [
            bar(counts, { x: "x", y: "v" }),
            kind === "line" ? line(data, options) : area(data, options),
          ],
        });
        const store = selectionStore(data);
        store.set("focus", selectRows(new RowSet(data).addAll([1])));
        const highlighter = new Highlighter([{ table: data, store, channel: "focus" }]);
        model.highlight = (mark, series, frame, key) =>
          highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
        const { tween } = change(model, () => {
          data.setColumn("y", [2, 8, 2]);
          counts.setColumn("v", [2, 3, 4]);
        });
        const name = `${kind}, followed: ${followed}`;
        const middle = frameAt(tween!, 100).panels[0]!.marks;
        const dot = middle.find((mark) => mark.key.endsWith("-dots")) as PointGeometry;
        expect(dot, name).toBeDefined();
        const trace = middle.find((mark) => mark.kind === kind) as LineGeometry | AreaGeometry;
        const path = trace.kind === "line" ? trace.path : trace.upper;
        expect(dot.coords[1], name).toBeCloseTo(path.coords[3]!, 3);
        expect(tween!.scene.panels[0]!.marks.includes(dot), name).toBe(followed);
      }
  });

  it("change at once where only pieces of series shown at once would move", () => {
    // Series a has a missing value, so it shows its new values at once,
    // and its dot with it; nothing else changes.
    const data = table({ x: [0, 1, 2], a: [2, 5, NaN], b: [3, 6, 3] }) as unknown as Table;
    const model = chart({
      x: { domain: [0, 2], nice: false },
      y: { domain: [0, 10], nice: false },
      marks: [line(data, { x: "x", y: ["a", "b"] })],
    });
    const store = selectionStore(data);
    store.set("focus", selectRows(new RowSet(data).addAll([1])));
    const highlighter = new Highlighter([{ table: data, store, channel: "focus" }]);
    model.highlight = (mark, series, frame, key) =>
      highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
    expect(change(model, () => data.setColumn("a", [2, 8, NaN])).tween).toBe(undefined);
  });

  it("show series labels follow at their new values at once, with their labels", () => {
    // An outlined area whose end a label stands at, beside bars that move:
    // followed by its own labels or by text, highlighted in part (drawn in
    // lit and dimmed pieces, each with its outline) or not.
    const data = table({ t: [0, 1, 2], hi: [2, 3, 4] }) as unknown as Table;
    const counts = table({ t: [0, 1, 2], v: [1, 2, 3] });
    const outlined = { id: "area", x: "t", y: "hi", stroke: "red" } as const;
    const last = { at: "last" } as const;
    const inside = { outside: false } as const;
    for (const follower of [undefined, "labels", "text"] as const)
      for (const highlighted of [false, true]) {
        data.setColumn("hi", [2, 3, 4]);
        counts.setColumn("v", [1, 2, 3]);
        const model = chart({
          x: { domain: [0, 2], nice: false },
          y: { domain: [0, 10], nice: false },
          marks: [
            bar(counts, { x: "t", y: "v" }),
            area(data, {
              ...outlined,
              ...(follower === "labels" && { labels: { ...last, place: inside } }),
            }),
            ...(follower === "text"
              ? [text({ from: { mark: "area", ...last }, label: { text: "end", place: inside } })]
              : []),
          ],
        });
        if (highlighted) {
          const store = selectionStore(data);
          store.set("focus", selectRows(new RowSet(data).addAll([0, 1])));
          const highlighter = new Highlighter([{ table: data, store, channel: "focus" }]);
          model.highlight = (mark, series, frame, key) =>
            highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
        }
        const { tween } = change(model, () => {
          data.setColumn("hi", [6, 7, 8]);
          counts.setColumn("v", [2, 3, 4]);
        });
        const name = `${follower}, highlighted: ${highlighted}`;
        const middle = frameAt(tween!, 100).panels[0]!.marks;
        const final = tween!.scene.panels[0]!.marks;
        // Halfway, every piece of a followed area is as the new scene draws it, as its label is.
        const pieces = middle.flatMap((mark, i) =>
          mark.kind === "area" ? [[mark, final[i]]] : [],
        );
        expect(pieces.length, name).toBeGreaterThan(highlighted ? 2 : 0);
        expect(
          pieces.every(([now, then]) => now === then),
          name,
        ).toBe(follower !== undefined);
        const labels = middle.filter((mark) => mark.kind === "labels");
        expect(
          labels.every((mark) => final.includes(mark)),
          name,
        ).toBe(true);
        // Bars move beside it.
        expect(tween!.panels[0]!.bars, name).toHaveLength(1);
      }
  });

  it("change at once beside marks placed in a frame or on a scale of the chart's own", () => {
    const data = table({ region: ["N", "S"], a: [10, 20], d: [100, 400] });
    const depth = chart({
      scales: { depth: { type: "linear" } },
      guides: [axis({ scale: "depth", place: { side: "right" } })],
      marks: [
        bar(data, { x: "region", y: "a" }),
        line(data, { x: "region", y: { field: "d", scale: "depth" } }),
      ],
    });
    expect(change(depth, () => data.setColumn("a", [30, 60])).tween).toBe(undefined);
    const lanes = table({ region: ["N", "S"], a: [10, 20], lane: [0.25, 0.75] });
    const framed = chart({
      marks: [
        bar(lanes, { x: "region", y: "a" }),
        point(lanes, { x: "region", y: { fraction: { field: "lane" } } }),
      ],
    });
    expect(change(framed, () => lanes.setColumn("a", [30, 60])).tween).toBe(undefined);
  });

  contractTest("position.field.animation", () => {
    // Coordinates naming only a field, an axis' scale, or no offset place
    // rows as plain ones do: changed values move.
    const places = [
      "region",
      { field: "region" },
      { field: "region", scale: "x" },
      { field: "region", offset: 0 },
    ] as const;
    for (const x of places) {
      const data = table({ region: ["N", "S"], a: [10, 20] });
      const model = chart({ y: { domain: [0, 100] }, marks: [bar(data, { x, y: "a" })] });
      expect(
        change(model, () => data.setColumn("a", [30, 60])).tween,
        JSON.stringify(x),
      ).toBeDefined();
    }
  });

  it("keep copies of what was shown, which later scenes cannot overwrite", () => {
    const data = table({ region: ["N", "S", "E"], sales: [10, 20, 30] });
    const model = chart({
      marks: [bar(data, { x: "region", y: "sales" })],
      y: { domain: [0, 40] },
    });
    const scene = model.scene(estimateText);
    const drawn = rects(bars(scene)[0]!);
    const shown = snapshot(scene, model.panels(), 0)!;
    // Scenes reuse their geometry buffers.
    data.setColumn("sales", [1, 2, 3]);
    model.scene(estimateText);
    data.setColumn("sales", [30, 20, 10]);
    const tween = plan(shown, model.scene(estimateText), model.panels(), 200, BUILDERS)!;
    expectRects(rects(bars(frameAt(tween, 0))[0]!), drawn);
  });

  it("draw exactly what a chart without animation draws once done", () => {
    const data = table({ region: ["N", "S", "E"], sales: [10, 20, 30] });
    const still = new ChartModel({
      locale: "en-US",
      marks: [bar(data, { x: "region", y: "sales" })],
    });
    still.setSize(600, 300, 1);
    const moving = chart({ marks: [bar(data, { x: "region", y: "sales" })] });
    const svg = (model: ChartModel) => renderSvg(model.scene(estimateText), { idPrefix: "c" });
    expect(svg(moving)).toBe(svg(still));
  });
});

describe("pies changing values", () => {
  function pieChart(
    rows: { region: string[]; sales: number[] },
    sort: "value" | "input" = "input",
  ) {
    const data = table(rows);
    return {
      data,
      model: chart({ marks: [pie(data, { category: "region", value: "sales", sort })] }),
    };
  }

  it("move shared boundaries, so slices never overlap and always make a turn", () => {
    const { data, model } = pieChart({ region: ["N", "S", "E"], sales: [10, 20, 30] });
    const before = turns(sectors(model.scene(estimateText)));
    const { tween } = change(model, () => data.setColumn("sales", [30, 20, 10]));
    expect(turns(sectors(frameAt(tween!, 0)))).toEqual(before);
    for (const elapsed of [20, 100, 180]) {
      const at = turns(sectors(frameAt(tween!, elapsed)));
      expect(at[0]![0]).toBeCloseTo(-Math.PI / 2, 5);
      for (let i = 1; i < at.length; i++) expect(at[i]![0]).toBe(at[i - 1]![1]);
      expect(at.at(-1)![1]).toBeCloseTo(1.5 * Math.PI, 5);
    }
    expect(turns(sectors(frameAt(tween!, 200)))).toEqual(turns(sectors(tween!.scene)));
  });

  it("open new slices from nothing and close slices that go, with their labels", () => {
    const { data, model } = pieChart({ region: ["N", "S"], sales: [10, 20] });
    const labels = (scene: Scene) =>
      scene.panels[0]!.marks.filter((m): m is TextGeometry => m.kind === "text")
        .flatMap((m) => m.labels)
        .sort();
    const { tween } = change(model, () => data.reset({ region: ["N", "E"], sales: [10, 20] }));
    // S goes and E comes in its place: at first only N and S show.
    expect(sectors(frameAt(tween!, 0)).count).toBe(2);
    expect(labels(frameAt(tween!, 0))).toEqual(["N", "S"]);
    const middle = frameAt(tween!, 50);
    expect(sectors(middle).count).toBe(3);
    expect(labels(middle)).toEqual(["E", "N", "S"]);
    const leaders = middle.panels[0]!.marks.find((m) => m.kind === "segments") as SegmentGeometry;
    expect(leaders.count).toBe(12);
    // S keeps its label while it shows, however thin.
    expect(labels(frameAt(tween!, 199))).toEqual(["E", "N", "S"]);
    expect(labels(tween!.scene)).toEqual(["E", "N"]);
  });

  it("sweep from the top when a pie fills, and do not move when kept slices change order", () => {
    // Without a legend, which would take room once there are slices to list.
    const data = table({ region: category([]), sales: [] });
    const model = chart({
      marks: [pie(data, { category: "region", value: "sales", sort: "input" })],
      legend: false,
    });
    const { tween } = change(model, () => data.reset({ region: ["N", "S"], sales: [10, 30] }));
    const half = turns(sectors(frameAt(tween!, 100)));
    // Seven eighths of the turn after half the time.
    expect(half.at(-1)![1]! - half[0]![0]!).toBeCloseTo(0.875 * 2 * Math.PI, 5);
    // Sorted by value, N and S swap places: they would cross.
    const sorted = pieChart({ region: ["N", "S"], sales: [10, 30] }, "value");
    expect(
      change(sorted.model, () => sorted.data.setColumn("sales", [30, 10])).tween,
    ).toBeUndefined();
  });
});

/** Seven eighths: eased progress half way through a change. */
const HALF = 0.875;
const axisOf = (scene: Scene, orient: AxisGuide["side"]) =>
  scene.panels[0]!.axes.find((axis) => axis.side === orient)!;
const labels = (axis: AxisGuide) => axis.ticks.map(({ label }) => label);
/** Ticks alike: the same labels, at positions alike to a thousandth of a pixel. */
function expectTicks(actual: AxisGuide, expected: AxisGuide) {
  expect(labels(actual)).toEqual(labels(expected));
  actual.ticks.forEach(({ position }, i) => {
    expect(position).toBeCloseTo(expected.ticks[i]!.position, 3);
  });
}
/**
 * Where `value` is drawn by a scale over the range of `to` whose domain is
 * `t` of the way from `from`'s to `to`'s; with `log`, in log space.
 */
function placed(value: number, from: PositionScale, to: PositionScale, t: number, log = false) {
  const f = (v: number) => (log ? Math.log10(v) : v);
  const [a, b] = [from.domain.map(f), to.domain.map(f)];
  const d0 = a[0]! + (b[0]! - a[0]!) * t;
  const d1 = a[1]! + (b[1]! - a[1]!) * t;
  const [r0, r1] = to.range;
  return r0 + ((f(value) - d0) * (r1 - r0)) / (d1 - d0);
}
const marksOf = <G>(scene: Scene, kind: string) =>
  scene.panels[0]!.marks.filter((mark) => mark.kind === kind) as G[];
const pointsOf = (scene: Scene) => marksOf<PointGeometry>(scene, "point");
const centers = (mark: PointGeometry) =>
  Array.from({ length: mark.count }, (_, i) => [mark.coords[i * 2]!, mark.coords[i * 2 + 1]!]);
const ys = (path: Polyline) =>
  Array.from({ length: path.count }, (_, i) => path.coords[i * 2 + 1]!);
const xs = (path: Polyline) => Array.from({ length: path.count }, (_, i) => path.coords[i * 2]!);

describe("axes moving with values", () => {
  it("plan ticks and grid lines for the domains between, from one scene's to the next's", () => {
    const { data, model } = barChart([10, 20, 30]);
    const before = model.scene(estimateText);
    const from = model.panels()[0]!.y;
    const { tween } = change(model, () => data.setColumn("sales", [10, 20, 45]));
    const to = model.panels()[0]!.y;
    expectTicks(axisOf(frameAt(tween!, 0), "left"), axisOf(before, "left"));
    expectTicks(axisOf(frameAt(tween!, 200), "left"), axisOf(tween!.scene, "left"));
    // Half way, ticks go up in tens to 40: between the axes up to 30 and 50.
    const middle = frameAt(tween!, 100);
    const left = axisOf(middle, "left");
    expect(labels(left)).toEqual(["0", "10", "20", "30", "40"]);
    for (const { label, position } of left.ticks)
      expect(position).toBeCloseTo(placed(Number(label), from, to, HALF), 3);
    expect(gridAt(middle.panels[0]!, "y")).toEqual(left.ticks.map(({ position }) => position));
    // The bar keeping its value moves only as its axis does; the one changing goes between.
    const [n, , e] = rects(bars(middle)[0]!);
    expect(n![1]).toBeCloseTo(placed(10, from, to, HALF), 3);
    expect(e![1]).toBeCloseTo(placed(30 + 15 * HALF, from, to, HALF), 3);
    // The x axis stays.
    expect(axisOf(middle, "bottom")).toBe(axisOf(tween!.scene, "bottom"));
  });

  it("show at once a change that moves an axis the guides list", () => {
    const data = table({ x: [1, 2, 3], y: [10, 20, 30] });
    const model = new ChartModel(
      {
        locale: "en-US",
        animation: VALUES,
        marks: [point(data, { x: "x", y: "y" })],
        guides: [
          axis({ scale: "y", layers: [{ id: "minor", ticks: { every: 1 }, labels: false }] }),
        ],
      },
      undefined,
      guideCompiler(GUIDE_KIT),
    );
    model.setSize(600, 300, 1);
    expect(change(model, () => data.set("y", 2, 45)).tween).toBeUndefined();
    // A change its axes stay through still moves.
    expect(change(model, () => data.set("y", 1, 25)).tween).toBeDefined();
  });

  it("move points, lines, and rules with their axes", () => {
    const data = table({ x: [1, 2, 3], y: [10, 20, 30] });
    const model = chart({
      marks: [point(data, { x: "x", y: "y" }), line(data, { x: "x", y: "y" }), rule({ y: 15 })],
    });
    model.scene(estimateText);
    const from = model.panels()[0]!.y;
    const { tween } = change(model, () => data.set("y", 2, 45));
    const to = model.panels()[0]!.y;
    const middle = frameAt(tween!, 100);
    const [a, , c] = centers(pointsOf(middle)[0]!);
    expect(a![1]).toBeCloseTo(placed(10, from, to, HALF), 3);
    expect(c![1]).toBeCloseTo(placed(30 + 15 * HALF, from, to, HALF), 3);
    const [path] = marksOf<LineGeometry>(middle, "line").map((mark) => mark.path);
    expect(ys(path!)[0]).toBeCloseTo(placed(10, from, to, HALF), 3);
    expect(ys(path!)[2]).toBeCloseTo(c![1]!, 3);
    const [threshold] = marksOf<RuleGeometry>(middle, "rule");
    expect(threshold!.y1).toBeCloseTo(placed(15, from, to, HALF), 6);
    expect(threshold!.y2).toBe(threshold!.y1);
  });

  it("move rules from a table's rows, alone in a chart", () => {
    const data = table({ y: [10, 20, 30] });
    const model = chart({ marks: [rule(data, { y: "y" })] });
    model.scene(estimateText);
    const from = model.panels()[0]!.y;
    const { tween } = change(model, () => data.set("y", 2, 45));
    const to = model.panels()[0]!.y;
    const [, middle, high] = marksOf<RuleGeometry>(frameAt(tween!, 100), "rule");
    expect(middle!.y1).toBeCloseTo(placed(20, from, to, HALF), 6);
    expect(high!.y1).toBeCloseTo(placed(30 + 15 * HALF, from, to, HALF), 6);
  });

  it("move areas' baselines and both edges of bands with the axis", () => {
    const data = table({ x: [1, 2, 3], lo: [-10, -5, -8], hi: [5, 10, 20] });
    const model = chart({
      marks: [area(data, { x: "x", y: "hi" }), area(data, { x: "x", y1: "lo", y2: "hi" })],
    });
    model.scene(estimateText);
    const from = model.panels()[0]!.y;
    const { tween } = change(model, () => data.setColumn("hi", [5, 10, 60]));
    const to = model.panels()[0]!.y;
    const [filled, band] = marksOf<AreaGeometry>(frameAt(tween!, 100), "area");
    expect(filled!.baseline).toBeCloseTo(placed(0, from, to, HALF), 3);
    expect(ys(filled!.upper)[0]).toBeCloseTo(placed(5, from, to, HALF), 3);
    expect(ys(band!.upper)[0]).toBeCloseTo(placed(5, from, to, HALF), 3);
    expect(ys(band!.lower!)[0]).toBeCloseTo(placed(-10, from, to, HALF), 3);
  });

  it("move marks on the right axis with its scale, and leave the left axis' alone", () => {
    const left = table({ x: [1, 2, 3], y: [1, 2, 3] });
    const right = table({ x: [1, 2, 3], y: [10, 20, 30] });
    const model = chart({
      marks: [line(left, { x: "x", y: "y" }), line(right, { x: "x", y: "y", axis: "right" })],
      y: { domain: [0, 4] },
    });
    model.scene(estimateText);
    const from = model.panels()[0]!.yRight!;
    const { tween } = change(model, () => right.set("y", 2, 45));
    const to = model.panels()[0]!.yRight!;
    const middle = frameAt(tween!, 100);
    const [still, moving] = marksOf<LineGeometry>(middle, "line").map((mark) => mark.path);
    const [drawn] = marksOf<LineGeometry>(tween!.scene, "line").map((mark) => mark.path);
    expect(ys(still!)).toEqual(ys(drawn!));
    expect(ys(moving!)[0]).toBeCloseTo(placed(10, from, to, HALF), 3);
    expect(axisOf(middle, "left")).toBe(axisOf(tween!.scene, "left"));
    expect(labels(axisOf(middle, "right"))).not.toEqual(labels(axisOf(tween!.scene, "right")));
  });

  it("move log axes, and values on them, in log space", () => {
    const data = table({ x: [1, 2, 3], y: [1, 10, 1000] });
    const model = chart({ marks: [point(data, { x: "x", y: "y" })], y: { type: "log" } });
    // The widest labels came first: margins only grow, so the plot stays.
    model.scene(estimateText);
    data.set("y", 2, 100);
    model.scene(estimateText);
    const from = model.panels()[0]!.y;
    const { tween } = change(model, () => data.set("y", 2, 1000));
    const to = model.panels()[0]!.y;
    const middle = frameAt(tween!, 100);
    const [, ten, top] = centers(pointsOf(middle)[0]!);
    expect(ten![1]).toBeCloseTo(placed(10, from, to, HALF, true), 3);
    expect(top![1]).toBeCloseTo(placed(10 ** (2 + HALF), from, to, HALF, true), 3);
    for (const { label, position } of axisOf(middle, "left").ticks)
      expect(position).toBeCloseTo(
        placed(Number(label.replace(/,/g, "")), from, to, HALF, true),
        3,
      );
  });

  it("show at once what cannot move with its axes", () => {
    const data = table({ region: ["N", "S"], a: [10, 20], b: [5, 15] });
    const marks = () => [
      errorbar(data, { x: "region", y1: "b", y2: "a" }),
      point(data, { x: "region", y: "a" }),
    ];
    // An error bar that goes leaves its list another length, which cannot
    // move: points can, but not with an axis moving past the error bars.
    const free = chart({ marks: marks() });
    expect(change(free, () => data.setColumn("a", [Number.NaN, 30])).tween).toBeUndefined();
    data.setColumn("a", [10, 20]);
    const fixed = chart({ marks: marks(), y: { domain: [0, 60] } });
    const { tween } = change(fixed, () => data.setColumn("a", [Number.NaN, 30]));
    expect(tween!.panels[0]!.points).toHaveLength(1);
    expect(tween!.panels[0]!.lists).toHaveLength(0);
  });
});

describe("seams of time breaks while values change", () => {
  it("stay put while only y moves, and leave changes that move x to show at once", () => {
    const data = table({ t: time([0, 10, 20]), y: [10, 20, 30] });
    const model = chart({
      timeZone: "UTC",
      marks: [point(data, { x: "t", y: "y" })],
      x: { breaks: timeBreaks([{ from: 4, to: 8 }]), seams: true },
    });
    const seams = (scene: Scene) =>
      scene.panels[0]!.marks.filter((m) => m.key === "time-break-seams");
    const { tween } = change(model, () => data.set("y", 2, 45));
    expect(tween).toBeDefined();
    expect(seams(frameAt(tween!, 100))).toEqual(seams(tween!.scene));
    expect(seams(tween!.scene)).toHaveLength(1);
    expect(change(model, () => data.set("t", 2, 30)).tween).toBeUndefined();
  });
});

describe("points changing values", () => {
  /** Points on axes that stay put. */
  function scatter(columns: Record<string, number[]>, options = {}) {
    const data = table(columns);
    const model = chart({
      marks: [point(data, { x: "x", y: "y", ...options })],
      x: { domain: [0, 4] },
      y: { domain: [0, 100] },
    });
    return { data, model };
  }

  it("match points by the rows they show as rows stop and start being drawn", () => {
    const { data, model } = scatter({ x: [1, 2, 3], y: [10, 20, 30] });
    const before = centers(pointsOf(model.scene(estimateText))[0]!);
    // B has no value: it goes, and C, now the second point drawn, is still C.
    const { tween } = change(model, () => data.set("y", 1, Number.NaN));
    const start = pointsOf(frameAt(tween!, 0))[0]!;
    expect(start.count).toBe(3);
    expectRects(centers(start), [before[0]!, before[2]!, before[1]!]);
    const end = pointsOf(frameAt(tween!, 200))[0]!;
    expect(end.radii![2]).toBe(0);
    expect(pointsOf(tween!.scene)[0]!.count).toBe(2);
    // B comes back where its new value is, from nothing; A moves to its own.
    const back = change(model, () => data.replace(0, { y: [50, 60] })).tween!;
    const first = pointsOf(frameAt(back, 0))[0]!;
    expect(Array.from(first.radii!)).toEqual([2.5, 0, 2.5]);
    const [a, b] = centers(pointsOf(frameAt(back, 100))[0]!);
    const y = model.panels()[0]!.y;
    expect(a![1]).toBeCloseTo(y.map(10 + 40 * HALF), 3);
    expect(b![1]).toBeCloseTo(y.map(60), 3);
  });

  it("change the sizes and colors they encode", () => {
    const { data, model } = scatter(
      { x: [1, 2, 3], y: [10, 20, 30], r: [1, 2, 4], c: [0, 5, 10] },
      { size: "r", color: "c" },
    );
    const before = pointsOf(model.scene(estimateText))[0]!;
    const [r0, i0] = [before.radii![0]!, before.colors!.index[0]!];
    const { tween } = change(model, () => {
      data.setColumn("r", [4, 2, 1]);
      data.setColumn("c", [10, 5, 0]);
    });
    const after = pointsOf(tween!.scene)[0]!;
    const middle = pointsOf(frameAt(tween!, 100))[0]!;
    expect(middle.radii![0]).toBeCloseTo(r0 + (after.radii![0]! - r0) * HALF, 4);
    expect(middle.colors!.index[0]).toBe(Math.round(i0 + (after.colors!.index[0]! - i0) * HALF));
    expect(middle.colors!.palette).toEqual(after.colors!.palette);
  });

  it("move points colored by category, but not across a change of category", () => {
    const data = table({ x: [1, 2, 3], y: [10, 20, 30], kind: ["a", "b", "a"] });
    const model = chart({
      marks: [point(data, { x: "x", y: "y", color: "kind", series: false })],
      x: { domain: [0, 4] },
      y: { domain: [0, 100] },
    });
    const { tween } = change(model, () => data.set("y", 0, 50));
    const middle = pointsOf(frameAt(tween!, 100))[0]!;
    expect(middle.colors!.categorical).toBe(true);
    expect(Array.from(middle.colors!.index.subarray(0, 3))).toEqual([0, 1, 0]);
    expect(change(model, () => data.set("kind", 0, "b")).tween).toBeUndefined();
  });

  it("do not match points across a reset, or move sampled points", () => {
    const { data, model } = scatter({ x: [1, 2, 3], y: [10, 20, 30] });
    expect(
      change(model, () => data.reset({ x: [1, 2, 3], y: [30, 20, 10] })).tween,
    ).toBeUndefined();
    const sampled = scatter({ x: [1, 2, 3], y: [10, 20, 30] }, { sampling: "pixel" }).model;
    expect(snapshot(sampled.scene(estimateText), sampled.panels(), 0)).toBeUndefined();
  });

  it("match numeric keys across reordered resets, entering and exiting in destination order", () => {
    const { data, model } = scatter(
      { x: [1, 2, 3], y: [10, 20, 30], id: [-0, 2, 3] },
      { itemKey: "id" },
    );
    const before = centers(pointsOf(model.scene(estimateText))[0]!);
    const { tween } = change(model, () =>
      data.reset({ x: [1, 2, 3], y: [60, 50, 40], id: [3, 0, 4] }),
    );
    const start = pointsOf(frameAt(tween!, 0))[0]!;
    const target = centers(pointsOf(tween!.scene)[0]!);
    expectRects(centers(start), [before[2]!, before[0]!, target[2]!, before[1]!]);
    expect(Array.from(start.radii!)).toEqual([2.5, 2.5, 0, 2.5]);
    const middle = centers(pointsOf(frameAt(tween!, 100))[0]!);
    expect(middle[0]![1]).toBeCloseTo(before[2]![1]! + (target[0]![1]! - before[2]![1]!) * HALF, 3);
    const end = pointsOf(frameAt(tween!, 200))[0]!;
    expectRects(centers(end).slice(0, 3), target);
    expect(end.radii![3]).toBe(0);
  });

  it("match category labels after dictionary recoding and keep snapshots independent of later scenes", () => {
    const data = table({
      x: [1, 2, 3],
      y: [10, 20, 30],
      id: encodedCategory(Int32Array.from([0, 1, 2]), ["a", "b", "c"]),
    });
    const model = chart({
      marks: [point(data, { x: "x", y: "y", itemKey: "id" })],
      x: { domain: [0, 4] },
      y: { domain: [0, 100] },
    });
    const scene = model.scene(estimateText);
    const geometry = pointsOf(scene)[0]!;
    const before = centers(geometry);
    const shown = snapshot(scene, model.panels(), 0)!;
    const copy = [...shown.panels[0]!.items.values()][0]!;
    expect(copy.kind).toBe("points");
    if (copy.kind !== "points") throw new Error("expected points");
    const ids = geometry.items!.ids as (string | undefined)[];
    expect(copy.ids).not.toBe(ids);
    ids[0] = "mutated";
    expect(copy.ids).toEqual(["a", "b", "c"]);
    data.reset({
      x: [1, 2, 3],
      y: [50, 60, 70],
      id: encodedCategory(Int32Array.from([0, 1, 2]), ["c", "a", "b"]),
    });
    const tween = plan(shown, model.scene(estimateText), model.panels(), 200, BUILDERS);
    expectRects(centers(pointsOf(frameAt(tween!, 0))[0]!), [before[2]!, before[0]!, before[1]!]);
    data.setColumn("id", ["new", "new", "new"]);
    model.scene(estimateText);
    expect(copy.ids).toEqual(["a", "b", "c"]);
  });

  it.each(["before", "after"] as const)(
    "show a series at once with invalid keys %s, without falling back to rows",
    (side) => {
      for (const bad of [
        [1, 1, 3],
        [1, Number.NaN, 3],
        [1, Infinity, 3],
      ]) {
        const { data, model } = scatter(
          { x: [1, 2, 3], y: [10, 20, 30], id: side === "before" ? bad : [1, 2, 3] },
          { itemKey: "id" },
        );
        expect(
          change(model, () => {
            data.setColumn("id", side === "after" ? bad : [1, 2, 3]);
            data.setColumn("y", [30, 20, 10]);
          }).tween,
        ).toBeUndefined();
      }
      for (const bad of [
        ["a", "a", "c"],
        ["a", null, "c"],
      ]) {
        const data = table({
          x: [1, 2, 3],
          y: [10, 20, 30],
          id: category(side === "before" ? bad : ["a", "b", "c"]),
        });
        const model = chart({
          marks: [point(data, { x: "x", y: "y", itemKey: "id" })],
          x: { domain: [0, 4] },
          y: { domain: [0, 100] },
        });
        expect(
          change(model, () => {
            data.setColumn("id", side === "after" ? bad : ["a", "b", "c"]);
            data.setColumn("y", [30, 20, 10]);
          }).tween,
        ).toBeUndefined();
      }
    },
  );

  it("scope keys and invalid-key fallback to each series, with a whole-chart fallback for moving axes", () => {
    const data = table({
      x: [1, 2, 1, 2],
      y: [10, 20, 30, 40],
      id: [1, 1, 1, 2],
      group: ["a", "a", "b", "b"],
    });
    const marks = [point(data, { x: "x", y: "y", series: "group", itemKey: "id" })];
    const fixed = chart({ marks, x: { domain: [0, 4] }, y: { domain: [0, 100] } });
    const automatic = chart({ marks });
    const old = snapshot(automatic.scene(estimateText), automatic.panels(), 0)!;
    const { tween } = change(fixed, () =>
      data.reset({
        x: [1, 2, 1, 2],
        y: [20, 10, 60, 70],
        id: [1, 1, 2, 1],
        group: ["a", "a", "b", "b"],
      }),
    );
    expect(tween!.panels[0]!.points).toHaveLength(1);
    expect(tween!.panels[0]!.points[0]!.mark.key).toContain('"b"');
    expect(centers(pointsOf(frameAt(tween!, 0))[0]!)).toEqual(centers(pointsOf(tween!.scene)[0]!));
    expect(
      plan(old, automatic.scene(estimateText), automatic.panels(), 200, BUILDERS),
    ).toBeUndefined();
  });

  it("capture no identities in static charts, and accept time keys in portable marks", () => {
    const data = table({ x: [1, 2], y: [10, 20], id: time([100, 200]) });
    const model = chart({
      marks: [
        new PointMark({ type: "point", x: "x", y: "y", itemKey: "id" }, data as unknown as Table),
      ],
    });
    expect(
      change(model, () => data.reset({ x: [1, 2], y: [30, 40], id: time([200, 100]) })).tween,
    ).toBeDefined();
    model.update({ ...model.config, animation: false });
    expect(pointsOf(model.scene(estimateText))[0]!.items).toBeUndefined();
  });

  it("require both scenes to declare the same key field and kind", () => {
    const { data, model } = scatter(
      { x: [1, 2, 3], y: [10, 20, 30], id: [1, 2, 3] },
      { itemKey: "id" },
    );
    const { shown, tween } = change(model, () => data.setColumn("y", [30, 20, 10]));
    const scene = tween!.scene;
    const panel = scene.panels[0]!;
    const mark = pointsOf(scene)[0]!;
    const items = mark.items!;
    const variants: PointItems[] = [
      { ...items, ids: new Float64Array([1, 2, 3]), key: undefined },
      { ...items, ids: new Float64Array([1, 2, 3]), key: { field: "other", kind: "number" } },
      { ...items, ids: new Float64Array([1, 2, 3]), key: { field: "id", kind: "time" } },
      { ...items, ids: ["1", "2", "3"], key: { field: "id", kind: "category" } },
    ];
    for (const identity of variants) {
      const changed = { ...scene, panels: [{ ...panel, marks: [{ ...mark, items: identity }] }] };
      expect(plan(shown, changed, model.panels(), 200, BUILDERS)).toBeUndefined();
    }
  });

  it.each([10_000, 10_001])(
    "bound %i combined retained, entering, and exiting points with fixed or moving axes",
    (combined) => {
      const extra = combined - MOVING_POINTS;
      const rows = (length: number, offset: number, factor: number) => ({
        x: Float64Array.from({ length }, (_, i) => i % 3),
        y: Float64Array.from({ length }, (_, i) => (10 + (i % 2) * 10) * factor),
        id: Float64Array.from({ length }, (_, i) => offset + i),
      });
      const first = table(rows(3000, 0, 1));
      const second = table(rows(3000, 0, 1));
      const marks = [
        point(first, { x: "x", y: "y", itemKey: "id", id: "first" }),
        point(second, { x: "x", y: "y", itemKey: "id", id: "second" }),
      ];
      const fixed = chart({ marks, x: { domain: [0, 4] }, y: { domain: [0, 100] } });
      const automatic = chart({ marks });
      const old = snapshot(automatic.scene(estimateText), automatic.panels(), 0)!;
      const before = centers(pointsOf(fixed.scene(estimateText))[0]!);
      // Each series retains 2,000 keys, loses 1,000, and gains 2,000 (or 2,001).
      // Their unions total 10,000 or 10,001, though both endpoint scenes fit.
      const { tween } = change(fixed, () => {
        first.reset(rows(4000, 1000, 2));
        second.reset(rows(4000 + extra, 1000, 2));
      });
      expect(tween).toBeDefined();
      const target = pointsOf(tween!.scene);
      expect(target.map((mark) => mark.count)).toEqual([4000, 4000 + extra]);
      expect(tween!.panels[0]!.axes).toBeUndefined();
      expect(tween!.panels[0]!.points.map(({ mark }) => mark.key)).toEqual(
        target.slice(0, extra === 0 ? 2 : 1).map((mark) => mark.key),
      );
      const expectedCounts = extra === 0 ? [5000, 5000] : [5000, 4001];
      for (const elapsed of [0, 100, 200]) {
        const frame = pointsOf(frameAt(tween!, elapsed));
        expect(frame.map((mark) => mark.count)).toEqual(expectedCounts);
        expect(frame.reduce((sum, mark) => sum + mark.count, 0)).toBeLessThanOrEqual(MOVING_POINTS);
        if (extra === 1) expect(frame[1]).toBe(target[1]);
      }
      const start = pointsOf(frameAt(tween!, 0))[0]!;
      expectRects(centers(start).slice(0, 1), [before[1000]!]);
      expect(start.radii![0]).toBe(2.5); // retained
      expect(start.radii![2000]).toBe(0); // entrant
      expect(start.radii![4000]).toBe(2.5); // exit
      const end = pointsOf(frameAt(tween!, 200))[0]!;
      expect(end.radii![2000]).toBe(2.5);
      expect(end.radii![4000]).toBe(0);

      const scene = automatic.scene(estimateText);
      expect(scene.panels[0]!.plot).toEqual(old.panels[0]!.plot);
      expect(automatic.panels()[0]!.y.domain).not.toEqual(old.panels[0]!.panel!.y.domain);
      const movingAxes = plan(old, scene, automatic.panels(), 200, BUILDERS);
      if (extra === 0) {
        expect(movingAxes!.panels[0]!.axes).toBeDefined();
        expect(movingAxes!.panels[0]!.points).toHaveLength(2);
      } else {
        expect(movingAxes).toBeUndefined();
      }
    },
  );

  it("leave out clouds, and more points than move every frame, before copying them", () => {
    const n = MOVING_POINTS + 1;
    const rows = (length: number) => ({
      x: Float64Array.from({ length }, (_, i) => i),
      y: Float64Array.from({ length }, (_, i) => i % 7),
    });
    // A series this long says nothing of its rows, so keeps no more for it.
    const long = chart({ marks: [point(table(rows(n)), { x: "x", y: "y" })] });
    const scene = long.scene(estimateText);
    expect(pointsOf(scene)[0]!.items).toBeUndefined();
    expect(snapshot(scene, long.panels(), 0)).toBeUndefined();
    // Series that are short enough, but too many together.
    const half = table(rows(Math.ceil(n / 2)));
    const model = chart({
      marks: [point(half, { x: "x", y: "y" }), point(half, { x: "x", y: "y", id: "again" })],
    });
    const shown = model.scene(estimateText);
    const copies = vi.spyOn(pointsOf(shown)[0]!.items!.ids, "slice");
    expect(snapshot(shown, model.panels(), 0)).toBeUndefined();
    expect(copies).not.toHaveBeenCalled();
    // Nor do other marks beside more points than that.
    const thresholds = table({ y: [10, 20, 30] });
    const crowded = chart({
      marks: [point(table(rows(n)), { x: "x", y: "y" }), rule(thresholds, { y: "y" })],
    });
    expect(snapshot(crowded.scene(estimateText), crowded.panels(), 0)).toBeUndefined();
    // Bars beside a cloud stay still too.
    const cloud = table({
      x: Float64Array.from({ length: CLOUD_POINTS }, (_, i) => i),
      y: Float64Array.from({ length: CLOUD_POINTS }, (_, i) => i % 7),
    });
    const beside = chart({
      marks: [
        bar(table({ x: [1, 2], y: [3, 4] }), { x: "x", y: "y" }),
        point(cloud, { x: "x", y: "y" }),
      ],
    });
    const drawn = beside.scene(estimateText, true);
    expect(pointsOf(drawn)[0]!.cloud).toBeDefined();
    expect(snapshot(drawn, beside.panels(), 0)).toBeUndefined();
  });
});

describe("lines and areas changing values", () => {
  const x = [0, 1, 2, 3, 4];
  function lines(curve?: "step-after" | "monotone") {
    const data = table({ x, y: [10, 30, 20, 40, 30] });
    const model = chart({
      marks: [line(data, { x: "x", y: "y", ...(curve && { curve }) })],
      y: { domain: [0, 100] },
    });
    return { data, model };
  }
  const pathOf = (scene: Scene) => marksOf<LineGeometry>(scene, "line")[0]!.path;

  it("move their points along y when rows keep their x positions", () => {
    const { data, model } = lines();
    const before = ys(pathOf(model.scene(estimateText)));
    const { tween } = change(model, () => data.setColumn("y", [50, 30, 60, 40, 90]));
    const after = pathOf(tween!.scene);
    expectRects([ys(pathOf(frameAt(tween!, 0)))], [before]);
    expectRects([ys(pathOf(frameAt(tween!, 200)))], [ys(after)]);
    const middle = pathOf(frameAt(tween!, 100));
    expect(xs(middle)).toEqual(xs(after));
    expect(ys(middle)[0]).toBeCloseTo(before[0]! + (ys(after)[0]! - before[0]!) * HALF, 3);
    // Rows at the same x after a reset are the same points of the line.
    expect(change(model, () => data.reset({ x, y: [10, 30, 20, 40, 30] })).tween).toBeDefined();
  });

  it("move a line along y along x, its positions staying, the x axis with it", () => {
    for (const curve of [undefined, "monotone"] as const) {
      const data = table({ y: x, v: [10, 30, 20, 40, 30] });
      const model = chart({
        marks: [line(data, { x: "v", y: "y", orient: "y", ...(curve && { curve }) })],
      });
      const before = xs(pathOf(model.scene(estimateText)));
      const { tween } = change(model, () => data.setColumn("v", [10, 30, 20, 80, 30]));
      expect(tween!.panels[0]!.traces, String(curve)).toHaveLength(1);
      // The x axis moves to the new largest value.
      expect(tween!.panels[0]!.motions.x.moves).toBe(true);
      const after = pathOf(tween!.scene);
      const middle = pathOf(frameAt(tween!, 100));
      if (!curve) {
        expect(ys(middle)).toEqual(ys(after));
        // A value that stays moves as far as its axis does.
        expect(xs(middle)[1]).toBeGreaterThan(Math.min(before[1]!, xs(after)[1]!));
        expect(xs(middle)[1]).toBeLessThan(Math.max(before[1]!, xs(after)[1]!));
      } else expect(middle.curved).toBe(true);
      expectRects([xs(pathOf(frameAt(tween!, 200)))], [xs(after)]);
    }
    // Rows whose positions move show at once.
    const data = table({ y: x, v: [10, 30, 20, 40, 30] });
    const model = chart({ marks: [line(data, { x: "v", y: "y", orient: "y" })] });
    expect(change(model, () => data.setColumn("y", [0, 1, 2, 3, 5])).tween).toBeUndefined();
  });

  it("show at once lines whose x positions, gaps, or level of detail change", () => {
    const moved = lines();
    expect(
      change(moved.model, () => moved.data.reset({ x: x.map((v) => v + 0.5), y: [1, 2, 3, 4, 5] }))
        .tween,
    ).toBeUndefined();
    const gap = lines();
    expect(
      change(gap.model, () => gap.data.setColumn("y", [10, Number.NaN, 20, 40, 30])).tween,
    ).toBeUndefined();
    // More rows than device pixels: level of detail leaves some out.
    const dense = table({
      x: Float64Array.from({ length: 4000 }, (_, i) => i),
      y: Float64Array.from({ length: 4000 }, (_, i) => Math.sin(i)),
    });
    const model = chart({ marks: [line(dense, { x: "x", y: "y" })] });
    expect(snapshot(model.scene(estimateText), model.panels(), 0)).toBeUndefined();
  });

  it("move steps through their points, and curve frames through the values between", () => {
    const steps = lines("step-after");
    steps.model.scene(estimateText);
    const step = change(steps.model, () => steps.data.setColumn("y", [50, 30, 60, 40, 90])).tween!;
    const corners = ys(pathOf(frameAt(step, 100)));
    // Each corner holds the value before it.
    for (let i = 1; i < corners.length; i += 2) expect(corners[i]).toBe(corners[i - 1]);
    // Curves go through the values between as the line curves its own:
    // never past a point's value between two points.
    const data = table({ x: [0, 1, 2], y: [0, 1, 2] });
    const model = chart({
      marks: [line(data, { x: "x", y: "y", curve: "monotone" })],
      y: { domain: [0, 10] },
    });
    const curve = change(model, () => data.setColumn("y", [2, 1, 10])).tween!;
    const middle = pathOf(frameAt(curve, 100));
    const points = new Polyline();
    for (let i = 0; i < middle.count; i++)
      points.push(middle.coords[i * 2]!, middle.coords[i * 2 + 1]!);
    const expected = new Polyline();
    monotonePolyline(points, expected);
    expect(middle.curved).toBe(true);
    expect(Array.from(middle.controls.subarray(4, 12))).toEqual(
      Array.from(expected.controls.subarray(4, 12)),
    );
    const [y0, y1] = [middle.coords[1]!, middle.coords[3]!];
    for (const control of [middle.controls[5]!, middle.controls[7]!]) {
      expect(control).toBeGreaterThanOrEqual(Math.min(y0, y1) - 1e-3);
      expect(control).toBeLessThanOrEqual(Math.max(y0, y1) + 1e-3);
    }
  });

  it("move a stack's layers together or not at all", () => {
    // A missing value leaves the bottom layer out: the one above stays with it.
    const data = table({ x, a: [10, 10, Number.NaN, 20, 20], b: [5, 5, 5, 5, 5] });
    const model = chart({
      marks: [area(data, { x: "x", y: ["a", "b"], stack: true })],
      y: { domain: [0, 100] },
    });
    expect(change(model, () => data.setColumn("a", [30, 30, Number.NaN, 40, 40])).tween).toBe(
      undefined,
    );
  });

  it("move stacked areas' shared edges together, straight or curved", () => {
    for (const curve of ["linear", "monotone"] as const) {
      const data = table({ x, a: [10, 30, 20, 40, 30], b: [5, 5, 15, 5, 5] });
      const model = chart({ marks: [area(data, { x: "x", y: ["a", "b"], stack: true, curve })] });
      const { tween } = change(model, () => data.setColumn("a", [40, 10, 50, 20, 60]));
      // Curved layers are curved together.
      expect(tween!.panels[0]!.stacks).toHaveLength(curve === "monotone" ? 1 : 0);
      for (const elapsed of [0, 30, 100, 170, 200]) {
        const [below, above] = marksOf<AreaGeometry>(frameAt(tween!, elapsed), "area");
        expect(ys(above!.lower!)).toEqual(ys(below!.upper));
        if (curve === "monotone")
          expect(Array.from(above!.lower!.controls.subarray(0, 20))).toEqual(
            Array.from(below!.upper.controls.subarray(0, 20)),
          );
      }
    }
  });

  it("curve a highlight's copies of a layer as the layer, and a series field's bands each alone", () => {
    // A band and a stack highlighted in part draw lit and dimmed copies of
    // each layer; a series field's bands are each curved alone, those that
    // touch too (a and b), where curving them together would straighten
    // one where the other could cross itself.
    const one = { t: [1, 2, 3], lo: [5, 10, 15], hi: [10, 20, 30] };
    const two = {
      t: [1, 2, 3, 1, 2, 3],
      s: ["a", "a", "a", "b", "b", "b"],
      lo: [5, 10, 15, 40, 45, 42],
      hi: [10, 20, 30, 50, 60, 55],
    };
    const touching = {
      t: [1, 2, 3, 1, 2, 3, 1, 3],
      s: ["a", "a", "a", "b", "b", "b", "c", "c"],
      lo: [0, 0, 0, 20, 80, 20, 85, 85],
      hi: [20, 80, 20, 30, 81, 90, 95, 95],
    };
    const cases = [
      ["band", one, { hi: [15, 25, 45] }, { y1: "lo", y2: "hi" }],
      ["stack", one, { hi: [15, 25, 45] }, { y: ["lo", "hi"], stack: true }],
      ["bands", two, { hi: [15, 25, 45, 55, 70, 60] }, { y1: "lo", y2: "hi", series: "s" }],
      [
        "touching bands",
        touching,
        { lo: [0, 0, 0, 30, 90, 30, 85, 85], hi: [30, 90, 30, 40, 91, 100, 95, 95] },
        { y1: "lo", y2: "hi", series: "s" },
      ],
    ] as const;
    // Edges as drawn, to a thousandth of a pixel: frames curve them again from rounded points.
    const areas = (scene: Scene) =>
      marksOf<AreaGeometry>(scene, "area").map(({ upper, lower }) =>
        [upper, lower!].flatMap((edge) => [
          ...edge.coords.subarray(0, edge.count * 2),
          ...edge.controls.subarray(0, edge.count * 4),
        ]),
      );
    const expectAreas = (actual: number[][], expected: number[][], label: string) => {
      expect(actual.length, label).toBe(expected.length);
      actual.forEach((edges, i) => {
        edges.forEach((value, k) => {
          if (Number.isNaN(expected[i]![k]!)) expect(value, label).toBeNaN();
          else expect(value, label).toBeCloseTo(expected[i]![k]!, 3);
        });
      });
    };
    for (const [name, columns, next, options] of cases)
      for (const highlighted of [false, true]) {
        const data = table(columns) as unknown as Table;
        const marks = [area(data, { x: "t", ...options, curve: "monotone" })];
        const model = chart({ x: { domain: [1, 3] }, y: { domain: [0, 100] }, marks });
        if (highlighted) {
          // Each series' first two rows.
          const store = selectionStore(data);
          const firsts = [0, 1, 3, 4].filter((row) => row < data.length);
          store.set("focus", selectRows(new RowSet(data).addAll(firsts)));
          const highlighter = new Highlighter([{ table: data, store, channel: "focus" }]);
          model.highlight = (mark, series, frame, key) =>
            highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
        }
        const before = areas(model.scene(estimateText));
        const { tween } = change(model, () => {
          for (const [field, values] of Object.entries(next)) data.setColumn(field, values);
        });
        const label = `${name}, highlighted: ${highlighted}`;
        expect(tween!.panels[0]!.stacks.length, label).toBeGreaterThan(0);
        // The frames begin and end as the scenes draw them.
        expectAreas(areas(frameAt(tween!, 0)), before, label);
        expectAreas(areas(frameAt(tween!, 200)), areas(tween!.scene), label);
        // Between, no layer's edges meet: each has its own.
        for (const { upper, lower } of marksOf<AreaGeometry>(frameAt(tween!, 100), "area"))
          expect(ys(upper), label).not.toEqual(ys(lower!));
      }
  });
});

describe("lists, rasters, and gauges changing values", () => {
  const samples = () =>
    table({
      x: [0, 1, 2, 3],
      low: [1, 3, 2, 10],
      high: [3, 5, 4, 30],
      y: [2, 4, 3, 20],
      category: ["a", "b", "a", "b"],
      note: ["one", "two", "three", "four"],
    });
  const corners = (points: Float32Array) => Array.from(points);

  it("move error bars, candles, regions, and text by their order, along the axis that changed", () => {
    const makes = [
      (data: Table) => errorbar(data as never, { x: "x", y1: "low", y2: "high" }),
      (data: Table) =>
        candlestick(data as never, { x: "x", open: "low", high: "high", low: "low", close: "y" }),
      (data: Table) => region(data as never, { y1: "low", y2: "high" }),
      (data: Table) => text(data as never, { x: "x", y: "high", label: { field: "note" } }),
      (data: Table) =>
        text(data as never, {
          x: "x",
          y: "high",
          label: { field: "note", style: { background: { fill: "#eee" } } },
        }),
    ];
    for (const [i, make] of makes.entries()) {
      const data = samples() as unknown as Table;
      const model = chart({ marks: [make(data)], y: { domain: [0, 60] } });
      const { tween } = change(model, () => data.set("high", 3, 50));
      expect(tween, `mark ${i}`).toBeDefined();
      expect(tween!.panels[0]!.lists.length, `mark ${i}`).toBeGreaterThan(0);
      for (const list of tween!.panels[0]!.lists) {
        // Halfway, each point is between its two, on the scales between.
        const middle = frameAt(tween!, 100).panels[0]!.marks[list.index]!;
        const points = list.to.map((to, k) => list.from[k]! + (to - list.from[k]!) * HALF);
        expect(middle.kind).toBe(list.mark.kind);
        const shown =
          middle.kind === "labels"
            ? (middle as LabelsGeometry).items.flatMap(({ x, y }) => [x, y])
            : middle.kind === "rect"
              ? corners(
                  Float32Array.from(
                    Array.from({ length: (middle as RectGeometry).count }, (_, r) => {
                      const [rx, ry, w, h] = (middle as RectGeometry).rects.subarray(
                        r * 4,
                        r * 4 + 4,
                      );
                      return [rx!, ry!, rx! + w!, ry! + h!];
                    }).flat(),
                  ),
                )
              : Array.from((middle as SegmentGeometry | TextGeometry).coords);
        shown.forEach((value, k) => {
          expect(value, `mark ${i}, point ${k}`).toBeCloseTo(points[k]!, 3);
        });
      }
    }
  });

  it("move a list only when its items keep their places along one axis", () => {
    const data = samples() as unknown as Table;
    const model = chart({
      marks: [text(data as never, { x: "x", y: "high", label: { field: "note" } })],
      x: { domain: [0, 4] },
      y: { domain: [0, 60] },
    });
    // A row moving along both axes has no place to tell it by.
    expect(
      change(model, () => {
        data.set("x", 1, 1.5);
        data.set("high", 1, 20);
      }).tween,
    ).toBeUndefined();
  });

  it("fade heatmap cells to their new colors, and cells coming or going in and out", () => {
    const data = table({ x: ["a", "b", "a", "b"], y: ["p", "p", "q", "q"], v: [1, 2, 3, 4] });
    const model = chart({ marks: [heatmap(data, { x: "x", y: "y", color: "v" })] });
    const raster = (scene: Scene) => marksOf<RasterGeometry>(scene, "raster")[0]!;
    const before = raster(model.scene(estimateText)).pixels.slice();
    const { tween } = change(model, () => data.set("v", 0, 2.5));
    expect(tween!.panels[0]!.rasters).toHaveLength(1);
    const after = raster(tween!.scene).pixels;
    const middle = raster(frameAt(tween!, 100)).pixels;
    middle.forEach((value, k) => {
      expect(value).toBeCloseTo(before[k]! + (after[k]! - before[k]!) * HALF, -0.5);
    });
    // A cell that goes keeps its color as it fades out.
    const gone = change(model, () => data.set("v", 1, Number.NaN)).tween!;
    const [from, to, mid] = [
      gone.panels[0]!.rasters[0]!.from,
      raster(gone.scene).pixels,
      raster(frameAt(gone, 100)).pixels,
    ];
    const cell = [...Array(from.length / 4).keys()].find((c) => to[c * 4 + 3] === 0)!;
    expect(Array.from(mid.subarray(cell * 4, cell * 4 + 3))).toEqual(
      Array.from(from.subarray(cell * 4, cell * 4 + 3)),
    );
    expect(mid[cell * 4 + 3]).toBeCloseTo(255 * (1 - HALF), -0.5);
  });

  it("turn a gauge's dial through the values between, writing them", () => {
    const data = table({ y: [30] });
    const model = chart({ marks: [gauge(data, { value: "y" })] });
    const dial = (marks: readonly Geometry[]) =>
      (marks.find((mark) => mark.key === "gauge-dial") as ArcGeometry).arcs[11]!;
    const start = dial(model.scene(estimateText).panels[0]!.marks);
    const { tween } = change(model, () => data.set("y", 0, 50));
    expect(tween!.panels[0]!.dial).toMatchObject({ from: 30, to: 50 });
    const middle = frameAt(tween!, 100).panels[0]!.marks;
    const value = middle.find((mark) => mark.key === "gauge-value") as ShapesGeometry;
    expect((value.shapes[0] as { text: string }).text).toBe(String(30 + 20 * HALF));
    const end = dial(tween!.scene.panels[0]!.marks);
    expect(dial(middle)).toBeGreaterThan(start);
    expect(dial(middle)).toBeLessThan(end);
    // A gauge whose value goes shows it at once.
    expect(change(model, () => data.set("y", 0, Number.NaN)).tween).toBeUndefined();
  });

  it("move histograms' bars by their bins", () => {
    const data = table({ v: [1, 2, 12, 22] });
    const model = chart({
      marks: [histogram(data, { x: "v", bins: [0, 10, 20, 30] })],
      y: { domain: [0, 4] },
    });
    const { tween } = change(model, () => data.set("v", 3, 3));
    expect(tween!.panels[0]!.bars).toHaveLength(1);
    // The bin a row left shrinks to the base, the one it joined grows.
    const middle = bars(frameAt(tween!, 100));
    expect(middle[0]!.count).toBe(3);
  });
});

describe("panels changing values", () => {
  const sales = () => table({ x: [0, 1, 2, 3], y: [10, 20, 30, 40], group: ["N", "N", "S", "S"] });

  it("move every subplot's marks, each on its own scales, or none", () => {
    const data = sales();
    const model = chart({
      panels: panels([{ id: "a" }, { id: "b" }]),
      marks: [
        bar(data, { x: "x", y: "y", panel: "a" }),
        line(data, { x: "x", y: "y", panel: "b" }),
      ],
    });
    const { tween } = change(model, () => data.set("y", 3, 60));
    expect(tween!.panels.map((panel) => [panel.bars.length, panel.traces.length])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    // Each panel's own y axis moves to its new domain.
    expect(tween!.panels.every((panel) => panel.motions.y.moves)).toBe(true);
    const middle = frameAt(tween!, 100);
    const final = tween!.scene;
    middle.panels.forEach((panel, i) => {
      expect(panel.key).toBe(final.panels[i]!.key);
      expect(panel.marks).not.toEqual(final.panels[i]!.marks);
    });
    // A panel whose change cannot move leaves the whole change to show at once.
    const other = sales();
    const blocked = chart({
      panels: panels([{ id: "a" }, { id: "b" }]),
      marks: [
        bar(other, { x: "x", y: "y", panel: "a" }),
        errorbar(other, { x: "x", y1: "y", y2: "y", panel: "b" }),
      ],
    });
    expect(change(blocked, () => other.set("y", 3, Number.NaN)).tween).toBeUndefined();
  });

  it("move facet panels, and panels that come or go show the change at once", () => {
    const data = sales();
    const model = chart({ marks: [bar(data, { x: "x", y: "y" })], facet: facet("group") });
    const { tween } = change(model, () => data.set("y", 0, 15));
    expect(tween!.panels.map((panel) => panel.bars.length)).toEqual([1, 1]);
    expect(change(model, () => data.set("group", 0, "E" as never)).tween).toBeUndefined();
  });

  it("move an inset's marks, painted over its parent's as the scene paints them", () => {
    const data = sales();
    const model = chart({
      panels: panels(
        panel("a", [inset("b", { width: { fraction: 0.5 }, height: { fraction: 0.5 } })]),
      ),
      marks: [
        line(data, { x: "x", y: "y", panel: "a" }),
        bar(data, { x: "x", y: "y", panel: "b" }),
      ],
    });
    const { tween } = change(model, () => data.set("y", 1, 25));
    const middle = frameAt(tween!, 100);
    expect(middle.painted).toHaveLength(tween!.scene.painted!.length);
    for (const panel of middle.painted!) expect(middle.panels).toContain(panel);
  });
});

describe("value animation", () => {
  const scene = (model: ChartModel) => model.scene(estimateText);
  const VALUES_CHANGED = { dropped: 0, appended: 0, updated: null, fields: [], reset: true };
  const APPENDED = { ...VALUES_CHANGED, appended: 1, reset: false };

  function animated() {
    const data = table({ region: ["N", "S", "E"], sales: [10, 20, 30] });
    const model = chart({
      marks: [bar(data, { x: "region", y: "sales" })],
      y: { domain: [0, 40] },
    });
    const animation = new ValueAnimation(model, null, true, BUILDERS);
    animation.start(scene(model), 0);
    return { data, model, animation };
  }

  it("play a change from when it was made, and end it when asked", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const { data, model, animation } = animated();
    const shown = scene(model);
    animation.changed(shown, VALUES_CHANGED, 0);
    data.setColumn("sales", [30, 20, 10]);
    const destination = scene(model);
    vi.spyOn(performance, "now").mockReturnValue(1100);
    const first = animation.start(destination, 0);
    expect(animation.playing).toBe(true);
    expect(first).not.toBe(destination);
    // Ended early (by a pointer, say), nothing more plays.
    expect(animation.settle()).toBe(true);
    expect(animation.step(0)).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("show appends, changes while moving, and changes soon after at once", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { data, model, animation } = animated();
    let shown = scene(model);
    animation.start(shown, 0);
    /** Whether a change to `values` moves. */
    const go = (values: number[], change: TableChange = VALUES_CHANGED) => {
      animation.changed(shown, change, 0);
      data.setColumn("sales", values);
      shown = animation.start(scene(model), 0);
      return animation.playing;
    };
    expect(go([10, 20, 35], APPENDED)).toBe(false);
    // Rows streamed in until a moment ago: still too soon.
    now.mockReturnValue(100);
    expect(go([10, 25, 35])).toBe(false);
    now.mockReturnValue(400);
    expect(go([15, 25, 35])).toBe(true);
    // A change while it moves ends it, and the next one soon after shows at once.
    now.mockReturnValue(450);
    animation.changed(undefined, VALUES_CHANGED, 0);
    expect(animation.playing).toBe(false);
    now.mockReturnValue(600);
    expect(go([5, 25, 35])).toBe(false);
    now.mockReturnValue(900);
    expect(go([5, 30, 35])).toBe(true);
    // Its last frame is the new scene.
    now.mockReturnValue(1200);
    expect(animation.step(0)).toBeDefined();
    expect(animation.playing).toBe(false);
    vi.restoreAllMocks();
  });

  it("show changes at once in slow charts, under other options, and with series hidden", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { data, model, animation } = animated();
    animation.changed(scene(model), VALUES_CHANGED, 12);
    data.setColumn("sales", [30, 20, 10]);
    animation.start(scene(model), 0);
    expect(animation.playing).toBe(false);
    clock.frame = 15;
    animation.changed(scene(model), VALUES_CHANGED, 0);
    data.setColumn("sales", [10, 20, 30]);
    animation.start(scene(model), 0);
    expect(animation.playing).toBe(false);
    clock.frame = 0;
    // Options changed since the scene on screen was built.
    const shown = animation.start(scene(model), 0);
    model.update({ ...model.config, title: "Sales" });
    animation.changed(shown, VALUES_CHANGED, 0);
    data.setColumn("sales", [30, 20, 10]);
    animation.start(scene(model), 0);
    expect(animation.playing).toBe(false);
    // So does a series hidden since: it would move away rather than go at once.
    const drawn = animation.start(scene(model), 0);
    model.hidden.add(model.series()[0]!.key);
    animation.changed(drawn, VALUES_CHANGED, 0);
    data.setColumn("sales", [10, 20, 30]);
    animation.start(scene(model), 0);
    expect(animation.playing).toBe(false);
    vi.restoreAllMocks();
  });

  it("leave out more bars than it can move every frame, before copying them", () => {
    const rows = (length: number) => ({
      x: Float64Array.from({ length }, (_, i) => i),
      y: Float64Array.from({ length }, () => 1),
    });
    // A series this long says nothing of its bars.
    const long = chart({ marks: [bar(table(rows(MOVING_ITEMS + 1)), { x: "x", y: "y" })] });
    const scene = long.scene(estimateText);
    expect(bars(scene)[0]!.bars).toBeUndefined();
    expect(snapshot(scene, long.panels(), 0)).toBeUndefined();
    // Two short enough, but too many together.
    const half = table(rows(MOVING_ITEMS / 2 + 1));
    const model = chart({
      marks: [bar(half, { x: "x", y: "y" }), bar(half, { x: "x", y: "y", id: "again" })],
    });
    const shown = model.scene(estimateText);
    const copies = vi.spyOn(bars(shown)[0]!.bars!.at, "slice");
    expect(snapshot(shown, model.panels(), 0)).toBeUndefined();
    expect(copies).not.toHaveBeenCalled();
    // Bars growing past the limit show at once beside marks that could move.
    const growing = table(rows(10));
    const mixed = chart({
      marks: [bar(growing, { x: "x", y: "y" }), point(table(rows(3)), { x: "x", y: "y" })],
      x: { domain: [-1, 2100] },
      y: { domain: [0, 2] },
    });
    expect(change(mixed, () => growing.reset(rows(MOVING_ITEMS + 1))).tween).toBeUndefined();
  });
});
