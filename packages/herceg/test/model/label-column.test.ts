// The outside label column: marks' labels outside the plot stand their
// offset (and the usual gap) past what stands beside the plot, and x end
// tick labels outside the plot may stand under the labels' tracks, so an
// end label overhanging the plot neither narrows it nor moves the column.
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { axis } from "../../src/guides/options.ts";
import { estimateText, textHeight, textLines } from "../../src/layout/text.ts";
import { columns, panel } from "../../src/layout.ts";
import { line } from "../../src/marks/line.ts";
import { rule } from "../../src/marks/rule.ts";
import { facet } from "../../src/model/facet.ts";
import { GAP } from "../../src/model/legend.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { measurePdfText } from "../../src/render/pdf-fonts.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type { AxisGuide, LabelsGeometry, Panel, Scene, TextItem } from "../../src/scene/scene.ts";
import type { SeriesLabelsSpec } from "../../src/spec/encoding.ts";
import { contractTest } from "../helpers/contracts.ts";
import { tickMarksOf } from "../helpers/guides.ts";

function model(config: ChartConfig, width = 900, height = 500) {
  const made = new ChartModel(
    { locale: "en-US", timeZone: "UTC", legend: false, ...config },
    undefined,
    staticCompilers(),
  );
  made.setSize(width, height, 1);
  return made;
}
const sceneOf = (config: ChartConfig, width?: number, height?: number) =>
  model(config, width, height).scene(estimateText);

/** A panel's series and rule labels. */
const labelsOf = (panel: Panel): TextItem[] =>
  panel.marks.filter((g): g is LabelsGeometry => g.kind === "labels").flatMap((g) => [...g.items]);
const textsOf = (guide: AxisGuide | undefined) =>
  (guide?.items ?? []).filter((item): item is TextItem => item.type === "text" && !!item.text);
const axisOn = (panel: Panel, side: AxisGuide["side"]) => panel.axes.find((a) => a.side === side);
/** An axis' tick labels, its title left out. */
const tickLabels = (guide: AxisGuide | undefined) =>
  textsOf(guide).filter((item) => item.text !== guide?.title?.text);
const right = ({ plot }: Panel) => plot.x + plot.width;
/** Pixels from a plot without a right y axis to the marks' labels' track, in automatic spacing. */
const TRACK = 12;

/** Where text is painted along x (unturned): its lines' block about its anchor. */
function extent(item: TextItem): [number, number] {
  const { width } = textLines(item.text, item.paint, estimateText);
  const start = item.x - width * (item.anchor === "end" ? 1 : item.anchor === "middle" ? 0.5 : 0);
  return [start, start + width];
}
/** Where an axis' title is painted across the plot's side: turned, its lines' height about its middle. */
function titleSpan(guide: AxisGuide): [number, number] {
  const item = textsOf(guide).find((t) => t.text === guide.title!.text)!;
  const half = Math.max(item.paint.lineHeight, textHeight(item.paint, item.text)) / 2;
  return [guide.title!.x - half, guide.title!.x + half];
}

const MINUTE = 60_000;
const START = Date.UTC(2026, 9, 1);
const minutes = Float64Array.from({ length: 360 }, (_, k) => START + k * MINUTE);
const NAMES = ["auth", "payments", "search", "recommendations-engine"] as const;
const lineOf = (s: number) =>
  Float64Array.from(minutes, (_, k) => 200 + s * 180 + 30 * Math.sin(k / 7 + s));
const metrics = table({
  time: time(minutes),
  auth: lineOf(0),
  payments: lineOf(1),
  search: lineOf(2),
  "recommendations-engine": lineOf(3),
});
/** Series labels of no content of their own: their series' names. */
type Names = Omit<SeriesLabelsSpec, "content">;
/** A6's names: beside the plot, 28 px out, with leaders. */
const A6 = {
  at: "view-end",
  place: { outside: true, offset: 28 },
  leader: true,
} as const satisfies Names;
const a6 = (view: [number, number], more: Partial<ChartConfig> = {}): ChartConfig => ({
  x: { domain: view },
  y: { domain: [0, 1000] },
  marks: [line(metrics, { x: "time", y: [...NAMES], labels: A6 })],
  ...more,
});
/** A6's 1.2 seconds ending between two minutes, ticked in sub-second steps. */
const SECONDS: [number, number] = [START + 338.99 * MINUTE, START + 339.01 * MINUTE];
const HOURS: [number, number] = [START, START + 359 * MINUTE];

// Numbers from 0 to 100, labelled by a listed x axis with a format of each test's.
const values = table({ x: [0, 100], a: [20, 30], b: [60, 70] });
const numbered = (
  format: (value: number) => string,
  labels: Names = { at: "last", place: { outside: true } },
  more: Partial<ChartConfig> = {},
): ChartConfig => ({
  x: { nice: false },
  y: { domain: [0, 100] },
  marks: [line(values, { x: "x", y: ["a", "b"], labels })],
  guides: [axis({ scale: "x", ticks: { values: [0, 50, 100] }, format })],
  ...more,
});

describe("the outside label column", () => {
  contractTest(
    "labels.attach.column",
    () => {
      // A6 at 1.2 seconds: the last tick label, "05:39:00.600", overhangs
      // the plot by about 40 px, less than the names' track is wide.
      const seconds = sceneOf(a6(SECONDS)).panels[0]!;
      const hours = sceneOf(a6(HOURS)).panels[0]!;
      const last = tickLabels(axisOn(seconds, "bottom")).at(-1)!;
      expect(last.text).toBe("05:39:00.600");
      // The plot keeps the width it has where no label overhangs.
      expect(seconds.plot).toEqual(hours.plot);
      // The names stand GAP + 28 px past the plot at both views.
      for (const panel of [seconds, hours]) {
        const names = labelsOf(panel);
        expect(names).toHaveLength(NAMES.length);
        for (const name of names) expect(name.x).toBeCloseTo(right(panel) + GAP + 28, 6);
      }
      // The end label stands under the names' column, inside the chart.
      const [, end] = extent(last);
      expect(end).toBeGreaterThan(right(seconds) + GAP + 28);
      expect(end).toBeLessThanOrEqual(900 - 2);
    },
    "stands its offset past the plot at every zoom, an x end label overhanging the plot standing under it",
  );

  it("stands at its offset past a margin widened for an end label wider than its track", () => {
    // Short names, a last label far wider than their track: the margin
    // widens past the track, and the column stays at its offset from the
    // plot, room left beyond it.
    const long = (v: number) => (v === 100 ? "a far longer last label than the names" : `${v}`);
    const panel = sceneOf(numbered(long)).panels[0]!;
    const plain = sceneOf(numbered(String)).panels[0]!;
    expect(right(panel)).toBeLessThan(right(plain));
    const [, end] = extent(tickLabels(axisOn(panel, "bottom")).at(-1)!);
    expect(end).toBeCloseTo(900 - 2, 0);
    for (const name of labelsOf(panel)) {
      expect(name.x).toBeCloseTo(right(panel) + GAP, 6);
      expect(extent(name)[1]).toBeLessThan(900 - 8);
    }
  });

  it("stands its offset before the plot on the left, labels aligned to their end", () => {
    const first = (v: number) => (v === 0 ? "the first label" : `${v}`);
    const left: Names = {
      at: "first",
      place: { outside: true, offset: 30 },
      style: { align: "end" },
    };
    const chart = (format: (v: number) => string) =>
      sceneOf(numbered(format, left, { y: { domain: [0, 100], show: false } })).panels[0]!;
    const panel = chart(first);
    expect(panel.plot).toEqual(chart(String).plot);
    for (const name of labelsOf(panel)) {
      expect(name.anchor).toBe("end");
      expect(name.x).toBeCloseTo(panel.plot.x - GAP - 30, 6);
    }
    // "the first label" reaches under the names, inside the chart.
    const [start] = extent(tickLabels(axisOn(panel, "bottom"))[0]!);
    expect(start).toBeLessThan(panel.plot.x - GAP - 30);
    expect(start).toBeGreaterThanOrEqual(2);
  });

  it("stands past the y labels and their title as drawn, before and after the margin widened", () => {
    // A right y axis with a title, the names beside it. A last x label too
    // long for the names' track widens the right margin; the title stays by
    // the chart's edge, so the column stands past the title as drawn.
    const label = { value: "short" };
    const rows = table({ x: [0, 100], a: [20, 30], b: [60, 70] });
    const config: ChartConfig = {
      x: { nice: false },
      yRight: { title: "Right title" },
      marks: [
        line(rows, {
          x: "x",
          y: ["a", "b"],
          axis: "right",
          labels: { at: "last", place: { outside: true, offset: 4 } },
        }),
      ],
      guides: [
        axis({
          scale: "x",
          ticks: { values: [0, 50, 100] },
          format: (v) => (v === 100 ? label.value : `${v}`),
        }),
      ],
    };
    const chart = model(config);
    const column = (scene: Scene) => {
      const panel = scene.panels[0]!;
      const yRight = axisOn(panel, "right")!;
      const [, titleEnd] = titleSpan(yRight);
      for (const name of labelsOf(panel)) expect(name.x).toBeCloseTo(titleEnd + GAP + 4, 6);
      return {
        panel,
        titleEnd,
        labelsEnd: Math.max(...tickLabels(yRight).map((t) => extent(t)[1])),
      };
    };
    const before = column(chart.scene(estimateText));
    // The y labels, then their title, then the names.
    expect(before.titleEnd).toBeGreaterThan(before.labelsEnd);
    // (The format reads the label anew each scene, as a changed domain's would.)
    label.value = "a last label far longer than the names' track is wide";
    const widened = column(chart.scene(estimateText));
    expect(right(widened.panel)).toBeLessThan(right(before.panel));
    // The title kept its place by the chart's edge, and the names theirs past it.
    expect(widened.titleEnd).toBeCloseTo(before.titleEnd, 6);
    // Margins grow only: the next scene keeps the wider one, the column past the title.
    label.value = "short";
    const kept = column(chart.scene(estimateText));
    expect(kept.panel.plot).toEqual(widened.panel.plot);
  });

  it("stands past the guides' axes beside the plot", () => {
    // A listed right y axis with a layer of its own: the names past its labels.
    const rows = table({ x: [0, 100], a: [20, 30] });
    const panel = sceneOf({
      x: { nice: false },
      marks: [
        line(rows, {
          x: "x",
          y: "a",
          axis: "right",
          labels: { at: "last", place: { outside: true } },
        }),
      ],
      guides: [
        axis({
          scale: "yRight",
          layers: [{ id: "far", ticks: { values: [25] }, format: () => "a far label" }],
        }),
      ],
    }).panels[0]!;
    const yRight = axisOn(panel, "right")!;
    const ticks = Math.max(...tickLabels(yRight).map((t) => extent(t)[1]));
    const [name] = labelsOf(panel);
    expect(name!.x).toBeGreaterThanOrEqual(ticks + GAP - 1e-6);
  });

  it("stands at the same place with reserve: false, and the margin keeps the end label out of no track", () => {
    const long = (v: number) => (v === 100 ? "a long last label" : `${v}`);
    const kept = sceneOf(numbered(long)).panels[0]!;
    const free = sceneOf(numbered(long, { at: "last", place: { outside: true, reserve: false } }))
      .panels[0]!;
    // No track: the end label widens the margin as it would without names.
    const none = sceneOf({ ...numbered(long), marks: [line(values, { x: "x", y: ["a", "b"] })] })
      .panels[0]!;
    expect(free.plot).toEqual(none.plot);
    for (const panel of [kept, free])
      for (const name of labelsOf(panel)) expect(name.x).toBeCloseTo(right(panel) + GAP, 6);
  });

  it("puts rules' labels outside the plot in the same column", () => {
    const panel = sceneOf(
      a6(SECONDS, {
        marks: [
          line(metrics, { x: "time", y: [...NAMES], labels: A6 }),
          rule({ y: 500, label: { text: "target", place: { outside: true, offset: 28 } } }),
        ],
      }),
    ).panels[0]!;
    for (const label of labelsOf(panel)) expect(label.x).toBeCloseTo(right(panel) + GAP + 28, 6);
    expect(labelsOf(panel).map(({ text }) => text)).toContain("target");
  });

  it("stands at its offset in facets, at the layout's side and between columns", () => {
    const rows = table({ x: [0, 100, 0, 100], v: [20, 30, 60, 70], g: ["p", "p", "q", "q"] });
    const chart = (format: (v: number) => string, more: Partial<ChartConfig> = {}) =>
      sceneOf({
        facet: facet("g"),
        x: { nice: false },
        y: { domain: [0, 100] },
        marks: [
          line(rows, {
            x: "x",
            y: "v",
            labels: { at: "last", place: { outside: true, offset: 40 } },
          }),
        ],
        guides: [axis({ scale: "x", ticks: { values: [0, 50, 100] }, format })],
        ...more,
      });
    const end = (v: number) => (v === 100 ? "an end label" : `${v}`);
    const [p, q] = chart(end).panels;
    const [, shortQ] = chart(String).panels;
    // The last column: its end label under the names' track, its plot's
    // right edge where it is without the overhang.
    expect(right(q!)).toBe(right(shortQ!));
    const [, reach] = extent(tickLabels(axisOn(q!, "bottom")).at(-1)!);
    expect(reach).toBeGreaterThan(right(q!) + TRACK);
    expect(reach).toBeLessThanOrEqual(900 - 2);
    // Every column's names stand GAP past its plot; between columns, before the next plot.
    for (const panel of [p!, q!])
      for (const name of labelsOf(panel)) expect(name.x).toBeCloseTo(right(panel) + GAP + 40, 6);
    for (const name of labelsOf(p!)) expect(extent(name)[1]).toBeLessThan(q!.plot.x);
    // A grid's row headers beside the last column: the names past them.
    const cells = table({
      x: [0, 100, 0, 100, 0, 100, 0, 100],
      v: [20, 30, 60, 70, 20, 30, 60, 70],
      g: ["p", "p", "q", "q", "p", "p", "q", "q"],
      r: ["r1", "r1", "r1", "r1", "r2", "r2", "r2", "r2"],
    });
    const grid = sceneOf({
      facet: facet({ row: "r", column: "g" }),
      x: { nice: false },
      marks: [line(cells, { x: "x", y: "v", labels: { at: "last", place: { outside: true } } })],
    });
    const headers = grid.guides
      .filter((g) => g.kind === "header")
      .flatMap((g) => g.items.filter((item): item is TextItem => item.type === "text"))
      .filter((item) => item.angle === 90);
    expect(headers.length).toBeGreaterThan(0);
    const lastColumn = grid.panels.filter(
      (panel) => right(panel) === Math.max(...grid.panels.map(right)),
    );
    expect(lastColumn).toHaveLength(2);
    for (const panel of lastColumn) {
      const header = headers.find(
        (h) => h.y > panel.plot.y && h.y < panel.plot.y + panel.plot.height,
      )!;
      for (const name of labelsOf(panel))
        expect(name.x).toBeGreaterThanOrEqual(header.x + header.paint.lineHeight / 2 + GAP - 1e-6);
    }
  });

  it("stands at its offset in subplots, in outer cells and in gutters", () => {
    const rows = table({ x: [0, 100], a: [20, 30], b: [60, 70] });
    const chart = (format: (v: number) => string, more: Partial<ChartConfig> = {}) =>
      sceneOf({
        panels: panels(
          columns(
            [1, 1],
            [
              panel({ id: "left", yRight: { title: "Left's" } }),
              panel({ id: "right", yRight: { title: "Right's" } }),
            ],
          ),
        ),
        x: { nice: false },
        marks: ["left", "right"].map((id) =>
          line(rows, {
            x: "x",
            y: ["a", "b"],
            axis: "right",
            panel: id,
            labels: { at: "last", place: { outside: true, offset: 2 } },
          }),
        ),
        guides: [axis({ scale: "x", ticks: { values: [0, 50, 100] }, format })],
        ...more,
      });
    const end = (v: number) => (v === 100 ? "a longer end label" : `${v}`);
    const scene = chart(end);
    const at = (key: string) => scene.panels.find((panel) => panel.key === key)!;
    for (const key of ["left", "right"]) {
      const panel = at(key);
      const yRight = axisOn(panel, "right")!;
      const [titleStart, titleEnd] = titleSpan(yRight);
      // Its y labels, then its title, then the names GAP and 2 px past it.
      expect(titleStart).toBeGreaterThan(Math.max(...tickLabels(yRight).map((t) => extent(t)[1])));
      for (const name of labelsOf(panel)) expect(name.x).toBeCloseTo(titleEnd + GAP + 2, 6);
    }
    // In the gutter, the names end before the next cell's plot.
    for (const name of labelsOf(at("left")))
      expect(extent(name)[1]).toBeLessThan(at("right").plot.x);
    // The outer cell: its end label under the chart's track for the names,
    // its plot where it is without the overhang.
    const short = chart(String).panels.find((panel) => panel.key === "right")!;
    expect(right(at("right"))).toBe(right(short));
    const [, reach] = extent(tickLabels(axisOn(at("right"), "bottom")).at(-1)!);
    expect(reach).toBeGreaterThan(labelsOf(at("right"))[0]!.x);
    expect(reach).toBeLessThanOrEqual(900 - 2);
    // A legend beside the outer cell stands between its axis and the names.
    const legended = chart(String, {
      legend: { place: { side: "right", scope: "panel", panel: "right" } },
    });
    const swatches = legended.guides
      .filter((g) => g.kind === "legend")
      .flatMap((g) => g.items.filter((item): item is TextItem => item.type === "text"));
    expect(swatches.length).toBeGreaterThan(0);
    const legendEnd = Math.max(...swatches.map((t) => extent(t)[1]));
    const names = labelsOf(legended.panels.find((p) => p.key === "right")!);
    for (const name of names) expect(name.x).toBeGreaterThan(legendEnd + GAP);
  });

  it("stands past each subplot's own axes: their rooms and titles as painted", () => {
    const rows = table({ x: [0, 100], a: [20, 30], b: [60, 70] });
    const names = { at: "last", place: { outside: true } } as const;
    // A y axis on the right whose room a subplot sets for itself: the
    // other's names stand past its own room, inside the chart.
    const roomed = sceneOf({
      panels: panels(columns([1, 1], [panel({ id: "a", y: { room: 100 } }), panel("b")])),
      y: { place: { side: "right" }, room: 20 },
      x: { nice: false },
      marks: ["a", "b"].map((id) =>
        line(rows, { x: "x", y: ["a", "b"], panel: id, labels: names }),
      ),
    });
    for (const panel of roomed.panels) {
      // A listed axis takes its room and 8 px past it, as the margins keep.
      const room = (panel.key === "a" ? 100 : 20) + 8;
      for (const name of labelsOf(panel)) {
        expect(name.x).toBeCloseTo(right(panel) + room + GAP, 6);
        expect(extent(name)[1]).toBeLessThanOrEqual(900);
      }
    }
    // Titles of three lines and of one: each panel's names GAP past its own title as painted.
    const titled = sceneOf({
      panels: panels(
        columns(
          [1, 1],
          [
            panel({ id: "a", yRight: { title: "First\nSecond\nThird" } }),
            panel({ id: "b", yRight: { title: "Short" } }),
          ],
        ),
      ),
      x: { nice: false },
      marks: ["a", "b"].map((id) =>
        line(rows, { x: "x", y: ["a", "b"], panel: id, axis: "right", labels: names }),
      ),
    });
    for (const panel of titled.panels) {
      const [, titleEnd] = titleSpan(axisOn(panel, "right")!);
      for (const name of labelsOf(panel)) expect(name.x).toBeCloseTo(titleEnd + GAP, 6);
    }
  });

  it("stands past each panel's own listed axis labels where panels' y labels differ in width", () => {
    // A listed y axis' wide layer beside panels whose own labels are narrow
    // (1 to 2) and wide (100,000 to 200,000): on each side, in facets and
    // subplots, every panel's names stand GAP past the labels it draws.
    const rows = table({ x: [0, 1, 0, 1], v: [1, 2, 100_000, 200_000], g: ["a", "a", "b", "b"] });
    const small = table({ x: [0, 1], v: [1, 2] });
    const large = table({ x: [0, 1], v: [100_000, 200_000] });
    for (const onRight of [false, true]) {
      const scale = onRight ? "yRight" : "y";
      const names: Names = {
        at: onRight ? "last" : "first",
        place: { outside: true },
        style: { align: onRight ? "start" : "end" },
      };
      const side = onRight ? { axis: "right" as const } : {};
      const wide = axis({ scale, layers: [{ id: "wide", format: () => "abcdefghijklmnopqrst" }] });
      const faceted = sceneOf({
        facet: facet("g", { columns: 1 }),
        [scale]: { scope: "panel" },
        marks: [line(rows, { x: "x", y: "v", ...side, labels: names })],
        guides: [wide],
      });
      const subplots = sceneOf({
        panels: panels(columns([1, 1], [panel("a"), panel("b")])),
        marks: [small, large].map((data, k) =>
          line(data, { x: "x", y: "v", panel: k ? "b" : "a", ...side, labels: names }),
        ),
        guides: [wide],
      });
      for (const chart of [faceted, subplots]) {
        for (const p of chart.panels) {
          const spans = tickLabels(axisOn(p, onRight ? "right" : "left")).map(extent);
          const [name] = labelsOf(p);
          if (onRight) {
            const edge = Math.max(...spans.map(([, end]) => end));
            expect(name!.x - edge).toBeGreaterThanOrEqual(GAP - 1e-6);
            expect(name!.x - edge).toBeLessThan(GAP + 1);
            expect(extent(name!)[1]).toBeLessThanOrEqual(900);
          } else {
            const edge = Math.min(...spans.map(([start]) => start));
            expect(edge - name!.x).toBeGreaterThanOrEqual(GAP - 1e-6);
            expect(edge - name!.x).toBeLessThan(GAP + 1);
            expect(extent(name!)[0]).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('can meet an end label overhanging the plot where its labels "show" at the plot\'s bottom', () => {
    // A name at its point at the plot's bottom reaches into the x axis' row,
    // over an end label overhanging the plot: "show" is drawn there anyway.
    const low = table({ time: time(minutes), floor: Float64Array.from(minutes, () => 0) });
    const panel = sceneOf(
      a6(SECONDS, {
        marks: [
          line(metrics, { x: "time", y: [...NAMES], labels: A6 }),
          line(low, { x: "time", y: "floor", labels: { ...A6, overlap: "show", leader: false } }),
        ],
      }),
    ).panels[0]!;
    const floor = labelsOf(panel).find((label) => label.text === "floor")!;
    expect(floor.y).toBeCloseTo(panel.plot.y + panel.plot.height, 6);
    const last = tickLabels(axisOn(panel, "bottom")).at(-1)!;
    const [from, to] = extent(last);
    const [start, end] = extent(floor);
    expect(start < to && from < end).toBe(true);
    expect(floor.y + floor.paint.lineHeight / 2).toBeGreaterThan(panel.plot.y + panel.plot.height);
  });
});

describe("x end tick labels under the labels' track", () => {
  contractTest(
    "axis.tick-labels.ends.tracks",
    () => {
      // An end label stands under the names' track, in the axis' rows below
      // the plot and inside the plot alike: the plot keeps its width.
      const layered = (inside: boolean) =>
        sceneOf(
          numbered(String, A6, {
            guides: [
              axis({
                scale: "x",
                ticks: { values: [0, 50, 100] },
                layers: [
                  {
                    id: "ends",
                    ticks: { values: [100] },
                    format: () => "end of axis",
                    labels: inside ? { inside: true } : { row: 1 },
                  },
                ],
              }),
            ],
          }),
        ).panels[0]!;
      const plain = sceneOf(numbered(String, A6)).panels[0]!;
      for (const inside of [false, true]) {
        const panel = layered(inside);
        expect([panel.plot.x, panel.plot.width]).toEqual([plain.plot.x, plain.plot.width]);
        const end = tickLabels(axisOn(panel, "bottom")).find((t) => t.text === "end of axis")!;
        expect(extent(end)[1]).toBeGreaterThan(right(panel) + TRACK);
        expect(extent(end)[1]).toBeLessThanOrEqual(900 - 2 + 0.5);
      }
    },
    "stand under marks' labels' tracks, below the plot and inside it, the plot keeping its width",
  );

  it("can meet names beside the plot's bottom row, inside the plot, overhanging past the gap and offset", () => {
    // A name that moves stays within the plot's height, so at a point at
    // the plot's bottom it stands beside the plot's bottom row, where an
    // inside end label overhanging the plot by more than GAP + offset
    // reaches: they meet (documented in the marks guide).
    const low = table({ x: [0, 100], floor: [0, 0] });
    const panel = sceneOf({
      x: { nice: false },
      y: { domain: [0, 100] },
      marks: [line(low, { x: "x", y: "floor", labels: { at: "last", place: { outside: true } } })],
      guides: [
        axis({
          scale: "x",
          ticks: { values: [0, 50, 100] },
          labels: { inside: true },
          format: (v) => (v === 100 ? "the end of the axis" : `${v}`),
        }),
      ],
    }).panels[0]!;
    const [name] = labelsOf(panel);
    const end = tickLabels(axisOn(panel, "bottom")).at(-1)!;
    expect(end.text).toBe("the end of the axis");
    expect(name!.x).toBeCloseTo(right(panel) + GAP, 6);
    // Across, the inside label reaches past the name's start; along y, both
    // stand within a line of the plot's bottom.
    expect(extent(end)[1]).toBeGreaterThan(name!.x);
    const bottom = panel.plot.y + panel.plot.height;
    expect(Math.abs(name!.y - bottom)).toBeLessThan(name!.paint.lineHeight);
    expect(Math.abs(end.y - bottom)).toBeLessThan(2 * end.paint.lineHeight);
  });

  it('are kept under "hide" where they fit under the track', () => {
    const hidden = (labels: Names | undefined) =>
      sceneOf(
        a6(SECONDS, {
          marks: [line(metrics, { x: "time", y: [...NAMES], ...(labels && { labels }) })],
          guides: [axis({ scale: "x", labels: { ends: "hide" } })],
        }),
      ).panels[0]!;
    const named = hidden(A6);
    expect(tickLabels(axisOn(named, "bottom")).at(-1)!.text).toBe("05:39:00.600");
    // Without the names' track the chart's edge is nearer: left out.
    const bare = hidden(undefined);
    expect(tickLabels(axisOn(bare, "bottom")).at(-1)!.text).not.toBe("05:39:00.600");
    expect(axisOn(bare, "bottom")!.ticks.at(-1)).toMatchObject({ label: "" });
    expect(named.plot).toEqual(sceneOf(a6(HOURS)).panels[0]!.plot);
    // Tick marks stay with the labels kept and go with those left out.
    for (const panel of [named, bare]) {
      const bottom = axisOn(panel, "bottom")!;
      const labelled = bottom.ticks.filter(({ label }) => label);
      expect(tickMarksOf(bottom).map((mark) => mark.at)).toEqual(
        labelled.map(({ position }) => Math.round(position)),
      );
    }
  });

  it("stand under the track as blocks of several lines", () => {
    const lines = (v: number) => (v === 100 ? "the last\nlabel of lines" : `${v}`);
    const panel = sceneOf(numbered(lines, A6)).panels[0]!;
    // As wide as with a label of one line (the row is deeper).
    const plain = sceneOf(numbered(String, A6)).panels[0]!.plot;
    expect([panel.plot.x, panel.plot.width]).toEqual([plain.x, plain.width]);
    const last = tickLabels(axisOn(panel, "bottom")).at(-1)!;
    expect(last.text).toBe("the last\nlabel of lines");
    expect(extent(last)[1]).toBeGreaterThan(right(panel) + TRACK);
    expect(extent(last)[1]).toBeLessThanOrEqual(900 - 2);
    // Under "hide" it stays, with its tick mark; past the chart's edge, both go.
    for (const [text, kept] of [
      ["the last\nlabel of lines", true],
      ["the last label, written\nfar too long to stand there", false],
    ] as const) {
      const ended = sceneOf(
        numbered(String, A6, {
          guides: [
            axis({
              scale: "x",
              ticks: { values: [0, 50, 100] },
              format: (v) => (v === 100 ? text : `${v}`),
              labels: { ends: "hide" },
            }),
          ],
        }),
      ).panels[0]!;
      const bottom = axisOn(ended, "bottom")!;
      expect(tickLabels(bottom).some((item) => item.text === text)).toBe(kept);
      const ticks = [ended.plot.x, ended.plot.x + ended.plot.width / 2, right(ended)];
      expect(tickMarksOf(bottom).map((mark) => mark.at)).toEqual(
        (kept ? ticks : ticks.slice(0, 2)).map(Math.round),
      );
    }
  });

  it("lay out alike with static output's metrics", () => {
    // Static SVG's built-in metrics and PDF's fonts: the names GAP + 28 px
    // past the plot, the end label under them, the plot as at hours' view.
    for (const measure of [estimateText, measurePdfText]) {
      const scene = (view: [number, number]) => {
        const made = model(a6(view));
        return made.scene(measure).panels[0]!;
      };
      const panel = scene(SECONDS);
      expect(panel.plot).toEqual(scene(HOURS).plot);
      for (const name of labelsOf(panel)) expect(name.x).toBeCloseTo(right(panel) + GAP + 28, 6);
      const last = tickLabels(axisOn(panel, "bottom")).at(-1)!;
      expect(last.text).toBe("05:39:00.600");
      expect(last.x + measure(last.text, last.paint.css) / 2).toBeGreaterThan(right(panel) + TRACK);
    }
    const svg = renderToSVG({ ...a6(SECONDS), width: 900, height: 500, timeZone: "UTC" });
    expect(svg).toContain(">05:39:00.600</text>");
  });
});
