// The chart state options set and events report, in the portable spec:
// one selection at a time (of a brush, of items, or of series), the view,
// what is hidden, and the drill root. Each type is the whole state, so the
// value an event reports can be given back as the option unchanged.

import { ChartError } from "./errors.ts";
import type { PaintStyle } from "./style.ts";

/** A part of an item's name after its mark's: a name, or an interval of a bin. */
export type ItemPart = string | number | null | readonly [from: number, to: number];

/**
 * An item named by the application where it has no key from an event yet:
 * a mark's `id` and the parts of the item's name after it, as keys hold
 * them: `{ mark: "brands", item: ["Coca-Cola"] }` (a bar keyed by brand),
 * `{ mark: "lines", item: ["auth", 1767225600000] }` (the `auth`
 * observation of a wide line keyed by time), `{ mark: "delays", item: [[0, 10]] }`
 * (a histogram's bin from 0 to 10).
 */
export interface ItemReference {
  readonly mark: string;
  readonly item: readonly ItemPart[];
}

/** A series named by the application: a mark's `id`, and a value field or a series field's value. */
export interface SeriesReference {
  readonly mark: string;
  readonly series: string;
}

/**
 * What a brush selected, or `select` set as if brushed: ranges along x and
 * y in data values (epoch ms on time axes, band indices on category axes),
 * and a lasso's outline.
 */
export interface BrushSelection {
  readonly kind: "brush";
  /** The x range, ascending; null for brushes along y. */
  readonly x: readonly [number, number] | null;
  /** The y range, ascending; null for brushes along x. */
  readonly y: readonly [number, number] | null;
  /** A lasso's outline as x, y pairs; null for other brushes, whose ranges say it all. */
  readonly lasso: readonly (readonly [number, number])[] | null;
  /** The panel it was drawn in, where that panel's scales are not every panel's. */
  readonly panel?: string | undefined;
}

/**
 * Items chosen by clicks or keys (`interaction.select: "items"`) or set:
 * bars, points, a line's observations, bins, cells, layout items. Only
 * those items are selected, in their marks: another mark's item from the
 * same row is not.
 */
export interface ItemSelection {
  readonly kind: "items";
  /** Item keys, as events give them; the chart also takes references. */
  readonly items: readonly (string | ItemReference)[];
}

/** Series chosen by clicks or keys (`interaction.select: "series"`) or set. */
export interface SeriesSelection {
  readonly kind: "series";
  /** Series keys, as events and the legend give them; the chart also takes references. */
  readonly series: readonly (string | SeriesReference)[];
}

/** A chart's selection: one at a time, of a brush, of items, or of series; each replaces the others. */
export type ChartSelection = BrushSelection | ItemSelection | SeriesSelection;

/** Where a change a gesture makes is: still moving, done, or undone. */
export type Phase = "preview" | "commit" | "cancel";

/** A state of the chart's, or a state per panel where panels have their own. */
export type Scoped<T> = T | { readonly panels: Readonly<Record<string, T>> };

/** What a chart shows along each axis (null: not zoomed), as `setViewport` takes it. */
export interface ViewState {
  readonly x?: readonly [number, number] | null | undefined;
  readonly y?: readonly [number, number] | null | undefined;
  readonly yRight?: readonly [number, number] | null | undefined;
}

/** The chart's view, or each panel's where panels zoom on their own. */
export type ViewportState = Scoped<ViewState>;

/**
 * The keys hidden in the chart, and per subplot the keys its own legend
 * hid and showed there unlike the rest of the chart.
 */
export interface VisibilityState {
  readonly hidden: readonly string[];
  readonly panels?:
    | Readonly<
        Record<string, { readonly hidden: readonly string[]; readonly shown: readonly string[] }>
      >
    | undefined;
}

/** A tree's drill root: its item key or its names from the top; null for the whole tree. */
export type DrillState = Scoped<string | readonly string[] | null>;

/** The state options (see `StateSpec`). */
export const STATE_OPTIONS = ["selection", "viewport", "visibility", "drillRoot"] as const;

/** What a chart without state support refuses of what needs it, at `path`. */
export function needsState(where: string, path = where): ChartError {
  return new ChartError({
    code: "unsupported",
    path,
    message: `${where}: needs state support; give the chart state: chartState, from herceg/state`,
  });
}

/**
 * State the chart keeps that options may set, not hold (they are not
 * controlled props): given when the chart is made, each is its first
 * state; given again with another value than the one last given
 * (compared by value, key lists as sets), the chart changes to it as the
 * matching method would, reporting cause "options", and a gesture changing
 * it ends (`cancel`). Given as `undefined`, it is forgotten: the chart's
 * input alone changes the state, and any value given later applies.
 */
export interface StateSpec {
  selection?: ChartSelection | null | undefined;
  viewport?: ViewportState | undefined;
  visibility?: VisibilityState | undefined;
  drillRoot?: DrillState | undefined;
}

/** A look laid over a mark's paint where a selection marks it out. */
export type Look = PaintStyle & {
  /** A point's radius, in pixels. */
  radius?: number;
};

/** How a mark's selected and unselected items, rows, and series look. */
export interface SelectionLooks {
  /**
   * What a selection holds of the mark (items or series selected, or the
   * rows a row selection highlights); as drawn by default.
   */
  selected?: Look;
  /** What it does not, while it holds something; by default at a quarter of its opacity. */
  unselected?: Look;
}
