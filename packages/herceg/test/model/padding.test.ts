// Scales' padding: "auto" keeps room for what marks draw past their data
// (markers, points, bar labels and widths), a share or pixels given replace
// it, and 0 is tight; given padding widens domains set and views too.
import { describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { NAVIGATOR_PANEL, rangeNavigator } from "../../src/model/navigator.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type { LineGeometry, ShapesGeometry } from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";
import { setViewport } from "../helpers/views.ts";

function build(config: ChartConfig, width = 400, height = 200) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", legend: false, ...config },
    undefined,
    ...staticCompilers(),
  );
  model.setSize(width, height, 1);
  const scene = model.scene(estimateText);
  return { model, scene, plot: scene.panels[0]!.plot };
}

const rows = table({ t: [0, 2, 4, 6, 8, 10], v: [1, 4, 2, 8, 5, 10] });
const plain = (options: object = {}) => line(rows, { x: "t", y: "v", ...options });

describe("automatic padding", () => {
  contractTest("scale.padding.auto.lines", () => {
    // Plain lines keep their domain; markers keep room for their reach.
    expect(build({ marks: [plain()] }).model.xScale()!.domain).toEqual([0, 10]);
    const { model, plot } = build({ marks: [plain({ markers: true })] });
    const x = model.xScale()!;
    // A circle of radius 3: its edge on the plot's.
    expect(x.map(0)).toBeCloseTo(plot.x + 3, 3);
    expect(x.map(10)).toBeCloseTo(plot.x + plot.width - 3, 3);
    // Outlined markers reach half their outline further.
    const ringed = build({
      marks: [plain({ markers: true, style: { marker: { stroke: "#000", strokeWidth: 4 } } })],
    });
    expect(ringed.model.xScale()!.map(0)).toBeCloseTo(ringed.plot.x + 5, 3);
  });

  contractTest("scale.padding.auto.bars", () => {
    // Bars keep their baseline on zero; labels get room at their ends.
    const labeled = build({ marks: [bar(rows, { x: "t", y: "v", labels: true })] });
    const y = labeled.model.yScale()!;
    expect(y.domain[0]).toBe(0);
    expect(y.domain[1]).toBeGreaterThan(10);
    // Bars of a width of their own keep half of it beyond their slots.
    const slots = build({ marks: [bar(rows, { x: "t", y: "v" })] }).model.xScale()!.domain;
    const wide = build({ marks: [bar(rows, { x: "t", y: "v", width: { px: 60 } })] });
    const x = wide.model.xScale()!;
    expect(x.domain[0]).toBeLessThan(slots[0]!);
    expect(x.map(slots[0]!)).toBeCloseTo(wide.plot.x + 30, 3);
  });

  contractTest("scale.padding.auto.tiny", () => {
    // A plot less than twice as wide as the room asked keeps the data's domain.
    const big = point(rows, { x: "t", y: "v", radius: 12 });
    expect(build({ marks: [big] }, 400).model.xScale()!.domain[0]).toBeLessThan(0);
    expect(build({ marks: [big] }, 80).model.xScale()!.domain).toEqual([0, 10]);
  });
});

describe("padding given", () => {
  contractTest("scale.padding.share", () => {
    // A share of the rounded domain at each end; ticks stay within it.
    const { model } = build({ marks: [plain()], x: { padding: 0.1 } });
    const x = model.xScale()!;
    expect(x.domain[0]).toBeCloseTo(-1, 9);
    expect(x.domain[1]).toBeCloseTo(11, 9);
    const ticks = model.panels()[0]!.plans.x.ticks;
    expect(Math.min(...ticks)).toBe(0);
    expect(Math.max(...ticks)).toBe(10);
    // On a log axis, in log space: 1 to 100 widened by a tenth of two decades.
    const log = build({
      marks: [line(table({ t: [1, 100], v: [1, 2] }), { x: "t", y: "v" })],
      x: { type: "log", padding: 0.1 },
    });
    const [lo, hi] = log.model.xScale()!.domain;
    expect(Math.log10(lo!)).toBeCloseTo(-0.2, 9);
    expect(Math.log10(hi!)).toBeCloseTo(2.2, 9);
  });

  contractTest("scale.padding.pixels", () => {
    // Pixels at each end, in place of the room points ask for.
    const { model, plot } = build({
      marks: [point(rows, { x: "t", y: "v", radius: 6 })],
      x: { padding: { px: 20 } },
    });
    const x = model.xScale()!;
    expect(x.map(0)).toBeCloseTo(plot.x + 20, 3);
    expect(x.map(10)).toBeCloseTo(plot.x + plot.width - 20, 3);
  });

  contractTest("scale.padding.tight", () => {
    // 0: no room, whatever marks ask.
    const { model } = build({
      marks: [point(rows, { x: "t", y: "v", radius: 6 })],
      x: { padding: 0 },
    });
    expect(model.xScale()!.domain).toEqual([0, 10]);
  });

  contractTest("scale.padding.views", () => {
    // A domain set and a view are exact unless padding is given; then padded too.
    const set = build({ marks: [point(rows, { x: "t", y: "v" })], x: { domain: [2, 8] } });
    expect(set.model.xScale()!.domain).toEqual([2, 8]);
    const padded = build({
      marks: [point(rows, { x: "t", y: "v" })],
      x: { domain: [2, 8], padding: { px: 10 } },
    });
    expect(padded.model.xScale()!.map(2)).toBeCloseTo(padded.plot.x + 10, 3);
    setViewport(padded.model, [4, 6]);
    padded.model.scene(estimateText);
    expect(padded.model.getViewport().x).toEqual([4, 6]);
    expect(padded.model.xScale()!.map(4)).toBeCloseTo(padded.plot.x + 10, 3);
  });

  contractTest("scale.padding.y-fit", () => {
    // y fits the rows of x's domain or view; padding is room around it,
    // which shows the rows beyond it without fitting them.
    const wide = table({ t: [-3, 0, 10, 13], v: [100, 1, 1, 100] });
    const { model } = build({
      marks: [line(wide, { x: "t", y: "v" })],
      x: { domain: [0, 10], padding: 0.4 },
    });
    expect(model.xScale()!.domain[0]).toBeCloseTo(-4, 9);
    expect(model.yScale()!.domain[1]).toBeLessThan(100);
  });

  contractTest("scale.padding.impossible", () => {
    // 40 pixels at each end of a plot about 60 wide leave no room.
    let error: unknown;
    try {
      build({ marks: [plain()], x: { padding: { px: 40 } } }, 100);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toMatchObject({ code: "layout-failed", path: "x.padding.px" });
    expect(String((error as Error).message)).toMatch(
      /^chart x\.padding\.px: 40 pixels at each end leave no room in a plot \d+ pixels long; increase the plot size or reduce padding$/,
    );
    // No padding at the limits of floating point changes nothing.
    for (const padding of [0, { px: 0 }])
      expect(() =>
        build({ marks: [plain()], x: { type: "log", domain: [1, Number.MAX_VALUE], padding } }),
      ).not.toThrow();
    // A domain padded past what numbers hold, which could not be read back:
    // a log domain, and linear ones by a share or by pixels.
    expect(() =>
      build({ marks: [plain()], x: { type: "log", domain: [1e-300, 1e300], padding: 0.1 } }),
    ).toThrow(
      /^chart x\.padding: padding the domain from 1e-300 to 1e\+300 reaches past what numbers hold; reduce the padding or narrow the domain$/,
    );
    for (const padding of [0.25, { px: 100 }])
      expect(() => build({ marks: [plain()], x: { domain: [0, 1.6e308], padding } })).toThrow(
        /reaches past what numbers hold/,
      );
    // Named where it is set: a scale's in `scales`, the chart's own scales' too.
    const at = (config: ChartConfig) => {
      try {
        build(config, 100);
      } catch (thrown) {
        return (thrown as { path?: string }).path;
      }
      return undefined;
    };
    expect(at({ marks: [plain()], scales: { x: { padding: { px: 40 } } } })).toBe(
      "scales.x.padding.px",
    );
    expect(
      at({
        scales: { depth: { type: "linear", padding: { px: 140 } } },
        marks: [plain(), line(rows, { x: "t", y: { field: "v", scale: "depth" } })],
      }),
    ).toBe("scales.depth.padding.px");
  });

  contractTest("scale.padding.category", () => {
    // Category axes place bands, with room of their own.
    const zones = table({ zone: ["a", "b"], v: [1, 2] });
    let error: unknown;
    try {
      build({ marks: [bar(zones, { x: "zone", y: "v" })], x: { padding: 0.1 } });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toMatchObject({ code: "invalid-option", path: "x.padding" });
  });

  contractTest("scale.padding.own", () => {
    // A scale of the chart's own pads as the axes do.
    const { scene, plot } = build({
      scales: { depth: { type: "linear", padding: { px: 15 }, nice: false } },
      marks: [plain(), line(rows, { x: "t", y: { field: "v", scale: "depth" } })],
    });
    const drawn = scene.panels[0]!.marks.filter((m) => m.kind === "line")[1] as LineGeometry;
    const ys = Array.from({ length: drawn.path.count }, (_, i) => drawn.path.coords[i * 2 + 1]!);
    // 1 and 10, the scale's ends, 15 pixels in from the plot's bottom and top.
    expect(Math.max(...ys)).toBeCloseTo(plot.y + plot.height - 15, 3);
    expect(Math.min(...ys)).toBeCloseTo(plot.y + 15, 3);
  });

  contractTest("scale.padding.transitions", () => {
    // A change of view starts from the ranges drawn, padded already: its
    // first frame draws them as they are, whatever padding is given.
    // Its ticks stay inside the padding.
    const ticks = (scene: ReturnType<ChartModel["scene"]>) =>
      scene.panels[0]!.axes.map((axis) => axis.ticks.map((t) => t.label).join(" "));
    for (const [x, y] of [
      [0.2, { px: 10 }],
      [{ px: 10 }, 0.2],
    ] as const) {
      const { model, scene } = build({ marks: [plain()], x: { padding: x }, y: { padding: y } });
      const drawn = { x: model.xScale()!.domain, y: model.yScale()!.domain };
      const { plans } = model.panels()[0]!;
      model.setTransitionDomains({
        x: drawn.x as [number, number],
        y: drawn.y as [number, number],
        yRight: null,
        ticks: { x: plans.x.within!, y: plans.y.within!, yRight: null },
      });
      const moving = model.scene(estimateText);
      expect(model.xScale()!.domain).toEqual(drawn.x);
      expect(model.yScale()!.domain).toEqual(drawn.y);
      expect(ticks(moving)).toEqual(ticks(scene));
    }
  });

  contractTest("scale.padding.navigator", () => {
    // A navigator's rail widened to hold a view past the data ends with
    // the range the plot shows, padded once.
    const { model } = build({
      marks: [plain()],
      x: { padding: 0.1 },
      navigator: rangeNavigator(),
    });
    setViewport(model, [5, 40]);
    const scene = model.scene(estimateText);
    const shown = model.xScale()!.domain;
    const strip = scene.panels.find(({ key }) => key === NAVIGATOR_PANEL)!;
    const frame = strip.marks.find(({ key }) => key === "navigator-frame") as ShapesGeometry;
    // Faded before the view, and not after it: the window reaches the rail's end.
    const faded = frame.shapes.filter((shape) => "d" in shape && shape.opacity < 1);
    expect(faded).toHaveLength(1);
    const ends = (faded[0] as { d: string }).d.match(/-?[\d.]+/g)!.map(Number);
    const { x: left, width } = strip.plot;
    // The rail fits the data, [0, 10], padded: [-1, 11]; the plot shows [1.5, 43.5].
    expect(shown[0]).toBeCloseTo(1.5, 9);
    expect(ends[2]).toBeCloseTo(left + (2.5 / 44.5) * width, 0);
  });
});
