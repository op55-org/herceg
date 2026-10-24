// The drawings of marks' text: text labels at points, and labels in styles
// of their own. Their markup is draw/text.ts's, their painting on a canvas
// draw/text-items.ts's.

import { lineCount } from "../layout/text.ts";
import type { Drawing, TextGeometry } from "../scene/scene.ts";
import { cssFont } from "../style/style.ts";
import { escapeXml } from "./markup.ts";
import { haloAttributes, textElement, textItemMarkup } from "./text.ts";
import { baselineDrop, labelsDrawingOf, paintLines } from "./text-items.ts";

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

/** Labels in styles of their own, as positioned text items (boxes, fonts, sizes). */
export const labelsDrawing = labelsDrawingOf(textItemMarkup);
