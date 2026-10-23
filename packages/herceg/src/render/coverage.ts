// Text an SVG export draws in supplied fonts, checked before it is written.
// A viewer draws text the fonts do not cover in whatever its system has,
// and a rasterizer given only the fonts as boxes, so SVG and PNG refuse it
// as PDF export does: text the theme's font list does not cover, glyph
// after glyph, is an error naming the code point.

import type { MeasureText } from "../layout/text.ts";
import type { GuideItem, MarkGeometry, Scene } from "../scene/scene.ts";
import { cssFont } from "../style/style.ts";

/** Measures every text `scene` draws with `measure`, the fonts', which throws for what they do not cover. */
export function checkCoverage(scene: Scene, measure: MeasureText): void {
  const { theme } = scene;
  const base = cssFont(theme.font, theme.fontSize);
  const items = (list: readonly GuideItem[]) => {
    for (const item of list) if (item.type === "text") measure(item.text, item.paint.css);
  };
  for (const { axes, marks } of scene.panels) {
    for (const axis of axes) items(axis.items);
    for (const mark of marks as MarkGeometry[])
      if (mark.kind === "text") for (const label of mark.labels) measure(label, base);
      else if (mark.kind === "rule" && mark.label) measure(mark.label, base);
      else if (mark.kind === "labels") items(mark.items);
      else if (mark.kind === "shapes")
        for (const shape of mark.shapes) if ("text" in shape) measure(shape.text, mark.font);
  }
  for (const guide of scene.guides) items(guide.items);
}
