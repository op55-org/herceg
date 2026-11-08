// Picking where marks crowd: a click on one of many lines a pixel or two
// apart selects the line clicked, over a region painted under them; a
// draggable rule among the lines is still grabbed first; and what the
// selection's keys and the legend's entries name, as references.
import "./interactive.ts";
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import type { ChartOptions } from "../../src/dom/chart.ts";
import { area } from "../../src/marks/area.ts";
import { line } from "../../src/marks/line.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { heard, mount, pointer } from "./interaction/helpers.ts";

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
