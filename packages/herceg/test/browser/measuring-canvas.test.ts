// The document's measuring canvas: charts measure text on a canvas of their
// document, which their measurer replaces every 1,000 strings it measures, as
// Chrome's keeps what it shaped of every distinct string for as long as it
// lives. Widths stay those of any canvas of the page, counting labels lay
// out frame by frame as on one canvas, old canvases go (charts that fitted
// labels on them kept), and in Chrome the memory of tens of thousands of
// strings measured stays bounded.
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, server } from "vitest/browser";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { facesLoaded, measurer } from "../../src/dom/measurers.ts";
import { SvgLayer } from "../../src/dom/svg-layer.ts";
import { canvasMeasurer, type MeasuringContext } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import type { LabelsGeometry, Scene } from "../../src/scene/scene.ts";
import { collectGarbage, collectUntilGone } from "./helpers.ts";

const FONT = "12px system-ui, sans-serif";
const BOLD = "700 13px Georgia, serif";

/** Strings never measured before in this file: values as counting labels write them. */
let written = 0;
const fresh = (count: number) =>
  Array.from({ length: count }, () => `${(written++ * 7919 + 0.25).toLocaleString("en-US")}`);

const charts: Chart[] = [];

afterEach(() => {
  for (const chart of [...charts]) unmount(chart);
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Destroys a chart mounted here, and its host. */
function unmount(chart: Chart): void {
  const host = chart.root.parentElement;
  chart.destroy();
  host?.remove();
  charts.splice(charts.indexOf(chart), 1);
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function mount(options: ChartOptions): Promise<Chart> {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:300px";
  document.body.append(host);
  const chart = createChart(host, options);
  charts.push(chart);
  await chart.loading;
  chart.render();
  return chart;
}

describe("the document's measuring canvas", () => {
  it("is replaced every 1,000 strings, each one measuring as any canvas of the page", async () => {
    // A measurer of its own, from its first line.
    facesLoaded(document);
    const measure = measurer(document);
    const reference = document.createElement("canvas").getContext("2d")!;
    const widthOf = (text: string, font: string) => {
      reference.font = font;
      return Math.max(...text.split("\n").map((line) => reference.measureText(line).width));
    };
    const contexts = new Set([measure.context]);
    const measured: [string, string, number][] = [];
    const strings = [
      ...fresh(1200).map((text) => [text, FONT] as const),
      ...fresh(600).map((text) => [text, BOLD] as const),
      // Two lines each.
      ...fresh(400).map((text) => [`${text}\nof ${text}`, FONT] as const),
    ];
    for (const [text, font] of strings) {
      measured.push([text, font, measure(text, font)]);
      contexts.add(measure.context);
    }
    // 2,200 strings: on three canvases.
    expect(contexts.size).toBe(3);
    for (const [text, font, width] of measured) expect(width).toBe(widthOf(text, font));
    // The newest canvas measures what the first did as it did.
    const newest = measure.context as MeasuringContext;
    for (const [text, font, width] of measured.slice(0, 50)) {
      newest.font = font;
      expect(newest.measureText(text).width).toBe(width);
    }
    // The old canvases go. Firefox keeps a context that measured text while a
    // weak reference watches it; unwatched, 20,000 made and dropped there take
    // no more memory than one kept.
    if (server.browser === "firefox") return;
    const old = [...contexts].filter((c) => c !== newest).map((c) => new WeakRef(c!));
    contexts.clear();
    await collectGarbage();
    expect(old.map((ref) => ref.deref() === undefined)).toEqual([true, true]);
  });

  it("goes once replaced, while a chart that shortened its names on it stays", async () => {
    // Firefox keeps a context a weak reference watches (see above).
    if (server.browser === "firefox") return;
    facesLoaded(document);
    const names = ["recommendations-engine", "payments-and-billing"];
    const data = table({ t: [0, 1], [names[0]!]: [1, 2], [names[1]!]: [2, 1] });
    const chart = await mount({
      animation: false,
      legend: false,
      marks: [
        line(data, {
          x: "t",
          y: names,
          labels: { at: "last", place: { outside: true, room: 64 } },
        }),
      ],
    });
    const drawn = chart.root.querySelectorAll("text");
    expect([...drawn].filter((text) => text.textContent?.endsWith("…"))).toHaveLength(2);
    const first = [new WeakRef(measurer(document).context!)];
    for (const text of fresh(1000)) measurer(document)(text, FONT);
    await collectUntilGone(first);
    expect(first[0]!.deref()).toBeUndefined();
    expect(chart.root.isConnected).toBe(true);
  });

  it("lays out counting labels of parts frame by frame as one canvas does", async () => {
    const keyframe = (k: number) => {
      const brands = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
      const values = brands.map((_, i) => 2000 + 900 * Math.sin(i * 1.7 + k) + i * 37.3 + k * 211);
      return {
        brand: brands,
        value: values,
        rank: brands.map((_, i) => values.filter((v) => v > values[i]!).length),
      };
    };
    /** Each frame's labels as drawn (text and place), with `before` strings measured beforehand. */
    const race = async (before: number) => {
      facesLoaded(document);
      for (const text of fresh(before)) measurer(document)(text, FONT);
      const first = measurer(document).context;
      const data = table(keyframe(0));
      const chart = await mount({
        animation: { values: true, duration: 250, easing: "linear" },
        x: { domain: [0, 5000], nice: false },
        y: { domain: [5.5, -0.5], show: false },
        marks: [
          bar(data, {
            itemKey: "brand",
            orient: "y",
            x: "value",
            y: "rank",
            labels: {
              content: [
                { field: "brand", style: { fontWeight: 700 } },
                "\n",
                { value: true, format: { number: ",.2f" } },
              ],
              place: { attachment: "end", outside: false },
              style: { font: "system-ui, sans-serif", fontSize: 12, align: "end", halo: false },
            },
          }),
        ],
      });
      // Frames and time are the test's from here, once frames asked for have run.
      await frame();
      await frame();
      vi.useFakeTimers({
        toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
      });
      chart.render();
      // Asks for a frame without changing anything, so the scheduler runs one.
      chart.root.dispatchEvent(new PointerEvent("pointerleave"));
      vi.advanceTimersByTime(16);
      const frames: string[][] = [];
      const render = SvgLayer.prototype.render;
      vi.spyOn(SvgLayer.prototype, "render").mockImplementation(function (this: SvgLayer, ...args) {
        frames.push(labelsOf(args[0]));
        return render.apply(this, args);
      });
      for (let k = 1; k <= 6; k++) {
        data.reset(keyframe(k));
        for (let t = 0; t < 260; t += 16) vi.advanceTimersByTime(16);
      }
      vi.restoreAllMocks();
      const renewed = measurer(document).context !== first;
      unmount(chart);
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
      return { frames, renewed };
    };
    // A canvas replaced while the labels count, and one canvas throughout.
    // Frames measure only their numbers' shapes, so the race measures little
    // more than its keyframes' values.
    const replaced = await race(970);
    const one = await race(0);
    expect(replaced.renewed).toBe(true);
    expect(one.renewed).toBe(false);
    expect(replaced.frames.length).toBeGreaterThan(60);
    // Values between keyframes' are written as they count.
    const ends = new Set(
      [0, 1, 2, 3, 4, 5, 6].flatMap((k) =>
        keyframe(k).value.map((v) => v.toLocaleString("en-US", { minimumFractionDigits: 2 })),
      ),
    );
    const written = replaced.frames.flat().map((label) => label.split("@")[0]!);
    expect(written.some((text) => /^\d/.test(text) && !ends.has(text))).toBe(true);
    expect(replaced.frames).toEqual(one.frames);
  });

  it.runIf(server.browser === "chromium")(
    "keeps Chrome's memory of the text it measured bounded, charts gone",
    async () => {
      facesLoaded(document);
      const before = (await commands.heapUsage())!;
      // Twelve bars writing new values at every render, 30,000 strings in all.
      const values = (k: number) =>
        Float64Array.from({ length: 12 }, (_, i) => 1000 + k * 12 + i + 0.25);
      const data = table({
        rank: Float64Array.from({ length: 12 }, (_, i) => i),
        value: values(0),
      });
      const chart = await mount({
        animation: false,
        marks: [
          bar(data, {
            orient: "y",
            x: "value",
            y: "rank",
            labels: { content: ["Total ", { value: true, format: { number: ",.2f" } }] },
          }),
        ],
      });
      for (let k = 1; k < 2500; k++) {
        data.setColumn("value", values(k));
        chart.render();
      }
      unmount(chart);
      const after = (await commands.heapUsage())!;
      // At most 1,000 strings' shaping (1 to 1.6 KB each) on the page's canvas.
      expect(after.blink - before.blink).toBeLessThan(4e6);
      // One canvas kept for as many strings keeps them all.
      const kept = canvasMeasurer(document.createElement("canvas").getContext("2d")!);
      for (const text of fresh(30_000)) kept(`Total ${text}`, FONT);
      const keeping = (await commands.heapUsage())!;
      expect(keeping.blink - after.blink).toBeGreaterThan(20e6);
      // Held until measured.
      expect(kept("Total", FONT)).toBeGreaterThan(0);
    },
  );
});

/** A scene's labels of parts, each part's text and place. */
function labelsOf(scene: Scene): string[] {
  return scene.panels[0]!.marks.flatMap((mark) =>
    mark.kind === "labels"
      ? (mark as LabelsGeometry).items.map(({ text, x, y }) => `${text}@${x},${y}`)
      : [],
  );
}
