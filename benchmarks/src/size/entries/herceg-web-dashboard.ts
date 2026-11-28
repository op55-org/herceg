import { observe } from "herceg/web";
import { LAYOUTS } from "../../../../packages/herceg/src/spec/families/layouts.ts";
import { MATRIX } from "../../../../packages/herceg/src/spec/families/matrix.ts";
import * as panels from "../../../../packages/herceg/src/spec/features/panels.ts";

// A page of a dashboard fragment, to its first frame: a line, a heatmap,
// and a pie in panels, so herceg/web with the families of matrix and
// layout marks and the code of panels, which it imports as the spec names them.
export const families = [MATRIX, LAYOUTS, panels];

export function render() {
  return observe();
}
