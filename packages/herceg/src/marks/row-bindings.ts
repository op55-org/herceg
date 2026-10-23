// Where marks of rows (lines, areas, bars, points, error bars) place their
// rows. Each position is a field on the axis' scale, or a coordinate a field
// gives: a field on a position scale of the chart's own (`{ field, scale }`),
// a share of a frame (`{ fraction: { field } }`), or pixels from its edge
// (`{ px: { field } }`), each moved by `offset` pixels. Rules every reader
// keeps:
// - Positions along one direction bind alike, so one scale places them all;
//   the mark draws, and is inspected, with that scale in its frame.
// - Only fields on their axis count toward its domain, move with zoom and
//   pan, and select rows by brushes; along a direction off its axis (a
//   frame's or another scale's) a mark tells the axis nothing.
// - A share's or pixels' field holds numbers; a row whose position is
//   missing or not finite is not drawn.
// - Tooltips and the keyboard write a value on a scale as that scale writes
//   it, and a share or pixels as a number.
// A mark keeps what binds each direction (`bound`); the feature compiler,
// which charts with coordinates load, checks the coordinates whole and
// projects them (marks/features/positions.ts).

import type { Schema, Table } from "../data/table.ts";
import { checkOption, requireField } from "./mark.ts";

/** How a mark of rows places them along x or y, where not as its axis does with no offset. */
export type RowBinding =
  | { readonly kind: "axis"; readonly offset: number }
  | { readonly kind: "scale"; readonly scale: string; readonly offset: number }
  | {
      readonly kind: "frame";
      readonly unit: "fraction" | "px";
      readonly frame: "plot" | "chart";
      readonly offset: number;
    };

/** A mark's bindings by direction, for a mark given coordinates; a direction absent is on its axis. */
export interface RowBindings {
  readonly x?: RowBinding | undefined;
  readonly y?: RowBinding | undefined;
}

/** The field, or fields, a mark of rows' position reads: its own, or its coordinate's. */
export function rowField(position: unknown): string | readonly string[] | undefined {
  if (typeof position !== "object" || Array.isArray(position))
    return position as string | readonly string[] | undefined;
  const coordinate = position as {
    field?: string;
    fraction?: { field?: string };
    px?: { field?: string };
  };
  return coordinate.field ?? (coordinate.fraction ?? coordinate.px)?.field;
}

/** Whether a direction is placed off its axis: in a frame or on a scale of the chart's own. */
export function offAxis(bound: RowBindings | undefined, axis: "x" | "y"): boolean {
  const binding = bound?.[axis];
  return binding !== undefined && binding.kind !== "axis";
}

/** Whether an axis' domain takes in zero for a mark standing on it there (bars from their base). */
export function standsOn(
  mark: { readonly zero?: "x" | "y" | undefined; readonly bound?: RowBindings | undefined },
  axis: "x" | "y",
): boolean {
  return mark.zero === axis && !offAxis(mark.bound, axis);
}

/**
 * The fields a `role` mark's positions `keys` read in `spec` (each key's
 * field, or fields), and with coordinates among them, how each direction
 * binds them, as its first position does. A coordinate without a field
 * (one place for every row, a rule's or text's), or with one `table`
 * lacks, is refused here.
 */
export function bindRows(
  spec: object,
  table: Table<Schema>,
  role: string,
  keys: readonly string[],
): { fields: Readonly<Record<string, string | readonly string[]>>; bound?: RowBindings } {
  const fields: Record<string, string | readonly string[]> = {};
  let bound: Record<string, RowBinding | undefined> | undefined;
  for (const key of keys) {
    const place = (spec as Record<string, unknown>)[key];
    if (place === undefined) continue;
    const field = rowField(place);
    fields[key] = field!;
    if (typeof place !== "object" || Array.isArray(place)) continue;
    const c = place as Record<string, unknown>;
    const form = "fraction" in c ? "fraction" : "px" in c ? "px" : undefined;
    const path = form ? `${key}.${form}` : key;
    checkOption(
      typeof field === "string",
      role,
      path,
      `{ field }${form ? "" : ", { fraction: { field } }, or { px: { field } }"}: each row is placed by its own value`,
      form ? c[form] : c,
    );
    // Named where it is given; the feature compiler checks its kind.
    if (!table.has(field as string))
      requireField(table, field as string, [], `${role} ${path}.field`);
    const offset = (c.offset as number | undefined) ?? 0;
    const scale = c.scale as string | undefined;
    bound ??= {};
    if (!(key[0]! in bound))
      bound[key[0]!] = form
        ? { kind: "frame", unit: form, frame: c.frame === "chart" ? "chart" : "plot", offset }
        : scale === undefined || scale === "x" || scale === "y" || scale === "yRight"
          ? offset
            ? { kind: "axis", offset }
            : undefined
          : { kind: "scale", scale, offset };
  }
  return bound ? { fields, bound } : { fields };
}
