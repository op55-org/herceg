<!-- A grid without Svelte cells, its options and handlers as given; `pivot` shows a pivot's. -->
<script lang="ts">
  import { PivotGrid } from "../../src/grid/pivot.js";
  import { Grid } from "../../src/grid.js";

  let {
    model,
    pivot = false,
    grid = $bindable(null),
    ...options
  }: {
    // biome-ignore lint/suspicious/noExplicitAny: a model of any schema, local or pivot
    model: any;
    pivot?: boolean;
    // biome-ignore lint/suspicious/noExplicitAny: a grid of either kind, as `model`
    grid?: any;
    ariaLabel: string;
    theme?: "dark" | undefined;
    copy?: false | undefined;
    onselect?: (event: {
      selection: { kind: string; rows?: { positions(): Uint32Array } } | null;
      cause: string;
    }) => void;
    onrowclick?: (event: { ref: { id: unknown }; column: string; rowIndex: number }) => void;
    oncellclick?: (event: { rowIndex: number }) => void;
    onrender?: (event: { revision: number }) => void;
  } = $props();
</script>

{#if pivot}
  <PivotGrid {model} style="height: 300px" bind:grid {...options} />
{:else}
  <Grid {model} style="height: 300px" bind:grid {...options} />
{/if}
