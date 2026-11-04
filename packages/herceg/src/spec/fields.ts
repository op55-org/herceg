// Portable types of field display: how a field is named and its values are
// written, given once for every surface (docs/guide/fields.md). Displays
// are given by field name, or as rules matching fields by name, regular
// expression, kind, or table, applied in order.

import type { FormatSpec, NumberFormatSpec, TimeFormatSpec } from "./guides.ts";

/** A kind of field displays write: numbers, times, or categories. */
export type DisplayedKind = "number" | "time" | "category";

/**
 * Values shown as `text`, matched by one value (a category, a number, or a
 * time in epoch milliseconds), by a range of numbers or times (`between`,
 * both ends included, null for an open end), or, for categories, by a
 * regular expression (`regex`; `$1`, `$2` in `text` write its groups). The
 * first mapping that matches a value applies.
 */
export type ValueMapping =
  | { value: number | string; text: string; between?: never; regex?: never }
  | {
      /** @minItems 2 @maxItems 2 */
      between: readonly [number | null, number | null];
      text: string;
      value?: never;
      regex?: never;
    }
  | {
      /** @examples ["^5(\\d\\d)$"] */
      regex: string;
      text: string;
      value?: never;
      between?: never;
    };

/** Mappings of numbers and times: by value or by range. */
export type NumberMapping =
  | { value: number; text: string; between?: never }
  | { between: readonly [number | null, number | null]; text: string; value?: never };

/** Mappings of categories: by value or by regular expression. */
export type CategoryMapping =
  | { value: string; text: string; regex?: never }
  | { regex: string; text: string; value?: never };

/** A part of a link: literal text, a field of the row, or the field's own value. */
export type LinkPart = string | { field: string; value?: never } | { value: true; field?: never };

/**
 * A link from each value: a URL, constant or made of parts (whose values
 * are written raw and URL-encoded), and its text, made of parts. No
 * surface draws links yet; they are checked, and planned for tooltips,
 * grid cells, and `displayOf`.
 */
export interface FieldLink {
  /** @examples ["https://status.example.com"] */
  url: string | readonly LinkPart[];
  text?: readonly LinkPart[];
}

/**
 * Settings every kind of field takes. Each also takes `false`, which
 * resets it: the field shows as if no earlier rule had given it.
 */
interface DisplayBase {
  /** The field's name where surfaces name it; its name by default. */
  label?: string | false;
  /** What the field is, for accessible descriptions. */
  description?: string | false;
  /** The text of missing values; "–" by default. */
  missing?: string | false;
  link?: FieldLink | false;
}

/** A number field's display. */
export interface NumberFieldDisplay extends DisplayBase {
  format?: NumberFormatSpec | false;
  /**
   * The field's lower bound, which gauges, color ramps, percent
   * thresholds, and cell bars read; never an axis' domain.
   */
  min?: number | false;
  /** The field's upper bound, as `min`. */
  max?: number | false;
  mappings?: readonly NumberMapping[] | false;
}

/** A time field's display. */
export interface TimeFieldDisplay extends DisplayBase {
  format?: TimeFormatSpec | false;
  mappings?: readonly NumberMapping[] | false;
}

/** A category field's display: its values are written as they are, or as mapped. */
export interface CategoryFieldDisplay extends DisplayBase {
  mappings?: readonly CategoryMapping[] | false;
}

/**
 * How a field of any kind is named and its values written. Each kind takes
 * what it writes: numbers a number format, bounds, and mappings by value
 * or range; times a time format and mappings by value or range; categories
 * mappings by value or regular expression.
 */
export interface FieldDisplay extends DisplayBase {
  /** How values are written: number forms for numbers, time forms for times. */
  format?: FormatSpec | false;
  /** The field's lower bound (numbers): never an axis' domain. */
  min?: number | false;
  /** The field's upper bound (numbers). */
  max?: number | false;
  mappings?: readonly ValueMapping[] | false;
}

/**
 * Which fields a rule applies to: one by name, or every field that all the
 * given keys hold for: named (`field`), whose name matches `regex` (a
 * JavaScript regular expression, unanchored), of a kind, or of a table
 * the spec's `data` names, and the same fields of tables derived from it
 * that pass them through unchanged.
 *
 * @minProperties 1
 */
export type FieldMatchSpec =
  | string
  | {
      /** @minItems 1 */
      field?: string | readonly string[];
      /** @examples ["^bytes_"] */
      regex?: string;
      /** @minItems 1 */
      kind?: DisplayedKind | readonly DisplayedKind[];
      table?: string;
    };

/** A display and the fields it applies to; every field without `match`. */
export interface FieldRuleSpec extends FieldDisplay {
  match?: FieldMatchSpec;
}

/**
 * Field displays: by field name, or rules applied in order, a later rule's
 * settings over an earlier one's, setting by setting (`false` resets one).
 * A surface's own option (an axis' `format`) wins over both, for it alone.
 */
export type FieldDisplaysSpec =
  | { readonly [field: string]: FieldDisplay }
  | readonly FieldRuleSpec[];
