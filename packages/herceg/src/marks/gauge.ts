// Gauges: one value on a dial. The value is the last finite one of a number
// field, so a table that streams readings moves the gauge as rows arrive.

import type { NumberField, Schema, Table } from "../data/table.ts";
import { ArcPath, arcDrawing, traceSector } from "../draw/arc.ts";
import { textDrawing } from "../draw/labels.ts";
import { shapesDrawing } from "../draw/shapes.ts";
import type { ChartFields, ShownField } from "../fields/chart.ts";
import { type Formatter, formatNumber, lazyFormat, numberFormatter } from "../format/format.ts";
import { fitText, oneLineText } from "../layout/text.ts";
import type { FormatUser, FormatWrite } from "../model/features.ts";
import { ItemViews } from "../model/item-views.ts";
import type { LegendEntry } from "../model/legend.ts";
import type { ArcGeometry, Geometry, ShapesGeometry, TextGeometry } from "../scene/scene.ts";
import type { NumberFormatSpec } from "../spec/guides.ts";
import type { Frozen, GaugeBand, GaugeSpec, MarkTooltipSpec } from "../spec/spec.ts";
import { refuseColor } from "./colored.ts";
import type { LayoutFrame, LayoutItem, LayoutMark, LayoutResult } from "./layout-mark.ts";
import { type ChartMark, frozen, type MARK, requireField } from "./mark.ts";
import { checkTooltip, type MarkTooltip } from "./tooltip-fields.ts";

export interface GaugeOptions<S extends Schema> {
  /** Number field whose last finite value the gauge shows. */
  value: NumberField<S>;
  /** The ends of the dial: the field's display's `min` and `max` by default, else 0 and 100. */
  min?: number;
  max?: number;
  /**
   * Colored ranges of the dial, by ascending ends: each from the previous
   * band's end (the first from `min`) up to its `to`, at most `max`.
   */
  bands?: readonly GaugeBand[];
  /** Text under the value; the field's label by default (its display's, else its name). */
  label?: string;
  /**
   * How the value and the dial's ends are written, in any of numbers'
   * forms (`NumberFormatSpec`); the field's display's format by default.
   */
  format?: NumberFormatSpec;
  /** Fields of the row the gauge shows, which its tooltip shows besides the value. */
  tooltip?: MarkTooltip<S>;
  id?: string;
  /** With the chart's `panels`, the id of the panel the gauge has to itself. */
  panel?: string;
}

/** The dial turns 240 degrees clockwise from its lower left, over the top: it is open at the bottom. */
const START = (5 / 6) * Math.PI;
const SWEEP = (4 / 3) * Math.PI;
/** The track's thickness, and the band ring's distance from it and thickness, in track radii. */
const TRACK = 0.18;
const BAND_GAP = 0.035;
const BAND = 0.06;
/** Space between neighboring bands, in pixels. */
const GAP = 2;
/** Space between the dial's ends and the labels under them, in pixels. */
const END_GAP = 6;
/** The value's font size, in track radii (at least the theme's), and its largest in pixels. */
const VALUE_SIZE = 0.34;
const MAX_VALUE_SIZE = 72;

interface Band {
  from: number;
  to: number;
  color: string;
}

export class GaugeMark implements LayoutMark, FormatUser {
  declare readonly [MARK]: true;
  readonly layout = true;
  readonly views = ItemViews;
  readonly spec: Frozen<GaugeSpec>;
  readonly table: Table;
  readonly measure: string;
  /** A format other than Intl options, which the feature compiler writes, handing its writer over. */
  readonly featured: boolean;
  #formats: FormatWrite | undefined;

  constructor(input: GaugeSpec, table: Table) {
    this.spec = frozen(input);
    // Read from the copy: the caller may change what it passed.
    const spec = this.spec;
    requireField(table, spec.value, ["number"], "gauge value");
    checkTooltip(table, spec.tooltip, "gauge");
    this.featured = lazyFormat(spec.format);
    this.table = table;
    this.measure = spec.value;
    // Ends the gauge gives are checked now; ends a field's display may give, once it is known.
    for (const [name, end] of [
      ["min", spec.min],
      ["max", spec.max],
    ] as const)
      if (end !== undefined && !Number.isFinite(end))
        throw new RangeError(`gauge ${name}: expected a finite number; received ${end}`);
    if (spec.min !== undefined && spec.max !== undefined) this.#endsOf(undefined);
  }

  /**
   * The dial's ends: its own `min` and `max`, else its field's display's
   * (`display`, the chart's), else 0 and 100; refused where they are out of
   * order or its bands leave them, an end the display gives named as the
   * chart's `index`-th mark's.
   */
  #endsOf(display: ShownField | undefined, index = 0): readonly [number, number] {
    const { spec } = this;
    const min = spec.min ?? display?.min ?? 0;
    const max = spec.max ?? display?.max ?? 100;
    if (!(min < max)) {
      // An end the field gives is named where it is given.
      const from = (end: "min" | "max") =>
        spec[end] === undefined && display?.[end] !== undefined ? display.from[end] : undefined;
      const field = from("min") ?? from("max");
      if (field === undefined)
        throw new RangeError(
          `gauge min, max: expected finite numbers, min below max; received ${min}, ${max}`,
        );
      const own = from("min") ? "max" : "min";
      throw new RangeError(
        own === "max"
          ? `chart marks[${index}].max: ${max} is not above min ${min} (${field}.min); give max above min`
          : `chart marks[${index}].min: ${min} is not below max ${max} (${field}.max); give min below max`,
      );
    }
    let previous = min;
    for (const { to } of spec.bands ?? []) {
      if (!(to > min && to <= max))
        throw new RangeError(
          `gauge bands: expected ends above min ${min} and at most max ${max}; received ${to}`,
        );
      if (!(to > previous))
        throw new RangeError(
          `gauge bands: expected ascending ends; received ${to} after ${previous}`,
        );
      previous = to;
    }
    return [min, max];
  }

  legend(): LegendEntry[] {
    return [];
  }

  /**
   * The row holding the field's last finite value among `rows` (all rows
   * by default), or -1 when none does.
   */
  #row(rows: Uint32Array | undefined): number {
    const values = this.table.numbers(this.spec.value);
    for (let k = (rows ?? values).length - 1; k >= 0; k--) {
      const row = rows ? rows[k]! : k;
      if (Number.isFinite(values[row]!)) return row;
    }
    return -1;
  }

  #bands({ theme, paint }: Pick<LayoutFrame, "theme" | "paint">, min: number): Band[] {
    let from = min;
    return (this.spec.bands ?? []).map(({ to, color }, i) => {
      const band = {
        from,
        to,
        color:
          color === undefined
            ? (theme.palette[i % theme.palette.length] ?? theme.text)
            : paint(color, `gauge bands[${i}].color`),
      };
      from = to;
      return band;
    });
  }

  /**
   * Takes the feature compiler's writer of its format, and checks its ends
   * against its field's display among the chart's (`fields`), which it
   * reads again as it is drawn: charts with other displays may draw it.
   */
  useFormats(write: FormatWrite, fields: ChartFields | undefined, index: number): void {
    this.#formats = write;
    this.#endsOf(fields?.of(this.table, this.spec.value), index);
  }

  draw(frame: LayoutFrame): LayoutResult {
    const { bounds, theme, measure, locale } = frame;
    // Its field's display, the chart's own.
    const display = frame.features?.fields?.of(this.table, this.spec.value);
    const [min, max] = this.#endsOf(display);
    const row = this.#row(frame.rows);
    const value = row < 0 ? Number.NaN : this.table.numbers(this.spec.value)[row]!;
    const given = this.spec.format;
    // The ends are written in the format, the gauge's or else its field's; the
    // value through the field's display too (its mappings and missing text).
    const ends: Formatter = this.featured
      ? this.#formats!(given!, locale, "gauge format")
      : given
        ? numberFormatter(given as Intl.NumberFormatOptions, locale)
        : display?.format
          ? this.#formats!(display.format, locale, `chart ${display.from.format}.format`)
          : (v) => formatNumber(v, locale);
    const shown = display?.writer(ends, ends);
    const format: Formatter = shown ? (v) => shown(v) : ends;
    const font = `${theme.fontSize}px ${theme.font}`;
    const lineHeight = Math.round(theme.fontSize * 1.25);
    const bands = this.#bands(frame, min);
    const label = this.spec.label ?? display?.label ?? this.spec.value;

    // The dial reaches its outer radius above its center, and half that below
    // it at its ends (30 degrees below level), with the end labels under them.
    const ring = bands.length > 0 ? 1 + BAND_GAP + BAND : 1;
    const room = Math.min(bounds.width / 2 - 2, (bounds.height - END_GAP - lineHeight) / 1.5);
    const r = Math.max(0, room / ring);
    const r0 = r * (1 - TRACK);
    const outer = r * ring;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + (bounds.height - 1.5 * outer - END_GAP - lineHeight) / 2 + outer;
    // Values past the dial's ends are drawn at them. Halving keeps the
    // differences of values near the largest doubles finite.
    const angle = (v: number) => {
      const clamped = Math.min(max, Math.max(min, v));
      return START + SWEEP * ((clamped / 2 - min / 2) / (max / 2 - min / 2));
    };

    // The band of a value as drawn: values past an end are drawn at it.
    const bandOf = (v: number) => bands.find(({ to }) => Math.min(max, Math.max(min, v)) <= to);
    const colorOf = (v: number) => bandOf(v)?.color ?? theme.palette[0] ?? theme.text;
    const endOf = (v: number) => (Number.isNaN(v) ? START : angle(v));
    const extremes = [ends(min), ends(max)];
    const widths = extremes.map((extreme) => measure(extreme, font));
    // The dial, the value, and the labels, as drawn at value `v`.
    const dial = (v: number): Geometry[] => {
      const end = endOf(v);
      const geometry: Geometry[] = [
        {
          kind: "arc",
          draw: arcDrawing,
          key: "gauge-dial",
          // The track beyond the value, and the value's arc. The track is not
          // drawn under the value, where its antialiased edges would show.
          arcs: Float32Array.of(cx, cy, r0, r, end, START + SWEEP, cx, cy, r0, r, START, end),
          count: 2,
          colors: [theme.grid, colorOf(v)],
          colorIndex: Uint32Array.of(0, 1),
          fillOpacity: 1,
          gap: 0,
        } as ArcGeometry,
      ];
      if (bands.length > 0) {
        const colors = [...new Set(bands.map((b) => b.color))];
        const [b0, b1] = [r * (1 + BAND_GAP), outer];
        geometry.push({
          kind: "arc",
          draw: arcDrawing,
          key: "gauge-bands",
          arcs: Float32Array.from(
            bands.flatMap(({ from, to }) => [cx, cy, b0, b1, angle(from), angle(to)]),
          ),
          count: bands.length,
          colors,
          colorIndex: Uint32Array.from(bands, (b) => colors.indexOf(b.color)),
          fillOpacity: 1,
          gap: GAP,
        } as ArcGeometry);
      }

      // The value as large as the dial allows, within the track's inside, and
      // the label under it.
      const text = Number.isNaN(v) ? (shown?.(v) ?? "–") : format(v);
      const perPixel = measure(text, `600 100px ${theme.font}`) / 100;
      const size = Math.round(
        Math.min(
          MAX_VALUE_SIZE,
          Math.max(theme.fontSize, r * VALUE_SIZE),
          perPixel > 0 ? (1.5 * r0) / perPixel : Infinity,
        ),
      );
      const valueY = cy - lineHeight * 0.3;
      const fitted = fitText(oneLineText(label), 1.7 * r0, measure, font);
      const labels: { text: string; x: number; y: number }[] = [];
      if (fitted !== "…")
        labels.push({ text: fitted, x: cx, y: valueY + size / 2 + lineHeight / 2 });
      geometry.push({
        kind: "shapes",
        draw: shapesDrawing,
        key: "gauge-value",
        shapes: [
          {
            text,
            x: cx,
            y: valueY,
            fill: Number.isNaN(v) ? theme.muted : theme.text,
            anchor: "middle",
          },
        ],
        font: `600 ${size}px ${theme.font}`,
        fontSize: size,
        bold: true,
      } as ShapesGeometry);

      // `min` and `max` under the track's ends, unless they would overlap.
      const reach = ((r0 + r) / 2) * Math.cos(START);
      if (widths[0]! / 2 + widths[1]! / 2 + 8 < -2 * reach) {
        const y = cy + outer * Math.sin(START) + END_GAP + lineHeight / 2;
        extremes.forEach((extreme, i) => {
          const half = widths[i]! / 2;
          const x = cx + (i === 0 ? reach : -reach);
          const inside = Math.min(bounds.x + bounds.width - half, Math.max(bounds.x + half, x));
          labels.push({ text: extreme, x: inside, y });
        });
      }
      geometry.push({
        kind: "text",
        draw: textDrawing,
        key: "gauge-labels",
        fill: theme.muted,
        anchor: "middle",
        halo: undefined,
        coords: Float32Array.from(labels.flatMap(({ x, y }) => [x, y])),
        labels: labels.map((l) => l.text),
        count: labels.length,
      } as TextGeometry);
      return geometry;
    };
    const geometry = dial(value);
    // Charts that animate changed values draw the dial at the values between.
    if (frame.keyed) (geometry[0] as ArcGeometry).dial = { value, draw: dial };
    const band = bandOf(value);
    const color = colorOf(value);
    const end = endOf(value);

    const key = JSON.stringify([frame.id, this.spec.value]);
    const outline = new ArcPath();
    traceSector(outline, cx, cy, r0, r, START, end > START ? end : START + SWEEP, 0);
    const middle = (r0 + r) / 2;
    const item: LayoutItem = {
      key,
      label,
      color,
      value,
      text: Number.isNaN(value)
        ? `no value, from ${ends(min)} to ${ends(max)}`
        : `${format(value)} of ${ends(min)} to ${ends(max)}${outside(value, min, max)}`,
      px: cx + middle * Math.cos(end),
      py: cy + middle * Math.sin(end),
      outline: outline.d,
      ...(row >= 0 && { row }),
    };
    return {
      geometry,
      itemAt: (px, py) => (Math.hypot(px - cx, py - cy) <= outer ? item : undefined),
      count: 1,
      item: () => item,
      indexOf: (k) => (k === key ? 0 : -1),
      summary: () => {
        const name = `Gauge of ${item.label}`;
        const range = `from ${ends(min)} to ${ends(max)}`;
        if (Number.isNaN(value)) return `${name}: no value, ${range}.`;
        const within = band ? `, in the band up to ${ends(band.to)}` : "";
        return `${name}: ${format(value)}, ${range}${outside(value, min, max)}${within}.`;
      },
    };
  }
}

function outside(value: number, min: number, max: number): string {
  return value > max ? ", above the maximum" : value < min ? ", below the minimum" : "";
}

/**
 * A gauge showing the last finite value of `value` on a dial from `min` to
 * `max` (0 to 100 by default), with optional colored bands.
 *
 * ```ts
 * gauge(metrics, { value: "cpu", bands: [{ to: 70 }, { to: 90 }, { to: 100 }] })
 * ```
 */
export function gauge<S extends Schema>(
  table: Table<S>,
  options: GaugeOptions<S>,
): ChartMark<Frozen<GaugeSpec>> {
  refuseColor(options, "gauge");
  const spec: GaugeSpec = { type: "gauge", value: options.value };
  if (options.min !== undefined) spec.min = options.min;
  if (options.max !== undefined) spec.max = options.max;
  if (options.bands !== undefined) spec.bands = options.bands.map((band) => ({ ...band }));
  if (options.label !== undefined) spec.label = options.label;
  if (options.format !== undefined) spec.format = { ...options.format };
  if (options.tooltip !== undefined) spec.tooltip = options.tooltip as MarkTooltipSpec;
  if (options.id !== undefined) spec.id = options.id;
  if (options.panel !== undefined) spec.panel = options.panel;
  if (table.name !== undefined) spec.data = table.name;
  // Field names were checked against S above; marks work on the erased schema.
  return new GaugeMark(spec, table as unknown as Table);
}
