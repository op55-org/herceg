// Text on a canvas: a box's border and a halo as wide as given, and none at
// a width of 0, as SVG and PDF draw them; labels dimmed with their marks.
import { afterEach, beforeEach, describe, expect } from "vitest";
import { RowSet } from "../../src/data/row-set.ts";
import { selectionStore, selectRows } from "../../src/data/selection.ts";
import { table } from "../../src/data/table.ts";
import { createChart } from "../../src/dom/chart.ts";
import { bar } from "../../src/marks/bar.ts";
import { text } from "../../src/marks/text.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import type { TextStyle } from "../../src/spec/style.ts";
import { contractTest } from "../helpers/contracts.ts";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:300px;height:200px";
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

/** The canvas' red pixels with a label in `style`, with `halo` around it. */
async function redPixels(
  style: TextStyle,
  halo?: { color: string; width: number },
): Promise<number> {
  const chart = createChart(host, {
    renderer: "canvas",
    theme: { tokens: { background: "transparent" } },
    legend: false,
    x: { domain: [0, 10], show: false, grid: false },
    y: { domain: [0, 10], show: false, grid: false },
    marks: [text({ x: 5, y: 5, label: { text: "stroked", style }, ...(halo && { halo }) })],
  });
  await chart.loading;
  const canvas = host.querySelector("canvas")!;
  const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  chart.destroy();
  let red = 0;
  for (let i = 0; i < data.length; i += 4)
    if (data[i]! > 200 && data[i + 1]! < 80 && data[i + 2]! < 80 && data[i + 3]! > 200) red++;
  return red;
}

describe("text's strokes on a canvas", () => {
  contractTest("text.box.stroke-width.canvas", async () => {
    const boxed = (strokeWidth: number) =>
      redPixels({ background: { fill: "#ffffff", stroke: "#ff0000", strokeWidth } });
    expect(await boxed(2)).toBeGreaterThan(20);
    expect(await boxed(0)).toBe(0);
  });

  contractTest("bar.labels.dimmed.canvas", async () => {
    // A highlight dims the bars left out and their labels with them.
    for (const style of [{ color: "#ff0000" }, { color: "#ff0000", fontWeight: 700 }]) {
      const pair = table({ c: ["a", "b"], v: [5, 5] });
      const store = selectionStore(pair);
      const chart = createChart(host, {
        renderer: "canvas",
        theme: { tokens: { background: "transparent" } },
        legend: false,
        x: { show: false },
        y: { show: false, domain: [0, 10], grid: false },
        marks: [bar(pair, { x: "c", y: "v", fill: "#0000ff", labels: { style } })],
        rowSelection: rowSelection({ store, channel: "focus" }),
      });
      await chart.loading;
      store.set("focus", selectRows(new RowSet(pair).add(1)));
      chart.render();
      const canvas = host.querySelector("canvas")!;
      const { width, height } = canvas;
      const { data } = canvas.getContext("2d")!.getImageData(0, 0, width, height);
      // The most opaque red of each half: the dimmed label's, then the other's.
      const reddest = [0, 0];
      for (let i = 0; i < data.length; i += 4)
        if (data[i]! > 150 && data[i + 2]! < 100) {
          const half = (i / 4) % width < width / 2 ? 0 : 1;
          reddest[half] = Math.max(reddest[half]!, data[i + 3]!);
        }
      chart.destroy();
      expect(reddest[1], JSON.stringify(style)).toBeGreaterThan(200);
      expect(reddest[0], JSON.stringify(style)).toBeLessThan(120);
    }
  });

  contractTest("text.halo.width.canvas", async () => {
    // Plain text, and a label in a style of its own.
    for (const style of [{}, { fontWeight: 700 }]) {
      const haloed = (width: number) => redPixels(style, { color: "#ff0000", width });
      expect(await haloed(3)).toBeGreaterThan(20);
      expect(await haloed(0)).toBe(0);
    }
  });
});
