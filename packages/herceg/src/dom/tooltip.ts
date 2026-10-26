import type { Inspection } from "../model/model.ts";
import type { Theme } from "../theme.ts";

/**
 * The tooltip's content, of your own (JavaScript only): text, or a node to
 * show in the box; null or undefined for the built-in content. A node's
 * content may change later, as frameworks render it: the box keeps its
 * place as its size changes.
 */
export type RenderTooltip = (inspection: Inspection) => string | Node | null | undefined;

/**
 * The tooltip's box. Charts with tooltip fields or `renderTooltip` show it
 * through the `show` of dom/tooltip-content.ts, which draws them.
 */
export class Tooltip {
  readonly element: HTMLDivElement;
  /** The theme the box and its rows are styled with, and each row's swatch color. */
  #theme: Theme | undefined;
  #colors: string[] = [];

  constructor(document: Document) {
    this.element = document.createElement("div");
    // The live region announces what the tooltip shows; read here too, it would repeat it.
    this.element.setAttribute("aria-hidden", "true");
    this.element.style.cssText =
      "position:absolute;left:0;top:0;pointer-events:none;display:none;white-space:nowrap;padding:8px 10px;border-radius:8px;line-height:1.4;z-index:1;font-variant-numeric:tabular-nums";
  }

  show(
    inspection: Inspection,
    theme: Theme,
    pointer: { x: number; y: number },
    bounds: { width: number; height: number },
  ) {
    const { element } = this;
    const document = element.ownerDocument;
    // Rows are kept from one move to the next and only what changed in them
    // is written: rebuilding them costs Firefox about 2 ms per move.
    if (theme !== this.#theme) {
      this.#theme = theme;
      element.style.background = theme.style.tooltip.fill;
      element.style.color = theme.text;
      element.style.border = `1px solid ${theme.style.tooltip.stroke}`;
      element.style.boxShadow =
        "0 1px 2px rgba(16, 24, 40, 0.06), 0 6px 16px rgba(16, 24, 40, 0.12)";
      element.style.font = `${theme.fontSize}px ${theme.font}`;
      element.replaceChildren();
      this.#colors = [];
    }
    let header = element.firstElementChild as HTMLDivElement | null;
    if (!header) {
      header = document.createElement("div");
      // Line breaks in labels break the tooltip's lines too.
      header.style.cssText = `color:${theme.muted};margin-bottom:2px;white-space:pre`;
      element.append(header);
    }
    write(header, inspection.label);
    const { points } = inspection;
    while (element.childElementCount > points.length + 1) element.lastElementChild!.remove();
    this.#colors.length = points.length;
    points.forEach((point, i) => {
      let row = element.children[i + 1];
      if (!row) {
        row = document.createElement("div");
        (row as HTMLDivElement).style.cssText =
          "display:flex;align-items:center;gap:6px;white-space:pre";
        const swatch = document.createElement("span");
        swatch.style.cssText = "width:8px;height:8px;border-radius:2px;flex:none";
        const label = document.createElement("span");
        label.style.flex = "1";
        const value = document.createElement("span");
        value.style.cssText = "font-weight:600;margin-left:12px";
        row.append(swatch, label, value);
        element.append(row);
      }
      const [swatch, label, value] = row.children as unknown as HTMLSpanElement[];
      if (this.#colors[i] !== point.color) swatch!.style.background = this.#colors[i] = point.color;
      write(label!, point.label);
      write(value!, point.text);
    });
    element.style.display = "block";
    // Right of the pointer, flipped when it would overflow the chart.
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    let x = pointer.x + 14;
    if (x + width > bounds.width) x = Math.max(0, pointer.x - 14 - width);
    const y = Math.min(Math.max(0, pointer.y - height / 2), Math.max(0, bounds.height - height));
    element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  hide() {
    this.element.style.display = "none";
  }
}

function write(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

/** Plain-text version of an inspection for screen reader announcements. */
export function describeInspection(inspection: Inspection): string {
  return [
    inspection.label,
    ...inspection.points.map(
      ({ label, text, fields = [] }) =>
        `${label}: ${[text, ...fields.map((field) => `${field.label}: ${field.text}`)].join(", ")}`,
    ),
  ].join(". ");
}
