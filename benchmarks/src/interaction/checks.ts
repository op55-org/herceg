// The pointer-interaction benchmark's checks that need no page (page.ts
// reads the page for them): where a column of attached labels stands, and
// what a histogram's bar shows, against what the fixture's data says.

/** A color: red, green, blue. */
export type RGB = readonly [number, number, number];

/**
 * A label of a column, as painted: what it is (for messages), its point
 * (its series' value at its end of the view), its height as the layout
 * keeps labels apart (a line and its halo), and where its middle stands,
 * in pixels down the page.
 */
export interface ColumnLabel {
  readonly name: string;
  readonly point: number;
  readonly height: number;
  readonly at: number;
}

/** How far, in pixels, a label's middle may stand from where it belongs: the painter's rounding. */
const PLACED = 0.5;

/**
 * Where the middles of a column of labels belong (in the labels' order),
 * as layout/attached.ts places labels that keep apart along y and all
 * meet along x: in the order of their points (ties in the labels' order),
 * each below the one before, within the plot's `top` and `bottom`, the sum
 * of squared moves least. With each top less the heights above it, the
 * tops must not decrease: pool-adjacent-violators solves that, and the
 * plot's bounds, the same for every label, clip the result.
 *
 * This is the engine's algorithm (layout/attached.ts `stack`) written
 * again, not a different one: the check runs it on inputs it derives
 * itself (the points, the painted heights, which labels share a column),
 * and checks.test.ts holds it to an exhaustive search over small columns.
 */
export function columnMiddles(
  labels: readonly Pick<ColumnLabel, "point" | "height">[],
  top: number,
  bottom: number,
): number[] {
  const order = labels.map((_, i) => i);
  order.sort((i, j) => labels[i]!.point - labels[j]!.point || i - j);
  const above: number[] = [];
  let total = 0;
  for (const i of order) {
    above.push(total);
    total += labels[i]!.height;
  }
  // Runs of labels moved as one: their first (in `order`), and the sum and count of their levels.
  const runs: { first: number; sum: number; count: number }[] = [];
  order.forEach((i, k) => {
    const { point, height } = labels[i]!;
    let run = { first: k, sum: point - height / 2 - above[k]!, count: 1 };
    for (
      let last = runs.at(-1);
      last && last.sum / last.count > run.sum / run.count;
      last = runs.at(-1)
    ) {
      runs.pop();
      run = { first: last.first, sum: last.sum + run.sum, count: last.count + run.count };
    }
    runs.push(run);
  });
  const middles = new Array<number>(labels.length);
  runs.forEach((run, r) => {
    const level = Math.min(Math.max(run.sum / run.count, top), bottom - total);
    const end = runs[r + 1]?.first ?? order.length;
    for (let k = run.first; k < end; k++)
      middles[order[k]!] = level + above[k]! + labels[order[k]!]!.height / 2;
  });
  return middles;
}

/** What is wrong with where a column of labels at the view's `side` stands, if anything (see `columnMiddles`). */
export function misplacedLabel(
  labels: readonly ColumnLabel[],
  top: number,
  bottom: number,
  side: "start" | "end",
): string | undefined {
  const total = labels.reduce((sum, { height }) => sum + height, 0);
  if (total > bottom - top)
    return `the labels at the view's ${side} are taller together than the plot, which leaves some out; this check does not model that`;
  const middles = columnMiddles(labels, top, bottom);
  for (const [i, label] of labels.entries())
    if (Math.abs(label.at - middles[i]!) > PLACED)
      return `${label.name} at the view's ${side} stands at ${label.at.toFixed(1)} px, not ${middles[i]!.toFixed(1)} (its point ${label.point.toFixed(1)})`;
}

/** A rectangle of a histogram's bar as drawn, in pixels: its sides, top, and bottom, and whether it is opaque (the brushed rows'). */
export interface BarPart {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly opaque: boolean;
}

/** How far, in pixels, a bar's sides may be from its bin's edges: the gap between bars and half-pixel snapping. */
const SIDE = 1;
/** How far, in pixels, a bar's ends and its parts' meeting edges may be from where they belong: the SVG's tenths of a pixel. */
const END = 0.6;
/** How far, in pixels, the end of a bar's opaque part may be from where its brushed rows put it. */
const SPLIT = 0.3;

/**
 * What is wrong with a bin's bar as drawn (`parts`), if anything, against
 * its `rows`, at least `low` and at most `high` of which the brush holds,
 * on the chart's scales: across, its bin's `edges`; down (`y`, rows to
 * pixels), from its rows to the scale's 0 without gaps or overlaps, faint
 * down to the brushed rows and opaque from there. A bar under a pixel
 * tall may be left out.
 */
export function barWrong(
  parts: readonly BarPart[],
  rows: number,
  low: number,
  high: number,
  edges: readonly [number, number],
  y: (rows: number) => number,
): string | undefined {
  const [base, top] = [y(0), y(rows)];
  if (parts.length === 0) return base - top < 1 ? undefined : `is not drawn (${rows} rows)`;
  const across = (a: number, b: number) => `${a.toFixed(1)} to ${b.toFixed(1)} px`;
  for (const part of parts)
    if (Math.abs(part.left - edges[0]) > SIDE || Math.abs(part.right - edges[1]) > SIDE)
      return `has a part across ${across(part.left, part.right)}, not ${across(...edges)}`;
  // Down the bar, each part from where the one above ends.
  const sorted = [...parts].sort((a, b) => a.top - b.top);
  if (Math.abs(sorted[0]!.top - top) > END)
    return `starts at ${sorted[0]!.top.toFixed(1)} px, not at ${top.toFixed(1)} (${rows} rows)`;
  let at = top;
  let split: number | undefined;
  for (const part of sorted) {
    if (part.top > at + END) return `has a gap from ${across(at, part.top)}`;
    if (part.top < at - END) return `has parts overlapping from ${across(part.top, at)}`;
    if (part.opaque) split ??= part.top;
    else if (split !== undefined) return "has faint parts below its opaque one";
    at = part.bottom;
  }
  if (Math.abs(at - base) > END)
    return `ends at ${at.toFixed(1)} px, not at its base, ${base.toFixed(1)}`;
  split ??= base;
  if (split < y(high) - SPLIT || split > y(low) + SPLIT)
    return `is opaque up to ${split.toFixed(1)} px, not between ${y(high).toFixed(1)} and ${y(low).toFixed(1)} (${low}-${high} of ${rows} rows brushed)`;
}

/** `color` painted at `opacity` over `under`, as the browser composites it. */
export function over(color: RGB, opacity: number, under: RGB): RGB {
  const mix = (i: number) => color[i]! * opacity + under[i]! * (1 - opacity);
  return [mix(0), mix(1), mix(2)];
}

/**
 * How far, in RGB units, a screen's color may be from the one it should
 * show: rounding, not another opacity (the bars' blue at 65% is 90 away
 * from them, their faint blue at 65% 23 away).
 */
const SHADE = 12;

/** Whether a screen's color `seen` is not `expected`, beyond rounding. */
export function shadeWrong(seen: RGB, expected: RGB): boolean {
  return Math.hypot(seen[0] - expected[0], seen[1] - expected[1], seen[2] - expected[2]) > SHADE;
}
