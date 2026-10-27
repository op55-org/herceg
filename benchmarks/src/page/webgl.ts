// WebGL contexts the page creates, so that a timing can end when the GPU has
// finished drawing them. The page entry imports this module before the
// library (see runner/build.ts), so `getContext` is wrapped before any
// library code runs. Contexts are held through weak references: keeping
// them alive would change what memory scenarios measure.

type Gl = WebGLRenderingContext | WebGL2RenderingContext;

const WEBGL_TYPES = new Set(["webgl", "webgl2", "experimental-webgl"]);
const contexts: WeakRef<Gl>[] = [];
let created = 0;

const htmlGetContext = HTMLCanvasElement.prototype.getContext;

function track(prototype: HTMLCanvasElement | OffscreenCanvas): void {
  const original = prototype.getContext as (
    this: unknown,
    type: string,
    ...rest: unknown[]
  ) => unknown;
  prototype.getContext = function (this: unknown, type: string, ...rest: unknown[]) {
    const context = original.call(this, type, ...rest);
    if (context && WEBGL_TYPES.has(type) && !contexts.some((ref) => ref.deref() === context)) {
      contexts.push(new WeakRef(context as Gl));
      created++;
    }
    return context;
  } as typeof prototype.getContext;
}

track(HTMLCanvasElement.prototype);
if (typeof OffscreenCanvas !== "undefined") track(OffscreenCanvas.prototype);

/** WebGL contexts the page has created so far, including any since lost or collected. */
export function webglContextsCreated(): number {
  return created;
}

const pixel = new Uint8Array(4);

/**
 * Waits until the GPU has finished every live WebGL context's commands: a
 * one-pixel read from a context's default framebuffer blocks until the
 * commands before it are done. Contexts on canvases outside the document
 * count too (a library may draw there and copy the result). The library's
 * framebuffer, read buffer, and pixel-pack state are restored afterwards.
 * Throws when a context on screen is lost (the GPU process reset, say),
 * before or after the read, since the time would no longer include its
 * drawing. Lost contexts off screen are skipped: libraries lose probe
 * contexts and those of destroyed charts on purpose.
 */
export function finishWebgl(): void {
  for (const ref of contexts) {
    const gl = ref.deref();
    if (!gl) continue;
    if (!gl.isContextLost()) {
      if (typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext)
        readPixel2(gl);
      else readPixel(gl);
    }
    const onScreen = gl.canvas instanceof HTMLCanvasElement && gl.canvas.isConnected;
    if (gl.isContextLost() && onScreen)
      throw new Error("finishWebgl: a WebGL context on screen was lost");
  }
}

function readPixel(gl: WebGLRenderingContext): void {
  const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
}

function readPixel2(gl: WebGL2RenderingContext): void {
  const framebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const pack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;
  const store = [gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS].map(
    (name) => [name, gl.getParameter(name) as number] as const,
  );
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  // The default framebuffer's read buffer is the library's to set (BACK or NONE).
  const readBuffer = gl.getParameter(gl.READ_BUFFER) as number;
  gl.readBuffer(gl.BACK);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  for (const [name] of store) gl.pixelStorei(name, 0);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  for (const [name, value] of store) gl.pixelStorei(name, value);
  gl.readBuffer(readBuffer);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pack);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
}

/** The GPU's name, read from a context the harness makes for it and does not track. */
export function gpuName(): string {
  const gl = htmlGetContext.call(
    document.createElement("canvas"),
    "webgl",
  ) as WebGLRenderingContext | null;
  const info = gl?.getExtension("WEBGL_debug_renderer_info");
  return info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
}
