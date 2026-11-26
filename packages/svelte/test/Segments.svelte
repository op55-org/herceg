<script lang="ts">
  import { table } from "herceg";
  import { Chart, Segment } from "../src/index.js";

  let { end }: { end: number } = $props();
  const forecasts = table({ id: ["F-1", "F-2"], start: [10, 80], end: [40, 30] });
  $effect(() => forecasts.set("end", 0, end));
</script>

<Chart renderer="svg">
  <Segment data={forecasts} x={["start", "end"]} y="id" color="#ff0000" width={{ from: 4, to: 1 }} caps={{ from: "dot", to: "arrow" }} />
</Chart>
