<!-- Points drawn by a custom mark whose tooltip text, made for the unit it names, is made again as the unit changes. -->
<script lang="ts">
  import type { AxisFormat, CustomSeries, Chart as HercegChart } from "herceg";
  import { Chart, Custom } from "../src/index.js";
  import type { Points } from "./flights.js";

  let {
    data,
    unit,
    chart = $bindable(null),
  }: {
    data: Points;
    unit: string;
    chart?: HercegChart | null;
  } = $props();

  const writing = (unit: string) => (row: number, format: AxisFormat, s: CustomSeries) =>
    `${format.y(s.y[row]!)} ${unit}`;
  const pointText = $derived(writing(unit));
</script>

<Chart bind:chart locale="en-US">
  <Custom
    {data}
    x="t"
    y="v"
    {pointText}
    draw={({ series, circle, x, y }) => {
      for (const s of series) for (let k = 0; k < s.length; k++) circle(x(s.x[k]!), y(s.y[k]!), 3);
    }}
  />
</Chart>
