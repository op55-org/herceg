// Leaders: lines from labels moved away from what they label back to it
// (text, rule, region, and series labels), as segments of one look, dashed
// where their look says. Imports nothing of the chart's at run time: the
// feature compiler draws series labels' leaders with the chart's markup
// handed to it, so a chart that draws no leaders carries none of this.

import type { Drawing, SegmentGeometry, SvgElement } from "../scene/scene.ts";

/** Leaders as SVG elements, with numbers written by `n`. */
function leaderElements(mark: SegmentGeometry, n: (value: number) => string): SvgElement[] {
  const c = mark.coords;
  let d = "";
  for (let i = 0; i < mark.count; i++) {
    const at = i * 4;
    d += `M${n(c[at]!)} ${n(c[at + 1]!)}L${n(c[at + 2]!)} ${n(c[at + 3]!)}`;
  }
  const attributes: Record<string, string> = {
    d,
    fill: "none",
    stroke: mark.stroke,
    "stroke-width": String(mark.strokeWidth),
  };
  if (mark.dash?.length) attributes["stroke-dasharray"] = mark.dash.join(" ");
  if (mark.opacity !== undefined && mark.opacity < 1)
    attributes["stroke-opacity"] = String(mark.opacity);
  return [{ tag: "path", attributes }];
}

/** How leaders draw, with the chart's `markupOf` and number writer `n` (made once for each). */
export function leaderDrawingOf(
  markupOf: (elements: readonly SvgElement[]) => string,
  n: (value: number) => string,
): Drawing<SegmentGeometry> {
  const elements = (mark: SegmentGeometry) => leaderElements(mark, n);
  return {
    canvas(context, mark) {
      if (mark.strokeWidth === 0) return;
      const c = mark.coords;
      context.save();
      context.lineCap = "butt";
      context.setLineDash(mark.dash ? [...mark.dash] : []);
      context.beginPath();
      for (let i = 0; i < mark.count; i++) {
        const at = i * 4;
        context.moveTo(c[at]!, c[at + 1]!);
        context.lineTo(c[at + 2]!, c[at + 3]!);
      }
      context.strokeStyle = mark.stroke;
      context.lineWidth = mark.strokeWidth;
      context.globalAlpha *= mark.opacity ?? 1;
      context.stroke();
      context.restore();
    },
    defaultClip: false,
    size: () => 0,
    elements,
    svg: (mark) => markupOf(elements(mark)),
  };
}
