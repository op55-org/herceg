// Maps: shapes and points of geographic coordinates, projected.

import { GeoPointMark } from "../../marks/geopoint.ts";
import { GeoShapeMark } from "../../marks/geoshape.ts";
import { type AllMarks, withScheme } from "../load-with.ts";

export const MAPS: Pick<AllMarks, "geoshape" | "geopoint"> = {
  geoshape: (spec, table) => new GeoShapeMark(withScheme(spec), table()),
  geopoint: (spec, table) => new GeoPointMark(withScheme(spec), table()),
};
