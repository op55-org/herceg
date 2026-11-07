<script lang="ts">
  import { PivotGrid } from "@herceg/svelte/grid/pivot";
  import { count, mean, rowView, table, time } from "herceg";
  import { createPivotGridModel } from "herceg/grid/pivot";
  import { pivotRows } from "herceg/pivot";

  let { x, y }: { x: Float64Array; y: Float64Array } = $props();
  const model = $derived.by(() => {
    const data = table({ t: time(x), v: y, k: Float64Array.from(x, (_, i) => i % 4) });
    const pivot = pivotRows(rowView(data), {
      rows: "t",
      pivot: "k",
      ops: { n: count(), avg: mean("v") },
    });
    return createPivotGridModel({ data: pivot });
  });
</script>

<PivotGrid {model} ariaLabel="Values" />
