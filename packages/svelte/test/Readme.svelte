<!-- The examples of the README and docs/guide/frameworks.md, checked by `npm run typecheck` so the docs stay true. -->
<script lang="ts" module>
  declare const timestamps: Float64Array;
  declare const p50: Float64Array;
  declare const p99: Float64Array;
  declare function readCpu(): number;

  // The frameworks guide's "Custom marks": a draw of flights, highlighting one.
  const flights = table({ id: ["F-1", "F-2"], start: [10, 30], end: [40, 90], lane: [1, 2] });
  type FlightSchema = typeof flights extends Table<infer S> ? S : never;
  const drawFlights =
    (highlighted: string) =>
    ({ table, series, x, y, item, rect }: DataDrawContext<FlightSchema>) => {
      const end = table.numbers("end");
      for (const s of series)
        for (let k = 0; k < s.length; k++) {
          const row = s.rowAt(k);
          const fill = table.value("id", row) === highlighted ? "#e4572e" : s.color;
          item(s, row, () =>
            rect(x(s.x[row]!), y(s.y[row]!) - 4, x(end[row]!) - x(s.x[row]!), 8, { fill }),
          );
        }
    };
</script>

<script lang="ts">
  import {
    type ChartSelection,
    type DataDrawContext,
    type Chart as HercegChart,
    type Table,
    table,
    time,
  } from "herceg";
  import { onMount } from "svelte";
  import { Chart, Custom, Line, Region, Rule, Text } from "../src/index.js";

  const metrics = table({ time: time(timestamps), p50, p99 });
  const deploys = table({ at: time([Date.now()]), version: ["v2"] });

  let chart = $state<HercegChart | null>(null);
  let selection = $state<ChartSelection | null>(null);
  export const exportSvg = () => chart?.toSVG();

  const data = table({ time: time([]), cpu: [] as number[] }, { maxRows: 3_000 });
  onMount(() => {
    const timer = setInterval(() => data.appendRow({ time: Date.now(), cpu: readCpu() }), 100);
    return () => clearInterval(timer);
  });

  let highlighted = $state("F-2");
  const draw = $derived(drawFlights(highlighted));
</script>

<Chart title="Request latency" y={{ title: "ms" }} interaction={{ zoom: true }}>
  <Line data={metrics} x="time" y={["p50", "p99"]} />
  <Rule y={250} label="SLO" />
</Chart>

<Chart bind:chart bind:selection interaction={{ brush: "x" }}>
  <Line data={metrics} x="time" y="p50" />
</Chart>

<Chart>
  <Region x1={new Date(0)} x2={new Date()} label="window" />
  <Line data={metrics} x="time" y="p50" />
  <Rule data={deploys} x="at" label={{ field: "version" }} />
  <Text x={Date.now()} y={100} label={{ text: "now", style: { align: "end" } }} />
  <Text data={deploys} x="at" y={120} label={{ field: "version" }} />
  <Custom draw={({ text, x, y }) => text(x(1), y(2), "now")} />
</Chart>

<Chart>
  <Custom data={flights} x={["start", "end"]} y="lane" itemKey="id" {draw} />
</Chart>

<Chart>
  <Line {data} x="time" y="cpu" />
</Chart>
