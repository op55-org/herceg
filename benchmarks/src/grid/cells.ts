// The cells scenarios' cells, which every grid is configured to draw: five
// columns of the first screen draw more than their text.
//
//   c0  the label in a chip, filled by label ("active" and "blocked"; a faint
//       default otherwise), its text black or white, whichever contrasts more
//   n0  a bar from 0 within 0..1000
//   n1  a link to https://example.com/items/<value>, opening in a new tab
//   n3  a symbol before the text: a triangle over 1000, a circle otherwise
//   n4  a bar from 0 within the extent of every row (0 included)
//
// Every cell still writes its value's text, and missing values draw only
// that. What a grid drew is read back as a `CellContent`: from the DOM for
// DOM grids, from what drawing was given for a canvas grid. The helpers here
// are the competitors' adapters', which draw cells in adapter code (a bar's
// ends, a chip's fill and ink, a link's URL, a symbol's path); the reference
// (reference.ts) shares only the constants and works content out on its own.

import type { GridTable } from "./fixture.ts";
import { sameColor } from "./looks.ts";

export type Shape = "circle" | "triangle";

/** What a cell draws beyond its text; undefined for a cell drawing only text. */
export type CellContent =
  | { kind: "bar"; start: number; end: number }
  | { kind: "chip"; fill: string | undefined }
  | { kind: "link"; href: string }
  | { kind: "symbol"; shape: Shape };

export const CHIP_FILLS: Readonly<Record<string, string>> = {
  active: "#2e7d32",
  blocked: "#c62828",
};
export const N0_DOMAIN = [0, 1000] as const;
export const LINK_URL = "https://example.com/items/";
export const N3_OVER = 1000;
/** The fields drawing more than text. */
export const CELL_FIELDS = ["c0", "n0", "n1", "n3", "n4"] as const;

/** The extent of `field`'s finite values, with 0 included: n4's bar's domain. */
export function extentOf(table: GridTable, field: string): readonly [number, number] {
  const values = table.columns[table.fields.findIndex((one) => one.name === field)]!;
  let low = 0;
  let high = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (value < low) low = value;
    else if (value > high) high = value;
  }
  return [low, high];
}

/** A bar's ends for `value` from 0, as fractions of [low, high]; undefined for missing values. */
export function barEnds(
  value: number,
  [low, high]: readonly [number, number],
): readonly [number, number] | undefined {
  if (Number.isNaN(value) || !(high > low)) return undefined;
  const at = (x: number) => Math.min(1, Math.max(0, (x - low) / (high - low)));
  const base = at(0);
  const end = at(value);
  return end < base ? [end, base] : [base, end];
}

export const shapeOf = (n3: number): Shape | undefined =>
  Number.isNaN(n3) ? undefined : n3 > N3_OVER ? "triangle" : "circle";

/** A symbol of 64 square pixels about the origin. */
const RADIUS = Math.sqrt(64 / Math.PI);
/** Each shape's SVG path data, as drawn about the center of an 11-pixel box. */
export const SHAPE_PATHS: Readonly<Record<Shape, string>> = {
  circle: `M${-RADIUS} 0a${RADIUS} ${RADIUS} 0 1 1 ${2 * RADIUS} 0a${RADIUS} ${RADIUS} 0 1 1 ${-2 * RADIUS} 0`,
  triangle: `M0 ${-RADIUS}L${RADIUS * 0.866} ${RADIUS / 2}L${-RADIUS * 0.866} ${RADIUS / 2}Z`,
};
export const SYMBOL_BOX = 11;

/** WCAG's relative luminance of "#rrggbb". */
function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Black or white text over `fill`, whichever has the higher contrast. */
export function inkOver(fill: string): string {
  const l = luminance(fill);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#ffffff";
}

/**
 * CSS of the cells competitors' adapters draw in the DOM (`.bc-*`): a bar
 * behind the text within the cell's padding, a chip, a link, a symbol.
 */
export const DOM_CELL_CSS = `
.bc-react{width:100%;height:100%}
.bc-cell{position:relative;display:flex;align-items:center;width:100%;height:100%;min-width:0}
.bc-text{position:relative;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bc-bar{position:absolute;top:4px;bottom:4px;left:calc(var(--bc-start)*100%);width:calc((var(--bc-end) - var(--bc-start))*100%);background:#2196f3;opacity:0.4}
.bc-chip{padding:2px 8px;border-radius:9px;background:rgba(104,104,104,0.22)}
.bc-link{color:#1565c0}
.bc-symbol{flex:none;margin-inline-end:6px;fill:#2196f3;overflow:visible}
`;

/** What `domCell` draws in an element for one row: the field's content and the text. */
export function fillDomCell(
  element: HTMLElement,
  field: string,
  text: string,
  value: number | string | undefined,
  n4: readonly [number, number],
): void {
  const document = element.ownerDocument;
  const span = (className: string) => {
    const made = document.createElement("span");
    made.className = className;
    return made;
  };
  element.className = "bc-cell";
  element.replaceChildren();
  const missing = value === undefined || (typeof value === "number" && Number.isNaN(value));
  if (missing) {
    element.append(text);
    return;
  }
  if (field === "c0") {
    const chip = span("bc-chip");
    const fill = CHIP_FILLS[value as string];
    if (fill) {
      chip.style.background = fill;
      chip.style.color = inkOver(fill);
    }
    chip.textContent = text;
    element.append(chip);
  } else if (field === "n1") {
    const link = document.createElement("a");
    link.className = "bc-link";
    link.href = `${LINK_URL}${encodeURIComponent(String(value))}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = text;
    element.append(link);
  } else if (field === "n3") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "bc-symbol");
    svg.setAttribute("width", String(SYMBOL_BOX));
    svg.setAttribute("height", String(SYMBOL_BOX));
    svg.setAttribute(
      "viewBox",
      `${-SYMBOL_BOX / 2} ${-SYMBOL_BOX / 2} ${SYMBOL_BOX} ${SYMBOL_BOX}`,
    );
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", SHAPE_PATHS[shapeOf(value as number)!]);
    svg.append(path);
    const label = span("bc-text");
    label.textContent = text;
    element.append(svg, label);
  } else {
    const ends = barEnds(value as number, field === "n0" ? N0_DOMAIN : n4)!;
    const bar = span("bc-bar");
    bar.style.setProperty("--bc-start", String(ends[0]));
    bar.style.setProperty("--bc-end", String(ends[1]));
    const label = span("bc-text");
    label.textContent = text;
    element.append(bar, label);
  }
}

/** Reads what `fillDomCell`, or a library's own DOM like it, drew in a cell. */
export function domContent(cell: Element): CellContent | undefined {
  const bar = cell.querySelector<HTMLElement>(".bc-bar");
  if (bar)
    return {
      kind: "bar",
      start: Number(bar.style.getPropertyValue("--bc-start")),
      end: Number(bar.style.getPropertyValue("--bc-end")),
    };
  const chip = cell.querySelector<HTMLElement>(".bc-chip");
  if (chip) return { kind: "chip", fill: chip.style.backgroundColor || undefined };
  const link = cell.querySelector("a[href]");
  if (link) return { kind: "link", href: link.getAttribute("href")! };
  const path = cell.querySelector(".bc-symbol path");
  if (path) {
    const d = path.getAttribute("d");
    const shape = (Object.keys(SHAPE_PATHS) as Shape[]).find((one) => SHAPE_PATHS[one] === d);
    return shape ? { kind: "symbol", shape } : undefined;
  }
  return undefined;
}

/** Whether two contents are the same: bars' ends within a millionth, chips' fills as colors. */
export function sameContent(a: CellContent | undefined, b: CellContent | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "bar" && b.kind === "bar")
    return Math.abs(a.start - b.start) < 1e-6 && Math.abs(a.end - b.end) < 1e-6;
  if (a.kind === "chip" && b.kind === "chip") return sameColor(a.fill, b.fill);
  return JSON.stringify(a) === JSON.stringify(b);
}
