// Which of the targets near the pointer is read. Distances that should
// tie differ by rounding: points are placed in 32-bit floats, lines'
// observations in doubles, and points placed alike about the pointer
// round apart. So targets within `TIE` of the least distance found are at
// one distance: of those the one painted last is on top (`Nearest`), and
// along an axis the earliest is read (`earliest`). Searches hand every
// target within `limit` to them; `settle` and `earliest` run a search,
// and again where the first could not tell.

import type { Hit, Mark } from "../marks/mark.ts";
import { litOverSeries } from "../marks/mark.ts";

/** Pixels apart that distances to the pointer tie within. */
export const TIE = 1e-3;

/**
 * Of targets taken in paint order (marks, series in theirs, rows as
 * visited), the one on top of the nearest: later marks and series over
 * earlier ones; in a series, the order `over` says of two positions, or
 * the later row; highlighted rows over the others, of their series or
 * their mark's (`litOverSeries`). Ties are settled as targets come; where
 * a nearer target leaves the winner behind, targets passed over before it
 * may still tie, and `passed` says how near they were.
 */
export class Nearest {
  best: Hit | undefined;
  #mark: Mark | undefined;
  #lit = 0;
  /** The least distance of the targets taken, or of all of them when known. */
  least: number;
  /** The least distance of targets taken before the winner was last left behind. */
  passed = Infinity;

  constructor(least = Infinity) {
    this.least = least;
  }

  /** How far targets may be and still tie with the nearest. */
  get limit(): number {
    return this.least + TIE;
  }

  /** Takes `hit`, a target of `mark`: `lit` when its row is highlighted; `over`, the order its series' positions paint in. */
  take(hit: Hit, mark: Mark, lit = 0, over?: (a: number, b: number) => boolean): void {
    if (hit.distance > this.limit) return;
    const best = this.best;
    if (hit.distance < this.least) {
      if (best && best.distance > hit.distance + TIE) {
        this.passed = this.least;
        this.least = hit.distance;
        this.#win(hit, mark, lit);
        return;
      }
      this.least = hit.distance;
    }
    if (this.#over(hit, mark, lit, over)) this.#win(hit, mark, lit);
  }

  /** Whether `hit` paints over the winner: a later mark's, or as `take` says within one. */
  #over(hit: Hit, mark: Mark, lit: number, over?: (a: number, b: number) => boolean): boolean {
    const best = this.best;
    if (!best || mark !== this.#mark) return true;
    const same = hit.series === best.series;
    if (same && over) return over(hit.position, best.position);
    const ranked = lit !== this.#lit && (same || litOverSeries(mark));
    return ranked ? lit > this.#lit : !same || hit.position > best.position;
  }

  #win(hit: Hit, mark: Mark, lit: number): void {
    this.best = hit;
    this.#mark = mark;
    this.#lit = lit;
  }
}

/**
 * The target on top of the nearest that `search` hands its `Nearest`:
 * searched again, knowing the least distance, only where targets passed
 * over before the winner was left behind may tie with it.
 */
export function settle(search: (found: Nearest) => void): Hit | undefined {
  const found = new Nearest();
  search(found);
  if (found.passed > found.limit) return found.best;
  const settled = new Nearest(found.least);
  search(settled);
  return settled.best;
}

/**
 * Hands a position found along an axis to `earliest`: its distance from
 * the pointer on screen, and its value along the axis. Says whether it is
 * the winner so far. The winner is always the first taken at its value
 * (those after it there are as near), so a search can choose among those
 * itself (the keyboard does, by the distance across).
 */
export type TakeEarliest = (position: number, distance: number, value: number) => boolean;

/**
 * Of the positions `search` hands `take`, the one an inspection reads; -1
 * for none. The nearest on screen, those within `TIE` of the least
 * distance tied, and of ties the earliest (the least value along the
 * axis), the first taken of those at one value. Ties are settled as
 * positions come; `limit` says how far a position may be and still tie.
 * As `settle` does, the search runs again, knowing the least distance,
 * only where positions passed over before the winner was left behind may
 * tie with it.
 */
export function earliest(search: (take: TakeEarliest, limit: () => number) => void): number {
  let least = Infinity;
  const limit = () => least + TIE;
  for (let again = false; ; again = true) {
    // The winner, its distance, and its value.
    let best = -1;
    let passed = Infinity;
    let near = Infinity;
    let early = Infinity;
    search((position, distance, value) => {
      if (distance > least + TIE) return false;
      // A nearer one leaving the winner behind wins; else the earlier of ties.
      let wins = value < early;
      if (distance < least) {
        if (near > distance + TIE) {
          wins = true;
          passed = least;
        }
        least = distance;
      }
      if (wins) {
        best = position;
        near = distance;
        early = value;
      }
      return wins;
    }, limit);
    if (again || passed > least + TIE) return best;
  }
}
