import type { ContentRun } from "../marks/tooltip-fields.ts";
import type { InspectedPoint, Inspection } from "../model/model.ts";
import type { Theme } from "../theme.ts";

/**
 * The tooltip's content, of your own (JavaScript only): text, or a node to
 * show in the box; null or undefined for the built-in content. A node's
 * content may change later, as frameworks render it: the box keeps its
 * place as its size changes.
 */
export type RenderTooltip = (inspection: Inspection) => string | Node | null | undefined;

/**
 * A tooltip's heading row as runs: the place it reads, or the heading of a
 * point it shows alone (its mark's `tooltip.heading`); undefined for none
 * (the chart's `tooltip.heading: false`). The controller decides it
 * (`headingOf`) and both draws of the box take it as given.
 */
export type TooltipHeading = readonly ContentRun[] | undefined;

/**
 * The heading of a tooltip showing `inspection`: none unless `headed`; a
 * point shown alone, its mark's heading where it has one (`headingSaid`);
 * else the place. Several points keep the place: a heading of one of them
 * would change as the legend hides series.
 */
export function headingOf(inspection: Inspection, headed: boolean): TooltipHeading {
  return headed ? ownHeading(inspection) || [{ text: inspection.label }] : undefined;
}

/** The heading of `inspection`'s one point (its mark's `tooltip.heading`), where it reads one. */
function ownHeading({ points }: Inspection): readonly ContentRun[] | undefined {
  return points.length === 1 ? points[0]!.heading : undefined;
}

/**
 * What the keyboard says of `inspection`'s heading before its point, as
 * "C-12. ": its one point's own, where it reads one point whose mark has
 * one. The place is said too, as always: the heading names the point.
 */
export function headingSaid(inspection: Inspection): string {
  const heading = runsText(ownHeading(inspection));
  return heading ? `${heading}. ` : "";
}

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

  /**
   * Shows `inspection` under `heading` beside `pointer`, within `bounds`;
   * the point at index `own` (the keyboard cursor's) has its label in bold.
   */
  show(
    inspection: Inspection,
    heading: TooltipHeading,
    theme: Theme,
    pointer: { x: number; y: number },
    bounds: { width: number; height: number },
    own = -1,
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
    // A heading's runs are their text alone, until what draws their styles loads.
    header.hidden = !heading;
    write(header, runsText(heading) ?? "");
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
      // A row of content is its text alone, until what draws its parts' styles loads.
      const content = runsText(point.content);
      write(label!, content ?? point.label);
      label!.style.fontWeight = i === own ? "600" : "";
      write(value!, point.text);
      value!.hidden = content !== undefined;
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

/**
 * Plain-text version of an inspection for screen reader announcements: the
 * place, the heading of a point read alone, and the points, leaving out
 * those that write no text.
 */
export function describeInspection(inspection: Inspection): string {
  return [
    inspection.label,
    runsText(ownHeading(inspection)),
    ...inspection.points.map(
      (point) =>
        `${runsText(point.content) ?? `${point.label}: ${point.text}`}${fieldsSpoken(point)}`,
    ),
  ]
    .filter(Boolean)
    .join(". ");
}

/**
 * Runs as text: a point's content (its row as its mark's `tooltip.content`
 * wrote it) or a heading; undefined without runs.
 */
export function runsText(runs: readonly ContentRun[] | undefined): string | undefined {
  return runs?.map((run) => run.text).join("");
}

/** A point's tooltip fields, as announcements read them after its value. */
export function fieldsSpoken({ fields = [] }: InspectedPoint): string {
  return fields.map((field) => `, ${field.label}: ${field.link?.text ?? field.text}`).join("");
}
