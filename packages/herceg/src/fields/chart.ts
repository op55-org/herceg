// A chart's field displays (`fields`): its rules checked once, and each
// field it shows resolved once per table and written with the chart's own
// formatters (its kit), for the guide and feature compilers and the
// surfaces they hand writers to: axes, legends, series names, tooltips,
// labels, gauges, and the text alternative (docs/guide/fields.md).

import type { HierarchyEncoding } from "../data/hierarchy.ts";
import type { Origins } from "../data/origin.ts";
import type { RowView } from "../data/row-view.ts";
import type { Table } from "../data/table.ts";
import type { Formatter } from "../format/format.ts";
import { formatWriter } from "../format/patterns.ts";
import type { TimeZone } from "../format/zone.ts";
import type { GlyphKey, Mark } from "../marks/mark.ts";
import type { TreeView } from "../marks/tree-data.ts";
import type { DisplayedKind } from "../spec/fields.ts";
import type { FormatSpec } from "../spec/guides.ts";
import type { Setting } from "./check.ts";
import {
  DATE_TIME,
  type DisplayKit,
  mapper,
  missingValue,
  type ResolvedDisplay,
} from "./display.ts";
import { type FieldDisplays, lineOf, resolve, rulesOf } from "./rules.ts";

/** A field a chart shows, as its displays write it. */
export interface ShownField {
  readonly field: string;
  readonly kind: DisplayedKind;
  /** Its label, else its name. */
  readonly label: string;
  /** Whether its displays give it a label. */
  readonly labeled: boolean;
  readonly description: string | undefined;
  readonly min: number | undefined;
  readonly max: number | undefined;
  /** Its format, where its displays give one. */
  readonly format: FormatSpec | undefined;
  /** The zone its times are written in: the chart's. */
  readonly zone: TimeZone;
  /** Where each of its settings comes from, for messages: the rule's place, `fields[2]`. */
  readonly from: Readonly<Partial<Record<Setting, string>>>;
  /** Its format normalized, which fields placed on one axis agree on; "" without one. */
  readonly formatKey: string;
  /** Its mappings and missing text normalized, which a category axis' fields agree on; "" without either. */
  readonly textKey: string;
  /**
   * A writer of its values: the missing text (its own, else `missing`), a
   * mapping's text, or `own` (a surface's own format) or else its format
   * or else `fallback` (the surface's default; numbers and times as charts
   * write them) writing the value; categories as they are.
   */
  writer(
    own?: Formatter,
    fallback?: Formatter,
    missing?: string,
  ): (value: number | string | null) => string;
  /** Its values as `writer()` writes them. */
  readonly text: (value: number | string | null) => string;
  /**
   * A writer of amounts computed from its values in its units (a slice's
   * sum, a node's total): its format, else `fallback`, and its missing
   * text, never its mappings, which name its values alone.
   */
  amount(fallback: Formatter): (value: number) => string;
  /**
   * A writer of its values in a tooltip, over the axis' writer `axis`: the
   * axis' own `tooltipFormat` (a writer marked `own`, `AxisContext`) over
   * its format, its format over the axis' other writing; with `numbers`
   * (times on an axis of numbers, such as bars' lengths), times as dates
   * rather than as the axis' numbers. Without `axis`, as `writer()`.
   */
  over(axis?: Formatter & { readonly own?: true }, numbers?: boolean): (value: number) => string;
}

/** How a layout mark writes its items' text through the displays (see `ChartFields.items`). */
export interface ItemText {
  /**
   * A writer of values of field `field` (a slice's category, a node's
   * size) as its display writes them, with `own` (a label part's format)
   * over its format and `missing` as the surface's missing text ("–" by
   * default); undefined where it has no display.
   */
  value(
    field: string | undefined,
    own?: Formatter,
    missing?: string,
  ): ShownField["text"] | undefined;
  /**
   * A writer of amounts of field `field` (a slice's sum, a node's total):
   * its format, without its mappings, which name single values, and
   * numbers as charts write them where it gives none; undefined where it
   * has no display.
   */
  amount(field: string | undefined): ((value: number) => string) | undefined;
  /**
   * A writer of values along a scale fields `fields` share (a radar's
   * rings): the format their displays agree on, without mappings;
   * undefined where they give none or disagree.
   */
  scale(fields: readonly string[]): ((value: number) => string) | undefined;
  /** Field `field`'s label, else its name. */
  label(field: string): string;
  /** `values`, values of field `field` (a radar's series), as its display writes them; as they are without one. */
  texts(field: string | undefined, values: readonly string[]): readonly string[];
  /**
   * `view`, a view of a tree its `encoding` names, with its nodes' names and
   * the names of the path to its root as the display of each level's field
   * writes them (a level below the path's last field's is the last's): what
   * items, labels, and summaries write, made once per view. Keys, drills,
   * selections, and labels' parts read `view` itself.
   */
  tree(view: TreeView, encoding: HierarchyEncoding): TreeView;
}

/** A chart's field displays, resolved per field and table as asked. */
export interface ChartFields {
  /**
   * The display of field `name` of `table` (a row view's: its table's),
   * undefined where the table lacks it, it holds shapes, or no rule gives
   * it a setting.
   */
  of(table: Table | RowView | undefined, name: string): ShownField | undefined;
  /**
   * The display `mark`'s labels write their `{ value: true }` parts
   * through: that of a series' value field (`field`, where the label says
   * which), else of the mark's value field, or of several of one kind whose
   * displays agree, where it is a field of numbers or times with a display;
   * undefined where the mark's own writer writes them, and for stacks to
   * their shares, whose values are shares.
   */
  valueDisplay(mark: Mark, field?: string): ShownField | undefined;
  /**
   * The text of a legend entry standing for `value` of the fields `reads`
   * names (each mark's table and field, none for a mark naming entries by
   * value): what the displays of those holding the value (of every one,
   * where none does: a declared domain's value without rows) write it as,
   * where they all write it alike; else `value`.
   */
  entry(
    reads: readonly (readonly [Table | undefined, string | undefined])[],
    value: string,
  ): string;
  /**
   * Field `name`'s label and its value at row `row` of `table`, as its
   * display writes them ("Memory 2 MiB"), with `fallback` writing numbers
   * it has no format for; undefined where it has no display.
   */
  labeled(table: Table, name: string, row: number, fallback: Formatter): string | undefined;
  /**
   * `key`, a legend's key of the values of field `name` of `table`, named
   * and its entries written as the field's display does; `key` itself where
   * the field has no display. Scales and colors read the raw values.
   */
  key(table: Table | RowView | undefined, name: string, key: GlyphKey): GlyphKey;
  /**
   * How a layout mark of `table` writes its items' text through the
   * displays: names, amounts, and fields' labels. Layout marks ask for it
   * only where the chart has displays, and write as they are otherwise.
   */
  items(table: Table | RowView | undefined): ItemText;
  /**
   * `values`, names a layout mark reads from the fields `reads` names (a
   * Sankey diagram's sources and targets), each as `entry` writes it.
   */
  names(
    reads: readonly (readonly [Table | undefined, string | undefined])[],
    values: readonly string[],
  ): string[];
}

/**
 * What a chart's displays use of its code, handed in (see `GuideKit`): its
 * formatters, and derived tables' origins (data/origin.ts), which rules
 * naming tables match along.
 */
export type ChartFieldKit = DisplayKit & { origins: Origins };

/**
 * `fields` checked and compiled for a chart in `locale` and `zone`, whose
 * code writes them (`kit`). Messages name them as the chart's ("chart
 * fields[2]"); what needs a field's kind is checked as it is asked for.
 */
export function chartFields(
  fields: FieldDisplays,
  kit: ChartFieldKit,
  locale: string | undefined,
  zone: TimeZone,
): ChartFields {
  const rules = rulesOf(fields, "chart", kit);
  // By table, weakly: displays outlive the tables charts drew with them.
  const tables = new WeakMap<Table, Map<string, ShownField | undefined>>();
  const numbers: Formatter = (value) => kit.formatNumber(value, locale);
  // Times as dates with times of day, as charts write them.
  let times: Formatter | undefined;
  const dates: Formatter = (value) => {
    times ??= kit.timeFormatter(DATE_TIME, zone, locale);
    return times(value);
  };
  const shown = (table: Table, name: string): ShownField | undefined => {
    if (!table.has(name)) return undefined;
    const kind = table.kind(name);
    if (kind === "geometry") return undefined;
    const resolved = resolve(
      rules,
      { name, kind, tables: lineOf(kit.origins, table, name) },
      "chart",
    );
    const display = resolved.settings as ResolvedDisplay;
    if (Object.keys(display).length === 0) return undefined;
    const { format, mappings, missing: own, label } = display;
    const write =
      format &&
      formatWriter(
        kit,
        format,
        kind === "time",
        zone,
        locale,
        `chart ${resolved.from.format}.format`,
      );
    const mapped = mappings && mapper(mappings);
    const writer: ShownField["writer"] = (
      ownFormat,
      fallback = kind === "time" ? dates : numbers,
      missing = "–",
    ) => {
      const writes = ownFormat ?? write ?? fallback;
      return (value) =>
        missingValue(kind, value)
          ? (own ?? missing)
          : (mapped?.(value!) ?? (typeof value === "string" ? value : writes(value!)));
    };
    return {
      field: name,
      kind,
      label: label ?? name,
      labeled: label !== undefined,
      description: display.description,
      min: display.min,
      max: display.max,
      format,
      zone,
      from: resolved.from,
      formatKey: format ? normalized(format) : "",
      textKey: mappings || own !== undefined ? JSON.stringify([mappings, own]) : "",
      writer,
      text: writer(),
      amount: (fallback) => (value) =>
        missingValue(kind, value) ? (own ?? "–") : (write ?? fallback)(value),
      over: (axis, numbers) => writer(axis?.own ? axis : undefined, numbers ? undefined : axis),
    };
  };
  const of: ChartFields["of"] = (ref, name) => {
    if (!ref) return undefined;
    const table = "source" in ref ? ref.source : ref;
    let byName = tables.get(table);
    if (!byName) {
      byName = new Map();
      tables.set(table, byName);
    }
    if (!byName.has(name)) byName.set(name, shown(table, name));
    return byName.get(name);
  };
  // Trees written (`ItemText.tree`), by the view each writes: views are kept
  // while their data is, so a redraw writes no names again.
  const trees = new WeakMap<TreeView, TreeView>();
  const entry: ChartFields["entry"] = (reads, value) => {
    // A category field holds the values its dictionary does.
    const holding = reads.filter(
      ([table, name]) =>
        name === undefined ||
        !table?.has(name) ||
        table.kind(name) !== "category" ||
        holds(table, name).has(value),
    );
    const texts = new Set(
      (holding.length > 0 ? holding : reads).map(([table, name]) =>
        name === undefined ? value : (of(table, name)?.text(value) ?? value),
      ),
    );
    return texts.size === 1 ? [...texts][0]! : value;
  };
  return {
    of,
    valueDisplay: (mark, field) => {
      if (fills(mark)) return undefined;
      const shown = (field === undefined ? (mark.identity?.values ?? []) : [field]).map((one) =>
        of(mark.table, one),
      );
      const first = shown[0];
      return first &&
        first.kind !== "category" &&
        shown.every(
          (one) =>
            one?.kind === first.kind &&
            one.formatKey === first.formatKey &&
            one.textKey === first.textKey,
        )
        ? first
        : undefined;
    },
    entry,
    labeled: (table, name, row, fallback) => {
      const shown = of(table, name);
      // Times as dates, not by the surface's numbers.
      const write = shown?.writer(undefined, shown.kind === "time" ? undefined : fallback);
      return shown && `${shown.label} ${write!(table.value(name as never, row))}`;
    },
    names: (reads, values) => values.map((value) => entry(reads, value)),
    items: (table) => {
      const shown = (field: string | undefined) =>
        field === undefined ? undefined : of(table, field);
      return {
        value: (field, own, missing) =>
          own || missing !== undefined
            ? shown(field)?.writer(own, undefined, missing)
            : shown(field)?.text,
        amount: (field) => shown(field)?.amount(numbers),
        scale: (names) => {
          const [first, ...rest] = names.map(shown);
          return first?.format && rest.every((other) => other?.formatKey === first.formatKey)
            ? first.amount(numbers)
            : undefined;
        },
        label: (field) => shown(field)?.label ?? field,
        texts: (field, values) => {
          const write = shown(field)?.text;
          return write ? values.map(write) : values;
        },
        tree: (view, encoding) => {
          let written = trees.get(view);
          if (written) return written;
          const writers = ("path" in encoding ? encoding.path : [encoding.id]).map(
            (field) => shown(field)?.text,
          );
          // A name at level -1, the whole tree's root, is as it is.
          const at = (name: string, level: number) =>
            (level < 0 ? undefined : writers[Math.min(level, writers.length - 1)])?.(name) ?? name;
          const { tree, prefix } = view;
          written = {
            ...view,
            prefix: prefix.map(at),
            tree: {
              ...tree,
              names: tree.names.map((name, node) =>
                at(name, prefix.length + tree.depth[node]! - 1),
              ),
            },
          };
          trees.set(view, written);
          return written;
        },
      };
    },
    key: (table, name, key) => {
      const shown = of(table, name);
      if (!shown) return key;
      const text = shown.writer();
      return {
        ...key,
        title: shown.label,
        entries: key.entries.map((entry) => ({ ...entry, label: text(entry.label) })),
      };
    },
  };
}

/** Whether `mark` stacks its values to their shares (`stack: "fill"`), which it places and writes. */
export function fills(mark: Mark): boolean {
  const { stack } = mark.spec as { stack?: unknown };
  return stack === "fill" || (stack as { offset?: unknown } | undefined)?.offset === "fill";
}

/**
 * The values of each category field's dictionary, by table, as a set: kept
 * until the dictionary is replaced, grows, or is compacted (its revision).
 */
const dictionaries = new WeakMap<
  Table,
  Map<
    string,
    { dictionary: readonly string[]; length: number; revision: number; values: Set<string> }
  >
>();

function holds(table: Table, name: string): ReadonlySet<string> {
  let byName = dictionaries.get(table);
  if (!byName) {
    byName = new Map();
    dictionaries.set(table, byName);
  }
  const { dictionary, revision } = table.categories(name as never);
  let held = byName.get(name);
  if (
    held?.dictionary !== dictionary ||
    held.length !== dictionary.length ||
    held.revision !== revision
  ) {
    held = { dictionary, length: dictionary.length, revision, values: new Set(dictionary) };
    byName.set(name, held);
  }
  return held.values;
}

/**
 * A format's settings in one order, without the defaults they document
 * (a duration's `maxUnits: 2` and `decimals: 0`), so that formats saying
 * the same agree.
 */
function normalized(format: FormatSpec): string {
  const settings = { ...format } as Record<string, unknown>;
  if (settings.duration !== undefined) {
    if (settings.maxUnits === 2) delete settings.maxUnits;
    if (settings.decimals === 0) delete settings.decimals;
  }
  return JSON.stringify(Object.fromEntries(Object.entries(settings).sort()));
}
