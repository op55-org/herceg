// Labels moving to changed values (value-transition.ts): a text mark's rows
// and bars' value labels, matched by name (scene.ts LabelItems) among their
// mark's labels: a text mark's, or a bar series' across the groups its
// labels are drawn in, which a label changes as it moves inside or outside
// its bar. A matched label moves its place on the frame's scales and counts
// the numbers it writes through the values between: a bar's label its
// value, a text label each part of a number field in its content (or the
// one field it labels with). A label without a match
// comes or goes with its bar, keeping its place on it (between its root and
// tip, or past its tip), or else shows or goes at once. Between the two
// scenes, a counting number is laid out by its shape (`shapeOf`), so frames
// measure only the few shapes a format writes.

import type { MeasureText } from "../layout/text.ts";
import type { LabelItems, LabelsGeometry, TextGeometry, TextItem } from "../scene/scene.ts";
import type { MovingBars } from "./value-bars.ts";
import { type Blend, before, blend, type ScaleMotion } from "./value-motion.ts";

type Labeled = TextGeometry | LabelsGeometry;

/**
 * One geometry's labels as drawn, owned: per label its name, place (x and
 * y alternating), the numbers it writes (one per field `fields` names, else
 * one), and its text (text geometry) or items (labels geometry).
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
  fields: readonly string[] | undefined;
  values: Float64Array | undefined;
  /** Bars' labels: where each one's text starts along x. */
  starts: Float32Array | undefined;
  texts: readonly string[] | undefined;
  items: readonly (readonly TextItem[])[] | undefined;
}

const DIGIT = /\p{Nd}/u;

/**
 * `text` with each decimal digit written as the zero of its own digits:
 * "59,268" as "00,000", Arabic-Indic "١٢٣" as "٠٠٠", signs, separators,
 * and units kept. Unicode's decimal digits come in runs of ten from zero,
 * some back to back, so a digit's zero is as far back as its place in its
 * run of runs. Frames measure a counting number by its shape: a format
 * writes few shapes, which the chart's measurer keeps, so a transition
 * measures nothing new after its first frames; the number's text stays
 * exact, and its run is drawn from the edge its line aligns to.
 */
export function shapeOf(text: string): string {
  return text.replace(/\p{Nd}/gu, (digit) => {
    if (digit <= "9") return "0";
    const code = digit.codePointAt(0)!;
    let start = code;
    while (DIGIT.test(String.fromCodePoint(start - 1))) start--;
    return String.fromCodePoint(code - ((code - start) % 10));
  });
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
  const { names, table, generation, of, fields, values } = mark.named!;
  const count = names.length;
  const numbers = count * (fields?.length ?? 1);
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
    fields,
    values: values && Float64Array.from({ length: numbers }, (_, k) => values[k]!),
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
  /** How many numbers each label writes. */
  stride: number;
  /**
   * Per label, each of its numbers at both ends where it counts; where it
   * does not, the number it shows at both (NaN for none), which frames keep.
   */
  values: Float64Array;
  /** Per label, whether one of its numbers counts between two: frames write it again. */
  counting: boolean[];
  write: LabelItems["write"];
  /** Labels going: their texts or items, and the new scene's labels' items (labels geometry). */
  texts: readonly string[];
  items: readonly (readonly TextItem[])[];
  names: (string | number)[];
  /** A frame's places and numbers (`stride` per label). */
  at: Float32Array;
  numbers: Float64Array;
  /** Bars' labels: how far each one's place is past where its text starts (NaN: not known). */
  offsets: Float32Array;
  /**
   * Per label, whether a frame drew it by its number's shape: kept, it
   * goes on counting, so laid out, though its number stays, until the
   * scene; going, its items keep that layout.
   */
  shaped: boolean[];
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
 * and `y` do, counting numbers measured with `count` (by their shapes,
 * `shapeOf`). Bars' labels without a match follow their bar in `bars`.
 */
export function moveLabels(
  shown: readonly ShownLabels[],
  next: readonly { index: number; mark: Labeled }[],
  x: ScaleMotion,
  y: ScaleMotion,
  side: "y" | "yRight",
  bars: MovingBars | undefined,
  count: MeasureText,
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
  const make = (index: number, mark: Labeled, count: number, kept: number): MovingLabels => {
    const stride = mark.named!.fields?.length ?? 1;
    return {
      index,
      mark,
      side,
      kept,
      count,
      from: new Float32Array(count * 2),
      to: new Float32Array(count * 2),
      stride,
      values: new Float64Array(count * stride * 2).fill(Number.NaN),
      counting: [],
      write: kept > 0 ? mark.named!.write : undefined,
      texts: [],
      items: [],
      names: [],
      at: new Float32Array(count * 2),
      numbers: new Float64Array(count * stride),
      offsets: new Float32Array(count).fill(Number.NaN),
      shaped: [],
    };
  };
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
    const { stride, values } = record;
    const places = mark.kind === "text" ? mark.coords : labels.at!;
    const place = (i: number) => [places[i * 2]!, places[i * 2 + 1]!] as const;
    if (mark.kind === "labels") record.items = itemsOf(mark);
    for (let i = 0; i < kept; i++) {
      const name = labels.names[i]!;
      record.names.push(name);
      const [px, py] = place(i);
      record.to[i * 2] = px!;
      record.to[i * 2 + 1] = py!;
      record.offsets[i] = px! - (labels.starts?.[i] ?? Number.NaN);
      const found = match(name);
      if (found) {
        const [set, j] = found;
        const old = shown[set]!;
        matched.add(`${set}:${j}`);
        const was = old.fields?.length ?? 1;
        let counts = false;
        let changes = false;
        for (let k = 0; k < stride; k++) {
          // A number counts from the old label's at its place among its
          // numbers, of the same field; only finite numbers at both ends
          // count, others show the new one.
          const a =
            old.fields?.[k] === labels.fields?.[k]
              ? (old.values?.[j * was + k] ?? Number.NaN)
              : Number.NaN;
          const b = labels.values?.[i * stride + k] ?? Number.NaN;
          const moves = Number.isFinite(a) && Number.isFinite(b) && !!labels.write;
          values[(i * stride + k) * 2] = moves ? a : b;
          values[(i * stride + k) * 2 + 1] = b;
          counts ||= moves;
          // (Zeros of either sign are written apart.)
          changes ||= moves && !Object.is(a, b);
        }
        // (A frame's record of them is its own, never written again.)
        record.shaped[i] = counts && !!old.mark.named?.shaped?.[j];
        record.counting[i] = changes;
        // Frames lay a label out by its number's shape as it counts: its
        // text starts as far before its place as they write it. (Bars'
        // labels tell it, of one number each, from `values[i * 2]` to the next.)
        const written = (changes || record.shaped[i]) && labels.offset;
        if (written) record.offsets[i] = written(i, values[i * 2 + 1]!, count);
        record.from[i * 2] = old.at[j * 2]!;
        record.from[i * 2 + 1] = old.at[j * 2 + 1]!;
        // Anchored otherwise now (moving inside or outside its bar), its text
        // starts where it did, before its place by as much as frames write it.
        if (anchorOf(old.mark, old.items?.[j]) !== anchorOf(mark, record.items[i])) {
          const start =
            (old.starts?.[j] ?? Number.NaN) +
            (written ? written(i, values[i * 2]!, count) : record.offsets[i]!);
          if (Number.isFinite(start)) record.from[i * 2] = start;
        }
        moves ||= changes || record.from[i * 2] !== px || record.from[i * 2 + 1] !== py;
        continue;
      }
      moves = true;
      for (let k = i * stride; k < (i + 1) * stride; k++)
        values[k * 2] = values[k * 2 + 1] = labels.values?.[k] ?? Number.NaN;
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
  // (Labels going are bars', of one number each.)
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
      record.shaped[k] = !!labels.mark.named?.shaped?.[i];
    });
    record.texts = texts;
    record.items = items;
    if (!host) moving.push(record);
  }
  return { moving, moves };
}

/**
 * The labels at eased progress `t`, placed on the frame's scales `x` and
 * `y`, counting numbers measured with `measure` (by their shapes, `shapeOf`).
 */
export function labelsAt(
  moving: MovingLabels,
  t: number,
  x: Blend,
  y: Blend,
  measure: MeasureText,
): Labeled {
  const { mark, kept, count, from, to, stride, values, at, numbers, write } = moving;
  for (let i = 0; i < count; i++) {
    at[i * 2] = blend(x, from[i * 2]!, to[i * 2]!);
    at[i * 2 + 1] = blend(y, from[i * 2 + 1]!, to[i * 2 + 1]!);
  }
  // Each end as it is (and a number that does not count, an infinity among
  // them, always), and between them a blend that stays within its ends.
  for (let k = 0; k < count * stride; k++) {
    const a = values[k * 2]!;
    const b = values[k * 2 + 1]!;
    numbers[k] = t <= 0 ? a : t >= 1 || Object.is(a, b) ? b : a * (1 - t) + b * t;
  }
  // Labels whose numbers change count, and those a frame before drew by
  // their shapes; labels going keep their items, laid out as they were.
  const shaped: boolean[] = [];
  const counts = (i: number) => {
    const writes = i < kept && !!write && (moving.counting[i] || !!moving.shaped[i]);
    shaped[i] = writes || !!moving.shaped[i];
    return writes;
  };
  // Text labels stay inside the chart, as their scene keeps them: those
  // written again by what they write, others by their scene's blocks.
  const { stayInside } = mark.named!;
  const record: LabelItems = { ...mark.named!, names: moving.names, values: numbers, shaped };
  if (record.starts)
    record.starts = Float32Array.from(moving.offsets, (offset, i) => at[i * 2]! - offset);
  // Bars' labels are cut to the plot as they come and go past its end (scenes leave out those outside it).
  const clip = record.of !== undefined && mark.clip === undefined ? "plot" : mark.clip;
  if (mark.kind === "text") {
    const labels = Array.from({ length: count }, (_, i) => {
      if (counts(i)) return write!(i, numbers, at, measure) as string;
      if (i >= kept) return moving.texts[i]!;
      stayInside?.(i, at);
      return mark.labels[i]!;
    });
    return { ...mark, coords: at, labels, count, named: record, clip };
  }
  // Each label's items move by its place, or are written again at it as it counts.
  const owners: number[] = [];
  const items: TextItem[] = [];
  const own = mark.named!.at!;
  for (let i = 0; i < count; i++) {
    let made: readonly TextItem[];
    if (counts(i)) made = write!(i, numbers, at, measure) as readonly TextItem[];
    else {
      if (i < kept) stayInside?.(i, at);
      const [dx, dy] = [
        at[i * 2]! - (i < kept ? own[i * 2]! : from[i * 2]!),
        at[i * 2 + 1]! - (i < kept ? own[i * 2 + 1]! : from[i * 2 + 1]!),
      ];
      made = moving.items[i]!.map((item) => moved(item, dx, dy));
    }
    for (const item of made) {
      items.push(item);
      owners.push(i);
    }
  }
  record.at = at;
  record.owners = Uint32Array.from(owners);
  return { ...mark, items, named: record, clip };
}

/** `item` moved by (`dx`, `dy`), with its box. */
function moved(item: TextItem, dx: number, dy: number): TextItem {
  const { box } = item;
  return {
    ...item,
    x: item.x + dx,
    y: item.y + dy,
    box: box && { ...box, x: box.x + dx, y: box.y + dy },
  };
}
