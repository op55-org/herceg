<script lang="ts">
  import type { ChartEvents, Chart as HercegChart, Table } from "herceg";
  import { Chart, Line } from "../src/index.js";

  let {
    data,
    chart = $bindable(null),
    onpin,
  }: {
    data: Table<{ t: "number"; a: "number" }>;
    chart?: HercegChart | null;
    onpin: (event: ChartEvents["pin"]) => void;
  } = $props();
</script>

<Chart bind:chart tooltip={{ pin: "click" }} {onpin}>
  <Line {data} x="t" y="a" />
</Chart>
