// Text measurement and layout: widths of text in a font (estimated where
// no browser or supplied fonts measure it), and text broken into lines and
// boxed as guides draw it.

import { bisect } from "../data/bisect.ts";
import type { Rect, SegmentsItem, TextItem } from "../scene/scene.ts";
import { haloOf, type ResolvedHalo, type TextPaint } from "../style/style.ts";

/**
 * Returns the width in CSS pixels of `text` drawn with a CSS `font`: of
 * its widest line, for text "\n" breaks into lines, so a line break never
 * reaches a measurer's fonts (see `widestLine`). `context`, where given, is
 * what it measures with: a canvas' 2D context, or one describing its fonts
 * as a canvas would. Leaders of moved labels are judged by where its fonts'
 * metrics say text is painted (layout/attached.ts `paintedMiddle`).
 */
export type MeasureText = ((text: string, font: string) => number) & {
  context?: MeasuringContext | undefined;
};

/** What a canvas' 2D context tells of a font: set `font`, then measure. */
export interface MeasuringContext {
  font: string;
  measureText(text: string): {
    width: number;
    actualBoundingBoxAscent: number;
    fontBoundingBoxAscent: number;
    fontBoundingBoxDescent: number;
  };
}

/** The width of `text`'s widest line, each measured by `measure`. */
export function widestLine(text: string, measure: (line: string) => number): number {
  return text.includes("\n") ? Math.max(...text.split("\n").map(measure)) : measure(text);
}

// Advance widths of ASCII 32..126 in Helvetica / Arial, in 1/1000 em. Used to
// lay out charts where no browser is available (server rendering, exports).
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** The size in pixels, weight, and family list of a CSS `font` such as "600 12px Inter, sans-serif". */
export function parseFont(font: string): { size: number; bold: boolean; family: string } {
  const match = /(\d+(?:\.\d+)?)px\s*(.*)$/.exec(font);
  const before = match ? font.slice(0, match.index) : "";
  return {
    size: match ? Number(match[1]) : 12,
    bold: /\b(bold|[6-9]00)\b/.test(before),
    family: match?.[2] ?? font,
  };
}

const MONOSPACE = /mono|courier|consolas|menlo|monaco/;
const SERIF = /(^|\s)(ui-)?serif$|times|georgia|garamond|palatino|cambria|baskerville/;
const SANS = /sans|helvetica|arial|system-ui|apple-system|segoe|roboto|verdana|tahoma/;

/**
 * What a CSS font family list draws with: the first family recognized as
 * monospace, serif, or sans-serif decides; sans-serif when none is.
 */
export function fontKind(family: string): "monospace" | "serif" | "sans" {
  for (const entry of family.toLowerCase().split(",")) {
    const name = entry.trim().replace(/^["']|["']$/g, "");
    if (MONOSPACE.test(name)) return "monospace";
    if (SERIF.test(name)) return "serif";
    if (SANS.test(name)) return "sans";
  }
  return "sans";
}

/**
 * Width estimate from Helvetica metrics (Courier's for monospace fonts),
 * padded by 10% because the viewer's font is unknown (system UI fonts run
 * slightly wider). Reserving a little too much space is better than
 * clipping labels; serif fonts, narrower, are estimated as Helvetica.
 */
export const estimateText: MeasureText = (text, font) => {
  const { size, family } = parseFont(font);
  const monospace = fontKind(family) === "monospace";
  return widestLine(text, (line) => {
    let units = 0;
    for (let i = 0; i < line.length; i++) {
      const code = line.charCodeAt(i);
      units +=
        code >= 0x2e80
          ? 1000
          : monospace
            ? 600
            : code >= 32 && code <= 126
              ? WIDTHS[code - 32]!
              : 556;
    }
    return (units / 1000) * size * 1.1;
  });
};

/**
 * Measures with a 2D canvas context, caching results per font and string.
 * With `renew`, a context of the same document, it measures on a new
 * context every 1,000 strings: Chrome's keeps what it shaped of every
 * distinct string (1 to 1.6 KB each) for as long as it lives, and counting
 * or streaming labels write new strings every frame. Widths are the same on
 * any context of a document, so the cache outlives it.
 */
export function canvasMeasurer(
  context: MeasuringContext,
  renew?: () => MeasuringContext | null,
): MeasureText {
  const cache = new Map<string, number>();
  let measured = 0;
  const measure: MeasureText = (text, font) => {
    const key = `${font}|${text}`;
    let width = cache.get(key);
    if (width === undefined) {
      // Without a new context, the old one measures 1,000 more.
      if (renew && ++measured > 1000) {
        measured = 1;
        context = measure.context = renew() ?? context;
      }
      if (context.font !== font) context.font = font;
      width = widestLine(text, (line) => context.measureText(line).width);
      if (cache.size > 5000) cache.clear();
      cache.set(key, width);
    }
    return width;
  };
  measure.context = context;
  return measure;
}

const DIGIT = /\p{Nd}/u;

/**
 * `text` with each decimal digit written as `digit` writes its run, by the
 * run's zero: by default the zero itself, "59,268" as "00,000", Arabic-Indic
 * "١٢٣" as "٠٠٠", signs, separators, and units kept. Unicode's decimal digits
 * come in runs of ten from zero, some back to back, so a digit's zero is as
 * far back as its place in its run of runs. Text measured by its shape
 * measures the same while its digits change: counting labels in value
 * transitions, and automatic ticks fitting their labels (`shapedMeasure`).
 */
export function shapeOf(
  text: string,
  digit: (zero: number) => string = (zero) => String.fromCodePoint(zero),
): string {
  let zero = -1;
  let written = "";
  return text.replace(/\p{Nd}/gu, (d) => {
    const code = d.codePointAt(0)!;
    let start = code;
    if (d <= "9") start = 48;
    else while (DIGIT.test(String.fromCodePoint(start - 1))) start--;
    const run = code - ((code - start) % 10);
    if (run !== zero) {
      zero = run;
      written = digit(run);
    }
    return written;
  });
}

/**
 * What each measurer measured shaped: the widest digit of a run, by the
 * run's zero and font; text's widths, by font and text; and how many
 * widths it holds, of every font.
 */
const shapes = new WeakMap<
  MeasureText,
  { digits: Map<string, string>; widths: Map<string, Map<string, number>>; size: number }
>();

/**
 * `measure`, giving text at least the width of its shape with each digit its
 * run's widest in the font (see `shapeOf`): ten measures per run and font,
 * once. A shape is as wide as any text of its digits drawn side by side, so
 * labels measured this way keep their width while their digits change;
 * text shaped wider than its digits measures as drawn. Digits a measurer
 * refuses (fonts registered for a PDF without them) are not drawn, and not
 * the widest. Widths are kept by measurer, at most 5,000, as a page's
 * measurer keeps its own: axes plan the same labels scene after scene. So
 * a measurer gives text the same width for as long as it is used: a page's
 * is replaced when faces load, and one given to an export is measured
 * afresh by each export (`forgetShapes`, render/static.ts).
 */
export function shapedMeasure(measure: MeasureText): MeasureText {
  let kept = shapes.get(measure);
  if (!kept) {
    kept = { digits: new Map(), widths: new Map(), size: 0 };
    shapes.set(measure, kept);
  }
  const known = kept;
  const { digits, widths } = known;
  const widthOf = (text: string, font: string) => {
    try {
      return measure(text, font);
    } catch {
      return -1;
    }
  };
  const digitOf = (zero: number, font: string) => {
    const key = `${zero} ${font}`;
    let digit = digits.get(key);
    if (digit === undefined) {
      digit = String.fromCodePoint(zero);
      let most = widthOf(digit, font);
      for (let k = 1; k < 10; k++) {
        const other = String.fromCodePoint(zero + k);
        const width = widthOf(other, font);
        if (width > most) [digit, most] = [other, width];
      }
      digits.set(key, digit);
    }
    return digit;
  };
  return (text, font) => {
    let inFont = widths.get(font);
    if (!inFont) {
      inFont = new Map();
      widths.set(font, inFont);
    }
    let width = inFont.get(text);
    if (width === undefined) {
      const shape = shapeOf(text, (zero) => digitOf(zero, font));
      const own = measure(text, font);
      width = shape === text ? own : Math.max(own, widthOf(shape, font));
      if (++known.size > 5000) {
        known.size = 1;
        digits.clear();
        widths.clear();
        inFont = new Map();
        widths.set(font, inFont);
      }
      inFont.set(text, width);
    }
    return width;
  };
}

/**
 * Forgets the shaped widths `measure` gave (see `shapedMeasure`), so that
 * text is measured afresh: for measurers whose widths may change, such as
 * one given to an export.
 */
export function forgetShapes(measure: MeasureText): void {
  shapes.delete(measure);
}

/** `text` shortened with an ellipsis, if needed, to at most `width` pixels. */
export function fitText(text: string, width: number, measure: MeasureText, font: string): string {
  if (measure(text, font) <= width) return text;
  // Cut between code points so surrogate pairs stay whole.
  const characters = Array.from(text);
  const cut = (n: number) => `${characters.slice(0, n).join("").trimEnd()}…`;
  // The most characters that fit, fewer than all.
  return cut(bisect(characters.length - 1, (k) => measure(cut(k + 1), font) <= width));
}

/**
 * A name fitted to `width` pixels, or "" when shortening it would leave
 * fewer than three characters, which say too little to be worth it.
 */
export function labelFor(name: string, width: number, measure: MeasureText, font: string): string {
  const line = oneLineText(name);
  const text = fitText(line, width, measure, font);
  return text === line || Array.from(text).length >= 4 ? text : "";
}

/**
 * `text` on one line, its breaks read as spaces: names layouts fit to a
 * room of one line (slices', nodes', stages', and spokes' names, and 3D
 * axes' labels), which are shortened rather than broken.
 */
export function oneLineText(text: string): string {
  return text.includes("\n") ? text.replaceAll("\n", " ") : text;
}

/** How many lines "\n" breaks `text` into, without making them: labels are counted scene after scene. */
export function lineCount(text: string): number {
  let count = 1;
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) count++;
  return count;
}

/** Text broken into lines at "\n", and how far they reach. */
export interface TextLines {
  readonly lines: readonly string[];
  /** Each line's width in pixels. */
  readonly widths: readonly number[];
  /** The widest line's width. */
  readonly width: number;
  /** The lines' height: their count times the paint's line height. */
  readonly height: number;
}

/** `text` in lines as `paint` sets it, each measured with `measure`. */
export function textLines(text: string, paint: TextPaint, measure: MeasureText): TextLines {
  const lines = text.split("\n");
  const widths = lines.map((line) => measure(line, paint.css));
  return { lines, widths, width: Math.max(...widths), height: lines.length * paint.lineHeight };
}

/**
 * The box of `lines` drawn at `at` (unturned), padded by the paint's
 * padding: as wide as the widest line, each line its line height tall,
 * stacked down from the first, whose middle (or top, "hanging"; or
 * baseline, `at.above` below its top) is at `at.y`.
 */
export function textBox(lines: TextLines, at: TextAt, paint: TextPaint): Rect {
  const { size, lineHeight, padding } = paint;
  const [top, right, bottom, left] = padding;
  const first =
    at.y -
    (at.baseline === "middle"
      ? lineHeight / 2
      : at.baseline === "hanging"
        ? (lineHeight - size) / 2
        : (at.above ?? 0.8 * size));
  const start = at.x - lines.width * (at.anchor === "middle" ? 0.5 : at.anchor === "end" ? 1 : 0);
  return {
    x: start - left,
    y: first - top,
    width: lines.width + left + right,
    height: lines.height + top + bottom,
  };
}

/**
 * Where guide text is drawn: its point, which line of the text the point is
 * on (its middle, its top for "hanging" text, or its baseline), and its
 * turn; for "alphabetic" text, how far its first line's box reaches above
 * the point (`above`).
 */
export type TextAt = Pick<TextItem, "x" | "y" | "anchor" | "angle" | "baseline" | "above">;

/** How wide a line of `text` in `paint` is drawn: with its box's padding when it has a box. */
export function textWidth(text: string, paint: TextPaint, measure: MeasureText): number {
  const [, right, , left] = paint.padding;
  return measure(text, paint.css) + (paint.background ? left + right : 0);
}

/** How tall `text` (a line by default) in `paint` is drawn: its lines' height, and its box's padding. */
export function textHeight(paint: TextPaint, text = ""): number {
  const [top, , bottom] = paint.padding;
  return lineCount(text) * paint.lineHeight + (paint.background ? top + bottom : 0);
}

/**
 * Where text in a box is drawn so that the box's edge (or middle) goes where
 * the text's own would go without one: the text moves inside the box by its
 * padding, in the text's own turn.
 */
export function padded(at: TextAt, [top, right, bottom, left]: TextPaint["padding"]): TextAt {
  const dx = at.anchor === "start" ? left : at.anchor === "end" ? -right : (left - right) / 2;
  return moved(at, dx, at.baseline === "hanging" ? top : (top - bottom) / 2);
}

/**
 * Where the first of `text`'s lines in `paint` goes for their middle to be
 * at `at`, as they go down the text's own turn.
 */
export function centeredLines(text: string, at: TextAt, paint: TextPaint): TextAt {
  return moved(at, 0, ((1 - lineCount(text)) * paint.lineHeight) / 2);
}

/** `at` moved `dx` along its text and `dy` down it, in the text's own turn. */
function moved(at: TextAt, dx: number, dy: number): TextAt {
  const turn = (at.angle * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return { ...at, x: at.x + dx * cos - dy * sin, y: at.y + dx * sin + dy * cos };
}

/** The halo of guide text in `paint` drawn over `surface`, or over its box when it has one. */
export function textHalo(paint: TextPaint, surface: string): ResolvedHalo | undefined {
  return haloOf(paint.halo, paint.background?.fill ?? surface);
}

/**
 * A line through each line of `item`'s text, which starts at its x (as a
 * hidden series' legend label is struck through), faded as the text is by
 * `opacity`, a share of its paint's.
 */
export function struckThrough(item: TextItem, measure: MeasureText, opacity: number): SegmentsItem {
  const { x, y, paint } = item;
  return {
    type: "segments",
    coords: item.text
      .split("\n")
      .flatMap((line, k) => [
        x,
        y + k * paint.lineHeight,
        x + measure(line, paint.css),
        y + k * paint.lineHeight,
      ]),
    paint: { stroke: paint.color, strokeWidth: 1, dash: [], opacity: paint.opacity * opacity },
  };
}

/**
 * A guide's line of `text` at `at` in `paint`, with the paint's halo over
 * `surface` and, when the paint has a background, the box behind it
 * (measured with `measure`, and only then), whose edge goes where the
 * text's own would (see `padded`).
 */
export function textItem(
  text: string,
  at: TextAt,
  paint: TextPaint,
  surface: string,
  measure?: MeasureText,
  box?: Rect,
): TextItem {
  if (!box && paint.background && measure) {
    at = padded(at, paint.padding);
    box = textBox(textLines(text, paint, measure), at, paint);
  }
  const { x, y, anchor, baseline, angle } = at;
  const halo = textHalo(paint, surface);
  const item: { -readonly [K in keyof TextItem]: TextItem[K] } = {
    type: "text",
    text,
    x,
    y,
    anchor,
    baseline,
    angle,
    paint,
  };
  if (halo) item.halo = halo;
  if (box) item.box = box;
  if (at.above !== undefined) item.above = at.above;
  return item;
}
