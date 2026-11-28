// How a heatmap spec's options go together, checked by the heatmap mark
// and by spec validation (spec/validate.ts) without loading the mark.

/**
 * Why a heatmap spec has neither or both of its forms (`x` and `y`, or a
 * `date` laid out as a calendar), or asks for the right axis (which specs
 * written by hand may), if it does.
 */
export function heatmapFormError(spec: Record<string, unknown>): string | undefined {
  if (spec.axis === "right")
    return "heatmap axis: heatmaps draw on the left y axis only; drop axis";
  if (spec.date === undefined) {
    for (const axis of ["x", "y"] as const) {
      const [one, low, high] = [spec[axis], spec[`${axis}1`], spec[`${axis}2`]];
      if (one !== undefined && (low !== undefined || high !== undefined))
        return `heatmap ${axis}1: ${axis} places cells at values, ${axis}1 and ${axis}2 between edges; give one form`;
      if ((low === undefined) !== (high === undefined))
        return `heatmap ${low === undefined ? `${axis}1` : `${axis}2`}: missing; cells between edges need ${axis}1 and ${axis}2`;
      if (one === undefined && low === undefined)
        return "heatmap: needs x and y (or x1 and x2, y1 and y2), or a date to lay out as a calendar";
      if (low !== undefined) {
        const option = [`${axis}Step`, `${axis}Banded`].find((name) => spec[name] !== undefined);
        if (option)
          return `heatmap ${option}: cells between ${axis}1 and ${axis}2 take their edges from them; drop ${option}`;
      }
    }
    if (spec.calendar !== undefined || spec.weekStart !== undefined)
      return "heatmap: calendar and weekStart are for heatmaps of a date; give date or drop them";
    return undefined;
  }
  const grid = GRID.find((name) => spec[name] !== undefined);
  if (grid) return `heatmap ${grid}: a calendar places its date itself; drop ${grid}`;
  if (spec.calendar === "months" && spec.weekStart !== undefined)
    return 'heatmap weekStart: for calendars of weeks; drop it or use calendar: "weeks"';
  return undefined;
}

/** What only heatmaps of cells at an x and a y take. */
const GRID = ["x", "y", "x1", "x2", "y1", "y2", "xStep", "yStep", "xBanded", "yBanded"] as const;
