// The canvas drawing of rasters with a source: what it puts per draw, and
// that the offscreen canvas it keeps holds the source's pixels after any
// sequence of patches. Canvases here are a small model of the 2D context's
// pixel operations (dirty-rectangle puts, a canvas drawn onto itself), so
// what is put can be counted and read back exactly.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rasterDrawing, rasterWork } from "../../src/draw/raster.ts";
import type { RasterGeometry, RasterPatch, RasterSource } from "../../src/scene/scene.ts";

class FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    [this.data, this.width, this.height] = [data, width, height];
  }
}

class FakeCanvas {
  data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    [this.width, this.height] = [width, height];
    this.data = new Uint8ClampedArray(width * height * 4);
    canvases.push(this);
  }
  addEventListener() {}
  getContext() {
    return new FakeContext(this);
  }
}

class FakeContext {
  globalCompositeOperation = "source-over";
  imageSmoothingEnabled = true;
  readonly canvas: FakeCanvas;
  constructor(canvas: FakeCanvas) {
    this.canvas = canvas;
  }
  putImageData(image: FakeImageData, dx: number, dy: number, x = 0, y = 0, w?: number, h?: number) {
    const { data, width } = this.canvas;
    const [sw, sh] = [w ?? image.width, h ?? image.height];
    for (let r = y; r < y + sh; r++)
      for (let c = x; c < x + sw; c++)
        for (let k = 0; k < 4; k++)
          data[((r + dy) * width + c + dx) * 4 + k] = image.data[(r * image.width + c) * 4 + k]!;
  }
  /** Only what the drawing does to its own canvas: itself, shifted, replacing. */
  drawImage(source: FakeCanvas, dx: number, dy: number) {
    if (source !== this.canvas) return;
    expect(this.globalCompositeOperation).toBe("copy");
    const { width, height, data } = this.canvas;
    const next = new Uint8ClampedArray(data.length);
    for (let r = 0; r < height; r++)
      for (let c = 0; c < width; c++) {
        const [fc, fr] = [c - dx, r - dy];
        if (fc < 0 || fc >= width || fr < 0 || fr >= height) continue;
        for (let k = 0; k < 4; k++)
          next[(r * width + c) * 4 + k] = data[(fr * width + fc) * 4 + k]!;
      }
    this.canvas.data = next;
  }
}

let canvases: FakeCanvas[] = [];
const saved = { OffscreenCanvas: globalThis.OffscreenCanvas, ImageData: globalThis.ImageData };

beforeAll(() => {
  Object.assign(globalThis, { OffscreenCanvas: FakeCanvas, ImageData: FakeImageData });
});
afterAll(() => {
  Object.assign(globalThis, saved);
});
beforeEach(() => {
  canvases = [];
});

/** The chart's own context: draws are recorded, not painted. */
const target = {
  imageSmoothingEnabled: true,
  drawImage() {},
} as unknown as CanvasRenderingContext2D;

/** A source kept as a heatmap keeps one: its pixels change in place, revision by revision. */
class Source implements RasterSource {
  revision = 0;
  patches: RasterPatch[] = [];
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  readonly columns: number;
  readonly rows: number;
  constructor(columns: number, rows: number, colors: readonly number[]) {
    [this.columns, this.rows] = [columns, rows];
    this.pixels = new Uint8ClampedArray(columns * rows * 4);
    for (const [i, color] of colors.entries())
      this.paint(i % columns, Math.floor(i / columns), color);
  }
  paint(column: number, row: number, color: number) {
    // Distinct opaque colors; 0 is a transparent hole.
    this.pixels.set(
      color ? [color, 255 - color, color >> 1, 255] : [0, 0, 0, 0],
      (row * this.columns + column) * 4,
    );
  }
  /** Moves the pixels by `shift` columns, then paints `painted` (column, row, color) and records the patch. */
  patch(shift: number, painted: [number, number, number][], rects: number[] | null) {
    const { columns, rows, pixels } = this;
    const before = pixels.slice();
    pixels.fill(0);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < columns; c++)
        if (c - shift >= 0 && c - shift < columns)
          pixels.set(
            before.subarray((r * columns + c - shift) * 4, (r * columns + c - shift) * 4 + 4),
            (r * columns + c) * 4,
          );
    for (const [c, r, color] of painted) this.paint(c, r, color);
    this.revision++;
    this.patches.push({ revision: this.revision, shift, rects: rects && Int32Array.from(rects) });
    if (this.patches.length > 4) this.patches.shift();
  }
}

const geometry = (source: RasterSource, pixels = source.pixels): RasterGeometry => ({
  kind: "raster",
  draw: rasterDrawing,
  key: "cells",
  x: 0,
  y: 0,
  width: source.columns,
  height: source.rows,
  columns: source.columns,
  rows: source.rows,
  pixels,
  source,
});

/** Pixels the draw put. */
function draw(raster: RasterGeometry): number {
  const before = rasterWork.put;
  const canvas = rasterDrawing.canvas as Exclude<typeof rasterDrawing.canvas, false>;
  canvas(target, raster, {} as never);
  return rasterWork.put - before;
}

const held = () => Array.from(canvases[canvases.length - 1]!.data);

describe("raster sources on canvas", () => {
  it("puts every pixel on a new canvas, then none while the revision holds", () => {
    const source = new Source(4, 2, [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(draw(geometry(source))).toBe(8);
    expect(held()).toEqual(Array.from(source.pixels));
    // A hover frame: a new geometry of the same image.
    expect(draw(geometry(source))).toBe(0);
  });

  it("puts what two shifts left uncovered, drawn once after both", () => {
    // [A, B, C, D] shifted twice, a new column painted each time, to [C, D, E, F].
    const [A, B, C, D, E, F] = [10, 20, 30, 40, 50, 60];
    const source = new Source(4, 1, [A, B, C, D]);
    draw(geometry(source));
    source.patch(-1, [[3, 0, E]], [3, 0, 1, 1]);
    source.patch(-1, [[3, 0, F]], [3, 0, 1, 1]);
    expect(draw(geometry(source))).toBe(2);
    expect(held()).toEqual(Array.from(source.pixels));
    expect(held()).toEqual(Array.from(new Source(4, 1, [C, D, E, F]).pixels));
  });

  it("composes a shift one way and back, and changes after them", () => {
    const source = new Source(4, 2, [1, 2, 3, 4, 5, 6, 7, 8]);
    draw(geometry(source));
    source.patch(
      -1,
      [
        [3, 0, 9],
        [3, 1, 10],
      ],
      [3, 0, 1, 2],
    );
    source.patch(
      1,
      [
        [0, 0, 11],
        [0, 1, 12],
      ],
      [0, 0, 1, 2],
    );
    // Holes come in as well as colors.
    source.patch(0, [[2, 1, 0]], [2, 1, 1, 1]);
    expect(draw(geometry(source))).toBe(3);
    expect(held()).toEqual(Array.from(source.pixels));
  });

  it("puts the whole image past the patches kept, after a whole repaint, and for a new size", () => {
    const source = new Source(3, 1, [1, 2, 3]);
    draw(geometry(source));
    for (let i = 0; i < 5; i++) source.patch(-1, [[2, 0, 4 + i]], [2, 0, 1, 1]);
    // A revision missed: its patch is no longer kept.
    expect(draw(geometry(source))).toBe(3);
    expect(held()).toEqual(Array.from(source.pixels));
    // The image painted anew in its buffer (another view, a reused buffer).
    source.patch(
      0,
      [
        [0, 0, 20],
        [1, 0, 21],
      ],
      null,
    );
    expect(draw(geometry(source))).toBe(3);
    expect(held()).toEqual(Array.from(source.pixels));
    // Another source over the same buffer has a canvas of its own.
    const again = Object.assign(new Source(3, 1, []), { pixels: source.pixels });
    expect(draw(geometry(again))).toBe(3);
  });

  it("puts the whole image past 16 rectangles", () => {
    const source = new Source(40, 1, []);
    draw(geometry(source));
    const painted: [number, number, number][] = [];
    const rects: number[] = [];
    for (let c = 0; c < 40; c += 2) {
      painted.push([c, 0, c + 1]);
      rects.push(c, 0, 1, 1);
    }
    source.patch(0, painted, rects);
    expect(draw(geometry(source))).toBe(40);
    expect(held()).toEqual(Array.from(source.pixels));
  });

  it("keeps a look's copy of the pixels off the source's canvas", () => {
    const source = new Source(2, 1, [1, 2]);
    draw(geometry(source));
    const copy = new Uint8ClampedArray(source.pixels.length).fill(200);
    expect(draw(geometry(source, copy))).toBe(2);
    expect(draw(geometry(source, copy))).toBe(2);
    // The source's canvas still holds the source's pixels, and needs nothing.
    expect(draw(geometry(source))).toBe(0);
    expect(Array.from(canvases[0]!.data)).toEqual(Array.from(source.pixels));
  });
});
