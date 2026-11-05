// Keys of glyphs as legend parts: point sizes and shapes, category colors,
// and the display colors fields give values (docs/guide/fields.md). The
// layout takes the text helpers it uses (`KeyKit`), so marks' own keys
// (legend-parts.ts), bars' keys (the feature compiler's), and the display
// code's keys of display colors are one implementation, without the lazy
// code importing the chart's modules.

import type { centeredLines, textHeight, textItem, textWidth } from "../layout/text.ts";
import type { LegendFlowItem, LegendOut, LegendPart, LegendText } from "../model/legend.ts";
import type { GuideItem, KeyGuide } from "../scene/scene.ts";
import type { TextPaint } from "../style/style.ts";
import type { GlyphKey } from "./mark.ts";

/** The text helpers a key is laid out with (layout/text.ts), handed in. */
export interface KeyKit {
  readonly textItem: typeof textItem;
  readonly centeredLines: typeof centeredLines;
  readonly textWidth: typeof textWidth;
  readonly textHeight: typeof textHeight;
}

const KEY_GAP = 12;
/** A swatch's side, as scene.ts's `LEGEND_SWATCH` (test/fields/colors.test.ts keeps them equal). */
export const SWATCH = 10;

/**
 * The legend of sizes, shapes, or colors: a row of its own with the title,
 * then each glyph and its label, laid out with `kit`'s text helpers. Glyphs
 * without colors of their own are the value text's color, translucent.
 */
export function keyLegendWith(kit: KeyKit, key: GlyphKey): LegendPart {
  const { textItem, centeredLines, textWidth, textHeight } = kit;
  /** Text at the middle of its row, its lines centered there. */
  const label = (x: number, y: number, line: string, paint: TextPaint, text: LegendText) =>
    textItem(
      line,
      centeredLines(line, { x, y, anchor: "start", baseline: "middle", angle: 0 }, paint),
      paint,
      text.surface,
      text.measure,
    );
  const { title, channel, entries, scale } = key;
  // Keys alike are one, unless they show scales of different names.
  const id = `key|${scale ?? ""}|${title}|${channel}|${entries.map((e) => `${e.label} ${e.glyph} ${e.color}`).join("|")}`;
  return {
    key: id,
    channel,
    scale,
    breaks: true,
    items(text: LegendText, out: LegendOut): LegendFlowItem[] {
      const { measure, lineHeight } = text;
      const legend = {
        kind: "key",
        key: id,
        title: { text: title, x: 0, y: 0 },
        entries: [] as KeyGuide["entries"][number][],
        items: [] as GuideItem[],
      } satisfies KeyGuide;
      out.guides.push(legend);
      out.finish.push(() => {
        legend.items.push(label(legend.title.x, legend.title.y, title, text.title, text));
        for (const { glyph, x, y, fill } of legend.entries)
          legend.items.push(
            fill === undefined
              ? { type: "shape", d: glyph, at: [x, y], fill: text.value.color, fillOpacity: 0.6 }
              : { type: "shape", d: glyph, at: [x, y], fill },
          );
        for (const { y, label: entry } of legend.entries)
          legend.items.push(label(entry.x, y, entry.text, text.value, text));
      });
      const items: LegendFlowItem[] = [
        {
          width: textWidth(title, text.title, measure),
          height: Math.max(lineHeight, textHeight(text.title, title)),
          gap: KEY_GAP,
          breaks: true,
          place: (x, y) => {
            legend.title.x = x;
            legend.title.y = y;
          },
        },
      ];
      for (const { label: entry, glyph, r, color } of entries) {
        const size = Math.max(SWATCH, r * 2);
        items.push({
          width: size + 6 + textWidth(entry, text.value, measure),
          height: Math.max(lineHeight, size + 2, textHeight(text.value, entry)),
          gap: KEY_GAP,
          place: (x, y) =>
            legend.entries.push({
              glyph,
              x: x + size / 2,
              y,
              ...(color !== undefined && { fill: color }),
              label: { text: entry, x: x + size + 6 },
            }),
        });
      }
      return items;
    },
    describe(): string {
      const values = entries.map(({ label: text, shape }) =>
        shape ? `${shape} for ${text}` : text,
      );
      const shows = channel === "size" ? "Size" : channel === "shape" ? "Shape" : "Color";
      return `${shows} shows ${title}: ${values.join(", ")}.`;
    },
  };
}
