// Point symbols' names, which the spec checks (spec/channels.ts) and
// category fields take in turn. Their shapes (draw/symbol-shapes.ts) are
// apart, so what checks a name loads no geometry.

import type { SymbolName } from "./encoding.ts";

/**
 * Every symbol: the first `CYCLE` in the order category fields take them,
 * distinct silhouettes first; "x", a cross turned 45 degrees, only by name.
 */
export const SYMBOLS: readonly SymbolName[] = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "cross",
  "star",
  "wye",
  "triangle-down",
  "x",
];

/** How many of SYMBOLS category fields take in turn. */
export const CYCLE = 8;
