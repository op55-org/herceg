// The operations dashboard of the tester's two migration rounds, rebuilt
// with @herceg/react, as dashboard.test.tsx proves it draws and behaves:
// load and requests on two y axes, a labelled target and a stepped limit,
// estimated stretches dotted, the latest point a square, numbered event
// badges on stems, day boundaries labelled inside the plots on a grey
// background; panels of unequal sizes sharing y with x of their own, an
// inset, a panel's legend and the chart's; history loaded as the reader
// drags back; a week's chart following the cursor; events selected across
// charts; and sparklines drawn on the server.

import {
  axis,
  type ChartOptions,
  col,
  line,
  point,
  rowSelection,
  selectionStore,
  table,
  time,
} from "herceg";
import type { Ref } from "react";
import type { Chart as HercegChart } from "../../../herceg/src/dom/handle.ts";
import { Legend } from "../../src/guides.tsx";
import { Bar, Chart, type ChartProps, Line, Point, Rule, Text } from "../../src/index.ts";
import { Columns, Inset, Panel, Rows } from "../../src/layout.tsx";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
const SAMPLE = 10 * 60_000;
/** Monday 19 October 2026, 00:00 UTC: the first day loaded. */
export const START = Date.UTC(2026, 9, 19);
/** The last sample: three days of ten-minute samples. */
export const END = START + 3 * DAY - SAMPLE;
/** Where the estimates start: the last six hours are forecast, not measured. */
export const ESTIMATED_FROM = END - 6 * HOUR;
export const GREY = "#eeeeee";
export const TARGET = 52.8;

/** Load (%), requests (/s), and whether estimated (1) for each ten-minute sample of `days` days from `from`. */
function samples(from: number, days: number) {
  const t = Float64Array.from({ length: days * 144 }, (_, i) => from + i * SAMPLE);
  const phase = (v: number) => (2 * Math.PI * (v - START)) / DAY;
  return {
    t,
    load: Float64Array.from(t, (v) => 45 + 8 * Math.sin(phase(v)) + ((v - START) / DAY) * 2),
    requests: Float64Array.from(t, (v) => 900 + 250 * Math.cos(phase(v))),
    estimated: Float64Array.from(t, (v) => (v > ESTIMATED_FROM ? 1 : 0)),
  };
}

const telemetryOf = (columns: ReturnType<typeof samples>) =>
  table({ ...columns, t: time(columns.t) });

export function dashboardData() {
  const telemetry = telemetryOf(samples(START, 3));
  // The limit steps every twelve hours.
  const steps = Float64Array.from({ length: 7 }, (_, i) => START + i * 12 * HOUR);
  const limits = table({ t: time(steps), limit: [58, 56, 60, 57, 59, 55, 58] });
  // Badges in lanes of the plot's height, numbered in time order.
  const events = table({
    t: time([END - 20 * HOUR, END - 12 * HOUR, END - 5 * HOUR]),
    level: [0.1, 0.22, 0.34],
    n: ["1", "2", "3"],
  });
  const latest = table({ t: time([END]), load: [telemetry.numbers("load").at(-1)!] });
  // Incidents by hour of the last day, at two sites.
  const hours = Array.from({ length: 24 }, (_, i) => END - DAY + i * HOUR);
  const incidents = table({
    t: time([...hours, ...hours]),
    site: [...hours.map(() => "Site A"), ...hours.map(() => "Site B")],
    count: [...hours.map((_, i) => i % 5), ...hours.map((_, i) => (i * 3) % 4)],
  });
  // The week before the last sample, hourly: another range at another frequency.
  const week = Float64Array.from({ length: 7 * 24 }, (_, i) => END - 7 * DAY + (i + 1) * HOUR);
  const weekly = table({
    t: time(week),
    load: Float64Array.from(week, (v) => 45 + 8 * Math.sin((2 * Math.PI * (v - START)) / DAY)),
  });
  const picks = selectionStore(events);
  let oldest = START;
  return {
    telemetry,
    limits,
    events,
    latest,
    incidents,
    weekly,
    picks,
    /** The earliest time loaded. */
    get oldest() {
      return oldest;
    },
    /** Loads the day before the earliest loaded, as a server would, in front of the rows. */
    loadEarlier() {
      const older = samples(oldest - DAY, 1);
      const join = (field: "load" | "requests" | "estimated") =>
        Float64Array.from([...older[field], ...telemetry.numbers(field)]);
      telemetry.reset({
        t: time(Float64Array.from([...older.t, ...telemetry.numbers("t")])),
        load: join("load"),
        requests: join("requests"),
        estimated: join("estimated"),
      });
      oldest -= DAY;
    },
  };
}

export type DashboardData = ReturnType<typeof dashboardData>;

/** The cursor every chart of the dashboard shares: each shows its reading at or before the time. */
export const CURSOR = { group: "ops", snap: "previous" } as const;

/** Hourly ticks labelled by time, and a layer of day boundaries labelled inside the plot. */
export const DAY_AXIS = [
  axis({
    scale: "x",
    ticks: { every: "6 hours" },
    format: { time: "%H:%M" },
    layers: [
      {
        id: "day",
        ticks: { every: "day" },
        format: { time: "%a %-d" },
        tick: { direction: "in", length: 8 },
        // Inside the plot, each label just after its boundary's tick.
        labels: { inside: true },
        style: { tickLabel: { align: "start" } },
      },
    ],
  }),
];

/** Estimated stretches dotted and lighter, in the same series. */
const ESTIMATED = {
  // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
  dash: { condition: { when: col("estimated").eq(1), then: ":", otherwise: "-" } },
  // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
  opacity: { condition: { when: col("estimated").eq(1), then: 0.6, otherwise: 1 } },
} as const;

interface OverviewProps extends Omit<ChartProps, "children"> {
  data: DashboardData;
  chart: Ref<HercegChart | null>;
}

/**
 * The main chart: the last day and the days before side by side, sharing
 * y and each with an x of its own, over the last day's incidents.
 */
export function Overview({ data, chart, ...props }: OverviewProps) {
  return (
    <Chart
      ref={chart}
      title="Load"
      height={560}
      locale="en-US"
      timeZone="UTC"
      interaction={{
        pan: "xy",
        limits: { x: { extent: [data.oldest, null], edge: true } },
        sync: { cursor: CURSOR },
      }}
      rowSelection={rowSelection({ store: data.picks, channel: "picked", events: ["click"] })}
      y={{ title: "load %", scope: { panels: ["now", "before"] } }}
      yRight={{ title: "requests/s" }}
      legend={{ place: { side: "bottom" } }}
      guides={DAY_AXIS}
      {...props}
    >
      <Rows weights={[3, 1]}>
        <Columns weights={[2, 1]}>
          <Panel
            id="now"
            title="Last day"
            x={{ domain: [END - DAY, END], padding: { px: 8 } }}
            style={{ plot: { fill: GREY } }}
          >
            <Line
              id="load"
              data={data.telemetry}
              x="t"
              y="load"
              stroke="#1f4e79"
              encode={ESTIMATED}
            />
            <Line
              id="requests"
              data={data.telemetry}
              x="t"
              y="requests"
              axis="right"
              stroke="#9aa5b1"
            />
            <Line
              id="limit"
              data={data.limits}
              x="t"
              y="limit"
              curve="step-after"
              dash="--"
              stroke="#c0392b"
              labels={{
                at: "visible-start",
                content: ["Limit ", { value: true }],
                place: { outside: true },
              }}
            />
            <Rule
              y={TARGET}
              stroke="#2e7d32"
              label={{ text: `Target\n${TARGET}%`, place: { attachment: "start", outside: true } }}
            />
            <Point
              id="latest"
              data={data.latest}
              x="t"
              y="load"
              symbol="square"
              size={{ value: 64 }}
              fill="#1f4e79"
              legend={false}
            />
            {/* Stems first, so the badges paint over them. */}
            <Rule
              id="stems"
              data={data.events}
              x="t"
              span={[{ fraction: 0 }, { fraction: { field: "level" } }]}
              dash={[3, 3]}
              stroke="#555555"
              legend={false}
            />
            <Point
              id="badges"
              data={data.events}
              x="t"
              y={{ fraction: { field: "level" } }}
              size={{ value: 256 }}
              fill="#c0392b"
              legend={false}
            />
            <Text
              id="numbers"
              data={data.events}
              x="t"
              y={{ fraction: { field: "level" } }}
              label={{ field: "n", style: { color: "#ffffff", fontWeight: 700, halo: false } }}
              legend={false}
            />
            <Legend place={{ inside: "bottom-left" }} />
            <Inset
              id="detail"
              x={{ domain: [END - 3 * HOUR, END] }}
              place={{ inside: "top-left" }}
              width={{ fraction: 0.35 }}
              height={{ fraction: 0.35 }}
              indicator
            >
              <Line data={data.telemetry} x="t" y="load" stroke="#1f4e79" />
            </Inset>
          </Panel>
          <Panel
            id="before"
            title="Days before"
            x={{ domain: [START, END - DAY] }}
            style={{ plot: { fill: GREY } }}
          >
            <Line id="history" data={data.telemetry} x="t" y="load" stroke="#1f4e79" />
          </Panel>
        </Columns>
        <Panel id="incidents" title="Incidents" x={{ domain: [END - DAY, END] }}>
          <Bar id="incidents" data={data.incidents} x="t" y="count" color="site" />
        </Panel>
      </Rows>
    </Chart>
  );
}

/** The week before, hourly: another range following the overview's cursor, highlighting its picked events. */
export function Week({ data, chart, ...props }: OverviewProps) {
  return (
    <Chart
      ref={chart}
      title="This week"
      height={240}
      locale="en-US"
      timeZone="UTC"
      interaction={{ pan: "x", sync: { cursor: CURSOR } }}
      rowSelection={rowSelection({ store: data.picks, channel: "picked", events: [] })}
      {...props}
    >
      <Line id="week" data={data.weekly} x="t" y="load" stroke="#1f4e79" />
      <Point
        id="events"
        data={data.events}
        x="t"
        y={{ fraction: { field: "level" } }}
        size={{ value: 100 }}
        fill="#c0392b"
        legend={false}
      />
    </Chart>
  );
}

/** A sparkline's size, and the options a server renders it from and the browser hydrates. */
export const SPARK = { width: 140, height: 48 } as const;

/** What a sparkline's chart takes: the options a server snapshot is made of, as the component takes them. */
type SparkOptions = Omit<ChartOptions, "onError" | "renderTooltip">;

export function sparkOptions(data: DashboardData): SparkOptions {
  return {
    locale: "en-US",
    timeZone: "UTC",
    padding: 0,
    x: { show: false, nice: false },
    y: { show: false, nice: false },
    tooltip: false,
    marks: [
      line(data.weekly, { x: "t", y: "load", stroke: "#1f4e79" }),
      point(data.latest, {
        x: "t",
        y: "load",
        symbol: "square",
        size: { value: 36 },
        fill: "#1f4e79",
      }),
    ],
  } as SparkOptions;
}
