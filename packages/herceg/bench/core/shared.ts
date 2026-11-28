// What the areas of the engine microbenchmarks share: the timing loop, a
// page-like text measurer, and data more than one area draws. Importing it
// allocates nothing; shared data is made when an area first asks for it.

import { canvasMeasurer, estimateText, type MeasureText } from "../../src/layout/text.ts";

/** Times `run`: `warmup` calls, then `samples` timed ones of `repeat` calls each; prints the median and median absolute deviation. */
export function measure(
  name: string,
  run: () => void,
  { warmup = 20, samples = 50, repeat = 1 } = {},
) {
  for (let i = 0; i < warmup; i++) run();
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    for (let r = 0; r < repeat; r++) run();
    times.push((performance.now() - start) / repeat);
  }
  times.sort((a, b) => a - b);
  const median = times[times.length >> 1]!;
  const deviations = times.map((t) => Math.abs(t - median)).sort((a, b) => a - b);
  const mad = deviations[deviations.length >> 1]!;
  const unit =
    median < 0.1
      ? `${(median * 1000).toFixed(2)} µs ± ${(mad * 1000).toFixed(2)}`
      : `${median.toFixed(3)} ms ± ${mad.toFixed(3)}`;
  console.log(`${name.padEnd(48)} ${unit}`);
}

/**
 * Text measured as a page's canvas measurer does, each string once per
 * font (here by the estimate, which costs far less than a canvas), so that
 * scenes and frames pay for what they measure anew.
 */
export function pageMeasurer(): MeasureText {
  return canvasMeasurer({
    font: "",
    measureText(text: string) {
      const width = estimateText(text, this.font);
      return {
        width,
        actualBoundingBoxAscent: 0,
        fontBoundingBoxAscent: 0,
        fontBoundingBoxDescent: 0,
      };
    },
  });
}

/** The size of the million-row cases. */
export const N = 1_000_000;

let points: { x: Float64Array; y: Float64Array } | undefined;

/**
 * A million timestamps a second apart and a wave with a little noise over
 * them, which lines, tables, stacks, and views draw. Made on first use and
 * kept for the rest of the run.
 */
export function millionPoints(): { x: Float64Array; y: Float64Array } {
  points ??= {
    x: Float64Array.from({ length: N }, (_, i) => 1_767_225_600_000 + i * 1000),
    y: Float64Array.from({ length: N }, (_, i) => Math.sin(i / 1000) * 100 + ((i * 7919) % 13)),
  };
  return points;
}

/** A seeded generator of numbers in [0, 1) (a linear congruential one), so every run draws the same data. */
export function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A comet from (sx, sy) to (ex, ey): a tail `w` pixels wide at its start, then a head 10 long. */
export const cometPath = (sx: number, sy: number, ex: number, ey: number, w: number) => {
  const length = Math.hypot(ex - sx, ey - sy) || 1;
  const [nx, ny] = [-(ey - sy) / length, (ex - sx) / length];
  const head = Math.min(10, length);
  const [bx, by] = [ex - ny * head, ey + nx * head];
  return `M${sx + (nx * w) / 2} ${sy + (ny * w) / 2}L${bx + nx / 2} ${by + ny / 2}L${bx - nx / 2} ${by - ny / 2}L${sx - (nx * w) / 2} ${sy - (ny * w) / 2}ZM${bx + nx * 4} ${by + ny * 4}L${ex} ${ey}L${bx - nx * 4} ${by - ny * 4}Z`;
};
