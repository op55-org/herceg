// Ties in what inspection reads, in the browser: midway between two
// observations, the earlier is read by every reader (the pointer's tooltip
// and hover events, the row a line's item names, the chart's `inspect`, a
// cursor `showCursor` shows, the keyboard and its announcements), on every
// kind of axis.
import "./interactive.ts";
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import type { Chart } from "../../src/dom/chart.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { frame, heard, host, key, mount, pointer } from "./interaction/helpers.ts";

// 500 times about 100 ms apart, each moved by a whole number of
// milliseconds (study A7's repro): rounding on screen sent 31 of their 260
// midpoints in whole milliseconds to the later time.
const T0 = Date.UTC(2026, 9, 1, 11, 30);
const TIMES = Array.from({ length: 500 }, (_, i) => T0 + i * 100 + ((i * 37) % 71) - 35);
const heightOf = (k: number) => 100 + (k % 7);

/** Each pair of neighbors of `x` whose midpoint is a whole number: the earlier's position, and the midpoint. */
function ties(x: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < x.length; k++)
    if ((x[k]! + x[k + 1]!) % 2 === 0) out.push([k, (x[k]! + x[k + 1]!) / 2]);
  return out;
}

/** The rows of the tooltip's box, while shown. */
function tooltipRows(chart: Chart): (string | null)[] {
  const box = [...chart.root.querySelectorAll<HTMLElement>(":scope > div[aria-hidden]")].find(
    (element) => element.style.display === "block",
  );
  return [...(box?.children ?? [])].map((row) => row.textContent);
}

/** The row of the first point an inspection reads. */
const firstRow = (inspection: unknown) =>
  (inspection as { points?: { row?: number }[] } | undefined)?.points?.[0]?.row;

describe("ties", () => {
  it("go to the earlier observation through the pointer, what it is on, the chart's API, and showCursor (A7)", async () => {
    for (const x of [TIMES, TIMES.map((t) => t - T0)]) {
      const data = table({ x: x === TIMES ? time(TIMES) : x, v: x.map((_, k) => heightOf(k)) });
      const chart = await mount(
        {
          marks: [line(data, { x: "x", y: "v" })],
          timeZone: "UTC",
          inspection: { mode: "nearest-x", snap: "each" },
        },
        host(1000, 300),
      );
      const hovers = heard(chart, "hover");
      const { plot } = chart.getPanels()[0]!;
      const y = plot.y + plot.height / 2;
      const later: string[] = [];
      const found = ties(x);
      expect(found.length).toBeGreaterThan(200);
      for (const [k, mid] of found) {
        const px = chart.toPixel(mid, { axis: "x" })!;
        if (firstRow(chart.inspect(px, y)) !== k) later.push(`inspect ${k}`);
        // On the line, midway: what the pointer is on is the earlier row too.
        const on =
          (chart.toPixel(heightOf(k), { axis: "y" })! +
            chart.toPixel(heightOf(k + 1), { axis: "y" })!) /
          2;
        pointer(chart, "pointermove", px, on);
        chart.render();
        const hover = hovers.at(-1);
        if (firstRow(hover?.inspection) !== k) later.push(`hover ${k}`);
        if (hover?.target?.kind !== "item" || hover.target.row !== k) later.push(`target ${k}`);
        if (tooltipRows(chart)[1] !== `v${heightOf(k)}`) later.push(`tooltip ${k}`);
      }
      // A cursor shown at a value reads it as the pointer there does (reported once drawn).
      pointer(chart, "pointerleave", 0, 0);
      for (const [k, mid] of found.slice(0, 40)) {
        const before = hovers.length;
        chart.showCursor({ x: mid });
        await expect.poll(() => hovers.length).toBeGreaterThan(before);
        const shown = hovers.at(-1)!;
        if (shown.cause !== "api" || firstRow(shown.inspection) !== k) later.push(`shown ${k}`);
      }
      expect(later).toEqual([]);
    }
  });

  it("are ties on screen: on log axes midway between decades, and between bands", async () => {
    const log = await mount({
      marks: [line(table({ x: [1, 100], v: [1, 2] }), { x: "x", y: "v" })],
      x: { type: "log", domain: [1, 100], nice: false },
      inspection: { mode: "nearest-x", snap: "each" },
    });
    const { plot } = log.getPanels()[0]!;
    const y = plot.y + plot.height / 2;
    expect(firstRow(log.inspect(log.toPixel(10, { axis: "x" })!, y))).toBe(0);
    expect(firstRow(log.inspect(log.toPixel(12, { axis: "x" })!, y))).toBe(1);
    const bands = await mount({
      marks: [line(table({ c: ["a", "b", "c"], v: [1, 2, 3] }), { x: "c", y: "v" })],
      inspection: { mode: "nearest-x", snap: "each" },
    });
    for (const k of [0, 1]) {
      const between = (bands.toPixel(k, { axis: "x" })! + bands.toPixel(k + 1, { axis: "x" })!) / 2;
      expect(firstRow(bands.inspect(between, y))).toBe(k);
    }
  });

  it("are read alike by the tooltip, hover events, the keyboard, and its announcements", async () => {
    // A's points stand midway between B's, which tie there.
    const b = TIMES.slice(0, 80);
    const midpoints = ties(b);
    const chart = await mount(
      {
        marks: [
          point(table({ t: time(midpoints.map(([, mid]) => mid)), v: midpoints.map(() => 50) }), {
            x: "t",
            y: "v",
            label: "A",
          }),
          line(table({ t: time(b), v: b.map((_, k) => heightOf(k)) }), {
            x: "t",
            y: "v",
            label: "B",
          }),
        ],
        timeZone: "UTC",
        inspection: { mode: "nearest-x", snap: "each" },
      },
      host(1000, 300),
    );
    const hovers = heard(chart, "hover");
    const said = () => chart.root.querySelector("[aria-live]")!.textContent;
    const press = async (name: string) => {
      key(chart, name);
      await frame();
      return said();
    };
    chart.root.focus();
    const later: string[] = [];
    for (const [k] of midpoints) {
      await press("ArrowRight");
      const at = chart.formatValue(b[k]!, { axis: "x" });
      const read = hovers.at(-1)!;
      const own = read.inspection?.points.find((p) => p.label === "B");
      if (read.cause !== "keyboard" || own?.row !== k) later.push(`hover ${k}`);
      if (!tooltipRows(chart).includes(`B${heightOf(k)}`)) later.push(`tooltip ${k}`);
      if (!(await press("i"))?.endsWith(`: A 50; B ${heightOf(k)}`)) later.push(`i ${k}`);
      // Up lands on B's observation nearest the cursor's place, above A's:
      // of the tie, the earlier, though its line crosses the place midway.
      if ((await press("ArrowUp")) !== `B, 1 of 2: ${heightOf(k)} at ${at}`) later.push(`up ${k}`);
      await press("ArrowDown");
    }
    expect(later).toEqual([]);
  });
});
