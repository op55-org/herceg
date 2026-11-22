import type { CategoryField, PositionField, Schema, Table } from "../data/table.ts";
import { labelHalo } from "../draw/label-halo.ts";
import { type Formatter, formatNumber, lazyFormat } from "../format/format.ts";
import {
  type LabelledMark,
  type LabelPlacement,
  type LabelRequest,
  placePanel,
  shiftWithin,
} from "../layout/placer.ts";
import { lineCount, type MeasureText } from "../layout/text.ts";
import { type Geometry, type LabelItems, NAMELESS, type Rect } from "../scene/scene.ts";
import type { LabelLayoutSpec, MarkAnchorSpec } from "../spec/encoding.ts";
import { ChartError } from "../spec/errors.ts";
import type { FormatSpec } from "../spec/guides.ts";
import type { BoxAnchor, ItemAnchor, ItemCoordinate } from "../spec/place.ts";
import type { AnnotationPosition, Clip, Frozen, TextLabelSpec, TextSpec } from "../spec/spec.ts";
import type { Halo, TextStyle as TextStyleSpec } from "../spec/style.ts";
import type { TextPaint } from "../style/style.ts";
import {
  AnnotationData,
  type ItemRefOf,
  inView,
  labelOf,
  leadersGeometry,
  type PlaceOption,
  position,
  readsTable,
  type TextField,
} from "./annotation.ts";
import type { DrawnMark, PartBuilders } from "./drawn.ts";
import type { ItemKeyed, LabelPartOf } from "./encoding.ts";
import type { PartText } from "./features/part-text.ts";
import { FollowingTextMark } from "./following.ts";
import { namesBy } from "./item-names.ts";
import {
  labelPaint,
  labelsGeometry,
  type PlacedLabel,
  paintedReach,
  plainText,
  textGeometry,
} from "./labels.ts";
import { definedFields } from "./line.ts";
import {
  type AxisFormat,
  type ChartMark,
  checkOptionalItemKey,
  type Frame,
  frozen,
  type MARK,
  type Mark,
  type MarkKey,
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
   * What the text is cut to: "plot", "chart", or false for nothing, labels
   * drawn exactly where told. Without it, text is drawn whole and stays
   * inside the chart (a label reaching past its edge goes to the other side
   * of its point, else moves in; a label of a point outside the chart is
   * drawn where told), and is left out while a place in data (a value,
   * field, or category) is out of the plot's view; text at pixels or a
   * share of a frame is drawn wherever it is.
   */
  clip?: Clip;
  /** With the chart's `panels`, the id of the panel to draw in, or "*" for every panel. */
  panel?: string;
  /** `true` lists the text in the chart's legends by its label; it is left out by default. */
  legend?: boolean;
  /** Where the text is drawn among the panel's marks: higher above lower; 0 by default. */
  zIndex?: number;
  /** `false`: the pointer passes through the marks: clicks, hover, and context menus pick what is under them. */
  pick?: boolean;
  /** `false`: tooltips, hover, and the keyboard leave the marks out. */
  inspect?: boolean;
  /** Whether the text's places count toward the axes' domains; false by default. */
  contributeDomain?: boolean;
  id?: string;
}

/**
 * Text's label: its text, or each row's `field`, styled (`style`: color,
 * font, size, box, `align`), and kept apart from other labels as its
 * layout says: those that would cover one of its overlap group (by
 * default, the mark's own labels) drawn anyway ("show", the default), left
 * out ("hide"), or moved ("move"): kept where they are put when that is
 * free and in the plot, else tried above, below, beside, and at the
 * corners of their point, then farther out, off the other labels' points,
 * and left out when nothing fits; the higher `priority` placed first, and
 * a `leader` from each label moved away from its point.
 */
export type TextLabel<F extends string = string> =
  | string
  | ((
      | { text: string; field?: never; content?: never }
      | { field: F; text?: never; content?: never }
      | { content: readonly LabelPartOf<F>[]; text?: never; field?: never; format?: never }
    ) &
      LabelLayoutSpec & {
        format?: FormatSpec;
        style?: TextStyleSpec;
      });

/**
 * Where text is: `at`, or its short forms `x` and `y`; or `from` a layout
 * item, at an anchor of its box. Item names are constants or category
 * fields `C` of the text's table.
 */
type TextPlace<F extends string, C extends string = never> =
  | { x: PlaceOption<F, C>; y: PlaceOption<F, C>; at?: never; from?: never }
  | { at: { x: PlaceOption<F, C>; y: PlaceOption<F, C> }; x?: never; y?: never; from?: never }
  | { from: ItemAnchorOf<C>; x?: never; y?: never; at?: never };

/** Text that follows a layout item (see `ItemAnchor`), its names typed by the text's table. */
export interface ItemAnchorOf<C extends string> extends ItemRefOf<C> {
  /** The point of the item's box the label is at, its block aligned to it unless its style says otherwise. */
  at: BoxAnchor;
  /** Pixels from the anchor, right and down. */
  offset?: { x?: number; y?: number };
}

/** Where each box anchor is along x and y, and how a label's block is aligned to it. */
const ANCHORS: Record<
  BoxAnchor,
  readonly [
    x: "start" | "center" | "end",
    y: "start" | "center" | "end",
    align: "start" | "center" | "end",
    verticalAlign: "top" | "middle" | "bottom",
  ]
> = {
  "top-left": ["start", "start", "start", "top"],
  top: ["center", "start", "center", "top"],
  "top-right": ["end", "start", "end", "top"],
  left: ["start", "center", "start", "middle"],
  center: ["center", "center", "center", "middle"],
  right: ["end", "center", "end", "middle"],
  "bottom-left": ["start", "end", "start", "bottom"],
  bottom: ["center", "end", "center", "bottom"],
  "bottom-right": ["end", "end", "end", "bottom"],
};

/**
 * The places on each axis of text following a layout item: the anchor's
 * edges of the item's box, moved by the offset. Throws for an anchor that
 * is none of a box's.
 */
export function itemPlaces(from: Frozen<ItemAnchor>): [ItemCoordinate, ItemCoordinate] {
  const anchor = ANCHORS[from.at];
  if (!anchor || !Object.hasOwn(ANCHORS, from.at))
    throw new ChartError({
      code: "invalid-option",
      path: "from.at",
      message: `text from.at: expected ${Object.keys(ANCHORS)
        .map((at) => JSON.stringify(at))
        .join(", ")}; received ${JSON.stringify(from.at)}`,
    });
  const item = { mark: from.mark, item: from.item };
  const { x, y } = from.offset ?? {};
  return [
    { item, at: anchor[0], ...(x !== undefined && { offset: x }) },
    { item, at: anchor[1], ...(y !== undefined && { offset: y }) },
  ];
}

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
 * (`place`: outside the plot, keeping room or not, and its offset; moved
 * apart from the panel's other series labels by default), so in no
 * overlap group.
 */
type FollowingLabel =
  | string
  | (Exclude<TextLabel, string> & { overlapGroup?: never } & Pick<TextLabelSpec, "place">);

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
  ItemKeyed<S> &
  TextPlace<PositionField<S>, CategoryField<S>> & { label: TextLabel<TextField<S>> };

/**
 * Text labels at data positions. They are drawn as SVG above the data and,
 * without a clip, left out while their point in data is out of view; meant
 * for annotations, not for labeling every point of a large series.
 */
export class TextMark implements Mark<Frozen<TextSpec>>, LabelledMark {
  declare readonly [MARK]: true;
  readonly spec: Frozen<TextSpec>;
  readonly tooltip = "x";
  readonly featured: boolean;
  readonly domainFallback: boolean;
  readonly #data: AnnotationData;
  /** The row of each label its text geometry drew (see `partOf`). */
  readonly #drawnRows = new WeakMap<Geometry, Uint32Array>();
  /** Its labels as last asked for by the panel's placer (see `labelRequests`). */
  #asked:
    | { frame: Frame; key: MarkKey; rows: RowParts | undefined; labels: TextLabels }
    | undefined;
  readonly placer = placePanel;
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
    // Text following a layout item is at edges of its box (see `itemPlaces`).
    const from = spec.from && "item" in spec.from ? spec.from : undefined;
    if (from && (spec.at || spec.x !== undefined || spec.y !== undefined))
      throw new Error("text from: a place on another mark, or at, or x and y; one of them");
    const [fromX, fromY] = from ? itemPlaces(from) : [];
    const x = fromX ?? spec.at?.x ?? spec.x;
    const y = fromY ?? spec.at?.y ?? spec.y;
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
    const own = labelOf(spec.label);
    // A label following an item is aligned to its anchor, as far as its style leaves it.
    const [, , align, verticalAlign] = from ? ANCHORS[from.at] : [];
    const label =
      own && align && verticalAlign
        ? { ...own, style: { align, verticalAlign, ...own.style } }
        : own;
    this.#data = new AnnotationData(
      table,
      from ? { "from.x": x, "from.y": y } : spec.at ? { "at.x": x, "at.y": y } : { x, y },
      label,
      "text",
      {
        x: "x",
        y: spec.axis === "right" ? "yRight" : "y",
      },
    );
    // Rows a constant annotation does not read have no items to name.
    checkOptionalItemKey(this.#data.table, this.spec.itemKey, "text");
    this.featured = lazyFormat(label?.format) || label?.content !== undefined;
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

  describe(
    format: AxisFormat,
    locale: string | undefined,
    rows?: RowParts,
    frames?: readonly Frame[],
  ): string | undefined {
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
      frames,
      format.content,
    );
  }

  xExtent(_series: unknown, log: boolean, _breaks?: unknown, rows?: RowParts) {
    return this.#data.extent([this.#x], log, undefined, rows);
  }

  get scaled() {
    return this.#data.scaled;
  }

  get follows() {
    return this.#data.follows;
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

  /** Its labels are rows (of its table, or of its places given alone); its leaders are no item's. */
  partOf(drawn: DrawnMark, geometry: Geometry, index: number, parts: PartBuilders) {
    const rows = this.#drawnRows.get(geometry);
    return rows && index < rows.length
      ? parts.annotation(drawn, this.table, rows[index]!)
      : undefined;
  }

  /**
   * Its labels, unless the panel's placer places them (`labelRequests`):
   * those of the items of `rows` (every item without them) the legend
   * leaves shown, each at its place.
   */
  geometry(_series: unknown, frame: Frame, key: MarkKey, panelRows?: RowParts): Geometry[] {
    if (this.#placed) return [];
    const labels = this.#labels(frame, key, panelRows);
    const drawn = labels.items.map((item) => labels.at(item, item.cx - item.shift, item.cy));
    return this.#drawn(frame, key, labels, drawn, labels.items, []);
  }

  /**
   * Its labels as requests to the panel's placer, where they keep apart
   * from others (`overlap` "hide" or "move", or an `overlapGroup`); none
   * otherwise, its geometry drawing them where they are.
   */
  labelRequests(frame: Frame, key: MarkKey, panelRows?: RowParts): readonly LabelRequest[] {
    if (!this.#placed) return [];
    const labels = this.#labels(frame, key, panelRows);
    // Asked for none, it is not asked to draw: keep no frame.
    this.#asked = labels.items.length > 0 ? { frame, key, rows: panelRows, labels } : undefined;
    return labels.items.map((item, index) => this.#request(labels, item, index, key));
  }

  /** Its labels at their placements, in request order, with leaders from those placed far. */
  drawLabels(
    frame: Frame,
    key: MarkKey,
    panelRows: RowParts | undefined,
    placements: readonly LabelPlacement[],
  ): Geometry[] {
    // As just asked for, in the same frame and panel; otherwise afresh.
    const asked = this.#asked;
    this.#asked = undefined;
    const labels =
      asked?.frame === frame && asked.key === key && asked.rows === panelRows
        ? asked.labels
        : this.#labels(frame, key, panelRows);
    const drawn: PlacedLabel[] = [];
    const items: TextItemLabel[] = [];
    const leaders: number[] = [];
    labels.items.forEach((item, k) => {
      const placement = placements[k];
      if (!placement) return;
      // Its middle, placed from its point.
      drawn.push(labels.at(item, item.px + placement.dx - item.shift, item.py + placement.dy));
      items.push(item);
      if (placement.leader) leaders.push(...placement.leader);
    });
    return this.#drawn(frame, key, labels, drawn, items, leaders);
  }

  /** Whether the panel's placer places its labels. */
  get #placed(): boolean {
    const { overlap, group } = this.#data.layout;
    return overlap !== "show" || group !== undefined;
  }

  /**
   * Item `index`'s label as a request: its block at its place (with the
   * room kept around it), the places around its point it may move to, ring
   * by ring (the first ring near), and the box it stays in when moving: the
   * plot, or the chart for a point outside it.
   */
  #request(labels: TextLabels, item: TextItemLabel, index: number, key: MarkKey): LabelRequest {
    const { group, overlap, priority, leader } = this.#data.layout;
    const { cx, cy, px, py, width } = item;
    const reach = width / 2 + labels.room;
    const tall = labels.halfOf(item);
    // Offsets are from the block centered on the point, which stay precise
    // however far the author's place is from it.
    const anchor = { x: px - reach, y: py - tall };
    const moving = overlap === "move";
    const { plot } = labels;
    const inPlot = holds(plot, px, py);
    return {
      mark: key,
      index,
      group,
      overlap,
      priority,
      anchor,
      block: { width: 2 * reach, height: 2 * tall },
      places: [{ dx: cx - px, dy: cy - py }],
      moves: moving
        ? {
            count: RINGS * AROUND.length,
            near: AROUND.length,
            at(k) {
              const ring = Math.floor(k / AROUND.length) + 1;
              const [ax, ay] = AROUND[k % AROUND.length]!;
              const gap = POINT_GAP + (ring - 1) * 2 * tall;
              return { dx: ax! * (gap + reach), dy: ay! * (gap + tall) };
            },
          }
        : undefined,
      point: { x: px, y: py, size: POINT_SIZE },
      inset: labels.room,
      hold: false,
      leader,
      bounds: moving ? (inPlot ? plot : labels.chart) : null,
    };
  }

  /**
   * The labels of the items of `rows` (every item without them) the legend
   * leaves shown and whose points are in view, in their order, each with
   * its text, its row, its point, and its box's middle at its place.
   */
  #labels(frame: Frame, key: MarkKey, panelRows: RowParts | undefined): TextLabels {
    // What the legend hides of it goes undrawn.
    const rows = this.#data.shown(frame.hidden, key, panelRows);
    const { spec } = this;
    const { plot, theme } = frame;
    const data = this.#data;
    const x = data.place(this.#x);
    const y = data.place(this.#y);
    const label = data.label!;
    const paint = labelPaint(
      theme,
      theme.text,
      label.style && frame.read(label.style, "text label.style"),
    );
    const content = frame.features?.of(this)?.content;
    const styled = content?.styled;
    const plain = !styled && plainText(paint, theme);
    const align = label.style?.align;
    const anchor = align === "start" ? "start" : align === "end" ? "end" : "middle";
    // The share of a label's width before its anchor.
    const share = anchor === "start" ? 0 : anchor === "end" ? 1 : 0.5;
    const write = data.writer(frame.locale, frame.features?.of(this)?.format);
    const font = paint.css;
    const haloOption = label.style?.halo ?? this.spec.halo;
    const halo = labelHalo(haloOption, frame);
    // How far halos and box outlines paint past a label's box.
    const reach = paintedReach(paint, halo);
    // Room around each label, which wider halos and box outlines reach past.
    const room = Math.max(LABEL_GAP, reach + 0.5);
    const chart = frame.chart ?? plot;
    // How far a label drawn from x, its box `width` wide, moves along x to
    // stay inside the chart, and one drawn from y, its painted block `up`
    // and `down` from it, along y: across `at` where given and where that
    // reaches less far past the chart's edge, then in.
    const alongX = (x: number, width: number, at?: number) =>
      shiftWithin(x - share * width - reach, width + 2 * reach, chart.x, chart.width, at);
    const alongY = (y: number, up: number, down: number, at?: number) =>
      shiftWithin(y - up, up + down, chart.y, chart.height, at);
    // Half a label's height, with the room kept around it: of a box (its
    // line height and padding) for labels in boxes.
    const [top, right, bottom, left] = paint.background ? paint.padding : [0, 0, 0, 0];
    const half =
      Math.ceil(
        paint.background ? paint.lineHeight / 2 + Math.max(top, bottom) : paint.size * 0.6,
      ) + room;
    // From its point to its block's middle (its box's, which labels in
    // boxes are placed by): the block's top, middle (by default), or bottom
    // at the point, as its style's verticalAlign says.
    const { verticalAlign } = paint;
    const lift = (lines: number) => {
      const block = (lines + top + bottom) / 2;
      return verticalAlign === "top" ? block : verticalAlign === "bottom" ? -block : 0;
    };
    // How much taller than a line a label's lines are.
    const more = ({ text, parts }: Pick<TextItemLabel, "text" | "parts">) =>
      parts ? parts.lines.height - paint.lineHeight : (lineCount(text) - 1) * paint.lineHeight;
    // Without a clip of its own, text shows while its places in data are in view.
    const shown = (px: number, py: number) =>
      Number.isFinite(px) &&
      Number.isFinite(py) &&
      (spec.clip !== undefined || (inView(x, px, "x", plot) && inView(y, py, "y", plot)));
    // The points labels belong to, which must be in view; their places' offsets move the labels.
    const dx = x.coordinate.offset ?? 0;
    const dy = y.coordinate.offset ?? 0;
    const [px0, py0] = [
      { ...x, coordinate: { ...x.coordinate, offset: 0 } },
      { ...y, coordinate: { ...y.coordinate, offset: 0 } },
    ];
    const placed = this.#placed;
    const items: TextItemLabel[] = [];
    data.each(rows, (row) => {
      const px = data.pixel(px0, "x", row, frame.x, frame) ?? Number.NaN;
      const py = data.pixel(py0, "y", row, frame.y, frame) ?? Number.NaN;
      if (!shown(px, py)) return;
      const text = data.text(row, frame.locale, write, content);
      // Labels that write nothing (none, or only breaks) take no room.
      if (placed && !/[^\n]/.test(text)) return;
      const parts = styled?.(row, "", Number.NaN, undefined, paint, frame);
      // Without a clip, labels of points in the chart stay inside it.
      const kept = spec.clip === undefined && holds(chart, px, py);
      const width =
        parts || placed || kept
          ? (parts?.lines.width ?? frame.measure(text, font)) + left + right
          : 0;
      const lines = paint.lineHeight + more({ text, parts });
      // Where it is drawn from (labels in items, their first line's middle),
      // and how far its painted block (its box, and what halos and outlines
      // paint past it) reaches above and below that.
      const from = plain ? 0 : (lines - paint.lineHeight) / 2;
      const painted = (lines + top + bottom) / 2 + reach;
      const [up, down] = [painted - from, painted + from];
      let lx = px + dx;
      let ly = py + dy + lift(lines) - from;
      if (kept) {
        // Across its point where that reaches less far past the chart's
        // edge (14 px above becomes 14 px below), then moved in.
        lx += alongX(lx, width, px);
        ly += alongY(ly, up, down, py);
      }
      // From the anchor to the label's middle.
      const shift = (0.5 - share) * width;
      items.push({
        row,
        text,
        px,
        py,
        width,
        shift,
        cx: lx + shift,
        cy: ly + from,
        parts,
        kept,
        up,
        down,
      });
    });
    return {
      items,
      write,
      styled: content !== undefined,
      plot,
      chart,
      room,
      padding: left + right,
      alongX,
      alongY,
      // Labels of parts are as tall as their lines and their box's padding,
      // whatever the base text's size.
      halfOf: ({ text, parts }) =>
        parts
          ? Math.ceil(parts.lines.height / 2 + (paint.background ? Math.max(top, bottom) : 0)) +
            room
          : half + more({ text, parts }) / 2,
      paint,
      plain,
      haloOption,
      // Placed by their middle, labels in items are drawn from their first
      // line; labels of parts, in their box.
      at: ({ text, parts }, lx, ly) => {
        const label: PlacedLabel = {
          text,
          x: lx,
          y: ly - (plain ? 0 : more({ text, parts }) / 2),
          anchor,
          baseline: "middle",
        };
        return parts ? { ...label, parts, box: parts.box(lx, ly, anchor, paint) } : label;
      },
    };
  }

  /** The geometry of `drawn`, the labels of `items`, and their `leaders`. */
  #drawn(
    frame: Frame,
    key: MarkKey,
    { paint, plain, haloOption, write, styled, padding, alongX, alongY }: TextLabels,
    drawn: PlacedLabel[],
    items: readonly TextItemLabel[],
    leaders: number[],
  ): Geometry[] {
    if (drawn.length === 0) return [];
    const rows = items.map((item) => item.row);
    const id = seriesKey(key, "text");
    const out: Geometry[] = [];
    if (leaders.length > 0)
      out.push(
        ...leadersGeometry(
          `${id}|leaders`,
          leaders,
          paint.color,
          this.#data.layout.look,
          frame,
          "text label.leader",
        ),
      );
    const owners: number[] = [];
    const labels = plain
      ? textGeometry(id, drawn, paint.color, haloOption, frame)
      : labelsGeometry(id, drawn, paint, haloOption, frame, owners);
    this.#drawnRows.set(
      labels,
      plain ? Uint32Array.from(rows) : Uint32Array.from(owners, (k) => rows[k]!),
    );
    if (frame.keyed) {
      const text = (value: number) => (write ?? ((v) => formatNumber(v, frame.locale)))(value);
      // A label placed again for a number between two, in its paint, its box measured with `count`.
      const again = (i: number, value: number, x: number, y: number, count: MeasureText) =>
        labelsGeometry(
          id,
          [{ ...drawn[i]!, text: text(value), x, y }],
          paint,
          haloOption,
          frame,
          undefined,
          count,
        ).items;
      labels.named = {
        ...this.#named(rows, styled),
        ...(labels.kind === "labels" && {
          at: drawn.flatMap(({ x, y }) => [x, y]),
          owners,
        }),
        write: (i, value, x, y, count) =>
          labels.kind === "text" ? text(value) : again(i, value, x, y, count),
        // Frames keep the labels the scene keeps inside the chart there
        // too: by their boxes' widths here, a counting label's by its number.
        ...(this.spec.clip === undefined && {
          stayInside: (i, at, written, count) => {
            const item = items[i]!;
            if (!item.kept) return;
            const width = written === undefined ? item.width : count(written, paint.css) + padding;
            at[i * 2]! += alongX(at[i * 2]!, width);
            at[i * 2 + 1]! += alongY(at[i * 2 + 1]!, item.up, item.down);
          },
        }),
      };
    }
    out.push(labels);
    return out;
  }

  /**
   * In charts that animate changed values, the names of the labels of
   * `rows` (their `itemKey` values, else row identities; places' indexes
   * for text without a table), and the numbers they write, unless written
   * by parts (`styled`).
   */
  #named(rows: readonly number[], styled: boolean): LabelItems {
    const { table } = this;
    const field = this.#data.label?.field;
    const numbers =
      !styled && table && field !== undefined && table.kind(field) !== "category"
        ? table.numbers(field as never)
        : undefined;
    const name = table
      ? this.spec.itemKey !== undefined
        ? namesBy(table, this.spec.itemKey)
        : (row: number) => NAMELESS + table.identity(row)
      : (row: number) => row;
    return {
      names: rows.map(name),
      table,
      generation: table?.generation ?? 0,
      values: numbers && rows.map((row) => numbers[row]!),
    };
  }
}

/**
 * A text mark's labels in a panel (`TextMark.#labels`): each item's, the
 * plot and chart, the room kept around each, half a label's height with
 * it, their paint, and where a label goes when its middle is at (x, y).
 */
interface TextLabels {
  readonly items: readonly TextItemLabel[];
  /** How numbers in the labels are written, unless the locale's default; whether labels are written by parts. */
  readonly write: Formatter | undefined;
  readonly styled: boolean;
  readonly plot: Rect;
  readonly chart: Rect;
  readonly room: number;
  /** A box's padding across. */
  readonly padding: number;
  /** How far a label drawn from x, its box `width` wide, moves along x to stay inside the chart (`#labels`). */
  alongX(x: number, width: number): number;
  /** How far a label drawn from y, its painted block `up` and `down` from it, moves along y to stay inside the chart. */
  alongY(y: number, up: number, down: number): number;
  halfOf(item: TextItemLabel): number;
  readonly paint: TextPaint;
  readonly plain: boolean;
  readonly haloOption: Halo | undefined;
  at(item: TextItemLabel, x: number, y: number): PlacedLabel;
}

/**
 * An item's label: its row, text (and its parts, where they have looks of
 * their own), point, width (its box's: measured where placed or kept
 * inside, and for parts), how far its middle is from its anchor along x,
 * and its middle at its place, kept inside the chart where it is `kept`;
 * and how far its painted block reaches above and below the point it is
 * drawn from.
 */
interface TextItemLabel {
  readonly row: number;
  readonly text: string;
  readonly parts: PartText | undefined;
  readonly px: number;
  readonly py: number;
  readonly width: number;
  readonly shift: number;
  readonly cx: number;
  readonly cy: number;
  readonly kept: boolean;
  readonly up: number;
  readonly down: number;
}

/** Whether `box` holds (x, y), its edges included. */
function holds(box: Rect, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
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
  const tagged = (place: PlaceOption<string, string>) => {
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
      "itemKey",
      "x",
      "y",
      "at",
      "from",
      "label",
      "contributeDomain",
      "legend",
      "zIndex",
      "pick",
      "inspect",
      "axis",
      "facet",
      "panel",
      "clip",
    ]),
  } as unknown as TextSpec;
  // Text following a mark's series reads that mark's rows.
  const { from } = spec;
  if (from && !("item" in from)) return new FollowingTextMark(spec);
  const places = from ? itemPlaces(from) : spec.at ? [spec.at.x, spec.at.y] : [spec.x, spec.y];
  if (table?.name !== undefined && readsTable(places as AnnotationPosition[], spec.label))
    spec.data = table.name;
  return new TextMark(spec, table as unknown as Table | undefined);
}
