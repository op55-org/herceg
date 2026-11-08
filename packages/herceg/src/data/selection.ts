// Selections of a table's rows that several views share: a chart's brush,
// a grid's selected rows. The application owns the store and decides which
// views read which channels, and whether they filter or highlight with
// them; nothing propagates on its own. A selection never changes once a
// store holds it: the store freezes it in place, so whoever kept one (an
// event, a listener) reads what was selected then.

import { Expr } from "./expr.ts";
import { compileExpression, type Expression } from "./expression.ts";
import type { ReadonlyRowSet } from "./row-set.ts";
import type { Schema, Table } from "./table.ts";

/**
 * A selection: a condition on the table's fields, which rows appended
 * later meet or not (a chart's brushed range), or a set of rows, which
 * later rows are never in (rows clicked in a grid). Conditions are portable
 * and can run where the data lives; row sets belong to the local table.
 */
export type DataSelection<S extends Schema = Schema> = ConditionSelection | RowsSelection<S>;

export interface ConditionSelection {
  readonly kind: "predicate";
  readonly expression: Expression;
}

export interface RowsSelection<S extends Schema = Schema> {
  readonly kind: "rows";
  /** Read-only: change a copy (`rows.copy()`) and select that. */
  readonly rows: ReadonlyRowSet<S>;
}

/** A change of a store's channel, as its listeners hear it: the channel, what it holds now, and the store's revision then. */
export interface SelectionChange<S extends Schema = Schema> {
  readonly channel: string;
  readonly selection: DataSelection<S> | null;
  readonly revision: number;
}

/**
 * Selections of one table by channel: each channel is one owner's
 * selection ("chart-brush", "grid-rows"), set and cleared on its own.
 */
export class SelectionStore<S extends Schema = Schema> {
  readonly source: Table<S>;
  #channels = new Map<string, DataSelection<S>>();
  #listeners = new Set<(change: SelectionChange<S>) => void>();
  #revision = 0;

  constructor(source: Table<S>) {
    this.source = source;
  }

  /** Increments whenever a channel changes. */
  get revision(): number {
    return this.#revision;
  }

  /** The channels holding a selection. */
  get channels(): string[] {
    return [...this.#channels.keys()];
  }

  get(channel: string): DataSelection<S> | null {
    return this.#channels.get(channel) ?? null;
  }

  /**
   * Sets a channel's selection, or clears it with null. The selection is
   * frozen in place, its row set or condition too: the store holds it as
   * given, and changing it after throws.
   */
  set(channel: string, selection: DataSelection<S> | null): void {
    if (selection === null) {
      if (!this.#channels.delete(channel)) return;
    } else {
      this.#check(selection);
      this.#channels.set(channel, frozen(selection));
    }
    this.#revision++;
    // Each listener hears each change, even when one sets another as it hears it.
    const change = { channel, selection, revision: this.#revision };
    for (const listener of [...this.#listeners]) listener(change);
  }

  /** Calls `listener` with each change of a channel; the function that stops it. */
  subscribe(listener: (change: SelectionChange<S>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * The conjunction of the conditions of `channels` (rows meeting all of
   * them), to filter a view by; undefined when none of them holds a condition.
   */
  condition(channels: readonly string[]): Expression | undefined {
    const conditions = channels.flatMap((channel) => {
      const selection = this.#channels.get(channel);
      return selection?.kind === "predicate" ? [selection.expression] : [];
    });
    if (conditions.length <= 1) return conditions[0];
    return ["and", ...conditions];
  }

  #check(selection: DataSelection<S>) {
    if (selection.kind === "rows") {
      if (selection.rows.source !== this.source)
        throw new Error("A row selection must be of the store's table");
      return;
    }
    const test = compileExpression(selection.expression, this.source as unknown as Table);
    if (test.type !== "boolean")
      throw new TypeError(`A selection needs a true or false condition, not a ${test.type}`);
  }
}

/** A store of selections of `source`'s rows; see `SelectionStore`. */
export function selectionStore<S extends Schema>(source: Table<S>): SelectionStore<S> {
  return new SelectionStore(source);
}

/**
 * A condition as a selection, frozen (the condition too):
 * `store.set("brush", selectWhere(col("t").ge(a).and(col("t").le(b))))`.
 */
export function selectWhere(condition: Expr | Expression | boolean): ConditionSelection {
  return frozen({
    kind: "predicate",
    expression: condition instanceof Expr ? condition.expression : condition,
  });
}

/** A row set as a selection, frozen: the set is read-only from then on. */
export function selectRows<S extends Schema>(set: ReadonlyRowSet<S>): RowsSelection<S> {
  return frozen({ kind: "rows", rows: set });
}

/** `selection` made read-only in place, with its row set or condition. */
function frozen<
  T extends ConditionSelection | { readonly kind: "rows"; readonly rows: { freeze(): unknown } },
>(selection: T): T {
  if (selection.kind === "rows") selection.rows.freeze();
  else freezeExpression(selection.expression);
  return Object.freeze(selection);
}

function freezeExpression(expression: Expression) {
  if (!Array.isArray(expression)) return;
  for (const part of expression) freezeExpression(part);
  Object.freeze(expression);
}
