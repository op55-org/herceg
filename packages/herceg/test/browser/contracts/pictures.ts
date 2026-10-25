// The pictures the browser proofs read: images and SVG documents drawn by
// the browser, and the scene a chart draws them from (see
// test/contracts/drawn.ts, which reads them).

import type { Chart } from "../../../src/dom/chart.ts";
import { EXPORT_SCENE, type ExportsScene } from "../../../src/render/export-scene.ts";
import type { Scene } from "../../../src/scene/scene.ts";

/** Pixels per CSS pixel the proofs draw pictures at (see drawn.ts). */
export const SCALE = 3;

/** A chart's picture, 600 CSS pixels wide, as `expectDrawn` reads it. */
export const PICTURE = { width: 600 * SCALE, scale: SCALE, channels: 4 };

/** An image drawn on a white canvas of its size: its RGBA pixels. */
export function draw(image: CanvasImageSource & { width: number; height: number }) {
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = [image.width, image.height];
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** An SVG document as an image `scale` times its size, decoded. */
async function svgImage(svg: string | SVGSVGElement, scale: number): Promise<HTMLImageElement> {
  const root = (
    typeof svg === "string"
      ? new DOMParser().parseFromString(svg, "image/svg+xml").documentElement
      : svg.cloneNode(true)
  ) as SVGSVGElement;
  // Drawn at its size (its view box stays), so that it is drawn sharp rather than scaled up.
  for (const side of ["width", "height"])
    root.setAttribute(side, String(Number(root.getAttribute(side)) * scale));
  const markup = new XMLSerializer().serializeToString(root);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The pixels of an SVG document, as the browser draws it in an image `scale` times its size. */
export async function drawSvg(svg: string | SVGSVGElement, scale = 1): Promise<Uint8ClampedArray> {
  return draw(await svgImage(svg, scale));
}

/** Runs `then` as a screen of `ratio` device pixels per CSS pixel would. */
export async function atRatio<T>(ratio: number, then: () => Promise<T>): Promise<T> {
  const own = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  Object.defineProperty(window, "devicePixelRatio", { value: ratio, configurable: true });
  try {
    return await then();
  } finally {
    if (own) Object.defineProperty(window, "devicePixelRatio", own);
    else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
  }
}

/**
 * What a chart 600 by 400 pixels shows, `SCALE` times its size: its
 * canvases, and its SVG over them, as the page stacks them.
 */
export async function shownPixels(chart: Chart): Promise<Uint8ClampedArray> {
  const picture = document.createElement("canvas");
  [picture.width, picture.height] = [600 * SCALE, 400 * SCALE];
  const context = picture.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, picture.width, picture.height);
  const root = chart.root.getBoundingClientRect();
  const place = (element: Element, image: CanvasImageSource) => {
    const box = element.getBoundingClientRect();
    context.drawImage(
      image,
      (box.left - root.left) * SCALE,
      (box.top - root.top) * SCALE,
      box.width * SCALE,
      box.height * SCALE,
    );
  };
  for (const canvas of chart.root.querySelectorAll("canvas")) place(canvas, canvas);
  const svg = chart.root.querySelector<SVGSVGElement>("svg:has([data-kind])");
  if (svg) place(svg, await svgImage(svg, SCALE));
  return context.getImageData(0, 0, picture.width, picture.height).data;
}

/** Text's width as a live chart measures it, on a canvas. */
const measuring = document.createElement("canvas").getContext("2d")!;
export const measure = (text: string, font: string) => {
  measuring.font = font;
  return measuring.measureText(text).width;
};

/** The scene a chart draws, and its exports: laid out as the chart is, with its text's widths. */
export const drawnScene = (chart: Chart): Scene =>
  (chart as unknown as ExportsScene)[EXPORT_SCENE]((scene) => scene);
