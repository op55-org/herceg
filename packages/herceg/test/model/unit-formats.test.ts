// Durations, SI and binary prefixes, and text around number patterns on
// every option that takes a format: axes' ticks and tooltip values, listed
// axes' layers, colorbars, label parts, bar, rule, and text labels,
// tooltip fields, and gauges.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { fieldReader } from "../../src/dom/tooltip-content.ts";
import { axis, colorbar } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { gauge } from "../../src/marks/gauge.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { needsGuides } from "../../src/model/guides.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderSvg } from "../../src/render/svg.ts";
import { type AxisGuide, guidesOf, type Scene, type TextItem } from "../../src/scene/scene.ts";

function build(config: ChartConfig, width = 640, height = 320) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    ...staticCompilers(),
  );
  model.fields = fieldReader;
  model.setSize(width, height, 1);
  return { model, scene: model.scene(estimateText) };
}

const usage = table({
  t: [0, 1, 2, 3],
  bytes: [0, 1_000_000, 2_000_000, 3_000_000],
  ms: [450, 66_000, 95_000, 120_000],
});
const labels = (scene: Scene, side: AxisGuide["side"] = "left") =>
  scene.panels[0]!.axes.find((one) => one.side === side)!.ticks.map((tick) => tick.label);
/** The text a scene draws, as its SVG writes it. */
const drawn = (scene: Scene) => renderSvg(scene).replaceAll("&#181;", "µ");

describe("formats of every form", () => {
  it("load the guide compiler, which writes them", () => {
    for (const format of [{ duration: "second" }, { si: "B" }, { binary: "B" }] as const)
      expect(needsGuides({ y: { format }, marks: [] })).toBe(true);
    expect(needsGuides({ y: { format: { maximumFractionDigits: 1 } }, marks: [] })).toBe(false);
  });

  it("write axes' ticks, telling neighbors apart, and tooltip values", () => {
    const bytes = build({
      y: { format: { si: "B" } },
      marks: [line(usage, { x: "t", y: "bytes" })],
    });
    expect(labels(bytes.scene)).toEqual([
      "0 B",
      "500 kB",
      "1.0 MB",
      "1.5 MB",
      "2.0 MB",
      "2.5 MB",
      "3.0 MB",
    ]);
    const times = build({
      y: { format: { binary: "B" }, tooltipFormat: { duration: "millisecond" } },
      marks: [line(usage, { x: "t", y: "ms" })],
    });
    expect(labels(times.scene)[1]).toMatch(/KiB$/);
    const plot = times.scene.panels[0]!.plot;
    const near = times.model.inspect(
      plot.x + plot.width / 3,
      plot.y + plot.height / 2,
      "nearest-x",
    )!;
    expect(near.points[0]!.text).toBe("1m 6s");
  });

  it("write durations on axes in their largest units", () => {
    const { scene } = build({
      y: { format: { duration: "millisecond" } },
      marks: [line(usage, { x: "t", y: "ms" })],
    });
    expect(labels(scene)).toEqual(["0ms", "20s", "40s", "1m", "1m 20s", "1m 40s", "2m"]);
  });

  it("refuse number forms on time axes, naming where", () => {
    const at = table({ t: [Date.UTC(2026, 0, 1)], v: [1] }, {});
    const refused = () =>
      build({
        x: { type: "time", format: { duration: "second" } },
        marks: [line(at, { x: "t", y: "v" })],
      });
    expect(refused).toThrow(
      'chart x.format.duration: a time axis writes times; give { time: "%b %d" } or Intl date options',
    );
  });

  it("write listed axes' layers and colorbars", () => {
    const { scene } = build({
      marks: [line(usage, { x: "t", y: "bytes" })],
      guides: [axis({ scale: "y", format: { si: "B", decimals: 1 }, ticks: 3 })],
    });
    expect(labels(scene).every((label) => /^\d\.\d (k|M)?B$/.test(label))).toBe(true);
    const cells = table({ x: [0, 1, 0, 1], y: [0, 0, 1, 1], w: [500, 1500, 2500, 3500] });
    const heat = build({
      marks: [heatmap(cells, { x: "x", y: "y", color: "w" })],
      guides: [colorbar({ format: { si: "W" }, ticks: 3 })],
    });
    const texts = guidesOf(heat.scene, "colorbar")[0]!.items.filter(
      (item): item is TextItem => item.type === "text",
    );
    expect(texts.map((item) => item.text)).toEqual(["1 kW", "2 kW", "3 kW"]);
  });

  it("write label parts, bar labels, rule labels, and text marks", () => {
    const { scene } = build({
      marks: [
        bar(usage, { x: "t", y: "bytes", labels: { format: { si: "B" } } }),
        rule({
          y: 2_500_000,
          label: { content: ["quota ", { value: true, format: { binary: "B" } }] },
        }),
        text(usage, {
          x: "t",
          y: "bytes",
          label: { field: "ms", format: { duration: "millisecond" } },
        }),
        line(usage, {
          x: "t",
          y: "bytes",
          labels: {
            at: "last",
            content: [{ value: true, format: { number: ".2~s", suffix: "B/s" } }],
          },
        }),
      ],
    });
    const svg = drawn(scene);
    expect(svg).toContain(">2 MB<");
    expect(svg).toContain("quota 2.4 MiB");
    expect(svg).toContain(">1m 6s<");
    expect(svg).toContain(">3MB/s<");
  });

  it("write tooltip fields and gauges", () => {
    const { model, scene } = build({
      marks: [
        line(usage, {
          x: "t",
          y: "bytes",
          tooltip: {
            fields: [{ field: "ms", label: "Latency", format: { duration: "millisecond" } }],
          },
        }),
      ],
    });
    const plot = scene.panels[0]!.plot;
    const near = model.inspect(plot.x + plot.width / 3, plot.y + plot.height / 2, "nearest-x")!;
    expect(near.points[0]!.fields).toEqual([
      { field: "ms", label: "Latency", kind: "number", value: 66_000, text: "1m 6s" },
    ]);
    const dial = build({
      marks: [gauge(usage, { value: "ms", max: 180_000, format: { duration: "millisecond" } })],
    });
    const svg = drawn(dial.scene);
    expect(svg).toContain("2m");
    expect(svg).toContain("0ms");
    expect(svg).toContain("3m");
  });
});
