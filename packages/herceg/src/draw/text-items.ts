// Text items as canvases paint them, as SVG and PDF draw them, and the
// drawing of labels in styles of their own. Imports nothing of the chart's
// at run time: the feature compiler draws the labels following series with
// it, and the chart hands it the markup of text items, so a chart that
// draws no such labels on a canvas carries none of it.

import type { Drawing, LabelsGeometry, TextItem } from "../scene/scene.ts";
import type { ResolvedHalo } from "../style/style.ts";
import type { Theme } from "../theme.ts";

/** Labels in styles of their own, as positioned text items (boxes, fonts, sizes), whose markup `markup` writes. */
export function labelsDrawingOf(
  markup: (item: TextItem, root: Theme) => string,
): Drawing<LabelsGeometry> {
  return {
    canvas(context, mark) {
      for (const item of mark.items) paintTextItem(context, item);
    },
    defaultClip: false,
    size: () => 0,
    svg(mark, { theme }) {
      let out = "";
      for (const item of mark.items) out += markup(item, theme);
      return out;
    },
  };
}

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
