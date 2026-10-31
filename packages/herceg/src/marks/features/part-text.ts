// Labels whose parts have looks of their own (a part's `style`): each
// part's text measured in its own font, set side by side on one baseline
// per line, each line as tall as its tallest part, and lowered to the text
// items painters draw already, one per part, halos before any part's fill
// so no part's halo covers its neighbor. The block's halo, box, and
// alignment stay the label's. Loaded with the feature compiler, which
// writes labels of parts; marks only call what it hands them (`PartText`).

import type { MeasureText, TextLines } from "../../layout/text.ts";
import type { FeatureKit } from "../../model/features.ts";
import type { Rect, TextItem } from "../../scene/scene.ts";
import type { PartStyle } from "../../spec/encoding.ts";
import type { ResolvedHalo, TextPaint } from "../../style/style.ts";

/** A label's text in parts of their own looks, measured, and how to draw it. */
export interface PartText {
  /** Its lines: as wide as the widest, as tall as their tallest parts added up. */
  readonly lines: TextLines;
  /**
   * How tall its text is: its lines but the last, and the last's largest
   * size, as a line of text is as tall as its size.
   */
  readonly size: number;
  /**
   * Its block's box with its middle at `y` and its `anchor` side (or
   * middle) at `x`, padded by `paint`'s padding where it has a box.
   */
  box(x: number, y: number, anchor: TextItem["anchor"], paint: TextPaint): Rect;
  /**
   * The text items drawing it in `box` (its block's, padded by `paint`'s
   * padding when it has a box, which the first item draws), its lines
   * aligned by `anchor`, each part over `halo`, in `paint`'s color where
   * the part has none of its own.
   */
  items(
    box: Rect,
    anchor: TextItem["anchor"],
    paint: TextPaint,
    halo: ResolvedHalo | undefined,
  ): TextItem[];
  /**
   * The text at most `width` wide: each line's part that runs past it
   * shortened with an ellipsis, and the parts after it left out; undefined
   * where a line would keep no more than the ellipsis.
   */
  fit(width: number): PartText | undefined;
}

/** A part on a line: its text, look (its own color, if any), and width. */
interface Piece {
  readonly text: string;
  readonly paint: TextPaint;
  readonly color: string | undefined;
  readonly width: number;
}

/** A line of parts, its width, its height, and its largest size. */
interface Line {
  readonly pieces: readonly Piece[];
  readonly width: number;
  readonly height: number;
  readonly size: number;
}

/**
 * How far below a line's middle its parts' alphabetic baseline goes: half
 * a typical x-height of its largest part, where text placed by its middle
 * would have its baseline.
 */
const DROP = 0.27;

/** `parts` in `paint`, each in its style over it, measured with `measure`. */
export function partText(
  kit: FeatureKit,
  parts: readonly { text: string; style: PartStyle | undefined }[],
  paint: TextPaint,
  measure: MeasureText,
): PartText {
  const rows: Piece[][] = [[]];
  for (const { text, style } of parts) {
    const look = style ? restyled(kit, paint, style) : { ...paint, background: undefined };
    text.split("\n").forEach((piece, k) => {
      if (k > 0) rows.push([]);
      rows.at(-1)!.push({
        text: piece,
        paint: look,
        color: style?.color,
        width: piece ? measure(piece, look.css) : 0,
      });
    });
  }
  return set(
    kit,
    measure,
    paint,
    rows.map((pieces) => line(pieces, paint)),
  );
}

/**
 * A line of `pieces`: as tall as its tallest that writes text (the empty
 * pieces beside a break take no height); a blank line, as its own empty
 * pieces' looks make it, or as `paint`'s line where it has none.
 */
function line(pieces: readonly Piece[], paint: TextPaint): Line {
  let [width, height, size] = [0, 0, 0];
  const writes = pieces.some((piece) => piece.text);
  for (const piece of pieces) {
    width += piece.width;
    if (writes && !piece.text) continue;
    height = Math.max(height, piece.paint.lineHeight);
    size = Math.max(size, piece.paint.size);
  }
  return height
    ? { pieces, width, height, size }
    : { pieces, width, height: paint.lineHeight, size: paint.size };
}

/** Lines of parts, as `PartText`. */
function set(
  kit: FeatureKit,
  measure: MeasureText,
  paint: TextPaint,
  rows: readonly Line[],
): PartText {
  const widths = rows.map(({ width }) => width);
  return {
    lines: {
      lines: rows.map(({ pieces }) => pieces.map(({ text }) => text).join("")),
      widths,
      width: Math.max(...widths),
      height: rows.reduce((sum, { height }) => sum + height, 0),
    },
    size:
      rows.reduce((sum, { height }) => sum + height, 0) - rows.at(-1)!.height + rows.at(-1)!.size,
    box(x, y, anchor, label) {
      const [top, right, bottom, left] = label.background ? label.padding : [0, 0, 0, 0];
      const width = Math.max(...widths) + left + right;
      const height = rows.reduce((sum, row) => sum + row.height, 0) + top + bottom;
      const along = anchor === "start" ? 0 : anchor === "end" ? 1 : 0.5;
      return { x: x - width * along, y: y - height / 2, width, height };
    },
    items(box, anchor, label, halo) {
      const [top, right, , left] = label.background ? label.padding : [0, 0, 0, 0];
      const inner = box.width - left - right;
      const halos: TextItem[] = [];
      const fills: TextItem[] = [];
      let y = box.y + top;
      for (const row of rows) {
        let x =
          box.x +
          left +
          (anchor === "start" ? 0 : (inner - row.width) * (anchor === "end" ? 1 : 0.5));
        const baseline = y + row.height / 2 + row.size * DROP;
        for (const piece of row.pieces) {
          if (piece.text) {
            const item: TextItem = {
              type: "text",
              text: piece.text,
              x,
              y: baseline,
              anchor: "start",
              baseline: "alphabetic",
              angle: 0,
              paint: piece.color ? piece.paint : { ...piece.paint, color: label.color },
            };
            if (halo) halos.push({ ...item, paint: { ...item.paint, color: "transparent" }, halo });
            fills.push(item);
          }
          x += piece.width;
        }
        y += row.height;
      }
      const items = [...halos, ...fills];
      // The first item drawn draws the label's box, under every part.
      if (label.background && items[0])
        items[0] = { ...items[0], box, paint: { ...items[0].paint, background: label.background } };
      return items;
    },
    fit(width) {
      const fitted: Line[] = [];
      for (const row of rows) {
        if (row.width <= width) {
          fitted.push(row);
          continue;
        }
        const pieces = shortened(kit, measure, row.pieces, width);
        if (!pieces) return undefined;
        fitted.push(line(pieces, paint));
      }
      return set(kit, measure, paint, fitted);
    },
  };
}

/**
 * `pieces` within `width`: those before the one that runs past it, and
 * that one shortened with an ellipsis; where the ellipsis does not fit
 * after the parts before it, the part before is shortened instead.
 * Undefined where nothing but the ellipsis would be left.
 */
function shortened(
  kit: FeatureKit,
  measure: MeasureText,
  pieces: readonly Piece[],
  width: number,
): Piece[] | undefined {
  let past = 0;
  for (let used = 0; past < pieces.length && used + pieces[past]!.width <= width; past++)
    used += pieces[past]!.width;
  for (let k = past; k >= 0; k--) {
    const piece = pieces[k];
    if (!piece?.text) continue;
    const before = pieces.slice(0, k);
    const room = width - before.reduce((sum, { width }) => sum + width, 0);
    // A part before the one that runs past fits whole: the ellipsis goes after it.
    const text = kit.fitText(
      k === past ? piece.text : `${piece.text}…`,
      room,
      measure,
      piece.paint.css,
    );
    const drawn = measure(text, piece.paint.css);
    if (drawn > room) continue;
    if (text === "…" && before.every(({ text }) => !text)) return undefined;
    return [...before, { ...piece, text, width: drawn }];
  }
  return undefined;
}

/** `paint` with a part's `style` over it: its size (lines as tall in proportion), weight, slant, color, and opacity. */
function restyled(kit: FeatureKit, paint: TextPaint, style: PartStyle): TextPaint {
  const size = style.fontSize ?? paint.size;
  const weight = style.fontWeight ?? paint.weight;
  const italic = style.fontStyle === undefined ? paint.italic : style.fontStyle === "italic";
  return {
    ...paint,
    size,
    weight,
    italic,
    color: style.color ?? paint.color,
    opacity: style.opacity ?? paint.opacity,
    // As a style of its size sets it, by the line height the label's style gives.
    lineHeight: Math.round(size * (paint.lineRatio ?? paint.lineHeight / paint.size)),
    css: kit.cssFont(paint.font, size, weight, italic),
    background: undefined,
  };
}
