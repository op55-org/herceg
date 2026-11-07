<!-- A cell's component whose effects do what a test asks: as it mounts, updates, and goes. -->
<script lang="ts">
  import type { GridCellContext } from "herceg/grid";
  import { untrack } from "svelte";
  import type { Hooks } from "./hooks.js";

  let { cell, hooks }: { cell: GridCellContext; hooks: Hooks } = $props();
  let first = true;
  $effect(() => {
    const current = cell;
    untrack(() => {
      if (first) hooks.mounted?.(current);
      else hooks.updated?.(current);
      first = false;
    });
  });
  $effect(() => () => untrack(() => hooks.destroyed?.(cell)));
</script>

<i>{cell.text}</i>
