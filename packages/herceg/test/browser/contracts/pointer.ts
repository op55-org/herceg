// The pointer on the matrix's live charts: presses and drags at pixels,
// and the pixels of values and items, for the proofs of gestures and reading.

import type { Chart } from "../../../src/dom/chart.ts";
import { MOUSE } from "../helpers.ts";

export type Pair = [number, number];

/** An item of a mark without axes, by the label (and text) inspections give it. */
export type Item = { label: string; text?: string };

/** Dispatches a mouse pointer event at a pixel of the chart. */
export function press(chart: Chart, type: string, [x, y]: Pair): void {
  const rect = chart.root.getBoundingClientRect();
  chart.root.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: rect.left + x,
      clientY: rect.top + y,
      pointerId: MOUSE,
      pointerType: "mouse",
    }),
  );
}

/** Presses at the first of `path`'s pixels, moves through the others, and lets go at the last. */
export function drag(chart: Chart, path: readonly Pair[]): void {
  press(chart, "pointerdown", path[0]!);
  for (const at of path.slice(1)) press(chart, "pointermove", at);
  press(chart, "pointerup", path.at(-1)!);
}

export function pixel(chart: Chart, value: number, axis: "x" | "y"): number {
  const at = chart.toPixel(value, { axis });
  if (at === undefined) throw new Error(`${value} has no place on the ${axis} axis`);
  return at;
}

/** Where a value pair is drawn. */
export const pixels = (chart: Chart, [x, y]: Pair): Pair => [
  pixel(chart, x, "x"),
  pixel(chart, y, "y"),
];

/**
 * An item's pixel under the pointer and its anchor (where lassos find it),
 * found by inspecting the plot every few pixels.
 */
export function itemAt(chart: Chart, { label, text }: Item): { at: Pair; anchor: Pair } {
  const { plot } = chart.getPanels()[0]!;
  for (let px = plot.x + 3; px < plot.x + plot.width; px += 6)
    for (let py = plot.y + 3; py < plot.y + plot.height; py += 6) {
      const point = chart
        .inspect(px, py)
        ?.points.find((p) => p.label === label && (text === undefined || p.text === text));
      if (point) return { at: [px, py], anchor: [point.px, point.py] };
    }
  throw new Error(
    `no item "${label}"${text === undefined ? "" : ` reading "${text}"`} in the plot`,
  );
}

/**
 * The middle of where the pointer reads an item: of the pixels it reads it
 * at (every few), the one nearest their mean, away from its edges and labels.
 */
export function itemCenter(chart: Chart, { label, text }: Item): Pair {
  const { plot } = chart.getPanels()[0]!;
  const found: Pair[] = [];
  for (let px = plot.x + 2; px < plot.x + plot.width; px += 4)
    for (let py = plot.y + 2; py < plot.y + plot.height; py += 4)
      if (
        chart
          .inspect(px, py)
          ?.points.some((p) => p.label === label && (text === undefined || p.text === text))
      )
        found.push([px, py]);
  if (found.length === 0) throw new Error(`no item "${label}" in the plot`);
  const mean = [0, 1].map((i) => found.reduce((sum, at) => sum + at[i]!, 0) / found.length);
  const distance = ([x, y]: Pair) => (x - mean[0]!) ** 2 + (y - mean[1]!) ** 2;
  return found.reduce((best, at) => (distance(at) < distance(best) ? at : best));
}

/** A closed square outline around a pixel. */
export const around = ([x, y]: Pair, r = 12): Pair[] => [
  [x - r, y - r],
  [x + r, y - r],
  [x + r, y + r],
  [x - r, y + r],
  [x - r, y - r],
];
