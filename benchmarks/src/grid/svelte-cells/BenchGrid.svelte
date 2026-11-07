<!--
  herceg-svelte's grid: `<Grid>` over the adapter's model; with `extent`
  (the framework cells scenarios), `SvelteCell` draws the cell-bearing
  columns from each cell's value and text, n1's link a control cell.
-->
<script lang="ts">
  import { Grid, type SvelteGridCells } from "@herceg/svelte/grid";
  import type { Schema } from "herceg";
  import type { GridCellContext, GridModel, GridOptions } from "herceg/grid";
  import { CELL_FIELDS } from "../cells.ts";
  import SvelteCell from "./SvelteCell.svelte";

  let {
    model,
    extent,
    ...options
  }: {
    model: GridModel<Schema>;
    extent: readonly [number, number] | undefined;
    ariaLabel: string;
    headerHeight: number;
    theme: NonNullable<GridOptions["theme"]>;
    style: string;
  } = $props();

  const cells: SvelteGridCells<Schema> | undefined = $derived(
    extent &&
      Object.fromEntries(
        CELL_FIELDS.map((field) => [
          field,
          field === "n1" ? { render: draw, interaction: "control" } : draw,
        ]),
      ),
  );
</script>

{#snippet draw(cell: GridCellContext<Schema>)}
  <SvelteCell field={cell.column.field!} value={cell.value ?? undefined} text={cell.text} extent={extent!} />
{/snippet}

<Grid {model} {cells} {...options} />
