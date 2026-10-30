// Chart events as JSON, the form they take between runtimes: Python reads
// them (python/src/herceg/_events.py), pages' DOM events carry them
// (mount.ts), and a server can read what a page posts. Axes holding times
// are named, so readers can make dates of epoch milliseconds, and category
// positions are their labels rather than band indices.

import type { Selection } from "../dom/brushed.ts";
import { MountedChart } from "../dom/chart.ts";
import type { ChangeCause, ChartEvents, PanelViewport } from "../dom/events.ts";
import type { Axis, AxisInfo, Chart, ScaleInstance, SelectionOwner } from "../dom/handle.ts";
import type { Inspection, Viewport, ViewSet } from "../model/model.ts";
import type { RowSelectionChange } from "../model/row-selection.ts";
import { ChartError } from "../spec/errors.ts";
import type { Expression } from "../spec/spec.ts";

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
  /** The panels it belongs to (`SelectionOwner.panels`), whose axes read its ranges. */
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

/** A scale instance (`ScaleInstance`), with whether its values are times rather than its type. */
export interface ScaleInstancePayload {
  scale: Axis;
  instance: string;
  /** Whether its values are times, in epoch milliseconds. */
  time: boolean;
  panels: string[];
}

/** A scale instance's view (`ScaleView`), null where it is fitted. */
export interface ScaleViewPayload extends ScaleInstancePayload {
  view: Ends | null;
}

/** A panel's whole view (`PanelViewport`). */
export interface PanelViewportPayload extends ViewportPayload {
  panel: string;
}

/** A change of view (`ViewportEvent`), with the chart's revision once it applied. */
export interface ViewportEventPayload {
  viewRevision: number;
  revision: number;
  cause: ChangeCause;
  panel?: string;
  scales: ScaleViewPayload[];
  views: PanelViewportPayload[];
}

/** A scale instance's view in a chart's state (`viewportStatePayload`). */
export interface ScaleStatePayload extends ScaleViewPayload {
  /**
   * The instance as another mount of the chart finds it again
   * (`restoreViewportState`): of the same scale and type, shared by every
   * panel, or drawn by the same panels. Opaque; kept as given.
   */
  identity: string;
}

/**
 * Every view a chart's axes show now (`viewportStatePayload`): each
 * instance, as a change of view lists them, and each panel with axes.
 */
export interface ViewportStatePayload {
  viewRevision: number;
  scales: ScaleStatePayload[];
  views: PanelViewportPayload[];
  /**
   * What `getViewport()` returns without a panel: the views of the scales
   * every panel shares. Absent where it needs a panel (maps' and networks'
   * subplots).
   */
  view?: ViewportPayload;
}

/** What a selection belongs to (`SelectionOwner`). */
export interface SelectionOwnerPayload {
  scales: ScaleInstancePayload[];
  panels: string[];
}

/**
 * A `select` event: the selection, null once cleared, what it belongs to
 * (or, cleared, belonged to), what made it, and the chart's revision then.
 */
export interface SelectEventPayload {
  owner: SelectionOwnerPayload;
  selection: SelectionPayload | null;
  cause: ChangeCause;
  revision: number;
}

/** An `edge` event: the scale instance, the end its view came near, and what moved it there. */
export interface EdgePayload extends ScaleInstancePayload {
  side: "start" | "end";
  domain: [number, number];
  bound: number;
  cause: ChangeCause;
}

/**
 * A `rowSelection` event: a channel a chart binds, of a table named by its
 * name in the spec's `data`, and what it holds: a condition, or rows by
 * identity in the table's generation `generation` (`Table.identity`, so
 * they stay the rows' across drops), or null for none.
 */
export interface RowSelectionPayload {
  data: string;
  channel: string;
  selection:
    | { kind: "predicate"; expression: Expression }
    | { kind: "rows"; rows: number[]; generation: number }
    | null;
}

/** A `visibility` event, which is JSON as it is. */
export type VisibilityPayload = ChartEvents["visibility"];

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

const AXES = ["x", "y", "yRight"] as const;

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
      ? (axes.find(({ x }) => x!.instance === "") ?? axes[0])
      : axes.find(({ key }) => key === panel);
  return { x: found?.x, y: found?.y, yRight: found?.yRight };
}

const timeAxes = (scales: Scales, axes: readonly Axis[]): Axis[] =>
  axes.filter((axis) => scales[axis]?.type === "time");

/** A scale instance as JSON: whether its values are times, rather than its type. */
function instancePayload({ scale, instance, type, panels }: ScaleInstance): ScaleInstancePayload {
  return { scale, instance, time: type === "time", panels: [...panels] };
}

/** A view as JSON: ascending ends, null where fitted. Category axes do not zoom. */
const view = (range: Range | null): [number, number] | null => range && [range[0], range[1]];

/** A panel's whole view as JSON, naming its axes of times. */
function panelViewportPayload({ panel, types, ...shown }: PanelViewport): PanelViewportPayload {
  return {
    panel,
    x: view(shown.x),
    y: view(shown.y),
    yRight: view(shown.yRight),
    time: AXES.filter((axis) => types[axis] === "time"),
  };
}

/** A change of view as JSON; it carries the types of its axes, so it needs no chart. */
export function viewportEventPayload(event: ChartEvents["viewport"]): ViewportEventPayload {
  return {
    viewRevision: event.viewRevision,
    revision: event.revision,
    cause: event.cause,
    ...(event.panel !== undefined && { panel: event.panel }),
    scales: event.scales.map((scale) => ({ ...instancePayload(scale), view: view(scale.view) })),
    views: event.views.map(panelViewportPayload),
  };
}

/** What finds an instance again in another mount: its scale, its type, and its name, which its panels' keys make. */
const identityOf = (scale: Axis, type: AxisInfo["type"], instance: string) =>
  JSON.stringify([scale, type, instance]);

/**
 * Every view the chart's axes show now, as a change of view lists them:
 * for mounting a chart, and restoring one, whatever happened before. Maps'
 * and networks' planes are read with `getViewport` and their panel.
 */
export function viewportStatePayload(chart: Chart): ViewportStatePayload {
  // Reading a panel's view draws the changes to the panels pending first.
  // The rest is read from the last scene and the views of its instances,
  // which draws nothing again: all of one scene, though a listener of that
  // frame changed the chart again.
  try {
    chart.getViewport({ panel: chart.getPanels()[0]?.key ?? "" });
  } catch {
    // That panel is gone now.
  }
  const model = MountedChart.modelOf(chart);
  const panels = chart.getPanels();
  const scales = new Map<string, ScaleStatePayload>();
  const views: PanelViewportPayload[] = [];
  for (const panel of panels) {
    if (!panel.x) continue;
    const shown = {} as Viewport;
    for (const axis of AXES) {
      const info = panel[axis];
      shown[axis] = info ? model.viewOf(axis, info.instance) : null;
      if (!info) continue;
      const key = `${axis} ${info.instance}`;
      const found = scales.get(key);
      if (found) found.panels.push(panel.key);
      else
        scales.set(key, {
          scale: axis,
          instance: info.instance,
          time: info.type === "time",
          panels: [panel.key],
          view: view(shown[axis]),
          identity: identityOf(axis, info.type, info.instance),
        });
    }
    const types = Object.fromEntries(
      AXES.flatMap((axis) => (panel[axis] ? [[axis, panel[axis].type]] : [])),
    );
    views.push(panelViewportPayload({ panel: panel.key, ...shown, types }));
  }
  // By scale, then by first panel, as a change of view lists them.
  const listed = [...scales.values()].sort((a, b) => AXES.indexOf(a.scale) - AXES.indexOf(b.scale));
  let shown: Viewport | undefined;
  if (scales.size) {
    // Without a panel, as `getViewport` reads it: along each scale, the
    // instance every panel shares, else the only one.
    shown = { x: null, y: null, yRight: null };
    for (const axis of AXES) {
      const of = listed.filter(({ scale }) => scale === axis);
      const one =
        of.find(({ instance }) => instance === "") ?? (of.length === 1 ? of[0] : undefined);
      shown[axis] = one ? model.viewOf(axis, one.instance) : null;
    }
  } else
    try {
      // A map's or network's plane, without axes beside it.
      shown = chart.getViewport();
    } catch {
      // Subplots of maps or networks: each panel's plane has a view of its own.
    }
  return {
    viewRevision: chart.viewRevision,
    scales: listed,
    views,
    ...(shown && { view: viewportPayload(chart, shown) }),
  };
}

/**
 * Gives `chart`, mounted in place of another (as a Streamlit app remounts
 * its chart on each run), the views of `state` (`viewportStatePayload` of
 * the chart it replaces, or as last confirmed): each instance the chart
 * draws again (by `identity`: the one every panel shares, though panels
 * come and go; another, only with the same panels; neither across a change
 * of type) takes its view, limits applied, and the others are fitted.
 * Waits for what the chart loads to draw its panels; one `viewport` event,
 * of cause "options", reports what changed. A state of another shape, or
 * with two views of one instance, is refused whole; a restore another
 * started while this one waited gives way to it. Resolves to the chart's
 * state then.
 */
export async function restoreViewportState(
  chart: Chart,
  state: ViewportStatePayload,
): Promise<ViewportStatePayload> {
  const views = stateViews(state);
  const restore = {};
  restores.set(chart, restore);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  // Nothing for a chart destroyed meanwhile.
  if (!MountedChart.restore(chart)) return state;
  // The instances the chart draws, as its last scene drew them.
  if (restores.get(chart) === restore) chart.render();
  // A restore a listener started meanwhile, which won.
  if (restores.get(chart) !== restore) return viewportStatePayload(chart);
  restores.delete(chart);
  const changes: ViewSet[] = [];
  for (const { scale, instance, type } of MountedChart.modelOf(chart).instances.values())
    if (type !== "band")
      changes.push([scale, instance, views.get(identityOf(scale, type, instance)) ?? null]);
  MountedChart.restore(chart, changes);
  return viewportStatePayload(chart);
}

/** Each chart's latest restore of its views, which restores before it give way to. */
const restores = new WeakMap<Chart, object>();

/** The views `state` holds by instance identity, checked whole: a state of another shape is refused. */
function stateViews(state: ViewportStatePayload): Map<string, Range | null> {
  const refuse = (at: string, problem: string): never => {
    throw new ChartError({
      code: "invalid-option",
      path: at,
      message: `restoreViewportState ${at}: ${problem}`,
    });
  };
  const scales = (state as Partial<ViewportStatePayload> | null)?.scales;
  if (!Array.isArray(scales))
    refuse("scales", "expected a list of instances' views; give a state viewportStatePayload made");
  const views = new Map<string, Range | null>();
  for (const [i, entry] of scales!.entries()) {
    const at = `scales[${i}]`;
    const { scale, identity, view: range } = (entry ?? {}) as Partial<ScaleStatePayload>;
    if (
      !AXES.includes(scale as Axis) ||
      typeof identity !== "string" ||
      !identifies(identity, scale!)
    )
      refuse(
        at,
        'expected a scale ("x", "y", or "yRight") and its identity; give an entry viewportStatePayload made',
      );
    const ascending =
      range === null ||
      (Array.isArray(range) &&
        range.length === 2 &&
        range.every((end) => typeof end === "number" && Number.isFinite(end)) &&
        (range[0] as number) <= (range[1] as number));
    if (!ascending)
      refuse(
        `${at}.view`,
        "expected null or two ascending finite numbers; give the view as viewportStatePayload wrote it",
      );
    const known = views.get(identity!);
    const next = range as Range | null;
    if (known !== undefined && (known?.[0] !== next?.[0] || known?.[1] !== next?.[1]))
      refuse(at, "holds another view of an instance listed before; give each instance once");
    views.set(identity!, next);
  }
  return views;
}

/** Whether `identity` is one `identityOf` made of an instance of `scale`. */
function identifies(identity: string, scale: Axis): boolean {
  try {
    const [of, type, instance, ...rest] = JSON.parse(identity) as unknown[];
    return of === scale && typeof type === "string" && typeof instance === "string" && !rest.length;
  } catch {
    return false;
  }
}

/** An edge event as JSON. */
export function edgePayload({
  side,
  domain,
  bound,
  cause,
  ...instance
}: ChartEvents["edge"]): EdgePayload {
  return { ...instancePayload(instance), side, domain: [domain[0], domain[1]], bound, cause };
}

/** What a selection belongs to, as JSON. */
function ownerPayload({ scales, panels }: SelectionOwner): SelectionOwnerPayload {
  return { scales: scales.map(instancePayload), panels: [...panels] };
}

/**
 * A select event as JSON: the selection on the instances it belongs to,
 * which carry their categories as the event was made, and what it belongs to.
 */
export function selectEventPayload(event: ChartEvents["select"]): SelectEventPayload {
  return {
    owner: ownerPayload(event.owner),
    selection: selectionPayload(event, event.owner),
    cause: event.cause,
    revision: event.revision,
  };
}

/**
 * A change of a channel `rowSelection` binds, as JSON, its table named
 * `name` (its name in the spec's data): a condition, or rows by identity,
 * as `Table.identity` gives them.
 * `numbering` counts, for a reader numbering rows from an earlier
 * snapshot, the rows dropped before it and its generation.
 */
export function rowSelectionPayload(
  { table, channel, selection }: RowSelectionChange,
  name: string,
  numbering: readonly [dropped: number, generation: number] = [0, 0],
): RowSelectionPayload {
  if (selection?.kind !== "rows")
    return {
      data: name,
      channel,
      selection: selection && { kind: "predicate", expression: selection.expression },
    };
  const [dropped, generation] = numbering;
  // A reset numbers rows afresh, from the table's first.
  const base = table.generation === 0 ? dropped : 0;
  return {
    data: name,
    channel,
    selection: {
      kind: "rows",
      rows: Array.from(selection.rows.positions(), (position) => base + table.identity(position)),
      generation: generation + table.generation,
    },
  };
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
 * A selection as JSON, read on the instances it belongs to (`owner`, as
 * `select` events and `chart.selectionOwner` give it), or null for none.
 */
export function selectionPayload(
  selection: Selection | null,
  owner: SelectionOwner | null,
): SelectionPayload | null {
  if (!selection || !(selection.x || selection.y || selection.lasso)) return null;
  const x = owner?.scales.find(({ scale }) => scale === "x");
  // A y range is of the right y in a panel without a left one.
  const y = owner?.scales.find(({ scale }) => scale !== "x");
  // A lasso's band positions refer to the categories of its axes.
  const categories = selection.lasso &&
    (x?.categories || y?.categories) && [
      x?.categories ? [...x.categories] : null,
      y?.categories ? [...y.categories] : null,
    ];
  return {
    ...(owner && { panels: [...owner.panels] }),
    x: ends(selection.x, x),
    y: ends(selection.y, y),
    lasso: selection.lasso?.map(([x, y]) => [x, y]) ?? null,
    ...(categories && { categories: categories as Categories }),
    time: (["x", "y"] as const).filter((axis) => (axis === "x" ? x : y)?.type === "time"),
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
  const { x, y } = scalesOf(chart, chart.selectionOwner?.panels[0]);
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
function ends(
  range: Range | null,
  scale: Pick<AxisInfo, "type" | "categories"> | undefined,
): Ends | null {
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
