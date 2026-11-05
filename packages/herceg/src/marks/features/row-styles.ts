// Looks of marks whose rows each draw something (bars): channels and
// `style.by` per row. A row's look is found from small integers (a field's
// dictionary code, a condition's truth), never an object per row: rows
// with the same channel values share one look, and a series draws a
// geometry per look its rows take. A list ending in the series' color (see
// `seriesTail`) gives its rows' looks by its other entries, and rows none
// of them gives an output the series' look.

import type { Table } from "../../data/table.ts";
import type { ChartFields } from "../../fields/chart.ts";
import type { MarkFeatures, RowLooks, RowPaint } from "../../model/features.ts";
import type { EncodingsSpec, SeriesStyle, StyleMapSpec } from "../../spec/encoding.ts";
import type { PaintReader, Theme } from "../../theme.ts";
import type { GlyphKey } from "../mark.ts";
import type { MarkRows } from "../rows.ts";
import type { Series } from "../series.ts";
import { wholeTable } from "./channel-scales.ts";
import {
  type Channel,
  type Check,
  categoryField,
  channelRevision,
  colorShortForm,
  compileChannel,
  displayFields,
  outputCheck,
  rowReader,
  type ScaleOf,
  seriesTail,
} from "./channels.ts";
import { subset } from "./runs.ts";

/** The options of a mark's spec its rows' looks come from. */
export interface RowStyleSpec {
  series?: string;
  color?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  encode?: EncodingsSpec;
  style?: { by?: StyleMapSpec };
}

/** A part of a row's look: how many values it takes, and each row's. */
interface Part {
  count: number;
  /** A row's value, from 0 to `count` - 1. */
  at(row: number): number;
}

/** The looks of a mark's rows, compiled. */
export class RowStyles {
  readonly #table: Table;
  /** The rows the mark draws (marks/rows.ts): only theirs are read and checked. */
  readonly #drawn: () => MarkRows;
  readonly #spec: RowStyleSpec;
  readonly #fill: Channel<string> | undefined;
  readonly #stroke: Channel<string> | undefined;
  readonly #width: Channel<number> | undefined;
  readonly #opacity: Channel<number> | undefined;
  /** The entries ending lists that color the series: fill, stroke, width, opacity (see `seriesTail`). */
  readonly #tails: readonly (Channel<unknown> | undefined)[];
  /** Each channel's check and option, for the values identity scales read. */
  readonly #checks: { check: Check; path: string }[];
  readonly #by: { field: string; map: StyleMapSpec["map"] } | undefined;
  readonly #path: string;
  /** Whether rows have looks of their own; otherwise looks are by series, through the palette. */
  readonly byRow: boolean;
  /** The chart's field displays, which name keys and write their values. */
  readonly #fields: ChartFields | undefined;
  #theme: Theme | undefined;
  #paint: PaintReader = (value) => value;
  /** Each series' looks, by its key, for the rows' looks they were found from. */
  readonly #rows = new Map<
    string,
    {
      looks: object;
      rows: Series["rows"];
      length: number;
      parts: { paints: readonly RowPaint[]; of(row: number): number };
    }
  >();
  /** Kept for a table version and the rows drawn, until the theme or paint reader changes (`use`). */
  #keys: { version: number; subset: string | undefined; keys: GlyphKey[] } | undefined;
  /** The looks `looks()` last painted, and their paints with colors read. */
  #paintedOf: object | undefined;
  #paintedLooks: RowPaint[] = [];
  #looks:
    | {
        version: number;
        subset: string | undefined;
        /** The revisions of the channel scales read (`channelRevision`). */
        scaled: number;
        of: Int32Array;
        paints: RowPaint[];
      }
    | undefined;

  constructor(
    spec: RowStyleSpec,
    table: Table,
    drawn: () => MarkRows,
    scales: ScaleOf,
    path: string,
    isColor: (value: string) => boolean,
    fields?: ChartFields,
  ) {
    this.#fields = fields;
    this.#table = table;
    this.#drawn = drawn;
    this.#spec = spec;
    this.#path = path;
    const encode = spec.encode ?? {};
    const both = (flat: keyof RowStyleSpec, channel: keyof EncodingsSpec) => {
      if (spec[flat] !== undefined && encode[channel] !== undefined)
        throw new Error(`${path} ${flat}: set as ${flat} and as encode.${channel}; give one`);
    };
    both("color", "color");
    both("fill", "fill");
    both("stroke", "stroke");
    both("strokeWidth", "strokeWidth");
    both("opacity", "opacity");
    const color =
      encode.color ??
      (spec.color === undefined
        ? undefined
        : colorShortForm(spec.color, table, `${path} color`, isColor));
    const at = (name: string) =>
      `${path} ${name === "color" && !encode.color ? "color" : `encode.${name}`}`;
    const colorValue = outputCheck("color", isColor);
    const width = outputCheck("strokeWidth", isColor);
    const fraction = outputCheck("opacity", isColor);
    // A fill set flat wins over the color channel.
    const fill = spec.fill === undefined ? (encode.fill ?? color) : undefined;
    const fillPath = at(encode.fill ? "fill" : "color");
    const split = <V>(channel: Channel<V> | undefined) => seriesTail(channel, spec.series);
    const [fillRows, fillTail] = split(
      fill && compileChannel(fill, table, scales, "color", colorValue, fillPath),
    );
    const [strokeRows, strokeTail] = split(
      encode.stroke &&
        compileChannel(encode.stroke, table, scales, "color", colorValue, at("stroke")),
    );
    const [widthRows, widthTail] = split(
      encode.strokeWidth &&
        compileChannel(
          encode.strokeWidth,
          table,
          scales,
          "strokeWidth",
          width,
          at("strokeWidth"),
          "strokeWidth",
        ),
    );
    const [opacityRows, opacityTail] = split(
      encode.opacity &&
        compileChannel(
          encode.opacity,
          table,
          scales,
          "opacity",
          fraction,
          at("opacity"),
          "opacity",
        ),
    );
    this.#fill = fillRows;
    this.#stroke = strokeRows;
    this.#width = widthRows;
    this.#opacity = opacityRows;
    this.#tails = [fillTail, strokeTail, widthTail, opacityTail];
    this.#checks = [
      { check: colorValue, path: fillPath },
      { check: colorValue, path: at("stroke") },
      { check: width, path: at("strokeWidth") },
      { check: fraction, path: at("opacity") },
    ];
    const by = spec.style?.by;
    if (by?.field !== undefined && by.field !== spec.series)
      this.#by = { field: categoryField(table, by.field, `${path} style.by.field`), map: by.map };
    const rowWise = (c: Channel<unknown> | undefined) =>
      c !== undefined &&
      (c.kind === "condition" ||
        c.kind === "list" ||
        c.kind === "identity" ||
        c.kind === "scaled" ||
        c.kind === "display" ||
        (c.kind === "field" && c.field !== spec.series));
    this.byRow =
      [this.#fill, this.#stroke, this.#width, this.#opacity].some(rowWise) ||
      this.#by !== undefined;
  }

  /** The number fields whose display colors fill and outline the rows, read without a scale. */
  get displayColors(): string[] | undefined {
    const fields = [this.#fill, this.#stroke].flatMap(displayFields);
    return fields.length > 0 ? fields : undefined;
  }

  /** Reads `theme`'s palette for values the scales do not map, and colors by `paint`. */
  use(theme: Theme, paint: PaintReader): void {
    if (theme !== this.#theme || paint !== this.#paint) {
      this.#keys = undefined;
      this.#looks = undefined;
    }
    this.#theme = theme;
    this.#paint = paint;
  }

  /** A look with its colors read, as the mark's. */
  #painted(look: RowPaint): RowPaint {
    const { fill, stroke } = look;
    if (fill === undefined && stroke === undefined) return look;
    const path = this.#path;
    return {
      ...look,
      ...(fill !== undefined && { fill: this.#paint(fill, `${path} fill`) }),
      ...(stroke !== undefined && { stroke: this.#paint(stroke, `${path} stroke`) }),
    };
  }

  /**
   * The color the palette gives a series of `name`: its style map's, its
   * channel's, the theme's muted color where rows have colors of their own
   * (as legends list the series), or the palette's (undefined).
   */
  color(name: string, given: string | undefined, label?: string): string | undefined {
    const by = this.#spec.style?.by;
    const mapped =
      by && (by.field === undefined || by.field === this.#spec.series)
        ? own(by.map, name)?.fill
        : undefined;
    if (mapped !== undefined) return mapped;
    if (given !== undefined) return given;
    const fill = (this.#tails[0] ?? this.#fill) as Channel<string> | undefined;
    const theme = this.#theme;
    const muted = theme?.muted ?? "#999999";
    const output = this.#seriesOutput(fill, name, label, theme?.palette ?? [], muted);
    return output ?? (fill ? theme?.muted : undefined);
  }

  /**
   * What a channel coloring series gives the series of `name` (its label
   * `label`): a constant, its name through a scale, or the series field's
   * value through one; undefined for other channels.
   */
  #seriesOutput<V>(
    channel: Channel<V> | undefined,
    name: string,
    label: string | undefined,
    defaults: readonly V[],
    fallback: V,
  ): V | undefined {
    if (channel?.kind === "value") return channel.value;
    if (channel?.kind === "series") return channel.scale.output(label ?? name, defaults, fallback);
    if (channel?.kind === "field" && channel.field === this.#spec.series)
      return channel.scale.output(name, defaults, fallback);
    return undefined;
  }

  /** Whether the fill's list ends in the series' color, which their swatches show. */
  get tailed(): boolean {
    return this.#tails[0] !== undefined;
  }

  /**
   * Keys of the colors fields other than the series field give rows, alone
   * or as a list's entries (see `categoryKey`), for the table's version.
   * Keys of display colors are the chart's (`displayColors`).
   */
  keys(lists = false): GlyphKey[] {
    const fills = this.#keyedFields(lists);
    if (fills.length === 0) return [];
    const table = this.#table;
    const rows = this.#drawn();
    const drawn = subset(rows);
    if (this.#keys?.version === table.version && this.#keys.subset === drawn)
      return this.#keys.keys;
    const keys = fills.flatMap(
      (fill) =>
        categoryKey(fill, rows, this.#theme, this.#paint, `${this.#path} fill`, this.#fields) ?? [],
    );
    this.#keys = { version: table.version, subset: drawn, keys };
    return keys;
  }

  /** Whether `keys(lists)` gives keys where rows are drawn, by the channels alone. */
  hasKeys(lists = false): boolean {
    return this.#keyedFields(lists).length > 0;
  }

  #keyedFields(lists: boolean) {
    // An outline's list keys its scales too (an outline's field alone does
    // not, as before lists); with `lists`, so does a fill's list alone.
    const of = (c: Channel<string> | undefined, alone: boolean) =>
      alone || c?.kind === "list" ? keyedFields(c, this.#spec.series) : [];
    return [...of(this.#fill, !lists), ...of(this.#stroke, false)].filter(
      (c, i, all) => all.findIndex((f) => f.field === c.field && f.scale === c.scale) === i,
    );
  }

  /** A series' look by its name (`style.by` without a field), over the mark's. */
  seriesStyle(name: string): SeriesStyle | undefined {
    const by = this.#spec.style?.by;
    return by && (by.field === undefined || by.field === this.#spec.series)
      ? own(by.map, name)
      : undefined;
  }

  /**
   * What a series' channels give all its rows: outputs for its name
   * (`{ series: true }`, by its label), and where rows have no looks of
   * their own, constants and outputs for its value (`name`).
   */
  #seriesPaint(name: string, label: string): RowPaint | undefined {
    const theme = this.#theme;
    const byRow = this.byRow;
    // A list's tail colors the series' rows other entries give no output.
    const value = <V>(
      channel: Channel<V> | undefined,
      tail: Channel<unknown> | undefined,
      defaults: readonly V[],
      fallback: V,
    ) =>
      tail || channel?.kind === "series" || !byRow
        ? this.#seriesOutput((tail as Channel<V>) ?? channel, name, label, defaults, fallback)
        : undefined;
    const [, stroke, width, opacity] = this.#tails;
    const paint = definedOf({
      stroke: value(this.#stroke, stroke, theme?.palette ?? [], theme?.muted ?? "#999999"),
      strokeWidth: value(this.#width, width, [], 1),
      opacity: value(this.#opacity, opacity, [], 1),
    });
    return Object.keys(paint).length ? paint : undefined;
  }

  /**
   * The looks a series' rows take, and which each takes: its rows' own
   * over what its channels give them all, under its style map's.
   */
  rows(
    s: Series,
    name: string,
  ): { paints: readonly RowPaint[]; of(row: number): number } | undefined {
    const looks = this.#read();
    const all = this.#seriesPaint(name, s.label);
    const series = this.seriesStyle(name);
    if (!looks) {
      const paint = { ...all, ...(series && definedOf(series)) };
      return Object.keys(paint).length
        ? { paints: [this.#painted(paint)], of: () => 0 }
        : undefined;
    }
    // Kept per series while the rows' looks are the same.
    const kept = this.#rows.get(s.key);
    if (kept && kept.looks === looks && kept.rows === s.rows && kept.length === s.length)
      return kept.parts;
    // A series draws the looks its rows take, in the order they first take
    // them; its own style over theirs may make some alike, which share one.
    const parts = new Map<number, number>();
    const alike = new Map<string, number>();
    const paints: RowPaint[] = [];
    for (let k = 0; k < s.length; k++) {
      const look = looks.of[s.rows ? s.rows[k]! : k]!;
      if (parts.has(look)) continue;
      let paint = looks.paints[look]!;
      if (all) paint = { ...all, ...definedOf(paint) };
      if (series) paint = { ...paint, ...definedOf(series) };
      paint = this.#painted(paint);
      const content = JSON.stringify(paint);
      let part = alike.get(content);
      if (part === undefined) {
        part = paints.push(paint) - 1;
        alike.set(content, part);
      }
      parts.set(look, part);
    }
    const out = { paints, of: (row: number) => parts.get(looks.of[row]!) ?? 0 };
    this.#rows.set(s.key, { looks, rows: s.rows, length: s.length, parts: out });
    return out;
  }

  /**
   * For marks drawing a shape per row without series (regions): each row's
   * look with its colors read, for the table's version and the rows drawn;
   * one look for every row where channels are constants; undefined for no
   * channels.
   */
  looks(): RowLooks | undefined {
    const looks = this.#read();
    if (!looks) {
      // Channels that read no rows give every row their one look.
      const value = <V>(c: Channel<V> | undefined) => (c?.kind === "value" ? c.value : undefined);
      const paint = definedOf({
        fill: value(this.#fill),
        stroke: value(this.#stroke),
        strokeWidth: value(this.#width),
        opacity: value(this.#opacity),
      });
      return Object.keys(paint).length > 0
        ? { paints: [this.#painted(paint)], of: () => 0 }
        : undefined;
    }
    if (this.#paintedOf !== looks) {
      this.#paintedOf = looks;
      this.#paintedLooks = looks.paints.map((paint) => this.#painted(paint));
    }
    const paints = this.#paintedLooks;
    return { paints, of: (row) => looks.of[row]! };
  }

  /**
   * Each drawn row's look, for the table's version and the rows drawn: an
   * index into `paints`. Rows the mark does not draw are not read (their
   * identity values are not checked), and keep look 0.
   */
  #read(): { of: Int32Array; paints: RowPaint[] } | undefined {
    if (!this.byRow) return undefined;
    const table = this.#table;
    const theme = this.#theme;
    const rows = this.#drawn();
    const drawn = subset(rows);
    const scaled = channelRevision([this.#fill, this.#stroke, this.#width, this.#opacity]);
    if (
      this.#looks?.version === table.version &&
      this.#looks.subset === drawn &&
      this.#looks.scaled === scaled
    )
      return this.#looks;
    const palette = theme?.palette ?? [];
    const muted = theme?.muted ?? "#999999";
    const [fill, stroke, width, opacity] = this.#checks;
    const { positions } = rows;
    const channels = [
      rowReader(this.#fill, table, palette, muted, fill!.check, fill!.path, true, positions),
      rowReader(this.#stroke, table, palette, muted, stroke!.check, stroke!.path, true, positions),
      rowReader(this.#width, table, [], 1, width!.check, width!.path, true, positions),
      rowReader(this.#opacity, table, [], 1, opacity!.check, opacity!.path, true, positions),
    ];
    const by = this.#by;
    const byPart = by && this.#codes(by.field);
    const parts: Part[] = [...channels, ...(byPart ? [byPart] : [])];
    // Rows' looks numbered by their parts' values, in the order rows take them;
    // values that give the same paint share one look.
    const of = new Int32Array(table.length);
    const numbers = new Map<number, number>();
    const interned = new Map<string, number>();
    const paints: RowPaint[] = [];
    this.#rows.clear();
    // Past exact integers, ids are their parts' values written out.
    const exact = parts.reduce((size, part) => size * part.count, 1) <= Number.MAX_SAFE_INTEGER;
    const ids = new Map<string, number>();
    const count = positions ? positions.length : of.length;
    for (let k = 0; k < count; k++) {
      const row = positions ? positions[k]! : k;
      let id = 0;
      if (exact) for (const part of parts) id = id * part.count + part.at(row);
      else id = ids.get(parts.map((part) => part.at(row)).join()) ?? ids.size;
      if (!exact) ids.set(parts.map((part) => part.at(row)).join(), id);
      let look = numbers.get(id);
      if (look === undefined) {
        const [fill, stroke, strokeWidth, opacity] = channels.map((c) => c.output(row));
        let paint: RowPaint = {
          fill: fill as string | undefined,
          stroke: stroke as string | undefined,
          strokeWidth: strokeWidth as number | undefined,
          opacity: opacity as number | undefined,
        };
        if (by && byPart) {
          const code = this.#table.categories(by.field as never).codes[row]!;
          const value =
            code < 0 ? undefined : this.#table.categories(by.field as never).dictionary[code];
          const style = value === undefined ? undefined : own(by.map, value);
          if (style) paint = { ...paint, ...definedOf(style) };
        }
        const content = JSON.stringify(paint);
        look = interned.get(content);
        if (look === undefined) {
          look = paints.length;
          interned.set(content, look);
          paints.push(paint);
        }
        numbers.set(id, look);
      }
      of[row] = look;
    }
    this.#looks = { version: table.version, subset: drawn, scaled, of, paints };
    return this.#looks;
  }

  /** A field's dictionary codes as a part of rows' looks. */
  #codes(field: string): Part {
    const { codes, dictionary } = this.#table.categories(field as never);
    return { count: dictionary.length + 1, at: (row) => codes[row]! + 1 };
  }
}

/**
 * The category fields a channel reads through scales, other than the series
 * field, whose colors keys show: the channel's own, or each a list reads
 * (once per field and scale; a scale read in a list keys its values, though
 * rows taking an earlier entry's output do not show them).
 */
export function keyedFields<V>(
  channel: Channel<V> | undefined,
  series: string | undefined,
): Extract<Channel<V>, { kind: "field" }>[] {
  const fields: Extract<Channel<V>, { kind: "field" }>[] = [];
  // A list's entries before a tail coloring the series are each keyed, the series field's too.
  const listed = channel?.kind === "list";
  for (const c of listed ? channel.entries : [channel])
    if (
      c?.kind === "field" &&
      (listed || c.field !== series) &&
      !fields.some((f) => f.field === c.field && f.scale === c.scale)
    )
      fields.push(c);
  return fields;
}

/**
 * A key of the colors `channel` gives the rows a mark draws (`rows`): the
 * values they hold, in the scale's order, written as the field's display
 * writes them; undefined for none.
 */
export function categoryKey(
  channel: Extract<Channel<string>, { kind: "field" }>,
  rows: MarkRows,
  theme: Theme | undefined,
  paint: PaintReader,
  path: string,
  fields: ChartFields | undefined,
): GlyphKey | undefined {
  const { table, positions } = rows;
  const { codes, dictionary } = table.categories(channel.field as never);
  const held = new Uint8Array(dictionary.length);
  const count = positions ? positions.length : codes.length;
  for (let k = 0; k < count; k++) {
    const code = codes[positions ? positions[k]! : k]!;
    if (code >= 0) held[code] = 1;
  }
  const values = dictionary.filter((_, code) => held[code]);
  if (values.length === 0) return undefined;
  const place = (value: string) => channel.scale.place(value) ?? Infinity;
  values.sort((a, b) => place(a) - place(b));
  const palette = theme?.palette ?? [];
  const muted = theme?.muted ?? "#999999";
  const raw: GlyphKey = {
    title: channel.field,
    channel: "color",
    scale: channel.scale.name,
    entries: values.map((label) => ({
      label,
      glyph: "M-4.5 -4.5h9v9h-9Z",
      r: 4.5,
      color: paint(channel.scale.output(label, palette, muted), path),
    })),
  };
  // Named and written as the field's display writes them.
  return fields?.key(table, channel.field, raw) ?? raw;
}

/**
 * The looks of a mark drawing a shape per row of its table, without series
 * (regions): its rows' channels (`encode`), read as bars' rows are.
 */
export function rowLooks(
  spec: RowStyleSpec,
  table: Table | undefined,
  scales: ScaleOf,
  path: string,
  isColor: (value: string) => boolean,
): Pick<MarkFeatures, "displayColors" | "listKeys"> & {
  use(theme: Theme, paint: PaintReader): void;
  rowLooks(): RowLooks | undefined;
} {
  if (!table)
    throw new Error(
      `${path} encode: channels read the rows of a table; give the mark one, or drop encode`,
    );
  for (const [name, channel] of Object.entries(spec.encode ?? {}))
    for (const [i, c] of (Array.isArray(channel) ? channel : [channel]).entries())
      if (c && "series" in c)
        throw new TypeError(
          `${path} encode.${name}${Array.isArray(channel) ? `[${i}]` : ""}: regions have no series whose names it could read; give a field, a value, or a condition`,
        );
  // Every row of the table, kept while its version is.
  let rows: MarkRows | undefined;
  const drawn = () => {
    if (rows?.revision !== String(table.version)) rows = wholeTable(table);
    return rows;
  };
  const styles = new RowStyles(spec, table, drawn, scales, path, isColor);
  return {
    use: (theme, paint) => styles.use(theme, paint),
    rowLooks: () => styles.looks(),
    displayColors: styles.displayColors,
    // Scales a list reads key their values (a field alone does not: a region's legend lists labels).
    ...(styles.hasKeys(true) && { listKeys: () => styles.keys(true) }),
  };
}

/** A series style's or a look's paint properties it sets. */
function definedOf(style: SeriesStyle | RowPaint): RowPaint {
  const out: { -readonly [K in keyof RowPaint]: RowPaint[K] } = {};
  for (const name of PAINT) if (style[name] !== undefined) out[name] = style[name] as never;
  return out;
}

const PAINT = [
  "fill",
  "stroke",
  "strokeWidth",
  "dash",
  "opacity",
  "fillOpacity",
  "strokeOpacity",
] as const;

/** A map's own entry, not one objects inherit (`"constructor"`). */
export function own<T>(map: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}
