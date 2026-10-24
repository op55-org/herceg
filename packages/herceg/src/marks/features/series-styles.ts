// Looks of series of connected marks (lines, areas): their color and paint
// from channels and `style.by`. A channel reading rows (a field other than
// the series', a condition, an identity scale) gives a series runs of looks
// along it (runs.ts), drawn in stretches (run-paths.ts); a style map by a
// field reads the field's value over each series' rows, which must be one,
// checked once, then as rows are appended only the new rows.

import type { Table } from "../../data/table.ts";
import type { FeatureKit } from "../../model/features.ts";
import type { Drawing, Geometry } from "../../scene/scene.ts";
import type { ChannelSpec, EncodingsSpec, SeriesStyle, StyleMapSpec } from "../../spec/encoding.ts";
import type { Dash } from "../../spec/spec.ts";
import type { PaintReader, Theme } from "../../theme.ts";
import type { Series } from "../series.ts";
import {
  type Channel,
  type Check,
  categoryField,
  colorShortForm,
  compileChannel,
  outputCheck,
  rowReader,
  type ScaleOf,
} from "./channels.ts";
import type { Where } from "./compile.ts";
import { firstAfter, type Look, type RunPart, type Runs, StyleRuns } from "./runs.ts";

/** The paint a series takes from the features, over its mark's flat paint. */
export interface SeriesPaint {
  color?: string | undefined;
  stroke?: string | undefined;
  fill?: string | undefined;
  strokeWidth?: number | undefined;
  dash?: Dash | undefined;
  /** The series' opacity, its mark's included. */
  opacity: number;
  strokeOpacity?: number | undefined;
  fillOpacity?: number | undefined;
  style?: SeriesStyle | undefined;
  /** The value of the field coloring the series at every observation, where it is not the series field. */
  value?: string | undefined;
  /** Where its looks change along it, where they do. */
  runs?: Runs | undefined;
  /**
   * With runs: what the series' style map, channels not reading rows, and
   * mark give it, which its runs' looks fall back to (see `look`).
   */
  own?: Omit<Look, "color"> | undefined;
}

/** The options of a line's or area's spec its looks come from. */
export interface SeriesStyleSpec {
  type: string;
  series?: string;
  color?: string;
  stroke?: string;
  fill?: string;
  dash?: Dash;
  strokeWidth?: number;
  opacity?: number;
  strokeOpacity?: number;
  encode?: EncodingsSpec;
  style?: { by?: StyleMapSpec };
}

/** A series' value of a channel: by its rows, its source, or its name. */
type Reader<V> = (s: Series | undefined, id: string, label?: string) => V | undefined;

/**
 * A series' one value of something its rows each have, as last checked:
 * the last row holding it (`evidence`), the last of the series' rows
 * (`seen`), and up to which row of the table (`last`; rows by identity,
 * `rowOffset + position`), in which generation, before which change of
 * existing values, and of the mark's row view, which rows count.
 */
interface Checked {
  value: string | undefined;
  evidence: number;
  seen: number;
  last: number;
  generation: number;
  modified: number;
  view: number | undefined;
}

/**
 * Where a series' color field has the one value its rows read so far end
 * with: since row `since` (by identity, `rowOffset + row`), with code
 * `code`, up to row `last`; in which generation, before which change of
 * existing values, and of the mark's row view, which rows count.
 */
interface Uniform {
  generation: number;
  modified: number;
  view: number | undefined;
  last: number;
  code: number;
  since: number;
}

/**
 * The looks of a connected mark's series, compiled: `primary` is the paint
 * `color` sets (a line's stroke, an area's fill).
 */
export class SeriesStyles {
  readonly #kit: FeatureKit;
  readonly #where: Where;
  readonly #spec: SeriesStyleSpec;
  readonly #table: Table;
  readonly #view: { readonly revision: number } | undefined;
  readonly #primary: "stroke" | "fill";
  readonly #color: Reader<string> | undefined;
  readonly #stroke: Reader<string> | undefined;
  readonly #fill: Reader<string> | undefined;
  readonly #dash: Reader<Dash> | undefined;
  readonly #width: Reader<number> | undefined;
  readonly #opacity: Reader<number> | undefined;
  readonly #by: Reader<SeriesStyle> | undefined;
  /** Whether a series' color needs its rows (a field other than the series field, or a condition). */
  readonly #byRows: boolean;
  /** The runs of channels reading rows, where some do. */
  readonly #runs: StyleRuns | undefined;
  /** The axis the series' positions run along. */
  readonly #along: "x" | "y";
  /** The field the series' color is read from, where it is not the series field. */
  readonly #colorField: string | undefined;
  /** The axis whose positions are bands, where rows without a band are no series' (see `#constant`). */
  readonly #bands: "x" | "y" | undefined;
  /** Each series' checked values, by series key and what they are of. */
  readonly #checked = new Map<string, Checked>();
  /** Each series' color field values (see `#colorValue`), by series key, at the table's version and the one before. */
  #uniform = new Map<string, Uniform>();
  #uniformBefore = new Map<string, Uniform>();
  #uniformAt = -1;
  /** The series field's codes by value, for one table version (see `#codeOf`). */
  #codes: { version: number; dictionary: readonly string[]; of: Map<string, number> } | undefined;
  #theme: Theme | undefined;
  #paint: PaintReader = (value) => value;
  /** Each series' paint, by its key, for the table's version and the theme and paint reader it was found with. */
  #paints = new Map<
    string,
    { rows: Series["rows"]; length: number; paint: SeriesPaint; color: string }
  >();
  #paintsOf: { version: number; theme: Theme | undefined; paint: PaintReader } | undefined;

  constructor(
    spec: SeriesStyleSpec,
    table: Table,
    scales: ScaleOf,
    primary: "stroke" | "fill",
    where: Where,
    kit: FeatureKit,
    along: "x" | "y",
    view?: { readonly revision: number },
    bands?: "x" | "y",
  ) {
    const { isColor } = kit;
    const { path } = where;
    this.#kit = kit;
    this.#where = where;
    this.#spec = spec;
    this.#table = table;
    this.#view = view;
    this.#bands = bands;
    this.#primary = primary;
    this.#along = along;
    const encode = spec.encode ?? {};
    const both = (flat: keyof SeriesStyleSpec, channel: keyof EncodingsSpec) => {
      if (spec[flat] !== undefined && encode[channel] !== undefined)
        throw new Error(`${path} ${flat}: set as ${flat} and as encode.${channel}; give one`);
    };
    both("color", "color");
    both(primary, primary);
    both("dash", "dash");
    both("strokeWidth", "strokeWidth");
    both("opacity", "opacity");
    // A paint of the mark's own (a line's stroke, an area's fill) wins over its color.
    const own = spec[primary] !== undefined || encode[primary] !== undefined;
    const color = own
      ? undefined
      : (encode.color ??
        (spec.color === undefined
          ? undefined
          : colorShortForm(spec.color, table, `${path} color`, isColor)));
    let rows = false;
    let colorField: string | undefined;
    const parts: RunPart[] = [];
    const reader = <V>(
      channel: ChannelSpec<V> | undefined,
      check: Check,
      name: "color" | "stroke" | "fill" | "dash" | "strokeWidth" | "opacity",
      defaults: () => readonly V[],
      fallback: () => V,
    ): Reader<V> | undefined => {
      if (!channel) return undefined;
      const at = `${path} ${name === "color" && !encode.color ? "color" : `encode.${name}`}`;
      const compiled = compileChannel(
        channel,
        table,
        scales,
        name === "color" || name === "fill" || name === "stroke" ? "color" : name,
        check,
        at,
        name,
      );
      // Only the series' own color waits for its rows (see `color`).
      const paint = name === "color" || name === primary;
      if (
        compiled.kind === "condition" ||
        compiled.kind === "identity" ||
        (compiled.kind === "field" && compiled.field !== spec.series)
      ) {
        // Rows' looks: runs along the series.
        parts.push({
          name: paint ? "color" : (name as keyof Look),
          read: (rows) => rowReader(compiled, rows, defaults(), fallback(), check, at, false),
        });
        if (paint) rows = true;
        if (paint && compiled.kind === "field") colorField = compiled.field;
        return undefined;
      }
      return this.#reader(compiled, defaults, fallback);
    };
    const palette = () => this.#theme?.palette ?? [];
    const muted = () => this.#theme?.muted ?? "#999999";
    const colorValue = outputCheck("color", isColor);
    const dash = outputCheck("dash", isColor);
    const width = outputCheck("strokeWidth", isColor);
    const fraction = outputCheck("opacity", isColor);
    this.#color = reader(color, colorValue, "color", palette, muted);
    this.#stroke = reader(encode.stroke, colorValue, "stroke", palette, muted);
    this.#fill = reader(encode.fill, colorValue, "fill", palette, muted);
    this.#dash = reader<Dash>(
      encode.dash,
      dash,
      "dash",
      () => [],
      () => "-",
    );
    this.#width = reader<number>(
      encode.strokeWidth,
      width,
      "strokeWidth",
      () => [],
      () => 2,
    );
    this.#opacity = reader<number>(
      encode.opacity,
      fraction,
      "opacity",
      () => [],
      () => 1,
    );
    const by = spec.style?.by;
    if (by) {
      const field =
        by.field === undefined
          ? undefined
          : categoryField(table, by.field, `${path} style.by.field`);
      this.#by = (s, id) => {
        const key =
          field === undefined || field === spec.series
            ? id
            : s && this.#field(s, field, `${path} style.by.field`);
        return key === undefined || !Object.hasOwn(by.map, key) ? undefined : by.map[key];
      };
    }
    this.#byRows = rows;
    this.#colorField = colorField;
    // Rows in band order are read whole each version; others as they are appended.
    this.#runs = parts.length ? new StyleRuns(table, parts, view, bands === undefined) : undefined;
  }

  /** Reads `theme`'s palette for values the scales do not map, and colors by `paint`. */
  use(theme: Theme, paint: PaintReader): void {
    this.#theme = theme;
    this.#paint = paint;
  }

  /** A series' value of a compiled channel that does not read rows: one per series. */
  #reader<V>(channel: Channel<V>, defaults: () => readonly V[], fallback: () => V): Reader<V> {
    if (channel.kind === "value") return () => channel.value;
    if (channel.kind === "series")
      return (s, id, label) =>
        channel.scale.output(label ?? s?.label ?? id, defaults(), fallback());
    // The series field's: the series' own value.
    const { scale } = channel as Extract<Channel<V>, { kind: "field" }>;
    return (_s, id) => scale.output(id, defaults(), fallback());
  }

  /** The value of category `field` over a series' rows, which must be one; undefined for none. */
  #field(s: Series, field: string, path: string): string | undefined {
    const { codes, dictionary } = this.#table.categories(field as never);
    return this.#constant(
      s,
      field,
      (row) => {
        const code = codes[row]!;
        return code < 0 ? undefined : dictionary[code];
      },
      path,
    );
  }

  /**
   * The one value `read` gives the rows of a series from `field`: found
   * once, then as the table appends rows checked over its new rows alone,
   * while the rows checked before are unchanged and the last of them
   * holding the value is still there. Throws where a series has two.
   */
  #constant(
    s: Series,
    field: string,
    read: (row: number) => string | undefined,
    path: string,
  ): string | undefined {
    const table = this.#table;
    const offset = table.rowOffset;
    const view = this.#view?.revision;
    const key = `${s.key}|${field}`;
    let checked = this.#checked.get(key);
    if (
      checked &&
      !(
        checked.generation === table.generation &&
        checked.modified === table.modifiedVersion &&
        checked.view === view &&
        held(checked, offset)
      )
    )
      checked = undefined;
    let { value, evidence, seen } = checked ?? { value: undefined, evidence: -1, seen: -1 };
    const check = (row: number) => {
      const id = offset + row;
      if (id > seen) seen = id;
      const at = read(row);
      if (at === undefined) return;
      if (value !== undefined && at !== value) {
        // A series found varying is checked whole again, so it recovers once its rows agree.
        this.#checked.delete(key);
        throw this.#varies(path, s, field);
      }
      value = at;
      if (id > evidence) evidence = id;
    };
    if (checked && !this.#view) {
      // Rows appended since: the table's last ones, of the series where they
      // are its field's value (whatever order the series draws them in).
      const { series } = this.#spec;
      const codes = series === undefined ? undefined : table.categories(series as never);
      const code = codes && this.#codeOf(codes.dictionary, (JSON.parse(s.key) as string[])[1]!);
      // Rows without a band are no series' (bandOrder leaves them out).
      const bands = this.#bands && (this.#bands === "x" ? s.x : s.y);
      for (let row = checked.last + 1 - offset; row < table.length; row++)
        if ((!codes || codes.codes[row] === code) && !(bands && !(bands[row]! >= 0))) check(row);
    } else for (let k = 0; k < s.length; k++) check(s.rows ? s.rows[k]! : k);
    // Every row of the table is checked now, or not the series'.
    const last = offset + table.length - 1;
    this.#checked.set(key, {
      value,
      evidence,
      seen,
      last,
      generation: table.generation,
      modified: table.modifiedVersion,
      view,
    });
    return value;
  }

  /** `value`'s code in `dictionary`, by an index made once per table version. */
  #codeOf(dictionary: readonly string[], value: string): number {
    const version = this.#table.version;
    if (this.#codes?.version !== version || this.#codes.dictionary !== dictionary)
      this.#codes = { version, dictionary, of: new Map(dictionary.map((v, i) => [v, i])) };
    return this.#codes.of.get(value) ?? -1;
  }

  #varies(path: string, s: Series, field: string): Error {
    const series = this.#spec.series;
    const within =
      series === undefined
        ? `the ${this.#spec.type === "area" ? "area" : "line"}`
        : `series "${s.label}" (by "${series}")`;
    const { index, mark } = this.#where;
    return new this.#kit.ChartError({
      code: "series-varies",
      path: `marks[${index}].${path.slice(this.#where.path.length + 1)}`,
      mark,
      message: `${path}: field "${field}" changes within ${within}; a style map gives each series one look, so split them by ${series === undefined ? "a series field" : "another field"}, or give the looks in encode, where they change along a series`,
    });
  }

  /**
   * The value of the field coloring a series, where it is not the series
   * field, when every observation of the series has it: the value it
   * stands for (see identity.ts). Undefined where it has two, a missing
   * value counting as one, or none. Read once, then as the table appends
   * rows over the new rows alone: the last change of value along the
   * series says it has two while a row before it is still there.
   */
  #colorValue(s: Series): string | undefined {
    const field = this.#colorField;
    if (field === undefined || s.length === 0) return undefined;
    const table = this.#table;
    const offset = table.rowOffset;
    const view = this.#view?.revision;
    // Series no longer asked for, as a rolling window drops them, go.
    if (this.#uniformAt !== table.version)
      [this.#uniformBefore, this.#uniform, this.#uniformAt] = [
        this.#uniform,
        new Map(),
        table.version,
      ];
    // Rows in band order are read whole each version.
    const ascending = this.#bands === undefined;
    let kept = this.#uniform.get(s.key) ?? this.#uniformBefore.get(s.key);
    if (
      !kept ||
      !ascending ||
      kept.generation !== table.generation ||
      kept.modified !== table.modifiedVersion ||
      kept.view !== view
    )
      kept = {
        generation: table.generation,
        modified: table.modifiedVersion,
        view,
        last: -1,
        code: -2,
        since: -1,
      };
    this.#uniform.set(s.key, kept);
    const { codes, dictionary } = table.categories(field as never);
    const rowAt = (k: number) => (s.rows ? s.rows[k]! : k);
    for (let k = ascending ? firstAfter(s, kept.last - offset) : 0; k < s.length; k++) {
      const row = rowAt(k);
      if (codes[row] !== kept.code) [kept.code, kept.since] = [codes[row]!, offset + row];
      kept.last = offset + row;
    }
    // Every observation the series has now holds the last value read.
    const first = offset + rowAt(0);
    const one = ascending ? kept.since <= first : kept.since === first;
    return one && kept.code >= 0 ? dictionary[kept.code] : undefined;
  }

  /**
   * The color the palette gives a series of source `id`, named `label`: its
   * style map's, the mark's constant `given`, its channels', or the
   * palette's (undefined). Empty when its rows decide it (`attach` sets it).
   */
  color(id: string, given: string | undefined, label?: string): string | undefined {
    if (this.#byRows) return "";
    return (
      this.#by?.(undefined, id)?.[this.#primary] ?? given ?? this.#paintOf(undefined, id, label)
    );
  }

  #paintOf(s: Series | undefined, id: string, label?: string): string | undefined {
    return (
      (this.#primary === "stroke" ? this.#stroke : this.#fill)?.(s, id, label) ??
      this.#color?.(s, id, label)
    );
  }

  /**
   * A series' paint, its color set on it where its rows decide it; read once
   * per data version and theme, since values within a series are checked.
   */
  paint(s: Series, id: string): SeriesPaint {
    const version = this.#table.version;
    const theme = this.#theme;
    const paint = this.#paint;
    if (
      this.#paintsOf?.version !== version ||
      this.#paintsOf.theme !== theme ||
      this.#paintsOf.paint !== paint
    ) {
      this.#paints.clear();
      this.#paintsOf = { version, theme, paint };
      // What was checked of rows the table no longer has goes, so series a
      // stream leaves behind are not kept; one that returns is checked afresh.
      const { generation, rowOffset } = this.#table;
      for (const [key, checked] of this.#checked)
        if (checked.generation !== generation || !held(checked, rowOffset))
          this.#checked.delete(key);
    }
    const kept = this.#paints.get(s.key);
    if (kept && kept.rows === s.rows && kept.length === s.length) {
      // The color the paint resolved, which the palette did not give.
      s.color = kept.color;
      return kept.paint;
    }
    const look = this.#paintOfSeries(s, id);
    this.#paints.set(s.key, { rows: s.rows, length: s.length, paint: look, color: s.color });
    return look;
  }

  #paintOfSeries(s: Series, id: string): SeriesPaint {
    const style = this.#by?.(s, id);
    const { path } = this.#where;
    const read = (color: string | undefined, option: string) =>
      color === undefined ? undefined : this.#paint(color, `${path} ${option}`);
    // Channels reading rows give the series the look of its first run.
    const runs = this.#runs?.of(s, this.#theme);
    const first = runs?.count ? this.#runs!.look(runs.looks[0]!) : undefined;
    if (runs && runs.count > 1 && !(this.#along === "x" ? s.sorted : s.ySorted)) {
      const { index, mark } = this.#where;
      throw new this.#kit.ChartError({
        code: "unsupported",
        path: `marks[${index}].encode`,
        mark,
        message: `${path} encode: looks change within ${this.#spec.series === undefined ? "the series" : `series "${s.label}"`}, whose positions do not ascend; looks change along ascending ${this.#along}; sort the rows, or keep each series' look`,
      });
    }
    // A color channel by rows gives every series its color; a style map by
    // another field, the series it maps (the others keep the palette's).
    const primary = this.#primary;
    if (this.#byRows)
      s.color =
        read(style?.[primary] ?? this.#spec[primary] ?? first?.color, primary) ??
        this.#theme?.muted ??
        s.color;
    else if (style?.[primary] !== undefined) s.color = read(style[primary], primary)!;
    const spec = this.#spec;
    // What the series has whatever its rows: its style map's, channels not reading rows, the mark's.
    const own = {
      stroke: read(
        style?.stroke ?? (primary === "stroke" ? undefined : this.#stroke?.(s, id)),
        "stroke",
      ),
      strokeWidth: style?.strokeWidth ?? this.#width?.(s, id),
      dash: style?.dash ?? this.#dash?.(s, id),
      opacity: style?.opacity ?? this.#opacity?.(s, id) ?? spec.opacity,
    };
    return {
      stroke: own.stroke ?? read(first?.stroke, "stroke"),
      strokeWidth: own.strokeWidth ?? first?.strokeWidth,
      dash: own.dash ?? first?.dash,
      opacity: own.opacity ?? first?.opacity ?? 1,
      strokeOpacity: style?.strokeOpacity ?? spec.strokeOpacity,
      fillOpacity: style?.fillOpacity,
      style,
      value: this.#colorValue(s),
      ...(runs && runs.count > 1 && { runs, own }),
    };
  }

  /**
   * Look `index` of a series' runs as it draws with `paint`: its style
   * map's settings and the mark's own paint over its channels', colors
   * read. What a row gives none of is the series' own (`paint.own`), else
   * undefined: the mark's, and for a color its rows decide, the muted
   * color channels give rows without one.
   */
  look(index: number, paint: SeriesPaint): Look {
    const look = this.#runs!.look(index);
    const { style, own } = paint;
    const { path } = this.#where;
    const color =
      style?.[this.#primary] ??
      this.#spec[this.#primary] ??
      look.color ??
      (this.#byRows ? (this.#theme?.muted ?? "#999999") : undefined);
    const stroke = style?.stroke ?? look.stroke;
    return {
      color: color === undefined ? undefined : this.#paint(color, `${path} color`),
      stroke: stroke === undefined ? own?.stroke : this.#paint(stroke, `${path} encode.stroke`),
      dash: style?.dash ?? look.dash ?? own?.dash,
      strokeWidth: style?.strokeWidth ?? look.strokeWidth ?? own?.strokeWidth,
      opacity: style?.opacity ?? look.opacity ?? own?.opacity,
    };
  }

  /** `draw` at `opacity`, as `faded` draws highlights: made once per drawing and opacity. */
  translucent<G extends Geometry>(geometry: G, opacity: number): G {
    if (opacity === 1) return geometry;
    return { ...geometry, draw: translucent(geometry.draw, opacity) };
  }
}

/**
 * Whether the table still has the rows `checked` stands on: the last
 * holding its value, or for none, the series' last.
 */
function held(checked: Checked, rowOffset: number): boolean {
  return (checked.value === undefined ? checked.seen : checked.evidence) >= rowOffset;
}

const translucents = new WeakMap<Drawing<Geometry>, Map<number, Drawing<Geometry>>>();
/**
 * How many opacities of one drawing are kept: drawings such as lines' live
 * as long as the page, and opacities streaming in would otherwise stay.
 */
const KEPT_OPACITIES = 256;

/** A drawing of the same geometry at `opacity`, the same while it is among the last opacities asked for. */
export function translucent(draw: Drawing<Geometry>, opacity: number): Drawing<Geometry> {
  let byOpacity = translucents.get(draw);
  if (!byOpacity) {
    byOpacity = new Map();
    translucents.set(draw, byOpacity);
  }
  let made = byOpacity.get(opacity);
  if (made) return made;
  // The opacity asked for longest ago goes first.
  if (byOpacity.size >= KEPT_OPACITIES) byOpacity.delete(byOpacity.keys().next().value!);
  const { elements, canvas: paint } = draw;
  made = {
    ...draw,
    opacity: (draw.opacity ?? 1) * opacity,
    svg: (geometry, context) => `<g opacity="${opacity}">${draw.svg(geometry, context)}</g>`,
    elements:
      elements &&
      ((geometry, context) =>
        elements(geometry, context)?.map(({ tag, attributes }) => ({
          tag,
          attributes: { ...attributes, opacity: String(opacity * Number(attributes.opacity ?? 1)) },
        }))),
    canvas:
      paint &&
      ((context, geometry, options) => {
        const alpha = context.globalAlpha;
        context.globalAlpha = alpha * opacity;
        paint(context, geometry, options);
        context.globalAlpha = alpha;
      }),
  } as Drawing<Geometry>;
  byOpacity.set(opacity, made);
  return made;
}
