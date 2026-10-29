<!-- A chart whose tooltip snippet reads the row it is at from the table it draws, as filtering applications do. -->
<script lang="ts">
  import type { Chart as HercegChart, Inspection, Table } from "herceg";
  import { Chart, Line } from "../src/index.js";

  let {
    data,
    tick = 0,
    chart = $bindable(null),
  }: {
    data: Table<{ t: "number"; v: "number" }>;
    tick?: number;
    chart?: HercegChart | null;
  } = $props();
</script>

{#snippet tip(inspection: Inspection)}
  <b>row {(data.value("t", inspection.points[0]!.row!) as number) + tick * 0}</b>
{/snippet}

<Chart bind:chart locale="en-US" renderTooltip={tip}>
  <Line {data} x="t" y="v" />
</Chart>
