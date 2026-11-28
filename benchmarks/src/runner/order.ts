// The order a run measures in, shuffled from a recorded seed: drift over a
// session (a warming machine, other work) then falls on every library and
// scenario alike rather than on whoever runs first, and a run repeated
// with the same seed measures in the same order. The schedule is made in
// full before anything runs, from a generator of its own (not the one that
// makes the data), so a failure or a skipped step does not reorder what
// follows.

import { randomInt } from "node:crypto";

/** mulberry32, as the datasets use: small, and the same sequence on every platform. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A copy of `items` in an order drawn from `next` (Fisher-Yates). */
export function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A seed for a run that was given none: an unsigned 32-bit integer, recorded with the results. */
export function newSeed(): number {
  return randomInt(0, 2 ** 32);
}

/** `--order-seed`'s value, or a new seed when it was not given. */
export function orderSeed(given: string | undefined): number {
  if (given === undefined) return newSeed();
  const seed = Number(given);
  if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 32)
    throw new Error(
      `--order-seed: ${given} is not a seed; give a whole number from 0 to ${2 ** 32 - 1}`,
    );
  return seed;
}

/**
 * The blocks of a run in a seeded order: blocks (scenarios) shuffled, and
 * the members of each (libraries, or builds) shuffled within it, so that a
 * block's members run close together in time while no member always runs
 * first. Each step names its block and member.
 */
export function schedule<B, M>(
  seed: number,
  blocks: readonly B[],
  members: (block: B) => readonly M[],
): { block: B; member: M }[] {
  const next = seeded(seed);
  return shuffled(blocks, next).flatMap((block) =>
    shuffled(members(block), next).map((member) => ({ block, member })),
  );
}
