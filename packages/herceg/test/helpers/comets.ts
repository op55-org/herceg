// Range comets (the customisation study's A2): a custom mark drawing each
// row as a dot at its start and a tapered tail to an arrowhead at its end,
// its width, color, and opacity each through one of the chart's scales.
// Shared by the unit and browser tests of custom marks' items and their
// benchmarks.

import { table } from "../../src/data/table.ts";
import { custom } from "../../src/marks/custom.ts";
import type { ChartConfig } from "../../src/model/model.ts";

export const CATEGORIES = ["energy", "metals", "grains", "rates", "fx"];
export const COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd"];

/** The chart's scales the comets read: categories to colors, confidence to widths, age to opacity. */
export const COMET_SCALES = {
  categories: {
    type: "ordinal",
    domain: CATEGORIES,
    map: Object.fromEntries(CATEGORIES.map((c, i) => [c, COLORS[i]!])),
  },
  widths: { type: "linear", domain: [0, 1], range: [2, 7] },
  fade: { type: "linear", domain: [0, 30], range: [1, 0.35] },
} as const satisfies ChartConfig["scales"];

/** The arrowhead's length and base width, the tail's width at the head, and the dot's radius, in pixels. */
export const HEAD = { length: 10, width: 8 };
export const NECK = 1;
export const DOT = 3;

export interface Comet {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
  category: string;
  age: number;
}

/** The comets as a table of the mark. */
export function cometTable(comets: readonly Comet[]) {
  return table({
    id: comets.map((c) => c.id),
    x0: comets.map((c) => c.x0),
    y0: comets.map((c) => c.y0),
    x1: comets.map((c) => c.x1),
    y1: comets.map((c) => c.y1),
    confidence: comets.map((c) => c.confidence),
    category: comets.map((c) => c.category),
    age: comets.map((c) => c.age),
  });
}

/** `count` comets on 0 to 100 each way, 3 to 12 long, seeded so every run draws the same. */
export function scatteredComets(count: number, seed = 2): Comet[] {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  return Array.from({ length: count }, (_, i) => {
    const [x0, y0] = [next() * 100, next() * 100];
    const angle = next() * 2 * Math.PI;
    const length = 3 + next() * 9;
    return {
      id: `C-${String(i + 1).padStart(4, "0")}`,
      x0,
      y0,
      x1: x0 + Math.cos(angle) * length,
      y1: y0 + Math.sin(angle) * length,
      confidence: next(),
      category: CATEGORIES[Math.floor(next() * CATEGORIES.length)]!,
      age: next() * 30,
    };
  });
}

/** The outline from (sx, sy) to (ex, ey) in pixels: a tail `width` wide at its start, then the head. */
export function cometPath(sx: number, sy: number, ex: number, ey: number, width: number): string {
  const length = Math.hypot(ex - sx, ey - sy) || 1;
  const [ux, uy] = [(ex - sx) / length, (ey - sy) / length];
  const [nx, ny] = [-uy, ux];
  const head = Math.min(HEAD.length, length);
  const [bx, by] = [ex - ux * head, ey - uy * head];
  const p = (x: number, y: number) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  const tail =
    head < length
      ? `M${p(sx + (nx * width) / 2, sy + (ny * width) / 2)}L${p(bx + (nx * NECK) / 2, by + (ny * NECK) / 2)}L${p(bx - (nx * NECK) / 2, by - (ny * NECK) / 2)}L${p(sx - (nx * width) / 2, sy - (ny * width) / 2)}Z`
      : "";
  const w = HEAD.width / 2;
  return `${tail}M${p(bx + nx * w, by + ny * w)}L${p(ex, ey)}L${p(bx - nx * w, by - ny * w)}Z`;
}

/** The comets' custom mark over `data`: a series per category, each comet its row's item. */
export function comets(data: ReturnType<typeof cometTable>) {
  return custom(data, {
    id: "comets",
    itemKey: "id",
    x: ["x0", "x1"],
    y: ["y0", "y1"],
    series: "category",
    tooltip: {
      fields: [
        "id",
        { field: "confidence", format: { maximumFractionDigits: 2 } },
        { field: "age", format: { maximumFractionDigits: 0 } },
      ],
    },
    encode: {
      color: { field: "category", scale: "categories" },
      strokeWidth: { field: "confidence", scale: "widths" },
      opacity: { field: "age", scale: "fade" },
    },
    draw({ table: t, series, x, y, item, path, circle, encoded }) {
      const [x0, y0, x1, y1] = [t.numbers("x0"), t.numbers("y0"), t.numbers("x1"), t.numbers("y1")];
      for (const s of series)
        for (let k = 0; k < s.length; k++) {
          const row = s.rowAt(k);
          const [sx, sy] = [x(x0[row]!), y(y0[row]!)];
          const style = {
            fill: encoded("color", row) ?? s.color,
            opacity: encoded("opacity", row),
          };
          item(s, row, () => {
            path(
              cometPath(sx, sy, x(x1[row]!), y(y1[row]!), encoded("strokeWidth", row) ?? 2),
              style,
            );
            circle(sx, sy, DOT, style);
          });
        }
    },
  });
}
