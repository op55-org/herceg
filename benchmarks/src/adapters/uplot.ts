import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { SeriesData } from "../datasets.ts";
import type { Adapter, ChartHandle, ChartOptions, Drawn } from "../page/adapter.ts";
import { clientPoint, color, rollArray } from "../page/adapter.ts";

// uPlot reads typed arrays directly: [x, ...ys].
function columns(data: SeriesData): uPlot.AlignedData {
  return [data.x, ...data.ys] as unknown as uPlot.AlignedData;
}

/**
 * What a uPlot chart drew, read at its `draw` hook (after each redraw):
 * the size, the scales, and series 0's data; the plot's place and the live
 * legend's text for series 0 from the elements before the frame paints,
 * with the cursor's index.
 */
function observer() {
  let draws = 0;
  let last: Omit<Drawn, "draws" | "plot" | "readout"> = { width: 0, height: 0 };
  let plot: uPlot | undefined;
  const hooks: uPlot.Hooks.Arrays = {
    draw: [
      (u) => {
        draws++;
        plot = u;
        const x = u.data[0] as unknown as ArrayLike<number>;
        const y = u.data[1] as unknown as ArrayLike<number>;
        const n = x.length;
        last = {
          width: u.width,
          height: u.height,
          x: [u.scales.x!.min!, u.scales.x!.max!],
          y: [u.scales.y!.min!, u.scales.y!.max!],
          series: { count: n, firstX: x[0]!, lastX: x[n - 1]!, first: y[0]!, last: y[n - 1]! },
        };
      },
    ],
  };
  const drawn = (): Drawn => {
    if (!plot) return { ...last, draws };
    const box = plot.over.getBoundingClientRect();
    const value = plot.root.querySelectorAll(".u-legend .u-series")[1]?.querySelector(".u-value");
    const index = plot.cursor.idx;
    return {
      ...last,
      draws,
      plot: { left: box.left, top: box.top, width: box.width, height: box.height },
      ...(value?.textContent &&
        index !== null &&
        index !== undefined && {
          readout: { text: value.textContent, value: value.textContent, index },
        }),
    };
  };
  return { hooks, drawn };
}

function lineKind(fill: boolean) {
  return {
    prepare: columns,
    create(
      container: HTMLElement,
      data: SeriesData,
      options: ChartOptions,
    ): ChartHandle<SeriesData> {
      const observed = observer();
      const plot = new uPlot(
        {
          hooks: observed.hooks,
          width: options.width,
          height: options.height,
          // Timestamps are milliseconds.
          ms: 1,
          // uPlot has no tooltip; its cursor and live legend are the hover readout.
          cursor: { show: options.tooltip },
          legend: { show: options.tooltip },
          scales: { x: { time: true } },
          series: [
            {},
            ...data.ys.map((_, s) => ({
              label: data.names[s],
              stroke: color(s),
              width: 1.5,
              fill: fill ? `${color(s)}40` : undefined,
            })),
          ],
        },
        columns(data),
        container,
      );
      // Rolling windows use plain arrays shifted in place, as in uPlot's streaming demos.
      let rolling: number[][] | null = null;
      let current = data;
      return {
        setData(next) {
          rolling = null;
          current = next;
          plot.setData(columns(next));
        },
        append(x, ys, keep) {
          rolling ??= [Array.from(current.x), ...current.ys.map((y) => Array.from(y))];
          rollArray(rolling[0]!, x, keep);
          ys.forEach((y, s) => {
            rollArray(rolling![s + 1]!, y, keep);
          });
          plot.setData(rolling as uPlot.AlignedData);
        },
        setViewport: (x0, x1) => plot.setScale("x", { min: x0, max: x1 }),
        pixelOf: (_series, _index, x, y) =>
          clientPoint(plot.over, plot.valToPos(x, "x"), plot.valToPos(y, "y")),
        resize: (width, height) => plot.setSize({ width, height }),
        drawn: observed.drawn,
        destroy: () => plot.destroy(),
      };
    },
  };
}

export const adapter: Adapter = {
  id: "uplot",
  verification:
    "the draw hook (after each redraw): size, scales, series 0's data; the plot element's place and the live legend's text for series 0 before paint, with the cursor's index",
  renderer: { normal: "canvas", large: "canvas" },
  line: lineKind(false),
  area: lineKind(true),
  // Grouped bars, scatter, and heatmaps need uPlot plugins or custom path builders.
};
