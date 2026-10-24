import type { Polyline } from "../lod/polyline.ts";
import type { Drawing, LineGeometry, SvgElement } from "../scene/scene.ts";
import { markupOf, type PathSink, SvgPath } from "./markup.ts";

/**
 * Traces points [start, end) of a polyline into `sink`, from the first to
 * the last or (`forward` false) back, without moving to the first: curved
 * segments as cubic curves, the others as lines.
 */
export function traceRun(
  sink: PathSink,
  path: Polyline,
  start: number,
  end: number,
  forward: boolean,
): void {
  const c = path.coords;
  const k = path.curved ? path.controls : undefined;
  if (forward) {
    for (let i = start + 1; i < end; i++) {
      if (k && !Number.isNaN(k[i * 4]!))
        sink.bezierCurveTo(
          k[i * 4]!,
          k[i * 4 + 1]!,
          k[i * 4 + 2]!,
          k[i * 4 + 3]!,
          c[i * 2]!,
          c[i * 2 + 1]!,
        );
      else sink.lineTo(c[i * 2]!, c[i * 2 + 1]!);
    }
    return;
  }
  // Backward, each segment into point i is traced from i, its control points swapped.
  for (let i = end - 1; i > start; i--) {
    if (k && !Number.isNaN(k[i * 4]!))
      sink.bezierCurveTo(
        k[i * 4 + 2]!,
        k[i * 4 + 3]!,
        k[i * 4]!,
        k[i * 4 + 1]!,
        c[i * 2 - 2]!,
        c[i * 2 - 1]!,
      );
    else sink.lineTo(c[i * 2 - 2]!, c[i * 2 - 1]!);
  }
}

/**
 * How long the line a lone point's round caps paint as a dot is, too short
 * to see: browsers paint no dot of a line of no length (WebKit paints its
 * caps twice in SVG, Chromium none where dashed), nor WebKit's canvases of
 * one much shorter (the first of several 0.001 long, say).
 */
const DOT_LENGTH = 0.02;

/** Traces a lone point at (x, y), moved to, as a dot its round caps paint. */
export function dotAt(sink: PathSink, x: number, y: number): void {
  // SVG paths round positions to a tenth of a pixel (`n`): the step is written as is.
  if (sink instanceof SvgPath) sink.d += `l${DOT_LENGTH} 0`;
  else sink.lineTo(x + DOT_LENGTH, y);
}

/** Adds a polyline's runs to `sink`, one subpath each. */
export function traceLine(sink: PathSink, path: Polyline): void {
  const c = path.coords;
  for (let run = 0; run < path.starts.length; run++) {
    const start = path.starts[run]!;
    const end = path.runEnd(run);
    if (end - start < 1) continue;
    sink.moveTo(c[start * 2]!, c[start * 2 + 1]!);
    // Round caps paint a stroke-sized dot; a lone move paints nothing.
    if (end === start + 1) dotAt(sink, c[start * 2]!, c[start * 2 + 1]!);
    traceRun(sink, path, start, end, true);
  }
}

/** Whether any run has just one point, needing a round cap to be visible. */
export function hasIsolated(path: Polyline): boolean {
  return path.starts.some((start, run) => path.runEnd(run) === start + 1);
}

/** Path data for a polyline, one subpath per run. */
export function linePath(path: Polyline): string {
  const svg = new SvgPath();
  traceLine(svg, path);
  return svg.d;
}

function lineElements(line: LineGeometry): SvgElement[] {
  const attributes: Record<string, string> = {
    d: linePath(line.path),
    fill: "none",
    stroke: line.stroke,
    "stroke-width": String(line.strokeWidth),
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
  };
  if (line.dash?.length) {
    attributes["stroke-dasharray"] = line.dash.join(" ");
    if (line.dashOffset) attributes["stroke-dashoffset"] = String(line.dashOffset);
  }
  return [{ tag: "path", attributes }];
}

export const lineDrawing: Drawing<LineGeometry> = {
  size: (line) => line.path.count,
  elements: lineElements,
  svg: (line) => markupOf(lineElements(line)),
  canvas(context, line) {
    // A width of 0 strokes nothing, as in SVG; the canvas would keep its last width.
    if (!(line.strokeWidth > 0)) return;
    context.beginPath();
    traceLine(context, line.path);
    // Canvas copies its input; the geometry's readonly array can be passed directly.
    context.setLineDash((line.dash ?? []) as number[]);
    context.lineDashOffset = line.dashOffset ?? 0;
    context.strokeStyle = line.stroke;
    context.lineWidth = line.strokeWidth;
    context.stroke();
    context.setLineDash([]);
    context.lineDashOffset = 0;
  },
};
