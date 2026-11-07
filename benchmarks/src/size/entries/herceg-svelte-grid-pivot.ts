import { mount } from "svelte";
import Values from "./herceg-svelte-grid-pivot.svelte";

// Svelte's runtime is excluded, as for herceg-svelte-grid.
export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  mount(Values, { target: element, props: { x, y } });
}
