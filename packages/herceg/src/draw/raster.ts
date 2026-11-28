import type {
  Drawing,
  RasterGeometry,
  RasterSource,
  SvgContext,
  SvgElement,
} from "../scene/scene.ts";
import { markupOf, n } from "./markup.ts";

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Offscreen canvases holding the pixels of rasters without a source of
 * their own (a look's colored copy, a transition's frame), by the pixels'
 * buffer: put whole at every draw, and gone with the buffer.
 */
const loose = new WeakMap<ArrayBuffer, Canvas>();

/** Each raster source's offscreen canvas, and the revision of the source it holds. */
const held = new WeakMap<RasterSource, { canvas: Canvas; revision: number }>();

/** Pixels put to offscreen canvases, for tests and benchmarks of what a draw uploads. */
export const rasterWork = { put: 0 };

/** Changed rectangles a draw puts one by one; past this, it puts the whole image. */
const MOST_RECTS = 16;

/** The raster as an image, left out without an encoder. */
function rasterElements(mark: RasterGeometry, { encodeRaster }: SvgContext): SvgElement[] {
  if (!encodeRaster) return [];
  return [
    {
      tag: "image",
      attributes: {
        x: n(mark.x),
        y: n(mark.y),
        width: n(mark.width),
        height: n(mark.height),
        preserveAspectRatio: "none",
        style: "image-rendering:pixelated",
        href: encodeRaster(mark),
      },
    },
  ];
}

export const rasterDrawing: Drawing<RasterGeometry> = {
  size: (mark) => mark.columns * mark.rows,
  elements: rasterElements,
  svg: (mark, context) => markupOf(rasterElements(mark, context)),
  canvas(context, mark) {
    const { source } = mark;
    const image =
      source && source.pixels === mark.pixels
        ? sourceCanvas(context, source)
        : looseCanvas(context, mark);
    if (!image) return;
    // Cells are flat colors; smoothing would blur their edges.
    const smoothing = context.imageSmoothingEnabled;
    context.imageSmoothingEnabled = false;
    context.drawImage(image, mark.x, mark.y, mark.width, mark.height);
    context.imageSmoothingEnabled = smoothing;
  },
};

function newCanvas(context: CanvasRenderingContext2D, columns: number, rows: number): Canvas {
  return typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(columns, rows)
    : Object.assign(context.canvas.ownerDocument.createElement("canvas"), {
        width: columns,
        height: rows,
      });
}

const contextOf = (canvas: Canvas) => canvas.getContext("2d") as Context2D | null;

/** A canvas of the raster's pixels, put whole. */
function looseCanvas(context: CanvasRenderingContext2D, mark: RasterGeometry): Canvas | undefined {
  let canvas = loose.get(mark.pixels.buffer);
  if (!canvas || canvas.width !== mark.columns || canvas.height !== mark.rows) {
    canvas = newCanvas(context, mark.columns, mark.rows);
    loose.set(mark.pixels.buffer, canvas);
  }
  const target = contextOf(canvas);
  if (!target) return undefined;
  target.putImageData(new ImageData(mark.pixels, mark.columns, mark.rows), 0, 0);
  rasterWork.put += mark.columns * mark.rows;
  return canvas;
}

/**
 * The source's canvas, brought to its revision: as it is when it holds it
 * (a hover frame puts nothing); when the patches since the revision it
 * holds are kept, shifted once and the rectangles they changed put; else,
 * and on a new canvas, the whole image put.
 */
function sourceCanvas(context: CanvasRenderingContext2D, source: RasterSource): Canvas | undefined {
  const { columns, rows } = source;
  let entry = held.get(source);
  if (!entry || entry.canvas.width !== columns || entry.canvas.height !== rows) {
    const made = { canvas: newCanvas(context, columns, rows), revision: Number.NaN };
    // A canvas whose context was lost and given back holds nothing.
    made.canvas.addEventListener?.("contextrestored", () => {
      made.revision = Number.NaN;
    });
    entry = made;
    held.set(source, entry);
  }
  const { canvas } = entry;
  if (entry.revision === source.revision) return canvas;
  const target = contextOf(canvas);
  if (!target || target.isContextLost?.()) return undefined;
  const image = new ImageData(source.pixels, columns, rows);
  const changed = changedSince(source, entry.revision);
  if (!changed) {
    target.putImageData(image, 0, 0);
    rasterWork.put += columns * rows;
  } else {
    const { shift, rects } = changed;
    if (shift !== 0) {
      // Replacing, so that pixels the image moved leave none of theirs behind.
      const mode = target.globalCompositeOperation;
      target.globalCompositeOperation = "copy";
      target.drawImage(canvas, shift, 0);
      target.globalCompositeOperation = mode;
    }
    for (let i = 0; i < rects.length; i += 4) {
      target.putImageData(image, 0, 0, rects[i]!, rects[i + 1]!, rects[i + 2]!, rects[i + 3]!);
      rasterWork.put += rects[i + 2]! * rects[i + 3]!;
    }
  }
  entry.revision = source.revision;
  return canvas;
}

/**
 * What changed in `source` since `revision`, in its pixels now: the
 * columns its patches moved the image by in all, and the rectangles they
 * painted, each earlier one moved by the later shifts and cut at the
 * edges. Undefined when a patch since is no longer kept, one painted
 * everything, or the rectangles are too many to put one by one.
 */
export function changedSince(
  source: RasterSource,
  revision: number,
): { shift: number; rects: number[] } | undefined {
  const { patches, columns } = source;
  const first = patches.findIndex((patch) => patch.revision === revision + 1);
  if (first < 0 || patches[patches.length - 1]!.revision !== source.revision) return undefined;
  let shift = 0;
  let rects: number[] = [];
  for (let p = first; p < patches.length; p++) {
    const patch = patches[p]!;
    if (!patch.rects) return undefined;
    if (patch.shift !== 0) {
      const moved: number[] = [];
      for (let i = 0; i < rects.length; i += 4) {
        const x0 = Math.max(0, rects[i]! + patch.shift);
        const x1 = Math.min(columns, rects[i]! + rects[i + 2]! + patch.shift);
        if (x1 > x0) moved.push(x0, rects[i + 1]!, x1 - x0, rects[i + 3]!);
      }
      rects = moved;
      shift += patch.shift;
    }
    for (const value of patch.rects) rects.push(value);
  }
  return rects.length / 4 > MOST_RECTS ? undefined : { shift, rects };
}
