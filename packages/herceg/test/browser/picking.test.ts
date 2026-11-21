// Picking where marks crowd: a click on one of many lines a pixel or two
// apart selects the line clicked, over a region painted under them; where
// crossing lines' strokes overlap, the one whose centre line is nearest;
// a draggable rule among the lines is still grabbed first; and what the
// selection's keys and the legend's entries name, as references.
import "./interactive.ts";
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import type { Chart, ChartOptions } from "../../src/dom/chart.ts";
import { area } from "../../src/marks/area.ts";
import { line } from "../../src/marks/line.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { pageOrigin, realMouse } from "./helpers.ts";
import { heard, host, mount, pointer } from "./interaction/helpers.ts";

const names = Array.from({ length: 12 }, (_, k) => `s${k}`);
/** Line k's value: 0.4 apart, about 1.4 px on a plot of y from 0 to 100. */
const level = (k: number) => 50 + 0.4 * k;

/** A1's crowd: twelve flat lines of one mark over a region of downtime, and a threshold. */
function crowd(threshold: number): ChartOptions {
  const data = table({
    t: [0, 10],
    ...Object.fromEntries(names.map((name, k) => [name, [level(k), level(k)]])),
  });
  return {
    errorMode: "throw",
    marks: [
      region({ id: "downtime", x1: 3, x2: 6 }),
      line(data, { id: "lines", x: "t", y: names as never }),
      rule({ id: "threshold", y: threshold, drag: true }),
    ],
    x: { domain: [0, 10], nice: false },
    y: { domain: [0, 100], nice: false },
    legend: false,
    interaction: { select: "series" },
  };
}

describe("a click among crowded lines", () => {
  it("selects the line clicked, inside the region under them too", async () => {
    const chart = await mount(crowd(20));
    const selections = heard(chart, "select");
    for (const t of [1, 4.5]) {
      const x = chart.toPixel(t, { axis: "x" })!;
      for (const [k, name] of names.entries()) {
        const y = chart.toPixel(level(k), { axis: "y" })!;
        pointer(chart, "pointerdown", x, y, { buttons: 1 });
        pointer(chart, "pointerup", x, y);
        const key = JSON.stringify(["lines", name]);
        expect(chart.selection, `${name} at ${t}`).toEqual({ kind: "series", series: [key] });
        expect(chart.referenceOf("series", key)).toEqual({ mark: "lines", series: name });
      }
    }
    expect(selections).toHaveLength(2 * names.length);
  });

  it("grabs a draggable rule among the lines first, and drags it", async () => {
    // The threshold on line 5; a press on it moves the rule, selecting no line.
    const chart = await mount(crowd(level(5)));
    const moves = heard(chart, "itemMove");
    const selections = heard(chart, "select");
    const x = chart.toPixel(4.5, { axis: "x" })!;
    pointer(chart, "pointerdown", x, chart.toPixel(level(5), { axis: "y" })!, { buttons: 1 });
    pointer(chart, "pointermove", x, chart.toPixel(70, { axis: "y" })!, { buttons: 1 });
    chart.render();
    pointer(chart, "pointerup", x, chart.toPixel(70, { axis: "y" })!);
    expect(moves.map(({ phase, markId }) => [phase, markId])).toEqual([
      ["preview", "threshold"],
      ["commit", "threshold"],
    ]);
    expect(moves.at(-1)!.position!.y).toBeCloseTo(70, 0);
    expect(selections).toEqual([]);
  });
});

describe("a click where crossing lines overlap (A1)", () => {
  // Twelve lines of 180 observations crossing each other, 2 px wide.
  const count = 180;
  const t = Float64Array.from({ length: count }, (_, i) => i);
  const value = (k: number, i: number) => 200 + 6 * k + 10 * Math.sin(i / 12 + k);
  const data = table({
    t,
    ...Object.fromEntries(names.map((name, k) => [name, t.map((i) => value(k, i))])),
  });

  /** Pixels from (x, y) to each line's centre line as drawn, by series. */
  function centres(chart: Chart, x: number, y: number): number[] {
    const px = (i: number) => chart.toPixel(i, { axis: "x" })!;
    // The observations either side of x, and their neighbours.
    let i = 0;
    while (i < count - 2 && px(i + 1) < x) i++;
    return names.map((_, k) => {
      let best = Number.POSITIVE_INFINITY;
      for (let j = Math.max(0, i - 2); j < Math.min(count - 1, i + 3); j++) {
        const [ax, ay] = [px(j), chart.toPixel(value(k, j), { axis: "y" })!];
        const [bx, by] = [px(j + 1), chart.toPixel(value(k, j + 1), { axis: "y" })!];
        const [dx, dy] = [bx - ax, by - ay];
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
        best = Math.min(best, Math.hypot(ax + u * dx - x, ay + u * dy - y));
      }
      return best;
    });
  }

  it("picks the line whose centre line is nearest, for the click, the hover, and the cursor alike", async () => {
    // At the page's top left, where real input lands.
    const into = host(400, 300);
    into.style.cssText += ";position:fixed;left:0;top:0";
    const chart = await mount(
      {
        errorMode: "throw",
        marks: [line(data, { id: "lines", x: "t", y: names as never })],
        legend: false,
        interaction: { select: "series" },
      },
      into,
    );
    const clicks = heard(chart, "click");
    const hovers = heard(chart, "hover");
    const origin = pageOrigin(chart.root);
    const { plot } = chart.getPanels()[0]!;
    // Whole page pixels (as every engine's real input lands) inside two or
    // more strokes, one centre nearer than the rest by a twentieth of a
    // pixel, none at a stroke's edge.
    const places: { x: number; y: number; nearest: number; under: boolean }[] = [];
    for (
      let px = Math.ceil(origin.x + plot.x + 10);
      px < origin.x + plot.x + plot.width - 10;
      px++
    ) {
      if (places.length && px - origin.x - places.at(-1)!.x < 15) continue;
      for (
        let py = Math.ceil(origin.y + plot.y + 5);
        py < origin.y + plot.y + plot.height - 5;
        py++
      ) {
        const [x, y] = [px - origin.x, py - origin.y];
        const d = centres(chart, x, y);
        if (d.some((c) => Math.abs(c - 1) < 0.03)) continue;
        const inside = d.flatMap((c, k) => (c < 1 ? [k] : [])).sort((a, b) => d[a]! - d[b]!);
        if (inside.length < 2 || d[inside[1]!]! - d[inside[0]!]! < 0.05) continue;
        // Whether a line painted over the nearest holds the point too.
        places.push({ x, y, nearest: inside[0]!, under: inside.some((k) => k > inside[0]!) });
        break;
      }
    }
    // Enough overlaps where paint order alone would take another line.
    expect(places.filter(({ under }) => under).length).toBeGreaterThanOrEqual(4);
    for (const [n, { x, y, nearest }] of places.slice(0, 12).entries()) {
      const key = JSON.stringify(["lines", names[nearest]]);
      const at = { x: origin.x + x, y: origin.y + y };
      await realMouse({ type: "move", ...at });
      // The hover once it reports the pointer here.
      const here = () => {
        const pointed = hovers.at(-1)?.pointer;
        return !!pointed && Math.hypot(pointed.x - x, pointed.y - y) < 0.01;
      };
      await expect.poll(here).toBe(true);
      expect(hovers.at(-1)?.target, `hover at ${x},${y}`).toMatchObject({ series: key });
      await expect.poll(() => chart.root.style.cursor).toBe("pointer");
      await realMouse({ type: "press", ...at });
      await realMouse({ type: "release", ...at });
      await expect.poll(() => clicks.length).toBe(n + 1);
      expect(clicks.at(-1)?.target, `click at ${x},${y}`).toMatchObject({ series: key });
    }
  });
});

describe("references", () => {
  it("of the legend's entries and the targets of their clicks, a line and area sharing a series", async () => {
    const data = table({ t: [0, 1, 2], auth: [1, 3, 2], api: [2, 1, 3] });
    const chart = await mount({
      errorMode: "throw",
      marks: [
        area(data, { id: "bands", x: "t", y: ["auth", "api"] as never }),
        line(data, { id: "lines", x: "t", y: ["auth", "api"] as never }),
      ],
      legend: { action: "select" },
    });
    const both = [
      { mark: "bands", series: "auth" },
      { mark: "lines", series: "auth" },
    ];
    const auth = chart.getLegend().find(({ label }) => label === "auth")!;
    expect(auth.references).toEqual(both);
    const clicks = heard(chart, "click");
    const button = [...chart.root.querySelectorAll("button")].find(
      (b) => b.textContent === "auth",
    )!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(clicks.at(-1)?.target).toMatchObject({ kind: "legendEntry", references: both });
  });

  it("are undefined for keys of no mark, or of the other kind", async () => {
    const chart = await mount(crowd(20));
    expect(chart.referenceOf("series", '["other","s0"]')).toBeUndefined();
    expect(chart.referenceOf("series", "not json")).toBeUndefined();
    expect(() => chart.referenceOf("row" as never, '["lines","s0"]')).toThrow(
      'chart.referenceOf kind: expected "series" or "item"; received "row"',
    );
  });
});
