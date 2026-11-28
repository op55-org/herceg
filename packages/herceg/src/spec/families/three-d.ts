// 3D: points, lines, and surfaces in a scene a camera views.

import { Line3DMark } from "../../marks/line3d.ts";
import { Point3DMark } from "../../marks/point3d.ts";
import { SurfaceMark } from "../../marks/surface.ts";
import { type AllMarks, withScheme } from "../load-with.ts";

export const THREE_D: Pick<AllMarks, "point3d" | "line3d" | "surface"> = {
  point3d: (spec, table) => new Point3DMark(withScheme(spec), table()),
  line3d: (spec, table) => new Line3DMark(spec, table()),
  surface: (spec, table) => new SurfaceMark(withScheme(spec), table()),
};
