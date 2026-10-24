// Style runs as browsers paint them, on a canvas and as SVG: each edge in
// the look of the observation it arrives at, where observations share a
// position too, and the join where two runs meet painted once.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { col } from "../../src/data/expr.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { selectionStore, selectRows } from "../../src/data/selection.ts";
import { type Schema, type Table, table } from "../../src/data/table.ts";
import { type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { line } from "../../src/marks/line.ts";
import { DIM } from "../../src/marks/mark.ts";
import { facet } from "../../src/model/facet.ts";
import { Highlighter } from "../../src/model/highlight.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { paintCanvas } from "../../src/render/canvas.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderToSVG } from "../../src/render/static.ts";
import { renderSvg } from "../../src/render/svg.ts";
import { timeBreaks } from "../../src/scale/breaks.ts";
import { contractTest } from "../helpers/contracts.ts";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:400px;height:300px";
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

/** A chart of nothing but its marks, on nothing, along fixed domains. */
const bare = (marks: ChartOptions["marks"]): ChartOptions => ({
  theme: { tokens: { background: "transparent" } },
  legend: false,
  x: { domain: [0, 10], show: false, grid: false, nice: false },
  y: { domain: [0, 10], show: false, grid: false, nice: false },
  marks,
});

/**
 * What a chart of `options` paints, on a canvas and as SVG rasterized: a
 * reader of its pixels at chart values (x, y), `dx` and `dy` pixels off.
 */
async function rasters(options: ChartOptions) {
  const chart = createChart(host, { ...options, renderer: "canvas" });
  await chart.loading;
  const canvas = host.querySelector("canvas")!;
  const ratio = canvas.width / host.clientWidth;
  // Domains are fixed, [0, 10] each: pixels from the ends', read while the chart lives.
  const [x0, x1] = [chart.toPixel(0, { axis: "x" })!, chart.toPixel(10, { axis: "x" })!];
  const [y0, y1] = [chart.toPixel(0, { axis: "y" })!, chart.toPixel(10, { axis: "y" })!];
  const at = (x: number, y: number) => [x0 + ((x1 - x0) * x) / 10, y0 + ((y1 - y0) * y) / 10];
  const svg = renderToSVG({ ...options, width: host.clientWidth, height: host.clientHeight });
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const drawn = document.createElement("canvas");
  [drawn.width, drawn.height] = [canvas.width, canvas.height];
  drawn.getContext("2d")!.drawImage(image, 0, 0, drawn.width, drawn.height);
  const reader =
    (target: HTMLCanvasElement) =>
    (x: number, y: number, dx = 0, dy = 0): number[] => {
      const [px, py] = at(x, y) as [number, number];
      return Array.from(
        target
          .getContext("2d")!
          .getImageData(Math.round((px + dx) * ratio), Math.round((py + dy) * ratio), 1, 1).data,
      );
    };
  const read = { canvas: reader(canvas), svg: reader(drawn) };
  chart.destroy();
  return read;
}

const near = (actual: readonly number[], expected: readonly number[]) =>
  actual.every((value, i) => Math.abs(value - expected[i]!) <= 3);

const painted = { color: { field: "paint" as const, scale: { type: "identity" as const } } };

describe("style runs", () => {
  contractTest(
    "line.style-runs.repeated-positions.raster",
    async () => {
      const two = await rasters(
        bare([
          line(
            table({
              t: [0, 5, 5, 10],
              v: [2, 2, 8, 8],
              paint: ["#ff0000", "#ff0000", "#0000ff", "#0000ff"],
            }),
            { x: "t", y: "v", strokeWidth: 8, encode: painted },
          ),
        ]),
      );
      const three = await rasters(
        bare([
          line(
            table({
              t: [0, 5, 5, 5, 10],
              v: [2, 2, 5, 8, 8],
              paint: ["#ff0000", "#ff0000", "#0000ff", "#00ff00", "#00ff00"],
            }),
            { x: "t", y: "v", strokeWidth: 8, encode: painted },
          ),
        ]),
      );
      for (const read of [two.canvas, two.svg]) {
        // The flat run into t = 5 is red; the edge up at t = 5 arrives at blue.
        expect(read(2.5, 2)).toEqual([255, 0, 0, 255]);
        expect(read(5, 5)).toEqual([0, 0, 255, 255]);
        expect(read(5, 7)).toEqual([0, 0, 255, 255]);
      }
      for (const read of [three.canvas, three.svg]) {
        // Two edges up at t = 5, each its arriving observation's.
        expect(read(5, 3.5)).toEqual([0, 0, 255, 255]);
        expect(read(5, 6.5)).toEqual([0, 255, 0, 255]);
        expect(read(7.5, 8)).toEqual([0, 255, 0, 255]);
      }
    },
    "edges between observations sharing a position take their arriving looks, painted",
  );

  it("paint a run turning back over the run before it, and keep a line's own start", async () => {
    const read = await rasters(
      bare([
        line(table({ t: [5, 5, 5], v: [2, 8, 2], paint: ["#ff0000", "#ff0000", "#0000ff"] }), {
          x: "t",
          y: "v",
          strokeWidth: 20,
          encode: painted,
        }),
        line(table({ t: [2, 8], v: [9, 9], paint: ["#ff0000", "#0000ff"] }), {
          x: "t",
          y: "v",
          strokeWidth: 20,
          encode: painted,
        }),
      ]),
    );
    for (const pixel of [read.canvas, read.svg]) {
      // The way back is blue from its turn on, painted over the red way up.
      expect(pixel(5, 8, 0, 4)).toEqual([0, 0, 255, 255]);
      expect(pixel(5, 8, 0, 30)).toEqual([0, 0, 255, 255]);
      // The blue line's round start, behind its first observation.
      expect(pixel(2, 9, -6, 0)).toEqual([0, 0, 255, 255]);
    }
    // Up past a boundary, then back down through it: blue on the way back.
    const back = await rasters(
      bare([
        line(
          table({
            t: [5, 5, 5, 5],
            v: [2, 5, 8, 2],
            paint: ["#ff0000", "#ff0000", "#0000ff", "#0000ff"],
          }),
          { x: "t", y: "v", strokeWidth: 20, encode: painted },
        ),
      ]),
    );
    for (const pixel of [back.canvas, back.svg])
      expect(pixel(5, 5, 0, 10)).toEqual([0, 0, 255, 255]);
  });

  it("end area outlines alike in every renderer where runs meet at a sharp turn", async () => {
    const read = await rasters(
      bare([
        area(table({ t: [5, 5, 5], v: [2, 8, 2], paint: ["#ff0000", "#ff0000", "#0000ff"] }), {
          x: "t",
          y: "v",
          fillOpacity: 0,
          strokeWidth: 20,
          encode: { stroke: { field: "paint", scale: { type: "identity" } } },
        }),
      ]),
    );
    // Past the turn: the red outline's join, on the canvas as in SVG.
    for (const pixel of [read.canvas, read.svg])
      expect(pixel(5, 8, 0, -6)).toEqual([255, 0, 0, 255]);
  });

  contractTest(
    "line.style-runs.seams.raster",
    async () => {
      // A wide corner where a translucent red run meets a translucent blue one.
      const read = await rasters(
        bare([
          line(table({ t: [1, 5, 9], v: [2, 2, 8], paint: ["#ff0000", "#ff0000", "#0000ff"] }), {
            x: "t",
            y: "v",
            strokeWidth: 20,
            opacity: 0.5,
            encode: painted,
          }),
        ]),
      );
      for (const pixel of [read.canvas, read.svg]) {
        // Each run's own half, at half its alpha.
        expect(near(pixel(3, 2), [255, 0, 0, 128])).toBe(true);
        expect(near(pixel(7, 5), [0, 0, 255, 128])).toBe(true);
        // About the join, nothing painted twice: no pixel more opaque than one layer.
        let most = 0;
        for (let dx = -12; dx <= 12; dx += 1)
          for (let dy = -12; dy <= 12; dy += 1) most = Math.max(most, pixel(5, 2, dx, dy)[3]!);
        expect(most).toBeLessThanOrEqual(131);
        expect(most).toBeGreaterThanOrEqual(125);
      }
    },
    "two translucent runs meeting paint their join once",
  );

  it("paint nothing of a run of no width, on a canvas as in SVG", async () => {
    const read = await rasters(
      bare([
        line(table({ t: [1, 4, 7, 9], v: [5, 5, 5, 5], width: [8, 8, 0, 8] }), {
          x: "t",
          y: "v",
          color: "#ff0000",
          encode: { strokeWidth: { field: "width", scale: { type: "identity" } } },
        }),
      ]),
    );
    for (const pixel of [read.canvas, read.svg]) {
      expect(pixel(2.5, 5)).toEqual([255, 0, 0, 255]);
      expect(pixel(5.5, 5)[3]).toBe(0);
    }
  });

  describe("with rows selected", () => {
    /**
     * What a model of `marks`, `rows` selected, paints on a canvas and as
     * SVG: readers of their pixels at chart values (x, y), `dx` and `dy` off.
     */
    async function selected<S extends Schema>(
      marks: ChartOptions["marks"],
      rows: Table<S>,
      on: number[],
      options: Partial<ChartConfig> = {},
    ) {
      const model = new ChartModel(
        { locale: "en-US", timeZone: "UTC", ...bare(marks), ...options },
        undefined,
        ...staticCompilers(),
      );
      model.setSize(400, 300, 1);
      const source = rows as unknown as Table;
      const store = selectionStore(source);
      const highlighter = new Highlighter([{ table: source, store, channel: "focus" }]);
      model.highlight = (mark, series, frame, key) =>
        highlighter.geometry(mark, series, frame, key) ?? mark.geometry(series, frame, key);
      store.set("focus", selectRows(new RowSet(source).addAll(on)));
      const scene = model.scene(estimateText);
      const canvas = document.createElement("canvas");
      paintCanvas(canvas, scene);
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSvg(scene))}`;
      await image.decode();
      const drawn = document.createElement("canvas");
      [drawn.width, drawn.height] = [canvas.width, canvas.height];
      drawn.getContext("2d")!.drawImage(image, 0, 0);
      // The first panel's scales.
      const { x, y } = model.panels()[0]!;
      return [canvas, drawn].map(
        (target) =>
          (vx: number, vy: number, dx = 0, dy = 0): number[] =>
            Array.from(
              target
                .getContext("2d")!
                .getImageData(Math.round(x.map(vx) + dx), Math.round(y.map(vy) + dy), 1, 1).data,
            ),
      );
    }

    /** Colors (0–255, alpha 0–1) painted in order, each over those before, as browsers composite. */
    const layered = (...colors: number[][]): number[] => {
      // Premultiplied.
      let [r, g, b, a] = [0, 0, 0, 0];
      for (const [cr, cg, cb, ca] of colors as [number, number, number, number][])
        [r, g, b, a] = [
          cr * ca + r * (1 - ca),
          cg * ca + g * (1 - ca),
          cb * ca + b * (1 - ca),
          ca + a * (1 - ca),
        ];
      return [r / a, g / a, b / a, a * 255];
    };
    const [red, blue] = [
      (alpha: number) => [255, 0, 0, alpha],
      (alpha: number) => [0, 0, 255, alpha],
    ];

    for (const kind of ["line", "area"] as const)
      it(`paint a selected ${kind} dot at a run boundary over the strokes it reaches, as points paint`, async () => {
        const rows = table({
          t: [1, 5, 9],
          v: [5, 5, 5],
          paint: ["#ff0000", "#ff0000", "#0000ff"],
          alpha: [0.2, 0.2, 1],
        });
        const draw = kind === "line" ? line : area;
        const alike = draw(rows, {
          x: "t",
          y: "v",
          strokeWidth: 20,
          fillOpacity: 0,
          opacity: 0.5,
          encode: painted,
        });
        const faint = draw(rows, {
          x: "t",
          y: "v",
          strokeWidth: 20,
          fillOpacity: 0,
          encode: { ...painted, opacity: { field: "alpha", scale: { type: "identity" } } },
        });
        // In its own look, over the run it ends and over the dimmed blue run after it.
        for (const pixel of await selected([alike], rows, [1])) {
          expect(near(pixel(5, 5, -4, 0), layered(red(0.5 * DIM), red(0.5)))).toBe(true);
          expect(near(pixel(5, 5, 4, 0), layered(blue(0.5 * DIM), red(0.5)))).toBe(true);
        }
        for (const pixel of await selected([faint], rows, [1])) {
          expect(near(pixel(5, 5, -4, 0), layered(red(0.2 * DIM), red(0.2)))).toBe(true);
          expect(near(pixel(5, 5, 4, 0), layered(blue(DIM), red(0.2)))).toBe(true);
        }
      });

    it("paint a wide selected dot standing alone in its own look", async () => {
      const rows = table({
        t: [1, 3, 5, 7, 9],
        v: [2, Number.NaN, 4, Number.NaN, 6],
        paint: ["#ff0000", "#ff0000", "#0000ff", "#0000ff", "#00ff00"],
      });
      const mark = area(rows, {
        x: "t",
        y: "v",
        line: false,
        strokeWidth: 20,
        opacity: 0.5,
        encode: painted,
      });
      // Over the row's own lone mark, dimmed.
      for (const pixel of await selected([mark], rows, [2]))
        for (const dx of [0, 6])
          expect(near(pixel(5, 4, dx, 0), layered(blue(0.5 * DIM), blue(0.5)))).toBe(true);
    });

    for (const kind of ["line", "area"] as const)
      it(`paint overlapping selected ${kind} dots in their observations' order`, async () => {
        const rows = table({
          t: [4.9, 4.95, 5, 5.05, 5.1],
          v: [5, Number.NaN, 5, Number.NaN, 5],
          paint: ["#ff0000", "#ff0000", "#0000ff", "#0000ff", "#ff0000"],
        });
        const draw = kind === "line" ? line : area;
        const mark = draw(rows, {
          x: "t",
          y: "v",
          strokeWidth: 20,
          fillOpacity: 0,
          opacity: 0.5,
          encode: painted,
        });
        // Over the rows' lone marks, dimmed: red, then blue over it, then red over both.
        const seen = layered(
          ...[red, blue, red].map((look) => look(0.5 * DIM)),
          ...[red, blue, red].map((look) => look(0.5)),
        );
        for (const pixel of await selected([mark], rows, [0, 2, 4]))
          expect(near(pixel(5, 5), seen)).toBe(true);
      });

    for (const paint of [["#ff0000"], ["#ff0000", "#ff0000", "#0000ff", "#0000ff", "#ff0000"]])
      it(`dim an area's isolated observations without an outline, ${paint.length > 1 ? "in runs" : "of one look"}`, async () => {
        const rows = table({
          t: [1, 3, 5, 7, 9],
          v: [5, Number.NaN, 5, Number.NaN, 5],
          paint: [0, 1, 2, 3, 4].map((i) => paint[i % paint.length]!),
        });
        const mark = area(rows, {
          x: "t",
          y: "v",
          line: false,
          strokeWidth: 20,
          opacity: 0.5,
          fillOpacity: 0.25,
          encode: painted,
        });
        const look = paint.length > 1 ? blue : red;
        for (const pixel of await selected([mark], rows, [2])) {
          expect(near(pixel(1, 5), layered(red(0.5 * DIM)))).toBe(true);
          // The selected one's dot over its own, dimmed.
          expect(near(pixel(5, 5), layered(look(0.5 * DIM), look(0.5)))).toBe(true);
        }
      });

    for (const orient of ["x", "y"] as const)
      it(`light the cap of a selected run starting a stretch past a gap, along ${orient}`, async () => {
        const rows = table({
          t: [0, 1, 5, 6, 9],
          v: [5, 5, 5, 5, 5],
          paint: ["#ff0000", "#ff0000", "#0000ff", "#0000ff", "#ff0000"],
        });
        const mark = line(rows, {
          ...(orient === "x" ? { x: "t", y: "v" } : { x: "v", y: "t" }),
          orient,
          strokeWidth: 20,
          opacity: 0.5,
          continuity: { maxGap: 2 },
          encode: painted,
        });
        // Five pixels before t = 5, where the line starts again: the blue run's cap, lit.
        for (const pixel of await selected([mark], rows, [2, 3]))
          expect(
            near(orient === "x" ? pixel(5, 5, -5, 0) : pixel(5, 5, 0, 5), layered(blue(0.5))),
          ).toBe(true);
      });

    for (const orient of ["x", "y"] as const)
      it(`dim before a selected run its line reaches from a crossing of where, along ${orient}`, async () => {
        const rows = table({
          t: [0, 4, 6, 8],
          v: [5, 5, 5, 5],
          paint: ["#ff0000", "#ff0000", "#0000ff", "#0000ff"],
        });
        const mark = line(rows, {
          ...(orient === "x" ? { x: "t", y: "v" } : { x: "v", y: "t" }),
          orient,
          strokeWidth: 20,
          opacity: 0.5,
          where: col("t").gt(1),
          encode: painted,
        });
        // The line goes on from t = 1 to t = 4: five pixels before that, dimmed, no cap.
        for (const pixel of await selected([mark], rows, [1, 2]))
          expect(
            near(orient === "x" ? pixel(4, 5, -5, 0) : pixel(5, 4, 0, 5), layered(red(0.5 * DIM))),
          ).toBe(true);
      });

    for (const orient of ["x", "y"] as const)
      it(`light the caps of a selected run where an inclusive where ends its line at its rows, along ${orient}`, async () => {
        const rows = table({
          t: [0, 4, 6, 8],
          v: [5, 5, 5, 5],
          paint: ["#ff0000", "#ff0000", "#0000ff", "#0000ff"],
        });
        const mark = (where: ReturnType<ReturnType<typeof col>["ge"]>) =>
          line(rows, {
            ...(orient === "x" ? { x: "t", y: "v" } : { x: "v", y: "t" }),
            orient,
            strokeWidth: 20,
            opacity: 0.5,
            where,
            encode: painted,
          });
        // From t = 4 on, the line starts at row 1: five pixels before it, the
        // cap of its first stretch (blue, arriving at row 2), lit.
        for (const pixel of await selected([mark(col("t").ge(4))], rows, [1, 2]))
          expect(
            near(orient === "x" ? pixel(4, 5, -5, 0) : pixel(5, 4, 0, 5), layered(blue(0.5))),
          ).toBe(true);
        // Up to t = 6, it ends at row 2: five pixels past it, its cap, lit.
        for (const pixel of await selected([mark(col("t").le(6))], rows, [1, 2]))
          expect(
            near(orient === "x" ? pixel(6, 5, 5, 0) : pixel(5, 6, 0, -5), layered(blue(0.5))),
          ).toBe(true);
      });

    for (const orient of ["x", "y"] as const)
      it(`dim before a selected run its panel's places join it to, along ${orient}`, async () => {
        // Panel A holds a, c, d, and e, at places 0 to 3: a joins c within
        // the gap. Five pixels from c toward a (bands run down y): dimmed.
        const rows = table({
          t: ["a", "b", "c", "d", "e"],
          v: [5, 5, 5, 5, 5],
          g: ["A", "B", "A", "A", "A"],
          paint: ["#ff0000", "#ff0000", "#ff0000", "#ff0000", "#ff0000"],
        });
        const look = {
          strokeWidth: 20,
          opacity: 0.5,
          continuity: { maxGap: 1.5 },
          encode: painted,
        };
        const mark =
          orient === "x"
            ? line(rows, { x: "t", y: "v", ...look })
            : line(rows, { x: "v", y: "t", orient: "y", ...look });
        const scoped = { scope: "panel", show: false, grid: false } as const;
        for (const pixel of await selected([mark], rows, [2, 3], {
          facet: facet("g"),
          [orient]: scoped,
        }))
          expect(
            near(orient === "x" ? pixel(1, 5, -5, 0) : pixel(5, 1, 0, -5), layered(red(0.5 * DIM))),
          ).toBe(true);
      });

    it("light the cap of a selected run past a gap the x axis' breaks leave, along y", async () => {
      // The break hides t = 2's row: the line goes from t = 1 to t = 5, past the gap.
      const rows = table({
        t: [0, 1, 2, 5, 6, 9],
        v: [5, 5, 3.5, 5, 5, 5],
        paint: ["#ff0000", "#ff0000", "#ff0000", "#0000ff", "#0000ff", "#ff0000"],
      });
      const mark = line(rows, {
        x: "v",
        y: "t",
        orient: "y",
        strokeWidth: 20,
        opacity: 0.5,
        continuity: { maxGap: 3 },
        encode: painted,
      });
      const x = {
        type: "time",
        domain: [0, 10],
        nice: false,
        show: false,
        grid: false,
        breaks: timeBreaks([{ from: 3, to: 4 }]),
      } as const;
      for (const pixel of await selected([mark], rows, [3, 4], { x }))
        expect(near(pixel(5, 5, 0, 5), layered(blue(0.5)))).toBe(true);
    });

    it("end a selected area's outline of one look as the area does", async () => {
      const rows = table({
        t: [2, 4, 6, 8],
        v: [5, 5, 5, 5],
        paint: ["#ff0000", "#ff0000", "#ff0000", "#ff0000"],
      });
      const mark = area(rows, { x: "t", y: "v", strokeWidth: 20, opacity: 0.5, encode: painted });
      // Before its first observation, where the area's flat end leaves nothing.
      for (const pixel of await selected([mark], rows, [2, 3]))
        expect(pixel(2, 5, -5, 0)[3]).toBe(0);
    });

    it("paint a selected dot over an area's outline of one look", async () => {
      const rows = table({ t: [1, 5, 9], v: [5, 5, 5] });
      const mark = area(rows, {
        x: "t",
        y: "v",
        stroke: "#ff0000",
        strokeWidth: 20,
        opacity: 0.5,
        fillOpacity: 0.25,
      });
      // Above the line, off the fill: the dot over the dimmed outline.
      for (const pixel of await selected([mark], rows, [1]))
        expect(near(pixel(5, 5, 0, -4), layered(red(0.5 * DIM), red(0.5)))).toBe(true);
    });

    it("paint selected dots sharing a place with others once", async () => {
      const rows = table({ t: [1, 1, 5], v: [2, 4, 6], paint: ["#ff0000", "#0000ff", "#00ff00"] });
      const mark = area(rows, {
        x: "t",
        y: "v",
        line: false,
        strokeWidth: 20,
        opacity: 0.5,
        encode: painted,
      });
      // Above the area, where only the dot reaches: once, not twice.
      for (const pixel of await selected([mark], rows, [0]))
        expect(near(pixel(1, 2, -6, 0), layered(red(0.5)))).toBe(true);
    });
  });
});
