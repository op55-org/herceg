import type { CategoryField, PositionField, Schema, Table } from "../data/table.ts";
import { labelHalo } from "../draw/label-halo.ts";
import { rectDrawing, sideMask } from "../draw/rect.ts";
import { type Formatter, lazyFormat } from "../format/format.ts";
import { anchorBlock } from "../layout/block.ts";
import {
  type LabelledMark,
  type LabelPlacement,
  type LabelRequest,
  placePanel,
  slidesAlong,
} from "../layout/placer.ts";
import { lineCount, type MeasureText, textLines } from "../layout/text.ts";
import type { CompiledFeatures, RowPaint } from "../model/features.ts";
import type { PositionScale } from "../scale/scale.ts";
import type { Geometry, LabelsGeometry, RectGeometry } from "../scene/scene.ts";
import type { LabelLayoutSpec, LabelPlaceSpec } from "../spec/encoding.ts";
import type { Side } from "../spec/place.ts";
import type {
  AnnotationPosition,
  Clip,
  Frozen,
  RegionRange,
  RegionSpec,
  RegionSteps,
} from "../spec/spec.ts";
import type { Halo } from "../spec/style.ts";
import type { TextPaint } from "../style/style.ts";
import {
  AnnotationData,
  type AtThresholds,
  checkLegend,
  type Items,
  itemsIn,
  labelOf,
  type Place,
  type PlaceOption,
  position,
  readsTable,
  type TextField,
  thresholdPlace,
} from "./annotation.ts";
import type { DrawnMark, PartBuilders } from "./drawn.ts";
import type { ItemKeyed, RowChannels, RowColorChannels } from "./encoding.ts";
import type { PartText } from "./features/part-text.ts";
import {
  grown,
  labelBox,
  labelPaint,
  labelsGeometry,
  movedLabel,
  type PlacedLabel,
  paintedReach,
  plainText,
  textGeometry,
} from "./labels.ts";
import { definedFields } from "./line.ts";
import {
  type AxisFormat,
  type ChartMark,
  checkOption,
  checkOptionalItemKey,
  type Frame,
  frozen,
  isPixels,
  isSides,
  type MARK,
  type Mark,
  type MarkKey,
  painted,
  type RowParts,
  rowBuffer,
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
   * What the regions are cut to: "plot", or the chart with "chart" or false,
   * so regions at pixels or a share of the chart outside the plot show.
   * Without it, regions are cut to the plot and labels are drawn whole.
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
  /** `false`: the pointer passes through the marks: clicks, hover, and context menus pick what is under them. */
  pick?: boolean;
  /** `false`: tooltips, hover, and the keyboard leave the marks out. */
  inspect?: boolean;
  id?: string;
}

/**
 * A region between constant places: an x range, a y range, or both (a
 * rectangle); or bands at a field's thresholds along y or x
 * (`{ thresholds: "p99" }`), each in its step's color unless `fill` is given.
 */
export type RegionOptions = RegionStyle &
  (RegionRange<PlaceOption<never>> | RegionSteps<PlaceOption<never>, AtThresholds>) & {
    /** Text drawn in the region (its top left corner by default): its text, or a label object. */
    label?: RuleLabel<never, RegionLabelLayout>;
  };

/** Regions from a table, one per row; places may also be constants. */
export type RegionDataOptions<S extends Schema> = RegionStyle &
  ItemKeyed<S> &
  RegionRange<PlaceOption<PositionField<S>, CategoryField<S>>> & {
    /** Text drawn in every region: constant, or each row's `field`. */
    label?: RuleLabel<TextField<S>, RegionLabelLayout>;
    /**
     * Each row's paint: `color` (the fill) or `fill`, `stroke`, and
     * `opacity`, which scales the fill's `fillOpacity` and the outline's;
     * fields through the chart's scales (a channel scale for numbers).
     * Regions are drawn in row order whatever their looks.
     */
    encode?: {
      color?: RowColorChannels<S>;
      fill?: RowColorChannels<S>;
      stroke?: RowColorChannels<S>;
      opacity?: RowChannels<number, S>;
    };
  };

/** Region labels slide along their side and draw no leaders. */
type RegionLabelLayout = LabelLayoutSpec & { leader?: never };

/** Pixels between a region's edge and its label. */
const PADDING = 4;

/** Why a region spec has no range, or half of one, or bands at thresholds and a range along one axis, if it does. */
export function regionFormError(spec: {
  x?: unknown;
  y?: unknown;
  x1?: unknown;
  x2?: unknown;
  y1?: unknown;
  y2?: unknown;
}): string | undefined {
  if (spec.x !== undefined && spec.y !== undefined)
    return "region: bands at thresholds go along x or along y; give one";
  for (const axis of ["x", "y"] as const)
    if (spec[axis] !== undefined) {
      if (typeof spec[axis] !== "object" || spec[axis] === null || !("thresholds" in spec[axis]))
        return `region ${axis}: places bands at a field's thresholds, such as { thresholds: "p99" }; give ${axis}1 and ${axis}2 for a range`;
      if (spec[`${axis}1`] !== undefined || spec[`${axis}2`] !== undefined)
        return `region: ${axis} places bands at thresholds, and ${axis}1 and ${axis}2 a range; give one`;
    }
  if ((spec.x1 === undefined) !== (spec.x2 === undefined))
    return "region: needs both x1 and x2, or neither";
  if ((spec.y1 === undefined) !== (spec.y2 === undefined))
    return "region: needs both y1 and y2, or neither";
  if (
    spec.x1 === undefined &&
    spec.y1 === undefined &&
    spec.x === undefined &&
    spec.y === undefined
  )
    return "region: needs x1 and x2, y1 and y2, or both";
  return undefined;
}

/**
 * Shaded regions: between x1 and x2 across the plot's height, between y1
 * and y2 across its width, or rectangles with both. Their values count
 * toward the axes' domains when they say so (`contributeDomain`).
 */
export class RegionMark implements Mark<Frozen<RegionSpec>>, LabelledMark {
  declare readonly [MARK]: true;
  readonly spec: Frozen<RegionSpec>;
  readonly tooltip = "x";
  readonly featured: boolean;
  readonly domainFallback: boolean;
  readonly thresholds: AtThresholds | undefined;
  readonly #data: AnnotationData;
  /** Its places as its data reads them: at thresholds, the bands' columns. */
  readonly #positions: Readonly<
    Record<"x1" | "x2" | "y1" | "y2", Frozen<AnnotationPosition> | undefined>
  >;
  /** Its items in a chart of compiled features (see `itemsIn`). */
  readonly #items: (features: CompiledFeatures | undefined) => Items;
  /** The rows each geometry drawn draws, by item (see `partOf`). */
  readonly #drawnRows = new WeakMap<Geometry, Uint32Array>();
  /** At thresholds, the step of each region or label a geometry drew (see `partOf`). */
  readonly #stepKeys = new WeakMap<Geometry, readonly string[]>();
  /** The label drawn as regions always draw theirs: plain text, in the top left corner. */
  readonly #plain: boolean;
  /**
   * Its labels, kept from drawing its regions to drawing the labels in one
   * panel and frame, so the panel's placer reads its rows once.
   */
  #kept:
    | { frame: Frame; key: MarkKey; rows: RowParts | undefined; labels: RegionLabel[] }
    | undefined;
  readonly placer = placePanel;

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
    // An encoding of no channels paints nothing, and reads no rows.
    if (input.encode && Object.keys(input.encode).length === 0) {
      const { encode: _, ...rest } = input;
      input = rest;
    }
    const problem = regionFormError(input);
    if (problem) throw new Error(problem);
    const [held, stepped] = thresholdPlace(input, "region");
    this.spec = frozen(held);
    this.thresholds = stepped;
    // Read from the copy: the caller may change what it passed.
    const spec = this.spec;
    this.domainFallback = spec.contributeDomain !== true;
    const label = labelOf(spec.label);
    // Channels paint each row of the table, wherever the rows' places are.
    if (spec.encode && !table)
      throw new Error(
        "region encode: channels read the rows of a table; give region(table, options), or drop encode",
      );
    const along = spec.x === undefined ? "y" : "x";
    // At thresholds, the bands' ends are their columns (see `stepItems`).
    const positions = {
      x1: stepped && along === "x" ? "from" : spec.x1,
      x2: stepped && along === "x" ? "to" : spec.x2,
      y1: stepped && along === "y" ? "from" : spec.y1,
      y2: stepped && along === "y" ? "to" : spec.y2,
    };
    this.#positions = positions;
    const across = along === "y" ? [spec.x1, spec.x2] : [spec.y1, spec.y2];
    if (stepped && readsTable(across, spec.label, spec.encode))
      throw new Error(
        `region ${along}.thresholds: regions at thresholds stand for steps, not rows; give the other places and label no fields, and drop encode`,
      );
    const data = (columns?: Record<string, Float64Array>) =>
      new AnnotationData(
        table,
        positions,
        label,
        "region",
        { x: "x", y: spec.axis === "right" ? "yRight" : "y" },
        "x",
        spec.encode,
        columns,
      );
    // Without the chart's steps, it has none.
    const none = new Float64Array(0);
    this.#data = data(stepped && { from: none, to: none });
    this.#items = itemsIn(this, this.#data, !!stepped, true, data);
    // Rows a constant annotation does not read have no items to name.
    checkOptionalItemKey(this.#data.table, this.spec.itemKey, "region");
    this.#plain = label !== undefined && !label.style && !label.place && !label.format;
    this.featured =
      lazyFormat(label?.format) ||
      label?.content !== undefined ||
      spec.encode !== undefined ||
      !!stepped;
  }

  get table(): Table | undefined {
    return this.#data.table;
  }

  channelKind(axis: "x" | "y") {
    const [a, b] = this.#pair(axis);
    return this.#data.kind(a) ?? this.#data.kind(b);
  }

  describe(
    format: AxisFormat,
    locale: string | undefined,
    rows?: RowParts,
    frames?: readonly Frame[],
    features?: CompiledFeatures,
  ): string | undefined {
    const data = this.#items(frames?.[0]?.features ?? features).data;
    const x = this.#places("x", data);
    const y = this.#places("y", data);
    const starts = this.thresholds && (this.spec.x === undefined ? y : x)?.[0];
    // Places that are not values or categories (fractions, pixels) say
    // nothing of where the region is; bands at thresholds open at an end
    // say where they start or end.
    const range = (places: [Place, Place] | undefined, f: Formatter, i: number) => {
      if (!places || places.some((p) => p.kind === "frame" || p.kind === "item")) return "";
      const [a, b] = places.map((p) =>
        p.kind === "category"
          ? data.category(p, i)
          : Number.isFinite(data.value(p, i))
            ? f(data.value(p, i))
            : undefined,
      );
      if (this.thresholds && (a ?? b) !== undefined)
        return a === undefined ? `up to ${b}` : b === undefined ? `from ${a}` : `${a} to ${b}`;
      return a !== undefined && b !== undefined ? `${a} to ${b}` : undefined;
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
      frames,
      format.content,
      // Labels at thresholds write each band's step, as drawn.
      starts && ((i) => data.value(starts, i)),
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

  xExtent(
    _series: unknown,
    log: boolean,
    _breaks?: unknown,
    rows?: RowParts,
    features?: CompiledFeatures,
  ) {
    return this.#items(features).data.extent(this.#pair("x"), log, undefined, rows);
  }

  get scaled() {
    return this.#data.scaled;
  }

  get follows() {
    return this.#data.follows;
  }

  scaleExtent(
    name: string,
    axis: "x" | "y",
    log: boolean,
    rows?: RowParts,
    features?: CompiledFeatures,
  ) {
    return this.#items(features).data.extent(this.#pair(axis), log, undefined, rows, name);
  }

  yExtent(
    _series: unknown,
    x0: number,
    x1: number,
    log: boolean,
    _breaks?: unknown,
    rows?: RowParts,
    features?: CompiledFeatures,
  ) {
    const data = this.#items(features).data;
    const x = this.#places("x", data);
    if (!x) return data.extent(this.#pair("y"), log, undefined, rows);
    // Regions that also span x count toward y only where they overlap the view.
    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    // An edge at a fraction, pixels, a category, or on a scale of the
    // chart's own is in view wherever x is.
    const edge = (place: Place, i: number, end: number) =>
      place.kind === "value" && !place.scale ? data.value(place, i) : end;
    const overlaps = (i: number) => {
      const p = edge(x[0], i, hi);
      const q = edge(x[1], i, lo);
      return Math.max(p, q) >= lo && Math.min(p, q) <= hi;
    };
    return data.extent(this.#pair("y"), log, overlaps, rows);
  }

  /** Its regions; the panel's placer places their labels (`labelRequests`). */
  geometry(_series: unknown, frame: Frame, key: MarkKey, panelRows?: RowParts): Geometry[] {
    const { fills, labels } = this.#regions(frame, key, panelRows);
    // The panel's placer asks for their labels next.
    this.#kept = this.#data.label ? { frame, key, rows: panelRows, labels } : undefined;
    return fills;
  }

  /** Its labels, for a panel's placer (see `LabelledMark`). */
  labelRequests(frame: Frame, key: MarkKey, panelRows?: RowParts): readonly LabelRequest[] {
    if (!this.#data.label) return [];
    const labels = this.#labelsIn(frame, key, panelRows);
    // Asked for none, it is not asked to draw: let the frame go.
    if (labels.length === 0) this.#kept = undefined;
    return labels.map(({ request }) => request);
  }

  /** Its labels at their placements, in request order. */
  drawLabels(
    frame: Frame,
    key: MarkKey,
    panelRows: RowParts | undefined,
    placements: readonly LabelPlacement[],
  ): Geometry[] {
    const labels = this.#labelsIn(frame, key, panelRows);
    this.#kept = undefined;
    return this.#drawLabels(frame, key, labels, placements);
  }

  /** Its labels in `frame`'s panel: as just drawn there, or afresh. */
  #labelsIn(frame: Frame, key: MarkKey, rows: RowParts | undefined): RegionLabel[] {
    const kept = this.#kept;
    if (kept?.frame === frame && kept.key === key && kept.rows === rows) return kept.labels;
    const { labels } = this.#regions(frame, key, rows);
    this.#kept = { frame, key, rows, labels };
    return labels;
  }

  /**
   * Its regions of the rows the legend leaves shown, each cut to its box
   * (the plot, or the chart), and their labels, each placed in its region's
   * visible part and asked to stay inside the box. Rows with looks of their
   * own (`encode`) are drawn in row order, a geometry per run of rows of
   * one look.
   */
  #regions(
    frame: Frame,
    key: MarkKey,
    panelRows: RowParts | undefined,
  ): { fills: RectGeometry[]; labels: RegionLabel[] } {
    // What the legend hides of it goes undrawn.
    const { data, keys, colors } = this.#items(frame.features);
    const rows = data.shown(frame.hidden, key, panelRows);
    const { plot, theme } = frame;
    const id = seriesKey(key, "region");
    const xs = this.#places("x", data);
    const ys = this.#places("y", data);
    // At thresholds, a band's label writes the step it starts at.
    const starts = this.thresholds && (this.spec.x === undefined ? ys : xs)![0];
    const label = data.label;
    const write = data.writer(frame.locale, frame.features?.of(this)?.format);
    // Buffers as large as the items drawn: a facet panel's, not the table's.
    const size = data.size(rows);
    const rects = frame.floats(id, "rect", size * 4);
    // The row each region drawn is (and, with labels, each label), for drawn-mark records.
    const drawnRows = rowBuffer(frame, id, "rows", size);
    const color = painted(frame.paint, this.spec.fill, "region fill") ?? theme.muted;
    // Each row's look, where channels read rows, or at thresholds each
    // band's color; runs of rows of one look start at `runs`.
    const looks =
      colors && this.spec.fill === undefined
        ? {
            paints: colors.map((c): RowPaint => ({ fill: frame.paint(c, "chart fields") })),
            of: (i: number) => i,
          }
        : frame.features?.of(this)?.rowLooks?.();
    const runs: number[] = [];
    const runLooks: number[] = [];
    // An outline draws the sides it is given of each region's own edges.
    const outlined =
      this.#edge(frame, color) !== undefined ||
      !!looks?.paints.some((look) => look.stroke !== undefined);
    const sides = outlined ? frame.bytes(id, "sides", size) : undefined;
    const given = sideMask(this.spec.strokeSides ?? ["top", "right", "bottom", "left"]);
    const labels: RegionLabel[] = [];
    const side = label?.place?.side;
    const along = side === "left" || side === "right" ? "y" : "x";
    const paint = label && this.#paint(frame);
    // Labels keep apart as painted: outlines and halos too.
    const reach = paint
      ? paintedReach(paint, labelHalo(label.style?.halo ?? this.spec.halo, frame))
      : 0;
    let count = 0;
    // Regions are cut to the plot, or to the chart with a clip of "chart" or false
    // (a decoration's by default).
    const clip = this.spec.clip ?? frame.clip;
    const box = clip === "chart" || clip === false ? (frame.chart ?? plot) : plot;
    data.each(rows, (i) => {
      // Each region is cut to its box, its label placed in its visible part;
      // without places on an axis, it spans the plot.
      const across = xs
        ? this.#span(data, xs, "x", i, frame.x, frame, box.x, box.x + box.width)
        : ([plot.x, plot.x + plot.width, 0] as const);
      const down = ys
        ? this.#span(data, ys, "y", i, frame.y, frame, box.y, box.y + box.height)
        : ([plot.y, plot.y + plot.height, 0] as const);
      if (!across || !down) return;
      const look = looks ? looks.of(i) : 0;
      if (count === 0 || look !== runLooks[runLooks.length - 1]) {
        runs.push(count);
        runLooks.push(look);
      }
      drawnRows[count] = i;
      rects[count * 4] = across[0];
      rects[count * 4 + 1] = down[0];
      rects[count * 4 + 2] = across[1] - across[0];
      rects[count * 4 + 3] = down[1] - down[0];
      // Left and right are x's start and end; top and bottom, y's (in pixels, down).
      if (sides)
        sides[count] =
          given & (((across[2] & 1) << 3) | (across[2] & 2) | (down[2] & 1) | ((down[2] & 2) << 1));
      if (paint) {
        const content = frame.features?.of(this)?.content;
        const at = starts ? data.value(starts, i) : Number.NaN;
        const text = data.text(i, frame.locale, write, content, at);
        const parts = content?.styled?.(i, "", at, undefined, paint, frame);
        // A label that writes nothing takes no place, so it hides no other.
        if (parts ? parts.lines.width > 0 : /[^\n]/.test(text)) {
          const label: PlacedLabel =
            this.#plain && paint.verticalAlign === undefined && !parts
              ? {
                  text,
                  x: across[0] + PADDING,
                  y: down[0] + PADDING + paint.size / 2,
                  anchor: "start",
                  baseline: "middle",
                }
              : this.#place(text, across, down, paint, frame.measure, parts);
          // Its box stays inside the region's where the visible part is too small for it.
          const block = grown(labelBox(label, paint, frame.measure), reach);
          const request: LabelRequest = {
            mark: key,
            index: labels.length,
            ...this.#data.layout,
            leader: false,
            anchor: { x: block.x, y: block.y },
            block: { width: block.width, height: block.height },
            places: [{ dx: 0, dy: 0 }],
            // Moved labels slide along their side, within its visible part.
            moves: slidesAlong(along, block),
            bounds:
              this.#data.layout.overlap === "move"
                ? along === "x"
                  ? { ...box, x: across[0], width: across[1] - across[0] }
                  : { ...box, y: down[0], height: down[1] - down[0] }
                : box,
          };
          labels.push({ row: i, at: label, request });
        }
      }
      count++;
    });
    if (runs.length === 0) {
      runs.push(0);
      runLooks.push(0);
    }
    const fillOpacity = this.spec.fillOpacity ?? 0.15;
    const fills = runs.map((start, run): RectGeometry => {
      const end = runs[run + 1] ?? count;
      const look = looks?.paints[runLooks[run]!];
      const opacity = look?.opacity ?? 1;
      const fill: RectGeometry = {
        kind: "rect",
        draw: rectDrawing,
        // At thresholds, a run is a band, keyed by its step.
        key: keys ? `${id}|${keys[runLooks[run]!]}` : looks ? `${id}|${run}` : id,
        fill: look?.fill ?? color,
        fillOpacity: fillOpacity * opacity,
        rects: rects.subarray(start * 4, end * 4),
        count: end - start,
      };
      const edge = this.#edge(frame, fill.fill, look?.stroke);
      if (edge) fill.edge = { ...edge, opacity, sides: sides!.subarray(start, end) };
      this.#drawnRows.set(fill, drawnRows.subarray(start, end));
      if (keys) this.#stepKeys.set(fill, stepsOf(keys, drawnRows.subarray(start, end)));
      return fill;
    });
    return { fills, labels };
  }

  /** The labels' paint: the theme's text in their style. */
  #paint(frame: Frame): TextPaint {
    const style = this.#data.label?.style;
    return labelPaint(
      frame.theme,
      frame.theme.text,
      style && frame.read(style, "region label.style"),
    );
  }

  /** The geometry of `labels` at their placements; none left out. */
  #drawLabels(
    frame: Frame,
    key: MarkKey,
    labels: readonly RegionLabel[],
    placements: readonly LabelPlacement[],
  ): Geometry[] {
    const placed: PlacedLabel[] = [];
    // The row of each label drawn, for drawn-mark records.
    const rows: number[] = [];
    labels.forEach(({ row, at }, k) => {
      const placement = placements[k];
      if (placement === null || placement === undefined) return;
      placed.push(movedLabel(at, [placement.dx, placement.dy]));
      rows.push(row);
    });
    if (placed.length === 0) return [];
    const { theme } = frame;
    const paint = this.#paint(frame);
    const labelKey = seriesKey(key, "region label");
    const halo = this.#data.label?.style?.halo ?? this.spec.halo;
    const owners: number[] = [];
    const geometry =
      !frame.features?.of(this)?.content?.styled && (this.#plain || plainText(paint, theme))
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
        : labelsGeometry(labelKey, placed, paint, halo, frame, owners);
    const drawn =
      geometry.kind === "labels"
        ? Uint32Array.from(owners, (k) => rows[k]!)
        : Uint32Array.from(rows);
    this.#drawnRows.set(geometry, drawn);
    const keys = this.#items(frame.features).keys;
    if (keys) this.#stepKeys.set(geometry, stepsOf(keys, drawn));
    return [geometry];
  }

  /**
   * Its regions and their labels are rows (of its table, or of its places
   * given alone); at thresholds, its steps, by key.
   */
  partOf(drawn: DrawnMark, geometry: Geometry, index: number, parts: PartBuilders) {
    const steps = this.#stepKeys.get(geometry);
    if (steps) return index < steps.length ? parts.group(drawn, [], [steps[index]!]) : undefined;
    const rows = this.#drawnRows.get(geometry);
    const count =
      (geometry as { count?: number }).count ?? (geometry as LabelsGeometry).items?.length;
    if (!rows || !(index < (count ?? 0))) return undefined;
    return parts.annotation(drawn, this.table, rows[index]!);
  }

  /**
   * The regions' outline, given a color (the mark's, or a row's `stroke`,
   * read already) or a width: 1 pixel wide and in their fill's color,
   * `fill`, by default.
   */
  #edge(frame: Frame, fill: string, stroke?: string): RectGeometry["edge"] {
    const { strokeWidth = 1 } = this.spec;
    const given = this.spec.stroke !== undefined || this.spec.strokeWidth !== undefined;
    if ((!given && stroke === undefined) || strokeWidth <= 0) return undefined;
    const color = stroke ?? painted(frame.paint, this.spec.stroke, "region stroke") ?? fill;
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
    parts: PartText | undefined,
  ): PlacedLabel {
    const place: Frozen<LabelPlaceSpec> = this.#data.label?.place ?? {};
    const side = place.side ?? "top";
    const attachment = place.attachment ?? "start";
    const gap = PADDING + (place.offset ?? 0);
    const out = place.outside ? -1 : 1;
    const { size, lineHeight, verticalAlign } = paint;
    // The block's lines after the first.
    const rest = (lineCount(text) - 1) * lineHeight;
    /** The label from `x` as `anchor` says, its block at `y` as `align` (its style's) says. */
    const block = (
      x: number,
      y: number,
      anchor: PlacedLabel["anchor"],
      align: NonNullable<TextPaint["verticalAlign"]>,
    ): PlacedLabel => {
      const { at, box } = anchorBlock(
        parts?.lines ?? textLines(text, paint, measure),
        { x, y, align: anchor === "middle" ? "center" : anchor, verticalAlign: align, angle: 0 },
        paint,
      );
      return { text, x: at.x, y: at.y, anchor, baseline: "middle", box, parts };
    };
    if (side === "top" || side === "bottom") {
      const [x, anchor]: [number, PlacedLabel["anchor"]] =
        attachment === "start"
          ? [left + PADDING, "start"]
          : attachment === "end"
            ? [right - PADDING, "end"]
            : [(left + right) / 2, "middle"];
      const edge = side === "top" ? top : bottom;
      // A label of parts goes inside the region from its side, or outside away from it.
      const align = verticalAlign ?? (parts && ((side === "top") === out > 0 ? "top" : "bottom"));
      if (align)
        return block(
          x,
          align === "top" ? edge + gap : align === "bottom" ? edge - gap : edge,
          anchor,
          align,
        );
      const y =
        side === "top"
          ? top + out * (gap + size / 2) - (out < 0 ? rest : 0)
          : bottom - out * (gap + size / 2) - (out > 0 ? rest : 0);
      return { text, x, y, anchor, baseline: "middle" };
    }
    if (verticalAlign || parts)
      return block(
        side === "left" ? left + out * gap : right - out * gap,
        attachment === "start"
          ? top + PADDING
          : attachment === "end"
            ? bottom - PADDING
            : (top + bottom) / 2,
        (side === "left") === !place.outside ? "start" : "end",
        verticalAlign ??
          (attachment === "start" ? "top" : attachment === "end" ? "bottom" : "middle"),
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
   * undefined when nothing of it is in view. Values a log scale cannot place (zero or below) sit at its low
   * end, so a region from zero reaches the axis. Its third element says
   * which ends are the region's own edges, which outlines draw, rather than
   * cut by the view or the range's: 1 its start, 2 its end.
   */
  #span(
    data: AnnotationData,
    places: [Place, Place],
    axis: "x" | "y",
    item: number,
    scale: PositionScale,
    frame: Frame,
    min: number,
    max: number,
  ): readonly [number, number, number] | undefined {
    const a = data.pixel(places[0], axis, item, scale, frame, true);
    const b = data.pixel(places[1], axis, item, scale, frame, true);
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
    const p = this.#positions;
    return axis === "x" ? [p.x1, p.x2] : [p.y1, p.y2];
  }

  #places(axis: "x" | "y", data: AnnotationData): [Place, Place] | undefined {
    const [a, b] = this.#pair(axis);
    return a === undefined || b === undefined ? undefined : [data.place(a), data.place(b)];
  }
}

/** The step key of each item `rows` holds. */
function stepsOf(keys: readonly string[], rows: Uint32Array): string[] {
  return Array.from(rows, (row) => keys[row]!);
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
        "itemKey",
        "x",
        "y",
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
        "pick",
        "inspect",
        "axis",
        "facet",
        "panel",
        "clip",
        "encode",
      ],
    ),
  } as unknown as RegionSpec;
  if (
    table?.name !== undefined &&
    readsTable([spec.x1, spec.x2, spec.y1, spec.y2], spec.label, spec.encode)
  )
    spec.data = table.name;
  return new RegionMark(spec, table as unknown as Table | undefined);
}

/** A region's label: its row, its place in the region, and its request. */
interface RegionLabel {
  row: number;
  at: PlacedLabel;
  request: LabelRequest;
}
