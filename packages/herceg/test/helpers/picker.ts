// The chart code picking reads series with (see `PickKit`), for tests that
// pick without the interaction controller.

import type { PickQuery } from "../../src/marks/drawn.ts";
import { lookups } from "../../src/marks/lookups.ts";
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
