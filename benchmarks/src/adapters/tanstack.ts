import { areaY, barY, cell, defineChart, dot, group, lineY, mountChart } from "@tanstack/charts";
import { mountCanvasChart } from "@tanstack/charts/canvas";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { tooltip } from "@tanstack/charts/tooltip";
import { interpolateRgb } from "d3-interpolate";
import { scaleSequential, scaleUtc } from "d3-scale";
import type { CategoryData, GridData, PointData, SeriesData } from "../datasets.ts";
import type { Adapter, ChartHandle, ChartOptions, Drawn, SeriesShown } from "../page/adapter.ts";
import { clientPoint, color, PALETTE, readoutText, rollArray } from "../page/adapter.ts";

// TanStack marks consume row objects; one row per point. Its temporal scales
// require Date values.
type Point = { t: Date; v: number };

function seriesRows(data: SeriesData): Point[][] {
  return data.ys.map((y) => {
    const rows: Point[] = new Array(y.length);
    for (let i = 0; i < y.length; i++) rows[i] = { t: new Date(data.x[i]!), v: y[i]! };
    return rows;
  });
}

// The definition object is TanStack's update boundary, so its exact generic
// type is not useful to the benchmark.
type Definition = Parameters<typeof mountChart>[1]["definition"];

function mount(container: HTMLElement, definition: Definition, options: ChartOptions) {
  /** The mark of the point TanStack focuses (its tooltip's point), where one is. */
  let focusedMark: string | undefined;
  const hostOptions = {
    definition,
    width: options.width,
    height: options.height,
    ariaLabel: "Benchmark chart",
    onFocusChange: (point: { markId: string } | null) => {
      focusedMark = point?.markId;
    },
  };
  // Canvas is TanStack's opt-in renderer for dense data.
  const host = options.large
    ? mountCanvasChart(container, hostOptions)
    : mountChart(container, hostOptions);
  return {
    update(next: Definition) {
      hostOptions.definition = next;
      host.update(hostOptions);
    },
    resize(width: number, height: number) {
      hostOptions.width = width;
      hostOptions.height = height;
      host.update(hostOptions);
    },
    scene: () => host.getScene(),
    focusedMark: () => focusedMark,
    /** Scene coordinates of the point with `index` in the mark's data, per mark in order. */
    point(series: number, index: number) {
      const candidates = host.getScene().points.filter((point) => point.datumIndex === index);
      return candidates[series] ?? candidates[0];
    },
    destroy: () => host.destroy(),
  };
}

type Scene = ReturnType<ReturnType<typeof mount>["scene"]>;

/**
 * How a scene point stands for an item in `SeriesShown`: by its x and y
 * values, by its category's place and y, or (heatmap cells) by its row's
 * place and the cell's value.
 */
type ItemX = "value" | "category" | "cell";

/** A scale's domain end as a number: dates as epoch ms, band categories by their index. */
function domainOf(
  scale: Scene["scales"][string] | undefined,
): readonly [number, number] | undefined {
  if (!scale || scale.domain.length === 0) return undefined;
  if (scale.type === "band") return [0, scale.domain.length - 1];
  const end = (value: unknown) => (value instanceof Date ? value.getTime() : Number(value));
  return [end(scale.domain[0]), end(scale.domain[scale.domain.length - 1])];
}

/**
 * Series 0 in a scene: how many points it drew, and its first and last, by
 * x (or index) and y. A scene lists each mark's points together, so the
 * first mark's end is found by halving; bars of several series share one
 * mark, told apart by their group, and are counted.
 */
function seriesInScene(scene: Scene, by: ItemX): SeriesShown | undefined {
  const points = scene.points;
  const first = points[0];
  if (!first) return undefined;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (points[mid]!.markId === first.markId) lo = mid;
    else hi = mid - 1;
  }
  let end = lo;
  while (end > 0 && points[end]!.group !== first.group) end--;
  const last = points[end]!;
  let count = lo + 1;
  if (by === "category") {
    count = 0;
    for (let i = 0; i <= lo; i++) if (points[i]!.group === first.group) count++;
  }
  const categories = scene.scales.x?.domain ?? [];
  const value = (point: typeof first) =>
    by === "cell" ? (point.datum as CellRow).value : Number(point.yValue);
  const x = (point: typeof first) =>
    by === "cell"
      ? point.datumIndex
      : by === "category"
        ? categories.indexOf(point.xValue)
        : point.xValue instanceof Date
          ? point.xValue.getTime()
          : Number(point.xValue);
  return {
    count,
    firstX: x(first),
    lastX: x(last),
    first: value(first),
    last: value(last),
  };
}

/**
 * What a TanStack chart drew: its scene (the renderer's output, new on each
 * render), read before the frame paints, a new scene counting as a draw:
 * size, plot bounds, scale domains, and the first mark's points; the
 * tooltip's text from its element. TanStack gives no index for the point
 * its tooltip reads.
 */
function observe(container: HTMLElement, host: ReturnType<typeof mount>, by: ItemX): () => Drawn {
  let draws = 0;
  let seen: Scene | undefined;
  let last: Omit<Drawn, "draws" | "readout"> = { width: 0, height: 0 };
  return () => {
    const scene = host.scene();
    if (scene !== seen) {
      seen = scene;
      draws++;
      const x = domainOf(scene.scales.x);
      const y = domainOf(scene.scales.y);
      const series = seriesInScene(scene, by);
      last = {
        width: scene.width,
        height: scene.height,
        plot: {
          left: scene.chart.x,
          top: scene.chart.y,
          width: scene.chart.width,
          height: scene.chart.height,
        },
        ...(x && { x }),
        ...(y && { y }),
        ...(series && { series }),
      };
    }
    const box = container.getBoundingClientRect();
    const tooltip = container.querySelector<HTMLElement>(".ts-chart-tooltip");
    const visible =
      tooltip &&
      !tooltip.hidden &&
      tooltip.style.display !== "none" &&
      tooltip.style.opacity !== "0";
    return {
      ...last,
      draws,
      ...(last.plot && {
        plot: { ...last.plot, left: box.left + last.plot.left, top: box.top + last.plot.top },
      }),
      ...(visible &&
        readoutText(tooltip) && {
          readout: {
            text: readoutText(tooltip),
            ...valueOfSeriesZero(tooltip, host.focusedMark() === scene.points[0]?.markId),
          },
        }),
    };
  };
}

const SERIES_ZERO = `rgb(${[1, 3, 5].map((i) => Number.parseInt(PALETTE[0]!.slice(i, i + 2), 16)).join(", ")})`;

/**
 * Series 0's value in a TanStack tooltip, whose rows name no series (the
 * marks have no names to give): in a tooltip of several points, the row
 * whose swatch is in series 0's color; in one of a single point (rows x
 * and y), its y, where the point focused is series 0's (`zeroFocused`).
 */
function valueOfSeriesZero(tooltip: HTMLElement, zeroFocused: boolean): { value?: string } {
  const rows = [...tooltip.querySelectorAll<HTMLElement>(".ts-chart-tooltip__row")];
  for (const row of rows) {
    const swatch = row.querySelector<HTMLElement>(".ts-chart-tooltip__swatch");
    const value = row.lastElementChild?.textContent;
    if (swatch?.style.backgroundColor === SERIES_ZERO && value) return { value };
  }
  const single =
    rows.length === 2 && !rows.some((row) => row.querySelector(".ts-chart-tooltip__swatch"));
  const value = rows[1]?.lastElementChild?.textContent;
  return single && zeroFocused && value ? { value } : {};
}

function handle<T>(
  container: HTMLElement,
  host: ReturnType<typeof mount>,
  build: (data: T) => Definition,
  by: ItemX = "value",
): ChartHandle<T> {
  return {
    drawn: observe(container, host, by),
    setData: (data) => host.update(build(data)),
    pixelOf(series, index) {
      const point = host.point(series, index);
      const surface = container.querySelector("svg, canvas") ?? container;
      return clientPoint(surface, point?.x ?? 0, point?.y ?? 0);
    },
    resize: host.resize,
    destroy: host.destroy,
  };
}

/**
 * The rows a window shows, plus one on each side so lines reach the edges.
 * TanStack's zoom guide leaves visible-row filtering to the application.
 */
function visibleRows(series: Point[], x0: number, x1: number): Point[] {
  const firstAtOrAfter = (value: number) => {
    let lo = 0;
    let hi = series.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (series[mid]!.t.getTime() < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return series.slice(Math.max(0, firstAtOrAfter(x0) - 1), firstAtOrAfter(x1) + 1);
}

function lineDefinition(
  rows: Point[][],
  options: ChartOptions,
  fill: boolean,
  window?: [number, number],
): Definition {
  const shown = window ? rows.map((series) => visibleRows(series, ...window)) : rows;
  return defineChart({
    marks: shown.map((series, s) =>
      fill
        ? areaY(series, { x: "t", y2: "v", y1: 0, fill: color(s), fillOpacity: 0.25 })
        : lineY(series, { x: "t", y: "v", stroke: color(s), strokeWidth: 1.5 }),
    ),
    scales: {
      // A zoomed chart's x scale is bound to the window, as in TanStack's zoom guide.
      x: { scale: window ? scaleUtc().domain(window.map((t) => new Date(t))) : scaleUtc },
      y: { scale: scaleLinear, nice: true },
    },
    focus: options.tooltip ? "group-x" : false,
    pointer: options.tooltip,
    ...(options.tooltip ? { tooltip } : {}),
  }) as Definition;
}

function lineKind(fill: boolean) {
  return {
    prepare: seriesRows,
    create(
      container: HTMLElement,
      data: SeriesData,
      options: ChartOptions,
    ): ChartHandle<SeriesData> {
      let rows = seriesRows(data);
      const host = mount(container, lineDefinition(rows, options, fill), options);
      return {
        ...handle<SeriesData>(container, host, (next) => {
          rows = seriesRows(next);
          return lineDefinition(rows, options, fill);
        }),
        // A new definition per update is TanStack's documented update path.
        append(x, ys, keep) {
          ys.forEach((y, s) => {
            const added: Point[] = new Array(x.length);
            for (let i = 0; i < x.length; i++) added[i] = { t: new Date(x[i]!), v: y[i]! };
            rollArray(rows[s]!, added, keep);
          });
          host.update(lineDefinition(rows, options, fill));
        },
        setViewport: (x0, x1) => host.update(lineDefinition(rows, options, fill, [x0, x1])),
      };
    },
  };
}

type BarRow = { category: string; series: string; value: number };

function barRows(data: CategoryData): BarRow[] {
  const rows: BarRow[] = [];
  data.categories.forEach((category, i) => {
    for (const series of data.series)
      rows.push({ category, series: series.name, value: series.values[i]! });
  });
  return rows;
}

function barDefinition(rows: BarRow[], data: CategoryData, options: ChartOptions): Definition {
  return defineChart({
    marks: [barY(rows, { x: "category", y: "value", color: "series", layout: group() })],
    scales: {
      x: { scale: () => scaleBand<string>().padding(0.2) },
      y: { scale: scaleLinear, nice: true },
    },
    color: {
      scale: () =>
        scaleOrdinal<string, string>()
          .domain(data.series.map((s) => s.name))
          .range(PALETTE),
    },
    focus: options.tooltip ? "group-x" : false,
    pointer: options.tooltip,
    ...(options.tooltip ? { tooltip } : {}),
  }) as Definition;
}

type XYRow = { x: number; y: number };

function scatterRows(data: PointData): XYRow[] {
  const rows: XYRow[] = new Array(data.x.length);
  for (let i = 0; i < data.x.length; i++) rows[i] = { x: data.x[i]!, y: data.y[i]! };
  return rows;
}

function scatterDefinition(
  rows: XYRow[],
  options: ChartOptions,
  window?: [number, number],
): Definition {
  // As for lines, a zoomed window filters rows and binds the x scale.
  const shown = window ? rows.filter((row) => row.x >= window[0] && row.x <= window[1]) : rows;
  return defineChart({
    marks: [dot(shown, { x: "x", y: "y", r: 1.5, fill: color(0) })],
    scales: {
      x: window ? { scale: scaleLinear().domain(window) } : { scale: scaleLinear, nice: true },
      y: { scale: scaleLinear, nice: true },
    },
    focus: options.tooltip ? "nearest" : false,
    pointer: options.tooltip,
    ...(options.tooltip ? { tooltip } : {}),
  }) as Definition;
}

type CellRow = { column: number; row: number; value: number };

function cellRows(data: GridData): CellRow[] {
  const rows: CellRow[] = new Array(data.values.length);
  for (let r = 0; r < data.rows; r++) {
    for (let c = 0; c < data.columns; c++) {
      const i = r * data.columns + c;
      rows[i] = { column: c, row: r, value: data.values[i]! };
    }
  }
  return rows;
}

function heatmapDefinition(rows: CellRow[], data: GridData, options: ChartOptions): Definition {
  return defineChart({
    marks: [cell(rows, { x: "column", y: "row", color: "value" })],
    scales: {
      x: {
        scale: () => scaleBand<number>().domain(Array.from({ length: data.columns }, (_, i) => i)),
      },
      y: {
        scale: () => scaleBand<number>().domain(Array.from({ length: data.rows }, (_, i) => i)),
      },
    },
    color: { scale: () => scaleSequential(interpolateRgb("#f7fbff", "#08306b")) },
    focus: options.tooltip ? "nearest" : false,
    pointer: options.tooltip,
    ...(options.tooltip ? { tooltip } : {}),
  }) as Definition;
}

export const adapter: Adapter = {
  id: "tanstack",
  verification:
    "the host's scene (the renderer's output, new on each render) read before paint, a new scene counting as a draw: size, plot bounds, scale domains, the first mark's points and their count; the tooltip element's text (TanStack names no point index)",
  renderer: { normal: "svg", large: "canvas (mountCanvasChart)" },
  line: lineKind(false),
  area: lineKind(true),
  bar: {
    prepare: barRows,
    create(container, data, options) {
      const host = mount(container, barDefinition(barRows(data), data, options), options);
      return handle<CategoryData>(
        container,
        host,
        (next) => barDefinition(barRows(next), next, options),
        "category",
      );
    },
  },
  scatter: {
    prepare: scatterRows,
    create(container, data, options) {
      let rows = scatterRows(data);
      const host = mount(container, scatterDefinition(rows, options), options);
      return {
        ...handle<PointData>(container, host, (next) => {
          rows = scatterRows(next);
          return scatterDefinition(rows, options);
        }),
        setViewport: (x0, x1) => host.update(scatterDefinition(rows, options, [x0, x1])),
      };
    },
  },
  heatmap: {
    prepare: cellRows,
    create(container, data, options) {
      const host = mount(container, heatmapDefinition(cellRows(data), data, options), options);
      return handle<GridData>(
        container,
        host,
        (next) => heatmapDefinition(cellRows(next), next, options),
        "cell",
      );
    },
  },
};
