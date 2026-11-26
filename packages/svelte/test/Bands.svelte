<!-- Bars of regions on an axis whose `domain` orders their bands. -->
<script lang="ts">
  import type { Chart as HercegChart, Table } from "herceg";
  import { Bar, Chart } from "../src/index.js";

  let {
    data,
    order,
    chart = $bindable(null),
  }: {
    data: Table<{ region: "category"; v: "number" }>;
    order: string[];
    chart?: HercegChart | null;
  } = $props();
</script>

<Chart bind:chart x={{ domain: order }}>
  <Bar {data} x="region" y="v" />
</Chart>
