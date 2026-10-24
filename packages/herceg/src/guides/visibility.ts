// What legend entries name, as drawn. The keys an entry toggles (a series',
// what series stand for, a mark whole, a mark's rows of a field's value: see
// marks/hidden.ts and model/legend.ts) name series, rows, and items drawn in
// the chart, or in each panel of subplots as its own visibility leaves them.
// An entry is hidden where all of what it names is, mixed where some is,
// whatever hides it; showing it lets go of what would still hide any of it:
// in the chart, every key hiding it; in a panel, the setting there that
// decides it (model/legend.ts, `hiddenIn`). Rows are read where entries
// name them by a field's value, and where something hides rows of their mark.

import type { Table } from "../data/table.ts";
import type { Mark, RowParts } from "../marks/mark.ts";
import type { Series } from "../marks/series.ts";
import type { MarkSeries } from "../model/inspect.ts";
import type { HiddenKeys, LegendContent } from "../model/legend.ts";

type MarkKey = string | number;

/** The keys a legend entry names to hide and show, as marks/hidden.ts and seriesKey make them. */
export const markKey = (mark: MarkKey) => JSON.stringify({ mark });
export const rowKey = (mark: MarkKey, field: string, value: string) =>
  JSON.stringify({ mark, field, equals: value });
export const seriesKey = (mark: MarkKey, value: string) => JSON.stringify([mark, value]);

/** A row predicate's key, read; undefined for other keys. */
function predicateOf(key: string): { mark: MarkKey; field: string; equals: string } | undefined {
  if (!key.startsWith('{"mark":')) return undefined;
  const parsed = JSON.parse(key) as { mark: MarkKey; field?: string; equals?: string };
  return parsed.field === undefined ? undefined : (parsed as ReturnType<typeof predicateOf>);
}

/** The key hiding the mark of a series' or item's key (`[M, ...]`) whole; undefined for others. */
const ownerOf = (key: string) =>
  key[0] === "[" ? markKey((JSON.parse(key) as [MarkKey])[0]) : undefined;

/** Where things are drawn: the chart, or a panel of subplots, and what is hidden there. */
interface Scope {
  readonly panel: string | undefined;
  /** Whether what `key` names is hidden there, by it or by what hides it too. */
  hides(key: string): boolean;
  /** What the panel's legend set there unlike the chart; undefined in the chart. */
  readonly own: ReadonlyMap<string, boolean> | undefined;
  /** Whether `key` itself is set hidden in the chart. */
  stored(key: string): boolean;
  /** The keys set there, which row predicates are among. */
  readonly keys: () => Iterable<string>;
  /** Per mark, the values of each field whose rows are hidden there; read once asked. */
  values?: Map<MarkKey, Map<string, Set<string>>>;
}

/** What keys name drawn in a scope: a series, or a mark of items (an annotation), with its rows there. */
interface Unit {
  /** Its panel of subplots; undefined in the chart, and for marks of every panel. */
  readonly panel: string | undefined;
  readonly mark: Mark;
  readonly place: MarkKey;
  /** Undefined for an annotation, whose rows are `rows`, or all of its table's. */
  readonly s: Series | undefined;
  readonly rows: RowParts | undefined;
}

/** What entries name as a scene draws it, by key and by mark, whatever is hidden. */
export interface Drawn {
  readonly byKey: Map<string, Unit[]>;
  readonly byMark: Map<MarkKey, Unit[]>;
  /** Layout marks' items drawn in panels, by their identities' keys: their own keys there. */
  readonly items: Map<string, { panel: string; key: string }[]>;
}

/** What a scene's visibility shares with those showing entries would leave (see `shows`). */
interface Shared {
  /** Per mark, the values of each field entries name. */
  readonly named: Map<MarkKey, Map<string, Set<string>>>;
  /** Per category dictionary, the codes of values entries name. */
  readonly codes: Map<readonly string[], Map<string, number>>;
  /** Per unit and field, how many rows hold each value named, as the scene counted them. */
  readonly counts: Map<Unit, Map<string, Map<string, number>>>;
  /** Per unit and field, the rows holding each value named, found once what showing would leave asks. */
  readonly rows: Map<Unit, Map<string, Map<string, Int32Array | undefined>>>;
}

/** Rows of a unit (of a value of a field): how many, and how many are hidden. */
interface Tally {
  readonly count: number;
  readonly hidden: number;
}

const NONE = 0;
const SOME = 1;
const ALL = 2;
type Status = typeof NONE | typeof SOME | typeof ALL;

/** The visibility of what legend entries name in one scene, read as entries ask. */
export class Visibility {
  readonly #content: LegendContent;
  readonly #drawn: Drawn;
  /** Whether this is the visibility an entry's showing would leave, not the scene's. */
  readonly #after: boolean;
  readonly #scopes = new Map<string | undefined, Scope>();
  /** Per unit, the tally of its rows, what hides them, and its rows by the values of each field entries name. */
  readonly #totals = new Map<Unit, Tally>();
  readonly #hidingOf = new Map<Unit, Map<string, Set<string>>>();
  readonly #byField = new Map<Unit, Map<string, ByValue>>();
  readonly #checksOf = new Map<Unit, Check[] | undefined>();
  /** What this scene's visibility shares with those showing entries would leave (`shows`). */
  #shared: Shared = { named: new Map(), codes: new Map(), counts: new Map(), rows: new Map() };
  /** Layout marks' items outside panels by what they stand for (`#itemsOf`), read once asked. */
  #loose: Map<string, string[]> | undefined;
  /** Whether a key hidden stands for more (`#standing`), read once asked. */
  #raw: boolean | undefined;

  /** Of what a scene draws (`drawnOf`), as `content` hides it: the scene's, or `after` an entry is shown. */
  constructor(content: LegendContent, drawn: Drawn, after = false) {
    this.#content = content;
    this.#drawn = drawn;
    this.#after = after;
  }

  /**
   * How what `keys` name is drawn, in panel `panel` (in every scope
   * without one): hidden (true), shown (false), or "mixed" where some is;
   * undefined where nothing drawn has it.
   */
  state(keys: readonly string[], panel?: string): boolean | "mixed" | undefined {
    this.#name(keys);
    let [any, some, all] = [false, false, true];
    this.#each(keys, panel, (status) => {
      any = true;
      if (status !== NONE) some = true;
      if (status !== ALL) all = false;
    });
    return !any ? undefined : all ? true : some && "mixed";
  }

  /**
   * The state of each entry of `targets` (see `state`): the rows holding
   * the values they name counted together, a pass per field of a unit.
   */
  states(
    targets: readonly (readonly string[])[],
    panel?: string,
  ): (boolean | "mixed" | undefined)[] {
    for (const keys of targets) this.#name(keys);
    return targets.map((keys) => this.state(keys, panel));
  }

  /** Notes the values `keys` name of marks' fields, which rows are counted for together (`byValue`). */
  #name(keys: readonly string[]): void {
    for (const key of keys) {
      const predicate = predicateOf(key);
      if (predicate) this.#asked(predicate.mark, predicate.field).add(predicate.equals);
    }
  }

  /** The values of a mark's field entries name. */
  #asked(mark: MarkKey, field: string): Set<string> {
    const { named } = this.#shared;
    const fields = named.get(mark) ?? new Map<string, Set<string>>();
    named.set(mark, fields);
    const values = fields.get(field) ?? new Set<string>();
    fields.set(field, values);
    return values;
  }

  /**
   * What showing an entry toggling `keys` lets go of, in panel `panel` (in
   * the chart without one): `keys`, and whatever would still hide what
   * they name; undefined where that is `keys` alone.
   */
  shows(keys: readonly string[], panel?: string): readonly string[] | undefined {
    this.#name(keys);
    const out = new Set(keys);
    const given = out.size;
    // In charts of subplots, letting go of keys changes what panels set
    // (model/panel-legends.ts), which may leave other keys hiding: where
    // panels' own settings name what the keys name, what hides it is read
    // again as showing would leave it, until nothing does. So too where a
    // key of a series that came since stands for more than the scene hides
    // by it: a click keeps keys as what they stand for (`kept`). Elsewhere
    // the scene's visibility says, with the keys, pressed in a panel,
    // deciding what they name there before the chart's.
    const { split, hidden, panelLegends } = this.#content;
    const touched = split && this.#touched(keys, panel);
    const showing = touched ? panelLegends?.showing : this.#standing() ? kept : undefined;
    const shown = touched || panel === undefined ? undefined : new Set(keys);
    const after = () => {
      const next = new Visibility(
        { ...this.#content, hidden: showing!(hidden as HiddenKeys, [...out], panel) },
        this.#drawn,
        true,
      );
      next.#shared = this.#shared;
      return next;
    };
    let now: Visibility = showing ? after() : this;
    for (;;) {
      const before = out.size;
      now.#each(
        keys,
        panel,
        (status, by) => {
          if (status !== NONE) for (const key of by()) out.add(key);
        },
        shown,
      );
      if (!showing || out.size === before) break;
      now = after();
    }
    return out.size > given ? [...out] : undefined;
  }

  /** Whether the chart hides a key by itself that stands for more (`kept`). */
  #standing(): boolean {
    const { hidden } = this.#content;
    this.#raw ??= [...hidden].some((key) => (hidden.groups?.get(key) ?? key) !== key);
    return this.#raw;
  }

  /**
   * Whether panels' own settings (in `panel`, or in any without one) name
   * what `keys` name there: a series, what it stands for, an item, or
   * their mark whole or its rows, whose state showing the keys changes.
   */
  #touched(keys: readonly string[], panel: string | undefined): boolean {
    const { panels, groups } = this.#content.hidden;
    if (!panels?.size) return false;
    const touches = (
      where: string | undefined,
      chain: readonly (string | undefined)[],
      place: MarkKey,
    ) => {
      const own =
        where === undefined || (panel !== undefined && where !== panel)
          ? undefined
          : panels.get(where);
      if (!own?.size) return false;
      if (chain.some((key) => key !== undefined && own.has(key))) return true;
      // Its mark whole, or rows of it.
      for (const key of own.keys())
        if (key.startsWith('{"mark":') && (JSON.parse(key) as { mark: MarkKey }).mark === place)
          return true;
      return false;
    };
    const { byKey, byMark, items } = this.#drawn;
    const unitTouched = (unit: Unit) =>
      touches(unit.panel, unit.s ? [unit.s.key, groups?.get(unit.s.key)] : [], unit.place);
    for (const key of keys) {
      if ((byKey.get(key) ?? []).some(unitTouched)) return true;
      const predicate = predicateOf(key);
      if (predicate && (byMark.get(predicate.mark) ?? []).some(unitTouched)) return true;
      for (const { panel: where, key: own } of items.get(key) ?? [])
        if (touches(where, [own, key], (JSON.parse(own) as [MarkKey])[0])) return true;
    }
    return false;
  }

  #scope(panel: string | undefined): Scope {
    let scope = this.#scopes.get(panel);
    if (scope) return scope;
    const { hidden } = this.#content;
    const stored = (key: string) => Set.prototype.has.call(hidden, key);
    const own = panel === undefined ? undefined : hidden.panels?.get(panel);
    scope =
      panel === undefined
        ? { panel, hides: (key) => hidden.has(key), own, stored, keys: () => hidden }
        : {
            panel,
            hides: (key) => hidden.hiddenIn!(key, panel),
            own,
            stored,
            keys: () => [...hidden, ...(own?.keys() ?? [])],
          };
    this.#scopes.set(panel, scope);
    return scope;
  }

  /**
   * Visits what each of `keys` names in `panel` (or every scope): its
   * status, and what would still hide it, were an entry of `keys` shown there.
   */
  #each(
    keys: readonly string[],
    panel: string | undefined,
    visit: (status: Status, by: () => Iterable<string>) => void,
    /** Keys shown in `panel`, which decide what they name there (see `shows`). */
    shown?: ReadonlySet<string>,
  ): void {
    const within = (where: string | undefined) => panel === undefined || where === panel;
    const groups = this.#content.hidden.groups;
    const { byKey, byMark, items } = this.#drawn;
    for (const key of keys) {
      let found = false;
      for (const unit of byKey.get(key) ?? []) {
        if (!within(unit.panel)) continue;
        found = true;
        visit(this.#status(unit), () => [
          ...this.#hiding(unit, panel, shown),
          ...this.#rowsHiding(unit, panel, shown),
        ]);
      }
      const predicate = predicateOf(key);
      if (predicate)
        for (const unit of byMark.get(predicate.mark) ?? []) {
          const { field, equals } = predicate;
          if (!within(unit.panel) || !unit.mark.table?.has(field)) continue;
          const tally = this.#byValue(unit, field).tally(equals);
          if (tally.count === 0) continue;
          found = true;
          visit(
            this.#whole(unit) || tally.hidden === tally.count
              ? ALL
              : tally.hidden > 0
                ? SOME
                : NONE,
            () => [
              ...this.#hiding(unit, panel, shown),
              ...this.#rowsHiding(unit, panel, shown, [field, equals]),
            ],
          );
        }
      for (const { panel: where, key: own } of items.get(key) ?? []) {
        if (!within(where)) continue;
        found = true;
        const scope = this.#scope(where);
        visit(scope.hides(own) ? ALL : NONE, () =>
          this.#deciding(scope, [own, key, ownerOf(own)], panel, shown),
        );
      }
      // What marks do not draw as series or rows is as the chart has it:
      // layout marks' items outside panels, by their own keys or what they
      // stand for, and what annotations' labels stand for. Keys of series,
      // marks, and scales naming nothing drawn have no say.
      if (!found && !key.startsWith('{"mark":') && !key.startsWith('{"scale":')) {
        const scope = this.#scope(panel);
        const own = key[0] === "[" ? (this.#item(key) ? [key] : []) : (this.#itemsOf(key) ?? [key]);
        for (const item of own)
          visit(scope.hides(item) ? ALL : NONE, () =>
            this.#deciding(scope, [item, groups?.get(item), ownerOf(item)], panel, shown),
          );
      }
    }
  }

  /** Whether `key` (`[M, ...]`) is a layout mark's item's: its mark draws no series or rows here. */
  #item(key: string): boolean {
    return !this.#drawn.byMark.has((JSON.parse(key) as [MarkKey])[0]);
  }

  /** The keys of layout marks' items outside panels standing for `identity`; undefined for none. */
  #itemsOf(identity: string): string[] | undefined {
    if (!this.#loose) {
      this.#loose = new Map();
      for (const [key, of] of this.#content.hidden.groups ?? [])
        if (key[0] === "[" && this.#item(key)) {
          const keys = this.#loose.get(of) ?? [];
          keys.push(key);
          this.#loose.set(of, keys);
        }
    }
    return this.#loose.get(identity);
  }

  /** How much of a unit is hidden: all where it is hidden whole, else as many of its rows as are. */
  #status(unit: Unit): Status {
    if (this.#whole(unit)) return ALL;
    if (!this.#values(unit)) return NONE;
    // The chart's series as the scene drew them, from those rows: their rows were counted then.
    const { s } = unit;
    const { count, hidden } =
      unit.panel === undefined && s?.unhidden && !this.#after
        ? { count: s.unhidden.length, hidden: s.unhidden.length - s.length }
        : this.#total(unit);
    return hidden === 0 ? NONE : hidden === count ? ALL : SOME;
  }

  /** Whether a unit is hidden whole there: its series, what it stands for, or its mark. */
  #whole({ s, place, panel }: Unit): boolean {
    return this.#scope(panel).hides(s ? s.key : markKey(place));
  }

  /** What would still hide a unit whole, were an entry shown in `panel` (`#deciding`). */
  #hiding(unit: Unit, panel: string | undefined, shown?: ReadonlySet<string>): string[] {
    if (!this.#whole(unit)) return [];
    const { s, place } = unit;
    const whole = markKey(place);
    const chain = s ? [s.key, this.#content.hidden.groups?.get(s.key), whole] : [whole];
    return this.#deciding(this.#scope(unit.panel), chain, panel, shown);
  }

  /**
   * What hides what `chain` names in `scope` (its keys, most specific
   * first, as `hiddenIn` reads them), for an entry shown in `panel` (the
   * chart's without one): the panel's own setting deciding it; else every
   * key the chart sets of them, or, shown in a panel, its most specific.
   * Keys `shown` there decide before the chart's (see `shows`).
   */
  #deciding(
    scope: Scope,
    chain: readonly (string | undefined)[],
    panel: string | undefined,
    shown?: ReadonlySet<string>,
  ): string[] {
    for (const key of chain) {
      if (key !== undefined && shown?.has(key)) return [];
      const set = key === undefined ? undefined : scope.own?.get(key);
      if (set !== undefined) return set ? [key!] : [];
    }
    if (panel !== undefined) return [chain[0]!];
    return [...new Set(chain)].filter(
      (key): key is string => key !== undefined && scope.stored(key),
    );
  }

  /**
   * The keys of predicates hiding the unit's rows (those holding `value`,
   * a field and its value), deciding each (`#deciding`).
   */
  #rowsHiding(
    unit: Unit,
    panel: string | undefined,
    shown?: ReadonlySet<string>,
    value?: readonly [field: string, equals: string],
  ): string[] {
    const checks = this.#checks(unit);
    if (!checks) return [];
    let hiding: Map<string, Set<string>> | undefined;
    if (value) hiding = this.#byValue(unit, value[0]).hiding(value[1]);
    else {
      hiding = this.#hidingOf.get(unit);
      if (!hiding) {
        hiding =
          hidingBy((visit) => eachRow(unit, (row) => visit(row, "")), checks).get("") ?? new Map();
        this.#hidingOf.set(unit, hiding);
      }
    }
    const scope = this.#scope(unit.panel);
    const whole = markKey(unit.place);
    return [...(hiding ?? [])].flatMap(([field, values]) =>
      [...values].flatMap((held) =>
        this.#deciding(scope, [rowKey(unit.place, field, held), undefined, whole], panel, shown),
      ),
    );
  }

  /** The values of each field whose rows of the unit's mark are hidden in its scope, if any are. */
  #values(unit: Unit): Map<string, Set<string>> | undefined {
    const scope = this.#scope(unit.panel);
    if (!scope.values) {
      scope.values = new Map();
      for (const key of scope.keys()) {
        const predicate = predicateOf(key);
        if (!predicate || !scope.hides(key)) continue;
        const fields = scope.values.get(predicate.mark) ?? new Map<string, Set<string>>();
        scope.values.set(predicate.mark, fields);
        const values = fields.get(predicate.field) ?? new Set<string>();
        fields.set(predicate.field, values);
        values.add(predicate.equals);
      }
    }
    return unit.mark.table ? scope.values.get(unit.place) : undefined;
  }

  /** The tally of all the unit's rows. */
  #total(unit: Unit): Tally {
    let total = this.#totals.get(unit);
    if (!total) {
      const hides = hiderOf(this.#checks(unit));
      let [count, hidden] = [0, 0];
      eachRow(unit, (row) => {
        count++;
        if (hides?.(row)) hidden++;
      });
      total = { count, hidden };
      this.#totals.set(unit, total);
    }
    return total;
  }

  /** The unit's rows by the values of `field`, counted once (`ByValue`). */
  #byValue(unit: Unit, field: string): ByValue {
    let fields = this.#byField.get(unit);
    if (!fields) {
      fields = new Map();
      this.#byField.set(unit, fields);
    }
    let found = fields.get(field);
    if (!found) {
      found = byValue(
        unit,
        field,
        this.#checks(unit),
        (dictionary, values) => this.#codesOf(dictionary, values),
        this.#asked(unit.place, field),
        // What showing would leave counts the rows holding the values named, not every row.
        this.#after
          ? { rowsOf: (value) => this.#rowsOf(unit, field, value) }
          : { counts: inner(inner(this.#shared.counts, unit), field) },
      );
      fields.set(field, found);
    }
    return found;
  }

  /**
   * The codes of `values` in a category's dictionary (-1 for none), found
   * once a scene for all its units: those not found yet in one pass.
   */
  #codesOf(dictionary: readonly string[], values: readonly string[]): number[] {
    let codes = this.#shared.codes.get(dictionary);
    if (!codes) {
      codes = new Map();
      this.#shared.codes.set(dictionary, codes);
    }
    const sought = new Set(values.filter((value) => !codes.has(value)));
    for (let code = 0; sought.size > 0 && code < dictionary.length; code++)
      if (sought.delete(dictionary[code]!)) codes.set(dictionary[code]!, code);
    for (const value of sought) codes.set(value, -1);
    return values.map((value) => codes.get(value)!);
  }

  /**
   * The unit's rows holding `value` of `field`: found in one pass with every
   * value named and not found yet, and shared by the scene's visibility and
   * every one showing would leave; undefined for a value held by more than
   * an eighth of them, whose rows are read in passes instead (at most eight
   * values are), so that the rows kept take less room than the unit's.
   */
  #rowsOf(unit: Unit, field: string, value: string): Int32Array | undefined {
    const { rows } = this.#shared;
    const fields = rows.get(unit) ?? new Map<string, Map<string, Int32Array | undefined>>();
    rows.set(unit, fields);
    const found = fields.get(field) ?? new Map<string, Int32Array | undefined>();
    fields.set(field, found);
    if (!found.has(value)) {
      const asked = this.#asked(unit.place, field).add(value);
      const values = [...asked].filter((v) => !found.has(v));
      const most = Math.max(64, sizeOf(unit) >> 3);
      // As many rows as the scene counted, where it did; dense values none.
      const counted = this.#shared.counts.get(unit)?.get(field);
      const kept = new Map<string, { rows: Int32Array; n: number }>();
      for (const v of values) {
        const count = counted?.get(v);
        if (count === undefined) kept.set(v, { rows: new Int32Array(16), n: 0 });
        else if (count <= most) kept.set(v, { rows: new Int32Array(count), n: 0 });
      }
      const { at, held } = heldValues(
        unit.mark.table!,
        field,
        [...kept.keys()],
        (dictionary, sought) => this.#codesOf(dictionary, sought),
      );
      if (held.size > 0)
        eachRow(unit, (row) => {
          const v = held.get(at[row]!);
          const k = v === undefined ? undefined : kept.get(v);
          if (!k) return;
          if (k.n === most) {
            kept.delete(v!);
            return;
          }
          if (k.n === k.rows.length) {
            const grown = new Int32Array(Math.min(most, k.n * 2));
            grown.set(k.rows);
            k.rows = grown;
          }
          k.rows[k.n++] = row;
        });
      for (const v of values) {
        const k = kept.get(v);
        found.set(v, k?.rows.subarray(0, k.n));
      }
    }
    return found.get(value);
  }

  /** Readers of the fields predicates hide the unit's rows by in its scope; undefined where none hides any. */
  #checks(unit: Unit): Check[] | undefined {
    if (this.#checksOf.has(unit)) return this.#checksOf.get(unit);
    const values = this.#values(unit);
    const table = unit.mark.table!;
    const checks =
      values &&
      [...values]
        .filter(([name]) => table.has(name))
        .map(([name, values]) => ({ name, values, at: reader(table, name) }));
    this.#checksOf.set(unit, checks);
    return checks;
  }
}

/** A field predicates hide rows by, the values they hide, and a reader of it. */
interface Check {
  readonly name: string;
  readonly values: ReadonlySet<string>;
  readonly at: (row: number) => string | undefined;
}

/** Whether `checks` hide a row; undefined without checks. */
function hiderOf(checks: readonly Check[] | undefined): ((row: number) => boolean) | undefined {
  return (
    checks &&
    ((row) =>
      checks.some(({ values, at }) => {
        const held = at(row);
        return held !== undefined && values.has(held);
      }))
  );
}

/**
 * Of rows (`each` visits them, each with a key) `checks` hide, by key: the
 * values of each field hiding them.
 */
function hidingBy(
  each: (visit: (row: number, key: string) => void) => void,
  checks: readonly Check[],
): Map<string, Map<string, Set<string>>> {
  const out = new Map<string, Map<string, Set<string>>>();
  each((row, of) => {
    for (const { name, values, at } of checks) {
      const held = at(row);
      if (held === undefined || !values.has(held)) continue;
      let fields = out.get(of);
      if (!fields) {
        fields = new Map();
        out.set(of, fields);
      }
      let hiding = fields.get(name);
      if (!hiding) {
        hiding = new Set();
        fields.set(name, hiding);
      }
      hiding.add(held);
    }
  });
  return out;
}

/**
 * The chart's keys as a click keeps them (dom/chart.ts `setVisibility`):
 * each as what it stands for, without `keys` shown in the chart (shown in
 * a panel, the chart's stay); panels' own settings as they are.
 */
function kept(hidden: HiddenKeys, keys: readonly string[], panel: string | undefined): HiddenKeys {
  const { groups, panels } = hidden;
  // A set of the chart's own kind, sharing what series stand for.
  const next = Object.assign(new (hidden.constructor as typeof HiddenKeys)(), { groups, panels });
  const identity = (key: string) => groups.get(key) ?? key;
  const gone = new Set(panel === undefined ? keys.map(identity) : []);
  for (const key of hidden) if (!gone.has(identity(key))) next.add(identity(key));
  return next;
}

/**
 * A unit's rows by the values of a field: how many hold a value, and how
 * many of those are hidden; and what hides the rows holding a value
 * (field to values). Each is read for every value entries name so far
 * (`Visibility.states`) in one pass.
 */
interface ByValue {
  tally(value: string): Tally;
  hiding(value: string): Map<string, Set<string>> | undefined;
}

function byValue(
  unit: Unit,
  field: string,
  checks: readonly Check[] | undefined,
  /** Values' codes in a category's dictionary; -1 for none. */
  codesOf: (dictionary: readonly string[], values: readonly string[]) => number[],
  /** The values entries name, which grow as they ask. */
  asked: Set<string>,
  {
    rowsOf,
    counts,
  }: {
    /** The rows holding a value, where they are kept (see `Visibility.#rowsOf`); else rows are read in a pass. */
    rowsOf?: (value: string) => Int32Array | undefined;
    /** Where to note how many rows hold each value counted. */
    counts?: Map<string, number>;
  },
): ByValue {
  const table = unit.mark.table!;
  const hides = hiderOf(checks);
  const tallies = new Map<string, Tally>();
  const blockers = new Map<string, Map<string, Set<string>> | undefined>();
  /**
   * The values to read with `value`: those asked of it whose `done` is not
   * read yet, where a pass reads them; alone where its rows are found.
   */
  const batch = (value: string, done: Map<string, unknown>) => {
    asked.add(value);
    return rowsOf ? [value] : [...asked].filter((v) => !done.has(v));
  };
  /** Visits the rows holding `values`, each with the value it holds. */
  const each = (values: readonly string[]) => (visit: (row: number, value: string) => void) => {
    // Values whose rows are kept, read from them; the others in a pass.
    const passed: string[] = rowsOf ? [] : [...values];
    if (rowsOf) {
      for (const v of values) {
        const rows = rowsOf(v);
        if (rows) for (const row of rows) visit(row, v);
        else passed.push(v);
      }
      if (passed.length === 0) return;
    }
    const { at, held } = heldValues(table, field, passed, codesOf);
    eachRow(unit, (row) => {
      const v = held.get(at[row]!);
      if (v !== undefined) visit(row, v);
    });
  };
  const count = (values: readonly string[]) => {
    const tallied = new Map(values.map((v) => [v, { count: 0, hidden: 0 }]));
    for (const [v, tally] of tallied) tallies.set(v, tally);
    each(values)((row, v) => {
      const tally = tallied.get(v)!;
      tally.count++;
      if (hides?.(row)) tally.hidden++;
    });
    for (const [v, { count }] of tallied) counts?.set(v, count);
  };
  return {
    tally(value) {
      if (!tallies.has(value)) count(batch(value, tallies));
      return tallies.get(value)!;
    },
    hiding(value) {
      if (!checks) return undefined;
      if (!blockers.has(value)) {
        const values = batch(value, blockers);
        const found = hidingBy(each(values), checks);
        for (const v of values) blockers.set(v, found.get(v));
      }
      return blockers.get(value);
    },
  };
}

/**
 * `values` (as row predicates name them) as rows of `table` hold `field`:
 * a category's codes, or numbers ("null" a missing one, NaN; others
 * written one way, as `String(Number(text))`, and "NaN" naming none), and
 * where rows hold them.
 */
function heldValues(
  table: Table,
  field: string,
  values: readonly string[],
  codesOf: (dictionary: readonly string[], values: readonly string[]) => number[],
): { at: ArrayLike<number>; held: Map<number, string> } {
  const held = new Map<number, string>();
  if (table.kind(field as never) === "category") {
    const { codes, dictionary } = table.categories(field as never);
    const found = codesOf(dictionary, values);
    values.forEach((v, i) => {
      if (found[i]! >= 0) held.set(found[i]!, v);
    });
    return { at: codes, held };
  }
  for (const v of values) {
    const n = v === "null" ? Number.NaN : Number(v);
    if (v === "null" || (!Number.isNaN(n) && String(n) === v)) held.set(n, v);
  }
  return { at: table.numbers(field as never), held };
}

/** What a scene draws that entries name: its marks' series and rows in each scope, and layout items. */
export function drawnOf(
  content: LegendContent,
  marks: readonly MarkSeries[],
  places: ReadonlyMap<object, MarkKey>,
  /** In charts of subplots, layout marks' items in each panel: their identities' keys and their own. */
  items: Iterable<readonly [panel: string, identity: string, keys: readonly string[]]> = [],
): Drawn {
  const drawn: Drawn = { byKey: new Map(), byMark: new Map(), items: new Map() };
  const groups = content.hidden.groups;
  const index = (key: string | undefined, unit: Unit) => {
    if (key === undefined) return;
    const list = drawn.byKey.get(key) ?? [];
    if (list.at(-1) !== unit) list.push(unit);
    drawn.byKey.set(key, list);
  };
  const add = (
    panel: string | undefined,
    mark: Mark,
    series: readonly Series[],
    rows?: RowParts,
  ) => {
    const place = places.get(mark)!;
    const units = drawn.byMark.get(place) ?? [];
    drawn.byMark.set(place, units);
    const whole = markKey(place);
    if (mark.labelEntries) {
      const unit: Unit = { panel, mark, place, s: undefined, rows };
      units.push(unit);
      index(whole, unit);
      return;
    }
    for (const s of series) {
      const unit: Unit = { panel, mark, place, s, rows: undefined };
      units.push(unit);
      for (const key of [s.key, s.entry, groups?.get(s.key), whole]) index(key, unit);
    }
  };
  const { split } = content;
  if (!split) {
    for (const { mark, series } of marks) add(undefined, mark, series);
    return drawn;
  }
  // Marks of every panel follow the chart's visibility in each.
  for (const { mark, series } of marks) if (mark.spec.panel === "*") add(undefined, mark, series);
  split.keys.forEach((panel, p) => {
    split.panels[p]!.forEach(({ mark, series, rows }, m) => {
      if (split.members?.[p]?.[m] === false || mark.spec.panel === "*") return;
      add(panel, mark, series, rows);
    });
  });
  for (const [panel, identity, keys] of items) {
    const list = drawn.items.get(identity) ?? [];
    for (const key of keys) list.push({ panel, key });
    drawn.items.set(identity, list);
  }
  return drawn;
}

/** A field's value at a row as row predicates name it (`hiddenRows`): a category's by its code. */
function reader(table: Table, field: string): (row: number) => string | undefined {
  if (table.kind(field) !== "category") return (row) => String(table.value(field as never, row));
  const { codes, dictionary } = table.categories(field as never);
  return (row) => dictionary[codes[row]!];
}

/** The map `outer` holds under `key`, made there where it has none. */
function inner<K, V extends Map<unknown, unknown>>(outer: Map<K, V>, key: K): V {
  let found = outer.get(key);
  if (!found) {
    found = new Map() as V;
    outer.set(key, found);
  }
  return found;
}

/** How many rows a unit has (`eachRow` visits). */
function sizeOf({ s, rows, mark }: Unit): number {
  if (s) return (s.unhidden ?? s).length;
  if (rows) return rows.reduce((sum, part) => sum + part.length, 0);
  return mark.table?.length ?? 0;
}

/** Each row of a unit: its series', those predicates hide included, or an annotation's drawn there. */
function eachRow(unit: Unit, visit: (row: number) => void): void {
  const { s, rows, mark } = unit;
  if (s) {
    const all = s.unhidden ?? s;
    for (let k = 0; k < all.length; k++) visit(all.rows ? all.rows[k]! : k);
  } else if (rows) {
    for (const part of rows) for (const row of part) visit(row);
  } else if (mark.table) {
    for (let row = 0; row < mark.table.length; row++) visit(row);
  }
}
