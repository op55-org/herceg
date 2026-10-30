import { type Density, kde, partDensity, silverman } from "../data/density.ts";
import type { BoxStats } from "../data/quantile.ts";
import type { Schema, Table } from "../data/table.ts";
import { areaDrawing } from "../draw/area.ts";
import { lineDrawing } from "../draw/line.ts";
import { pointDrawing } from "../draw/point.ts";
import { rectDrawing } from "../draw/rect.ts";
import { segmentDrawing } from "../draw/segments.ts";
import type { PositionScale } from "../scale/scale.ts";
import type {
  AreaGeometry,
  LineGeometry,
  PointGeometry,
  Rect,
  RectGeometry,
  SegmentGeometry,
} from "../scene/scene.ts";
import type { Frozen, ViolinSpec } from "../spec/spec.ts";
import { surface } from "../theme.ts";
import {
  DistributionMark,
  type DistributionOptions,
  type Placement,
  type Stat,
  type Summary,
} from "./distribution.ts";
import { boxOf, distanceToCut, distanceToDisc, distanceToStroke } from "./drawn.ts";
import { definedFields } from "./line.ts";
import type { AxisFormat, ChartMark, Frame } from "./mark.ts";
import { placeAt, rowOf, type Series } from "./series.ts";
import { refuseValues } from "./still.ts";

export type ViolinOptions<S extends Schema> = DistributionOptions<S> & {
  /**
   * The kernel's standard deviation in data units, the same for every
   * violin; by default each violin's by Silverman's rule of thumb.
   */
  bandwidth?: number;
  /** Two series share a center: first left (below horizontally), second right (above). */
  split?: boolean;
  /** Inner box (default), dashed quartiles with a solid median, or no inner marks. */
  inner?: "box" | "quartiles" | "none";
};

/** How much of its slot a violin takes across its category at its widest. */
const VIOLIN = 0.8;
/** The inner box's width as a fraction of the violin's, kept within these pixels. */
const BOX = 0.1;
const BOX_MIN = 3;
const BOX_MAX = 8;
/** Outline and whisker line width, in pixels. */
const STROKE = 1.5;

/** What a violin keeps of its values: their range, and their density unless they do not vary. */
interface Shape {
  min: number;
  max: number;
  density: Density | undefined;
  /** The density's largest value, which spans the violin's whole width. */
  peak: number;
}

/**
 * Violins of a number field's values per category: each group's kernel
 * density mirrored about its center, every violin as wide at its densest,
 * with the box plot's whisker range, quartile box, and median inside.
 * Groups whose values do not vary are drawn as a line across the violin's
 * width; groups whose density cannot be computed (a span beyond the largest
 * double) show only what is inside.
 */
export class ViolinMark extends DistributionMark<ViolinSpec, Shape> {
  /**
   * How far a pixel is from what `clip` keeps of the violin of `row` as
   * painted: its fill, its outline's stroke, and the inner marks
   * `geometry` draws.
   */
  protected override shapeDistance(
    s: Series,
    row: number,
    px: number,
    py: number,
    frame: Frame,
    clip: Readonly<Rect>,
  ): number {
    const horizontal = this.horizontal;
    const along = horizontal ? frame.y : frame.x;
    const across = horizontal ? frame.x : frame.y;
    const { offset, share } = this.placement(s, frame);
    const split = this.spec.split ?? false;
    const inner = this.spec.inner ?? "box";
    const half = share * VIOLIN * (split ? 1 : 0.5);
    const center = along.map(placeAt(s, horizontal ? "y" : "x", row)) + (split ? 0 : offset);
    // The sides drawn out from the center: a split violin's own, else both, mirrored.
    const side = offset < 0 ? -1 : 1;
    const sides = split ? [side] : [1, -1];
    /** A point `w` out from the center on `side`, at `c` across, on screen. */
    const at = (w: number, c: number, side: number) =>
      horizontal ? ([c, center + side * w] as const) : ([center + side * w, c] as const);
    /** How far the pixel is from what the clip keeps of a rectangle, along from `a0` to `a1`, across from `c0` to `c1`. */
    const toRect = (a0: number, c0: number, a1: number, c1: number) =>
      distanceToCut(horizontal ? boxOf(c0, a0, c1, a1) : boxOf(a0, c0, a1, c1), clip, px, py);
    // A line across the violin, from its center out `w`, butt-ended.
    const across0 = (c: number, w: number) =>
      Number.isFinite(c)
        ? toRect(
            split ? center : center - w,
            c - STROKE / 2,
            center + (split ? side : 1) * w,
            c + STROKE / 2,
          )
        : Number.POSITIVE_INFINITY;
    const { stats, groups } = this.summaryOf(s);
    const shape = groups[row]!;
    let distance = Number.POSITIVE_INFINITY;
    if (shape.density) {
      // The fill as kept: whether it holds the clip's point nearest the pixel.
      const qx = Math.min(Math.max(px, clip.x), clip.x + clip.width);
      const qy = Math.min(Math.max(py, clip.y), clip.y + clip.height);
      const [qa, qc] = horizontal ? [qy, qx] : [qx, qy];
      const a = split ? side * (qa - center) : Math.abs(qa - center);
      // The outline's stroke, on each side drawn.
      const edge = (w0: number, c0: number, w1: number, c1: number) => {
        for (const side of sides) {
          const [x0, y0] = at(w0, c0, side);
          const [x1, y1] = at(w1, c1, side);
          distance = Math.min(distance, distanceToStroke(x0, y0, x1, y1, STROKE / 2, clip, px, py));
        }
      };
      let [first, c0, w0] = [Number.NaN, Number.NaN, 0];
      let inside = false;
      this.#edge(shape, this.#statistics(stats, row), across, half, (c, w) => {
        if (Number.isNaN(first)) {
          first = c;
          edge(0, c, w, c);
        } else {
          edge(w0, c0, w, c);
          if (c !== c0 && (qc - c0) * (qc - c) <= 0)
            inside ||= a >= 0 && a <= w0 + ((w - w0) * (qc - c0)) / (c - c0);
        }
        [c0, w0] = [c, w];
      });
      if (inside) return Math.hypot(px - qx, py - qy);
      if (!Number.isNaN(first)) {
        edge(0, c0, w0, c0);
        // A split violin's flat side runs along its center.
        if (split) edge(0, first, 0, c0);
      }
    } else if (shape.min === shape.max) {
      return across0(across.map(shape.min), half);
    }
    if (inner === "none") return distance;
    if (inner === "quartiles") {
      for (const value of this.#statistics(stats, row)) {
        const c = across.map(value);
        distance = Math.min(distance, across0(c, widthAt(shape, half, across, value, c)));
      }
      return distance;
    }
    const box = this.#box(share, half);
    // As drawn: a split violin's inner marks in the middle of its side.
    const middle = center + (split ? (side * half) / 2 : 0);
    // Statistics an axis cannot draw (a log axis' nonpositive ones) are not drawn.
    const span = (width: number, from: number, to: number) => {
      const [p, q] = [across.map(from), across.map(to)];
      return Number.isFinite(p) && Number.isFinite(q)
        ? toRect(middle - width / 2, p, middle + width / 2, q)
        : Number.POSITIVE_INFINITY;
    };
    const boxed = span(box, stats.q1[row]!, stats.q3[row]!);
    const whisker = span(STROKE, stats.low[row]!, stats.high[row]!);
    const median = across.map(stats.median[row]!);
    const [mx, my] = horizontal ? [median, middle] : [middle, median];
    const dot = Number.isFinite(median)
      ? distanceToDisc(mx, my, medianRadius(box), clip, px, py)
      : Number.POSITIVE_INFINITY;
    return Math.min(distance, boxed, whisker, dot);
  }

  /**
   * Half its inner box, drawn at least `BOX_MIN` wide on the center of a
   * violin that is not split (a split one's fits in its half).
   */
  protected override paintedPast(
    s: Series,
    row: number,
    frame: Frame,
  ): readonly [number, number, number] {
    const shape = this.summaryOf(s).groups[row]!;
    const boxed =
      (this.spec.inner ?? "box") === "box" &&
      !this.spec.split &&
      (shape.density !== undefined || shape.min !== shape.max);
    if (!boxed) return [1, 1, 0];
    const { share } = this.placement(s, frame);
    return [1, 1, this.#box(share, share * VIOLIN * 0.5) / 2];
  }

  /** The median dot inside its inner box, which a log axis can draw past the values it places. */
  protected override paintedDot(
    s: Series,
    row: number,
    frame: Frame,
  ): readonly [number, number] | undefined {
    const shape = this.summaryOf(s).groups[row]!;
    if ((this.spec.inner ?? "box") !== "box" || (!shape.density && shape.min === shape.max))
      return undefined;
    const at = (this.horizontal ? frame.x : frame.y).map(this.summaryOf(s).stats.median[row]!);
    const { share } = this.placement(s, frame);
    const half = share * VIOLIN * (this.spec.split ? 1 : 0.5);
    return Number.isFinite(at) ? [at, medianRadius(this.#box(share, half))] : undefined;
  }

  /** A selection's violin is drawn inside the whole's outline, as wide. */
  protected override partWidth(): number {
    return 1;
  }

  /** The statistics quartile lines draw, which the edge passes through; none otherwise. */
  #statistics(stats: Summary<Shape>["stats"], row: number): number[] {
    return this.spec.inner === "quartiles"
      ? [stats.q1[row]!, stats.median[row]!, stats.q3[row]!]
      : [];
  }

  /** The inner box's width: a share of the violin's, within pixels, inside a split half. */
  #box(share: number, half: number): number {
    const box = Math.min(BOX_MAX, Math.max(BOX_MIN, share * VIOLIN * BOX));
    return this.spec.split ? Math.min(box, half) : box;
  }

  /**
   * Calls `vertex` with each point of a violin's edge in drawing order: the
   * density's samples the axis places, and between them the `statistics`
   * it places (even below the first positive sample of a log axis), so
   * that their lines meet the edge. Each is a pixel across the value axis
   * and a width out from the center.
   */
  #edge(
    shape: Shape,
    statistics: readonly number[],
    across: PositionScale,
    half: number,
    vertex: (c: number, w: number) => void,
  ): void {
    const { lo, values, step } = shape.density!;
    let next = 0;
    for (let i = 0; i < values.length; i++) {
      const value = lo + i * step;
      while (next < statistics.length && statistics[next]! < value) {
        const statistic = statistics[next++]!;
        const c = across.map(statistic);
        if (Number.isFinite(c)) vertex(c, widthAt(shape, half, across, statistic, c));
      }
      const c = across.map(value);
      if (Number.isFinite(c)) vertex(c, half * (values[i]! / shape.peak));
    }
  }

  readonly inset = { x: 0, y: 0 };
  protected readonly noun = ["violin", "violins"] as const;
  protected readonly width = VIOLIN;

  constructor(spec: ViolinSpec, table: Table) {
    const { bandwidth, split, inner } = spec;
    if (bandwidth !== undefined && !(bandwidth > 0 && Number.isFinite(bandwidth)))
      throw new RangeError(`violin bandwidth: expected a positive number; received ${bandwidth}`);
    if (split !== undefined && typeof split !== "boolean")
      throw new TypeError(
        `violin split: expected true or false; received ${JSON.stringify(split)}`,
      );
    if (inner !== undefined && !["box", "quartiles", "none"].includes(inner))
      throw new TypeError(
        `violin inner: expected "box", "quartiles", or "none"; received ${JSON.stringify(inner)}`,
      );
    if (split && spec.series === undefined)
      throw new TypeError("violin split: needs a series field; give one");
    super(spec, table);
    this.#checkSplit();
  }

  #checkSplit(): void {
    if (!this.spec.split) return;
    const count = this.rosterIds().length;
    if (count > 2)
      throw new RangeError(
        `violin split: expected at most two series; series field "${this.spec.series}" has ${count} values`,
      );
  }

  protected override summarizeRows(rows?: Uint32Array): Summary<Shape> {
    this.#checkSplit();
    return super.summarizeRows(rows);
  }

  /** Split halves stand on either side of the category's center; others in their slots. */
  protected override placement(s: Series, frame: Frame): Placement {
    if (!this.spec.split) return super.placement(s, frame);
    this.#checkSplit();
    const share = Math.abs((this.horizontal ? frame.y : frame.x).bandwidth ?? 0) / 2;
    // The first series' half is on the left (vertical) or the top (horizontal).
    const side = (this.rosterIds().indexOf(s.label) === 0 ? -1 : 1) * (this.horizontal ? -1 : 1);
    return { offset: (side * share * VIOLIN) / 2, share };
  }

  protected describeGroup(sorted: Float64Array, stats: BoxStats): Shape {
    const n = stats.count;
    const density = n > 0 ? kde(sorted, this.spec.bandwidth ?? silverman(sorted)) : undefined;
    let peak = 0;
    for (const value of density?.values ?? []) peak = Math.max(peak, value);
    return {
      min: n > 0 ? sorted[0]! : Number.NaN,
      max: n > 0 ? sorted[n - 1]! : Number.NaN,
      density: peak > 0 ? density : undefined,
      peak,
    };
  }

  /**
   * A selection's values of a group: their density on the whole's points,
   * over the whole's count and with its bandwidth, as wide as the whole's
   * at its peak, so it lies inside the whole's violin.
   */
  protected override describeSelected(
    sorted: Float64Array,
    stats: BoxStats,
    whole: Shape,
    n: number,
  ): Shape {
    const count = stats.count;
    const { density } = whole;
    return {
      min: count > 0 ? sorted[0]! : Number.NaN,
      max: count > 0 ? sorted[count - 1]! : Number.NaN,
      density: density && count > 0 ? within(density, partDensity(density, n, sorted)) : undefined,
      peak: whole.peak,
    };
  }

  #draws(shape: Shape): boolean {
    return !!shape.density || shape.min === shape.max || this.spec.inner !== "none";
  }

  protected override drawnSeries(series: Series[]): Series[] {
    if (this.spec.inner !== "none") return series;
    for (const s of series) {
      if (s.length === 0) continue;
      const { groups } = this.summaryOf(s);
      const rows: number[] = [];
      for (let k = 0; k < s.length; k++) {
        const row = rowOf(s, k);
        if (this.#draws(groups[row]!)) rows.push(row);
      }
      if (rows.length !== s.length) {
        s.rows = Uint32Array.from(rows);
        s.length = rows.length;
      }
    }
    return series;
  }

  override shows(series: Series, row: number): boolean {
    return super.shows(series, row) && this.#draws(this.summaryOf(series).groups[row]!);
  }

  /**
   * The density's span, and for log axes, which cannot place all of it, the
   * values and statistics drawn and where the density turns positive.
   */
  protected drawnValues(
    { stats, groups }: Summary<Shape>,
    row: number,
    add: (value: number) => void,
  ): void {
    const shape = groups[row]!;
    if (!this.#draws(shape)) return;
    const { min, max, density } = shape;
    add(min);
    add(max);
    for (const stat of ["low", "q1", "median", "q3", "high"] as const) add(stats[stat][row]!);
    if (!density) return;
    const { lo, hi, values, step } = density;
    add(lo);
    add(hi);
    // Where the density turns positive, as the geometry computes its points.
    for (let i = 0; lo <= 0 && i < values.length; i++) {
      if (lo + i * step <= 0) continue;
      add(lo + i * step);
      break;
    }
  }

  geometry(
    series: readonly Series[],
    frame: Frame,
  ): (AreaGeometry | LineGeometry | SegmentGeometry | RectGeometry | PointGeometry)[] {
    refuseValues(frame.keyed, this.spec.type);
    const out: (AreaGeometry | LineGeometry | SegmentGeometry | RectGeometry | PointGeometry)[] =
      [];
    const horizontal = this.horizontal;
    const along = horizontal ? frame.y : frame.x;
    const across = horizontal ? frame.x : frame.y;
    const fillOpacity = this.spec.fillOpacity ?? 0.25;
    const split = this.spec.split ?? false;
    const inner = this.spec.inner ?? "box";
    const ok = Number.isFinite;
    for (const [s, { offset, share }] of this.placements(series, frame)) {
      // A series without groups in a panel draws nothing there, but keeps its slot.
      if (s.length === 0) continue;
      const { stats, groups: shapes } = this.summaryOf(s);
      const { q1, median, q3, low, high } = stats;
      const half = share * VIOLIN * (split ? 1 : 0.5);
      const side = split ? (offset < 0 ? -1 : 1) : 0;
      const box = this.#box(share, half);
      // The violin's two edges as an area, and its outline as one closed line each.
      const upper = frame.polyline(s.key, "violin-upper");
      const lower = frame.polyline(s.key, "violin-lower");
      const outline = frame.polyline(s.key, "violin-outline");
      upper.reset();
      lower.reset();
      outline.reset();
      const quartiles = inner === "quartiles" ? frame.polyline(s.key, "quartiles") : undefined;
      const medianLine = inner === "quartiles" ? frame.polyline(s.key, "median-line") : undefined;
      quartiles?.reset();
      medianLine?.reset();
      let lines = inner === "box" ? frame.floats(s.key, "lines", s.length * 4) : undefined;
      const rects = inner === "box" ? frame.floats(s.key, "box", s.length * 4) : undefined;
      const dots = inner === "box" ? frame.floats(s.key, "median", s.length * 2) : undefined;
      let segments = 0;
      let boxes = 0;
      let medians = 0;
      // Points given along the category and across it, as x and y.
      const at = (a: number, c: number) => (horizontal ? [c, a] : [a, c]) as [number, number];
      for (let k = 0; k < s.length; k++) {
        const row = rowOf(s, k);
        // A panel's own categories are read at their places.
        const position = placeAt(s, horizontal ? "y" : "x", row);
        if (position < 0) continue;
        const center = along.map(position) + (split ? 0 : offset);
        if (!ok(center)) continue;
        const shape = shapes[row]!;
        const density = shape.density;
        if (density) {
          upper.break();
          lower.break();
          outline.break();
          const first = outline.count;
          const from = lower.count;
          const push = (c: number, w: number) => {
            // A horizontal violin's upper edge is above its center, at smaller y.
            const [ux, uy] = at(
              split ? center + side * w : horizontal ? center - w : center + w,
              c,
            );
            const [lx, ly] = at(split ? center : horizontal ? center + w : center - w, c);
            upper.push(ux, uy);
            lower.push(lx, ly);
            outline.push(ux, uy);
          };
          this.#edge(shape, this.#statistics(stats, row), across, half, push);
          // Back along the lower edge, closing at the first point.
          for (let i = lower.count - 1; i >= from; i--)
            outline.push(lower.coords[i * 2]!, lower.coords[i * 2 + 1]!);
          if (outline.count > first)
            outline.push(outline.coords[first * 2]!, outline.coords[first * 2 + 1]!);
        } else if (shape.min === shape.max) {
          // Values that do not vary: a line across the violin at their value.
          const c = across.map(shape.min);
          if (ok(c)) {
            lines ??= frame.floats(s.key, "lines", s.length * 4);
            lines.set(
              [
                ...at(split ? center : center - half, c),
                ...at(split ? center + side * half : center + half, c),
              ],
              segments++ * 4,
            );
          }
          continue;
        }
        if (inner === "none") continue;
        if (quartiles && medianLine) {
          for (const [stat, path] of [
            [q1, quartiles],
            [median, medianLine],
            [q3, quartiles],
          ] as const) {
            const value = stat[row]!;
            const c = across.map(value);
            if (!ok(c)) continue;
            const w = widthAt(shape, half, across, value, c);
            path.break();
            path.push(...at(split ? center : center - w, c));
            path.push(...at(split ? center + side * w : center + w, c));
          }
          continue;
        }
        const inside = center + (split ? (side * half) / 2 : 0);
        const [pl, ph, p1, p3, pm] = [low, high, q1, q3, median].map((stat) =>
          across.map(stat![row]!),
        ) as [number, number, number, number, number];
        if (ok(pl) && ok(ph)) {
          lines!.set([...at(inside, pl), ...at(inside, ph)], segments++ * 4);
        }
        if (ok(p1) && ok(p3)) {
          const [c0, c1] = [Math.min(p1, p3), Math.max(p1, p3)];
          const [x, y] = at(inside - box / 2, c0);
          rects!.set(horizontal ? [x, y, c1 - c0, box] : [x, y, box, c1 - c0], boxes++ * 4);
        }
        if (ok(pm)) dots!.set(at(inside, pm), medians++ * 2);
      }
      out.push(
        {
          kind: "area",
          draw: areaDrawing,
          key: `${s.key}|violin`,
          fill: s.color,
          fillOpacity,
          upper,
          lower,
          baseline: 0,
          stroke: null,
          strokeWidth: 0,
        },
        {
          kind: "line",
          draw: lineDrawing,
          key: `${s.key}|outline`,
          stroke: s.color,
          strokeWidth: STROKE,
          dash: undefined,
          path: outline,
        },
      );
      if (lines)
        out.push({
          kind: "segments",
          draw: segmentDrawing,
          key: `${s.key}|lines`,
          stroke: s.color,
          strokeWidth: STROKE,
          coords: lines,
          count: segments,
        });
      if (rects && dots)
        out.push(
          {
            kind: "rect",
            draw: rectDrawing,
            key: `${s.key}|box`,
            fill: s.color,
            fillOpacity: 1,
            rects,
            count: boxes,
          },
          {
            kind: "point",
            draw: pointDrawing,
            key: `${s.key}|median`,
            fill: surface(frame.theme),
            fillOpacity: 1,
            opaque: true,
            radius: medianRadius(box),
            symbol: "circle",
            coords: dots,
            count: medians,
          },
        );
      if (quartiles && medianLine)
        for (const [name, path, dash] of [
          ["quartiles", quartiles, [4, 3]],
          ["median-line", medianLine, undefined],
        ] as const)
          out.push({
            kind: "line",
            draw: lineDrawing,
            key: `${s.key}|${name}`,
            stroke: s.color,
            strokeWidth: STROKE,
            dash,
            path,
          });
    }
    return out;
  }

  /** From one end of a violin to the other. */
  span(series: Series, row: number): readonly [number, number] {
    const { min, max, density } = this.summaryOf(series).groups[row]!;
    return density ? [density.lo, density.hi] : [min, max];
  }

  /** A violin's statistics, formatted as its value axis formats values. */
  pointText(series: Series, row: number, format: AxisFormat): string {
    const f = this.horizontal ? format.x : format.y;
    const { stats, groups } = this.summaryOf(series);
    const stat = (name: Stat) => stats[name][row]!;
    const { min, max } = groups[row]!;
    const n = stat("count");
    return `median ${f(stat("median"))}, quartiles ${f(stat("q1"))} to ${f(stat("q3"))}, values from ${f(min)} to ${f(max)}, ${n} ${n === 1 ? "value" : "values"}${this.selectedText(series, row, f)}`;
  }
}

/**
 * A part's density on the points of the whole's, `values`, cut to where it
 * is positive, so that its violin ends where its values' kernels do rather
 * than running on along its center.
 */
function within(whole: Density, values: Float64Array): Density | undefined {
  let first = 0;
  while (first < values.length && !(values[first]! > 0)) first++;
  let last = values.length - 1;
  while (last > first && !(values[last]! > 0)) last--;
  if (first > last) return undefined;
  // At least two points, between which a violin's width is read.
  if (first === last) [first, last] = first > 0 ? [first - 1, last] : [first, last + 1];
  const { lo, step } = whole;
  return {
    lo: lo + first * step,
    hi: lo + last * step,
    values: values.slice(first, last + 1),
    step,
    bandwidth: whole.bandwidth,
  };
}

/**
 * Violins of `y` per category of `x` (or of `x` per category of `y`, for
 * horizontal violins): each group's density, with its quartiles and median.
 *
 * ```ts
 * violin(requests, { x: "region", y: "latency" })
 * ```
 */
export function violin<S extends Schema>(
  table: Table<S>,
  options: ViolinOptions<S>,
): ChartMark<Frozen<ViolinSpec>> {
  const spec: ViolinSpec = {
    type: "violin",
    x: options.x,
    y: options.y,
    ...definedFields(options, [
      "series",
      "color",
      "bandwidth",
      "split",
      "inner",
      "fill",
      "fillOpacity",
      "label",
      "legend",
      "axis",
      "facet",
      "panel",
      "clip",
      "zIndex",
      "id",
    ]),
  };
  if (table.name !== undefined) spec.data = table.name;
  // Field names were checked against S above; marks work on the erased schema.
  return new ViolinMark(spec, table as unknown as Table);
}

/** The median dot's radius inside a box `box` pixels wide. */
function medianRadius(box: number): number {
  return Math.min(box / 2, Math.max(1, box / 2 - 1));
}

/**
 * A violin's width at `value`, which the axis places at pixel `c`: along
 * the pixel-linear edge between the density's samples where both map, and
 * where one does not (a log axis' boundary), the density interpolated in
 * data units.
 */
function widthAt(
  shape: Shape,
  half: number,
  across: PositionScale,
  value: number,
  c: number,
): number {
  const { density } = shape;
  if (!density) return half;
  const { lo, values, step } = density;
  const i = Math.max(0, Math.min(values.length - 2, Math.floor((value - lo) / step)));
  const v0 = lo + i * step;
  const p0 = across.map(v0);
  const p1 = across.map(lo + (i + 1) * step);
  const ok = Number.isFinite;
  const t = ok(p0) && ok(p1) ? (p0 === p1 ? 0 : (c - p0) / (p1 - p0)) : (value - v0) / step;
  return half * ((values[i]! * (1 - t) + values[i + 1]! * t) / shape.peak);
}
