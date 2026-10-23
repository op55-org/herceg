import { lineCount } from "../layout/text.ts";
import type { Drawing, LabelsGeometry, TextGeometry, TextItem } from "../scene/scene.ts";
import { cssFont, type ResolvedHalo } from "../style/style.ts";
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

/** Text labels, with a halo when asked; labels of several lines are centered on their point. */
export const textDrawing: Drawing<TextGeometry> = {
  canvas(context, mark, { theme }) {
    const { lineHeight } = theme.style.text;
    const c = mark.coords;
    const style = { anchor: mark.anchor, fill: mark.fill, halo: mark.halo, lineHeight };
    context.save();
    context.font = cssFont(theme.font, theme.fontSize);
    const drop = baselineDrop(context, "middle");
    for (let i = 0; i < mark.count; i++) {
      const label = mark.labels[i]!;
      const first = c[i * 2 + 1]! - ((lineCount(label) - 1) * lineHeight) / 2;
      paintLines(context, label, c[i * 2]!, first + drop, style);
    }
    context.restore();
  },
  defaultClip: false,
  size: () => 0,
  svg(mark, { theme }) {
    const halo = mark.halo ? haloAttributes(mark.halo) : "";
    const c = mark.coords;
    const { lineHeight } = theme.style.text;
    let out = `<g fill="${escapeXml(mark.fill)}" text-anchor="${mark.anchor}"${halo}>`;
    for (let i = 0; i < mark.count; i++) {
      const label = mark.labels[i]!;
      const first = c[i * 2 + 1]! - ((lineCount(label) - 1) * lineHeight) / 2;
      out += textElement(
        label,
        c[i * 2]!,
        first,
        lineHeight,
        ' dominant-baseline="middle"',
        "middle",
      );
    }
    return `${out}</g>`;
  },
};

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

/** Labels in styles of their own, as positioned text items (boxes, fonts, sizes). */
export const labelsDrawing: Drawing<LabelsGeometry> = {
  canvas(context, mark) {
    for (const item of mark.items) paintTextItem(context, item);
  },
  defaultClip: false,
  size: () => 0,
  svg(mark, { theme }) {
    let out = "";
    for (const item of mark.items) out += textItemMarkup(item, theme);
    return out;
  },
};

const ALIGN = { start: "left", middle: "center", end: "right" } as const;

/**
 * How far below a text's `y` a canvas draws its alphabetic baseline, for
 * text placed by its middle or hanging from its top as SVG places it: half
 * the font's x-height below the middle, and 0.8 of its ascent below the
 * top, as browsers place SVG text (a canvas' own "middle" and "hanging"
 * baselines land up to a pixel or two elsewhere). Read from the context's
 * current font each time it is drawn, so fonts loading later count.
 */
export function baselineDrop(
  context: CanvasRenderingContext2D,
  baseline: TextItem["baseline"],
): number {
  if (baseline === "alphabetic") return 0;
  const metrics = context.measureText("x");
  return baseline === "middle"
    ? metrics.actualBoundingBoxAscent / 2
    : 0.8 * metrics.fontBoundingBoxAscent;
}

/**
 * Draws `text` in the context's font, a line each as "\n" breaks it, the
 * first's alphabetic baseline at `y` and each `lineHeight` below the last,
 * over its halo when it has one.
 */
export function paintLines(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: {
    anchor: TextItem["anchor"];
    fill: string;
    halo: ResolvedHalo | undefined;
    lineHeight: number;
    opacity?: number;
  },
): void {
  const { halo, lineHeight } = style;
  // Over the alpha the text is drawn in (a highlight's dimming).
  const base = context.globalAlpha;
  const opacity = base * (style.opacity ?? 1);
  context.textAlign = ALIGN[style.anchor];
  context.textBaseline = "alphabetic";
  const lines = text.split("\n");
  // A width of 0 strokes nothing, as in SVG and PDF; the canvas would keep its last width.
  if (halo && halo.width > 0) {
    context.globalAlpha = opacity * halo.opacity;
    context.strokeStyle = halo.color;
    context.lineWidth = halo.width;
    context.lineJoin = "round";
    lines.forEach((line, i) => {
      context.strokeText(line, x, y + i * lineHeight);
    });
  }
  context.globalAlpha = opacity;
  context.fillStyle = style.fill;
  lines.forEach((line, i) => {
    context.fillText(line, x, y + i * lineHeight);
  });
  context.globalAlpha = base;
}

/** Draws a text item as SVG and PDF draw it: its box, then its text over its halo, turned about its point. */
export function paintTextItem(context: CanvasRenderingContext2D, item: TextItem): void {
  const { paint } = item;
  context.save();
  if (item.angle) {
    context.translate(item.x, item.y);
    context.rotate((item.angle * Math.PI) / 180);
    context.translate(-item.x, -item.y);
  }
  const box = item.box && paint.background;
  if (box) {
    const { x, y, width, height } = item.box!;
    context.beginPath();
    context.roundRect(x, y, width, height, box.radius ?? 0);
    context.fillStyle = box.fill;
    context.fill();
    // A width of 0 strokes nothing, as in SVG and PDF; the canvas would keep its last width.
    const lineWidth = box.strokeWidth ?? 1;
    if (box.stroke && lineWidth > 0) {
      context.strokeStyle = box.stroke;
      context.lineWidth = lineWidth;
      context.stroke();
    }
  }
  context.font = paint.css;
  paintLines(context, item.text, item.x, item.y + baselineDrop(context, item.baseline), {
    anchor: item.anchor,
    fill: paint.color,
    halo: item.halo,
    lineHeight: paint.lineHeight,
    opacity: paint.opacity * (item.opacity ?? 1),
  });
  context.restore();
}
