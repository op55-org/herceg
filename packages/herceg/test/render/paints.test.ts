// Every color option a chart takes reads CSS variables as renderers read
// them: in output without a page, as their fallbacks, so no SVG attribute
// written by an export holds `var(`, and a variable without a fallback is
// refused naming the option.

import { describe, expect, it } from "vitest";
import { col } from "../../src/data/expr.ts";
import { fromGeoJSON } from "../../src/data/geojson.ts";
import { table } from "../../src/data/table.ts";
import { legend } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { inset, panel } from "../../src/layout.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { boxen } from "../../src/marks/boxen.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { candlestick } from "../../src/marks/candlestick.ts";
import { contour } from "../../src/marks/contour.ts";
import { custom } from "../../src/marks/custom.ts";
import { dendrogram } from "../../src/marks/dendrogram.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { funnel } from "../../src/marks/funnel.ts";
import { gauge } from "../../src/marks/gauge.ts";
import { geopoint } from "../../src/marks/geopoint.ts";
import { geoshape } from "../../src/marks/geoshape.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { line } from "../../src/marks/line.ts";
import { line3d } from "../../src/marks/line3d.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { region } from "../../src/marks/region.ts";
import { rug } from "../../src/marks/rug.ts";
import { rule } from "../../src/marks/rule.ts";
import { surface } from "../../src/marks/surface.ts";
import { text } from "../../src/marks/text.ts";
import { violin } from "../../src/marks/violin.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { rangeNavigator } from "../../src/model/navigator.ts";
import { panels } from "../../src/model/panels.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { NO_PAGE } from "../../src/render/fallbacks.ts";
import { renderToSVG } from "../../src/render/static.ts";
import { Readings } from "../../src/theme.ts";

/** A CSS variable whose fallback is a color of its own, `n` telling them apart. */
const paint = (n: number): `var(${string})` =>
  `var(--paint-${n}, #${(0x102030 + n * 0x010101).toString(16)})`;
const fallback = (n: number) => `#${(0x102030 + n * 0x010101).toString(16)}`;

/** The attributes of `svg` holding a CSS variable. */
const leaks = (svg: string) => [...svg.matchAll(/[\w:-]+="[^"]*var\([^"]*"/g)].map((m) => m[0]);

const samples = table({
  x: [0, 1, 2, 3, 4, 5],
  y: [2, 4, 3, 20, 40, 30],
  low: [1, 3, 2, 10, 30, 20],
  high: [3, 5, 4, 30, 50, 40],
  category: ["a", "b", "c", "a", "b", "c"],
  group: ["N", "N", "N", "S", "S", "S"],
});
const field = table({
  x: [0, 1, 2, 0, 1, 2, 0, 1, 2],
  y: [0, 0, 0, 1, 1, 1, 2, 2, 2],
  z: [0, 1, 0, 1, 3, 1, 0, 1, 0],
});
const world = fromGeoJSON({
  type: "FeatureCollection",
  features: [0, 20].map((x) => ({
    type: "Feature" as const,
    properties: { v: x },
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [x, 0],
          [x + 10, 0],
          [x + 10, 10],
          [x, 10],
          [x, 0],
        ],
      ],
    },
  })),
});
const places = table({ lon: [1, 25], lat: [2, 5], v: [1, 2] });
const linkage = table({ first: [0, 2, 4], second: [1, 3, 5], height: [1, 2, 3] });
const label = (n: number) => ({
  style: {
    color: paint(n),
    background: { fill: paint(n + 1), stroke: paint(n + 2) },
    halo: { color: paint(n + 3) },
  },
});

/** Each case: a chart, and the variables its colors hold, each with its fallback. */
const cases: [
  name: string,
  config: () => Omit<ChartConfig, "width" | "height">,
  paints: number[],
][] = [
  ["line stroke", () => ({ marks: [line(samples, { x: "x", y: "y", stroke: paint(1) })] }), [1]],
  ["line color", () => ({ marks: [line(samples, { x: "x", y: "y", color: paint(1) })] }), [1]],
  [
    "area fill and stroke",
    () => ({ marks: [area(samples, { x: "x", y: "y", fill: paint(1), stroke: paint(2) })] }),
    [1, 2],
  ],
  [
    "bar fill, stroke, and labels",
    () => ({
      marks: [
        bar(samples, {
          x: "category",
          y: "y",
          series: false,
          fill: paint(1),
          stroke: paint(2),
          labels: { style: { color: paint(3), background: { fill: paint(4), stroke: paint(5) } } },
          halo: { color: paint(6) },
        }),
      ],
    }),
    [1, 2, 3, 4, 5, 6],
  ],
  [
    "point fill and stroke",
    () => ({ marks: [point(samples, { x: "x", y: "y", fill: paint(1), stroke: paint(2) })] }),
    [1, 2],
  ],
  [
    "point ramp",
    () => ({
      marks: [point(samples, { x: "x", y: "y", color: "y", colors: [paint(1), paint(2)] })],
    }),
    [1, 2],
  ],
  ["histogram fill", () => ({ marks: [histogram(samples, { x: "y", fill: paint(1) })] }), [1]],
  [
    "boxplot fill",
    () => ({ marks: [boxplot(samples, { x: "category", y: "y", fill: paint(1) })] }),
    [1],
  ],
  [
    "boxen fill",
    () => ({ marks: [boxen(samples, { x: "category", y: "y", fill: paint(1) })] }),
    [1],
  ],
  [
    "violin fill",
    () => ({ marks: [violin(samples, { x: "group", y: "y", fill: paint(1) })] }),
    [1],
  ],
  ["rug stroke", () => ({ marks: [rug(samples, { x: "x", stroke: paint(1) })] }), [1]],
  [
    "errorbar stroke",
    () => ({ marks: [errorbar(samples, { x: "x", y1: "low", y2: "high", stroke: paint(1) })] }),
    [1],
  ],
  [
    "candlestick rise and fall",
    () => ({
      marks: [
        candlestick(samples, {
          x: "x",
          open: "low",
          high: "high",
          low: "low",
          close: "y",
          rise: paint(1),
          fall: paint(2),
        }),
      ],
    }),
    [1, 2],
  ],
  [
    "heatmap ramp",
    () => ({
      marks: [
        heatmap(samples, { x: "x", y: "category", color: "y", colors: [paint(1), paint(2)] }),
      ],
    }),
    [1, 2],
  ],
  [
    "2D histogram ramp",
    () => ({
      marks: [histogram(samples, { x: "x", y: "y", bins: 2, colors: [paint(1), paint(2)] })],
    }),
    [1, 2],
  ],
  [
    "contour ramp and stroke",
    () => ({
      marks: [
        contour(field, {
          x: "x",
          y: "y",
          color: "z",
          thresholds: [0.5, 2],
          colors: [paint(1), paint(2)],
        }),
        contour(field, { x: "x", y: "y", color: "z", thresholds: [0.5, 2], stroke: paint(3) }),
      ],
    }),
    [1, 2, 3],
  ],
  [
    "rule stroke and label",
    () => ({
      marks: [
        line(samples, { x: "x", y: "y" }),
        rule({ y: 10, stroke: paint(1), label: { text: "Target", ...label(2) } }),
      ],
    }),
    [1, 2, 3, 4, 5],
  ],
  [
    "region fill and label",
    () => ({
      marks: [
        line(samples, { x: "x", y: "y" }),
        region({ x1: 1, x2: 2, fill: paint(1), label: { text: "Window", ...label(2) } }),
      ],
    }),
    [1, 2, 3, 4, 5],
  ],
  [
    "text label",
    () => ({
      marks: [
        line(samples, { x: "x", y: "y" }),
        text({ x: 2, y: 10, label: { text: "Note", ...label(1) } }),
      ],
    }),
    [1, 2, 3, 4],
  ],
  [
    "custom shapes",
    () => ({
      marks: [
        custom(samples, {
          x: "x",
          y: "y",
          draw({ series, x, y, circle }) {
            for (const s of series)
              for (let i = 0; i < s.length; i++)
                circle(x(s.x[i]!), y(s.y[i]!), 3, { fill: paint(1), stroke: paint(2) });
          },
        }),
      ],
    }),
    [1, 2],
  ],
  [
    "dendrogram stroke",
    () => ({
      marks: [
        dendrogram(linkage, {
          first: "first",
          second: "second",
          height: "height",
          leaves: ["a", "b", "c", "d"],
          stroke: paint(1),
        }),
      ],
    }),
    [1],
  ],
  [
    "gauge bands",
    () => ({
      marks: [
        gauge(samples, {
          value: "y",
          max: 50,
          bands: [
            { to: 20, color: paint(1) },
            { to: 50, color: paint(2) },
          ],
        }),
      ],
    }),
    [1, 2],
  ],
  ["funnel", () => ({ marks: [funnel(samples, { category: "category", value: "y" })] }), []],
  [
    "map shapes and points",
    () => ({
      marks: [
        geoshape(world, { fill: paint(1), stroke: paint(2) }),
        geopoint(places, { longitude: "lon", latitude: "lat", fill: paint(3), stroke: paint(4) }),
      ],
    }),
    [1, 2, 3, 4],
  ],
  [
    "map ramps",
    () => ({
      marks: [
        geoshape(world, { color: "v", colors: [paint(1), paint(2)] }),
        geopoint(places, {
          longitude: "lon",
          latitude: "lat",
          color: "v",
          colors: [paint(3), paint(4)],
        }),
      ],
    }),
    [1, 2, 3, 4],
  ],
  [
    "3D points and lines",
    () => ({
      marks: [
        point3d(field, { x: "x", y: "y", z: "z", fill: paint(1) }),
        line3d(field, { x: "x", y: "y", z: "z", stroke: paint(2) }),
      ],
    }),
    [1, 2],
  ],
  [
    "surface ramp",
    () => ({ marks: [surface(field, { x: "x", y: "y", z: "z", colors: [paint(1), paint(2)] })] }),
    [1, 2],
  ],
  [
    "ordinal scale map and unknown",
    () => ({
      scales: {
        color: { type: "ordinal", domain: ["N"], map: { N: paint(1) }, unknown: paint(2) },
      },
      marks: [line(samples, { x: "x", y: "y", color: "group" })],
    }),
    [1, 2],
  ],
  [
    "channels: values and conditions",
    () => ({
      marks: [
        line(samples, { x: "x", y: "y", series: "group", encode: { stroke: { value: paint(1) } } }),
        bar(samples, {
          x: "x",
          y: "low",
          series: false,
          encode: {
            fill: {
              condition: {
                when: col("y").gt(10),
                // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
                then: paint(2),
                otherwise: paint(3),
              },
            },
          },
        }),
      ],
    }),
    [1, 2, 3],
  ],
  [
    "looks by value and markers",
    () => ({
      marks: [
        line(samples, {
          x: "x",
          y: "y",
          series: "group",
          markers: "circle",
          style: {
            by: { map: { N: { stroke: paint(1) } } },
            marker: { fill: paint(2), stroke: paint(3) },
          },
        }),
      ],
    }),
    [1, 2, 3],
  ],
  [
    "legend swatches of marks' looks",
    () => ({
      guides: [legend({ swatches: "mark" })],
      marks: [
        line(samples, { x: "x", y: "y", stroke: paint(1) }),
        bar(samples, { x: "x", y: "low", series: false, fill: paint(3), stroke: paint(4) }),
      ],
    }),
    [1, 3, 4],
  ],
  [
    "inset indicators",
    () => ({
      marks: [
        line(samples, { x: "x", y: "y", panel: "main" }),
        line(samples, { x: "x", y: "y", panel: "zoom" }),
      ],
      panels: panels(
        panel({ id: "main" }, [
          inset(
            { id: "zoom", x: { domain: [1, 3] } },
            { indicator: { style: { stroke: paint(1) } } },
          ),
        ]),
      ),
    }),
    [1],
  ],
];

/** The halo color of the text drawn `label` in `svg`. */
const haloOf = (svg: string, label: string) =>
  new RegExp(`stroke="(#[0-9a-f]{6})"[^>]*>(?:<text[^>]*>)?${label}<`).exec(svg)?.[1];

describe("CSS variables in color options", () => {
  it.each(cases)("%s: export their fallbacks", (_name, config, paints) => {
    const svg = renderToSVG({ width: 400, height: 300, ...config() } as never);
    expect(leaks(svg)).toEqual([]);
    for (const n of paints) expect(svg.toLowerCase()).toContain(fallback(n));
  });

  it("refuse a variable without a fallback, naming the option", () => {
    expect(() =>
      renderToSVG({
        width: 400,
        height: 300,
        marks: [line(samples, { x: "x", y: "y", stroke: "var(--brand)" })],
      }),
    ).toThrow(
      "line stroke is the CSS variable var(--brand), which only a chart in a page can read; give a fallback, as var(--name, #2a78d6)",
    );
  });

  it("draw their fallbacks in PDF", () => {
    const options = {
      width: 400,
      height: 300,
      marks: [
        line(samples, { x: "x", y: "y", stroke: paint(1) }),
        rule({ y: 10, stroke: paint(2) }),
      ],
    };
    expect(() => renderToPDF(options)).not.toThrow();
  });

  it("read fallbacks in any CSS syntax as hex, which ramps take", () => {
    const svg = renderToSVG({
      width: 300,
      height: 200,
      marks: [
        heatmap(field, {
          x: "x",
          y: "y",
          color: "z",
          colors: ["var(--low, rgb(255, 0, 0))", "#ffffff"],
        }),
      ],
    });
    expect(svg).toContain("#ff0000");
  });

  it("give tooltips a heatmap's color as its cells read it", () => {
    const model = new ChartModel(
      {
        marks: [heatmap(field, { x: "x", y: "y", color: "z", colors: [paint(1), paint(2)] })],
      },
      NO_PAGE,
      ...staticCompilers(),
    );
    model.setSize(300, 200, 1);
    model.scene(estimateText, false, NO_PAGE);
    const plot = model.panels()[0]!.plot;
    const color = model.inspect(plot.x + plot.width / 2, plot.y + plot.height / 2)?.points[0]
      ?.color;
    expect(color).toBe(fallback(2));
  });

  it("keep what reads the page across many other colors, to read it again", () => {
    const readings = new Readings();
    const page = (brand: string) => ({
      color: (value: string) => (value === "var(--brand)" ? brand : value),
    });
    readings.in(page("#ff0000"), () => {
      readings.color("var(--brand)", "line stroke");
      for (let i = 0; i < 1100; i++) readings.color(`rgb(${i % 256}, 0, ${i >> 8})`, "custom fill");
    });
    expect(readings.again(page("#ff0000"))).toBe(readings);
    const again = readings.again(page("#00ff00"));
    expect(again).not.toBe(readings);
    expect(again.color("var(--brand)", "line stroke")).toBe("#00ff00");
  });

  it("halo text on what is under a transparent plot, and boxed text on its box", () => {
    const svg = renderToSVG({
      width: 400,
      height: 300,
      theme: { tokens: { background: "#fafafa" }, style: { plot: { fill: "transparent" } } },
      marks: [
        line(samples, { x: "x", y: "y" }),
        text({ x: 1, y: 10, label: "open" }),
        text({ x: 3, y: 20, label: { text: "boxed", style: { background: { fill: "#ffcc00" } } } }),
      ],
    });
    expect(haloOf(svg, "open")).toBe("#fafafa");
    expect(haloOf(svg, "boxed")).toBe("#ffcc00");
  });

  it("halo the legend inside a layout mark's plot on the plot", () => {
    const svg = renderToSVG({
      width: 400,
      height: 300,
      theme: { style: { plot: { fill: "#abcdef" }, legendLabel: { halo: "auto" } } },
      legend: { place: { inside: "top-right" } },
      marks: [pie(samples, { category: "category", value: "y" })],
    });
    expect(haloOf(svg, "a")).toBe("#abcdef");
  });

  it("halo a navigator's labels on the chart, not on its plot", () => {
    const svg = renderToSVG({
      width: 400,
      height: 300,
      theme: { style: { plot: { fill: "#abcdef" } } },
      navigator: rangeNavigator({ height: 60 }),
      marks: [line(samples, { x: "x", y: "y" })],
    });
    const labels = /<g fill="#[0-9a-f]{6}" text-anchor="start" stroke="(#[0-9a-f]{6})"/.exec(svg);
    expect(labels?.[1]).toBe("#ffffff");
  });

  it("leave text that names a variable alone", () => {
    const svg = renderToSVG({
      width: 400,
      height: 300,
      marks: [
        line(samples, { x: "x", y: "y" }),
        text({ x: 2, y: 10, label: "var(--not-a-color)" }),
      ],
    });
    expect(svg).toContain(">var(--not-a-color)</text>");
  });
});
