<script lang="ts">
  import { Grid } from "@herceg/svelte/grid";
  import { rowView, table, time } from "herceg";
  import { createGridModel } from "herceg/grid";

  let { x, y }: { x: Float64Array; y: Float64Array } = $props();
  const model = $derived(
    createGridModel({
      data: rowView(table({ t: time(x), v: y })),
      columns: [{ field: "t" }, { field: "v" }],
    }),
  );
</script>

<Grid {model} ariaLabel="Values" />
