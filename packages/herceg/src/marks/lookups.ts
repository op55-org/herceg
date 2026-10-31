// How marks with lookups of their own pick their items (`Mark.pickItem`):
// candles, distributions (box plots, boxen, violins), heatmaps, 2D
// histograms, contours, error bars, and rugs. Their cells, boxes, and
// candles a lookup finds faster and more exactly than geometry by kind.
// The picker (model/pick.ts) loads this module and hands it to them in
// each query (`PickQuery.lookups`): charts that never pick never load it.
// What it reads of a mark's module that the chart already has is handed
// in by the mark (its `PickKit`s below), and what it reads series with by
// the picker (`LookupKit`), so that this chunk shares no module with the
// chart's.

import { groupKey, type KeyPart } from "../model/items.ts";
import type { PositionScale } from "../scale/scale.ts";
import type { RasterGeometry, Rect, RectGeometry } from "../scene/scene.ts";
import type { BoxenSpec, BoxPlotSpec, Clip, ViolinSpec } from "../spec/spec.ts";
import type { CandlePicking, CandlestickMark, Merged } from "./candlestick.ts";
import type { ContourMark, ContourPicking } from "./contour.ts";
import type { DistributionMark } from "./distribution.ts";
import type { DrawnMark, PickedItem, PickQuery } from "./drawn.ts";
import type { ErrorBarMark, ErrorBarPicking } from "./errorbar.ts";
import type { HeatmapMark, HeatmapPicking, ResolvedAxis } from "./heatmap.ts";
import type { AxisCells } from "./heatmap-cells.ts";
import type { Histogram2DMark } from "./histogram2d.ts";
import type { Frame, Hit, Mark } from "./mark.ts";
import type { RugMark } from "./rug.ts";
import type { placeAt, rowOf, Series } from "./series.ts";

/** What lookups read series with, handed in by the picker (see `PickKit`). */
export interface LookupKit {
  rowOf: typeof rowOf;
  placeAt: typeof placeAt;
}

/** How a mark's own lookup reads the point it found (see `pickedHit`). */
interface HitReading {
  /** Its drawn bounds, as the mark draws it; undefined where it is not drawn. */
  bounds(series: Series, position: number, frame: Frame): Readonly<Rect> | undefined;
  /** For aggregates: the parts and names of its group's key (see `groupKey`). */
  group?(
    series: Series,
    position: number,
  ): { parts: readonly KeyPart[]; names: readonly KeyPart[] } | undefined;
  /**
   * A lookup to use instead of `pick`, for marks whose `pick` finds
   * otherwise than picking does: reaching less far than `query.slop` or
   * measuring strokes' middles (contours), ranking ties apart from paint
   * order (error bars, rugs), choosing by span before shape (violins),
   * measuring what the mark's clip keeps.
   */
  lookup?:
    | ((series: readonly Series[], px: number, py: number, frame: Frame) => Hit | undefined)
    | undefined;
}

/** Each drawing's cover, read once: picking asks for it at every pointer move. */
const covers = new WeakMap<DrawnMark, Rect[] | undefined>();

/** The lookups of marks with their own, reading series with `kit`. */
export function lookups(kit: LookupKit) {
  const { rowOf, placeAt } = kit;

  /**
   * The item `mark` finds at `query` through its own lookup (`pick`): the
   * row of the point hit or, with `group`, the aggregate it is; its drawn
   * bounds; its distance as the lookup gives it, within `query.slop`.
   */
  function pickedHit(
    mark: Mark,
    drawn: DrawnMark,
    query: PickQuery,
    reading: HitReading,
  ): PickedItem | undefined {
    const { frame } = drawn;
    if (!frame || !mark.pick) return undefined;
    // What tooltips look among: series shown, with rows (the query's only, if it names one).
    const shown = drawn.series.filter(
      (s) => !frame.hidden.has(s.key) && s.length > 0 && (query.series ?? s.key) === s.key,
    );
    const hit = reading.lookup
      ? reading.lookup(shown, query.x, query.y, frame)
      : mark.pick(shown, query.x, query.y, frame);
    if (!hit) return undefined;
    const { series, position, distance } = hit;
    // Lookups find the nearest, however far; a pick reaches `slop` past a shape.
    if (!(distance <= query.slop)) return undefined;
    const box = reading.bounds(series, position, frame);
    if (!box) return undefined;
    if (reading.group) {
      const named = reading.group(series, position);
      if (!named) return undefined;
      const key = groupKey(drawn.mark, named.parts, named.names);
      return {
        part: { kind: "group", key, point: { series, position } },
        names: named.names,
        box,
        distance,
      };
    }
    const row = rowOf(series, position);
    if (!mark.table) return undefined;
    return {
      part: { kind: "row", table: mark.table, position: row, series: { series, position } },
      names: undefined,
      box,
      distance,
    };
  }

  return {
    /**
     * Candles are found as drawn: one by one, or merged a pixel column at
     * a time where more are in view than the plot has columns; ties go to
     * what is painted last. Each is bounded by its candle as drawn.
     */
    candlestick(
      mark: CandlestickMark,
      drawn: DrawnMark,
      query: PickQuery,
      candles: CandlePicking,
    ): PickedItem | undefined {
      // Read once a pick: counting the candles in view reads every one.
      const merged = new Map<Series, boolean>();
      const merges = (s: Series, frame: Frame) => {
        let merging = merged.get(s);
        if (merging === undefined) {
          const columns = Math.max(1, Math.ceil(frame.plot.width));
          merging = mark.inView(s.whole ?? s, frame, columns) > columns;
          merged.set(s, merging);
        }
        return merging;
      };
      return pickedHit(mark, drawn, query, {
        lookup: (series, px, py, frame) => {
          const lit = frame.highlighted?.(mark.table);
          // Paint order: a highlight's selected candles over the others, then later series.
          const order = (
            { series: s, position }: Hit,
            selected = lit?.[rowOf(s, position)] ?? 0,
          ) => [selected, series.indexOf(s)];
          const box = clipBox(mark.spec.clip, frame);
          let best = pickSingle(
            mark,
            candles,
            series.filter((s) => !merges(s, frame)),
            px,
            py,
            frame,
            box,
            lit,
            query.slop,
          );
          let bestOrder = best ? order(best) : [];
          for (const s of series) {
            const found =
              merges(s, frame) && pickMerged(mark, candles, s, px, py, frame, query.slop, lit, box);
            if (!found) continue;
            const at = order(found.hit, found.selected);
            const { distance } = found.hit;
            const nearest = best?.distance ?? Number.POSITIVE_INFINITY;
            if (distance < nearest || (distance === nearest && paintedLater(at, bestOrder)))
              [best, bestOrder] = [found.hit, at];
          }
          return best;
        },
        bounds: (s, position, frame) => {
          const { x, y } = frame;
          const row = rowOf(s, position);
          const at = s.x[row]!;
          const center = x.map(s.places?.x ? s.places.x.at(at) : at);
          if (merges(s, frame)) {
            const column = columnOf(center, frame);
            const lit = frame.highlighted?.(mark.table);
            const [found] = columnsOf(mark, candles, s, frame, column, column, lit);
            // A selected row is drawn in the selected rows' own candle.
            const part = lit?.[row] === 1 ? found?.selected : found;
            return (
              part &&
              cut(
                mergedBox(mark, column, mergedCandle(mark, s, part), frame),
                clipBox(mark.spec.clip, frame),
              )
            );
          }
          const candle = mark.candle;
          if (!candles.candleOf(mark.prices(), row, y.type === "log", candle)) return undefined;
          const box = mark.candleBox(center, mark.width(frame), candle, false, frame);
          return cut(box, clipBox(mark.spec.clip, frame));
        },
      });
    },

    /**
     * Contours' bands and lines are found by `pick`, named by their level's
     * value, and bounded by their region's outer ring or their line.
     */
    contour(
      mark: ContourMark,
      drawn: DrawnMark,
      query: PickQuery,
      { along, ringShown, inside }: ContourPicking,
    ): PickedItem | undefined {
      /**
       * The band region nearest a pixel within `reach` of what `clip` keeps
       * of it: the one holding the clip's point nearest the pixel, else the
       * one whose edge, cut to the clip, is nearest.
       */
      const nearestBand = (
        series: readonly Series[],
        px: number,
        py: number,
        frame: Frame,
        reach: number,
        clip: Readonly<Rect>,
      ): Hit | undefined => {
        const qx = Math.min(Math.max(px, clip.x), clip.x + clip.width);
        const qy = Math.min(Math.max(py, clip.y), clip.y + clip.height);
        const distance = Math.hypot(px - qx, py - qy);
        if (!(distance <= reach)) return undefined;
        // Outside the clip, the band shown at its edge: just inside it, so a
        // band that only meets the edge is not.
        const inward = (p: number, q: number, from: number, size: number) =>
          p === q
            ? q
            : q === from
              ? from + Math.min(inside, size / 2)
              : q - Math.min(inside, size / 2);
        const held = mark.find(
          series,
          inward(px, qx, clip.x, clip.width),
          inward(py, qy, clip.y, clip.height),
          frame,
          0,
        );
        // Only a region geometry draws (its ring in the view).
        const contours = held && mark.contours.get(held.series.values);
        const shown =
          held &&
          contours &&
          ringShown(contours, mark.viewBox(contours, frame))(
            contours.parts[held.position * 2]!,
            contours.parts[held.position * 2 + 1]!,
          );
        if (!shown) return mark.find(series, px, py, frame, reach, clip);
        // A later band's outline may be painted over the region there.
        const edge = mark.edgeWidth(frame) > 0 && mark.find(series, px, py, frame, distance, clip);
        const later = edge && series.indexOf(edge.series) > series.indexOf(held.series);
        return later ? edge : { ...held, distance };
      };
      return pickedHit(mark, drawn, query, {
        bounds: (s, position, frame) => {
          const { x, y } = frame;
          const contours = mark.contours.get(s.values);
          if (!contours) return undefined;
          const { boxes } = contours.sets[contours.parts[position * 2]!]!;
          const r = contours.parts[position * 2 + 1]! * 4;
          const { xs, ys } = contours.grid;
          // With half what their edges paint past them (so straight lines have an area).
          const grow = mark.edgeWidth(frame) / 2;
          const x0 = x.map(along(xs, boxes[r]!));
          const y0 = y.map(along(ys, boxes[r + 1]!));
          const x1 = x.map(along(xs, boxes[r + 2]!));
          const y1 = y.map(along(ys, boxes[r + 3]!));
          const ring = boxOf(
            Math.min(x0, x1) - grow,
            Math.min(y0, y1) - grow,
            Math.max(x0, x1) + grow,
            Math.max(y0, y1) + grow,
          );
          return cut(ring, clipBox(mark.spec.clip, frame));
        },
        group: (s, position) => ({ parts: [], names: [s.values[rowOf(s, position)]!] }),
        // What clipping keeps, as far as the query reaches: band regions,
        // and lines' strokes measured from their edges.
        lookup: (series, px, py, frame) => {
          const box = clipBox(mark.spec.clip, frame);
          if (mark.filled) return nearestBand(series, px, py, frame, query.slop, box);
          // Lines of no width paint nothing.
          return mark.stroke(frame) > 0
            ? mark.find(series, px, py, frame, query.slop, box)
            : undefined;
        },
      });
    },

    /**
     * Box plots', boxen plots', and violins' shapes are found as drawn, a
     * selection's over the whole's (`shapeDistance`); bounded by them, and
     * named by their category (and, with a series field, its group).
     */
    distribution(mark: Distribution, drawn: DrawnMark, query: PickQuery): PickedItem | undefined {
      return pickedHit(mark, drawn, query, {
        bounds: (s, position, frame) => {
          const row = rowOf(s, position);
          let bounds: Rect | undefined;
          for (const layer of mark.layers(s, frame)) {
            const extent = mark.extent(layer, row, frame, mark.placement(layer, frame));
            const box = extent && shapeBox(mark, extent, layer, row, frame);
            const kept = box && cut(box, clipBox(mark.spec.clip, frame));
            if (kept) bounds = bounds ? union(bounds, kept) : kept;
          }
          return bounds;
        },
        group: (s, position) => {
          const { table } = mark.summaryOf(s);
          const row = rowOf(s, position);
          const name = (field: string) => table.value(field as never, row) as string;
          return {
            parts: mark.spec.series === undefined ? [] : [name("group")],
            names: [name("category")],
          };
        },
        lookup: (series, px, py, frame) =>
          nearestShape(mark, series, px, py, frame, query.slop, clipBox(mark.spec.clip, frame)),
      });
    },

    /**
     * Error bars are found as `pick` finds them, measured to their painted
     * strokes, the one painted last of those as near; bounded by what the
     * mark's clip keeps of their stems and caps.
     */
    errorbar(
      mark: ErrorBarMark,
      drawn: DrawnMark,
      query: PickQuery,
      { columns }: ErrorBarPicking,
    ): PickedItem | undefined {
      const stroke = mark.spec.strokeWidth ?? 1.5;
      return pickedHit(mark, drawn, query, {
        lookup: (series, px, py, frame) => mark.find(series, px, py, frame, stroke, true),
        bounds: (s, position, frame) => {
          const { horizontal } = mark;
          const along = horizontal ? frame.y : frame.x;
          const across = horizontal ? frame.x : frame.y;
          const { positions, lows, highs } = columns(s, horizontal);
          const row = rowOf(s, position);
          const band = positions[row]!;
          const places = s.places?.[horizontal ? "y" : "x"];
          const p = along.map(places && band >= 0 ? places.at(band) : band) + mark.shift(s, along);
          const [a, b] = [across.map(lows[row]!), across.map(highs[row]!)];
          // What the clip keeps of the stem and caps the lookup measures.
          const box = clipBox(mark.spec.clip, frame);
          let bounds: Rect | undefined;
          for (const [u1, v1, u2, v2] of mark.pieces(p, a, b, stroke)) {
            const piece = cut(horizontal ? boxOf(v1, u1, v2, u2) : boxOf(u1, v1, u2, v2), box);
            if (piece) bounds = bounds ? union(bounds, piece) : piece;
          }
          return bounds;
        },
      });
    },

    /**
     * Heatmap cells are found under the pointer where their image draws
     * them, else the nearest within reach; named by their bands' values or
     * their edges, and bounded by what the image covers of them.
     */
    heatmap(
      mark: HeatmapMark,
      drawn: DrawnMark,
      query: PickQuery,
      { bandOf }: HeatmapPicking,
    ): PickedItem | undefined {
      const name = (s: Series, row: number, axis: "x" | "y", scale: PositionScale): KeyPart => {
        const { cells, ordinals } = mark.resolve(s, axis, scale);
        const at = ordinals[row]!;
        if (cells) return at >= 0 ? cells.values[at]! : null;
        const key = mark.bandKeys.get(s[axis])?.[at];
        if (key === undefined) return null;
        return key.startsWith("c:")
          ? key.slice(2)
          : key.startsWith("n:")
            ? Number(key.slice(2))
            : key;
      };
      // Along each axis: its band, or its cell's span.
      const span = (s: Series, row: number, axis: "x" | "y", scale: PositionScale) => {
        const resolved = mark.resolve(s, axis, scale);
        if (resolved.cells) return mark.edges(resolved, scale, resolved.ordinals[row]!);
        const center = scale.map(placeAt(s, axis, row));
        const half = Math.abs(scale.bandwidth ?? 0) / 2;
        return [center - half, center + half] as const;
      };
      const cell = (s: Series, position: number, frame: Frame) => {
        const row = rowOf(s, position);
        const [x0, x1] = span(s, row, "x", frame.x);
        const [y0, y1] = span(s, row, "y", frame.y);
        return boxOf(x0, y0, x1, y1);
      };
      /** The bands or cells along an axis within `reach` of a pixel. */
      const cellsNear = (
        axis: ResolvedAxis,
        scale: PositionScale,
        pixel: number,
        reach: number,
      ): { from: number; to: number; only?: Set<number> } | undefined => {
        // Half a pixel more, so cells at the reach's very end are not lost to rounding.
        const [a, b] = [scale.invert(pixel - reach - 0.5), scale.invert(pixel + reach + 0.5)];
        if (axis.cells) {
          const [from, to] = axis.cells.reaching(Math.min(a, b), Math.max(a, b));
          return from <= to ? { from, to } : undefined;
        }
        const count = scale.categories?.length ?? 0;
        const only = new Set<number>();
        const [from, to] = [Math.round(Math.min(a, b)), Math.round(Math.max(a, b))];
        for (let place = Math.max(0, from); place <= Math.min(count - 1, to); place++) {
          const band = bandOf(axis.places, place);
          if (band >= 0) only.add(band);
        }
        if (only.size === 0) return undefined;
        return { from: Math.min(...only), to: Math.max(...only), only };
      };
      // What its image covers, cut as it is drawn.
      const cover = drawn.frame && cellsCover(drawn, mark.spec.clip);
      if (!cover) return undefined;
      return pickedHit(mark, drawn, query, {
        lookup: (series, px, py, frame) => {
          const s = series[0];
          if (!s) return undefined;
          const near = coverNear(cover, px, py, query.slop);
          // The cell under it, where some of it is drawn there (not only its
          // edge, a neighbor's), before those around it.
          const under = mark.pick(series, px, py, frame);
          if (under && distanceToCover(cell(s, under.position, frame), near, px, py) === 0)
            return under;
          const across = mark.resolve(s, "x", frame.x);
          const down = mark.resolve(s, "y", frame.y);
          const columns = cellsNear(across, frame.x, px, query.slop);
          const lines = cellsNear(down, frame.y, py, query.slop);
          if (!columns || !lines) return undefined;
          let best: Hit | undefined;
          mark
            .cellsOf(s, across, down)
            .index.forEachIn(columns.from, columns.to, lines.from, lines.to, (c, r, position) => {
              if (columns.only?.has(c) === false || lines.only?.has(r) === false) return;
              const [x0, x1] = mark.edges(across, frame.x, c);
              const [y0, y1] = mark.edges(down, frame.y, r);
              const distance = distanceToCover(boxOf(x0, y0, x1, y1), near, px, py);
              if (distance < (best?.distance ?? Number.POSITIVE_INFINITY))
                best = { series: s, position, distance };
            });
          return best;
        },
        bounds: (s, position, frame) => coverOf(cell(s, position, frame), cover),
        group: (s, position) => {
          const row = rowOf(s, position);
          const { frame } = drawn;
          return {
            parts: [],
            names: [name(s, row, "x", frame!.x), name(s, row, "y", frame!.y)],
          };
        },
      });
    },

    /**
     * 2D histograms' cells are found under the pointer where their image
     * draws them, else the nearest within reach; named and bounded by their
     * bins along x and y.
     */
    histogram2d(mark: Histogram2DMark, drawn: DrawnMark, query: PickQuery): PickedItem | undefined {
      const bins = (s: Series, position: number) => {
        const cells = mark.cellsOf(s);
        if (!cells) return undefined;
        const [c, r] = [cells.columns[position]!, cells.rows[position]!];
        return [
          [cells.xEdges[c]!, cells.xEdges[c + 1]!],
          [cells.yEdges[r]!, cells.yEdges[r + 1]!],
        ] as const;
      };
      const cell = (s: Series, position: number, frame: Frame) => {
        const [x, y] = bins(s, position) ?? [];
        return x && y
          ? boxOf(frame.x.map(x[0]), frame.y.map(y[0]), frame.x.map(x[1]), frame.y.map(y[1]))
          : undefined;
      };
      // What its image covers, cut as it is drawn.
      const cover = drawn.frame && cellsCover(drawn, mark.spec.clip);
      if (!cover) return undefined;
      return pickedHit(mark, drawn, query, {
        lookup: (series, px, py, frame) => {
          const s = series[0];
          const cells = s && mark.cellsOf(s);
          if (!cells) return undefined;
          const near = coverNear(cover, px, py, query.slop);
          // The cell under it, where some of it is drawn there (not only its
          // edge, a neighbor's), before those around it.
          const under = mark.pick(series, px, py, frame);
          const drawnCell = under && cell(s, under.position, frame);
          if (drawnCell && distanceToCover(drawnCell, near, px, py) === 0) return under;
          const reaching = (axis: AxisCells, scale: PositionScale, pixel: number) => {
            // Half a pixel more, so cells at the reach's very end are not lost to rounding.
            const [a, b] = [
              scale.invert(pixel - query.slop - 0.5),
              scale.invert(pixel + query.slop + 0.5),
            ];
            return axis.reaching(Math.min(a, b), Math.max(a, b));
          };
          const [c0, c1] = reaching(cells.xCells, frame.x, px);
          const [r0, r1] = reaching(cells.yCells, frame.y, py);
          let best: Hit | undefined;
          cells.index.forEachIn(c0, c1, r0, r1, (c, r, position) => {
            const box = boxOf(
              frame.x.map(cells.xEdges[c]!),
              frame.y.map(cells.yEdges[r]!),
              frame.x.map(cells.xEdges[c + 1]!),
              frame.y.map(cells.yEdges[r + 1]!),
            );
            const distance = distanceToCover(box, near, px, py);
            if (distance < (best?.distance ?? Number.POSITIVE_INFINITY))
              best = { series: s, position, distance };
          });
          return best;
        },
        bounds: (s, position, frame) => {
          const drawnCell = cell(s, position, frame);
          return drawnCell && coverOf(drawnCell, cover);
        },
        group: (s, position) => {
          const [x, y] = bins(s, position) ?? [];
          return x && y && { parts: [], names: [x, y] };
        },
      });
    },

    /**
     * Rugs' ticks are found as `pick` finds them, measured to their painted
     * strokes, the one painted last of those as near; each a line from the
     * plot's edge.
     */
    rug(mark: RugMark, drawn: DrawnMark, query: PickQuery): PickedItem | undefined {
      const stroke = mark.spec.strokeWidth ?? 1;
      return pickedHit(mark, drawn, query, {
        lookup: (series, px, py, frame) => mark.find(series, px, py, frame, stroke, true),
        bounds: (s, position, frame) => {
          const row = rowOf(s, position);
          if (!mark.place(s, row, frame)) return undefined;
          const at = frame[mark.tooltip].map(s.values[row]!);
          const [edge, end] = mark.edge(frame);
          const half = stroke / 2;
          const tick =
            mark.tooltip === "x"
              ? boxOf(at - half, edge, at + half, end)
              : boxOf(edge, at - half, end, at + half);
          return cut(tick, clipBox(mark.spec.clip, frame));
        },
      });
    },
  };

  /**
   * Candles drawn one by one, nearest a pixel within `reach` of what `box`
   * keeps of them; of those as near, the one painted last.
   */
  function pickSingle(
    mark: CandlestickMark,
    { candleOf, visibleRange }: CandlePicking,
    series: readonly Series[],
    px: number,
    py: number,
    frame: Frame,
    box: Readonly<Rect>,
    lit: Uint8Array | undefined,
    reach: number,
  ): Hit | undefined {
    const { x, y, plot } = frame;
    const prices = mark.prices();
    const log = y.type === "log";
    const candle = mark.candle;
    const width = mark.width(frame);
    const half = width / 2;
    // How far a candle's center can be from a pixel its box (wick and strokes too) reaches.
    const far = reach + half + 2;
    const { categorical } = mark;
    let best: Hit | undefined;
    let bestAt: number[] = [];
    series.forEach((s, i) => {
      const places = s.places?.x;
      // Those geometry draws (the view's, and a neighbor beside it each side)...
      let [start, end] = categorical ? [0, s.length] : visibleRange(s, x.domain[0], x.domain[1]);
      // ...where the scale alone places x, centered near the pixel.
      if (!categorical && !places && !x.breaks) {
        const [from, to] = visibleRange(s, x.invert(px - far), x.invert(px + far));
        [start, end] = [Math.max(start, from), Math.min(end, to)];
      }
      for (let k = start; k < end; k++) {
        const row = rowOf(s, k);
        const at = s.x[row]!;
        if ((categorical && at < 0) || x.breaks?.hides(at)) continue;
        const center = x.map(places ? places.at(at) : at);
        if (!(center >= plot.x - half && center <= plot.x + plot.width + half)) continue;
        if (!candleOf(prices, row, log, candle)) continue;
        const shown = mark.candleBox(center, width, candle, false, frame);
        const distance = distanceToCut(shown, box, px, py);
        const order = [lit?.[row] ?? 0, i, batch(mark, candle, center, width, px, py, y), k];
        const nearest = best?.distance ?? Number.POSITIVE_INFINITY;
        if (distance < nearest || (distance === nearest && paintedLater(order, bestAt)))
          [best, bestAt] = [{ series: s, position: k, distance }, order];
      }
    });
    return best;
  }

  /**
   * Of a series whose candles merge into pixel columns: the column's candle
   * nearest a pixel within `reach`, and its candle whose range of prices is
   * nearest the pixel; of those as near, the one painted last.
   */
  function pickMerged(
    mark: CandlestickMark,
    candles: CandlePicking,
    s: Series,
    px: number,
    py: number,
    frame: Frame,
    reach: number,
    lit: Uint8Array | undefined,
    clip: Readonly<Rect>,
  ): { hit: Hit; selected: number } | undefined {
    const { plot, y } = frame;
    const log = y.type === "log";
    const prices = mark.prices();
    const candle = mark.candle;
    let best: { hit: Hit; selected: number } | undefined;
    // Paint order: a highlight's selected rows' candles over the columns', falling over rising, then by column.
    let bestAt: number[] = [];
    const from = Math.max(0, Math.floor(px - plot.x - reach - 1));
    const to = Math.min(Math.ceil(plot.width) - 1, Math.floor(px - plot.x + reach + 1));
    const near = columnsOf(mark, candles, s, frame, from, to, lit);
    for (let column = from; column <= to; column++) {
      const merged = near[column - from];
      for (const selected of lit ? [0, 1] : [0]) {
        const part = selected ? merged?.selected : merged;
        if (!part) continue;
        const shown = mergedCandle(mark, s, part);
        const distance = distanceToCut(mergedBox(mark, column, shown, frame), clip, px, py);
        if (distance === Number.POSITIVE_INFINITY) continue;
        const [center, width] = mark.column(column, frame);
        const at = [selected, batch(mark, shown, center, width, px, py, y), column];
        if (
          best &&
          (distance > best.hit.distance ||
            (distance === best.hit.distance && !paintedLater(at, bestAt)))
        )
          continue;
        // Its candle whose range of prices is nearest the pointer.
        let position = -1;
        let gap = Number.POSITIVE_INFINITY;
        for (const k of part.positions) {
          const row = rowOf(s, k);
          if ((lit?.[row] ?? 0) !== selected || !candles.candleOf(prices, row, log, candle))
            continue;
          const [high, low] = [y.map(candle[1]!), y.map(candle[2]!)];
          const off = Math.max(0, Math.min(high, low) - py, py - Math.max(high, low));
          if (off <= gap) [position, gap] = [k, off];
        }
        if (position >= 0)
          [best, bestAt] = [{ hit: { series: s, position, distance }, selected }, at];
      }
    }
    return best;
  }

  /**
   * The candles of `s` merged in each pixel column from `from` to `to`
   * (and with a highlight, its selected rows' own), as geometry merges them.
   */
  function columnsOf(
    mark: CandlestickMark,
    { candleOf, visibleRange }: CandlePicking,
    s: Series,
    frame: Frame,
    from: number,
    to: number,
    lit?: Uint8Array,
  ): ((Merged & { selected?: Merged }) | undefined)[] {
    const { x, plot } = frame;
    const prices = mark.prices();
    const log = frame.y.type === "log";
    const candle = mark.candle;
    const places = s.places?.x;
    const { categorical } = mark;
    const [a, b] = [x.invert(plot.x + from), x.invert(plot.x + to + 1)];
    const [start, end] =
      categorical || !s.sorted ? [0, s.length] : visibleRange(s, Math.min(a, b), Math.max(a, b));
    const out: ((Merged & { selected?: Merged }) | undefined)[] = [];
    for (let k = start; k < end; k++) {
      const row = rowOf(s, k);
      const at = s.x[row]!;
      if ((categorical && at < 0) || x.breaks?.hides(at)) continue;
      const center = x.map(places ? places.at(at) : at);
      if (!(center >= plot.x && center <= plot.x + plot.width)) continue;
      const column = columnOf(center, frame);
      if (column < from || column > to || !candleOf(prices, row, log, candle)) continue;
      out[column - from] ??= { positions: [], low: Infinity, high: -Infinity };
      const merged = out[column - from]!;
      const parts = [merged];
      if (lit?.[row] === 1) {
        merged.selected ??= { positions: [], low: Infinity, high: -Infinity };
        parts.push(merged.selected);
      }
      for (const part of parts) {
        part.positions.push(k);
        part.low = Math.min(part.low, candle[2]!);
        part.high = Math.max(part.high, candle[1]!);
      }
    }
    return out;
  }

  /** A merged candle's prices: its first open, highest high, lowest low, and last close. */
  function mergedCandle(
    mark: CandlestickMark,
    s: Series,
    { positions, low, high }: Merged,
  ): number[] {
    let [first, last] = [rowOf(s, positions[0]!), rowOf(s, positions[0]!)];
    for (const k of positions) {
      const row = rowOf(s, k);
      if (s.x[row]! < s.x[first]!) first = row;
      if (s.x[row]! >= s.x[last]!) last = row;
    }
    const prices = mark.prices();
    return [prices.open[first]!, high, low, prices.close[last]!];
  }

  function mergedBox(
    mark: CandlestickMark,
    column: number,
    candle: readonly number[],
    frame: Frame,
  ) {
    const [center, width] = mark.column(column, frame);
    return mark.candleBox(center, width, candle, true, frame);
  }

  /** The pixel column a candle's center is in. */
  function columnOf(center: number, { plot }: Frame): number {
    return Math.min(Math.ceil(plot.width) - 1, Math.floor(center - plot.x));
  }

  /**
   * The batch a candle is painted in, as geometry paints them: rising,
   * then falling (or every OHLC bar), then a body under the pointer.
   */
  function batch(
    mark: CandlestickMark,
    candle: ArrayLike<number>,
    center: number,
    width: number,
    px: number,
    py: number,
    y: PositionScale,
  ): number {
    if (candle[3]! >= candle[0]!) return 0;
    if (mark.spec.variant === "ohlc") return 1;
    const [open, close] = [y.map(candle[0]!), y.map(candle[3]!)];
    const top = Math.min(open, close);
    // A body at least a pixel tall, down from its top.
    const body =
      Math.abs(px - center) <= width / 2 &&
      py >= top &&
      py <= top + Math.max(1, Math.abs(close - open));
    return body ? 2 : 1;
  }

  /**
   * The distribution shape nearest a pixel, within `reach` of what `clip`
   * keeps of it (`shapeDistance` measures a shape of its own); of shapes as
   * near, the one painted last.
   */
  function nearestShape(
    mark: Distribution,
    series: readonly Series[],
    px: number,
    py: number,
    frame: Frame,
    reach: number,
    clip: Readonly<Rect>,
  ): Hit | undefined {
    let best: Hit | undefined;
    // Its paint order: a highlight's selected layer, series index, position.
    let bestAt: number[] = [];
    const measure = mark.shapeDistance?.bind(mark);
    series.forEach((s, i) => {
      const layers = mark.layers(s, frame);
      const placements = layers.map((layer) => mark.placement(layer, frame));
      for (let k = 0; k < s.length; k++) {
        const row = rowOf(s, k);
        let distance = Number.POSITIVE_INFINITY;
        let layer = 0;
        for (let l = 0; l < layers.length; l++) {
          const extent = mark.extent(layers[l]!, row, frame, placements[l]!);
          const box = extent && shapeBox(mark, extent, layers[l]!, row, frame);
          if (!box) continue;
          const shown = distanceToCut(box, clip, px, py);
          // Dots reach a few pixels past.
          if (!(shown <= reach + 4)) continue;
          const d = measure ? measure(layers[l]!, row, px, py, frame, clip) : shown;
          // The selection's shape is painted over the whole's.
          if (d < distance || (l > 0 && d === distance)) [distance, layer] = [d, l];
        }
        if (distance === Number.POSITIVE_INFINITY) continue;
        // ...and over every series' whole.
        const order = [layer, i, k];
        const nearest = best?.distance ?? Number.POSITIVE_INFINITY;
        if (distance < nearest || (distance === nearest && paintedLater(order, bestAt)))
          [best, bestAt] = [{ series: s, position: k, distance }, order];
      }
    });
    return best;
  }
}

/** Box plots, boxen plots, and violins. */
type Distribution = DistributionMark<BoxPlotSpec | BoxenSpec | ViolinSpec, unknown>;

/** Lookups of marks with their own, as the picker hands them in (`PickQuery.lookups`). */
export type Lookups = ReturnType<typeof lookups>;

/**
 * The box a distribution's shape takes, from its extent (see
 * `DistributionMark.extent`), with what is painted past it (whiskers'
 * caps, outliers, dots); undefined where it has none.
 */
function shapeBox(
  mark: Distribution,
  [center, half, low, high]: readonly [number, number, number, number],
  s: Series,
  row: number,
  frame: Frame,
): Rect | undefined {
  if (!(low <= high)) return undefined;
  const across = mark.horizontal ? frame.x : frame.y;
  let [below, above, least] = mark.paintedPast(s, row, frame);
  // Pixels run against values on reversed axes (y, as usual).
  if ((across.range[1] - across.range[0]) * (across.domain[1] - across.domain[0]) < 0)
    [below, above] = [above, below];
  // Dots and inner boxes on its center keep their width in narrow slots.
  const wide = Math.max(half + 1, least);
  let [from, to] = [low - below, high + above];
  const dot = mark.paintedDot?.(s, row, frame);
  if (dot) [from, to] = [Math.min(from, dot[0] - dot[1]), Math.max(to, dot[0] + dot[1])];
  return mark.horizontal
    ? boxOf(from, center - wide, to, center + wide)
    : boxOf(center - wide, from, center + wide, to);
}

/** The box around two boxes. */
function union(a: Readonly<Rect>, b: Readonly<Rect>): Rect {
  return boxOf(
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.x + a.width, b.x + b.width),
    Math.max(a.y + a.height, b.y + b.height),
  );
}

/**
 * What a cell mark's drawing covers: the rasters it drew (the cells the
 * plot shows) and rectangles (a highlight's cells) outside them, each cut
 * to its clip box; undefined where it drew none, or nothing of them shows.
 */
function cellsCover(drawn: DrawnMark, clip: Clip | undefined): Rect[] | undefined {
  if (covers.has(drawn)) return covers.get(drawn);
  const box = clipBox(clip, drawn.frame!);
  const rasters: Rect[] = [];
  const cells: Rect[] = [];
  for (const g of drawn.geometry) {
    if (g.kind !== "raster") continue;
    const { x, y, width, height } = g as RasterGeometry;
    const kept = cut({ x, y, width, height }, box);
    if (kept) rasters.push(kept);
  }
  const within = (r: Rect, image: Rect) =>
    r.x >= image.x &&
    r.y >= image.y &&
    r.x + r.width <= image.x + image.width &&
    r.y + r.height <= image.y + image.height;
  for (const g of drawn.geometry) {
    if (g.kind !== "rect") continue;
    const { rects, count } = g as RectGeometry;
    for (let i = 0; i < count * 4; i += 4) {
      const r = { x: rects[i]!, y: rects[i + 1]!, width: rects[i + 2]!, height: rects[i + 3]! };
      const kept = cut(r, box);
      // A highlight's cells drawn over the image add nothing to what it covers.
      if (kept && !rasters.some((image) => within(kept, image))) cells.push(kept);
    }
  }
  const cover = rasters.length + cells.length > 0 ? [...rasters, ...cells] : undefined;
  covers.set(drawn, cover);
  return cover;
}

/**
 * Of a drawing's cover, the rectangles within `reach` of a pixel, which
 * alone can hold what is drawn of a cell there: a highlight draws one
 * rectangle per cell.
 */
function coverNear(cover: readonly Rect[], px: number, py: number, reach: number): Rect[] {
  return cover.filter((r) => distanceToCut(r, r, px, py) <= reach);
}

/** How far a pixel is from what `cover` holds of `rect`: infinite for nothing. */
function distanceToCover(
  rect: Readonly<Rect>,
  cover: readonly Rect[],
  px: number,
  py: number,
): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const r of cover) distance = Math.min(distance, distanceToCut(rect, r, px, py));
  return distance;
}

/** What `cover` holds of `rect`, bounded: undefined for nothing. */
function coverOf(rect: Readonly<Rect>, cover: readonly Rect[]): Rect | undefined {
  let bounds: Rect | undefined;
  for (const r of cover) {
    const kept = cut(rect, r);
    if (kept) bounds = bounds ? union(bounds, kept) : kept;
  }
  return bounds;
}

// Box geometry as marks/shapes.ts measures it: copies, so that this chunk
// shares no module with the chart (see the top); a module both import
// would load with the chart, the picking-only parts of it too.

/** The box with corners at two points, in either order. */
export function boxOf(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

/** What a mark's drawing is cut to: the chart with a `clip` of "chart" or false, else the plot. */
export function clipBox(clip: Clip | undefined, frame: Frame): Readonly<Rect> {
  return clip === "chart" || clip === false ? (frame.chart ?? frame.plot) : frame.plot;
}

/** Whether a point is in a box, edges included. */
export function inside(box: Readonly<Rect>, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

/** The part of `rect` inside `box`; undefined where none of it is (or only an edge). */
export function cut(rect: Readonly<Rect>, box: Readonly<Rect>): Rect | undefined {
  const x0 = Math.max(rect.x, box.x);
  const y0 = Math.max(rect.y, box.y);
  const x1 = Math.min(rect.x + rect.width, box.x + box.width);
  const y1 = Math.min(rect.y + rect.height, box.y + box.height);
  return x0 < x1 && y0 < y1 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : undefined;
}

/** How far a point is from the part of `rect` inside `box`; Infinity where none is. */
export function distanceToCut(
  rect: Readonly<Rect>,
  box: Readonly<Rect>,
  x: number,
  y: number,
): number {
  const kept = cut(rect, box);
  if (!kept) return Number.POSITIVE_INFINITY;
  return Math.hypot(
    Math.max(0, kept.x - x, x - kept.x - kept.width),
    Math.max(0, kept.y - y, y - kept.y - kept.height),
  );
}

/** How far a point is from the segment between two others. */
export function distanceToSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const squared = dx * dx + dy * dy;
  const t = squared > 0 ? Math.min(1, Math.max(0, ((px - x0) * dx + (py - y0) * dy) / squared)) : 0;
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/**
 * Whether paint order `a` comes after `b`, each a list compared in turn
 * (a highlight's selected rows over the others, then series, then position).
 */
export function paintedLater(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}
