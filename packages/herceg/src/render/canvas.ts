// Paints a scene's panels into a 2D canvas: backgrounds, grid lines, and
// geometry, each panel in the order its paint plan gives. Axes and guides
// stay in SVG above the canvas, so their text is crisp and accessible and
// pointer feedback never repaints the data. Each geometry is painted by the
// drawing it carries.

import { gridLines } from "../scene/grid.ts";
import { eachPainted } from "../scene/paint.ts";
import {
  type CloudOptions,
  clipOf,
  type Panel,
  type RasterGeometry,
  type Rect,
  type Scene,
} from "../scene/scene.ts";

/**
 * Paints the scene. The canvas backing store is sized to the scene times
 * its pixel ratio; drawing happens in CSS pixels. Geometry whose drawing
 * has no canvas painter is left out: charts draw such scenes in SVG.
 */
export function paintCanvas(
  canvas: HTMLCanvasElement,
  scene: Scene,
  clouds: CloudOptions = {},
  kerning = true,
): void {
  const ratio = scene.pixelRatio;
  const width = Math.round(scene.width * ratio);
  const height = Math.round(scene.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.lineJoin = "round";
  context.lineCap = "round";
  // Supplied fonts measure glyph by glyph: text is drawn so, unkerned and,
  // where the canvas can leave them out (Chrome), without ligatures.
  context.fontKerning = kerning ? "auto" : "none";
  context.textRendering = kerning ? "auto" : "optimizeSpeed";

  const { theme } = scene;
  const background = theme.background !== "transparent" && theme.background;
  const fill = (rects: readonly Rect[], color: string) => {
    context.fillStyle = color;
    for (const { x, y, width, height } of rects) context.fillRect(x, y, width, height);
  };
  const grid = (panel: Panel) => (batch: Panel["grids"][number]) => {
    const paint = batch.paint ?? theme.style.grid;
    const c = gridLines(batch, panel.plot, ratio);
    context.beginPath();
    for (let i = 0; i < c.length; i += 4) {
      context.moveTo(c[i]!, c[i + 1]!);
      context.lineTo(c[i + 2]!, c[i + 3]!);
    }
    context.save();
    // Lines end where they do, as SVG and PDF draw them: insets cut them.
    context.lineCap = "butt";
    context.strokeStyle = paint.stroke;
    // One-pixel grid lines are a device pixel wide, crisp at any ratio.
    context.lineWidth = paint.strokeWidth === 1 ? 1 / ratio : paint.strokeWidth;
    context.globalAlpha = paint.opacity;
    context.setLineDash([...paint.dash]);
    context.stroke();
    context.restore();
  };
  // Under every panel, the chart's background; then each panel in its
  // paint order (an inset over its box): its plot's background, then its plan.
  if (background) fill([{ x: 0, y: 0, width: scene.width, height: scene.height }], background);
  // GPU clouds are drawn over the plot only: those not cut to it are placed on the CPU.
  const cpu: CloudOptions = {};
  for (const panel of scene.painted ?? scene.panels) {
    const { plot, visible, keep, cover, frame } = panel;
    if (cover && background) fill([cover], background);
    if (frame?.fill) fill(visible ?? [plot], frame.fill);
    eachPainted(panel, grid(panel), (mark) => {
      const paint = mark.draw.canvas;
      if (!paint) return;
      const clip = clipOf(mark);
      // Cut to the plot (where insets over it leave it visible), or for
      // the rest, off those insets; the canvas' edges cut it anyway.
      const rects = clip === "plot" ? (visible ?? [plot]) : keep;
      context.save();
      if (rects) {
        context.beginPath();
        for (const { x, y, width, height } of rects) context.rect(x, y, width, height);
        context.clip();
      }
      paint(context, mark, {
        plot,
        pixelRatio: ratio,
        clouds: clip === "plot" ? clouds : cpu,
        theme,
      });
      context.restore();
    });
  }
}

/** Raster pixels as a PNG data URL, encoded by the browser through a canvas. */
export function canvasRasterUrl(mark: RasterGeometry, document: Document): string {
  const canvas = document.createElement("canvas");
  canvas.width = mark.columns;
  canvas.height = mark.rows;
  canvas.getContext("2d")?.putImageData(new ImageData(mark.pixels, mark.columns, mark.rows), 0, 0);
  return canvas.toDataURL();
}
