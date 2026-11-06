// An independent reference for what a grid should display: row order after
// filtering and sorting, cell text, and checks of what an adapter reports
// against it. It shares no code with the adapters beyond the fixture and the
// formatting functions every grid is configured with.
//
// Semantics: sorts compare numbers and times numerically and categories by
// label (code-unit order), put missing values last in either direction, and
// break ties by row identity, oldest first. Filters drop missing values.

import { COLUMN_WIDTH, ROW_HEIGHT, type RowFilter, type SortKey, type Visible } from "./adapter.ts";
import {
  CELL_FIELDS,
  type CellContent,
  CHIP_FILLS,
  LINK_URL,
  N0_DOMAIN,
  N3_OVER,
  sameContent,
} from "./cells.ts";
import { formatValue, type GridField, type GridTable } from "./fixture.ts";
import {
  C0_COLORS,
  type CellLook,
  type LookDomain,
  N0_STEPS,
  N1_STEPS,
  N2_RANGE,
  N3_FILL,
  N3_TOP,
  N4_OVER,
  ROW_FILL,
  sameColor,
} from "./looks.ts";
import { LABEL, LABEL_FIELD, TOTALS, totalText } from "./summary.ts";

type Value = number | string | undefined;

function missing(value: Value): boolean {
  return value === undefined || (typeof value === "number" && Number.isNaN(value));
}

/** Ascending comparison with missing values last in both directions. */
function compare(a: Value, b: Value, descending: boolean): number {
  const am = missing(a);
  const bm = missing(b);
  if (am || bm) return am === bm ? 0 : am ? 1 : -1;
  const order = a! < b! ? -1 : a! > b! ? 1 : 0;
  return descending ? -order : order;
}

/** The rows a table holds over time: the starting table, appended batches, evictions, and updates. */
export class Reference {
  readonly fields: GridField[];
  private readonly chunks: GridTable[] = [];
  /** Updated values per field, by row identity. */
  private readonly overrides: Map<number, number>[];
  /** Live row identities are [start, end). */
  start: number;
  end: number;
  /** Whether grids show the looks scenarios' looks (looks.ts), which frames are then checked for. */
  readonly looks: boolean;
  /**
   * Whether grids draw the cells scenarios' cells (cells.ts), which frames
   * are then checked for; "react": drawn by React components (react-cells.tsx).
   */
  readonly cells: boolean | "react";
  /** Whether grids show the summary scenarios' totals row (summary.ts), which frames are then checked for. */
  readonly summary: boolean;

  constructor(table: GridTable, looks = false, cells: boolean | "react" = false, summary = false) {
    this.looks = looks;
    this.cells = cells;
    this.summary = summary;
    this.fields = table.fields;
    this.chunks.push(table);
    this.overrides = table.fields.map(() => new Map());
    this.start = table.firstId;
    this.end = table.firstId + table.length;
  }

  get length(): number {
    return this.end - this.start;
  }

  fieldIndex(name: string): number {
    const index = this.fields.findIndex((field) => field.name === name);
    if (index < 0) throw new Error(`no field ${name}`);
    return index;
  }

  append(batch: GridTable): void {
    if (batch.firstId !== this.end) throw new Error("batches must follow the newest row");
    this.chunks.push(batch);
    this.end += batch.length;
  }

  evict(count: number): void {
    this.start = Math.min(this.end, this.start + count);
  }

  update(field: number, ids: ArrayLike<number>, values: Float64Array): void {
    for (let i = 0; i < ids.length; i++) this.overrides[field]!.set(ids[i]!, values[i]!);
    this.#updates++;
  }

  private chunkOf(id: number): GridTable {
    let lo = 0;
    let hi = this.chunks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.chunks[mid]!.firstId <= id) lo = mid;
      else hi = mid - 1;
    }
    return this.chunks[lo]!;
  }

  /** A number or time (NaN when missing), or a category label (undefined when missing). */
  value(id: number, field: number): Value {
    const chunk = this.chunkOf(id);
    const raw = chunk.columns[field]![id - chunk.firstId]!;
    if (this.fields[field]!.kind === "category")
      return raw < 0 ? undefined : chunk.dictionaries[field]![raw];
    const overrides = this.overrides[field]!;
    return overrides.size > 0 ? (overrides.get(id) ?? raw) : raw;
  }

  text(id: number, field: number): string {
    const value = this.value(id, field);
    return formatValue(this.fields[field]!.kind, missing(value) ? undefined : value);
  }

  /**
   * The totals row's text under each field (summary.ts' totals over every
   * live row), worked out from the rows on its own; scanned again whenever
   * the rows change.
   */
  totalTexts(): string[] {
    const key = `${this.start} ${this.end} ${this.#updates}`;
    if (this.#totals?.key === key) return this.#totals.texts;
    const texts = this.fields.map((field, f) => {
      if (field.name === LABEL_FIELD) return LABEL;
      const op = TOTALS[field.name];
      if (!op) return "";
      if (op === "count") return totalText(field.name, this.length);
      let sum = 0;
      let n = 0;
      let extreme = Number.NaN;
      for (let id = this.start; id < this.end; id++) {
        const value = this.value(id, f) as number;
        if (Number.isNaN(value)) continue;
        sum += value;
        n++;
        if (Number.isNaN(extreme) || (op === "min" ? value < extreme : value > extreme))
          extreme = value;
      }
      const total = op === "sum" ? sum : op === "mean" ? (n > 0 ? sum / n : Number.NaN) : extreme;
      return totalText(field.name, total);
    });
    this.#totals = { key, texts };
    return texts;
  }

  #totals: { key: string; texts: string[] } | undefined;
  #domain: { key: string; domain: LookDomain } | undefined;
  /** Counts updates, which may move the looks' domain. */
  #updates = 0;

  /** The looks' domain over every live row (looks.ts), scanned again whenever the rows change. */
  lookDomain(): LookDomain {
    const key = `${this.start},${this.end},${this.#updates}`;
    if (this.#domain?.key === key) return this.#domain.domain;
    const n2 = this.fieldIndex("n2");
    const n3 = this.fieldIndex("n3");
    let min = Infinity;
    let max = -Infinity;
    const finite = new Float64Array(this.length);
    let count = 0;
    for (let id = this.start; id < this.end; id++) {
      const a = this.value(id, n2) as number;
      if (Number.isFinite(a)) {
        if (a < min) min = a;
        if (a > max) max = a;
      }
      const b = this.value(id, n3) as number;
      if (Number.isFinite(b)) finite[count++] = b;
    }
    const values = finite.subarray(0, count).sort();
    const domain: LookDomain = {
      extent: min <= max ? [min, max] : undefined,
      nth: count === 0 ? Number.NaN : values[Math.max(0, count - N3_TOP)]!,
    };
    this.#domain = { key, domain };
    return domain;
  }

  #indices: Map<string, number> | undefined;

  /**
   * The look of a row's cell of `field` (looks.ts' scenario), against
   * `domain`, worked out here apart from the adapters' code: a column's own
   * fill or color, the row's fill under cells without one, and black or
   * white text over a fill by the ratio of their contrasts.
   */
  look(id: number, field: number, domain = this.lookDomain()): CellLook | undefined {
    this.#indices ??= new Map(this.fields.map((f, i) => [f.name, i]));
    const indices = this.#indices;
    const read = (name: string) => this.value(id, indices.get(name)!);
    const name = this.fields[field]!.name;
    let fill: string | undefined;
    let color: string | undefined;
    const stepped = (
      value: number,
      steps: readonly (readonly [number, string])[],
      base?: string,
    ) => {
      if (missing(value)) return undefined;
      const passed = steps.filter(([at]) => value >= at);
      return passed.length > 0 ? passed[passed.length - 1]![1] : base;
    };
    if (name === "n0") fill = stepped(read("n0") as number, N0_STEPS.steps, N0_STEPS.base);
    else if (name === "n1") fill = stepped(read("n1") as number, N1_STEPS.steps);
    else if (name === "n2") {
      const value = read("n2") as number;
      if (!missing(value) && domain.extent) {
        const [lo, hi] = domain.extent;
        const t = lo === hi ? 1 : Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
        const [from, to] = N2_RANGE.map((c) =>
          [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)),
        );
        fill = `#${from!
          .map((c, i) =>
            Math.round(c + (to![i]! - c) * t)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")}`;
      }
    } else if (name === "n3") {
      const value = read("n3") as number;
      if (Number.isFinite(value) && value >= domain.nth) fill = N3_FILL;
    } else if (name === "c0") {
      const label = read("c0") as string | undefined;
      if (label !== undefined && Object.hasOwn(C0_COLORS, label)) color = C0_COLORS[label];
    }
    if (fill === undefined && (read("n4") as number) > N4_OVER) fill = ROW_FILL;
    if (fill === undefined && color === undefined) return undefined;
    if (color === undefined && fill !== undefined) {
      const l = luminanceOf(fill);
      color = (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#ffffff";
    }
    return { fill, color };
  }

  #extent: { key: string; extent: readonly [number, number] } | undefined;

  /** n4's bar's domain: the extent of every live row's value, with 0 included. */
  barExtent(): readonly [number, number] {
    const key = `${this.start},${this.end},${this.#updates}`;
    if (this.#extent?.key === key) return this.#extent.extent;
    const n4 = this.fieldIndex("n4");
    let low = 0;
    let high = 0;
    for (let id = this.start; id < this.end; id++) {
      const value = this.value(id, n4) as number;
      if (value < low) low = value;
      if (value > high) high = value;
    }
    this.#extent = { key, extent: [low, high] };
    return this.#extent.extent;
  }

  /**
   * What a row's cell of `field` draws beyond its text (cells.ts' scenario),
   * against n4's `extent`, worked out here apart from the adapters' code.
   */
  content(id: number, field: number, extent = this.barExtent()): CellContent | undefined {
    const name = this.fields[field]!.name;
    const value = this.value(id, field);
    if (missing(value) || !(CELL_FIELDS as readonly string[]).includes(name)) return undefined;
    const bar = (low: number, high: number) => {
      const at = (x: number) => Math.min(1, Math.max(0, (x - low) / (high - low)));
      const [start, end] = [at(0), at(value as number)].sort((a, b) => a - b);
      return { kind: "bar" as const, start: start!, end: end! };
    };
    switch (name) {
      case "c0":
        return { kind: "chip", fill: CHIP_FILLS[value as string] };
      case "n0":
        return bar(N0_DOMAIN[0], N0_DOMAIN[1]);
      case "n1":
        return { kind: "link", href: `${LINK_URL}${value}` };
      case "n3":
        return { kind: "symbol", shape: (value as number) > N3_OVER ? "triangle" : "circle" };
      case "n4":
        return bar(extent[0], extent[1]);
      default:
        return undefined;
    }
  }

  private passes(id: number, filter: RowFilter, field: number): boolean {
    const value = this.value(id, field);
    if (missing(value)) return false;
    if (filter.kind === "range")
      return (value as number) >= filter.min && (value as number) <= filter.max;
    return filter.labels.includes(value as string);
  }

  /**
   * Identities of displayed rows in display order. `previous`, an earlier
   * order of the same sort, only speeds up sorting: it starts nearly sorted.
   * It is not used with a filter, since updates can bring rows the earlier
   * order left out back in.
   */
  order(
    sort: readonly SortKey[],
    filter: RowFilter | null,
    previous?: readonly number[],
  ): number[] {
    let ids: number[];
    if (previous && !filter) {
      ids = previous.filter((id) => id >= this.start);
      let newest = this.start - 1;
      for (const id of previous) newest = Math.max(newest, id);
      for (let id = newest + 1; id < this.end; id++) ids.push(id);
    } else {
      ids = [];
      for (let id = this.start; id < this.end; id++) ids.push(id);
    }
    if (filter) {
      const field = this.fieldIndex(filter.field);
      const labels = filter.kind === "in" ? new Set(filter.labels) : undefined;
      ids = ids.filter((id) =>
        labels ? labels.has(this.value(id, field) as string) : this.passes(id, filter, field),
      );
    }
    if (sort.length === 0) return previous && !filter ? ids.sort((a, b) => a - b) : ids;
    const keys = sort.map((key) => {
      const field = this.fieldIndex(key.field);
      return { descending: key.descending, values: ids.map((id) => this.value(id, field)) };
    });
    const positions = ids.map((_, p) => p);
    positions.sort((a, b) => {
      for (const key of keys) {
        const order = compare(key.values[a], key.values[b], key.descending);
        if (order !== 0) return order;
      }
      return ids[a]! - ids[b]!;
    });
    return positions.map((p) => ids[p]!);
  }
}

/** WCAG's relative luminance of "#rrggbb". */
function luminanceOf(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** What a correct frame shows. */
export interface Expected {
  /** Displayed rows. */
  count: number;
  fields: number;
  /** Identity of the row at a display index. */
  idAt(index: number): number;
  text(id: number, field: number): string;
  /** Selection, when the scenario selects rows. */
  selected?: (id: number) => boolean;
  /** Cells' looks, when the scenario shows them. */
  look?: (id: number, field: number) => CellLook | undefined;
  /** What cells draw beyond their text, when the scenario draws them. */
  content?: (id: number, field: number) => CellContent | undefined;
  /** The totals row's text under each field, when the scenario shows one. */
  totals?: readonly string[];
  /** Requested scroll offsets; grids clamp them at the end of the content. */
  top: number;
  left: number;
}

/** Rows and columns visible at a scroll offset, as [first, last] indices. */
export function visibleRange(
  offset: number,
  size: number,
  step: number,
  count: number,
): [number, number] {
  const first = Math.floor((offset + 0.5) / step);
  const last = Math.min(count, Math.ceil((offset + size - 0.5) / step)) - 1;
  return [first, last];
}

/** Describes the first difference between what a grid shows and what it should, or undefined. */
export function verifyVisible(
  visible: Visible | undefined,
  expected: Expected,
): string | undefined {
  if (!visible) return "the grid reports nothing visible";
  const v = visible;
  if (v.count !== expected.count) return `shows ${v.count} rows in all, expected ${expected.count}`;
  const maxTop = Math.max(0, expected.count * ROW_HEIGHT - v.height);
  const top = Math.min(expected.top, maxTop);
  if (Math.abs(v.top - top) > Math.max(1, v.scrollStep ?? 1))
    return `shows the body from top ${v.top}, expected ${top}`;
  const maxLeft = Math.max(0, expected.fields * COLUMN_WIDTH - v.width);
  const left = Math.min(expected.left, maxLeft);
  if (Math.abs(v.left - left) > 1) return `shows the body from left ${v.left}, expected ${left}`;
  const [firstRow, lastRow] = visibleRange(v.top, v.height, ROW_HEIGHT, expected.count);
  const rows = Math.max(0, lastRow - firstRow + 1);
  if (v.rows.length !== rows)
    return `shows ${v.rows.length} rows, expected ${rows} (display rows ${firstRow}-${lastRow})`;
  for (let r = 0; r < rows; r++) {
    const id = expected.idAt(firstRow + r);
    const shown = v.rows[r];
    if (shown !== undefined && shown !== id)
      return `display row ${firstRow + r} is row ${shown}, expected ${id}`;
  }
  const [firstColumn, lastColumn] = visibleRange(v.left, v.width, COLUMN_WIDTH, expected.fields);
  const columns = lastColumn - firstColumn + 1;
  if (v.columns.length !== columns || v.columns.some((field, c) => field !== firstColumn + c))
    return `shows columns ${v.columns.join(",")}, expected ${firstColumn}-${lastColumn}`;
  if (expected.totals)
    for (let c = 0; c < columns; c++) {
      const want = expected.totals[firstColumn + c];
      const got = v.totals?.[c];
      if (got !== want)
        return `the totals row's column ${firstColumn + c} shows "${got}", expected "${want}"`;
    }
  for (let r = 0; r < rows; r++) {
    const id = expected.idAt(firstRow + r);
    for (let c = 0; c < columns; c++) {
      const want = expected.text(id, firstColumn + c);
      const got = v.text[r]?.[c];
      if (got !== want)
        return `row ${id} column ${firstColumn + c} shows "${got}", expected "${want}"`;
    }
    if (expected.look) {
      for (let c = 0; c < columns; c++) {
        const want = expected.look(id, firstColumn + c);
        const got = v.looks?.[r]?.[c];
        if (!sameColor(got?.fill, want?.fill) || !sameColor(got?.color, want?.color))
          return `row ${id} column ${firstColumn + c} looks ${JSON.stringify(got ?? null)}, expected ${JSON.stringify(want ?? null)}`;
      }
    }
    if (expected.content) {
      for (let c = 0; c < columns; c++) {
        const want = expected.content(id, firstColumn + c);
        const got = v.content?.[r]?.[c];
        if (!sameContent(got, want))
          return `row ${id} column ${firstColumn + c} draws ${JSON.stringify(got ?? null)}, expected ${JSON.stringify(want ?? null)}`;
      }
    }
    const selected = expected.selected?.(id) ?? false;
    if (v.selected[r] !== selected)
      return `row ${id} is shown ${v.selected[r] ? "selected" : "unselected"}, expected the opposite`;
  }
  return undefined;
}

/** Describes the first difference between two display orders, or undefined. */
export function verifyOrder(got: ArrayLike<number>, want: readonly number[]): string | undefined {
  if (got.length !== want.length) return `displays ${got.length} rows, expected ${want.length}`;
  for (let i = 0; i < want.length; i++)
    if (got[i] !== want[i]) return `display row ${i} is row ${got[i]}, expected ${want[i]}`;
  return undefined;
}
