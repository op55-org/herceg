// Raster images, imported as `herceg/image`: PNG, JPEG, and WebP of a chart
// for documents, drawn by the browser. A separate entry point, so charts
// that never write images neither bundle nor (unbundled) load its code.

import type { Chart } from "./dom/handle.ts";
import { measurer } from "./dom/measurers.ts";
import { readPage } from "./dom/page-theme.ts";
import { checkFonts } from "./fonts/prepared.ts";
import type { Fonts } from "./fonts/registry.ts";
import { type Fail, type RasterSource, rasterize } from "./image/raster.ts";
import { describeChart } from "./model/describe.ts";
import { canvasRasterUrl } from "./render/canvas.ts";
import { checkCoverage } from "./render/coverage.ts";
import { EXPORT_FONTS, EXPORT_SCENE } from "./render/export-scene.ts";
import {
  checkMounted,
  checkRaster,
  isMounted,
  type RasterSettings,
  type StaticOptions,
  staticRaster,
  underOf,
} from "./render/static.ts";
import { renderSvg } from "./render/svg.ts";
import { ChartError } from "./spec/errors.ts";
import { EXPORT_LIMITS, type LengthUnit, planFor } from "./spec/export.ts";

export type { ExportFormat, LengthUnit } from "./spec/export.ts";

/** How `renderToImage` writes a chart. Every setting is optional. */
export interface ImageSettings extends RasterSettings {
  /** "png" (the default), "jpeg", or "webp", which not every browser writes. */
  format?: "png" | "jpeg" | "webp" | undefined;
  /**
   * Width and height, in `unit`, to lay static options out at in place of
   * their own size; a mounted chart is drawn at its own.
   */
  size?: readonly [number, number] | undefined;
  /** What `size` is measured in: "px" (CSS pixels, the default), "in", "cm", "mm", or "pt". */
  unit?: LengthUnit | undefined;
  /**
   * Image pixels per inch, which the file records: 96 (the default) draws a
   * CSS pixel as a pixel. It changes only the image's resolution, never how
   * the chart is laid out.
   */
  dpi?: number | undefined;
  /** JPEG and WebP compression, from 0 to 100 (90 by default); PNG refuses it. */
  quality?: number | undefined;
  /**
   * A CSS color under the chart, which a transparent theme shows; JPEG,
   * which has no transparency, is otherwise drawn on the chart's own
   * background, or under a transparent one on black (light text) or white.
   */
  background?: string | undefined;
  /**
   * Fonts from `prepareFonts` (herceg/fonts) to measure and draw text in, in
   * place of static options' own. A mounted chart is drawn in the fonts it
   * measures with; giving others is refused.
   */
  fonts?: Fonts | undefined;
}

const fail: Fail = (failure) => {
  throw new ChartError(failure);
};

/**
 * A PNG, JPEG, or WebP of a chart: static options laid out at their size
 * (or `size`), or a mounted chart's current state (its size, zoom, hidden
 * series, and highlighted selection), at `dpi` pixels per inch, which the
 * file records. The image is captured when this is called and drawn by the
 * browser; what refuses rejects the promise with a `ChartError`.
 */
export function renderToImage(
  target: Chart | StaticOptions,
  settings: ImageSettings = {},
): Promise<Blob> {
  const where = "renderToImage";
  let source: RasterSource;
  let document: Document;
  try {
    checkRaster(where, settings);
    checkFonts(settings.fonts, where);
    if (isMounted(target)) {
      checkMounted(where, target, settings);
      const chart = target as Chart;
      document = chart.root.ownerDocument;
      const fonts = target[EXPORT_FONTS];
      source = target[EXPORT_SCENE]((scene, model) => {
        const plan = planFor(where, { ...settings, format: settings.format ?? "png" }, scene);
        // A mounted chart may draw text its fonts do not cover in the page's;
        // an image has only its fonts.
        if (fonts) checkCoverage(scene, fonts.measure);
        const svg = renderSvg(scene, {
          idPrefix: "herceg-image",
          unkerned: fonts !== undefined,
          encodeRaster: (mark) => {
            // The chart's own bitmap, encoded through a canvas of its size.
            const { columns, rows } = mark;
            const { side, pixels } = EXPORT_LIMITS;
            if (columns > side || rows > side || columns * rows > pixels)
              fail({
                code: "invalid-option",
                message: `${where}: the chart draws an image of ${columns} by ${rows} pixels, more than exports allocate (${side} a side, ${pixels} in all); export the chart's options, which draw it at the image's resolution`,
              });
            return canvasRasterUrl(mark, document);
          },
          description: describeChart(model),
        });
        // The background setting is read of the chart's page, as its colors are.
        const under = readPage(chart.root, (page) =>
          underOf(where, scene, plan, page, (color) => CSS.supports("color", color)),
        );
        return { where, fail, svg, plan, under, faces: fonts?.faces };
      });
    } else {
      document = globalThis.document;
      if (!document)
        throw new TypeError(
          `${where}: draws images in a browser; in Python, chart.to_image writes them`,
        );
      const options = target as StaticOptions;
      checkFonts(options.fonts, where);
      const fonts = settings.fonts ?? options.fonts;
      source = {
        ...staticRaster(where, options, settings, fonts, fonts ? undefined : measurer(document)),
        fail,
        faces: fonts?.faces,
      };
    }
  } catch (error) {
    return Promise.reject(error);
  }
  return rasterize(source, document);
}
