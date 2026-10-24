import type { NumericField, Schema, Table } from "../data/table.ts";
import { rectDrawing, sideMask } from "../draw/rect.ts";
import type { Formatter } from "../format/format.ts";
import { anchorBlock } from "../layout/block.ts";
import { lineCount, type MeasureText, textLines } from "../layout/text.ts";
import type { PositionScale } from "../scale/scale.ts";
import type { Geometry, RectGeometry } from "../scene/scene.ts";
import type { LabelPlaceSpec } from "../spec/encoding.ts";
import type { Side } from "../spec/place.ts";
import type { AnnotationPosition, Clip, Frozen, RegionRange, RegionSpec } from "../spec/spec.ts";
import type { Halo } from "../spec/style.ts";
import type { TextPaint } from "../style/style.ts";
import {
  AnnotationData,
  checkLegend,
  labelOf,
  type Place,
  type PlaceOption,
  position,
  readsTable,
  type TextField,
} from "./annotation.ts";
import { labelPaint, labelsGeometry, type PlacedLabel, plainText, textGeometry } from "./labels.ts";
import { definedFields } from "./line.ts";
import {
  type AxisFormat,
  type ChartMark,
  checkOption,
  type Frame,
  frozen,
  isPixels,
  isSides,
  type MARK,
  type Mark,
  type MarkKey,
  painted,
  type RowParts,
  seriesKey,
} from "./mark.ts";
import type { RuleLabel } from "./rule.ts";

interface RegionStyle {
  /** The outline that keeps text readable: "auto" (the default), false for none, or a color of its own. */
  halo?: Halo;
  /** The y axis the values are on: "left" (default) or "right", the chart's `yRight`. */
  axis?: "left" | "right";
  /** With the chart's `facet`, draw all rows in every panel instead of splitting them. */
  facet?: "repeat";
  /**
   * What the mark's drawing is cut to: "plot", "chart", or false for
   * nothing, so markers at the plot's edge show whole. Without it, data is
   * cut to the plot and labels are drawn whole.
   */
  clip?: Clip;
  /** With the chart's `panels`, the id of the panel to draw in, or "*" for every panel. */
  panel?: string;
  fill?: string;
  fillOpacity?: number;
  /** An outline: its color, and width in pixels (1 by default with a stroke). */
  stroke?: string;
  strokeWidth?: number;
  /** The sides `stroke` outlines, such as ["left", "right"]: every side by default. */
  strokeSides?: readonly Side[];
  /** Whether the regions' values count toward the axes' domains; false by default. */
  contributeDomain?: boolean;
  /** `true` lists the regions in the chart's legends by their label; they are left out by default. */
  legend?: boolean;
  /** Where the regions are drawn among the panel's marks: higher above lower; 0 by default. */
  zIndex?: number;
  id?: string;
}

/** A region between constant places: an x range, a y range, or both (a rectangle). */
export type RegionOptions = RegionStyle &
  RegionRange<PlaceOption<never>> & {
    /** Text drawn in the region (its top left corner by default): its text, or a label object. */
    label?: RuleLabel<never>;
  };

/** Regions from a table, one per row; places may also be constants. */
export type RegionDataOptions<S extends Schema> = RegionStyle &
  RegionRange<PlaceOption<NumericField<S>>> & {
    /** Text drawn in every region: constant, or each row's `field`. */
    label?: RuleLabel<TextField<S>>;
  };

/** Pixels between a region's edge and its label. */
const PADDING = 4;

/** Why a region spec has no range, or half of one, if it does. */
export function regionFormError(spec: {
  x1?: unknown;
  x2?: unknown;
  y1?: unknown;
  y2?: unknown;
}): string | undefined {
  if ((spec.x1 === undefined) !== (spec.x2 === undefined))
    return "region: needs both x1 and x2, or neither";
  if ((spec.y1 === undefined) !== (spec.y2 === undefined))
    return "region: needs both y1 and y2, or neither";
  if (spec.x1 === undefined && spec.y1 === undefined)
    return "region: needs x1 and x2, y1 and y2, or both";
  return undefined;
}

/**
 * Shaded regions: between x1 and x2 across the plot's height, between y1
 * and y2 across its width, or rectangles with both. Their values count
 * toward the axes' domains when they say so (`contributeDomain`).
 */
export class RegionMark implements Mark<Frozen<RegionSpec>> {
  declare readonly [MARK]: true;
  readonly spec: Frozen<RegionSpec>;
  readonly tooltip = "x";
  readonly featured: boolean;
  readonly domainFallback: boolean;
  readonly #data: AnnotationData;
  /** The label drawn as regions always draw theirs: plain text, in the top left corner. */
  readonly #plain: boolean;

  constructor(input: RegionSpec, table?: Table) {
    // Outlines well formed first, as the validator checks a spec before what it draws.
    const { stroke, strokeWidth, strokeSides } = input;
    if (stroke !== undefined)
      checkOption(typeof stroke === "string", "region", "stroke", "a string", stroke);
    if (strokeWidth !== undefined)
      checkOption(
        isPixels(strokeWidth),
        "region",
        "strokeWidth",
        "a number of at least 0",
        strokeWidth,
      );
    if (strokeSides !== undefined)
      checkOption(
        isSides(strokeSides),
        "region",
        "strokeSides",
        'sides, such as ["top"]',
        strokeSides,
      );
    checkLegend(input, "region");
    this.spec = frozen(input);
    // Read from the copy: the caller may change what it passed.
    const spec = this.spec;
    this.domainFallback = spec.contributeDomain !== true;
    const problem = regionFormError(spec);
    if (problem) throw new Error(problem);
    const label = labelOf(spec.label);
    this.#data = new AnnotationData(
      table,
      { x1: spec.x1, x2: spec.x2, y1: spec.y1, y2: spec.y2 },
      label,
      "region",
      { x: "x", y: spec.axis === "right" ? "yRight" : "y" },
    );
    this.#plain = label !== undefined && !label.style && !label.place && !label.format;
    const format = label?.format as { number?: unknown; time?: unknown } | undefined;
    this.featured =
      format?.number !== undefined || format?.time !== undefined || label?.content !== undefined;
  }

  get table(): Table | undefined {
    return this.#data.table;
  }

  channelKind(axis: "x" | "y") {
    const [a, b] = this.#pair(axis);
    return this.#data.kind(a) ?? this.#data.kind(b);
  }

  describe(format: AxisFormat, locale: string | undefined, rows?: RowParts): string | undefined {
    const data = this.#data;
    const x = this.#places("x");
    const y = this.#places("y");
    // Places that are not values (fractions, pixels) say nothing of where the region is.
    const range = (places: [Place, Place] | undefined, f: Formatter, i: number) => {
      if (!places || places.some((p) => p.kind !== "value")) return "";
      const a = data.value(places[0], i);
      const b = data.value(places[1], i);
      return Number.isFinite(a) && Number.isFinite(b) ? `${f(a)} to ${f(b)}` : undefined;
    };
    return data.summary(
      ["Region", "Regions"],
      locale,
      (i) => {
        const across = range(x, format.x, i);
        const down = range(y, format.y, i);
        if (across === undefined || down === undefined) return undefined;
        return [across && `x ${across}`, down && `y ${down}`].filter(Boolean).join(", ");
      },
      rows,
      format.content,
    );
  }

  series() {
    return [];
  }

  labelEntries(
    key: MarkKey,
    locale: string | undefined,
    rows?: RowParts,
    pattern?: (format: object, locale: string | undefined, path: string) => Formatter,
  ) {
    const data = this.#data;
    return data.entries(key, locale, rows, data.writer(locale, pattern));
  }

  xExtent(_series: unknown, log: boolean, _breaks?: unknown, rows?: RowParts) {
    return this.#data.extent(this.#pair("x"), log, undefined, rows);
  }

  get scaled() {
    return this.#data.scaled;
  }

  scaleExtent(name: string, axis: "x" | "y", log: boolean, rows?: RowParts) {
    return this.#data.extent(this.#pair(axis), log, undefined, rows, name);
  }

  yExtent(
    _series: unknown,
    x0: number,
    x1: number,
    log: boolean,
    _breaks?: unknown,
    rows?: RowParts,
  ) {
    const x = this.#places("x");
    if (!x) return this.#data.extent(this.#pair("y"), log, undefined, rows);
    // Regions that also span x count toward y only where they overlap the view.
    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    // An edge at a fraction, pixels, a category, or on a scale of the
    // chart's own is in view wherever x is.
    const edge = (place: Place, i: number, end: number) =>
      place.kind === "value" && !place.scale ? this.#data.value(place, i) : end;
    const overlaps = (i: number) => {
      const p = edge(x[0], i, hi);
      const q = edge(x[1], i, lo);
      return Math.max(p, q) >= lo && Math.min(p, q) <= hi;
    };
    return this.#data.extent(this.#pair("y"), log, overlaps, rows);
  }

  geometry(_series: unknown, frame: Frame, key: MarkKey, panelRows?: RowParts): Geometry[] {
    // What the legend hides of it goes undrawn.
    const rows = this.#data.shown(frame.hidden, key, panelRows);
    const { plot, theme } = frame;
    const data = this.#data;
    const id = seriesKey(key, "region");
    const xs = this.#places("x");
    const ys = this.#places("y");
    const label = data.label;
    const write = data.writer(frame.locale, frame.features?.of(this)?.format);
    // Buffers as large as the items drawn: a facet panel's, not the table's.
    const size = data.size(rows);
    const rects = frame.floats(id, "rect", size * 4);
    const color = painted(frame.paint, this.spec.fill, "region fill") ?? theme.muted;
    // An outline draws the sides it is given of each region's own edges.
    const edge = this.#edge(frame, color);
    const sides = edge && frame.bytes(id, "sides", size);
    const given = sideMask(this.spec.strokeSides ?? ["top", "right", "bottom", "left"]);
    const placed: PlacedLabel[] = [];
    const paint =
      label &&
      labelPaint(theme, theme.text, label.style && frame.read(label.style, "region label.style"));
    let count = 0;
    data.each(rows, (i) => {
      // Each region is clipped to the plot, so a label stays in its visible part.
      const across = this.#span(xs, "x", i, frame.x, frame, plot.x, plot.x + plot.width);
      const down = this.#span(ys, "y", i, frame.y, frame, plot.y, plot.y + plot.height);
      if (!across || !down) return;
      rects[count * 4] = across[0];
      rects[count * 4 + 1] = down[0];
      rects[count * 4 + 2] = across[1] - across[0];
      rects[count * 4 + 3] = down[1] - down[0];
      // Left and right are x's start and end; top and bottom, y's (in pixels, down).
      if (sides)
        sides[count] =
          given & (((across[2] & 1) << 3) | (across[2] & 2) | (down[2] & 1) | ((down[2] & 2) << 1));
      if (paint) {
        const text = data.text(i, frame.locale, write, frame.features?.of(this)?.content);
        placed.push(
          this.#plain && paint.verticalAlign === undefined
            ? {
                text,
                x: across[0] + PADDING,
                y: down[0] + PADDING + paint.size / 2,
                anchor: "start",
                baseline: "middle",
              }
            : this.#place(text, across, down, paint, frame.measure),
        );
      }
      count++;
    });
    const fill: RectGeometry = {
      kind: "rect",
      draw: rectDrawing,
      key: id,
      fill: color,
      fillOpacity: this.spec.fillOpacity ?? 0.15,
      rects,
      count,
    };
    if (edge) fill.edge = { ...edge, sides: sides! };
    const out: Geometry[] = [fill];
    if (placed.length > 0 && paint) {
      const labelKey = seriesKey(key, "region label");
      const halo = label?.style?.halo ?? this.spec.halo;
      out.push(
        this.#plain || plainText(paint, theme)
          ? textGeometry(
              labelKey,
              // Placed by their first lines, drawn by their middles.
              placed.map((at) => ({
                ...at,
                y: at.y + ((lineCount(at.text) - 1) * paint.lineHeight) / 2,
              })),
              paint.color,
              halo,
              frame,
            )
          : labelsGeometry(labelKey, placed, paint, halo, frame),
      );
    }
    return out;
  }

  /**
   * The regions' outline, given a color or a width: 1 pixel wide and in
   * their fill's color, `fill`, by default.
   */
  #edge(frame: Frame, fill: string): RectGeometry["edge"] {
    const { stroke, strokeWidth = 1 } = this.spec;
    if ((stroke === undefined && this.spec.strokeWidth === undefined) || strokeWidth <= 0)
      return undefined;
    const color = painted(frame.paint, stroke, "region stroke") ?? fill;
    return { stroke: color, width: strokeWidth, opacity: 1, dash: undefined };
  }

  /**
   * Where a region's label goes: along the edge `side` names (top by
   * default), at its start, middle, or end, inside the region or outside it.
   * Its point is its first line's: a label of several lines grows away from
   * the edge it is beside, and is centered where it is centered. A style's
   * verticalAlign puts the block's top, middle, or bottom, box and all, at
   * the place instead: below a top or bottom edge, on it, or above it; at
   * the start, middle, or end of a side edge.
   */
  #place(
    text: string,
    [left, right]: readonly [number, number, ...number[]],
    [top, bottom]: readonly [number, number, ...number[]],
    paint: TextPaint,
    measure: MeasureText,
  ): PlacedLabel {
    const place: Frozen<LabelPlaceSpec> = this.#data.label?.place ?? {};
    const side = place.side ?? "top";
    const attachment = place.attachment ?? "start";
    const gap = PADDING + (place.offset ?? 0);
    const out = place.outside ? -1 : 1;
    const { size, lineHeight, verticalAlign } = paint;
    // The block's lines after the first.
    const rest = (lineCount(text) - 1) * lineHeight;
    /** The label from `x` as `anchor` says, its block at `y` as its style aligns it. */
    const block = (x: number, y: number, anchor: PlacedLabel["anchor"]): PlacedLabel => {
      const { at, box } = anchorBlock(
        textLines(text, paint, measure),
        {
          x,
          y,
          align: anchor === "middle" ? "center" : anchor,
          verticalAlign: verticalAlign!,
          angle: 0,
        },
        paint,
      );
      return { text, x: at.x, y: at.y, anchor, baseline: "middle", box };
    };
    if (side === "top" || side === "bottom") {
      const [x, anchor]: [number, PlacedLabel["anchor"]] =
        attachment === "start"
          ? [left + PADDING, "start"]
          : attachment === "end"
            ? [right - PADDING, "end"]
            : [(left + right) / 2, "middle"];
      const edge = side === "top" ? top : bottom;
      if (verticalAlign)
        return block(
          x,
          verticalAlign === "top" ? edge + gap : verticalAlign === "bottom" ? edge - gap : edge,
          anchor,
        );
      const y =
        side === "top"
          ? top + out * (gap + size / 2) - (out < 0 ? rest : 0)
          : bottom - out * (gap + size / 2) - (out > 0 ? rest : 0);
      return { text, x, y, anchor, baseline: "middle" };
    }
    if (verticalAlign)
      return block(
        side === "left" ? left + out * gap : right - out * gap,
        attachment === "start"
          ? top + PADDING
          : attachment === "end"
            ? bottom - PADDING
            : (top + bottom) / 2,
        (side === "left") === !place.outside ? "start" : "end",
      );
    const y =
      attachment === "start"
        ? top + PADDING + size / 2
        : attachment === "end"
          ? bottom - PADDING - size / 2 - rest
          : (top + bottom - rest) / 2;
    return side === "left"
      ? {
          text,
          x: left + out * gap,
          y,
          anchor: place.outside ? "end" : "start",
          baseline: "middle",
        }
      : {
          text,
          x: right - out * gap,
          y,
          anchor: place.outside ? "start" : "end",
          baseline: "middle",
        };
  }

  /**
   * Pixel span [start, end] of item i on one axis, clipped to [min, max];
   * the whole range without places; undefined when nothing of it is in
   * view. Values a log scale cannot place (zero or below) sit at its low
   * end, so a region from zero reaches the axis. Its third element says
   * which ends are the region's own edges, which outlines draw, rather than
   * cut by the view or the range's: 1 its start, 2 its end.
   */
  #span(
    places: [Place, Place] | undefined,
    axis: "x" | "y",
    item: number,
    scale: PositionScale,
    frame: Frame,
    min: number,
    max: number,
  ): [number, number, number] | undefined {
    if (!places) return [min, max, 0];
    const a = this.#data.pixel(places[0], axis, item, scale, frame, true);
    const b = this.#data.pixel(places[1], axis, item, scale, frame, true);
    if (a === undefined || b === undefined) return undefined;
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const start = Math.max(min, low);
    const end = Math.min(max, high);
    return end > start ? [start, end, (low >= min ? 1 : 0) | (high <= max ? 2 : 0)] : undefined;
  }

  #pair(
    axis: "x" | "y",
  ): [Frozen<AnnotationPosition> | undefined, Frozen<AnnotationPosition> | undefined] {
    return axis === "x" ? [this.spec.x1, this.spec.x2] : [this.spec.y1, this.spec.y2];
  }

  #places(axis: "x" | "y"): [Place, Place] | undefined {
    const [a, b] = this.#pair(axis);
    return a === undefined || b === undefined
      ? undefined
      : [this.#data.place(a), this.#data.place(b)];
  }
}

/**
 * Shaded regions: one between constant places, or one per row of a table.
 * List them before the marks they highlight to draw them underneath.
 *
 * ```ts
 * region({ x1: start, x2: end, label: "Maintenance" })
 * region(incidents, { x1: "start", x2: "end", label: { field: "title" } })
 * region({ y1: 200, y2: 300, fill: "#2a9d8f" })
 * region({ x1: start, x2: end, y1: { fraction: 0 }, y2: { fraction: 0.1 } })
 * ```
 */
export function region(options: RegionOptions): ChartMark<Frozen<RegionSpec>>;
export function region<S extends Schema>(
  table: Table<S>,
  options: RegionDataOptions<S>,
): ChartMark<Frozen<RegionSpec>>;
export function region<S extends Schema>(
  first: Table<S> | RegionOptions,
  second?: RegionDataOptions<S>,
): ChartMark<Frozen<RegionSpec>> {
  const table = second ? (first as Table<S>) : undefined;
  const options = (second ?? first) as RegionDataOptions<S>;
  const spec = {
    type: "region",
    ...definedFields(
      {
        ...options,
        x1: position(options.x1),
        x2: position(options.x2),
        y1: position(options.y1),
        y2: position(options.y2),
      },
      [
        "halo",
        "id",
        "x1",
        "x2",
        "y1",
        "y2",
        "fill",
        "fillOpacity",
        "stroke",
        "strokeWidth",
        "strokeSides",
        "label",
        "contributeDomain",
        "legend",
        "zIndex",
        "axis",
        "facet",
        "panel",
        "clip",
      ],
    ),
  } as unknown as RegionSpec;
  if (table?.name !== undefined && readsTable([spec.x1, spec.x2, spec.y1, spec.y2], spec.label))
    spec.data = table.name;
  return new RegionMark(spec, table as unknown as Table | undefined);
}
