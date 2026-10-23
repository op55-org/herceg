import type { Drawing, RectGeometry, SvgElement } from "../scene/scene.ts";
import type { Side } from "../spec/place.ts";
import { KAPPA, markupOf, type PathSink, SvgPath } from "./markup.ts";

/**
 * Adds a geometry's rectangles to `sink`. Rectangles with a rounded end
 * (bars, at their value's end) get corners of up to `rounded.radius` there,
 * no more than half their width or their whole length.
 */
export function traceRects(sink: PathSink, mark: RectGeometry): void {
  const r = mark.rects;
  const ends = mark.rounded?.ends;
  const radius = mark.rounded?.radius ?? 0;
  for (let i = 0; i < mark.count; i++) {
    const x = r[i * 4]!;
    const y = r[i * 4 + 1]!;
    const w = r[i * 4 + 2]!;
    const h = r[i * 4 + 3]!;
    const end = ends ? ends[i]! : NONE;
    const vertical = end === TOP || end === BOTTOM;
    const c = end === NONE ? 0 : Math.min(radius, (vertical ? w : h) / 2, vertical ? h : w);
    if (!(c > 0.5)) {
      sink.rect(x, y, w, h);
      continue;
    }
    const k = c * (1 - KAPPA);
    // Clockwise from the top left, rounding the two corners at the end.
    const [tl, tr, br, bl] = [
      end === TOP || end === LEFT,
      end === TOP || end === RIGHT,
      end === BOTTOM || end === RIGHT,
      end === BOTTOM || end === LEFT,
    ];
    sink.moveTo(x, tl ? y + c : y);
    if (tl) sink.bezierCurveTo(x, y + k, x + k, y, x + c, y);
    sink.lineTo(tr ? x + w - c : x + w, y);
    if (tr) sink.bezierCurveTo(x + w - k, y, x + w, y + k, x + w, y + c);
    sink.lineTo(x + w, br ? y + h - c : y + h);
    if (br) sink.bezierCurveTo(x + w, y + h - k, x + w - k, y + h, x + w - c, y + h);
    sink.lineTo(bl ? x + c : x, y + h);
    if (bl) sink.bezierCurveTo(x + k, y + h, x, y + h - k, x, y + h - c);
    sink.closePath();
  }
}

/** A rectangle's sides as bits of an outline's `sides`, clockwise from the top. */
const SIDES = { top: 1, right: 2, bottom: 4, left: 8 };

/** Every side: a closed outline. */
export const ALL_SIDES = 15;

/** The mask of `sides`, as an outline's `sides` holds them. */
export function sideMask(sides: readonly Side[]): number {
  let mask = 0;
  for (const side of sides) mask |= SIDES[side];
  return mask;
}

/**
 * Adds the sides of each rectangle its outline draws to `sink`: `sides`,
 * one mask for every rectangle or one per rectangle; a closed rectangle
 * where all four are.
 */
export function traceSides(
  sink: PathSink,
  mark: RectGeometry,
  sides: number | Uint8ClampedArray,
): void {
  const r = mark.rects;
  for (let i = 0; i < mark.count; i++) {
    const mask = typeof sides === "number" ? sides : sides[i]!;
    const x = r[i * 4]!;
    const y = r[i * 4 + 1]!;
    const w = r[i * 4 + 2]!;
    const h = r[i * 4 + 3]!;
    if (mask === ALL_SIDES) {
      sink.rect(x, y, w, h);
      continue;
    }
    // Side k runs from corner k to corner k + 1, clockwise from the top
    // left. Starting after a side not drawn, drawn sides meeting at a
    // corner join there.
    const cx = (k: number) => (k === 1 || k === 2 ? x + w : x);
    const cy = (k: number) => (k >= 2 ? y + h : y);
    let start = 0;
    while (mask & (1 << start)) start++;
    let open = false;
    for (let j = 1; j <= 4; j++) {
      const k = (start + j) % 4;
      const drawn = (mask & (1 << k)) !== 0;
      if (drawn && !open) sink.moveTo(cx(k), cy(k));
      if (drawn) sink.lineTo(cx((k + 1) % 4), cy((k + 1) % 4));
      open = drawn;
    }
  }
}

/** Which end of a rectangle is rounded, per rectangle of `RectGeometry.rounded.ends`. */
export const NONE = 0;
export const TOP = 1;
export const BOTTOM = 2;
export const LEFT = 3;
export const RIGHT = 4;

/** All rectangles of a series as one path. */
export function rectPath(mark: RectGeometry): string {
  const svg = new SvgPath();
  traceRects(svg, mark);
  return svg.d;
}

function rectElements(mark: RectGeometry): SvgElement[] {
  const fill: Record<string, string> = {
    d: rectPath(mark),
    fill: mark.fill,
    "fill-opacity": String(mark.fillOpacity),
  };
  const edge = mark.edge;
  if (!edge) return [{ tag: "path", attributes: fill }];
  // An outline of some sides is a path of its own over the fill.
  const { sides } = edge;
  let outline = fill;
  if (sides !== undefined) {
    const path = new SvgPath();
    traceSides(path, mark, sides);
    outline = { d: path.d, fill: "none" };
  }
  outline.stroke = edge.stroke;
  outline["stroke-width"] = String(edge.width);
  if (edge.opacity !== 1) outline["stroke-opacity"] = String(edge.opacity);
  if (edge.dash?.length) outline["stroke-dasharray"] = edge.dash.join(" ");
  const elements: SvgElement[] = [{ tag: "path", attributes: fill }];
  if (outline !== fill) elements.push({ tag: "path", attributes: outline });
  return elements;
}

export const rectDrawing: Drawing<RectGeometry> = {
  size: (mark) => mark.count,
  elements: rectElements,
  svg: (mark) => markupOf(rectElements(mark)),
  canvas(context, mark) {
    context.beginPath();
    traceRects(context, mark);
    context.globalAlpha = mark.fillOpacity;
    context.fillStyle = mark.fill;
    context.fill();
    const edge = mark.edge;
    if (edge) {
      if (edge.sides !== undefined) {
        context.beginPath();
        traceSides(context, mark, edge.sides);
      }
      context.globalAlpha = edge.opacity;
      context.strokeStyle = edge.stroke;
      context.lineWidth = edge.width;
      // As SVG and PDF stroke them: butt ends of open sides, mitered corners.
      context.lineCap = "butt";
      context.lineJoin = "miter";
      context.setLineDash((edge.dash ?? []) as number[]);
      context.stroke();
      context.setLineDash([]);
    }
    context.globalAlpha = 1;
  },
};
