// The header rows over a grid's columns' own (dom/grid.ts): one per level of
// the columns' headings (`heading`, grid/columns.ts), the longest path's
// many. At each level a run of adjacent shown columns whose headings agree,
// by id, there and at every level above it shares one `columnheader`
// spanning them (`aria-colspan`); a column moved out of its run, or held at
// an edge apart from its neighbors, makes a header of its own. Columns
// without a heading at a level have none there; over those held at an edge
// a blank, hidden from assistive technology, keeps the held headers in
// place. Runs are of every shown column, so the rows do not change as the
// grid scrolls; only the headers over mounted columns are mounted. Columns'
// own headers are named with their headings ("Latency, p99").

import type { PlacedColumn } from "../grid/columns.ts";
import { arrange, placeCell, setAttribute, setText } from "./grid-place.ts";

/** A header mounted over a run of shown columns: a heading's, or a blank over columns held at an edge. */
interface Header {
  readonly element: HTMLDivElement;
  readonly text: Text;
}

/** One header row: its element, and the headers mounted, by their first column's id. */
interface Level {
  readonly row: HTMLDivElement;
  headers: Map<string, Header>;
}

export class Headings {
  readonly #document: Document;
  #levels: Level[] = [];

  constructor(document: Document) {
    this.#document = document;
  }

  /** How many rows headings take over these columns: the longest path's levels. */
  rows(layout: readonly PlacedColumn[]): number {
    let rows = 0;
    for (const { headings } of layout) rows = Math.max(rows, headings.length);
    return rows;
  }

  /**
   * Draws the rows in the header rowgroup `header`, before the columns' own
   * row `own`, over the shown columns mounted (`columns`, indices into
   * `layout`, whose header cells are `cells`), in a grid of columns `width`
   * wide whose rows are `span` wide.
   */
  draw(
    header: HTMLElement,
    own: HTMLElement,
    columns: readonly number[],
    cells: readonly { readonly element: HTMLElement }[],
    layout: readonly PlacedColumn[],
    width: number,
    span: number,
  ): void {
    columns.forEach((column, k) => {
      const { title, headings } = layout[column]!;
      const element = cells[k]!.element;
      if (headings.length > 0)
        setAttribute(
          element,
          "aria-label",
          [...headings.map((heading) => heading.title), title].join(", "),
        );
      else element.removeAttribute("aria-label");
    });
    const count = this.rows(layout);
    const levels = this.#levels;
    while (levels.length > count) levels.pop()!.row.remove();
    while (levels.length < count) {
      const row = this.#document.createElement("div");
      row.className = "hg-band";
      row.setAttribute("role", "row");
      levels.push({ row, headers: new Map() });
    }
    // Written only when it changes: the grid draws every frame it scrolls.
    const { style } = header.closest<HTMLElement>(".herceg-grid")!;
    const rows = count > 0 ? String(count + 1) : "";
    if (style.getPropertyValue("--hg-header-rows") !== rows)
      style.setProperty("--hg-header-rows", rows || null);
    const value = `${span}px`;
    levels.forEach((level, depth) => {
      const { row } = level;
      setAttribute(row, "aria-rowindex", String(depth + 1));
      if (row.style.width !== value) row.style.width = value;
      this.#drawLevel(level, depth, columns, layout, width);
    });
    // The rows from the top, before the columns' own: placed from the lowest up.
    for (let depth = levels.length - 1; depth >= 0; depth--) {
      const { row } = levels[depth]!;
      const next = levels[depth + 1]?.row ?? own;
      if (row.nextElementSibling !== next) header.insertBefore(row, next);
    }
  }

  #drawLevel(
    level: Level,
    depth: number,
    columns: readonly number[],
    layout: readonly PlacedColumn[],
    width: number,
  ) {
    // Runs over mounted columns: under one heading at this level, or held at an edge without one.
    const runs: [number, number][] = [];
    for (const column of columns) {
      if (runs.length > 0 && column < runs.at(-1)![1]) continue;
      const [start, end] = runOf(layout, column, depth);
      if (layout[start]!.headings.length > depth || layout[start]!.pinned) runs.push([start, end]);
    }
    const previous = level.headers;
    const headers = new Map<string, Header>();
    for (const [start, end] of runs) {
      const first = layout[start]!;
      const last = layout[end - 1]!;
      const key = first.id;
      const header = previous.get(key) ?? this.#header();
      previous.delete(key);
      headers.set(key, header);
      const { element } = header;
      placeCell(
        element,
        { x: first.x, width: last.x + last.width - first.x, pinned: first.pinned, align: "center" },
        layout,
        start,
        end,
        width,
      );
      const heading = first.headings[depth];
      if (heading) {
        setAttribute(element, "role", "columnheader");
        element.removeAttribute("aria-hidden");
        setAttribute(element, "aria-colindex", String(start + 1));
        setAttribute(element, "aria-colspan", String(end - start));
        setText(header.text, heading.title);
      } else {
        // A blank over held columns without a heading: nothing to read.
        element.removeAttribute("role");
        element.removeAttribute("aria-colindex");
        element.removeAttribute("aria-colspan");
        setAttribute(element, "aria-hidden", "true");
        setText(header.text, "");
      }
    }
    for (const header of previous.values()) header.element.remove();
    level.headers = headers;
    arrange(
      level.row,
      [...headers.values()].map(({ element }) => element),
      null,
    );
  }

  #header(): Header {
    const element = this.#document.createElement("div");
    const text = this.#document.createTextNode("");
    element.append(text);
    return { element, text };
  }
}

/**
 * The run of shown columns around `column` at level `depth`: those held at
 * its edge (or none) whose headings agree with its own, by id, at that level
 * and every level above (or that have none there, as it has none).
 */
function runOf(layout: readonly PlacedColumn[], column: number, depth: number): [number, number] {
  const { pinned, headings } = layout[column]!;
  const path = headings.length > depth ? headings.slice(0, depth + 1) : null;
  const same = (at: number) => {
    const other = layout[at]!;
    if (other.pinned !== pinned) return false;
    if (!path) return other.headings.length <= depth;
    return (
      other.headings.length > depth &&
      path.every((heading, k) => other.headings[k]!.id === heading.id)
    );
  };
  let start = column;
  while (start > 0 && same(start - 1)) start--;
  let end = column + 1;
  while (end < layout.length && same(end)) end++;
  return [start, end];
}
