// The chart handle applications hold: what `createChart` returns and the
// framework adapters expose. Engine state stays behind it; panels and axes
// come out as read-only snapshots of the last frame drawn.

import type { DrillRoot } from "../marks/tree-data.ts";
import type {
  DrawnPanel,
  Inspection,
  ScaleInstance,
  TooltipMode,
  ViewChange,
  Viewport,
} from "../model/model.ts";
import type { SelectionOwner } from "../model/selected-rows.ts";
import type { SvgSizing } from "../render/svg.ts";
import type { PositionScale } from "../scale/scale.ts";
import type { PlotRect } from "../scene/scene.ts";
import type { CameraSpec, CursorShowSpec } from "../spec/spec.ts";
import type { Camera } from "../three/camera.ts";
import type { Selection } from "./brushed.ts";
import type { ChartUpdate } from "./chart.ts";
import type { ChartEvents, ChartListener, PanelTarget, PanelVisibility } from "./events.ts";

/** A panel's axis: x, the left y axis, or the right one. */
export type Axis = "x" | "y" | "yRight";

export type { ScaleInstance, SelectionOwner };

/** An axis of a panel; `panel` is needed in charts of several panels. */
export interface AxisTarget extends PanelTarget {
  axis: Axis;
}

/** A panel's axis as the last frame drew it. */
export interface AxisInfo {
  readonly type: "linear" | "log" | "time" | "band";
  /**
   * The values shown, from the start of `range` to its end: epoch ms on
   * time axes; on category axes, band indices from -0.5 to the last band's
   * index plus 0.5.
   */
  readonly domain: readonly [number, number];
  /** Where `domain` lies, in CSS pixels from the top left corner of `chart.root`. */
  readonly range: readonly [number, number];
  /** Category axes: the categories, in band index order. */
  readonly categories?: readonly string[] | undefined;
  /** Category axes: each band's width in pixels; 0 on other axes. */
  readonly bandwidth: number;
  /**
   * Names the instance of the scale the axis shows (see `ScaleInstance`):
   * panels whose axis has the same instance share its domain (and on x,
   * its viewport), though each maps it to pixels of its own. Opaque.
   */
  readonly instance: string;
  /** Whether `setViewport` zooms the axis: not on category axes. */
  readonly canSetViewport: boolean;
}

/** A panel as the last frame drew it. */
export interface PanelInfo {
  /** "" without facets or subplots; else as in `PanelTarget`. */
  readonly key: string;
  /** What names the panel for people: its facet values, or its subplot's title or id; "" without. */
  readonly label: string;
  /** The area inside the axes, in CSS pixels from the top left corner of `chart.root`. */
  readonly plot: PlotRect;
  /** An inset's: the key of the panel it is drawn over. */
  readonly parent?: string | undefined;
  /** Charts of a layout mark (a pie, a map, a 3D chart) have no axes. */
  readonly x?: AxisInfo | undefined;
  readonly y?: AxisInfo | undefined;
  /** Only in charts with marks on the right axis. */
  readonly yRight?: AxisInfo | undefined;
}

/**
 * Where the cursor goes: a value on x or on y (epoch ms on time axes, a
 * category's name on category axes).
 */
export type CursorPosition = { x: number | string } | { y: number | string };

/**
 * Whether showing or hiding the cursor shares it with the charts of the
 * chart's cursor channel (true by default), and how this chart shows it:
 * which points it reads, and whether with the tooltip (as the channel says
 * by default, else "nearest" and none).
 */
export interface CursorOptions extends CursorShowSpec {
  broadcast?: boolean;
}

/** An entry of the chart's legend, which hides and shows what it names by key. */
export interface LegendEntry {
  /** A series' key, or a layout mark's item's (a pie slice's), as inspections name them. */
  readonly key: string;
  readonly label: string;
  readonly color: string;
}

/** Network nodes moved by the chart's user, by item key: where each is, in the network's layout units. */
export type ItemPositions = Readonly<Record<string, Readonly<{ x: number; y: number }>>>;

export interface InspectOptions extends PanelTarget {
  /** How to find the data; by default the chart's tooltip mode. */
  mode?: TooltipMode;
}

/**
 * A chart mounted in an element. Panels, pixel mapping, legend entries, and
 * inspections describe the last frame drawn: changes are drawn on the next
 * animation frame, or at once with `render()`. Pixels are CSS pixels from
 * the top left corner of `root`.
 */
export interface Chart {
  /** The chart's element, inside the container it was mounted in. */
  readonly root: HTMLDivElement;
  /** Replaces options (see `ChartUpdate`). Unspecified keys keep their current values. */
  update(options: ChartUpdate): void;
  /**
   * Zooms: each axis given (`x`, `y`, `yRight`) shows a range (epoch ms on
   * time axes), or with null its configured domain or its data; axes left
   * out keep their view. A pair is an x range, and null resets every axis.
   * A range is set on the scale instance of `panel` (see `ScaleInstance`),
   * which every panel sharing it follows; without a panel, on the instance
   * every panel shares, or the only one, and a range is refused where
   * panels have instances of their own. Null without a panel resets every
   * instance of the axis. Category axes, and axes `panel` does not have,
   * refuse ranges; the whole change is checked before any of it is made,
   * and reported as one `viewport` event. Maps use projected plane units,
   * networks layout units (y increases downwards); node radii stay in
   * pixels. Facet panels of maps or networks share one view; a map or
   * network subplot has its own, which needs its `panel` (unless the chart
   * has no other view).
   */
  setViewport(view: ViewChange, target?: PanelTarget): void;
  /**
   * What `panel` shows along each axis, null where it is not zoomed or it
   * has no such axis; without a panel, along each axis every panel shares
   * (or the only instance of), and null along the others. For a map or
   * network subplot, with its `panel`, its plane's.
   */
  getViewport(target?: PanelTarget): Viewport;
  /** Counts the chart's changes of view: the `viewRevision` of the last `viewport` event, 0 before any. */
  readonly viewRevision: number;
  /**
   * Counts the chart's changes of options, data, and state (views,
   * selection, visibility, drill roots, cameras, moved nodes): each change
   * applies, increments it, and reports itself with it (`revision` on its
   * event); `render` carries the revision a frame drew, and input events
   * the revision of the frame they acted on.
   */
  readonly revision: number;
  /**
   * The revision on screen, which `render` last reported; undefined until
   * a frame draws (while code the first frame needs loads, or when it
   * fails).
   */
  readonly drawnRevision: number | undefined;
  /** What is brushed (x and y ranges, epoch ms for time axes, and a lasso's outline), or null. */
  readonly selection: Selection | null;
  /**
   * What the selection belongs to, or null without one: the scale
   * instances it has ranges on, and the panels drawing them all, which
   * show it (see `SelectionOwner`).
   */
  readonly selectionOwner: SelectionOwner | null;
  /**
   * Sets or clears (null) the selection, as if the user had brushed it in
   * `panel`; an x range alone may be given as a pair. It belongs to the
   * instances it has ranges on in that panel (an x range's x, a y range's
   * y, a lasso's both), or without a panel to those every panel shares,
   * or the only panel's. With `rowSelection`, it writes the rows it
   * covers, unless `rows` is false: a selection another view made and
   * wrote, shown here too.
   */
  select(
    selection: Selection | readonly [number, number] | null,
    target?: PanelTarget & { rows?: boolean },
  ): void;
  /** A copy of the camera of a 3D subplot (or the chart); multiple cameras require a panel. */
  getCamera(target?: PanelTarget): Camera | undefined;
  /**
   * Turns a 3D chart's camera: the settings given replace the current ones;
   * null goes back to the configured camera. A `camera` event follows on
   * the next frame.
   */
  setCamera(camera: CameraSpec | null, target?: PanelTarget): void;
  /**
   * The node a treemap or sunburst is drilled into (null for the whole
   * tree) and the path to it from the top level, as set though not drawn
   * yet; undefined for charts without trees. Facet panels share one root;
   * each subplot's tree has its own, which `panel` names (needed when
   * several subplots draw trees).
   */
  getDrillRoot(target?: PanelTarget): DrillRoot | undefined;
  /**
   * Drills a treemap or sunburst into a node, named by its item key (as
   * inspections, the legend, and `drill` events give it) or by its names
   * from the top level down, or with null back out to the whole tree, as
   * clicks do with `interaction.zoom`: in every facet panel, or in the
   * subplot `panel` names. A `drill` event follows when the root changed.
   * Throws for a node the tree does not have, for charts without trees,
   * and without `panel` when several subplots draw trees.
   */
  setDrillRoot(node: string | readonly string[] | null, target?: PanelTarget): void;
  /**
   * The nodes the chart's user moved (dragged, moved with keys, or put with
   * `setItemPosition`), by item key, where each is in the network's layout
   * units: of every facet panel's network, or of the subplot `panel` names.
   * A copy; empty for charts without networks.
   */
  getItemPositions(target?: PanelTarget): ItemPositions;
  /**
   * Moves a network's node, keyed as its items are, to a place in the
   * network's layout units (as `itemMove` events report them; links settle
   * about 30 units long), or with null back to where the layout puts it.
   * Nodes stay where they are put while the network's data has them, including
   * outside the current view; navigation does not clamp or change their positions.
   * A node of a hidden group can be moved too, and is drawn there once shown.
   * Facet panels' networks share one layout, and so their moves; each
   * subplot's network has its own, which `panel` names. An `itemMove` event
   * follows when the node moved. Throws for a key of no node in the network,
   * for charts without networks, and without `panel` when several subplots draw them.
   */
  setItemPosition(
    key: string,
    position: { x: number; y: number } | null,
    target?: PanelTarget,
  ): void;
  /** The panels of the last frame, in reading order. */
  getPanels(): readonly PanelInfo[];
  /**
   * Where a value is on an axis, in pixels: numbers, epoch ms on time
   * axes, fractional band indices on category axes. Values beyond the
   * domain map beyond the plot. Undefined for an axis the panel lacks, and
   * for values it cannot show: not finite, not positive on log axes, or
   * left out by a time axis' breaks. Charts of several panels need `panel`.
   */
  toPixel(value: number, target: AxisTarget): number | undefined;
  /**
   * The value at a pixel of an axis: on category axes a fractional band
   * index (round it for the band), and at the seam of a time axis' break
   * the first time shown after the break. Undefined for an axis the panel lacks.
   */
  fromPixel(pixel: number, target: AxisTarget): number | undefined;
  /**
   * A value as the axis' tooltips write it: on category axes, the category
   * at the band index. Undefined for an axis the panel lacks, a value that
   * is not finite, and an index past the categories.
   */
  formatValue(value: number, target: AxisTarget): string | undefined;
  /**
   * The data at a pixel, as the tooltip would show it: in the panel under
   * the pixel, or in `panel` (nothing outside its plot). Moves no cursor,
   * shows no tooltip, and emits no event.
   */
  inspect(x: number, y: number, options?: InspectOptions): Inspection | undefined;
  /**
   * The entries the legend lists in the last frame, also when the chart
   * shows no legend: series, or a layout mark's items.
   */
  getLegend(): readonly LegendEntry[];
  /**
   * The keys of the series and items hidden, as the legend hides them; with
   * `panel`, those hidden in that subplot, as its own legend may hide them.
   */
  getHiddenKeys(options?: { panel?: string | undefined }): readonly string[];
  /**
   * Hides the series and items keyed `keys`, and shows the others. Keys of
   * series not drawn now stay hidden for when they are. A mark's keys go
   * with its identity, its `id` or else its index in `marks`: an update
   * without the mark drops them, and a mark that takes its index keeps them.
   * With `panels`, what each subplot's own legend hid and showed there, as
   * a `visibility` event reports them (so its state sets again in one
   * change); without, what panels' legends set goes.
   */
  setHiddenKeys(keys: readonly string[], options?: { panels?: PanelVisibility | undefined }): void;
  /**
   * Shows or hides series or items by key, as their legend entries do: in
   * every panel, letting go of what panels' legends set of them; or with
   * `panel`, in that subplot only, as its own legend does.
   */
  setVisibility(
    keys: string | readonly string[],
    visible: boolean,
    options?: { panel?: string | undefined },
  ): void;
  /**
   * Shows the cursor at a value, as a synced chart's cursor shows: a
   * crosshair and the points there in each panel, with no tooltip, and a
   * `hover` event. Along the axis the chart's data is placed on (x, or y
   * for horizontal bars); a value elsewhere shows nothing. Shared with the
   * charts of the chart's cursor channel unless `broadcast` is false.
   *
   * ```ts
   * other.on("hover", ({ inspection }) =>
   *   inspection?.axis === "x" ? chart.showCursor({ x: inspection.value }) : chart.hideCursor(),
   * );
   * ```
   */
  showCursor(position: CursorPosition, options?: CursorOptions): void;
  /** Hides the cursor `showCursor` or a synced chart shows; the pointer's own stays. */
  hideCursor(options?: CursorOptions): void;
  /**
   * Calls `listener` on every `type` event until the returned function is
   * called.
   *
   * ```ts
   * chart.on("select", ({ x }) => x && other.setViewport(x));
   * ```
   */
  on<K extends keyof ChartEvents>(type: K, listener: ChartListener<K>): () => void;
  /**
   * Pending while the chart loads code it needs: its interaction controller
   * (tooltips, the pointer, the wheel, and keys), which loads after the
   * first frame or at the first input, playing the input that came before
   * it; its GPU painter for large point series, which it draws once loaded;
   * its `animation` of views and values, without which they change at once;
   * its crosshair labels; what reads tooltip fields and draws
   * `renderTooltip`'s content; or what turns a 3D chart. Undefined when
   * nothing is pending.
   */
  readonly loading: Promise<void> | undefined;
  /**
   * Settles once the chart's first frame is on screen, the code it waits
   * for loaded (its compilers), or rejects with the `ChartError` that kept
   * the first frame from drawing. A later failure is an "error" event.
   */
  readonly ready: Promise<void>;
  /**
   * Draws pending changes now, at the container's current size, instead of
   * on the next frame. It always draws, so a `render` listener calling it
   * hears of another frame.
   */
  render(): void;
  /**
   * Standalone SVG of the current state, for export: pending changes are
   * drawn first (and reported with a `render` event once the export has
   * the frame), and nothing is drawn when nothing is pending, so `render`
   * listeners may export. `options` say how the SVG sizes and scales.
   */
  toSVG(options?: SvgSizing): string;
  /**
   * PNG of the current state, as `toSVG` exports it, at the chart's size
   * and `dpi` image pixels per inch (96, a pixel per CSS pixel, by
   * default), which the PNG records; a transparent background stays
   * transparent. Loads its encoder the first time. `renderToImage` in
   * herceg/image writes JPEG and WebP and takes a background; `renderToPDF`
   * in herceg/pdf writes PDF.
   */
  toPNG(settings?: { dpi?: number }): Promise<Blob>;
  destroy(): void;
}

/** A snapshot of a panel of the last scene. */
export function panelInfo(panel: DrawnPanel): PanelInfo {
  const { key, label, plot, x, y, yGroup, yRight, yRightGroup, drawsY } = panel;
  return {
    key,
    label,
    plot: { ...plot },
    x: axisInfo(x, panel.xGroup, x.type !== "band"),
    // A panel drawing nothing along the left y axis has no instance of it.
    y: drawsY ? axisInfo(y, yGroup, y.type !== "band") : undefined,
    yRight: yRight && axisInfo(yRight, yRightGroup, yRight.type !== "band"),
  };
}

function axisInfo(scale: PositionScale, instance: string, canSetViewport: boolean): AxisInfo {
  return {
    type: scale.type,
    domain: [...scale.domain],
    range: [...scale.range],
    // Category lists are kept while they are unchanged, never changed in place.
    categories: scale.categories,
    bandwidth: Math.abs(scale.bandwidth ?? 0),
    instance,
    canSetViewport,
  };
}
