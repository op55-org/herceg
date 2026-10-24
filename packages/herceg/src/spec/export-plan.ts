// The export planner without ChartError: what `planExport` (spec/export.ts)
// and a mounted chart's `toPNG`, whose lazily loaded code must not refer to
// ChartError, share. Layout size (the CSS pixels a chart is laid out in),
// raster resolution (image pixels per CSS pixel, from dots per inch), and
// encoding are separate, so a figure 16 by 10 inches at 150 dpi lays out at
// 1536 by 960 CSS pixels whatever its dpi and is drawn 2400 by 1500 pixels.
// Fonts are given beside these settings, since what carries them differs by
// language (prepared fonts in TypeScript, files in Python).

/** What a chart is written as. */
export type ExportFormat = "svg" | "png" | "jpeg" | "webp";

/** A unit of `size`: CSS pixels (96 per inch), inches, centimeters, millimeters, or points (72 per inch). */
export type LengthUnit = "px" | "in" | "cm" | "mm" | "pt";

/**
 * How a chart is written to a file. Every setting is optional: the format
 * is PNG, the size is the chart's own, in CSS pixels, at 96 dpi.
 */
export interface ExportSettings {
  format?: ExportFormat | undefined;
  /** Width and height in `unit`; the chart's own size by default. */
  size?: readonly [number, number] | undefined;
  unit?: LengthUnit | undefined;
  /** Image pixels per inch, for raster formats: 96 draws a CSS pixel as one image pixel. */
  dpi?: number | undefined;
  /** JPEG and WebP compression quality, from 0 to 100; 90 by default. */
  quality?: number | undefined;
  /**
   * A color under the chart: what a transparent theme shows through, and
   * what JPEG, which has no transparency, composites onto (the chart's own
   * surface by default, else white).
   */
  background?: string | undefined;
  /** "title": SVG elements carry their tooltip's text as a `<title>`, which viewers show on hover. */
  tooltip?: "title" | undefined;
}

/** What an export draws: the chart laid out at `width` by `height` CSS pixels, written as `pixels` image pixels. */
export interface ExportPlan {
  format: ExportFormat;
  /** Layout size in CSS pixels. */
  width: number;
  height: number;
  /** Image pixels for raster formats (width, height); for SVG, the layout size. */
  pixels: readonly [number, number];
  dpi: number;
  /** For JPEG and WebP. */
  quality: number | undefined;
  background: string | undefined;
  tooltip: "title" | undefined;
}

/** CSS pixels per unit. */
const UNITS: Readonly<Record<LengthUnit, number>> = {
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  pt: 96 / 72,
};

/**
 * The largest exports Herceg draws, a policy rather than what every
 * browser or rasterizer can allocate (which may be less): no side longer
 * than 16,384 pixels (WebP's format allows 16,383), and no more than 16.7
 * million pixels in all (64 MiB of RGBA), which a 16 by 10 inch figure at
 * 300 dpi stays under.
 */
export const EXPORT_LIMITS = {
  /** Pixels along either side, of the layout and of the image. */
  side: 16384,
  /** WebP's own limit along either side. */
  webpSide: 16383,
  /** Image pixels in all. */
  pixels: 16_777_216,
  /** Dots per inch. */
  dpi: [1, 1200],
} as const;

const FORMATS: readonly ExportFormat[] = ["svg", "png", "jpeg", "webp"];

/** How planning refuses a setting: at its `path`, saying what is wrong and what to do. */
export type Refuse = (
  path: string,
  message: string,
  code?: "invalid-option" | "unsupported",
) => never;

function positive(value: unknown, path: string, refuse: Refuse): number {
  if (typeof value !== "number" || !(value > 0) || !Number.isFinite(value))
    refuse(path, `expected a positive number; received ${JSON.stringify(value)}`);
  return value;
}

/**
 * `length` in `unit` as CSS pixels, to a ten-thousandth, so that 254 mm
 * lays out at 960 pixels rather than at the float 960.0000000000001.
 */
function cssPixels(length: number, unit: LengthUnit): number {
  return Math.floor(length * UNITS[unit] * 1e4 + 0.5) / 1e4;
}

/** A dimension of `length` CSS pixels in image pixels at `dpi`: rounded half up, never 0. */
function pixelsOf(length: number, dpi: number, path: string, refuse: Refuse): number {
  const pixels = Math.floor((length * dpi) / 96 + 0.5);
  if (pixels < 1)
    refuse(path, `${length} CSS pixels at ${dpi} dpi is less than a pixel; give a larger size`);
  return pixels;
}

/**
 * `planExport`, refusing with `refuse`: a mounted chart's `toPNG` plans
 * with plain errors, since a chunk it loads lazily that referred to
 * ChartError would move ChartError out of the chart's own chunk.
 */
export function planWith(
  settings: ExportSettings,
  chart: { readonly width: number; readonly height: number },
  refuse: Refuse,
): ExportPlan {
  const { format = "png", size, unit = "px", dpi = 96, quality, background, tooltip } = settings;
  if (!FORMATS.includes(format))
    refuse(
      "format",
      `expected "svg", "png", "jpeg", or "webp"; received ${JSON.stringify(format)}`,
    );
  if (typeof unit !== "string" || !Object.hasOwn(UNITS, unit))
    refuse("unit", `expected "px", "in", "cm", "mm", or "pt"; received ${JSON.stringify(unit)}`);
  if (size !== undefined && (!Array.isArray(size) || size.length !== 2))
    refuse("size", `expected a width and a height; received ${JSON.stringify(size)}`);
  if (size === undefined && unit !== "px")
    refuse("unit", "says what size is measured in; give size, or drop unit");
  const width = size ? cssPixels(positive(size[0], "size[0]", refuse), unit) : chart.width;
  const height = size ? cssPixels(positive(size[1], "size[1]", refuse), unit) : chart.height;
  if (!(Math.max(width, height) <= EXPORT_LIMITS.side))
    refuse(
      "size",
      `${width} by ${height} CSS pixels is larger than an export lays out (${EXPORT_LIMITS.side} a side); give a smaller size`,
    );
  const raster = format !== "svg";
  if (settings.dpi !== undefined) {
    if (!raster) refuse("dpi", "sets image pixels, which SVG has none of; drop dpi", "unsupported");
    positive(dpi, "dpi", refuse);
    const [least, most] = EXPORT_LIMITS.dpi;
    if (dpi < least || dpi > most) refuse("dpi", `expected ${least} to ${most}; received ${dpi}`);
  }
  if (quality !== undefined) {
    if (format !== "jpeg" && format !== "webp")
      refuse(
        "quality",
        `compresses JPEG and WebP; ${format.toUpperCase()} keeps every pixel, so drop quality`,
        "unsupported",
      );
    if (typeof quality !== "number" || !(quality >= 0 && quality <= 100))
      refuse("quality", `expected a number from 0 to 100; received ${JSON.stringify(quality)}`);
  }
  if (background !== undefined && (typeof background !== "string" || background === ""))
    refuse("background", `expected a CSS color; received ${JSON.stringify(background)}`);
  if (tooltip !== undefined) {
    if (tooltip !== "title")
      refuse("tooltip", `expected "title"; received ${JSON.stringify(tooltip)}`);
    if (raster)
      refuse(
        "tooltip",
        `"title" writes tooltips into SVG, which a ${format.toUpperCase()} image cannot hold; export SVG, or drop tooltip`,
        "unsupported",
      );
  }
  const pixels = raster
    ? ([pixelsOf(width, dpi, "size", refuse), pixelsOf(height, dpi, "size", refuse)] as const)
    : ([width, height] as const);
  const side = format === "webp" ? EXPORT_LIMITS.webpSide : EXPORT_LIMITS.side;
  if (raster && (Math.max(...pixels) > side || pixels[0] * pixels[1] > EXPORT_LIMITS.pixels))
    refuse(
      settings.dpi !== undefined ? "dpi" : "size",
      `${pixels[0]} by ${pixels[1]} pixels is more than ${format.toUpperCase()} exports draw (${side} a side, ${EXPORT_LIMITS.pixels} in all); lower the dpi or the size`,
    );
  return {
    format,
    width,
    height,
    pixels,
    dpi: raster ? dpi : 96,
    quality: format === "jpeg" || format === "webp" ? (quality ?? 90) : undefined,
    background,
    tooltip,
  };
}
