import type { TextItem } from "../scene/scene.ts";
import type { ResolvedHalo } from "../style/style.ts";
import type { Theme } from "../theme.ts";
import { escapeXml, n, rectMarkup } from "./markup.ts";

/** SVG attributes of a halo, drawn under the text's fill. */
export function haloAttributes(halo: ResolvedHalo): string {
  return ` stroke="${escapeXml(halo.color)}" stroke-opacity="${halo.opacity}" stroke-width="${halo.width}" stroke-linejoin="round" paint-order="stroke"`;
}

/**
 * An SVG text element with `attributes`: a line each as "\n" breaks
 * `text`, the first at (x, y) and each `lineHeight` below the last. WebKit
 * does not pass a text's `dominant-baseline` on to its lines, so lines
 * name the `baseline` again.
 */
export function textElement(
  text: string,
  x: number,
  y: number,
  lineHeight: number,
  attributes: string,
  baseline = "alphabetic",
): string {
  const at = (line: number) => ` x="${n(x)}" y="${n(y + line * lineHeight)}"`;
  const base = baseline === "alphabetic" ? "" : ` dominant-baseline="${baseline}"`;
  // Lines placed whole, so empty ones keep their room.
  return `<text${at(0)}${attributes}>${
    text.includes("\n")
      ? text
          .split("\n")
          .map((line, i) => `<tspan${at(i)}${base}>${escapeXml(line)}</tspan>`)
          .join("")
      : escapeXml(text)
  }</text>`;
}

/**
 * A text item's markup: only what differs from what the document's root
 * sets (the theme's font and size, and its muted color).
 */
export function textItemMarkup(item: TextItem, root: Theme): string {
  const { paint } = item;
  let out = "";
  if (item.box) {
    const box = paint.background!;
    out += rectMarkup(
      item.box,
      box.radius,
      ` fill="${escapeXml(box.fill)}"${box.stroke ? ` stroke="${escapeXml(box.stroke)}" stroke-width="${box.strokeWidth ?? 1}"` : ""}${rotation(item)}`,
    );
  }
  let attributes = "";
  if (item.anchor !== "start") attributes += ` text-anchor="${item.anchor}"`;
  if (item.baseline !== "alphabetic") attributes += ` dominant-baseline="${item.baseline}"`;
  if (paint.font !== root.font) attributes += ` font-family="${escapeXml(paint.font)}"`;
  if (paint.size !== root.fontSize) attributes += ` font-size="${paint.size}"`;
  if (paint.italic) attributes += ` font-style="italic"`;
  if (paint.weight !== 400) attributes += ` font-weight="${paint.weight}"`;
  if (paint.color !== root.muted) attributes += ` fill="${escapeXml(paint.color)}"`;
  const opacity = paint.opacity * (item.opacity ?? 1);
  if (opacity !== 1) attributes += ` opacity="${opacity}"`;
  if (item.halo) attributes += haloAttributes(item.halo);
  attributes += rotation(item);
  return out + textElement(item.text, item.x, item.y, paint.lineHeight, attributes, item.baseline);
}

function rotation(item: TextItem): string {
  return item.angle ? ` transform="rotate(${item.angle} ${n(item.x)} ${n(item.y)})"` : "";
}
