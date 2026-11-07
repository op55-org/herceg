// The herceg pivot grid as a Svelte component, imported as
// `@herceg/svelte/grid/pivot` so that grids showing no pivot load none of it.
// Pivot grids take no Svelte cells: their rows are combinations, not records.

export { default as PivotGrid } from "./PivotGrid.svelte";
export type { GridComponentProps, PivotGridProps } from "./props.js";
