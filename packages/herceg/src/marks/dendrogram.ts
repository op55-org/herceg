import type { NumberField, Schema, Table } from "../data/table.ts";
import { segmentDrawing } from "../draw/segments.ts";
import { formatNumber } from "../format/format.ts";
import type { PositionScale } from "../scale/scale.ts";
import type { Rect, SegmentGeometry } from "../scene/scene.ts";
import type { Clip, DendrogramSpec, Frozen } from "../spec/spec.ts";
import { checkLinkage } from "./dendrogram-data.ts";
import { markKey } from "./hidden.ts";
import { definedFields } from "./line.ts";
import {
  type AxisFormat,
  type BandList,
  type Bands,
  type ChartMark,
  type Frame,
  frozen,
  type MARK,
  type Mark,
  type MarkKey,
  type Palette,
  painted,
  requireField,
} from "./mark.ts";
import { TableCache } from "./series.ts";
import { refuseValues } from "./still.ts";

export interface DendrogramOptions<S extends Schema> {
  /** Linkage child cluster ids; leaves are 0 to n-1, merge row k makes n+k. */
  first: NumberField<S>;
  second: NumberField<S>;
  /** Finite, nonnegative merge heights. */
  height: NumberField<S>;
  /** Category label of each leaf id, before dendrogram ordering. */
  leaves: readonly string[];
  /** Plot edge at height zero. Bottom/top band x; left/right band y. */
  side?: "bottom" | "top" | "left" | "right";
  stroke?: string;
  strokeWidth?: number;
  label?: string;
  facet?: "repeat";
  /**
   * What the mark's drawing is cut to: "plot", "chart", or false for
   * nothing, so markers at the plot's edge show whole. Without it, data is
   * cut to the plot and labels are drawn whole.
   */
  clip?: Clip;
  /** Where it is drawn among the panel's marks: higher above lower; 0 by default. */
  zIndex?: number;
  panel?: string;
  id?: string;
}

interface Linkage {
  first: ArrayLike<number>;
  second: ArrayLike<number>;
  height: ArrayLike<number>;
  min: number;
  max: number;
  bands: BandList;
}

export class DendrogramMark implements Mark<Frozen<DendrogramSpec>> {
  declare readonly [MARK]: true;
  readonly spec: Frozen<DendrogramSpec>;
  readonly table: Table;
  readonly tooltip = "x";
  readonly #cache = new TableCache<Linkage>();
  // Scales retain these label lists; keys distinguish categories from numeric
  // bands with the same display label, across charts and panel resolutions.
  readonly #bandKeys = new WeakMap<readonly string[], readonly string[]>();

  constructor(input: DendrogramSpec, table: Table) {
    this.spec = frozen(input);
    this.table = table;
    const { spec } = this;
    for (const channel of ["first", "second", "height"] as const)
      requireField(table, spec[channel], ["number"], `dendrogram ${channel}`);
    if (spec.side !== undefined && !["bottom", "top", "left", "right"].includes(spec.side))
      throw new TypeError(
        `dendrogram side: expected "bottom", "top", "left", or "right"; received ${JSON.stringify(spec.side)}`,
      );
    if (
      spec.strokeWidth !== undefined &&
      !(Number.isFinite(spec.strokeWidth) && spec.strokeWidth >= 0)
    )
      throw new RangeError(
        `dendrogram strokeWidth: expected 0 or more pixels; received ${spec.strokeWidth}`,
      );
    this.#linkage();
  }

  #leafAxis(): "x" | "y" {
    return this.spec.side === "left" || this.spec.side === "right" ? "y" : "x";
  }

  #linkage(): Linkage {
    return this.#cache.get(this.table, () => {
      const { spec, table } = this;
      const fields = [spec.first, spec.second, spec.height] as const;
      const first = table.numbers(spec.first as never);
      const second = table.numbers(spec.second as never);
      const height = table.numbers(spec.height as never);
      const columns = [first, second, height];
      checkLinkage(table.length, spec.leaves, fields, (column, row) => columns[column]![row]!);
      let min = Infinity;
      let max = 0;
      for (let i = 0; i < table.length; i++) {
        min = Math.min(min, height[i]!);
        max = Math.max(max, height[i]!);
      }
      // Depth-first, first child before second, without recursion for deep trees.
      const n = spec.leaves.length;
      const pending = [n + table.length - 1];
      const labels: string[] = [];
      while (pending.length) {
        const cluster = pending.pop()!;
        if (cluster < n) labels.push(spec.leaves[cluster]!);
        else pending.push(second[cluster - n]!, first[cluster - n]!);
      }
      return {
        first,
        second,
        height,
        min,
        max,
        bands: { keys: labels.map((label) => `c:${label}`), labels },
      };
    });
  }

  channelKind(axis: "x" | "y"): "category" | undefined {
    return axis === this.#leafAxis() ? "category" : undefined;
  }

  bands(axis: "x" | "y"): BandList | undefined {
    return axis === this.#leafAxis() ? this.#linkage().bands : undefined;
  }

  resolveBands(bands: Bands): void {
    const own = bands[this.#leafAxis()];
    if (own) this.#bandKeys.set(own.labels, own.keys);
  }

  series(_key: MarkKey, _palette: Palette, _hidden: ReadonlySet<string>, bands: Bands) {
    this.resolveBands(bands);
    return [];
  }
  /** Heights are values on the axis across the leaves': from zero to the largest. */
  #heights(axis: "x" | "y", log: boolean): readonly [number, number] | undefined {
    const { max } = this.#linkage();
    return axis === this.#leafAxis() || log || max === 0 ? undefined : [0, max];
  }
  xExtent(_series: unknown, log: boolean) {
    return this.#heights("x", log);
  }
  yExtent(_series: unknown, _x0: number, _x1: number, log: boolean) {
    return this.#heights("y", log);
  }

  describe(format: AxisFormat, locale: string | undefined): string {
    const { min, max } = this.#linkage();
    const n = this.spec.leaves.length;
    const rows = this.table.length;
    const range = rows ? ` Merge heights ${format.value(min)} to ${format.value(max)}.` : "";
    return `${this.spec.label ?? "Dendrogram"}: ${formatNumber(n, locale)} ${n === 1 ? "leaf" : "leaves"}, ${formatNumber(rows, locale)} ${rows === 1 ? "merge" : "merges"}.${range}`;
  }

  /**
   * The axis across the leaves runs from high to low with leaves at the top
   * or right, so heights grow away from them on its automatic domain.
   */
  get descends(): "x" | "y" | undefined {
    const { side } = this.spec;
    return side === "top" ? "y" : side === "right" ? "x" : undefined;
  }

  /**
   * Where links at a height are drawn across the plot: on `scale` where it
   * is linear, so its ticks read them and views move them; else (another
   * mark's categories, a log axis) at the height's share of the largest,
   * `max`, from the leaves' edge to the opposite one.
   */
  #placeHeights(scale: PositionScale, plot: Rect, max: number): (h: number) => number {
    if (scale.type === "linear") return (h) => scale.map(h);
    const side = this.spec.side ?? "bottom";
    const { x, y, width, height } = plot;
    const edge =
      side === "bottom" ? y + height : side === "top" ? y : side === "left" ? x : x + width;
    // Pixels run up from the bottom and left from the right.
    const away = side === "bottom" || side === "right" ? -1 : 1;
    const span = (side === "bottom" || side === "top" ? height : width) * away;
    return (h) => edge + (max > 0 ? h / max : 0) * span;
  }

  geometry(_series: unknown, frame: Frame, key: MarkKey): SegmentGeometry[] {
    refuseValues(frame.keyed, this.spec.type);
    const { first, second, height, max } = this.#linkage();
    const { spec, table } = this;
    // A legend entry targeting the mark hides it whole.
    if (table.length === 0 || spec.strokeWidth === 0 || frame.hidden.has(markKey(key))) return [];
    const horizontal = this.#leafAxis() === "x";
    const scale = horizontal ? frame.x : frame.y;
    if (scale.type !== "band") throw new Error("dendrogram leaves: expected a category axis");
    const keys =
      this.#bandKeys.get(scale.categories!) ?? scale.categories!.map((label) => `c:${label}`);
    const positions = new Map(keys.map((key, i) => [key, scale.map(i)]));
    const n = spec.leaves.length;
    const centers = frame.doubles(JSON.stringify(key), "dendrogram-centers", n + table.length);
    for (let leaf = 0; leaf < n; leaf++)
      centers[leaf] = positions.get(`c:${spec.leaves[leaf]!}`) ?? NaN;
    const atHeight = this.#placeHeights(horizontal ? frame.y : frame.x, frame.plot, max);
    const childHeight = (cluster: number) => atHeight(cluster < n ? 0 : height[cluster - n]!);
    const coords = frame.floats(JSON.stringify(key), "dendrogram-segments", table.length * 12);
    let count = 0;
    const segment = (a: number, ha: number, b: number, hb: number) => {
      const offset = count++ * 4;
      coords[offset] = horizontal ? a : ha;
      coords[offset + 1] = horizontal ? ha : a;
      coords[offset + 2] = horizontal ? b : hb;
      coords[offset + 3] = horizontal ? hb : b;
    };
    for (let row = 0; row < table.length; row++) {
      const a = first[row]!;
      const b = second[row]!;
      const pa = centers[a]!;
      const pb = centers[b]!;
      centers[n + row] = (pa + pb) / 2;
      // Missing a leaf suppresses its entire ancestral branch, without
      // moving surviving leaves or drawing a partial merge.
      if (!Number.isFinite(pa) || !Number.isFinite(pb)) continue;
      const h = atHeight(height[row]!);
      segment(pa, childHeight(a), pa, h);
      segment(pa, h, pb, h);
      segment(pb, h, pb, childHeight(b));
    }
    return [
      {
        kind: "segments",
        draw: segmentDrawing,
        key: JSON.stringify([key, "dendrogram"]),
        coords,
        count,
        stroke: painted(frame.paint, spec.stroke, "dendrogram stroke") ?? frame.theme.muted,
        strokeWidth: spec.strokeWidth ?? 1,
      },
    ];
  }
}

/** A dendrogram over category bands from a SciPy-layout linkage table. */
export function dendrogram<S extends Schema>(
  table: Table<S>,
  options: DendrogramOptions<S>,
): ChartMark<Frozen<DendrogramSpec>> {
  const spec = {
    type: "dendrogram",
    ...definedFields(options, [
      "first",
      "second",
      "height",
      "leaves",
      "side",
      "stroke",
      "strokeWidth",
      "label",
      "facet",
      "panel",
      "clip",
      "zIndex",
      "id",
    ]),
  } as unknown as DendrogramSpec;
  if (table.name !== undefined) spec.data = table.name;
  return new DendrogramMark(spec, table as unknown as Table);
}
