// The content marks' labels take from the chart's field displays where
// their options give none (docs/guide/fields.md, "Labels"): bars' value
// labels and annotations' labels of a field, as parts the content writer
// writes through the displays. It loads with the displays (fields/compile.ts).

import type { LabelContent } from "../../spec/encoding.ts";
import type { FormatSpec } from "../../spec/guides.ts";
import type { BarSpec } from "../../spec/spec.ts";
import type { Mark } from "../mark.ts";

/**
 * The content `mark`'s labels take from the displays: a bar's value labels
 * (its value, or the field it labels with), an annotation's label of a
 * field, each with its label's format; undefined for other marks, labels
 * with content of their own, and the value labels of bars stacked to their
 * shares, which label shares no display writes.
 */
export function displayedContent(mark: Mark): LabelContent | undefined {
  const spec = mark.spec as { type: string; labels?: unknown; label?: unknown };
  const of = (field: string | undefined, format: FormatSpec | undefined): LabelContent => [
    field === undefined
      ? { value: true, ...(format && { format }) }
      : { field, ...(format && { format }) },
  ];
  if (spec.type === "bar") {
    if (!spec.labels) return undefined;
    const labels = (typeof spec.labels === "object" ? spec.labels : {}) as {
      field?: string;
      format?: FormatSpec;
      content?: unknown;
    };
    return labels.content === undefined &&
      (labels.field !== undefined || (spec as BarSpec).stack !== "fill")
      ? of(labels.field, labels.format)
      : undefined;
  }
  const label = spec.label as
    | { field?: string; format?: FormatSpec; content?: unknown }
    | undefined;
  return (spec.type === "rule" || spec.type === "region" || spec.type === "text") &&
    typeof label === "object" &&
    label.field !== undefined &&
    label.content === undefined
    ? of(label.field, label.format)
    : undefined;
}
