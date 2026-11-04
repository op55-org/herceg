<!-- A line of `data`, whose chart's field displays name `v` for the rows of `matched`. -->
<script lang="ts">
  import type { Chart as HercegChart, Table } from "herceg";
  import { Chart, Line } from "../src/index.js";

  type Rows = Table<{ t: "number"; v: "number" }>;
  let {
    data,
    matched,
    chart = $bindable(null),
  }: { data: Rows; matched: Rows; chart?: HercegChart | null } = $props();
</script>

<Chart bind:chart renderer="svg" fields={[{ match: { table: matched, field: "v" }, label: "Volume" }]}>
  <Line {data} x="t" y="v" />
</Chart>
