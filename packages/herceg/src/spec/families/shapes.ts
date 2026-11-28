// Custom shapes: segments, drawn by the custom-mark machinery (shapes of
// rows, their lookups and hit areas), which no other mark of a spec needs.

import { segmentMark } from "../../marks/segment.ts";
import type { AllMarks } from "../load-with.ts";

export const SHAPES: Pick<AllMarks, "segment"> = {
  segment: (spec, table, view) => segmentMark(spec, table(), view),
};
