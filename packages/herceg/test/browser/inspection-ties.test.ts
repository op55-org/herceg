// Ties in what inspection reads, in the browser: midway between two
// observations, the earlier is read by every reader (the pointer's tooltip
// and hover events, the row a line's item names, the chart's `inspect`, a
// cursor `showCursor` shows or another chart shares, the keyboard and its
// announcements), on every kind of axis; and two distances tie only within
// a ten-thousandth of the nearer, so a near-tie reads the nearer.
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
  // Times, numbers near 0 and far from it, and times on a reversed range:
  // a test each, as each hovers at more than 200 ties.
  it.each([
    { axis: "times", x: TIMES, timed: true },
    { axis: "numbers near 0", x: TIMES.map((t) => t - T0), timed: false },
    { axis: "numbers far from 0", x: TIMES.map((t) => t - T0 + 1e12), timed: false },
    { axis: "times on a reversed range", x: TIMES, timed: true, reversed: true },
  ])(
    "go to the earlier observation through the pointer, what it is on, the chart's API, and showCursor, on $axis (A7)",
    async ({ x, timed, reversed }) => {
      const data = table({ x: timed ? time(x) : x, v: x.map((_, k) => heightOf(k)) });
      const into = host(1000, 300);
      const chart = await mount(
        {
          marks: [line(data, { x: "x", y: "v" })],
          timeZone: "UTC",
          ...(reversed && { x: { domain: [x.at(-1)!, x[0]!] as [number, number], nice: false } }),
          inspection: { mode: "nearest-x", snap: "each" },
        },
        into,
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
        chart.showCursor({ x: mid });
        // The hover of this cursor: a frame may first report the one before
        // it again, where its layout moved what that read.
        const at = () => {
          const shown = hovers.at(-1);
          const value = (shown?.inspection as { value?: number } | undefined)?.value;
          return shown?.cause === "api" && value !== undefined && Math.abs(value - mid) < 1;
        };
        // A frame draws it; under load (WebKit on CI) that can take seconds.
        await expect.poll(at, { timeout: 5000 }).toBe(true);
        const read = firstRow(hovers.at(-1)!.inspection);
        if (read !== k) later.push(`shown ${k}: row ${read}`);
      }
      expect(later).toEqual([]);
    },
  );

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

  it("read A7's near-tie as the nearer, through the pointer, the API, showCursor, and a synced cursor", async () => {
    // Chiller's observations 130 ms apart about 11:32 (study A7); the
    // cursor 0.48 ms past their midpoint, where the later is nearer by
    // 0.96 ms of 65, at A7's 30-minute view and at a second's.
    const T = Date.UTC(2026, 9, 1, 11, 32);
    const chiller = table({
      t: time([T - 60_000, T - 65, T + 65, T + 60_000]),
      v: [500, 500, 500, 500],
    });
    for (const domain of [
      [Date.UTC(2026, 9, 1, 11, 30), Date.UTC(2026, 9, 1, 12)],
      [T - 500, T + 500],
    ] as [number, number][]) {
      const options = {
        marks: [line(chiller, { x: "t", y: "v" })],
        timeZone: "UTC",
        x: { domain, nice: false },
        y: { domain: [0, 1000] as [number, number] },
        inspection: {
          mode: "nearest-x" as const,
          snap: "each" as const,
          within: { milliseconds: 30_000 },
        },
        interaction: { sync: { cursor: `chiller-${domain[0]}` } },
      };
      const hosts = [host(1100, 480), host(1100, 480)];
      const chart = await mount(options, hosts[0]);
      const peer = await mount(options, hosts[1]);
      const hovers = heard(chart, "hover");
      const shared = heard(peer, "hover");
      const { plot } = chart.getPanels()[0]!;
      const y = chart.toPixel(500, { axis: "y" })!;
      for (const [name, ms, row] of [
        ["near-tie", 0.48, 2],
        ["before it", -0.48, 1],
        ["midpoint", 0, 1],
      ] as const) {
        const px = chart.toPixel(T + ms, { axis: "x" })!;
        const before = shared.length;
        pointer(chart, "pointermove", px, y);
        chart.render();
        await expect.poll(() => shared.length).toBeGreaterThan(before);
        const hover = hovers.at(-1);
        const got = [
          firstRow(hover?.inspection),
          hover?.target?.kind === "item" ? hover.target.row : undefined,
          firstRow(chart.inspect(px, plot.y + plot.height / 2)),
          firstRow(shared.at(-1)?.inspection),
        ];
        expect(got, `${name} at ${domain}`).toEqual([row, row, row, row]);
      }
      // A cursor shown at the value reads as the pointer there does.
      pointer(chart, "pointerleave", 0, 0);
      for (const [ms, row] of [
        [0.48, 2],
        [0, 1],
      ] as const) {
        const before = hovers.length;
        chart.showCursor({ x: T + ms });
        await expect.poll(() => hovers.length).toBeGreaterThan(before);
        expect(firstRow(hovers.at(-1)!.inspection), `shown ${ms} at ${domain}`).toBe(row);
      }
      for (const element of hosts) element.remove();
    }
  });
});
