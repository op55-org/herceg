// Labels moving to changed values (value-transition.ts): a text mark's rows
// and bars' value labels, matched by name (scene.ts LabelItems) among their
// mark's labels: a text mark's, or a bar series' across the groups its
// labels are drawn in, which a label changes as it moves inside or outside
// its bar. A matched label moves its place on the frame's scales and counts
// the number it writes through the values between. A label without a match
// comes or goes with its bar, keeping its place on it (between its root and
// tip, or past its tip), or else shows or goes at once.

import type { LabelItems, LabelsGeometry, TextGeometry, TextItem } from "../scene/scene.ts";
import type { MovingBars } from "./value-bars.ts";
import { type Blend, before, blend, type ScaleMotion } from "./value-motion.ts";

type Labeled = TextGeometry | LabelsGeometry;

/**
 * One geometry's labels as drawn, owned: per label its name, place (x and
 * y alternating), the number it writes, and its text (text geometry) or
 * items (labels geometry).
 */
export interface ShownLabels {
  kind: "labels";
  /** The geometry drawn, for the paint of labels going: never its buffers. */
  mark: Labeled;
  count: number;
  names: readonly (string | number)[];
  table: object | undefined;
  generation: number;
  of: string | undefined;
  at: Float32Array;
  values: Float64Array | undefined;
  /** Bars' labels: where each one's text starts along x. */
  starts: Float32Array | undefined;
  texts: readonly string[] | undefined;
  items: readonly (readonly TextItem[])[] | undefined;
}

/** Whether a geometry's labels are named for value transitions. */
export function named(mark: { kind: string }): mark is Labeled {
  return (mark.kind === "text" || mark.kind === "labels") && (mark as Labeled).named !== undefined;
}

/** Each label's items, by the label they draw. */
function itemsOf(mark: LabelsGeometry): TextItem[][] {
  const { owners, names } = mark.named!;
  const items: TextItem[][] = Array.from({ length: names.length }, () => []);
  mark.items.forEach((item, k) => {
    items[owners![k]!]!.push(item);
  });
  return items;
}

/** A copy of a geometry's named labels, a scene's or a frame's. */
export function copyLabels(mark: Labeled): ShownLabels {
  const { names, table, generation, of, values } = mark.named!;
  const count = names.length;
  const text = mark.kind === "text";
  const at = text ? mark.coords : mark.named!.at!;
  const starts = mark.named!.starts;
  return {
    kind: "labels",
    mark,
    count,
    names: names.slice(0, count),
    table,
    generation,
    of,
    at: Float32Array.from({ length: count * 2 }, (_, k) => at[k]!),
    values: values && Float64Array.from({ length: count }, (_, i) => values[i]!),
    starts: starts && Float32Array.from({ length: count }, (_, i) => starts[i]!),
    texts: text ? mark.labels.slice(0, count) : undefined,
    items: text ? undefined : itemsOf(mark),
  };
}

/**
 * Labels moving: the new scene's labels of one geometry (`kept` of them),
 * then labels going, each with its place at both ends (x and y
 * alternating) and the numbers it writes where it counts.
 */
export interface MovingLabels {
  /** The geometry's place among its panel's; -1 for labels of a geometry that went, drawn after the panel's geometry. */
  index: number;
  mark: Labeled;
  /** The y scale the labels are on. */
  side: "y" | "yRight";
  kept: number;
  count: number;
  from: Float32Array;
  to: Float32Array;
  /**
   * Per label, the numbers it writes at both ends where it counts; where it
   * does not, the number it shows at both (NaN for none), which frames keep.
   */
  values: Float64Array;
  write: LabelItems["write"];
  /** Labels going: their texts or items, and the new scene's labels' items (labels geometry). */
  texts: readonly string[];
  items: readonly (readonly TextItem[])[];
  names: (string | number)[];
  /** A frame's places and numbers. */
  at: Float32Array;
  numbers: Float64Array;
  /** Bars' labels: how far each one's place is past where its text starts (NaN: not known). */
  offsets: Float32Array;
}

/** Each name's place (its set, and its place in it) among sets of names, and names given to more than one. */
function index(sets: readonly (readonly (string | number)[])[]): {
  at: Map<string | number, [set: number, i: number]>;
  shared: Set<string | number>;
} {
  const at = new Map<string | number, [number, number]>();
  const shared = new Set<string | number>();
  sets.forEach((names, set) => {
    names.forEach((name, i) => {
      if (at.has(name)) shared.add(name);
      else at.set(name, [set, i]);
    });
  });
  return { at, shared };
}

/** How a label's text is anchored: its geometry's, as recorded, or its first item's. */
function anchorOf(mark: Labeled, items: readonly TextItem[] | undefined): string | undefined {
  return mark.kind === "text" ? mark.anchor : (mark.named?.anchor ?? items?.[0]?.anchor);
}

/** A label's name made of its row identity (scene.ts NAMELESS). */
const nameless = (name: string | number) => typeof name === "string" && name[0] === "\u0000";

/**
 * How the labels of one mark, or one bar series (labels whose `of` names
 * it), move: `shown`, their geometries as drawn, to `next`, the new scene's
 * (with their places among the panel's geometry), on scales moving as `x`
 * and `y` do. Bars' labels without a match follow their bar in `bars`.
 */
export function moveLabels(
  shown: readonly ShownLabels[],
  next: readonly { index: number; mark: Labeled }[],
  x: ScaleMotion,
  y: ScaleMotion,
  side: "y" | "yRight",
  bars: MovingBars | undefined,
): { moving: MovingLabels[]; moves: boolean } {
  const nextLabels = next.map(({ mark }) => mark.named!);
  const was = index(shown.map((labels) => labels.names));
  const is = index(nextLabels.map((labels) => labels.names));
  const target = nextLabels[0];
  const shared = (name: string | number) => was.shared.has(name) || is.shared.has(name);
  // Names of rows match labels of the same table generation only.
  const match = (name: string | number) => {
    const found = shared(name) ? undefined : was.at.get(name);
    const labels = found && shown[found[0]]!;
    return labels &&
      nameless(name) &&
      (labels.table !== target?.table || labels.generation !== target?.generation)
      ? undefined
      : found;
  };
  // A bar's motion by its name: how far its middle and its tip move. Labels
  // coming find their bar among the new scene's, labels going among those
  // going, by their names in the old scene (names of rows of another
  // generation may name others in the new one).
  const barsKept = (bars?.names.length ?? 0) - (bars?.left.length ?? 0);
  const barsComing = new Map<string | number, number>();
  const barsGoing = new Map<string | number, number>();
  bars?.names.forEach((name, b) => {
    if (b < barsKept) barsComing.set(name, b);
  });
  bars?.left.forEach((name, e) => {
    barsGoing.set(name, barsKept + e);
  });
  /**
   * Where a label at (lx, ly) of the bar named `name` (one coming; with
   * `sign` -1, one going) stands at the bar's other end: moved across with
   * its middle, and along it as far as it is between the bar's root and tip
   * (inside it), or as far past its tip.
   */
  const follow = (
    name: string | number,
    sign: number,
    lx: number,
    ly: number,
  ): [number, number] | undefined => {
    const b = (sign > 0 ? barsComing : barsGoing).get(name);
    if (b === undefined) return undefined;
    const [here, there] = sign > 0 ? [bars!.to, bars!.from] : [bars!.from, bars!.to];
    const standing = bars!.place === "x";
    const [across, along] = standing ? [lx, ly] : [ly, lx];
    const [root, tip] = [here[b * 4 + 2]!, here[b * 4 + 3]!];
    const [otherRoot, otherTip] = [there[b * 4 + 2]!, there[b * 4 + 3]!];
    const length = tip - root;
    const past = length === 0 ? along !== tip : (along - tip) * length > 0;
    const moved = past
      ? otherTip + (along - tip)
      : otherRoot + (length === 0 ? 0 : (along - root) / length) * (otherTip - otherRoot);
    const middle = (p: Float32Array) => p[b * 4]! + p[b * 4 + 1]! / 2;
    const placed = across + middle(there) - middle(here);
    return standing ? [placed, moved] : [moved, placed];
  };
  const matched = new Set<string>();
  const moving: MovingLabels[] = [];
  let moves = false;
  const make = (index: number, mark: Labeled, count: number, kept: number): MovingLabels => ({
    index,
    mark,
    side,
    kept,
    count,
    from: new Float32Array(count * 2),
    to: new Float32Array(count * 2),
    values: new Float64Array(count * 2).fill(Number.NaN),
    write: kept > 0 ? mark.named!.write : undefined,
    texts: [],
    items: [],
    names: [],
    at: new Float32Array(count * 2),
    numbers: new Float64Array(count),
    offsets: new Float32Array(count).fill(Number.NaN),
  });
  // Labels going, by the geometry they were drawn in.
  const going = new Map<ShownLabels, number[]>();
  const leave = (labels: ShownLabels, i: number) => {
    const list = going.get(labels) ?? [];
    list.push(i);
    going.set(labels, list);
  };
  for (const { index: at, mark } of next) {
    const labels = mark.named!;
    const kept = labels.names.length;
    const record = make(at, mark, kept, kept);
    const places = mark.kind === "text" ? mark.coords : labels.at!;
    const place = (i: number) => [places[i * 2]!, places[i * 2 + 1]!] as const;
    if (mark.kind === "labels") record.items = itemsOf(mark);
    for (let i = 0; i < kept; i++) {
      const name = labels.names[i]!;
      record.names.push(name);
      const [px, py] = place(i);
      record.to[i * 2] = px!;
      record.to[i * 2 + 1] = py!;
      const offset = px! - (labels.starts?.[i] ?? Number.NaN);
      record.offsets[i] = offset;
      const found = match(name);
      if (found) {
        const [set, j] = found;
        const old = shown[set]!;
        matched.add(`${set}:${j}`);
        // Anchored otherwise now (moving inside or outside its bar), its text starts where it did.
        const start = old.starts?.[j] ?? Number.NaN;
        const turned = anchorOf(old.mark, old.items?.[j]) !== anchorOf(mark, record.items[i]);
        record.from[i * 2] =
          turned && Number.isFinite(start + offset) ? start + offset : old.at[j * 2]!;
        record.from[i * 2 + 1] = old.at[j * 2 + 1]!;
        const a = old.values?.[j] ?? Number.NaN;
        const b = labels.values?.[i] ?? Number.NaN;
        // Only finite numbers at both ends count; others show the new one.
        const counts = Number.isFinite(a) && Number.isFinite(b) && labels.write;
        record.values[i * 2] = counts ? a : b;
        record.values[i * 2 + 1] = b;
        moves ||= a !== b || record.from[i * 2] !== px || record.from[i * 2 + 1] !== py;
        continue;
      }
      moves = true;
      record.values[i * 2] = record.values[i * 2 + 1] = labels.values?.[i] ?? Number.NaN;
      // With its bar, or at once where its values are on the scales before.
      const by = shared(name) ? undefined : follow(name, 1, px!, py!);
      record.from[i * 2] = by ? by[0] : before(x, px!);
      record.from[i * 2 + 1] = by ? by[1] : before(y, py!);
    }
    moving.push(record);
  }
  shown.forEach((labels, s) => {
    for (let i = 0; i < labels.count; i++) {
      const name = labels.names[i]!;
      if (matched.has(`${s}:${i}`) || shared(name)) continue;
      // Only labels that follow a bar out go; others go at once.
      if (barsGoing.has(name)) leave(labels, i);
    }
  });
  for (const [labels, exits] of going) {
    moves = true;
    // Drawn in their geometry where the new scene has it, else in one of their own.
    const host = moving.find(({ mark }) => mark.key === labels.mark.key);
    const kept = host?.kept ?? 0;
    const record = host ?? make(-1, labels.mark, 0, 0);
    const count = kept + exits.length;
    const grow = (array: Float32Array) => {
      const bigger = new Float32Array(count * 2);
      bigger.set(array.subarray(0, kept * 2));
      return bigger;
    };
    const values = new Float64Array(count * 2).fill(Number.NaN);
    values.set(record.values.subarray(0, kept * 2));
    const offsets = new Float32Array(count).fill(Number.NaN);
    offsets.set(record.offsets.subarray(0, kept));
    Object.assign(record, {
      count,
      from: grow(record.from),
      to: grow(record.to),
      values,
      at: new Float32Array(count * 2),
      numbers: new Float64Array(count),
      offsets,
    });
    const texts: string[] = [...record.texts];
    const items: (readonly TextItem[])[] = [...record.items];
    exits.forEach((i, e) => {
      const k = kept + e;
      const [fx, fy] = [labels.at[i * 2]!, labels.at[i * 2 + 1]!];
      const [tx, ty] = follow(labels.names[i]!, -1, fx, fy)!;
      record.from[k * 2] = fx;
      record.from[k * 2 + 1] = fy;
      record.to[k * 2] = tx;
      record.to[k * 2 + 1] = ty;
      // Named in frames as its bar is.
      record.names.push(bars!.names[barsGoing.get(labels.names[i]!)!]!);
      values[k * 2] = values[k * 2 + 1] = labels.values?.[i] ?? Number.NaN;
      offsets[k] = fx - (labels.starts?.[i] ?? Number.NaN);
      if (labels.texts) texts[k] = labels.texts[i]!;
      if (labels.items) items[k] = labels.items[i]!;
    });
    record.texts = texts;
    record.items = items;
    if (!host) moving.push(record);
  }
  return { moving, moves };
}

/** The labels at eased progress `t`, placed on the frame's scales `x` and `y`. */
export function labelsAt(moving: MovingLabels, t: number, x: Blend, y: Blend): Labeled {
  const { mark, kept, count, from, to, values, at, numbers, write } = moving;
  for (let i = 0; i < count; i++) {
    at[i * 2] = blend(x, from[i * 2]!, to[i * 2]!);
    at[i * 2 + 1] = blend(y, from[i * 2 + 1]!, to[i * 2 + 1]!);
    const [a, b] = [values[i * 2]!, values[i * 2 + 1]!];
    numbers[i] = a + (b - a) * t;
  }
  const counts = (i: number) =>
    i < kept && write && Number.isFinite(numbers[i]!) && values[i * 2] !== values[i * 2 + 1];
  const record: LabelItems = { ...mark.named!, names: moving.names, values: numbers };
  if (record.starts)
    record.starts = Float32Array.from(moving.offsets, (offset, i) => at[i * 2]! - offset);
  // Bars' labels are cut to the plot as they come and go past its end (scenes leave out those outside it).
  const clip = record.of !== undefined && mark.clip === undefined ? "plot" : mark.clip;
  if (mark.kind === "text") {
    const labels = Array.from({ length: count }, (_, i) =>
      counts(i)
        ? (write!(i, numbers[i]!, at[i * 2]!, at[i * 2 + 1]!) as string)
        : i < kept
          ? mark.labels[i]!
          : moving.texts[i]!,
    );
    return { ...mark, coords: at, labels, count, named: record, clip };
  }
  // Each label's items move by its place, or are written again at it as it counts.
  const owners: number[] = [];
  const items: TextItem[] = [];
  const own = mark.named!.at!;
  for (let i = 0; i < count; i++) {
    const [lx, ly] = [at[i * 2]!, at[i * 2 + 1]!];
    const made = counts(i)
      ? (write!(i, numbers[i]!, lx, ly) as readonly TextItem[])
      : moving.items[i]!.map((item) => {
          const dx = lx - (i < kept ? own[i * 2]! : from[i * 2]!);
          const dy = ly - (i < kept ? own[i * 2 + 1]! : from[i * 2 + 1]!);
          const { box } = item;
          return {
            ...item,
            x: item.x + dx,
            y: item.y + dy,
            box: box && { ...box, x: box.x + dx, y: box.y + dy },
          };
        });
    for (const item of made) {
      items.push(item);
      owners.push(i);
    }
  }
  record.at = at;
  record.owners = Uint32Array.from(owners);
  return { ...mark, items, named: record, clip };
}
