import { observe } from "herceg/web";
import { SHAPES } from "../../../../packages/herceg/src/spec/families/shapes.ts";

// A page of one fragment of segments, to its first frame: herceg/web and the
// family of custom shapes, which it imports as the spec names segments.
export const families = [SHAPES];

export function render() {
  return observe();
}
