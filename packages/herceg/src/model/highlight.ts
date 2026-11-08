// Highlighting: a chart bound to a selection store draws the rows a
// channel selects as they are and dims the others (see row-selection.ts).
// Marks draw their own geometry, so layout, stacking, curves, and color
// stay as drawn without a selection; nothing here is in a chart that binds
// no store.
//
// - Marks drawing a glyph per row (points, bars, error bars, candlesticks,
//   rugs): unselected rows dimmed, then selected rows on top, each row
//   drawn once. Their series keep their place in the list, so grouped bars
//   stay in their slots. Point series the GPU draws stay clouds: two, of
//   their unselected and selected rows.
// - Lines and areas: drawn as they are within the x spans of their runs of
//   selected rows and dimmed outside them, so each pixel is painted once and
//   the highlighted part is the same curve and stack. A line's selected rows
//   with no selected neighbor are dots. Lines whose x does not ascend, and
//   runs of rows at one x, draw whole and dimmed with their selected rows'
//   values over them instead. Lines draw every series' selected parts over
//   every series' others; areas keep their order (a stack's layers).
// - Marks summarizing rows (histograms, box plots, heatmaps) draw their
//   selected rows against the whole themselves (`Mark.selectedGeometry`),
//   through the parts and dimming lent here.
// - Other marks (annotations, custom marks, contours) draw every row as before.
//
// Memberships, splits, and masked values depend only on the selection and
// the data, so charts showing one selection share them.

import type { Table } from "../data/table.ts";
import type { unmappable } from "../lod/m4.ts";
import { copiedFrom, drawingRows, tracing } from "../marks/drawn.ts";
import { opaque } from "../marks/features/translucent.ts";
import type { Frame, Mark, MarkKey, RowParts, SelectionDrawing } from "../marks/mark.ts";
import type { placeAt, rowOf, Series } from "../marks/series.ts";
import { alphaOf } from "../scale/alpha.ts";
import type {
  AreaGeometry,
  Drawing,
  Geometry,
  LineGeometry,
  PointGeometry,
  RasterGeometry,
  RectGeometry,
  SvgElement,
} from "../scene/scene.ts";
import type { ChartSelection, Look, SelectionLooks } from "../spec/state.ts";
import { dashPattern } from "../style/dash.ts";
import type { DotLook } from "./features.ts";
import type { GuideKit } from "./guides.ts";
import { itemResolver } from "./items.ts";
import type { ChartModel } from "./model.ts";

/**
 * The chart's code highlighting draws with, handed in (as the
 * controller's is) by what loads this module: `rowSelection()`'s bindings
 * with it, or a chart with its first selection of items or series, which
 * loads it apart. Imported here, that code would leave the chart's first
 * chunk for one it shares with this module.
 */
export interface HighlightKit {
  placeAt: typeof placeAt;
  rowOf: typeof rowOf;
  unmappable: typeof unmappable;
  /** The markup helpers dots are drawn with (`dotDrawing`). */
  guides: GuideKit;
  /** The fraction of their opacity unselected things are drawn at (`DIM`). */
  dim: number;
  /** Point series of this many rows or more draw on the GPU, as clouds (`CLOUD_POINTS`). */
  cloudPoints: number;
  /**
   * Squares of the share of each cell its selected rows are, for heatmaps
   * and 2D histograms (`shareSquares`). Without, they draw an image of the
   * cells holding selected rows, as items and series, whole cells, need.
   */
  squares?: SelectionDrawing["squares"];
}

/** No shift: a series drawn at its values' place. */
const STILL: readonly [number, number] = [0, 0];

/** Positions of a series' rows, split into the selected and the others. */
interface Split {
  on: Uint32Array;
  off: Uint32Array;
}

/**
 * Splits by membership, then by series rows (the membership itself for
 * series of whole columns), and values with unselected rows missing by
 * membership, then by the column they were read from: kept while the
 * membership lives, so a selection let go takes them with it.
 */
const splits = new WeakMap<Uint8Array, WeakMap<object, Split>>();
const masks = new WeakMap<Uint8Array, WeakMap<object, Float64Array>>();

/** What `cache` keeps for a membership, made on first use. */
function within<V>(cache: WeakMap<Uint8Array, WeakMap<object, V>>, selected: Uint8Array) {
  let kept = cache.get(selected);
  if (!kept) {
    kept = new WeakMap();
    cache.set(selected, kept);
  }
  return kept;
}
/** Dimmed copies of drawings, made once per drawing. */
const dimmedDrawings = new WeakMap<Drawing<Geometry>, Drawing<Geometry>>();
const ON = "\u0001on";
const OFF = "\u0001off";

/** Marks drawing a glyph per row, each drawn dimmed or not. */
const ROWS = new Set(["point", "bar", "errorbar", "rug"]);

/** Whether a mark draws the rows a channel selects highlighted; others draw every row as before. */
export function highlights(mark: Mark): boolean {
  const type = mark.spec.type;
  // Custom marks dim the items their draw makes of rows a selection leaves
  // out, themselves (see `Highlighter.geometry`).
  return (
    ROWS.has(type) ||
    type === "line" ||
    type === "area" ||
    type === "custom" ||
    !!mark.selectedGeometry
  );
}

/**
 * Which rows of a mark's series a selection holds (1 each, by row of its
 * table: `selected`), and what caches of what is drawn of them key by
 * (`key`, and `version`, a row set's or -1); for the series of no one
 * selection (`undefined`), every series' (summaries, drawn as one).
 */
export type Chosen = (series: Series | undefined) => {
  readonly selected: Uint8Array;
  readonly key: object;
  readonly version: number;
};

/** How a mark draws what a selection holds and what it does not, by its looks. */
interface Paint {
  /** Whether a look of the mark's own replaces dimming. */
  looked: boolean;
  dim(geometry: Geometry): Geometry[];
  lit(geometry: Geometry): Geometry;
}

export class Highlighter {
  readonly #kit: HighlightKit;
  /** What a mark's series hold: its table's channel's selection, or the chart's; undefined for none. */
  readonly #of: (mark: Mark) => Chosen | undefined;

  constructor(kit: HighlightKit, chosen: (mark: Mark) => Chosen | undefined) {
    this.#kit = kit;
    this.#of = chosen;
  }

  /**
   * The geometry of a mark with the rows its table's channel selects
   * highlighted; undefined when nothing of it is highlighted (the channel
   * holds no selection, or the mark is not one this draws), for the mark
   * to draw as usual.
   */
  geometry(
    mark: Mark,
    series: readonly Series[],
    frame: Frame,
    key: MarkKey,
    rows?: RowParts,
  ): Geometry[] | undefined {
    const type = mark.spec.type;
    // Custom marks dim their own items, reading `Frame.highlighted`.
    if (!highlights(mark) || type === "custom") return undefined;
    const table = mark.table;
    const chosen = table && this.#of(mark);
    if (!chosen) return undefined;
    const kit = this.#kit;
    const selectedOf = (s: Series) => chosen(s).selected;
    const paint = paintOf(kit, mark, frame);
    // Parts of series draw into buffers and keys of their own, hidden as their series are.
    const hidden = (suffix: string) =>
      frame.hidden.size === 0
        ? frame.hidden
        : new Set(series.filter((s) => frame.hidden.has(s.key)).map((s) => s.key + suffix));
    const own = (suffix: string): Frame => ({ ...frame, hidden: hidden(suffix), keyed: false });
    if (mark.selectedGeometry) {
      const byKey = new Map(series.map((s) => [s.key, s]));
      // Each part stands for the drawn series of its key, whose slot it keeps.
      const parts = (list: readonly Series[], suffix: string) =>
        list.map((p) => ({ ...p, key: p.key + suffix, whole: p.whole ?? byKey.get(p.key) }));
      const drawing: SelectionDrawing = {
        selected: chosen(undefined).selected,
        dimmed: (list) => mark.geometry(parts(list, OFF), own(OFF), key, rows).flatMap(paint.dim),
        lit: (list) => mark.geometry(parts(list, ON), own(ON), key, rows).map(paint.lit),
        dim: paint.dim,
        shown: paint.lit,
        squares: kit.squares ?? (() => undefined),
      };
      return mark.selectedGeometry(series, frame, drawing);
    }
    if (ROWS.has(type)) {
      // Every series' dimmed rows, then every series' selected rows: picking
      // finds those on top (`Frame.highlighted`).
      const dimClouds: Geometry[] = [];
      const litClouds: Geometry[] = [];
      let rest = series;
      if (type === "point" && frame.clouds && series.some((s) => s.length >= kit.cloudPoints)) {
        const big = series.filter((s) => s.length >= kit.cloudPoints);
        const drawn = (mark.geometry(big, frame, key) as PointGeometry[]).filter((g) => g.cloud);
        for (const g of drawn) {
          const s = big.find(({ key }) => key === g.key)!;
          const held = chosen(s);
          const [off, on] = lightClouds(kit, g, split(kit, s, held.selected), held, table, paint);
          dimClouds.push(off);
          litClouds.push(on);
        }
        const done = new Set(drawn.map((g) => g.key));
        rest = series.filter((s) => !done.has(s.key));
      }
      const parts = rest.map((s) => split(kit, s, selectedOf(s)));
      const off = rest.map((s, i) => part(s, OFF, parts[i]!.off));
      const on = rest.map((s, i) => part(s, ON, parts[i]!.on));
      // Clouds are drawn into the canvas in turn: each part in its series' place.
      const place = new Map(series.map((s, i) => [s.key, i]));
      const of = ({ key }: Geometry) => place.get(key.slice(0, key.indexOf("\u0001"))) ?? 0;
      const inOrder = (parts: Geometry[]) => parts.sort((a, b) => of(a) - of(b));
      return [
        ...inOrder([...dimClouds, ...mark.geometry(off, own(OFF), key).flatMap(paint.dim)]),
        ...inOrder([...litClouds, ...mark.geometry(on, own(ON), key).map(paint.lit)]),
      ];
    }
    const drawn = mark.geometry(series, frame, key);
    const byKey = new Map(series.map((s) => [s.key, s]));
    // Lines and areas run along x, or along y (`orient`), which their runs follow.
    const along = mark.tooltip === "y" ? "y" : "x";
    // Stacked areas draw their zeros at a log axis' low end.
    const low =
      type === "area" &&
      Boolean((mark.spec as { stack?: boolean | string }).stack) &&
      frame[along === "x" ? "y" : "x"].type === "log";
    const found = new Map<Series, Runs>();
    const runs = (s: Series) =>
      found.get(s) ?? found.set(s, runsOf(kit, s, selectedOf(s), frame, low, along)).get(s)!;
    // A series' runs' ends, which its pieces (style runs', markers) share.
    const endsOf = new Map<Series, number[] | undefined>();
    const seriesEnds = (s: Series) => {
      if (!endsOf.has(s)) {
        // Dodged series are drawn off their bands' centers.
        const shift = shiftOf(mark, s, frame)[along === "x" ? 0 : 1];
        endsOf.set(s, runEnds(kit, s, runs(s), frame, shift, along));
      }
      return endsOf.get(s);
    };
    // Series spans cannot say: their selected rows' values draw over them instead.
    const others = new Set<Series>();
    for (const g of drawn) {
      const s = byKey.get(g.of ?? g.key);
      if (s && !seriesEnds(s) && !frame.hidden.has(s.key)) others.add(s);
    }
    const shown = new Map<string, Geometry[]>();
    // Geometry of a series with a key of its own (markers, style runs'
    // pieces) by its series and layer: an area's outlines apart from its fills.
    const litKey = (g: Geometry, on = "") =>
      g.of === undefined ? g.key + on : `${g.of}${on}|${outlined(g) ? "outline" : g.kind}`;
    if (others.size > 0) {
      const maskedSeries = [...others].map((s) => masked(s, selectedOf(s), along === "y"));
      for (const g of mark.geometry(maskedSeries, own(ON), key)) {
        // Picking reads which rows a path draws, and where its runs end, of the series it traced.
        const name = g.of ?? g.key;
        const traced = maskedSeries.find((m) => name === m.key || name.startsWith(`${m.key}|`));
        if (traced) tracing(g, traced);
        const parts = shown.get(litKey(g)) ?? shown.set(litKey(g), []).get(litKey(g))!;
        // A look replaces paint once; without, a translucent copy shows the mark's own over it dimmed.
        const copies = paint.looked ? [paint.lit(g)] : over(kit, g);
        parts.push(...copies.map((copy) => (copy === g ? g : copiedFrom(copy, g))));
      }
    }
    // A series drawn in pieces (sharing `of`: markers, style runs'): each
    // layer's selected values go once, over the last of its dimmed pieces.
    const lastPiece = new Map<string, Geometry>();
    for (const g of drawn) if (g.of !== undefined) lastPiece.set(litKey(g, ON), g);
    // In the mark's order, each part as it paints it: an area's fill, then
    // its outline; a series' selected rows over its own dimmed ones, so that
    // translucent colors selected whole show as they are. Lines, whose order
    // means nothing, paint every series' selected parts over every series'
    // others (`litOverSeries`); a stack's layers keep theirs.
    const out: Geometry[] = [];
    const lit = type === "line" ? ([] as Geometry[]) : out;
    const shift = (s: Series) => shiftOf(mark, s, frame);
    for (const g of drawn) {
      const s = byKey.get(g.of ?? g.key);
      const ends = s && seriesEnds(s);
      // Markers are lit whole where their observations are selected rows,
      // which they mark in place of dots.
      const rows = ends && g.kind === "point" && s.features?.markerRows?.(g);
      if (rows) {
        const [inside, outside] = pointsIn(g as PointGeometry, rows, selectedOf(s));
        out.push(...paint.dim(outside));
        lit.push(paint.lit(inside));
        continue;
      }
      if (ends) {
        // Each pixel is painted once: dimmed outside the selected runs, as
        // drawn inside them; each piece of a series (a style run's) by the
        // spans its own extent reaches, for its own width. Line ends are
        // round caps, half a stroke past the last vertex.
        const width =
          g.kind === "line"
            ? (g as LineGeometry).strokeWidth
            : (g as AreaGeometry).stroke
              ? (g as AreaGeometry).strokeWidth
              : 0;
        const box = strokeBounds(g);
        const [lo, hi] = along === "x" ? [box[0], box[2]] : [box[1], box[3]];
        const spans =
          lo <= hi
            ? spansAt(ends, width / 2, lo, hi)
            : spansAt(ends, width / 2, -Infinity, Infinity);
        const off = complement(spans, frame, along);
        const [outside, inside] =
          lo <= hi ? [reaching(off, lo, hi), reaching(spans, lo, hi)] : [off, spans];
        if (outside.length > 0)
          for (const dimmed of paint.dim(g)) out.push(clipped(dimmed, outside, frame, along, OFF));
        if (inside.length > 0) lit.push(clipped(paint.lit(g), inside, frame, along, ON));
        continue;
      }
      // Dimmed, then its selected rows' values over it, part by part. A
      // translucent copy shows as it is only straight over its own dimmed
      // part, so a series with selected values goes with them whole.
      const [under, values] = [paint.dim(g), shown.get(litKey(g, ON)) ?? []];
      const dimmed = values.some(drawsSome) ? lit : out;
      const last = lastPiece.get(litKey(g, ON));
      if (last) {
        dimmed.push(...under);
        if (last === g) lit.push(...values);
        continue;
      }
      for (let i = 0; i < Math.max(under.length, values.length); i++) {
        if (under[i]) dimmed.push(under[i]!);
        if (values[i]) lit.push(values[i]!);
      }
    }
    // Dots at selected rows no span shows, for series without markers, in
    // the look each observation is drawn in: a line's color, opacity, and
    // width, an area's outline's (or its dots'), or as its style runs give
    // it. With the series' selected parts: over its own runs, under later
    // series' (picking reads them so: `litOverSeries`).
    const whole = new Map<string, DotLook>();
    for (const g of drawn)
      if (g.kind === "line") {
        const line = g as LineGeometry;
        whole.set(g.key, {
          color: line.stroke,
          opacity: g.draw.opacity ?? 1,
          width: line.strokeWidth,
        });
      } else if (g.kind === "area" && g.of === undefined) {
        const area = g as AreaGeometry;
        whole.set(g.key, {
          color: area.stroke ?? area.fill,
          opacity: area.strokeOpacity ?? 1,
          width: area.strokeWidth,
        });
      }
    const marked = new Set(drawn.map((g) => (g.kind === "point" ? g.of : undefined)));
    const dotsOf = new Map<string, PointGeometry[]>();
    for (const d of dots(
      kit,
      series.filter((s) => !marked.has(s.key)),
      table,
      runs,
      frame,
      shift,
      (s) => {
        const at = s.features?.lookAt?.(s);
        const look = whole.get(s.key) ?? { color: s.color, opacity: 1, width: 0 };
        return at ?? (() => look);
      },
    )) {
      const owner = d.key.slice(0, d.key.indexOf(ON));
      (dotsOf.get(owner) ?? dotsOf.set(owner, []).get(owner)!).push(d);
    }
    const under = lit === out ? [] : out;
    if (dotsOf.size === 0) return lit === out ? out : [...out, ...lit];
    const ownerOf = (g: Geometry) => (g.of ?? g.key).split("\u0001")[0]!;
    const last = new Map<string, Geometry>();
    for (const g of lit) last.set(ownerOf(g), g);
    // Dots of a series none of whose pieces reach the plot go where it
    // would be drawn: before the first part of a later series.
    const order = new Map(series.map((s, i) => [s.key, i]));
    const rank = (owner: string) => order.get(owner) ?? -1;
    const waiting = [...dotsOf.keys()].filter((owner) => !last.has(owner));
    waiting.sort((a, b) => rank(a) - rank(b));
    const placed: Geometry[] = [...under];
    for (const g of lit) {
      const owner = ownerOf(g);
      while (waiting.length > 0 && rank(waiting[0]!) < rank(owner))
        placed.push(...dotsOf.get(waiting.shift()!)!);
      placed.push(g);
      if (last.get(owner) === g && dotsOf.has(owner)) placed.push(...dotsOf.get(owner)!);
    }
    for (const owner of waiting) placed.push(...dotsOf.get(owner)!);
    return placed;
  }
}

/** Points split by whether the rows they stand at (`rows`, one a point) are selected: those in, and the others. */
function pointsIn(
  g: PointGeometry,
  rows: ArrayLike<number>,
  selected: Uint8Array,
): [PointGeometry, PointGeometry] {
  const parts = [new Float32Array(g.count * 2), new Float32Array(g.count * 2)];
  // Which of `g`'s points each part's is, for drawn-mark records.
  const indices = [new Uint32Array(g.count), new Uint32Array(g.count)];
  const counts = [0, 0];
  for (let i = 0; i < g.count; i++) {
    const part = selected[rows[i]!] === 1 ? 0 : 1;
    parts[part]!.set(g.coords.subarray(i * 2, i * 2 + 2), counts[part]! * 2);
    indices[part]![counts[part]!] = i;
    counts[part]!++;
  }
  const part = (j: number): PointGeometry =>
    copiedFrom(
      { ...g, key: `${g.key}${j ? "" : ON}`, coords: parts[j]!, count: counts[j]! },
      g,
      indices[j]!.subarray(0, counts[j]!),
    );
  return [part(0), part(1)];
}

/** How far a mark draws a line's or area's series from its values' place (dodged series). */
function shiftOf(mark: Mark, s: Series, frame: Frame): readonly [number, number] {
  return mark.displace?.(s, 0, frame) ?? STILL;
}

/** A series' positions split by whether their rows are selected. */
function split(kit: HighlightKit, s: Series, selected: Uint8Array): Split {
  const { rowOf } = kit;
  const kept = within(splits, selected);
  const key = s.rows ?? selected;
  const known = kept.get(key);
  if (known) return known;
  let count = 0;
  for (let k = 0; k < s.length; k++) count += selected[rowOf(s, k)]!;
  const on = new Uint32Array(count);
  const off = new Uint32Array(s.length - count);
  // Each row is written to both and kept by the one it belongs to: without
  // a branch, which scattered selections mispredict. Writes past an array's
  // end, of rows that belong to the other, are dropped.
  let [i, j] = [0, 0];
  for (let k = 0; k < s.length; k++) {
    const row = rowOf(s, k);
    const lit = selected[row]!;
    on[i] = row;
    off[j] = row;
    i += lit;
    j += lit ^ 1;
  }
  const found = { on, off };
  kept.set(key, found);
  return found;
}

/** A series cut down to some of its rows, under a key of its own. */
function part(s: Series, suffix: string, rows: Uint32Array): Series {
  return {
    ...s,
    key: s.key + suffix,
    rows,
    length: rows.length,
    stream: undefined,
    edges: undefined,
    whole: s.whole ?? s,
  };
}

/**
 * A point cloud highlighted on the GPU: its unselected and its selected
 * rows as two clouds, so each point composites once. Each part streams as
 * its cloud does: while the selection stays and rows are only appended and
 * dropped, a part loses rows from its front and gains them at its end, so
 * its upload takes appended points rather than being made again.
 */
function lightClouds(
  { dim }: HighlightKit,
  g: PointGeometry,
  { on, off }: Split,
  held: ReturnType<Chosen>,
  table: Table,
  paint: Paint,
): [dimmed: PointGeometry, lit: PointGeometry] {
  const cloud = g.cloud!;
  const rows = (side: "on" | "off", of: Uint32Array, opacity: number): PointGeometry => ({
    ...g,
    key: g.key + (side === "on" ? ON : OFF),
    fillOpacity: opacity,
    opaque: g.opaque && opacity >= 1,
    count: of.length,
    cloud: {
      ...cloud,
      rows: of,
      start: 0,
      end: of.length,
      stream: cloud.stream && partStream(cloud.stream.key, side, of, held, table),
    },
  });
  if (!paint.looked) return [rows("off", off, g.fillOpacity * dim), rows("on", on, g.fillOpacity)];
  const [dimmed, lit] = [
    paint.dim(rows("off", off, g.fillOpacity))[0],
    paint.lit(rows("on", on, g.fillOpacity)),
  ];
  return [dimmed as PointGeometry, lit as PointGeometry];
}

/** What a streaming cloud's part was last drawn of, by its cloud's stream key. */
interface PartUpload {
  /** Names the part's upload, as long as it can follow its rows. */
  key: object;
  /** The row set's version; -1 for a condition. */
  version: number;
  generation: number;
  modified: number;
  rowOffset: number;
  rows: Uint32Array;
  /** Rows the part has lost from its front. */
  offset: number;
  /** Counts the times the part changed otherwise, which uploads it again. */
  epoch: number;
}

/** Cloud parts' uploads by selection, then by their cloud's stream key, kept while both live. */
const partUploads = new WeakMap<object, WeakMap<object, { on?: PartUpload; off?: PartUpload }>>();

/**
 * A cloud part's stream (see `PointCloud.stream`): rows dropped from the
 * table's front leave the part's front (its rows are ascending positions),
 * appended rows join its end; any other change starts a new epoch.
 */
function partStream(
  base: object,
  side: "on" | "off",
  rows: Uint32Array,
  { key: selection, version }: ReturnType<Chosen>,
  table: Table,
): NonNullable<NonNullable<PointGeometry["cloud"]>["stream"]> {
  let bySelection = partUploads.get(selection);
  if (!bySelection) {
    bySelection = new WeakMap();
    partUploads.set(selection, bySelection);
  }
  let parts = bySelection.get(base);
  if (!parts) {
    parts = {};
    bySelection.set(base, parts);
  }
  const known = parts[side];
  let next: PartUpload;
  if (
    known &&
    known.version === version &&
    known.generation === table.generation &&
    known.modified === table.modifiedVersion &&
    table.rowOffset >= known.rowOffset
  ) {
    // Rows of the part before the table's new first row have left.
    const shift = table.rowOffset - known.rowOffset;
    let dropped = 0;
    while (dropped < known.rows.length && known.rows[dropped]! < shift) dropped++;
    next = { ...known, rowOffset: table.rowOffset, rows, offset: known.offset + dropped };
  } else {
    next = {
      key: known?.key ?? {},
      version,
      generation: table.generation,
      modified: table.modifiedVersion,
      rowOffset: table.rowOffset,
      rows,
      offset: 0,
      epoch: (known?.epoch ?? 0) + 1,
    };
  }
  parts[side] = next;
  return { key: next.key, offset: next.offset, modified: next.epoch };
}

/**
 * A line's or area's series with the unselected rows' values (and a
 * stack's or band's bases) missing, so the mark breaks its runs there:
 * values along y, or for marks along y, along x.
 */
function masked(s: Series, selected: Uint8Array, alongY: boolean): Series {
  // Indexes and streams follow the columns, not these values; edges draw a
  // whole layer. A part keeps its whole, whose slot it stands in (dodge).
  const part = { key: s.key + ON, field: undefined, stream: undefined, edges: undefined };
  const whole = s.whole ?? s;
  if (alongY)
    return { ...s, ...part, x: mask(s.x, selected), x0: s.x0 && mask(s.x0, selected), whole };
  return { ...s, ...part, y: mask(s.y, selected), y0: s.y0 && mask(s.y0, selected), whole };
}

function mask(values: Series["y"], selected: Uint8Array): Float64Array {
  const kept = within(masks, selected);
  const known = kept.get(values);
  if (known) return known;
  const out = new Float64Array(selected.length);
  for (let row = 0; row < selected.length; row++)
    out[row] = selected[row] ? values[row]! : Number.NaN;
  kept.set(values, out);
  return out;
}

/** A series' runs of selected rows, as its mark draws them (see `runsOf`). */
interface Runs {
  /**
   * The first and last of each run, as pairs of indices in x order,
   * trimmed to the rows the mark draws through.
   */
  runs: number[];
  /** How many positions are in x order: the series', or a stack layer's with an x. */
  count: number;
  /** The position at an index in x order. */
  at(i: number): number;
  /** Whether the mark draws through the row at an index in x order. */
  drawn(i: number): boolean;
  /** From `i` on by `step`, the first index an axis break does not hide (-1 or `count` past the ends). */
  shown(i: number, step: 1 | -1): number;
}

/**
 * The runs of selected rows of a series, in x order: as its positions are,
 * or for a layer of a stack drawn through its edges, its rows with an x
 * sorted, as the stack orders them. A run ends at its outermost rows the
 * mark draws through, by the rule it draws by: x, y, and a range's or a
 * stack's lower end placed (`low`: zeros at a log axis' low end), rows
 * inside axis breaks hidden, and for a stack's layer drawn through its
 * edges, x alone, since the edges draw what is there. A run goes on across
 * rows a break hides, as the line joins the rows either side, and keeps the
 * rows inside it that the line breaks at: the caps either side are within
 * its span. Only runs' ends and their neighbors are placed, so this costs
 * per run, beyond a scan of the membership.
 */
function runsOf(
  kit: HighlightKit,
  s: Series,
  selected: Uint8Array,
  frame: Frame,
  low: boolean,
  along: "x" | "y",
): Runs {
  const { placeAt, rowOf, unmappable } = kit;
  const { rows, edges } = s;
  const across = along === "x" ? "y" : "x";
  const bases = along === "x" ? s.y0 : s.x0;
  const sorted = runsAlong(s, frame, along);
  const positionOf = (k: number) => placeAt(s, along, rowOf(s, k));
  let order: Uint32Array | undefined;
  if (!sorted && edges) {
    const placed: number[] = [];
    for (let k = 0; k < s.length; k++) if (Number.isFinite(positionOf(k))) placed.push(k);
    order = Uint32Array.from(placed).sort((a, b) => positionOf(a) - positionOf(b));
  }
  const count = order ? order.length : s.length;
  const at = (i: number) => (order === undefined ? i : order[i]!);
  const [alongMap, acrossMap] = [frame[along].mapping(), frame[across].mapping()];
  // Only time x axes have breaks, which hide positions, or the values of marks along y.
  const breaks = frame.x.breaks;
  const onAlong =
    frame[along].type === "band" ? (v: number) => v >= 0 : (v: number) => !unmappable(alongMap, v);
  const onAcross =
    frame[across].type === "band"
      ? (v: number) => v >= 0
      : (v: number) => (low && v === 0) || !unmappable(acrossMap, v);
  const drawn = (i: number) => {
    const row = rowOf(s, at(i));
    const position = placeAt(s, along, row);
    if (!onAlong(position) || breaks?.hides(placeAt(s, "x", row))) return false;
    // Rows `where` and `continuity.defined` leave out.
    if (s.features?.drawn?.(row) === false) return false;
    return (
      edges !== undefined ||
      (onAcross(placeAt(s, across, row)) && (bases === undefined || onAcross(bases[row]!)))
    );
  };
  const shown = (i: number, step: 1 | -1) => {
    let j = i;
    while (breaks && j >= 0 && j < count && breaks.hides(placeAt(s, "x", rowOf(s, at(j)))))
      j += step;
    return j;
  };
  // Series of whole columns in their own order read the membership directly.
  const direct = order === undefined && rows === undefined;
  const chosen = (i: number) => selected[direct ? i : rowOf(s, at(i))] === 1;
  const runs: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!chosen(i)) continue;
    // Runs start at rows shown: past those a break hides, each read once.
    const from = shown(i, 1);
    if (from !== i) {
      i = from - 1;
      continue;
    }
    const first = i;
    let next = i + 1;
    for (;;) {
      if (i + 1 < count && chosen(i + 1)) i++;
      else {
        // Past rows a break hides, to the row the line joins next.
        next = shown(i + 1, 1);
        if (next === i + 1 || next >= count || !chosen(next)) break;
        i = next;
      }
    }
    let [start, end] = [first, i];
    while (start <= end && !drawn(start)) start++;
    while (end > start && !drawn(end)) end--;
    if (start <= end) runs.push(start, end);
    // The hidden rows after the run were read: go on from the row shown next.
    i = next - 1;
  }
  return { runs, count, at, drawn, shown };
}

/**
 * Whether a series' positions ascend along `along` as it is traced: as it
 * says, or over categories, whose rows lines and areas draw in band order.
 */
function runsAlong(s: Series, frame: Frame, along: "x" | "y"): boolean {
  return (along === "x" ? s.sorted : (s.ySorted ?? false)) || frame[along].type === "band";
}

/**
 * The pixel ends along the axis a series runs along (`along`: x, or y for
 * lines and areas along y) of its runs of selected rows, in pixel order:
 * per run, its low and high ends, from its first row to its last, moved
 * `shift` pixels where a dodged series is drawn, and whether each ends a
 * path (1, else 0), where a stroke's round cap reaches further (`spansAt`).
 * A layer of a stack drawn through its edges (a series field's) fills
 * positions other layers have too: its runs reach the stack's ends past
 * its own first and last rows. Undefined where spans cannot say what is
 * selected: a line whose positions do not ascend, or rows at one position
 * drawn as a run across, all selected or some at a run's end.
 */
function runEnds(
  { placeAt, rowOf }: HighlightKit,
  s: Series,
  found: Runs,
  frame: Frame,
  shift: number,
  along: "x" | "y",
): number[] | undefined {
  const edges = s.edges;
  const sorted = runsAlong(s, frame, along);
  if (!sorted && !edges) return undefined;
  const { at, drawn, shown, count: n } = found;
  // Where the series was traced, as its trace ended its paths (`continuity`, `where`).
  const stops = s.features?.pathEnds?.(s, frame);
  const xAt = (i: number) => placeAt(s, along, rowOf(s, at(i)));
  // Edges hold positions as the series does: bands read through a panel's places.
  const places = s.places?.[along];
  const placed = (value: number) => (places && value >= 0 ? places.at(value) : value);
  // In x order, which is pixel order or (reversed axes) its reverse.
  const ends: number[] = [];
  for (let r = 0; r < found.runs.length; r += 2) {
    const [start, end] = [found.runs[r]!, found.runs[r + 1]!];
    let [from, to] = [xAt(start), xAt(end)];
    // Other rows drawn at a run's end, past breaks too: no span tells their segments apart.
    for (let j = start - 1; j >= 0 && xAt(j) === from; j--) if (drawn(j)) return undefined;
    for (let j = end + 1; j < n && xAt(j) === to; j++) if (drawn(j)) return undefined;
    if (edges && edges.x.length > 0) {
      if (start === 0) from = Math.min(from, placed(edges.x[0]!));
      if (end === n - 1) to = Math.max(to, placed(edges.x[edges.x.length - 1]!));
    }
    // A row alone is a dot.
    if (start === end && from === to) continue;
    if (from === to) return undefined;
    const [a, b] = [frame[along].map(from) + shift, frame[along].map(to) + shift];
    // Ends of paths: as its trace ended them, or rows with no row drawn
    // before or after them, past rows breaks hide.
    const [before, after] = [shown(start - 1, -1), shown(end + 1, 1)];
    const endsPath = (i: number, j: number, way: 1 | -1) =>
      stops ? stops(rowOf(s, at(i)), way) : j < 0 || j >= n || !drawn(j);
    const first = endsPath(start, before, -1) ? 1 : 0;
    const last = endsPath(end, after, 1) ? 1 : 0;
    if (a <= b) ends.push(a, b, first, last);
    else ends.push(b, a, last, first);
  }
  if (ends.length > 4 && ends[0]! > ends[ends.length - 4]!) {
    const reversed: number[] = [];
    for (let i = ends.length - 4; i >= 0; i -= 4) reversed.push(...ends.slice(i, i + 4));
    return reversed;
  }
  return ends;
}

/**
 * The spans of the runs of `ends` (`runEnds`) reaching from `lo` to `hi`,
 * for a stroke whose round caps reach `cap` pixels past a path's ends:
 * ascending pixel pairs, merged where they touch, at least a pixel wide.
 * Found by bisection, so a piece of a series reads only the runs it meets.
 */
function spansAt(ends: readonly number[], cap: number, lo: number, hi: number): number[] {
  // Runs' high ends ascend; a run reaches at most a cap and half a pixel past its ends.
  const reach = cap + 0.5;
  let [a, b] = [0, ends.length / 4];
  while (a < b) {
    const mid = (a + b) >> 1;
    if (ends[mid * 4 + 1]! + reach < lo) a = mid + 1;
    else b = mid;
  }
  const spans: number[] = [];
  for (let i = a * 4; i < ends.length && ends[i]! - reach <= hi; i += 4) {
    let [from, to] = [ends[i]! - ends[i + 2]! * cap, ends[i + 1]! + ends[i + 3]! * cap];
    if (to - from < 1) [from, to] = [(from + to) / 2 - 0.5, (from + to) / 2 + 0.5];
    // A cap may reach over spans before it: they merge.
    while (spans.length > 0 && from <= spans[spans.length - 1]!) {
      to = Math.max(to, spans.pop()!);
      from = Math.min(from, spans.pop()!);
    }
    spans.push(from, to);
  }
  return spans;
}

/** The plot's x (or y, `along`) outside `spans` (ascending pairs), as pairs. */
function complement(spans: readonly number[], frame: Frame, along: "x" | "y"): number[] {
  const { plot } = frame;
  const [start, size] = along === "x" ? [plot.x, plot.width] : [plot.y, plot.height];
  const out: number[] = [];
  let from = start - 1;
  for (let i = 0; i < spans.length; i += 2) {
    if (spans[i]! > from) out.push(from, spans[i]!);
    from = Math.max(from, spans[i + 1]!);
  }
  const end = start + size + 1;
  if (end > from) out.push(from, end);
  return out;
}

/** Of `spans` (ascending pairs that do not overlap), those reaching from `lo` to `hi`. */
function reaching(spans: readonly number[], lo: number, hi: number): number[] {
  let [a, b] = [0, spans.length / 2];
  while (a < b) {
    const mid = (a + b) >> 1;
    if (spans[mid * 2 + 1]! < lo) a = mid + 1;
    else b = mid;
  }
  const out: number[] = [];
  for (let i = a * 2; i < spans.length && spans[i]! <= hi; i += 2)
    out.push(spans[i]!, spans[i + 1]!);
  return out;
}

/**
 * A geometry drawn only over spans (pairs of pixels) along x, across the
 * plot's height, or with `along` "y" along y, across its width.
 */
function clipped(
  geometry: Geometry,
  spans: readonly number[],
  frame: Frame,
  along: "x" | "y",
  part: typeof ON | typeof OFF,
): Geometry {
  const { plot } = frame;
  // Runs of series' data, which canvases draw.
  const draw = geometry.draw as Drawing<Geometry> & { canvas: CanvasPaint };
  // Each span's rectangle: x, y, width, height.
  const rect = (i: number) =>
    along === "x"
      ? [spans[i]!, plot.y, spans[i + 1]! - spans[i]!, plot.height]
      : [plot.x, spans[i]!, plot.width, spans[i + 1]! - spans[i]!];
  // Named by what it cuts, so that scenes name it alike, and SVG documents
  // drawn apart and shown on one page do not mix them up.
  const id = `herceg-runs-${hash(`${geometry.key}${part}${along} ${spans.join(" ")} ${plot.x} ${plot.y} ${plot.width} ${plot.height}`)}`;
  const drawing: Drawing<Geometry> = {
    size: draw.size,
    opacity: draw.opacity,
    clip: Array.from({ length: spans.length / 2 }, (_, i) => rect(i * 2)).flat(),
    // What it leaves out where style runs meet, which PDF cuts as the drawing's own clips do.
    ...(draw.holes && { holes: draw.holes }),
    svg(g, context) {
      // One shape of every span: WebKit clips away all of a flat line under several.
      let d = "";
      for (let i = 0; i < spans.length; i += 2) {
        const [x, y, width, height] = rect(i);
        d += `M${x} ${y}h${width}v${height}h${-width!}Z`;
      }
      return `<clipPath id="${id}"><path d="${d}"/></clipPath><g clip-path="url(#${id})">${draw.svg(g, context)}</g>`;
    },
    canvas(context, g, options) {
      context.save();
      context.beginPath();
      for (let i = 0; i < spans.length; i += 2) {
        const [x, y, width, height] = rect(i);
        context.rect(x!, y!, width!, height!);
      }
      context.clip();
      draw.canvas(context, g, options);
      context.restore();
    },
  };
  return copiedFrom({ ...geometry, key: `${geometry.key}${part}${id}`, draw: drawing }, geometry);
}

type CanvasPaint = Exclude<Drawing<Geometry>["canvas"], false>;

/** What a stroke may paint: its points' bounds (curves' controls too), out by half its width. */
function strokeBounds(geometry: Geometry): [number, number, number, number] {
  const box: [number, number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  const take = (values: ArrayLike<number>, count: number) => {
    for (let i = 0; i + 1 < count; i += 2) {
      const [x, y] = [values[i]!, values[i + 1]!];
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      if (x < box[0]) box[0] = x;
      if (y < box[1]) box[1] = y;
      if (x > box[2]) box[2] = x;
      if (y > box[3]) box[3] = y;
    }
  };
  const paths =
    geometry.kind === "line"
      ? [(geometry as LineGeometry).path]
      : [(geometry as AreaGeometry).upper, (geometry as AreaGeometry).lower];
  for (const path of paths) {
    if (!path) continue;
    take(path.coords, path.count * 2);
    if (path.curved) take(path.controls, path.count * 4);
  }
  // Round joins and caps reach half a width from the path, and a pixel more antialiased.
  const half = (geometry as LineGeometry | AreaGeometry).strokeWidth / 2 + 1;
  return [box[0] - half, box[1] - half, box[2] + half, box[3] + half];
}

/** A 32-bit FNV-1a hash of `text`, in base 36 (as run-paths.ts names its cuts). */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/**
 * Where a series draws its runs of one selected row, which no span shows:
 * x, y pixels per row; with `positions`, the position of each in it too.
 */
function loneRows(
  { placeAt, rowOf }: HighlightKit,
  s: Series,
  runs: (s: Series) => Runs,
  frame: Frame,
  shift: (s: Series) => readonly [number, number],
  positions?: number[],
): number[] {
  const coords: number[] = [];
  const found = runs(s);
  const [dx, dy] = shift(s);
  for (let r = 0; r < found.runs.length; r += 2) {
    if (found.runs[r] !== found.runs[r + 1]) continue;
    const k = found.at(found.runs[r]!);
    const row = rowOf(s, k);
    coords.push(frame.x.map(placeAt(s, "x", row)) + dx, frame.y.map(placeAt(s, "y", row)) + dy);
    positions?.push(k);
  }
  return coords;
}

/**
 * Dots at runs of one row drawn, which no span shows, where `shift` says
 * each series is drawn, in the look `looks` gives each position: a
 * geometry per series, a piece of it (`of`), which value animation moves
 * with it by the rows of `table` the dots are. Each covers its
 * observation's stroke, or its dot where it stands alone, and composites
 * over what is drawn under it as translucent points do.
 */
function dots(
  kit: HighlightKit,
  series: readonly Series[],
  table: Table,
  runs: (s: Series) => Runs,
  frame: Frame,
  shift: (s: Series) => readonly [number, number],
  looks: (s: Series) => (position: number) => DotLook,
): PointGeometry[] {
  const out: PointGeometry[] = [];
  for (const s of series) {
    if (frame.hidden.has(s.key)) continue;
    const positions: number[] = [];
    const coords = loneRows(kit, s, runs, frame, shift, positions);
    if (coords.length === 0) continue;
    const lookAt = looks(s);
    // In observation order, each in its own look: later dots over earlier
    // ones, as translucent points draw (never grouped by color).
    const count = positions.length;
    const palette: string[] = [];
    const indexOf = new Map<string, number>();
    const [index, opacities, radii] = [
      new Float32Array(count),
      new Float32Array(count),
      new Float32Array(count),
    ];
    const least = Math.max(2.5, frame.theme.style.line.strokeWidth * 1.5);
    positions.forEach((k, i) => {
      const { color, opacity, width } = lookAt(k);
      let at = indexOf.get(color);
      if (at === undefined) {
        at = palette.length;
        palette.push(color);
        indexOf.set(color, at);
      }
      [index[i], opacities[i], radii[i]] = [at, opacity, Math.max(least, width / 2)];
    });
    const alike = (values: Float32Array) => values.every((value) => value === values[0]);
    const one = palette.length === 1 && alike(opacities) && alike(radii);
    const items = frame.keyed
      ? {
          table,
          generation: table.generation,
          ids: Float64Array.from(positions, (k) => table.identity(kit.rowOf(s, k))),
        }
      : undefined;
    const dot: PointGeometry = {
      kind: "point",
      draw: dotDrawing(kit),
      key: `${s.key}${ON}-dots`,
      of: s.key,
      ...(items && { items }),
      fill: palette[0]!,
      fillOpacity: opacities[0]!,
      opaque: false,
      radius: radii.reduce((most, r) => Math.max(most, r), 0),
      symbol: "circle",
      coords: Float32Array.from(coords),
      count,
      ...(!one && { colors: { index, palette, categorical: true as const }, opacities, radii }),
    };
    out.push(
      drawingRows(
        dot,
        Uint32Array.from(positions, (k) => kit.rowOf(s, k)),
      ),
    );
  }
  return out;
}

const dotDrawings = new WeakMap<HighlightKit, Drawing<PointGeometry>>();

/**
 * The drawing of dots (circles, as PDF reads their fields too), made once
 * per kit: each in its own color, opacity, and radius where the geometry
 * gives them per dot, in order, so later dots draw over earlier ones.
 */
function dotDrawing(kit: HighlightKit): Drawing<PointGeometry> {
  let drawing = dotDrawings.get(kit);
  if (drawing) return drawing;
  const { n, markupOf } = kit.guides;
  const lookOf = (dots: PointGeometry, i: number) => ({
    fill: dots.colors ? dots.colors.palette[dots.colors.index[i]!]! : dots.fill,
    opacity: dots.opacities ? dots.opacities[i]! : dots.fillOpacity,
    r: dots.radii ? dots.radii[i]! : dots.radius,
  });
  const elements = (dots: PointGeometry): SvgElement[] =>
    Array.from({ length: dots.count }, (_, i) => {
      const { fill, opacity, r } = lookOf(dots, i);
      const [x, y, d] = [dots.coords[i * 2]!, dots.coords[i * 2 + 1]!, n(r * 2)];
      const arc = `${n(r)} ${n(r)} 0 1 1`;
      const attributes: Record<string, string> = {
        d: `M${n(x - r)} ${n(y)}a${arc} ${d} 0a${arc} -${d} 0`,
        fill,
      };
      if (opacity !== 1) attributes["fill-opacity"] = String(opacity);
      return { tag: "path", attributes };
    });
  drawing = {
    size: (dots) => dots.count,
    elements,
    svg: (dots) => markupOf(elements(dots)),
    canvas(context, dots) {
      const alpha = context.globalAlpha;
      for (let i = 0; i < dots.count; i++) {
        const { fill, opacity, r } = lookOf(dots, i);
        context.beginPath();
        context.arc(dots.coords[i * 2]!, dots.coords[i * 2 + 1]!, r, 0, Math.PI * 2);
        context.globalAlpha = alpha * opacity;
        context.fillStyle = fill;
        context.fill();
      }
      context.globalAlpha = alpha;
    },
  };
  dotDrawings.set(kit, drawing);
  return drawing;
}

/** A point's or bar's geometry with its opacity dimmed; anything else (labels) drawn dimmed. */
function dim({ dim: DIM }: HighlightKit, geometry: Geometry): Geometry {
  if (geometry.kind === "point") {
    const points = geometry as PointGeometry;
    const dimmed: PointGeometry = {
      ...points,
      fillOpacity: points.fillOpacity * DIM,
      opaque: false,
      opacities: points.opacities?.map((opacity) => opacity * DIM),
      ring: points.ring && { ...points.ring, opacity: (points.ring.opacity ?? 1) * DIM },
    };
    return copiedFrom(dimmed, geometry);
  }
  if (geometry.kind === "rect") {
    const rects = geometry as RectGeometry;
    const { edge } = rects;
    const dimmed: RectGeometry = {
      ...rects,
      fillOpacity: rects.fillOpacity * DIM,
      ...(edge && { edge: { ...edge, opacity: edge.opacity * DIM } }),
    };
    return copiedFrom(dimmed, geometry);
  }
  let draw = dimmedDrawings.get(geometry.draw);
  if (!draw) {
    draw = faded(geometry.draw, DIM);
    dimmedDrawings.set(geometry.draw, draw);
  }
  return copiedFrom({ ...geometry, draw }, geometry);
}

/**
 * Whether `geometry` is an area of no fill (a style run's outline, or dots
 * of observations standing alone, painted at its stroke's opacity), which
 * paints after an area's fills.
 */
function outlined(geometry: Geometry): boolean {
  return geometry.kind === "area" && (geometry as AreaGeometry).fillOpacity === 0;
}

/**
 * A geometry dimmed, for any kind: an area's fill at a fraction of its
 * opacity and its outline drawn apart, an area of no fill (`outlineOf`)
 * at a fraction of its stroke's opacity, since areas paint their outline
 * at full opacity (and set the canvas' alpha, which a faded drawing would
 * multiply).
 */
function dimLayer(kit: HighlightKit, geometry: Geometry): Geometry[] {
  const DIM = kit.dim;
  if (geometry.kind !== "area") return [dim(kit, geometry)];
  const area = geometry as AreaGeometry;
  // An outline of no fill (a style run's) dims as drawn, keeping where it is cut.
  if (outlined(area))
    return [copiedFrom({ ...area, strokeOpacity: (area.strokeOpacity ?? 1) * DIM }, area)];
  // Areas draw isolated observations as dots of their outline, or of their
  // fill's color without one: with the outline, dimmed, or dimmed here.
  const fill: AreaGeometry = area.stroke
    ? { ...area, fillOpacity: area.fillOpacity * DIM, stroke: null, strokeWidth: 0 }
    : {
        ...area,
        fillOpacity: area.fillOpacity * DIM,
        strokeOpacity: (area.strokeOpacity ?? 1) * DIM,
      };
  copiedFrom(fill, area);
  return area.stroke ? [fill, ...dimLayer(kit, outlineOf(area))] : [fill];
}

/**
 * An area's outline apart from its fill, as an area of no fill: drawn as
 * the area draws it (its ends, its isolated observations' dots), at its
 * own opacity.
 */
function outlineOf(area: AreaGeometry): AreaGeometry {
  // Its series', whose selected dots are drawn after it.
  return copiedFrom(
    { ...area, key: `${area.key}-outline`, of: area.of ?? area.key, fillOpacity: 0 },
    area,
  );
}

/** A drawing of the same marks at `fraction` of their opacity. */
function faded(draw: Drawing<Geometry>, fraction: number): Drawing<Geometry> {
  const { elements, canvas: paint } = draw;
  const copy = {
    ...draw,
    opacity: (draw.opacity ?? 1) * fraction,
    svg: (geometry, context) => `<g opacity="${fraction}">${draw.svg(geometry, context)}</g>`,
    elements:
      elements &&
      ((geometry, context) =>
        elements(geometry, context)?.map(({ tag, attributes }) => ({
          tag,
          attributes: {
            ...attributes,
            opacity: String(fraction * Number(attributes.opacity ?? 1)),
          },
        }))),
    canvas:
      paint &&
      ((context, geometry, options) => {
        const alpha = context.globalAlpha;
        context.globalAlpha = alpha * fraction;
        paint(context, geometry, options);
        context.globalAlpha = alpha;
      }),
  } as Drawing<Geometry>;
  return copy;
}

/**
 * Selected rows' values drawn over their series dimmed (where spans cannot
 * say what is selected), at the opacity that, over the dimmed drawing in
 * the same color, shows the mark's own: a color of alpha `a` (its own
 * alpha times the mark's opacity) over itself at `a * DIM` composites to
 * `a` when drawn at `(1 - DIM) a / (1 - DIM a)`. An area's outline is
 * drawn apart, an area of no fill (`outlineOf`), so each is drawn at its
 * own alpha.
 */
/** Whether a line's or markers' copy draws anything: a series' with selected rows does. */
function drawsSome(geometry: Geometry): boolean {
  if (geometry.kind === "line") return (geometry as LineGeometry).path.count > 0;
  return geometry.kind !== "point" || (geometry as PointGeometry).count > 0;
}

function over(kit: HighlightKit, geometry: Geometry): Geometry[] {
  const DIM = kit.dim;
  const at = (a: number) => (a >= 1 ? 1 : ((1 - DIM) * a) / (1 - DIM * a));
  if (geometry.kind === "line") {
    const line = geometry as LineGeometry;
    // The line's alpha: its color's, at the opacity it is drawn at.
    const c = alphaOf(line.stroke) * (line.draw.opacity ?? 1);
    return [
      c >= 1 || c <= 0
        ? line
        : {
            ...line,
            draw: faded(line.draw as Drawing<Geometry>, at(c) / c) as LineGeometry["draw"],
          },
    ];
  }
  if (geometry.kind === "point") {
    // Markers: their fill and ring, each at its own alpha.
    const points = geometry as PointGeometry;
    const fill = alphaOf(points.fill);
    const ring = points.ring;
    const edge = ring && alphaOf(ring.color);
    return [
      {
        ...points,
        fillOpacity: fill > 0 ? at(points.fillOpacity * fill) / fill : points.fillOpacity,
        ...(ring &&
          edge! > 0 && { ring: { ...ring, opacity: at((ring.opacity ?? 1) * edge!) / edge! } }),
      } as PointGeometry,
    ];
  }
  if (geometry.kind !== "area") return [geometry];
  const area = geometry as AreaGeometry;
  if (outlined(area)) {
    // An outline of no fill (a style run's), at its own alpha, keeping where it is cut.
    // Dots of observations standing alone paint in the fill where there is no outline.
    const a = alphaOf(area.stroke ?? area.fill) * (area.strokeOpacity ?? 1);
    if (a >= 1 || a <= 0) return [area];
    return [{ ...area, strokeOpacity: ((area.strokeOpacity ?? 1) * at(a)) / a } as AreaGeometry];
  }
  const c = alphaOf(area.fill);
  // The outline, its isolated observations' dots too, drawn apart.
  const fill: AreaGeometry = {
    ...area,
    fillOpacity: c > 0 ? at(area.fillOpacity * c) / c : area.fillOpacity,
    stroke: null,
    ...(area.stroke && { strokeWidth: 0 }),
  };
  return area.stroke ? [fill, ...over(kit, outlineOf(area))] : [fill];
}

/**
 * Draws `model`'s scenes with the chart's selection of items or series
 * (`selection()`) in its marks' looks: what it holds as drawn (or in the
 * `selected` look), the other items and series of the same marks dimmed
 * (or in the `unselected` look); marks holding none of it draw as they
 * are. Layout marks dim the items whose rows it does not hold. Returns
 * what undoes it.
 */
export function selectionLooks(
  kit: HighlightKit,
  model: ChartModel,
  selection: () => ChartSelection | null,
  again: () => void,
): () => void {
  const highlighter = new Highlighter(kit, (mark) => chosenIn(model, mark, selection()));
  const draw: NonNullable<ChartModel["looks"]> = (mark, series, frame, key, rows) =>
    highlighter.geometry(mark, series, frame, key, rows) ?? mark.geometry(series, frame, key, rows);
  // A custom mark's own items and series; a layout mark's, of its table's marks.
  const layout = (table: Table, mark?: Mark, series?: Series) => {
    const chosen = selection();
    if (!chosen || chosen.kind === "brush") return undefined;
    if (!mark && chosen.kind === "items") {
      const laid = layoutRows(model, chosen.items as readonly string[], table, again);
      if (laid) return laid;
    }
    const marks = mark
      ? [mark]
      : (model.config.marks as readonly Mark[]).filter((m) => m.table === table);
    const held = marks.map((m) => chosenIn(model, m, chosen)?.(series).selected);
    return held.find((selected) => selected !== undefined);
  };
  model.looks = draw;
  model.layoutLooks = layout;
  return () => {
    if (model.looks === draw) model.looks = undefined;
    if (model.layoutLooks === layout) model.layoutLooks = undefined;
  };
}

/**
 * The rows of `table` layout items keyed `keys` stand for, as their marks'
 * layouts give them in every panel (a slice's rows, a node's subtree's);
 * undefined where no key is a layout item's. Rows a layout not drawn yet
 * holds are drawn `again`, on the next frame.
 */
function layoutRows(
  model: ChartModel,
  keys: readonly string[],
  table: Table,
  again: () => void,
): Uint8Array | undefined {
  let held: Uint8Array | undefined;
  for (const key of keys) {
    const found = model.items?.rowsOfItem(key, table);
    if (!found) continue;
    if (!found.whole) queueMicrotask(again);
    if (found.rows.length === 0) continue;
    held ??= new Uint8Array(table.length);
    for (const rows of found.rows) for (let i = 0; i < rows.length; i++) held[rows[i]!] = 1;
  }
  return held;
}

/** What each selection holds of each mark's series, kept while both live, as of a version of its table and view, and its key. */
const chosenRows = new WeakMap<
  ChartSelection,
  WeakMap<
    Mark,
    {
      version: number;
      generation: number;
      view: number | undefined;
      own: string | number;
      chosen: Chosen | undefined;
    }
  >
>();

/**
 * What the chart's items or series selection holds of `mark`'s series:
 * of items, the rows their keys name, in the series of their value field
 * for a mark drawing one per row; of series, every row of those it names
 * and none of the others. Undefined where it names nothing of the mark.
 */
function chosenIn(
  model: ChartModel,
  mark: Mark,
  selection: ChartSelection | null,
): Chosen | undefined {
  const table = mark.table;
  if (!table || !selection || selection.kind === "brush") return undefined;
  let byMark = chosenRows.get(selection);
  if (!byMark) {
    byMark = new WeakMap();
    chosenRows.set(selection, byMark);
  }
  const known = byMark.get(mark);
  const view = mark.view?.revision;
  const marks = model.config.marks as readonly Mark[];
  // The mark's key: its id, else its place, which an update can change.
  const own = mark.spec.id ?? marks.indexOf(mark);
  if (
    known?.version === table.version &&
    known.generation === table.generation &&
    known.view === view &&
    known.own === own
  )
    return known.chosen;
  const keys = (selection.kind === "items" ? selection.items : selection.series) as string[];
  // Each key's parts: its mark's first.
  const mine = keys.flatMap((key) => {
    try {
      const parts = JSON.parse(key) as unknown[];
      return parts[0] === own ? [{ key, source: parts[1] }] : [];
    } catch {
      return [];
    }
  });
  let chosen: Chosen | undefined;
  if (mine.length > 0) {
    // A series by its source, the second part of its key (see `seriesKey`); one of every row for a mark of one per row.
    const sourceOf = (s: Series | undefined) =>
      s && mark.wide ? (JSON.parse(s.key) as unknown[])[1] : undefined;
    const byKind = new Map<unknown, Uint8Array>();
    const rowsOf = (source: unknown): Uint8Array => {
      let selected = byKind.get(source);
      if (selected) return selected;
      selected = new Uint8Array(table.length);
      if (selection.kind === "items") {
        const resolver = itemResolver(marks.map((m, i) => ({ mark: m, key: m.spec.id ?? i })));
        for (const { key, source: from } of mine)
          if (source === undefined || from === source)
            for (const row of resolver.rowsOf(key, table)) selected[row] = 1;
      } else {
        const split = mark.identity?.field;
        const sources = new Set(mine.map(({ source }) => source));
        if (source !== undefined) selected.fill(sources.has(source) ? 1 : 0);
        else if (split === undefined) selected.fill(1);
        else {
          // The rows of each series named, by its value of the series field.
          const { codes, dictionary } = table.categories(split as never);
          const named = Uint8Array.from(dictionary, (label) => (sources.has(label) ? 1 : 0));
          for (let row = 0; row < selected.length; row++)
            selected[row] = codes[row]! < 0 ? 0 : named[codes[row]!]!;
        }
      }
      byKind.set(source, selected);
      return selected;
    };
    chosen = (s) => {
      // A series selection of a mark of several series holds whole series.
      const source =
        selection.kind === "series" && s && mark.identity?.field !== undefined
          ? (JSON.parse(s.key) as unknown[])[1]
          : sourceOf(s);
      return { selected: rowsOf(source), key: selection, version: -1 };
    };
  }
  byMark.set(mark, { version: table.version, generation: table.generation, view, own, chosen });
  return chosen;
}

/** Rasters' pixels in a look's fill, by the buffer of the pixels they cover. */
const fills = new WeakMap<ArrayBufferLike, Uint8ClampedArray<ArrayBuffer>>();

/**
 * A raster's pixels in `color` where they show, as the browser reads the
 * color (as they are without a canvas to read it): a copy, the raster's
 * own pixels left as they are.
 */
function filled(raster: RasterGeometry, color: string): Uint8ClampedArray<ArrayBuffer> {
  const { pixels } = raster;
  const context =
    typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1).getContext("2d");
  if (!context) return pixels;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data as unknown as number[];
  let out = fills.get(pixels.buffer);
  if (out?.length !== pixels.length) {
    out = new Uint8ClampedArray(pixels.length);
    fills.set(pixels.buffer, out);
  }
  for (let i = 0; i < pixels.length; i += 4) {
    out[i] = r!;
    out[i + 1] = g!;
    out[i + 2] = b!;
    out[i + 3] = (pixels[i + 3]! * a!) / 255;
  }
  return out;
}

/** How `mark` draws what a selection holds and what it does not: its looks, else dimmed and as drawn. */
function paintOf(kit: HighlightKit, mark: Mark, frame: Frame): Paint & { looked: boolean } {
  const { selected, unselected } = mark.spec as SelectionLooks;
  return {
    looked: !!(selected || unselected),
    dim: unselected ? (g) => [inLook(g, unselected, frame)] : (g) => dimLayer(kit, g),
    lit: selected ? (g) => inLook(g, selected, frame) : (g) => g,
  };
}

/**
 * A geometry in a look: the paint the look gives in place of its own
 * (colors read as the mark reads its own), the rest as drawn.
 */
function inLook(geometry: Geometry, look: Look, frame: Frame): Geometry {
  const color = (value: string | undefined, part: string) =>
    value === undefined ? undefined : frame.paint(value, `${geometry.kind} ${part}`);
  const { fill, stroke, strokeWidth, dash, opacity, radius } = look;
  const fillOpacity = look.fillOpacity ?? opacity;
  const strokeOpacity = look.strokeOpacity ?? opacity;
  const g = { ...geometry } as Geometry & Record<string, unknown>;
  const set = (name: string, value: unknown) => {
    if (value !== undefined) g[name] = value;
  };
  if (geometry.kind === "point") {
    set("fill", color(fill, "fill"));
    if (fill !== undefined) g.colors = undefined;
    set("fillOpacity", fillOpacity);
    if (fillOpacity !== undefined) g.opacities = undefined;
    // Overlaps paint once only where the look leaves the points opaque.
    if (fill !== undefined || fillOpacity !== undefined) {
      const p = g as unknown as PointGeometry;
      p.opaque =
        !p.opacities &&
        p.fillOpacity >= 1 &&
        (p.colors?.palette ?? [p.fill]).every((c) => alphaOf(c) >= 1);
    }
    set("radius", radius);
    if (radius !== undefined) g.radii = undefined;
    // An outline of its own, or the one a look's stroke gives (a pixel wide by default).
    const ring = (geometry as PointGeometry).ring;
    if (ring || stroke !== undefined)
      g.ring = {
        color: color(stroke, "stroke") ?? ring!.color,
        width: strokeWidth ?? ring?.width ?? 1,
        opacity: strokeOpacity ?? ring?.opacity,
      };
  } else if (geometry.kind === "rect") {
    set("fill", color(fill, "fill"));
    set("fillOpacity", fillOpacity);
    const edge = (geometry as RectGeometry).edge;
    if (edge || stroke !== undefined) {
      const width = strokeWidth ?? edge?.width ?? 1;
      g.edge = {
        ...edge,
        stroke: color(stroke, "stroke") ?? edge!.stroke,
        width,
        opacity: strokeOpacity ?? edge?.opacity ?? 1,
        // Named dashes in proportion to the width drawn.
        dash: dashPattern(dash, width) ?? edge?.dash,
      };
    }
  } else if (geometry.kind === "area") {
    set("fill", color(fill, "fill"));
    set("fillOpacity", fillOpacity);
    set("stroke", color(stroke, "stroke"));
    set("strokeWidth", strokeWidth);
    set("strokeOpacity", strokeOpacity);
  } else if (geometry.kind === "raster") {
    // An image of cells: in the fill where it shows, faded by the fill opacity.
    const paint = color(fill, "fill");
    if (paint !== undefined) g.pixels = filled(geometry as RasterGeometry, paint);
    if (fillOpacity !== undefined)
      (g as Record<string, unknown>).draw = faded(opaque(geometry.draw), fillOpacity);
  } else {
    set("stroke", color(stroke, "stroke"));
    set("strokeWidth", strokeWidth);
    set("dash", dashPattern(dash, (g as { strokeWidth?: number }).strokeWidth ?? 1));
    // A line is its stroke: its stroke opacity, in place of the series' own, is its drawing's.
    if (strokeOpacity !== undefined)
      (g as Record<string, unknown>).draw = faded(opaque(geometry.draw), strokeOpacity);
  }
  return copiedFrom(g, geometry);
}
