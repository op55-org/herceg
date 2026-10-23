// Options the spec takes before Herceg draws them. Round 2 freezes its
// contracts first (the spec's types, the validator, the factories, and
// Python's builders) and its streams then add the behavior: R rendering,
// placement, and painting; C channels, labels, and legends; S export.
// Until a stream lands, a chart refuses its options here, by name, rather
// than ignoring them, and the stream deletes its entries as it adds each.

import { ChartError } from "../spec/errors.ts";

/**
 * An option not drawn yet: its path in a mark's spec ("labels.content"),
 * the stream that adds it, what to do meanwhile, and which of its values
 * are refused (every value by default).
 */
export type Pending = readonly [
  path: string,
  stream: "R" | "C" | "S",
  instead: string,
  refused?: (value: unknown) => boolean,
];

/** Refuses the first of `pending` a `type` mark's `spec` sets. */
export function refusePending(spec: object, type: string, pending: readonly Pending[]): void {
  for (const [path, stream, instead, refused] of pending) {
    let value: unknown = spec;
    for (const key of path.split("."))
      value = (value as Record<string, unknown> | undefined)?.[key];
    if (value !== undefined && (!refused || refused(value)))
      throw new ChartError({
        code: "unsupported",
        path,
        message: `${type} ${path}: not drawn as given yet (round 2 stream ${stream} adds it); ${instead}`,
      });
  }
}

/** An object, not a list: a coordinate where fields were, or a channel object. */
export const OBJECT = (value: unknown): boolean =>
  typeof value === "object" && !Array.isArray(value);
