// Labels of marks in styles of their own: their paint (the theme's text,
// the mark's default color, and the label's style over them), and their
// geometry. Labels in the theme's plain text draw as text marks always have;
// others draw as positioned text items (fonts, sizes, boxes), as guides do.

import { labelHalo } from "../draw/label-halo.ts";
import { labelsDrawing, textDrawing } from "../draw/text.ts";
import { type TextAt, textItem } from "../layout/text.ts";
import type { LabelsGeometry, Rect, TextGeometry } from "../scene/scene.ts";
import type { Frozen } from "../spec/spec.ts";
import type { Halo, TextStyle } from "../spec/style.ts";
import { type TextPaint, textPaint } from "../style/style.ts";
import { surface, type Theme } from "../theme.ts";
import type { Frame } from "./mark.ts";

/**
 * A label's paint: the theme's text, in `color` unless its style sets one,
 * its style over it. Its halo is the mark's (see `labelsGeometry`).
 */
export function labelPaint(
  theme: Theme,
  color: string,
  style: Frozen<TextStyle> | undefined,
): TextPaint {
  return textPaint([theme.roles.text, { color }, style as TextStyle | undefined, { halo: false }]);
}

/** Whether a paint is the theme's plain text: drawn as text marks draw their labels. */
export function plainText(paint: TextPaint, theme: Theme): boolean {
  return (
    paint.font === theme.font &&
    paint.size === theme.fontSize &&
    paint.weight === 400 &&
    !paint.italic &&
    paint.opacity === 1 &&
    paint.lineHeight === theme.style.text.lineHeight &&
    !paint.background
  );
}

/**
 * A label to draw: its text and where its anchor is, with its anchor and
 * baseline. A label of several lines is placed by its first line, the
 * others following a line height apart.
 */
export interface PlacedLabel {
  text: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  baseline: TextAt["baseline"];
  /** The box behind it, where placed with it (see `anchorBlock`); else padded about the text. */
  box?: Rect | undefined;
}

/**
 * The geometry of labels in `paint`: text items, each with `halo` (the
 * label style's, else the mark's; "auto" by default) against what it is
 * drawn on.
 */
export function labelsGeometry(
  key: string,
  labels: readonly PlacedLabel[],
  paint: TextPaint,
  halo: Halo | undefined,
  frame: Frame,
): LabelsGeometry {
  // Text in a box is drawn on the box.
  const ring = labelHalo(
    halo,
    paint.background ? { ...frame, surface: paint.background.fill } : frame,
  );
  const under = frame.surface ?? surface(frame.theme);
  const items = labels.map(({ text, x, y, anchor, baseline, box }) => {
    const at: TextAt = { x, y, anchor, baseline, angle: 0 };
    const item = textItem(text, at, paint, under, frame.measure, box);
    return ring ? { ...item, halo: ring } : item;
  });
  return { kind: "labels", draw: labelsDrawing, key, items };
}

/**
 * The geometry of labels in plain text of one color, anchor, and vertical
 * middle, each label's lines centered on its point (its `y` is their middle).
 */
export function textGeometry(
  key: string,
  labels: readonly PlacedLabel[],
  fill: string,
  halo: Halo | undefined,
  frame: Frame,
): TextGeometry {
  const coords = frame.floats(key, "text", labels.length * 2);
  labels.forEach((label, i) => {
    coords[i * 2] = label.x;
    coords[i * 2 + 1] = label.y;
  });
  return {
    kind: "text",
    draw: textDrawing,
    key,
    fill,
    anchor: labels[0]?.anchor ?? "middle",
    halo: labelHalo(halo, frame),
    coords,
    labels: labels.map((label) => label.text),
    count: labels.length,
  };
}
