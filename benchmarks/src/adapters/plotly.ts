import Plotly from "plotly.js-dist-min";
import {
  BUBBLE,
  type BubbleData,
  bubbleRadius,
  type CandleData,
  type CategoryData,
  type GridData,
  type Point3Data,
  type PointData,
  type SampleData,
  type SeriesData,
  type SurfaceData,
} from "../datasets.ts";
import type { Adapter, ChartHandle, ChartOptions, Drawn, SeriesShown } from "../page/adapter.ts";
import { clientPoint, color, FALL, RISE, readoutText } from "../page/adapter.ts";

type Root = Plotly.PlotlyHTMLElement;

// Plotly exposes axis conversion only through its internal layout object.
interface Axis {
  d2l(value: number): number;
  l2p(value: number): number;
  r2l(value: number | string): number;
  range: [number | string, number | string];
}
interface FullLayout {
  width: number;
  height: number;
  xaxis: Axis;
  yaxis: Axis;
  _size: { l: number; t: number; w: number; h: number };
  scene?: { camera: { eye: { x: number; y: number; z: number } } };
}

const fullLayout = (root: Root) => (root as unknown as { _fullLayout: FullLayout })._fullLayout;

/** Series 0's items in the trace Plotly drew: x (or undefined for an index) and values, flattening a grid of rows. */
type SeriesOf = (trace: Record<string, unknown>) => SeriesShown;

const flat = (rows: ArrayLike<ArrayLike<number>>) => {
  const last = rows[rows.length - 1]!;
  return {
    count: rows.length * rows[0]!.length,
    firstX: 0,
    lastX: rows.length * rows[0]!.length - 1,
    first: rows[0]![0]!,
    last: last[last.length - 1]!,
  };
};
const along = (x: ArrayLike<number> | undefined, values: ArrayLike<number>): SeriesShown => {
  const n = values.length;
  return {
    count: n,
    firstX: x ? x[0]! : 0,
    lastX: x ? x[n - 1]! : n - 1,
    first: values[0]!,
    last: values[n - 1]!,
  };
};
const SERIES = {
  xy: ((t) => along(t.x as ArrayLike<number>, t.y as ArrayLike<number>)) as SeriesOf,
  values: ((t) => along(undefined, t.y as ArrayLike<number>)) as SeriesOf,
  bins: ((t) => along(undefined, t.x as ArrayLike<number>)) as SeriesOf,
  grid: ((t) => flat(t.z as ArrayLike<ArrayLike<number>>)) as SeriesOf,
  candles: ((t) => along(t.x as ArrayLike<number>, t.close as ArrayLike<number>)) as SeriesOf,
  xz: ((t) => along(t.x as ArrayLike<number>, t.z as ArrayLike<number>)) as SeriesOf,
};

/**
 * What a Plotly chart drew, read at the `plotly_afterplot` event, or once
 * a Plotly call the adapter makes has finished (its promise resolves after
 * Plotly has drawn) where that event did not fire during it: the layout's size, plot area, and axis ranges,
 * series 0's trace, the 3D camera; the hover label's text from the SVG
 * before the frame paints, with the point from the `plotly_hover` event.
 */
function observer(root: Root, seriesOf: SeriesOf) {
  let draws = 0;
  let last: Omit<Drawn, "draws" | "readout"> = { width: 0, height: 0 };
  let index: number | undefined;
  const drew = () => {
    draws++;
    const layout = fullLayout(root);
    const size = layout._size;
    const eye = layout.scene?.camera.eye;
    const range = (axis: Axis | undefined) =>
      axis?.range ? ([axis.r2l(axis.range[0]), axis.r2l(axis.range[1])] as const) : undefined;
    const x = range(layout.xaxis);
    const y = range(layout.yaxis);
    last = {
      width: layout.width,
      height: layout.height,
      plot: { left: size.l, top: size.t, width: size.w, height: size.h },
      ...(x && { x }),
      ...(y && { y }),
      series: seriesOf((root as unknown as { data: Record<string, unknown>[] }).data[0]!),
      ...(eye && {
        camera: {
          azimuth: (Math.atan2(eye.y, eye.x) * 180) / Math.PI,
          elevation: (Math.atan2(eye.z, Math.hypot(eye.x, eye.y)) * 180) / Math.PI,
        },
      }),
    };
  };
  root.on("plotly_afterplot", drew);
  root.on("plotly_hover", (event) => {
    index = event.points.find((point) => point.curveNumber === 0)?.pointNumber as
      | number
      | undefined;
  });
  const drawn = (): Drawn => {
    const box = root.getBoundingClientRect();
    const text = readoutText(root.querySelector(".hoverlayer"));
    // Series 0's label: the one naming its trace, or the only one of a
    // chart of one trace (Plotly names no trace there).
    const traces = (root as unknown as { data: { name?: string }[] }).data;
    const labels = [...root.querySelectorAll(".hoverlayer g.hovertext")];
    const label =
      labels.find((g) => g.querySelector("text.name")?.textContent === traces[0]?.name) ??
      (traces.length === 1 && labels.length === 1 ? labels[0] : undefined);
    const value = label?.querySelector("text.nums")?.textContent;
    return {
      ...last,
      draws,
      ...(last.plot && {
        plot: { ...last.plot, left: box.left + last.plot.left, top: box.top + last.plot.top },
      }),
      ...(text && {
        readout: { text, ...(value && { value }), ...(index !== undefined && { index }) },
      }),
    };
  };
  /** Makes a Plotly call and awaits it, then captures what it drew unless `plotly_afterplot` did meanwhile. */
  const after = async (call: () => Promise<unknown>) => {
    const before = draws;
    await call();
    if (draws === before) drew();
  };
  return { drew, after, drawn };
}

const config = (options: ChartOptions): Partial<Plotly.Config> => ({
  displayModeBar: false,
  responsive: false,
  staticPlot: !options.tooltip,
});

function layout(options: ChartOptions, extra: Partial<Plotly.Layout> = {}): Partial<Plotly.Layout> {
  return {
    width: options.width,
    height: options.height,
    showlegend: false,
    hovermode: options.tooltip ? "x" : false,
    margin: { l: 50, r: 20, t: 20, b: 40 },
    ...extra,
  };
}

// Plotly accepts typed arrays directly; dates are epoch milliseconds on a date axis.
function lineTraces(
  data: SeriesData,
  options: ChartOptions,
  fill: boolean,
): Partial<Plotly.Data>[] {
  return data.ys.map((y, s) => ({
    // scattergl is Plotly's documented path for large series.
    type: options.large ? "scattergl" : "scatter",
    mode: "lines",
    name: data.names[s],
    x: data.x as unknown as number[],
    y: y as unknown as number[],
    line: { color: color(s), width: 1.5 },
    fill: fill ? "tozeroy" : "none",
  }));
}

// Plotly's candlestick trace takes the four price columns; rising candles are hollow by default.
function candleTraces(data: CandleData): Partial<Plotly.Data>[] {
  return [
    {
      type: "candlestick",
      x: data.x as unknown as number[],
      open: data.open as unknown as number[],
      high: data.high as unknown as number[],
      low: data.low as unknown as number[],
      close: data.close as unknown as number[],
      increasing: { line: { color: RISE }, fillcolor: "rgba(0,0,0,0)" },
      decreasing: { line: { color: FALL }, fillcolor: FALL },
    } as Partial<Plotly.Data>,
  ];
}

// Plotly's histogram trace bins the values itself, on the fixed grid every
// library is given: 5 wide from 25 (values lie within about 25 to 175).
function histogramTraces(data: SampleData): Partial<Plotly.Data>[] {
  return [
    {
      type: "histogram",
      x: data.values as unknown as number[],
      xbins: { start: 25, end: 175, size: 5 },
      marker: { color: color(0) },
    } as Partial<Plotly.Data>,
  ];
}

async function mount(
  container: HTMLElement,
  traces: Partial<Plotly.Data>[],
  plotLayout: Partial<Plotly.Layout>,
  options: ChartOptions,
): Promise<Root> {
  const root = document.createElement("div");
  container.append(root);
  return Plotly.newPlot(root, traces, plotLayout, config(options));
}

function handle<T>(
  root: Root,
  setData: (data: T) => Promise<unknown>,
  plotLayout: Partial<Plotly.Layout>,
  seriesOf: SeriesOf,
): ChartHandle<T> & { after(call: () => Promise<unknown>): Promise<void> } {
  const observed = observer(root, seriesOf);
  // newPlot resolved before the observer listened.
  observed.drew();
  return {
    after: observed.after,
    drawn: observed.drawn,
    async setData(data) {
      await observed.after(() => setData(data));
    },
    pixelOf(_series, _index, x, y) {
      const layout = (root as unknown as { _fullLayout: FullLayout })._fullLayout;
      return clientPoint(
        root,
        layout._size.l + layout.xaxis.l2p(layout.xaxis.d2l(x)),
        layout._size.t + layout.yaxis.l2p(layout.yaxis.d2l(y)),
      );
    },
    async resize(width, height) {
      plotLayout.width = width;
      plotLayout.height = height;
      await observed.after(() => Plotly.relayout(root, { width, height }));
    },
    destroy() {
      Plotly.purge(root);
      root.remove();
    },
  };
}

function lineKind(fill: boolean) {
  return {
    prepare: (data: SeriesData, options: ChartOptions) => lineTraces(data, options, fill),
    async create(
      container: HTMLElement,
      data: SeriesData,
      options: ChartOptions,
    ): Promise<ChartHandle<SeriesData>> {
      const plotLayout = layout(options, { xaxis: { type: "date" } });
      const root = await mount(container, lineTraces(data, options, fill), plotLayout, options);
      const base = handle<SeriesData>(
        root,
        (next) => Plotly.react(root, lineTraces(next, options, fill), plotLayout, config(options)),
        plotLayout,
        SERIES.xy,
      );
      return {
        ...base,
        async append(x, ys, keep) {
          // extendTraces with maxPoints is Plotly's documented rolling-window
          // API. Batches must match the typed arrays the traces were built with.
          await base.after(() =>
            Plotly.extendTraces(
              root,
              { x: ys.map(() => x as unknown as number[]), y: ys as unknown as number[][] },
              ys.map((_, s) => s),
              keep,
            ),
          );
        },
        async setViewport(x0, x1) {
          await base.after(() => Plotly.relayout(root, { "xaxis.range": [x0, x1] }));
        },
      };
    },
  };
}

function barTraces(data: CategoryData): Partial<Plotly.Data>[] {
  return data.series.map((series, s) => ({
    type: "bar",
    name: series.name,
    x: data.categories,
    y: series.values as unknown as number[],
    marker: { color: color(s) },
  }));
}

function scatterTraces(data: PointData, options: ChartOptions): Partial<Plotly.Data>[] {
  return [
    {
      type: options.large ? "scattergl" : "scatter",
      mode: "markers",
      x: data.x as unknown as number[],
      y: data.y as unknown as number[],
      marker: { size: 3, color: color(0) },
    },
  ];
}

// Plotly's area-mode marker radius is sqrt(size / 2) with sizeref 1, so
// sizes of 2r² give the shared radii; opaque and without outlines, as the
// other libraries draw them.
function bubbleTraces(data: BubbleData): Partial<Plotly.Data>[] {
  const maxSize = Math.max(...data.size);
  const size = Array.from(data.size, (s) => 2 * bubbleRadius(s, maxSize) ** 2);
  return [
    {
      type: "scatter",
      mode: "markers",
      x: data.x as unknown as number[],
      y: data.y as unknown as number[],
      marker: {
        size,
        sizemode: "area",
        sizeref: 1,
        sizemin: 0,
        opacity: 1,
        line: { width: 0 },
        color: data.value as unknown as number[],
        colorscale: [
          [0, BUBBLE.colors[0]],
          [1, BUBBLE.colors[1]],
        ],
        showscale: false,
      },
    },
  ];
}

function heatmapTraces(data: GridData): Partial<Plotly.Data>[] {
  const z: Float64Array[] = [];
  for (let r = 0; r < data.rows; r++) {
    z.push(data.values.subarray(r * data.columns, (r + 1) * data.columns));
  }
  return [
    {
      type: "heatmap",
      z: z as unknown as number[][],
      colorscale: [
        [0, "#f7fbff"],
        [1, "#08306b"],
      ],
      showscale: false,
    },
  ];
}

// 3D charts are WebGL (gl3d) in Plotly. The camera is orthographic, as
// Herceg's is by default, with the box a cube, and its eye at Plotly's
// default distance in the direction of the azimuth and elevation.
function scene3d(
  options: ChartOptions,
  extra: Partial<Plotly.Layout> = {},
): Partial<Plotly.Layout> {
  return layout(options, {
    hovermode: options.tooltip ? "closest" : false,
    margin: { l: 0, r: 0, t: 0, b: 0 },
    scene: { aspectmode: "cube", camera: { projection: { type: "orthographic" } } },
    ...extra,
  } as Partial<Plotly.Layout>);
}

function eye(azimuth: number, elevation: number) {
  const distance = Math.hypot(1.25, 1.25, 1.25);
  const [a, e] = [(azimuth * Math.PI) / 180, (elevation * Math.PI) / 180];
  return {
    x: distance * Math.cos(e) * Math.cos(a),
    y: distance * Math.cos(e) * Math.sin(a),
    z: distance * Math.sin(e),
  };
}

function scatter3dTraces(data: Point3Data): Partial<Plotly.Data>[] {
  return [
    {
      type: "scatter3d",
      mode: "markers",
      x: data.x as unknown as number[],
      y: data.y as unknown as number[],
      z: data.z as unknown as number[],
      marker: { size: 7, color: color(0), line: { width: 0 } },
    } as Partial<Plotly.Data>,
  ];
}

// Plotly's surface takes z as rows of the grid, over the x and y vectors.
function surfaceTraces(data: SurfaceData): Partial<Plotly.Data>[] {
  const side = data.x.length;
  const z = Array.from({ length: data.y.length }, (_, j) =>
    data.z.subarray(j * side, (j + 1) * side),
  );
  return [
    {
      type: "surface",
      x: data.x as unknown as number[],
      y: data.y as unknown as number[],
      z: z as unknown as number[][],
    } as Partial<Plotly.Data>,
  ];
}

function camera3d(root: Root, after: (call: () => Promise<unknown>) => Promise<void>) {
  return (azimuth: number, elevation: number) =>
    after(() =>
      Plotly.relayout(root, {
        "scene.camera.eye": eye(azimuth, elevation),
      } as Partial<Plotly.Layout>),
    );
}

export const adapter: Adapter = {
  id: "plotly",
  verification:
    "after each Plotly call's promise resolves (Plotly has drawn) and at plotly_afterplot: the layout's size, plot area, axis ranges, series 0's trace, the 3D camera; the hover layer's SVG text before paint, with the point from plotly_hover",
  renderer: { normal: "svg", large: "webgl (scattergl)" },
  line: lineKind(false),
  area: {
    prepare: (data, options) => lineTraces(data, options, true),
    create: (container, data, options) => lineKind(true).create(container, data, options),
  },
  bar: {
    prepare: barTraces,
    async create(container, data, options) {
      const plotLayout = layout(options, { barmode: "group" });
      const root = await mount(container, barTraces(data), plotLayout, options);
      return handle<CategoryData>(
        root,
        (next) => Plotly.react(root, barTraces(next), plotLayout, config(options)),
        plotLayout,
        SERIES.values,
      );
    },
  },
  scatter: {
    prepare: scatterTraces,
    async create(container, data, options) {
      const plotLayout = layout(options, { hovermode: options.tooltip ? "closest" : false });
      const root = await mount(container, scatterTraces(data, options), plotLayout, options);
      const base = handle<PointData>(
        root,
        (next) => Plotly.react(root, scatterTraces(next, options), plotLayout, config(options)),
        plotLayout,
        SERIES.xy,
      );
      return {
        ...base,
        async setViewport(x0, x1) {
          await base.after(() => Plotly.relayout(root, { "xaxis.range": [x0, x1] }));
        },
      };
    },
  },
  heatmap: {
    prepare: heatmapTraces,
    async create(container, data, options) {
      const plotLayout = layout(options, { hovermode: options.tooltip ? "closest" : false });
      const root = await mount(container, heatmapTraces(data), plotLayout, options);
      return handle<GridData>(
        root,
        (next) => Plotly.react(root, heatmapTraces(next), plotLayout, config(options)),
        plotLayout,
        SERIES.grid,
      );
    },
  },
  candlestick: {
    prepare: candleTraces,
    async create(container, data, options) {
      // Plotly adds a range slider under candlestick charts; the others have
      // none. Times are epoch milliseconds, so the axis is declared a date axis.
      const plotLayout = layout(options, {
        xaxis: { type: "date", rangeslider: { visible: false } },
      });
      const root = await mount(container, candleTraces(data), plotLayout, options);
      return handle<CandleData>(
        root,
        (next) => Plotly.react(root, candleTraces(next), plotLayout, config(options)),
        plotLayout,
        SERIES.candles,
      );
    },
  },
  bubble: {
    prepare: bubbleTraces,
    async create(container, data, options) {
      const plotLayout = layout(options, { hovermode: options.tooltip ? "closest" : false });
      const root = await mount(container, bubbleTraces(data), plotLayout, options);
      return handle<BubbleData>(
        root,
        (next) => Plotly.react(root, bubbleTraces(next), plotLayout, config(options)),
        plotLayout,
        SERIES.xy,
      );
    },
  },
  histogram: {
    prepare: histogramTraces,
    async create(container, data, options) {
      // The x range every library is given.
      const plotLayout = layout(options, { bargap: 0.02, xaxis: { range: [25, 175] } });
      const root = await mount(container, histogramTraces(data), plotLayout, options);
      return handle<SampleData>(
        root,
        (next) => Plotly.react(root, histogramTraces(next), plotLayout, config(options)),
        plotLayout,
        SERIES.bins,
      );
    },
  },
  scatter3d: {
    prepare: scatter3dTraces,
    async create(container, data, options) {
      const plotLayout = scene3d(options);
      const root = await mount(container, scatter3dTraces(data), plotLayout, options);
      const base = handle<Point3Data>(
        root,
        (next) => Plotly.react(root, scatter3dTraces(next), plotLayout, config(options)),
        plotLayout,
        SERIES.xz,
      );
      return { ...base, setCamera: camera3d(root, base.after) };
    },
  },
  surface: {
    prepare: surfaceTraces,
    async create(container, data, options) {
      const plotLayout = scene3d(options);
      const root = await mount(container, surfaceTraces(data), plotLayout, options);
      const base = handle<SurfaceData>(
        root,
        (next) => Plotly.react(root, surfaceTraces(next), plotLayout, config(options)),
        plotLayout,
        SERIES.grid,
      );
      return { ...base, setCamera: camera3d(root, base.after) };
    },
  },
};
