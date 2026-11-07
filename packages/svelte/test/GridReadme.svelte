<!-- The Svelte grid examples of docs/guide/grids.md and docs/guide/frameworks.md, checked by `npm run typecheck` so the docs stay true. -->
<script lang="ts" module>
  import type { Table } from "herceg";
  import type { GridColumn } from "herceg/grid";
  import type { Component } from "svelte";

  type Services = { service: "category"; status: "category"; latency: "number" };
  declare const services: Table<Services>;
  declare const columns: GridColumn<Services>[];
  declare const StatusBadge: Component<{ status: string | number | null | undefined }>;
  declare const Sparkline: Component<{ service: string | null }>;
  declare function openService(service: string | null): void;
</script>

<script lang="ts">
  import { rowView } from "herceg";
  import { createGridModel, type GridCellContext, type GridModel } from "herceg/grid";
  import { Grid } from "../src/grid.js";

  const model: GridModel<Services> = createGridModel({ data: rowView(services), columns });
</script>

{#snippet trend(cell: GridCellContext<Services>)}
  <Sparkline service={cell.read("service")} />
{/snippet}

<Grid {model} ariaLabel="Services" cells={{ trend: { fields: ["service"], render: trend } }} />

{#snippet status(cell: GridCellContext<Services>)}<StatusBadge status={cell.value} />{/snippet}
{#snippet open(cell: GridCellContext<Services>)}
  <button type="button" onclick={() => openService(cell.read("service"))}>Open</button>
{/snippet}

<Grid {model} ariaLabel="Services" style="height: 400px"
  cells={{ status, open: { fields: ["service"], interaction: "control", render: open } }} />
