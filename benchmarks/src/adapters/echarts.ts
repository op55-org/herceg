import { BarChart, CandlestickChart, HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import {
  BUBBLE,
  type BubbleData,
  bubbleRadius,
  type CandleData,
  type CategoryData,
  type GridData,
  type PointData,
  type SeriesData,
} from "../datasets.ts";
import type { Adapter, ChartHandle, ChartOptions, Drawn, SeriesShown } from "../page/adapter.ts";
import { clientPoint, color, FALL, RISE, readoutText } from "../page/adapter.ts";

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  HeatmapChart,
  CandlestickChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

// ECharts' documented shape for time series is [x, y] pairs per point.
function seriesPairs(data: SeriesData): [number, number][][] {
  return data.ys.map((y) => {
    const pairs: [number, number][] = new Array(y.length);
    for (let i = 0; i < y.length; i++) pairs[i] = [data.x[i]!, y[i]!];
    return pairs;
  });
}

function base(options: ChartOptions, trigger: "axis" | "item") {
  return {
    animation: false,
    // The tooltip has its own CSS transition that `animation: false` keeps.
    tooltip: options.tooltip ? { trigger, transitionDuration: 0 } : { show: false },
  };
}

function lineOption(
  pairs: [number, number][][],
  data: SeriesData,
  options: ChartOptions,
  area: boolean,
) {
  return {
    ...base(options, "axis"),
    xAxis: { type: "time" as const },
    yAxis: { type: "value" as const, scale: true },
    // Zoom goes through ECharts' documented dataZoom component.
    dataZoom: options.zoom ? [{ type: "inside" as const, xAxisIndex: 0 }] : undefined,
    series: pairs.map((points, s) => ({
      type: "line" as const,
      name: data.names[s],
      data: points,
      showSymbol: false,
      color: color(s),
      lineStyle: { width: 1.5 },
      // Documented large-line setting; keeps the min and max of each bucket.
      sampling: options.large ? ("minmax" as const) : undefined,
      areaStyle: area ? { opacity: 0.25 } : undefined,
    })),
  };
}

/** Series 0's raw item as the adapter gave it: its x (or undefined for an item's index) and value. */
type ItemOf = (raw: unknown) => [x: number | undefined, value: number];

/** Pairs, rows, and plain values, by chart kind. */
const ITEMS = {
  pair: ((raw) => [(raw as number[])[0], (raw as number[])[1]!]) as ItemOf,
  value: ((raw) => [undefined, raw as number]) as ItemOf,
  cell: ((raw) => [undefined, (raw as number[])[2]!]) as ItemOf,
  candle: ((raw) => [(raw as number[])[0], (raw as number[])[2]!]) as ItemOf,
};

// ECharts keeps its model behind internal accessors; the observer reads it
// only, at the chart's `rendered` event.
interface Model {
  getComponent(type: string, index: number): { axis?: Axis; coordinateSystem?: Grid } | undefined;
  /** A series' data as given, before sampling or zoom filtered it. */
  getSeriesByIndex(index: number): { getRawData(): RawData } | undefined;
}
interface RawData {
  count(): number;
  getRawDataItem(i: number): unknown;
}
interface Axis {
  scale: { getExtent(): [number, number] };
}
interface Grid {
  getRect(): { x: number; y: number; width: number; height: number };
}

/**
 * What an ECharts chart drew, read at its `rendered` event (after each
 * frame zrender draws): the size, the grid's rectangle and axis extents,
 * and series 0's raw data; the tooltip's text from its element before the
 * frame paints, and the item it reads from the `updateAxisPointer` and
 * `mouseover` events.
 */
function observe(chart: echarts.ECharts, container: HTMLElement, itemOf: ItemOf): () => Drawn {
  const model = () => (chart as unknown as { getModel(): Model }).getModel();
  let draws = 0;
  let last: Omit<Drawn, "draws" | "readout"> = { width: 0, height: 0 };
  let index: number | undefined;
  let tooltip: HTMLElement | undefined;
  chart.on("rendered", () => {
    draws++;
    const m = model();
    const rect = m.getComponent("grid", 0)?.coordinateSystem?.getRect();
    const x = m.getComponent("xAxis", 0)?.axis?.scale.getExtent();
    const y = m.getComponent("yAxis", 0)?.axis?.scale.getExtent();
    const raw = m.getSeriesByIndex(0)?.getRawData();
    let shown: SeriesShown | undefined;
    if (raw && raw.count() > 0) {
      const n = raw.count();
      const [firstX, first] = itemOf(raw.getRawDataItem(0));
      const [lastX, lastValue] = itemOf(raw.getRawDataItem(n - 1));
      shown = { count: n, firstX: firstX ?? 0, lastX: lastX ?? n - 1, first, last: lastValue };
    }
    last = {
      width: chart.getWidth(),
      height: chart.getHeight(),
      ...(rect && { plot: { left: rect.x, top: rect.y, width: rect.width, height: rect.height } }),
      ...(x && { x: [x[0], x[1]] as const }),
      ...(y && { y: [y[0], y[1]] as const }),
      ...(shown && { series: shown }),
    };
  });
  // The axis pointer's value is series 0's x it snapped to; items name their index.
  chart.on("updateAxisPointer", (event) => {
    const value = (event as { axesInfo?: { axisDim: string; value: number }[] }).axesInfo?.find(
      (info) => info.axisDim === "x",
    )?.value;
    const raw = model().getSeriesByIndex(0)?.getRawData();
    if (value === undefined || !raw) return;
    let lo = 0;
    let hi = raw.count() - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((itemOf(raw.getRawDataItem(mid))[0] ?? mid) < value) lo = mid + 1;
      else hi = mid;
    }
    index = lo;
  });
  chart.on("mouseover", (event) => {
    const item = event as { seriesIndex?: number; dataIndex?: number };
    if (item.seriesIndex === 0) index = item.dataIndex;
  });
  return () => {
    // ECharts' tooltip is a div it adds to the container (z-index 9999999).
    tooltip ??= [...container.querySelectorAll("div")].find(
      (element) => element.style.zIndex === "9999999",
    );
    const visible =
      tooltip &&
      tooltip.style.display !== "none" &&
      tooltip.style.visibility !== "hidden" &&
      tooltip.style.opacity !== "0";
    const box = container.getBoundingClientRect();
    return {
      ...last,
      draws,
      ...(last.plot && {
        plot: { ...last.plot, left: box.left + last.plot.left, top: box.top + last.plot.top },
      }),
      ...(visible && {
        readout: { text: readoutText(tooltip), ...(index !== undefined && { index }) },
      }),
    };
  };
}

type EChartsHandle<T> = ChartHandle<T> & {
  apply(next: object): void;
  /** Runs a change and tracks rendering until ECharts emits `finished`. */
  track(change: () => void): void;
  chart: echarts.ECharts;
};

/**
 * Creates a chart the harness can wait on: scatter and heatmap series render
 * progressively over several frames, and ECharts emits `finished` when the
 * last one is drawn.
 */
function mount<T>(
  container: HTMLElement,
  options: ChartOptions,
  option: object,
  update: (data: T) => object,
  itemOf: ItemOf,
): EChartsHandle<T> {
  const chart = echarts.init(container, undefined, {
    renderer: "canvas",
    width: options.width,
    height: options.height,
  });
  let pending: Promise<void> | undefined;
  const track = (change: () => void) => {
    const promise = new Promise<void>((resolve) => {
      const done = () => {
        chart.off("finished", done);
        if (pending === promise) pending = undefined;
        resolve();
      };
      chart.on("finished", done);
    });
    pending = promise;
    change();
  };
  const apply = (next: object) => track(() => chart.setOption(next as echarts.EChartsCoreOption));
  const drawn = observe(chart, container, itemOf);
  apply(option);
  return {
    apply,
    track,
    chart,
    setData: (data) => apply(update(data)),
    rendered: () => pending,
    pixelOf(_series, _index, x, y) {
      const [px, py] = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [x, y]) as number[];
      return clientPoint(container, px!, py!);
    },
    resize: (width, height) => chart.resize({ width, height }),
    drawn,
    destroy: () => chart.dispose(),
  };
}

function lineKind(area: boolean) {
  return {
    prepare: (data: SeriesData) => seriesPairs(data),
    create(
      container: HTMLElement,
      data: SeriesData,
      options: ChartOptions,
    ): ChartHandle<SeriesData> {
      // ECharts copies series data into its own storage, so rolling arrays are
      // only kept once streaming starts.
      let rolling: [number, number][][] | null = null;
      let current = data;
      const chart = mount<SeriesData>(
        container,
        options,
        lineOption(seriesPairs(data), data, options, area),
        (next) => {
          rolling = null;
          current = next;
          return { series: seriesPairs(next).map((points) => ({ data: points })) };
        },
        ITEMS.pair,
      );
      return {
        ...chart,
        append(x, ys, keep) {
          rolling ??= seriesPairs(current);
          ys.forEach((y, s) => {
            const points = rolling![s]!;
            for (let i = 0; i < x.length; i++) points.push([x[i]!, y[i]!]);
            if (points.length > keep) points.splice(0, points.length - keep);
          });
          chart.apply({ series: rolling.map((points) => ({ data: points })) });
        },
        setViewport(x0, x1) {
          chart.track(() =>
            chart.chart.dispatchAction({ type: "dataZoom", startValue: x0, endValue: x1 }),
          );
        },
      };
    },
  };
}

const prepareBar = (data: CategoryData) => data.series.map((s) => Array.from(s.values));

function scatterPairs(data: PointData): [number, number][] {
  const pairs: [number, number][] = new Array(data.x.length);
  for (let i = 0; i < data.x.length; i++) pairs[i] = [data.x[i]!, data.y[i]!];
  return pairs;
}

// ECharts' documented candlestick item on a time axis: [time, open, close, low, high].
function candleRows(data: CandleData): number[][] {
  const rows: number[][] = new Array(data.x.length);
  for (let i = 0; i < data.x.length; i++) {
    rows[i] = [data.x[i]!, data.open[i]!, data.close[i]!, data.low[i]!, data.high[i]!];
  }
  return rows;
}

// ECharts' documented scatter item with extra dimensions: [x, y, size, value].
function bubbleRows(data: BubbleData): number[][] {
  const rows: number[][] = new Array(data.x.length);
  for (let i = 0; i < data.x.length; i++) {
    rows[i] = [data.x[i]!, data.y[i]!, data.size[i]!, data.value[i]!];
  }
  return rows;
}

/**
 * Bubbles colored by the fourth dimension and sized by the third, with the
 * domains of `data`; opaque, as the other libraries draw them.
 */
function bubbleOption(data: BubbleData) {
  const [min, max] = extent(data.value);
  const maxSize = extent(data.size)[1];
  return {
    visualMap: { min, max, dimension: 3, show: false, inRange: { color: [...BUBBLE.colors] } },
    series: [
      {
        type: "scatter" as const,
        data: bubbleRows(data),
        symbolSize: (row: number[]) => 2 * bubbleRadius(row[2]!, maxSize),
        itemStyle: { opacity: 1 },
      },
    ],
  };
}

function heatmapTriples(data: GridData): [number, number, number][] {
  const out: [number, number, number][] = new Array(data.values.length);
  for (let r = 0; r < data.rows; r++) {
    for (let c = 0; c < data.columns; c++) {
      const i = r * data.columns + c;
      out[i] = [c, r, data.values[i]!];
    }
  }
  return out;
}

function extent(values: Float64Array): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

export const adapter: Adapter = {
  id: "echarts",
  verification:
    "the chart's rendered event (after each frame zrender draws): the grid's rectangle, the axes' extents, series 0's raw data; the tooltip element's text before paint, and the item from updateAxisPointer and mouseover events",
  renderer: { normal: "canvas", large: "canvas (sampling: minmax, large: true)" },
  line: lineKind(false),
  area: lineKind(true),
  bar: {
    prepare: prepareBar,
    create(container, data, options) {
      return mount<CategoryData>(
        container,
        options,
        {
          ...base(options, "axis"),
          xAxis: { type: "category", data: data.categories },
          yAxis: { type: "value" },
          series: prepareBar(data).map((values, s) => ({
            type: "bar",
            name: data.series[s]!.name,
            data: values,
            color: color(s),
          })),
        },
        (next) => ({ series: prepareBar(next).map((values) => ({ data: values })) }),
        ITEMS.value,
      );
    },
  },
  scatter: {
    prepare: scatterPairs,
    create(container, data, options) {
      const chart = mount<PointData>(
        container,
        options,
        {
          ...base(options, "item"),
          xAxis: { type: "value", scale: true },
          yAxis: { type: "value", scale: true },
          dataZoom: options.zoom ? [{ type: "inside" as const, xAxisIndex: 0 }] : undefined,
          series: [
            {
              type: "scatter",
              data: scatterPairs(data),
              symbolSize: 3,
              color: color(0),
              // Documented setting for large scatter data.
              large: options.large,
            },
          ],
        },
        (next) => ({ series: [{ data: scatterPairs(next) }] }),
        ITEMS.pair,
      );
      return {
        ...chart,
        setViewport(x0, x1) {
          chart.track(() =>
            chart.chart.dispatchAction({ type: "dataZoom", startValue: x0, endValue: x1 }),
          );
        },
      };
    },
  },
  heatmap: {
    prepare: heatmapTriples,
    create(container, data, options) {
      const [min, max] = extent(data.values);
      return mount<GridData>(
        container,
        options,
        {
          ...base(options, "item"),
          xAxis: { type: "category", data: Array.from({ length: data.columns }, (_, i) => i) },
          yAxis: { type: "category", data: Array.from({ length: data.rows }, (_, i) => i) },
          visualMap: { min, max, show: false, inRange: { color: ["#f7fbff", "#08306b"] } },
          series: [{ type: "heatmap", data: heatmapTriples(data) }],
        },
        (next) => ({ series: [{ data: heatmapTriples(next) }] }),
        ITEMS.cell,
      );
    },
  },
  candlestick: {
    prepare: candleRows,
    create(container, data, options) {
      return mount<CandleData>(
        container,
        options,
        {
          ...base(options, "axis"),
          xAxis: { type: "time" },
          yAxis: { type: "value", scale: true },
          series: [
            {
              type: "candlestick",
              data: candleRows(data),
              // Documented large-data mode for candlesticks: it draws each
              // candle as a high-low line without a body.
              large: options.large,
              // Rising candles hollow, falling ones filled, as the others draw
              // them (outside the large mode).
              itemStyle: {
                color: "transparent",
                color0: FALL,
                borderColor: RISE,
                borderColor0: FALL,
              },
            },
          ],
        },
        (next) => ({ series: [{ data: candleRows(next) }] }),
        ITEMS.candle,
      );
    },
  },
  bubble: {
    prepare: bubbleRows,
    create(container, data, options) {
      return mount<BubbleData>(
        container,
        options,
        {
          ...base(options, "item"),
          xAxis: { type: "value", scale: true },
          yAxis: { type: "value", scale: true },
          ...bubbleOption(data),
        },
        bubbleOption,
        ITEMS.pair,
      );
    },
  },
};
