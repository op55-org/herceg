<!-- A chart whose selection and view its parent binds. -->
<script lang="ts">
  import type { ChartSelection, Chart as HercegChart, Table, ViewportState } from "herceg";
  import { Chart, Line } from "../src/index.js";

  let {
    data,
    chart = $bindable(null),
    selection = $bindable(null),
    viewport = $bindable(),
  }: {
    data: Table<{ t: "number"; a: "number"; b: "number" }>;
    chart?: HercegChart | null;
    selection?: ChartSelection | null;
    viewport?: ViewportState | undefined;
  } = $props();
</script>

<Chart bind:chart bind:selection bind:viewport interaction={{ brush: "x", zoom: "x" }}>
  <Line {data} x="t" y="a" />
</Chart>
