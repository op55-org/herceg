// Changes of values moving: bars and pie slices matched between two scenes
// and interpolated, evaluated at explicit times.

import { afterEach, describe, expect, it, vi } from "vitest";
import { category, encodedCategory, time } from "../../src/data/column.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { selectionStore, selectRows } from "../../src/data/selection.ts";
import { type Table, type TableChange, table } from "../../src/data/table.ts";
import { fieldReader } from "../../src/dom/tooltip-content.ts";
import { drawSectors, moveSunburst, sectorAt, sectorsOf } from "../../src/dom/value-sectors.ts";
import {
  followedOf,
  frameAt,
  MOVING_ITEMS,
  MOVING_POINTS,
  panelsAt,
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
import { sunburst } from "../../src/marks/sunburst.ts";
import { text } from "../../src/marks/text.ts";
import { planAxis } from "../../src/model/axis.ts";
import { axisGuide } from "../../src/model/axis-guide.ts";
import { facet } from "../../src/model/facet.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { clickedRows } from "../../src/model/selected-rows.ts";
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
  type SunburstSectors,
  type TextGeometry,
} from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";
import { gridAt } from "../helpers/grid.ts";
import { channelHighlighter } from "../helpers/highlight.ts";

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

const VALUES_CHANGED = { dropped: 0, appended: 0, updated: null, fields: [], reset: true };

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

  it("move stacks and labeled bars by position, bars on log axes in order, and bars sharing a position at once", () => {
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
    expect(moved.panels[0]!.labels.map(({ mark }) => mark.kind)).toEqual([
      expect.stringMatching(/text|labels/),
    ]);
    // On a log axis bars move as rectangles in their order.
    const logged = data();
    const log = chart({ marks: [bar(logged, { x: "region", y: "a" })], y: { type: "log" } });
    const ordered = change(log, () => logged.setColumn("a", [20, 10])).tween!;
    expect([ordered.panels[0]!.bars.length, ordered.panels[0]!.lists.length]).toEqual([0, 1]);
    // Two bars at one position share a name: they show their new values at
    // once, and the rest of their series moves.
    const twice = table({ region: ["N", "N", "S"], a: [10, 12, 20] });
    const model = chart({ marks: [bar(twice, { x: "region", y: "a" })], y: { domain: [0, 40] } });
    const shared = change(model, () => twice.setColumn("a", [11, 13, 25])).tween!;
    const [now, end] = [rects(bars(frameAt(shared, 100))[0]!), rects(bars(shared.scene)[0]!)];
    expectRects(now.slice(0, 2), end.slice(0, 2));
    expect(now[2]![3]).toBeGreaterThan(end[2]![3]! * 0.75);
    expect(now[2]![3]).toBeLessThan(end[2]![3]!);
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
        const highlighter = channelHighlighter([{ table: data, store, channel: "focus" }]);
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
    const highlighter = channelHighlighter([{ table: data, store, channel: "focus" }]);
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
          const highlighter = channelHighlighter([{ table: data, store, channel: "focus" }]);
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

describe("bars matched by name", () => {
  /** A race of brands on a rank scale drawn top down, ranks 0 to 2 shown. */
  function race(rows: { brand: string[]; value: number[]; rank: number[] }) {
    const data = table({ brand: category(rows.brand), value: rows.value, rank: rows.rank });
    const model = chart({
      marks: [bar(data, { itemKey: "brand", orient: "y", x: "value", y: "rank", labels: true })],
      x: { domain: [0, 100] },
      y: { domain: [2.5, -0.5] },
    });
    return { data, model };
  }
  const middle = (rect: number[]) => rect[1]! + rect[3]! / 2;

  it("move keyed bars between ranks, and bring them in and out past the last rank", () => {
    const { data, model } = race({ brand: ["A", "B", "C"], value: [90, 80, 70], rank: [0, 1, 2] });
    const { tween } = change(model, () =>
      data.reset({ brand: category(["B", "A", "D"]), value: [95, 85, 60], rank: [0, 1, 2] }),
    );
    const { plot } = tween!.scene.panels[0]!;
    const moving = tween!.panels[0]!.bars[0]!;
    expect(moving.names).toEqual(["B", "A", "D", "C"]);
    const start = rects(bars(frameAt(tween!, 0))[0]!);
    const end = rects(bars(tween!.scene)[0]!);
    // B and A trade places; D comes from wholly below the plot, C goes there.
    expect(middle(start[0]!)).toBeCloseTo(middle(end[1]!), 3);
    expect(middle(start[1]!)).toBeCloseTo(middle(end[0]!), 3);
    expect(start[2]![1]).toBeGreaterThan(plot.y + plot.height);
    const last = rects(bars(frameAt(tween!, 199.9))[0]!);
    expect(last[3]![1]).toBeGreaterThan(plot.y + plot.height - 1);
    // Entering at its new length, leaving at its old one.
    expect(start[2]![2]).toBeCloseTo(end[2]![2]!, 3);
    // Their labels move with them: D's comes up from below with its bar.
    const labels = tween!.panels[0]!.labels;
    expect(labels.flatMap(({ names }) => names).sort()).toEqual(["A", "B", "C", "D"]);
    const d = labels.find(({ names }) => names.includes("D"))!;
    const k = d.names.indexOf("D");
    expect(d.from[k * 2 + 1]! - d.to[k * 2 + 1]!).toBeCloseTo(
      middle(start[2]!) - middle(end[2]!),
      3,
    );
  });

  it("move bars on a category axis whose categories changed order, with the axis' labels", () => {
    const data = table({ region: ["N", "S", "E"], sales: [10, 20, 30] });
    const model = chart({
      marks: [bar(data, { x: "region", y: "sales" })],
      y: { domain: [0, 40] },
    });
    const before = model.scene(estimateText).panels[0]!.axes.find((a) => a.scale === "x")!;
    const { tween } = change(model, () =>
      data.reset({ region: ["E", "N", "S"], sales: [30, 10, 25] }),
    );
    expect(tween).toBeDefined();
    const at = (scene: Scene) => {
      const axis = scene.panels[0]!.axes.find((a) => a.scale === "x")!;
      return Object.fromEntries(axis.ticks.map(({ label, position }) => [label, position]));
    };
    const was = Object.fromEntries(before.ticks.map(({ label, position }) => [label, position]));
    const now = at(frameAt(tween!, 100));
    const end = at(tween!.scene);
    for (const label of ["N", "S", "E"])
      expect(now[label]).toBeCloseTo(was[label]! + (end[label]! - was[label]!) * HALF, 3);
    // E's bar travels from the right end to the left with its label.
    const [e] = rects(bars(frameAt(tween!, 100))[0]!);
    expect(e![0]! + e![2]! / 2).toBeCloseTo(now.E!, 3);
    // Categories coming or going still show the change at once.
    expect(
      change(model, () => data.reset({ region: ["E", "N", "W"], sales: [1, 2, 3] })).tween,
    ).toBeUndefined();
  });

  it("keep a thinned axis' labels under their bars when categories change order again", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const names = Array.from({ length: 60 }, (_, i) => `c${i}`);
    const reversed = [...names].reverse();
    const data = table({ name: category(names), sales: names.map((_, i) => i) });
    const model = chart({ marks: [bar(data, { x: "name", y: "sales" })], y: { domain: [0, 100] } });
    const animation = new ValueAnimation(model, null, model.scene(estimateText), BUILDERS);
    animation.changed(animation.start(model.scene(estimateText), 0), VALUES_CHANGED, 0);
    data.reset({ name: category(reversed), sales: reversed.map((_, i) => i) });
    animation.start(model.scene(estimateText), 0);
    // Values change on the way, the order kept, then the order goes back.
    now.mockReturnValue(40);
    animation.changed(animation.step(0)!, VALUES_CHANGED, 0);
    data.setColumn(
      "sales",
      reversed.map((_, i) => i / 2),
    );
    animation.start(model.scene(estimateText), 0);
    now.mockReturnValue(80);
    animation.changed(animation.step(0)!, VALUES_CHANGED, 0);
    data.reset({ name: category(names), sales: names.map((_, i) => i) });
    const first = animation.start(model.scene(estimateText), 0);
    // Each label stands under its bar, as the frame draws them.
    const [mark] = bars(first);
    const middles = new Map(
      mark!.bars!.names.map((name, i) => [name, mark!.rects[i * 4]! + mark!.rects[i * 4 + 2]! / 2]),
    );
    const axis = first.panels[0]!.axes.find((a) => a.scale === "x")!;
    for (const { label, position } of axis.ticks)
      expect(position).toBeCloseTo(middles.get(label)!, 3);
    vi.restoreAllMocks();
  });

  it("show a change at once where lines stand on categories that change order, shown or not", () => {
    for (const show of [true, false]) {
      const data = table({ region: ["N", "S", "E"], sales: [10, 20, 30] });
      const model = chart({
        marks: [bar(data, { x: "region", y: "sales" }), line(data, { x: "region", y: "sales" })],
        x: { show },
        y: { domain: [0, 40] },
      });
      expect(
        change(model, () => data.reset({ region: ["E", "N", "S"], sales: [30, 10, 20] })).tween,
      ).toBeUndefined();
    }
  });

  it("move a label the axis did not draw before, thinning its labels, from its category's band", () => {
    const names = Array.from({ length: 60 }, (_, i) => `c${i}`);
    const data = table({ name: category(names), sales: names.map((_, i) => i) });
    const model = chart({ marks: [bar(data, { x: "name", y: "sales" })], y: { domain: [0, 100] } });
    const before = model.scene(estimateText).panels[0]!.axes.find((a) => a.scale === "x")!;
    const labeled = new Set(before.ticks.map(({ label }) => label));
    expect(labeled.size).toBeLessThan(names.length);
    const reversed = [...names].reverse();
    const { tween } = change(model, () =>
      data.reset({ name: category(reversed), sales: reversed.map((_, i) => i) }),
    );
    const end = tween!.scene.panels[0]!.axes.find((a) => a.scale === "x")!;
    const tick = end.ticks.find(({ label }) => !labeled.has(label))!;
    const bar0 = rects(bars(frameAt(tween!, 0))[0]!)[tick.value]!;
    const start = frameAt(tween!, 0).panels[0]!.axes.find((a) => a.scale === "x")!;
    // At the start, the label stands under its bar, where its band was.
    expect(start.ticks.find(({ label }) => label === tick.label)!.position).toBeCloseTo(
      bar0[0]! + bar0[2]! / 2,
      3,
    );
  });

  it("bring a bar going back from where it is, show shared names at once, and match missing ones in place only", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { data, model } = race({ brand: ["A", "B", "C"], value: [90, 80, 70], rank: [0, 1, 2] });
    const animation = new ValueAnimation(model, null, model.scene(estimateText), BUILDERS);
    animation.changed(animation.start(model.scene(estimateText), 0), VALUES_CHANGED, 0);
    data.reset({ brand: category(["B", "A", "D"]), value: [95, 85, 60], rank: [0, 1, 2] });
    animation.start(model.scene(estimateText), 0);
    now.mockReturnValue(100);
    // C halfway out comes back from there.
    const passing = animation.step(0)!;
    animation.changed(passing, VALUES_CHANGED, 0);
    data.reset({ brand: category(["C", "B", "A"]), value: [99, 95, 85], rank: [0, 1, 2] });
    const first = animation.start(model.scene(estimateText), 0);
    const was = bars(passing)[0]!;
    const c = was.bars!.names.indexOf("C");
    expect(bars(first)[0]!.bars!.names.slice(0, 3)).toEqual(["C", "B", "A"]);
    expectRects(rects(bars(first)[0]!).slice(0, 1), rects(was).slice(c, c + 1));
    animation.settle();
    vi.restoreAllMocks();

    // A name two bars share shows them at once; the rest move.
    const shared = change(model, () =>
      data.reset({ brand: category(["A", "A", "C"]), value: [50, 40, 30], rank: [0, 1, 2] }),
    ).tween!;
    const start = rects(bars(frameAt(shared, 0))[0]!);
    const end = rects(bars(shared.scene)[0]!);
    expectRects(start.slice(0, 2), end.slice(0, 2));
    expect(start[2]).not.toEqual(end[2]);

    // A bar missing its key matches its row while the table keeps its rows, not across a reset.
    const missing = race({
      brand: ["A", null as never, "C"],
      value: [90, 80, 70],
      rank: [0, 1, 2],
    });
    const inPlace = change(missing.model, () => missing.data.setColumn("value", [60, 50, 40]))
      .tween!;
    expect(inPlace.panels[0]!.bars[0]!.count).toBe(3);
    const reset = change(missing.model, () =>
      missing.data.reset({
        brand: category(["A", null, "C"]),
        value: [30, 20, 10],
        rank: [0, 1, 2],
      }),
    ).tween!;
    // The bar without a key goes and its new one comes.
    expect(reset.panels[0]!.bars[0]!.count).toBe(4);
  });

  it("count a label that came on from the number it shows when values change again", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { data, model } = race({ brand: ["A", "B", "C"], value: [90, 80, 70], rank: [0, 1, 2] });
    const animation = new ValueAnimation(model, null, model.scene(estimateText), BUILDERS);
    animation.changed(animation.start(model.scene(estimateText), 0), VALUES_CHANGED, 0);
    data.reset({ brand: category(["B", "A", "D"]), value: [95, 85, 60], rank: [0, 1, 2] });
    animation.start(model.scene(estimateText), 0);
    now.mockReturnValue(100);
    /** The number the label named `name` writes in `scene`. */
    const numberOf = (scene: Scene, name: string) => {
      for (const mark of scene.panels[0]!.marks) {
        const record = (mark as TextGeometry).named;
        const k = record?.names.indexOf(name) ?? -1;
        if (k >= 0) return record!.values![k];
      }
      return undefined;
    };
    const passing = animation.step(0)!;
    expect(numberOf(passing, "D")).toBe(60);
    animation.changed(passing, VALUES_CHANGED, 0);
    data.reset({ brand: category(["D", "B", "A"]), value: [99, 95, 85], rank: [0, 1, 2] });
    // D's label starts from 60, as it shows, not at 99.
    expect(numberOf(animation.start(model.scene(estimateText), 0), "D")).toBe(60);
    vi.restoreAllMocks();
  });

  it("take a going bar's label out with it when its key is missing, across a reset", () => {
    const { data, model } = race({
      brand: ["A", null as never, "C"],
      value: [90, 80, 70],
      rank: [0, 1, 2],
    });
    const { tween } = change(model, () =>
      data.reset({ brand: category(["A", null, "C"]), value: [95, 60, 75], rank: [0, 2, 1] }),
    );
    const frame = frameAt(tween!, 100);
    const [mark] = bars(frame);
    // The bar without a key going, last; and the label writing its value.
    const gone = mark!.count - 1;
    const middle = mark!.rects[gone * 4 + 1]! + mark!.rects[gone * 4 + 3]! / 2;
    const labels = frame.panels[0]!.marks.find(
      (m): m is LabelsGeometry | TextGeometry => !!(m as TextGeometry).named,
    )!;
    const k = Array.from(labels.named!.values!).indexOf(80);
    const y = labels.kind === "text" ? labels.coords[k * 2 + 1]! : labels.named!.at![k * 2 + 1]!;
    expect(y).toBeCloseTo(middle, 0);
    // In frames it is named as its bar, apart from the bar coming in its row's name.
    expect(labels.named!.names[k]).toBe(mark!.bars!.names[gone]);
    expect(labels.named!.names.filter((name) => name === labels.named!.names[k])).toHaveLength(1);
  });

  it("match a keyless bar's label by its row when labels of an older table go meanwhile", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { data, model } = race({
      brand: ["A", null as never, "C"],
      value: [60, 60, 60],
      rank: [0, 1, 2],
    });
    const animation = new ValueAnimation(model, null, model.scene(estimateText), BUILDERS);
    animation.changed(animation.start(model.scene(estimateText), 0), VALUES_CHANGED, 0);
    data.reset({ brand: category(["A", null, "C"]), value: [99, 99, 99], rank: [0, 1, 2] });
    animation.start(model.scene(estimateText), 0);
    now.mockReturnValue(40);
    /** The number written by the label of the keyless bar of the table as it is. */
    const keyless = (scene: Scene) => {
      for (const mark of scene.panels[0]!.marks) {
        const record = (mark as TextGeometry).named;
        const k = record?.names.findIndex(
          (name) => typeof name === "string" && name[0] === "\u0000" && name[1] !== "-",
        );
        if (record && k !== undefined && k >= 0) return record.values![k];
      }
      return undefined;
    };
    const passing = animation.step(0)!;
    animation.changed(passing, VALUES_CHANGED, 0);
    data.setColumn("value", [20, 20, 20]);
    // It counts on from where it is, not at once to 20.
    expect(keyless(animation.start(model.scene(estimateText), 0))).toBe(keyless(passing));
    vi.restoreAllMocks();
  });

  it("keep a label coming at its bar's middle as the bar grows, stacked", () => {
    const data = table({ region: ["N", "N"], kind: ["a", "b"], sales: [40, Number.NaN] });
    const model = chart({
      marks: [bar(data, { x: "region", y: "sales", series: "kind", stack: true, labels: true })],
      y: { domain: [0, 100] },
      legend: false,
    });
    const { tween } = change(model, () => data.setColumn("sales", [40, 50]));
    const frame = frameAt(tween!, 40);
    const grown = bars(frame).find((mark) => mark.key.includes('"b"'))!;
    const middle = grown.rects[1]! + grown.rects[3]! / 2;
    const labels = frame.panels[0]!.marks.filter(
      (m): m is LabelsGeometry | TextGeometry => !!(m as TextGeometry).named,
    );
    const label = labels.find((m) => m.named!.values![0] === 50)!;
    const y = label.kind === "text" ? label.coords[1]! : label.named!.at![1]!;
    expect(y).toBeCloseTo(middle, 0);
  });

  it("keep where a label's text starts as it moves into its bar, and cut bars' labels to the plot", () => {
    const { data, model } = race({ brand: ["A", "B", "C"], value: [60, 50, 40], rank: [0, 1, 2] });
    const labelOf = (scene: Scene, name: string) => {
      for (const mark of scene.panels[0]!.marks) {
        const record = (mark as TextGeometry).named;
        const k = record?.names.indexOf(name) ?? -1;
        if (k >= 0) return { mark: mark as TextGeometry, start: record!.starts![k]! };
      }
      throw new Error(`no label of ${name}`);
    };
    const before = labelOf(model.scene(estimateText), "A");
    const { tween } = change(model, () => data.setColumn("value", [99, 50, 40]));
    const after = labelOf(tween!.scene, "A");
    // Past its tip before, inside it after: anchored otherwise.
    expect(after.mark.anchor).not.toBe(before.mark.anchor);
    const start = labelOf(frameAt(tween!, 0), "A");
    expect(start.start).toBeCloseTo(before.start, 3);
    expect(start.mark.clip).toBe("plot");
  });

  it("keep where a label of parts starts as it moves into its bar", () => {
    const data = table({ brand: category(["A", "B"]), value: [60, 50], rank: [0, 1] });
    const model = chart({
      marks: [
        bar(data, {
          itemKey: "brand",
          orient: "y",
          x: "value",
          y: "rank",
          labels: { content: [{ value: true, style: { fontWeight: 700 } }] },
        }),
      ],
      x: { domain: [0, 100] },
      y: { domain: [1.5, -0.5] },
    });
    // Where label A's text starts: its first run's place (runs are placed from their start).
    const startOf = (scene: Scene) => {
      for (const mark of scene.panels[0]!.marks) {
        const { named } = mark as LabelsGeometry;
        const k = mark.kind === "labels" ? (named?.names.indexOf("A") ?? -1) : -1;
        if (k >= 0)
          return Math.min(
            ...(mark as LabelsGeometry).items
              .filter((_, i) => named!.owners![i] === k)
              .map(({ x }) => x),
          );
      }
      throw new Error("no label of A");
    };
    const before = startOf(model.scene(estimateText));
    const { tween } = change(model, () => data.setColumn("value", [99, 50]));
    // Past its tip before, inside it after; it writes 60 at first, from where it started.
    expect(startOf(tween!.scene)).not.toBeCloseTo(before, 0);
    expect(startOf(frameAt(tween!, 0))).toBeCloseTo(before, 3);
  });

  it("keep a label anchored as it was where it stands, as its number widens", () => {
    const data = table({ k: ["a", "b"], v: [9, 50] });
    const model = chart({
      marks: [bar(data, { x: "k", y: "v", labels: true })],
      y: { domain: [0, 150] },
    });
    const placeOf = (scene: Scene) => {
      for (const mark of scene.panels[0]!.marks) {
        const record = (mark as TextGeometry | LabelsGeometry).named;
        const k = record?.names.indexOf("a") ?? -1;
        if (k < 0) continue;
        const at = mark.kind === "text" ? (mark as TextGeometry).coords : record!.at!;
        return at[k * 2]!;
      }
      throw new Error("no label of a");
    };
    const before = placeOf(model.scene(estimateText));
    const { tween } = change(model, () => data.setColumn("v", [100, 50]));
    // "9" is as wide as it was at first, and goes on standing where it stood.
    expect(placeOf(frameAt(tween!, 0))).toBeCloseTo(before, 3);
    expect(placeOf(tween!.scene)).toBeCloseTo(before, 3);
  });

  it("bring keyed bars in past the right end of a continuous x axis", () => {
    const data = table({ id: category(["a", "b"]), at: [1, 2], value: [10, 20] });
    const model = chart({
      marks: [bar(data, { itemKey: "id", x: "at", y: "value" })],
      x: { domain: [0, 4] },
      y: { domain: [0, 40] },
    });
    const { tween } = change(model, () =>
      data.reset({ id: category(["b", "c"]), at: [1, 2], value: [20, 30] }),
    );
    const { plot } = tween!.scene.panels[0]!;
    const start = rects(bars(frameAt(tween!, 0))[0]!);
    const end = rects(bars(tween!.scene)[0]!);
    // b moves left a place; c comes from past the right end, a goes there.
    expect(start[0]![0]).toBeGreaterThan(end[0]![0]!);
    expect(start[1]![0]).toBeGreaterThan(plot.x + plot.width);
    expect(rects(bars(frameAt(tween!, 199.9))[0]!)[2]![0]).toBeGreaterThan(plot.x + plot.width - 1);
  });

  it("bring the bars of a series that came", () => {
    const data = table({ region: ["N", "S"], kind: ["a", "a"], sales: [10, 20] });
    const model = chart({
      marks: [bar(data, { x: "region", y: "sales", series: "kind" })],
      y: { domain: [0, 40] },
      // A legend appearing would move the plot, which shows at once.
      legend: false,
    });
    const { tween } = change(model, () =>
      data.reset({ region: ["N", "S", "N"], kind: ["a", "a", "b"], sales: [15, 25, 5] }),
    );
    const [kept, came] = tween!.panels[0]!.bars;
    expect(kept!.names).toEqual(["N", "S"]);
    // The new series' bar grows from its root.
    expect(came!.from[3]).toBeCloseTo(came!.from[2]!, 3);
    expect(came!.to[3]).not.toBeCloseTo(came!.to[2]!, 3);
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

  it("show at once a change drawing more slices than move every frame, those going counted", () => {
    for (const [count, moves] of [
      [900, true],
      [1100, false],
    ] as const) {
      const names = (from: number) => Array.from({ length: count }, (_, i) => `r${from + i}`);
      const data = table({ region: names(0), sales: names(0).map(() => 1) });
      const model = chart({
        marks: [pie(data, { category: "region", value: "sales", labels: false })],
        legend: false,
      });
      // Every slice goes and as many come.
      const { tween } = change(model, () =>
        data.reset({ region: names(count), sales: names(0).map(() => 1) }),
      );
      expect(tween !== undefined).toBe(moves);
    }
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

describe("sunbursts changing values and drill roots", () => {
  const rows = (sizes: number[]) => ({
    top: ["a", "a", "a", "b", "b", "c"],
    leaf: ["a1", "a2", "a3", "b1", "b2", "c1"],
    size: sizes,
  });
  function burst() {
    const data = table(rows([10, 20, 30, 15, 25, 40]));
    const model = chart({
      marks: [sunburst(data, { id: "tree", path: ["top", "leaf"], value: "size" })],
      legend: false,
    });
    return { data, model };
  }
  const recordOf = (scene: Scene) =>
    (scene.panels[0]!.marks.find((m) => (m as ArcGeometry).sectors) as ArcGeometry).sectors!;
  const byKey = (scene: Scene) => new Map(sectorsOf(recordOf(scene)).map((s) => [s.key, s]));

  it("move sectors matched by path to new angles, drawn whole each frame", () => {
    const { data, model } = burst();
    const before = byKey(model.scene(estimateText));
    const { tween } = change(model, () => data.setColumn("size", [40, 20, 30, 15, 25, 10]));
    expect(tween!.panels[0]!.sunburst).toBeDefined();
    const middle = byKey(frameAt(tween!, 100));
    const after = byKey(tween!.scene);
    for (const [key, sector] of after) {
      const was = before.get(key)!;
      expect(middle.get(key)!.end).toBeCloseTo(was.end + (sector.end - was.end) * HALF, 6);
    }
    // Its items for getItems and decorations are the frame's.
    const items = frameAt(tween!, 100).panels[0]!.items!.list!();
    const a = items.find(({ names }) => names.join() === "a")!;
    expect(a.sector!.endAngle).toBeCloseTo(middle.get(a.key)!.end * 2 * Math.PI, 6);
  });

  it("make a scene's sectors as it drew them, though its table changed since", () => {
    const data = table({
      top: ["a", "a", "a", "b"],
      mid: ["a1", "a1", "a2", "b1"],
      leaf: ["x", "y", "z", "w"],
      size: [1, 2, 3, 4],
    });
    const model = chart({
      marks: [sunburst(data, { id: "tree", path: ["top", "mid", "leaf"], value: "size" })],
      legend: false,
    });
    model.scene(estimateText);
    // Two levels down, the middle's parent is a node of the whole tree.
    model.items!.setDrillRoot(["a", "a1"]);
    const record = recordOf(model.scene(estimateText));
    const described = () =>
      sectorsOf(record).map(({ key, parent, info }) => [key, parent, info?.().parent]);
    const drawn = described();
    expect(drawn[0]![1]).toBe(JSON.stringify(["tree", "a"]));
    data.reset({ top: ["c"], mid: ["c1"], leaf: ["v"], size: [1] });
    expect(described()).toEqual(drawn);
  });

  it("drill in: the node takes the middle, its children the circle, and siblings squeeze out", () => {
    const { model } = burst();
    const shown = snapshot(model.scene(estimateText), model.panels(), 0)!;
    const before = new Map(sectorsOf(shown.panels[0]!.sunburst!).map((s) => [s.key, s]));
    const a = [...before.values()].find((s) => s.info?.().label === "a")!;
    model.items!.setDrillRoot(["a"]);
    const scene = model.scene(estimateText);
    const tween = plan(shown, scene, model.panels(), 200, BUILDERS)!;
    const moving = tween.panels[0]!.sunburst!;
    const at = (key: string) => moving.sectors.findIndex((s) => s.key === key);
    // "a" moves from its sector in the first ring to the middle disc.
    const k = at(a.key) * 7;
    expect([...moving.from.subarray(k, k + 4)]).toEqual([a.start, a.end, a.inner, a.outer]);
    expect([...moving.to.subarray(k, k + 4)]).toEqual([0, 1, 0, 1]);
    // Its children go from inside its old angles to the whole circle.
    const drawn = sectorsOf(recordOf(scene)).find((s) => s.info?.().label === "a / a1")!;
    const child = before.get(drawn.key)!;
    const c = at(child.key) * 7;
    expect(moving.from[c]).toBeCloseTo(child.start, 9);
    expect(moving.to[c]).toBeCloseTo(drawn.start, 9);
    expect(child.end - child.start).toBeLessThan(drawn.end - drawn.start);
    // "b", a sibling, is pushed past the circle's end: it squeezes to the edge.
    const b = [...before.values()].find((s) => s.info?.().label === "b")!;
    const s = at(b.key) * 7;
    expect(moving.to[s]).toBeGreaterThanOrEqual(1);
    // And back out again: "b" comes in from past the edge.
    const drilled = snapshot(scene, model.panels(), 0)!;
    model.items!.setDrillRoot(null);
    const back = plan(drilled, model.scene(estimateText), model.panels(), 200, BUILDERS)!;
    const out = back.panels[0]!.sunburst!;
    const j = out.sectors.findIndex(({ key }) => key === b.key) * 7;
    expect(out.from[j]).toBeGreaterThanOrEqual(1);
    expect(out.to[j]).toBeCloseTo(b.start, 9);
  });

  it("fade labels shown at one end only, and move the rest with their sectors", () => {
    const { data, model } = burst();
    const { tween } = change(model, () => data.setColumn("size", [1, 1, 1, 1, 1, 400]));
    const moving = tween!.panels[0]!.sunburst!;
    // Labels of sectors grown too thin go out; the frame halfway draws them fading.
    const fading = moving.sectors.findIndex(
      (_, i) => moving.from[i * 7 + 5] === 1 && moving.to[i * 7 + 5] === 0,
    );
    expect(fading).toBeGreaterThanOrEqual(0);
    const frame = byKey(frameAt(tween!, 100)).get(moving.sectors[fading]!.key)!;
    expect(frame.shown).toBeCloseTo(1 - HALF, 6);
  });

  it("keep sectors going as items while drawn, and point at and outline them where frames draw them", () => {
    const { model } = burst();
    const shown = snapshot(model.scene(estimateText), model.panels(), 0)!;
    const result = model.items!.result()!;
    const outlineOf = (names: string) => {
      const was = sectorsOf(shown.panels[0]!.sunburst!).find((s) => s.info?.().label === names)!;
      return result.item(result.indexOf(was.key)).outline;
    };
    const before = outlineOf("b");
    model.items!.setDrillRoot(["a"]);
    const tween = plan(shown, model.scene(estimateText), model.panels(), 200, BUILDERS)!;
    const frame = frameAt(tween, 40);
    const { list, pick } = frame.panels[0]!.items!;
    // "b", squeezing out, is still an item of the frame.
    const b = list!().find(({ names }) => names.join() === "b")!;
    expect(b).toBeDefined();
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle } = b.sector!;
    const [middle, along] = [(startAngle + endAngle) / 2, (innerRadius + outerRadius) / 2];
    const [px, py] = [cx + along * Math.sin(middle), cy - along * Math.cos(middle)];
    const item = pick!(px, py)!;
    expect(item.key).toBe(b.key);
    // Its tooltip points at it, and its outline is where the frame draws it.
    expect(item.px).toBeCloseTo(px, 6);
    expect(item.py).toBeCloseTo(py, 6);
    expect(item.outline).toMatch(/^M/);
    expect(item.outline).not.toBe(before);
  });

  it("give sectors going their rows and tooltip fields while a drill draws them", () => {
    const data = table({
      ...rows([10, 20, 30, 15, 25, 40]),
      note: ["n0", "n1", "n2", "n3", "n4", "n5"],
    }) as unknown as Table;
    const model = chart({
      marks: [
        sunburst(data, {
          id: "tree",
          path: ["top", "leaf"],
          value: "size",
          tooltip: { fields: ["note"] },
        }),
      ],
      legend: false,
    });
    model.fields = fieldReader;
    const shown = snapshot(model.scene(estimateText), model.panels(), 0)!;
    model.items!.setDrillRoot(["a"]);
    const tween = plan(shown, model.scene(estimateText), model.panels(), 750, BUILDERS)!;
    const frame = frameAt(tween, 100);
    const items = model.items!;
    items.transitionItems = new Map(frame.panels.map((p) => [p.key, p.items!.pick!]));
    // "b / b1", squeezing out, is read and clicked where the frame draws it.
    const b1 = frame.panels[0]!.items!.list!().find(({ names }) => names.join() === "b,b1")!;
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle } = b1.sector!;
    const [middle, along] = [(startAngle + endAngle) / 2, (innerRadius + outerRadius) / 2];
    const [px, py] = [cx + along * Math.sin(middle), cy - along * Math.cos(middle)];
    const inspection = model.inspect(px, py)!;
    expect(inspection.axis === "item" && inspection.key).toBe(b1.key);
    expect(inspection.points[0]!.fields?.map(({ text }) => text)).toEqual(["n3"]);
    expect([...(clickedRows(model, new Set([data]), px, py)?.rows ?? [])]).toEqual([3]);
    // Once it ends, keys the tree drawn leaves out have no rows again.
    items.transitionItems = undefined;
    expect(items.rowsOfItem(b1.key, data)?.rows).toEqual([]);
  });

  it("pick nothing in the gaps frames leave between sectors", () => {
    const data = table(rows([10, 20, 30, 15, 25, 40]));
    const model = chart({
      marks: [
        sunburst(data, {
          id: "tree",
          path: ["top", "leaf"],
          value: "size",
          gap: { radial: 20, angular: 10 },
        }),
      ],
      legend: false,
    });
    const { tween } = change(model, () => data.setColumn("size", [40, 20, 30, 15, 25, 10]));
    const { list, pick } = frameAt(tween!, 0).panels[0]!.items!;
    const a = list!().find(({ names }) => names.join() === "a")!;
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle } = a.sector!;
    const middle = (startAngle + endAngle) / 2;
    const at = (radius: number) =>
      pick!(cx + radius * Math.sin(middle), cy - radius * Math.cos(middle))?.key;
    expect(at((innerRadius + outerRadius) / 2)).toBe(a.key);
    // Inside its ring's edge, in the gap between rings, as drawn.
    expect(at(innerRadius + 5)).toBeUndefined();
  });

  it("keep labels along the radius upright as their sectors change halves", () => {
    const data = table({ top: ["a", "b", "c"], size: [80, 10, 10] });
    const model = chart({
      marks: [sunburst(data, { path: ["top"], value: "size", labels: { rotation: "radial" } })],
      legend: false,
    });
    const angleOf = (scene: Scene) =>
      sectorsOf(recordOf(scene)).find(({ info }) => info?.().label === "a")!.label!;
    const labelAngle = (scene: Scene) =>
      (scene.panels[0]!.marks.find((m) => m.kind === "labels") as LabelsGeometry).items.find(
        ({ text }) => text === "a",
      )!.angle;
    const before = labelAngle(model.scene(estimateText));
    expect(angleOf(model.scene(estimateText)).turns).toBe(true);
    const { tween } = change(model, () => data.setColumn("size", [10, 80, 10]));
    // At the start, the label is drawn as before, not turned half a turn.
    expect((labelAngle(frameAt(tween!, 0)) - before + 360) % 360).toBeCloseTo(0, 6);
  });

  it("turn a label between along the radius and level as its sector takes or leaves the middle", () => {
    const data = table(rows([10, 20, 30, 15, 25, 40]));
    const model = chart({
      marks: [
        sunburst(data, {
          id: "tree",
          path: ["top", "leaf"],
          value: "size",
          labels: { rotation: "radial" },
        }),
      ],
      legend: false,
    });
    // A label's angle, within a quarter turn of level.
    const angleOf = (scene: Scene) => {
      const labels = scene.panels[0]!.marks.filter((m) => m.kind === "labels") as LabelsGeometry[];
      const angle = labels.flatMap(({ items }) => items).find(({ text }) => text === "a")!.angle;
      return (((((angle % 180) + 270) % 180) + 180) % 180) - 90;
    };
    const whole = model.scene(estimateText);
    const shown = snapshot(whole, model.panels(), 0)!;
    model.items!.setDrillRoot(["a"]);
    const drilled = model.scene(estimateText);
    const into = plan(shown, drilled, model.panels(), 200, BUILDERS)!;
    // Drilling in, it starts along the radius, as drawn, and ends level in the middle.
    expect(angleOf(frameAt(into, 0))).toBeCloseTo(angleOf(whole), 6);
    expect(angleOf(drilled)).toBeCloseTo(0, 6);
    expect(Math.abs(angleOf(frameAt(into, 100)))).toBeGreaterThan(0.5);
    // Going back up, it starts level and ends along the radius.
    const back = snapshot(drilled, model.panels(), 0)!;
    model.items!.setDrillRoot(null);
    const out = plan(back, model.scene(estimateText), model.panels(), 200, BUILDERS)!;
    expect(angleOf(frameAt(out, 0))).toBeCloseTo(0, 6);
    expect(angleOf(frameAt(out, 200))).toBeCloseTo(angleOf(whole), 6);
  });

  it("draw frames with the gaps between rings, labels or not", () => {
    const data = table(rows([10, 20, 30, 15, 25, 40]));
    const model = chart({
      marks: [
        sunburst(data, {
          id: "tree",
          path: ["top", "leaf"],
          value: "size",
          gap: { radial: 20 },
          labels: false,
        }),
      ],
      legend: false,
    });
    const radii = (scene: Scene) => {
      const arcs = scene.panels[0]!.marks.filter((m) => m.kind === "arc") as ArcGeometry[];
      const all = arcs.flatMap(({ arcs, count }) =>
        Array.from(
          { length: count },
          (_, i) => `${arcs[i * 6 + 2]!.toFixed(3)}-${arcs[i * 6 + 3]!.toFixed(3)}`,
        ),
      );
      return [...new Set(all)].sort();
    };
    const before = radii(model.scene(estimateText));
    const { tween } = change(model, () => data.setColumn("size", [40, 20, 30, 15, 25, 10]));
    expect(radii(frameAt(tween!, 0))).toEqual(before);
  });

  it("fade the drilled node in and out of a middle left empty", () => {
    const data = table(rows([10, 20, 30, 15, 25, 40]));
    const model = chart({
      marks: [sunburst(data, { id: "tree", path: ["top", "leaf"], value: "size", center: false })],
      legend: false,
    });
    const shown = snapshot(model.scene(estimateText), model.panels(), 0)!;
    const a = sectorsOf(shown.panels[0]!.sunburst!).find((s) => s.info?.().label === "a")!;
    model.items!.setDrillRoot(["a"]);
    const drilled = model.scene(estimateText);
    const into = plan(shown, drilled, model.panels(), 200, BUILDERS)!.panels[0]!.sunburst!;
    const k = into.sectors.findIndex(({ key }) => key === a.key) * 7;
    // Going into the empty middle, it fades out.
    expect([into.from[k + 4], into.to[k + 4]]).toEqual([a.opacity, 0]);
    const back = snapshot(drilled, model.panels(), 0)!;
    model.items!.setDrillRoot(null);
    const out = plan(back, model.scene(estimateText), model.panels(), 200, BUILDERS)!.panels[0]!
      .sunburst!;
    const j = out.sectors.findIndex(({ key }) => key === a.key) * 7;
    // Coming back out of it, it fades in.
    expect(out.from[j + 4]).toBe(0);
    expect(out.to[j + 4]).toBe(a.opacity);
  });

  it("pick the sector painted last where two overlap", () => {
    const { model } = burst();
    const record = recordOf(model.scene(estimateText));
    const [first, second, third] = sectorsOf(record).filter(
      ({ inner, fill }) => inner === 1 && fill,
    );
    // All three over the same angles, in this order, the first and last of
    // one color: the last is painted over the others.
    const overlapping = [first!, second!, { ...third!, fill: first!.fill }].map((sector) => ({
      ...sector,
      start: 0.1,
      end: 0.3,
    }));
    const drawn = drawSectors(record, overlapping, record);
    const arcs = drawn.filter((m) => m.kind === "arc") as ArcGeometry[];
    expect(arcs.map(({ colors }) => colors[0])).toEqual([first!.fill, second!.fill, first!.fill]);
    // From 12 o'clock, clockwise.
    const middle = -Math.PI / 2 + 0.2 * 2 * Math.PI;
    const along = record.hole + record.ring / 2;
    const item = sectorAt(
      record,
      overlapping,
      record,
      record.cx + along * Math.cos(middle),
      record.cy + along * Math.sin(middle),
    );
    expect(item?.key).toBe(third!.key);
  });

  it("label no sector past the turn's end, and move the sunburst as breadcrumbs come", () => {
    const { model } = burst();
    const whole = model.scene(estimateText);
    const shown = snapshot(whole, model.panels(), 0)!;
    model.items!.setDrillRoot(["a"]);
    const drilled = model.scene(estimateText);
    const into = plan(shown, drilled, model.panels(), 200, BUILDERS)!;
    // Breadcrumbs take room above it: its center and size move there.
    const shape = ({ cx, cy, radius }: SunburstSectors) => [cx, cy, radius];
    expect(shape(recordOf(drilled))).not.toEqual(shape(recordOf(whole)));
    expect(shape(recordOf(frameAt(into, 0)))).toEqual(shape(recordOf(whole)));
    expect(shape(recordOf(frameAt(into, 200)))).toEqual(shape(recordOf(drilled)));
    // Going back up, "c" comes from past the turn's end, its labels with it once it shows.
    const back = snapshot(drilled, model.panels(), 0)!;
    model.items!.setDrillRoot(null);
    const out = plan(back, model.scene(estimateText), model.panels(), 200, BUILDERS)!;
    const frame = frameAt(out, 40);
    const c = sectorsOf(recordOf(frame)).find(({ info }) => info?.().label === "c")!;
    expect(c.start).toBeGreaterThan(1);
    const texts = (frame.panels[0]!.marks.filter((m) => m.kind === "labels") as LabelsGeometry[])
      .flatMap(({ items }) => items)
      .map(({ text }) => text);
    expect(texts).not.toContain("c");
    // Nor is it an item, which decorations would be placed by.
    expect(frame.panels[0]!.items!.list!().some(({ key }) => key === c.key)).toBe(false);
  });

  it("list no sector thinner than the gap between rings", () => {
    const data = table(rows([10, 20, 30, 15, 25, 40]));
    const model = chart({
      marks: [
        sunburst(data, { id: "tree", path: ["top", "leaf"], value: "size", gap: { radial: 20 } }),
      ],
      legend: false,
    });
    const { tween } = change(model, () =>
      data.setColumn("leaf", ["a1", "a2", "a4", "b1", "b2", "c1"]),
    );
    const listed = (elapsed: number) =>
      frameAt(tween!, elapsed).panels[0]!.items!.list!().some(
        ({ names }) => names.join() === "a,a4",
      );
    // Growing out of "a", it is listed once it shows between the gaps.
    expect(listed(5)).toBe(false);
    expect(listed(200)).toBe(true);
  });

  it("refuse transitions drawing more sectors than the budget, before making them", () => {
    const many = Array.from({ length: 2100 }, (_, i) => `n${i}`);
    const data = table({ top: many, size: many.map(() => 1) });
    const model = chart({
      marks: [sunburst(data, { path: ["top"], value: "size" })],
      legend: false,
    });
    const big = recordOf(model.scene(estimateText));
    expect(moveSunburst(big, big, 2000)).toBeUndefined();
    const { model: small } = burst();
    const shown = snapshot(small.scene(estimateText), small.panels(), 0)!;
    small.items!.setDrillRoot(["a"]);
    const next = recordOf(small.scene(estimateText));
    const record = shown.panels[0]!.sunburst!;
    expect(moveSunburst(record, next, 2000)).toBeDefined();
    expect(moveSunburst(record, next, sectorsOf(next).length)).toBeUndefined();
    // The big sunburst is not copied: its changes show at once.
    expect(snapshot(model.scene(estimateText), model.panels(), 0)).toBeUndefined();
  });
});

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
    "show points of invalid keys %s at once, without falling back to rows, and move the rest",
    (side) => {
      const expectAtOnce = (model: ChartModel, edit: () => void) => {
        const before = centers(pointsOf(model.scene(estimateText))[0]!);
        const { tween } = change(model, edit);
        const start = centers(pointsOf(frameAt(tween!, 0))[0]!);
        const target = centers(pointsOf(tween!.scene)[0]!);
        // The middle point does not move from its row's place; the last does.
        expectRects(start.slice(1, 3), [target[1]!, before[2]!]);
      };
      for (const bad of [
        [1, 1, 3],
        [1, Number.NaN, 3],
        [1, Infinity, 3],
      ]) {
        const { data, model } = scatter(
          { x: [1, 2, 3], y: [10, 20, 30], id: side === "before" ? bad : [1, 2, 3] },
          { itemKey: "id" },
        );
        expectAtOnce(model, () => {
          data.setColumn("id", side === "after" ? bad : [1, 2, 3]);
          data.setColumn("y", [30, 40, 10]);
        });
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
        expectAtOnce(model, () => {
          data.setColumn("id", side === "after" ? bad : ["a", "b", "c"]);
          data.setColumn("y", [30, 40, 10]);
        });
      }
    },
  );

  it("show points of keys shared or missing at once on the frame's scales, the rest of their series moving", () => {
    const data = table({
      x: [1, 2, 3, 1, 2],
      y: [10, 20, 30, 30, 40],
      id: [1, 1, 3, 1, 2],
      group: ["a", "a", "a", "b", "b"],
    });
    const marks = [point(data, { x: "x", y: "y", series: "group", itemKey: "id" })];
    const fixed = chart({ marks, x: { domain: [0, 4] }, y: { domain: [0, 100] } });
    const automatic = chart({ marks });
    const old = snapshot(automatic.scene(estimateText), automatic.panels(), 0)!;
    const [a, b] = pointsOf(fixed.scene(estimateText)).map(centers);
    const { tween } = change(fixed, () =>
      data.reset({
        x: [1, 2, 3, 1, 2],
        y: [20, 10, 50, 60, 70],
        id: [1, 1, 3, 2, Number.NaN],
        group: ["a", "a", "a", "b", "b"],
      }),
    );
    expect(tween!.panels[0]!.points).toHaveLength(2);
    const [toA, toB] = pointsOf(tween!.scene).map(centers);
    const [startA, startB] = pointsOf(frameAt(tween!, 0));
    // Key 1, shared in "a", shows at once; key 3 moves.
    expectRects(centers(startA!), [toA![0]!, toA![1]!, a![2]!]);
    // In "b", key 2 moves, the missing key shows at once, and key 1 goes.
    expectRects(centers(startB!), [b![1]!, toB![1]!, b![0]!]);
    expect(Array.from(startB!.radii!)).toEqual([2.5, 2.5, 2.5]);
    expect(Array.from(pointsOf(frameAt(tween!, 200))[1]!.radii!)).toEqual([2.5, 2.5, 0]);
    // On moving axes too, points shown at once stand on the frame's scales.
    expect(
      plan(old, automatic.scene(estimateText), automatic.panels(), 200, BUILDERS),
    ).toBeDefined();
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

  it("move on from a frame when values change again, straight, curved, and stacked", () => {
    for (const curve of ["linear", "monotone"] as const) {
      for (const stacked of [false, true]) {
        const data = table({ x, a: [10, 30, 20, 40, 30], b: [5, 5, 15, 5, 5] });
        const marks = stacked
          ? [area(data, { x: "x", y: ["a", "b"], stack: true, curve })]
          : [line(data, { x: "x", y: "a", curve })];
        const model = chart({ marks, y: { domain: [0, 100] } });
        const { tween } = change(model, () => data.setColumn("a", [40, 10, 50, 20, 60]));
        const frame = frameAt(tween!, 100);
        const copy = snapshot(frame, panelsAt(tween!, 100, model.panels()), 0);
        data.setColumn("a", [20, 50, 10, 30, 40]);
        const next = plan(copy!, model.scene(estimateText), model.panels(), 200, BUILDERS);
        // The next change starts where the frame is.
        const edge = (scene: Scene) =>
          stacked ? marksOf<AreaGeometry>(scene, "area")[0]!.upper : pathOf(scene);
        expect(ys(edge(frameAt(next!, 0)))).toEqual(ys(edge(frame)));
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
          const highlighter = channelHighlighter([{ table: data, store, channel: "focus" }]);
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

  it("move error bars, candles, and regions by their order, along the axis that changed", () => {
    const makes = [
      (data: Table) => errorbar(data as never, { x: "x", y1: "low", y2: "high" }),
      (data: Table) =>
        candlestick(data as never, { x: "x", open: "low", high: "high", low: "low", close: "y" }),
      (data: Table) => region(data as never, { y1: "low", y2: "high" }),
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
      marks: [errorbar(data as never, { x: "x", y1: "low", y2: "high" })],
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

  it("move text by its rows' names along both axes, in plain text and in boxes", () => {
    for (const style of [undefined, { background: { fill: "#eee" } }]) {
      const data = samples() as unknown as Table;
      const model = chart({
        marks: [
          text(data as never, {
            x: "x",
            y: "high",
            label: { field: "note", ...(style && { style }) },
          }),
        ],
        x: { domain: [0, 4] },
        y: { domain: [0, 60] },
      });
      const { shown, tween } = change(model, () => {
        data.set("x", 1, 1.5);
        data.set("high", 1, 20);
      });
      const [labels] = tween!.panels[0]!.labels;
      expect(labels!.mark.kind).toBe(style ? "labels" : "text");
      const before = shown.panels[0]!.items.get(labels!.mark.key)! as { at: Float32Array };
      const after = labels!.to;
      const middle = frameAt(tween!, 100).panels[0]!.marks[labels!.index]!;
      const place = (k: number) =>
        middle.kind === "text"
          ? (middle as TextGeometry).coords[k]!
          : (middle as LabelsGeometry).named!.at![k]!;
      // Row 1 between its places on both axes; the others stay.
      for (const k of [2, 3])
        expect(place(k)).toBeCloseTo(before.at[k]! + (after[k]! - before.at[k]!) * HALF, 3);
      expect(place(0)).toBeCloseTo(after[0]!, 3);
    }
  });

  it("count number labels through the values between, and match keyed text across resets", () => {
    const rows = (values: number[]) => ({ id: ["a", "b", "c"], x: [0, 1, 2], v: values });
    const data = table(rows([10, 20, 30]));
    const model = chart({
      marks: [
        text(data, {
          itemKey: "id",
          x: "x",
          y: "v",
          label: { field: "v", format: { maximumFractionDigits: 0 } },
        }),
      ],
      x: { domain: [-1, 3] },
      y: { domain: [0, 100] },
    });
    // Reordered by a reset, rows keep their names.
    const { tween } = change(model, () =>
      data.reset({ id: ["c", "a", "b"], x: [2, 0, 1], v: [60, 40, 20] }),
    );
    const middle = frameAt(tween!, 100).panels[0]!.marks.find(
      (m) => m.kind === "text",
    ) as TextGeometry;
    // "c" from 30 to 60, "a" from 10 to 40, "b" stays at 20: written between.
    expect(middle.labels).toEqual([
      String(Math.round(30 + 30 * HALF)),
      String(Math.round(10 + 30 * HALF)),
      "20",
    ]);
    expect(middle.coords[0]).toBeCloseTo(middle.coords[0]!, 3);
    // Unkeyed text is named by its rows, which a reset renames: it shows at once.
    const plain = table(rows([10, 20, 30]));
    const unkeyed = chart({
      marks: [text(plain, { x: "x", y: "v", label: { field: "v" } })],
      x: { domain: [-1, 3] },
      y: { domain: [0, 100] },
    });
    const reset = change(unkeyed, () => plain.reset(rows([40, 50, 60]))).tween!;
    const shownAtOnce = frameAt(reset, 100).panels[0]!.marks.find(
      (m) => m.kind === "text",
    ) as TextGeometry;
    expect(shownAtOnce.labels).toEqual(["40", "50", "60"]);
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
  const APPENDED = { ...VALUES_CHANGED, appended: 1, reset: false };

  function animated() {
    const data = table({ region: ["N", "S", "E"], sales: [10, 20, 30] });
    const model = chart({
      marks: [bar(data, { x: "region", y: "sales" })],
      y: { domain: [0, 40] },
    });
    const animation = new ValueAnimation(model, null, model.scene(estimateText), BUILDERS);
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

  it("move on from the frame on screen when values change while they move", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { data, model, animation } = animated();
    let shown = scene(model);
    animation.changed(shown, VALUES_CHANGED, 0);
    data.setColumn("sales", [30, 20, 10]);
    animation.start(scene(model), 0);
    now.mockReturnValue(100);
    // Half way, values change again: the next change starts where the bars are.
    const passing = animation.step(0)!;
    animation.changed(passing, VALUES_CHANGED, 0);
    data.setColumn("sales", [5, 35, 20]);
    const first = animation.start(scene(model), 0);
    expect(animation.playing).toBe(true);
    expectRects(rects(bars(first)[0]!), rects(bars(passing)[0]!));
    // Again and again, each change moving on from the last frame, always continuous.
    for (const [time, values] of [
      [150, [25, 15, 30]],
      [180, [10, 40, 5]],
    ] as const) {
      now.mockReturnValue(time);
      shown = animation.step(0)!;
      animation.changed(shown, VALUES_CHANGED, 0);
      data.setColumn("sales", [...values]);
      expectRects(rects(bars(animation.start(scene(model), 0))[0]!), rects(bars(shown)[0]!));
    }
    // It ends at the last values, a full duration after the last change.
    now.mockReturnValue(180 + 200);
    const end = animation.step(0)!;
    expect(animation.playing).toBe(false);
    expectRects(rects(bars(end)[0]!), rects(bars(scene(model))[0]!));
    vi.restoreAllMocks();
  });

  it("move points on from the frame on screen, keys entering and going included", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const data = table({ x: [1, 2, 3], y: [10, 20, 30], id: [1, 2, 3] });
    const model = chart({
      marks: [point(data, { x: "x", y: "y", itemKey: "id" })],
      x: { domain: [0, 4] },
      y: { domain: [0, 100] },
    });
    const animation = new ValueAnimation(model, null, model.scene(estimateText), BUILDERS);
    animation.changed(animation.start(scene(model), 0), VALUES_CHANGED, 0);
    data.reset({ x: [1, 2, 3], y: [60, 50, 40], id: [3, 2, 4] });
    animation.start(scene(model), 0);
    now.mockReturnValue(100);
    const passing = animation.step(0)!;
    animation.changed(passing, VALUES_CHANGED, 0);
    data.reset({ x: [1, 2, 3], y: [90, 10, 70], id: [4, 1, 2] });
    const first = animation.start(scene(model), 0);
    expect(animation.playing).toBe(true);
    // Key 4, half grown, and key 2 move on from where they are; key 1, half
    // gone, comes back from there; key 3 goes from there.
    const [from] = pointsOf(passing).map(centers);
    const [start] = pointsOf(first).map(centers);
    expectRects(start!, [from![2]!, from![3]!, from![1]!, from![0]!]);
    const radii = pointsOf(passing)[0]!.radii!;
    expect(Array.from(pointsOf(first)[0]!.radii!)).toEqual([
      radii[2],
      radii[3],
      radii[1],
      radii[0],
    ]);
    vi.restoreAllMocks();
  });

  it("show appends, changes soon after, and changes it cannot show at once", () => {
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
    // A change the chart cannot show moving (inspected, off screen) ends it,
    // and the next one before a scene is drawn shows at once.
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
    const copies = vi.spyOn(bars(shown)[0]!.bars!.names as (string | number)[], "slice");
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
