// Field display rules: which fields each applies to (names, a regular
// expression, kinds, a table and the tables derived from it that pass the
// field through unchanged), and the display a field takes from them: each
// setting from the last rule giving it, `false` resetting it.

import type { Origins } from "../data/origin.ts";
import type { RowView } from "../data/row-view.ts";
import type { Table } from "../data/table.ts";
import type { FormatKit } from "../format/patterns.ts";
import type { DisplayedKind, FieldDisplay } from "../spec/fields.ts";
import { checkDisplay, holds, keyPath, misfit, SETTINGS, type Setting, shown } from "./check.ts";

/** A table rules match by: a table, a row view (which stands for its table), or a table's name. */
// biome-ignore lint/suspicious/noExplicitAny: tables of any schema, matched by identity.
export type TableRef = string | Table<any> | RowView<any>;

/**
 * Which fields a rule applies to: one by name, or every field that all the
 * given keys hold for: named (`field`), whose name matches `regex` (a
 * JavaScript regular expression, unanchored), of a kind, or of a table
 * (`TableRef`) and the same fields of its row views and of tables derived
 * from it that pass them through unchanged (filters and sorts; aggregates'
 * `by` fields), not fields they calculate.
 */
export type FieldMatch =
  | string
  | {
      field?: string | readonly string[];
      regex?: string;
      kind?: DisplayedKind | readonly DisplayedKind[];
      table?: TableRef;
    };

/** A display and the fields it applies to; every field without `match`. */
export interface FieldRule extends FieldDisplay {
  match?: FieldMatch;
}

/**
 * Field displays: by field name, or rules applied in order, a later rule's
 * settings over an earlier one's, setting by setting (`false` resets one).
 */
export type FieldDisplays = { readonly [field: string]: FieldDisplay } | readonly FieldRule[];

/** A rule checked and compiled: what it matches, and its settings. */
export interface Rule {
  /** Where it is, for messages, whole ("displayOf fields[2]") and in its list ("fields[2]"). */
  readonly path: string;
  readonly where: string;
  /** The fields it names; a rule naming fields refuses settings their kinds cannot take. */
  readonly names: readonly string[] | undefined;
  readonly regex: RegExp | undefined;
  readonly kinds: readonly DisplayedKind[] | undefined;
  readonly table: Table | string | undefined;
  readonly settings: FieldDisplay;
}

/**
 * A field a surface writes: its name, its kind, and the tables its values
 * come from unchanged (`lineOf`), or only a table's name.
 */
export interface FieldOf {
  readonly name: string;
  readonly kind: DisplayedKind;
  readonly tables?: readonly Table[] | undefined;
  readonly table?: string | undefined;
}

/** A field's display as its rules give it, and the rule that gave each setting. */
export interface Resolved {
  readonly settings: Readonly<FieldDisplay>;
  readonly from: Readonly<Partial<Record<Setting, string>>>;
}

/**
 * `fields` checked and compiled into rules, in order; a record is a rule
 * per key. Messages name them on `surface` ("displayOf fields[2]");
 * formats are checked with the writers `kit` hands.
 */
export function rulesOf(fields: FieldDisplays, surface: string, kit: FormatKit): Rule[] {
  if (Array.isArray(fields))
    return fields.map((rule, i) => compile(rule, surface, `fields[${i}]`, kit));
  if (typeof fields !== "object" || fields === null)
    throw new Error(
      `${surface} fields: expected displays by field name, or a list of rules; received ${shown(fields)}`,
    );
  return Object.entries(fields as Record<string, FieldDisplay>).map(([name, settings]) => {
    const where = `fields${keyPath(name)}`;
    const path = `${surface} ${where}`;
    checkDisplay(settings, path, kit, false);
    return {
      path,
      where,
      names: [name],
      regex: undefined,
      kinds: undefined,
      table: undefined,
      settings,
    };
  });
}

function compile(rule: FieldRule, surface: string, where: string, kit: FormatKit): Rule {
  const path = `${surface} ${where}`;
  checkDisplay(rule, path, kit, true);
  const { match, ...settings } = rule;
  if (match === undefined || typeof match === "string")
    return {
      path,
      where,
      names: match === undefined ? undefined : [match],
      regex: undefined,
      kinds: undefined,
      table: undefined,
      settings,
    };
  const { field, regex, kind, table } = match;
  return {
    path,
    where,
    names: field === undefined ? undefined : typeof field === "string" ? [field] : field,
    regex: regex === undefined ? undefined : new RegExp(regex),
    kinds: kind === undefined ? undefined : typeof kind === "string" ? [kind] : kind,
    table: table === undefined ? undefined : tableOf(table, `${path}.match.table`),
    settings,
  };
}

/** The table `ref` names: a row view's own, a table, or a table's name. */
function tableOf(ref: unknown, at: string): Table | string {
  if (typeof ref === "string") return ref;
  // Row views stand for their tables; a table has no source of its own.
  const table = (
    typeof ref === "object" && ref !== null && "source" in ref ? ref.source : ref
  ) as Table;
  if (typeof table?.kind !== "function")
    throw new Error(
      `${at}: expected a table, a row view, or a table's name; received ${shown(ref)}`,
    );
  return table;
}

/** Whether `rule` applies to `field`: every key of its match holds. */
function applies(rule: Rule, field: FieldOf): boolean {
  const { table } = rule;
  return (
    (!rule.names || rule.names.includes(field.name)) &&
    (!rule.regex || rule.regex.test(field.name)) &&
    (!rule.kinds || rule.kinds.includes(field.kind)) &&
    (table === undefined ||
      (typeof table === "string"
        ? field.table === table || !!field.tables?.some((one) => one.name === table)
        : field.tables
          ? field.tables.includes(table)
          : table.name !== undefined && table.name === field.table))
  );
}

/**
 * The display `rules` give `field`, setting by setting in order: a rule
 * naming it refuses settings its kind cannot take, and broader rules give
 * it only what it takes. Settings that clash once merged (`min` not below
 * `max`, percent thresholds without both) are refused, naming the field on
 * `surface` and the rules that gave them.
 */
export function resolve(rules: readonly Rule[], field: FieldOf, surface: string): Resolved {
  const settings: Record<string, unknown> = {};
  const from: Partial<Record<Setting, string>> = {};
  for (const rule of rules) {
    if (!applies(rule, field)) continue;
    for (const setting of SETTINGS) {
      const value = rule.settings[setting];
      if (value === undefined) continue;
      const wrong = misfit(field.kind, setting, value);
      if (wrong) {
        if (rule.names)
          throw new Error(
            `${rule.path}.${setting}${wrong.at}: ${wrong.problem(holds(field.name, field.kind))}`,
          );
        continue;
      }
      if (value === false) {
        delete settings[setting];
        delete from[setting];
      } else {
        settings[setting] = value;
        from[setting] = rule.where;
      }
    }
  }
  const { min, max, thresholds } = settings as FieldDisplay;
  const at = `${surface} fields${keyPath(field.name)}`;
  if (typeof min === "number" && typeof max === "number" && !(min < max))
    throw new Error(
      `${at}: min ${min} (${from.min}) is not below max ${max} (${from.max}); give min below max`,
    );
  // Percent steps are shares of the field's bounds, never of its data's extent.
  if (thresholds && thresholds.mode === "percent" && !(min !== undefined && max !== undefined))
    throw new Error(`${at}: percent thresholds (${from.thresholds}) need min and max; give both`);
  return { settings, from };
}

/**
 * The tables field `name` of `table` comes from unchanged, nearest first:
 * `table`, then each source while the field passes through the step that
 * made the table before it, as `origins` records them (data/origin.ts).
 */
export function lineOf(origins: Origins, table: Table, name: string): Table[] {
  const line = [table];
  for (let origin = origins.get(table); origin?.passes(name); origin = origins.get(table)) {
    table = origin.source;
    line.push(table);
  }
  return line;
}
