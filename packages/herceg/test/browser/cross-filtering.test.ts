// The data guide's "Cross-filtering" dashboard on every surface: the
// guide's TypeScript (between the markers below, which the guide prints
// whole), its spec, and what its Python writes (test/fixtures/
// cross-filter.json, which python/tests/test_cross_filter.py checks). Each
// is four charts over one table and one selection store: every panel draws
// a view of the rows the other panels' channels leave, or groups of it,
// and its brush or click sets its own channel. A grid among them selects
// rows that filter the others. Each step is checked against a
// recomputation from the source's rows, the same on every surface, and
// every panel's SVG at each step is the same on every surface.
import "./interactive.ts";
import { afterEach, beforeEach, expect } from "vitest";
import { createGridModel } from "../../src/grid/model.ts";
import {
  bar,
  type Chart,
  type ChartSpec,
  category,
  createChart,
  groupRows,
  type Inspection,
  line,
  lineage,
  rowSelection,
  rowView,
  type SelectionGesture,
  type SelectionStore,
  selectionStore,
  sum,
  type Table,
  table,
  time,
} from "../../src/index.ts";
import { loadSpec } from "../../src/spec/load.ts";
import fixture from "../fixtures/cross-filter.json";
import { contractTest } from "../helpers/contracts.ts";
import { MOUSE } from "./helpers.ts";

const DAY = 86_400_000;
const REGIONS = ["North", "South", "East", "West"];
const LATE = Date.UTC(2025, 0, 19);

let host: HTMLDivElement;
const mounted: Chart[] = [];

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:400px";
  document.body.append(host);
});

afterEach(() => {
  for (const chart of mounted.splice(0)) chart.destroy();
  host.remove();
});

/** A panel's element: four fit the page (charts off it wait to draw). */
function panel(): HTMLDivElement {
  const element = document.createElement("div");
  element.style.cssText = "height:180px";
  host.append(element);
  return element;
}

/**
 * Daily rows per region from December 2024, across a new year, seeded,
 * but West's and North's of January 19, which arrive late.
 */
function salesRows(days: number) {
  let seed = 7;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const rows = { times: [] as number[], regions: [] as string[], months: [] as string[] };
  const revenue: number[] = [];
  const orders: number[] = [];
  for (let d = 0; d < days; d++) {
    const day = Date.UTC(2024, 11, 1) + d * DAY;
    for (const region of REGIONS) {
      if (day === LATE && (region === "West" || region === "North")) continue;
      rows.times.push(day);
      rows.regions.push(region);
      rows.months.push(new Date(day).toISOString().slice(0, 7));
      revenue.push(Math.round(4000 + 3000 * next()));
      orders.push(Math.round(80 + 60 * next()));
    }
  }
  return { ...rows, revenue, orders };
}

/** The guide's `sales`: a row a day and region. */
function salesTable(rows: ReturnType<typeof salesRows>) {
  return table({
    time: time(rows.times),
    region: category(rows.regions),
    month: category(rows.months),
    revenue: rows.revenue,
    orders: rows.orders,
  });
}
type Sales = ReturnType<typeof salesTable>;
type Elements = readonly [HTMLElement, HTMLElement, HTMLElement, HTMLElement];

/** What the checks read of a table a mark draws. */
interface Drawn {
  readonly length: number;
  value(field: string, row: number): unknown;
}

/** A dashboard's store and charts, and the table each chart's mark draws (the revenue lines' rows are `sales`'). */
interface Dashboard {
  filters: SelectionStore<Sales extends Table<infer S> ? S : never>;
  charts: readonly [Chart, Chart, Chart, Chart];
  drawn: readonly [Drawn, Drawn, Drawn, Drawn];
}

/** The guide's TypeScript. */
function declared(sales: Sales, elements: Elements): Dashboard {
  const [revenueElement, ordersElement, regionsElement, monthsElement] = elements;
  // ---- The guide's example ----
  // The filters: a channel for each panel, which filters the others.
  const filters = selectionStore(sales);

  /** The rows a panel shows: those every other panel's channel leaves. */
  const rowsFor = (panel: string) =>
    rowView(sales, { selection: { store: filters, excluding: panel } });

  /** A panel's brushes or clicks set its channel to rows of `sales`, through its groups. */
  const filtering = (channel: string, events: SelectionGesture[]) =>
    rowSelection({ store: filters, channel, events, lineage });

  // Panels that sum draw groups of their rows, which follow the view.
  const byDay = groupRows(rowsFor("orders"), { by: ["time"], ops: { orders: sum("orders") } });
  const byRegion = groupRows(rowsFor("regions"), {
    by: ["region"],
    ops: { revenue: sum("revenue") },
  });
  const byMonth = groupRows(rowsFor("months"), { by: ["month"], ops: { revenue: sum("revenue") } });

  const revenueChart = createChart(revenueElement, {
    marks: [line(rowsFor("revenue"), { x: "time", y: "revenue", color: "region" })],
    interaction: { brush: "x" },
    rowSelection: filtering("revenue", ["brush"]),
  });
  const ordersChart = createChart(ordersElement, {
    marks: [line(byDay.table, { x: "time", y: "orders" })],
    interaction: { brush: "x" },
    rowSelection: filtering("orders", ["brush"]),
  });
  // The axis lists the regions: a bar a filter empties keeps its band.
  const regionsChart = createChart(regionsElement, {
    x: { domain: ["North", "South", "East", "West"] },
    marks: [bar(byRegion.table, { x: "region", y: "revenue", color: "region" })],
    interaction: { select: "items" },
    rowSelection: filtering("regions", ["click"]),
  });
  const monthsChart = createChart(monthsElement, {
    marks: [bar(byMonth.table, { x: "month", y: "revenue" })],
    interaction: { select: "items" },
    rowSelection: filtering("months", ["click"]),
  });
  // ---- End of the guide's example ----
  return {
    filters,
    charts: [revenueChart, ordersChart, regionsChart, monthsChart],
    drawn: [sales, byDay.table, byRegion.table, byMonth.table],
  };
}

/** The panels' specs, loaded over `sales` and one store of it. */
function loaded(
  panels: Record<"revenue" | "orders" | "regions" | "months", unknown>,
  sales: Sales,
  elements: Elements,
): Dashboard {
  const filters = selectionStore(sales);
  const specs = [panels.revenue, panels.orders, panels.regions, panels.months] as ChartSpec[];
  const charts = specs.map((spec, i) => {
    // The table every panel reads is the one its binding names.
    const name = [spec.rowSelection ?? []].flat()[0]!.data!;
    const { config, tables } = loadSpec(spec, [], {
      tables: { [name]: sales },
      stores: { [name]: filters },
    });
    const mark = spec.marks![0]!.data!;
    return { chart: createChart(elements[i]!, config), table: i === 0 ? sales : tables.get(mark)! };
  });
  return {
    filters,
    charts: charts.map(({ chart }) => chart) as unknown as Dashboard["charts"],
    drawn: charts.map(({ table }) => table) as unknown as Dashboard["drawn"],
  };
}

const SURFACES = {
  typescript: declared,
  spec: (sales: Sales, elements: Elements) => loaded(fixture.spec, sales, elements),
  python: (sales: Sales, elements: Elements) => loaded(fixture.python, sales, elements),
};

for (const [surface, make] of Object.entries(SURFACES))
  contractTest(
    `cross-filter.dashboard.${surface}`,
    async () => {
      await dashboard(make);
    },
    "follows each panel's channel through views and groups, and a grid's rows, with no new table",
  );

contractTest(
  "cross-filter.dashboard.same",
  async () => {
    const drawings: Record<string, string[][]> = {};
    for (const [surface, make] of Object.entries(SURFACES)) {
      drawings[surface] = await dashboard(make);
      for (const chart of mounted.splice(0)) chart.destroy();
      host.replaceChildren();
    }
    const steps = drawings.typescript!;
    expect(steps.length).toBeGreaterThan(10);
    for (const surface of ["spec", "python"])
      for (const [step, panels] of drawings[surface]!.entries())
        for (const [i, svg] of panels.entries())
          expect(svg, `${surface}, step ${step}, panel ${i}`).toBe(steps[step]![i]);
  },
  "draws the same panels at every step on every surface: their lines and bars, and what each selection highlights",
);

/** A chart's SVG with its ids numbered in the order they appear: what it draws, whichever ids its instance took. */
function drawing(chart: Chart): string {
  const svg = chart.toSVG();
  const ids = new Map<string, string>();
  for (const [, id] of svg.matchAll(/\bid="([^"]+)"/g))
    if (!ids.has(id!)) ids.set(id!, `id-${ids.size}`);
  if (ids.size === 0) return svg;
  // Wherever an id is named: ids, references, and lists of them (aria-labelledby).
  const escaped = [...ids.keys()].map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const named = new RegExp(`(?<![\\w-])(${escaped.join("|")})(?![\\w-])`, "g");
  return svg.replace(named, (id) => ids.get(id)!);
}

/** Runs the guide's dashboard as `make` writes it; returns what each panel drew at each step checked. */
async function dashboard(make: (sales: Sales, elements: Elements) => Dashboard) {
  const source = salesRows(60);
  const { times, regions, months, revenue, orders } = source;
  const sales = salesTable(source);
  const { filters, charts, drawn: tables } = make(sales, [panel(), panel(), panel(), panel()]);
  const [revenueChart, ordersChart, regionsChart, monthsChart] = charts;
  mounted.push(...charts);
  // A grid among the panels: the rows selected in it filter the others.
  const grid = createGridModel({
    data: rowView(sales, { selection: { store: filters, excluding: "grid" } }),
    columns: [{ field: "time" }, { field: "region" }, { field: "revenue" }],
    selectionStore: filters,
    channel: "grid",
  });
  // The tables the charts' marks read, as each committed selection names them.
  const named = new Map<Chart, unknown[]>(charts.map((chart) => [chart, []]));
  for (const chart of charts)
    chart.on("select", ({ conditions, phase }) => {
      if (phase === "commit") named.get(chart)!.push(...conditions.map((c) => c.table));
    });

  /** Waits until every chart has drawn its latest state. */
  const drawn = () =>
    expect
      .poll(() => charts.every((chart) => chart.drawnRevision === chart.revision), {
        timeout: 4000,
      })
      .toBe(true);
  await Promise.all(charts.map((chart) => chart.loading));
  await drawn();

  /** The filters as plain values, and the source rows each panel should show. */
  interface Filters {
    revenue?: readonly [number, number];
    orders?: readonly [number, number];
    region?: string;
    month?: string;
    grid?: ReadonlySet<number>;
  }
  const rowsOf = (filters: Filters, own: keyof Filters) =>
    times.flatMap((t, i) => {
      const inRange = (range?: readonly [number, number]) =>
        !range || (t >= range[0] && t <= range[1]);
      const kept =
        (own === "revenue" || inRange(filters.revenue)) &&
        (own === "orders" || inRange(filters.orders)) &&
        (own === "region" || !filters.region || regions[i] === filters.region) &&
        (own === "month" || !filters.month || months[i] === filters.month) &&
        (own === "grid" || !filters.grid || filters.grid.has(i));
      return kept ? [i] : [];
    });
  /** Sums of `values` over `rows` by `key`. */
  const sums = (rows: number[], key: (i: number) => string | number, values: number[]) => {
    const out = new Map<string | number, number>();
    for (const i of rows) out.set(key(i), (out.get(key(i)) ?? 0) + values[i]!);
    return out;
  };

  type Point = Inspection["points"][number];
  /**
   * What a line chart draws at each x: every column of its plot inspected.
   * The points read go to `points`.
   */
  const lineReadings = (chart: Chart, points: Point[] = []) => {
    const { plot } = chart.getPanels()[0]!;
    const out = new Map<number, Map<string, number>>();
    for (let px = plot.x; px <= plot.x + plot.width; px += 0.5) {
      const reading = chart.inspect(px, plot.y + plot.height / 2, { mode: "nearest-x" });
      if (reading?.axis !== "x") continue;
      points.push(...reading.points);
      out.set(reading.value, new Map(reading.points.map((p) => [p.label, p.value])));
    }
    return out;
  };
  /** What a bar chart draws: its bands, in order, and the value of each that has a bar. */
  const barReadings = (chart: Chart, points: Point[] = []) => {
    const { x, plot } = chart.getPanels()[0]!;
    return (x?.categories ?? []).map((label, band) => {
      const px = chart.toPixel(band, { axis: "x" })!;
      const reading = chart.inspect(px, plot.y + plot.height - 2, { mode: "nearest-x" });
      if (reading?.label !== label) return [label, null] as const;
      points.push(...reading.points);
      return [label, reading.points.map((p) => p.value)] as const;
    });
  };
  /** Each point drawn is a row of the table its mark was given, which `read` reads. */
  const expectRowsOf = (points: Point[], read: (row: number) => unknown, what: string) => {
    expect(points.length, `${what}: points read`).toBeGreaterThan(0);
    for (const { row, value } of points)
      expect(row === undefined ? undefined : read(row), `${what}: row ${row}`).toBe(value);
  };
  /** The bars `totals` give, on bands in the order `bands` lists them. */
  const barsOf = (bands: readonly string[], totals: Map<string | number, number>) =>
    bands.map((label) => [label, totals.has(label) ? [totals.get(label)] : null]);

  /** What each panel drew at each step checked. */
  const drawings: string[][] = [];
  /**
   * Every panel draws what the source's rows give through the other
   * panels' filters. The months' bars have a band each while their group
   * has rows, in order of time: groups that come back take their place.
   */
  const expectPanels = (filters: Filters, what: string) => {
    drawings.push(charts.map(drawing));
    const points: Point[][] = [[], [], [], []];
    const revenueRows = rowsOf(filters, "revenue");
    const byTime = new Map<number, Map<string, number>>();
    for (const i of revenueRows)
      byTime.set(times[i]!, (byTime.get(times[i]!) ?? new Map()).set(regions[i]!, revenue[i]!));
    expect(lineReadings(revenueChart, points[0]), `${what}: revenue`).toEqual(byTime);

    const orderSums = sums(rowsOf(filters, "orders"), (i) => times[i]!, orders);
    expect(lineReadings(ordersChart, points[1]), `${what}: orders`).toEqual(
      new Map([...orderSums].map(([t, total]) => [t, new Map([["orders", total]])])),
    );

    const regionSums = sums(rowsOf(filters, "region"), (i) => regions[i]!, revenue);
    expect(barReadings(regionsChart, points[2]), `${what}: regions`).toEqual(
      barsOf(REGIONS, regionSums),
    );

    const monthSums = sums(rowsOf(filters, "month"), (i) => months[i]!, revenue);
    const monthBands = [...monthSums.keys()].map(String).sort();
    expect(barReadings(monthsChart, points[3]), `${what}: months`).toEqual(
      barsOf(monthBands, monthSums),
    );
    expectRowsOf(points[0]!, (row) => sales.value("revenue", row), `${what}: revenue's rows`);
    expectRowsOf(points[1]!, (row) => tables[1].value("orders", row), `${what}: orders' rows`);
    expectRowsOf(points[2]!, (row) => tables[2].value("revenue", row), `${what}: regions'`);
    expectRowsOf(points[3]!, (row) => tables[3].value("revenue", row), `${what}: months'`);
    return monthBands;
  };

  /** Pointer events at a chart's pixel. */
  const send = (chart: Chart, type: string, x: number, y: number) => {
    const rect = chart.root.getBoundingClientRect();
    const init = { bubbles: true, clientX: rect.left + x, clientY: rect.top + y, pointerId: MOUSE };
    chart.root.dispatchEvent(
      new PointerEvent(type, { ...init, button: 0, buttons: type === "pointerup" ? 0 : 1 }),
    );
    if (type === "pointerup") chart.root.dispatchEvent(new MouseEvent("click", init));
  };
  const brush = (chart: Chart, from: number, to: number) => {
    const { plot } = chart.getPanels()[0]!;
    const y = plot.y + plot.height / 2;
    send(chart, "pointerdown", chart.toPixel(from, { axis: "x" })!, y);
    send(chart, "pointermove", chart.toPixel((from + to) / 2, { axis: "x" })!, y);
    send(chart, "pointerup", chart.toPixel(to, { axis: "x" })!, y);
    const { selection } = chart;
    return selection?.kind === "brush" && selection.x ? selection.x : ([0, 0] as const);
  };
  /** A click on a chart's plot, off its brush: it clears. */
  const clickOff = (chart: Chart, at: number) => {
    const { plot } = chart.getPanels()[0]!;
    send(chart, "pointerdown", chart.toPixel(at, { axis: "x" })!, plot.y + plot.height / 2);
    send(chart, "pointerup", chart.toPixel(at, { axis: "x" })!, plot.y + plot.height / 2);
  };
  const clickBar = (chart: Chart, label: string) => {
    const { x, plot } = chart.getPanels()[0]!;
    const band = x!.categories!.indexOf(label);
    send(chart, "pointerdown", chart.toPixel(band, { axis: "x" })!, plot.y + plot.height - 2);
    send(chart, "pointerup", chart.toPixel(band, { axis: "x" })!, plot.y + plot.height - 2);
  };
  /** Rows appended to `sales` and to the arrays the checks read. */
  const append = (rows: {
    time: number[];
    region: string[];
    revenue: number[];
    orders: number[];
  }) => {
    const month = rows.time.map((t) => new Date(t).toISOString().slice(0, 7));
    sales.append({ ...rows, month });
    times.push(...rows.time);
    regions.push(...rows.region);
    months.push(...month);
    revenue.push(...rows.revenue);
    orders.push(...rows.orders);
  };

  expect(expectPanels({}, "mount")).toEqual(["2024-12", "2025-01"]);

  // A brush on orders within January, along its groups' axis: the channel
  // holds the condition on the rows' times, and the others show those
  // days. December's group empties, and its bar leaves.
  const from = Date.UTC(2025, 0, 5);
  const to = Date.UTC(2025, 0, 20);
  const brushed = brush(ordersChart, from, to);
  expect(filters.get("orders")?.kind).toBe("predicate");
  await drawn();
  expect(expectPanels({ orders: brushed }, "orders brushed")).toEqual(["2025-01"]);
  expect(tables[3].length).toBe(1);

  // West's bar: its channel holds the condition of West's rows, and every
  // other panel shows them. The bars keep their bands.
  clickBar(regionsChart, "West");
  const westRows = filters.get("regions");
  const west = ["==", ["field", "region"], "West"];
  // The bar's item condition, of its x and its color, both the region.
  expect(westRows?.kind === "predicate" && westRows.expression).toEqual(["and", west, west]);
  await drawn();
  expectPanels({ orders: brushed, region: "West" }, "West selected");

  // Rows streamed in follow the channels: the late rows of a day in the
  // range, West's and North's, and a day a month later, outside it. The
  // late day had no West row: its group comes back in its place.
  append({
    time: [LATE, LATE, Date.UTC(2025, 1, 19)],
    region: ["West", "North", "West"],
    revenue: [9000, 9100, 9200],
    orders: [200, 210, 220],
  });
  await drawn();
  expectPanels({ orders: brushed, region: "West" }, "rows appended");

  // Cleared: West clicked again, then the brush cleared by a click off it.
  // Every panel draws all rows again; December's group came back in its
  // place, before January's, and February's new group follows them.
  clickBar(regionsChart, "West");
  expect(filters.get("regions")).toBeNull();
  clickOff(ordersChart, Date.UTC(2024, 11, 10));
  expect(filters.get("orders")).toBeNull();
  await drawn();
  expect(expectPanels({}, "cleared")).toEqual(["2024-12", "2025-01", "2025-02"]);
  expect(monthsChart.getPanels()[0]!.x!.categories).toEqual(["2024-12", "2025-01", "2025-02"]);
  // The orders line runs in order of time: the days a brush emptied came
  // back in their places.
  const drawnPath = /<path[^>]*\bd="(M[^"]{200,})"/.exec(ordersChart.toSVG())![1]!;
  const xs = [...drawnPath.matchAll(/[ML]\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  expect(xs).toHaveLength(new Set(times).size);
  expect(xs).toEqual([...xs].sort((a, b) => a - b));

  // A month's bar filters the others to its days; again, back to all.
  clickBar(monthsChart, "2024-12");
  expect(filters.get("months")?.kind).toBe("predicate");
  await drawn();
  expectPanels({ month: "2024-12" }, "December selected");
  clickBar(monthsChart, "2024-12");
  expect(filters.get("months")).toBeNull();
  await drawn();
  expectPanels({}, "December cleared");

  // A brush on revenue filters the others to its days; February's group
  // empties, then comes back in its place when a click clears the brush.
  const revenueRange = brush(revenueChart, Date.UTC(2024, 11, 20), Date.UTC(2025, 0, 10));
  expect(filters.get("revenue")?.kind).toBe("predicate");
  await drawn();
  expect(expectPanels({ revenue: revenueRange }, "revenue brushed")).toEqual([
    "2024-12",
    "2025-01",
  ]);
  clickOff(revenueChart, Date.UTC(2024, 11, 5));
  expect(filters.get("revenue")).toBeNull();
  await drawn();
  expectPanels({}, "revenue cleared");

  // Two more months streamed in, then a brush on March's days empties
  // every other month's group; cleared, each comes back in its place.
  const march = [Date.UTC(2025, 2, 3), Date.UTC(2025, 2, 4)];
  append({
    time: [Date.UTC(2025, 1, 26), ...march],
    region: ["East", "East", "South"],
    revenue: [9300, 9400, 9500],
    orders: [230, 240, 250],
  });
  await drawn();
  const streamed = ["2024-12", "2025-01", "2025-02", "2025-03"];
  expect(expectPanels({}, "months streamed")).toEqual(streamed);
  const inMarch = brush(ordersChart, march[0]! - DAY / 2, march[1]! + DAY / 2);
  await drawn();
  expect(expectPanels({ orders: inMarch }, "March brushed")).toEqual(["2025-03"]);
  expect(tables[3].length).toBe(1);
  clickOff(ordersChart, Date.UTC(2024, 11, 10));
  expect(filters.get("orders")).toBeNull();
  await drawn();
  expect(expectPanels({}, "March cleared")).toEqual(streamed);

  // The grid's rows: the first ten days, every region. Its channel holds
  // them as a row set, which the other panels' views meet with West's
  // condition; the grid's own view is filtered by West only.
  grid.select(0);
  grid.select(39, "range");
  const firstDays = new Set(Array.from({ length: 40 }, (_, i) => i));
  expect(new Set([...firstDays].map((i) => times[i]!)).size).toBe(10);
  expect(filters.get("grid")?.kind).toBe("rows");
  await drawn();
  expectPanels({ grid: firstDays }, "grid rows selected");
  clickBar(regionsChart, "West");
  await drawn();
  expectPanels({ grid: firstDays, region: "West" }, "grid rows and West");
  expect(grid.data.length).toBe(rowsOf({ region: "West" }, "grid").length);
  // Rows appended are not among the grid's: the other panels leave them out.
  append({
    time: [Date.UTC(2025, 2, 5)],
    region: ["West"],
    revenue: [9600],
    orders: [260],
  });
  await drawn();
  expectPanels({ grid: firstDays, region: "West" }, "grid rows, appended");
  clickBar(regionsChart, "West");
  grid.clearSelection();
  expect(filters.get("grid")).toBeNull();
  await drawn();
  expectPanels({}, "grid cleared");

  // Every selection, after filters and clears, named the table its chart's
  // mark was given: no chart was given another.
  for (const [i, chart] of charts.entries()) {
    const tablesNamed = named.get(chart)!;
    expect(tablesNamed.length).toBeGreaterThan(0);
    for (const named of tablesNamed) expect(named).toBe(tables[i]);
  }
  grid.dispose();
  return drawings;
}
