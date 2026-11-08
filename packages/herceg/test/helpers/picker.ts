// The chart code picking reads series with (see `PickKit`), for tests that
// pick without the interaction controller.

import type { DrawnMark, PickQuery } from "../../src/marks/drawn.ts";
import { lookups } from "../../src/marks/lookups.ts";
import type { Mark } from "../../src/marks/mark.ts";
import { lowerPosition, placeAt, rowOf } from "../../src/marks/series.ts";
import type { ChartModel } from "../../src/model/model.ts";
import { Picker, type PickKit } from "../../src/model/pick.ts";

export const pickKit: PickKit = {
  rowOf,
  placeAt,
  lowerPosition,
};

/** `model`, picking as its controller would (`model.picker`), with `slop` pixels of reach. */
export function withPicker<M extends ChartModel>(model: M, slop = 4): M {
  const picker = new Picker(pickKit);
  model.picker = (x, y, accept) => picker.pick(model, { x, y, slop }, accept);
  return model;
}

/** What marks with lookups of their own pick through, as a picker hands it to them in queries. */
export const LOOKUPS: PickQuery["lookups"] = lookups(pickKit);

/**
 * What a mark's own lookup (`Mark.pickItem`) finds at a query: its
 * candidate, else the fill holding the query, else the fill beside it.
 */
export function lookedUp(mark: Mark, record: DrawnMark, query: PickQuery) {
  const found = mark.pickItem!(record, query);
  return found?.candidate ?? found?.fill ?? found?.beside;
}
