// Tick labels' gap from their axis line: one default on x and y (8 px, 0.65
// em above 12 px, and past outward tick marks longer than 5 px), `gap`
// counted past the marks, where each side's gap ends in the text, inside
// labels and colorbars as before, and the room the axes keep for what they
// draw.
import { describe, expect, it } from "vitest";
import { category } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { guideCompiler } from "../../src/guides/compile.ts";
import { axis, colorbar } from "../../src/guides/options.ts";
import { estimateText, textLines } from "../../src/layout/text.ts";
import { grid } from "../../src/layout.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { type Compilers, GUIDE_KIT } from "../../src/model/guides.ts";
import { GAP } from "../../src/model/legend.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import {
  type AxisGuide,
  type ColorbarGuide,
  guidesOf,
  type LabelsGeometry,
  type Panel,
  type RampItem,
  type Scene,
  type TextItem,
} from "../../src/scene/scene.ts";
import type { TickMarkSpec } from "../../src/spec/guides.ts";

const guides = guideCompiler(GUIDE_KIT);

function build(
  config: ChartConfig,
  width = 640,
  height = 320,
  compilers: Compilers = [guides],
): Scene {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    compilers,
  );
  model.setSize(width, height, 1);
  return model.scene(estimateText);
}

const data = table({ x: [0, 1, 2, 3, 4], v: [0, 1000, 500, 2000, 1500] });
const marks = [line(data, { x: "x", y: "v" })];
const axisOn = (panel: Panel, side: AxisGuide["side"]) => panel.axes.find((a) => a.side === side)!;
const labelsOf = (guide: AxisGuide) =>
  guide.items.filter(
    (item): item is TextItem =>
      item.type === "text" && !!item.text && item.text !== guide.title?.text,
  );
/** The center of an axis' line, where its tick marks start. */
const lineOf = (guide: AxisGuide) => Math.round(guide.edge) + 0.5;
/** Where text is painted along x (unturned): its lines' block about its anchor. */
function extent(item: TextItem): [number, number] {
  const { width } = textLines(item.text, item.paint, estimateText);
  const start = item.x - width * (item.anchor === "end" ? 1 : item.anchor === "middle" ? 0.5 : 0);
  return [start, start + width];
}
/** Pixels from a y axis' plot edge out to its labels' near ends, each label's. */
const outFromY = (guide: AxisGuide) =>
  labelsOf(guide).map((item) =>
    guide.side === "left" ? guide.edge - item.x : item.x - guide.edge,
  );
/** Pixels from an x axis' line down to the line its labels hang from, each label's. */
const outFromX = (guide: AxisGuide) => labelsOf(guide).map((item) => item.y - lineOf(guide));
const style = (fontSize: number) => ({ theme: { style: { tickLabel: { fontSize } } } });

describe("the default gap", () => {
  it("is the same on x and y: 8 px, 0.65 em above 12 px, past outward marks longer than 5 px", () => {
    const cases: [TickMarkSpec | false, number][] = [
      [false, 0],
      [{ length: 5 }, 0],
      [{ length: 6 }, 1],
      [{ length: 10 }, 5],
      // A cross mark reaches out half its length; one pointing in, not at all.
      [{ direction: "cross", length: 12 }, 1],
      [{ direction: "in", length: 10 }, 0],
    ];
    for (const [size, gap] of [
      [12, 8],
      [16, 10],
    ] as const)
      for (const [tick, past] of cases) {
        const scene = build({
          marks,
          ...style(size),
          guides: [axis({ scale: "x", tick }), axis({ scale: "y", tick })],
        });
        const p = scene.panels[0]!;
        const x = outFromX(axisOn(p, "bottom"));
        const y = outFromY(axisOn(p, "left"));
        expect(x.length).toBeGreaterThan(1);
        expect(y.length).toBeGreaterThan(1);
        for (const out of [...x, ...y]) expect(out).toBe(gap + past);
        // Labels hang below the axis, and end beside it.
        expect(labelsOf(axisOn(p, "bottom"))[0]!.baseline).toBe("hanging");
        expect(labelsOf(axisOn(p, "left"))[0]!.anchor).toBe("end");
      }
  });

  it("puts y labels 9 px out beside 6 px marks, where they stood 14 (B1)", () => {
    // d3's axes: 6 px marks, labels 3 px past them; no `gap` needed on either.
    const p = build({
      marks,
      theme: { style: { text: { font: "sans-serif", fontSize: 10 } } },
      guides: [
        axis({ scale: "x", tick: { length: 6 } }),
        axis({ scale: "y", tick: { length: 6 } }),
      ],
    }).panels[0]!;
    for (const out of outFromY(axisOn(p, "left"))) expect(out).toBe(9);
    for (const out of outFromX(axisOn(p, "bottom"))) expect(out).toBe(9);
  });

  it("follows the font on the default y axes, as on x, in the room they keep", () => {
    for (const [size, gap] of [
      [12, 8],
      [13, 8],
      [14, 9],
      [16, 10],
      [20, 13],
    ] as const) {
      const p = build({ marks, ...style(size) }).panels[0]!;
      const left = axisOn(p, "left");
      expect(left.gap).toBe(gap);
      for (const out of outFromY(left)) expect(out).toBe(gap);
      for (const out of outFromX(axisOn(p, "bottom"))) expect(out).toBe(gap);
      // The room holds the widest label whole from the chart's edge inset,
      // and no more: none is cut, and none stands further in than a pixel.
      const start = Math.min(...labelsOf(left).map((item) => extent(item)[0]));
      expect(start).toBeGreaterThanOrEqual(8);
      expect(start).toBeLessThan(9);
    }
  });

  it("keeps room beside a listed y axis for its marks past 5 px, and no more", () => {
    const plain = build({ marks }).panels[0]!;
    for (const [length, past] of [
      [5, 0],
      [6, 1],
      [10, 5],
    ] as const) {
      const p = build({ marks, guides: [axis({ scale: "y", tick: { length } })] }).panels[0]!;
      expect(p.plot.x).toBe(plain.plot.x + past);
      const left = axisOn(p, "left");
      for (const out of outFromY(left)) expect(out).toBe(8 + past);
      const start = Math.min(...labelsOf(left).map((item) => extent(item)[0]));
      expect(start).toBeGreaterThanOrEqual(8);
      expect(start).toBeLessThan(9);
    }
  });

  it("is a y axis' own on the right, and stands labels of every layer from it", () => {
    // A 16 px axis whose second layer writes 24 px labels: both rows of
    // labels start 11 px out beside 6 px marks, by the axis' paint.
    const twin = [line(data, { x: "x", y: "v" }), line(data, { x: "x", y: "v", axis: "right" })];
    const scene = build({
      marks: twin,
      guides: [
        axis({
          scale: "yRight",
          tick: { length: 6 },
          style: { tickLabel: { fontSize: 16 } },
          layers: [
            {
              id: "big",
              ticks: { values: [250, 1750] },
              tick: { length: 6 },
              style: { tickLabel: { fontSize: 24 } },
            },
          ],
        }),
      ],
    });
    const right = axisOn(scene.panels[0]!, "right");
    const sizes = new Set(labelsOf(right).map((item) => item.paint.size));
    expect(sizes).toEqual(new Set([16, 24]));
    for (const out of outFromY(right)) expect(out).toBe(11);
    // The room holds the widest of them inside the chart.
    const end = Math.max(...labelsOf(right).map((item) => extent(item)[1]));
    expect(end).toBeLessThanOrEqual(640);
  });
});

describe("a given gap", () => {
  // 6 px marks and a 3 px gap: labels 9 px from the line on every side.
  const tick = { length: 6 };
  const labels = { gap: 3 };
  const boxed = {
    background: { fill: "#eeeeee" },
    padding: { top: 2, right: 4, bottom: 3, left: 4 },
  } as const;
  const sides = (tickLabel: object): Panel =>
    build({
      marks,
      guides: [
        axis({ scale: "x", tick, labels, style: { tickLabel } }),
        axis({ scale: "x", place: { side: "top" }, tick, labels, style: { tickLabel } }),
        axis({ scale: "y", tick, labels, style: { tickLabel } }),
      ],
    }).panels[0]!;

  it("ends below an axis at the line labels hang from, above it at their last line's box", () => {
    for (const lineHeight of [1, 1.5]) {
      const p = sides({ fontSize: 12, lineHeight });
      const height = Math.round(12 * lineHeight);
      const bottom = axisOn(p, "bottom");
      for (const item of labelsOf(bottom)) {
        expect(item.baseline).toBe("hanging");
        expect(item.y).toBe(lineOf(bottom) + 9);
      }
      const top = axisOn(p, "top");
      for (const item of labelsOf(top)) {
        // Placed by its middle: its box ends half a line below.
        expect(item.baseline).toBe("middle");
        expect(item.y + height / 2).toBe(lineOf(top) - 9);
      }
      const left = axisOn(p, "left");
      for (const item of labelsOf(left)) expect(left.edge - item.x).toBe(9);
    }
  });

  it("ends at labels' boxes where they have them, their text moved in by the padding", () => {
    for (const lineHeight of [1, 1.5]) {
      const p = sides({ fontSize: 12, lineHeight, ...boxed });
      const height = Math.round(12 * lineHeight);
      const leading = (height - 12) / 2;
      const bottom = axisOn(p, "bottom");
      for (const item of labelsOf(bottom)) {
        // The box takes the place of the text's line, which starts half a
        // leading above the line it hangs from.
        expect(item.box!.y).toBe(lineOf(bottom) + 9 - leading);
        expect(item.y).toBe(lineOf(bottom) + 9 + 2);
      }
      const top = axisOn(p, "top");
      for (const item of labelsOf(top)) {
        expect(item.box!.y + item.box!.height).toBe(lineOf(top) - 9);
        expect(item.y + height / 2 + 3).toBe(lineOf(top) - 9);
      }
      const left = axisOn(p, "left");
      for (const item of labelsOf(left)) {
        expect(item.box!.x + item.box!.width).toBeCloseTo(left.edge - 9, 9);
        expect(item.x).toBe(left.edge - 9 - 4);
      }
    }
  });

  it("ends at the block's edge for labels their style aligns", () => {
    const p = sides({ fontSize: 12, lineHeight: 1.5, align: "start", verticalAlign: "top" });
    const bottom = axisOn(p, "bottom");
    // Placed by its middle, its block's top at the gap's end.
    for (const item of labelsOf(bottom)) expect(item.y - 9).toBe(lineOf(bottom) + 9);
    const left = axisOn(p, "left");
    for (const item of labelsOf(left)) expect(left.edge - item.x).toBe(9);
  });

  it("counts past outward marks only, from the line where there are none", () => {
    for (const [mark, out] of [
      [{ length: 6 }, 6],
      [{ direction: "cross", length: 6 }, 3],
      [{ direction: "in", length: 6 }, 0],
      [false, 0],
    ] as const) {
      const p = build({
        marks,
        guides: [
          axis({ scale: "x", tick: mark, labels: { gap: 2 } }),
          axis({ scale: "y", tick: mark, labels: { gap: 2 } }),
        ],
      }).panels[0]!;
      for (const away of outFromX(axisOn(p, "bottom"))) expect(away).toBe(out + 2);
      for (const away of outFromY(axisOn(p, "left"))) expect(away).toBe(out + 2);
    }
  });
});

describe("labels inside the plot", () => {
  it("stand 4 px past the inward marks, or their gap past them", () => {
    const tick = { direction: "in", length: 6 } as const;
    for (const [labels, past] of [
      [{ inside: true }, 4],
      [{ inside: true, gap: 1 }, 1],
    ] as const) {
      for (const size of [12, 16]) {
        const p = build({
          marks,
          ...style(size),
          guides: [axis({ scale: "x", tick, labels }), axis({ scale: "y", tick, labels })],
        }).panels[0]!;
        const left = axisOn(p, "left");
        for (const item of labelsOf(left)) {
          expect(item.anchor).toBe("start");
          expect(item.x - left.edge).toBe(6 + past);
        }
        const bottom = axisOn(p, "bottom");
        for (const item of labelsOf(bottom))
          expect(lineOf(bottom) - (item.y + item.paint.lineHeight / 2)).toBe(6 + past);
      }
    }
  });
});

describe("colorbars", () => {
  const hosts = Array.from({ length: 12 }, (_, i) => `host ${i % 4}`);
  const cells = table({
    hour: Array.from({ length: 12 }, (_, i) => Math.floor(i / 4)),
    host: category(hosts),
    temp: [-8.55, -3, 0, 2, 4, 6, 7, 8.5, 9, 10, 11, 12.3],
  });
  const map = heatmap(cells, { x: "hour", y: "host", color: "temp" });
  const barOf = (scene: Scene) => guidesOf(scene, "colorbar")[0]! as ColorbarGuide;
  const parts = (bar: ColorbarGuide) => ({
    ramp: bar.items.find((item): item is RampItem => item.type === "ramp")!,
    texts: bar.items.filter((item): item is TextItem => item.type === "text"),
  });

  it("keep their labels 4 px past their ticks standing, and 10 px under the bar lying", () => {
    for (const [tick, reach] of [
      [undefined, 4],
      [{ length: 10 }, 10],
      [{ direction: "cross", length: 12 }, 6],
    ] as const) {
      const own = tick ? { tick } : {};
      const standing = parts(barOf(build({ marks: [map], guides: [colorbar(own)] })));
      const edge = standing.ramp.x + standing.ramp.width - 1;
      expect(standing.texts.length).toBeGreaterThan(2);
      for (const item of standing.texts) expect(item.x).toBe(edge + 5 + reach);
      const lying = parts(
        barOf(build({ marks: [map], guides: [colorbar({ ...own, place: { side: "bottom" } })] })),
      );
      const line = Math.round(lying.ramp.y + lying.ramp.height - 1) + 0.5;
      expect(lying.texts.length).toBeGreaterThan(2);
      for (const item of lying.texts) expect(item.y).toBe(line + 10 + Math.max(0, reach - 5));
    }
  });
});

describe("panels of different tick label paints", () => {
  it("stand each panel's y labels at its own paint's gap, in the room each keeps", () => {
    const small = table({ x: [0, 1], v: [1, 2] });
    for (const listed of [false, true]) {
      const scene = build(
        {
          panels: panels(
            [{ id: "a" }, { id: "b", style: { tickLabel: { fontSize: 16 } } }],
            grid({ columns: 2 }),
          ),
          y: { scope: "panel" },
          marks: ["a", "b"].map((id) => line(small, { x: "x", y: "v", panel: id })),
          ...(listed && { guides: [axis({ scale: "y", tick: { length: 6 } })] }),
        },
        800,
      );
      const [a, b] = scene.panels;
      const past = listed ? 1 : 0;
      for (const out of outFromY(axisOn(a!, "left"))) expect(out).toBe(8 + past);
      for (const out of outFromY(axisOn(b!, "left"))) expect(out).toBe(10 + past);
      // The second panel's labels clear the first panel's plot.
      const start = Math.min(...labelsOf(axisOn(b!, "left")).map((item) => extent(item)[0]));
      expect(start).toBeGreaterThan(a!.plot.x + a!.plot.width);
    }
  });
});

describe("the outside label column", () => {
  it("stands past y labels at their new gap, beside marks and at larger fonts", () => {
    for (const size of [12, 16]) {
      const scene = build(
        {
          legend: false,
          ...style(size),
          marks: [
            line(data, {
              x: "x",
              y: "v",
              axis: "right",
              labels: { at: "last", place: { outside: true } },
            }),
          ],
          guides: [axis({ scale: "yRight", tick: { length: 6 } })],
        },
        900,
        500,
        staticCompilers(),
      );
      const p = scene.panels[0]!;
      const right = axisOn(p, "right");
      for (const out of outFromY(right)) expect(out).toBe((size === 12 ? 8 : 10) + 1);
      const edge = Math.max(...labelsOf(right).map((item) => extent(item)[1]));
      const names = p.marks
        .filter((g): g is LabelsGeometry => g.kind === "labels")
        .flatMap((g) => [...g.items]);
      expect(names.length).toBe(1);
      expect(names[0]!.x - edge).toBeGreaterThanOrEqual(GAP - 1e-6);
      expect(names[0]!.x - edge).toBeLessThan(GAP + 1);
    }
  });
});

describe("fitted ticks", () => {
  it("judge y labels where they are drawn beside marks at the new gap, as without marks", () => {
    // A short plot at 16 px: the labels' blocks along y decide the interval,
    // whatever stands across; the boxes recorded are the drawn ones.
    const plan = (tick: TickMarkSpec | false) => {
      const scene = build({ marks, ...style(16), guides: [axis({ scale: "y", tick })] }, 640, 140);
      return axisOn(scene.panels[0]!, "left");
    };
    const plain = plan(false);
    const marked = plan({ length: 6 });
    const labelled = (guide: AxisGuide) => guide.ticks.filter(({ label }) => label);
    expect(labelled(marked).map(({ value }) => value)).toEqual(
      labelled(plain).map(({ value }) => value),
    );
    const boxes = (marked.labelBoxes ?? []).map(({ box }) => box).sort((a, b) => a.y - b.y);
    expect(boxes.length).toBe(labelled(marked).length);
    for (let k = 1; k < boxes.length; k++)
      expect(boxes[k]!.y).toBeGreaterThanOrEqual(boxes[k - 1]!.y + boxes[k - 1]!.height);
    for (const box of boxes) expect(box.x + box.width).toBeCloseTo(marked.edge - 11, 9);
  });
});
