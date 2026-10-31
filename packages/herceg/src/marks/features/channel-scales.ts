// Channel scales: continuous scales of the chart's `scales` that map a
// number field's values onto what a channel other than position draws
// (widths, opacities, areas, colors): `{ type, domain?, range, clamp? }`.
// A scale is shared by every channel naming it, in every mark: its domain,
// unless given, is the extent of every field read through it over the rows
// each mark draws (before facets split them and the legend hides any), so
// hiding a series or drawing a panel never rescales the others. Values a
// scale cannot take (missing, a log's zero or less, a square root's
// negatives) have no output: the channel's fallback paints them.

import type { MarkRows } from "../../data/row-view.ts";
import type { Table } from "../../data/table.ts";
import type { ChannelScaleSpec } from "../../spec/encoding.ts";
import type { PaintReader } from "../../theme.ts";

/** Colors a ramp is read at: one more than a byte's last index, so its ends are exact. */
const STEPS = 256;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Where a value lies along the scale's transform: its log, its square root, or itself. */
type Transform = (value: number) => number;

const TRANSFORMS: Record<ChannelScaleSpec["type"], Transform> = {
  linear: (v) => (Number.isFinite(v) ? v : Number.NaN),
  log: (v) => (v > 0 && v < Infinity ? Math.log(v) : Number.NaN),
  sqrt: (v) => (v >= 0 && v < Infinity ? Math.sqrt(v) : Number.NaN),
};

/** A field a scale reads, of the rows a mark draws, and its extent as last found. */
interface Source {
  readonly rows: () => MarkRows;
  readonly field: string;
  revision: string | undefined;
  extent: readonly [number, number] | undefined;
}

export class ChannelScale {
  readonly name: string;
  readonly spec: ChannelScaleSpec;
  /** Whether the scale maps onto colors (a ramp), rather than numbers. */
  readonly colors: boolean;
  /**
   * Changes whenever outputs may (the domain found from the data, the
   * colors read), so caches of looks read through the scale read again.
   */
  revision = 0;
  readonly #transform: Transform;
  readonly #sources: Source[] = [];
  /** The domain's ends along the transform; undefined while no value is valid. */
  #ends: readonly [number, number] | undefined;
  /** The ramp's colors at STEPS places, read through the theme. */
  #ramp: string[] = [];
  #stops = "";

  constructor(name: string, spec: ChannelScaleSpec) {
    this.name = name;
    this.spec = spec;
    this.colors = typeof spec.range[0] === "string";
    this.#transform = TRANSFORMS[spec.type];
    if (spec.domain) this.#ends = this.#along(spec.domain);
  }

  /** Reads `field` of the rows `rows` gives into the domain, unless the domain is given. */
  read(rows: () => MarkRows, field: string): void {
    if (this.spec.domain || this.#sources.some((s) => s.rows === rows && s.field === field)) return;
    this.#sources.push({ rows, field, revision: undefined, extent: undefined });
  }

  /**
   * Brings the domain up to date with the rows its fields' marks draw, and
   * reads a ramp's colors through `paint` (CSS variables), checked as
   * color ramps are: "#rgb" or "#rrggbb".
   */
  update(paint: PaintReader, path: string): void {
    let changed = false;
    if (this.colors) {
      const stops = (this.spec.range as readonly string[]).map((stop, i) => {
        const read = paint(stop, `${path}.range[${i}]`);
        if (!HEX.test(read))
          throw new TypeError(
            `${path}.range[${i}]: expected a "#rrggbb" color; received ${JSON.stringify(read)}`,
          );
        return read;
      });
      const key = stops.join();
      if (key !== this.#stops) {
        this.#stops = key;
        this.#ramp = ramp(stops);
        changed = true;
      }
    }
    if (!this.spec.domain) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const source of this.#sources) {
        const rows = source.rows();
        if (source.revision !== rows.revision) {
          source.revision = rows.revision;
          source.extent = this.extentOf(rows, source.field);
        }
        if (!source.extent) continue;
        lo = Math.min(lo, source.extent[0]);
        hi = Math.max(hi, source.extent[1]);
      }
      const ends = lo <= hi ? this.#along([lo, hi]) : undefined;
      if (ends?.[0] !== this.#ends?.[0] || ends?.[1] !== this.#ends?.[1]) {
        this.#ends = ends;
        changed = true;
      }
    }
    if (changed) this.revision = nextRevision();
  }

  /** The domain's ends as values, or undefined while the fields hold none it can take. */
  get domain(): readonly [number, number] | undefined {
    return this.spec.domain ?? (this.#ends && this.#values());
  }

  /**
   * Where each value lies from the domain's start (0) to its end (1): past
   * them unless the scale clamps; NaN for a value it cannot take, or with
   * no domain. A domain of one value puts it at the end, as color scales
   * do. As the scale is now: read again once `revision` changes.
   */
  #places(): (value: number) => number {
    const ends = this.#ends;
    if (!ends) return () => Number.NaN;
    const transform = this.#transform;
    const [a, b] = ends;
    // Ends, or a value and an end, near the largest numbers lie further
    // apart than a number holds; their halves do not (halving the smallest
    // numbers instead would leave none).
    const [span, half] = [b - a, b / 2 - a / 2];
    const wide = !Number.isFinite(span);
    const constant = a === b;
    const clamp = this.spec.clamp === true;
    return (value) => {
      const v = transform(value);
      if (constant) return Number.isNaN(v) ? v : 1;
      let t = (v - a) / span;
      if (wide || !Number.isFinite(t)) t = (v / 2 - a / 2) / half;
      return clamp ? (t < 0 ? 0 : t > 1 ? 1 : t) : t;
    };
  }

  /**
   * A number range's outputs by value, kept from `limits[0]` to `limits[1]`
   * (a channel's), past the range's ends where the scale does not clamp;
   * NaN for none. As the scale is now: read again once `revision` changes.
   */
  numberOutputs([lo, hi]: readonly [number, number]): (value: number) => number {
    const [from, to] = this.spec.range as readonly [number, number];
    const place = this.#places();
    const span = to - from;
    return (value) => {
      const t = place(value);
      // From the nearer end, so each end's output is exact, and constant
      // ranges constant however far past the domain a value is.
      const out =
        span === 0 ? (Number.isNaN(t) ? t : from) : t < 0.5 ? from + t * span : to - (1 - t) * span;
      return out < lo ? lo : out > hi ? hi : out;
    };
  }

  /** A color range's step of the ramp by value: its ends past the domain; NaN for none. As `numberOutputs`. */
  colorSteps(): (value: number) => number {
    const place = this.#places();
    return (value) => {
      const t = place(value);
      return Math.round((t < 0 ? 0 : t > 1 ? 1 : t) * (STEPS - 1));
    };
  }

  /** A color range's outputs by value (see `colorSteps`); undefined for none. */
  colorOutputs(): (value: number) => string | undefined {
    const step = this.colorSteps();
    const ramp = this.#ramp;
    return (value) => ramp[step(value)];
  }

  /** The least and greatest values `field` holds at `rows` that the scale can take. */
  extentOf(rows: MarkRows, field: string): readonly [number, number] | undefined {
    const { table, positions } = rows;
    const transform = this.#transform;
    if (!positions && this.spec.type === "linear") return table.extent(field as never);
    const values = table.numbers(field as never);
    const count = positions ? positions.length : values.length;
    let min = Infinity;
    let max = -Infinity;
    for (let k = 0; k < count; k++) {
      const value = values[positions ? positions[k]! : k]!;
      if (Number.isNaN(transform(value))) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return min <= max ? [min, max] : undefined;
  }

  #along([a, b]: readonly [number, number]): readonly [number, number] {
    return [this.#transform(a), this.#transform(b)];
  }

  #values(): readonly [number, number] {
    const back = (v: number) =>
      this.spec.type === "log" ? Math.exp(v) : this.spec.type === "sqrt" ? v * v : v;
    return [back(this.#ends![0]), back(this.#ends![1])];
  }
}

/**
 * Why a channel scale's settings are malformed: the setting (".range[1]")
 * and what it expects, or undefined for none.
 */
export function channelScaleProblem(
  spec: ChannelScaleSpec,
): { at: string; expected: string; value: unknown } | undefined {
  const { type, domain, range, clamp } = spec as unknown as Record<string, unknown>;
  if (type !== "linear" && type !== "log" && type !== "sqrt")
    return {
      at: ".type",
      expected: '"linear", "log", or "sqrt", as a scale with a range maps numbers onto a channel',
      value: type,
    };
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (!Array.isArray(range))
    return { at: ".range", expected: "two numbers, or colors", value: range };
  if (typeof range[0] === "number") {
    if (range.length !== 2 || !range.every(finite))
      return { at: ".range", expected: "two finite numbers, or colors", value: range };
  } else {
    const bad = range.findIndex(
      (stop) => typeof stop !== "string" || !(HEX.test(stop) || /\bvar\(/.test(stop)),
    );
    if (range.length < 2) return { at: ".range", expected: "at least two colors", value: range };
    if (bad >= 0) return { at: `.range[${bad}]`, expected: 'a "#rrggbb" color', value: range[bad] };
  }
  if (domain !== undefined) {
    const valid = (v: unknown) =>
      finite(v) &&
      (type === "log" ? (v as number) > 0 : type === "sqrt" ? (v as number) >= 0 : true);
    if (
      !Array.isArray(domain) ||
      domain.length !== 2 ||
      !domain.every(valid) ||
      domain[0] === domain[1]
    )
      return {
        at: ".domain",
        expected: `two different ${type === "log" ? "positive " : type === "sqrt" ? "non-negative " : ""}finite numbers`,
        value: domain,
      };
  }
  if (clamp !== undefined && typeof clamp !== "boolean")
    return { at: ".clamp", expected: "true or false", value: clamp };
  return undefined;
}

/** Every row of `table`, for marks that read their table whole. */
export function wholeTable(table: Table): MarkRows {
  return { table, positions: undefined, revision: String(table.version) };
}

/** Revisions across every channel scale, so a sum of them changes whenever one does. */
let revisions = 0;
function nextRevision(): number {
  return ++revisions;
}

/** A ramp through `stops`, evenly spaced, as hex colors at STEPS places. */
function ramp(stops: readonly string[]): string[] {
  const rgb = stops.map((stop) => {
    const hex = stop.slice(1);
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const n = Number.parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  const out: string[] = [];
  for (let i = 0; i < STEPS; i++) {
    const position = (i / (STEPS - 1)) * (rgb.length - 1);
    const index = Math.min(rgb.length - 2, Math.floor(position));
    const t = position - index;
    const [a, b] = [rgb[index]!, rgb[index + 1]!];
    const channel = (c: number) => Math.round(a[c]! + (b[c]! - a[c]!) * t);
    out.push(
      `#${((1 << 24) | (channel(0) << 16) | (channel(1) << 8) | channel(2)).toString(16).slice(1)}`,
    );
  }
  return out;
}
