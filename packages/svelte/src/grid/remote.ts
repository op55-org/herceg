// The herceg remote grid as a Svelte component, imported as
// `@herceg/svelte/grid/remote` so that grids over local tables load none of
// it: rows live elsewhere (a database behind an API, a worker) and load as
// they come into view.

export type { GridCellSnippet, SvelteGridCell, SvelteGridCells } from "./cells.svelte.js";
export type { GridComponentProps, RemoteGridProps } from "./props.js";
export { default as RemoteGrid } from "./RemoteGrid.svelte";
