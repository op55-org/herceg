import {
  type ChartError,
  type ChartListener,
  type ChartMark,
  type ChartUpdate,
  type Chart as HercegChart,
  type Hydration,
  type Inspection,
  Table,
  tablesOf,
  viewOf,
} from "herceg";
import type { Snippet } from "svelte";
import type { ClassValue } from "svelte/elements";

/**
 * Chart options as props: one left out, or `undefined`, takes its default.
 * The state options (`selection`, `viewport`, `visibility`, `drillRoot`)
 * set the chart's state when their value changes; bound
 * (`bind:selection`), they follow the chart's state as each change commits.
 */
export interface ChartProps
  extends Omit<ChartUpdate, "marks" | "renderTooltip" | "onError" | "state"> {
  /**
   * The tooltip's content (`{#snippet renderTooltip(inspection)}`), in the
   * chart's own box, which keeps its placement, the crosshair, and the
   * keyboard's announcements. Only the content of what the tooltip is at
   * renders, when that changes: never a node per data point.
   */
  renderTooltip?: Snippet<[Inspection]> | undefined;
  /** Marks built with herceg's functions; mark components among the children are added after them. */
  marks?: readonly ChartMark[] | undefined;
  /** Mark components: <Line>, <Area>, <Bar>, <Point>, <Heatmap>, <Contour>, <ErrorBar>, <Candlestick>, <Histogram>, <Pie>, <BoxPlot>, <Boxen>, <Violin>, <Treemap>, <Sunburst>, <Gauge>, <Funnel>, <Radar>, <Sankey>, <Graph>, <GeoShape>, <GeoPoint>, <Point3D>, <Line3D>, <Surface>, <Rule>, <Region>, <Text>, <Custom>. */
  children?: Snippet | undefined;
  class?: ClassValue | undefined;
  /** Style of the container. Without a `height` prop or style height, the chart is 320 px tall. */
  style?: string | undefined;
  /** The underlying chart once mounted (`bind:chart`), for imperative calls such as `setViewport` or `toSVG`. */
  chart?: HercegChart | null | undefined;
  /**
   * The chart rendered on the server (`renderToSnapshot`, or Python's
   * `to_snapshot`) from the same options, as `hydration(snapshot)`: server
   * and first client renders show its markup, which the chart then takes
   * over without drawing it again. Read when the chart mounts; later values
   * are not.
   */
  initial?: Hydration | undefined;
  /** The view changed (zoom, pan, reset, sync): x, y, and right y ranges, each null when not zoomed. */
  onviewport?: ChartListener<"viewport"> | undefined;
  /** The view came near an end of what `interaction.limits` allows, as to load more data. */
  onedge?: ChartListener<"edge"> | undefined;
  /**
   * The selection changed (a brush, `interaction.select`, `select`): what
   * it is (null when cleared), and its `phase`, "preview" while a brush
   * moves, then "commit" or "cancel".
   */
  onselect?: ChartListener<"select"> | undefined;
  /** What the pointer or keyboard cursor is on, or the data the inspection reads there, changed. */
  onhover?: ChartListener<"hover"> | undefined;
  /**
   * A plot, item, axis label, or legend entry was clicked, or Enter pressed
   * on the keyboard cursor: what it is on, the data the inspection reads
   * there (and with `rowSelection`, the rows it selected).
   */
  onclick?: ChartListener<"click"> | undefined;
  /**
   * A secondary press (a right click, a long press): where, and what it is
   * on. While it is given, the browser's own menu stays off the plots.
   */
  oncontextmenu?: ChartListener<"contextMenu"> | undefined;
  /** A channel `rowSelection` binds changed, by any chart or grid: what it holds now. */
  onrowselection?: ChartListener<"rowSelection"> | undefined;
  /** A 3D chart's camera moved (dragged, zoomed, reset, keys, `setCamera`); once a frame at most. */
  oncamera?: ChartListener<"camera"> | undefined;
  /** A treemap or sunburst was drilled into a node or back out: its key (null for the whole tree) and path. */
  ondrill?: ChartListener<"drill"> | undefined;
  /**
   * A network's node was moved (dragged, keys, `setItemPosition`) or put
   * back (null), or a rule of `drag: true` moved: previews while dragged, a
   * commit where dropped, a cancel when given up.
   */
  onitemmove?: ChartListener<"itemMove"> | undefined;
  /** The tooltip was pinned (a click with `tooltip.pin`, `pin()`) or let go (null). */
  onpin?: ChartListener<"pin"> | undefined;
  /** Series or items were hidden or shown (legend, `setVisibility`): the keys now hidden. */
  onvisibility?: ChartListener<"visibility"> | undefined;
  /** The chart drew a frame of its data: its panels and pixel mapping describe it, for overlays. */
  onrender?: ChartListener<"render"> | undefined;
  /**
   * Something kept the chart from drawing: options or mark components it
   * refused, code it could not load, a frame that failed. With
   * `errorMode="inline"` (the default) the chart also shows it in its
   * place; with "throw", it is thrown, for the nearest `<svelte:boundary>`.
   */
  onerror?: ((error: ChartError) => void) | undefined;
}

/**
 * Ids of what options hold by identity: functions (tick generators,
 * formatters), and tables and row views (in field displays' rules), so
 * that a new one compares as a change and the same one as none.
 */
const identities = new WeakMap<object, number>();
let identified = 0;

/**
 * JSON with object keys sorted, so equal settings written in any order
 * compare equal, and functions, tables, and row views by identity (two
 * unnamed tables write the same JSON).
 */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) => {
    const table = v instanceof Table || (typeof v === "object" && v !== null && "markRows" in v);
    if (typeof v === "function" || table) {
      let id = identities.get(v as object);
      if (id === undefined) {
        id = ++identified;
        identities.set(v as object, id);
      }
      return `${typeof v === "function" ? "function" : "table"} ${id}`;
    }
    return v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v;
  });
}

/**
 * Same mark when the spec and the tables are unchanged, so caches survive
 * updates: every built-in mark's spec and tables describe it. Custom marks,
 * whose `draw` may close over new values, are only the same mark as
 * themselves.
 */
export function sameMark(a: ChartMark, b: ChartMark): boolean {
  if (a === b) return true;
  if (a.spec.type === "custom" || a.constructor !== b.constructor) return false;
  const [tables, others] = [tablesOf(a), tablesOf(b)];
  return (
    tables.length === others.length &&
    tables.every((table, i) => table === others[i]) &&
    viewOf(a) === viewOf(b) &&
    canonical(a.spec) === canonical(b.spec)
  );
}

/** What an inspection is made on (`basisOf`). */
export interface Basis {
  marks: readonly ChartMark[];
  versions: string;
}

/**
 * What an inspection of `marks` is made on: the marks, the versions of the
 * tables they read, and the revisions of the row views they show. Its rows
 * name rows of those as they were.
 */
export const basisOf = (marks: readonly ChartMark[]): Basis => ({
  marks,
  versions: marks
    .map((mark) => [viewOf(mark)?.revision, ...tablesOf(mark).map((table) => table.version)])
    .join(";"),
});

/** Whether an inspection made on `basis` is of `marks`: the same marks, their data unchanged since. */
export function holds(basis: Basis, marks: readonly ChartMark[]): boolean {
  return (
    marks.length === basis.marks.length &&
    marks.every((mark, i) => sameMark(mark, basis.marks[i]!)) &&
    basisOf(marks).versions === basis.versions
  );
}
