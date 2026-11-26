// Segments: each row from one place to another, its width tapering between
// its ends, with a dot or an arrowhead at either. The custom mark's core
// draws them (custom.ts): its series, picking by shape, tooltips writing
// ranges, selection and dimming, the keyboard, the text alternative, value
// transitions, and every output. This module adds their options, their
// checks, and their outline, which is one filled path per row: the body
// between the ends (or the heads' bases), each head, each dot, all wound
// alike, so that where they overlap they paint once.

import type { RowView } from "../data/row-view.ts";
import type { CategoryField, NumericField, PositionField, Schema, Table } from "../data/table.ts";
import { n } from "../draw/markup.ts";
import type { RowChannelsSpec } from "../spec/encoding.ts";
import type { Frozen, SegmentCap, SegmentSpec, SegmentWidthSpec } from "../spec/spec.ts";
import { namesColor } from "./colored.ts";
import {
  type CustomDataOptions,
  type CustomSeries,
  customCore,
  type DataDrawContext,
} from "./custom.ts";
import type { ColorChannels, CssColor, ItemKeyed, RowChannels, SeriesName } from "./encoding.ts";
import type { DrawChannel } from "./features/encoded.ts";
import { definedFields } from "./line.ts";
import { CATEGORY, type ChartMark, frozen, type Mark, requireField } from "./mark.ts";
import { isRowView } from "./rows.ts";
import type { MarkTooltip } from "./tooltip-fields.ts";

/** A segment's width in pixels, or a channel giving each row's. */
export type SegmentWidth<S extends Schema> = number | RowChannels<number, S>;

/**
 * Segments over a table: each row from its `from` place to its `to`
 * place. `x` and `y` are each a field, the same at both ends (a category
 * places rows in its bands), or a pair `[from, to]` of number or time
 * fields; at least one is a pair. Both ends count toward the axes'
 * domains.
 */
export interface SegmentOptions<S extends Schema> extends ItemKeyed<S> {
  x: PositionField<S> | readonly [from: NumericField<S>, to: NumericField<S>];
  y: PositionField<S> | readonly [from: NumericField<S>, to: NumericField<S>];
  /** Category field: one series per value; one series without it. */
  series?: CategoryField<S>;
  /**
   * A category field naming the series, whose values color them (as
   * `series` does, which must then name it too), or a color for every
   * segment.
   */
  color?: CategoryField<S> | CssColor;
  /** The series' name in legends and tooltips; by default, the paired fields' ("start – end"). */
  label?: SeriesName<S>;
  /**
   * Pixels across, or a channel giving each row's (as `encode.strokeWidth`
   * on other marks): one for the whole segment, or `{ from, to }`,
   * tapering linearly between the body's ends (an arrowhead's base where
   * an end has one). By default, a line's width. A row a channel gives no
   * width is not drawn.
   */
  width?: SegmentWidth<S> | { from: SegmentWidth<S>; to: SegmentWidth<S> };
  /**
   * What each end draws: nothing by default. A segment shorter than its
   * arrowhead draws the head alone, its base at the other end; two heads
   * longer than the segment together each take half of it; a segment of no
   * length draws its dots and no arrowhead.
   */
  caps?: { from?: SegmentCap; to?: SegmentCap };
  /** Each row's own color (over its series') and opacity (from 0 to 1; by default 1). */
  encode?: { color?: ColorChannels<S>; opacity?: RowChannels<number, S> };
  /** What tooltips show besides the segment's ends: fields of the row, its content, a heading. */
  tooltip?: MarkTooltip<S>;
  /** `false` leaves the mark's series out of the legend; they still draw. */
  legend?: false;
  /** The y axis `y` maps to: "left" (default) or "right", the chart's `yRight`. */
  axis?: "left" | "right";
  /** With the chart's `facet`, draw all rows in every panel instead of splitting them. */
  facet?: "repeat";
  /**
   * What the mark's drawing is cut to: "plot" (the default), "chart", or
   * false for nothing, so dots and heads at the plot's edge show whole.
   */
  clip?: SegmentSpec["clip"];
  /** Where it is drawn among the panel's marks: higher above lower; 0 by default. */
  zIndex?: number;
  /** `false`: the pointer passes through the marks: clicks, hover, and context menus pick what is under them. */
  pick?: boolean;
  /** `false`: tooltips, hover, and the keyboard leave the marks out. */
  inspect?: boolean;
  /** With the chart's `panels`, the id of the panel to draw in, or "*" for every panel. */
  panel?: string;
  id?: string;
}

/** The options a segment's spec keeps. */
const KEYS = [
  "x",
  "y",
  "series",
  "color",
  "label",
  "width",
  "caps",
  "encode",
  "tooltip",
  "itemKey",
  "legend",
  "axis",
  "facet",
  "clip",
  "zIndex",
  "pick",
  "inspect",
  "panel",
  "id",
] as const;

/** A cap's sizes, defaults filled in; undefined for a cap drawing nothing. */
type Cap = { dot: number } | { arrow: { length: number; width: number } } | undefined;

const DOT = 3;
const ARROW = { length: 10, width: 8 };

/** `value` as a size in pixels, refused unless it is a number of at least 0. */
function size(value: unknown, at: string): number {
  if (typeof value === "number" && value >= 0 && value < Infinity) return value;
  throw new TypeError(
    `segment ${at}: expected a number of at least 0; received ${JSON.stringify(value)}`,
  );
}

/** What a cap draws, its sizes checked. */
function capOf(cap: Frozen<SegmentCap> | undefined, end: "from" | "to"): Cap {
  const at = `caps.${end}`;
  if (cap === undefined) return undefined;
  const sizes = (given: object, keys: readonly string[], form: string) => {
    for (const key of Object.keys(given))
      if (!keys.includes(key))
        throw new TypeError(
          `segment ${at}.${form}: expected ${keys.join(" and ")}; received ${JSON.stringify(key)}`,
        );
  };
  if (cap === "dot") return { dot: DOT };
  if (cap === "arrow") return { arrow: ARROW };
  const forms = typeof cap === "object" && cap !== null ? Object.keys(cap) : [];
  if (forms.length === 1 && "dot" in cap! && typeof cap.dot === "object" && cap.dot !== null) {
    sizes(cap.dot, ["radius"], "dot");
    const radius = size(cap.dot.radius ?? DOT, `${at}.dot.radius`);
    return radius > 0 ? { dot: radius } : undefined;
  }
  if (
    forms.length === 1 &&
    "arrow" in cap! &&
    typeof cap.arrow === "object" &&
    cap.arrow !== null
  ) {
    sizes(cap.arrow, ["length", "width"], "arrow");
    const length = size(cap.arrow.length ?? ARROW.length, `${at}.arrow.length`);
    const width = size(cap.arrow.width ?? ARROW.width, `${at}.arrow.width`);
    // A head of no area is none: it takes nothing of the segment's length.
    return length > 0 && width > 0 ? { arrow: { length, width } } : undefined;
  }
  throw new TypeError(
    `segment ${at}: expected "dot", "arrow", { dot }, or { arrow }; received ${JSON.stringify(cap)}`,
  );
}

/**
 * A width at one end: pixels, or the name of the channel the draw reads it
 * by (each different channel once: one width for both ends is one channel).
 */
type Width = number | string | undefined;

/** The segment's widths at its ends, and the channels they read. */
function widthsOf(width: Frozen<SegmentSpec["width"]>, channels: DrawChannel[]): [Width, Width] {
  if (width === undefined) return [undefined, undefined];
  const one = (given: Frozen<SegmentWidthSpec>, name: string, path: string): Width => {
    if (typeof given === "number") return size(given, path);
    if (typeof given !== "object" || given === null)
      throw new TypeError(
        `segment ${path}: expected pixels or a channel; received ${JSON.stringify(given)}`,
      );
    channels.push({
      name,
      output: "strokeWidth",
      given: given as RowChannelsSpec<number>,
      path,
    });
    return name;
  };
  if (typeof width === "object" && width !== null && ("from" in width || "to" in width)) {
    const ends = width as Frozen<{ from?: SegmentWidthSpec; to?: SegmentWidthSpec }>;
    for (const end of ["from", "to"] as const)
      if (ends[end] === undefined)
        throw new TypeError(
          `segment width.${end}: missing; { from, to } gives the widths at both ends, so give ${end}, or one width for the whole segment`,
        );
    return [one(ends.from!, "from", "width.from"), one(ends.to!, "to", "width.to")];
  }
  const whole = one(width as Frozen<SegmentWidthSpec>, "width", "width");
  return [whole, whole];
}

/** A point as path data writes it. */
const at = (x: number, y: number) => `${n(x)} ${n(y)}`;

/** A dot of radius `r` about (cx, cy), wound as the rest of the outline (clockwise on screen). */
function dot(cx: number, cy: number, r: number): string {
  const d = n(2 * r);
  const radius = n(r);
  return `M${at(cx - r, cy)}a${radius} ${radius} 0 1 1 ${d} 0a${radius} ${radius} 0 1 1 -${d} 0Z`;
}

/**
 * The outline of a segment from (x0, y0) to (x1, y1) in pixels, `w0` and
 * `w1` wide at its body's ends, with caps `from` and `to`; "" for one
 * that paints nothing. Every subpath is wound clockwise on screen, so the
 * nonzero rule fills their union.
 */
export function segmentOutline(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w0: number,
  w1: number,
  from: Cap,
  to: Cap,
): string {
  const length = Math.hypot(x1 - x0, y1 - y0);
  const r0 = from && "dot" in from ? from.dot : 0;
  const r1 = to && "dot" in to ? to.dot : 0;
  // Of no length, it has no direction for a body or a head: its dots, the larger where both are.
  if (!(length > 0)) {
    const r = Math.max(r0, r1);
    return r > 0 ? dot(x0, y0, r) : "";
  }
  const [ux, uy] = [(x1 - x0) / length, (y1 - y0) / length];
  // Across the segment: (nx, ny) is (ux, uy) turned a quarter clockwise on screen.
  const [nx, ny] = [-uy, ux];
  const head0 = from && "arrow" in from ? from.arrow : undefined;
  const head1 = to && "arrow" in to ? to.arrow : undefined;
  let a0 = head0?.length ?? 0;
  let a1 = head1?.length ?? 0;
  // Heads longer than the segment: two meet in its middle, one alone ends at the other end.
  if (a0 + a1 > length) {
    if (head0 && head1) a0 = a1 = length / 2;
    else if (head0) a0 = length;
    else a1 = length;
  }
  // The bases' middles, where the body ends: computed once, read by the body and the heads alike.
  const [bx0, by0] = [x0 + ux * a0, y0 + uy * a0];
  const [bx1, by1] = [x1 - ux * a1, y1 - uy * a1];
  let d = "";
  if (length - a1 > a0 && (w0 > 0 || w1 > 0))
    d += `M${at(bx0 - (nx * w0) / 2, by0 - (ny * w0) / 2)}L${at(bx1 - (nx * w1) / 2, by1 - (ny * w1) / 2)}L${at(bx1 + (nx * w1) / 2, by1 + (ny * w1) / 2)}L${at(bx0 + (nx * w0) / 2, by0 + (ny * w0) / 2)}Z`;
  if (head1) {
    const half = head1.width / 2;
    d += `M${at(bx1 - nx * half, by1 - ny * half)}L${at(x1, y1)}L${at(bx1 + nx * half, by1 + ny * half)}Z`;
  }
  if (head0) {
    const half = head0.width / 2;
    d += `M${at(x0, y0)}L${at(bx0 - nx * half, by0 - ny * half)}L${at(bx0 + nx * half, by0 + ny * half)}Z`;
  }
  if (r0 > 0) d += dot(x0, y0, r0);
  if (r1 > 0) d += dot(x1, y1, r1);
  return d;
}

/** Reads a draw channel by its name, as the core's `encoded` gives it. */
type Encoded = (name: string, row: number, series?: CustomSeries) => string | number | undefined;

/**
 * The library's draw of segments from a frozen spec: for each row of each
 * series shown, its outline as its item, filled in its color (its own, or
 * its series'), at its opacity. Rows missing a place, an end, or a width
 * a channel gives draw nothing.
 */
function drawOf(
  spec: Frozen<SegmentSpec>,
  [toX, toY]: readonly [string | undefined, string | undefined],
  banded: { readonly x: boolean; readonly y: boolean },
  [width0, width1]: readonly [Width, Width],
  colored: boolean,
  opaque: boolean,
): (context: DataDrawContext<Schema>) => void {
  const from = capOf(spec.caps?.from, "from");
  const to = capOf(spec.caps?.to, "to");
  return ({ table, series, x, y, item, path, encoded, theme }) => {
    const read = encoded as Encoded;
    // The second field of a pair: the frame's values while values move.
    // A field may be named "": a pair's second is there when given.
    const ends = [
      toX === undefined ? undefined : table.numbers(toX as never),
      toY === undefined ? undefined : table.numbers(toY as never),
    ];
    const line = theme.style.line.strokeWidth;
    const widthAt = (width: Width, row: number) =>
      typeof width === "string" ? (read(width, row) as number | undefined) : (width ?? line);
    for (const s of series) {
      const [xs, ys] = [ends[0] ?? s.x, ends[1] ?? s.y];
      for (let k = 0; k < s.length; k++) {
        const row = s.rowAt(k);
        // Rows outside every band are placed nowhere.
        if ((banded.x && !(s.x[row]! >= 0)) || (banded.y && !(s.y[row]! >= 0))) continue;
        const [px0, py0, px1, py1] = [x(s.x[row]!), y(s.y[row]!), x(xs[row]!), y(ys[row]!)];
        const w0 = widthAt(width0, row);
        const w1 = width1 === width0 ? w0 : widthAt(width1, row);
        if (
          !(Number.isFinite(px0) && Number.isFinite(py0) && Number.isFinite(px1)) ||
          !Number.isFinite(py1) ||
          w0 === undefined ||
          w1 === undefined
        )
          continue;
        const d = segmentOutline(px0, py0, px1, py1, w0, w1, from, to);
        if (!d) continue;
        const fill =
          (colored ? (read("color", row, s) as string | undefined) : undefined) ?? s.color;
        const opacity = opaque ? undefined : (read("opacity", row) as number | undefined);
        item(s, row, () => path(d, { fill, opacity }));
      }
    }
  };
}

/** Segments from a spec, over `table` or a view of it (`view`): a custom mark of ranges whose draw is the library's. */
export function segmentMark(input: SegmentSpec, table: Table, view?: RowView): Mark {
  const spec = frozen(input);
  const pair = (axis: "x" | "y") => {
    const given = spec[axis] as unknown;
    if (typeof given === "string") return undefined;
    if (
      !Array.isArray(given) ||
      given.length !== 2 ||
      !given.every((field) => typeof field === "string")
    )
      throw new TypeError(
        `segment ${axis}: expected a field, or a pair of fields [from, to]; received ${JSON.stringify(given)}`,
      );
    return given as unknown as readonly [string, string];
  };
  const [xs, ys] = [pair("x"), pair("y")];
  if (!xs && !ys)
    throw new TypeError(
      "segment x, y: a segment goes from one place to another; give x or y a pair of field names [from, to]",
    );
  // A category names the series unless it is a color (colored.ts).
  let { series } = spec;
  let color: string | undefined;
  if (spec.color !== undefined) {
    if (
      namesColor(
        "segment",
        spec.color,
        table,
        `give series: "${spec.color}", or encode.color: { value: "${spec.color}" }`,
      )
    )
      color = spec.color;
    else {
      requireField(table, spec.color, CATEGORY, "segment color");
      if (series !== undefined && series !== spec.color)
        throw new TypeError(
          "segment color: colors the series, so it names their field; give series or color, or the same field for both",
        );
      series = spec.color;
    }
  }
  const channels: DrawChannel[] = [];
  const widths = widthsOf(spec.width, channels);
  const { encode } = spec;
  if (encode?.color !== undefined)
    channels.push({ name: "color", output: "color", given: encode.color, path: "encode.color" });
  if (encode?.opacity !== undefined)
    channels.push({
      name: "opacity",
      output: "opacity",
      given: encode.opacity,
      path: "encode.opacity",
    });
  const banded = (axis: "x" | "y", fields: readonly string[] | undefined) =>
    !fields && table.has(spec[axis] as string) && table.kind(spec[axis] as never) === "category";
  const draw = drawOf(
    spec,
    [xs?.[1], ys?.[1]],
    { x: banded("x", xs), y: banded("y", ys) },
    widths,
    encode?.color !== undefined,
    encode?.opacity === undefined,
  );
  return customCore(
    table,
    {
      x: xs ?? (spec.x as string),
      y: ys ?? (spec.y as string),
      ...(series !== undefined && { series }),
      ...(spec.label !== undefined && { label: spec.label as string }),
      ...(spec.tooltip && {
        tooltip: spec.tooltip as NonNullable<CustomDataOptions<Schema>["tooltip"]>,
      }),
      draw,
    },
    view,
    {
      spec: series === spec.series ? spec : frozen({ ...input, series }),
      channels,
      // Transitions move what the channels read, as a custom mark's encode.
      declared: {
        itemKey: spec.itemKey,
        series,
        encode: Object.fromEntries(channels.map((c) => [c.name, c.given])),
      },
      color,
      noun: "segment",
    },
  );
}

/**
 * Segments over a table or a view of its rows: each row from one place
 * to another, its width tapering between its ends, with a dot or an
 * arrowhead at either. Rows are items, picked by their shapes; tooltips
 * write their ends as ranges ("12 – 40", "(1, 2) – (3, 4)"); legends,
 * selection, the keyboard, value transitions of both ends and of their
 * channels, and every output follow, as custom marks' do. Meant for
 * thousands of segments, not millions.
 *
 * ```ts
 * segment(forecasts, {
 *   x: ["start", "end"],
 *   y: "id",
 *   color: "category",
 *   width: { from: { field: "confidence", scale: "widths" }, to: 1 },
 *   caps: { from: "dot", to: "arrow" },
 * })
 * ```
 */
export function segment<S extends Schema>(
  data: Table<S> | RowView<S>,
  options: SegmentOptions<S>,
): ChartMark<Frozen<SegmentSpec>> {
  const view = isRowView(data) ? data : undefined;
  const table = view ? view.source : (data as Table<S>);
  const spec = {
    type: "segment",
    ...definedFields(options as Partial<Record<(typeof KEYS)[number], unknown>>, KEYS),
  } as SegmentSpec;
  if (table.name !== undefined) spec.data = table.name;
  return segmentMark(
    spec,
    table as unknown as Table,
    view as RowView | undefined,
  ) as unknown as ChartMark<Frozen<SegmentSpec>>;
}
