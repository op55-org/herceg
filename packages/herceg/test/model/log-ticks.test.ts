// Log axes tick as d3 does: every digit of each decade where the domain
// spans fewer decades than the count, labelled where the leading digit fits
// the count, the other ticks blank with their tick marks and grid lines.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { guideCompiler } from "../../src/guides/compile.ts";
import { axis } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { line } from "../../src/marks/line.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { NAVIGATOR_PANEL, rangeNavigator } from "../../src/model/navigator.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type { AxisGuide, Scene, TextGeometry, TextItem } from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";
import { gridAt } from "../helpers/grid.ts";

const guides = guideCompiler(GUIDE_KIT);

function build(config: ChartConfig, width = 928, height = 600) {
  const model = new ChartModel({ locale: "en-US", timeZone: "UTC", ...config }, undefined, [
    guides,
  ]);
  model.setSize(width, height, 1);
  return { model, scene: model.scene(estimateText) };
}

const axisOf = (scene: Scene, side: AxisGuide["side"]) =>
  scene.panels[0]!.axes.find((a) => a.side === side)!;
/** The tick labels an axis writes, blank ones as "". */
const labels = (scene: Scene, side: AxisGuide["side"] = "left") =>
  axisOf(scene, side).ticks.map((t) => t.label);
/** The labels an axis draws, in order. */
const drawn = (scene: Scene, side: AxisGuide["side"] = "left") =>
  axisOf(scene, side)
    .items.filter((item): item is TextItem => item.type === "text")
    .map((t) => t.text);

// Study B1: values re-based to an index date, on the fixed domain [1/k, k].
const k = 6.54;
const ratios = table({ t: [0, 10], v: [1 / k, k] });
const b1 = (y: ChartConfig["y"] = {}): ChartConfig => ({
  marks: [line(ratios, { x: "t", y: "v" })],
  y: { type: "log", domain: [1 / k, k], nice: false, ...y },
});
const B1_TICKS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 2, 3, 4, 5, 6];

describe("log ticks", () => {
  contractTest(
    "axis.log-ticks.digits",
    () => {
      // d3's count of 10: 14 ticks, the leading digits up to 7 labelled.
      const { scene } = build(b1({ ticks: 10 }));
      const left = axisOf(scene, "left");
      expect(left.ticks.map((t) => t.value)).toEqual(B1_TICKS);
      expect(labels(scene)).toEqual([
        "0.2",
        "0.3",
        "0.4",
        "0.5",
        "0.6",
        "0.7",
        "",
        "",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
      ]);
      // Blank ticks keep their tick marks' places and grid lines; they draw no text.
      expect(gridAt(scene.panels[0]!, "y")).toHaveLength(14);
      expect(drawn(scene)).toEqual(labels(scene).filter((label) => label));
    },
    "tick every digit of a short span, labelling the leading digits that fit d3's count",
  );

  it("label by the axis' own count, else Herceg's by length", () => {
    // 564 px of plot ask for 13 ticks: every digit fits, all labelled.
    const tall = build(b1());
    expect(axisOf(tall.scene, "left").ticks.map((t) => t.value)).toEqual(B1_TICKS);
    expect(labels(tall.scene).every((label) => label)).toBe(true);
    // 264 px ask for 6: the same ticks, labels up to the digit 4.
    const short = build(b1(), 928, 300);
    expect(axisOf(short.scene, "left").ticks.map((t) => t.value)).toEqual(B1_TICKS);
    expect(labels(short.scene).filter((label) => label)).toEqual([
      "0.2",
      "0.3",
      "0.4",
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(labels(build(b1({ ticks: { count: 10 } })).scene)).toEqual(
      labels(build(b1({ ticks: 10 })).scene),
    );
  });

  it("tick powers of ten past the count, every digit below it", () => {
    const decades = table({ t: [0, 1], v: [1, 1e6] });
    const chart = (height: number) =>
      build({ marks: [line(decades, { x: "t", y: "v" })], y: { type: "log" } }, 600, height);
    // Six decades over 264 px (6 ticks): powers of ten, all labelled.
    expect(labels(chart(300).scene)).toEqual(["1", "10", "100", "1K", "10K", "100K", "1M"]);
    // Over 564 px (13 ticks): every digit, labelled at 1 and 2.
    const tall = labels(chart(600).scene);
    expect(tall).toHaveLength(55);
    expect(tall.filter((label) => label)).toEqual(
      "1 2 10 20 100 200 1K 2K 10K 20K 100K 200K 1M".split(" "),
    );
  });

  it("follow the same rule on reversed and sub-unit domains", () => {
    expect(labels(build(b1({ domain: [k, 1 / k], ticks: 10 })).scene)).toEqual(
      labels(build(b1({ ticks: 10 })).scene),
    );
    const small = table({ t: [0, 1], v: [0.001, 0.05] });
    const { scene } = build({
      marks: [line(small, { x: "t", y: "v" })],
      y: { type: "log", nice: false, ticks: 10 },
    });
    expect(labels(scene)).toEqual(
      "0.001 0.002 0.003 0.004 0.005 0.006 0.007 _ _ 0.01 0.02 0.03 0.04 0.05"
        .split(" ")
        .map((label) => (label === "_" ? "" : label)),
    );
  });

  it("label every tick given as values", () => {
    const { scene } = build(b1({ ticks: { values: [0.2, 0.5, 0.8, 0.9, 1, 2, 5] } }));
    expect(labels(scene)).toEqual(["0.2", "0.5", "0.8", "0.9", "1", "2", "5"]);
  });

  it("label every linear tick of a span too short for digits", () => {
    const narrow = table({ t: [0, 1], v: [7.6, 9] });
    const { scene } = build({
      marks: [line(narrow, { x: "t", y: "v" })],
      y: { type: "log", nice: false, ticks: 10 },
    });
    expect(labels(scene)).toEqual(
      "7.6 7.7 7.8 7.9 8.0 8.1 8.2 8.3 8.4 8.5 8.6 8.7 8.8 8.9 9.0".split(" "),
    );
  });
});

describe("log tick labels by format", () => {
  contractTest(
    "axis.log-ticks.format",
    () => {
      const calls: [number, number | undefined, number | undefined][] = [];
      const { scene } = build(
        b1({
          ticks: 10,
          format: (value, { index, values }) => {
            calls.push([value, index, values?.length]);
            return `${value}×`;
          },
        }),
      );
      expect(labels(scene).filter((label) => label)).toEqual(
        ["0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "1", "2", "3", "4", "5", "6"].map(
          (label) => `${label}×`,
        ),
      );
      // Called for labelled ticks alone, each told its place among all 14.
      expect(calls.map(([value]) => value)).not.toContain(0.8);
      expect(calls.find(([value]) => value === 1)).toEqual([1, 8, 14]);
    },
    "write only the labelled values with the axis' format",
  );

  it("write labelled values in Intl options and patterns alike", () => {
    const intl = build(b1({ ticks: 10, format: { minimumFractionDigits: 2 } }));
    expect(labels(intl.scene).slice(5, 10)).toEqual(["0.70", "", "", "1.00", "2.00"]);
    const pattern = build(b1({ ticks: 10, format: { number: ".1f" } }));
    expect(labels(pattern.scene).slice(5, 10)).toEqual(["0.7", "", "", "1.0", "2.0"]);
  });

  it("leave a label repeating the labelled one before it blank, past blank ticks", () => {
    // No decimals: 0.5 to 1 all read "1". Fewer labels tell the rest apart,
    // and the ticks and their grid lines stay.
    const { scene } = build(b1({ ticks: 10, format: { maximumFractionDigits: 0 } }));
    expect(axisOf(scene, "left").ticks.map((t) => t.value)).toEqual(B1_TICKS);
    expect(labels(scene).filter((label) => label)).toEqual(["0", "1", "2", "3", "4"]);
    const repeated = build(
      b1({ ticks: 10, format: (value) => (value < 0.6 ? "low" : value < 2 ? "mid" : "high") }),
    );
    expect(labels(repeated.scene).filter((label) => label)).toEqual(["low", "mid", "high"]);
  });
});

describe("blank log labels downstream", () => {
  it("thin overlapping labels by their order among labels, not ticks", () => {
    // Every other tick blank and wide labels on the rest: the first label
    // stays, every other label after it.
    const wide = table({ x: [1, 9], v: [0, 1] });
    const { scene } = build(
      {
        marks: [line(wide, { x: "x", y: "v" })],
        guides: [
          axis({
            scale: "x",
            ticks: { values: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
            format: (v) => (v % 2 ? "" : `a long label for ${v}`),
            labels: { overlap: "hide" },
          }),
        ],
      },
      400,
      300,
    );
    const shown = labels(scene, "bottom").filter((label) => label);
    expect(shown[0]).toBe("a long label for 2");
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(4);
  });

  it("wrap labels by the room to the labels either side, past blank ticks", () => {
    const span = table({ x: [1, 1000], v: [0, 1] });
    const wrap = (room?: number) =>
      build(
        {
          marks: [line(span, { x: "x", y: "v" })],
          x: { type: "log", nice: false, ticks: 8, ...(room && { room }) },
          guides: [
            axis({
              scale: "x",
              format: (v) => `value is ${v}`,
              labels: { overlap: "wrap" },
              ...(room && { room }),
            }),
          ],
        },
        928,
        300,
      );
    // 1, 2, 10, 20, 100, 200, 1,000 have room on one line; the ticks between are blank.
    for (const chart of [wrap(), wrap(24)])
      expect(labels(chart.scene, "bottom").filter((label) => label)).toEqual(
        [1, 2, 10, 20, 100, 200, 1000].map((v) => `value is ${v}`),
      );
  });

  it("leave out an end label that crosses the edge and keep the ticks blank around it", () => {
    const span = table({ x: [1, 1000], v: [0, 1] });
    const { scene } = build(
      {
        padding: 0,
        marks: [line(span, { x: "x", y: "v" })],
        x: { type: "log", nice: false, ticks: 8 },
        y: { show: false, grid: false },
        guides: [axis({ scale: "x", labels: { ends: "hide" } })],
      },
      600,
      300,
    );
    const shown = labels(scene, "bottom");
    // 1 and 1,000 stand on the chart's edges: left out; 2 to 200 stay.
    expect(shown.filter((label) => label)).toEqual(["2", "10", "20", "100", "200"]);
    expect(shown).toHaveLength(28);
  });

  it("keep no margin for a blank end tick's label box", () => {
    // Digits 1 to 9 at a count of 2: 1 and 2 labelled, the tick at 9 blank.
    const nine = table({ x: [1, 9], v: [0, 1] });
    const { scene } = build(
      {
        padding: 0,
        marks: [line(nine, { x: "x", y: "v" })],
        x: {
          type: "log",
          nice: false,
          ticks: 2,
          style: { tickLabel: { background: { fill: "#eeeeee" }, padding: 30 } },
        },
        y: { show: false, grid: false },
      },
      600,
      300,
    );
    expect(labels(scene, "bottom").filter((label) => label)).toEqual(["1", "2"]);
    const { plot } = scene.panels[0]!;
    expect(plot.x + plot.width).toBe(600);
  });

  it("write each repeated default label once among the labelled ticks", () => {
    // 24 decades below 30 ticks: digits; the smallest read alike at their decimals.
    const vast = table({ t: [0, 1], v: [1e-18, 1e6] });
    for (const listed of [false, true]) {
      const { scene } = build({
        marks: [line(vast, { x: "t", y: "v" })],
        y: { type: "log", nice: false, ticks: 30 },
        ...(listed && { guides: [axis({ scale: "y" })] }),
      });
      const shown = labels(scene).filter((label) => label);
      expect(new Set(shown).size).toBe(shown.length);
    }
  });

  it("draw the navigator's strip at the labelled ticks", () => {
    const data = table({
      x: Float64Array.from({ length: 100 }, (_, i) => 1 + i * 10),
      y: Float64Array.from({ length: 100 }, (_, i) => i),
    });
    const { scene } = build(
      {
        marks: [line(data, { x: "x", y: "y" })],
        x: { type: "log" },
        navigator: rangeNavigator(),
      },
      600,
      300,
    );
    const strip = scene.panels.find((p) => p.key === NAVIGATOR_PANEL)!;
    const text = strip.marks.find((mark) => mark.kind === "text") as TextGeometry;
    expect(text.labels).toEqual(["1", "2", "10", "20", "100", "200"]);
    expect(gridAt(strip, "x")).toHaveLength(6);
  });

  it("write no text for blank ticks in static SVG", () => {
    const svg = renderToSVG({ ...b1({ ticks: 10 }), width: 928, height: 600, locale: "en-US" });
    expect(svg).toMatch(/>0\.7<\/text>/);
    expect(svg).not.toMatch(/>0\.8<\/text>/);
    expect(svg).not.toMatch(/<text[^>]*><\/text>/);
  });
});
