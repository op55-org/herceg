// Raster images in the browser: a chart's SVG drawn on a canvas of the
// image's pixels, encoded by the browser, then given the resolution its dpi
// says. Loaded by `chart.toPNG()` the first time, and by herceg/image.

import type { FontSource } from "../fonts/registry.ts";
import type { ChartErrorInfo } from "../spec/errors.ts";
import { type ExportPlan, planWith } from "../spec/export-plan.ts";
import { jpegWithDensity, pngWithDensity, webpWithDensity } from "./metadata.ts";

/**
 * How a raster export fails: with a ChartError in herceg/image; with a
 * plain error in `chart.toPNG()`, whose chunk must not refer to ChartError
 * (see `planWith`).
 */
export type Fail = (failure: Omit<ChartErrorInfo, "phase">) => never;

/** What a raster export draws, captured when it is asked for. */
export interface RasterSource {
  /** Which export it is, as failures name it ("toPNG", "renderToImage"). */
  where: string;
  fail: Fail;
  /** The chart's SVG, laid out at the plan's width and height. */
  svg: string;
  plan: ExportPlan;
  /** Faces the SVG's text is drawn in: an SVG drawn as an image sees none of the page's. */
  faces?: readonly FontSource[] | undefined;
  /** Colors painted under the chart, in order: a JPEG's opaque base, then the `background` setting. */
  under?: readonly string[] | undefined;
}

/**
 * `svg` written by `renderSvg` with its root `width` by `height`: lengths
 * in a CSS unit, or (with `stretch`) image pixels the viewBox is drawn
 * onto exactly. A fluid SVG, without either, is left as it is.
 */
export function sizedRoot(svg: string, width: string, height: string, stretch = false): string {
  return svg.replace(
    /^(<svg [^>]*?) width="[^"]*" height="[^"]*"/,
    `$1 width="${width}" height="${height}"${stretch ? ' preserveAspectRatio="none"' : ""}`,
  );
}

/** A mounted chart's SVG as `chart.toPNG(settings)` writes it, of a chart `width` by `height` CSS pixels. */
export function pngOf(
  svg: string,
  width: number,
  height: number,
  document: Document,
  settings: { dpi?: number } = {},
  faces?: readonly FontSource[],
): Promise<Blob> {
  for (const key of Object.keys(settings))
    if (key !== "dpi")
      throw new TypeError(
        `toPNG ${key}: is not a setting of toPNG, which takes dpi; renderToImage (herceg/image) takes the format, size, quality, and background`,
      );
  const plan = planWith(
    { format: "png", dpi: settings.dpi },
    { width, height },
    (path, message) => {
      throw new RangeError(`toPNG ${path}: ${message}`);
    },
  );
  const fail: Fail = ({ message }) => {
    throw new Error(message);
  };
  return rasterize({ where: "toPNG", fail, svg, plan, faces }, document);
}

const NAMES = { png: "PNG", jpeg: "JPEG", webp: "WebP" } as const;

/** The image `source` says, as a Blob of its format with its resolution written. */
export async function rasterize(source: RasterSource, document: Document): Promise<Blob> {
  const { where, fail, plan, faces = [], under = [] } = source;
  const format = plan.format as "png" | "jpeg" | "webp";
  const [width, height] = plan.pixels;
  // The SVG at the image's pixels, so the browser draws its vectors at that size.
  let svg = sizedRoot(source.svg, String(width), String(height), true);
  if (faces.length) svg = svg.replace(/^<svg[^>]*>/, (root) => `${root}${fontFaces(faces)}`);
  const image = document.createElement("img");
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    image.src = url;
    await image.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d");
    if (!context)
      return fail({
        code: "render-failed",
        message: `${where}: the browser gave no canvas of ${width} by ${height} pixels to draw the chart on; lower the dpi or the size`,
      });
    for (const color of under) {
      context.fillStyle = color;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    const type = `image/${format}`;
    const quality = format === "png" ? undefined : (plan.quality ?? 90) / 100;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob)
      return fail({
        code: "render-failed",
        message: `${where}: the browser could not encode the ${NAMES[format]} image of ${width} by ${height} pixels; lower the dpi or the size`,
      });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Browsers that do not write a format write PNG in its place.
    if (blob.type !== type || !signed(bytes, format))
      return fail({
        code: "unsupported",
        path: "format",
        message: `${where} format: this browser does not write ${NAMES[format]} images (it wrote ${blob.type || "something else"}); export PNG or JPEG`,
      });
    const dense =
      format === "png"
        ? pngWithDensity(bytes, plan.dpi)
        : format === "jpeg"
          ? jpegWithDensity(bytes, plan.dpi)
          : webpWithDensity(bytes, plan.dpi, width, height);
    return new Blob([dense as Uint8Array<ArrayBuffer>], { type });
  } finally {
    // The bitmap goes now rather than when the canvas is collected.
    canvas.width = canvas.height = 0;
  }
}

/** Whether `bytes` begin as files of `format` do. */
function signed(bytes: Uint8Array, format: "png" | "jpeg" | "webp"): boolean {
  const text = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  if (format === "png") return bytes[0] === 0x89 && text(1, 3) === "PNG";
  if (format === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  return text(0, 4) === "RIFF" && text(8, 4) === "WEBP";
}

/** CSS rules giving an SVG image `faces`, as data URLs. */
function fontFaces(faces: readonly FontSource[]): string {
  let rules = "";
  for (const { family, weight, data } of faces) {
    let binary = "";
    for (let i = 0; i < data.length; i += 0x8000)
      binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
    const name = family
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/["\\]/g, "\\$&");
    rules += `@font-face{font-family:"${name}";font-weight:${weight === "bold" ? 700 : 400};src:url(data:font/ttf;base64,${btoa(binary)})}`;
  }
  // Markup inside the SVG's style element: its own characters escaped.
  return `<style>${rules.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</style>`;
}
