// Binary search over positions: of sorted series, and of how much of a text fits.

/**
 * The first of positions 0 to `length` for which `before` is false, it
 * being true for every position before that one and false from it on.
 */
export function bisect(length: number, before: (position: number) => boolean): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (before(mid)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
