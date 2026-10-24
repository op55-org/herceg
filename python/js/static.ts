// Static rendering inside an embedded JavaScript engine (no DOM): the Python
// package calls `hercegStatic.svg(specJson, base64Buffers, ...)`, and `pdf`, which
// returns the document as base64.

import { type FontSource, type Fonts, prepareFonts } from "herceg/fonts";
import type { PdfExportOptions } from "herceg/pdf";
import {
  type ChartErrorInfo,
  type ChartSpec,
  chartError,
  errorInfo,
  loadSpec,
  type PdfSpec,
  type SvgSettings,
  specToPDF,
  specToSnapshot,
  specToSVG,
} from "herceg/spec";
import { sizedRoot } from "../../packages/herceg/src/image/raster.ts";
import { type RasterSettings, staticRaster } from "../../packages/herceg/src/render/static.ts";
import { cssColor } from "../../packages/herceg/src/scale/css-color.ts";
import { decodeBase64, encodeBase64 } from "./buffers.ts";
import { rasterFont } from "./raster-font.ts";

type Sources = (Omit<FontSource, "data"> & { data: string })[];

/**
 * `run`, with what fonts refuse said in Python's words: text they do not
 * cover with its fix, as PDF export refuses it, and other problems with
 * what to supply instead.
 */
function withFonts<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("fonts do not cover"))
      throw new Error(`fonts: ${message.slice("fonts ".length)}`);
    const problem = message.replace(
      "; match the theme's font or add an explicit fallback family",
      "",
    );
    throw new Error(
      `fonts: ${problem}; supply static OpenType fonts covering the text and matching the theme's font`,
    );
  }
}

/** The font sources Python sends (as base64), and fonts of them refusing in Python's words. */
function fontsOf(options: string): { sources: FontSource[]; fonts: Fonts | undefined } {
  const sources = (JSON.parse(options) as Sources).map((font) => ({
    ...font,
    data: decodeBase64(font.data),
  }));
  const registry = sources.length ? withFonts(() => prepareFonts(sources)) : undefined;
  return {
    sources,
    fonts:
      registry &&
      (Object.create(registry, {
        measure: {
          value: (text: string, font: string) => withFonts(() => registry.measure(text, font)),
        },
      }) as typeof registry),
  };
}

/**
 * Runs an export. What herceg refuses (a spec it does not accept, a font it
 * cannot embed) is returned as `{ error }`, its message, and `info`, the
 * `ChartErrorInfo` Python raises as a `ChartError`: thrown, it would reach
 * Python as V8's report, with a line of this bundle's source in it.
 */
function exported(run: () => string): string | { error: string; info: ChartErrorInfo } {
  try {
    return run();
  } catch (error) {
    const info = errorInfo(chartError(error, "validate"));
    return { error: info.message, info };
  }
}

(globalThis as { hercegStatic?: unknown }).hercegStatic = {
  svg(
    spec: string,
    buffers: string[],
    options = "[]",
    raster = false,
    settings = "{}",
  ): string | { error: string; info: ChartErrorInfo } {
    return exported(() => {
      const { sources, fonts } = fontsOf(options);
      const svg = specToSVG(JSON.parse(spec) as ChartSpec, buffers.map(decodeBase64), {
        ...(JSON.parse(settings) as SvgSettings),
        ...(fonts && { fonts }),
      });
      return raster
        ? JSON.stringify({
            svg,
            fonts: withFonts(() => sources.map((source, i) => encodeBase64(rasterFont(source, i)))),
          })
        : svg;
    });
  },
  /**
   * What an image export draws, as JSON (see Python's `_render.image`): the
   * SVG at the image's pixels, the colors under it as RGBA (alpha 0 to
   * 255), and the fonts resvg draws it in, as base64. Refusals name `where`.
   */
  image(
    spec: string,
    buffers: string[],
    options = "[]",
    settings = "{}",
    where = "to_image",
  ): string | { error: string; info: ChartErrorInfo } {
    return exported(() => {
      const { sources, fonts } = fontsOf(options);
      const { config } = loadSpec(JSON.parse(spec) as ChartSpec, buffers.map(decodeBase64));
      const chart = { ...config, width: config.width ?? 640, height: config.height ?? 320 };
      const source = staticRaster(where, chart, JSON.parse(settings) as RasterSettings, fonts);
      const [width, height] = source.plan.pixels;
      return JSON.stringify({
        svg: sizedRoot(source.svg, String(width), String(height), true),
        under: (source.under ?? []).map((color) => {
          // Bytes, as Pillow takes them: hsl() and color-mix() give fractions.
          const [r, g, b, a] = cssColor(color)!;
          return [Math.round(r), Math.round(g), Math.round(b), Math.round(a * 255)];
        }),
        fonts: withFonts(() => sources.map((source, i) => encodeBase64(rasterFont(source, i)))),
      });
    });
  },
  /**
   * A snapshot for a page to show and a browser to hydrate, as JSON:
   * `options` hold its size, id prefix, locale, and zone, and its fonts as
   * base64.
   */
  snapshot(
    spec: string,
    buffers: string[],
    options = "{}",
  ): string | { error: string; info: ChartErrorInfo } {
    return exported(() => {
      const { fonts, ...settings } = JSON.parse(options) as {
        fonts?: (Omit<FontSource, "data"> & { data: string })[];
      } & Record<string, unknown>;
      const prepared = fonts?.length
        ? prepareFonts(fonts.map((font) => ({ ...font, data: decodeBase64(font.data) })))
        : undefined;
      return JSON.stringify(
        specToSnapshot(JSON.parse(spec) as ChartSpec, buffers.map(decodeBase64), {
          ...(settings as { idPrefix: string }),
          ...(prepared && { fonts: prepared }),
        }),
      );
    });
  },
  pdf(
    spec: string,
    buffers: string[] | string[][],
    options = "{}",
  ): string | { error: string; info: ChartErrorInfo } {
    const supplied = JSON.parse(options) as Omit<PdfExportOptions, "fonts"> & {
      fonts?: (Omit<FontSource, "data"> & { data: string })[];
    };
    const { fonts, fallback, missingGlyph, ...settings } = supplied;
    return exported(() => {
      const prepared = {
        ...settings,
        ...(fonts?.length && {
          fonts: prepareFonts(fonts.map((font) => ({ ...font, data: decodeBase64(font.data) }))),
          ...(fallback && { fallback }),
          ...(missingGlyph !== undefined && { missingGlyph }),
        }),
      };
      const input = JSON.parse(spec) as ChartSpec | ChartSpec[];
      return encodeBase64(
        Array.isArray(input)
          ? specToPDF(
              input.map(
                (spec, i): PdfSpec => ({
                  spec,
                  buffers: (buffers as string[][])[i]!.map(decodeBase64),
                }),
              ),
              prepared,
            )
          : specToPDF({ spec: input, buffers: (buffers as string[]).map(decodeBase64) }, prepared),
      );
    });
  },
};
