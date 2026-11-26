// The data guide's "Cross-filtering" example, as the guide prints it (only
// its imports differ): four charts over one table, each drawing a view of
// the rows every other panel's filter leaves, the panels that sum drawing
// groups of their view. Each filter step is checked against a recomputation
// from the source; the tables the marks draw stay the same objects, and the
// bars keep their listed bands as groups leave and come back.
import "./interactive.ts";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  bar,
  type Chart,
  category,
  col,
  createChart,
  groupRows,
  type Inspection,
  line,
  rowView,
  selectionStore,
  selectWhere,
  sum,
  table,
  time,
} from "../../src/index.ts";
import { MOUSE } from "./helpers.ts";

const DAY = 86_400_000;
const REGIONS = ["North", "South", "East", "West"];

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

/** Daily rows per region from December 2024, across a new year, seeded. */
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
      rows.times.push(day);
      rows.regions.push(region);
      rows.months.push(new Date(day).toISOString().slice(0, 7));
      revenue.push(Math.round(4000 + 3000 * next()));
      orders.push(Math.round(80 + 60 * next()));
    }
  }
  return { ...rows, revenue, orders };
}

it("follows each filter through views and groups, with no new table", async () => {
  const { times, regions, months, revenue, orders } = salesRows(60);
  const [revenueElement, ordersElement, regionsElement, monthsElement] = [
    panel(),
    panel(),
    panel(),
    panel(),
  ] as const;

  // The guide's `sales`: a row a day and region.
  const sales = table({
    time: time(times),
    region: category(regions),
    month: category(months),
    revenue,
    orders,
  });

  // ---- The guide's example ----
  // The filters: a channel for each panel that filters the others.
  const filters = selectionStore(sales);
  const channels = ["revenue", "orders", "regions", "months"];

  /** The rows a panel shows: those every filter but its own leaves. */
  function rowsFor(panel: string) {
    const others = channels.filter((channel) => channel !== panel);
    const view = rowView(sales, { filter: filters.condition(others) });
    filters.subscribe(({ channel }) => {
      if (channel !== panel) view.setQuery({ ...view.query, filter: filters.condition(others) });
    });
    return view;
  }

  // Panels that sum draw groups of their rows, which follow the view.
  const byDay = groupRows(rowsFor("orders"), { by: ["time"], ops: { orders: sum("orders") } });
  const byRegion = groupRows(rowsFor("regions"), {
    by: ["region"],
    ops: { revenue: sum("revenue") },
  });
  const byMonth = groupRows(rowsFor("months"), { by: ["month"], ops: { revenue: sum("revenue") } });

  const revenueChart = createChart(revenueElement, {
    marks: [line(rowsFor("revenue"), { x: "time", y: "revenue", series: "region" })],
    interaction: { brush: "x" },
  });
  const ordersChart = createChart(ordersElement, {
    // Days a filter empties come back after the others: drawn sorted by time.
    marks: [line(rowView(byDay.table, { sort: [{ field: "time" }] }), { x: "time", y: "orders" })],
    interaction: { brush: "x" },
  });
  // Bars keep their places as their groups leave and come back: the axes list them.
  const regionsChart = createChart(regionsElement, {
    x: { domain: ["North", "South", "East", "West"] },
    marks: [bar(byRegion.table, { x: "region", y: "revenue", color: "region" })],
    interaction: { select: "items" },
  });
  const monthsChart = createChart(monthsElement, {
    x: { domain: [...sales.categories("month").dictionary] }, // in order of time, as the rows came
    marks: [bar(byMonth.table, { x: "month", y: "revenue" })],
    interaction: { select: "items" },
  });

  // A brush filters the others to its range; a selected bar to its region or month.
  for (const [chart, channel] of [
    [revenueChart, "revenue"],
    [ordersChart, "orders"],
  ] as const)
    chart.on("select", ({ selection, phase }) => {
      if (phase !== "commit") return;
      const x = selection?.kind === "brush" ? selection.x : undefined;
      filters.set(channel, x ? selectWhere(col("time").ge(x[0]).and(col("time").le(x[1]))) : null);
    });
  for (const [chart, channel] of [
    [regionsChart, "regions"],
    [monthsChart, "months"],
  ] as const)
    chart.on("select", ({ conditions, phase }) => {
      if (phase !== "commit") return;
      filters.set(channel, conditions[0] ? selectWhere(conditions[0].condition) : null);
    });
  // ---- End of the guide's example ----

  const charts = [revenueChart, ordersChart, regionsChart, monthsChart];
  mounted.push(...charts);
  const tables = [byDay.table, byRegion.table, byMonth.table];
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
  }
  const rowsOf = (filters: Filters, own: keyof Filters) =>
    times.flatMap((t, i) => {
      const inRange = (range?: readonly [number, number]) =>
        !range || (t >= range[0] && t <= range[1]);
      const kept =
        (own === "revenue" || inRange(filters.revenue)) &&
        (own === "orders" || inRange(filters.orders)) &&
        (own === "region" || !filters.region || regions[i] === filters.region) &&
        (own === "month" || !filters.month || months[i] === filters.month);
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

  /** Every panel draws what the source's rows give through the other panels' filters. */
  const expectPanels = (filters: Filters, what: string, monthBands: readonly string[]) => {
    // Each chart's points are rows of the table the example gave its mark
    // (the orders line's, through its sorted view, are rows of byDay's).
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
    expect(barReadings(monthsChart, points[3]), `${what}: months`).toEqual(
      barsOf(monthBands, monthSums),
    );
    // The groups' tables are the objects the marks were given, and they draw from them.
    for (const [i, current] of [byDay.table, byRegion.table, byMonth.table].entries())
      expect(current, `${what}: table ${i}`).toBe(tables[i]);
    expectRowsOf(points[0]!, (row) => sales.value("revenue", row), `${what}: revenue's rows`);
    expectRowsOf(points[1]!, (row) => byDay.table.value("orders", row), `${what}: orders' rows`);
    expectRowsOf(points[2]!, (row) => byRegion.table.value("revenue", row), `${what}: regions'`);
    expectRowsOf(points[3]!, (row) => byMonth.table.value("revenue", row), `${what}: months'`);
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
  };
  const clickBar = (chart: Chart, label: string) => {
    const { x, plot } = chart.getPanels()[0]!;
    const band = x!.categories!.indexOf(label);
    send(chart, "pointerdown", chart.toPixel(band, { axis: "x" })!, plot.y + plot.height - 2);
    send(chart, "pointerup", chart.toPixel(band, { axis: "x" })!, plot.y + plot.height - 2);
  };

  const listed = ["2024-12", "2025-01"];
  expectPanels({}, "mount", listed);

  // A brush on orders within January: the others show its days; December's
  // bar leaves its band, which stays in place, empty.
  const from = Date.UTC(2025, 0, 5);
  const to = Date.UTC(2025, 0, 20);
  brush(ordersChart, from, to);
  expect(filters.get("orders")?.kind).toBe("predicate");
  const { selection } = ordersChart;
  const brushed = selection?.kind === "brush" && selection.x ? selection.x : ([0, 0] as const);
  await drawn();
  expectPanels({ orders: brushed }, "orders brushed", listed);
  expect(byMonth.table.length).toBe(1);

  // West's bar: every other panel shows West's rows; the bars stay, West selected.
  clickBar(regionsChart, "West");
  expect(filters.get("regions")?.kind).toBe("predicate");
  await drawn();
  expectPanels({ orders: brushed, region: "West" }, "West selected", listed);

  // Rows streamed in follow the filters: a day appended in the range, and one
  // a month later, outside it.
  const added = [to - DAY / 2, to - DAY / 2, to + 30 * DAY];
  const addedMonths = added.map((t) => new Date(t).toISOString().slice(0, 7));
  sales.append({
    time: added,
    region: ["West", "North", "West"],
    month: addedMonths,
    revenue: [9000, 9100, 9200],
    orders: [200, 210, 220],
  });
  times.push(...added);
  regions.push("West", "North", "West");
  months.push(...addedMonths);
  revenue.push(9000, 9100, 9200);
  orders.push(200, 210, 220);
  await drawn();
  expectPanels({ orders: brushed, region: "West" }, "rows appended", listed);

  // Cleared: West clicked again, then the brush cleared by a click off it.
  // Every panel draws all rows again. December's group came back after
  // January's, but its bar is back in its listed band; February, which no
  // list names, follows them.
  clickBar(regionsChart, "West");
  expect(filters.get("regions")).toBeNull();
  const { plot } = ordersChart.getPanels()[0]!;
  const off = ordersChart.toPixel(Date.UTC(2024, 11, 10), { axis: "x" })!;
  send(ordersChart, "pointerdown", off, plot.y + plot.height / 2);
  send(ordersChart, "pointerup", off, plot.y + plot.height / 2);
  expect(filters.get("orders")).toBeNull();
  await drawn();
  const all = [...listed, "2025-02"];
  expectPanels({}, "cleared", all);
  expect(byMonth.table.categories("month").dictionary).toEqual(["2025-01", "2024-12", "2025-02"]);
  expect(monthsChart.getPanels()[0]!.x!.categories).toEqual(all);
  // The orders line runs in order of time, though December's days came back
  // after January's in its groups.
  const drawnPath = /<path[^>]*\bd="(M[^"]{200,})"/.exec(ordersChart.toSVG())![1]!;
  const xs = [...drawnPath.matchAll(/[ML]\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  expect(xs).toHaveLength(new Set(times).size);
  expect(xs).toEqual([...xs].sort((a, b) => a - b));

  // A month's bar filters the others to its days; again, back to all.
  clickBar(monthsChart, "2024-12");
  expect(filters.get("months")?.kind).toBe("predicate");
  await drawn();
  expectPanels({ month: "2024-12" }, "December selected", all);
  clickBar(monthsChart, "2024-12");
  await drawn();
  expectPanels({}, "December cleared", all);

  // A brush on revenue filters the others to its days; a click off it clears
  // it. February, which no list names, has no band while its group is empty.
  brush(revenueChart, Date.UTC(2024, 11, 20), Date.UTC(2025, 0, 10));
  expect(filters.get("revenue")?.kind).toBe("predicate");
  const onRevenue = revenueChart.selection;
  const revenueRange = onRevenue?.kind === "brush" && onRevenue.x ? onRevenue.x : ([0, 0] as const);
  await drawn();
  expectPanels({ revenue: revenueRange }, "revenue brushed", listed);
  const revenuePlot = revenueChart.getPanels()[0]!.plot;
  const offRevenue = revenueChart.toPixel(Date.UTC(2024, 11, 5), { axis: "x" })!;
  send(revenueChart, "pointerdown", offRevenue, revenuePlot.y + revenuePlot.height / 2);
  send(revenueChart, "pointerup", offRevenue, revenuePlot.y + revenuePlot.height / 2);
  expect(filters.get("revenue")).toBeNull();
  await drawn();
  expectPanels({}, "revenue cleared", all);

  // Two more months streamed in, and the axis given the months again, as
  // the guide says: a brush on March's days empties February's group, which
  // comes back after March's, but its bar stays in its band.
  const march = [Date.UTC(2025, 2, 3), Date.UTC(2025, 2, 4)];
  sales.append({
    time: [Date.UTC(2025, 1, 26), ...march],
    region: ["East", "East", "South"],
    month: ["2025-02", "2025-03", "2025-03"],
    revenue: [9300, 9400, 9500],
    orders: [230, 240, 250],
  });
  times.push(Date.UTC(2025, 1, 26), ...march);
  regions.push("East", "East", "South");
  months.push("2025-02", "2025-03", "2025-03");
  revenue.push(9300, 9400, 9500);
  orders.push(230, 240, 250);
  monthsChart.update({ x: { domain: [...sales.categories("month").dictionary] } });
  await drawn();
  const streamed = [...all, "2025-03"];
  expectPanels({}, "months streamed", streamed);
  brush(ordersChart, march[0]! - DAY / 2, march[1]! + DAY / 2);
  const marchBrush = ordersChart.selection;
  const inMarch = marchBrush?.kind === "brush" && marchBrush.x ? marchBrush.x : ([0, 0] as const);
  await drawn();
  expectPanels({ orders: inMarch }, "March brushed", streamed);
  expect(byMonth.table.length).toBe(1);
  send(ordersChart, "pointerdown", off, plot.y + plot.height / 2);
  send(ordersChart, "pointerup", off, plot.y + plot.height / 2);
  expect(filters.get("orders")).toBeNull();
  await drawn();
  expectPanels({}, "March cleared", streamed);
  // March's group stayed; the others came back after it, February after March.
  expect(byMonth.table.categories("month").dictionary).toEqual([
    "2025-03",
    "2024-12",
    "2025-01",
    "2025-02",
  ]);

  // Every selection, after filters and clears, named the table the example
  // gave its chart's mark: no chart was given another.
  for (const [chart, given] of [
    [revenueChart, sales],
    [ordersChart, tables[0]],
    [regionsChart, tables[1]],
    [monthsChart, tables[2]],
  ] as const) {
    const tablesNamed = named.get(chart)!;
    expect(tablesNamed.length).toBeGreaterThan(0);
    for (const table of tablesNamed) expect(table).toBe(given);
  }
});
