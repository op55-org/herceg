// The lineage kit: what a binding through lineage reads and draws, loaded
// with `lineage` (`import { lineage } from "herceg"`, which bindings take;
// see lineage-binding.ts). A route goes from a table the chart draws (a
// groups' table, a derived table) to the bound table it comes from: its
// contributor relation (data/contributors.ts) and the coverage of each
// field the chart draws (coverage.ts), held while the chart draws them.
//
// - Gestures keep their meanings: a click, Space, or a lasso writes the
//   contributors of the items it is on, as rows of the bound table; a brush
//   along a position axis writes a condition there where every derivation
//   between rewrites it (data/lineage.ts), its items' contributors
//   otherwise; a brush along an axis of aggregates is refused.
// - Bars draw a target's selected part from its base where its field is a
//   count or sum of the bound table's rows none of whose contributions is
//   below zero (the histogram's rule); a target some of whose contributors
//   are selected draws in the partial look otherwise. Every other mark
//   draws targets all of whose contributors are selected as selected, none
//   as unselected, and the others in the partial look.
// - Budgets: what a binding's routes build is counted before it is made,
//   and again as tables grow; past it, the binding stops highlighting.

import {
  type ContributorRecord,
  contributorsOf,
  type Measure,
} from "../data/contributor-records.ts";
import { type ContributorRelation, relationTo } from "../data/contributors.ts";
import { compileExpression, type Expression } from "../data/expression.ts";
import { lineageOf } from "../data/lineage.ts";
import { RowSet } from "../data/row-set.ts";
import {
  type DataSelection,
  type SelectionStore,
  selectRows,
  selectWhere,
} from "../data/selection.ts";
import type { Table } from "../data/table.ts";
import { copiedFrom } from "../marks/drawn.ts";
import { heldText, type LayoutMark } from "../marks/layout-mark.ts";
import type { Frame, Mark, MarkKey } from "../marks/mark.ts";
import { rowField } from "../marks/row-bindings.ts";
import { rowOf, type Series } from "../marks/series.ts";
import type { Geometry, PointGeometry, RectGeometry } from "../scene/scene.ts";
import { ChartError } from "../spec/errors.ts";
import type { BrushSpec } from "../spec/spec.ts";
import type {
  ChartSelection,
  ItemSelection,
  SelectionLooks,
  SeriesSelection,
} from "../spec/state.ts";
import {
  budgetRefusal,
  type Coverage,
  coverageOf,
  type LineageCost,
  lineageCost,
  type TargetCoverage,
} from "./coverage.ts";
import { type Covered, inLook, type Paint, part } from "./highlight.ts";
import {
  named,
  type Reader,
  type Resolution,
  type RouteBinding,
  type SelectionLineage,
} from "./lineage-binding.ts";
import type { ChartModel } from "./model.ts";
import { valueFieldOf } from "./selected-rows.ts";

/** A target's coverage as inspection reports it, by the channel it is of. */
export interface InspectedCoverage extends TargetCoverage {
  readonly channel: string;
}

/**
 * What a route holds of each row of a table a layout mark draws (a pie of
 * groups): counts of the rows behind it, and the selected part of a field's
 * value where it can be drawn. `key` changes whenever any of them may have.
 */
export interface RowsCoverage {
  readonly key: Uint8Array;
  selected(row: number, field?: string): number;
  total(row: number, field?: string): number;
  /**
   * Whether `field`'s selected parts can be drawn of every row, so that an
   * item says what they measure: a count, or a sum no contribution of which
   * is below zero (a mean's cannot).
   */
  measured(field: string | undefined): boolean;
  /**
   * The selected part of `field`'s value of `row` (a count or sum, none of
   * whose contributions is below zero), or with no field, of the row as one
   * (1 all selected, 0 none); undefined where no part can be drawn.
   */
  part(row: number, field: string | undefined): number | undefined;
}

/** What the lineage kit makes of a table the chart draws and the bound table it comes from. */
export interface LineageRoute {
  readonly relation: ContributorRelation;
  /** The refusal that stopped it, past its budget as tables grew; null while it highlights. */
  readonly stopped: ChartError | null;
  /** Checks what it holds against its binding's budget as tables grew: the refusal once it passes, else null. */
  check(): ChartError | null;
  /**
   * Where a refusal found as the tables a gesture walked change goes: the
   * chart's `onError` once a chart's gestures walk it; `reportError` by default.
   */
  report: (error: ChartError) => void;
  /** The bound table's rows behind `targets` (positions of the table drawn), for `field`'s value where given. */
  rows(targets: ArrayLike<number>, field?: string): RowSet;
  /**
   * `condition` on the table drawn, on the bound table's fields; null where
   * no condition says it. Through groups and totals, a condition of their
   * keys is the same condition on their view's table, within the view's
   * own filter, for a chart drawing one value field of them: where it draws
   * several, whose rows differ by field, a gesture's rows are its field's.
   */
  back(condition: Expression): Expression | null;
  /**
   * What a gesture's selection of the table drawn (a brush, a lasso, items,
   * series) writes of the bound table: a condition where every step
   * between writes one, else the rows behind the targets it holds, for the
   * value field of each series it chose (all the mark draws, for a brush).
   * `rowsOf` finds a selection's targets, and a lasso's by field.
   */
  written(
    selection: ChartSelection,
    rowsOf: (
      selection: ChartSelection,
      byField?: Map<string | undefined, number[]>,
    ) => DataSelection | null | undefined,
  ): DataSelection | undefined;
  /** Refuses a brush along an axis of the table's aggregates, whose values select no rows. */
  refuse(mark: Mark, brush: BrushSpec, path: string): void;
  /** What the text alternative says of it once stopped past its budget; "" while it highlights. */
  readonly said: string;
  /** How a mark of the table draws (see `Covered`): its geometry, or the rows a byte view holds. */
  draw(mark: Mark, ...drawing: Parameters<Covered>): ReturnType<Covered>;
  /**
   * Rows of the table drawn with any of their contributors for `field`
   * (the first field drawn by default) selected, 1 each; made again as
   * coverage changes.
   */
  bytes(field?: string): Uint8Array | undefined;
  /** Coverage per row, for layout marks. */
  coverage(): RowsCoverage | undefined;
  /**
   * A target's coverage for `field` while the channel holds a selection,
   * with what it adds to the target's text: "; 12 of 42 rows selected,
   * revenue 80 of 100".
   */
  inspect(
    row: number,
    field: string | undefined,
    format: (value: number) => string,
  ): { coverage: InspectedCoverage; text: string } | undefined;
  release(): void;
}

/** What a chart draws routes through lineage with, while it highlights. */
export interface LineageHighlight {
  /** How a mark of a table reached through lineage draws. */
  covered(mark: Mark): Covered | undefined;
  /** A byte view of a table's targets, for layout marks and picking. */
  layout(table: Table): Uint8Array | undefined;
  /** Stops, letting go of what routes hold at once. */
  stop(): void;
}

/** The kit, as `lineage` is at run time. */
export interface LineageKit {
  route(target: Table, bound: RouteBinding, readers: readonly Reader[]): LineageRoute;
  /** Refuses `routes` of one binding past its budget, which they then share. */
  admit(routes: readonly LineageRoute[], bound: RouteBinding): void;
  /** Refuses `reader`'s table, which reaches bindings of `nearest` and of `further`. */
  ambiguous(reader: Reader, nearest: Table, further: Table): never;
  /** Refuses a binding no reader's table reaches, naming them where they have names. */
  unrelated(readers: readonly Reader[], bound: RouteBinding): void;
  /** Draws `model`'s marks of tables reached through lineage, as of the routes its configuration has now. */
  highlight(model: ChartModel, routes: () => Resolution): LineageHighlight;
  /** Selections of one table as one: a condition where each is one, else the rows they hold together. */
  join(found: readonly DataSelection[], table: Table): DataSelection;
  /**
   * Makes a grid of a table that comes from its store's read and write its
   * selection through lineage (see `LineageGrid`); `changed` redraws it.
   * Returns what stops it.
   */
  grid(model: LineageGrid, changed: () => void, grouped: boolean): () => void;
}

/**
 * A grid model as the kit makes it select through lineage, without groups:
 * the members it replaces on the model, and those they read.
 */
export interface LineageGrid {
  readonly data: { readonly source: Table };
  readonly selectionStore: SelectionStore;
  readonly channel: string;
  rangeAnchor: unknown;
  refAt(rowIndex: number): unknown;
  rangeAnchorIndex(): number | null;
  current(): {
    readonly length: number;
    readonly snapshot: { readonly indices: Uint32Array | undefined };
  };
  writeSelection(store: SelectionStore, channel: string, selection: DataSelection | null): void;
  readonly selectedCount: number | null;
  selectionNote?(rowIndex: number): string | undefined;
  selectionState(rowIndex: number): "all" | "some" | "none";
  selectedAlone(rowIndex: number): boolean;
  selectedTest(selection: DataSelection): (position: number) => boolean;
  applySelect(rowIndex: number, mode: GridMode): void;
  applySelectAll(): void;
  setGroups(groups: object | null): void;
}

/** How a grid's gesture selects rows: only them, toggled, a range of them, or a range added. */
type GridMode = "only" | "toggle" | "range" | "addRange";

/**
 * Parts of series drawn apart, keyed after their series' keys with
 * "\u0001" and their name, as the highlighter's are: targets none, all, or
 * some of whose contributors are selected (in the partial look), and split
 * bars' lit lower parts, dimmed upper parts, and labels.
 */
type Part = "off" | "on" | "partial" | "lower" | "upper" | "labels";

/** The fields a mark places at `key` of its spec: one, a list, a coordinate's, or none (a value). */
function fieldsAt(mark: Mark | LayoutMark, key: string): string[] {
  return [rowField((mark.spec as unknown as Record<string, unknown>)[key])]
    .flat()
    .filter((field): field is string => typeof field === "string");
}

/**
 * The fields a mark draws its values of: those along its values axis, a
 * layout mark's value; none for bands and error bars, whose items stand
 * for their rows, both ends' (`valueFieldOf`).
 */
function fieldsOf(mark: Mark | LayoutMark): (string | undefined)[] {
  const layout = "layout" in mark && mark.layout;
  const across = layout ? "value" : (mark as Mark).tooltip === "y" ? "x" : "y";
  const spec = mark.spec as unknown as Record<string, unknown>;
  if (spec[`${across}1`] !== undefined || spec[`${across}Error`] !== undefined) return [undefined];
  const fields = fieldsAt(mark, across);
  return fields.length > 0 ? fields : [undefined];
}

/**
 * `condition` on a groups' or totals' table, on its view's table: the same
 * condition where it reads only the record's keys (totals have none),
 * within the view's own filter (as a gesture on a chart of the view writes:
 * the channels it follows are other panels' filters); null where it reads
 * an aggregate, a row set restricts the view, or the producer stopped.
 */
function keyed(
  record: Exclude<ContributorRecord, { kind: "derived" }>,
  condition: Expression,
): Expression | null {
  const keys = record.kind === "links" ? record.keys : [];
  const following = record.kind === "links" ? record.following : record.current();
  const { view } = record;
  if (!following || view.restriction || readOf(condition).some((field) => !keys.includes(field)))
    return null;
  const filter = view.query.filter as Expression | undefined;
  return filter === undefined ? condition : ["and", condition, filter];
}

/** Positions of `table`'s rows meeting `condition` now. */
function rowsWhere(condition: Expression, table: Table): number[] {
  const { at } = compileExpression(condition, table);
  const rows: number[] = [];
  for (let row = 0; row < table.length; row++) if (at(row) === true) rows.push(row);
  return rows;
}

/** The fields an expression reads. */
function readOf(expression: Expression): string[] {
  if (!Array.isArray(expression)) return [];
  const [op, ...args] = expression;
  return op === "field" ? [args[0] as string] : args.flatMap(readOf);
}

/**
 * Whether `field` of `table` holds statistics of `bound`'s rows, whose
 * values no brush selects rows by: an aggregate of groups or totals (one
 * that measures or reads their values), an aggregate's or a rolling
 * aggregate's result, or a value calculated or binned from one. Groups'
 * and totals' other fields are their keys, and fields a derivation passes
 * through, filters, sorts, or bins from positions are positions.
 */
function statistic(table: Table, field: string, bound: Table): boolean {
  if (table === bound) return false;
  const lineage = lineageOf(table);
  if (!lineage) {
    // Groups' and totals' aggregates as their producers name them, whether
    // or not a part of them can be drawn (a frozen pivot's); their keys are
    // what their source has them as (a key may group by its aggregates).
    const record = contributorsOf(table);
    if (!record || record.kind === "derived") return false;
    return (
      record.aggregates.some((op) => op.name === field) || statistic(record.source, field, bound)
    );
  }
  const { steps, source } = lineage;
  // `name` as the steps before `end` made it, back to the source's fields.
  const made = (end: number, name: string): boolean => {
    for (let k = end - 1; k >= 0; k--) {
      const step = steps[k]!;
      if ("aggregate" in step) {
        if (step.aggregate.some((op) => op.as === name)) return true;
      } else if ("rolling" in step) {
        if (step.rolling.some((op) => op.as === name)) return true;
      } else if ("calculate" in step) {
        if (step.as === name) return readOf(step.calculate).some((read) => made(k, read));
      } else if ("bin" in step && (name === (step.as ?? step.bin) || name === step.end))
        return made(k, step.bin);
    }
    return statistic(source, name, bound);
  };
  return made(steps.length, field);
}

/** The routes of one binding, which share its budget. */
class Budget {
  readonly routes: Route[] = [];
  readonly bound: RouteBinding;
  stopped: ChartError | null = null;
  /** The tables' versions the last count was of. */
  #seen = "";

  constructor(bound: RouteBinding) {
    this.bound = bound;
  }

  /** The bytes its routes keep, the membership they share counted once. */
  required(): number {
    let [required, membership] = [0, 0];
    for (const route of this.routes) {
      const cost = route.cost();
      required += cost.required - cost.membership;
      membership = Math.max(membership, cost.membership);
    }
    return required + membership;
  }

  refusal(phase?: "render"): ChartError | null {
    const { bound } = this;
    const [first] = this.routes;
    const source = bound.table;
    return budgetRefusal(
      { required: this.required() },
      bound.budget,
      {
        target: first
          ? named(first.target, bound.fixed ? "the view's table" : "the chart's table")
          : "",
        source: named(source, "the bound table"),
        rows: source.length,
        at: bound.at,
        fixed: !!bound.fixed,
      },
      phase,
    );
  }

  /** The refusal the first time the routes grew past the budget; null while within it, and after. */
  check(): ChartError | null {
    if (this.stopped) return null;
    let seen = `${this.bound.table.version}`;
    for (const route of this.routes) seen += ` ${route.target.version} ${route.sums()}`;
    if (seen === this.#seen) return null;
    this.#seen = seen;
    const refusal = this.refusal("render");
    if (!refusal) return null;
    this.stopped = refusal;
    for (const route of this.routes) route.release();
    return refusal;
  }
}

class Route implements LineageRoute {
  readonly relation: ContributorRelation;
  readonly target: Table;
  readonly bound: RouteBinding;
  readonly fields: readonly (string | undefined)[];
  budget: Budget | null = null;
  /** The fields each reader draws its values of, by its key in the chart. */
  readonly #fieldsBy: ReadonlyMap<MarkKey, readonly (string | undefined)[]>;
  /** Coverage held by class of fields, with its release. */
  readonly #held = new Map<string | null, { coverage: Coverage; release: () => void }>();
  /** Byte views of the targets, by class of fields. */
  readonly #bytes = new Map<string | null, { revision: number; bytes: Uint8Array }>();
  /** The relation's hold while gestures walk it, and its tables followed, released with the route. */
  #walking: (() => void) | null = null;
  report: (error: ChartError) => void = report;

  constructor(target: Table, bound: RouteBinding, readers: readonly Reader[]) {
    this.target = target;
    this.bound = bound;
    // The resolver found the chain of records, so the relation is there.
    const relation = relationTo(target, bound.table)!;
    this.relation = relation;
    this.#fieldsBy = new Map(readers.map(({ key, mark }) => [key, fieldsOf(mark)]));
    const fields = [...this.#fieldsBy.values()].flat();
    // A grid reads its rows' coverage, of every contributor.
    this.fields = fields.length > 0 ? [...new Set(fields)] : [undefined];
    for (const { mark, name } of readers) {
      const of = named(target);
      // Summaries draw statistics of positions that are not the table's rows
      // (bins, groups), and merges of rows: what they draw selected is their own.
      const layout = "layout" in mark && mark.layout;
      const series = mark as Mark;
      const summary = !layout && !!(series.summarizes || series.selectedGeometry);
      // Layout items add their rows' counts, which rows sharing contributors would count twice.
      const shared = layout && !relation.partition;
      if (summary || shared)
        throw new ChartError({
          code: "unsupported",
          path: bound.at,
          message: `rowSelection lineage: ${name} ${summary ? "summarizes" : "draws items of"} ${of}${shared ? ", whose rows share contributors (rolling aggregates)," : ""}, which a selection through lineage does not highlight yet; bind a store of ${of}`,
        });
    }
  }

  get stopped(): ChartError | null {
    return this.budget?.stopped ?? null;
  }

  check(): ChartError | null {
    return this.budget?.check() ?? null;
  }

  cost(): LineageCost {
    return lineageCost(this.relation, this.fields, this.bound.store, this.bound.channel);
  }

  /** Whether coverage held keeps sums: another reader asking for them grows what this route holds. */
  sums(): string {
    let sums = "";
    for (const { coverage } of this.#held.values()) sums += coverage.sums ? "1" : "0";
    return sums;
  }

  /** The coverage of `field`, held while the route lives; none once stopped. */
  #coverage(field: string | undefined): Coverage | undefined {
    if (this.stopped) return undefined;
    const relation = this.relation;
    const key = relation.classOf(field);
    let held = this.#held.get(key);
    if (!held) {
      const coverage = coverageOf(relation, field, this.bound.store, this.bound.channel);
      held = { coverage, release: coverage.hold() };
      this.#held.set(key, held);
    }
    return held.coverage;
  }

  rows(targets: ArrayLike<number>, field?: string): RowSet {
    return this.#behind(new RowSet(this.bound.table), targets, [field]);
  }

  /** Adds the contributors of `targets` for each of `fields` to `rows`. */
  #behind(
    rows: RowSet,
    targets: ArrayLike<number>,
    fields: readonly (string | undefined)[],
  ): RowSet {
    // A gesture's walk builds what a derivation keeps of its rows: held
    // until released, the budget checked as the tables change (so a binding
    // that draws nothing stops past it too), or past it only while it walks.
    const once = this.stopped ? this.relation.hold() : undefined;
    if (!once && !this.#walking) {
      const hold = this.relation.hold();
      const checked = () => {
        const refusal = this.check();
        if (refusal) this.report(refusal);
      };
      const stops = [this.bound.table.subscribe(checked), this.target.subscribe(checked)];
      this.#walking = () => {
        hold();
        for (const stop of stops) stop();
      };
    }
    // Rows reached twice (rolling windows) go into the set in batches, not kept apart.
    const batch: number[] = [];
    const visit = (position: number) => {
      if (batch.push(position) === 4096) {
        rows.addAll(batch);
        batch.length = 0;
      }
    };
    try {
      for (const field of fields)
        for (let i = 0; i < targets.length; i++)
          this.relation.contributors(targets[i]!, visit, field);
    } finally {
      once?.();
    }
    return rows.addAll(batch);
  }

  back(condition: Expression): Expression | null {
    let table = this.target;
    let written: Expression | null = condition;
    // Through every derivation, groups, and totals between, to the bound table.
    while (written !== null && table !== this.bound.table) {
      const lineage = lineageOf(table);
      if (lineage) {
        written = lineage.back(written);
        table = lineage.source;
        continue;
      }
      const record = contributorsOf(table);
      if (!record || record.kind === "derived" || this.fields.length > 1) return null;
      written = keyed(record, written);
      table = record.source;
    }
    return written;
  }

  written(
    selection: ChartSelection,
    rowsOf: (
      selection: ChartSelection,
      byField?: Map<string | undefined, number[]>,
    ) => DataSelection | null | undefined,
  ): DataSelection | undefined {
    const table = this.bound.table;
    if (selection.kind === "brush") {
      // Each mark's rows the brush holds, under the value fields of its series shown.
      const byField = new Map<string | undefined, number[]>();
      const found = rowsOf(selection, byField);
      if (!found) return undefined;
      if (found.kind !== "rows") {
        const condition = this.back(found.expression);
        if (condition !== null) return selectWhere(condition);
      }
      // A map's or network's lasso names no fields: the rows behind every field drawn.
      if (byField.size === 0) return this.#written(found, this.fields);
      const rows = new RowSet(table);
      for (const [field, targets] of byField) this.#behind(rows, targets, [field]);
      return selectRows(rows);
    }
    // Items and series by the mark their keys name, and of it the value
    // field they name (a series of a mark of several), else every field
    // the mark draws.
    const keys: readonly unknown[] =
      selection.kind === "items" ? selection.items : selection.series;
    const byFields = new Map<string, { fields: readonly (string | undefined)[]; of: unknown[] }>();
    for (const key of keys) {
      let parts: unknown[] = [];
      try {
        parts = JSON.parse(key as string) as unknown[];
      } catch {}
      const drawn = this.#fieldsBy.get(parts[0] as MarkKey) ?? this.fields;
      const fields = drawn.includes(parts[1] as string) ? [parts[1] as string] : drawn;
      const id = JSON.stringify(fields);
      const entry = byFields.get(id) ?? { fields, of: [] };
      entry.of.push(key);
      byFields.set(id, entry);
    }
    const found = [...byFields.values()].flatMap(({ fields, of }) => {
      const rows = rowsOf(
        selection.kind === "items"
          ? { kind: "items", items: of as ItemSelection["items"] }
          : { kind: "series", series: of as SeriesSelection["series"] },
      );
      return rows ? [this.#written(rows, fields)] : [];
    });
    return found.length > 1 ? joined(found, table) : found[0];
  }

  /** `found`, of the table drawn, as the bound table's: its condition written back, else the rows behind it for `fields`. */
  #written(found: DataSelection, fields: readonly (string | undefined)[]): DataSelection {
    let targets: ArrayLike<number>;
    if (found.kind === "rows") targets = found.rows.positions();
    else {
      const condition = this.back(found.expression);
      if (condition !== null) return selectWhere(condition);
      targets = rowsWhere(found.expression, this.target);
    }
    return selectRows(this.#behind(new RowSet(this.bound.table), targets, fields));
  }

  refuse(mark: Mark, brush: BrushSpec, path: string): void {
    const bound = this.bound.table;
    for (const axis of ["x", "y"] as const) {
      if (brush !== axis && brush !== "xy") continue;
      // The fields placing the axis: a position, a range's ends, an error.
      const placing = [axis, `${axis}1`, `${axis}2`, `${axis}Error`].flatMap((key) =>
        fieldsAt(mark, key),
      );
      if (!placing.some((field) => statistic(this.target, field, bound))) continue;
      const other = axis === "x" ? "y" : "x";
      throw new ChartError({
        code: "unsupported",
        path,
        message: `${mark.spec.type} brush: its ${axis} axis holds aggregates of ${named(this.bound.table, "the bound table")}'s rows, which a brush selects none of; brush along ${other}${brush === "xy" ? " only" : ""}, or click its items`,
      });
    }
  }

  /** Grids': how much of the rows behind a target the channel holds. */
  held(target: number): "all" | "some" | "none" {
    const coverage = this.#coverage(undefined);
    if (!coverage?.membership.held) return "none";
    const state = coverage.state(target);
    return state === "partial" ? "some" : state;
  }

  /** Grids': rows of the bound table the channel holds. */
  get count(): number {
    return this.#coverage(undefined)?.membership.count ?? 0;
  }

  /**
   * Grids': what selecting `targets` writes, as a grid's `mode` says (only
   * them, a range of them, added, or toggled: taken out where every row
   * behind them is held), over what the channel holds (`current`).
   */
  pick(targets: ArrayLike<number>, mode: GridMode, current: DataSelection | null): DataSelection {
    const rows = this.rows(targets);
    if (mode === "only" || mode === "range") return selectRows(rows);
    const held = asRows(current, this.bound.table);
    const all = rows.positions();
    if (mode === "toggle" && all.every((row) => held.has(row)))
      for (const row of all) held.delete(row);
    else held.addAll(all);
    return selectRows(held);
  }

  /** Grids': whether a target's rows are all the channel holds. */
  alone(target: number): boolean {
    const coverage = this.#coverage(undefined);
    return this.held(target) === "all" && coverage!.selected(target) === this.count;
  }

  /** Grids': what a target partly selected says of it, "12 of 42 rows selected"; undefined otherwise. */
  note(target: number): string | undefined {
    const coverage = this.#coverage(undefined);
    if (this.held(target) !== "some") return undefined;
    return heldText(coverage!.selected(target), coverage!.total(target), undefined, String).slice(
      2,
    );
  }

  /**
   * Grids': follows the bound table, whose changes change what the channel
   * holds of each row though the grid's own rows stay the same, checking
   * the budget (a refusal is reported) and calling `changed`; returns what
   * stops it and lets go of what the route holds.
   */
  follow(changed: () => void): () => void {
    const checked = () => {
      const refusal = this.check();
      if (refusal) report(refusal);
    };
    // The view's table grows as its view's rows return, the bound table staying the same.
    const stops = [
      this.bound.table.subscribe(() => {
        checked();
        changed();
      }),
      this.target.subscribe(checked),
    ];
    return () => {
      for (const stop of stops) stop();
      this.release();
    };
  }

  /** Grids': refuses groups, which a grid bound through lineage does not show yet. */
  refuseGroups(): never {
    throw new Error(
      `${this.bound.at}: groups of a grid bound through lineage are not shown yet; drop groups`,
    );
  }

  get said(): string {
    return this.stopped
      ? `Highlighting of ${named(this.target, "the chart's table")} stopped because its selection indexes passed the budget.`
      : "";
  }

  /** What `field` measures, where a part of it can be drawn. */
  #measure(field: string | undefined): Measure | undefined {
    return field === undefined ? undefined : this.relation.measureOf(field);
  }

  /**
   * The selected share of a target's value of `field`: its selected
   * contributors' count or sum over all of theirs, where the field is one
   * and, for a sum, no contribution is below zero; undefined otherwise.
   */
  #share(
    coverage: Coverage,
    target: number,
    field: string | undefined,
    measure: Measure | undefined,
  ): number | undefined {
    if (!measure || field === undefined) return undefined;
    // Measured first: the coverage keeps sums, and with them negatives, from then on.
    const measured = coverage.measure(target, field);
    if (measure.op === "sum" && coverage.negatives(target) > 0) return undefined;
    if (!measured || !(measured.total > 0) || !(measured.selected >= 0)) return undefined;
    return Math.min(1, measured.selected / measured.total);
  }

  /** Whether every target's selected part of `field` can be drawn: a count, or a sum with no contribution below zero. */
  #measured(field: string | undefined): boolean {
    const measure = this.#measure(field);
    if (!measure) return false;
    if (measure.op === "count") return true;
    const coverage = this.#coverage(field);
    if (!coverage) return false;
    if (this.target.length > 0) coverage.measure(0, field!);
    for (let row = 0; row < this.target.length; row++)
      if (coverage.negatives(row) > 0) return false;
    return true;
  }

  draw(
    mark: Mark,
    series: readonly Series[],
    paint: Paint,
    frame: Frame,
    drawn: (parts: readonly Series[], suffix: string) => Geometry[],
  ): ReturnType<Covered> {
    if (!this.#coverage(this.fields[0])?.membership.held) return undefined;
    const type = mark.spec.type;
    // Lines and areas draw the targets with any contributor selected as their selected runs.
    if (type === "line" || type === "area") {
      // Each series by its own field's coverage: two sums' contributors may differ.
      return (s) => {
        const bytes = this.#bytesOf(s ? valueFieldOf(s) : this.fields[0])!;
        return { selected: bytes, key: bytes, version: -1 };
      };
    }
    const [top, root] = mark.tooltip === "y" ? (["x", "x0"] as const) : (["y", "y0"] as const);
    // Each series' rows in each part, every series in every part drawn, so
    // that grouped bars keep their slots.
    const split: { s: Series; rows: Record<Part, number[]>; middle?: Float64Array }[] = [];
    for (const s of series) {
      const field = valueFieldOf(s);
      const coverage = this.#coverage(field);
      if (!coverage) return undefined;
      const measure = type === "bar" ? this.#measure(field) : undefined;
      const rows: Record<Part, number[]> = {
        off: [],
        on: [],
        partial: [],
        lower: [],
        upper: [],
        labels: [],
      };
      const entry: (typeof split)[number] = { s, rows };
      split.push(entry);
      const counts = coverage.counts();
      for (let k = 0; k < s.length; k++) {
        const row = rowOf(s, k);
        const selected = counts.selected(row);
        if (selected === 0) {
          rows.off.push(row);
          continue;
        }
        if (selected >= counts.total(row)) {
          rows.on.push(row);
          continue;
        }
        const share = this.#share(coverage, row, field, measure);
        if (share === undefined) {
          rows.partial.push(row);
          continue;
        }
        // A split bar's selected part ends at its share of the bar, from
        // where it starts (its stack's base): drawn from the base to there,
        // and dimmed from there to its top, in data values.
        rows.lower.push(row);
        entry.middle ??= Float64Array.from(s[top]);
        const middle = entry.middle;
        const base = s[root]?.[row];
        const from = Number.isFinite(base) ? base! : 0;
        middle[row] = from + (middle[row]! - from) * share;
      }
      rows.upper = rows.labels = rows.lower;
    }
    const draw = (name: Part) => {
      if (!split.some(({ rows }) => rows[name].length > 0)) return [];
      const parts = split.map(({ s, rows, middle }) => {
        const cut = part(s, `\u0001${name}`, Uint32Array.from(rows[name]));
        // Split bars' parts end at their middles: the lit one's top, the dimmed one's base.
        if (!middle || (name !== "lower" && name !== "upper")) return cut;
        return name === "lower" ? { ...cut, [top]: middle } : { ...cut, [root]: middle };
      });
      return drawn(parts, `\u0001${name}`);
    };
    const rects = (name: Part) => draw(name).filter((g) => g.kind === "rect");
    // A split bar's selected part ends inside the bar: only its top rounds, as the bar does.
    const square = (g: Geometry) =>
      (g as RectGeometry).rounded ? copiedFrom({ ...g, rounded: undefined } as Geometry, g) : g;
    // The partial look, by default the unselected one outlined in the item's color.
    const look = (mark.spec as SelectionLooks).partial;
    const partial = (g: Geometry) =>
      look ? [inLook(g, look, frame)] : paint.dim(g).map((dimmed) => outlined(dimmed, g));
    return [
      ...draw("off").flatMap(paint.dim),
      ...rects("upper").flatMap(paint.dim),
      ...draw("partial").flatMap(partial),
      ...draw("on").map(paint.lit),
      ...rects("lower").map((g) => paint.lit(square(g))),
      ...draw("labels").filter((g) => g.kind !== "rect"),
    ];
  }

  bytes(field?: string): Uint8Array | undefined {
    return this.#bytesOf(field ?? this.fields[0]);
  }

  /** `bytes` of `field`'s coverage; of every contributor for none. */
  #bytesOf(field: string | undefined): Uint8Array | undefined {
    const coverage = this.#coverage(field);
    if (!coverage?.membership.held) return undefined;
    const revision = coverage.revision;
    const key = this.relation.classOf(field);
    const made = this.#bytes.get(key);
    if (made?.revision === revision) return made.bytes;
    const { selected } = coverage.counts();
    const bytes = new Uint8Array(this.target.length);
    for (let row = 0; row < bytes.length; row++) bytes[row] = selected(row) > 0 ? 1 : 0;
    this.#bytes.set(key, { revision, bytes });
    return bytes;
  }

  coverage(): RowsCoverage | undefined {
    const key = this.bytes();
    if (!key) return undefined;
    const of = (field: string | undefined) => this.#coverage(field)!;
    return {
      key,
      selected: (row, field) => of(field).selected(row),
      total: (row, field) => of(field).total(row),
      // Asked once a count of the mark's items, which marks keep while the selection is the same.
      measured: (field) => this.#measured(field),
      part: (row, field) => {
        const coverage = of(field);
        const [selected, total] = [coverage.selected(row), coverage.total(row)];
        if (field === undefined) return selected === 0 ? 0 : selected >= total ? 1 : undefined;
        if (selected === 0) return 0;
        const value = this.target.numbers(field as never)[row]!;
        if (selected >= total) return value;
        const share = this.#share(coverage, row, field, this.#measure(field));
        return share === undefined ? undefined : value * share;
      },
    };
  }

  inspect(row: number, field: string | undefined, format: (value: number) => string) {
    const held = this.#coverage(field);
    if (!held?.membership.held || !(row >= 0 && row < this.target.length)) return undefined;
    const coverage = { ...held.of(row, field), channel: this.bound.channel };
    const { measure } = coverage;
    const text = heldText(
      coverage.selected,
      coverage.total,
      measure && { field: measure.field, held: measure.selected, of: measure.total },
      format,
    );
    return { coverage, text };
  }

  release(): void {
    for (const { release } of this.#held.values()) release();
    this.#held.clear();
    this.#bytes.clear();
    this.#walking?.();
    this.#walking = null;
  }
}

/**
 * The partial look's outline: `dimmed` (of `g`) with an edge or ring in
 * `g`'s color, 1.5 px, at full opacity. Lines and areas draw their selected
 * runs instead.
 */
function outlined(dimmed: Geometry, g: Geometry): Geometry {
  const width = 1.5;
  let copy: Geometry = dimmed;
  if (g.kind === "rect") {
    const { fill, edge } = g as RectGeometry;
    copy = {
      ...dimmed,
      edge: { stroke: fill, width, opacity: 1, dash: undefined, sides: edge?.sides },
    } as Geometry;
  } else if (g.kind === "point")
    copy = { ...dimmed, ring: { color: (g as PointGeometry).fill, width, opacity: 1 } } as Geometry;
  return copy === dimmed ? dimmed : copiedFrom(copy, dimmed);
}

/** What a channel holds as a set of rows to change: a copy of its rows, or a condition's rows as they are now. */
function asRows(current: DataSelection | null, table: Table): RowSet {
  if (current?.kind === "rows") return current.rows.copy();
  const rows = new RowSet(table);
  return current ? rows.addAll(rowsWhere(current.expression, table)) : rows;
}

/** Selections of one table as one: a condition where each is one, else the rows they hold together. */
function joined(found: readonly DataSelection[], table: Table): DataSelection {
  const conditions = found.flatMap((s) => (s.kind === "predicate" ? [s.expression] : []));
  if (conditions.length === found.length) return selectWhere(["or", ...conditions]);
  const rows = new RowSet(table);
  for (const s of found)
    rows.addAll(s.kind === "rows" ? s.rows.positions() : rowsWhere(s.expression, table));
  return selectRows(rows);
}

/** Reports an error without stopping the code that ran into it: a grid's budget passed, which no `onError` hears. */
function report(error: unknown): void {
  if (typeof reportError === "function") reportError(error);
  else console.error(error);
}

/**
 * Makes `model` show and select the rows behind its rows: they read as
 * selected all, some, or none as the channel holds those rows, and
 * selecting them writes those rows.
 */
function selectThrough(model: LineageGrid, route: Route): void {
  const { selectionStore: store, channel } = model;
  const setGroups = model.setGroups;
  const positionOf = (rowIndex: number) => {
    const { snapshot, length } = model.current();
    if (!(Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < length))
      throw new RangeError(`Row ${rowIndex} is not among the grid's ${length} rows`);
    return snapshot.indices ? snapshot.indices[rowIndex]! : rowIndex;
  };
  /** Writes the rows behind the view's rows from `start` to `end` (or one at a position) as `mode` selects them. */
  const write = (mode: GridMode, start: number, end?: number) => {
    let targets: ArrayLike<number> = [start];
    if (end !== undefined) {
      const { indices } = model.current().snapshot;
      const rows = new RowSet(route.target);
      if (indices) rows.addAll(indices.subarray(start, end));
      else rows.addRange(start, end);
      targets = rows.positions();
    }
    model.writeSelection(store, channel, route.pick(targets, mode, store.get(channel)));
  };
  Object.defineProperty(model, "selectedCount", {
    get: () => (store.get(channel) ? route.count : 0),
  });
  Object.assign(model, {
    selectionNote: (rowIndex: number) => route.note(positionOf(rowIndex)),
    selectionState: (rowIndex: number) => route.held(positionOf(rowIndex)),
    selectedAlone: (rowIndex: number) => route.alone(positionOf(rowIndex)),
    // Copying takes the records all of whose rows are selected.
    selectedTest: () => (position: number) => route.held(position) === "all",
    applySelect(rowIndex: number, mode: GridMode) {
      const position = positionOf(rowIndex);
      if (mode === "only" || mode === "toggle") {
        model.rangeAnchor = model.refAt(rowIndex);
        return write(mode, position);
      }
      let from = model.rangeAnchorIndex();
      if (from === null) {
        from = rowIndex;
        model.rangeAnchor = model.refAt(rowIndex);
      }
      write(mode, Math.min(from, rowIndex), Math.max(from, rowIndex) + 1);
    },
    applySelectAll: () => write("only", 0, model.current().length),
    setGroups(groups: object | null) {
      if (groups) route.refuseGroups();
      setGroups.call(model, groups);
    },
  } satisfies Partial<LineageGrid>);
}

/** Lets go of what a resolution's routes through lineage hold. */
function release(resolution: Resolution | undefined) {
  for (const route of resolution?.values() ?? []) route.through?.release();
}

/**
 * The lineage reader, for bindings whose store is of a table the chart's
 * marks come from rather than one they draw: `rowSelection({ store:
 * selectionStore(sales), channel, lineage })` on a chart of a groups' table
 * of `sales`. Bindings of the tables a chart draws need none.
 */
export const lineage: SelectionLineage = /* @__PURE__ */ Object.freeze({
  route: (target: Table, bound: RouteBinding, readers: readonly Reader[]) =>
    new Route(target, bound, readers),
  admit(routes: readonly LineageRoute[], bound: RouteBinding) {
    const budget = new Budget(bound);
    for (const route of routes as Route[]) {
      route.budget = budget;
      budget.routes.push(route);
    }
    const refusal = budget.refusal();
    if (refusal) throw refusal;
  },
  ambiguous(reader: Reader, nearest: Table, further: Table): never {
    const target = reader.table;
    throw new ChartError({
      code: "invalid-option",
      path: "rowSelection",
      message: `rowSelection: ${reader.name} reads ${named(target)}, which comes from ${named(further)}, whose store is bound, and binds a store of ${named(nearest)} too; bind one of them`,
    });
  },
  unrelated(readers: readonly Reader[], bound: RouteBinding) {
    const reader = readers.find(({ table }) => table.name !== undefined);
    if (reader && bound.table.name !== undefined)
      throw new ChartError({
        code: "invalid-option",
        path: "rowSelection",
        message: `rowSelection store: ${reader.name} reads ${named(reader.table)}, whose rows no lineage connects to ${named(bound.table)}; bind a store of ${named(reader.table)} (channel "${bound.channel}")`,
      });
  },
  highlight(model: ChartModel, routes: () => Resolution): LineageHighlight {
    // The routes of the configuration drawn: those of one it replaced let go of what they hold.
    let last: Resolution | undefined;
    /** The route through lineage of a table's rows to a highlighted binding, checked against its budget. */
    const through = (table: Table | undefined) => {
      const now = routes();
      if (last !== now) release(last);
      last = now;
      const route = table && now.get(table);
      const lineage = (route?.bound as { highlight?: boolean } | undefined)?.highlight
        ? route!.through
        : undefined;
      const refusal = lineage?.check();
      if (refusal) model.report?.(refusal);
      return lineage?.stopped ? undefined : lineage;
    };
    const covered: NonNullable<ChartModel["layoutCoverage"]> = (table) =>
      through(table)?.coverage();
    // A point reads the coverage its mark is budgeted for: a series' field
    // of those the mark draws, a band's or error bar's rows (`fieldsOf`).
    const inspected: NonNullable<ChartModel["coverage"]> = (mark, field, row, format) => {
      const fields = fieldsOf(mark);
      return through(mark.table)?.inspect(row, fields.includes(field) ? field : fields[0], format);
    };
    model.layoutCoverage = covered;
    model.coverage = inspected;
    return {
      covered(mark) {
        const route = through(mark.table);
        return route && ((...drawing) => route.draw(mark, ...drawing));
      },
      layout: (table) => through(table)?.bytes(),
      stop() {
        if (model.layoutCoverage === covered) model.layoutCoverage = undefined;
        if (model.coverage === inspected) model.coverage = undefined;
        release(last);
        release(routes());
      },
    };
  },
  grid(model: LineageGrid, changed: () => void, grouped: boolean): () => void {
    const at = "grid selectionStore";
    const { selectionStore: store, channel } = model;
    const target = model.data.source;
    if (!relationTo(target, store.source))
      throw new Error(
        `${at}: the view's table comes from no lineage of the store's; give a store of the view's table`,
      );
    const bound = {
      store,
      table: store.source,
      channel,
      lineage: undefined,
      budget: undefined,
      at,
      fixed: true,
    };
    const route = new Route(target, bound, []);
    if (grouped) route.refuseGroups();
    this.admit([route], bound);
    selectThrough(model, route);
    // Made apart from the model, which what follows the table must not keep.
    return route.follow(changed);
  },
  join: joined,
} satisfies LineageKit) as unknown as SelectionLineage;
