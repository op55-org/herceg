// Legends of continuous color scales. Marks that color by a ramp add one to
// the chart's legend; it brings its layout, drawing, and description, so
// charts without ramps carry none of this code.

import { escapeXml, n, rectMarkup } from "../draw/markup.ts";
import { formatNumber } from "../format/format.ts";
import { centeredLines, textHeight, textItem, textWidth } from "../layout/text.ts";
import type { LegendFlowItem, LegendOut, LegendPart, LegendText } from "../model/legend.ts";
import { fraction } from "../scale/color.ts";
import {
  LEGEND_SWATCH,
  type RampGuide,
  type RampItem,
  rampOffsets,
  type TextItem,
} from "../scene/scene.ts";
import type { TextPaint } from "../style/style.ts";
import type { ColorRamp } from "./mark.ts";

const LEGEND_GAP = 16;
const RAMP_WIDTH = 120;

/** Text at the middle of its row, its lines centered there. */
const label = (x: number, y: number, line: string, paint: TextPaint, text: LegendText): TextItem =>
  textItem(
    line,
    centeredLines(line, { x, y, anchor: "start", baseline: "middle", angle: 0 }, paint),
    paint,
    text.surface,
    text.measure,
  );

/** A ramp as SVG: a rectangle filled with a gradient of its stops, the gradient's id `id`. */
function rampMarkup(item: RampItem, id: string): string {
  const stops = item.stops
    .map(
      (color, i) =>
        `<stop offset="${n(item.offsets[i]! * 100)}%" stop-color="${escapeXml(color)}"/>`,
    )
    .join("");
  return `<defs><linearGradient id="${id}">${stops}</linearGradient></defs>${rectMarkup(item, item.radius, ` fill="url(#${id})"`)}`;
}

/** The legend of a continuous color scale: its title, low value, ramp, and high value in a row. */
export function rampLegend(ramp: ColorRamp): LegendPart {
  const { title, domain, midpoint, stops, field } = ramp;
  // Values as the field's display writes them, else as the chart's numbers.
  const writer = (locale: string | undefined) =>
    field?.writer() ?? ((value: number) => formatNumber(value, locale));
  const key = `ramp|${title}|${domain.join()}|${midpoint}|${stops.join()}`;
  const [lo, hi] = domain;
  // Where the midpoint falls between the ends, for diverging ramps.
  const middle =
    midpoint === undefined
      ? undefined
      : hi > lo
        ? Math.min(1, Math.max(0, fraction(midpoint, lo, hi)))
        : 0.5;
  const offsets = rampOffsets(stops, middle);
  return {
    key,
    colorbar: { kind: "ramp", ramp, offsets },
    items(text: LegendText, out: LegendOut): LegendFlowItem[] {
      const { measure, lineHeight, locale } = text;
      const write = writer(locale);
      const low = write(lo);
      const high = write(hi);
      const titleWidth = textWidth(title, text.title, measure) + 10;
      const lowWidth = textWidth(low, text.value, measure) + 6;
      const at = out.guides.length;
      out.guides.push(placeRamp(0, 0));
      function placeRamp(x: number, y: number): RampGuide {
        const start = x + titleWidth + lowWidth;
        return {
          kind: "ramp",
          key,
          stops,
          middle,
          y,
          title: { text: title, x },
          low: { text: low, x: x + titleWidth },
          ramp: { x: start, width: RAMP_WIDTH },
          high: { text: high, x: start + RAMP_WIDTH + 6 },
          rampMarkup,
          items: [
            label(x, y, title, text.title, text),
            label(x + titleWidth, y, low, text.value, text),
            {
              type: "ramp",
              x: start,
              y: y - LEGEND_SWATCH / 2,
              width: RAMP_WIDTH,
              height: LEGEND_SWATCH,
              radius: 2,
              stops,
              offsets,
            },
            label(start + RAMP_WIDTH + 6, y, high, text.value, text),
          ],
        };
      }
      return [
        {
          width: titleWidth + lowWidth + RAMP_WIDTH + 6 + textWidth(high, text.value, measure),
          height: Math.max(lineHeight, textHeight(text.title, title), textHeight(text.value)),
          gap: LEGEND_GAP,
          place: (x, y) => {
            out.guides[at] = placeRamp(x, y);
          },
        },
      ];
    },
    describe(locale: string | undefined): string {
      const f = writer(locale);
      const middle = midpoint === undefined ? "" : `, diverging at ${f(midpoint)}`;
      return `Color shows ${title} from ${f(domain[0])} to ${f(domain[1])}${middle}.`;
    },
  };
}
