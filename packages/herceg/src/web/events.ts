// Chart events as JSON, the form they take between runtimes: Python reads
// them (python/src/herceg/_events.py), pages' DOM events carry them
// (mount.ts), and a server can read what a page posts. Axes holding times
// are named, so readers can make dates of epoch milliseconds, and category
// positions are their labels rather than band indices.

import type { Selection } from "../dom/brushed.ts";
import type { ChartEvents } from "../dom/events.ts";
import type { Axis, AxisInfo, Chart } from "../dom/handle.ts";
import type { Inspection, Viewport } from "../model/model.ts";

type Ends = [number, number] | [string, string];
type Range = readonly [number, number];

/** A viewport: each axis' range, or null where it is not zoomed. */
export interface ViewportPayload {
  x: Ends | null;
  y: Ends | null;
  yRight: Ends | null;
  /** The axes whose values are times, in epoch milliseconds. */
  time?: Axis[];
}

/** A selection: x and y ranges and a lasso's outline. */
export interface SelectionPayload {
  /** The panels it belongs to, when they are a subplot's (a map's or network's lasso). */
  panels?: string[];
  x: Ends | null;
  y: Ends | null;
  /** [x, y] pairs: numbers, epoch ms on time axes, and band positions on category axes. */
  lasso: [number, number][] | null;
  /**
   * For a lasso over category axes, their categories, which its band
   * positions refer to: elsewhere they would outline other categories.
   */
  categories?: Categories;
  time?: Axis[];
}

/** The categories of a selection's x and y axes; null for an axis of other values. */
type Categories = [string[] | null, string[] | null];

export interface InspectionPayload {
  /** "item" for a pie slice, whose value is the slice's. */
  axis: "x" | "y" | "item";
  value: number | string | null;
  time: boolean;
  label: string;
  panel?: string;
  points: {
    mark: number;
    markId: string | null;
    key: string;
    label: string;
    row: number | null;
    value: number | null;
    text: string;
    /** The fields of the row its mark's tooltip shows (`tooltip.fields`), times in epoch ms. */
    fields?: {
      field: string;
      label: string;
      kind: string;
      value: number | string | null;
      text: string;
    }[];
  }[];
  /** An item's data by field (a 3D chart's point): numbers, times in epoch ms, and categories. */
  values?: Readonly<Record<string, number | string>>;
}

/** What reads a chart's axes, as Python sees their values: their types and categories. */
interface Scales {
  x: AxisInfo | undefined;
  y: AxisInfo | undefined;
  yRight?: AxisInfo | undefined;
}

/**
 * The axes Python reads, as the chart last drew them: of `panel`, or by
 * default of the first panel drawing with the x scale panels share (else
 * the first with axes). A map's or network's subplot has none: its
 * plane's values are plain numbers.
 */
function scalesOf(chart: Chart, panel?: string): Scales {
  const axes = chart.getPanels().filter(({ x }) => x);
  const found =
    panel === undefined
      ? (axes.find(({ x }) => x!.group === "") ?? axes[0])
      : axes.find(({ key }) => key === panel);
  return { x: found?.x, y: found?.y, yRight: found?.yRight };
}

const timeAxes = (scales: Scales, axes: readonly Axis[]): Axis[] =>
  axes.filter((axis) => scales[axis]?.type === "time");

/** An edge event as Python reads it, with whether its scale holds times. */
export function edgePayload(chart: Chart, edge: ChartEvents["edge"]) {
  // The scale of the panels the edge names, or of those sharing x.
  const panels = chart.getPanels();
  const panel =
    panels.find(({ key }) => edge.panels?.includes(key)) ??
    panels.find(({ x }) => x?.group === "") ??
    panels.find(({ x }) => x);
  return { ...edge, time: panel?.[edge.scale]?.type === "time" };
}

/**
 * A viewport as Python reads it, of `panel`'s axes (or the first panel's);
 * a plane's (a map's or network's subplot's) has no times.
 */
export function viewportPayload(
  chart: Chart,
  view: Viewport,
  plane = false,
  panel?: string,
): ViewportPayload {
  const scales = plane ? { x: undefined, y: undefined } : scalesOf(chart, panel);
  return {
    x: ends(view.x, scales.x),
    y: ends(view.y, scales.y),
    yRight: ends(view.yRight, scales.yRight),
    time: timeAxes(scales, ["x", "y", "yRight"]),
  };
}

/**
 * A viewport from Python as the chart takes it, on `panel`'s axes (or the
 * first panel's): category labels become band indices.
 */
export function chartViewport(
  chart: Chart,
  payload: ViewportPayload | null,
  panel?: string,
): Viewport {
  const scales = scalesOf(chart, panel);
  return {
    x: chartRange(payload?.x ?? null, scales.x),
    y: chartRange(payload?.y ?? null, scales.y),
    yRight: chartRange(payload?.yRight ?? null, scales.yRight),
  };
}

/**
 * A selection as Python reads it, or null for none. Its y values are read
 * on the y axis of the first panel it belongs to.
 */
export function selectionPayload(
  chart: Chart,
  selection: Selection | null,
  panels?: readonly string[],
): SelectionPayload | null {
  if (!selection || !(selection.x || selection.y || selection.lasso)) return null;
  const scales = scalesOf(chart, chart.selectionPanels?.[0]);
  const categories = selection.lasso ? categoriesOf(chart) : undefined;
  return {
    ...(panels && { panels: [...panels] }),
    x: ends(selection.x, scales.x),
    y: ends(selection.y, scales.y),
    lasso: selection.lasso?.map(([x, y]) => [x, y]) ?? null,
    ...(categories && { categories }),
    time: timeAxes(scales, ["x", "y"]),
  };
}

/**
 * A selection from Python as the chart takes it, or null for none: with
 * category labels, where the categories are now, and null when a range's
 * categories are gone, since part of a selection is another selection.
 */
export function chartSelection(chart: Chart, payload: SelectionPayload | null): Selection | null {
  if (!payload) return null;
  // A lasso whose categories moved would outline others.
  if (payload.lasso && payload.categories) {
    if (JSON.stringify(categoriesOf(chart)) !== JSON.stringify(payload.categories)) return null;
  }
  const scales = scalesOf(chart, payload.panels?.[0]);
  const x = chartRange(payload.x, scales.x);
  const y = chartRange(payload.y, scales.y);
  if ((payload.x && !x) || (payload.y && !y)) return null;
  const lasso = payload.lasso?.map(([px, py]) => [px, py] as const) ?? null;
  return x || y || lasso ? { x, y, lasso } : null;
}

/**
 * Whether a selection depends on the categories, which change with the
 * data: its ranges name them, or its lasso outlines them.
 */
export function namesCategories(payload: SelectionPayload | null): boolean {
  return (
    typeof payload?.x?.[0] === "string" ||
    typeof payload?.y?.[0] === "string" ||
    payload?.categories !== undefined
  );
}

/** The categories of the axes a selection is on; undefined when neither is a category axis. */
function categoriesOf(chart: Chart): Categories | undefined {
  const { x, y } = scalesOf(chart, chart.selectionPanels?.[0]);
  if (!x?.categories && !y?.categories) return undefined;
  return [x?.categories ? [...x.categories] : null, y?.categories ? [...y.categories] : null];
}

export function inspectionPayload(
  chart: Chart,
  inspection: Inspection | undefined,
): InspectionPayload | null {
  if (!inspection) return null;
  // The panel's axes, which may differ from other panels'.
  const panels = chart.getPanels();
  const panel = panels.find(({ key }) => key === inspection.panel) ?? panels[0];
  const scale = inspection.axis === "item" ? undefined : panel?.[inspection.axis];
  const categories = scale?.type === "band" ? scale.categories : undefined;
  return {
    axis: inspection.axis,
    value: categories ? label(categories, inspection.value) : finite(inspection.value),
    time: scale?.type === "time",
    label: inspection.label,
    ...(inspection.panel !== undefined && { panel: inspection.panel }),
    points: inspection.points.map((point) => ({
      mark: point.mark,
      markId: point.markId ?? null,
      key: point.key,
      label: point.label,
      row: point.row ?? null,
      value: finite(point.value),
      text: point.text,
      ...(point.fields && { fields: point.fields.map((field) => ({ ...field })) }),
    })),
    ...(inspection.axis === "item" && inspection.values && { values: inspection.values }),
  };
}

/** A range's ends as Python reads them: on category axes, labels. */
function ends(range: Range | null, scale: AxisInfo | undefined): Ends | null {
  if (!range) return null;
  const categories = scale?.type === "band" ? scale.categories : undefined;
  if (categories) return [label(categories, range[0]), label(categories, range[1])];
  return [range[0], range[1]];
}

/** A range from Python as the chart takes it: category labels become band indices, or null when gone. */
function chartRange(range: Ends | null, scale: AxisInfo | undefined): Range | null {
  if (!range) return null;
  const [start, end] = range;
  if (typeof start === "number" && typeof end === "number") return [start, end];
  const categories = scale?.categories ?? [];
  const from = categories.indexOf(String(start));
  const to = categories.indexOf(String(end));
  return from >= 0 && to >= 0 ? [from, to] : null;
}

function label(categories: readonly string[], index: number): string {
  return categories[Math.round(index)] ?? String(index);
}

/** JSON has no NaN or infinities; missing values travel as null. */
function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}
