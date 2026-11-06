// Scales of categories with fixed outputs: a chart's or a grid's `scales`
// of type "ordinal", and the default ones an unnamed field reads ("symbol",
// "dash", and "color" where the chart or grid declares it). A value's
// place in the domain is kept for the scale's life, so a value keeps its
// output as data streams, leaves, and comes back, in every mark, panel, or
// cell reading the scale. Without a declared "color", a chart's field
// takes the chart's colors of what its values stand for
// (marks/features/identity-colors.ts).

import type { Table } from "../data/table.ts";
import type { OrdinalScaleSpec } from "../spec/encoding.ts";

/**
 * The outputs values take by their place in a scale's domain where its
 * `map` gives none: a list cycled (a theme's palette), or an output per
 * place (a grid's palette references, which its renderer cycles).
 */
export type Defaults<V> = readonly V[] | ((place: number) => V);

/** What channels read a field's values through: a scale of the chart's or grid's, or a chart's colors by identity. */
export interface CategoryScale {
  readonly name: string;
  readonly spec: OrdinalScaleSpec | undefined;
  /** Reads `field` of `table` into the domain from now on. */
  read(table: Table, field: string): void;
  /** A value's place in the domain; undefined outside an explicit domain. */
  place(value: string): number | undefined;
  /** A value's output, as `OrdinalScale.output`. */
  output<V>(value: string, defaults: Defaults<V>, fallback: V): V;
  /** The output of missing values, where the scale gives them one. */
  missing?(): string | undefined;
}

/** A field of a mark's table a scale reads its values from. */
interface Source {
  table: Table;
  field: string;
  /** The table version last read. */
  version: number;
}

export class OrdinalScale implements CategoryScale {
  readonly name: string;
  readonly spec: OrdinalScaleSpec | undefined;
  /** Each value's place in the domain, in order: sticky once given. */
  readonly #places = new Map<string, number>();
  readonly #sources: Source[] = [];

  /**
   * `previous`, the scale of the configuration before with the same
   * settings, hands over its values' places, not the tables it read.
   */
  constructor(name: string, spec: OrdinalScaleSpec | undefined, previous?: OrdinalScale) {
    this.name = name;
    this.spec = spec;
    if (previous) for (const [value, place] of previous.#places) this.#places.set(value, place);
    for (const value of spec?.domain ?? [])
      if (!this.#places.has(value)) this.#places.set(value, this.#places.size);
  }

  /** Reads `field` of `table` into the domain from now on, unless the domain is given. */
  read(table: Table, field: string): void {
    if (this.spec?.domain) return;
    if (!this.#sources.some((s) => s.table === table && s.field === field))
      this.#sources.push({ table, field, version: -1 });
  }

  /**
   * Brings the domain up to date with the fields it reads, in the order the
   * marks read them: each field's dictionary in its order (a pandas
   * Categorical's or Arrow dictionary's own; first appearance for strings).
   */
  update(): void {
    for (const source of this.#sources) {
      const { table, field } = source;
      if (source.version === table.version) continue;
      source.version = table.version;
      for (const value of table.categories(field as never).dictionary) this.#add(value);
    }
  }

  #add(value: string): void {
    if (!this.#places.has(value)) this.#places.set(value, this.#places.size);
  }

  /** A value's place in the domain; undefined outside an explicit domain. */
  place(value: string): number | undefined {
    if (!this.spec?.domain) this.#add(value);
    return this.#places.get(value);
  }

  /** The domain's values, in order. */
  get domain(): readonly string[] {
    return [...this.#places.keys()];
  }

  /**
   * A value's output: its `map` entry, else the output of its place among
   * `defaults` (cycled), else (outside an explicit domain, or with no
   * defaults) `unknown`, or `fallback` without one.
   */
  output<V>(value: string, defaults: Defaults<V>, fallback: V): V {
    const map = this.spec?.map;
    const mapped = map && Object.hasOwn(map, value) ? map[value] : undefined;
    if (mapped !== undefined) return mapped as V;
    const place = this.place(value);
    const output = place === undefined ? undefined : defaultAt(defaults, place);
    return output ?? (this.spec?.unknown as V | undefined) ?? fallback;
  }
}

/** The default output at `place`: the list's, cycled; undefined for an empty list. */
export function defaultAt<V>(defaults: Defaults<V>, place: number): V | undefined {
  if (typeof defaults === "function") return defaults(place);
  return defaults.length > 0 ? defaults[place % defaults.length] : undefined;
}
