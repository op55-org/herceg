// The keyboard cursor's stops and steps as the chart's interaction
// controller finds them (model/keyboard.ts), for tests of what charts draw.

import { placeAt, rowOf, samePositions } from "../../src/marks/series.ts";
import {
  cursorAxis,
  inspectPosition,
  keyboardStops,
  stepCell,
  stepPoint,
} from "../../src/model/keyboard.ts";
import type { ChartModel } from "../../src/model/model.ts";

/** The series of panel `panel` the keyboard stops at. */
export function stopsOf(model: ChartModel, panel: string) {
  return keyboardStops(model.inspectorOf(panel), samePositions);
}

/** The cell the keyboard steps to from `position` in panel `panel`'s series keyed `key`. */
export function cellOf(
  model: ChartModel,
  panel: string,
  key: string,
  position: number,
  columns: number,
  rows: number,
) {
  return stepCell(model.inspectorOf(panel), key, position, columns, rows);
}

/** The axis the chart's cursor follows. */
export function axisOf(model: ChartModel) {
  return cursorAxis(model.panels().map(({ key }) => model.inspectorOf(key)));
}

/** The keyboard cursor's inspection at `position` of the series keyed `key`, in `panel` (the first by default). */
export function positionOf(model: ChartModel, key: string, position: number, panel?: string) {
  return inspectPosition(model, key, position, panel, { placeAt, rowOf });
}

/**
 * What the arrow keys read pressed in turn from a stop (the first by
 * default) of panel `panel`: the inspections' headings and points, as
 * "heading. series: text" (cells step as `cellOf` says).
 */
export function readKeys(model: ChartModel, keys: readonly string[], panel = "", stop = 0) {
  let series = stopsOf(model, panel)[stop]!;
  let position = -1;
  const inspector = model.inspectorOf(panel)!;
  const cells = model.markOf(series)?.stepCell !== undefined;
  return keys.map((key) => {
    if (cells)
      position =
        cellOf(model, panel, series.key, position, key === "ArrowRight" ? 1 : -1, 0) ?? position;
    else ({ series, position } = stepPoint(inspector, series, position, key, { placeAt, rowOf }));
    const read = positionOf(model, series.key, position, panel || undefined)!;
    return [read.label, ...read.points.map((p) => `${p.label}: ${p.text}`)].join(". ");
  });
}
