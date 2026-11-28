import type {
  BubbleData,
  CandleData,
  CategoryData,
  GridData,
  Point3Data,
  PointData,
  SampleData,
  SeriesData,
  SurfaceData,
} from "../datasets.ts";

export interface ChartOptions {
  width: number;
  height: number;
  /** Enable the library's hover tooltip or crosshair. */
  tooltip: boolean;
  /**
   * Use the configuration the library documents for large data (decimation,
   * WebGL traces, Canvas renderer, ...). Each adapter comments what it changes.
   */
  large: boolean;
  /** Configure the library's zoom interaction (zoom scenarios only). */
  zoom: boolean;
}

export interface Point {
  x: number;
  y: number;
}

/** A rectangle in client (viewport) CSS pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Series 0 as the library drew it, from the data its last draw read: its
 * first and last items' x (epoch ms, or the item's index where a chart has
 * no x: bars, cells, values to bin) and values (y, a bar's value, a cell's
 * value, a candle's close, a 3D point's z), and how many items it drew
 * from. `count` is left out where the library draws from a reduction of
 * the data it was given.
 */
export interface SeriesShown {
  count?: number;
  firstX: number;
  lastX: number;
  first: number;
  last: number;
}

/**
 * What a chart showed when its library last drew, read at the library's
 * draw boundary (a render event or a draw hook) or, for what a library
 * shows in the DOM or SVG, from those elements just before the frame
 * paints. The harness compares it with what each operation asked
 * (expect.ts), the same comparison for every library: adapters report,
 * they do not judge. Each adapter's `verification` says where it reads.
 */
export interface Drawn {
  /** Draws the library has finished since the chart was created; a draw after an operation began counts it as drawn. */
  draws: number;
  /** The chart's size as last drawn, CSS px. */
  width: number;
  height: number;
  /** The plot (the data's area) as last drawn, client px; 2D charts. */
  plot?: Box;
  /** The x and y domains the plot showed, in data units (epoch ms on time axes, indices on category axes). */
  x?: readonly [number, number];
  y?: readonly [number, number];
  series?: SeriesShown;
  /** The hover readout shown now (a tooltip, or uPlot's live legend). */
  readout?: Readout;
  /** A 3D chart's camera as last drawn, degrees. */
  camera?: { azimuth: number; elevation: number };
}

export interface Readout {
  /** Its text. */
  text: string;
  /**
   * Series 0's value as it writes it, where the adapter can tell that part
   * apart: uPlot's legend cell, TanStack's row in series 0's color,
   * Plotly's label of series 0's trace.
   */
  value?: string;
  /** Series 0's item it reads, where the library says which. */
  index?: number;
}

export interface ChartHandle<T> {
  /** Replace the complete dataset with one of the same shape. */
  setData(data: T): void | Promise<void>;
  /**
   * While the library is still rendering the latest change over several
   * frames, returns a promise that resolves when it finishes; otherwise
   * undefined. Only progressive renderers implement it.
   */
  rendered?(): Promise<void> | undefined;
  /**
   * Client (viewport) coordinates of a data point, used to aim pointer moves
   * at real data. `series` and `index` identify the point; `x` and `y` are its
   * values.
   */
  pixelOf(series: number, index: number, x: number, y: number): Point;
  resize(width: number, height: number): void | Promise<void>;
  /** What the chart showed when the library last drew (see `Drawn`). */
  drawn(): Drawn;
  destroy(): void;
  /**
   * Append points to every series and keep only the newest `keep` points,
   * using the update path the library documents for live data. Line charts
   * only; omitted when the library has no such path.
   */
  append?(x: Float64Array, ys: Float64Array[], keep: number): void | Promise<void>;
  /**
   * Show only x values in [x0, x1], through the library's documented zoom or
   * axis-range path. Line charts only; omitted when the library has none.
   */
  setViewport?(x0: number, x1: number): void | Promise<void>;
  /**
   * Turns a 3D chart's camera to an azimuth about the vertical axis and an
   * elevation above the floor, in degrees, through the library's documented
   * camera path. 3D charts only.
   */
  setCamera?(azimuth: number, elevation: number): void | Promise<void>;
}

export interface ChartKind<T> {
  /**
   * Converts benchmark data into the library's input format. Adapters call it
   * inside `create` and `setData`, so conversion is part of every timed
   * operation; the harness also times it alone as a diagnostic.
   */
  prepare(data: T, options: ChartOptions): unknown;
  create(
    container: HTMLElement,
    data: T,
    options: ChartOptions,
  ): ChartHandle<T> | Promise<ChartHandle<T>>;
}

export interface Adapter {
  id: string;
  /** Renderer used by the normal and large configurations. */
  renderer: { normal: string; large: string };
  /** Where `drawn()` reads what the library drew, recorded with the results. */
  verification: string;
  line?: ChartKind<SeriesData>;
  area?: ChartKind<SeriesData>;
  bar?: ChartKind<CategoryData>;
  scatter?: ChartKind<PointData>;
  heatmap?: ChartKind<GridData>;
  candlestick?: ChartKind<CandleData>;
  histogram?: ChartKind<SampleData>;
  bubble?: ChartKind<BubbleData>;
  scatter3d?: ChartKind<Point3Data>;
  surface?: ChartKind<SurfaceData>;
}

/** Candlestick colors: rising (hollow) and falling (filled) candles. */
export const RISE = "#1baf7a";
export const FALL = "#e34948";

export const PALETTE = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#4f46e5",
  "#ca8a04",
  "#0d9488",
  "#c026d3",
  "#e11d48",
  "#2dd4bf",
  "#78716c",
];

export function color(index: number): string {
  return PALETTE[index % PALETTE.length]!;
}

/** Shifts and pushes into plain arrays, the way most libraries expect rolling data. */
export function rollArray<T>(target: T[], values: ArrayLike<T>, keep: number): void {
  for (let i = 0; i < values.length; i++) target.push(values[i]!);
  if (target.length > keep) target.splice(0, target.length - keep);
}

/** Offsets element-relative coordinates by the element's position in the viewport. */
export function clientPoint(element: Element, x: number, y: number): Point {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + x, y: rect.top + y };
}

/**
 * An element's text with its text nodes apart ("series 1 108.4", not
 * "series 1108.4"), without the layout `innerText` would force.
 */
export function readoutText(element: Element | null | undefined): string {
  if (!element) return "";
  const parts: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue?.trim();
    if (text) parts.push(text);
  }
  return parts.join(" ");
}
