<!--
  A herceg remote grid: rows live elsewhere (a database behind an API, a
  worker) and load as they come into view. Props other than `model` are
  applied with `grid.update` when they change, as `<Grid>`'s are.
-->
<script lang="ts" generics="S extends Schema">
  import type { Schema } from "herceg";
  import { createRemoteGrid, type RemoteGridModel } from "herceg/grid/remote";
  import { getAllContexts } from "svelte";
  import { useGrid } from "./base.svelte.js";
  import { CellMounts } from "./cells.svelte.js";
  import type { RemoteGridProps } from "./props.js";

  let {
    model,
    cells,
    grid = $bindable(null),
    class: className,
    style,
    ariaLabel,
    theme,
    headerHeight,
    copy,
    onselect,
    onrowclick,
    oncellclick,
    onrender,
  }: RemoteGridProps<S> = $props();

  const attach = useGrid(
    (container, given, options) =>
      createRemoteGrid(container, { ...options, model: given as RemoteGridModel }),
    () => ({ model, options: { ariaLabel, theme, headerHeight, copy }, cells }),
    () => ({ onselect, onrowclick, oncellclick, onrender }),
    (made) => {
      grid = made as typeof grid;
    },
    new CellMounts(getAllContexts()),
  );
</script>

<div class={className} {style} {@attach attach}></div>
