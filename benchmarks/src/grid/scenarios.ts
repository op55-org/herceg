// Grid scenario catalog, shared by the in-page harness and the Node runner.

import type { RowFilter, SortKey } from "./adapter.ts";
import type { GridSize } from "./fixture.ts";

export type GridOperation =
  /** Mount from prepared native input and from the columnar fixture (conversion counted); destroy. */
  | "mount"
  /** Scroll steps, each to its correct frame. */
  | "scroll"
  /** Continuous scrolling with vsync: offsets set every frame, or wheel input from the browser. */
  | "scroll-trace"
  | "sort"
  | "filter"
  /** Select one displayed row, or a displayed-order range, under a sort. */
  | "select"
  /** Append batches on a timer (vsync), optionally evicting the oldest rows. */
  | "append"
  /** Change values of random rows on a timer (vsync). */
  | "update"
  /** Heap, DOM, and canvas footprint; destroy and repeated mounts. Driven by the runner. */
  | "memory";

export interface GridScenario {
  id: string;
  sizeName: SizeName;
  size: GridSize;
  /** Seeds the fixture's values; 1 unless the runner is given another. */
  seed?: number;
  operation: GridOperation;
  /**
   * Scroll direction for `scroll` and `scroll-trace`; `end` jumps between the
   * last row and the top; `wheel` scrolls down with wheel events the runner
   * dispatches through the browser.
   */
  direction?: "vertical" | "horizontal" | "diagonal" | "end" | "wheel";
  /** Sort applied by the operation (`sort`) or before it (`select`, `append`, `update`). */
  sort?: SortKey[];
  filter?: RowFilter;
  /** `select`: rows selected at once (1 for a single row; 0.5 means half the rows). */
  select?: number;
  /** `append`: rows per batch, evicting as many when `evict`. `update`: rows changed per tick. */
  batch?: number;
  evict?: boolean;
  /** `update`: the field changed. */
  field?: string;
  /** Timer rate and trial length for `append` and `update` (a fixed-duration offered load), and `scroll-trace`. */
  rateHz?: number;
  durationMs?: number;
  samples: number;
  warmup: number;
  /** Seconds before the runner abandons the scenario for a library (default 600). */
  timeout?: number;
  /** Grids show the looks scenarios' conditional formatting (looks.ts), checked in every frame. */
  looks?: boolean;
  /**
   * Grids draw the cells scenarios' bars, chips, links, and symbols
   * (cells.ts), checked in every frame; "framework": through components of
   * the grid's framework holding state (react-cells.tsx and its Vue and
   * Svelte equivalents) in each grid's framework cells.
   */
  cells?: boolean | "framework";
  /** Grids show the summary scenarios' headings and totals row (summary.ts), its text checked in every frame. */
  summary?: boolean;
  description: string;
}

export const SIZES = {
  "10k": { rows: 10_000, groups: 1 },
  "100k": { rows: 100_000, groups: 1 },
  "1m": { rows: 1_000_000, groups: 1 },
  "1m-wide": { rows: 1_000_000, groups: 5 },
} satisfies Record<string, GridSize>;

export type SizeName = keyof typeof SIZES;

const SORT_NUMBER_ASC: SortKey[] = [{ field: "n2", descending: false }];
const SORT_NUMBER_DESC: SortKey[] = [{ field: "n2", descending: true }];
const SORT_CATEGORY_NUMBER: SortKey[] = [
  { field: "c0", descending: false },
  { field: "n1", descending: true },
];
const SKUS = (count: number) =>
  Array.from({ length: count }, (_, i) => `sku${String(i).padStart(4, "0")}`);

/** Scenarios at one size. `stress` keeps the cases that say most about limits. */
function scenariosFor(name: SizeName, stress: boolean): GridScenario[] {
  const size = SIZES[name];
  const shape = `${size.rows.toLocaleString("en-US")} x ${size.groups * 20}`;
  const latency = stress ? { samples: 3, warmup: 1 } : { samples: 20, warmup: 3 };
  const paced = stress ? { samples: 1, warmup: 0 } : { samples: 2, warmup: 1 };
  const timeout = stress ? 900 : 300;
  const id = (suffix: string) => `grid-${name}-${suffix}`;
  const all: (Omit<GridScenario, "sizeName"> & { stress: boolean })[] = [
    {
      id: id("mount"),
      size,
      operation: "mount",
      ...latency,
      timeout,
      stress: true,
      description: `${shape}: mount to first correct frame, then destroy`,
    },
    ...(["vertical", "horizontal", "diagonal", "end"] as const).map((direction) => ({
      id: id(`scroll-${direction}`),
      size,
      operation: "scroll" as const,
      direction,
      samples: stress ? 10 : 40,
      warmup: stress ? 2 : 5,
      timeout,
      stress: direction === "vertical" || direction === "end",
      description:
        direction === "end"
          ? `${shape}: jump to the last row and back`
          : `${shape}: ${direction} scroll steps of a screen`,
    })),
    ...(["vertical", "diagonal", "wheel"] as const).map((direction) => ({
      id: id(`trace-${direction}`),
      size,
      operation: "scroll-trace" as const,
      direction,
      durationMs: 3000,
      ...paced,
      timeout,
      stress: false,
      description:
        direction === "wheel"
          ? `${shape}: 3 s of wheel scrolling down, dispatched by the browser`
          : `${shape}: 3 s of ${direction} scrolling, offsets set every frame`,
    })),
    {
      id: id("sort-number-asc"),
      size,
      operation: "sort",
      sort: SORT_NUMBER_ASC,
      ...latency,
      timeout,
      stress: false,
      description: `${shape}: sort a number field ascending`,
    },
    {
      id: id("sort-number-desc"),
      size,
      operation: "sort",
      sort: SORT_NUMBER_DESC,
      ...latency,
      timeout,
      stress: true,
      description: `${shape}: sort a number field descending`,
    },
    {
      id: id("sort-category-number"),
      size,
      operation: "sort",
      sort: SORT_CATEGORY_NUMBER,
      ...latency,
      timeout,
      stress: false,
      description: `${shape}: sort by category, then a number field`,
    },
    ...(
      [
        ["1", 10],
        ["50", 500],
        ["99", 990],
      ] as const
    ).flatMap(([percent, bound]) => [
      {
        id: id(`filter-range-${percent}`),
        size,
        operation: "filter" as const,
        filter: { kind: "range" as const, field: "n0", min: 0, max: bound },
        ...latency,
        timeout,
        stress: percent === "50",
        description: `${shape}: number range filter keeping about ${percent}%`,
      },
      {
        id: id(`filter-category-${percent}`),
        size,
        operation: "filter" as const,
        filter: { kind: "in" as const, field: "c1", labels: SKUS(bound) },
        ...latency,
        timeout,
        stress: false,
        description: `${shape}: category membership filter keeping about ${percent}%`,
      },
    ]),
    {
      id: id("select-row"),
      size,
      operation: "select",
      sort: SORT_CATEGORY_NUMBER,
      select: 1,
      ...latency,
      timeout,
      stress: false,
      description: `${shape}: select one displayed row (sorted)`,
    },
    {
      id: id("select-range"),
      size,
      operation: "select",
      sort: SORT_CATEGORY_NUMBER,
      select: 0.5,
      ...latency,
      timeout,
      stress: false,
      description: `${shape}: select half the rows in display order (sorted), then read the selection`,
    },
    {
      id: id("append"),
      size,
      operation: "append",
      batch: 1000,
      rateHz: 10,
      durationMs: 5000,
      ...paced,
      timeout,
      stress: false,
      description: `${shape}: append 1,000 rows at 10 Hz`,
    },
    {
      id: id("append-sorted"),
      size,
      operation: "append",
      sort: SORT_NUMBER_DESC,
      batch: 1000,
      rateHz: 10,
      durationMs: 5000,
      ...paced,
      timeout,
      stress: true,
      description: `${shape}: append 1,000 rows at 10 Hz under a number sort`,
    },
    {
      id: id("append-rolling"),
      size,
      operation: "append",
      batch: 1000,
      evict: true,
      rateHz: 10,
      durationMs: 5000,
      ...paced,
      timeout,
      stress: false,
      description: `${shape}: append 1,000 rows and evict the oldest 1,000 at 10 Hz`,
    },
    {
      id: id("append-rolling-sorted"),
      size,
      operation: "append",
      sort: SORT_NUMBER_DESC,
      batch: 1000,
      evict: true,
      rateHz: 10,
      durationMs: 5000,
      ...paced,
      timeout,
      stress: false,
      description: `${shape}: append 1,000 rows and evict the oldest 1,000 at 10 Hz under a number sort`,
    },
    {
      id: id("update"),
      size,
      operation: "update",
      field: "n4",
      batch: 100,
      rateHz: 10,
      durationMs: 5000,
      ...paced,
      timeout,
      stress: false,
      description: `${shape}: change a display-only field in 100 rows (10 on screen) at 10 Hz`,
    },
    {
      id: id("update-sorted"),
      size,
      operation: "update",
      field: "n3",
      sort: [{ field: "n3", descending: true }],
      batch: 100,
      rateHz: 10,
      durationMs: 5000,
      ...paced,
      timeout,
      stress: false,
      description: `${shape}: change the sort key of 100 rows (10 on screen) at 10 Hz`,
    },
    {
      id: id("update-filtered"),
      size,
      operation: "update",
      field: "n0",
      filter: { kind: "range", field: "n0", min: 0, max: 500 },
      batch: 100,
      rateHz: 10,
      durationMs: 5000,
      ...paced,
      timeout,
      stress: false,
      description: `${shape}: change the filtered field of 100 rows (10 on screen) at 10 Hz`,
    },
    {
      id: id("memory"),
      size,
      operation: "memory",
      sort: SORT_NUMBER_DESC,
      samples: stress ? 1 : 3,
      warmup: 0,
      timeout,
      stress: true,
      description: `${shape}: heap, DOM, and canvas footprint; destroy and repeated mounts`,
    },
  ];
  return all
    .filter((s) => !stress || s.stress)
    .map(({ stress: _, ...s }) => ({ ...s, sizeName: name }));
}

/**
 * Looks at one size: six presented columns colored by thresholds, a
 * gradient, a label, a row condition, and a rank (looks.ts), mounted,
 * scrolled, traced, and streamed through a rolling window, each frame's
 * looks checked with its text.
 */
function looksFor(name: SizeName): GridScenario[] {
  const size = SIZES[name];
  const shape = `${size.rows.toLocaleString("en-US")} x ${size.groups * 20}`;
  const big = size.rows >= 1_000_000;
  const id = (suffix: string) => `grid-${name}-looks-${suffix}`;
  const timeout = big ? 900 : 300;
  return [
    {
      id: id("mount"),
      sizeName: name,
      size,
      operation: "mount",
      looks: true,
      samples: big ? 5 : 20,
      warmup: big ? 1 : 3,
      timeout,
      description: `${shape} with looks: mount to the first correct frame (cold, warm, and over reordered dictionaries)`,
    },
    ...(["vertical", "diagonal"] as const).map((direction) => ({
      id: id(`scroll-${direction}`),
      sizeName: name,
      size,
      operation: "scroll" as const,
      direction,
      looks: true,
      samples: big ? 10 : 40,
      warmup: big ? 2 : 5,
      timeout,
      description: `${shape} with looks: ${direction} scroll steps of a screen`,
    })),
    ...(["vertical", "diagonal"] as const).map((direction) => ({
      id: id(`trace-${direction}`),
      sizeName: name,
      size,
      operation: "scroll-trace" as const,
      direction,
      looks: true,
      durationMs: 3000,
      samples: big ? 1 : 2,
      warmup: big ? 0 : 1,
      timeout,
      description: `${shape} with looks: 3 s of ${direction} scrolling, offsets set every frame`,
    })),
    {
      id: id("append-rolling"),
      sizeName: name,
      size,
      operation: "append",
      looks: true,
      batch: 1000,
      evict: true,
      rateHz: 10,
      durationMs: 5000,
      samples: big ? 1 : 2,
      warmup: big ? 0 : 1,
      timeout,
      description: `${shape} with looks: append 1,000 rows and evict the oldest 1,000 at 10 Hz`,
    },
  ];
}

/**
 * Cells at one size: bars on two columns, chips, links, and symbols
 * (cells.ts), mounted, scrolled, traced, and held in memory, each frame's
 * content checked with its text. With `framework`, drawn by components of
 * each grid's framework (react-cells.tsx, vue-cells.ts, svelte-cells/)
 * through its framework cells.
 */
function cellsFor(name: SizeName, framework = false): GridScenario[] {
  const size = SIZES[name];
  const shape = `${size.rows.toLocaleString("en-US")} x ${size.groups * 20}`;
  const big = size.rows >= 1_000_000;
  const kind = framework ? "framework-cells" : "cells";
  const id = (suffix: string) => `grid-${name}-${kind}-${suffix}`;
  const timeout = big ? 900 : 300;
  const common = {
    sizeName: name,
    size,
    cells: framework ? ("framework" as const) : true,
    timeout,
  };
  const cells = framework ? "framework cells" : "cells";
  return [
    {
      ...common,
      id: id("mount"),
      operation: "mount",
      samples: big ? 5 : 20,
      warmup: big ? 1 : 3,
      description: `${shape} with ${cells}: mount to the first correct frame`,
    },
    ...(["vertical", "diagonal"] as const).map((direction) => ({
      ...common,
      id: id(`scroll-${direction}`),
      operation: "scroll" as const,
      direction,
      samples: big ? 10 : 40,
      warmup: big ? 2 : 5,
      description: `${shape} with ${cells}: ${direction} scroll steps of a screen`,
    })),
    ...(["vertical", "diagonal"] as const).map((direction) => ({
      ...common,
      id: id(`trace-${direction}`),
      operation: "scroll-trace" as const,
      direction,
      durationMs: 3000,
      samples: big ? 1 : 2,
      warmup: big ? 0 : 1,
      description: `${shape} with ${cells}: 3 s of ${direction} scrolling, offsets set every frame`,
    })),
    {
      ...common,
      id: id("memory"),
      operation: "memory",
      sort: SORT_NUMBER_DESC,
      samples: big ? 1 : 3,
      warmup: 0,
      description: `${shape} with ${cells}: heap, DOM, and canvas footprint; destroy and repeated mounts`,
    },
  ];
}

/**
 * Headings and a totals row at one size (summary.ts): mounted, scrolled,
 * traced, and streamed through appends and a rolling window, each frame's
 * totals checked with its text.
 */
function summaryFor(name: SizeName): GridScenario[] {
  const size = SIZES[name];
  const shape = `${size.rows.toLocaleString("en-US")} x ${size.groups * 20}`;
  const big = size.rows >= 1_000_000;
  const id = (suffix: string) => `grid-${name}-summary-${suffix}`;
  const common = { sizeName: name, size, summary: true, timeout: big ? 900 : 300 };
  const what = "with headings and a totals row";
  const paced = { rateHz: 10, durationMs: 5000, samples: big ? 1 : 2, warmup: big ? 0 : 1 };
  return [
    {
      ...common,
      id: id("mount"),
      operation: "mount",
      samples: big ? 5 : 20,
      warmup: big ? 1 : 3,
      description: `${shape} ${what}: mount to the first correct frame`,
    },
    ...(["vertical", "diagonal"] as const).map((direction) => ({
      ...common,
      id: id(`scroll-${direction}`),
      operation: "scroll" as const,
      direction,
      samples: big ? 10 : 40,
      warmup: big ? 2 : 5,
      description: `${shape} ${what}: ${direction} scroll steps of a screen`,
    })),
    {
      ...common,
      id: id("trace-vertical"),
      operation: "scroll-trace",
      direction: "vertical",
      durationMs: 3000,
      samples: big ? 1 : 2,
      warmup: big ? 0 : 1,
      description: `${shape} ${what}: 3 s of vertical scrolling, offsets set every frame`,
    },
    {
      ...common,
      ...paced,
      id: id("append"),
      operation: "append",
      batch: 1000,
      description: `${shape} ${what}: append 1,000 rows at 10 Hz`,
    },
    {
      ...common,
      ...paced,
      id: id("append-rolling"),
      operation: "append",
      batch: 1000,
      evict: true,
      description: `${shape} ${what}: append 1,000 rows and evict the oldest 1,000 at 10 Hz`,
    },
  ];
}

export const GRID_SCENARIOS: GridScenario[] = [
  ...scenariosFor("10k", false),
  ...scenariosFor("100k", false),
  ...looksFor("100k"),
  ...cellsFor("100k"),
  ...cellsFor("100k", true),
  ...summaryFor("100k"),
  ...scenariosFor("1m", true),
  ...looksFor("1m"),
  ...cellsFor("1m"),
  ...cellsFor("1m", true),
  ...summaryFor("1m"),
  ...scenariosFor("1m-wide", true),
];
