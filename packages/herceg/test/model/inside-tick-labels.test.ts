// Tick labels inside the plot (`labels.inside`) and apart from their ticks
// (`labels.gap`): placed past the ticks on their side, aligned along the
// axis as their style says, and taking no room outside the plot.
import { describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { guideCompiler } from "../../src/guides/compile.ts";
import { axis, colorbar } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { GUIDE_KIT, needsGuides } from "../../src/model/guides.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import type { AxisGuide, Scene, TextItem } from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";

const guides = guideCompiler(GUIDE_KIT);
const data = table({ x: [0, 100], v: [0, 10] });
const marks = [line(data, { x: "x", y: "v" })];

function sceneOf(config: Omit<ChartConfig, "marks"> & Partial<Pick<ChartConfig, "marks">>) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", marks, ...config },
    undefined,
    guides,
  );
  model.setSize(400, 300, 1);
  return model.scene(estimateText);
}

const sideOf = (scene: Scene, side: AxisGuide["side"]) =>
  scene.panels[0]!.axes.find((a) => a.side === side)!;
const labelsOf = (guide: AxisGuide) =>
  guide.items.filter((item): item is TextItem => item.type === "text");
const widthOf = (label: TextItem) => estimateText(label.text, label.paint.css);
/** The line an x axis' edge is drawn on, as its tick marks are: on the half pixel. */
const lineOf = (guide: AxisGuide) => Math.round(guide.edge) + 0.5;
const plain = sceneOf({});

describe("tick labels inside the plot", () => {
  contractTest("axis.tick-labels.inside.bottom", () => {
    const scene = sceneOf({ guides: [axis({ scale: "x", labels: { inside: true } })] });
    const plot = scene.panels[0]!.plot;
    const bottom = sideOf(scene, "bottom");
    const labels = labelsOf(bottom);
    expect(labels.map((l) => l.text)).toEqual(["0", "20", "40", "60", "80", "100"]);
    // Blocks centered on their ticks, their bottoms the gap above the line.
    for (const label of labels) {
      expect(label.anchor).toBe("middle");
      expect(label.y + label.paint.lineHeight / 2).toBeCloseTo(lineOf(bottom) - 4);
    }
    // No room is kept below the plot for them: it grows down by theirs.
    expect(plot.height).toBeGreaterThan(plain.panels[0]!.plot.height + 15);
  });

  contractTest("axis.tick-labels.inside.top", () => {
    const scene = sceneOf({
      guides: [axis({ scale: "x", place: { side: "top" }, labels: { inside: true } })],
    });
    const top = sideOf(scene, "top");
    for (const label of labelsOf(top))
      expect(label.y - label.paint.lineHeight / 2).toBeCloseTo(lineOf(top) + 4);
    // Above the plot are only the tick marks.
    expect(scene.panels[0]!.plot.y).toBe(plain.panels[0]!.plot.y + 5);
  });

  contractTest("axis.tick-labels.inside.left", () => {
    const scene = sceneOf({ guides: [axis({ scale: "y", labels: { inside: true } })] });
    const plot = scene.panels[0]!.plot;
    const left = sideOf(scene, "left");
    for (const label of labelsOf(left)) {
      expect(label.anchor).toBe("start");
      expect(label.x).toBeCloseTo(left.edge + 4);
    }
    expect(plot.x).toBeLessThan(plain.panels[0]!.plot.x - 15);
  });

  contractTest("axis.tick-labels.inside.right", () => {
    const outside = sceneOf({ guides: [axis({ scale: "y", place: { side: "right" } })] });
    const scene = sceneOf({
      guides: [axis({ scale: "y", place: { side: "right" }, labels: { inside: true } })],
    });
    const right = sideOf(scene, "right");
    for (const label of labelsOf(right)) {
      expect(label.anchor).toBe("end");
      expect(label.x).toBeCloseTo(right.edge - 4);
    }
    const plot = scene.panels[0]!.plot;
    expect(plot.x + plot.width).toBeGreaterThan(
      outside.panels[0]!.plot.x + outside.panels[0]!.plot.width + 15,
    );
  });

  contractTest("axis.tick-labels.inside.align", () => {
    const scene = sceneOf({
      guides: [
        axis({ scale: "x", labels: { inside: true }, style: { tickLabel: { align: "start" } } }),
        axis({
          scale: "y",
          labels: { inside: true },
          style: { tickLabel: { verticalAlign: "top" } },
        }),
      ],
    });
    const bottom = sideOf(scene, "bottom");
    // Along x, each label starts at its tick.
    labelsOf(bottom).forEach((label, k) => {
      expect(label.anchor).toBe("start");
      expect(label.x).toBeCloseTo(bottom.ticks[k]!.position);
    });
    // Along y, each label's top is at its tick, as far as the chart allows.
    const left = sideOf(scene, "left");
    const ticks = new Map(left.ticks.map((t) => [t.label, t.position]));
    for (const label of labelsOf(left).filter((l) => l.text !== "0"))
      expect(label.y - label.paint.lineHeight / 2).toBeCloseTo(ticks.get(label.text)!);
  });

  contractTest("axis.tick-labels.inside.gap", () => {
    const scene = sceneOf({
      guides: [
        axis({
          scale: "x",
          tick: { direction: "in", length: 6 },
          labels: { inside: true, gap: 10 },
        }),
      ],
    });
    const bottom = sideOf(scene, "bottom");
    // Past the ticks reaching into the plot, by the gap.
    for (const label of labelsOf(bottom))
      expect(label.y + label.paint.lineHeight / 2).toBeCloseTo(lineOf(bottom) - 6 - 10);
  });

  contractTest("axis.tick-labels.inside.rows", () => {
    const scene = sceneOf({
      guides: [
        axis({
          scale: "x",
          labels: { inside: true },
          layers: [
            { id: "ends", ticks: { values: [50] }, labels: { inside: true, row: 1 } },
            { id: "out", ticks: { values: [50] }, format: { number: ".1f" } },
          ],
        }),
      ],
    });
    const bottom = sideOf(scene, "bottom");
    const labels = labelsOf(bottom);
    const first = labels.find((l) => l.text === "40")!;
    const second = labels.filter((l) => l.text === "50");
    // The inside row 1 a line and the rows' gap further in than row 0.
    const inner = second.find((l) => l.y < lineOf(bottom))!;
    expect(first.y - inner.y).toBeCloseTo(first.paint.lineHeight + 2);
    // A layer outside the plot keeps its own place below the line.
    expect(labels.find((l) => l.text === "50.0")!.y).toBeGreaterThan(lineOf(bottom));
  });

  contractTest("axis.tick-labels.inside.collision", () => {
    const wide = table({ x: [0, 1_000_000], v: [0, 1] });
    const shown = (align: "start" | "center") =>
      labelsOf(
        sideOf(
          sceneOf({
            marks: [line(wide, { x: "x", y: "v" })],
            guides: [
              axis({
                scale: "x",
                ticks: { values: [0, 100_000, 140_000, 600_000, 1_000_000] },
                format: { number: ",d" },
                labels: { inside: true, collision: "hide" },
                style: { tickLabel: { align } },
              }),
            ],
          }),
          "bottom",
        ),
      );
    // Labels meet where their aligned blocks do.
    for (const labels of [shown("start"), shown("center")]) {
      expect(labels.length).toBeLessThan(5);
      for (let k = 1; k < labels.length; k++) {
        const [a, b] = [labels[k - 1]!, labels[k]!];
        const start = (l: TextItem) =>
          l.anchor === "start" ? l.x : l.x - widthOf(l) / (l.anchor === "end" ? 1 : 2);
        expect(start(b)).toBeGreaterThanOrEqual(start(a) + widthOf(a));
      }
    }
  });

  contractTest("axis.tick-labels.inside.rotated", () => {
    const scene = sceneOf({
      guides: [axis({ scale: "x", labels: { inside: true, rotation: -45 } })],
    });
    const bottom = sideOf(scene, "bottom");
    for (const label of labelsOf(bottom)) {
      expect(label.angle).toBe(-45);
      expect(label.y).toBeLessThan(lineOf(bottom) - 4);
    }
  });

  contractTest("axis.tick-labels.inside.reversed", () => {
    const scene = sceneOf({
      x: { domain: [100, 0] },
      guides: [
        axis({ scale: "x", labels: { inside: true }, style: { tickLabel: { align: "end" } } }),
      ],
    });
    const bottom = sideOf(scene, "bottom");
    // Alignment is in screen order: blocks end at their ticks, whichever way the scale runs.
    labelsOf(bottom).forEach((label, k) => {
      expect(label.anchor).toBe("end");
      expect(label.x).toBeCloseTo(bottom.ticks[k]!.position);
    });
  });
});

describe("inside labels where they are drawn", () => {
  contractTest("axis.tick-labels.inside.margins", () => {
    // Margins hold labels as they are drawn: a long last one starting at
    // its tick, and turned ones reaching up into the plot.
    const long = (v: number) => (v === 100 ? "a hundred %" : String(v));
    for (const labels of [{ inside: true }, { inside: true, rotation: -30 }] as const) {
      const scene = sceneOf({
        guides: [
          axis({ scale: "x", format: long, labels, style: { tickLabel: { align: "start" } } }),
        ],
      });
      const last = labelsOf(sideOf(scene, "bottom")).find((l) => l.text === long(100))!;
      // Turned up into the plot, it reaches right from its tick.
      expect(last.anchor).toBe("start");
      const reach = labels.rotation
        ? widthOf(last) * Math.cos((30 * Math.PI) / 180)
        : widthOf(last);
      expect(last.x + reach, JSON.stringify(labels)).toBeLessThanOrEqual(400);
    }
  });

  contractTest("axis.tick-labels.inside.rotation", () => {
    // Of the angles given, the first at which labels fit as they are
    // anchored: ends at their ticks meet where centers would not.
    const angleOf = (align: "end" | "center") =>
      labelsOf(
        sideOf(
          sceneOf({
            guides: [
              axis({
                scale: "x",
                ticks: { values: [40, 60] },
                format: (v) => (v === 40 ? "ab" : "a longer label text"),
                labels: { inside: true, rotation: { candidates: [0, -45] } },
                style: { tickLabel: { align } },
              }),
            ],
          }),
          "bottom",
        ),
      )[0]!.angle;
    expect(angleOf("center")).toBe(0);
    expect(angleOf("end")).toBe(-45);
  });

  contractTest("axis.tick-labels.inside.priority", () => {
    // Labels of one row kept apart by their gaps both stay, whatever their priority.
    const scene = sceneOf({
      guides: [
        axis({
          scale: "x",
          ticks: { values: [25, 50, 75] },
          labels: { inside: true },
          layers: [
            {
              id: "far",
              ticks: { values: [50] },
              format: { number: ".1f" },
              labels: { inside: true, gap: 60, priority: 1 },
            },
          ],
        }),
      ],
    });
    const texts = labelsOf(sideOf(scene, "bottom")).map((l) => l.text);
    expect(texts).toContain("50");
    expect(texts).toContain("50.0");
  });

  contractTest("axis.tick-labels.priority.depth", () => {
    // A short turned label stays clear of a label further off the line,
    // however deep its layer's longest label reaches.
    const scene = sceneOf({
      guides: [
        axis({
          scale: "x",
          ticks: { values: [50, 100] },
          format: (v) => (v === 100 ? "a very long label here" : String(v)),
          labels: { rotation: -90 },
          layers: [
            {
              id: "far",
              ticks: { values: [50] },
              format: { number: ".1f" },
              labels: { gap: 40, priority: 1, rotation: 0 },
            },
          ],
        }),
      ],
    });
    const texts = labelsOf(sideOf(scene, "bottom")).map((l) => l.text);
    expect(texts).toContain("50");
    expect(texts).toContain("50.0");
  });
});

describe("tick labels aligned by their style", () => {
  contractTest("axis.tick-labels.align.listed", () => {
    // Axes listed on the default side align their labels as the styles
    // say, the scale's or their own.
    for (const scene of [
      sceneOf({
        x: { style: { tickLabel: { align: "start" } } },
        guides: [axis({ scale: "x" })],
      }),
      sceneOf({ guides: [axis({ scale: "x", style: { tickLabel: { align: "start" } } })] }),
    ]) {
      const bottom = sideOf(scene, "bottom");
      expect(labelsOf(bottom).length).toBeGreaterThan(0);
      labelsOf(bottom).forEach((label, k) => {
        expect(label.anchor).toBe("start");
        expect(label.x).toBeCloseTo(bottom.ticks[k]!.position);
      });
    }
  });

  contractTest("axis.tick-labels.align.default", () => {
    // Default axes whose tick label styles align them draw them so: along
    // x from their ticks, along y with their tops there.
    expect(needsGuides({ theme: { style: { text: { verticalAlign: "top" } } }, marks })).toBe(true);
    for (const scene of [
      sceneOf({
        x: { style: { tickLabel: { align: "start" } } },
        y: { style: { tickLabel: { verticalAlign: "top" } } },
      }),
      sceneOf({
        theme: { style: { tickLabel: { align: "start", verticalAlign: "top" } } },
      }),
      // Tick labels start from the theme's base text.
      sceneOf({ theme: { style: { text: { align: "start", verticalAlign: "top" } } } }),
    ]) {
      const bottom = sideOf(scene, "bottom");
      labelsOf(bottom).forEach((label, k) => {
        expect(label.anchor).toBe("start");
        expect(label.x).toBeCloseTo(bottom.ticks[k]!.position);
      });
      const left = sideOf(scene, "left");
      const ticks = new Map(left.ticks.map((t) => [t.label, t.position]));
      // The lowest is kept inside the chart.
      for (const label of labelsOf(left).filter((l) => l.text !== "0"))
        expect(label.y - label.paint.lineHeight / 2).toBeCloseTo(ticks.get(label.text)!);
    }
  });
});

describe("tick labels apart from their ticks", () => {
  contractTest("axis.tick-labels.gap.outside", () => {
    const scene = sceneOf({ guides: [axis({ scale: "y", labels: { gap: 20 } })] });
    const left = sideOf(scene, "left");
    // Default y axes draw no tick marks: the labels end the gap from the line.
    for (const label of labelsOf(left)) expect(label.x).toBeCloseTo(left.edge - 20);
    expect(scene.panels[0]!.plot.x).toBeGreaterThan(plain.panels[0]!.plot.x + 10);
  });

  contractTest("colorbar.labels.inside.refused", () => {
    const values = table({ x: [0, 1], y: [0, 1], c: [0, 1] });
    expect(() =>
      sceneOf({
        marks: [point(values, { x: "x", y: "y", color: "c" })],
        guides: [colorbar({ labels: { inside: true } } as Parameters<typeof colorbar>[0])],
      }),
    ).toThrow(/labels\.inside: a colorbar's labels stand beside its ramp; drop inside/);
  });
});
