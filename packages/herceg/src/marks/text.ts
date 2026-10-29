import type { PositionField, Schema, Table } from "../data/table.ts";
import { labelHalo } from "../draw/label-halo.ts";
import { guideSegmentDrawing } from "../draw/segments.ts";
import type { Formatter } from "../format/format.ts";
import { LabelBoxes, segmentMeetsBox, segmentsMeet } from "../layout/label-boxes.ts";
import { lineCount } from "../layout/text.ts";
import type { Geometry, Rect, SegmentGeometry } from "../scene/scene.ts";
import type { MarkAnchorSpec } from "../spec/encoding.ts";
import { ChartError } from "../spec/errors.ts";
import type { FormatSpec } from "../spec/guides.ts";
import type { AnnotationPosition, Clip, Frozen, TextLabelSpec, TextSpec } from "../spec/spec.ts";
import type { Halo, StrokeStyle, TextStyle as TextStyleSpec } from "../spec/style.ts";
import { dashPattern } from "../style/style.ts";
import {
  AnnotationData,
  inView,
  labelOf,
  type PlaceOption,
  position,
  readsTable,
  type TextField,
} from "./annotation.ts";
import type { LabelPartOf } from "./encoding.ts";
import { FollowingTextMark } from "./following.ts";
import { labelPaint, labelsGeometry, type PlacedLabel, plainText, textGeometry } from "./labels.ts";
import { definedFields } from "./line.ts";
import {
  type AxisFormat,
  type ChartMark,
  type Frame,
  frozen,
  type MARK,
  type Mark,
  type MarkKey,
  painted,
  type RowParts,
  seriesKey,
} from "./mark.ts";

interface TextStyle {
  /** The outline that keeps text readable: "auto" (the default), false for none, or a color of its own. */
  halo?: Halo;
  /** The y axis the values are on: "left" (default) or "right", the chart's `yRight`. */
  axis?: "left" | "right";
  /** With the chart's `facet`, draw all rows in every panel instead of splitting them. */
  facet?: "repeat";
  /**
   * What the text is cut to: "plot", "chart", or false for nothing. Without
   * it, text is drawn whole, and left out while a place in data (a value,
   * field, or category) is out of the plot's view; text at pixels or a
   * share of a frame is drawn wherever it is.
   */
  clip?: Clip;
  /** With the chart's `panels`, the id of the panel to draw in, or "*" for every panel. */
  panel?: string;
  /**
   * Labels that would cover an earlier one of this mark, in row order:
   * drawn anyway ("show", the default), left out ("hide"), or moved
   * ("move"): kept where they are put when that is free and in the plot,
   * else tried above, below, beside, and at the corners of their point,
   * then farther out with a line back to it, off the other rows' points,
   * and left out when nothing fits.
   */
  overlap?: "show" | "hide" | "move";
  /** How the lines from moved labels back to their points look. */
  style?: { leader?: StrokeStyle };
  /** `true` lists the text in the chart's legends by its label; it is left out by default. */
  legend?: boolean;
  /** Where the text is drawn among the panel's marks: higher above lower; 0 by default. */
  zIndex?: number;
  /** Whether the text's places count toward the axes' domains; false by default. */
  contributeDomain?: boolean;
  id?: string;
}

/** Text's label: its text, or each row's `field`, styled (`style`: color, font, size, box, `align`). */
export type TextLabel<F extends string = string> =
  | string
  | ((
      | { text: string; field?: never; content?: never }
      | { field: F; text?: never; content?: never }
      | { content: readonly LabelPartOf<F>[]; text?: never; field?: never; format?: never }
    ) & {
      format?: FormatSpec;
      style?: TextStyleSpec;
    });

/** Where text is: `at`, or its short forms `x` and `y`. */
type TextPlace<F extends string> =
  | { x: PlaceOption<F>; y: PlaceOption<F>; at?: never; from?: never }
  | { at: { x: PlaceOption<F>; y: PlaceOption<F> }; x?: never; y?: never; from?: never };

/**
 * Text following another mark's series (`from`), one label per series, of
 * no table of its own: its label's fields are the source mark's, read at
 * the observation each label is at.
 */
type FollowingText = {
  from: MarkAnchorSpec;
  x?: never;
  y?: never;
  at?: never;
  label: FollowingLabel;
};

/**
 * Following text's label: as text's, placed as series' labels are
 * (`place`: outside the plot, keeping room or not, and its offset).
 */
type FollowingLabel = string | (Exclude<TextLabel, string> & Pick<TextLabelSpec, "place">);

/** Room kept around each label against others, in pixels, at least: a default halo reaches 1.5. */
const LABEL_GAP = 2;
/** Room between a moved label and its point, in pixels. */
const POINT_GAP = 5;
/** Half the side of the box a labeled point keeps clear of moved labels, in pixels: a dot. */
const POINT_SIZE = 3;
/** Rings of places around its point a moved label tries, nearest first; each is a label's height farther. */
const RINGS = 3;
/**
 * Where a moved label may go in each ring, as directions from its point:
 * above, below, after, before, then the corners.
 */
const AROUND: readonly (readonly [number, number])[] = [
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
  [1, -1],
  [-1, -1],
  [1, 1],
  [-1, 1],
];
/** One label at a constant place, or labels following another mark's series. */
export type TextOptions = TextStyle &
  ((TextPlace<never> & { label: TextLabel<never> }) | FollowingText);

/** Labels from a table, one per row; places may also be constants. */
export type TextDataOptions<S extends Schema> = TextStyle &
  TextPlace<PositionField<S>> & { label: TextLabel<TextField<S>> };

/**
 * Text labels at data positions. They are drawn as SVG above the data and,
 * without a clip, left out while their point in data is out of view; meant
 * for annotations, not for labeling every point of a large series.
 */
export class TextMark implements Mark<Frozen<TextSpec>> {
  declare readonly [MARK]: true;
  readonly spec: Frozen<TextSpec>;
  readonly tooltip = "x";
  readonly featured: boolean;
  readonly domainFallback: boolean;
  readonly #data: AnnotationData;
  /** Its place on each axis: `at`'s, or the short forms'. */
  readonly #x: Frozen<AnnotationPosition>;
  readonly #y: Frozen<AnnotationPosition>;

  constructor(input: TextSpec, table?: Table) {
    this.spec = frozen(input);
    // Read from the copy: the caller may change what it passed.
    const spec = this.spec;
    this.domainFallback = spec.contributeDomain !== true;
    if (spec.at && (spec.x !== undefined || spec.y !== undefined))
      throw new Error("text at: a place, or its short forms x and y, not both; drop at or x and y");
    const x = spec.at?.x ?? spec.x;
    const y = spec.at?.y ?? spec.y;
    if (x === undefined || y === undefined) throw new Error("text: needs a place: at, or x and y");
    if (spec.label === undefined)
      throw new Error("text label: required; give its text, or { field }");
    if (typeof spec.label === "object" && spec.label.place !== undefined)
      throw new ChartError({
        code: "invalid-option",
        path: "label.place",
        message:
          "text label.place: text at a place is drawn there; drop place, or follow a series with from",
      });
    this.#x = x;
    this.#y = y;
    const label = labelOf(spec.label);
    this.#data = new AnnotationData(
      table,
      spec.at ? { "at.x": x, "at.y": y } : { x, y },
      label,
      "text",
      {
        x: "x",
        y: spec.axis === "right" ? "yRight" : "y",
      },
    );
    const format = label?.format as { number?: unknown; time?: unknown } | undefined;
    this.featured =
      format?.number !== undefined || format?.time !== undefined || label?.content !== undefined;
  }

  get table(): Table | undefined {
    return this.#data.table;
  }

  channelKind(axis: "x" | "y") {
    return this.#data.kind(axis === "x" ? this.#x : this.#y);
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

  describe(format: AxisFormat, locale: string | undefined, rows?: RowParts): string | undefined {
    const data = this.#data;
    const x = data.place(this.#x);
    const y = data.place(this.#y);
    return data.summary(
      ["Label", "Labels"],
      locale,
      (i) => {
        const at = data.value(x, i);
        const value = data.value(y, i);
        // Places that are not values or categories (fractions, pixels) say
        // nothing of where the text is.
        if (x.kind === "value" && !Number.isFinite(at)) return undefined;
        if (y.kind === "value" && !Number.isFinite(value)) return undefined;
        const [cx, cy] = [data.category(x, i), data.category(y, i)];
        return [
          x.kind === "value" ? `x ${format.x(at)}` : cx !== undefined && `x ${cx}`,
          y.kind === "value" ? `y ${format.y(value)}` : cy !== undefined && `y ${cy}`,
        ]
          .filter(Boolean)
          .join(", ");
      },
      rows,
      format.content,
    );
  }

  xExtent(_series: unknown, log: boolean, _breaks?: unknown, rows?: RowParts) {
    return this.#data.extent([this.#x], log, undefined, rows);
  }

  get scaled() {
    return this.#data.scaled;
  }

  scaleExtent(name: string, axis: "x" | "y", log: boolean, rows?: RowParts) {
    return this.#data.extent([axis === "x" ? this.#x : this.#y], log, undefined, rows, name);
  }

  yExtent(
    _series: unknown,
    x0: number,
    x1: number,
    log: boolean,
    _breaks?: unknown,
    rows?: RowParts,
  ) {
    // Only labels inside the x view count toward y.
    const x = this.#data.place(this.#x);
    if (x.kind !== "value" || x.scale) return this.#data.extent([this.#y], log, undefined, rows);
    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    const inView = (i: number) => {
      const value = this.#data.value(x, i);
      return value >= lo && value <= hi;
    };
    return this.#data.extent([this.#y], log, inView, rows);
  }

  /**
   * Labels of the items of `rows` (every item without them), placed in
   * their order. Scratch is as large as the items drawn: a facet panel's,
   * not the table's.
   */
  geometry(_series: unknown, frame: Frame, key: MarkKey, panelRows?: RowParts): Geometry[] {
    // What the legend hides of it goes undrawn.
    const rows = this.#data.shown(frame.hidden, key, panelRows);
    const { spec } = this;
    const { plot, theme } = frame;
    const data = this.#data;
    const id = seriesKey(key, "text");
    const x = data.place(this.#x);
    const y = data.place(this.#y);
    const label = data.label!;
    const paint = labelPaint(
      theme,
      theme.text,
      label.style && frame.read(label.style, "text label.style"),
    );
    const plain = plainText(paint, theme);
    const align = label.style?.align;
    const anchor = align === "start" ? "start" : align === "end" ? "end" : "middle";
    const write = data.writer(frame.locale, frame.features?.of(this)?.format);
    const content = frame.features?.of(this)?.content;
    const overlap = spec.overlap ?? "show";
    const placed = overlap === "show" ? undefined : new LabelBoxes();
    const moving = overlap === "move";
    const font = paint.css;
    const haloOption = label.style?.halo ?? this.spec.halo;
    const halo = labelHalo(haloOption, frame);
    // Room around each label, which wider halos reach past.
    const room = Math.max(LABEL_GAP, (halo?.width ?? 0) / 2 + 0.5);
    // Half a label's height, with the room kept around it: of a box (its
    // line height and padding) for labels in boxes.
    const [top, right, bottom, left] = paint.background ? paint.padding : [0, 0, 0, 0];
    const half =
      Math.ceil(
        paint.background ? paint.lineHeight / 2 + Math.max(top, bottom) : paint.size * 0.6,
      ) + room;
    // A label of several lines is as much taller as its lines after the first.
    const halfOf = (label: string) => half + ((lineCount(label) - 1) * paint.lineHeight) / 2;
    // From its point to its block's middle (its box's, which labels in
    // boxes are placed by): the block's top, middle (by default), or bottom
    // at the point, as its style's verticalAlign says.
    const { verticalAlign } = paint;
    const lift = (label: string) => {
      const block = (lineCount(label) * paint.lineHeight + top + bottom) / 2;
      return verticalAlign === "top" ? block : verticalAlign === "bottom" ? -block : 0;
    };
    const chart = frame.chart ?? plot;
    const inside = (box: Rect, x0: number, y0: number, x1: number, y1: number) =>
      x0 >= box.x && x1 <= box.x + box.width && y0 >= box.y && y1 <= box.y + box.height;
    const inPlot = (x0: number, y0: number, x1: number, y1: number) => inside(plot, x0, y0, x1, y1);
    // Without a clip of its own, text shows while its places in data are in view.
    const shown = (px: number, py: number) =>
      Number.isFinite(px) &&
      Number.isFinite(py) &&
      (spec.clip !== undefined || (inView(x, px, "x", plot) && inView(y, py, "y", plot)));
    // The points labels belong to, which must be in view; their places' offsets move the labels.
    const dx = x.coordinate.offset ?? 0;
    const dy = y.coordinate.offset ?? 0;
    const [px, py] = [
      { ...x, coordinate: { ...x.coordinate, offset: 0 } },
      { ...y, coordinate: { ...y.coordinate, offset: 0 } },
    ];
    const pointAt = (row: number) => [
      data.pixel(px, "x", row, frame.x, frame) ?? Number.NaN,
      data.pixel(py, "y", row, frame.y, frame) ?? Number.NaN,
    ];
    // Scratch is indexed by each item's place among those drawn, whose row
    // `rowAt` gives: a panel's rows are one part, read as they are.
    const size = data.size(rows);
    const items = rows?.length === 1 ? rows[0]! : rows && new Uint32Array(size);
    if (items && items !== rows![0]) data.each(rows, (row, place) => (items[place] = row));
    const rowAt = (place: number) => (items ? items[place]! : place);
    // Moved labels keep off the points of the other rows in view.
    const dots = moving ? new LabelBoxes() : undefined;
    const dotOf = new Int32Array(dots ? size : 0).fill(-1);
    if (dots) {
      for (let place = 0; place < size; place++) {
        const [px, py] = pointAt(rowAt(place)) as [number, number];
        const s = POINT_SIZE;
        if (inPlot(px, py, px, py)) dotOf[place] = dots.add(px - s, py - s, px + s, py + s);
      }
    }
    // Each item's label and where it goes, kept in order whichever pass places it.
    const texts: (string | undefined)[] = new Array(size);
    const at = new Float64Array(size * 2);
    const add = (place: number, label: string, lx: number, ly: number) => {
      texts[place] = label;
      at[place * 2] = lx;
      at[place * 2 + 1] = ly;
    };
    // Lines from labels moved past the first ring back to their points.
    const leaders: number[] = [];
    /** Whether some line passes through the box, or with a segment given, meets it. */
    const meetsLeader = (test: (sx: number, sy: number, ex: number, ey: number) => boolean) => {
      for (let k = 0; k < leaders.length; k += 4)
        if (test(leaders[k]!, leaders[k + 1]!, leaders[k + 2]!, leaders[k + 3]!)) return true;
      return false;
    };
    // Places are boxes' centers: the author's (place 0), then, when moving,
    // the spots around the point, ring by ring, nearest sides first.
    const nearPlaces = moving ? 1 + AROUND.length : 1;
    /** Puts an item's label at the first free spot in [from, to); false if none is. */
    const place = (item: number, label: string, width: number, from: number, to: number) => {
      const [px, py] = pointAt(rowAt(item)) as [number, number];
      // Moved labels stay in the plot, or in the chart when put outside it.
      const bounds = inPlot(px, py, px, py) ? plot : chart;
      // From the anchor to the label's center, and half its box's width and height.
      const shift = anchor === "start" ? width / 2 : anchor === "end" ? -width / 2 : 0;
      const reach = width / 2 + room;
      const tall = halfOf(label);
      for (let p = from; p < to; p++) {
        const ring = Math.ceil(p / AROUND.length);
        const [ax, ay] = AROUND[(p - 1) % AROUND.length] ?? [0, 0];
        const gap = POINT_GAP + (ring - 1) * 2 * tall;
        const [cx, cy] =
          p === 0
            ? [px + dx + shift, py + dy + lift(label)]
            : [px + ax * (gap + reach), py + ay * (gap + tall)];
        const [x0, y0, x1, y1] = [cx - reach, cy - tall, cx + reach, cy + tall];
        // Moving labels stay in their bounds, and moved ones off other points
        // and the lines leading to other labels.
        if (moving && !inside(bounds, x0, y0, x1, y1)) continue;
        // Labels before dots: in a crowded plot labels refuse most places,
        // and there are fewer of them to check.
        if (placed!.hits(x0, y0, x1, y1)) continue;
        if (p > 0 && dots!.hits(x0, y0, x1, y1, dotOf[item])) continue;
        if (meetsLeader((sx, sy, ex, ey) => segmentMeetsBox(sx, sy, ex, ey, x0, y0, x1, y1)))
          continue;
        if (ring > 1) {
          // A line from the dot's edge to the nearest point of the text's
          // box, clear of other labels (so none from a point under one),
          // other rows' dots, and other lines.
          const ex = Math.min(Math.max(px, cx - width / 2), cx + width / 2);
          const ey = Math.min(Math.max(py, y0 + room), y1 - room);
          const length = Math.hypot(ex - px, ey - py);
          const sx = px + ((ex - px) / length) * POINT_SIZE;
          const sy = py + ((ey - py) / length) * POINT_SIZE;
          if (placed!.crosses(sx, sy, ex, ey)) continue;
          if (dots!.crosses(sx, sy, ex, ey, dotOf[item])) continue;
          if (meetsLeader((ax, ay, bx, by) => segmentsMeet(sx, sy, ex, ey, ax, ay, bx, by)))
            continue;
          leaders.push(sx, sy, ex, ey);
        }
        placed!.add(x0, y0, x1, y1);
        add(item, label, cx - shift, cy);
        return true;
      }
      return false;
    };
    // Labels that found no place near their point: item, text, and width.
    const later: [number, string, number][] = [];
    for (let item = 0; item < size; item++) {
      const row = rowAt(item);
      const [px, py] = pointAt(row) as [number, number];
      if (!shown(px, py)) continue;
      const label = data.text(row, frame.locale, write, content);
      if (!placed) {
        add(item, label, px + dx, py + dy + lift(label));
        continue;
      }
      // Empty labels draw nothing, so they take no room.
      if (label === "") continue;
      const width = frame.measure(label, font) + left + right;
      if (!place(item, label, width, 0, nearPlaces) && moving) later.push([item, label, width]);
    }
    // Then those go farther out, once every label that fits near its point
    // has its place, so lines never take a nearer label's room.
    for (const [item, label, width] of later)
      place(item, label, width, nearPlaces, nearPlaces + (RINGS - 1) * AROUND.length);
    const drawn: PlacedLabel[] = [];
    for (let item = 0; item < size; item++) {
      const text = texts[item];
      if (text === undefined) continue;
      // Placed by their middle, labels in items are drawn from their first line.
      const y = at[item * 2 + 1]! - (plain ? 0 : ((lineCount(text) - 1) * paint.lineHeight) / 2);
      drawn.push({ text, x: at[item * 2]!, y, anchor, baseline: "middle" });
    }
    if (drawn.length === 0) return [];
    const out: Geometry[] = [];
    if (leaders.length > 0) {
      const leader = spec.style?.leader;
      const strokeWidth = leader?.strokeWidth ?? 1;
      const segments: SegmentGeometry = {
        kind: "segments",
        draw: guideSegmentDrawing,
        key: `${id}|leaders`,
        stroke: painted(frame.paint, leader?.stroke, "text style.leader.stroke") ?? theme.muted,
        strokeWidth,
        coords: Float32Array.from(leaders),
        count: leaders.length / 4,
      };
      const dash = dashPattern(leader?.dash, strokeWidth);
      if (dash) segments.dash = dash;
      if (leader?.opacity !== undefined) segments.opacity = leader.opacity;
      out.push(segments);
    }
    out.push(
      plain
        ? textGeometry(id, drawn, paint.color, haloOption, frame)
        : labelsGeometry(id, drawn, paint, haloOption, frame),
    );
    return out;
  }
}

/**
 * Text at a place: one label at a constant place, or one per row of a
 * table. Places mix kinds: a fraction of the plot's width at a data value.
 *
 * ```ts
 * text({ x: launch, y: 120, label: "Launch" })
 * text({ at: { x: { fraction: 0.03 }, y: { data: 1.7 } }, label: { text: "Target", style: { align: "start" } } })
 * text(peaks, { x: "time", y: { field: "value", offset: -10 }, label: { field: "value" } })
 * ```
 */
export function text(options: TextOptions): ChartMark<Frozen<TextSpec>>;
export function text<S extends Schema>(
  table: Table<S>,
  options: TextDataOptions<S>,
): ChartMark<Frozen<TextSpec>>;
export function text<S extends Schema>(
  first: Table<S> | TextOptions,
  second?: TextDataOptions<S>,
): ChartMark<Frozen<TextSpec>> {
  const table = second ? (first as Table<S>) : undefined;
  const options = (second ?? first) as TextDataOptions<S>;
  // A position's places are coordinates in specs: values and fields tagged.
  const tagged = (place: PlaceOption<string>) => {
    const value = position(place);
    return typeof value === "number"
      ? { data: value }
      : typeof value === "string"
        ? { field: value }
        : value;
  };
  const at = options.at && { x: tagged(options.at.x), y: tagged(options.at.y) };
  const spec = {
    type: "text",
    ...definedFields({ ...options, x: position(options.x), y: position(options.y), at }, [
      "halo",
      "id",
      "x",
      "y",
      "at",
      "from",
      "label",
      "overlap",
      "style",
      "contributeDomain",
      "legend",
      "zIndex",
      "axis",
      "facet",
      "panel",
      "clip",
    ]),
  } as unknown as TextSpec;
  // Text following a mark's series reads that mark's rows.
  if (spec.from) return new FollowingTextMark(spec);
  const places = spec.at ? [spec.at.x, spec.at.y] : [spec.x, spec.y];
  if (table?.name !== undefined && readsTable(places as AnnotationPosition[], spec.label))
    spec.data = table.name;
  return new TextMark(spec, table as unknown as Table | undefined);
}
