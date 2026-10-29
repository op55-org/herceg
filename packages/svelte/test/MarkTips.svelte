<!-- A chart whose tooltip snippet names the mark it is at, and records each name it renders. -->
<script lang="ts">
  import type { Chart as HercegChart, Inspection, Table } from "herceg";
  import { Chart, Line } from "../src/index.js";

  let {
    data,
    id,
    record,
    chart = $bindable(null),
  }: {
    data: Table<{ t: "number"; v: "number" }>;
    id: string;
    record: (markId: string | undefined) => void;
    chart?: HercegChart | null;
  } = $props();

  const name = (inspection: Inspection) => {
    record(inspection.points[0]?.markId);
    return inspection.points[0]?.markId;
  };
</script>

{#snippet tip(inspection: Inspection)}
  <b>{name(inspection)}</b>
{/snippet}

<Chart bind:chart locale="en-US" renderTooltip={tip}>
  <Line {id} {data} x="t" y="v" />
</Chart>
