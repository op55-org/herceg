import {
  area,
  bar,
  type Chart,
  candlestick,
  createChart,
  fromMatrix,
  heatmap,
  histogram,
  line,
  point,
  point3d,
  surface,
  table,
  time,
} from "herceg";
import {
  BUBBLE,
  type BubbleData,
  type CandleData,
  type CategoryData,
  type GridData,
  type Point3Data,
  type PointData,
  type SampleData,
  type SeriesData,
  type SurfaceData,
} from "../datasets.ts";
import type {
  Adapter,
  ChartHandle,
  ChartKind,
  ChartOptions,
  Drawn,
  Point,
  SeriesShown,
} from "../page/adapter.ts";
import { clientPoint, readoutText } from "../page/adapter.ts";

// A chart Herceg refuses throws, so the harness records the refusal rather
// than timing a chart that draws its error in place.
const REFUSALS = { errorMode: "throw" } as const;

/** What a chart refuses in a later frame reaches the harness as an uncaught error. */
function watched(chart: Chart): Chart {
  chart.on("error", ({ error }) => reportError(error));
  return chart;
}

/** A table as `drawn` reads it: its length and one value. */
interface Rows {
  readonly length: number;
  value(field: never, row: number): unknown;
}

/** Series 0 of `rows`: `x` (or the row's index) and `value` at its first and last rows. */
export function seriesIn(rows: Rows, x: string | undefined, value: string): SeriesShown {
  const n = rows.length;
  const at = (field: string, row: number) => Number(rows.value(field as never, row));
  return {
    count: n,
    firstX: x ? at(x, 0) : 0,
    lastX: x ? at(x, n - 1) : n - 1,
    first: at(value, 0),
    last: at(value, n - 1),
  };
}

/**
 * What a Herceg chart drew, read at its `render` event (after the frame's
 * draw): the size it drew at (the root's style, which each draw sets), the
 * first panel's plot and axes, series 0's rows, and the camera; the
 * tooltip's text from its element, and the row it reads from the `hover`
 * event, reported before that frame draws.
 */
export function observe(chart: Chart, series: () => SeriesShown, name = "s0"): () => Drawn {
  let draws = 0;
  let last: Omit<Drawn, "draws" | "readout" | "plot"> & { plot?: Drawn["plot"] } = {
    width: 0,
    height: 0,
  };
  let row: number | undefined;
  const capture = () => {
    draws++;
    const panel = chart.getPanels()[0];
    const camera = chart.getCamera();
    last = {
      width: Number.parseFloat(chart.root.style.width),
      height: Number.parseFloat(chart.root.style.height),
      ...(panel?.x &&
        panel.y && {
          plot: {
            left: panel.plot.x,
            top: panel.plot.y,
            width: panel.plot.width,
            height: panel.plot.height,
          },
          x: panel.x.domain,
          y: [panel.y.domain[0], panel.y.domain[1]] as const,
        }),
      series: series(),
      ...(camera && { camera: { azimuth: camera.azimuth, elevation: camera.elevation } }),
    };
  };
  chart.on("render", capture);
  // A chart draws its first frame before `createChart` returns.
  if (chart.drawnRevision !== undefined) capture();
  chart.on("hover", ({ inspection }) => {
    const points = inspection?.points ?? [];
    row = (points.find((point) => point.label === name) ?? points[0])?.row;
  });
  return () => {
    const tooltip = [...chart.root.children].find(
      (element): element is HTMLElement =>
        element instanceof HTMLDivElement && element.style.pointerEvents === "none",
    );
    const shown = tooltip && tooltip.style.display !== "none" ? readoutText(tooltip) : "";
    // Where the chart is on the page, for the plot's client position.
    const box = chart.root.getBoundingClientRect();
    return {
      ...last,
      draws,
      ...(last.plot && {
        plot: { ...last.plot, left: box.left + last.plot.left, top: box.top + last.plot.top },
      }),
      ...(shown && { readout: { text: shown, ...(row !== undefined && { index: row }) } }),
    };
  };
}

// Herceg reads the benchmark's typed arrays in place: a table wraps them
// without copying. The table's maxRows makes it a rolling window, which is
// Herceg's documented streaming path. Each series' field is its name, which
// legends and tooltips show, as the other libraries show the names given.
export function seriesTable(data: SeriesData) {
  const columns: Record<string, Float64Array | ReturnType<typeof time>> = { t: time(data.x) };
  data.ys.forEach((y, s) => {
    columns[data.names[s]!] = y;
  });
  return table(columns, { maxRows: data.x.length });
}

export function columnsOf(data: SeriesData) {
  const columns: Record<string, Float64Array> = { t: data.x };
  data.ys.forEach((y, s) => {
    columns[data.names[s]!] = y;
  });
  return columns;
}

/** Streaming: append a batch to every series (`names`) and keep the newest `keep` rows. */
export function appendTo(
  source: ReturnType<typeof seriesTable>,
  x: Float64Array,
  ys: Float64Array[],
  keep: number,
  names: readonly string[],
): void {
  const batch: Record<string, Float64Array> = { t: x };
  ys.forEach((y, s) => {
    batch[names[s]!] = y;
  });
  source.append(batch);
  if (source.length > keep) source.dropFirst(source.length - keep);
}

function lineKind(fill: boolean): ChartKind<SeriesData> {
  return {
    prepare: seriesTable,
    create(
      container: HTMLElement,
      data: SeriesData,
      options: ChartOptions,
    ): ChartHandle<SeriesData> {
      const source = seriesTable(data);
      const fields = data.names;
      const chart = watched(
        createChart(container, {
          ...REFUSALS,
          width: options.width,
          height: options.height,
          tooltip: options.tooltip,
          marks: [fill ? area(source, { x: "t", y: fields }) : line(source, { x: "t", y: fields })],
        }),
      );
      return {
        setData: (next) => source.reset(columnsOf(next)),
        append: (x, ys, keep) => appendTo(source, x, ys, keep, data.names),
        setViewport: (x0, x1) => chart.setViewport([x0, x1]),
        pixelOf: (_series, _index, x, y) => pixelOf(chart, x, y),
        resize: (width, height) => {
          chart.update({ width, height });
        },
        drawn: observe(chart, () => seriesIn(source, "t", fields[0]!), fields[0]),
        destroy: () => chart.destroy(),
      };
    },
  };
}

/** Where data values are on the page, as the chart last drew them. */
export function pixelOf(chart: Chart, x: number, y: number): Point {
  return clientPoint(
    chart.root,
    chart.toPixel(x, { axis: "x" })!,
    chart.toPixel(y, { axis: "y" })!,
  );
}

function common(
  chart: Chart,
  series: () => SeriesShown,
): Pick<ChartHandle<unknown>, "pixelOf" | "resize" | "drawn" | "destroy" | "rendered"> {
  return {
    drawn: observe(chart, series),
    pixelOf: (_series, _index, x, y) => pixelOf(chart, x, y),
    resize: (width, height) => {
      chart.update({ width, height });
    },
    destroy: () => chart.destroy(),
    // Large point series wait for the GPU painter, which loads on demand.
    rendered: () => chart.loading,
  };
}

function barColumns(data: CategoryData) {
  const columns: Record<string, Float64Array | string[]> = { category: data.categories };
  data.series.forEach((s, i) => {
    columns[`s${i}`] = s.values;
  });
  return columns;
}

function candleColumns(data: CandleData) {
  return { t: time(data.x), o: data.open, h: data.high, l: data.low, c: data.close };
}

// A surface's grid as a matrix table: its x and y values and the heights
// at each pair, as Plotly takes them.
function surfaceTable(data: SurfaceData) {
  return fromMatrix({ x: data.x, y: data.y, z: data.z }, { x: "x", y: "y" });
}

// A surface's grid points as one row each, as a long table gives them.
function surfaceColumns(data: SurfaceData) {
  const side = data.x.length;
  const x = new Float64Array(data.z.length);
  const y = new Float64Array(data.z.length);
  for (let k = 0; k < data.z.length; k++) {
    x[k] = data.x[k % side]!;
    y[k] = data.y[Math.floor(k / side)]!;
  }
  return { x, y, z: data.z };
}

/** A 3D chart's handle: `setCamera` turns it; there are no x and y scales to aim pointers with. */
function solid(chart: Chart, series: () => SeriesShown): Omit<ChartHandle<never>, "setData"> {
  return {
    drawn: observe(chart, series),
    pixelOf: () => clientPoint(chart.root, 0, 0),
    resize: (width, height) => {
      chart.update({ width, height });
    },
    destroy: () => chart.destroy(),
    // Large point clouds wait for the GPU painter, which loads on demand.
    rendered: () => chart.loading,
    setCamera: (azimuth, elevation) => chart.setCamera({ azimuth, elevation }),
  };
}

// Heatmap cells as one row each: column index, row index, value.
function gridColumns(data: GridData) {
  const count = data.columns * data.rows;
  const c = new Float64Array(count);
  const r = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    c[i] = i % data.columns;
    r[i] = Math.floor(i / data.columns);
  }
  return { c, r, v: data.values };
}

export const adapter: Adapter = {
  id: "herceg",
  verification:
    "the chart's render event (after each frame's draw): the first panel's plot and axis domains, series 0's rows, the camera; the tooltip element's text before paint, and the row from the hover event",
  renderer: {
    normal:
      "auto (svg below 4,000 drawn points, canvas above; 3D charts on WebGL from 20,000 points or 10,000 surface cells)",
    large: "auto",
  },
  line: lineKind(false),
  area: lineKind(true),
  bar: {
    prepare: (data) => table(barColumns(data)),
    create(container, data, options) {
      const source = table(barColumns(data));
      const fields = data.series.map((_, i) => `s${i}`);
      const chart = watched(
        createChart(container, {
          ...REFUSALS,
          width: options.width,
          height: options.height,
          tooltip: options.tooltip,
          marks: [bar(source, { x: "category", y: fields })],
        }),
      );
      return {
        ...common(chart, () => seriesIn(source, undefined, "s0")),
        setData: (next) => source.reset(barColumns(next)),
      };
    },
  },
  scatter: {
    prepare: (data) => table({ x: data.x, y: data.y }),
    create(container, data, options) {
      const source = table({ x: data.x, y: data.y });
      const chart = watched(
        createChart(container, {
          ...REFUSALS,
          width: options.width,
          height: options.height,
          tooltip: options.tooltip,
          marks: [point(source, { x: "x", y: "y", radius: 1.5 })],
        }),
      );
      return {
        ...common(chart, () => seriesIn(source, "x", "y")),
        setData: (next: PointData) => source.reset({ x: next.x, y: next.y }),
        setViewport: (x0, x1) => chart.setViewport([x0, x1]),
      };
    },
  },
  heatmap: {
    prepare: (data) => table(gridColumns(data)),
    create(container, data, options) {
      const source = table(gridColumns(data));
      const chart = watched(
        createChart(container, {
          ...REFUSALS,
          width: options.width,
          height: options.height,
          tooltip: options.tooltip,
          // Same ramp and no color legend, as configured for the other libraries.
          legend: false,
          marks: [heatmap(source, { x: "c", y: "r", color: "v", colors: ["#f7fbff", "#08306b"] })],
        }),
      );
      return {
        ...common(chart, () => seriesIn(source, undefined, "v")),
        setData: (next) => source.reset(gridColumns(next)),
      };
    },
  },
  candlestick: {
    prepare: (data) => table(candleColumns(data)),
    create(container, data, options) {
      const source = table(candleColumns(data));
      const chart = watched(
        createChart(container, {
          ...REFUSALS,
          width: options.width,
          height: options.height,
          tooltip: options.tooltip,
          marks: [candlestick(source, { x: "t", open: "o", high: "h", low: "l", close: "c" })],
        }),
      );
      return {
        ...common(chart, () => seriesIn(source, "t", "c")),
        setData: (next) => source.reset(candleColumns(next)),
      };
    },
  },
  histogram: {
    prepare: (data) => table({ v: data.values }),
    create(container, data, options) {
      const source = table({ v: data.values });
      const chart = watched(
        createChart(container, {
          ...REFUSALS,
          width: options.width,
          height: options.height,
          tooltip: options.tooltip,
          // The fixed grid and x range every library is given: 5 wide from 25 to 175.
          x: { domain: [25, 175] },
          marks: [histogram(source, { x: "v", bins: { step: 5, start: 25 } })],
        }),
      );
      return {
        ...common(chart, () => seriesIn(source, undefined, "v")),
        setData: (next: SampleData) => source.reset({ v: next.values }),
      };
    },
  },
  bubble: {
    prepare: (data) => table(bubbleColumns(data)),
    create(container, data, options) {
      const source = table(bubbleColumns(data));
      const chart = watched(
        createChart(container, {
          ...REFUSALS,
          width: options.width,
          height: options.height,
          tooltip: options.tooltip,
          // No size key or color legend, as configured for the other libraries.
          legend: false,
          marks: [
            point(source, {
              x: "x",
              y: "y",
              size: "s",
              radiusRange: [BUBBLE.minRadius, BUBBLE.maxRadius],
              color: "v",
              colors: BUBBLE.colors,
            }),
          ],
        }),
      );
      return {
        ...common(chart, () => seriesIn(source, "x", "y")),
        setData: (next) => source.reset(bubbleColumns(next)),
      };
    },
  },
  // Orthographic projection and the default camera, with 3.5 px points of
  // one color; surfaces colored by height and shaded, Herceg's defaults.
  scatter3d: {
    prepare: (data) => table({ x: data.x, y: data.y, z: data.z }),
    create(container, data, options) {
      const source = table({ x: data.x, y: data.y, z: data.z });
      const chart = watched(
        createChart(container, {
          ...REFUSALS,
          width: options.width,
          height: options.height,
          tooltip: options.tooltip,
          marks: [point3d(source, { x: "x", y: "y", z: "z" })],
        }),
      );
      return {
        ...solid(chart, () => seriesIn(source, "x", "z")),
        setData: (next: Point3Data) => source.reset({ x: next.x, y: next.y, z: next.z }),
      };
    },
  },
  surface: {
    prepare: surfaceTable,
    create(container, data, options) {
      const source = surfaceTable(data);
      const chart = watched(
        createChart(container, {
          ...REFUSALS,
          width: options.width,
          height: options.height,
          tooltip: options.tooltip,
          marks: [surface(source, { x: "x", y: "y", z: "z" })],
        }),
      );
      return {
        ...solid(chart, () => seriesIn(source, undefined, "z")),
        setData: (next: SurfaceData) => source.reset(surfaceColumns(next)),
      };
    },
  },
};

function bubbleColumns(data: BubbleData) {
  return { x: data.x, y: data.y, s: data.size, v: data.value };
}
