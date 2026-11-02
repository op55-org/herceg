// Gaps between tree items as canvases draw them (draw/tiles.ts, draw/rings.ts).

/**
 * A gap of `gap` CSS pixels on a canvas of `ratio` device pixels to one:
 * whole device pixels, at least one where there is a gap at all.
 */
export function deviceGap(gap: number, ratio: number): number {
  return gap > 0 ? Math.max(1, Math.round(gap * ratio)) : 0;
}
