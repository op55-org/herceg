// What charts load for tooltips that show more than their marks' values:
// the fields of rows marks' tooltips show (`tooltip.fields`), read and
// written for inspections, and content of the application's own
// (`renderTooltip`) in the tooltip's box. It imports only types of the
// chart's modules, and writes with the chart's code handed in (the kit), so
// that loading it later shares no code with the chart's own.

import type { Formatter } from "../format/format.ts";
import { intlWrites } from "../format/intl-options.ts";
import { formatWriter, formOf } from "../format/patterns.ts";
import type { FieldReaders, InspectedField } from "../marks/tooltip-fields.ts";
import type { Inspection } from "../model/model.ts";
import type { Theme } from "../theme.ts";
import type { RenderTooltip, Tooltip } from "./tooltip.ts";

const DATE_TIME = { dateStyle: "medium", timeStyle: "short" } as const;

/**
 * Reads tooltip fields in a chart's locale and zone, through the chart's
 * field displays (missing values, mappings, labels): written with their
 * formats (any form of their kind's, `FormatSpec`), else their displays',
 * else numbers as the chart's other numbers, and times as `times` does (the
 * x axis' formatter, on time axes) or as dates and times. A format of the
 * wrong kind is refused as it is first read, as a malformed one is.
 */
export const fieldReader: FieldReaders = (locale, zone, kit, features, times) => {
  const numbers = (value: number) => kit.formatNumber(value, locale);
  const formats = new Map<string, Formatter>();
  const fallback = (kind: string): Formatter =>
    kind === "number" ? numbers : (times ?? kit.timeFormatter(DATE_TIME, zone, locale));
  const write = (field: string, kind: InspectedField["kind"], format: object, at: string) => {
    const key = `${kind} ${JSON.stringify(format)}`;
    let formatter = formats.get(key);
    if (!formatter) {
      formatter = formatWriter(kit, format, kind === "time", zone, locale, at);
      const form = formOf(format, at);
      // As a display's format of the wrong kind is refused (fields/check.ts, `misfit`).
      if (
        kind === "category" ||
        (form === "intl" ? !intlWrites(format, kind) : (form === "time") !== (kind === "time"))
      )
        throw new Error(
          `${at}: ${JSON.stringify(field)} holds ${kind === "category" ? "categories" : `${kind}s`}; ${
            kind === "category"
              ? "formats are for numbers and times; drop format"
              : kind === "time"
                ? "give { time } or Intl date options"
                : "give a number format"
          }`,
        );
      formats.set(key, formatter);
    }
    return formatter;
  };
  return (mark, row) =>
    mark?.spec.tooltip?.fields?.map((entry, i) => {
      const table = mark.table!;
      const { field, label, format } = typeof entry === "string" ? { field: entry } : entry;
      const value = table.value(field, row);
      const kind = table.kind(field) as InspectedField["kind"];
      const own = format && write(field, kind, format, `tooltip.fields[${i}].format`);
      const shown = features?.fields?.of(table, field);
      // Times beyond what dates hold (an infinity among them) have no date to write.
      const text = shown
        ? shown.writer(own, fallback(kind))(value)
        : value === null || (kind === "time" && !(Math.abs(value as number) <= 8.64e15))
          ? "–"
          : typeof value === "string"
            ? value
            : (own ?? fallback(kind))(value);
      const color = shown?.color?.(value);
      const read: InspectedField = {
        field,
        label: label ?? shown?.label ?? field,
        kind,
        value,
        text,
      };
      if (color !== undefined) read.color = color;
      return read;
    });
};

/**
 * Makes the chart's tooltip, `tooltip`, show the fields of the rows its
 * points are, and the content `render()` returns in its box (the built-in
 * content where it returns none). `render`'s content is asked for again
 * only when what the tooltip is at changes, the chart's options or data
 * do (`revision()`: the marks and rows an inspection names), or the
 * content left the box; the box is placed again as that content changes
 * size, as frameworks render it. Returns what stops watching its size.
 */
export function ownContent(
  tooltip: Tooltip,
  render: () => RenderTooltip | undefined,
  revision: () => number,
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
  /** The built-in content, each point's row followed by its fields', which line up under its label. */
  const builtIn = (inspection: Inspection, theme: Theme) => {
    const header = document.createElement("div");
    header.textContent = inspection.label;
    // Line breaks in labels break the tooltip's lines too.
    header.style.cssText = `color:${theme.muted};margin-bottom:2px;white-space:pre`;
    element.append(header);
    // A point's swatch is its series', and its label reads as its name; a field's is its value's.
    const row = (name: string, text: string, color?: string, field = false) => {
      const line = document.createElement("div");
      line.style.cssText = "display:flex;align-items:center;gap:6px;white-space:pre";
      const swatch = document.createElement("span");
      swatch.style.cssText = `width:8px;height:8px;border-radius:2px;background:${color ?? "none"};flex:none`;
      const label = document.createElement("span");
      label.textContent = name;
      label.style.cssText = `flex:1;color:${color && !field ? theme.text : theme.muted}`;
      const value = document.createElement("span");
      value.textContent = text;
      value.style.cssText = "font-weight:600;margin-left:12px";
      line.append(swatch, label, value);
      element.append(line);
    };
    for (const point of inspection.points) {
      row(point.label, point.text, point.color);
      for (const field of point.fields ?? []) row(field.label, field.text, field.color, true);
    }
  };
  tooltip.show = (inspection, theme, pointer, bounds) => {
    const own = render();
    const key = JSON.stringify(inspection);
    const revised = revision();
    // A framework may have taken its content out of the box (a snippet removed and given again).
    const kept = !(shown[4] instanceof Node) || element.contains(shown[4]);
    if (
      own !== shown[0] ||
      theme !== shown[1] ||
      key !== shown[2] ||
      revised !== shown[3] ||
      !kept
    ) {
      shown = [own, theme, key, revised];
      element.style.background = theme.style.tooltip.fill;
      element.style.color = theme.text;
      element.style.border = `1px solid ${theme.style.tooltip.stroke}`;
      element.style.boxShadow =
        "0 1px 2px rgba(16, 24, 40, 0.06), 0 6px 16px rgba(16, 24, 40, 0.12)";
      element.style.font = `${theme.fontSize}px ${theme.font}`;
      const page = element.getRootNode() as Document | ShadowRoot;
      const focused = page.activeElement as HTMLElement | null;
      const within = focused !== element && element.contains(focused);
      element.replaceChildren();
      const content = own?.(inspection);
      // Text is shown as text, never parsed as markup.
      if (content != null) element.append(content);
      else builtIn(inspection, theme);
      // A fragment leaves its children in the box, not itself.
      shown.push(content instanceof Node ? element.firstChild : undefined);
      // The focus stays in a pinned tooltip whose content is drawn again:
      // on the control it was on if the new content has it, else on the box.
      if (within && !element.contains(page.activeElement))
        (element.contains(focused) ? focused! : element).focus({ preventScroll: true });
    }
    element.style.display = "block";
    at = [pointer, bounds];
    place();
  };
  return () => resized.disconnect();
}
