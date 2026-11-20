// End labels of listed axes at the chart's edge: "room" widens the margin
// for them, "hide" leaves them out and keeps the margin.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { guideCompiler } from "../../src/guides/compile.ts";
import { axis, colorbar } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { cell, grid, inset, panel as subplot } from "../../src/layout.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { facet } from "../../src/model/facet.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import type { AxisGuide, Panel, Scene, TextItem } from "../../src/scene/scene.ts";
import type { TickEnds } from "../../src/spec/guides.ts";
import { loadSpec } from "../../src/spec/load.ts";
import { contractTest } from "../helpers/contracts.ts";
import { gridAt } from "../helpers/grid.ts";

const guides = guideCompiler(GUIDE_KIT);

function build(config: ChartConfig, width = 800, height = 300) {
  const model = new ChartModel({ locale: "en-US", timeZone: "UTC", ...config }, undefined, [
    guides,
  ]);
  model.setSize(width, height, 1);
  return { model, scene: model.scene(estimateText) };
}

const axisOn = (panel: Panel, side: AxisGuide["side"]) => panel.axes.find((a) => a.side === side);
/** The labels an axis draws, in order. */
const labels = (guide: AxisGuide | undefined) =>
  (guide?.items ?? []).filter((item): item is TextItem => item.type === "text").map((t) => t.text);
const right = (scene: Scene, i = 0) => {
  const { plot } = scene.panels[i]!;
  return plot.x + plot.width;
};

// Values from 0 to 1000 across a chart without padding or a y axis, so the
// first and last labels cross the chart's left and right edges.
const values = table({ x: [0, 1000], v: [0, 1] });
const edgeToEdge = (ends?: TickEnds, more: Partial<ChartConfig> = {}): ChartConfig => ({
  padding: 0,
  marks: [line(values, { x: "x", y: "v" })],
  x: { nice: false },
  y: { show: false, grid: false },
  guides: [
    axis({
      scale: "x",
      ticks: { values: [0, 250, 500, 750, 1000] },
      grid: true,
      ...(ends && { labels: { ends } }),
    }),
  ],
  ...more,
});

describe("end labels on x", () => {
  contractTest(
    "axis.tick-labels.ends.room",
    () => {
      const { scene } = build(edgeToEdge());
      const { plot } = scene.panels[0]!;
      expect(plot.x).toBeGreaterThan(0);
      expect(right(scene)).toBeLessThan(800);
      expect(labels(axisOn(scene.panels[0]!, "bottom"))).toEqual([
        "0",
        "250",
        "500",
        "750",
        "1,000",
      ]);
      expect(build(edgeToEdge("room")).scene.panels[0]!.plot).toEqual(plot);
    },
    "widen the margins for labels crossing the chart's edge by default",
  );

  contractTest(
    "axis.tick-labels.ends.hide",
    () => {
      const { scene } = build(edgeToEdge("hide"));
      const panel = scene.panels[0]!;
      expect(panel.plot.x).toBe(0);
      expect(right(scene)).toBe(800);
      const bottom = axisOn(panel, "bottom")!;
      expect(labels(bottom)).toEqual(["250", "500", "750"]);
      expect(bottom.ticks.map((t) => t.position)).toEqual([0, 200, 400, 600, 800]);
      expect(gridAt(panel, "x")).toEqual([0, 200, 400, 600, 800]);
    },
    "are left out with their tick marks and grid lines kept, the margins not widened",
  );

  contractTest(
    "axis.tick-labels.ends.margin",
    () => {
      const { scene } = build(edgeToEdge("hide", { padding: { right: 0 }, y: { grid: false } }));
      // The y labels take room on the left, which "0" fits in; "1,000" crosses the right edge.
      expect(scene.panels[0]!.plot.x).toBeGreaterThan(20);
      expect(right(scene)).toBe(800);
      expect(labels(axisOn(scene.panels[0]!, "bottom"))).toEqual(["0", "250", "500", "750"]);
    },
    "stay where they fit in the margin as it is: the y labels' room and padding",
  );

  contractTest(
    "axis.tick-labels.ends.moving",
    () => {
      const live = table({ x: [0, 1000], v: [0, 1] });
      const chart = (ends: TickEnds) =>
        build({
          padding: { top: 0, right: 6, bottom: 0, left: 0 },
          marks: [line(live, { x: "x", y: "v" })],
          x: { nice: false },
          y: { show: false, grid: false },
          guides: [axis({ scale: "x", place: { side: "top" }, labels: { ends } })],
        }).model;
      for (const ends of ["room", "hide"] as const) {
        live.reset({ x: [0, 1180], v: [0, 1] });
        const model = chart(ends);
        const widths: number[] = [];
        for (const max of [1180, 1430, 1690, 2010, 2480, 2900])
          for (const step of [0, 1]) {
            live.reset({ x: [0, max + step * 37], v: [0, 1] });
            widths.push(model.scene(estimateText).panels[0]!.plot.width);
          }
        // As a race's axis: the last label reaches past the edge now and
        // then, narrowing the plot each time for good.
        if (ends === "room") {
          expect(new Set(widths).size).toBeGreaterThan(1);
          expect(widths).toEqual([...widths].sort((a, b) => b - a));
        } else expect(new Set(widths)).toEqual(new Set([794]));
      }
    },
    "keep the plot's width while the domain moves, where margins only grow",
  );

  contractTest(
    "axis.tick-labels.ends.painted",
    () => {
      const long = (v: number) => `A long label ${v}`;
      const turned = (ends: TickEnds) =>
        build(
          edgeToEdge(undefined, {
            padding: { right: 0 },
            guides: [
              axis({
                scale: "x",
                ticks: { values: [0, 500, 1000] },
                format: long,
                labels: { rotation: -45, ends },
              }),
            ],
          }),
        ).scene;
      // Turned up from their ticks, labels reach left, the first past the
      // edge; the last reaches past the right edge by its box's corner.
      const room = turned("room");
      const hide = turned("hide");
      expect(hide.panels[0]!.plot.x).toBeLessThan(room.panels[0]!.plot.x);
      expect(right(room)).toBeLessThan(800);
      expect(right(hide)).toBe(800);
      expect(labels(axisOn(hide.panels[0]!, "bottom"))).toEqual([long(500)]);
      // A label whose box fits but whose halo would cross the edge.
      const at = (style: object) =>
        build(
          edgeToEdge(undefined, {
            guides: [
              axis({
                scale: "x",
                ticks: { values: [30, 500] },
                format: (v) => (v === 30 ? "MM" : "x"),
                labels: { ends: "hide" },
                style: { tickLabel: style },
              }),
            ],
          }),
        ).scene;
      const plain = at({});
      const item = axisOn(plain.panels[0]!, "bottom")!.items.find(
        (i): i is TextItem => i.type === "text" && i.text === "MM",
      )!;
      // 30 maps to 24 px: the label's box starts inside the chart, a halo of 2 × 24 px past it does not.
      expect(24 - estimateText("MM", item.paint.css) / 2).toBeGreaterThan(0);
      expect(labels(axisOn(plain.panels[0]!, "bottom"))).toEqual(["MM", "x"]);
      const haloed = at({ halo: { color: "#ffffff", width: 48 } });
      expect(labels(axisOn(haloed.panels[0]!, "bottom"))).toEqual(["x"]);
      // A halo reaches past a box's end by what it has over the padding on that
      // side: 40 px of padding on the left hold a 20 px halo, none on the right.
      const padded = (ends: TickEnds) =>
        build(
          edgeToEdge(undefined, {
            guides: [
              axis({
                scale: "x",
                ticks: { values: [50, 500] },
                format: (v) => (v === 50 ? "MM" : "x"),
                labels: { ends },
                style: {
                  tickLabel: {
                    background: { fill: "#eeeeee" },
                    padding: { left: 40, right: 0, top: 0, bottom: 0 },
                    halo: { color: "#ffffff", width: 40 },
                  },
                },
              }),
            ],
          }),
        ).scene;
      const boxLeft = 40 - (estimateText("MM", item.paint.css) + 40) / 2;
      expect(boxLeft).toBeGreaterThan(0);
      expect(boxLeft).toBeLessThan(20);
      expect(labels(axisOn(padded("hide").panels[0]!, "bottom"))).toEqual(["MM", "x"]);
      expect(padded("room").panels[0]!.plot.x).toBe(0);
      // Turned a quarter, text reaches across by its size, not its line's
      // height: 12 px text 6 px either side of its tick, in lines of 24 or 6.
      const quarter = (lineHeight: number, at: readonly number[]) =>
        build(
          edgeToEdge(undefined, {
            guides: [
              axis({
                scale: "x",
                ticks: { values: [...at, 500] },
                format: () => "M",
                labels: { rotation: 90, duplicates: "show", ends: "hide" },
                style: { tickLabel: { fontSize: 12, lineHeight } },
              }),
            ],
          }),
          400,
        ).scene.panels[0]!;
      // At 10 and 390 px of 400.
      expect(labels(axisOn(quarter(2, [25, 975]), "bottom"))).toEqual(["M", "M", "M"]);
      // At 4 and 396 px.
      expect(labels(axisOn(quarter(0.5, [10, 990]), "bottom"))).toEqual(["M"]);
      // A box shorter than its text does not hold it: 12 px glyphs in 3 px lines.
      const short = (ends: TickEnds) =>
        build(
          edgeToEdge(undefined, {
            guides: [
              axis({
                scale: "x",
                ticks: { values: [5, 500, 995] },
                format: () => "M",
                labels: { rotation: 90, duplicates: "show", ends },
                style: {
                  tickLabel: {
                    fontSize: 12,
                    lineHeight: 0.25,
                    background: { fill: "#eeeeee" },
                    padding: 0,
                  },
                },
              }),
            ],
          }),
          400,
        ).scene.panels[0]!;
      expect(labels(axisOn(short("hide"), "bottom"))).toEqual(["M"]);
      expect(short("room").plot.x).toBeGreaterThan(0);
    },
    "are judged as painted: turned, boxed, and haloed",
  );

  contractTest(
    "axis.tick-labels.ends.halo",
    () => {
      const at = (halo: boolean) =>
        build(
          edgeToEdge(undefined, {
            guides: [
              axis({
                scale: "x",
                ticks: { values: [0, 500] },
                style: { tickLabel: halo ? { halo: { color: "#ffffff", width: 20 } } : {} },
              }),
            ],
          }),
        ).scene.panels[0]!.plot.x;
      expect(at(true) - at(false)).toBe(10);
    },
    "widen the margin for a haloed label's halo too, by default",
  );

  contractTest(
    "axis.tick-labels.ends.layers",
    () => {
      const layered = (major: string) =>
        build(
          edgeToEdge(undefined, {
            guides: [
              axis({
                scale: "x",
                ticks: { values: [0, 1000] },
                format: (v) => `${major}${v}`,
                labels: { ends: "hide" },
                layers: [
                  {
                    id: "days",
                    ticks: { values: [0, 1000] },
                    format: (v) => `day ${v}`,
                    labels: { row: 1 },
                  },
                ],
              }),
            ],
          }),
        ).scene.panels[0]!;
      // The layer of row 1 widens the margins for its own labels: the major
      // layer's longer ones still cross them and are left out, and shorter
      // ones fit and stay.
      const long = layered("a much longer label ");
      expect(long.plot.x).toBeGreaterThan(0);
      expect(labels(axisOn(long, "bottom"))).toEqual(["day 0", "day 1000"]);
      const short = layered("");
      expect(short.plot).toEqual(long.plot);
      expect(labels(axisOn(short, "bottom"))).toEqual(["0", "1000", "day 0", "day 1000"]);
    },
    "apply to each layer alone, whose own setting a layer keeps",
  );

  contractTest(
    "axis.tick-labels.ends.lanes",
    () => {
      // A long first label staggered into its lane, a layer's label of a higher
      // priority beside the next: the first is left out, but its lane keeps
      // its depth, so the others stay where priorities placed them.
      const staggered = (ends: TickEnds) =>
        build(
          edgeToEdge(undefined, {
            guides: [
              axis({
                scale: "x",
                ticks: { values: [0, 500, 1000] },
                format: (v) => (v === 0 ? "A".repeat(20) : "M"),
                labels: { rotation: 90, overlap: "stagger", ends },
                layers: [
                  {
                    id: "hp",
                    ticks: { values: [500] },
                    format: () => "HP",
                    labels: { priority: 1, gap: 20, ends },
                  },
                ],
              }),
            ],
          }),
          400,
          600,
        ).scene.panels[0]!;
      const at = (panel: Panel) =>
        Object.fromEntries(
          axisOn(panel, "bottom")!
            .items.filter((item): item is TextItem => item.type === "text")
            .map((item) => [item.text, item.y]),
        );
      const hide = staggered("hide");
      const room = staggered("room");
      expect(Object.keys(at(hide))).toEqual(["M", "HP"]);
      expect(at(hide).M).toBe(at(room).M);
      expect(at(hide).HP).toBe(at(room).HP);
      expect(hide.plot.height).toBe(room.plot.height);
      const [m, hp] = axisOn(hide, "bottom")!.labelBoxes!.map(({ box }) => box);
      expect(m!.y > hp!.y + hp!.height || hp!.y > m!.y + m!.height).toBe(true);
    },
    "keep the rows and lanes their labels left out sized",
  );

  contractTest(
    "axis.tick-labels.ends.room-rows",
    () => {
      const rows = (ends?: TickEnds) =>
        build(
          edgeToEdge(undefined, {
            guides: [
              axis({
                scale: "x",
                place: { side: "top" },
                room: 16,
                line: false,
                tick: false,
                ticks: { values: [0, 500, 1000] },
                labels: { gap: 0, ...(ends && { ends }) },
                layers: [
                  { id: "second", ticks: { values: [250, 750] }, tick: false, labels: { row: 1 } },
                ],
              }),
            ],
          }),
        ).scene;
      // A room of 16 px holds the first row only, whatever `ends` says.
      expect(labels(axisOn(rows("room").panels[0]!, "top"))).toEqual(["0", "500", "1,000"]);
      const hide = rows("hide");
      expect(labels(axisOn(hide.panels[0]!, "top"))).toEqual(["500"]);
      expect(hide.panels[0]!.plot.y).toBe(rows("room").panels[0]!.plot.y);
    },
    "leave a room's rows as the room leaves them",
  );
});

describe("end labels on y", () => {
  contractTest(
    "axis.tick-labels.ends.y",
    () => {
      const chart = (ends?: TickEnds) =>
        build(
          {
            padding: 0,
            marks: [line(values, { x: "x", y: "v" })],
            x: { show: false, grid: false },
            y: { domain: [0, 1], nice: false },
            guides: [
              axis({
                scale: "y",
                ticks: { values: [0, 0.5, 1] },
                ...(ends && { labels: { ends } }),
              }),
            ],
          },
          400,
          200,
        ).scene;
      // The top label fits the room kept above the plot; the bottom one, at
      // the chart's bottom edge, has none.
      expect(labels(axisOn(chart().panels[0]!, "left"))).toEqual(["0", "0.5", "1"]);
      const hide = chart("hide");
      expect(labels(axisOn(hide.panels[0]!, "left"))).toEqual(["0.5", "1"]);
      expect(hide.panels[0]!.plot).toEqual(chart().panels[0]!.plot);
      // A block of two lines, as painted: moved inside the chart, or left out.
      const tall = (ends?: TickEnds) =>
        build(
          {
            padding: 0,
            marks: [line(values, { x: "x", y: "v" })],
            x: { show: false, grid: false },
            y: { domain: [0, 1], nice: false },
            guides: [
              axis({
                scale: "y",
                ticks: { values: [0.5, 1] },
                format: (v) => (v === 1 ? "most\nof all" : String(v)),
                ...(ends && { labels: { ends } }),
              }),
            ],
          },
          400,
          200,
        ).scene.panels[0]!;
      expect(labels(axisOn(tall(), "left"))).toEqual(["0.5", "most of all"]);
      expect(labels(axisOn(tall("hide"), "left"))).toEqual(["0.5"]);
      expect(tall("hide").plot).toEqual(tall().plot);
      // A block aligned at its tick paints its outline past the tick too: the
      // end labels' blocks stand inside the chart, their outlines do not.
      const aligned = (verticalAlign: "top" | "bottom", strokeWidth = 20) =>
        build(
          {
            padding: 0,
            marks: [line(values, { x: "x", y: "v" })],
            x: { show: false, grid: false },
            y: { domain: [0, 1], nice: false },
            guides: [
              axis({
                scale: "y",
                ticks: { values: [0, 0.5, 1] },
                labels: { ends: "hide" },
                style: {
                  tickLabel: {
                    verticalAlign,
                    background: { fill: "#eeeeee", stroke: "#000000", strokeWidth },
                    padding: 0,
                  },
                },
              }),
            ],
          },
          400,
          200,
        ).scene.panels[0]!;
      expect(labels(axisOn(aligned("bottom", 0), "left"))).toEqual(["0", "0.5"]);
      expect(labels(axisOn(aligned("bottom"), "left"))).toEqual(["0.5"]);
      expect(labels(axisOn(aligned("top", 0), "left"))).toEqual(["0.5", "1"]);
      expect(labels(axisOn(aligned("top"), "left"))).toEqual(["0.5"]);
      // Without a box, a block's lines start at its tick, its glyphs half a
      // leading inside: 24 px lines of 12 px text reach 18 px from the tick.
      const leading = (verticalAlign: "top" | "bottom", at: number, lineHeight = 2) =>
        build(
          {
            padding: 0,
            marks: [line(values, { x: "x", y: "v" })],
            x: { show: false, grid: false },
            y: { domain: [0, 1], nice: false },
            guides: [
              axis({
                scale: "y",
                ticks: { values: [at, 0.5] },
                labels: { ends: "hide" },
                style: { tickLabel: { verticalAlign, fontSize: 12, lineHeight } },
              }),
            ],
          },
          400,
          200,
        ).scene.panels[0]!;
      const top = leading("top", 0.08);
      const y = top.plot.y + top.plot.height * (1 - 0.08);
      expect(y + 12).toBeLessThan(200);
      expect(y + 18).toBeGreaterThan(200.5);
      expect(labels(axisOn(top, "left"))).toEqual(["0.5"]);
      const bottom = leading("bottom", 0.95);
      const up = bottom.plot.y + bottom.plot.height * (1 - 0.95);
      expect(up - 12).toBeGreaterThan(0);
      expect(up - 18).toBeLessThan(-0.5);
      expect(labels(axisOn(bottom, "left"))).toEqual(["0.5"]);
      // Lines taller than the chart: the glyphs below the middle cross its bottom.
      expect(labels(axisOn(leading("top", 0.5, 20), "left"))).toEqual([]);
      // Taller than the chart (a layer's labels keep their lines): left out,
      // where "room" cannot place it.
      const towering = (ends?: TickEnds) =>
        build(
          {
            padding: 0,
            marks: [line(values, { x: "x", y: "v" })],
            x: { show: false, grid: false },
            y: { domain: [0, 1], nice: false },
            guides: [
              axis({
                scale: "y",
                ticks: { values: [0.5] },
                layers: [
                  {
                    id: "tall",
                    ticks: { values: [1] },
                    format: () => Array(20).fill("line").join("\n"),
                    labels: ends ? { ends } : {},
                  },
                ],
              }),
            ],
          },
          400,
          200,
        ).scene.panels[0]!;
      expect(labels(axisOn(towering("hide"), "left"))).toEqual(["0.5"]);
      expect(() => towering()).toThrow(/does not fit the \d+ px down it stays inside/);
    },
    "are left out where the chart's edge would cut them, in place of being moved inside",
  );
});

describe("end labels between panels", () => {
  contractTest(
    "axis.tick-labels.ends.facets",
    () => {
      const data = table({ g: ["a", "a", "b", "b"], x: [0, 1000, 0, 1000], v: [0, 1, 0, 1] });
      const chart = (ends?: TickEnds) =>
        build({
          padding: 0,
          facet: facet("g", { columns: 2, header: false }),
          marks: [line(data, { x: "x", y: "v" })],
          x: { nice: false },
          y: { show: false, grid: false },
          guides: [
            axis({
              scale: "x",
              ticks: { values: [0, 500, 1000] },
              ...(ends && { labels: { ends } }),
            }),
          ],
        }).scene;
      const room = chart();
      const hide = chart("hide");
      const gap = (scene: Scene) => scene.panels[1]!.plot.x - right(scene, 0);
      expect(gap(room)).toBeGreaterThan(gap(hide));
      expect(gap(hide)).toBe(16);
      // Each panel's labels at the gap and at the chart's edges are left out.
      for (const panel of hide.panels) expect(labels(axisOn(panel, "bottom"))).toEqual(["500"]);
    },
    "are left out where they cross into the gap between facets' columns",
  );

  contractTest(
    "axis.tick-labels.ends.subplots",
    () => {
      // Two cells side by side over one spanning both, with an inset over it.
      const data = table({ x: [0, 1000], v: [0, 1] });
      const chart = (ends: TickEnds) =>
        build(
          {
            padding: 0,
            panels: panels(
              [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
              grid({ columns: 2, rows: 2 }, [
                cell({ row: 0, column: 0 }, subplot("a")),
                cell({ row: 0, column: 1 }, subplot("b")),
                cell({ row: 1, column: 0, columnSpan: 2 }, subplot("c", [inset("d")])),
              ]),
            ),
            marks: ["a", "b", "c", "d"].map((id) => line(data, { x: "x", y: "v", panel: id })),
            x: { nice: false },
            y: { show: false, grid: false },
            guides: [axis({ scale: "x", ticks: { values: [0, 500, 1000] }, labels: { ends } })],
          },
          800,
          400,
        ).scene;
      const room = chart("room");
      expect(room.panels[2]!.plot.x).toBeGreaterThan(0);
      const hide = chart("hide");
      for (const each of hide.panels) {
        expect(labels(axisOn(each, "bottom"))).toEqual(["500"]);
        expect(axisOn(each, "bottom")!.ticks).toHaveLength(3);
      }
      expect(hide.panels[2]!.plot).toMatchObject({ x: 0, width: 800 });
      // The inset's labels end at its own plot's sides, inside the chart.
      expect(hide.panels[3]!.plot.x).toBeGreaterThan(0);
    },
    "are left out where they cross a subplot's plot beside another, or an inset's",
  );
});

describe("ends", () => {
  // A colorbar's ends load, as its inside and gap do, and are refused as it compiles.
  it("is refused on colorbars, and checked in specs", () => {
    const cells = table({ x: [0, 1], y: [0, 1], v: [0, 1] });
    const heat = [heatmap(cells, { x: "x", y: "y", color: "v" })];
    const bar = colorbar({ labels: { ends: "hide" } as never });
    expect(() => build({ marks: heat, guides: [bar] })).toThrow(
      "chart guides[0].labels.ends: a colorbar's labels stand beside its ramp; drop ends",
    );
    const spec = (guide: object) => ({
      data: { t: { columns: { x: [0, 1], v: [0, 1] } } },
      marks: [{ type: "line", data: "t", x: "x", y: "v" }],
      guides: [guide],
    });
    expect(() =>
      loadSpec(spec({ type: "axis", scale: "x", labels: { ends: "drop" } }) as never),
    ).toThrow('guides[0].labels.ends: expected "room" or "hide"; received "drop"');
    expect(() =>
      loadSpec(
        spec({ type: "axis", scale: "x", layers: [{ id: "m", labels: { ends: 1 } }] }) as never,
      ),
    ).toThrow('guides[0].layers[0].labels.ends: expected "room" or "hide"; received 1');
    expect(
      loadSpec(spec({ type: "axis", scale: "x", labels: { ends: "hide" } }) as never).config.guides,
    ).toEqual([{ type: "axis", scale: "x", labels: { ends: "hide" } }]);
  });
});
