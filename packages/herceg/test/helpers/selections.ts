import type { BrushSelection, ChartSelection } from "../../src/spec/state.ts";

/** A selection when it is a brush's, which tests read the ranges of; null otherwise. */
export function brushOf(selection: ChartSelection | null | undefined): BrushSelection | null {
  return selection?.kind === "brush" ? selection : null;
}
