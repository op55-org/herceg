// Which rows of a table a store's selection holds, a byte per row, and the
// selection a chart's bound channels hold of each table (see
// row-selection.ts): what highlighting draws a store's selection by.

import { compileExpression, type Expression } from "../data/expression.ts";
import type { DataSelection, SelectionStore } from "../data/selection.ts";
import type { Table } from "../data/table.ts";
import type { Mark } from "../marks/mark.ts";
import type { Chosen } from "./highlight.ts";

/** A store channel whose selection a chart highlights, for the marks over its table. */
export interface HighlightedChannel {
  table: Table;
  store: SelectionStore;
  channel: string;
}

/**
 * The selection `table`'s channel holds among `channels`; undefined for
 * none, or rows of a table since reset.
 */
export function channelSelection(
  channels: readonly HighlightedChannel[],
  table: Table,
): DataSelection | undefined {
  const channel = channels.find((c) => c.table === table);
  const selection = channel?.store.get(channel.channel);
  if (!selection || (selection.kind === "rows" && !selection.rows.current)) return undefined;
  return selection;
}

/**
 * What each mark's series hold of its table's channel's selection, for
 * `Highlighter`: the same rows in every series; undefined for marks of
 * tables whose channels hold none.
 */
export function channelsChosen(
  channels: readonly HighlightedChannel[],
): (mark: Mark) => Chosen | undefined {
  return (mark) => {
    const table = mark.table;
    const selection = table && channelSelection(channels, table);
    if (!selection) return undefined;
    const held = {
      selected: membership(table, selection),
      key: selection,
      version: selection.kind === "rows" ? selection.rows.version : -1,
    };
    return () => held;
  };
}

/**
 * Whether each of a table's rows is selected, by position: 1 or 0, as of
 * the table's version and, for rows, the set's.
 */
interface Membership {
  version: number;
  generation: number;
  modified: number;
  rowOffset: number;
  /** The row set's version; -1 for a condition. */
  rows: number;
  selected: Uint8Array;
}

/** Memberships by table and selection, kept while either lives. */
const memberships = new WeakMap<Table, WeakMap<DataSelection, Membership>>();

/**
 * Which of a table's rows a selection holds, by position. Rows still in the
 * table keep their membership when rows were only appended or dropped
 * since: only appended rows are tested.
 */
export function membership(table: Table, selection: DataSelection): Uint8Array {
  let byTable = memberships.get(table);
  if (!byTable) {
    byTable = new WeakMap();
    memberships.set(table, byTable);
  }
  const known = byTable.get(selection);
  const rows = selection.kind === "rows" ? selection.rows.version : -1;
  const same = known?.generation === table.generation && known.rows === rows;
  if (same && known.version === table.version) return known.selected;
  const selected = new Uint8Array(table.length);
  let from = 0;
  if (same && known.modified === table.modifiedVersion && table.rowOffset >= known.rowOffset) {
    const kept = known.selected.subarray(table.rowOffset - known.rowOffset);
    from = Math.min(kept.length, selected.length);
    selected.set(kept.subarray(0, from));
  }
  if (selection.kind === "rows") {
    const set = selection.rows;
    for (let row = from; row < selected.length; row++) if (set.has(row)) selected[row] = 1;
  } else if (from < selected.length) {
    // Compiled first in any case, which checks it against the table.
    const { at } = compileExpression(selection.expression, table);
    if (!fill(selection.expression, table, from, selected.subarray(from))) {
      selected.fill(0, from);
      for (let row = from; row < selected.length; row++) if (at(row) === true) selected[row] = 1;
    }
  }
  byTable.set(selection, {
    version: table.version,
    generation: table.generation,
    modified: table.modifiedVersion,
    rowOffset: table.rowOffset,
    rows,
    selected,
  });
  return selected;
}

/** Comparisons of a number field with a literal, which conditions test a column at a time. */
const COMPARE = new Set(["==", "!=", "<", "<=", ">", ">="]);
const FLIP: Record<string, string> = { "<": ">", "<=": ">=", ">": "<", ">=": "<=" };

/** How a test's results go into what is there: in place of it, or and-ed or or-ed with it. */
type Into = "set" | "and" | "or";

/**
 * Whether each of rows `from` on (as many as `out` holds) meets condition
 * `e`, 1 or 0 into `out`: worked out a column at a time, for the
 * conditions brushes write (number fields compared with numbers, category
 * fields among labels, and conjunctions, disjunctions, and negations of
 * them), about ten times faster than testing row by row. False, with `out`
 * in any state, for any other condition. It gives what the compiled
 * condition gives: a missing value compares false, though unequal.
 */
function fill(
  e: Expression,
  table: Table,
  from: number,
  out: Uint8Array,
  into: Into = "set",
): boolean {
  const n = out.length;
  if (typeof e === "boolean") {
    const bit = e ? 1 : 0;
    if (into === "set" || (into === "and" && !e) || (into === "or" && e)) out.fill(bit);
    return true;
  }
  if (!Array.isArray(e)) return false;
  const [op, ...args] = e as readonly [string, ...Expression[]];
  const name = (arg: Expression | undefined) =>
    Array.isArray(arg) && arg[0] === "field" && typeof arg[1] === "string" ? arg[1] : undefined;
  // A field between two numbers, as brushes write ranges: one pass.
  const range = op === "and" && args.length === 2 && rangeOf(args[0]!, args[1]!, table);
  if (range) {
    const [v, lo, hi] = range;
    // Without branches: a branch on scattered values mispredicts every other row.
    if (into === "set")
      for (let i = 0; i < n; i++) out[i] = +(v[from + i]! >= lo) & +(v[from + i]! <= hi);
    else if (into === "and")
      for (let i = 0; i < n; i++) out[i]! &= +(v[from + i]! >= lo) & +(v[from + i]! <= hi);
    else for (let i = 0; i < n; i++) out[i]! |= +(v[from + i]! >= lo) & +(v[from + i]! <= hi);
    return true;
  }
  if ((op === "and" || op === "or") && args.length > 0) {
    // Each part goes straight into `out` when it combines as the node does.
    if (into === op || into === "set")
      return args.every((arg, i) => fill(arg, table, from, out, i === 0 ? into : op));
    const own = new Uint8Array(n);
    if (!fill(e, table, from, own)) return false;
    combine(out, own, into);
    return true;
  }
  if (op === "not" && args.length === 1) {
    const own = new Uint8Array(n);
    if (!fill(args[0]!, table, from, own)) return false;
    for (let i = 0; i < n; i++) own[i]! ^= 1;
    combine(out, own, into);
    return true;
  }
  if (COMPARE.has(op) && args.length === 2) {
    const compared = comparisonOf(op, args[0]!, args[1]!, table);
    if (!compared) return false;
    const [v, test, c] = compared;
    const own = into === "set" ? out : new Uint8Array(n);
    // A loop per comparison, without branches: these run over every row.
    if (test === "==") for (let i = 0; i < n; i++) own[i] = +(v[from + i] === c);
    else if (test === "!=") for (let i = 0; i < n; i++) own[i] = +(v[from + i] !== c);
    else if (test === "<") for (let i = 0; i < n; i++) own[i] = +(v[from + i]! < c);
    else if (test === "<=") for (let i = 0; i < n; i++) own[i] = +(v[from + i]! <= c);
    else if (test === ">") for (let i = 0; i < n; i++) own[i] = +(v[from + i]! > c);
    else for (let i = 0; i < n; i++) own[i] = +(v[from + i]! >= c);
    if (own !== out) combine(out, own, into);
    return true;
  }
  const field = name(args[0]);
  if (op !== "in" || field === undefined || table.kind(field) !== "category") return false;
  const candidates = args.slice(1);
  if (!candidates.every((v) => typeof v === "string" || v === null)) return false;
  // Whether each category is a candidate, then each row's.
  const { codes, dictionary } = table.categories(field as never);
  const labels = new Set(candidates);
  const member = Uint8Array.from(dictionary, (label) => (labels.has(label) ? 1 : 0));
  const missing = labels.has(null) ? 1 : 0;
  const own = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const code = codes[from + i]!;
    own[i] = code < 0 ? missing : member[code]!;
  }
  combine(out, own, into);
  return true;
}

/**
 * A comparison of a number field with a number, as a test of the field's
 * values with a literal on the right; undefined for other comparisons.
 */
function comparisonOf(
  op: string,
  left: Expression,
  right: Expression,
  table: Table,
): [values: ArrayLike<number>, op: string, literal: number] | undefined {
  // A literal on the left is the same comparison turned around.
  const flipped = typeof left === "number";
  const [arg, c] = flipped ? [right, left] : [left, right];
  const field = Array.isArray(arg) && arg[0] === "field" ? arg[1] : undefined;
  if (typeof field !== "string" || typeof c !== "number" || table.kind(field) === "category")
    return undefined;
  return [table.numbers(field as never), flipped ? (FLIP[op] ?? op) : op, c];
}

/** A field from one number to another, inclusive (`>=` one and `<=` the other); undefined otherwise. */
function rangeOf(
  a: Expression,
  b: Expression,
  table: Table,
): [values: ArrayLike<number>, lo: number, hi: number] | undefined {
  if (!Array.isArray(a) || !Array.isArray(b)) return undefined;
  const first = comparisonOf(a[0] as string, a[1]!, a[2]!, table);
  const second = comparisonOf(b[0] as string, b[1]!, b[2]!, table);
  if (!first || !second || first[0] !== second[0] || a.length !== 3 || b.length !== 3)
    return undefined;
  const low = first[1] === ">=" ? first : second[1] === ">=" ? second : undefined;
  const high = first[1] === "<=" ? first : second[1] === "<=" ? second : undefined;
  return low && high && low !== high ? [first[0], low[2], high[2]] : undefined;
}

/** `own` into `out`, as `into` says. */
function combine(out: Uint8Array, own: Uint8Array, into: Into): void {
  if (into === "set") out.set(own);
  else if (into === "and") for (let i = 0; i < out.length; i++) out[i]! &= own[i]!;
  else for (let i = 0; i < out.length; i++) out[i]! |= own[i]!;
}
