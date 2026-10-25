// Proofs of the matrix's reading (test/contracts/), one per row: the
// pointer on a known datum reads it in each tooltip mode, with the fields
// asked for; the arrow keys announce data in order; the description names
// what the chart draws. Items read under the pointer refuse the modes that
// read along an axis. Expectations are rows.json's `reading`.

import { describe, expect } from "vitest";
import type { Chart } from "../../../src/dom/chart.ts";
import type { Inspection, TooltipMode } from "../../../src/model/inspect.ts";
import { cellsOf, defaultsOf, fixtureOf, markOf } from "../../contracts/matrix.ts";
import { contractTest } from "../../helpers/contracts.ts";
import { dateTimes } from "../helpers.ts";
import { expectChartRefused, mount } from "./mount.ts";
import { type Item, itemAt, type Pair, pixels, press } from "./pointer.ts";

type Point = [label: string, row: number | null, text: string];

/** How a row reads (rows.json's `reading`, over its table's defaults). */
interface Reading {
  at?: Pair | Item;
  points?: Point[];
  x?: Point[];
  y?: Point[];
  /** Inside an item, nearer another's edge: nearest reads the item the pointer is in. */
  inside?: { at: Pair; points: Point[] };
  fields?: [label: string, text: string][];
  /** The field, target, and mark options for `fields`, where they differ from the row's own. */
  field?: string;
  fieldsAt?: Pair | Item;
  fieldsMark?: object;
  keys?: string[];
  describes: string[];
}

function readingOf(row: string): Reading {
  const { read, field } = defaultsOf(fixtureOf(row).table) as { read?: Pair; field?: string };
  return {
    ...(read && { at: read }),
    ...(field && { field }),
    ...(fixtureOf(row).reading as Reading),
  };
}

/** The pixel of a row's datum: a value pair's, or under an item. */
function targetOf(chart: Chart, at: Pair | Item): Pair {
  return Array.isArray(at) ? pixels(chart, at) : itemAt(chart, at).at;
}

/** What the pointer at `at` reads, as the chart's hover event reports it. */
async function hover(chart: Chart, at: Pair): Promise<Inspection | undefined> {
  const read: (Inspection | undefined)[] = [];
  const off = chart.on("hover", ({ inspection }) => read.push(inspection));
  press(chart, "pointermove", at);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  off();
  return read.at(-1);
}

const pointsOf = (inspection: Inspection | undefined): Point[] =>
  inspection?.points.map((p) => [dateTimes(p.label), p.row ?? null, dateTimes(p.text)]) ?? [];

function descriptionOf(chart: Chart): string {
  const id = chart.root.getAttribute("aria-describedby")!.split(" ")[0]!;
  return dateTimes(document.getElementById(id)?.textContent ?? "");
}

/**
 * A row read through its labels and the description: alone, the pointer
 * across the plot and the arrow keys read nothing, and the description
 * names what it draws, without promising the keys read values.
 */
async function expectDescribedOnly(row: string): Promise<void> {
  const chart = await mount({ marks: [markOf(row)], tooltip: { mode: "nearest" } });
  const { plot } = chart.getPanels()[0] ?? { plot: chart.root.getBoundingClientRect() };
  for (const [fx, fy] of [
    [0.25, 0.5],
    [0.5, 0.25],
    [0.75, 0.75],
  ] as const)
    expect(
      pointsOf(await hover(chart, [plot.x + plot.width * fx, plot.y + plot.height * fy])),
    ).toEqual([]);
  expect(await arrowRight(chart)).toEqual(["", ""]);
  for (const part of readingOf(row).describes)
    await expect.poll(() => descriptionOf(chart), { timeout: 3000 }).toContain(part);
  expect(descriptionOf(chart)).not.toContain("arrow keys");
}

/** A row read under the pointer but not along an axis: in `mode`, the pointer on it reads nothing. */
async function expectNotAlong(row: string, mode: TooltipMode): Promise<void> {
  const chart = await mount({ marks: [markOf(row)], tooltip: { mode } });
  expect(pointsOf(await hover(chart, targetOf(chart, readingOf(row).at!)))).toEqual([]);
}

const MODES = {
  "reading.nearest-x": ["nearest-x", "x"],
  "reading.nearest-y": ["nearest-y", "y"],
  "reading.nearest": ["nearest", "points"],
} as const;

for (const [capability, [mode, key]] of Object.entries(MODES))
  describe(capability, () => {
    for (const cell of cellsOf(capability))
      contractTest(`${cell.row}.${capability}`, async () => {
        const reading = readingOf(cell.row);
        const spec = { marks: [markOf(cell.row)], tooltip: { mode } };
        if (cell.state === "refused") return expectChartRefused(spec, cell);
        if (cell.state === "na")
          return reading.points ? expectNotAlong(cell.row, mode) : expectDescribedOnly(cell.row);
        const chart = await mount(spec);
        const read = pointsOf(await hover(chart, targetOf(chart, reading.at!)));
        expect(read).toEqual(reading[key] ?? reading.points);
        if (mode === "nearest" && reading.inside) {
          // Away first: a pointer moving within the item it reads reports no new hover.
          await hover(chart, [1, 1]);
          const inside = pointsOf(await hover(chart, pixels(chart, reading.inside.at)));
          expect(inside, "inside the item").toEqual(reading.inside.points);
        }
      });
  });

describe("reading.fields", () => {
  for (const cell of cellsOf("reading.fields"))
    contractTest(`${cell.row}.reading.fields`, async () => {
      const { field, at, fields, fieldsAt, fieldsMark } = readingOf(cell.row);
      const spec = {
        marks: [markOf(cell.row, { ...fieldsMark, tooltip: { fields: [field] } })],
        tooltip: { mode: "nearest" as const },
      };
      if (cell.state === "refused") return expectChartRefused(spec, cell);
      if (cell.state === "na") return expectDescribedOnly(cell.row);
      const chart = await mount(spec);
      const [point] = (await hover(chart, targetOf(chart, (fieldsAt ?? at)!)))?.points ?? [];
      expect(point?.fields?.map((f) => [f.label, f.text])).toEqual(fields);
    });
});

/** The first two announcements of the arrow keys, from a focused chart. */
async function arrowRight(chart: Chart): Promise<string[]> {
  const live = chart.root.querySelector("[aria-live]")!;
  chart.root.focus();
  const said: string[] = [];
  for (let i = 0; i < 2; i++) {
    chart.root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    chart.render();
    // WebKit writes "Jan 5, 2026 at 00:00" where others write "Jan 5, 2026, 00:00".
    said.push(dateTimes(live.textContent ?? ""));
  }
  return said;
}

describe("reading.keyboard", () => {
  for (const cell of cellsOf("reading.keyboard"))
    contractTest(`${cell.row}.reading.keyboard`, async () => {
      if (cell.state === "na") return expectDescribedOnly(cell.row);
      if (cell.state !== "works") throw new Error(`reading.keyboard is never ${cell.state}`);
      const chart = await mount({ marks: [markOf(cell.row)] });
      expect(await arrowRight(chart)).toEqual(readingOf(cell.row).keys);
    });
});

describe("reading.description", () => {
  for (const cell of cellsOf("reading.description"))
    contractTest(`${cell.row}.reading.description`, async () => {
      if (cell.state !== "works") throw new Error(`reading.description is never ${cell.state}`);
      const chart = await mount({ marks: [markOf(cell.row)] });
      for (const part of readingOf(cell.row).describes)
        await expect.poll(() => descriptionOf(chart), { timeout: 3000 }).toContain(part);
    });
});
