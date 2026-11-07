<!--
  A herceg pivot grid. Props other than `model` are applied with
  `grid.update` when they change, as `<Grid>`'s are. Pivot grids take no
  Svelte cells: their rows are combinations, not records.
-->
<script lang="ts" generics="S extends Schema">
  import type { Schema } from "herceg";
  import { createPivotGrid, type PivotGridModel } from "herceg/grid/pivot";
  import { useGrid } from "./base.svelte.js";
  import type { PivotGridProps } from "./props.js";

  let {
    model,
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
  }: PivotGridProps<S> = $props();

  const attach = useGrid(
    (container, given, options) =>
      createPivotGrid(container, { ...options, model: given as PivotGridModel }),
    () => ({ model, options: { ariaLabel, theme, headerHeight, copy } }),
    () => ({ onrowclick, oncellclick, onrender }),
    (made) => {
      grid = made as typeof grid;
    },
  );
</script>

<div class={className} {style} {@attach attach}></div>
