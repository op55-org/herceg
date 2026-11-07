<!--
  The grid v2 acceptance: a link (the service's display), a chip (status),
  a bar (latency), and an action (a Svelte control cell), whose components
  count their mounts.
-->
<script lang="ts">
  import type { GridCellContext, GridModel } from "herceg/grid";
  import { Grid } from "../../src/grid.js";
  import Action from "./Action.svelte";

  type Services = { id: "number"; service: "category"; status: "category"; latency: "number" };
  let {
    model,
    grid = $bindable(null),
    opened,
    live,
  }: {
    model: GridModel<Services>;
    grid?: import("herceg/grid").Grid<Services> | null;
    opened: (service: string) => void;
    live: (service: string, by: number) => void;
  } = $props();
</script>

{#snippet open(cell: GridCellContext<Services>)}<Action service={cell.read("service") ?? ""} {opened} {live} />{/snippet}

<Grid
  {model}
  ariaLabel="Services"
  style="height: 300px"
  bind:grid
  cells={{ open: { fields: ["service"], interaction: "control", render: open } }}
/>
