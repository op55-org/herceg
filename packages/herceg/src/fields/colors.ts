// What a chart's field displays color, beyond each value's color (see
// `ShownField.color`): keys of a number field's display colors for legends,
// one color per value across the displays of every field standing for it
// (category values' mapping colors, which series, rows, and layout items
// take), and the steps rules and regions are placed at (`{ thresholds }`).
// Part of the display code (fields/compile.ts), which only charts with
// `fields` load.

import type { RowView } from "../data/row-view.ts";
import type { Table } from "../data/table.ts";
import type { Formatter } from "../format/format.ts";
import type { AtThresholds } from "../marks/annotation.ts";
import type { GlyphKey } from "../marks/mark.ts";
import type { LegendPart } from "../model/legend.ts";
import { cssColor } from "../scale/css-color.ts";
import type { ChartFields, ShownField } from "./chart.ts";
import type { ResolvedDisplay, Steps } from "./display.ts";

/** A legend key's swatch: a square, as keys of colors draw them. */
const SWATCH = { glyph: "M-4.5 -4.5h9v9h-9Z", r: 4.5 };

/**
 * A number field's display colors drawn as a mark's own continuous colors
 * are (points', heatmap cells'), in their place (see `SequentialScale`,
 * whose members marks read these by): `colors()`, its colors as read, the
 * color of values without one (`none`) first; each value's place among
 * them (-1 for a missing value); its color, or its RGBA bytes; and its
 * legend's key of them.
 */
export interface DisplayTones {
  /** The mark's legend of them: a key of glyphs, as every mark's keys are drawn. */
  readonly legend: LegendPart | undefined;
  /** The colors as `colors()` lists them, which marks keep what they made of them by. */
  readonly stops: readonly string[];
  readonly domain: readonly [number, number];
  readonly midpoint: undefined;
  index(value: number): number;
  colors(): string[];
  color(value: number): string;
  write(value: number, out: Uint8ClampedArray, at: number): void;
  legendStops(): readonly string[];
}

/**
 * Number field `shown`'s display colors as a mark draws them in place of
 * its ramp, each read by `paint`, values without one in `none`
 * (transparent where undefined), with `legend` its legend's key of them.
 */
export function displayTones(
  shown: ShownField,
  none: string | undefined,
  paint: (color: string) => string,
  legend: LegendPart | undefined,
): DisplayTones {
  const { colors, index: place } = shown.values!;
  // Points and cells missing the value are not drawn, as with a ramp, whatever `missing` says.
  const index = (value: number) => (Number.isNaN(value) ? -1 : place(value));
  const stops = [none ?? "transparent", ...colors.map(paint)];
  // Each stop's RGBA bytes, which cells copy.
  const bytes = Uint8Array.from(stops.flatMap(rgba));
  return {
    legend,
    stops,
    domain: [0, 0],
    midpoint: undefined,
    index,
    colors: () => [...stops],
    color: (value) => stops[Math.max(0, index(value))]!,
    write(value, out, at) {
      // A missing value (-1) is transparent.
      const from = index(value) * 4;
      for (let i = 0; i < 4; i++) out[at + i] = from < 0 ? 0 : bytes[from + i]!;
    },
    legendStops: () => stops,
  };
}

/** A CSS color as read for drawing, as RGBA bytes; syntax `cssColor` does not read (`color-mix()`), transparent. */
function rgba(color: string): [number, number, number, number] {
  const [r, g, b, a] = cssColor(color) ?? [0, 0, 0, 0];
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(a * 255)];
}

/** A stretch of the number line, and whether each end belongs to it. */
interface Stretch {
  readonly from: number;
  readonly to: number;
  readonly fromIn: boolean;
  readonly toIn: boolean;
}

/**
 * A key of the colors number field `shown`'s display gives its values, as
 * values are colored along the number line: its mappings with colors, in
 * order, then its steps (the base, where it has a color, first), each
 * named by its mapping's text, else by what of its range earlier mappings
 * leave it, its ends in the display's format (`write`, without mappings):
 * "< 200ms", "200ms – 500ms", "≥ 500ms", "> 500ms" where a mapping takes
 * 500ms. An entry left nothing is left out; a value mapping takes one
 * value and cuts no range around it. Missing values are not drawn by the
 * marks keys explain, so the key leaves them out. Colors are read by `paint`.
 */
export function colorKey(
  shown: ShownField,
  display: ResolvedDisplay,
  write: Formatter,
  paint: (color: string) => string,
): GlyphKey | undefined {
  const entries: GlyphKey["entries"] = [];
  const add = (label: string, color: string) =>
    entries.push({ label, ...SWATCH, color: paint(color) });
  const range = ({ from, to, fromIn, toIn }: Stretch) =>
    from === -Infinity
      ? to === Infinity
        ? "all values"
        : `${toIn ? "≤" : "<"} ${write(to)}`
      : to === Infinity
        ? `${fromIn ? "≥" : ">"} ${write(from)}`
        : from === to
          ? write(from)
          : `${write(from)} – ${write(to)}`;
  // What earlier ranges take of the number line, and what mappings with colors keep of theirs.
  const taken: Stretch[] = [];
  let colored: Stretch[] = [];
  const values = new Set<number>();
  for (const mapping of display.mappings ?? []) {
    // A range of one value maps it as a value mapping does.
    const ends = mapping.between as readonly [number | null, number | null] | undefined;
    const one =
      mapping.value ?? (ends && ends[0] !== null && ends[0] === ends[1] ? ends[0] : undefined);
    if (one !== undefined) {
      const value = one as number;
      const free = !values.has(value) && !taken.some((stretch) => holds(stretch, value));
      values.add(value);
      if (free && mapping.color !== undefined) add(mapping.text ?? write(value), mapping.color);
      continue;
    }
    const [from, to] = ends!;
    const own = { from: from ?? -Infinity, to: to ?? Infinity, fromIn: true, toIn: true };
    const left = without([own], taken);
    taken.push(own);
    if (mapping.color === undefined || left.length === 0) continue;
    colored = [...colored, ...left];
    add(mapping.text ?? left.map(range).join(", "), mapping.color);
  }
  const { steps } = shown;
  if (steps) {
    const { values: at, colors, base } = steps;
    // A step takes its value, not the next step's: "< 200ms" below the first.
    const bands: [Stretch, string | undefined][] = [
      [{ from: -Infinity, to: at[0]!, fromIn: false, toIn: false }, base],
      ...at.map((from, i): [Stretch, string] => [
        { from, to: at[i + 1] ?? Infinity, fromIn: true, toIn: false },
        colors[i]!,
      ]),
    ];
    for (const [band, color] of bands) {
      if (color === undefined) continue;
      const left = without([band], colored);
      if (left.length > 0) add(left.map(range).join(", "), color);
    }
  }
  return entries.length > 0 ? { title: shown.label, channel: "color", entries } : undefined;
}

/** Whether `stretch` holds `value`. */
function holds({ from, to, fromIn, toIn }: Stretch, value: number): boolean {
  return (value > from && value < to) || (value === from && fromIn) || (value === to && toIn);
}

/** `stretches` without what `cut` covers, keeping what is left, a point where both its ends belong. */
function without(stretches: readonly Stretch[], cut: readonly Stretch[]): Stretch[] {
  let out = [...stretches];
  for (const c of cut)
    out = out.flatMap((s): Stretch[] => {
      const apart =
        c.to < s.from ||
        c.from > s.to ||
        (c.to === s.from && !(c.toIn && s.fromIn)) ||
        (c.from === s.to && !(c.fromIn && s.toIn));
      if (apart) return [s];
      return [
        { from: s.from, to: c.from, fromIn: s.fromIn, toIn: !c.fromIn },
        { from: c.to, to: s.to, fromIn: !c.toIn, toIn: s.toIn },
      ].filter(({ from, to, fromIn, toIn }) => to > from || (to === from && fromIn && toIn));
    });
  return out;
}

/** The colors category values take from the displays of every field standing for them. */
export interface MappedColors {
  /** Field `field` of `table` stands for values keyed under `prefix` (see model/identity.ts). */
  read(prefix: string, table: Table | undefined, field: string): void;
  /**
   * The display color of `value` under `prefix` (null for a missing value):
   * the one its fields' displays give it, undefined where none does, and
   * refused where two give it different colors (one value has one color,
   * whichever field draws it).
   */
  color(prefix: string, value: string | null): string | undefined;
  /** The display color of the value an identity key names, as `color` gives it. */
  key(key: string): string | undefined;
}

/**
 * The display colors of category values of a chart, through its displays
 * (`fields`), with `refuse` making the chart's error for a value two
 * displays color differently. Each value's color is worked out once, from
 * every field read for it before the first is asked for (fields are read
 * as marks are compiled, colors asked for as they are drawn).
 */
export function mappedColors(
  fields: ChartFields,
  refuse: (message: string) => Error,
): MappedColors {
  const readers = new Map<string, [Table | undefined, string][]>();
  const found = new Map<string, string | undefined>();
  const color = (prefix: string, value: string | null) => {
    const at = `${prefix}${JSON.stringify(value)}`;
    if (found.has(at)) return found.get(at);
    let given: [string, ShownField] | undefined;
    for (const [table, field] of readers.get(prefix) ?? []) {
      const shown = fields.of(table, field);
      const one = shown?.kind === "category" ? shown.color?.(value) : undefined;
      if (one === undefined || one === given?.[0]) continue;
      if (given)
        throw refuse(
          `chart fields: ${JSON.stringify(value)} of ${JSON.stringify(field)} is ${JSON.stringify(given[0])} (${given[1].from.mappings}) and ${JSON.stringify(one)} (${shown!.from.mappings}); one value has one color`,
        );
      given = [one, shown!];
    }
    found.set(at, given?.[0]);
    return given?.[0];
  };
  return {
    read(prefix, table, field) {
      const list = readers.get(prefix) ?? [];
      if (!list.some(([t, f]) => t === table && f === field)) list.push([table, field]);
      readers.set(prefix, list);
    },
    color,
    key(key) {
      const at = key.lastIndexOf(',"value":') + 9;
      return at > 8 ? color(key.slice(0, at), JSON.parse(key.slice(at, -1)) as string) : undefined;
    },
  };
}

/**
 * The steps `place` stands at in a chart with displays `fields`, whose
 * marks read `tables`: those its field's display gives, in the table
 * `place` names, else in every table read that has the field (refused
 * where two take different steps), else in a field of no table; undefined
 * where none gives the field thresholds. With the field's display, which
 * labels write steps' values through. `at` ("rule (mark 1) y.thresholds")
 * names the place in messages.
 */
export function stepsAt(
  fields: ChartFields,
  place: AtThresholds,
  tables: readonly Table[],
  at: string,
): { steps: Steps; shown: ShownField } | undefined {
  const name = place.thresholds;
  const given = place.table;
  const named = (table: Table) =>
    table.name === undefined ? "an unnamed table" : JSON.stringify(table.name);
  let candidates: (Table | undefined)[];
  if (given === undefined) {
    candidates = tables.filter((table) => table.has(name) && table.kind(name) === "number");
    if (candidates.length === 0) candidates = [undefined];
  } else {
    const table =
      typeof given === "string" ? tables.find((one) => one.name === given) : sourceTable(given);
    if (!table)
      throw new Error(
        `${at}.table: the chart's marks read no table ${JSON.stringify(given)}; give the name of one`,
      );
    if (!table.has(name))
      throw new Error(
        `${at}: table ${named(table)} has no field ${JSON.stringify(name)}; give a table whose ${name} has thresholds`,
      );
    candidates = [table];
  }
  let found: { steps: Steps; shown: ShownField; table: Table | undefined } | undefined;
  for (const table of candidates) {
    const shown = table ? fields.of(table, name) : fields.named(name);
    const steps = shown?.steps;
    if (!steps) continue;
    if (found && JSON.stringify(found.steps) !== JSON.stringify(steps))
      throw new Error(
        `${at}: ${JSON.stringify(name)} of ${named(found.table!)} and of ${named(table!)} take different thresholds; give table`,
      );
    found ??= { steps, shown: shown!, table };
  }
  return found;
}

/** A row view's table, or the table itself. */
function sourceTable(table: Table | RowView): Table {
  return "source" in table ? table.source : table;
}
