// Drawings fit only geometry of their own type, and say whether they paint
// on a canvas. Compiled by `npm run typecheck`.
import { lineDrawing } from "../../src/draw/line.ts";
import { rectDrawing } from "../../src/draw/rect.ts";
import type { Drawing, LineGeometry } from "../../src/scene/scene.ts";

declare const line: Omit<LineGeometry, "draw">;

export const paired: LineGeometry = { ...line, draw: lineDrawing };
// @ts-expect-error a rectangle drawing does not fit a line
export const mismatched: LineGeometry = { ...line, draw: rectDrawing };
// @ts-expect-error drawings say how they paint on a canvas, or that they do not, or they vanish there
export const noCanvas: Drawing<LineGeometry> = { size: () => 0, svg: () => "" };
export const svgOnly: Drawing<LineGeometry> = {
  canvas: false,
  defaultClip: false,
  size: () => 0,
  svg: () => "",
};
