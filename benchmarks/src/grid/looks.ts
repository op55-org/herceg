// The looks scenarios' conditional formatting, which every grid is
// configured to show: six presented columns of the first screen.
//
//   n0  fill by threshold: base, from 500, from 900
//   n1  fill by threshold from 50 and from 90, none below
//   n2  fill along a gradient over the extent of the rows shown
//   n3  fill where the value is among the 100 largest of the rows shown (ties in)
//   c0  text color by label: "active" and "blocked"
//   n4  a row condition: rows over 900 fill every cell without a fill of its own
//
// Text over a fill without a color of its own is black or white, whichever
// has the higher WCAG contrast with the fill (every fill is opaque). The
// rules here are the adapters' that compute looks in adapter code; the
// reference (reference.ts) shares only the constants and works looks out
// on its own.

import type { GridTable } from "./fixture.ts";

/** A cell's look: its background and text color as "#rrggbb"; undefined where none. */
export interface CellLook {
  fill?: string | undefined;
  color?: string | undefined;
}

export const N0_STEPS = {
  base: "#e8f5e9",
  steps: [
    [500, "#1565c0"],
    [900, "#c62828"],
  ],
} as const;
export const N1_STEPS = {
  steps: [
    [50, "#bbdefb"],
    [90, "#0d47a1"],
  ],
} as const;
/** The gradient's ends; every color between them takes black text. */
export const N2_RANGE = ["#ffffff", "#ef9a9a"] as const;
export const N3_TOP = 100;
export const N3_FILL = "#ffd54f";
export const C0_COLORS: Readonly<Record<string, string>> = {
  active: "#2e7d32",
  blocked: "#c62828",
};
export const N4_OVER = 900;
export const ROW_FILL = "#fff8e1";

/** The fields looks read. */
export const LOOK_FIELDS = ["n0", "n1", "n2", "n3", "c0", "n4"] as const;

/** What a scan of the rows shown gives the looks: the gradient's domain and the 100th largest value. */
export interface LookDomain {
  /** [min, max] of n2's finite values; undefined without any. */
  extent: readonly [number, number] | undefined;
  /** The 100th largest of n3's finite values (the smallest where fewer); NaN without any. */
  nth: number;
}

function step(
  value: number,
  thresholds: { base?: string; steps: readonly (readonly [number, string])[] },
): string | undefined {
  if (Number.isNaN(value)) return undefined;
  let color = thresholds.base;
  for (const [at, c] of thresholds.steps) if (value >= at) color = c;
  return color;
}

const hex = (channel: number) => Math.round(channel).toString(16).padStart(2, "0");

function channels(color: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** The gradient's color at `value` within `extent`, linear in sRGB; undefined for missing values. */
export function gradient(value: number, extent: LookDomain["extent"]): string | undefined {
  if (Number.isNaN(value) || !extent) return undefined;
  const [min, max] = extent;
  // A domain of one value maps it to the range's end, as Herceg's scales do.
  const t = max === min ? 1 : Math.min(1, Math.max(0, (value - min) / (max - min)));
  const a = channels(N2_RANGE[0]);
  const b = channels(N2_RANGE[1]);
  return `#${a.map((c, i) => hex(c + (b[i]! - c) * t)).join("")}`;
}

/** WCAG relative luminance of a "#rrggbb" color. */
function luminance(color: string): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channels(color);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Black or white, whichever contrasts more with `fill`. */
export function ink(fill: string): string {
  const l = luminance(fill);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#ffffff";
}

/**
 * The look of field `name`'s cell in a row, from the row's values of the
 * looks' fields (`value`: numbers NaN when missing, `c0` a label or
 * undefined) and the rows' domain; undefined for cells without one.
 */
export function cellLook(
  name: string,
  value: (field: (typeof LOOK_FIELDS)[number]) => number | string | undefined,
  domain: LookDomain,
): CellLook | undefined {
  let fill: string | undefined;
  let color: string | undefined;
  if (name === "n0") fill = step(value("n0") as number, N0_STEPS);
  else if (name === "n1") fill = step(value("n1") as number, N1_STEPS);
  else if (name === "n2") fill = gradient(value("n2") as number, domain.extent);
  else if (name === "n3") {
    const v = value("n3") as number;
    if (v >= domain.nth && v < Infinity) fill = N3_FILL;
  } else if (name === "c0") {
    const label = value("c0") as string | undefined;
    color = label === undefined ? undefined : C0_COLORS[label];
  }
  if (fill === undefined && (value("n4") as number) > N4_OVER) fill = ROW_FILL;
  if (fill === undefined && color === undefined) return undefined;
  return { fill, color: color ?? (fill === undefined ? undefined : ink(fill)) };
}

/**
 * The domain looks read, kept as rows arrive and leave: the extent of n2
 * and the 100 largest values of n3, scanned again only when a row leaving
 * held an end of the extent or one of the 100. Adapter code, for grids
 * without looks over their rows.
 */
export class LookState {
  #extent: [number, number] | undefined;
  /** The largest values of n3, ascending, at most N3_TOP. */
  #top: number[] = [];
  /** Counts what changed the domain, so adapters can redraw cells only then. */
  revision = 0;

  /** Starts over from every row shown. */
  reset(n2: ArrayLike<number>, n3: ArrayLike<number>, from = 0, to = n2.length): void {
    this.#extent = undefined;
    this.#top = [];
    this.#add(n2, n3, from, to);
    this.revision++;
  }

  /** Rows [from, to) of the columns arrived. */
  append(n2: ArrayLike<number>, n3: ArrayLike<number>, from = 0, to = n2.length): void {
    const before = this.#key();
    this.#add(n2, n3, from, to);
    if (this.#key() !== before) this.revision++;
  }

  /**
   * Rows [from, to) are leaving; `rescan` reads every row left after they
   * have gone, where one of them mattered.
   */
  evict(
    n2: ArrayLike<number>,
    n3: ArrayLike<number>,
    from: number,
    to: number,
    rescan: () => void,
  ): void {
    const extent = this.#extent;
    const nth = this.nth;
    for (let i = from; i < to; i++) {
      const a = n2[i]!;
      const b = n3[i]!;
      if ((extent && (a === extent[0] || a === extent[1])) || b >= nth) {
        rescan();
        return;
      }
    }
  }

  get domain(): LookDomain {
    return { extent: this.#extent, nth: this.nth };
  }

  get nth(): number {
    return this.#top.length === 0 ? Number.NaN : this.#top[0]!;
  }

  #key(): string {
    return `${this.#extent?.[0]},${this.#extent?.[1]},${this.nth}`;
  }

  #add(n2: ArrayLike<number>, n3: ArrayLike<number>, from: number, to: number): void {
    let extent = this.#extent;
    const top = this.#top;
    for (let i = from; i < to; i++) {
      const a = n2[i]!;
      if (Number.isFinite(a))
        extent = extent ? [Math.min(extent[0], a), Math.max(extent[1], a)] : [a, a];
      const b = n3[i]!;
      if (!Number.isFinite(b) || (top.length === N3_TOP && b <= top[0]!)) continue;
      // Sorted insert into at most 100 values.
      let at = 0;
      while (at < top.length && top[at]! < b) at++;
      top.splice(at, 0, b);
      if (top.length > N3_TOP) top.shift();
    }
    this.#extent = extent;
  }
}

/** Parses "#rgb", "#rrggbb", "rgb()/rgba()", and "color(srgb[-linear] r g b)" (ends only) into 0-255 channels. */
export function parseColor(color: string): [number, number, number] | undefined {
  const value = color.trim();
  if (value.startsWith("#")) {
    const digits =
      value.length === 4 ? [...value.slice(1)].map((d) => d + d).join("") : value.slice(1);
    return channels(`#${digits}`);
  }
  const numbers = value.match(/-?[\d.]+(?:e-?\d+)?/g)?.map(Number);
  if (!numbers || numbers.length < 3) return undefined;
  if (value.startsWith("color(")) return [numbers[0]! * 255, numbers[1]! * 255, numbers[2]! * 255];
  return [numbers[0]!, numbers[1]!, numbers[2]!];
}

/** Whether two colors are the same within `tolerance` per channel (gradients quantize differently). */
export function sameColor(a: string | undefined, b: string | undefined, tolerance = 3): boolean {
  if (a === undefined || b === undefined) return a === b;
  const x = parseColor(a);
  const y = parseColor(b);
  return !!x && !!y && x.every((c, i) => Math.abs(c - y[i]!) <= tolerance);
}

/**
 * Keeps the looks' domain for an adapter over the fixture's columns and
 * the batches appended to them, read in place (no copies): what the
 * application code around a grid without looks over its rows would keep.
 */
export class LookTracker {
  readonly #state = new LookState();
  readonly #n2: number;
  readonly #n3: number;
  /** The fixture and each batch: their n2 and n3 columns from identity `firstId`. */
  readonly #chunks: { firstId: number; n2: Float64Array; n3: Float64Array }[] = [];
  /** Live identities are [start, end). */
  #start: number;
  #end: number;

  constructor(table: GridTable) {
    this.#n2 = table.fields.findIndex((field) => field.name === "n2");
    this.#n3 = table.fields.findIndex((field) => field.name === "n3");
    this.#start = table.firstId;
    this.#end = table.firstId;
    this.#push(table);
    this.#state.reset(this.#chunks[0]!.n2, this.#chunks[0]!.n3);
  }

  get domain(): LookDomain {
    return this.#state.domain;
  }

  /** Changes whenever the domain does. */
  get revision(): number {
    return this.#state.revision;
  }

  /** The oldest `evict` rows leave, then `batch` arrives. */
  append(batch: GridTable, evict: number): void {
    const to = Math.min(this.#end, this.#start + evict);
    let rescan = false;
    for (const chunk of this.#chunks) {
      const from = Math.max(this.#start, chunk.firstId) - chunk.firstId;
      const until = Math.min(to, chunk.firstId + chunk.n2.length) - chunk.firstId;
      if (from < until) this.#state.evict(chunk.n2, chunk.n3, from, until, () => (rescan = true));
      if (rescan) break;
    }
    this.#start = to;
    while (this.#chunks.length > 0) {
      const first = this.#chunks[0]!;
      if (first.firstId + first.n2.length > this.#start) break;
      this.#chunks.shift();
    }
    this.#push(batch);
    const added = this.#chunks.at(-1)!;
    if (rescan) {
      // Every live row again, the batch among them.
      const revision = this.#state.revision;
      this.#state.reset([], []);
      for (const chunk of this.#chunks) {
        const from = Math.max(this.#start, chunk.firstId) - chunk.firstId;
        this.#state.append(chunk.n2, chunk.n3, from, chunk.n2.length);
      }
      this.#state.revision = revision + 1;
    } else this.#state.append(added.n2, added.n3);
  }

  #push(table: GridTable): void {
    this.#chunks.push({
      firstId: table.firstId,
      n2: table.columns[this.#n2] as Float64Array,
      n3: table.columns[this.#n3] as Float64Array,
    });
    this.#end = table.firstId + table.length;
  }
}
