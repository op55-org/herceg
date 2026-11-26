// Segments in the browser: A2's comets painted as their outline says on a
// canvas, read back from the chart's PNG (the dot, the taper, the head;
// both directions; a head alone; a dot alone), cut at the plot; the live
// canvas and SVG drawing what the exports draw; picked by their shapes under
// a real pointer; both ends moving through a 300 ms transition, the start
// dots still; and 2,000 comets read under the pointer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { measurer } from "../../src/dom/measurers.ts";
import { renderToImage } from "../../src/image.ts";
import { segment } from "../../src/marks/segment.ts";
import { renderToSVG } from "../../src/render/static.ts";
import { CATEGORIES, COLORS, scatteredComets } from "../helpers/comets.ts";
import { contractTest } from "../helpers/contracts.ts";
import { modelOf, pageOrigin, realMouse } from "./helpers.ts";

const WIDTH = 480;
const HEIGHT = 260;
const charts: Chart[] = [];

afterEach(() => {
  for (const chart of charts.splice(0)) {
    const host = chart.root.parentElement;
    chart.destroy();
    host?.remove();
  }
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mount(options: ChartOptions, width = WIDTH, height = HEIGHT): Promise<Chart> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;background:#ffffff`;
  document.body.append(host);
  const chart = createChart(host, options);
  charts.push(chart);
  await chart.ready;
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  chart.render();
  return chart;
}

const SCALES = {
  color: {
    type: "ordinal",
    domain: CATEGORIES,
    map: Object.fromEntries(CATEGORIES.map((c, i) => [c, COLORS[i]!])),
  },
  widths: { type: "linear", domain: [0, 1], range: [2, 7] },
} as const;

/**
 * Witnesses, a band each: to the right, to the left, shorter than its head,
 * of no length, and crossing the plot's right edge.
 */
const WITNESSES = {
  id: ["right", "left", "short", "none", "edge"],
  start: [20, 80, 50, 60, 85],
  end: [70, 30, 51.5, 60, 130],
  confidence: [1, 0, 0.5, 0.5, 1],
  category: [...CATEGORIES],
};

const comets = (data = table(WITNESSES)) =>
  segment(data, {
    id: "comets",
    x: ["start", "end"],
    y: "id",
    color: "category",
    itemKey: "id",
    width: { from: { field: "confidence", scale: "widths" }, to: 1 },
    caps: { from: "dot", to: "arrow" },
  });

const options = (renderer: "svg" | "canvas", extra: Partial<ChartOptions> = {}): ChartOptions => ({
  renderer,
  locale: "en-US",
  legend: false,
  animation: false,
  scales: SCALES,
  x: { domain: [0, 100], nice: false },
  marks: [comets()],
  ...extra,
});

/** A PNG's pixels as the browser decodes them, `scale` image pixels per CSS pixel. */
async function pixelsOf(blob: Blob, scale: number) {
  const image = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  return (x: number, y: number) => {
    const at = (Math.round(y * scale) * image.width + Math.round(x * scale)) * 4;
    return [data[at]!, data[at + 1]!, data[at + 2]!];
  };
}

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const near = (pixel: number[], hex: string, tolerance = 40) =>
  rgb(hex).every((channel, i) => Math.abs(channel - pixel[i]!) <= tolerance);

/** The height of `hex`'s pixels in the column at `x`, within 7 CSS px of `cy`. */
function thickness(pixel: (x: number, y: number) => number[], hex: string, x: number, cy: number) {
  let [top, bottom] = [Infinity, -Infinity];
  for (let y = cy - 7; y <= cy + 7; y += 0.5)
    if (near(pixel(x, y), hex)) [top, bottom] = [Math.min(top, y), Math.max(bottom, y)];
  return bottom >= top ? bottom - top + 0.5 : 0;
}

describe("segments in the browser", () => {
  contractTest(
    "segment.shapes.painted",
    async () => {
      const chart = await mount(options("canvas"));
      const model = modelOf(chart);
      const [panel] = model.panels();
      const { x, plot } = panel!;
      const y = (row: number) => model.inspectorOf(panel!.key)!.frame.y.map(row);
      const pixel = await pixelsOf(await renderToImage(chart, { dpi: 192 }), 2);
      const widths = [7, 2];
      for (const [row, dir] of [
        [0, 1],
        [1, -1],
      ] as const) {
        const color = COLORS[row]!;
        const [x0, x1, cy] = [x.map(WITNESSES.start[row]!), x.map(WITNESSES.end[row]!), y(row)];
        const where = `${WITNESSES.id[row]}`;
        // The dot at the start, 6 px across.
        expect(thickness(pixel, color, x0, cy), `${where}: its dot`).toBeGreaterThanOrEqual(4.5);
        expect(thickness(pixel, color, x0, cy), `${where}: its dot`).toBeLessThanOrEqual(8);
        // The head's base 8 px across, narrow near the tip.
        expect(thickness(pixel, color, x1 - dir * 9.5, cy), `${where}: its head`).toBeGreaterThan(
          6,
        );
        expect(thickness(pixel, color, x1 - dir * 2, cy), `${where}: its tip`).toBeLessThanOrEqual(
          3.5,
        );
        // The tail a fifth along the body: its width there, tapering to 1 px at the head.
        const fifth = x0 + dir * 0.2 * (Math.abs(x1 - x0) - 10);
        const expected = widths[row]! * 0.8 + 1 * 0.2;
        expect(thickness(pixel, color, fifth, cy), `${where}: its tail`).toBeGreaterThanOrEqual(
          expected - 1.5,
        );
        expect(thickness(pixel, color, fifth, cy), `${where}: its tail`).toBeLessThanOrEqual(
          expected + 1.5,
        );
      }
      // Shorter than its head: the head alone, its base at the start (where the dot is).
      const [s0, s1] = [x.map(50), x.map(51.5)];
      expect(s1 - s0).toBeLessThan(10);
      expect(thickness(pixel, COLORS[2]!, s0 + 0.5, y(2))).toBeGreaterThan(6);
      expect(thickness(pixel, COLORS[2]!, s0 - 5, y(2))).toBe(0);
      // Of no length: its dot, and no head.
      const z = x.map(60);
      expect(thickness(pixel, COLORS[3]!, z, y(3))).toBeGreaterThanOrEqual(4.5);
      expect(thickness(pixel, COLORS[3]!, z + 5, y(3))).toBe(0);
      expect(thickness(pixel, COLORS[3]!, z - 5, y(3))).toBe(0);
      // Crossing the plot's edge: drawn to it, cut there.
      const edge = plot.x + plot.width;
      expect(thickness(pixel, COLORS[4]!, edge - 2, y(4))).toBeGreaterThan(0);
      expect(thickness(pixel, COLORS[4]!, edge + 2, y(4))).toBe(0);
    },
    "segments paint their dots, tapering bodies, and heads, cut at the plot",
  );

  contractTest(
    "segment.exports.live",
    async () => {
      // The live SVG holds the outlines the static SVG writes.
      const svg = await mount(options("svg"));
      const drawn = [...svg.root.querySelectorAll(`[data-kind="shapes"] path`)].map((p) =>
        p.getAttribute("d"),
      );
      expect(drawn).toHaveLength(5);
      const exported = renderToSVG(
        { ...options("svg"), width: WIDTH, height: HEIGHT },
        { measureText: measurer(document) },
      );
      for (const d of drawn) expect(exported).toContain(`d="${d}"`);
      expect(svg.toSVG()).toContain(`d="${drawn[0]}"`);
      // The live canvas paints what the PNG draws, pixel for pixel where comets are.
      const canvas = await mount(options("canvas"));
      const layers = [...canvas.root.querySelectorAll("canvas")];
      const scale = layers[0]!.width / layers[0]!.getBoundingClientRect().width;
      const png = await pixelsOf(await renderToImage(canvas, { dpi: 96 * scale }), scale);
      const model = modelOf(canvas);
      const [panel] = model.panels();
      const y = (row: number) => model.inspectorOf(panel!.key)!.frame.y.map(row);
      const live = (px: number, py: number) => {
        // The layers stacked as the page shows them, the top one painted.
        for (const layer of layers.toReversed()) {
          const [r, g, b, a] = layer
            .getContext("2d")!
            .getImageData(Math.round(px * scale), Math.round(py * scale), 1, 1).data;
          if (a! > 0) return [r!, g!, b!];
        }
        return [255, 255, 255];
      };
      for (let row = 0; row < 5; row++)
        for (const v of [
          WITNESSES.start[row]!,
          (WITNESSES.start[row]! + WITNESSES.end[row]!) / 2,
        ]) {
          const px = panel!.x.map(v);
          if (px > panel!.plot.x + panel!.plot.width) continue;
          for (const dy of [-2, 0, 2]) {
            const [a, b] = [live(px, y(row) + dy), png(px, y(row) + dy)];
            expect(
              a.every((c, i) => Math.abs(c - b[i]!) <= 8),
              `row ${row} at ${v}, ${dy}: ${a} against ${b}`,
            ).toBe(true);
          }
        }
    },
    "the live chart draws segments as its SVG and PNG exports do",
  );

  it("are read by their shapes under a real pointer", async () => {
    const chart = await mount(options("svg"));
    // What the pointer reads: the tooltip's points, exactly on a shape.
    const targets: (number | null)[] = [];
    chart.on("hover", ({ inspection }) => targets.push(inspection?.points[0]?.row ?? null));
    const model = modelOf(chart);
    const [panel] = model.panels();
    const y = (row: number) => model.inspectorOf(panel!.key)!.frame.y.map(row);
    const origin = pageOrigin(chart.root);
    const move = async (px: number, py: number) => {
      await realMouse({ type: "move", x: origin.x + px, y: origin.y + py });
      await expect.poll(() => targets.length).toBeGreaterThan(0);
      const last = targets.at(-1)!;
      targets.length = 0;
      return last;
    };
    // On the right comet's tail; then inside its box, off its taper (under 5 px wide there).
    const tail = panel!.x.map(30);
    expect(await move(tail, y(0))).toBe(0);
    expect(await move(tail, y(0) - 4)).toBe(null);
    // On the left comet's head, near its tip.
    expect(await move(panel!.x.map(30) + 3, y(1))).toBe(1);
  });

  it("move both ends and their widths through a transition, the start dots still", async () => {
    const data = table(WITNESSES);
    const chart = await mount(
      options("svg", {
        animation: { values: true, duration: 300, easing: "linear" },
        marks: [comets(data)],
      }),
    );
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await frame();
    await frame();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    chart.render();
    chart.root.dispatchEvent(new PointerEvent("pointerleave"));
    vi.advanceTimersByTime(16);
    const d = () => chart.root.querySelector(`[data-kind="shapes"] path`)!.getAttribute("d")!;
    const dot = (path: string) => path.slice(path.lastIndexOf("M"));
    // The head: the piece of three corners, its tip the middle one.
    const tip = (path: string) => {
      const head = path
        .split("M")
        .find((piece) => !piece.includes("a") && piece.split("L").length === 3);
      return Number(head!.split("L")[1]!.split(" ")[0]);
    };
    const before = d();
    // The right comet turns back past its start, and its tail narrows.
    data.transaction(() => {
      data.set("end", 0, 5);
      data.set("confidence", 0, 0);
    });
    const frames: string[] = [];
    for (let t = 0; t < 400; t += 16) {
      vi.advanceTimersByTime(16);
      frames.push(d());
    }
    const { x } = modelOf(chart).panels()[0]!;
    const [from, to] = [x.map(70), x.map(5)];
    const moving = frames.filter(
      (f) => tip(f) > Math.min(from, to) + 1 && tip(f) < Math.max(from, to) - 1,
    );
    expect(moving.length).toBeGreaterThanOrEqual(8);
    // The dot at the start stays where it was in every frame.
    for (const f of frames) expect(dot(f)).toBe(dot(before));
    expect(tip(frames.at(-1)!)).toBeCloseTo(to, 0);
  });

  it("read 2,000 comets under the pointer, each witness by its shape", async () => {
    const cloud = scatteredComets(2000);
    // Witnesses beyond the cloud, one each way.
    const witnesses = [
      [110, 20, 140, 20],
      [140, 40, 110, 40],
      [120, 60, 120, 90],
    ];
    const rows = [
      ...cloud,
      ...witnesses.map(([x0, y0, x1, y1], i) => ({
        id: `W-${i}`,
        x0: x0!,
        y0: y0!,
        x1: x1!,
        y1: y1!,
        confidence: 1,
        category: CATEGORIES[i]!,
        age: 0,
      })),
    ];
    const data = table({
      id: rows.map((c) => c.id),
      x0: Float64Array.from(rows, (c) => c.x0),
      y0: Float64Array.from(rows, (c) => c.y0),
      x1: Float64Array.from(rows, (c) => c.x1),
      y1: Float64Array.from(rows, (c) => c.y1),
      confidence: Float64Array.from(rows, (c) => c.confidence),
      category: rows.map((c) => c.category),
    });
    const chart = await mount(
      {
        renderer: "canvas",
        locale: "en-US",
        animation: false,
        scales: SCALES,
        x: { domain: [0, 150], nice: false },
        y: { domain: [0, 100], nice: false },
        marks: [
          segment(data, {
            x: ["x0", "x1"],
            y: ["y0", "y1"],
            color: "category",
            itemKey: "id",
            width: { from: { field: "confidence", scale: "widths" }, to: 1 },
            caps: { from: "dot", to: "arrow" },
          }),
        ],
      },
      960,
      640,
    );
    const [panel] = modelOf(chart).panels();
    for (const [i, [x0, y0, x1, y1]] of witnesses.entries()) {
      const [px, py] = [
        panel!.x.map(x0! + (x1! - x0!) * 0.4),
        panel!.y.map(y0! + (y1! - y0!) * 0.4),
      ];
      const read = chart.inspect(px, py);
      expect(read?.points.map((p) => data.value("id", p.row!))).toEqual([`W-${i}`]);
    }
    // Every comet drawn, each its own outline.
    expect(modelOf(chart).scene(measurer(document)).panels[0]!.marks[0]).toMatchObject({
      kind: "shapes",
    });
  });
});
