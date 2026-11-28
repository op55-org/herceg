import {
  BarController,
  BarElement,
  BubbleController,
  CategoryScale,
  Chart,
  Decimation,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  TimeScale,
  Tooltip,
} from "chart.js";
import "chartjs-adapter-date-fns";
import {
  type BubbleData,
  bubbleColor,
  bubbleRadius,
  type CategoryData,
  type PointData,
  type SeriesData,
} from "../datasets.ts";
import type { Adapter, ChartHandle, ChartOptions, Drawn } from "../page/adapter.ts";
import { clientPoint, color } from "../page/adapter.ts";

Chart.register(
  LineController,
  BarController,
  BubbleController,
  ScatterController,
  LineElement,
  BarElement,
  PointElement,
  LinearScale,
  CategoryScale,
  TimeScale,
  Tooltip,
  Filler,
  Decimation,
);

type XY = { x: number; y: number };

/** What each chart drew, kept by the observer plugin below. */
interface Observed {
  draws: number;
  drawn: Omit<Drawn, "draws">;
  /** Whether the draw under way has drawn its tooltip. */
  tooltipDrawn: boolean;
}
const observed = new WeakMap<Chart, Observed>();

/** Series 0's items: the points a draw read (Chart.js keeps them in `_data` when it decimates). */
function itemsOf(chart: Chart): unknown[] {
  const dataset = chart.data.datasets[0] as { data: unknown[]; _data?: unknown[] } | undefined;
  return dataset?._data ?? dataset?.data ?? [];
}

/** An item's x (or undefined for a bar's index) and value. */
function itemOf(item: unknown): [number | undefined, number] {
  return typeof item === "number" ? [undefined, item] : [(item as XY).x, (item as XY).y];
}

// Reads what each chart drew at its own draw hooks: after the whole draw
// (size, chart area, scales, series 0's items), and after the tooltip is
// drawn on the canvas (its text and series 0's point).
Chart.register({
  id: "benchmarkObserver",
  beforeDraw(chart: Chart) {
    const state = observed.get(chart);
    if (state) state.tooltipDrawn = false;
  },
  afterTooltipDraw(chart: Chart, args: { tooltip: Chart["tooltip"] }) {
    const state = observed.get(chart);
    const tooltip = args.tooltip;
    if (!state || !tooltip || tooltip.opacity === 0) return;
    state.tooltipDrawn = true;
    const lines = [
      ...tooltip.title,
      ...tooltip.body.flatMap((part) => [...part.before, ...part.lines, ...part.after]),
      ...tooltip.footer,
    ];
    const point = tooltip.dataPoints.find((p) => p.datasetIndex === 0);
    let index: number | undefined;
    if (point) {
      const items = itemsOf(chart);
      if (items[point.dataIndex] === point.raw) index = point.dataIndex;
      else {
        // A decimated line's point: find its x among the items drawn from.
        const x = (point.raw as XY).x;
        let lo = 0;
        let hi = items.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if ((items[mid] as XY).x < x) lo = mid + 1;
          else hi = mid;
        }
        index = lo;
      }
    }
    state.drawn.readout = { text: lines.join(" "), ...(index !== undefined && { index }) };
  },
  afterDraw(chart: Chart) {
    const state = observed.get(chart) ?? {
      draws: 0,
      drawn: { width: 0, height: 0 },
      tooltipDrawn: false,
    };
    observed.set(chart, state);
    state.draws++;
    const items = itemsOf(chart);
    const n = items.length;
    const [firstX, first] = itemOf(items[0]);
    const [lastX, last] = itemOf(items[n - 1]);
    const area = chart.chartArea;
    const { x, y } = chart.scales;
    state.drawn = {
      width: chart.width,
      height: chart.height,
      plot: { left: area.left, top: area.top, width: area.width, height: area.height },
      ...(x && { x: [x.min, x.max] as const }),
      ...(y && { y: [y.min, y.max] as const }),
      series: { count: n, firstX: firstX ?? 0, lastX: lastX ?? n - 1, first, last },
      ...(state.tooltipDrawn && state.drawn.readout && { readout: state.drawn.readout }),
    };
  },
});

/** What `chart` drew, its plot placed in client px before the frame paints. */
function drawnBy(chart: Chart): Drawn {
  const state = observed.get(chart);
  if (!state) return { draws: 0, width: 0, height: 0 };
  const box = chart.canvas.getBoundingClientRect();
  const plot = state.drawn.plot;
  return {
    ...state.drawn,
    draws: state.draws,
    ...(plot && { plot: { ...plot, left: box.left + plot.left, top: box.top + plot.top } }),
  };
}

// Chart.js' internal (pre-parsed) format is one {x, y} object per point.
function seriesPoints(data: SeriesData): XY[][] {
  return data.ys.map((y) => {
    const points: XY[] = new Array(y.length);
    for (let i = 0; i < y.length; i++) points[i] = { x: data.x[i]!, y: y[i]! };
    return points;
  });
}

function canvasIn(container: HTMLElement, options: ChartOptions): HTMLCanvasElement {
  // Chart.js sizes the canvas from a relatively positioned parent.
  const box = document.createElement("div");
  box.style.cssText = `position:relative;width:${options.width}px;height:${options.height}px`;
  const canvas = document.createElement("canvas");
  box.append(canvas);
  container.append(box);
  return canvas;
}

function common(options: ChartOptions) {
  return {
    animation: false as const,
    responsive: true,
    maintainAspectRatio: false,
    events: options.tooltip ? undefined : [],
  };
}

function handle<T>(chart: Chart, setData: (data: T) => void): ChartHandle<T> {
  return {
    setData,
    pixelOf(_series, _index, x, y) {
      return clientPoint(
        chart.canvas,
        chart.scales.x!.getPixelForValue(x),
        chart.scales.y!.getPixelForValue(y),
      );
    },
    resize(width, height) {
      const box = chart.canvas.parentElement!;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      chart.resize(width, height);
    },
    drawn: () => drawnBy(chart),
    destroy() {
      const box = chart.canvas.parentElement!;
      chart.destroy();
      box.remove();
    },
  };
}

function lineKind(fill: boolean) {
  return {
    prepare: (data: SeriesData) => seriesPoints(data),
    create(
      container: HTMLElement,
      data: SeriesData,
      options: ChartOptions,
    ): ChartHandle<SeriesData> {
      // With decimation on, `dataset.data` holds the decimated points, so the
      // adapter keeps the source arrays and assigns them on every update.
      let sources = seriesPoints(data);
      const chart = new Chart(canvasIn(container, options), {
        type: "line",
        data: {
          datasets: sources.map((points, s) => ({
            label: data.names[s],
            data: points,
            borderColor: color(s),
            backgroundColor: `${color(s)}40`,
            borderWidth: 1.5,
            pointRadius: 0,
            fill: fill ? "origin" : false,
          })),
        },
        options: {
          ...common(options),
          // Documented large-data settings: skip parsing for sorted, unique x
          // values, and min-max decimation (which requires parsing: false).
          parsing: false,
          normalized: true,
          interaction: { mode: "index", intersect: false },
          scales: { x: { type: "time" }, y: { type: "linear" } },
          plugins: {
            tooltip: { enabled: options.tooltip },
            decimation: { enabled: options.large, algorithm: "min-max" },
          },
        },
      });
      const assign = () => {
        sources.forEach((points, s) => {
          chart.data.datasets[s]!.data = points;
        });
        chart.update("none");
      };
      return {
        ...handle<SeriesData>(chart, (next) => {
          sources = seriesPoints(next);
          assign();
        }),
        append(x, ys, keep) {
          ys.forEach((y, s) => {
            const points = sources[s]!;
            for (let i = 0; i < x.length; i++) points.push({ x: x[i]!, y: y[i]! });
            if (points.length > keep) points.splice(0, points.length - keep);
          });
          assign();
        },
        // Axis limits are Chart.js' documented way to set the visible range;
        // decimation then works on the visible points.
        setViewport(x0, x1) {
          const x = chart.options.scales!.x!;
          x.min = x0;
          x.max = x1;
          chart.update("none");
        },
      };
    },
  };
}

const prepareBar = (data: CategoryData) => data.series.map((s) => Array.from(s.values));

function scatterPoints(data: PointData): XY[] {
  const points: XY[] = new Array(data.x.length);
  for (let i = 0; i < data.x.length; i++) points[i] = { x: data.x[i]!, y: data.y[i]! };
  return points;
}

/** Chart.js bubbles take a radius per point and a color per point. */
function bubblePoints(data: BubbleData): {
  points: { x: number; y: number; r: number }[];
  colors: string[];
} {
  const maxSize = Math.max(...data.size);
  let min = Infinity;
  let max = -Infinity;
  for (const v of data.value) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const points = new Array(data.x.length);
  const colors = new Array<string>(data.x.length);
  for (let i = 0; i < data.x.length; i++) {
    points[i] = { x: data.x[i]!, y: data.y[i]!, r: bubbleRadius(data.size[i]!, maxSize) };
    colors[i] = bubbleColor(data.value[i]!, min, max);
  }
  return { points, colors };
}

export const adapter: Adapter = {
  id: "chartjs",
  verification:
    "a plugin's draw hooks: afterDraw (size, chart area, scales, series 0's items) and afterTooltipDraw (the tooltip's text and series 0's point, as drawn on the canvas)",
  renderer: { normal: "canvas", large: "canvas (parsing: false, min-max decimation)" },
  line: lineKind(false),
  area: lineKind(true),
  bar: {
    prepare: prepareBar,
    create(container, data, options) {
      const chart = new Chart(canvasIn(container, options), {
        type: "bar",
        data: {
          labels: data.categories,
          datasets: prepareBar(data).map((values, s) => ({
            label: data.series[s]!.name,
            data: values,
            backgroundColor: color(s),
          })),
        },
        options: {
          ...common(options),
          interaction: { mode: "index", intersect: false },
          plugins: { tooltip: { enabled: options.tooltip } },
        },
      });
      return handle<CategoryData>(chart, (next) => {
        prepareBar(next).forEach((values, s) => {
          chart.data.datasets[s]!.data = values;
        });
        chart.update("none");
      });
    },
  },
  scatter: {
    prepare: scatterPoints,
    create(container, data, options) {
      // Scatter x values are unsorted, so `parsing: false` / `normalized`
      // (which assume sorted data) must stay off.
      const chart = new Chart(canvasIn(container, options), {
        type: "scatter",
        data: {
          datasets: [
            {
              data: scatterPoints(data),
              pointRadius: 1.5,
              backgroundColor: color(0),
              borderWidth: 0,
            },
          ],
        },
        options: {
          ...common(options),
          interaction: { mode: "nearest", intersect: false },
          plugins: { tooltip: { enabled: options.tooltip } },
        },
      });
      return {
        ...handle<PointData>(chart, (next) => {
          chart.data.datasets[0]!.data = scatterPoints(next);
          chart.update("none");
        }),
        setViewport(x0, x1) {
          const x = chart.options.scales!.x!;
          x.min = x0;
          x.max = x1;
          chart.update("none");
        },
      };
    },
  },
  bubble: {
    prepare: bubblePoints,
    create(container, data, options) {
      const { points, colors } = bubblePoints(data);
      const chart = new Chart(canvasIn(container, options), {
        type: "bubble",
        data: { datasets: [{ data: points, backgroundColor: colors, borderWidth: 0 }] },
        options: {
          ...common(options),
          interaction: { mode: "nearest", intersect: false },
          plugins: { tooltip: { enabled: options.tooltip } },
        },
      });
      return handle<BubbleData>(chart, (next) => {
        const prepared = bubblePoints(next);
        const dataset = chart.data.datasets[0]!;
        dataset.data = prepared.points;
        dataset.backgroundColor = prepared.colors;
        chart.update("none");
      });
    },
  },
  // Chart.js has no built-in heatmap; chartjs-chart-matrix is a third-party plugin.
};
