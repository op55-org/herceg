// Labels of marks in styles of their own: their paint (the theme's text,
// the mark's default color, and the label's style over them), and their
// geometry. Labels in the theme's plain text draw as text marks always have;
// others draw as positioned text items (fonts, sizes, boxes), as guides do.

import { labelHalo } from "../draw/label-halo.ts";
import { labelsDrawing, textDrawing } from "../draw/labels.ts";
import {
  type MeasureText,
  padded,
  type TextAt,
  textBox,
  textItem,
  textLines,
} from "../layout/text.ts";
import type { LabelsGeometry, Rect, TextGeometry, TextItem } from "../scene/scene.ts";
import type { Frozen } from "../spec/spec.ts";
import type { Halo, TextStyle } from "../spec/style.ts";
import { type ResolvedHalo, type TextPaint, textPaint } from "../style/style.ts";
import { surface, type Theme } from "../theme.ts";
import type { PartText } from "./features/part-text.ts";
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
  const paint = textPaint([
    theme.roles.text,
    { color },
    style as TextStyle | undefined,
    { halo: false },
  ]);
  return { ...paint, lineRatio: style?.lineHeight ?? theme.roles.text.lineHeight };
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
  /** Its text in parts of their own looks, drawn in its box (`labelBox`) rather than from its point. */
  parts?: PartText | undefined;
}

/**
 * A label's box: the one placed with it, or its text's lines as `paint`
 * sets them from its point, in a box as `textItem` draws one (the text
 * moved in by its padding), else bare.
 */
export function labelBox(label: PlacedLabel, paint: TextPaint, measure: MeasureText): Rect {
  if (label.box) return label.box;
  const lines = label.parts?.lines ?? textLines(label.text, paint, measure);
  const at: TextAt = { ...label, angle: 0 };
  return paint.background
    ? textBox(lines, padded(at, paint.padding), paint)
    : textBox(lines, at, { ...paint, padding: [0, 0, 0, 0] });
}

/**
 * How far a label in `paint`, with `halo`, paints past its box: half its
 * box's outline, or its halo past the box's padding.
 */
export function paintedReach(paint: TextPaint, halo: ResolvedHalo | undefined): number {
  const box = paint.background;
  const outline = box?.stroke ? (box.strokeWidth ?? 1) / 2 : 0;
  const padding = box ? Math.min(...paint.padding) : 0;
  return Math.max(0, outline, (halo?.width ?? 0) / 2 - padding);
}

/** `box` grown by `reach` on every side. */
export function grown(box: Rect, reach: number): Rect {
  return {
    x: box.x - reach,
    y: box.y - reach,
    width: box.width + 2 * reach,
    height: box.height + 2 * reach,
  };
}

/** `label` moved by (`dx`, `dy`), with its box. */
export function movedLabel(label: PlacedLabel, [dx, dy]: readonly [number, number]): PlacedLabel {
  if (dx === 0 && dy === 0) return label;
  const { box } = label;
  return {
    ...label,
    x: label.x + dx,
    y: label.y + dy,
    ...(box && { box: { ...box, x: box.x + dx, y: box.y + dy } }),
  };
}

/**
 * The geometry of labels in `paint`: text items, each with `halo` (the
 * label style's, else the mark's; "auto" by default) against what it is
 * drawn on. A label of parts takes an item per part; `owners`, when
 * given, gets each item's label (its index in `labels`).
 */
export function labelsGeometry(
  key: string,
  labels: readonly PlacedLabel[],
  paint: TextPaint,
  halo: Halo | undefined,
  frame: Frame,
  owners?: number[],
): LabelsGeometry {
  // Text in a box is drawn on the box.
  const ring = labelHalo(
    halo,
    paint.background ? { ...frame, surface: paint.background.fill } : frame,
  );
  const under = frame.surface ?? surface(frame.theme);
  const items: TextItem[] = [];
  labels.forEach((label, k) => {
    const { text, x, y, anchor, baseline, box, parts } = label;
    let made: TextItem[];
    if (parts) made = parts.items(labelBox(label, paint, frame.measure), anchor, paint, ring);
    else {
      const at: TextAt = { x, y, anchor, baseline, angle: 0 };
      const item = textItem(text, at, paint, under, frame.measure, box);
      made = [ring ? { ...item, halo: ring } : item];
    }
    for (const item of made) {
      items.push(item);
      owners?.push(k);
    }
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
