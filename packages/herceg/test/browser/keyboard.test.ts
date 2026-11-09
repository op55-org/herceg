// The keyboard cursor in the browser: its stops, Up and Down by screen
// order at the cursor's place, what it announces, and where its tooltip
// stands.
import "./interactive.ts";
import { describe, expect, it, vi } from "vitest";
import { orderedTable } from "../../src/data/ordered.ts";
import { table } from "../../src/data/table.ts";
import type { Chart, ChartOptions } from "../../src/dom/chart.ts";
import { columns, panel, rows } from "../../src/layout.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { custom } from "../../src/marks/custom.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { placeAt, rowOf, type Series } from "../../src/marks/series.ts";
import { facet } from "../../src/model/facet.ts";
import { itemAt, keyedItem } from "../../src/model/keyboard.ts";
import { panels } from "../../src/model/panels.ts";
import { modelOf } from "./helpers.ts";
import { frame, heard, host, key, mount } from "./interaction/helpers.ts";

/** What the chart announced last. */
const said = (chart: Chart) => chart.root.querySelector("[aria-live]")!.textContent;

/** Presses `name` on the focused chart, and what it announces once drawn. */
async function press(chart: Chart, name: string): Promise<string | null> {
  key(chart, name);
  await frame();
  return said(chart);
}

/** The series an announcement names, with its place in the run: ["b", 2] of "b, 2 of 3: ..." or "b, 2 of 3". */
function ranked(text: string | null): [string, number] | undefined {
  const match = /^([^,:]+), (\d+) of \d+(:|\u00a0|$)/.exec(text ?? "");
  return match ? [match[1]!, Number(match[2])] : undefined;
}

/** The tooltip's box, relative to the chart's root; undefined while it is hidden. */
function tooltipOf(chart: Chart): HTMLElement | undefined {
  return [...chart.root.querySelectorAll<HTMLElement>(":scope > div[aria-hidden]")].find(
    (element) => element.style.display === "block",
  );
}

function tooltipBox(chart: Chart): DOMRect | undefined {
  const tip = tooltipOf(chart);
  if (!tip) return undefined;
  const box = tip.getBoundingClientRect();
  const root = chart.root.getBoundingClientRect();
  return new DOMRect(box.x - root.x, box.y - root.y, box.width, box.height);
}

/** The vertical middle of the tooltip's box. */
function tooltipMiddle(chart: Chart): number {
  const box = tooltipBox(chart);
  expect(box).toBeDefined();
  return box!.y + box!.height / 2;
}

/** The ring around the keyboard cursor's point, while shown. */
function ring(chart: Chart): { cx: number; cy: number } | undefined {
  const circle = [...chart.root.querySelectorAll("circle")].find(
    (c) => c.getAttribute("r") === "6.5" && c.getAttribute("visibility") === "visible",
  );
  return circle && { cx: Number(circle.getAttribute("cx")), cy: Number(circle.getAttribute("cy")) };
}

/** The vertical middle of the chart's first plot. */
function plotMiddle(chart: Chart): number {
  const { plot } = modelOf(chart).panels()[0]!;
  return plot.y + plot.height / 2;
}

describe("Up and Down", () => {
  // Twelve crowded, crossing lines of one table, as in the study's A1.
  const n = 40;
  const names = Array.from({ length: 12 }, (_, k) => `s${k}`);
  // Columns named at run time: a table of number fields by any name.
  const crowded = table<Record<string, Float64Array>>({
    t: Float64Array.from({ length: n }, (_, i) => i),
    ...Object.fromEntries(
      names.map((name, k) => [
        name,
        Float64Array.from({ length: n }, (_, i) => 50 + 10 * Math.sin(i / 5 + k) + k),
      ]),
    ),
  });
  const value = (name: string, i: number) => crowded.numbers(name)[i]!;

  it("visit twelve crowded lines once each, in screen order at the cursor's place", async () => {
    const chart = await mount({
      marks: [line(crowded, { x: "t", y: names })],
      interaction: { select: "series" },
    });
    chart.root.focus();
    expect(await press(chart, "ArrowRight")).toBe(`s0: ${format(value("s0", 0))} at 0`);
    await press(chart, "ArrowRight");
    // Up to the top, then down through every series to the bottom.
    for (let i = 0; i < 11; i++) await press(chart, "ArrowUp");
    const visited = [ranked(said(chart))];
    for (let i = 0; i < 11; i++) visited.push(ranked(await press(chart, "ArrowDown")));
    const byHeight = [...names].sort((p, q) => value(q, 1) - value(p, 1));
    expect(visited).toEqual(byHeight.map((name, i) => [name, i + 1]));
    const target = byHeight.at(-1)!;
    // Past the bottom there is nowhere further to go: the cursor says where it is.
    expect(await press(chart, "ArrowDown")).toBe(`${target}, 12 of 12`);
    // The ring marks the cursor's point; the tooltip stands at it and lists
    // all twelve, the cursor's in bold.
    const at = ring(chart);
    expect(at?.cx).toBeCloseTo(chart.toPixel(1, { axis: "x" })!, 0);
    expect(at?.cy).toBeCloseTo(chart.toPixel(value(target, 1), { axis: "y" })!, 0);
    const rows = [...tooltipOf(chart)!.children].slice(1);
    expect(rows).toHaveLength(12);
    const bold = rows.filter((row) => (row.children[1] as HTMLElement).style.fontWeight === "600");
    expect(bold.map((row) => row.children[1]!.textContent)).toEqual([target]);
    // `i` reads every series at the place, in the tooltip's order.
    expect(await press(chart, "i")).toMatch(
      /^12 series at 1: s0 [\d.]+; s1 [\d.]+; .*; s11 [\d.]+$/,
    );
    // Enter selects the cursor's series, and says so; again, clears it.
    expect(await press(chart, "Enter")).toBe(`${target} selected`);
    const keyOf = modelOf(chart)
      .series()
      .find(({ label }) => label === target)?.key;
    expect(chart.selection).toMatchObject({ kind: "series", series: [keyOf] });
    expect(await press(chart, "Enter")).toBe("Selection cleared");
  });

  it("keep the run's order with snap each, where series have points at different places", async () => {
    const a = table({ x: [0, 2, 4], y: [50, 40, 10] });
    const b = table({ x: [1, 3.5], y: [46, 30] });
    const c = table({ x: [0, 1, 2, 3, 4], y: [20, 20, 20, 20, 20] });
    const chart = await mount({
      marks: [
        line(a, { x: "x", y: "y", label: "A" }),
        line(b, { x: "x", y: "y", label: "B" }),
        line(c, { x: "x", y: "y", label: "C" }),
      ],
      inspection: { snap: "each" },
    });
    chart.root.focus();
    await press(chart, "ArrowRight");
    expect(await press(chart, "ArrowRight")).toBe("40 at 2");
    // At x 2, B is drawn at 39.6, between A and C: Down reaches it at its
    // point nearest there, then C, and never A again.
    expect(await press(chart, "ArrowDown")).toBe("B, 2 of 3: 46 at 1");
    expect(await press(chart, "ArrowDown")).toBe("C, 3 of 3: 20 at 2");
    expect(await press(chart, "ArrowUp")).toBe("B, 2 of 3: 46 at 1");
    expect(await press(chart, "ArrowUp")).toBe("A, 1 of 3: 40 at 2");
  });

  it("keep the run where a press goes nowhere, and start afresh after another key", async () => {
    const a = table({ x: [0, 2, 4], y: [50, 40, 10] });
    const b = table({ x: [1, 3.5], y: [46, 30] });
    const c = table({ x: [0, 3.9, 4], y: [20, 20, 20] });
    const options = {
      marks: [
        line(a, { x: "x", y: "y", label: "A" }),
        line(b, { x: "x", y: "y", label: "B" }),
        line(c, { x: "x", y: "y", label: "C" }),
      ],
      inspection: { snap: "each" },
    } as const;
    const chart = await mount(options);
    chart.root.focus();
    await press(chart, "ArrowRight");
    await press(chart, "ArrowRight");
    await press(chart, "ArrowDown");
    expect(await press(chart, "ArrowDown")).toBe("C, 3 of 3: 20 at 3.9");
    // Past the last series, the run stays as it was: Down again goes
    // nowhere, never back to A, and Up climbs it.
    expect(await press(chart, "ArrowDown")).toBe("C, 3 of 3");
    expect(await press(chart, "ArrowDown")).toBe("C, 3 of 3\u00a0");
    expect(await press(chart, "ArrowUp")).toBe("B, 2 of 3: 46 at 1");
    // Home ends the run though the cursor stays where it is: at x 1, B is the top series.
    const again = await mount(options);
    again.root.focus();
    await press(again, "ArrowRight");
    await press(again, "ArrowRight");
    expect(await press(again, "ArrowDown")).toBe("B, 2 of 3: 46 at 1");
    expect(await press(again, "Home")).toBe("46 at 1");
    expect(await press(again, "ArrowUp")).toBe("B, 1 of 3");
    // So do i and Enter.
    for (const name of ["i", "Enter"]) {
      const read = await mount(options);
      heard(read, "click");
      read.root.focus();
      await press(read, "ArrowRight");
      await press(read, "ArrowRight");
      expect(await press(read, "ArrowDown")).toBe("B, 2 of 3: 46 at 1");
      await press(read, name);
      expect(await press(read, "ArrowUp")).toBe("B, 1 of 3");
    }
  });

  it("follow the cursor's row as a stream drops rows before it, and hand on when its row goes", async () => {
    const stream = table({ x: [0, 1, 2, 3, 4, 5, 6, 7], y: [0, 10, 20, 30, 40, 50, 60, 70] });
    const chart = await mount({ marks: [line(stream, { x: "x", y: "y" })] });
    const clicks = heard(chart, "click");
    chart.root.focus();
    await press(chart, "ArrowRight");
    for (let i = 0; i < 5; i++) await press(chart, "ArrowRight");
    expect(said(chart)).toBe("50 at 5");
    // Two rows go before it: its row is now the fourth, which Enter clicks
    // and from which Right steps.
    stream.dropBefore("x", 2);
    chart.render();
    await press(chart, "Enter");
    expect(clicks.map((click) => click.inspection?.points[0]?.text)).toEqual(["50"]);
    expect(await press(chart, "ArrowRight")).toBe("60 at 6");
    // Where its row goes while its place is another row's, it is handed on
    // from where it stood, and Enter clicks nothing.
    const flat = (y: number) => table({ x: [0, 1, 2, 3, 4], y: [y, y, y, y, y] });
    for (const name of ["ArrowDown", "Enter"]) {
      const b = flat(50);
      const three = await mount({
        marks: [
          line(flat(80), { x: "x", y: "y", label: "a" }),
          line(b, { x: "x", y: "y", label: "b" }),
          line(flat(20), { x: "x", y: "y", label: "c" }),
        ],
        interaction: { select: "series" },
      });
      three.root.focus();
      await press(three, "ArrowRight");
      await press(three, "ArrowDown");
      expect(await press(three, "ArrowRight")).toBe("50 at 1");
      b.dropBefore("x", 2);
      three.render();
      expect(await press(three, name)).toBe("c, 3 of 3: 20 at 1");
      expect(three.selection).toBeNull();
    }
  });

  it("keep the cursor, its tooltip, and its ring on its row as a stream moves it", async () => {
    const stream = table({ x: [0, 1, 2, 3, 4, 5, 6, 7], y: [0, 10, 20, 30, 40, 50, 60, 70] });
    const chart = await mount({ marks: [line(stream, { x: "x", y: "y" })] });
    const clicks = heard(chart, "click");
    chart.root.focus();
    await press(chart, "ArrowRight");
    expect(await press(chart, "End")).toBe("70 at 7");
    // Its row moves back one as the stream goes on: the frame drawn shows it there.
    stream.dropFirst(1);
    stream.append({ x: [8], y: [80] });
    chart.render();
    await frame();
    expect(tooltipOf(chart)?.textContent).toContain("70");
    expect(tooltipOf(chart)?.textContent).not.toContain("80");
    expect(ring(chart)?.cx).toBeCloseTo(chart.toPixel(7, { axis: "x" })!, 0);
    await press(chart, "Enter");
    expect(clicks.map((click) => click.inspection?.points[0]?.text)).toEqual(["70"]);
    // Its row gone, it shows nothing until the next key hands it on: in a
    // series alone, to its point nearest where it stood.
    stream.dropBefore("x", 8);
    chart.render();
    await frame();
    expect(tooltipOf(chart)).toBeUndefined();
    expect(ring(chart)).toBeUndefined();
    expect(await press(chart, "ArrowDown")).toBe("80 at 8");
  });

  it("follow the cell the cursor is on as data changes move it", async () => {
    const cells = table({
      x: ["a", "b", "c", "d"],
      y: ["one", "one", "one", "one"],
      v: [10, 20, 30, 40],
    });
    const chart = await mount({ marks: [heatmap(cells, { x: "x", y: "y", color: "v" })] });
    const clicks = heard(chart, "click");
    chart.root.focus();
    await press(chart, "ArrowRight");
    expect(await press(chart, "ArrowRight")).toBe("b. one: 20");
    cells.dropFirst(1);
    chart.render();
    await press(chart, "Enter");
    expect(clicks.map((click) => click.inspection?.points[0]?.text)).toEqual(["20"]);
    expect(await press(chart, "ArrowRight")).toBe("c. one: 30");
  });

  it("goes with its cell, never to the cell beside it", async () => {
    const cells = table({ x: [0, 1, 100], y: [0, 0, 0], v: [10, 20, 30] });
    const chart = await mount({ marks: [heatmap(cells, { x: "x", y: "y", color: "v" })] });
    const clicks = heard(chart, "click");
    chart.root.focus();
    expect(await press(chart, "ArrowRight")).toContain(": 10");
    cells.dropFirst(1);
    chart.render();
    await frame();
    expect(tooltipOf(chart)).toBeUndefined();
    await press(chart, "Enter");
    expect(clicks).toEqual([]);
  });

  it("stay on a cell between edges as its values change", async () => {
    // Edges whose pixels, read back, fall just before them.
    const x1 = Array.from({ length: 7 }, (_, i) => i * 0.01);
    const x2 = x1.map((_, i) => (i + 1) * 0.01);
    const cells = table({ x1, x2, y: x1.map(() => 0), v: x1.map((_, i) => i) });
    const chart = await mount({
      marks: [heatmap(cells, { x1: "x1", x2: "x2", y: "y", color: "v" })],
    });
    const clicks = heard(chart, "click");
    chart.root.focus();
    for (let i = 0; i < 4; i++) await press(chart, "ArrowRight");
    expect(said(chart)).toBe("0.03. 0: 0.03 – 0.04: 3");
    cells.replace(0, { v: x1.map((_, i) => i + 0.5) });
    chart.render();
    await frame();
    await press(chart, "Enter");
    expect(clicks.map((click) => click.inspection?.points[0]?.text)).toEqual(["0.03 – 0.04: 3.5"]);
  });

  it("follow a cell to the row its value moves to as rows join it", async () => {
    for (const faceted of [false, true]) {
      const cells = table({ x: ["a", "b"], y: ["one", "one"], v: [10, 20], f: ["p", "p"] });
      const chart = await mount({
        marks: [heatmap(cells, { x: "x", y: "y", color: "v" })],
        ...(faceted ? { facet: facet("f") } : {}),
      });
      const clicks = heard(chart, "click");
      chart.root.focus();
      await press(chart, "ArrowRight");
      expect(await press(chart, "ArrowRight")).toContain("b. one: 20");
      cells.append({ x: ["b"], y: ["one"], v: [30], f: ["p"] });
      chart.render();
      await frame();
      expect(tooltipOf(chart)?.textContent).toContain("30");
      expect(await press(chart, "i")).toContain("30");
      await press(chart, "Enter");
      expect(clicks.map((click) => click.inspection?.points[0]?.text)).toEqual(["30"]);
    }
  });

  it("look for a gone cell no more, scene after scene", async () => {
    const side = 1000;
    const n = side * side;
    // Row 0 is the top left cell, where the cursor enters.
    const cells = table({
      x: Float64Array.from({ length: n }, (_, i) => i % side),
      y: Float64Array.from({ length: n }, (_, i) => side - 1 - Math.floor(i / side)),
      v: Float64Array.from({ length: n }, (_, i) => i % 97),
    });
    const chart = await mount({ marks: [heatmap(cells, { x: "x", y: "y", color: "v" })] });
    chart.root.focus();
    expect(await press(chart, "ArrowRight")).toBe("0. 999: 0");
    // The fastest of a few scenes, each of another view.
    const scenes = () => {
      let fastest = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        chart.setViewport([0, 500 + i]);
        chart.render();
        fastest = Math.min(fastest, performance.now() - start);
      }
      return fastest;
    };
    const kept = scenes();
    cells.dropFirst(1);
    chart.render();
    expect(scenes()).toBeLessThan(2 * kept + 10);
  });

  it("find the row Enter pins at in a long series split by a field, by halves", async () => {
    const n = 4_000_000;
    const split = table({
      x: Float64Array.from({ length: n }, (_, i) => i >> 1),
      y: new Float64Array(n),
      s: Array.from({ length: n }, (_, i) => (i % 2 ? "b" : "a")),
    });
    const chart = await mount({
      marks: [line(split, { x: "x", y: "y", series: "s" })],
      tooltip: { pin: "click" },
    });
    const pins = heard(chart, "pin");
    chart.root.focus();
    await press(chart, "ArrowRight");
    await press(chart, "End");
    let fastest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 6; i++) {
      const start = performance.now();
      key(chart, "Enter");
      if (pins.length > i) fastest = Math.min(fastest, performance.now() - start);
      chart.root.focus();
      await frame();
    }
    expect(pins.length).toBeGreaterThan(2);
    expect(fastest).toBeLessThan(3);
  });

  it("find the row a click pins at without searching a long series", async () => {
    const n = 4_000_000;
    const long = table({
      x: Float64Array.from({ length: n }, (_, i) => i),
      y: new Float64Array(n),
    });
    const chart = await mount({
      marks: [line(long, { x: "x", y: "y" })],
      tooltip: { pin: "click" },
    });
    const pins = heard(chart, "pin");
    chart.root.focus();
    await press(chart, "ArrowRight");
    await press(chart, "ArrowRight");
    // Enter pins, and Enter again lets go: the fastest of a few.
    let fastest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 6; i++) {
      const start = performance.now();
      key(chart, "Enter");
      if (pins.length > i) fastest = Math.min(fastest, performance.now() - start);
      chart.root.focus();
      await frame();
    }
    expect(pins.length).toBeGreaterThan(2);
    expect(fastest).toBeLessThan(3);
  });

  it("go on from where the cursor stood when a stream drops its row", async () => {
    const flat = (y: number) => table({ x: [0, 1, 2, 3, 4], y: [y, y, y, y, y] });
    const b = flat(50);
    const chart = await mount({
      marks: [
        line(flat(80), { x: "x", y: "y", label: "a" }),
        line(b, { x: "x", y: "y", label: "b" }),
        line(flat(20), { x: "x", y: "y", label: "c" }),
      ],
    });
    chart.root.focus();
    await press(chart, "ArrowRight");
    await press(chart, "ArrowDown");
    for (let i = 0; i < 3; i++) await press(chart, "ArrowRight");
    expect(said(chart)).toBe("50 at 3");
    b.dropBefore("x", 4);
    chart.render();
    expect(await press(chart, "ArrowDown")).toBe("c, 3 of 3: 20 at 3");
    // From where it stood, whatever the series' row left draws: b's last
    // point below c, Down still goes to c; Enter there says where it went,
    // and selects nothing.
    for (const name of ["ArrowDown", "Enter"]) {
      const falls = table({ x: [0, 1, 2, 3, 4], y: [50, 50, 50, 50, 10] });
      const again = await mount({
        marks: [
          line(flat(80), { x: "x", y: "y", label: "a" }),
          line(falls, { x: "x", y: "y", label: "b" }),
          line(flat(20), { x: "x", y: "y", label: "c" }),
        ],
        interaction: { select: "series" },
      });
      again.root.focus();
      await press(again, "ArrowRight");
      await press(again, "ArrowDown");
      for (let i = 0; i < 3; i++) await press(again, "ArrowRight");
      falls.dropBefore("x", 4);
      again.render();
      expect(await press(again, name)).toBe("c, 2 of 3: 20 at 3");
      expect(again.selection).toBeNull();
    }
    // Never back to its own series' row that is left, Up or Down.
    for (const name of ["ArrowUp", "ArrowDown"]) {
      const lone = flat(50);
      const two = await mount({
        marks: [
          line(flat(80), { x: "x", y: "y", label: "a" }),
          line(lone, { x: "x", y: "y", label: "b" }),
        ],
      });
      two.root.focus();
      await press(two, "ArrowRight");
      await press(two, "ArrowDown");
      for (let i = 0; i < 3; i++) await press(two, "ArrowRight");
      lone.dropBefore("x", 4);
      two.render();
      expect(await press(two, name)).toBe("a, 1 of 2: 80 at 3");
    }
  });

  it("take a path crossing the place twice where it crosses nearest the cursor, then go on to the next panel", async () => {
    // A folds back over x 0, at 30 and at 0; B is at 20 and C at 10.
    const folded = table({ x: [0, 10, 10, 0], y: [30, 30, 0, 0] });
    const flat = (y: number) => table({ x: [0, 10], y: [y, y] });
    const chart = await mount({
      marks: [
        line(folded, { x: "x", y: "y", label: "A", panel: "a" }),
        line(flat(20), { x: "x", y: "y", label: "B", panel: "a" }),
        line(flat(10), { x: "x", y: "y", label: "C", panel: "a" }),
        line(flat(5), { x: "x", y: "y", label: "D", panel: "b" }),
      ],
      panels: panels(columns([1, 1], [panel("a"), panel("b")])),
    });
    chart.root.focus();
    expect(await press(chart, "Home")).toMatch(/^a: A: 30 at 0$/);
    expect(ranked(await press(chart, "ArrowDown"))).toEqual(["B", 2]);
    expect(ranked(await press(chart, "ArrowDown"))).toEqual(["C", 3]);
    expect(await press(chart, "ArrowDown")).toMatch(/^b: D: 5 at 0$/);
    // Back up into the first panel from its bottom edge: A crosses nearest
    // there at 0, its lowest series.
    expect(await press(chart, "ArrowUp")).toMatch(/^a: A, 3 of 3: 0 at 0$/);
  });

  it("order profiles along y left to right, Up going left", async () => {
    const depths = table({
      depth: [0, 10, 20, 30],
      p1: [5, 6, 7, 8],
      p2: [12, 13, 14, 15],
      p3: [20, 22, 24, 26],
    });
    const chart = await mount({
      marks: [line(depths, { y: "depth", x: ["p1", "p2", "p3"], orient: "y" })],
    });
    chart.root.focus();
    expect(await press(chart, "ArrowRight")).toBe("p1: 5 at 0");
    // p1 is drawn leftmost: Up goes nowhere, Down to the right.
    expect(await press(chart, "ArrowUp")).toBe("p1, 1 of 3");
    expect(await press(chart, "ArrowDown")).toBe("p2, 2 of 3: 12 at 0");
    expect(await press(chart, "ArrowDown")).toBe("p3, 3 of 3: 20 at 0");
    expect(await press(chart, "ArrowUp")).toBe("p2, 2 of 3: 12 at 0");
  });

  it("visit series along the run's axis by height, then those along the other, in a panel mixing them", async () => {
    const across = table({ t: [0, 10, 20], a: [80, 80, 80], b: [20, 20, 20] });
    const down = table({ depth: [10, 50, 90], q: [5, 10, 15] });
    const chart = await mount({
      marks: [
        line(across, { x: "t", y: ["a", "b"] }),
        line(down, { y: "depth", x: "q", orient: "y", label: "p" }),
      ],
    });
    chart.root.focus();
    expect(await press(chart, "ArrowRight")).toBe("a: 80 at 0");
    expect(ranked(await press(chart, "ArrowDown"))).toEqual(["b", 2]);
    expect(ranked(await press(chart, "ArrowDown"))).toEqual(["p", 3]);
    // On p, a run along y: p by its place across, then a and b.
    await press(chart, "ArrowRight");
    expect(ranked(await press(chart, "ArrowDown"))).toEqual(["a", 2]);
    expect(ranked(await press(chart, "ArrowDown"))).toEqual(["b", 3]);
  });

  it("place a series not drawn at the place by its point nearest there", async () => {
    const gaps = table({
      x: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      a: [50, 50, 50, 60, Number.NaN, Number.NaN, Number.NaN, 30, 30],
      b: [40, 40, 40, 40, 40, 40, 40, 40, 40],
    });
    const chart = await mount({ marks: [line(gaps, { x: "x", y: ["a", "b"] })] });
    chart.root.focus();
    await press(chart, "ArrowRight");
    expect(await press(chart, "ArrowDown")).toBe("b, 2 of 2: 40 at 0");
    for (let i = 0; i < 5; i++) await press(chart, "ArrowRight");
    // At x 5, a's gap: of its points 2 away, the one nearer b's height, below it.
    expect(await press(chart, "ArrowUp")).toBe("b, 1 of 2");
    expect(await press(chart, "ArrowDown")).toBe("a, 2 of 2: 30 at 7");
  });

  it("place a path's jump at a repeated position, or a step's, at the cursor's height", async () => {
    const repeated = table({ x: [0, 5, 5, 10], a: [10, 10, 50, 50], b: [35, 35, 35, 35] });
    const jumps = await mount({ marks: [line(repeated, { x: "x", y: ["a", "b"] })] });
    jumps.root.focus();
    expect(await press(jumps, "ArrowRight")).toBe("a: 10 at 0");
    expect(await press(jumps, "ArrowUp")).toBe("b, 1 of 2: 35 at 0");
    // At x 5, a spans 10 to 50, so it is drawn at b's height: a first, in
    // series order, at its point there nearer b.
    expect(await press(jumps, "ArrowRight")).toBe("35 at 5");
    expect(await press(jumps, "ArrowUp")).toBe("a, 1 of 2: 50 at 5");
    expect(await press(jumps, "ArrowDown")).toBe("b, 2 of 2: 35 at 5");

    const stepped = table({ x: [0, 2, 4, 6, 8], y: [10, 10, 50, 50, 50] });
    const flat = table({ x: [0, 3, 8], y: [30, 30, 30] });
    const steps = await mount({
      marks: [
        line(stepped, { x: "x", y: "y", curve: "step-after", label: "a" }),
        line(flat, { x: "x", y: "y", label: "b" }),
      ],
    });
    steps.root.focus();
    expect(await press(steps, "ArrowRight")).toBe("a: 10 at 0");
    expect(await press(steps, "ArrowUp")).toBe("b, 1 of 2: 30 at 0");
    // At x 3, a's step holds 10 until x 4: drawn below b, though its
    // straight line would cross b there.
    expect(await press(steps, "ArrowRight")).toBe("30 at 3");
    expect(await press(steps, "ArrowUp")).toBe("b, 1 of 2");
    expect(await press(steps, "ArrowDown")).toBe("a, 2 of 2: 10 at 2");
  });

  it("find where a line drawn in pieces of different looks crosses the place", async () => {
    const pieces = table({ x: [0, 4, 8], y: [10, 60, 10] });
    const flat = table({ x: [0, 1.8, 8], y: [30, 30, 30] });
    const chart = await mount({
      marks: [
        line(pieces, {
          x: "x",
          y: "y",
          label: "A",
          // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
          encode: { color: { condition: { when: { top: 1, field: "y" }, then: "#c62828" } } },
        }),
        line(flat, { x: "x", y: "y", label: "B" }),
      ],
    });
    const keys = modelOf(chart)
      .drawnMarks()
      .flatMap(({ geometry }) => geometry.map((g) => g.key));
    expect(keys.filter((k) => k.includes("|run")).length).toBeGreaterThan(1);
    chart.root.focus();
    expect(await press(chart, "ArrowRight")).toBe("A: 10 at 0");
    expect(await press(chart, "ArrowUp")).toBe("B, 1 of 2: 30 at 0");
    // At x 1.8, A's line climbs past B (at 32.5); its point nearest there is at 0.
    expect(await press(chart, "ArrowRight")).toBe("30 at 1.8");
    expect(await press(chart, "ArrowUp")).toBe("A, 1 of 2: 10 at 0");
  });
});

describe("a cursor whose row goes", () => {
  // Bars a, b, and c (or a line keying its rows), the cursor on b, then a
  // stream dropping a and b (or every row).
  const onGone = async (options: Partial<ChartOptions> = {}, keyed = false, drop = 2) => {
    const rows = table({ k: ["a", "b", "c"], v: [1, 2, 3] });
    const chart = await mount({
      errorMode: "throw",
      marks: [keyed ? line(rows, { x: "k", y: "v", itemKey: "k" }) : bar(rows, { x: "k", y: "v" })],
      ...options,
    });
    const hovers = heard(chart, "hover");
    const clicks = heard(chart, "click");
    const pins = heard(chart, "pin");
    chart.root.focus();
    await press(chart, "ArrowRight");
    expect(await press(chart, "ArrowRight")).toContain("2 at b");
    rows.dropFirst(drop);
    chart.render();
    await frame();
    return { chart, hovers, clicks, pins };
  };

  it("reports nothing hovered", async () => {
    for (const keyed of [false, true]) {
      const { hovers } = await onGone({}, keyed);
      expect(hovers.at(-2)?.target).toBeDefined();
      expect(hovers.at(-1)).toMatchObject({ target: undefined, inspection: undefined });
    }
  });

  it("shows no tooltip or ring", async () => {
    const { chart } = await onGone();
    expect(tooltipOf(chart)).toBeUndefined();
    expect(ring(chart)).toBeUndefined();
  });

  it("is handed on by i, which reads where it lands", async () => {
    const { chart } = await onGone();
    expect(await press(chart, "i")).toBe("1 series at c: v 3");
  });

  it("is handed on by Enter, which says where and clicks and selects nothing", async () => {
    const { chart, clicks } = await onGone({ interaction: { select: "items" } });
    expect(await press(chart, "Enter")).toBe("3 at c");
    expect(clicks).toEqual([]);
    expect(chart.selection).toBeNull();
  });

  it("pins nothing with Enter", async () => {
    const { chart, pins } = await onGone({ tooltip: { pin: "click" } });
    await press(chart, "Enter");
    expect(pins).toEqual([]);
  });

  it("is handed on by Enter, which clicks nothing, though its row or cell came back", async () => {
    // A row moved to the other series and back; a heatmap's cell emptied and filled again.
    const split = table({ x: [0, 0, 1, 1], y: [2, 1, 2, 1], s: ["a", "b", "a", "b"] });
    const cells = table({ x: [0, 1], y: [0, 0], v: [1, 2] });
    const cases = [
      {
        options: { marks: [line(split, { x: "x", y: "y", series: "s" })] },
        changes: [() => split.replace(0, { s: ["b"] }), () => split.replace(0, { s: ["a"] })],
      },
      {
        options: { marks: [heatmap(cells, { x: "x", y: "y", color: "v" })] },
        changes: [() => cells.dropFirst(1), () => cells.append({ x: [0], y: [0], v: [3] })],
      },
    ];
    for (const { options, changes } of cases) {
      const chart = await mount(options);
      const clicks = heard(chart, "click");
      chart.root.focus();
      await press(chart, "ArrowRight");
      for (const change of changes) {
        change();
        chart.render();
        await frame();
      }
      expect(tooltipOf(chart)).toBeUndefined();
      await press(chart, "Enter");
      expect(clicks).toEqual([]);
    }
  });

  it("is none once nothing is left to hand it to: Enter and i do nothing", async () => {
    for (const keyed of [false, true]) {
      const { chart, clicks } = await onGone({ interaction: { select: "items" } }, keyed, 3);
      const before = said(chart);
      await press(chart, "Enter");
      await press(chart, "i");
      expect(clicks).toEqual([]);
      expect(chart.selection).toBeNull();
      expect(said(chart)).toBe(before);
    }
  });

  // What the controller does for the cursor as each scene is drawn, read
  // through readers that count the rows looked at.
  const counted = () => {
    const readers = {
      placeAt,
      rowOf: (s: Series, k: number) => {
        readers.reads++;
        return rowOf(s, k);
      },
      reads: 0,
    };
    return readers;
  };

  it("is gone, without a look at every row, once its row moves to another group", async () => {
    const n = 200_000;
    const rows = table({
      x: Float64Array.from({ length: n }, (_, i) => i >> 1),
      y: new Float64Array(n),
      s: Array.from({ length: n }, (_, i) => (i % 2 ? "b" : "a")),
    });
    const chart = await mount({ marks: [line(rows, { x: "x", y: "y", series: "s" })] });
    const model = modelOf(chart);
    const { key: panel } = model.panels()[0]!;
    const { key } = model.series()[0]!;
    const item = keyedItem(model, panel, key, n / 4, { placeAt, rowOf })!;
    // Its row, the 50,000th of a, is the 100,000th of the table.
    rows.replace(n / 2, { s: ["b"] });
    chart.render();
    const readers = counted();
    expect(itemAt(model, panel, key, n / 4, item, readers)).toBe(-1);
    expect(readers.reads).toBeLessThan(100);
  });

  it("is found where it was in a long ordered stream, without a look at every row", async () => {
    const n = 4_000_000;
    const stream = orderedTable(
      { t: Float64Array.from({ length: n }, (_, i) => i), v: new Float64Array(n) },
      { orderBy: "t" },
    );
    const chart = await mount({ marks: [line(stream, { x: "t", y: "v" })] });
    const model = modelOf(chart);
    const { key: panel } = model.panels()[0]!;
    const { key } = model.series()[0]!;
    const readers = { placeAt, rowOf };
    const item = keyedItem(model, panel, key, n / 2, readers)!;
    stream.append({ t: [n], v: [0] });
    chart.render();
    let fastest = Number.POSITIVE_INFINITY;
    let found = -1;
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      found = itemAt(model, panel, key, n / 2, item, readers);
      fastest = Math.min(fastest, performance.now() - start);
    }
    expect(found).toBe(n / 2);
    expect(fastest).toBeLessThan(0.5);
  });

  it("is found among many rows of one time in an ordered stream, without a look at every one", async () => {
    const n = 4_000_000;
    const stream = orderedTable(
      { t: new Float64Array(n), v: new Float64Array(n) },
      { orderBy: "t" },
    );
    const chart = await mount({ marks: [line(stream, { x: "t", y: "v" })] });
    const model = modelOf(chart);
    const { key: panel } = model.panels()[0]!;
    const { key } = model.series()[0]!;
    const readers = { placeAt, rowOf };
    const item = keyedItem(model, panel, key, n - 2, readers)!;
    const asked = vi.spyOn(stream, "positionOf");
    // Where the cursor at `position` finds its row, and the fastest of a few looks.
    const found = (position: number) => {
      let fastest = Number.POSITIVE_INFINITY;
      let at = -1;
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        at = itemAt(model, panel, key, position, item, readers);
        fastest = Math.min(fastest, performance.now() - start);
      }
      return [at, fastest] as const;
    };
    // A row of the same time joins after the others: the cursor's row
    // stays, which its identity there says without asking the table.
    stream.append({ t: [0], v: [0] });
    chart.render();
    const [still, unchanged] = found(n - 2);
    expect(still).toBe(n - 2);
    expect(asked).not.toHaveBeenCalled();
    expect(unchanged).toBeLessThan(0.5);
    // The first row leaves: the cursor's row is one place back.
    stream.dropFirst(1);
    chart.render();
    const [moved, looked] = found(n - 2);
    expect(moved).toBe(n - 3);
    expect(looked).toBeLessThan(0.5);
  });
});

describe("a cursor whose layout mark's item goes", () => {
  // A pie of two slices, the cursor on the small one, which a stream drops.
  const onGone = async () => {
    const shares = table({ k: ["small", "large"], v: [1, 3] });
    const chart = await mount({ marks: [pie(shares, { category: "k", value: "v" })] });
    const hovers = heard(chart, "hover");
    const clicks = heard(chart, "click");
    chart.root.focus();
    await press(chart, "ArrowRight");
    expect(await press(chart, "ArrowRight")).toBe("v. small: 1 (25%)");
    expect(tooltipOf(chart)).toBeDefined();
    shares.dropFirst(1);
    chart.render();
    await frame();
    return { chart, shares, hovers, clicks };
  };

  it("leaves no tooltip or hover, and none again once the item is back", async () => {
    const { chart, shares, hovers } = await onGone();
    expect(tooltipOf(chart)).toBeUndefined();
    expect(hovers.at(-1)).toMatchObject({ target: undefined, inspection: undefined });
    shares.append({ k: ["small"], v: [1] });
    chart.render();
    await frame();
    expect(tooltipOf(chart)).toBeUndefined();
  });

  it("is handed to its panel's items by Enter, which clicks nothing", async () => {
    const { chart, clicks } = await onGone();
    expect(await press(chart, "Enter")).toBe("v. large: 3 (100%)");
    expect(clicks).toEqual([]);
  });

  it("is handed on by Enter, which clicks nothing, though the item came back", async () => {
    const { chart, shares, clicks } = await onGone();
    shares.append({ k: ["small"], v: [1] });
    chart.render();
    await frame();
    expect(await press(chart, "Enter")).toBe("v. large: 3 (75%)");
    expect(clicks).toEqual([]);
  });
});

describe("Up and Down going nowhere", () => {
  it("say the cursor's series and its place in the run again, so the key is heard", async () => {
    const three = table({ t: [0, 1], a: [80, 80], b: [50, 50], c: [20, 20] });
    const chart = await mount({ marks: [line(three, { x: "t", y: ["a", "b", "c"] })] });
    chart.root.focus();
    expect(await press(chart, "ArrowRight")).toBe("a: 80 at 0");
    expect(await press(chart, "ArrowUp")).toBe("a, 1 of 3");
    // Again, told apart from the last announcement so that it is read again.
    expect(await press(chart, "ArrowUp")).toBe("a, 1 of 3\u00a0");
    await press(chart, "ArrowDown");
    expect(await press(chart, "ArrowDown")).toBe("c, 3 of 3: 20 at 0");
    expect(await press(chart, "ArrowDown")).toBe("c, 3 of 3");
    // A series alone has no place to say.
    const one = await mount({ marks: [line(three, { x: "t", y: "a" })] });
    one.root.focus();
    await press(one, "ArrowRight");
    expect(await press(one, "ArrowDown")).toBe("a");
  });
});

describe("a cursor whose series hides", () => {
  const three = table({ t: [0, 1, 2], a: [80, 80, 80], b: [50, 50, 50], c: [20, 20, 20] });
  const onB = async (options: Partial<ChartOptions> = {}) => {
    const chart = await mount({ marks: [line(three, { x: "t", y: ["a", "b", "c"] })], ...options });
    chart.root.focus();
    await press(chart, "ArrowRight");
    expect(await press(chart, "ArrowDown")).toBe("b, 2 of 3: 50 at 0");
    // The legend's button hides b.
    chart.root.querySelectorAll("button")[1]!.click();
    await frame();
    return chart;
  };

  it("is handed to the series below with Down, and above with Up", async () => {
    expect(await press(await onB(), "ArrowDown")).toBe("c, 2 of 2: 20 at 0");
    expect(await press(await onB(), "ArrowUp")).toBe("a, 1 of 2: 80 at 0");
  });

  it("steps from where it is handed with Left and Right", async () => {
    expect(await press(await onB(), "ArrowRight")).toBe("c: 20 at 1");
  });

  it("is handed to the next series in series order among series at one height", async () => {
    const flat = table({ t: [0, 1], a: [50, 50], b: [50, 50], c: [50, 50] });
    const tied = async () => {
      const chart = await mount({ marks: [line(flat, { x: "t", y: ["a", "b", "c"] })] });
      chart.root.focus();
      await press(chart, "ArrowRight");
      expect(await press(chart, "ArrowDown")).toBe("b, 2 of 3: 50 at 0");
      chart.root.querySelectorAll("button")[1]!.click();
      await frame();
      return chart;
    };
    expect(await press(await tied(), "ArrowDown")).toBe("c, 2 of 2: 50 at 0");
    expect(await press(await tied(), "ArrowUp")).toBe("a, 1 of 2: 50 at 0");
  });

  it("is handed to the layer below a stack's layer the legend hides", async () => {
    const layers = table({ x: [0, 1], a: [10, 10], b: [20, 20], c: [30, 30] });
    const chart = await mount({
      marks: [area(layers, { x: "x", y: ["a", "b", "c"], stack: true })],
      y: { domain: [0, 60] },
    });
    chart.root.focus();
    await press(chart, "ArrowRight");
    await press(chart, "ArrowUp");
    expect(await press(chart, "ArrowUp")).toBe("c, 1 of 3: 30 at 0");
    chart.root.querySelectorAll("button")[2]!.click();
    await frame();
    expect(await press(chart, "ArrowDown")).toBe("b, 1 of 2: 20 at 0");
  });

  it("is kept while focus is on the legend that hides its series", async () => {
    const chart = await mount({ marks: [line(three, { x: "t", y: ["a", "b", "c"] })] });
    chart.root.focus();
    await press(chart, "ArrowRight");
    expect(await press(chart, "ArrowDown")).toBe("b, 2 of 3: 50 at 0");
    const button = chart.root.querySelectorAll("button")[1]!;
    button.focus();
    button.click();
    await frame();
    chart.root.focus();
    expect(await press(chart, "ArrowDown")).toBe("c, 2 of 2: 20 at 0");
  });

  it("is handed on at the next key, though its series is shown again", async () => {
    const chart = await onB();
    chart.root.querySelectorAll("button")[1]!.click();
    await frame();
    const clicks = heard(chart, "click");
    expect(ring(chart)).toBeUndefined();
    expect(await press(chart, "Enter")).toBe("c, 3 of 3: 20 at 0");
    expect(clicks).toEqual([]);
    expect(ring(chart)).toBeDefined();
    expect(tooltipOf(chart)).toBeDefined();
  });

  it("reads every series where it is handed with i", async () => {
    const chart = await onB();
    expect(await press(chart, "i")).toBe("2 series at 0: a 80; c 20");
    // Handed on by i, it is on the row it was handed: when that row goes,
    // Enter hands it on again and selects nothing.
    const flat = (y: number) => table({ x: [0, 1, 2, 3, 4], y: [y, y, y, y, y] });
    const c = flat(20);
    const apart = await mount({
      marks: [
        line(flat(80), { x: "x", y: "y", label: "a" }),
        line(flat(50), { x: "x", y: "y", label: "b" }),
        line(c, { x: "x", y: "y", label: "c" }),
      ],
      interaction: { select: "items" },
    });
    apart.root.focus();
    await press(apart, "ArrowRight");
    await press(apart, "ArrowDown");
    expect(await press(apart, "ArrowRight")).toBe("50 at 1");
    apart.root.querySelectorAll("button")[1]!.click();
    await frame();
    expect(await press(apart, "i")).toBe("2 series at 1: a 80; c 20");
    c.dropBefore("x", 2);
    apart.render();
    expect(await press(apart, "Enter")).toBe("a, 1 of 2: 80 at 1");
    expect(apart.selection).toBeNull();
  });

  it("enters a layout mark's panel with i where it is handed there", async () => {
    const chart = await mount({
      marks: [
        line(table({ t: [0, 1, 2], v: [1, 2, 3] }), { x: "t", y: "v", panel: "a" }),
        pie(table({ k: ["small", "large"], v: [1, 3] }), { category: "k", value: "v", panel: "b" }),
      ],
      panels: panels(rows([1, 1], [panel("a"), panel("b")])),
    });
    chart.root.focus();
    await press(chart, "ArrowRight");
    chart.setHiddenKeys([modelOf(chart).series()[0]!.key]);
    chart.render();
    expect(await press(chart, "i")).toBe("b: v. large: 3 (75%)");
    expect(await press(chart, "ArrowRight")).toBe("v. small: 1 (25%)");
  });

  it("is handed on to the next panel when its panel has no other series", async () => {
    const flat = (y: number) => table({ t: [0, 1], v: [y, y] });
    const chart = await mount({
      marks: [
        line(flat(10), { x: "t", y: "v", label: "A", panel: "a" }),
        line(flat(20), { x: "t", y: "v", label: "B", panel: "b" }),
        line(flat(30), { x: "t", y: "v", label: "C", panel: "c" }),
      ],
      panels: panels(rows([1, 1, 1], [panel("a"), panel("b"), panel("c")])),
    });
    chart.root.focus();
    await press(chart, "ArrowRight");
    expect(await press(chart, "ArrowDown")).toBe("b: B: 20 at 0");
    chart.root.querySelectorAll("button")[1]!.click();
    await frame();
    expect(await press(chart, "ArrowDown")).toBe("c: C: 30 at 0");
    // Its row dropped, a series alone in its panel keeps the cursor, at its
    // point nearest where it stood, and Down goes on to the next panel at
    // the place of that run.
    const five = (y: number) => table({ t: [0, 1, 2, 3, 4], v: [y, y, y, y, y] });
    const a = five(10);
    const split = await mount({
      marks: [
        line(a, { x: "t", y: "v", label: "A", panel: "a" }),
        line(five(20), { x: "t", y: "v", label: "B", panel: "b" }),
      ],
      panels: panels(rows([1, 1], [panel("a"), panel("b")])),
    });
    split.root.focus();
    for (let i = 0; i < 4; i++) await press(split, "ArrowRight");
    expect(said(split)).toBe("10 at 3");
    a.dropBefore("t", 4);
    split.render();
    expect(await press(split, "ArrowDown")).toBe("10 at 4");
    expect(await press(split, "ArrowDown")).toBe("b: B: 20 at 3");
  });

  it("lets Escape clear the selection where it would be handed to a layout mark's panel", async () => {
    const shares = table({ k: ["small", "large"], v: [1, 3] });
    const chart = await mount({
      marks: [
        line(table({ t: [0, 1, 2], v: [1, 2, 3] }), { x: "t", y: "v", panel: "a" }),
        pie(shares, { category: "k", value: "v", panel: "b" }),
      ],
      panels: panels(columns([1, 1], [panel("a"), panel("b")])),
      interaction: { brush: "x" },
    });
    chart.root.focus();
    await press(chart, "ArrowRight");
    chart.select([0, 1], { panel: "a" });
    expect(chart.selection).not.toBeNull();
    chart.setHiddenKeys([modelOf(chart).series()[0]!.key]);
    chart.render();
    await press(chart, "Escape");
    expect(chart.selection).toBeNull();
  });

  it("is handed on by Enter, which says where and clicks nothing", async () => {
    const chart = await onB({ interaction: { select: "series" } });
    const clicks = heard(chart, "click");
    expect(await press(chart, "Enter")).toBe("c, 2 of 2: 20 at 0");
    expect(clicks).toEqual([]);
    expect(chart.selection).toBeNull();
  });
});

/** The value as announcements write it, in en-US. */
function format(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

describe("what the keyboard reads", () => {
  it("is nothing where the pointer reads nothing at its point, its own point still announced", async () => {
    const unordered = table({ x: [1, 0, 2], y: [20, 30, 40] });
    const chart = await mount({
      marks: [line(unordered, { x: "x", y: "y" })],
      inspection: { mode: "nearest-x", snap: "previous" },
    });
    chart.root.focus();
    expect(await press(chart, "ArrowRight")).toBe("y: 20 at 1");
    expect(tooltipOf(chart)).toBeUndefined();
  });

  it("reads a cell it is on as the pointer does, beside the series, once each", async () => {
    const grid = table({ x: [1, 2], y: [20, 30], c: [2, 4] });
    const chart = await mount({
      marks: [
        line(grid, { x: "x", y: "y", label: "line" }),
        heatmap(grid, { x: "x", y: "y", color: "c" }),
      ],
      inspection: { mode: "nearest-x", snap: "shared" },
    });
    chart.root.focus();
    await press(chart, "ArrowRight");
    await press(chart, "ArrowDown");
    const { cx, cy } = ring(chart)!;
    const pointer = chart.inspect(cx, cy)!;
    expect(await press(chart, "i")).toBe(
      `${pointer.points.length} series at ${pointer.label}: ${pointer.points.map((p) => `${p.label} ${p.text}`).join("; ")}`,
    );
    expect(new Set(pointer.points.map((p) => p.key)).size).toBe(2);
  });

  it("is nothing where within leaves the pointer nothing at its point", async () => {
    const dodged = table({
      c: ["a", "a", "b", "b"],
      v: [10, 20, 30, 40],
      s: ["one", "two", "one", "two"],
    });
    const chart = await mount({
      marks: [line(dodged, { x: "c", y: "v", series: "s", dodge: true })],
      inspection: { mode: "nearest-x", snap: "shared", within: 0 },
    });
    chart.root.focus();
    // Dodged off the category's middle, the point is beyond reach of the
    // pointer there: announced, but no tooltip.
    expect(await press(chart, "ArrowRight")).toBe("one: 10 at a");
    expect(tooltipOf(chart)).toBeUndefined();
  });

  it("reads what a snap to the previous position reads, not its own row there", async () => {
    const dodged = table({
      c: ["a", "a", "b", "b"],
      v: [10, 20, 30, 40],
      s: ["one", "two", "one", "two"],
    });
    const chart = await mount({
      marks: [line(dodged, { x: "c", y: "v", series: "s", dodge: true })],
      inspection: { mode: "nearest-x", snap: "previous" },
    });
    chart.root.focus();
    await press(chart, "ArrowRight");
    expect(await press(chart, "ArrowRight")).toBe("30 at b");
    const { cx, cy } = ring(chart)!;
    const pointer = chart.inspect(cx, cy)!;
    expect(await press(chart, "i")).toBe(
      `${pointer.points.length} series at ${pointer.label}: ${pointer.points.map((p) => `${p.label} ${p.text}`).join("; ")}`,
    );
  });

  it("reads along y the series of the y axis the pointer compares", async () => {
    const profile = table({ p: [5, 6, 7], d: [20, 30, 40] });
    const chart = await mount({
      marks: [
        line(profile, { y: "d", x: "p", orient: "y", label: "profile" }),
        line(profile, { x: "p", y: "d", label: "left" }),
        line(profile, { x: "p", y: "d", label: "right", axis: "right" }),
      ],
      y: { domain: [0, 50] },
      yRight: { domain: [0, 100] },
      inspection: { mode: "nearest-y", snap: "shared" },
    });
    chart.root.focus();
    await press(chart, "ArrowRight");
    expect(await press(chart, "ArrowRight")).toBe("6 at 30");
    const { cx, cy } = ring(chart)!;
    const pointer = chart.inspect(cx, cy)!;
    expect(pointer.points.map((p) => p.label)).not.toContain("right");
    expect(await press(chart, "i")).toBe(
      `${pointer.points.length} series at ${pointer.label}: ${pointer.points.map((p) => `${p.label} ${p.text}`).join("; ")}`,
    );
  });

  it("includes the cells the pointer reads at its point", async () => {
    const grid = table({ x: [1, 2], y: [20, 30], c: [2, 4] });
    const chart = await mount({
      marks: [
        line(grid, { x: "x", y: "y", label: "line" }),
        heatmap(grid, { x: "x", y: "y", color: "c" }),
      ],
      inspection: { mode: "nearest-x", snap: "shared" },
    });
    chart.root.focus();
    await press(chart, "ArrowRight");
    const { cx, cy } = ring(chart)!;
    const pointer = chart.inspect(cx, cy)!;
    const read = await press(chart, "i");
    expect(pointer.points.length).toBe(2);
    expect(read).toMatch(/^2 series at 1: line 20; /);
  });
});

describe("the keyboard tooltip", () => {
  /** A chart of the marks given on a fixed y domain, its cursor moved by `keys`. */
  async function keyed(options: ChartOptions, keys: readonly string[]): Promise<Chart> {
    const chart = await mount({ y: { domain: [0, 100] }, ...options });
    chart.root.focus();
    for (const name of keys) key(chart, name);
    await frame();
    return chart;
  }
  const values = table({ t: [0, 1, 2], a: [80, 75, 70], b: [25, 20, 15] });

  for (const [family, marks] of [
    ["lines", [line(values, { x: "t", y: ["a", "b"] })]],
    ["areas", [area(values, { x: "t", y: "a" }), area(values, { x: "t", y: "b" })]],
    [
      "points",
      [
        point(values, { x: "t", y: "a", label: "a" }),
        point(values, { x: "t", y: "b", label: "b" }),
      ],
    ],
  ] as const)
    it(`stands at the point of the cursor's series in ${family}`, async () => {
      const chart = await keyed({ marks }, ["ArrowRight", "ArrowRight", "ArrowDown"]);
      expect(said(chart)).toMatch(/^b, 2 of 2: 20 at 1$/);
      const py = chart.toPixel(20, { axis: "y" })!;
      expect(Math.abs(tooltipMiddle(chart) - py)).toBeLessThan(2);
      expect(Math.abs(plotMiddle(chart) - py)).toBeGreaterThan(40);
    });

  it("stands at the top of the cursor's bar", async () => {
    const sales = table({ k: ["a", "b", "c"], v: [90, 20, 60] });
    const chart = await keyed({ marks: [bar(sales, { x: "k", y: "v" })] }, [
      "ArrowRight",
      "ArrowRight",
    ]);
    expect(said(chart)).toBe("20 at b");
    expect(Math.abs(tooltipMiddle(chart) - chart.toPixel(20, { axis: "y" })!)).toBeLessThan(2);
  });

  it("stands at a custom range item the cursor is on, not at the plot's middle", async () => {
    const n = 20;
    const rows = table({
      id: Array.from({ length: n }, (_, i) => `F-${i}`),
      start: Float64Array.from({ length: n }, (_, i) => 10 + i),
      end: Float64Array.from({ length: n }, (_, i) => 60 + i),
      category: Array.from({ length: n }, () => "a"),
    });
    const chart = await mount(
      {
        marks: [
          custom(rows, {
            x: ["start", "end"],
            y: "id",
            series: "category",
            itemKey: "id",
            draw({ table: t, series, x, y, item, rect }) {
              const end = t.numbers("end");
              for (const s of series)
                for (let k = 0; k < s.length; k++) {
                  const row = s.rowAt(k);
                  item(s, row, () =>
                    rect(x(s.x[row]!), y(s.y[row]!) - 4, x(end[row]!) - x(s.x[row]!), 8, {
                      fill: s.color,
                    }),
                  );
                }
            },
          }),
        ],
      },
      host(400, 1000),
    );
    chart.root.focus();
    key(chart, "ArrowRight");
    key(chart, "End");
    await frame();
    const last = chart.toPixel(n - 1, { axis: "y" })!;
    expect(Math.abs(tooltipMiddle(chart) - last)).toBeLessThan(2);
  });

  it("stands at the cell the cursor is on in a heatmap", async () => {
    const grid = table({
      x: ["a", "b", "c", "a", "b", "c", "a", "b", "c"],
      y: ["1", "1", "1", "2", "2", "2", "3", "3", "3"],
      v: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    });
    const chart = await mount({ marks: [heatmap(grid, { x: "x", y: "y", color: "v" })] });
    chart.root.focus();
    for (const name of ["ArrowRight", "ArrowDown", "ArrowDown"]) key(chart, name);
    await frame();
    expect(said(chart)).toBe("a. 3: 7");
    const [cell] = modelOf(chart).inspect(ring(chart)!.cx, ring(chart)!.cy)?.points ?? [];
    expect(cell?.text).toBe("7");
    expect(Math.abs(tooltipMiddle(chart) - ring(chart)!.cy)).toBeLessThan(2);
    expect(Math.abs(plotMiddle(chart) - ring(chart)!.cy)).toBeGreaterThan(40);
  });

  it("stands at the item the cursor is on in a layout mark", async () => {
    const shares = table({ k: ["small", "large"], v: [1, 3] });
    const chart = await mount({ marks: [pie(shares, { category: "k", value: "v" })] });
    const clicks = heard(chart, "click");
    chart.root.focus();
    key(chart, "ArrowRight");
    key(chart, "ArrowRight");
    key(chart, "Enter");
    await frame();
    const item = clicks[0]?.inspection?.points[0];
    expect(item?.label).toBe("small");
    expect(Math.abs(tooltipMiddle(chart) - item!.py)).toBeLessThan(2);
    // The small slice is drawn well above the pie's middle.
    expect(chart.root.getBoundingClientRect().height / 2 - item!.py).toBeGreaterThan(20);
  });

  it("stands at the plot's middle where the cursor's point is out of view", async () => {
    const chart = await keyed(
      { marks: [line(values, { x: "t", y: ["a", "b"] })], y: { domain: [0, 50] } },
      ["ArrowRight"],
    );
    expect(said(chart)).toBe("a: 80 at 0");
    expect(ring(chart)).toBeUndefined();
    expect(Math.abs(tooltipMiddle(chart) - plotMiddle(chart))).toBeLessThan(2);
  });

  it("stands at the plot's middle in charts following the cursor", async () => {
    const options = (title: string): ChartOptions => ({
      title,
      y: { domain: [0, 100] },
      marks: [line(values, { x: "t", y: ["a", "b"] })],
      interaction: { sync: { cursor: { group: "keyboard-tooltip", tooltip: true } } },
    });
    const [leader, follower] = [await mount(options("leader")), await mount(options("follower"))];
    leader.root.focus();
    for (const name of ["ArrowRight", "ArrowRight", "ArrowDown"]) key(leader, name);
    await frame();
    await frame();
    const py = leader.toPixel(20, { axis: "y" })!;
    expect(Math.abs(tooltipMiddle(leader) - py)).toBeLessThan(2);
    expect(Math.abs(tooltipMiddle(follower) - plotMiddle(follower))).toBeLessThan(2);
  });
});
