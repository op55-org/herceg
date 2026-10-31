// Axes the chart's guides list: on other sides, with tick layers, tick
// marks, lines, and labels turned or kept apart.
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { guideCompiler } from "../../src/guides/compile.ts";
import { axis } from "../../src/guides/options.ts";
import { estimateText, lineCount } from "../../src/layout/text.ts";
import { grid } from "../../src/layout.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { facet } from "../../src/model/facet.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { renderSvg } from "../../src/render/svg.ts";
import type { AxisGuide, Scene, SegmentsItem, TextItem } from "../../src/scene/scene.ts";
import { validateSpec } from "../../src/spec/validate.ts";
import { contractTest } from "../helpers/contracts.ts";
import { gridAt } from "../helpers/grid.ts";
import { drawnLines } from "../helpers/guides.ts";
import { setViewport } from "../helpers/views.ts";

const guides = guideCompiler(GUIDE_KIT);
const HOUR = 3_600_000;
const start = Date.UTC(2026, 8, 28);
const week = table({
  t: time(Array.from({ length: 49 }, (_, i) => start + i * HOUR)),
  v: Array.from({ length: 49 }, (_, i) => 50 + 40 * Math.sin(i / 5)),
});

function build(config: ChartConfig, width = 800, height = 320) {
  const model = new ChartModel({ locale: "en-US", timeZone: "UTC", ...config }, undefined, guides);
  model.setSize(width, height, 1);
  return { model, scene: model.scene(estimateText) };
}

const marks = [line(week, { x: "t", y: "v" })];
const axesOf = (scene: Scene) => scene.panels[0]!.axes;
const sideOf = (scene: Scene, side: AxisGuide["side"]) =>
  axesOf(scene).find((a) => a.side === side);
/** A guide's text, a line at a time. */
const texts = (guide: AxisGuide | undefined) =>
  drawnLines((guide?.items ?? []).filter((item): item is TextItem => item.type === "text"));
const segments = (guide: AxisGuide | undefined) =>
  (guide?.items ?? []).filter((item): item is SegmentsItem => item.type === "segments");

describe("listed axes on the default side", () => {
  it("draw as the automatic axes when they ask for nothing more", () => {
    const plain = build({ marks });
    const listed = build({ marks, guides: [axis({ scale: "x" }), axis({ scale: "y" })] });
    expect(renderSvg(listed.scene, { idPrefix: "a" })).toBe(
      renderSvg(plain.scene, { idPrefix: "a" }),
    );
  });

  it("take the short form's settings, and give theirs to the scale's axis", () => {
    const { scene } = build({
      marks,
      x: { title: "Time" },
      guides: [axis({ scale: "x", format: { time: "%H" } })],
    });
    const bottom = sideOf(scene, "bottom")!;
    expect(bottom.title?.text).toBe("Time");
    expect(bottom.ticks[0]!.label).toMatch(/^\d\d$/);
  });

  it("hide the automatic axis of a scale whose axes are all elsewhere", () => {
    const { scene } = build({ marks, guides: [axis({ scale: "x", place: { side: "top" } })] });
    expect(sideOf(scene, "bottom")).toBeUndefined();
    expect(sideOf(scene, "top")).toBeDefined();
    // Grid lines stay with the scale.
    expect(gridAt(scene.panels[0]!, "y").length).toBeGreaterThan(0);
  });
});

describe("axes on other sides", () => {
  it("put an x axis above the plot, in room taken from it", () => {
    const plain = build({ marks });
    const { scene } = build({
      marks,
      guides: [axis({ scale: "x" }), axis({ scale: "x", place: { side: "top" }, title: "Hours" })],
    });
    const plot = scene.panels[0]!.plot;
    expect(plot.y).toBeGreaterThan(plain.scene.panels[0]!.plot.y + 10);
    const top = sideOf(scene, "top")!;
    expect(top.edge).toBe(plot.y);
    for (const label of texts(top)) expect(label.y).toBeLessThan(plot.y);
    expect(texts(top).at(-1)!.text).toBe("Hours");
  });

  it("put the y scale's labels on the right too", () => {
    const plain = build({ marks });
    const { scene } = build({
      marks,
      guides: [axis({ scale: "y" }), axis({ scale: "y", place: { side: "right" } })],
    });
    const plot = scene.panels[0]!.plot;
    const right = sideOf(scene, "right")!;
    expect(right.scale).toBe("y");
    expect(texts(right).map((t) => t.text)).toEqual(
      sideOf(scene, "left")!.ticks.map((t) => t.label),
    );
    for (const label of texts(right)) expect(label.x).toBeGreaterThan(plot.x + plot.width);
    expect(plot.width).toBeLessThan(plain.scene.panels[0]!.plot.width);
  });

  it("move the only y axis to the right", () => {
    const { scene } = build({ marks, guides: [axis({ scale: "y", place: { side: "right" } })] });
    expect(sideOf(scene, "left")).toBeUndefined();
    const right = sideOf(scene, "right")!;
    expect(texts(right).length).toBeGreaterThan(2);
    const plot = scene.panels[0]!.plot;
    for (const label of texts(right)) expect(label.x).toBeGreaterThan(plot.x + plot.width);
  });

  it("draw the grid of a scale whose axes are all elsewhere as the first of them says", () => {
    const data = table({ x: [0, 1], v: [0, 10] });
    const moved = (grid: boolean) =>
      build({
        marks: [line(data, { x: "x", y: "v" })],
        y: { nice: false },
        guides: [axis({ scale: "y", place: { side: "right" }, ticks: { values: [2, 8] }, grid })],
      }).scene.panels[0]!;
    expect(gridAt(moved(false), "y")).toEqual([]);
    const lines = moved(true);
    expect(gridAt(lines, "y")).toHaveLength(2);
    expect(texts(lines.axes.find((a) => a.side === "right")).map((t) => t.text)).toEqual([
      "2",
      "8",
    ]);
    // Planned once: the axis' ticks are the grid's, whatever its format leaves out.
    const unit = build({
      marks: [line(table({ x: [0, 1], v: [0, 1] }), { x: "x", y: "v" })],
      y: { nice: false },
      guides: [
        axis({
          scale: "y",
          place: { side: "right" },
          ticks: 5,
          format: { maximumFractionDigits: 0 },
          grid: true,
        }),
      ],
    }).scene.panels[0]!;
    const right = unit.axes.find((a) => a.side === "right")!;
    expect(gridAt(unit, "y")).toEqual(right.ticks.map((t) => t.position));
    // Moved, it leaves a label repeating the one before blank, as its layers do.
    expect(right.ticks.map((t) => t.label)).toEqual(["0", "1", ""]);
  });

  it("take subplots' own titles to the side an axis moves to", () => {
    const { scene } = build(
      {
        panels: panels(
          [
            { id: "a", y: { title: "First" } },
            { id: "b", y: { title: "Second" } },
          ],
          grid({ columns: 1 }),
        ),
        marks: ["a", "b"].map((panel) => line(week, { x: "t", y: "v", panel })),
        guides: [axis({ scale: "y", place: { side: "right" } })],
      },
      640,
      480,
    );
    const titles = scene.panels.map(
      (panel) => texts(panel.axes.find((a) => a.side === "right")).at(-1)!.text,
    );
    expect(titles).toEqual(["First", "Second"]);
  });

  it("leave out of a moved axis the subplots that hide it", () => {
    const { scene } = build(
      {
        panels: panels([{ id: "a", y: { show: false } }, { id: "b" }], grid({ columns: 1 })),
        marks: ["a", "b"].map((panel) => line(week, { x: "t", y: "v", panel })),
        guides: [axis({ scale: "y", place: { side: "right" } })],
      },
      640,
      480,
    );
    expect(scene.panels.map((panel) => panel.axes.some((a) => a.side === "right"))).toEqual([
      false,
      true,
    ]);
  });

  it("refuse a subplot showing an axis moved elsewhere on its default side", () => {
    expect(() =>
      build({
        panels: panels([{ id: "a", x: { show: true } }, { id: "b" }], grid({ columns: 2 })),
        marks: ["a", "b"].map((panel) => line(week, { x: "t", y: "v", panel })),
        guides: [axis({ scale: "x", place: { side: "top" } })],
      }),
    ).toThrow(
      "chart panels[0].x.show: the guides list x's axes elsewhere, which hides its axis on the bottom; drop show, or list an axis on the bottom",
    );
  });

  it("draw a moved axis in each subplot's own styles", () => {
    const { scene } = build(
      {
        panels: panels(
          [
            { id: "a", y: { style: { tickLabel: { color: "#cc0000" } } } },
            { id: "b", y: { style: { tickLabel: { color: "#00cc00" } } } },
          ],
          grid({ columns: 1 }),
        ),
        marks: ["a", "b"].map((panel) => line(week, { x: "t", y: "v", panel })),
        y: { style: { tickLabel: { color: "#0000cc" } } },
        guides: [axis({ scale: "y", place: { side: "right" } })],
      },
      640,
      480,
    );
    const colors = scene.panels.map(
      (panel) => texts(panel.axes.find((a) => a.side === "right"))[0]!.paint.color,
    );
    expect(colors).toEqual(["#cc0000", "#00cc00"]);
  });

  it("keep turned labels of a reversed axis apart", () => {
    const data = table({ x: [0, 10], v: [0, 1] });
    const { scene } = build({
      marks: [line(data, { x: "x", y: "v" })],
      x: { domain: [10, 0] },
      guides: [
        axis({
          scale: "x",
          place: { side: "top" },
          ticks: { values: [4, 5] },
          format: (v) => (v === 4 ? "a" : "a much longer label for five"),
          labels: { rotation: -5, overlap: "hide" },
        }),
      ],
    });
    expect(texts(sideOf(scene, "top")).length).toBe(1);
  });

  it("take the scale's title to the side an axis moves to", () => {
    const { scene } = build({
      marks,
      y: { title: "Value" },
      x: { title: "Time" },
      guides: [
        axis({ scale: "y", place: { side: "right" } }),
        axis({ scale: "x", place: { side: "top" } }),
      ],
    });
    expect(texts(sideOf(scene, "right")).at(-1)!.text).toBe("Value");
    expect(texts(sideOf(scene, "top")).at(-1)!.text).toBe("Time");
    expect(sideOf(scene, "left")).toBeUndefined();
    expect(sideOf(scene, "bottom")).toBeUndefined();
  });

  it("keep a scale's axis hidden where its short form hides it", () => {
    for (const place of [undefined, { side: "right" as const }]) {
      const { scene } = build({
        marks,
        y: { show: false },
        guides: [axis({ scale: "y", ...(place && { place }) })],
      });
      expect(sideOf(scene, "left")).toBeUndefined();
      expect(sideOf(scene, "right")).toBeUndefined();
    }
  });

  it("leave out axes elsewhere that are not shown, and their room", () => {
    const plain = build({ marks });
    const { scene } = build({
      marks,
      guides: [axis({ scale: "x" }), axis({ scale: "x", place: { side: "top" }, show: false })],
    });
    expect(sideOf(scene, "top")).toBeUndefined();
    expect(scene.panels[0]!.plot).toEqual(plain.scene.panels[0]!.plot);
  });

  it("put a y axis on the right beside each subplot with a y scale of its own, or a row's last", () => {
    const right = (y?: ChartConfig["y"]) =>
      build({
        panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 2 })),
        marks: ["a", "b"].map((panel) => line(week, { x: "t", y: "v", panel })),
        guides: [axis({ scale: "y", place: { side: "right" } })],
        ...(y && { y }),
      }).scene.panels.map((panel) => panel.axes.some((a) => a.side === "right"));
    expect(right()).toEqual([true, true]);
    expect(right({ scope: "row" })).toEqual([false, true]);
    // Facet rows put it beside their last panel only, so they must share y.
    expect(() =>
      build({
        marks: [
          line(table({ t: [0, 1, 0, 1], v: [1, 2, 3, 4], g: ["a", "a", "b", "b"] }), {
            x: "t",
            y: "v",
          }),
        ],
        facet: facet("g", { columns: 2 }),
        y: { scope: "panel" },
        guides: [axis({ scale: "y", place: { side: "right" } })],
      }),
    ).toThrow(
      'chart guides[0].place.side: a y axis on the right stands beside each row\'s last panel, so the panels of a row must share y; give y scope "row" or "chart", repeat "all" for one beside every panel, or keep the axis on the left',
    );
  });

  it("refuse sides an axis cannot take", () => {
    expect(() => build({ marks, guides: [axis({ scale: "x", place: { side: "left" } })] })).toThrow(
      'chart guides[0].place.side: x axes go on the "top" or the "bottom"; received "left"',
    );
    expect(() => build({ marks, guides: [axis({ scale: "x" }), axis({ scale: "x" })] })).toThrow(
      'chart guides[1].place.side: scale x has an axis on the bottom already; give this one "top"',
    );
    expect(() =>
      build({
        marks: [...marks, line(week, { x: "t", y: "v", axis: "right" })],
        guides: [axis({ scale: "y", place: { side: "right" } })],
      }),
    ).toThrow(/marks with axis: "right" put yRight's axis on the right/);
  });
});

describe("tick layers", () => {
  it("draw a row of day boundaries under hourly labels", () => {
    const plain = build({ marks, x: { ticks: { every: "6 hours" }, format: { time: "%H:%M" } } });
    const { scene } = build({
      marks,
      x: { ticks: { every: "6 hours" }, format: { time: "%H:%M" } },
      guides: [
        axis({
          scale: "x",
          layers: [
            {
              id: "day",
              ticks: { every: "day" },
              format: { time: "%b %-d" },
              tick: { length: 12 },
              labels: { row: 1 },
            },
          ],
        }),
      ],
    });
    const bottom = sideOf(scene, "bottom")!;
    const labels = texts(bottom);
    const hours = labels.filter((t) => /:/.test(t.text));
    const days = labels.filter((t) => /^Sep/.test(t.text));
    expect(days.map((t) => t.text)).toEqual(["Sep 28", "Sep 29", "Sep 30"]);
    expect(days[0]!.y).toBeGreaterThan(hours[0]!.y + 8);
    // The plot gives the second row its room.
    expect(scene.panels[0]!.plot.height).toBeLessThan(plain.scene.panels[0]!.plot.height);
    // Day ticks reach further than hourly ones, drawn once where both fall.
    const coords = segments(bottom).flatMap((s) => [...s.coords]);
    const lengths = new Map<number, number>();
    for (let k = 0; k + 3 < coords.length; k += 4)
      if (coords[k] === coords[k + 2]) lengths.set(coords[k]!, coords[k + 3]! - coords[k + 1]!);
    expect(Math.max(...lengths.values())).toBe(12);
    expect(Math.min(...lengths.values())).toBe(5);
  });

  it("let a layer of higher priority label a row where labels would meet", () => {
    const { scene } = build({
      marks,
      x: { ticks: { every: "6 hours" }, format: { time: "%H:%M" } },
      guides: [
        axis({
          scale: "x",
          layers: [
            {
              id: "day",
              ticks: { every: "day" },
              format: { time: "%b %-d" },
              labels: { priority: 1 },
            },
          ],
        }),
      ],
    });
    const labels = texts(sideOf(scene, "bottom")).map((t) => t.text);
    // At midnight the date, not the hour.
    expect(labels).toContain("Sep 29");
    expect(labels.filter((label) => label === "00:00")).toHaveLength(0);
    expect(labels).toContain("06:00");
  });

  it("plan a layer about its own count of ticks", () => {
    const data = table({ x: [0, 100], v: [0, 1] });
    const { model } = build({
      marks: [line(data, { x: "x", y: "v" })],
      guides: [axis({ scale: "x", ticks: 2, layers: [{ id: "minor", ticks: 20, labels: false }] })],
    });
    expect(model.panels()[0]!.plans.x.ticks).toEqual([0, 50, 100]);
    const bottom = sideOf(model.scene(estimateText), "bottom")!;
    const marked = new Set(segments(bottom).flatMap((s) => s.coords.filter((_, k) => k % 4 === 0)));
    expect(marked.size).toBeGreaterThan(15);
  });

  it("draw a layer's labels in its own style: halo and box too", () => {
    const { scene } = build({
      marks,
      guides: [
        axis({
          scale: "x",
          layers: [
            {
              id: "day",
              ticks: { every: "day" },
              format: { time: "%b %-d" },
              labels: { row: 1 },
              style: {
                tickLabel: {
                  color: "#aa0000",
                  halo: { color: "#ffffff", width: 2 },
                  background: { fill: "#eeeeee" },
                  padding: 2,
                },
              },
            },
          ],
        }),
      ],
    });
    // The automatic labels write the day at midnight too; the layer's are in the row below.
    const day = texts(sideOf(scene, "bottom"))
      .filter((t) => t.text === "Sep 29")
      .sort((a, b) => b.y - a.y)[0]!;
    expect(day.paint.color).toBe("#aa0000");
    expect(day.halo).toMatchObject({ color: "#ffffff", width: 2 });
    expect(day.box).toBeDefined();
  });

  it("keep room on y for layers' labels wider than the axis' own", () => {
    const plain = build({ marks });
    const { scene } = build({
      marks,
      guides: [
        axis({
          scale: "y",
          layers: [{ id: "mid", ticks: { values: [50] }, format: { number: ".4f" } }],
        }),
      ],
    });
    const left = sideOf(scene, "left")!;
    const mid = texts(left).find((t) => t.text === "50.0000")!;
    const width = estimateText(mid.text, mid.paint.css);
    // Labels end at the axis' gap; the widest starts inside the chart.
    expect(mid.x - width).toBeGreaterThanOrEqual(0);
    expect(scene.panels[0]!.plot.x).toBeGreaterThan(plain.scene.panels[0]!.plot.x);
  });

  it("draw minor ticks without labels", () => {
    const { scene } = build({
      marks,
      guides: [axis({ scale: "y", layers: [{ id: "minor", ticks: { every: 5 }, labels: false }] })],
    });
    const left = sideOf(scene, "left")!;
    expect(segments(left).length).toBeGreaterThan(0);
    expect(texts(left).length).toBe(left.ticks.length);
  });
});

describe("tick marks and lines", () => {
  it("point tick marks into the plot", () => {
    const { scene } = build({
      marks,
      guides: [axis({ scale: "x", tick: { direction: "in", length: 6 } })],
    });
    const bottom = sideOf(scene, "bottom")!;
    const edge = Math.round(bottom.edge) + 0.5;
    const coords = [...segments(bottom)[0]!.coords];
    // After the axis line, each tick runs from 6 pixels up to the line.
    expect(coords[5]).toBe(edge - 6);
    expect(coords[7]).toBe(edge);
  });

  it("draw a y axis' line when asked, in its own style", () => {
    const { scene } = build({
      marks,
      y: { style: { axisLine: { stroke: "#246" }, tickLabel: { color: "#246" } } },
      guides: [axis({ scale: "y", line: true })],
    });
    const left = sideOf(scene, "left")!;
    const [stroke] = segments(left);
    expect(stroke!.paint.stroke).toBe("#246");
    expect(stroke!.coords[0]).toBe(stroke!.coords[2]);
    expect(texts(left)[0]!.paint.color).toBe("#246");
  });
});

describe("tick labels", () => {
  const names = table({
    name: ["Northern Hemisphere", "Southern Hemisphere", "Equatorial Belt", "Polar Regions"],
    v: [3, 5, 2, 4],
  });

  it("turn labels and keep room for them", () => {
    const plain = build({ marks: [bar(names, { x: "name", y: "v" })] }, 300);
    const { scene } = build(
      {
        marks: [bar(names, { x: "name", y: "v" })],
        guides: [axis({ scale: "x", labels: { rotation: -45 } })],
      },
      300,
    );
    const labels = texts(sideOf(scene, "bottom"));
    expect(labels.length).toBe(4);
    for (const label of labels) {
      expect(label.angle).toBe(-45);
      expect(label.anchor).toBe("end");
    }
    expect(scene.panels[0]!.plot.height).toBeLessThan(plain.scene.panels[0]!.plot.height - 20);
  });

  it("choose the first rotation at which labels fit", () => {
    const { scene } = build(
      {
        marks: [bar(names, { x: "name", y: "v" })],
        guides: [axis({ scale: "x", labels: { rotation: { candidates: [0, -30, -90] } } })],
      },
      300,
    );
    expect(texts(sideOf(scene, "bottom"))[0]!.angle).not.toBe(0);
  });

  it("keep room for labels turned in each panel's own width", () => {
    // Labels that fit flat in a third of the chart, not in a panel's plot.
    const regions = table({
      name: ["Northwest", "Northeast", "Southwest", "Southeast"],
      v: [3, 5, 2, 4],
    });
    const ids = ["a", "b", "c"];
    const { scene } = build(
      {
        panels: panels(
          ids.map((id) => ({ id })),
          grid({ columns: 3 }),
        ),
        marks: ids.map((panel) => bar(regions, { x: "name", y: "v", panel })),
        guides: [axis({ scale: "x", labels: { rotation: { candidates: [0, -90] } } })],
      },
      780,
      300,
    );
    for (const panel of scene.panels)
      for (const label of texts(panel.axes.find((a) => a.side === "bottom"))) {
        expect(label.angle).toBe(-90);
        // Turned a quarter, a label ends at its tick and runs down from it.
        expect(label.y + estimateText(label.text, label.paint.css)).toBeLessThanOrEqual(300);
      }
  });

  it("keep room for turned labels as zooming lengthens them", () => {
    const data = table({ x: [0, 1000], v: [0, 1] });
    const { model } = build(
      {
        marks: [line(data, { x: "x", y: "v" })],
        x: { format: { number: ",.4f" } },
        guides: [axis({ scale: "x", labels: { rotation: { candidates: [0, -90] } } })],
      },
      650,
      320,
    );
    for (const view of [
      [0, 1000],
      [0, 10],
      [100, 100.5],
      [5000, 905000],
    ] as const) {
      setViewport(model, [view[0], view[1]]);
      const scene = model.scene(estimateText);
      for (const label of texts(sideOf(scene, "bottom")))
        if (label.angle === -90)
          expect(label.y + estimateText(label.text, label.paint.css)).toBeLessThanOrEqual(320);
    }
  });

  it("turn labels above the plot away from it", () => {
    const { scene } = build(
      {
        marks: [bar(names, { x: "name", y: "v" })],
        guides: [axis({ scale: "x", place: { side: "top" }, labels: { rotation: -90 } })],
      },
      300,
      400,
    );
    const plot = scene.panels[0]!.plot;
    for (const label of texts(sideOf(scene, "top"))) {
      expect(label.anchor).toBe("start");
      // Turned a quarter and starting at its tick, a label runs up from it.
      expect(label.y).toBeLessThanOrEqual(plot.y);
      expect(label.y - estimateText(label.text, label.paint.css)).toBeGreaterThanOrEqual(0);
    }
  });

  it("stagger the labels they keep, every other one a lane further out", () => {
    const data = table({ x: [0, 100], v: [0, 1] });
    const { scene } = build(
      {
        marks: [line(data, { x: "x", y: "v" })],
        guides: [
          axis({
            scale: "x",
            ticks: { every: 1 },
            format: { number: ".1f" },
            labels: { overlap: "stagger" },
          }),
        ],
      },
      400,
    );
    const shown = texts(sideOf(scene, "bottom")).sort((a, b) => a.x - b.x);
    expect(shown.length).toBeGreaterThan(4);
    for (let k = 1; k < shown.length; k++) expect(shown[k]!.y).not.toBe(shown[k - 1]!.y);
  });

  it("measure and align a title above the plot in its own style", () => {
    const { scene } = build({
      marks,
      guides: [
        axis({ scale: "x" }),
        axis({
          scale: "x",
          place: { side: "top" },
          title: "Hours",
          style: { axisTitle: { fontSize: 40, align: "start" } },
        }),
      ],
    });
    const top = sideOf(scene, "top")!;
    const title = texts(top).at(-1)!;
    expect(title.text).toBe("Hours");
    expect(title.anchor).toBe("start");
    expect(title.x).toBe(scene.panels[0]!.plot.x);
    // The whole title clears the labels, which clear the plot.
    const lowestLabel = Math.min(
      ...texts(top)
        .slice(0, -1)
        .map((t) => t.y),
    );
    expect(title.y + title.paint.lineHeight / 2).toBeLessThanOrEqual(lowestLabel);
    expect(title.y - title.paint.lineHeight / 2).toBeGreaterThanOrEqual(0);
  });

  it("keep labels on y one above the other unless their lines meet", () => {
    const data = table({ x: [0, 1], v: [0, 100] });
    const { scene } = build(
      {
        marks: [line(data, { x: "x", y: "v" })],
        y: { title: "Load" },
        guides: [
          axis({
            scale: "y",
            ticks: { every: 10 },
            format: { number: ",.3f" },
            labels: { overlap: "hide" },
          }),
        ],
      },
      400,
      400,
    );
    const left = sideOf(scene, "left")!;
    // Eleven wide labels about 30 pixels apart all fit one above the other.
    expect(left.ticks.filter((t) => t.label).length).toBe(11);
  });

  it("keep room for turned labels' boxes, padding and all", () => {
    const data = table({ x: [0, 1], v: [0, 1] });
    for (const side of ["bottom", "top"] as const) {
      const { scene } = build(
        {
          marks: [line(data, { x: "x", y: "v" })],
          guides: [
            axis({
              scale: "x",
              place: { side },
              format: () => "X",
              labels: { rotation: -45 },
              style: {
                tickLabel: { background: { fill: "#eeeeee" }, padding: { left: 10, right: 10 } },
              },
            }),
          ],
        },
        640,
        320,
      );
      for (const label of texts(sideOf(scene, side))) {
        // The box's corners, turned about the text's point as renderers turn them.
        const { x, y, width, height } = label.box!;
        const turn = (label.angle * Math.PI) / 180;
        const ys = [x, x + width].flatMap((cx) =>
          [y, y + height].map(
            (cy) => label.y + (cx - label.x) * Math.sin(turn) + (cy - label.y) * Math.cos(turn),
          ),
        );
        expect(Math.max(...ys)).toBeLessThanOrEqual(320);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("keep labels above the plot inside the chart's sides, and their boxes off the plot", () => {
    const data = table({ x: [0, 10], v: [0, 1] });
    const turnedAbove = build(
      {
        marks: [line(data, { x: "x", y: "v" })],
        guides: [
          axis({
            scale: "x",
            place: { side: "top" },
            ticks: { values: [0, 10] },
            format: () => "A very long label for a value",
            labels: { rotation: -45 },
          }),
        ],
      },
      640,
    ).scene;
    for (const label of texts(sideOf(turnedAbove, "top"))) {
      const reach = estimateText(label.text, label.paint.css) * Math.SQRT1_2;
      expect(label.x + reach).toBeLessThanOrEqual(640);
    }
    const boxed = build({
      marks: [line(data, { x: "x", y: "v" })],
      guides: [
        axis({ scale: "x" }),
        axis({
          scale: "x",
          place: { side: "top" },
          style: {
            tickLabel: { background: { fill: "#eeeeee" }, padding: { top: 20, bottom: 20 } },
          },
        }),
      ],
    }).scene;
    const plot = boxed.panels[0]!.plot;
    for (const label of texts(sideOf(boxed, "top")))
      expect(label.box!.y + label.box!.height).toBeLessThanOrEqual(plot.y);
  });

  it("keep each panel's turned labels inside the chart, whatever the panel above draws", () => {
    const data = table({ x: [0, 10], v: [0, 1] });
    const long = () => "A very long label for a value";
    for (const config of [
      {
        panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 1 })),
        marks: ["a", "b"].map((panel) => line(data, { x: "x", y: "v", panel })),
        guides: [
          axis({ scale: "x", ticks: { values: [0, 10] }, format: long, labels: { rotation: -45 } }),
        ],
      },
      {
        marks: [line(data, { x: "x", y: "v" })],
        guides: [
          axis({
            scale: "x",
            ticks: { values: [] },
            layers: [
              { id: "ends", ticks: { values: [0, 10] }, format: long, labels: { rotation: -45 } },
            ],
          }),
        ],
      },
    ] as ChartConfig[]) {
      const { scene } = build(config, 640, 400);
      for (const panel of scene.panels)
        for (const label of texts(panel.axes.find((a) => a.side === "bottom")))
          expect(
            label.x - estimateText(label.text, label.paint.css) * Math.SQRT1_2,
          ).toBeGreaterThanOrEqual(0);
    }
  });

  it("put wrapped labels above the plot as a block", () => {
    const data = table({ x: [0, 2], v: [0, 1] });
    const { scene } = build(
      {
        marks: [line(data, { x: "x", y: "v" })],
        guides: [
          axis({
            scale: "x",
            place: { side: "top" },
            ticks: { values: [0, 1, 2] },
            format: (v) => `${v} one two three four five`,
            labels: { overlap: "wrap" },
          }),
        ],
      },
      300,
    );
    const plot = scene.panels[0]!.plot;
    const lines = texts(sideOf(scene, "top"));
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines)
      expect(line.y + line.paint.lineHeight / 2).toBeLessThanOrEqual(plot.y);
  });

  it("keep y labels apart where the chart's edges move them", () => {
    const data = table({ x: [0, 1], v: [0, 1] });
    const { scene } = build(
      {
        marks: [line(data, { x: "x", y: "v" })],
        y: { nice: false },
        guides: [
          axis({
            scale: "y",
            layers: [
              {
                id: "big",
                ticks: { values: [0.6, 1] },
                labels: { overlap: "hide" },
                style: { tickLabel: { fontSize: 80 } },
              },
            ],
          }),
        ],
      },
      640,
      320,
    );
    const big = texts(sideOf(scene, "left")).filter((t) => t.paint.size === 80);
    for (let k = 1; k < big.length; k++)
      expect(Math.abs(big[k]!.y - big[k - 1]!.y)).toBeGreaterThanOrEqual(big[k]!.paint.lineHeight);
  });

  it("keep labels of several lines along y apart and inside the chart", () => {
    const data = table({ x: [0, 1], v: [0, 1] });
    const { scene } = build(
      {
        marks: [line(data, { x: "x", y: "v" })],
        y: { nice: false },
        guides: [
          axis({
            scale: "y",
            ticks: { values: [0, 0.12, 1] },
            format: (v) => `${v}\nsecond\nthird`,
            labels: { overlap: "hide" },
            style: { tickLabel: { fontSize: 20 } },
          }),
        ],
      },
      640,
      320,
    );
    const lines = texts(sideOf(scene, "left"));
    const height = lines[0]!.paint.lineHeight;
    for (const line of lines) {
      expect(line.y - height / 2).toBeGreaterThanOrEqual(0);
      expect(line.y + height / 2).toBeLessThanOrEqual(320);
    }
    // Two blocks of three lines, not three overlapping ones.
    expect(lines).toHaveLength(6);
    // Blocks of different heights meet by both halves.
    const mixed = build(
      {
        marks: [line(data, { x: "x", y: "v" })],
        y: { nice: false },
        guides: [
          axis({
            scale: "y",
            ticks: { values: [0.5, 0.62] },
            format: (v) => (v === 0.5 ? "one" : "one\ntwo\nthree"),
            labels: { overlap: "hide" },
            style: { tickLabel: { fontSize: 20 } },
          }),
        ],
      },
      640,
      320,
    ).scene;
    expect(texts(sideOf(mixed, "left")).length).toBeLessThan(4);
  });

  it("write labels that may turn on one line", () => {
    const data = table({ x: [0, 1], v: [0, 1] });
    const { scene } = build({
      marks: [line(data, { x: "x", y: "v" })],
      guides: [axis({ scale: "x", format: (v) => `${v}\none`, labels: { rotation: -45 } })],
    });
    for (const label of texts(sideOf(scene, "bottom"))) expect(label.text).not.toContain("\n");
    expect(texts(sideOf(scene, "bottom"))[0]!.text).toMatch(/ one$/);
  });

  it("refuse turns beyond a quarter", () => {
    expect(() =>
      build({ marks, guides: [axis({ scale: "x", labels: { rotation: 270 } })] }),
    ).toThrow(
      "chart guides[0].labels.rotation: 270 degrees is beyond a quarter turn; give degrees from -90 (reading up) to 90 (reading down)",
    );
  });

  it("refuse wrapping turned labels", () => {
    expect(() =>
      build({
        marks,
        guides: [axis({ scale: "x", labels: { overlap: "wrap", rotation: -45 } })],
      }),
    ).toThrow(
      'chart guides[0].labels.overlap: "wrap" breaks labels that lie flat; drop rotation, or keep turned labels apart with "hide" or "stagger"',
    );
  });

  it("keep a layer's taller labels at the plot's ends inside the chart", () => {
    const data = table({ x: [0, 1], v: [0, 1] });
    const { scene } = build(
      {
        marks: [line(data, { x: "x", y: "v" })],
        guides: [
          axis({
            scale: "y",
            layers: [
              { id: "ends", ticks: { values: [0, 1] }, style: { tickLabel: { fontSize: 80 } } },
            ],
          }),
        ],
      },
      640,
      320,
    );
    for (const label of texts(sideOf(scene, "left"))) {
      const half = label.paint.lineHeight / 2;
      expect(label.y - half).toBeGreaterThanOrEqual(0);
      expect(label.y + half).toBeLessThanOrEqual(320);
    }
  });

  it("choose a turn by the labels drawn, not the blank ticks between them", () => {
    const data = table({ x: [0, 4], v: [0, 1] });
    const { scene } = build(
      {
        marks: [line(data, { x: "x", y: "v" })],
        guides: [
          axis({
            scale: "x",
            ticks: { values: [0, 1, 2, 3, 4] },
            format: (v) => (v % 2 ? "" : "A rather long label for the tick, and longer"),
            labels: { rotation: { candidates: [0, -90] } },
          }),
        ],
      },
      400,
    );
    expect(texts(sideOf(scene, "bottom")).every((t) => t.angle === -90)).toBe(true);
  });

  it("keep a label of lower priority out from under one of another size", () => {
    const { scene } = build({
      marks,
      x: { ticks: { every: "6 hours" }, format: { time: "%H:%M" } },
      guides: [
        axis({
          scale: "x",
          style: { tickLabel: { fontSize: 48 } },
          layers: [
            {
              id: "day",
              ticks: { every: "day" },
              format: { time: "%d" },
              labels: { priority: 1 },
              style: { tickLabel: { fontSize: 10 } },
            },
          ],
        }),
      ],
    });
    const labels = texts(sideOf(scene, "bottom"));
    const days = labels.filter((t) => t.paint.size === 10);
    const hours = labels.filter((t) => t.paint.size === 48);
    expect(days.length).toBeGreaterThan(0);
    // No hour label's box meets a day's.
    for (const day of days)
      for (const hour of hours) {
        const half = estimateText(hour.text, hour.paint.css) / 2;
        expect(Math.abs(hour.x - day.x)).toBeGreaterThan(half);
      }
  });

  it("keep labels' boxes apart, padding and all", () => {
    const data = table({ x: [0, 1], v: [0, 100] });
    const { scene } = build(
      {
        marks: [line(data, { x: "x", y: "v" })],
        guides: [
          axis({
            scale: "y",
            ticks: { every: 10 },
            labels: { overlap: "hide" },
            style: { tickLabel: { background: { fill: "#eeeeee" }, padding: 10 } },
          }),
        ],
      },
      400,
      400,
    );
    const kept = sideOf(scene, "left")!.ticks.filter((t) => t.label);
    const tall = texts(sideOf(scene, "left"))[0]!.paint.lineHeight + 20;
    for (let k = 1; k < kept.length; k++)
      expect(Math.abs(kept[k]!.position - kept[k - 1]!.position)).toBeGreaterThanOrEqual(tall);
  });

  it("hide labels that would overlap, every n-th kept", () => {
    const data = table({ x: [0, 100], v: [0, 1] });
    const { scene } = build(
      {
        marks: [line(data, { x: "x", y: "v" })],
        guides: [axis({ scale: "x", ticks: { every: 1 }, labels: { overlap: "hide" } })],
      },
      400,
    );
    const bottom = sideOf(scene, "bottom")!;
    const shown = bottom.ticks.filter((t) => t.label);
    expect(shown.length).toBeLessThan(bottom.ticks.length / 2);
    expect(shown.length).toBeGreaterThan(2);
  });
});

describe("axis room", () => {
  const sized = (values: number[]) => line(table({ x: [0, 1, 2], v: values }), { x: "x", y: "v" });
  const plotX = (scene: Scene) => scene.panels[0]!.plot.x;

  contractTest("axis.room.fixed", () => {
    // Labels of different widths: a fixed room lines the plots up.
    const narrow = [sized([1, 5, 9])];
    const wide = [sized([100000, 500000, 900000])];
    const fixed = axis({ scale: "y", room: 28 });
    const a = build({ marks: narrow, guides: [fixed] }).scene;
    const b = build({ marks: wide, guides: [fixed] }).scene;
    expect(plotX(a)).toBe(plotX(b));
    expect(plotX(build({ marks: narrow }).scene)).not.toBe(plotX(build({ marks: wide }).scene));
    // Labels wider than the room are shortened, never drawn past it.
    const left = sideOf(b, "left")!;
    const labels = texts(left).map(({ text }) => text);
    expect(labels.some((text) => text.endsWith("…"))).toBe(true);
    for (const box of left.labelBoxes ?? [])
      expect(box.box.x).toBeGreaterThanOrEqual(plotX(b) - 28 - 0.5);
    // Bounds hold the room within them: a least room widens narrow labels'.
    const least = build({ marks: narrow, guides: [axis({ scale: "y", room: { min: 60 } })] }).scene;
    expect(plotX(least)).toBeGreaterThan(plotX(a) + 25);
    const most = build({ marks: wide, guides: [axis({ scale: "y", room: { max: 28 } })] }).scene;
    expect(plotX(most)).toBe(plotX(b));
    // Boxes and their outlines stay in the room too; where not even an
    // ellipsis fits, the label is left out.
    const boxed = (room: number) =>
      build({
        marks: wide,
        guides: [
          axis({
            scale: "y",
            room,
            style: {
              tickLabel: {
                background: { fill: "#eee", stroke: "#999", strokeWidth: 2 },
                padding: 10,
              },
            },
          }),
        ],
      }).scene;
    const roomy = boxed(40);
    for (const box of sideOf(roomy, "left")!.labelBoxes ?? [])
      expect(box.box.x - 1).toBeGreaterThanOrEqual(plotX(roomy) - 40 - 0.5);
    expect(texts(sideOf(boxed(24), "left")!).filter(({ text }) => text !== "")).toEqual([]);
    // Labels of several lines none of which fit are left out whole, their
    // boxes too, on either side.
    for (const side of ["left", "right"] as const) {
      const scale = side === "left" ? "y" : "yRight";
      const { scene } = build({
        marks: [
          line(table({ x: [0, 1, 2], v: [100000, 500000, 900000] }), {
            x: "x",
            y: "v",
            axis: side,
          }),
        ],
        guides: [
          axis({
            scale,
            room: 12,
            format: (v) => `${v}\n${v}`,
            style: {
              tickLabel: {
                background: { fill: "#eee", stroke: "#999", strokeWidth: 2 },
                padding: 10,
              },
            },
          }),
        ],
      });
      const drawn = sideOf(scene, side)!.items.filter((item) => item.type === "text" && item.box);
      expect(drawn).toEqual([]);
    }
    // Shortened before labels are chosen among: a label the room leaves
    // out gives way to one of lower priority at its tick that fits.
    const { scene: kept } = build({
      marks: [sized([0, 0.5, 1])],
      y: { domain: [0, 1] },
      guides: [
        axis({
          scale: "y",
          room: 30,
          labels: false,
          layers: [
            {
              id: "long",
              ticks: { values: [0.5] },
              format: () => "long\nlong",
              labels: { priority: 10 },
              style: { tickLabel: { background: { fill: "#eee" }, padding: 15 } },
            },
            { id: "short", ticks: { values: [0.5] }, format: () => "ok", labels: { priority: 0 } },
          ],
        }),
      ],
    });
    expect(texts(sideOf(kept, "left")).map(({ text }) => text)).toContain("ok");
    // Halos too.
    const haloed = build({
      marks: wide,
      guides: [
        axis({
          scale: "y",
          room: 40,
          style: { tickLabel: { halo: { color: "#fff", width: 20 } } },
        }),
      ],
    }).scene;
    for (const box of sideOf(haloed, "left")!.labelBoxes ?? [])
      expect(box.box.x - 10).toBeGreaterThanOrEqual(plotX(haloed) - 40 - 0.5);
  });

  it("holds a y axis on the right in its room", () => {
    const wide = [
      line(table({ x: [0, 1, 2], v: [100000, 500000, 900000] }), { x: "x", y: "v", axis: "right" }),
    ];
    const plot = (room?: number) =>
      build({ marks: wide, guides: [axis({ scale: "yRight", ...(room && { room }) })] }).scene
        .panels[0]!.plot;
    const fixed = plot(30);
    expect(800 - (fixed.x + fixed.width)).toBeLessThan(800 - (plot().x + plot().width));
  });

  it("is refused on x axes, colorbars, and below zero", () => {
    expect(() => build({ marks, guides: [axis({ scale: "x", room: 20 })] })).toThrow(
      "chart guides[0].room: x axes take the depth their rows of labels need, and an ellipsis shortens only y axes' labels; drop room",
    );
    expect(() =>
      build({ marks, guides: [axis({ scale: "y", room: { min: 30, max: 20 } })] }),
    ).toThrow(
      /chart guides\[0\]\.room: expected finite pixels of at least 0, or \{ min, max \} with min no more than max/,
    );
    // Pixels given are finite; a most left out is no bound.
    for (const room of [Number.POSITIVE_INFINITY, { max: Number.POSITIVE_INFINITY }, Number.NaN])
      expect(() => build({ marks, guides: [axis({ scale: "y", room })] })).toThrow(
        /chart guides\[0\]\.room: expected finite pixels of at least 0.*; received (Infinity|NaN|\{ min: undefined, max: Infinity \})$/,
      );
    expect(() => build({ marks, guides: [axis({ scale: "y", room: { min: 20 } })] })).not.toThrow();
    // Tick marks outside the plot are not shortened: the room holds them whole.
    expect(() =>
      build({ marks, guides: [axis({ scale: "y", room: 10, tick: { length: 50 } })] }),
    ).toThrow(
      "chart guides[0].room: its tick marks reach 50 px out from the plot, past the 10 px room; give a room of at least 50 px, or shorter or inward tick marks",
    );
    const spec = (guide: object) => () =>
      validateSpec({ marks: [{ type: "line", x: "t", y: "v" }], guides: [guide] } as never);
    expect(spec({ type: "colorbar", scale: { mark: 0, channel: "color" }, room: 10 })).toThrow(
      "guides[0].room: colorbars take their own room; drop room",
    );
    expect(spec({ type: "axis", scale: "y", room: -1 })).toThrow(/^guides\[0\]\.room: expected/);
  });
});

describe("panels' least widths", () => {
  const ids = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}` }));
  const marksIn = ids.map(({ id }) => line(week, { x: "t", y: "v", panel: id }));
  const sides = { y: { show: false }, legend: false } as const;
  const panelled = { ...sides, marks: marksIn, panels: panels(ids, grid({ columns: 12 })) };
  const faceted = {
    ...sides,
    marks: [
      line(table({ t: ids.map((_, i) => i), v: ids.map(() => 1), id: ids.map(({ id }) => id) }), {
        x: "t",
        y: "v",
      }),
    ],
    facet: facet("id", { columns: 12, header: false }),
  };
  const widths = ({ model }: ReturnType<typeof build>) =>
    model.panels().map(({ plot }) => plot.width);

  it("keep room for x labels only where an axis writes them", () => {
    for (const config of [panelled, faceted]) {
      // Twelve plots in a row of 300 pixels: too narrow for x labels below each.
      expect(() => build({ ...config, x: { repeat: "all" } }, 300, 200)).toThrow(
        /px of width|do not fit/,
      );
      // An x axis without labels leaves each its share of the row.
      const bare = build(
        { ...config, x: { repeat: "all" }, guides: [axis({ scale: "x", labels: false })] },
        300,
        200,
      );
      expect(Math.max(...widths(bare))).toBeLessThan(48);
      // One above the plots writes labels there, which need the room too.
      expect(() =>
        build(
          { ...config, guides: [axis({ scale: "x", place: { side: "top" }, repeat: "all" })] },
          300,
          200,
        ),
      ).toThrow(/px of width|do not fit/);
    }
  });
});

describe("panels' least heights", () => {
  const ids = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}` }));
  const stacked = {
    marks: ids.map(({ id }) => line(week, { x: "t", y: "v", panel: id })),
    panels: panels(ids),
    x: { show: false },
    legend: false,
  } as const;
  const heights = ({ model }: ReturnType<typeof build>) =>
    model.panels().map(({ plot }) => plot.height);

  it("keep room for y labels only where an axis writes them, on either side", () => {
    // Twelve plots stacked in 200 pixels: too short for y labels beside each.
    expect(() => build(stacked, 600, 200)).toThrow(/px of height/);
    // A y axis without labels leaves each its share.
    const bare = build({ ...stacked, guides: [axis({ scale: "y", labels: false })] }, 600, 200);
    expect(Math.max(...heights(bare))).toBeLessThan(18);
    // Moved to the right, it writes labels there, which need the room too.
    expect(() =>
      build({ ...stacked, guides: [axis({ scale: "y", place: { side: "right" } })] }, 600, 200),
    ).toThrow(/px of height/);
  });

  it("count only the labels axes draw: on the right beside a row's last panel", () => {
    // Side by side sharing y, the axis on the right beside the second: the
    // first's large label style draws nothing there.
    const pair = {
      marks: [
        line(week, { x: "t", y: "v", panel: "a" }),
        line(week, { x: "t", y: "v", panel: "b" }),
      ],
      panels: panels(
        [{ id: "a", y: { style: { tickLabel: { fontSize: 80 } } } }, { id: "b" }],
        grid({ columns: 2 }),
      ),
      x: { show: false },
      y: { scope: "chart" },
      legend: false,
      guides: [axis({ scale: "y", place: { side: "right" } })],
    } as const;
    expect(heights(build(pair, 400, 80))).toEqual([70, 70]);
  });

  it("count no room for boxed labels an axis does not write", () => {
    const rows = table({ t: [0, 1, 0, 1], v: [0, 1, 0, 1], g: ["a", "a", "b", "b"] });
    const boxed = {
      marks: [line(rows, { x: "t", y: "v" })],
      facet: facet("g", { columns: 1, header: false }),
      x: { show: false },
      y: { style: { tickLabel: { fontSize: 80, background: { fill: "#eee" }, padding: 40 } } },
      legend: false,
      guides: [axis({ scale: "y", labels: false })],
    } as const;
    expect(Math.min(...heights(build(boxed, 400, 80)))).toBeGreaterThan(20);
  });

  const rows = table({ t: [0, 1, 0, 1], v: [0, 1, 0, 1], g: ["a", "a", "b", "b"] });

  it("count the layers that write labels, as each writes them", () => {
    // The major layer writes none; the base style a layer starts from is
    // large and boxed, the minor layer's own small and unpadded.
    const config = (fontSize: number): ChartConfig => ({
      marks: [line(rows, { x: "t", y: "v" })],
      facet: facet("g", { columns: 1, header: false }),
      x: { show: false },
      y: { style: { tickLabel: { fontSize, background: { fill: "#eee" }, padding: 40 } } },
      legend: false,
      guides: [
        axis({
          scale: "y",
          labels: false,
          layers: [{ id: "minor", ticks: 4, style: { tickLabel: { fontSize: 12, padding: 0 } } }],
        }),
      ],
    });
    expect(heights(build(config(80), 400, 160))).toEqual(heights(build(config(12), 400, 160)));
  });

  it("count a halo past a box's top and bottom padding only, on automatic and listed axes", () => {
    // 40 px of padding above and below, none beside: an 80 px halo stays
    // inside the box up and down.
    const padding = { top: 40, bottom: 40, left: 0, right: 0 };
    const plain = { background: { fill: "#eee" }, padding };
    const haloed = { ...plain, halo: { color: "#fff", width: 80 } };
    const side = (tickLabel: typeof plain, listed: boolean) =>
      build(
        {
          marks: [line(rows, { x: "t", y: "v" })],
          facet: facet("g", { columns: 2, header: false }),
          x: { show: false },
          legend: false,
          ...(listed
            ? { guides: [axis({ scale: "y", style: { tickLabel } })] }
            : { y: { style: { tickLabel } } }),
        },
        400,
        250,
      );
    for (const listed of [false, true])
      expect(heights(side(haloed, listed))).toEqual(heights(side(plain, listed)));
  });

  it("keep rows apart by y labels of several lines, as they are planned", () => {
    const DAY = 86_400_000;
    /** Each row's y labels: from the top of each one's first line to the bottom of its last. */
    const blocks = (config: ChartConfig, height: number) =>
      build(
        {
          facet: facet("g", { columns: 1, header: false, gap: 0 }),
          x: { show: false },
          legend: false,
          ...config,
        },
        400,
        height,
      ).scene.panels.map((panel) =>
        panel.axes
          .filter((guide) => guide.side === "left")
          .flatMap((guide) => guide.items)
          .flatMap((item) => {
            if (item.type !== "text" || !item.text) return [];
            const { y, text, paint } = item;
            const last = y + (lineCount(text) - 1) * paint.lineHeight;
            return [[y - paint.size / 2, last + paint.size / 2] as const];
          }),
      );
    /** How far apart the first row's lowest label and the second's highest are. */
    const apart = ([first, second]: ReturnType<typeof blocks>) =>
      Math.min(...second!.map(([top]) => top)) - Math.max(...first!.map(([, bottom]) => bottom));
    // Dates of three lines at the plots' ends.
    const dates = table({
      t: time([0, 10 * DAY, 0, 10 * DAY]),
      v: [0, 1, 0, 1],
      g: ["a", "a", "b", "b"],
    });
    const atEnds = blocks(
      {
        marks: [line(dates, { x: "v", y: "t" })],
        guides: [
          axis({
            scale: "y",
            labels: false,
            layers: [{ id: "dates", ticks: 2, format: { time: "%b\n%-d\n%Y" } }],
          }),
        ],
      },
      300,
    );
    expect(atEnds[0]!.some(([top, bottom]) => bottom - top > 30)).toBe(true);
    expect(apart(atEnds)).toBeGreaterThanOrEqual(-0.5);
    // Five lines at ticks inside the plots, which come nearer the plots'
    // ends as the rows move apart.
    const inside = blocks(
      {
        marks: [line(rows, { x: "t", y: "v" })],
        y: { domain: [0, 1] },
        guides: [
          axis({
            scale: "y",
            labels: false,
            layers: [
              { id: "notes", ticks: { values: [0.1, 0.9] }, format: (v) => `${v}\na\nb\nc\nd` },
            ],
          }),
        ],
      },
      400,
    );
    expect(apart(inside)).toBeGreaterThanOrEqual(-0.5);
    // A tall label in the middle of each plot, inside it: rows keep no more room.
    const middle = (text: string) =>
      heights(
        build(
          {
            marks: [line(rows, { x: "t", y: "v" })],
            facet: facet("g", { columns: 1, header: false, gap: 0 }),
            x: { show: false },
            y: { domain: [0, 1] },
            legend: false,
            guides: [
              axis({
                scale: "y",
                labels: false,
                layers: [{ id: "notes", ticks: { values: [0.5] }, format: () => text }],
              }),
            ],
          },
          400,
          180,
        ),
      );
    expect(middle("a\nb\nc\nd\ne")).toEqual(middle("a"));
    // Labels a fixed room leaves out reach nothing.
    const roomed = (text: string) =>
      heights(
        build(
          {
            marks: [line(rows, { x: "t", y: "v" })],
            facet: facet("g", { columns: 1, header: false, gap: 0 }),
            x: { show: false },
            y: { domain: [0, 1] },
            legend: false,
            guides: [
              axis({
                scale: "y",
                room: 12,
                labels: false,
                layers: [{ id: "notes", ticks: { values: [0, 1] }, format: () => text }],
              }),
            ],
          },
          400,
          180,
        ),
      );
    expect(roomed("long\nlong\nlong\nlong\nlong")).toEqual(roomed(""));
  });
});
