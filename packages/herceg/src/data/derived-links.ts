// Derived tables' contributors (derive.ts records what they keep): part of
// the lineage reader (contributors.ts), so derivations no one reads
// through carry none of it. A derivation whose steps all work row by row
// keeps its rows' source slots: a gather. Any other is computed again on
// every change of its source, and on first need runs once more recording
// where each row came from: stretches of steps that keep rows one for one
// (filters, sorts, calculations, bins), each a gather of the rows below,
// between fan-in steps (aggregates, rolling windows), each a layer of
// groups or windows over its input rows. Its links, top first, are those
// stretches and layers; contributors.ts composes them. While the links are
// read, each computation records them again.

import type {
  AggregateOp,
  AggregateSpec,
  RollingOp,
  RollingSpec,
  TransformSpec,
} from "../spec/spec.ts";
import type { ContributorLink, Measure } from "./contributor-records.ts";
import type { DerivedRecord, FanIn, Rows, Trace } from "./derive.ts";

/**
 * A derivation's links, top first: made once from its steps, they read the
 * trace of its last computation only when asked for rows, so what a
 * budget asks of them (classes, measures, how many targets) builds nothing.
 */
export function derivedLinks(record: DerivedRecord): readonly ContributorLink[] {
  let links = made.get(record);
  if (!links) {
    links = record.incremental ? [gather(record)] : shapeLinks(record);
    made.set(record, links);
  }
  return links;
}

/** Bytes a derivation's links hold: its trace, and the inverses its stretches made. */
export function derivedBytes(record: DerivedRecord): number {
  const trace = record.followed.trace as Tracer | null;
  if (!trace) return 0;
  let bytes = trace.byteLength;
  for (const stretch of trace.stretches) bytes += inverses.get(stretch)?.byteLength ?? 0;
  return bytes;
}

/** The most bytes a derivation's links will hold, before they are made. */
export function derivedEstimate(record: DerivedRecord): number {
  return record.incremental ? 0 : traceEstimate(record.transforms, record.followed.sizes);
}

/** Lets a derivation's trace go, once no reader holds its links: the next read records it again. */
export function releaseDerived(record: DerivedRecord): void {
  record.followed.trace = null;
  record.followed.read = false;
}

/** Links of each derivation; what stretches and layers of a trace work out once. */
const made = /* @__PURE__ */ new WeakMap<DerivedRecord, readonly ContributorLink[]>();
const inverses = /* @__PURE__ */ new WeakMap<Stretch, Int32Array>();
const ordered = /* @__PURE__ */ new WeakMap<Stretch, boolean>();
const maskings = /* @__PURE__ */ new WeakMap<Layer, Map<string | undefined, Uint8Array | null>>();

/** The trace of the derivation's last computation, recorded now if none is: its links are read. */
function traceOf(record: DerivedRecord): Tracer {
  const { followed } = record;
  followed.sync();
  followed.read = true;
  followed.tracer ??= (rows) => new Tracer(rows);
  if (!followed.trace) {
    const trace = new Tracer(record.source.length);
    record.run(trace);
    followed.trace = trace;
  }
  // This module's Tracer, which `tracer` made.
  return followed.trace as Tracer;
}

/** Fields a derivation's steps make (calculations, bins): none passes a source field. */
function madeBy(transforms: readonly TransformSpec[]): Set<string> {
  const made = new Set<string>();
  for (const step of transforms) {
    if ("calculate" in step) made.add(step.as);
    if ("bin" in step) made.add(step.as ?? step.bin);
    if ("bin" in step && step.end !== undefined) made.add(step.end);
  }
  return made;
}

/** Operations that read the finite values of their field; first and last take the value at the end, missing or not. */
const FINITE = new Set<AggregateOp | RollingOp>([
  "count",
  "sum",
  "mean",
  "median",
  "min",
  "max",
  "q1",
  "q3",
  "stdev",
  "variance",
  "distinct",
]);

/** Each group's rows, in order: `list[start[g]]` to `list[start[g + 1]]`. */
interface Lists {
  start: Int32Array;
  list: Int32Array;
}

function listsOf(group: Int32Array, groups: number): Lists {
  const start = new Int32Array(groups + 1);
  for (let i = 0; i < group.length; i++) start[group[i]! + 1]!++;
  for (let g = 0; g < groups; g++) start[g + 1]! += start[g]!;
  const next = start.slice(0, groups);
  const list = new Int32Array(group.length);
  for (let i = 0; i < group.length; i++) list[next[group[i]!]!++] = i;
  return { start, list };
}

/** For each field, 1 where a row's value is finite: none where every one is. */
function masksOf(rows: Rows, fields: readonly string[]): Map<string, Uint8Array | null> {
  const masks = new Map<string, Uint8Array | null>();
  for (const field of fields) {
    if (masks.has(field)) continue;
    const values = rows.numbers(field);
    let mask: Uint8Array | null = null;
    for (let i = 0; i < rows.length; i++) {
      if (Number.isFinite(values[i]!)) continue;
      mask ??= new Uint8Array(rows.length).fill(1);
      mask[i] = 0;
    }
    masks.set(field, mask);
  }
  return masks;
}

/** A fan-in step's record: each input row's group (an aggregate's output row, a rolling window's group). */
type Layer =
  | {
      kind: "aggregate";
      group: Int32Array;
      lists: Lists;
      specs: readonly AggregateSpec[];
      masks: Map<string, Uint8Array | null>;
    }
  | {
      kind: "rolling";
      group: Int32Array;
      lists: Lists;
      /** Each row's place among its group's rows. */
      rank: Int32Array;
      size: number;
      specs: readonly RollingSpec[];
      masks: Map<string, Uint8Array | null>;
    };

/** A stretch of steps keeping rows one for one: each row's row below (null: the same one), and the fields it made. */
interface Stretch {
  from: Int32Array | null;
  /** Rows below. */
  rows: number;
  made: Set<string>;
}

/** Records, as a derivation runs, where each row came from. */
class Tracer implements Trace {
  readonly stretches: Stretch[] = [];
  readonly layers: Layer[] = [];
  /** Fields the current stretch made. */
  #made = new Set<string>();
  #below: number;

  constructor(rows: number) {
    this.#below = rows;
  }

  made(field: string) {
    this.#made.add(field);
  }

  layer(rows: Rows, fanIn: FanIn) {
    this.#close(rows);
    const { group, groups } = fanIn;
    const lists = listsOf(group, groups);
    if (fanIn.kind === "aggregate") {
      const fields = fanIn.specs.flatMap((spec) =>
        FINITE.has(spec.op) && spec.field !== undefined ? [spec.field] : [],
      );
      this.layers.push({
        kind: "aggregate",
        group,
        lists,
        specs: fanIn.specs,
        masks: masksOf(rows, fields),
      });
    } else {
      const rank = new Int32Array(rows.length);
      for (let g = 0; g < groups; g++)
        for (let k = lists.start[g]!; k < lists.start[g + 1]!; k++)
          rank[lists.list[k]!] = k - lists.start[g]!;
      const masks = masksOf(
        rows,
        fanIn.specs.map(({ field }) => field),
      );
      this.layers.push({
        kind: "rolling",
        group,
        lists,
        rank,
        size: fanIn.size,
        specs: fanIn.specs,
        masks,
      });
    }
    // Rows above an aggregate are its groups; a rolling window keeps its rows.
    this.#below = fanIn.kind === "aggregate" ? fanIn.groups : rows.length;
  }

  end(rows: Rows) {
    this.#close(rows);
  }

  #close(rows: Rows) {
    const ids = rows.ids!;
    let same = rows.length === this.#below;
    for (let i = 0; i < rows.length && same; i++) same = ids[i] === i;
    this.stretches.push({
      from: same ? null : Int32Array.from(ids),
      rows: this.#below,
      made: this.#made,
    });
    this.#made = new Set();
  }

  /** Bytes it holds. */
  get byteLength(): number {
    let bytes = 0;
    for (const { from } of this.stretches) bytes += from?.byteLength ?? 0;
    for (const layer of this.layers) {
      bytes += layer.group.byteLength + layer.lists.start.byteLength + layer.lists.list.byteLength;
      if (layer.kind === "rolling") bytes += layer.rank.byteLength;
      for (const mask of layer.masks.values()) bytes += mask?.byteLength ?? 0;
    }
    return bytes;
  }
}

/**
 * A stretch's link: a gather of the rows below (`rows()` of them) into its
 * `targets()` rows, through `stretch()` of the trace. Rows kept in order
 * (filters) are found by halving; rows a sort moved, by an inverse.
 */
function stretchLink(
  stretch: () => Stretch,
  made: ReadonlySet<string>,
  rows: () => number,
  targets: () => number,
): ContributorLink {
  const rowOf = (target: number) => stretch().from?.[target] ?? target;
  const targetAt = (row: number) => {
    const data = stretch();
    const { from } = data;
    const count = targets();
    if (!from) return row < count ? row : -1;
    let ascending = ordered.get(data);
    if (ascending === undefined) {
      ascending = true;
      for (let t = 1; t < count && ascending; t++) ascending = from[t - 1]! < from[t]!;
      ordered.set(data, ascending);
    }
    if (ascending) {
      let [lo, hi] = [0, count];
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (from[mid]! < row) lo = mid + 1;
        else hi = mid;
      }
      return lo < count && from[lo] === row ? lo : -1;
    }
    let inverse = inverses.get(data);
    if (!inverse) {
      inverse = new Int32Array(data.rows).fill(-1);
      for (let t = 0; t < count; t++) inverse[from[t]!] = t;
      inverses.set(data, inverse);
    }
    return inverse[row] ?? -1;
  };
  const passes = (field: string | undefined) =>
    field === undefined || made.has(field) ? undefined : field;
  return {
    get rows() {
      return rows();
    },
    get targets() {
      return targets();
    },
    single: true,
    partition: true,
    contributors: (target, visit) => visit(rowOf(target)),
    targetsOf: (row, visit) => {
      const target = targetAt(row);
      if (target >= 0) visit(target);
    },
    targetAt,
    count: () => 1,
    classOf: () => null,
    operandOf: passes,
    passes,
    measureOf: () => undefined,
    incidences: (visit) => {
      const count = targets();
      for (let t = 0; t < count; t++) visit(rowOf(t), t);
    },
    // The rows below are the trace's, and the inverses counted with it.
    byteLength: 0,
  };
}

/**
 * A fan-in layer's link: an aggregate's groups, or windows over each
 * group's rows, of step `step`, through `layer()` of the trace.
 */
function layerLink(
  step: Extract<TransformSpec, { aggregate: unknown } | { rolling: unknown }>,
  layer: () => Layer,
  rows: () => number,
  targets: () => number,
): ContributorLink {
  // Looked up per row: by name, and each field's mask once per trace.
  const specs = new Map<string, AggregateSpec | RollingSpec>();
  for (const s of "aggregate" in step ? step.aggregate : step.rolling) specs.set(s.as, s);
  const spec = (field: string | undefined) => (field === undefined ? undefined : specs.get(field));
  /** The mask of rows `field` reads, null for every row. */
  const maskOf = (data: Layer, field: string | undefined) => {
    let masks = maskings.get(data);
    if (!masks) {
      masks = new Map();
      maskings.set(data, masks);
    }
    let mask = masks.get(field);
    if (mask === undefined) {
      const of = spec(field);
      mask =
        of?.field === undefined || !FINITE.has(of.op) ? null : (data.masks.get(of.field) ?? null);
      masks.set(field, mask);
    }
    return mask;
  };
  const operandOf = (field: string | undefined) => {
    const of = spec(field);
    if ("aggregate" in step) return of?.field;
    // Fields a rolling step does not make are its rows' own.
    return of ? of.field : field;
  };
  if ("aggregate" in step) {
    const link: ContributorLink = {
      get rows() {
        return rows();
      },
      get targets() {
        return targets();
      },
      single: false,
      partition: true,
      contributors: (target, visit, field) => {
        const data = layer();
        const { start, list } = data.lists;
        const mask = maskOf(data, field);
        for (let k = start[target]!; k < start[target + 1]!; k++) {
          const row = list[k]!;
          if (!mask || mask[row]) visit(row);
        }
      },
      targetsOf: (row, visit, field) => {
        const target = link.targetAt(row, field);
        if (target >= 0) visit(target);
      },
      targetAt: (row, field) => {
        const data = layer();
        const mask = maskOf(data, field);
        return !mask || mask[row] ? data.group[row]! : -1;
      },
      count: (target, field) => {
        const data = layer();
        const { start, list } = data.lists;
        const mask = maskOf(data, field);
        if (!mask) return start[target + 1]! - start[target]!;
        let count = 0;
        for (let k = start[target]!; k < start[target + 1]!; k++) count += mask[list[k]!]!;
        return count;
      },
      classOf: (field) => {
        const of = spec(field);
        return of?.field !== undefined && FINITE.has(of.op) ? of.field : null;
      },
      operandOf,
      passes: () => undefined,
      measureOf: (field): Measure | undefined => {
        const of = spec(field) as AggregateSpec | undefined;
        if (of?.op === "count")
          return of.field === undefined ? { op: "count" } : { op: "count", field: of.field };
        if (of?.op === "sum") return { op: "sum", field: of.field! };
        return undefined;
      },
      incidences: (visit, field) => {
        const data = layer();
        const { group } = data;
        const mask = maskOf(data, field);
        for (let row = 0; row < group.length; row++)
          if (!mask || mask[row]) visit(row, group[row]!);
      },
      byteLength: 0,
    };
    return link;
  }
  const size = step.size;
  /** Whether `field` is a window's value: its contributors are the window's rows. */
  const windowed = (field: string | undefined) => spec(field) !== undefined;
  const link: ContributorLink = {
    get rows() {
      return rows();
    },
    get targets() {
      return targets();
    },
    // One row each for the rows' own fields; windows read several (`classOf`).
    single: true,
    partition: false,
    contributors: (target, visit, field) => {
      if (!windowed(field)) return visit(target);
      const data = layer() as Extract<Layer, { kind: "rolling" }>;
      const { group, rank } = data;
      const { start, list } = data.lists;
      const mask = maskOf(data, field);
      const base = start[group[target]!]!;
      for (let k = base + Math.max(0, rank[target]! - size + 1); k <= base + rank[target]!; k++) {
        const row = list[k]!;
        if (!mask || mask[row]) visit(row);
      }
    },
    targetsOf: (row, visit, field) => {
      if (!windowed(field)) return visit(row);
      const data = layer() as Extract<Layer, { kind: "rolling" }>;
      const { group, rank } = data;
      const { start, list } = data.lists;
      const mask = maskOf(data, field);
      if (mask && !mask[row]) return;
      const g = group[row]!;
      const end = Math.min(start[g + 1]!, start[g]! + rank[row]! + size);
      for (let k = start[g]! + rank[row]!; k < end; k++) visit(list[k]!);
    },
    targetAt: (row, field) => (windowed(field) ? -1 : row),
    count: (target, field) => {
      let count = 0;
      link.contributors(target, () => count++, field);
      return count;
    },
    classOf: (field) => (windowed(field) ? `rolling ${spec(field)!.field}` : null),
    operandOf,
    passes: (field) => (windowed(field) ? undefined : field),
    measureOf: () => undefined,
    byteLength: 0,
  };
  return link;
}

/**
 * The most bytes a trace of `transforms` holds with its links' inverses,
 * from `sizes` (the rows entering each step as they last ran, and the rows
 * made): every stretch that leaves rows out a row below per row (4 B),
 * and one that sorts an inverse per row below (4 B), every aggregate a
 * group and a list per row (8 B) and a start per group, every rolling
 * window a rank too and a start per row at most, and a mask per field read
 * (1 B a row).
 */
function traceEstimate(transforms: readonly TransformSpec[], sizes: readonly number[]): number {
  let bytes = 0;
  let [moved, sorted] = [false, false];
  let below = sizes[0] ?? 0;
  const stretch = (rows: number) => (moved || sorted ? 4 * rows : 0) + (sorted ? 4 * below : 0);
  transforms.forEach((step, i) => {
    if ("filter" in step) moved = true;
    if ("sort" in step) sorted = true;
    const fanIn = "aggregate" in step || "rolling" in step;
    if (!fanIn) return;
    const [rows, made] = [sizes[i] ?? 0, sizes[i + 1] ?? 0];
    bytes += stretch(rows);
    [moved, sorted] = [false, false];
    const fields = new Set(
      ("aggregate" in step ? step.aggregate : step.rolling).flatMap((s) =>
        s.field === undefined ? [] : [s.field],
      ),
    );
    bytes += ("aggregate" in step ? 8 * rows + 4 * (made + 1) : 16 * rows + 4) + fields.size * rows;
    below = made;
  });
  // The last stretch, to the derived rows.
  return bytes + stretch(sizes[transforms.length] ?? 0);
}

/**
 * A derivation's links, top first, from its steps: stretches of steps
 * keeping rows one for one between fan-in steps, each stretch reading the
 * trace's stretch of the same place, each fan-in step its layer. A stretch
 * that moves no row and makes no field changes nothing a reader asks, and
 * is left out. Rows and targets are those of the last computation.
 */
function shapeLinks(record: DerivedRecord): ContributorLink[] {
  const { transforms, followed } = record;
  /** Each stretch: whether it leaves out or moves rows, and the fields it makes. */
  const stretches: { moves: boolean; made: Set<string> }[] = [{ moves: false, made: new Set() }];
  /** The fan-in steps, by their index among the steps. */
  const fanIns: number[] = [];
  transforms.forEach((step, i) => {
    const stretch = stretches.at(-1)!;
    if ("filter" in step || "sort" in step) stretch.moves = true;
    if ("calculate" in step) stretch.made.add(step.as);
    if ("bin" in step) stretch.made.add(step.as ?? step.bin);
    if ("bin" in step && step.end !== undefined) stretch.made.add(step.end);
    if ("aggregate" in step || "rolling" in step) {
      fanIns.push(i);
      stretches.push({ moves: false, made: new Set() });
    }
  });
  // Rows entering stretch k (a layer's output, or the source's), and leaving it.
  const below = (k: number) => {
    followed.sync();
    return k === 0 ? record.source.length : (followed.sizes[fanIns[k - 1]! + 1] ?? 0);
  };
  const above = (k: number) => {
    followed.sync();
    return k === fanIns.length ? record.length() : (followed.sizes[fanIns[k]!] ?? 0);
  };
  const links: ContributorLink[] = [];
  for (let k = stretches.length - 1; k >= 0; k--) {
    const { moves, made } = stretches[k]!;
    if (moves || made.size > 0)
      links.push(
        stretchLink(
          () => traceOf(record).stretches[k]!,
          made,
          () => below(k),
          () => above(k),
        ),
      );
    if (k === 0) continue;
    const step = transforms[fanIns[k - 1]!] as Extract<
      TransformSpec,
      { aggregate: unknown } | { rolling: unknown }
    >;
    links.push(
      layerLink(
        step,
        () => traceOf(record).layers[k - 1]!,
        () => above(k - 1),
        () => below(k),
      ),
    );
  }
  if (links.length === 0) {
    // Steps that move no row (calculations alone) are a gather's; kept for a link to stand.
    const { made } = stretches[0]!;
    links.push(
      stretchLink(
        () => traceOf(record).stretches[0]!,
        made,
        () => below(0),
        () => above(0),
      ),
    );
  }
  return links;
}

/**
 * A derivation working row by row: a gather of its source's rows by slot
 * (`ids` from `idStart`, ascending, as the derived table keeps them), of
 * `length()` rows.
 */
function gather(record: DerivedRecord): ContributorLink {
  const { source, length, slots } = record;
  const made = madeBy(record.transforms);
  const targetAt = (row: number) => {
    const { ids, idStart } = slots();
    const slot = source.rowOffset + row;
    let [lo, hi] = [idStart, idStart + length()];
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ids[mid]! < slot) lo = mid + 1;
      else hi = mid;
    }
    return lo < idStart + length() && ids[lo] === slot ? lo - idStart : -1;
  };
  const rowOf = (target: number) => {
    const { ids, idStart } = slots();
    const row = ids[idStart + target]! - source.rowOffset;
    return row >= 0 && row < source.length ? row : -1;
  };
  const passes = (field: string | undefined) =>
    field === undefined || made.has(field) ? undefined : field;
  return {
    get rows() {
      return source.length;
    },
    get targets() {
      return length();
    },
    single: true,
    partition: true,
    contributors: (target, visit) => {
      const row = rowOf(target);
      if (row >= 0) visit(row);
    },
    targetsOf: (row, visit) => {
      const target = targetAt(row);
      if (target >= 0) visit(target);
    },
    targetAt,
    count: (target) => (rowOf(target) >= 0 ? 1 : 0),
    classOf: () => null,
    operandOf: passes,
    passes,
    measureOf: () => undefined,
    incidences: (visit) => {
      for (let target = 0; target < length(); target++) {
        const row = rowOf(target);
        if (row >= 0) visit(row, target);
      }
    },
    byteLength: 0,
  };
}
