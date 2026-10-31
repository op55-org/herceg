// Boxes along one axis moved apart as little as possible: each box's top
// as near its wanted place as can be (the least sum of squared moves),
// below every earlier box it must clear, and within two bounds. Solved
// exactly, after Dwyer, Marriott, and Stuckey's VPSC ("Fast Node Overlap
// Removal", Graph Drawing 2005) in its incremental form: boxes that
// binding constraints hold together move as a block, to the mean of their
// wanted places; blocks merge where a constraint between them is broken,
// and a block splits where a binding constraint's multiplier is negative
// (it holds its boxes together rather than apart). It stops where no
// constraint is broken and none holds the wrong way, which is the least
// sum (its Karush–Kuhn–Tucker conditions hold), to rounding. The bounds
// are two boxes more, pinned in place, that every box keeps its own
// distance from.

/** Pixels by which a constraint may be broken, or a multiplier below zero, and count as kept: rounding. */
const TOLERANCE = 1e-9;

/** Boxes that binding constraints hold together: they move as one. */
interface Block {
  /** Its boxes, each at the block's place plus its offset. */
  vars: number[];
  /** The binding constraints holding them: a tree over them. */
  edges: number[];
  /** Its pinned box (a bound), which places it, or -1. */
  pin: number;
  place: number;
}

/**
 * The tops of boxes `heights` tall, as near `wanted` as can be (the least
 * sum of squared moves): each pair `pairs` names (u, v, u, v, ...; u < v,
 * in the order of v) keeping v below u by u's height at least, and each
 * box i within its bounds: its top no higher than `lo[i]`, its bottom no
 * lower than `hi[i]`. The pairs and bounds must leave room for every box. Each step
 * merges or splits blocks and costs O(n + m) for n boxes and m pairs;
 * about 2n steps settle it in tests, at most n² are taken. Where rounding
 * keeps it from settling within them, the tops are made to keep the
 * constraints, each box pushed below the ones above it and then up within
 * its bound, though their moves may not then be least: O(n²(n + m)) at
 * worst.
 */
export function separate(
  wanted: ArrayLike<number>,
  heights: ArrayLike<number>,
  pairs: ArrayLike<number>,
  lo: ArrayLike<number>,
  hi: ArrayLike<number>,
): Float64Array {
  const n = wanted.length;
  if (n === 0) return new Float64Array(0);
  // Boxes n and n + 1 are the bounds, pinned at the least of `lo` and the most of `hi`.
  const want = new Float64Array(n + 2);
  for (let i = 0; i < n; i++) want[i] = wanted[i]!;
  [want[n], want[n + 1]] = [Math.min(...Array.from(lo)), Math.max(...Array.from(hi))];
  // Constraint c keeps box right[c] at least gap[c] below box left[c].
  const left: number[] = [];
  const right: number[] = [];
  const gap: number[] = [];
  const keep = (u: number, v: number, by: number) => {
    left.push(u);
    right.push(v);
    gap.push(by);
  };
  for (let k = 0; k < pairs.length; k += 2) keep(pairs[k]!, pairs[k + 1]!, heights[pairs[k]!]!);
  for (let i = 0; i < n; i++) {
    keep(n, i, lo[i]! - want[n]!);
    keep(i, n + 1, heights[i]! + want[n + 1]! - hi[i]!);
  }
  const m = left.length;
  const active = new Uint8Array(m);
  const lambda = new Float64Array(m);
  const offset = new Float64Array(n + 2);
  const blockOf: Block[] = [];
  const blocks = new Set<Block>();
  for (let i = 0; i < n + 2; i++) {
    const block: Block = { vars: [i], edges: [], pin: i < n ? -1 : i, place: want[i]! };
    blockOf.push(block);
    blocks.add(block);
  }
  const top = (i: number) => blockOf[i]!.place + offset[i]!;
  const slack = (c: number) => top(right[c]!) - top(left[c]!) - gap[c]!;

  /** Moves `b` where its boxes want it: its pin's place, or the mean of theirs. */
  function settle(b: Block): void {
    if (b.pin >= 0) b.place = want[b.pin]! - offset[b.pin]!;
    else {
      let sum = 0;
      for (const i of b.vars) sum += want[i]! - offset[i]!;
      b.place = sum / b.vars.length;
    }
  }

  // A walk of a block's tree: each box's constraints, and the one it is reached by (-1 at the root).
  const around: number[][] = Array.from({ length: n + 2 }, () => []);
  const via = new Int32Array(n + 2);
  const moved = new Float64Array(n + 2);

  /** `b`'s boxes reached from `root` along its constraints, each after the box it is reached from. */
  function walk(b: Block, root: number): number[] {
    for (const i of b.vars) around[i]!.length = 0;
    for (const c of b.edges) {
      around[left[c]!]!.push(c);
      around[right[c]!]!.push(c);
    }
    via[root] = -1;
    const order = [root];
    for (let k = 0; k < order.length; k++) {
      const x = order[k]!;
      for (const c of around[x]!)
        if (c !== via[x]) {
          const y = left[c] === x ? right[c]! : left[c]!;
          via[y] = c;
          order.push(y);
        }
    }
    return order;
  }

  /**
   * Sets the multipliers of `b`'s constraints and returns the least's
   * constraint, or -1. Cutting a constraint parts the tree in two; its
   * multiplier is how far the lower part is below where it wants to be,
   * summed over its boxes, measured on the side away from the pin.
   */
  function weakest(b: Block): number {
    const order = walk(b, b.pin >= 0 ? b.pin : b.vars[0]!);
    for (const i of order) moved[i] = i === b.pin ? 0 : top(i) - want[i]!;
    let least = -1;
    for (let k = order.length - 1; k > 0; k--) {
      const x = order[k]!;
      const c = via[x]!;
      const lower = x === right[c];
      lambda[c] = lower ? moved[x]! : -moved[x]!;
      moved[lower ? left[c]! : right[c]!]! += moved[x]!;
      if (least < 0 || lambda[c]! < lambda[least]!) least = c;
    }
    return least;
  }

  /**
   * The constraints the walk in `b` from box `from` to box `to` follows
   * downward, from their upper box to their lower: those whose splitting
   * lets `to` move down from `from`.
   */
  function downward(b: Block, from: number, to: number): number[] {
    walk(b, from);
    const on: number[] = [];
    for (let x = to; x !== from; ) {
      const c = via[x]!;
      if (right[c] === x) on.push(c);
      x = left[c] === x ? right[c]! : left[c]!;
    }
    return on;
  }

  /** Splits `b` at its constraint `c`: the boxes on `c`'s lower side become a block of their own. */
  function split(b: Block, c: number): void {
    active[c] = 0;
    b.edges = b.edges.filter((e) => e !== c);
    const side = new Set(walk(b, right[c]!));
    const lower: Block = { vars: [...side], edges: [], pin: -1, place: 0 };
    b.vars = b.vars.filter((i) => !side.has(i));
    lower.edges = b.edges.filter((e) => side.has(left[e]!));
    b.edges = b.edges.filter((e) => !side.has(left[e]!));
    if (side.has(b.pin)) [lower.pin, b.pin] = [b.pin, -1];
    for (const i of lower.vars) blockOf[i] = lower;
    blocks.add(lower);
    settle(b);
    settle(lower);
  }

  /** Joins the blocks of `c`'s boxes, at most one pinned, with `c` binding. */
  function merge(c: number): void {
    let [into, from] = [blockOf[left[c]!]!, blockOf[right[c]!]!];
    // What moves the lower block's offsets so that `c` binds; the smaller block's move.
    let shift = offset[left[c]!]! + gap[c]! - offset[right[c]!]!;
    if (from.vars.length > into.vars.length) [into, from, shift] = [from, into, -shift];
    for (const i of from.vars) {
      offset[i]! += shift;
      blockOf[i] = into;
      into.vars.push(i);
    }
    into.edges.push(...from.edges, c);
    if (from.pin >= 0) into.pin = from.pin;
    active[c] = 1;
    blocks.delete(from);
    settle(into);
  }

  /**
   * Keeps the broken constraint `c`: merges its boxes' blocks. Where one
   * block holds both boxes, or each block is pinned (the pins held apart
   * as one), it first splits the walk from `c`'s upper box to its lower
   * (through the pins) where splitting lets the lower move down, at the
   * least multiplier. False where there is no such place: the pairs ask
   * for more than fits.
   */
  function resolve(c: number): boolean {
    const [u, v] = [left[c]!, right[c]!];
    const [a, b] = [blockOf[u]!, blockOf[v]!];
    if (a !== b && (a.pin < 0 || b.pin < 0)) {
      merge(c);
      return true;
    }
    weakest(a);
    let on: number[];
    if (a === b) on = downward(a, u, v);
    else {
      weakest(b);
      on = [...downward(a, u, a.pin), ...downward(b, b.pin, v)];
    }
    if (on.length === 0) return false;
    const at = on.reduce((x, y) => (lambda[y]! < lambda[x]! ? y : x));
    split(blockOf[left[at]!]!, at);
    if (slack(c) < -TOLERANCE) merge(c);
    return true;
  }

  /** The most broken constraint not binding, or -1. */
  function broken(): number {
    let worst = -1;
    let least = -TOLERANCE;
    for (let c = 0; c < m; c++)
      if (!active[c]) {
        const s = slack(c);
        if (s < least) [worst, least] = [c, s];
      }
    return worst;
  }

  const tops = () => Float64Array.from({ length: n }, (_, i) => top(i));
  let steps = Math.max(n * n, 16);
  for (;;) {
    let changed = false;
    for (const b of [...blocks]) {
      const c = weakest(b);
      if (c >= 0 && lambda[c]! < -TOLERANCE) {
        split(b, c);
        changed = true;
      }
    }
    for (let c = broken(); c >= 0; c = broken()) {
      if (--steps < 0 || !resolve(c)) return kept(tops(), heights, pairs, lo, hi);
      changed = true;
    }
    if (!changed) return tops();
  }
}

/** `tops` made to keep the pairs' constraints and the bounds: each pushed below those above it, then up within its bound. */
function kept(
  tops: Float64Array,
  heights: ArrayLike<number>,
  pairs: ArrayLike<number>,
  lo: ArrayLike<number>,
  hi: ArrayLike<number>,
): Float64Array {
  for (let i = 0; i < tops.length; i++) tops[i] = Math.max(tops[i]!, lo[i]!);
  for (let k = 0; k < pairs.length; k += 2) {
    const [u, v] = [pairs[k]!, pairs[k + 1]!];
    tops[v] = Math.max(tops[v]!, tops[u]! + heights[u]!);
  }
  for (let i = 0; i < tops.length; i++) tops[i] = Math.min(tops[i]!, hi[i]! - heights[i]!);
  for (let k = pairs.length - 2; k >= 0; k -= 2) {
    const [u, v] = [pairs[k]!, pairs[k + 1]!];
    tops[u] = Math.min(tops[u]!, tops[v]! - heights[u]!);
  }
  return tops;
}
