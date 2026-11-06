// A chart's colors of a field's values where it declares no "color" scale
// (see encoding/category-scales.ts).

import { type CategoryScale, type Defaults, defaultAt } from "../../encoding/category-scales.ts";

/**
 * A field's values' colors where the chart declares no "color" scale: the
 * chart's colors of what each value stands for (see model/identity.ts), by
 * the identity keys `prefix` starts, so a bar or point colored by a field
 * has the color the series of that value have: the color the chart's field
 * displays give the value, else the color at the chart's palette slot for
 * its key, which the compilation hands over before each scene.
 */
export class IdentityColors implements CategoryScale {
  readonly name = "color";
  readonly spec = undefined;
  readonly #prefix: string;
  readonly #chart: { slot: ((key: string) => number) | undefined };
  /** A value's display color (null: missing values'), which it takes over the palette's (fields/colors.ts). */
  readonly #shown: ((value: string | null) => string | undefined) | undefined;
  /** Values in the order first colored, which keys of colors list them in. */
  readonly #places = new Map<string, number>();

  constructor(
    prefix: string,
    chart: { slot: ((key: string) => number) | undefined },
    shown?: (value: string | null) => string | undefined,
  ) {
    this.#prefix = prefix;
    this.#chart = chart;
    this.#shown = shown;
  }

  read(): void {}

  place(value: string): number {
    let place = this.#places.get(value);
    if (place === undefined) {
      place = this.#places.size;
      this.#places.set(value, place);
    }
    return place;
  }

  /** The identity key of a value. */
  key(value: string): string {
    return `${this.#prefix}${JSON.stringify(value)}}`;
  }

  output<V>(value: string, defaults: Defaults<V>, fallback: V): V {
    this.place(value);
    const shown = this.#shown?.(value);
    if (shown !== undefined) return shown as V;
    const slot = this.#chart.slot?.(this.key(value));
    return (slot === undefined ? undefined : defaultAt(defaults, slot)) ?? fallback;
  }

  missing(): string | undefined {
    return this.#shown?.(null);
  }
}
