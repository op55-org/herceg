// Placing a grid's cells and writing them only where they change: what the
// DOM grid (grid.ts) and its header rows (grid-headings.ts) share.

import type { GridColumnLayout } from "../grid/columns.ts";

/**
 * Places a cell over shown columns `start` to `end` (one column's, or a
 * header's over several) at `column`'s offset, width, and edge, in a grid of
 * columns `width` wide: cells of columns held at an edge are in the row's
 * flow and stick there (sticky offsets are their distances from the edge);
 * the others are placed absolutely, and scroll under them.
 */
export function placeCell(
  element: HTMLElement,
  column: Pick<GridColumnLayout, "x" | "width" | "pinned" | "align">,
  layout: readonly GridColumnLayout[],
  start: number,
  end: number,
  width: number,
) {
  const style = element.style;
  const { pinned } = column;
  // The first cell held at the right goes after the others in the row's flow.
  const first = pinned === "right" && layout[start - 1]?.pinned !== "right";
  const last = pinned === "left" && layout[end]?.pinned !== "left";
  // Most cells keep their place when one column resizes: write only what changed.
  const set = (name: "left" | "right" | "marginLeft" | "width", value: string) => {
    if (style[name] !== value) style[name] = value;
  };
  set("left", pinned === "right" ? "" : `${column.x}px`);
  set("right", pinned === "right" ? `${width - column.x - column.width}px` : "");
  set("marginLeft", first ? "auto" : "");
  set("width", `${column.width}px`);
  setAttribute(element, "data-pin", pinned ?? "");
  // The boundary between held columns and those scrolling under them.
  setAttribute(element, "data-edge", first || last ? pinned! : "");
  setAttribute(element, "data-align", column.align);
}

/**
 * Sets an attribute unless it has the value; no value, or an empty one for
 * `data-` attributes, removes it.
 */
export function setAttribute(target: Element, name: string, value: string | undefined) {
  if (value === undefined || (value === "" && name.startsWith("data-"))) {
    if (target.hasAttribute(name)) target.removeAttribute(name);
  } else if (target.getAttribute(name) !== value) target.setAttribute(name, value);
}

export function setText(text: Text, value: string) {
  if (text.data !== value) text.data = value;
}

/**
 * Puts `elements` in `parent` in this order, with no other children. The
 * element `fixed` holds the page's focus and stays put; the others move
 * around it, each only if it is out of place.
 */
export function arrange(parent: Element, elements: readonly Element[], fixed: Element | null) {
  if (elements.length === 0) return;
  let pivot = fixed ? elements.indexOf(fixed) : -1;
  if (pivot < 0) {
    pivot = 0;
    if (parent.firstElementChild !== elements[0]) parent.prepend(elements[0]!);
  }
  for (let k = pivot + 1; k < elements.length; k++)
    if (elements[k]!.previousElementSibling !== elements[k - 1])
      elements[k - 1]!.after(elements[k]!);
  for (let k = pivot - 1; k >= 0; k--)
    if (elements[k]!.nextElementSibling !== elements[k + 1])
      parent.insertBefore(elements[k]!, elements[k + 1]!);
}
