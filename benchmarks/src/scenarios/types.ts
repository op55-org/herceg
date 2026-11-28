// The scenario types every area file of the catalog uses.

export type ChartType =
  | "line"
  | "area"
  | "bar"
  | "scatter"
  | "heatmap"
  | "candlestick"
  | "histogram"
  | "bubble"
  | "scatter3d"
  | "surface";

export type Operation =
  /** Create the chart and wait for the first frame. */
  | "init"
  /** Replace the dataset with another of the same shape. */
  | "update"
  /** Append `append` points per series, keep `points`, wait for a frame; repeat. */
  | "stream"
  /** Append on a timer at `rateHz` while frames run at the display rate (vsync on). */
  | "ingest"
  /** Move the pointer across the plot and wait for each frame. */
  | "hover"
  /** Toggle the container size. */
  | "resize"
  /** Show a sequence of x ranges (zoomed in, panning), waiting for each frame. */
  | "zoom"
  /** Retained heap, DOM nodes, and canvas pixels after creating the chart(s). */
  | "memory"
  /** Create `charts` line charts at once (dashboard), then refresh them all. */
  | "dashboard"
  /** Turn a 3D chart's camera through a sequence of angles, waiting for each frame. */
  | "rotate"
  /** Turn a 3D chart's camera a step every frame, as a drag does, with vsync on. */
  | "orbit"
  /** Move the pointer over the chart on a fixed schedule for `durationMs`, with vsync on. */
  | "trace";

export interface Scenario {
  id: string;
  chart: ChartType;
  operation: Operation;
  /** Series count (line/area/bar) or 1. */
  series: number;
  /** Points per series, categories for bars, cells for heatmaps and surfaces. */
  points: number;
  /** Use each library's documented large-data configuration. */
  large: boolean;
  tooltip: boolean;
  /** Number of charts mounted at once. */
  charts?: number;
  /** Streaming: points appended per series per tick. */
  append?: number;
  /** Paced ingestion rate and duration; a trace's duration. */
  rateHz?: number;
  durationMs?: number;
  /**
   * Also time loading a page to the chart's first verified frame: with an
   * empty cache, with its assets cached, and through a throttled connection,
   * `loadSamples` fresh pages each (default 5, scaled by `--sample-scale`).
   */
  load?: boolean;
  loadSamples?: number;
  /** Measured samples; the runner may override. */
  samples: number;
  /** Seconds before the runner gives up on a library (default 600). */
  timeout?: number;
  warmup: number;
  description: string;
}
