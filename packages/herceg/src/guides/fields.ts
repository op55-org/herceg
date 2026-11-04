// What axes read of the chart's field displays (`fields`), for the guide
// compiler: the format the fields placed on each position scale agree on,
// which its axis writes where it gives none of its own; the text of
// categories, where the fields on a band axis agree on their mappings; and
// axes' titles of parts, whose `{ label }` parts are fields' labels
// (docs/guide/fields.md, "Axes"). It loads with the displays (fields/compile.ts).

import { type ChartFields, fills, type ShownField } from "../fields/chart.ts";
import type { Mark } from "../marks/mark.ts";
import type { AxisContext } from "../model/axis.ts";
import type { ChartConfig } from "../model/model.ts";
import type { AxisTitleSpec, TitlePart } from "../spec/encoding.ts";

/** What axes take from the chart's field displays. */
export interface GuideFields {
  /**
   * `context`, the context of an axis of scale `scale`, with the format
   * the fields placed on the scale agree on below its own: a number axis'
   * ticks and values, and a time axis' values (its ticks keep their
   * calendar labels). `paths` takes where that format is given, for
   * messages.
   */
  axis(context: AxisContext, scale: string, paths: WeakMap<object, string>): AxisContext;
  /**
   * The texts of the bands of the band axis along `axis`, from their keys
   * (raw values) and labels: as the display of the fields marks place there
   * in bands writes them, where every such field of their kind (categories,
   * or numbers and times) has one and they agree on it; undefined where
   * every band keeps its label.
   */
  categories(
    axis: "x" | "y",
    keys: readonly string[],
    labels: readonly string[],
  ): readonly string[] | undefined;
  /** `title` as text: its `{ label }` parts written as the fields of that name are labeled. */
  title(title: AxisTitleSpec | undefined): string | undefined;
}

/** Keys of marks' specs placing fields on position scales: x's, and y's (or yRight's). */
const KEYS = ["x", "x1", "x2", "y", "y1", "y2"] as const;
/**
 * Keys of marks' specs placing fields on their value axis (y, or x for
 * marks inspected along y): a candle's prices, a precomputed box's
 * statistics.
 */
const VALUES: Readonly<Record<string, readonly string[]>> = {
  candlestick: ["open", "high", "low", "close"],
  boxplot: ["low", "q1", "median", "q3", "high"],
};

/**
 * The fields `config`'s marks place on each position scale, with their
 * displays from `fields` (none without displays): every configured mark's,
 * whichever of its series are hidden. Values a mark computes in other
 * units (counts, shares of a stack) place none.
 */
export function guideFields(config: ChartConfig, fields: ChartFields): GuideFields {
  const placed = new Map<string, (ShownField | undefined)[]>();
  // Every field marks read by a name, for titles' labels.
  const named = new Map<string, (ShownField | undefined)[]>();
  for (const mark of config.marks as readonly Mark[]) {
    if ((mark as { layout?: boolean }).layout || !mark.table) continue;
    const spec = mark.spec as unknown as Record<string, unknown> & { axis?: string };
    // Stacks to their shares place shares along their values.
    const shares = fills(mark) ? (mark.tooltip === "y" ? "x" : "y") : undefined;
    const values = mark.tooltip === "y" ? "x" : "y";
    for (const key of [...KEYS, ...(VALUES[spec.type as string] ?? [])]) {
      const axis = (KEYS as readonly string[]).includes(key) ? (key[0] as "x" | "y") : values;
      if (axis === shares) continue;
      for (const { field, scale } of fieldsIn(spec[key])) {
        if (!mark.table.has(field)) continue;
        const name = scale ?? (axis === "x" ? "x" : spec.axis === "right" ? "yRight" : "y");
        const shown = fields.of(mark.table, field);
        placed.set(name, [...(placed.get(name) ?? []), shown]);
      }
    }
    for (const field of mark.table.fields())
      named.set(field, [...(named.get(field) ?? []), fields.of(mark.table, field)]);
  }
  return {
    axis: (context, scale, paths) => {
      const { type, spec } = context;
      if (type === "band") return context;
      const kind = type === "time" ? "time" : "number";
      const on = placed.get(scale)?.filter((shown) => !shown || shown.kind === kind) ?? [];
      const first = on[0];
      const own = spec?.format;
      // Ticks take the agreed format below the axis' own, and values below
      // its own two, whatever they are (functions too).
      if (!first?.format || on.some((shown) => shown?.formatKey !== first.formatKey))
        return context;
      const agreed = first.format;
      paths.set(agreed, `${first.from.format}.format`);
      return {
        ...context,
        spec:
          type === "time"
            ? { ...spec, tooltipFormat: spec?.tooltipFormat ?? own ?? agreed }
            : { ...spec, format: own ?? agreed },
      };
    },
    categories: (axis, keys, labels) =>
      categories(config.marks as readonly Mark[], axis, fields, keys, labels),
    title: (title) => {
      if (!Array.isArray(title)) return title as string | undefined;
      return (title as readonly TitlePart[])
        .map((part) => {
          if (typeof part === "string") return part;
          const labels = new Set(
            (named.get(part.label) ?? []).map((shown) => shown?.label ?? part.label),
          );
          // Fields of one name labeled differently (two tables' rules) are named by it.
          return labels.size === 1 ? [...labels][0]! : part.label;
        })
        .join("");
    },
  };
}

/** See `GuideFields.categories`. */
function categories(
  marks: readonly Mark[],
  axis: "x" | "y",
  fields: ChartFields,
  keys: readonly string[],
  labels: readonly string[],
): readonly string[] | undefined {
  // By the kind of band key, "c:" for categories and "n:" for numbers and
  // times: the display the fields marks place in bands agree on, else null.
  const agreed = new Map<string, ShownField | null>();
  for (const mark of marks) {
    const table = mark.table;
    if (!table || mark.channelKind?.(axis) !== "category") continue;
    const spec = mark.spec as unknown as Record<string, unknown>;
    for (const { field } of fieldsIn(spec[axis])) {
      if (!table.has(field)) continue;
      const kind = table.kind(field) === "category" ? "c:" : "n:";
      const shown = fields.of(table, field);
      const before = agreed.get(kind);
      agreed.set(
        kind,
        (shown?.textKey || (kind === "n:" && shown?.format)) &&
          (before === undefined ||
            (before?.kind === shown.kind &&
              before.textKey === shown.textKey &&
              before.formatKey === shown.formatKey))
          ? shown
          : null,
      );
    }
  }
  if (![...agreed.values()].some(Boolean)) return undefined;
  return keys.map((key, i) => {
    const kind = key.slice(0, 2);
    const raw = key.slice(2);
    const shown = agreed.get(kind);
    const label = labels[i]!;
    // Values it neither maps nor formats keep their labels.
    return shown ? shown.writer(undefined, () => label)(kind === "n:" ? Number(raw) : raw) : label;
  });
}

/** The fields a spec's position option names: a field, several, or a coordinate's, with the scale it names. */
function fieldsIn(given: unknown): { field: string; scale?: string | undefined }[] {
  if (typeof given === "string") return [{ field: given }];
  if (Array.isArray(given))
    return given
      .filter((one): one is string => typeof one === "string")
      .map((field) => ({ field }));
  if (typeof given === "object" && given !== null) {
    const { field, scale } = given as { field?: unknown; scale?: unknown };
    if (typeof field === "string")
      return [{ field, scale: typeof scale === "string" ? scale : undefined }];
  }
  return [];
}
