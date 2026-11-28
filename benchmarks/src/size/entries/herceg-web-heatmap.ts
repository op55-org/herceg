import { observe } from "herceg/web";
import { MATRIX } from "../../../../packages/herceg/src/spec/families/matrix.ts";

// A page of one heatmap fragment, to its first frame: herceg/web and the
// family of matrix marks, which it imports as the heatmap's spec names it.
export const families = [MATRIX];

export function render() {
  return observe();
}
