// Scene to SVG markup. Used directly for static output (server rendering,
// exports) and piecewise by the live SVG renderer. Each mark's geometry is
// drawn by the drawing it carries; guides are drawn from their items, which
// say where everything goes, so this module places nothing itself.

import { dashAttribute, escapeXml, markupOf, n, rectMarkup } from "../draw/markup.ts";
import { textItemMarkup } from "../draw/text.ts";
import { gridLines } from "../scene/grid.ts";
import { eachPainted, type GridBatch } from "../scene/paint.ts";
import {
  type ColorbarGuide,
  clipOf,
  type Geometry,
  type Guide,
  type GuideItem,
  type Panel,
  type RampGuide,
  type Rect,
  type Scene,
  type ShapeItem,
  type SvgContext,
  type SvgElement,
  type TitleGuide,
} from "../scene/scene.ts";
import type { StrokePaint } from "../style/style.ts";
import type { Theme } from "../theme.ts";

/**
 * Markup of what `panel` paints over its plot's background: its plan, in
 * order, each geometry cut to the clip path `clip` names for it (none when
 * undefined); entries one after another cut alike share a group.
 */
export function contentMarkup(
  panel: Panel,
  context: SvgContext,
  clip: (mark: Geometry) => string | undefined,
): string {
  let out = "";
  let open: string | undefined;
  const cut = (id: string | undefined) => {
    if (id === open) return;
    if (open) out += "</g>";
    if (id) out += `<g clip-path="url(#${id})">`;
    open = id;
  };
  eachPainted(
    panel,
    (batch) => {
      cut(undefined);
      out += gridMarkup(batch, panel.plot, context.theme);
    },
    (mark) => {
      cut(clip(mark));
      out += mark.draw.svg(mark, context) + (context.titles?.(mark) ?? "");
    },
  );
  cut(undefined);
  return out;
}

/**
 * The id of the clip path `mark` is cut to, of the ids of its panel's
 * plot's (`plot`), of where what the panel does not cut to its plot keeps
 * to with insets over it (`keep`), and of the chart's: undefined for none.
 */
export function clipId(
  mark: Geometry,
  plot: string,
  keep: string | undefined,
  chart: string,
): string | undefined {
  const clip = clipOf(mark);
  return clip === "plot" ? plot : (keep ?? (clip === "chart" ? chart : undefined));
}

/** Whether any geometry of the scene is cut to the chart, which needs a clip path of its own. */
export function cutToChart(scene: Scene): boolean {
  return scene.panels.some((panel) => panel.marks.some((mark) => mark.clip === "chart"));
}

/** Path data of segments: horizontal and vertical ones in the short forms. */
export function segmentPath(coords: readonly number[]): string {
  let d = "";
  for (let i = 0; i + 3 < coords.length; i += 4) {
    const [x1, y1, x2, y2] = [coords[i]!, coords[i + 1]!, coords[i + 2]!, coords[i + 3]!];
    d += `M${n(x1)} ${n(y1)}`;
    d += y1 === y2 ? `H${n(x2)}` : x1 === x2 ? `V${n(y2)}` : `L${n(x2)} ${n(y2)}`;
  }
  return d;
}

/** A stroke's attributes: its color, and its width, dash, and opacity where they are not the defaults. */
export function strokeAttributes(paint: StrokePaint): string {
  return (
    ` stroke="${escapeXml(paint.stroke)}"` +
    (paint.strokeWidth !== 1 ? ` stroke-width="${paint.strokeWidth}"` : "") +
    dashAttribute(paint.dash) +
    (paint.opacity !== 1 ? ` stroke-opacity="${paint.opacity}"` : "")
  );
}

/** A shape item's markup: its path about its point, outlined 1 pixel wide when it has a stroke. */
export function shapeMarkup(item: ShapeItem): string {
  const opacity = item.opacity !== undefined ? ` opacity="${item.opacity}"` : "";
  const fillOpacity = item.fillOpacity !== undefined ? ` fill-opacity="${item.fillOpacity}"` : "";
  const outline = item.stroke
    ? ` stroke="${escapeXml(item.stroke)}" stroke-width="1" stroke-linejoin="round"`
    : "";
  return `<path transform="translate(${n(item.at[0])} ${n(item.at[1])})" d="${item.d}" fill="${escapeXml(item.fill)}"${fillOpacity}${outline}${opacity}/>`;
}

/**
 * Markup of a guide's items (an axis', or `guide`'s); `id` makes a
 * document-unique id for each ramp's gradient.
 */
export function itemsMarkup(
  items: readonly GuideItem[],
  root: Theme,
  id: () => string,
  guide?: Guide,
): string {
  let out = "";
  for (const item of items) {
    switch (item.type) {
      case "text":
        out += textItemMarkup(item, root);
        break;
      case "segments":
        if (item.coords.length > 0)
          out += `<path d="${segmentPath(item.coords)}"${strokeAttributes(item.paint)} fill="none"/>`;
        break;
      case "shape":
        out += shapeMarkup(item);
        break;
      case "rect": {
        const opacity = item.opacity !== undefined ? ` opacity="${item.opacity}"` : "";
        out += rectMarkup(item, item.radius, ` fill="${escapeXml(item.fill)}"${opacity}`);
        break;
      }
      case "ramp":
        out += (guide as RampGuide | ColorbarGuide).rampMarkup(item, id());
        break;
    }
  }
  return out;
}

/** A grid batch as one element: its lines in one stroke. */
export function gridElement(batch: GridBatch, plot: Rect, theme: Theme): SvgElement {
  const { stroke, strokeWidth, dash, opacity } = batch.paint ?? theme.style.grid;
  const attributes: Record<string, string> = { d: segmentPath(gridLines(batch, plot)), stroke };
  if (strokeWidth !== 1) attributes["stroke-width"] = String(strokeWidth);
  if (dash.length) attributes["stroke-dasharray"] = dash.join(" ");
  if (opacity !== 1) attributes["stroke-opacity"] = String(opacity);
  attributes.fill = "none";
  return { tag: "path", attributes };
}

function gridMarkup(batch: GridBatch, plot: Rect, theme: Theme): string {
  return markupOf([gridElement(batch, plot, theme)]);
}

/**
 * Markup of what is painted under every panel, the chart's background; or
 * under what `panel` paints, its plot's background, and for an inset, over
 * the panels before it, its box first.
 */
export function underMarkup(scene: Scene, panel?: Panel): string {
  const { theme, width, height } = scene;
  const background = theme.background !== "transparent" && ` fill="${escapeXml(theme.background)}"`;
  if (!panel) return background ? `<rect width="${width}" height="${height}"${background}/>` : "";
  let out = background && panel.cover ? rectMarkup(panel.cover, 0, background) : "";
  if (panel.frame?.fill)
    for (const rect of panel.visible ?? [panel.plot])
      out += rectMarkup(rect, 0, ` fill="${escapeXml(panel.frame.fill)}"`);
  return out;
}

/**
 * Markup of a scene's axes, plot borders, and guides; without `legend`,
 * not the series legend, which the browser draws as buttons.
 */
export function guidesMarkup(scene: Scene, id: string, legend: boolean): string {
  const root = scene.theme;
  let ramps = 0;
  const next = () => `${id}-ramp-${ramps++}`;
  let out = '<g style="font-variant-numeric:tabular-nums">';
  for (const { axes, plot, frame } of scene.panels) {
    for (const axis of axes) out += itemsMarkup(axis.items, root, next);
    if (frame?.stroke)
      out += rectMarkup(
        plot,
        0,
        ` fill="none" stroke="${escapeXml(frame.stroke)}"${frame.strokeWidth !== 1 ? ` stroke-width="${frame.strokeWidth}"` : ""}`,
      );
  }
  out += "</g>";
  for (const guide of scene.guides)
    if (legend || guide.kind !== "legend") out += itemsMarkup(guide.items, root, next, guide);
  return out;
}

/** An alignment of SVG's `preserveAspectRatio`. */
export type SvgAlign =
  | "xMinYMin"
  | "xMidYMin"
  | "xMaxYMin"
  | "xMinYMid"
  | "xMidYMid"
  | "xMaxYMid"
  | "xMinYMax"
  | "xMidYMax"
  | "xMaxYMax";

/**
 * How a standalone SVG sizes and scales. Scaling an SVG scales its text and
 * geometry as they are laid out; a live chart lays itself out again at a
 * new size instead.
 */
export interface SvgSizing {
  /**
   * "fixed" (the default): width and height attributes of the chart's size.
   * "fluid": neither, so CSS or the container sizes the SVG, its viewBox
   * scaling the chart to fit (as wide as its container by default).
   */
  sizing?: "fixed" | "fluid" | undefined;
  /**
   * How the chart fits a box of another aspect ratio, as SVG's attribute
   * of the same name says: "none" stretches it; the default centers it whole.
   */
  preserveAspectRatio?: "none" | SvgAlign | `${SvgAlign} ${"meet" | "slice"}` | undefined;
  /**
   * "fixed": lines and outlines keep their width in pixels however the SVG
   * scales. "scale" (the default) scales them with it.
   */
  strokeScaling?: "scale" | "fixed" | undefined;
}

/** Each sizing option, the values it takes, and how messages say them. */
const SIZING: readonly [keyof SvgSizing, RegExp, string][] = [
  ["sizing", /^(fixed|fluid)$/, '"fixed" or "fluid"'],
  [
    "preserveAspectRatio",
    /^(none|x(Min|Mid|Max)Y(Min|Mid|Max)( (meet|slice))?)$/,
    '"none" or an alignment such as "xMidYMid meet"',
  ],
  ["strokeScaling", /^(scale|fixed)$/, '"scale" or "fixed"'],
];

/** Throws for `SvgSizing` options that are not valid, named under `where` (such as "renderToSVG"). */
export function checkSizing(options: SvgSizing, where: string): void {
  for (const [key, valid, expected] of SIZING) {
    const value: unknown = options[key];
    if (value !== undefined && !(typeof value === "string" && valid.test(value)))
      throw new TypeError(
        `${where} ${key}: expected ${expected}; received ${JSON.stringify(value)}`,
      );
  }
}

export interface SvgOptions extends SvgSizing {
  /** Raster image encoder; rasters are omitted without one. */
  encodeRaster?: SvgContext["encodeRaster"];
  /** Prefix for element ids, unique per document. */
  idPrefix?: string;
  /** Accessible name; defaults to the scene title. */
  title?: string;
  description?: string;
  /** Include the legend (the browser runtime renders it as HTML instead). */
  legend?: boolean;
  /** Bars, points, and lines with native tooltips: `titlesOf` (render/titles.ts) for the scene. */
  titles?: SvgContext["titles"];
  /**
   * Draw text unkerned and without ligatures, as supplied fonts measure
   * it: glyph after glyph.
   */
  unkerned?: boolean;
}

/** Complete, standalone SVG document for a scene. */
export function renderSvg(scene: Scene, options: SvgOptions = {}): string {
  const { theme, width, height } = scene;
  const id = options.idPrefix ?? "herceg";
  const title =
    options.title ??
    (scene.guides.find((guide) => guide.kind === "title") as TitleGuide | undefined)?.text;
  const labelled = [title ? `${id}-title` : "", options.description ? `${id}-desc` : ""]
    .filter(Boolean)
    .join(" ");
  const size = options.sizing === "fluid" ? "" : ` width="${width}" height="${height}"`;
  const aspect = options.preserveAspectRatio;
  const fixed = options.strokeScaling === "fixed";
  let out = `<svg xmlns="http://www.w3.org/2000/svg"${fixed ? ` id="${escapeXml(id)}"` : ""}${size} viewBox="0 0 ${width} ${height}"${aspect ? ` preserveAspectRatio="${aspect}"` : ""} role="img"${labelled ? ` aria-labelledby="${labelled}"` : ""} font-family="${escapeXml(theme.font)}" font-size="${theme.fontSize}" fill="${escapeXml(theme.muted)}"${options.unkerned ? ' style="font-kerning:none;font-variant-ligatures:none"' : ""}>`;
  if (title) out += `<title id="${id}-title">${escapeXml(title)}</title>`;
  if (options.description) out += `<desc id="${id}-desc">${escapeXml(options.description)}</desc>`;
  // vector-effect is not inherited, so every element of this document gets
  // it (and of no other, where the SVG is inlined into a page).
  if (fixed)
    out += `<style>[id="${escapeXml(cssString(id))}"] *{vector-effect:non-scaling-stroke}</style>`;
  out += "<defs>";
  // A panel with insets over it draws only where they leave its plot
  // visible, and what it does not cut there keeps off them too.
  const rects = (list: readonly Rect[]) => list.map((rect) => rectMarkup(rect, 0, "")).join("");
  scene.panels.forEach((panel, i) => {
    out += `<clipPath id="${id}-clip-${i}">${rects(panel.visible ?? [panel.plot])}</clipPath>`;
    if (panel.keep) out += `<clipPath id="${id}-keep-${i}">${rects(panel.keep)}</clipPath>`;
  });
  if (cutToChart(scene))
    out += `<clipPath id="${id}-clip-chart"><rect width="${width}" height="${height}"/></clipPath>`;
  out += "</defs>";
  const context: SvgContext = { theme, encodeRaster: options.encodeRaster, titles: options.titles };
  // Panels in their paint order: those in cells, then each inset over its
  // box (axes go over them all: an inset sits in its parent's plot).
  out += underMarkup(scene);
  for (const panel of scene.painted ?? scene.panels) {
    const i = scene.panels.indexOf(panel);
    out += underMarkup(scene, panel);
    out += contentMarkup(panel, context, (mark) =>
      clipId(mark, `${id}-clip-${i}`, panel.keep && `${id}-keep-${i}`, `${id}-clip-chart`),
    );
  }
  out += guidesMarkup(scene, id, options.legend ?? true);
  return `${out}</svg>`;
}

/**
 * `text` inside a CSS string: quotes, backslashes, and line breaks escaped,
 * so any id prefix (one starting with a digit too) selects its document.
 */
function cssString(text: string): string {
  return text.replace(/["\\\n\r]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}
