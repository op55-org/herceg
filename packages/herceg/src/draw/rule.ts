import type { Drawing, RuleGeometry } from "../scene/scene.ts";
import { cssFont } from "../style/style.ts";
import { dashAttribute, escapeXml, n } from "./markup.ts";
import { paintLines } from "./text.ts";

/**
 * Where a rule's label goes, on its alphabetic baseline: inside the top of
 * a vertical rule, above the right end of a horizontal one.
 */
export function ruleLabel(
  rule: RuleGeometry,
  fontSize: number,
): { x: number; y: number; anchor: "start" | "end" } {
  return rule.x1 === rule.x2
    ? { x: rule.x1 + 4, y: rule.y1 + fontSize, anchor: "start" }
    : { x: rule.x2 - 4, y: rule.y1 - 4, anchor: "end" };
}

/** Reference lines, with their label at the top (vertical) or right end (horizontal). */
export const ruleDrawing: Drawing<RuleGeometry> = {
  canvas(context, rule, { theme }) {
    context.save();
    context.beginPath();
    context.moveTo(rule.x1, rule.y1);
    context.lineTo(rule.x2, rule.y2);
    // As SVG strokes a line: butt ends.
    context.lineCap = "butt";
    context.setLineDash((rule.dash ?? []) as number[]);
    context.strokeStyle = rule.stroke;
    context.lineWidth = rule.strokeWidth;
    // The stroke's opacity is the line's, not its label's (SVG's stroke-opacity).
    const alpha = context.globalAlpha;
    context.globalAlpha = alpha * (rule.opacity ?? 1);
    // A canvas keeps its last width for 0, which SVG and PDF draw as nothing.
    if (rule.strokeWidth > 0) context.stroke();
    context.globalAlpha = alpha;
    context.setLineDash([]);
    if (rule.label) {
      const { x, y, anchor } = ruleLabel(rule, theme.fontSize);
      context.font = cssFont(theme.font, theme.fontSize);
      paintLines(context, rule.label, x, y, {
        anchor,
        fill: theme.muted,
        halo: undefined,
        lineHeight: theme.style.text.lineHeight,
      });
    }
    context.restore();
  },
  defaultClip: false,
  size: () => 0,
  svg(rule, { theme }) {
    const opacity = rule.opacity === undefined ? "" : ` stroke-opacity="${rule.opacity}"`;
    let out = `<line x1="${n(rule.x1)}" y1="${n(rule.y1)}" x2="${n(rule.x2)}" y2="${n(rule.y2)}" stroke="${escapeXml(rule.stroke)}" stroke-width="${rule.strokeWidth}"${dashAttribute(rule.dash)}${opacity}/>`;
    if (rule.label) {
      const { x, y, anchor } = ruleLabel(rule, theme.fontSize);
      out += `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" fill="${escapeXml(theme.muted)}">${escapeXml(rule.label)}</text>`;
    }
    return out;
  },
};
