// Points' channels, compiled (see `PointChannels`): what a channel reading
// a field through a scale, an identity scale, or a condition gives each row
// (`PointLooks`), for the table's current version. Rows read small integers
// (a field's dictionary code, a condition's truth) or, through an identity
// scale of numbers, their value: nothing is made per row. Points leave out
// a row missing a value a channel reads, as they leave out rows missing any
// value they encode; a value a scale leaves unmapped takes the channel's
// fallback: the theme's muted color, no shape drawn, the mark's own size,
// opaque.

import type { Table } from "../../data/table.ts";
import { CYCLE, SYMBOLS, symbolReach } from "../../draw/symbol-shapes.ts";
import type { FeatureKit, PointChannel, PointChannels, PointLooks } from "../../model/features.ts";
import type { ChannelName } from "../../spec/channels.ts";
import type { SymbolName } from "../../spec/encoding.ts";
import type { PaintReader, Theme } from "../../theme.ts";
import type { GlyphKey } from "../mark.ts";
import type { MarkRows } from "../rows.ts";
import { type Channel, type Check, compileChannel, outputCheck, type ScaleOf } from "./channels.ts";
import { markerPath } from "./markers.ts";
import { subset } from "./runs.ts";

/** Legend glyphs: circles of this radius, other shapes reaching at most KEY_REACH (as points' series). */
const KEY_RADIUS = 4.5;
const KEY_REACH = 6;
/** The shapes symbol fields take in turn. */
const SHAPES = SYMBOLS.slice(0, CYCLE);

/** A channel compiled, with the check of its outputs and its option's path. */
interface Compiled<V> {
  readonly channel: Channel<V>;
  readonly check: Check;
  readonly path: string;
}

/** A channel's output for each row, as a number: a palette index, an area, a shape's index. */
type Rows = (row: number) => number;

export class PointStyles {
  readonly #kit: FeatureKit;
  readonly #table: Table;
  readonly #own: PointChannels;
  /** The field the mark's series are split by. */
  readonly #series: string | undefined;
  /** The color channel, where rows take colors of their own; else the series' colors are its. */
  readonly #color: Compiled<string> | undefined;
  readonly #seriesColor: Channel<string> | undefined;
  readonly #size: Compiled<number> | undefined;
  readonly #opacity: Compiled<number> | undefined;
  readonly #symbol: Compiled<SymbolName> | undefined;
  /** The rows the mark draws (marks/rows.ts), which checks, keys, and reach read. */
  readonly #rows: () => MarkRows;
  #theme: Theme | undefined;
  #paint: PaintReader = (value) => value;
  #looks: { version: number; subset: string | undefined; looks: PointLooks } | undefined;

  constructor(
    kit: FeatureKit,
    own: PointChannels,
    table: Table,
    rows: () => MarkRows,
    scales: ScaleOf,
    path: string,
    series: string | undefined,
  ) {
    this.#kit = kit;
    this.#table = table;
    this.#rows = rows;
    this.#own = own;
    this.#series = series;
    const compile = <V>(
      given: PointChannel<V> | undefined,
      name: ChannelName,
    ): Compiled<V> | undefined => {
      if (!given) return undefined;
      const at = `${path} ${given.path}`;
      const { spec } = given;
      if (name !== "color" && "series" in spec)
        throw new TypeError(
          `${at}: { series: true } names series through a scale, which points' ${name === "symbol" ? "shapes" : "sizes and opacities"} do not read; give a field`,
        );
      // Categories' sizes and opacities have no default: a scale says them.
      if (
        (name === "size" || name === "opacity") &&
        "field" in spec &&
        spec.scale === undefined &&
        table.kind(spec.field) === "category"
      )
        throw new TypeError(
          `${at}.field: field "${spec.field}" holds categories, which ${name === "size" ? "sizes" : "opacities"} read through a scale mapping them; give scale, the name of one of the chart's scales`,
        );
      const check = outputCheck(name, kit.isColor);
      return {
        channel: compileChannel(spec, table, scales, name, check, at, name),
        check,
        path: at,
      };
    };
    const color = compile(own.color, "color");
    // A constant, the series field, and the series' names color series, not rows.
    const bySeries =
      color &&
      (color.channel.kind === "value" ||
        color.channel.kind === "series" ||
        (color.channel.kind === "field" && color.channel.field === series));
    this.#color = bySeries ? undefined : color;
    this.#seriesColor = bySeries ? color.channel : undefined;
    this.#size = compile(own.size, "size");
    this.#opacity = compile(own.opacity, "opacity");
    this.#symbol = compile(own.symbol, "symbol");
  }

  /** Reads `theme`'s palette for values the scales do not map, and colors by `paint`. */
  use(theme: Theme, paint: PaintReader): void {
    if (theme !== this.#theme || paint !== this.#paint) this.#looks = undefined;
    this.#theme = theme;
    this.#paint = paint;
  }

  /**
   * The color of the series of `name` (its label `label`): its channel's,
   * where the channel colors series; the theme's muted color where rows
   * have colors of their own (as legends list the series); else undefined.
   */
  seriesColor(name: string, label: string | undefined): string | undefined {
    const theme = this.#theme;
    if (this.#color) return theme?.muted;
    const channel = this.#seriesColor;
    if (!channel || !theme) return undefined;
    if (channel.kind === "value") return channel.value;
    if (channel.kind !== "field" && channel.kind !== "series") return undefined;
    const value = channel.kind === "series" ? (label ?? name) : name;
    return channel.scale.output(value, theme.palette, theme.muted);
  }

  /** How far points reach past their centers at most, outlines included: automatic padding's room. */
  inset(): number {
    return this.looks().reach;
  }

  /** What the channels give each row, for the table's current version and the rows drawn. */
  looks(): PointLooks {
    const table = this.#table;
    const rows = this.#rows();
    const drawn = subset(rows);
    if (this.#looks?.version === table.version && this.#looks.subset === drawn)
      return this.#looks.looks;
    const theme = this.#theme;
    const paint = this.#paint;
    const own = this.#own;
    const colors: string[] = [];
    const indexes = new Map<string, number>();
    const color =
      this.#color &&
      this.#outputs(
        rows,
        this.#color,
        theme?.palette ?? [],
        theme?.muted ?? "#999999",
        (value) => {
          const painted = paint(value, this.#color!.path);
          let index = indexes.get(painted);
          if (index === undefined) {
            index = colors.push(painted) - 1;
            indexes.set(painted, index);
          }
          return index;
        },
        -1,
      );
    const fallback = Math.PI * own.radius * own.radius;
    const area = this.#size && this.#outputs(rows, this.#size, [], fallback, Number, Number.NaN);
    const opacity = this.#opacity && this.#outputs(rows, this.#opacity, [], 1, Number, Number.NaN);
    const shapeOf = (symbol: SymbolName) => SYMBOLS.indexOf(symbol);
    const shape =
      this.#symbol &&
      this.#outputs(rows, this.#symbol, SHAPES, undefined as unknown as SymbolName, shapeOf, -1);
    const symbol = this.#symbol?.channel;
    const looks = {
      color,
      colors,
      area,
      opacity,
      shape,
      seriesShape:
        symbol?.kind === "field" && symbol.field === this.#series
          ? (name: string) => shapeOf(symbol.scale.output(name, SHAPES, "circle"))
          : undefined,
      keys: this.#keys(rows),
      text: (row: number, format: (value: number) => string) => this.#text(row, format),
      reach: this.#reach(rows),
    };
    this.#looks = { version: table.version, subset: drawn, looks };
    return looks;
  }

  /**
   * A channel's output for each row through `of`, `none` for a row missing
   * the value it reads; values a scale leaves unmapped take `fallback`, or
   * where it is undefined, `none`. Identity values are checked at the rows
   * the mark draws.
   */
  #outputs<V>(
    rows: MarkRows,
    { channel, check, path }: Compiled<V>,
    defaults: readonly V[],
    fallback: V | undefined,
    of: (value: V) => number,
    none: number,
  ): Rows {
    const table = this.#table;
    if (channel.kind === "value") {
      const value = of(channel.value);
      return () => value;
    }
    if (channel.kind === "condition") {
      const [then, otherwise] = [of(channel.then), of(channel.otherwise)];
      return (row) => (channel.when(row) ? then : otherwise);
    }
    if (channel.kind === "series") return () => none;
    if (channel.kind === "identity" && channel.numbers) {
      // The values are the outputs, checked over their extent; others are missing.
      const values = table.numbers(channel.field as never);
      for (const value of extentOf(rows, channel.field) ?? []) check(value, `${path}.field`);
      return (row) => (Number.isFinite(values[row]!) ? values[row]! : none);
    }
    const { codes, dictionary } = table.categories(channel.field as never);
    const held = heldCodes(rows, codes, dictionary.length);
    const outputs = dictionary.map((value, code) => {
      if (channel.kind === "identity") {
        // Values of rows the mark does not draw are neither checked nor drawn.
        if (held && !held[code]) return none;
        check(value, `${path}.field`);
      }
      const output =
        channel.kind === "identity"
          ? (value as V)
          : channel.scale.output(value, defaults, fallback as V);
      return output === undefined ? none : of(output);
    });
    return (row) => {
      const code = codes[row]!;
      return code < 0 ? none : outputs[code]!;
    };
  }

  /**
   * Keys of the values field channels map through ordinal scales (none for
   * the series field, which the series' entries show): a declared domain's
   * values, held or not, else the values rows hold, in the scale's order.
   */
  #keys(rows: MarkRows): GlyphKey[] {
    const keys: GlyphKey[] = [];
    const kit = this.#kit;
    const key = <V>(
      compiled: Compiled<V> | undefined,
      channel: GlyphKey["channel"],
      entry: (value: string) => GlyphKey["entries"][number],
    ) => {
      const c = compiled?.channel;
      if (c?.kind !== "field" || c.field === this.#series) return;
      const { codes, dictionary } = this.#table.categories(c.field as never);
      const held = heldCodes(rows, codes, dictionary.length) ?? new Uint8Array(dictionary.length);
      if (!rows.positions) for (const code of codes) if (code >= 0) held[code] = 1;
      const placeOf = (value: string) => c.scale.place(value) ?? Infinity;
      let values = dictionary
        .filter((_, code) => held[code])
        .sort((a, b) => placeOf(a) - placeOf(b));
      // A declared domain whole, then values held outside it.
      const domain = c.scale.spec?.domain;
      if (domain) values = [...domain, ...values.filter((value) => !domain.includes(value))];
      keys.push({
        title: c.field,
        channel,
        scale: c.scale.name,
        entries: values.map((value) => entry(value)),
      });
    };
    const circle = markerPath(kit, "circle", 0, 0, KEY_RADIUS);
    key(this.#color, "color", (label) => {
      const c = this.#color!.channel as Extract<Channel<string>, { kind: "field" }>;
      const theme = this.#theme;
      const output = c.scale.output(label, theme?.palette ?? [], theme?.muted ?? "#999999");
      return { label, glyph: circle, r: KEY_RADIUS, color: this.#paint(output, this.#color!.path) };
    });
    key(this.#symbol, "shape", (label) => {
      const c = this.#symbol!.channel as Extract<Channel<SymbolName>, { kind: "field" }>;
      const shape = c.scale.output(label, SHAPES, undefined as unknown as SymbolName);
      if (shape === undefined) return { label, glyph: "", r: 0 };
      const reach = symbolReach(shape);
      const r = Math.min(KEY_RADIUS, KEY_REACH / reach);
      return { label, glyph: markerPath(kit, shape, 0, 0, r), r: r * reach, shape };
    });
    key(this.#size, "size", (label) => {
      const c = this.#size!.channel as Extract<Channel<number>, { kind: "field" }>;
      const area = c.scale.output(label, [], Math.PI * this.#own.radius ** 2);
      const r = Math.sqrt(area / Math.PI);
      return { label, glyph: markerPath(kit, "circle", 0, 0, r), r };
    });
    return keys;
  }

  /** The values a row's channels read, after its y value in its text: ", kind Threshold". */
  #text(row: number, format: (value: number) => string): string {
    const table = this.#table;
    const named = new Set<string>();
    let text = "";
    for (const compiled of [this.#color, this.#size, this.#opacity, this.#symbol]) {
      const c = compiled?.channel;
      if (!c || (c.kind !== "field" && c.kind !== "identity")) continue;
      if (c.field === this.#series || named.has(c.field)) continue;
      named.add(c.field);
      if (table.kind(c.field) === "category") {
        const { codes, dictionary } = table.categories(c.field as never);
        text += `, ${c.field} ${dictionary[codes[row]!] ?? ""}`;
      } else text += `, ${c.field} ${format(table.numbers(c.field as never)[row]!)}`;
    }
    return text;
  }

  /** How far points reach past their centers at most: the largest radius, by the farthest-reaching shape, and half the outline. */
  #reach(rows: MarkRows): number {
    const own = this.#own;
    const table = this.#table;
    const most = <V>(
      compiled: Compiled<V> | undefined,
      defaults: readonly V[],
      fallback: V,
    ): V[] => {
      const c = compiled?.channel;
      if (!c) return [];
      if (c.kind === "value") return [c.value];
      if (c.kind === "condition") return [c.then, c.otherwise];
      if (c.kind === "identity") {
        if (c.numbers) return (extentOf(rows, c.field) ?? []) as V[];
        const { codes, dictionary } = table.categories(c.field as never);
        const held = heldCodes(rows, codes, dictionary.length);
        return (held ? dictionary.filter((_, code) => held[code]) : dictionary) as V[];
      }
      if (c.kind !== "field") return [];
      // Values the scale leaves unmapped take `unknown`, else the fallback.
      const { map, unknown } = c.scale.spec ?? {};
      return [
        ...defaults,
        ...(Object.values(map ?? {}) as V[]),
        (unknown as V | undefined) ?? fallback,
      ];
    };
    const areas = most(this.#size, [], Math.PI * own.radius ** 2);
    const radius = areas.length > 0 ? Math.sqrt(Math.max(...areas) / Math.PI) : own.radius;
    const shapes = this.#symbol ? most(this.#symbol, SHAPES, own.shape) : [own.shape];
    const reach = Math.max(
      0,
      ...shapes.filter((s) => SYMBOLS.includes(s)).map((s) => symbolReach(s)),
    );
    return radius * reach + own.outline / 2;
  }
}

/**
 * Which categories the rows a mark draws hold, 1 each, where it draws some
 * of its table's rows; undefined where it draws them all.
 */
function heldCodes(rows: MarkRows, codes: Int32Array, count: number): Uint8Array | undefined {
  const { positions } = rows;
  if (!positions) return undefined;
  const held = new Uint8Array(count);
  for (let k = 0; k < positions.length; k++) {
    const code = codes[positions[k]!]!;
    if (code >= 0) held[code] = 1;
  }
  return held;
}

/**
 * The least and greatest finite value of a number field at the rows a mark
 * draws: as `extentAt` (marks/rows.ts) gives it, which this chunk does not
 * import from the line chart's.
 */
function extentOf(rows: MarkRows, field: string): readonly [number, number] | undefined {
  const { table, positions } = rows;
  if (!positions) return table.extent(field as never);
  const values = table.numbers(field as never);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < positions.length; k++) {
    const value = values[positions[k]!]!;
    if (value < min && value > Number.NEGATIVE_INFINITY) min = value;
    if (value > max && value < Number.POSITIVE_INFINITY) max = value;
  }
  return min <= max ? [min, max] : undefined;
}
