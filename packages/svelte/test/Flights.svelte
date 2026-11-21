<!-- Flights whose values move, drawn by a custom mark whose draw is made from the props it reads. -->
<script lang="ts">
  import type { AxisFormat, CustomSeries, DataDrawContext, Chart as HercegChart } from "herceg";
  import { Chart, Custom } from "../src/index.js";
  import type { FlightSchema, Flights } from "./flights.js";

  let {
    data,
    drawing,
    past,
    note,
    unit = "min",
    series,
    spread = false,
    duration = 320,
    onerror,
    chart = $bindable(null),
  }: {
    data: Flights;
    /** Makes the draw: of flights reaching `past` past their ends; `note` is closed over, not drawn. */
    drawing: (past: number, note: string) => (context: DataDrawContext<FlightSchema>) => void;
    past: number;
    note: string;
    /** What the tooltip's text names its values in. */
    unit?: string;
    /** The custom mark's series field, which a name not in the table makes refused. */
    series?: string | undefined;
    /** Whether the draw is given in a spread of props rather than by name. */
    spread?: boolean;
    /** How long values move, which the chart refuses below 0. */
    duration?: number;
    onerror?: (() => void) | undefined;
    chart?: HercegChart | null;
  } = $props();

  const writing = (unit: string) => (row: number, format: AxisFormat, s: CustomSeries) =>
    `${format.x(s.x[row]!)} ${unit}`;
  const pointText = $derived(writing(unit));
  const draw = $derived(drawing(past, note));
  const callbacks = $derived({ draw });
</script>

<Chart
  bind:chart
  {onerror}
  renderer="svg"
  animation={{ values: true, duration, easing: "linear" }}
  x={{ domain: [0, 100] }}
  y={{ domain: [0, 3] }}
>
  {#if spread}
    <Custom {data} x={["start", "end"]} y="lane" itemKey="id" {pointText} {...callbacks} />
  {:else}
    <Custom
      {data}
      x={["start", "end"]}
      y="lane"
      itemKey="id"
      {...series === undefined ? {} : { series: series as "id" }}
      {pointText}
      {draw}
    />
  {/if}
</Chart>
