// Labels following series (marks/attachments.ts, marks/features/labels.ts):
// `labels` on lines and areas and text `from` a mark, at a series' first or
// last observation drawn, or where its line enters or leaves the view, as
// it is drawn; reading the observation owning that point, and the value
// drawn there; following hidden series out, and making no rows.
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { table } from "../../src/data/table.ts";
import { estimateText, textLines } from "../../src/layout/text.ts";
import { columns, inset, panel } from "../../src/layout.ts";
import { area } from "../../src/marks/area.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { text } from "../../src/marks/text.ts";
import { describeChart } from "../../src/model/describe.ts";
import { facet } from "../../src/model/facet.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { timeBreaks } from "../../src/scale/breaks.ts";
import type {
  AreaGeometry,
  Geometry,
  LabelsGeometry,
  Scene,
  TextItem,
} from "../../src/scene/scene.ts";
import { chartError, errorInfo } from "../../src/spec/errors.ts";
import { contractTest } from "../helpers/contracts.ts";

function model(config: ChartConfig, width = 400, height = 200) {
  const made = new ChartModel(
    { locale: "en-US", timeZone: "UTC", legend: false, ...config },
    undefined,
    ...staticCompilers(),
  );
  made.setSize(width, height, 1);
  return made;
}

const labelsOf = (scene: Scene, panelAt = 0): TextItem[] =>
  scene.panels[panelAt]!.marks.filter((g): g is LabelsGeometry => g.kind === "labels").flatMap(
    (g) => [...g.items],
  );

/** Where a label is painted along x: its box and the box's outline, or its text and halo. */
function extent(label: TextItem): [number, number] {
  const { box, paint } = label;
  if (box) {
    const outline = paint.background?.stroke ? (paint.background.strokeWidth ?? 1) / 2 : 0;
    return [box.x - outline, box.x + box.width + outline];
  }
  const { width } = textLines(label.text, paint, estimateText);
  const reach = (label.halo?.width ?? 0) / 2;
  const start =
    label.x - width * (label.anchor === "end" ? 1 : label.anchor === "middle" ? 0.5 : 0);
  return [start - reach, start + width + reach];
}

/** Each panel's labels, checked to be painted within its plot. */
function within(scene: Scene): TextItem[][] {
  return scene.panels.map(({ plot }, k) => {
    const labels = labelsOf(scene, k);
    for (const label of labels) {
      const [from, to] = extent(label);
      expect(from).toBeGreaterThanOrEqual(plot.x - 1e-9);
      expect(to).toBeLessThanOrEqual(plot.x + plot.width + 1e-9);
    }
    return labels;
  });
}

/** Labels' text, in the order of their series' keys (columns of labels go by height). */
const texts = (scene: Scene) =>
  labelsOf(scene)
    .map(({ text }) => text)
    .sort();

/** What making a chart of `config` throws, as the chart reports it. */
function refusal(config: ChartConfig) {
  try {
    model(config).scene(estimateText);
  } catch (error) {
    return errorInfo(chartError(error, "validate"));
  }
  throw new Error("not refused");
}

const rows = table({
  t: [0, 1, 2, 3, 0, 1, 2, 3],
  v: [1, 2, 3, 4, 4, 3, Number.NaN, 1],
  g: ["a", "a", "a", "a", "b", "b", "b", "b"],
  note: ["a0", "a1", "a2", "a3", "b0", "b1", "b2", "b3"],
});

describe("labels following series", () => {
  contractTest("labels.attach.first-last", () => {
    const chart = model({
      marks: [line(rows, { x: "t", y: "v", series: "g", labels: { at: "last" } })],
    });
    const scene = chart.scene(estimateText);
    const [a, b] = labelsOf(scene);
    // Each series' name in its color, after its last observation drawn.
    expect([a!.text, b!.text]).toEqual(["a", "b"]);
    const colors = chart.series().map(({ color }) => color);
    expect([a!.paint.color, b!.paint.color]).toEqual(colors);
    expect(a!.anchor).toBe("start");
    const { plot } = scene.panels[0]!;
    // The lines end at the plot's right edge: their labels stand inside it, at that edge.
    expect(extent(a!)[1]).toBeCloseTo(plot.x + plot.width, 6);
    // At their points' heights: "a" ends at 4, the top of the domain, above "b".
    expect(a!.y).toBeLessThan(b!.y);
    // Before the first, set before it, and inside the plot too, off the y axis' tick labels.
    const first = model({
      marks: [line(rows, { x: "t", y: "v", series: "g", labels: { at: "first" } })],
    }).scene(estimateText);
    expect(labelsOf(first).map(({ anchor }) => anchor)).toEqual(["end", "end"]);
    expect(extent(labelsOf(first)[0]!)[0]).toBeCloseTo(plot.x, 6);
    // A point inside the plot keeps its label beside it.
    const inner = model({
      x: { domain: [-1, 3] },
      marks: [line(rows, { x: "t", y: "v", series: "g", labels: { at: "first" } })],
    }).scene(estimateText);
    const [start] = labelsOf(inner);
    expect(start!.x).toBeCloseTo(inner.panels[0]!.plot.x + inner.panels[0]!.plot.width / 4 - 4, 6);
  });

  contractTest("labels.attach.not-drawn", () => {
    // The last observation drawn: "b"'s NaN at t = 2 is skipped for the first, its last is drawn.
    const gaps = table({ t: [0, 1, 2], v: [1, 2, Number.NaN] });
    const chart = model({
      marks: [
        line(gaps, {
          x: "t",
          y: "v",
          labels: { at: "last", content: [{ field: "t" }] },
        }),
      ],
    });
    expect(texts(chart.scene(estimateText))).toEqual(["1"]);
    // Observations outside the plot have no labels there.
    const zoomed = model({
      x: { domain: [0, 0.5] },
      marks: [line(gaps, { x: "t", y: "v", labels: { at: "last" } })],
    });
    expect(texts(zoomed.scene(estimateText))).toEqual([]);
  });

  contractTest("labels.attach.visible-edges", () => {
    // Zoomed to [0.5, 2.5]: the line leaves the view half way from t = 2 to 3.
    const chart = model({
      x: { domain: [0.5, 2.5] },
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          series: "g",
          labels: {
            at: "visible-end",
            content: [{ field: "note" }, " ", { value: true, format: { number: ".1f" } }],
          },
        }),
      ],
    });
    const scene = chart.scene(estimateText);
    const { plot } = scene.panels[0]!;
    const [a] = labelsOf(scene);
    // The segment's end owns the point, and the value is the line's there.
    expect(a!.text).toBe("a3 3.5");
    // It stands inside the plot, at the edge.
    expect(extent(a!)[1]).toBeCloseTo(plot.x + plot.width, 6);
    // Entering the view: "a" from t = 0 to 1, owned by t = 1.
    const start = model({
      x: { domain: [0.5, 2.5] },
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          series: "g",
          labels: { at: "visible-start", content: [{ field: "note" }, " ", { value: true }] },
        }),
      ],
    });
    expect(texts(start.scene(estimateText))).toEqual(["a1 1.5", "b1 3.5"]);
  });

  contractTest("labels.attach.step-hold", () => {
    // A step held from t = 0 to 1 at 1: entering the view at 0.5, it holds t = 0's value.
    const chart = model({
      x: { domain: [0.5, 3] },
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          series: "g",
          curve: "step-after",
          labels: { at: "visible-start", content: [{ field: "note" }, " ", { value: true }] },
        }),
      ],
    });
    expect(texts(chart.scene(estimateText))).toEqual(["a0 1", "b0 4"]);
  });

  contractTest("labels.attach.series-order", () => {
    // On a reversed axis, a series still starts at its first observation, at the right.
    const chart = model({
      x: { domain: [3, 0] },
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          series: "g",
          labels: { at: "visible-start", content: [{ field: "note" }] },
        }),
      ],
    });
    const scene = chart.scene(estimateText);
    const { plot } = scene.panels[0]!;
    const a = labelsOf(scene).find(({ text }) => text === "a0")!;
    expect(a.x).toBeGreaterThan(plot.x + plot.width / 2);
  });

  contractTest("labels.attach.hidden", () => {
    const chart = model({
      marks: [line(rows, { x: "t", y: "v", series: "g", labels: { at: "last" } })],
    });
    chart.hidden.add(chart.series()[0]!.key);
    expect(texts(chart.scene(estimateText))).toEqual(["b"]);
  });

  contractTest("labels.attach.no-rows", () => {
    const plain = model({ marks: [line(rows, { x: "t", y: "v", series: "g", id: "l" })] });
    const labeled = model({
      marks: [
        line(rows, { x: "t", y: "v", series: "g", id: "l", labels: { at: "last" } }),
        text({ from: { mark: "l", at: "first" }, label: "start" }),
      ],
    });
    plain.scene(estimateText);
    labeled.scene(estimateText);
    // The same series, inspected and described alike.
    expect(labeled.series().map(({ key }) => key)).toEqual(plain.series().map(({ key }) => key));
    expect(describeChart(labeled)).toBe(describeChart(plain));
  });

  contractTest("labels.attach.outside", () => {
    const outside = { at: "last", place: { outside: true } } as const;
    const chart = model({
      marks: [line(rows, { x: "t", y: "v", series: "g", labels: outside })],
    });
    const plain = model({ marks: [line(rows, { x: "t", y: "v", series: "g" })] });
    const scene = chart.scene(estimateText);
    const { plot } = scene.panels[0]!;
    // The chart keeps room for them on the right, where they go.
    expect(plot.width).toBeLessThan(plain.scene(estimateText).panels[0]!.plot.width);
    for (const label of labelsOf(scene)) expect(label.x).toBeGreaterThan(plot.x + plot.width);
  });

  contractTest("labels.attach.surface", () => {
    // Halos take the color of what the labels are drawn on: the plot's fill, or the chart's outside it.
    const halo = (place?: { outside: true }) => {
      const labels = { at: "first", ...(place && { place }) } as const;
      const chart = model({
        theme: { style: { plot: { fill: "#eeeeee" } } },
        marks: [line(rows, { x: "t", y: "v", labels })],
      });
      return labelsOf(chart.scene(estimateText))[0]!.halo?.color;
    };
    expect(halo()).toBe("#eeeeee");
    expect(halo({ outside: true })).toBe("#ffffff");
  });

  contractTest("labels.attach.edge-spread", () => {
    // Labels of different widths moved in from one edge stand apart, as labels at one point do.
    const level = table({
      x: [0, 1, 0, 1],
      y: [5, 5, 5, 5],
      g: ["A", "A", "Long one", "Long one"],
    });
    for (const at of ["first", "last"] as const) {
      const scene = model({
        marks: [line(level, { x: "x", y: "y", series: "g", labels: { at } })],
      }).scene(estimateText);
      const [a, b] = within(scene)[0]!;
      expect(Math.abs(a!.y - b!.y)).toBeGreaterThanOrEqual(a!.paint.lineHeight);
    }
  });

  contractTest("labels.attach.shared-rows", () => {
    // Labels keep apart only from those they overlap: A meets B and B meets C along x,
    // so A and C share a row at their points, in a short plot as in a tall one.
    const steps = table({ x: [0, 3, 6], y: [3, 7, 3], g: ["AAAAAA", "BBBBBB", "CCCCCC"] });
    const style = { fontSize: 16, lineHeight: 1.25, halo: false } as const;
    for (const height of [90, 300]) {
      const scene = model(
        {
          x: { domain: [0, 10] },
          y: { domain: [0, 10] },
          marks: [line(steps, { x: "x", y: "y", series: "g", labels: { at: "last", style } })],
        },
        240,
        height,
      ).scene(estimateText);
      const { plot } = scene.panels[0]!;
      const labels = within(scene)[0]!;
      expect(labels.map(({ text }) => text).sort()).toEqual(["AAAAAA", "BBBBBB", "CCCCCC"]);
      for (const label of labels) {
        const value = label.text === "BBBBBB" ? 7 : 3;
        expect(label.y).toBeCloseTo(plot.y + plot.height * (1 - value / 10), 6);
      }
    }
  });

  contractTest("labels.attach.stable", () => {
    // Five labels whose extents along x meet as A-B, B-C, B-D, and D-E: C, which
    // meets only B, keeps its row at its point while A comes to meet B or leaves it.
    const names = ["A", "BBBBBBBB", "C", "DDD", "EE"];
    const style = { fontSize: 16, lineHeight: 1.25, halo: false } as const;
    const points = (x: number[], y: number[]) => table({ x, y, g: names });
    const config = (data: ReturnType<typeof points>): ChartConfig => ({
      x: { domain: [0, 300] },
      y: { domain: [0, 100] },
      marks: [line(data, { x: "x", y: "y", series: "g", labels: { at: "last", style } })],
    });
    const plot = model(config(points([0, 0, 0, 0, 0], [0, 0, 0, 0, 0])), 343, 136).scene(
      estimateText,
    ).panels[0]!.plot;
    const wide = estimateText("A", "16px sans-serif");
    const tops = (delta: number) => {
      const from = [20 - wide + delta, 20, 45, 100, 120];
      const centers = [40, 45, 70, 80, 90];
      const data = points(
        from.map((x) => ((x - 4) * 300) / plot.width),
        centers.map((y) => (1 - y / plot.height) * 100),
      );
      const scene = model(config(data), 343, 136).scene(estimateText);
      const at = scene.panels[0]!.plot;
      return new Map(labelsOf(scene).map((label) => [label.text, label.y - at.y]));
    };
    const [apart, met] = [tops(-0.001), tops(0.001)];
    expect(apart.get("C")).toBeCloseTo(70, 6);
    expect(met.get("C")).toBeCloseTo(70, 6);
    expect([...met.keys()].sort()).toEqual([...names].sort());
  });

  it("put labels at one point in the order of their series", () => {
    const same = table({
      x: [0, 1, 0, 1],
      y: [5, 5, 5, 5],
      g: ["first", "first", "second", "second"],
    });
    const scene = model({
      y: { domain: [0, 10] },
      marks: [line(same, { x: "x", y: "y", series: "g", labels: { at: "last" } })],
    }).scene(estimateText);
    const fromTop = labelsOf(scene)
      .sort((a, b) => a.y - b.y)
      .map(({ text }) => text);
    expect(fromTop).toEqual(["first", "second"]);
  });

  contractTest("labels.attach.fit", () => {
    // Labels wider than their plot are shortened to it, at both edges, in a narrow inset and in facet panels.
    const long = "A longer series label which does not fit";
    const level = table({ x: [0, 1, 0, 1], y: [1, 1, 1, 1], g: ["a", "a", "b", "b"] });
    for (const at of ["first", "last"] as const) {
      const labels = { at, content: [long] };
      const [main, zoom] = within(
        model(
          {
            panels: panels(panel({ id: "main" }, [inset({ id: "zoom" })])),
            marks: [line(level, { x: "x", y: "y", panel: "*", labels })],
          },
          400,
          300,
        ).scene(estimateText),
      );
      expect(main!.map(({ text }) => text)).toEqual([long]);
      expect(zoom![0]!.text).toMatch(/^A longer .*…$/);
      const faceted = within(
        model({ facet: facet("g"), marks: [line(level, { x: "x", y: "y", labels })] }).scene(
          estimateText,
        ),
      );
      for (const [label] of faceted) expect(label!.text).toMatch(/^A longer .*…$/);
    }
    // Where nothing but the ellipsis fits, the label is left out.
    const rising = table({ x: [0, 1], y: [1, 2] });
    const shown = (fontSize: number) => {
      const labels = { at: "last", content: ["Wide"], style: { fontSize } } as const;
      return texts(
        model({ marks: [line(rising, { x: "x", y: "y", labels })] }, 120).scene(estimateText),
      );
    };
    expect(shown(40)).toEqual(["W…"]);
    expect(shown(60)).toEqual([]);
  });

  contractTest("labels.attach.box-outline", () => {
    // A box's outline is painted within the plot too, and counts in the room kept outside it.
    const level = table({ x: [0, 1], y: [1, 1] });
    const boxed = (strokeWidth: number, at: "first" | "last", outside = false) => {
      const background = { fill: "#ffffff", stroke: "#ff0000", strokeWidth };
      const style = { background, padding: 4 };
      const labels = { at, content: ["Label"], place: { outside }, style };
      return model({ marks: [line(level, { x: "x", y: "y", labels })] }).scene(estimateText);
    };
    for (const at of ["first", "last"] as const) expect(within(boxed(12, at))[0]).toHaveLength(1);
    const width = (strokeWidth: number) => boxed(strokeWidth, "last", true).panels[0]!.plot.width;
    expect(width(0) - width(12)).toBe(6);
  });

  contractTest("labels.attach.streaming", () => {
    const live = table({ t: [0, 1], v: [1, 2] }, { maxRows: 10 });
    const chart = model({
      marks: [line(live, { x: "t", y: "v", labels: { at: "last", content: [{ value: true }] } })],
    });
    expect(texts(chart.scene(estimateText))).toEqual(["2"]);
    live.append({ t: [2], v: [5] });
    expect(texts(chart.scene(estimateText))).toEqual(["5"]);
  });

  contractTest("labels.attach.paint-order", () => {
    // A line's own labels paint where the line does; text from it as the text does.
    const chart = model({
      marks: [
        line(rows, { x: "t", y: "v", series: "g", id: "l", zIndex: 2, labels: { at: "last" } }),
        text({ from: { mark: "l", at: "first" }, label: "start", zIndex: 1 }),
      ],
    });
    const marks = chart.scene(estimateText).panels[0]!.marks;
    const labels = marks.filter((g: Geometry) => g.kind === "labels");
    expect(labels.map(({ zIndex }) => zIndex)).toEqual([2, 1]);
  });

  contractTest("labels.attach.band-edge", () => {
    const band = table({ t: [0, 1, 2], low: [1, 2, 3], high: [4, 5, 6] });
    const options = { x: "t", y1: "low", y2: "high" } as const;
    expect(refusal({ marks: [area(band, { ...options, labels: { at: "last" } })] })).toMatchObject({
      code: "invalid-option",
      path: "marks[0].labels.edge",
    });
    const chart = model({
      marks: [
        area(band, {
          ...options,
          labels: { at: "last", edge: "y1", content: [{ value: true }] },
        }),
      ],
    });
    expect(texts(chart.scene(estimateText))).toEqual(["3"]);
    expect(
      refusal({
        marks: [line(band, { x: "t", y: "low", labels: { at: "last", edge: "y1" } as never })],
      }),
    ).toMatchObject({ code: "invalid-option", path: "marks[0].labels.edge" });
  });

  contractTest("labels.attach.stacked", () => {
    // A stack's layers follow their tops, and say the value drawn there.
    const stacked = table({ t: [0, 1, 0, 1], v: [1, 2, 3, 4], g: ["a", "a", "b", "b"] });
    const chart = model({
      marks: [
        area(stacked, {
          x: "t",
          y: "v",
          series: "g",
          stack: true,
          labels: { at: "last", content: [{ series: true }, " ", { value: true }] },
        }),
      ],
    });
    expect(texts(chart.scene(estimateText))).toEqual(["a 2", "b 6"]);
  });
});

describe("text following a mark", () => {
  contractTest("text.from.fields", () => {
    const chart = model({
      marks: [
        line(rows, { x: "t", y: "v", series: "g", id: "l" }),
        text({ from: { mark: "l", at: "last" }, label: { field: "note" } }),
      ],
    });
    expect(texts(chart.scene(estimateText))).toEqual(["a3", "b3"]);
  });

  contractTest("text.from.refused", () => {
    const own = (from: object, at = 1) => {
      const follow = text({ from: from as never, label: "x" });
      const marks = [
        line(rows, { x: "t", y: "v", id: "l" }),
        point(rows, { x: "t", y: "v", id: "p" }),
      ];
      return refusal({ marks: at === 0 ? [follow, ...marks] : [...marks, follow] });
    };
    expect(own({ mark: "nope", at: "last" })).toMatchObject({
      code: "unknown-reference",
      path: "marks[2].from.mark",
    });
    expect(own({ mark: "p", at: "last" })).toMatchObject({
      code: "invalid-option",
      path: "marks[2].from.mark",
    });
    expect(own({ mark: "l", at: "last" }, 0)).toMatchObject({
      code: "invalid-option",
      path: "marks[0].from.mark",
    });
    expect(own({ mark: "l", at: "last", edge: "y1" })).toMatchObject({
      code: "invalid-option",
      path: "marks[2].from.edge",
    });
    // In the source's panel.
    const layout = panels(columns([1, 1], [panel({ id: "a" }), panel({ id: "b" })]));
    expect(
      refusal({
        panels: layout,
        marks: [
          line(rows, { x: "t", y: "v", id: "l", panel: "a" }),
          text({ from: { mark: "l", at: "last" }, label: "x", panel: "b" }),
        ],
      }),
    ).toMatchObject({ code: "invalid-option", path: "marks[1].panel" });
    expect(() => text({ from: { mark: "l", at: "last" }, label: "x", legend: true })).toThrow(
      /legend/,
    );
  });

  it("refuse label places text does not draw", () => {
    expect(() => text({ x: 1, y: 1, label: { text: "x", place: { offset: 4 } } as never })).toThrow(
      expect.objectContaining({
        code: "invalid-option",
        path: "label.place",
        message:
          "text label.place: text at a place is drawn there; drop place, or follow a series with from",
      }),
    );
    expect(() =>
      text({
        from: { mark: "l", at: "last" },
        label: { text: "x", place: { side: "top" } } as never,
      }),
    ).toThrow(expect.objectContaining({ code: "invalid-option", path: "label.place.side" }));
  });

  contractTest("text.from.panels", () => {
    // Labels follow their source in each panel it draws.
    const layout = panels(columns([1, 1], [panel({ id: "a" }), panel({ id: "b" })]));
    const chart = model({
      panels: layout,
      marks: [
        line(rows, { x: "t", y: "v", series: "g", id: "l", panel: "b" }),
        text({
          from: { mark: "l", at: "last" },
          label: { content: [{ series: true }] },
          panel: "b",
        }),
      ],
    });
    const scene = chart.scene(estimateText);
    const b = scene.panels.findIndex((p) => p.key === "b");
    expect(labelsOf(scene, b).map(({ text }) => text)).toEqual(["a", "b"]);
    expect(labelsOf(scene, 1 - b)).toEqual([]);
  });
});

describe("the observation a label is at", () => {
  /** The notes labels at `at` read, on `marks` drawn along fixed domains. */
  const notes = (config: ChartConfig) => texts(model(config).scene(estimateText));
  const noted = { content: [{ field: "note" }] } as const;

  it("is the one an edge between rows at one position arrives at", () => {
    const steps = table({ t: [0, 1, 1, 2], v: [1, 2, 3, 4], note: ["n0", "n1", "n2", "n3"] });
    const at = (labels: "visible-start" | "visible-end", domain: [number, number]) =>
      notes({
        x: { domain, nice: false },
        y: { domain: [0, 5], nice: false },
        marks: [line(steps, { x: "t", y: "v", labels: { at: labels, ...noted } })],
      });
    // Leaving the view at t = 1 from the row at 3; entering it at t = 1 at the row at 2.
    expect(at("visible-end", [0, 1])).toEqual(["n2"]);
    expect(at("visible-start", [1, 2])).toEqual(["n1"]);
  });

  it("is the one a segment entering the view arrives at, where positions do not ascend", () => {
    const back = table({ t: [5, 1, 3], v: [1, 2, 3], note: ["n0", "n1", "n2"] });
    expect(
      notes({
        x: { domain: [0, 4], nice: false },
        y: { domain: [0, 4], nice: false },
        marks: [line(back, { x: "t", y: "v", labels: { at: "visible-start", ...noted } })],
      }),
    ).toEqual(["n1"]);
  });

  it("is the one a crossing of where arrives at", () => {
    const rising = table({ t: [0, 1, 2, 3], v: [1, 2, 3, 4], note: ["n0", "n1", "n2", "n3"] });
    expect(
      notes({
        x: { domain: [0, 3], nice: false },
        y: { domain: [0, 5], nice: false },
        marks: [
          line(rising, {
            x: "t",
            y: "v",
            where: col("v").lt(2.5),
            labels: { at: "visible-end", ...noted },
          }),
        ],
      }),
    ).toEqual(["n2"]);
  });

  it("is on the plot's edge whatever widths round its path to", () => {
    // A path's 32-bit pixels fall a little past the edge of a plot 400.1 wide.
    const upright = table({ t: [1, 1], v: [1, 2], note: ["n0", "n1"] });
    const config: ChartConfig = {
      x: { domain: [0, 1], nice: false },
      y: { domain: [0, 3], nice: false },
      marks: [line(upright, { x: "t", y: "v", labels: { at: "visible-end", ...noted } })],
    };
    expect(texts(model(config, 400.1).scene(estimateText))).toEqual(["n1"]);
  });

  it("is drawn: a band's with both edges, a row outside the x axis' breaks along y", () => {
    const band = (hi: number[]) =>
      notes({
        marks: [
          area(table({ t: [0, 1, 2], lo: [1, 1, 1], hi, note: ["n0", "n1", "n2"] }), {
            x: "t",
            y1: "lo",
            y2: "hi",
            labels: { at: "last", edge: "y1", ...noted },
          }),
        ],
      });
    expect(band([2, 2, Number.NaN])).toEqual(["n1"]);
    expect(band([Number.NaN, Number.NaN, Number.NaN])).toEqual([]);
    // Along y, the last row's time is inside a break of x: the row before it is the last drawn.
    const depths = table({ depth: [0, 1, 2], at: time([2, 6, 4]), note: ["n0", "n1", "n2"] });
    expect(
      notes({
        x: { breaks: timeBreaks([{ from: 3, to: 5 }]), domain: [0, 20] },
        marks: [
          line(depths, { x: "at", y: "depth", orient: "y", labels: { at: "last", ...noted } }),
        ],
      }),
    ).toEqual(["n1"]);
  });

  it("is the one the drawn step arrives at, where level of detail keeps rows apart", () => {
    // A column of a hundred rows rising to 0.99, then one at 1 far off:
    // level of detail keeps rows 0 and 99 of the column, whose jump leaves the view.
    const n = 100;
    const steps = table({
      t: [...Array.from({ length: n }, (_, i) => i / 10_000), 1000],
      v: [...Array.from({ length: n }, (_, i) => i / 100), 1],
      note: Array.from({ length: n + 1 }, (_, i) => `n${i}`),
    });
    expect(
      notes({
        x: { domain: [0, 1000], nice: false },
        y: { domain: [0, 0.5], nice: false },
        marks: [
          line(steps, { x: "t", y: "v", curve: "step", labels: { at: "visible-end", ...noted } }),
        ],
      }),
    ).toEqual(["n99"]);
  });

  it("is the one a step's hold holds, where positions do not ascend", () => {
    // Back from t = 5 to 0, the hold of row 1's value enters the view at t = 4.
    const back = table({ t: [5, 0, 2], v: [1, 4, 6], note: ["n0", "n1", "n2"] });
    expect(
      notes({
        x: { domain: [1, 4], nice: false },
        y: { domain: [0, 10], nice: false },
        marks: [
          line(back, {
            x: "t",
            y: "v",
            curve: "step-before",
            labels: { at: "visible-start", ...noted },
          }),
        ],
      }),
    ).toEqual(["n1"]);
  });

  it("is never a row continuity leaves out, though it stands where one drawn does", () => {
    const twice = table({ t: [0, 1, 1], v: [1, 2, 2], note: ["n0", "n1", "n2"] });
    expect(
      notes({
        x: { domain: [0, 2], nice: false },
        y: { domain: [0, 3], nice: false },
        marks: [
          line(twice, {
            x: "t",
            y: "v",
            continuity: { defined: col("note").ne("n2") },
            labels: { at: "visible-end", ...noted },
          }),
        ],
      }),
    ).toEqual(["n1"]);
  });

  it("is drawn as the tracer draws it: a log band's other edge placed, a log stack's zeros at the axis' low end, a layer at a break's seam", () => {
    // A band on a log axis draws only rows both of whose edges are positive.
    const logBand = table({
      t: [0, 1, 2],
      lo: [1, 0, -1],
      hi: [2, 3, 4],
      note: ["n0", "n1", "n2"],
    });
    expect(
      notes({
        y: { type: "log", domain: [0.5, 10], nice: false },
        marks: [
          area(logBand, {
            x: "t",
            y1: "lo",
            y2: "hi",
            labels: { at: "last", edge: "y2", ...noted },
          }),
        ],
      }),
    ).toEqual(["n0"]);
    // A stack on a log axis draws its zeros along the axis' low end.
    const logStack = table({ t: [0, 1], v: [1, 0], note: ["n0", "n1"] });
    expect(
      notes({
        y: { type: "log", domain: [0.5, 10], nice: false },
        marks: [area(logStack, { x: "t", y: "v", stack: true, labels: { at: "last", ...noted } })],
      }),
    ).toEqual(["n1"]);
    // A band along y keeps a row whose edge a break of x hides, at the break's seam.
    const depths = table({
      depth: [0, 1, 2],
      lo: time([1, 1, 1]),
      hi: time([6, 6, 4]),
      note: ["n0", "n1", "n2"],
    });
    expect(
      notes({
        x: { breaks: timeBreaks([{ from: 3, to: 5 }]), domain: [0, 20] },
        marks: [
          area(depths, {
            y: "depth",
            x1: "lo",
            x2: "hi",
            orient: "y",
            labels: { at: "last", edge: "x1", ...noted },
          }),
        ],
      }),
    ).toEqual(["n2"]);
  });

  it("is drawn as the tracer draws it, where a stack's layers or a curved band are drawn through shared edges", () => {
    // A series field's stack on a log axis draws its last zero along the axis' low end.
    const logStack = table({ t: [0, 1], v: [1, 0], g: ["a", "a"], note: ["n0", "n1"] });
    expect(
      notes({
        x: { domain: [0, 1], nice: false },
        y: { type: "log", domain: [0.1, 10], nice: false },
        marks: [
          area(logStack, {
            x: "t",
            y: "v",
            series: "g",
            stack: true,
            labels: { at: "last", ...noted },
          }),
        ],
      }),
    ).toEqual(["n1"]);
    // Along y, the last row's edge is in a break of x: it is drawn at the break's seam.
    const breaks = timeBreaks([{ from: 3, to: 5 }]);
    const depths = table({
      depth: [0, 1, 2],
      lo: time([1, 1, 1]),
      hi: time([6, 6, 4]),
      g: ["a", "a", "a"],
      note: ["n0", "n1", "n2"],
    });
    for (const mark of [
      area(depths, {
        y: "depth",
        x1: "lo",
        x2: "hi",
        curve: "monotone",
        labels: { at: "last", edge: "x1", ...noted },
      }),
      area(depths, {
        y: "depth",
        x: "hi",
        orient: "y",
        series: "g",
        stack: true,
        labels: { at: "last", ...noted },
      }),
    ])
      expect(notes({ x: { domain: [0, 10], nice: false, breaks }, marks: [mark] })).toEqual(["n2"]);
  });

  it("is the one a crossing of where arrives at, past rows a break hides", () => {
    // Rows 1 and 2 are in the break; v < 6 ends where the line leaves row 3 for
    // row 4, and v > 2 starts where it leaves row 0 for row 1 (at the seam).
    const hidden = table({
      t: time([0, 3, 4, 8, 10]),
      v: [0, 3, 4, 8, 10],
      lo: [-2, 1, 2, 6, 8],
      note: ["n0", "n1", "n2", "n3", "n4"],
    });
    const at = (end: boolean, banded: boolean) => {
      const where = end ? col("v").lt(6) : col("v").gt(2);
      const labels = {
        at: end ? "visible-end" : "visible-start",
        place: { outside: false },
        ...noted,
      } as const;
      return notes({
        x: { domain: [0, 10], nice: false, breaks: timeBreaks([{ from: 2, to: 6 }]) },
        y: { domain: [-2, 10], nice: false },
        marks: [
          banded
            ? area(hidden, { x: "t", y1: "lo", y2: "v", where, labels: { ...labels, edge: "y2" } })
            : line(hidden, { x: "t", y: "v", where, labels }),
        ],
      });
    };
    for (const banded of [false, true]) {
      expect(at(true, banded)).toEqual(["n3"]);
      expect(at(false, banded)).toEqual(["n1"]);
    }
  });

  it("is where the curve drawn meets the plot's edge, however little of it the view holds", () => {
    // The view holds a sliver of the curve from row 0 to 1, entering at its left edge.
    expect(
      notes({
        x: { domain: [0.53, 0.53001], nice: false },
        y: { domain: [72.05, 72.07], nice: false },
        marks: [
          line(table({ t: [0, 1, 2], v: [0, 100, 100], note: ["n0", "n1", "n2"] }), {
            x: "t",
            y: "v",
            curve: "monotone",
            labels: { at: "visible-start", ...noted },
          }),
        ],
      }),
    ).toEqual(["n1"]);
  });

  it("is refused at the view's edges for fields of a series field's stack", () => {
    const layers = table({ t: [0, 1, 2], lo: [0, 0, 0], hi: [1, 4, 6], g: ["a", "a", "a"] });
    const content = [{ series: true }, ": ", { field: "hi" }] as const;
    const stack = { x: "t", y: "hi", series: "g", stack: true } as const;
    expect(
      refusal({ marks: [area(layers, { ...stack, labels: { at: "visible-end", content } })] }),
    ).toMatchObject({ code: "invalid-option", path: "marks[0].labels.content[2]" });
    expect(
      refusal({
        marks: [
          area(layers, { id: "a", ...stack }),
          text({ from: { mark: "a", at: "visible-start" }, label: { field: "hi" } }),
        ],
      }),
    ).toMatchObject({ code: "invalid-option", path: "marks[1].label.field" });
    // Its series and values are written there, and its fields at either end.
    const view = {
      x: { domain: [0, 2], nice: false },
      y: { domain: [0, 10], nice: false },
    } as const;
    for (const labels of [
      { at: "visible-end", content: [{ value: true }] },
      { at: "last", content: [{ field: "hi" }] },
    ] as const)
      expect(notes({ ...view, marks: [area(layers, { ...stack, labels })] })).toEqual(["6"]);
  });

  it("is the one a curve of layers drawn together arrives at", () => {
    // A band's curve back from t = 5 to 0 enters the view at t = 4, arriving
    // at row 1, and leaves it on the way to row 2, on a linear and a log axis.
    const back = table({ t: [5, 0, 2], lo: [1, 1, 1], hi: [2, 4, 6], note: ["n0", "n1", "n2"] });
    for (const type of ["linear", "log"] as const)
      for (const [at, note] of [
        ["visible-start", "n1"],
        ["visible-end", "n2"],
      ] as const)
        expect(
          notes({
            x: { domain: [1, 4], nice: false },
            y: { type, domain: [0.5, 10], nice: false },
            marks: [
              area(back, {
                x: "t",
                y1: "lo",
                y2: "hi",
                curve: "monotone",
                labels: { at, edge: "y2", ...noted },
              }),
            ],
          }),
          `${type} ${at}`,
        ).toEqual([note]);
    // Level of detail keeps rows 0 and 99 of a dense column: the curve leaving the view arrives at 99.
    const n = 100;
    const t = [...Array.from({ length: n }, (_, i) => i / 10_000), 1000];
    const dense = table({
      t,
      lo: t.map(() => 0),
      hi: t.map((_, i) => i / 100),
      v: t.map(() => 0.1),
      note: t.map((_, i) => `n${i}`),
    });
    const view = {
      x: { domain: [0, 1000], nice: false },
      y: { domain: [0, 0.5], nice: false },
    } as const;
    expect(
      notes({
        ...view,
        marks: [
          area(dense, {
            x: "t",
            y1: "lo",
            y2: "hi",
            curve: "monotone",
            labels: { at: "visible-end", edge: "y2", ...noted },
          }),
        ],
      }),
    ).toEqual(["n99"]);
    // A stack of fields curves its layers together too: v's top stays in
    // view to row 100, on the plot's edge; hi's leaves it on the way to 99.
    expect(
      notes({
        ...view,
        marks: [
          area(dense, {
            x: "t",
            y: ["v", "hi"],
            stack: true,
            curve: "monotone",
            labels: { at: "visible-end", ...noted },
          }),
        ],
      }),
    ).toEqual(["n100", "n99"]);
  });

  it("is each panel's own, where panels draw a series on scales of their own", () => {
    // Panel a's log axis draws the band straight, b's linear one curved.
    const band = table({ t: [0, 1, 2], lo: [1, 2, 3], hi: [4, 5, 6], note: ["n0", "n1", "n2"] });
    for (const order of [
      ["log", "linear"],
      ["linear", "log"],
    ] as const) {
      const chart = model({
        panels: panels(
          order.map((type, i) => ({ id: `p${i}`, y: { type, domain: [1, 10], nice: false } })),
        ),
        marks: [
          area(band, {
            x: "t",
            y1: "lo",
            y2: "hi",
            panel: "*",
            curve: "monotone",
            labels: { at: "last", edge: "y2", ...noted },
          }),
        ],
      });
      const scene = chart.scene(estimateText);
      for (const [i, panel] of scene.panels.entries()) {
        const { upper } = panel.marks.find((g) => g.kind === "area") as AreaGeometry;
        const [label] = labelsOf(scene, i);
        expect(label?.text, order.join(" ")).toBe("n2");
        expect(label!.y).toBeCloseTo(upper.coords[upper.count * 2 - 1]!, 2);
      }
    }
  });

  it("is found as a stack is traced, through its edges' indexes", () => {
    // Reads of the stack's values as a scene draws it again, with labels and
    // without; stacks this long keep min/max indexes of their edges.
    const n = 300_000;
    const rows = table({
      t: Float64Array.from({ length: n }, (_, i) => i),
      lo: Float64Array.from({ length: n }, (_, i) => 1 + Math.sin(i / 500)),
      v: Float64Array.from({ length: n }, (_, i) => 2 + Math.sin(i / 500)),
    });
    const reads = (labeled: boolean) => {
      const chart = model({
        x: { domain: [0, n], nice: false },
        y: { domain: [0, 6], nice: false },
        marks: [
          area(rows, {
            x: "t",
            y: ["lo", "v"],
            stack: true,
            ...(labeled ? { labels: { at: "visible-end", place: { outside: false } } } : {}),
          }),
        ],
      });
      let drawn: Parameters<NonNullable<ChartModel["highlight"]>> | undefined;
      chart.highlight = (mark, series, frame, key) => {
        drawn = [mark, series, frame, key];
        return mark.geometry(series, frame, key);
      };
      chart.scene(estimateText);
      let count = 0;
      const counted = <T extends object>(values: T): T =>
        new Proxy(values, {
          get: (target, key) => {
            if (typeof key === "string" && /^\d+$/.test(key)) count++;
            return Reflect.get(target, key);
          },
        });
      const [mark, series, frame, key] = drawn!;
      mark.geometry(
        series.map((s) => ({ ...s, y: counted(s.y), ...(s.y0 && { y0: counted(s.y0) }) })),
        frame,
        key,
      );
      return count;
    };
    const unlabeled = reads(false);
    expect(unlabeled).toBeLessThan(n / 10);
    expect(reads(true)).toBeLessThan(2 * unlabeled);
  });

  it("is found past a break a break at a time, not a row at a time", () => {
    // Reads of the line's positions as a scene draws it again, with a label
    // at its first observation and without: a break hides all but its last rows.
    const n = 100_000;
    const rows = table({
      t: time(Float64Array.from({ length: n }, (_, i) => i)),
      v: Float64Array.from({ length: n }, () => 1),
      g: Array.from({ length: n }, () => "a"),
    });
    // A line, and a series field's stack, whose layers are drawn through its edges.
    const reads = (labeled: boolean, stacked: boolean) => {
      const labels = labeled ? ({ labels: { at: "first" } } as const) : {};
      const chart = model({
        x: { domain: [0, n], nice: false, breaks: timeBreaks([{ from: 0, to: n - 10 }]) },
        y: { domain: [0, 2], nice: false },
        marks: [
          stacked
            ? area(rows, { x: "t", y: "v", series: "g", stack: true, ...labels })
            : line(rows, { x: "t", y: "v", ...labels }),
        ],
      });
      let drawn: Parameters<NonNullable<ChartModel["highlight"]>> | undefined;
      chart.highlight = (mark, series, frame, key) => {
        drawn = [mark, series, frame, key];
        return mark.geometry(series, frame, key);
      };
      chart.scene(estimateText);
      let count = 0;
      const counted = <T extends object>(values: T): T =>
        new Proxy(values, {
          get: (target, key) => {
            if (typeof key === "string" && /^\d+$/.test(key)) count++;
            return Reflect.get(target, key);
          },
        });
      const [mark, series, frame, key] = drawn!;
      // Drawn as in a scene of its own, so labels find their places again.
      const again = { ...frame, scene: frame.scene + 1 };
      mark.geometry(
        series.map((s) => ({ ...s, x: counted(s.x) })),
        again,
        key,
      );
      return count;
    };
    for (const stacked of [false, true])
      expect(reads(true, stacked), `stacked: ${stacked}`).toBeLessThan(
        reads(false, stacked) + 1000,
      );
  });

  it("is none where a series drawn before draws nothing now", () => {
    const rows = table({ t: [0, 1], v: [1, 2], lo: [0, 1], note: ["n0", "n1"] });
    const labels = { at: "visible-start", place: { outside: false }, ...noted } as const;
    const continuity = { maxGap: 100 };
    for (const mark of [
      line(rows, { x: "t", y: "v", continuity, labels }),
      area(rows, { x: "t", y: "v", continuity, labels }),
      area(rows, { x: "t", y1: "lo", y2: "v", continuity, labels: { ...labels, edge: "y2" } }),
    ]) {
      const chart = model({
        x: { domain: [0, 1], nice: false },
        y: { domain: [0, 3], nice: false },
        marks: [mark],
      });
      expect(texts(chart.scene(estimateText))).toEqual(["n0"]);
      rows.setColumn("v", [Number.NaN, Number.NaN]);
      expect(texts(chart.scene(estimateText))).toEqual([]);
      rows.setColumn("v", [1, 2]);
    }
  });

  it("is read on the source's scales, for text following a series on another axis", () => {
    const right = table({ t: [0, 1, 2], v: [120, 180, 150] });
    for (const at of ["last", "visible-end"] as const)
      expect(
        notes({
          x: { domain: [0, 2], nice: false },
          y: { domain: [0, 1], nice: false },
          yRight: { domain: [100, 200], nice: false },
          marks: [
            line(right, { id: "r", x: "t", y: "v", axis: "right" }),
            text({ from: { mark: "r", at }, label: { content: [{ value: true }] } }),
          ],
        }),
        at,
      ).toEqual(["150"]);
  });

  it("takes following text's own halo, and its place outside the plot", () => {
    const chart = model({
      marks: [
        line(rows, { id: "l", x: "t", y: "v", series: "g" }),
        text({
          from: { mark: "l", at: "last" },
          halo: false,
          label: { text: "end", place: { outside: true } },
        }),
      ],
    });
    const scene = chart.scene(estimateText);
    const { plot } = scene.panels[0]!;
    for (const label of labelsOf(scene)) {
      expect(label.halo).toBeUndefined();
      expect(label.x).toBeGreaterThan(plot.x + plot.width);
    }
  });

  it("is refused where text's from.at names no place", () => {
    expect(
      refusal({
        marks: [
          line(rows, { id: "l", x: "t", y: "v", series: "g" }),
          text({ from: { mark: "l", at: "middle" as "last" }, label: "x" }),
        ],
      }),
    ).toMatchObject({ code: "invalid-option", path: "marks[1].from.at" });
  });

  it("writes a time field with Intl date options in the chart's zone", () => {
    const day = Date.UTC(2026, 9, 25, 23);
    const dated = table({ t: [0, 1], v: [1, 2], when: time([day, day]) });
    expect(
      texts(
        model({
          timeZone: "Asia/Tokyo",
          marks: [
            line(dated, {
              x: "t",
              y: "v",
              labels: {
                at: "last",
                content: [
                  { field: "when", format: { year: "numeric", month: "2-digit", day: "2-digit" } },
                ],
              },
            }),
          ],
        }).scene(estimateText),
      ),
    ).toEqual(["10/26/2026"]);
  });

  it("writes the value of a line of times as a time, with Intl date options or none", () => {
    const day = Date.UTC(2026, 9, 25, 23);
    const dated = table({ t: [0, 1], when: time([day - 86_400_000, day]) });
    const written = (format?: Intl.DateTimeFormatOptions) =>
      texts(
        model({
          timeZone: "Asia/Tokyo",
          marks: [
            line(dated, {
              x: "t",
              y: "when",
              labels: { at: "last", content: [{ value: true, ...(format && { format }) }] },
            }),
          ],
        }).scene(estimateText),
      ).filter((text) => text.includes("2026"));
    expect(written({ year: "numeric", month: "2-digit", day: "2-digit" })).toEqual(["10/26/2026"]);
    expect(written()).toEqual([expect.stringMatching(/^Oct 26, 2026/)]);
  });
});
