import type { GridCellContext } from "herceg/grid";

/** What a probing cell's component does as it mounts, updates, and goes. */
export interface Hooks {
  mounted?: (cell: GridCellContext) => void;
  updated?: (cell: GridCellContext) => void;
  destroyed?: (cell: GridCellContext) => void;
}

/** Which of the fixture's snippets draws a column, with its renderer's settings. */
export type Use =
  | Snippets
  | {
      snippet: Snippets;
      fields?: readonly string[];
      interaction?: "text" | "control" | "composite";
    };

export type Snippets =
  | "text"
  | "span"
  | "badge"
  | "counter"
  | "button"
  | "toggle"
  | "input"
  | "throws"
  | "read"
  | "kept"
  | "probe"
  | "fail"
  | "a"
  | "b";
