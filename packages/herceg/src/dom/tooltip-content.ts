// What charts load for tooltips that show more than their marks' names and
// values: the fields of rows marks' tooltips show (`tooltip.fields`) and
// their rows of parts (`tooltip.content`), which inspections carry, drawn
// in the tooltip's box, and content of the application's own
// (`renderTooltip`) in it. It imports only types of the chart's modules.

import type { RowLink } from "../fields/links.ts";
import type { ContentRun } from "../marks/tooltip-fields.ts";
import type { Inspection } from "../model/model.ts";
import type { Theme } from "../theme.ts";
import type { RenderTooltip, Tooltip } from "./tooltip.ts";

/**
 * Makes the chart's tooltip, `tooltip`, show the fields of the rows its
 * points are, and the content `render()` returns in its box (the built-in
 * content where it returns none). `render`'s content is asked for again
 * only when what the tooltip is at changes, the chart's options or data
 * do (`revision()`: the marks and rows an inspection names), it is pinned
 * or let go (`pinned()`), or the content left the box; the box is placed
 * again as that content changes size, as frameworks render it. Fields'
 * links are links in the built-in content while it is pinned. Returns
 * what stops watching its size.
 */
export function ownContent(
  tooltip: Tooltip,
  render: () => RenderTooltip | undefined,
  revision: () => number,
  pinned: () => boolean,
): () => void {
  const { element } = tooltip;
  const document = element.ownerDocument;
  let shown: unknown[] = [];
  let at: [{ x: number; y: number }, { width: number; height: number }] | undefined;
  /** As the built-in tooltip is placed: right of the pointer, flipped when it would overflow the chart. */
  const place = () => {
    if (!at || element.style.display === "none") return;
    const [pointer, bounds] = at;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    let x = pointer.x + 14;
    if (x + width > bounds.width) x = Math.max(0, pointer.x - 14 - width);
    const y = Math.min(Math.max(0, pointer.y - height / 2), Math.max(0, bounds.height - height));
    element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  const resized = new ResizeObserver(place);
  resized.observe(element);
  /**
   * The built-in content, each point's row (its name and value, or its
   * content's runs, each in its part's style) followed by its fields',
   * which line up under its label; a field's link is written as its text,
   * and is a link once the tooltip is pinned (`linked`), when it takes the
   * pointer.
   */
  const builtIn = (inspection: Inspection, theme: Theme, linked: boolean, own: number) => {
    const header = document.createElement("div");
    header.textContent = inspection.label;
    // Line breaks in labels break the tooltip's lines too.
    header.style.cssText = `color:${theme.muted};margin-bottom:2px;white-space:pre`;
    element.append(header);
    // A point's swatch is its series', and its label reads as its name; a field's is its value's.
    const row = (
      name: string,
      text: string,
      color?: string,
      field = false,
      link?: RowLink,
      bold = false,
      runs?: readonly ContentRun[],
    ) => {
      const line = document.createElement("div");
      line.style.cssText = "display:flex;align-items:center;gap:6px;white-space:pre";
      const swatch = document.createElement("span");
      swatch.style.cssText = `width:8px;height:8px;border-radius:2px;background:${color ?? "none"};flex:none`;
      const label = document.createElement("span");
      label.textContent = name;
      label.style.cssText = `flex:1;color:${color && !field ? theme.text : theme.muted}${bold ? ";font-weight:600" : ""}`;
      if (runs) {
        // The content's runs in place of the name and value, each part in its style.
        label.textContent = "";
        for (const { text, style } of runs) {
          const run = document.createElement("span");
          run.textContent = text;
          if (style) {
            const { fontSize, fontWeight, fontStyle, color, opacity } = style;
            Object.assign(run.style, {
              fontSize: fontSize === undefined ? "" : `${fontSize}px`,
              fontWeight: fontWeight ?? "",
              fontStyle: fontStyle ?? "",
              color: color ?? "",
              opacity: opacity ?? "",
            });
          }
          label.append(run);
        }
        line.append(swatch, label);
        element.append(line);
        return;
      }
      const anchor = !!link && linked;
      const value = document.createElement(anchor ? "a" : "span");
      value.textContent = link?.text ?? text;
      value.style.cssText = "font-weight:600;margin-left:12px;color:inherit";
      if (anchor) {
        // Its URL is http, https, mailto, or relative (fields/links.ts); it
        // opens beside the chart, which keeps its state, and knows nothing of it.
        const a = value as HTMLAnchorElement;
        a.href = link.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      line.append(swatch, label, value);
      element.append(line);
    };
    for (const [i, point] of inspection.points.entries()) {
      row(point.label, point.text, point.color, false, undefined, i === own, point.content);
      for (const field of point.fields ?? [])
        row(field.label, field.text, field.color, true, field.link);
    }
  };
  tooltip.show = (inspection, theme, pointer, bounds, ownRow = -1) => {
    const own = render();
    const linked = pinned();
    const key = JSON.stringify([inspection, ownRow]);
    const revised = revision();
    // A framework may have taken its content out of the box (a snippet removed and given again).
    const kept = !(shown[5] instanceof Node) || element.contains(shown[5]);
    const changed =
      own !== shown[0] || theme !== shown[1] || key !== shown[2] || revised !== shown[3] || !kept;
    // The built-in content's links are links while pinned: it is drawn again
    // as the pin changes, the application's content not asked for again.
    if (changed || (shown[4] !== undefined && linked !== shown[4])) {
      element.style.background = theme.style.tooltip.fill;
      element.style.color = theme.text;
      element.style.border = `1px solid ${theme.style.tooltip.stroke}`;
      element.style.boxShadow =
        "0 1px 2px rgba(16, 24, 40, 0.06), 0 6px 16px rgba(16, 24, 40, 0.12)";
      element.style.font = `${theme.fontSize}px ${theme.font}`;
      const page = element.getRootNode() as Document | ShadowRoot;
      const focused = page.activeElement as HTMLElement | null;
      const within = focused !== element && element.contains(focused);
      // Links as drawn, live: the one with the focus is found again by its place.
      const links = element.getElementsByTagName("a");
      const at = Array.prototype.indexOf.call(links, focused);
      element.replaceChildren();
      const content = changed ? own?.(inspection) : null;
      // Text is shown as text, never parsed as markup.
      if (content != null) element.append(content);
      else builtIn(inspection, theme, linked, ownRow);
      // Whether the built-in content was drawn pinned; a fragment leaves its
      // children in the box, not itself.
      shown = [
        own,
        theme,
        key,
        revised,
        content == null ? linked : undefined,
        content instanceof Node ? element.firstChild : undefined,
      ];
      // The focus stays in a pinned tooltip whose content is drawn again:
      // on the control it was on if the new content has it, else on the
      // built-in content's link in its place, else on the box.
      if (within && !element.contains(page.activeElement))
        (element.contains(focused) ? focused! : (content == null && links[at]) || element).focus({
          preventScroll: true,
        });
    }
    element.style.display = "block";
    at = [pointer, bounds];
    place();
  };
  return () => resized.disconnect();
}
