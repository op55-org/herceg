// "\n" breaks every drawn label into lines, measured and placed as a block
// and drawn a line at a time, so a line break never reaches a font.

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { prepareFonts } from "../../src/fonts.ts";
import { axis, colorbar, legend } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { custom } from "../../src/marks/custom.ts";
import { funnel } from "../../src/marks/funnel.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { sunburst } from "../../src/marks/sunburst.ts";
import { text } from "../../src/marks/text.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { facet } from "../../src/model/facet.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { NO_PAGE } from "../../src/render/fallbacks.ts";
import { renderToSVG } from "../../src/render/static.ts";

const samples = table({ x: [0, 1, 2, 3], y: [10, 20, 30, 40], k: ["a", "b", "c", "d"] });
const sans = new Uint8Array(
  readFileSync(new URL("../fixtures/pdf-fonts/sans.ttf", import.meta.url)),
);

/** Each line of `svg`'s text elements holding lines: its text and position. */
const lines = (svg: string) =>
  [...svg.matchAll(/<tspan x="([\d.-]+)" y="([\d.-]+)"[^>]*>([^<]*)<\/tspan>/g)].map(
    ([, x, y, line]) => ({ line, x: Number(x), y: Number(y) }),
  );

/** The plot of a chart's first panel. */
const plotOf = (config: Omit<ChartConfig, "width" | "height">) => {
  const model = new ChartModel(config as ChartConfig, NO_PAGE, ...staticCompilers());
  model.setSize(400, 300, 1);
  return model.scene(estimateText, false, NO_PAGE).panels[0]!.plot;
};

describe("labels of several lines", () => {
  it("draw each line a line height below the last, in every label", () => {
    const svg = renderToSVG({
      width: 400,
      height: 300,
      title: "Weekly\nby host",
      y: { title: "Latency\n(ms)" },
      marks: [
        line(samples, { x: "x", y: "y" }),
        rule({ y: 25, label: "Target\n25" }),
        region({ x1: 1, x2: 2, label: "Freeze\nwindow" }),
        text({ x: 2, y: 15, label: "two\nlines" }),
      ],
    });
    const drawn = lines(svg);
    // The title's 15px text has lines 19 pixels apart; 12px text, 15.
    for (const [first, second, apart] of [
      ["Weekly", "by host", 19],
      ["Latency", "(ms)", 15],
      ["Target", "25", 15],
      ["Freeze", "window", 15],
      ["two", "lines", 15],
    ] as const) {
      const a = drawn.find(({ line }) => line === first)!;
      const b = drawn.find(({ line }) => line === second)!;
      expect(b.y - a.y, first).toBe(apart);
      expect(b.x, first).toBe(a.x);
    }
    expect(svg.replace(/<(title|desc)[^<]*<\/(title|desc)>/g, "")).not.toContain("\n");
  });

  it("place blocks away from what they are beside, and centered where centered", () => {
    const svg = renderToSVG({
      width: 400,
      height: 300,
      marks: [
        line(samples, { x: "x", y: "y" }),
        rule({ y: 25, label: "up\nabove" }),
        text({ x: 2, y: 15, label: "mid\ndle" }),
      ],
    });
    const at = (line: string) => lines(svg).find((l) => l.line === line)!;
    const one = renderToSVG({
      width: 400,
      height: 300,
      marks: [
        line(samples, { x: "x", y: "y" }),
        rule({ y: 25, label: { text: "above", style: { fontSize: 12 } } }),
        text({ x: 2, y: 15, label: "single" }),
      ],
    });
    const single = (label: string) =>
      Number(new RegExp(`y="([\\d.]+)"[^>]*>${label}<`).exec(one)![1]);
    // A rule's label grows up from the rule: its last line where one line would be.
    expect(at("above").y).toBeCloseTo(single("above"), 0);
    // A text mark's lines are centered on its point.
    expect((at("mid").y + at("dle").y) / 2).toBeCloseTo(single("single"), 5);
  });

  it("keep room for titles, legend entries, and category labels of several lines", () => {
    const base = { marks: [line(samples, { x: "x", y: "y" })] };
    expect(plotOf({ ...base, x: { title: "a\nb" } }).height).toBe(
      plotOf({ ...base, x: { title: "a" } }).height - 15,
    );
    const categories = (k: string[]) => ({
      marks: [bar(table({ k, v: [1, 2] }), { x: "k", y: "v" })],
    });
    expect(plotOf(categories(["North\nregion", "South"])).height).toBe(
      plotOf(categories(["North", "South"])).height - 15,
    );
    // Labels beside an axis are centered on their tick.
    const svg = renderToSVG({
      width: 400,
      height: 300,
      marks: [bar(table({ k: ["North\nregion", "South"], v: [1, 2] }), { y: "k", x: "v" })],
    });
    const drawn = lines(svg);
    const tick = Number(/<text x="[\d.]+" y="([\d.]+)"[^>]*>South</.exec(svg)![1]);
    const [north, region] = [drawn[0]!, drawn[1]!];
    expect(north.line).toBe("North");
    expect(region.y - north.y).toBe(15);
    expect(tick).toBeGreaterThan(region.y);
    const legendOf = (labels: string[]) =>
      plotOf({
        legend: { place: { side: "top" } },
        marks: [line(table({ x: [0, 1], y: [1, 2], s: labels }), { x: "x", y: "y", series: "s" })],
      });
    expect(legendOf(["a\nb", "c"]).y).toBe(legendOf(["a", "c"]).y + 15);
  });

  it("draw axes' titles of several lines inside the room they keep, with tick layers too", () => {
    for (const guides of [[], [axis({ scale: "x", layers: [{ id: "minor", ticks: 3 }] })]]) {
      const svg = renderToSVG({
        width: 400,
        height: 300,
        x: { title: "Time\n(UTC)" },
        guides,
        marks: [line(samples, { x: "x", y: "y" })],
      });
      const second = lines(svg).find(({ line }) => line === "(UTC)")!;
      expect(second.y, JSON.stringify(guides)).toBeLessThanOrEqual(300 - 4);
      expect(second.y - lines(svg).find(({ line }) => line === "Time")!.y).toBe(15);
    }
  });

  it("keep room for facet headers of several lines, wrapped or in a grid", () => {
    const facets = (site: string, by: string | { column: string } | { row: string }) => {
      const data = table({ x: [0, 1, 0, 1], y: [1, 2, 3, 4], k: [site, site, "B", "B"] });
      const split = typeof by === "string" ? facet(by) : facet(by);
      return plotOf({ facet: split, marks: [line(data, { x: "x", y: "y" })] });
    };
    expect(facets("A\nB\nC", "k").y).toBe(facets("A", "k").y + 30);
    expect(facets("A\nB\nC", { column: "k" }).y).toBe(facets("A", { column: "k" }).y + 30);
    expect(facets("A\nB\nC", { row: "k" }).width).toBe(facets("A", { row: "k" }).width - 30);
  });

  it("keep room for listed legends' entries and titles and colorbars' titles", () => {
    const field = table({ x: [0, 1, 0, 1], y: [0, 0, 1, 1], z: [1, 2, 3, 4] });
    const heat = (title: string) =>
      plotOf({
        guides: [colorbar({ place: { side: "top" }, title })],
        marks: [heatmap(field, { x: "x", y: "y", color: "z" })],
      });
    expect(heat("z\nunits").y).toBe(heat("z").y + 15);
    const listed = (title: string, labels: string[]) =>
      plotOf({
        guides: [legend({ place: { side: "top" }, title })],
        marks: [line(table({ x: [0, 1], y: [1, 2], s: labels }), { x: "x", y: "y", series: "s" })],
      });
    expect(listed("Hosts\nall", ["a", "c"]).y).toBe(listed("Hosts", ["a", "c"]).y + 15);
    expect(listed("Hosts", ["a\nb", "c"]).y).toBe(listed("Hosts", ["a", "c"]).y + 15);
    // Keys of symbols and color ramps in the automatic legend.
    const shapes = (kind: string) =>
      plotOf({
        marks: [
          point(table({ x: [0, 1], y: [1, 2], kind: [kind, "d"] }), {
            x: "x",
            y: "y",
            symbol: "kind",
          }),
        ],
      });
    expect(shapes("a\nb\nc").y).toBe(shapes("a").y + 30);
    const ramp = (label: string) =>
      plotOf({ marks: [heatmap(field, { x: "x", y: "y", color: "z", label })] });
    expect(ramp("z\nunits").y).toBe(ramp("z").y + 15);
  });

  it("write the names layouts fit to their room on one line, shortened rather than broken", () => {
    const regions = table({ region: ["North\nregion", "South"], v: [3, 1] });
    for (const mark of [
      pie(regions, { category: "region", value: "v" }),
      treemap(regions, { path: ["region"], value: "v" }),
      sunburst(regions, { path: ["region"], value: "v" }),
      funnel(regions, { category: "region", value: "v" }),
    ]) {
      const svg = renderToSVG({ width: 600, height: 400, legend: false, marks: [mark] });
      // "North region", or as much of it as fits.
      expect(svg, mark.spec.type).toMatch(/>(North region|Nort[^<\n]*…)</);
      expect(lines(svg), mark.spec.type).toEqual([]);
    }
    // The room a funnel keeps for names is that of the line they are written on.
    const funnelOf = (name: string) =>
      renderToSVG({
        width: 600,
        height: 400,
        marks: [funnel(table({ s: [name, "South"], v: [3, 1] }), { category: "s", value: "v" })],
      });
    expect(funnelOf("North\nregion")).toContain(">North region<");
  });

  it("draw in PDF with supplied fonts, a line at a time", () => {
    const fonts = prepareFonts([{ family: "Fixture", data: sans }]);
    const options = {
      width: 400,
      height: 300,
      fonts,
      theme: { style: { text: { font: "Fixture" } } },
      marks: [
        line(samples, { x: "x", y: "y" }),
        rule({
          y: 25,
          label: { text: "Target\n25", place: { attachment: "start" as const, outside: true } },
        }),
        custom({ draw: (c) => c.text(60, 20, "two\nlines") }),
      ],
    };
    const svg = renderToSVG(options);
    expect(svg).toContain(">Target</tspan>");
    expect(svg).toContain(">lines</tspan>");
    const pdf = renderToPDF(options);
    // Each line is a run of its own: no run holds a line break.
    const streams = [
      ...Buffer.from(pdf)
        .toString("latin1")
        .matchAll(/stream\r?\n([\s\S]*?)endstream/g),
    ]
      .map(([, body]) => {
        try {
          return inflateSync(Buffer.from(body!, "latin1")).toString("latin1");
        } catch {
          return body!;
        }
      })
      .join("");
    expect((streams.match(/ Tj ET/g) ?? []).length).toBeGreaterThan(4);
    // So with the export's own fallback and replacement, which measure as it draws.
    const categories = {
      ...options,
      legend: { title: "Sites\nall" },
      marks: [bar(table({ k: ["North\nregion", "South"], v: [1, 2] }), { x: "k", y: "v" })],
    };
    for (const settings of [{ fallback: ["Fixture"] }, { missingGlyph: "?" }])
      expect(
        renderToPDF(categories, settings).byteLength,
        JSON.stringify(settings),
      ).toBeGreaterThan(0);
  });
});

describe("number labels on the automatic axes", () => {
  it("keep room for the one line they are written on", () => {
    const svg = renderToSVG({
      width: 500,
      height: 300,
      y: { format: (v: number) => `${v}MMMMMMMM\nMMMMMMMM` },
      marks: [line(samples, { x: "x", y: "y" })],
    });
    const starts = [
      ...svg.matchAll(/<text x="([\d.-]+)"[^>]*text-anchor="end"[^>]*>[^<]*MMMMMMMM MMMMMMMM/g),
    ];
    expect(starts.length).toBeGreaterThan(0);
    // Drawn from the label's end at its tick, the whole line fits in the chart.
    for (const [, x] of starts)
      expect(
        Number(x) - estimateText("40MMMMMMMM MMMMMMMM", "12px sans-serif"),
      ).toBeGreaterThanOrEqual(0);
  });
});
