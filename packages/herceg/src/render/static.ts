// Static output without a DOM: SVG of a chart's options or of a mounted
// chart's current state, with native tooltips when asked, and the SVG a
// raster export draws (herceg/image in browsers, Python's exports).

import type { Chart } from "../dom/handle.ts";
import { readPage } from "../dom/page-theme.ts";
import { checkFonts } from "../fonts/prepared.ts";
import type { Fonts } from "../fonts/registry.ts";
import { type RasterSource, sizedRoot } from "../image/raster.ts";
import { estimateText, type MeasureText } from "../layout/text.ts";
import { describeChart } from "../model/describe.ts";
import { type ChartConfig, ChartModel, STATIC_RASTER_RATIO } from "../model/model.ts";
import { isLightColor } from "../scale/color.ts";
import { cssColor } from "../scale/css-color.ts";
import type { Scene } from "../scene/scene.ts";
import { ChartError } from "../spec/errors.ts";
import {
  type ExportPlan,
  type ExportSettings,
  type LengthUnit,
  planFor,
  refuseSetting,
} from "../spec/export.ts";
import type { ThemeEnvironment } from "../theme.ts";
import { staticCompilers } from "./compilers.ts";
import { checkCoverage } from "./coverage.ts";
import { EXPORT_FONTS, EXPORT_SCENE, type ExportsScene } from "./export-scene.ts";
import { NO_PAGE } from "./fallbacks.ts";
import { pngDataUrl } from "./png.ts";
import { checkSizing, renderSvg, type SvgSizing } from "./svg.ts";
import { type SvgTitles, titlesOf } from "./titles.ts";

/** A chart's options for output without a page: SVG, images, and PDF. */
export interface StaticOptions extends ChartConfig {
  /** CSS pixels the chart is laid out in, unless an export's `size` says otherwise. */
  width: number;
  height: number;
}

/** How `renderToSVG` writes a chart. */
export interface SvgSettings extends SvgSizing {
  /**
   * Width and height, in `unit`, to lay the chart out at in place of its
   * own size: for static options (a mounted chart is written at its size).
   */
  size?: readonly [number, number] | undefined;
  /**
   * What `size` is measured in: "px" (CSS pixels, the default), "in",
   * "cm", "mm", or "pt". A fixed SVG's width and height say it in that
   * unit, so documents place it at that size.
   */
  unit?: LengthUnit | undefined;
  /**
   * "title": each bar, point, and observation of a line carries its
   * tooltip's text as a `<title>`, which viewers show under the pointer.
   * Charts with other marks the tooltip reads are refused, as are more
   * than 5,000 of them; the chart's title, description, and data summary
   * stay what assistive technology reads.
   */
  tooltip?: "title" | undefined;
  /**
   * Fonts from `prepareFonts` (herceg/fonts) to measure text with, which
   * the SVG names: in place of the options' own fonts. A mounted chart is
   * written in the fonts it measures with; giving others is refused.
   */
  fonts?: Fonts | undefined;
  /**
   * Text measurement of static options without fonts. Built-in Helvetica
   * metrics by default, so output is the same on every machine; pass a
   * canvas-based measurer to match a browser.
   */
  measureText?: MeasureText | undefined;
  /**
   * Prefix for element ids in the output. Charts embedded in the same
   * document need distinct prefixes; by default each call gets a new one.
   */
  idPrefix?: string | undefined;
}

let renders = 0;

/**
 * The size static `options` are laid out at unless `size` says another:
 * their own, refused unless it is one.
 */
export function ownSize(where: string, options: StaticOptions, size: unknown): StaticOptions {
  if (size === undefined)
    for (const key of ["width", "height"] as const) {
      const value: unknown = options[key];
      if (typeof value !== "number" || !(value > 0) || !Number.isFinite(value))
        refuseSetting(
          where,
          key,
          `expected the chart's size in CSS pixels; received ${JSON.stringify(value)}`,
        );
    }
  return options;
}

/** Whether `target` is a mounted chart rather than options. */
export function isMounted(target: object): target is ExportsScene {
  return EXPORT_SCENE in target;
}

/**
 * Refuses settings a mounted chart cannot honor: another size (it is
 * written at its own, which only its container changes) and other fonts
 * than it measures with.
 */
export function checkMounted(
  where: string,
  chart: ExportsScene,
  settings: { size?: unknown; unit?: unknown; fonts?: Fonts | undefined },
): void {
  const path = settings.size !== undefined ? "size" : settings.unit !== undefined ? "unit" : "";
  if (path)
    refuseSetting(
      where,
      path,
      "a mounted chart is written at its own size, which its container sets; resize the container, or export its options at that size",
      "unsupported",
    );
  if (settings.fonts !== undefined && settings.fonts !== chart[EXPORT_FONTS])
    refuseSetting(
      where,
      "fonts",
      "a mounted chart is written in the fonts it measures its text with; leave fonts out, or give them to the chart",
      "unsupported",
    );
}

/**
 * The scene of static `options` laid out at `width` by `height` CSS
 * pixels, its images at `rasterRatio` pixels per CSS pixel, and its model:
 * text measured with `fonts` (whose coverage is checked) or `measure`.
 */
export function drawStatic(
  options: ChartConfig,
  width: number,
  height: number,
  fonts: Fonts | undefined,
  measure: MeasureText = estimateText,
  rasterRatio = STATIC_RASTER_RATIO,
): { scene: Scene; model: ChartModel; measure: MeasureText } {
  const model = new ChartModel({ ...options, fonts }, NO_PAGE, ...staticCompilers());
  model.setSize(width, height, 1, rasterRatio);
  // What the bound stores hold now is drawn as a mounted chart draws it.
  options.rowSelection?.highlight(model);
  if (fonts) measure = fonts.measure;
  const scene = model.scene(measure, false, NO_PAGE);
  // What the fonts do not cover is refused, as PDF export refuses it.
  if (fonts) checkCoverage(scene, fonts.measure);
  return { scene, model, measure };
}

/**
 * The chart's scene again with native tooltips: refused for marks that
 * cannot carry them (only bars, points, and lines can, not pies, 3D, or
 * other marks laying out a panel of their own; annotations need none), past
 * the budget, and for what cannot be attributed to rows.
 */
export function titledScene(
  where: string,
  model: ChartModel,
  measure: MeasureText,
  page: ThemeEnvironment,
): { scene: Scene; titles: SvgTitles } {
  // Marks are checked first, every one of the chart's in every panel.
  model.config.marks.forEach(({ spec: { type } }, index) => {
    if (TITLED.has(type) || ANNOTATIONS.has(type)) return;
    refuseSetting(
      where,
      "tooltip",
      `"title" goes on bars, points, and lines, and marks[${index}] (${type}) is none of them; export without tooltip, or with that mark in a chart of its own`,
      "unsupported",
    );
  });
  try {
    return titlesOf(model, measure, { page });
  } catch (error) {
    if (!(error instanceof ChartError)) throw error;
    throw new ChartError({
      code: error.code,
      path: error.path,
      message: error.message.replace(/^chart tooltip:/, `${where} tooltip:`),
    });
  }
}

/** Types of marks whose items native titles go on. */
const TITLED: ReadonlySet<string> = /* @__PURE__ */ new Set(["bar", "point", "line"]);
/** Annotations, which explain the data rather than hold it: they need no titles. */
const ANNOTATIONS: ReadonlySet<string> = /* @__PURE__ */ new Set(["rule", "region", "text"]);

/**
 * A color of an export's settings as the chart reads its own: on its page
 * (where `supported` says what CSS reads as a color), or without one with
 * variables taking their fallbacks; refused unless it is a color.
 */
export function settingColor(
  where: string,
  value: string,
  page: ThemeEnvironment,
  supported?: (color: string) => boolean,
): string {
  let color = "";
  if (!supported || supported(value)) {
    const key = `${where} background`;
    try {
      color = page.color?.(value, key) ?? value;
    } catch (error) {
      // A variable without a fallback, which only a page could read.
      if (!(error instanceof TypeError) || !error.message.startsWith(key)) throw error;
      refuseSetting(where, "background", error.message.slice(key.length).trim());
    }
  }
  if (!cssColor(color))
    refuseSetting(where, "background", `expected a CSS color; received ${JSON.stringify(value)}`);
  return color;
}

/**
 * What a JPEG, which has no transparency, is drawn on under a chart whose
 * own background is not opaque: black under light text, white under dark,
 * as the page it was made for likely is.
 */
export function opaqueBase(scene: Scene): string | undefined {
  const { background, text } = scene.theme;
  if (cssColor(background)?.[3] === 1) return undefined;
  return isLightColor(text) ? "#000000" : "#ffffff";
}

/** Settings of raster exports, as `ImageSettings` (herceg/image) documents them. */
export type RasterSettings = Pick<
  ExportSettings,
  "size" | "unit" | "dpi" | "quality" | "background"
> & {
  format?: "png" | "jpeg" | "webp" | undefined;
};

/**
 * Refuses what SVG export does not take: settings of raster images
 * (planned, and refused with their reasons) and of no export.
 */
function checkSvg(where: string, settings: object): void {
  for (const key of Object.keys(settings))
    if (!SVG_SETTINGS.has(key))
      refuseSetting(
        where,
        key,
        NOT_SVG[key] ??
          "is not a setting of SVG export, which takes size, unit, tooltip, fonts, measureText, idPrefix, sizing, preserveAspectRatio, and strokeScaling",
        key in NOT_SVG ? "unsupported" : "invalid-option",
      );
}

/** Settings of images SVG export refuses, and why. */
const NOT_SVG: Readonly<Record<string, string>> = {
  format: "writes SVG; renderToImage (herceg/image) writes PNG, JPEG, and WebP",
  background: "is drawn under images; give an SVG a background with its theme's background",
};

const SVG_SETTINGS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "size",
  "unit",
  "tooltip",
  "fonts",
  "measureText",
  "idPrefix",
  "sizing",
  "preserveAspectRatio",
  "strokeScaling",
  "dpi",
  "quality",
]);

/**
 * Refuses what an image export does not take: SVG, and settings of no
 * export (`tooltip` is planned, and refused with its reason).
 */
export function checkRaster(where: string, settings: object): void {
  for (const key of Object.keys(settings))
    if (!RASTER_SETTINGS.has(key))
      refuseSetting(
        where,
        key,
        "is not a setting of image exports, which take format, size, unit, dpi, quality, background, and fonts",
      );
  if ((settings as { format?: unknown }).format === "svg")
    refuseSetting(
      where,
      "format",
      'writes "png", "jpeg", or "webp" images; renderToSVG writes SVG',
    );
}

const RASTER_SETTINGS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "format",
  "size",
  "unit",
  "dpi",
  "quality",
  "background",
  "fonts",
  "tooltip",
]);

/**
 * What a raster export of static `options` draws: their SVG laid out at
 * the planned size, images in it at the image's resolution, and the colors
 * under it (see `RasterSource`).
 */
export function staticRaster(
  where: string,
  options: StaticOptions,
  settings: RasterSettings,
  fonts: Fonts | undefined,
  measure?: MeasureText,
): Omit<RasterSource, "fail"> {
  const plan = planFor(
    where,
    { ...settings, format: settings.format ?? "png" },
    ownSize(where, options, settings.size),
  );
  const { scene, model } = drawStatic(
    options,
    plan.width,
    plan.height,
    fonts,
    measure,
    // Images marks draw are drawn at the image's resolution, which the
    // planner bounded, rather than a fixed ratio of the layout's.
    plan.dpi / 96,
  );
  const svg = renderSvg(scene, {
    idPrefix: `herceg-image-${++renders}`,
    unkerned: fonts !== undefined,
    encodeRaster: (mark) => pngDataUrl(mark.columns, mark.rows, mark.pixels),
    description: describeChart(model),
  });
  return { where, svg, plan, under: underOf(where, scene, plan, NO_PAGE) };
}

/**
 * The colors painted under a raster export of `scene`: for JPEG, which has
 * no transparency, an opaque base; then the `background` setting.
 */
export function underOf(
  where: string,
  scene: Scene,
  plan: ExportPlan,
  page: ThemeEnvironment,
  supported?: (color: string) => boolean,
): string[] {
  const under: string[] = [];
  const base = plan.format === "jpeg" ? opaqueBase(scene) : undefined;
  if (base) under.push(base);
  if (plan.background !== undefined)
    under.push(settingColor(where, plan.background, page, supported));
  return under;
}

/**
 * Renders a chart to a standalone SVG string, without a DOM: static
 * options (with `rowSelection`, the selections its stores hold drawn
 * highlighted), or a mounted chart's current state as `chart.toSVG()`
 * writes it. `settings` say its size, scaling, fonts, and native tooltips.
 */
export function renderToSVG(target: Chart | StaticOptions, settings: SvgSettings = {}): string {
  return svgFor("renderToSVG", target, settings);
}

/** `renderToSVG` for `where` (such as "specToSVG"), which its refusals name. */
export function svgFor(
  where: string,
  target: Chart | StaticOptions,
  settings: SvgSettings,
): string {
  checkSvg(where, settings);
  checkSizing(settings, where);
  checkFonts(settings.fonts, where);
  const { size, unit, tooltip, fonts, measureText, sizing, preserveAspectRatio, strokeScaling } =
    settings;
  // Raster settings, planned to be refused with their reasons.
  const { dpi, quality } = settings as { dpi?: number; quality?: number };
  const idPrefix = settings.idPrefix ?? `herceg-svg-${++renders}`;
  const write = (
    scene: Scene,
    model: ChartModel,
    measure: MeasureText,
    page: ThemeEnvironment,
    unkerned: boolean,
  ) => {
    const titled = tooltip ? titledScene(where, model, measure, page) : undefined;
    return renderSvg(titled?.scene ?? scene, {
      sizing,
      preserveAspectRatio,
      strokeScaling,
      idPrefix,
      unkerned,
      encodeRaster: (mark) => pngDataUrl(mark.columns, mark.rows, mark.pixels),
      description: describeChart(model),
      titles: titled?.titles,
    });
  };
  if (isMounted(target)) {
    if (measureText !== undefined)
      refuseSetting(
        where,
        "measureText",
        "measures static options; a mounted chart measures its own text",
        "unsupported",
      );
    checkMounted(where, target, settings);
    return target[EXPORT_SCENE]((scene, model, measure) => {
      planFor(where, { format: "svg", tooltip, dpi, quality }, scene);
      const own = target[EXPORT_FONTS];
      if (own) checkCoverage(scene, own.measure);
      // Titles draw the scene again, reading the page as the chart does.
      return readPage((target as Chart).root, (page) =>
        write(scene, model, measure, page, own !== undefined),
      );
    });
  }
  const options = target as StaticOptions;
  checkFonts(options.fonts, where);
  const used = fonts ?? options.fonts;
  if (used && measureText)
    refuseSetting(
      where,
      "measureText",
      "fonts measure their own text; give fonts or measureText, not both",
    );
  const plan = planFor(
    where,
    { format: "svg", size, unit, tooltip, dpi, quality },
    ownSize(where, options, size),
  );
  const { scene, model, measure } = drawStatic(options, plan.width, plan.height, used, measureText);
  const svg = write(scene, model, measure, NO_PAGE, used !== undefined);
  return size && unit && unit !== "px"
    ? sizedRoot(svg, `${size[0]}${unit}`, `${size[1]}${unit}`)
    : svg;
}
