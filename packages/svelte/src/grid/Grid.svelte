<!--
  A herceg grid. Props other than `model` are applied with `grid.update`
  when they change; a theme or header height no longer passed goes back to
  its default.
-->
<script lang="ts" generics="S extends Schema">
  import type { Schema } from "herceg";
  import { createGrid, type GridModel } from "herceg/grid";
  import { getAllContexts } from "svelte";
  import { useGrid } from "./base.svelte.js";
  import { CellMounts } from "./cells.svelte.js";
  import type { GridProps } from "./props.js";

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
    onrowclick,
    oncellclick,
    onrender,
  }: GridProps<S> = $props();

  const attach = useGrid(
    (container, given, options) => createGrid(container, { ...options, model: given as GridModel }),
    () => ({ model, options: { ariaLabel, theme, headerHeight, copy }, cells }),
    () => ({ onrowclick, oncellclick, onrender }),
    (made) => {
      grid = made as typeof grid;
    },
    new CellMounts(getAllContexts()),
  );
</script>

<div class={className} {style} {@attach attach}></div>
