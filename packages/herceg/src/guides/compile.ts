// The guide compiler: plans what only charts asking for it need (see
// model/guides.ts). It plans the ticks and formats of axes whose settings
// ask for more than a count and Intl options, the axes `guides` lists, and
// legends and colorbars. A live chart loads it before drawing such a
// configuration; static output imports it.

import { intlOptions } from "../format/patterns.ts";
import type { AxisContext } from "../model/axis.ts";
import type { CompiledGuides, GuideCompiler, GuideKit } from "../model/guides.ts";
import type { ChartConfig } from "../model/model.ts";
import type { ScaleName } from "../model/scales.ts";
import { compiledAxes, listedAxes } from "./axes.ts";
import { compiledLegends, plannedLegends } from "./legends.ts";
import type { Format } from "./options.ts";
import { axisPadding } from "./padding.ts";
import { type PaintPlan, planPanels } from "./paint.ts";
import { ownScales } from "./positions.ts";
import { countOf, stepsFiscal, tickPlanner, writer } from "./ticks.ts";

/**
 * Checks what scales, axes, and guides ask, as the validator checks a
 * spec: malformed settings, names of scales the chart lacks, and grid
 * lines along scales of the chart's own, which it does not draw.
 */
function checkSettings(kit: GuideKit, config: ChartConfig): void {
  // 3D boxes refuse their own axes' settings for good (marks/plot3d.ts): a
  // chart's when its marks are 3D, a panel's when its marks are.
  const boxes = config.marks.flatMap((mark) =>
    (mark as { dimensions?: number }).dimensions === 3 ? [mark.spec.panel] : [],
  );
  const gridZ = (grid: unknown) => (grid as { zIndex?: number } | undefined)?.zIndex;
  // A chart without panels whose marks are 3D: its x and y are its box's.
  const box = (name: string) =>
    !config.panels && boxes.length > 0 && (name === "x" || name === "y");
  // Scales first: the short forms hold their settings too, merged.
  const axes: [string, object | undefined][] = [
    ...Object.entries(config.scales ?? {}).flatMap(
      ([name, scale]): [string, object | undefined][] =>
        box(name) ? [] : [[scalePath(name), scale]],
    ),
    ...SCALES.flatMap((name): [string, object | undefined][] =>
      box(name) ? [] : [[name, config[name]]],
    ),
    ...(config.panels?.declared ?? []).flatMap((panel, i) =>
      boxes.includes(panel.id)
        ? []
        : SCALES.map((name): [string, object | undefined] => [`panels[${i}].${name}`, panel[name]]),
    ),
  ];
  // Well formed first, as the validator checks a spec before what it
  // draws: what is malformed is refused for good.
  const malformed = (path: string, expected: string, value: unknown): never => {
    throw new kit.ChartError({
      code: "invalid-option",
      path,
      message: `chart ${path}: expected ${expected}; received ${typeof value === "number" ? value : JSON.stringify(value)}`,
    });
  };
  const pixels = (value: unknown) =>
    typeof value === "number" && value >= 0 && Number.isFinite(value);
  const checkGrid = (grid: unknown, path: string) => {
    const z = gridZ(grid);
    if (z !== undefined && !Number.isFinite(z))
      malformed(`${path}.grid.zIndex`, "a finite number", z);
  };
  for (const [path, settings] of axes) {
    const { grid, padding } = (settings ?? {}) as { grid?: unknown; padding?: unknown };
    checkGrid(grid, path);
    if (typeof padding === "number") {
      if (!(padding >= 0 && padding < 0.5))
        malformed(`${path}.padding`, "a share of the domain from 0 up to 0.5, not 0.5", padding);
    } else if (padding && typeof padding === "object") {
      const { px } = padding as { px?: unknown };
      if (!pixels(px)) malformed(`${path}.padding.px`, "a number of at least 0", px);
    } else if (padding !== undefined && padding !== "auto")
      malformed(
        `${path}.padding`,
        '"auto", a share of the domain from 0 up to 0.5, or { px }',
        padding,
      );
  }
  config.guides?.forEach((guide, i) => {
    if (guide.type === "legend") return;
    if (guide.type === "axis") {
      if (typeof guide.scale !== "string")
        malformed(`guides[${i}].scale`, "a scale's name", guide.scale);
      checkGrid(guide.grid, `guides[${i}]`);
    }
    for (const [path, labels] of tickLabels(guide, `guides[${i}]`)) {
      const { gap, inside } = (labels || {}) as { gap?: unknown; inside?: unknown };
      if (gap !== undefined && !pixels(gap))
        malformed(`${path}.gap`, "a number of at least 0", gap);
      if (inside !== undefined && typeof inside !== "boolean")
        malformed(`${path}.inside`, "true or false", inside);
    }
  });
  config.guides?.forEach((guide, i) => {
    if (guide.type === "legend") return;
    const at = `guides[${i}]`;
    if (guide.type === "axis" && !SCALES.includes(guide.scale as ScaleName)) {
      const named = config.scales?.[guide.scale];
      if (!["linear", "log", "time"].includes(named?.type as string) || "range" in named!)
        throw new kit.ChartError({
          code: "unknown-reference",
          path: `${at}.scale`,
          message: `chart ${at}.scale: the chart has no position scale "${guide.scale}"; name x, y, yRight, or one of its scales of type "linear", "log", or "time"`,
        });
      // Grid lines follow x and y.
      if (guide.grid !== undefined && guide.grid !== false)
        throw new kit.ChartError({
          code: "unsupported",
          path: `${at}.grid`,
          message: `chart ${at}.grid: an axis of a scale of the chart's own draws no grid lines; drop grid`,
        });
    }
  });
}

/** A guide's tick labels and its layers', by their paths. */
function tickLabels(
  guide: { labels?: unknown; layers?: readonly { labels?: unknown }[] },
  at: string,
): [string, unknown][] {
  return [
    [`${at}.labels`, guide.labels],
    ...(guide.layers ?? []).map((layer, k): [string, unknown] => [
      `${at}.layers[${k}].labels`,
      layer.labels,
    ]),
  ];
}

/** The compiler, with the chart's code it uses (see `GuideKit`). */
export function guideCompiler(kit: GuideKit): GuideCompiler {
  return { compile: (config) => compile(kit, config) };
}

const SCALES: readonly ScaleName[] = ["x", "y", "yRight"];

function compile(kit: GuideKit, config: ChartConfig): CompiledGuides {
  // Where each setting that may need planning is, for messages: the same
  // value shows through a panel's axis, merged over the chart's.
  const paths = new WeakMap<object, string>();
  const note = (axis: object | undefined, path: string) => {
    for (const key of ["ticks", "format", "tooltipFormat"] as const) {
      const value = (axis as Record<string, unknown> | undefined)?.[key];
      if (typeof value === "object" || typeof value === "function")
        paths.set(value as object, `${path}.${key}`);
    }
  };
  for (const scale of SCALES) note(config[scale], scale);
  config.panels?.declared.forEach((panel, i) => {
    for (const scale of SCALES) note(panel[scale], `panels[${i}].${scale}`);
  });
  // The model merged `scales` into the short forms; their settings are named where they are set.
  const { scales } = config;
  // Other scales are the feature compiler's, which loads for them and
  // refuses those round 2 does not draw yet; channel scales have a range.
  for (const [name, scale] of Object.entries(scales ?? {}))
    if (
      !SCALES.includes(name as ScaleName) &&
      !["ordinal", "identity", "linear", "log", "time"].includes(scale?.type as string) &&
      !(scale && "range" in scale)
    )
      throw new Error(
        `chart scales.${name}: marks place values on x, y, and yRight; name one of those, or give type: "ordinal" for a scale of categories`,
      );
  for (const [name, scale] of Object.entries(scales ?? {})) note(scale, scalePath(name));
  checkSettings(kit, config);
  let read = config;
  // Listed axes: each scale's on its default side read as its short form.
  config.guides?.forEach((guide, i) => {
    note(guide, `guides[${i}]`);
  });
  const listed = listedAxes(read, kit.alignsTickLabels(read));
  if (listed) read = { ...read, ...listed.read };
  // The duplicates policy of the axis whose ticks the model plans for the
  // scale: an axis moved off the default side leaves out repeats, as its
  // other layers do, unless it says otherwise.
  const repeats = (scale: string) => {
    const axis = listed?.axes.find((one) => one.scale === scale && one.layers[0]!.planned);
    const labels = axis?.layers[0]?.labels;
    return labels ? (labels.duplicates ?? (axis.home ? undefined : "hide")) : undefined;
  };
  const legends = plannedLegends(kit, read);
  const context = (context: AxisContext, scale: string): AxisContext => {
    const spec = context.spec;
    if (!spec) return context;
    const { ticks, format, tooltipFormat } = spec;
    // The model reads a count of ticks; the compiler plans the other forms.
    const count = countOf(ticks);
    const plannedTicks = ticks !== undefined && count === undefined;
    const plannedFormat = planned(format);
    const plannedValue = planned(tooltipFormat) || (tooltipFormat === undefined && plannedFormat);
    // A duplicates policy of its own has the compiler write the axis' labels too.
    const policy = context.type !== "band" && repeats(scale) !== undefined;
    // Padding given replaces the room marks ask for.
    const given = spec.padding === "auto" ? undefined : spec.padding;
    const where = given === undefined ? "" : paddingPath(config, scale, given);
    if (given !== undefined && context.type === "band")
      throw new kit.ChartError({
        code: "invalid-option",
        path: where,
        message: `chart ${where}: a category axis places its categories in bands, with room of their own; drop padding`,
      });
    const padding = given !== undefined ? axisPadding(kit, context, given, where) : undefined;
    const at = (value: unknown, fallback: string) =>
      `chart ${paths.get(value as object) ?? `${scale}.${fallback}`}`;
    // A count and Intl options, which the model plans and writes, have no fiscal year either.
    stepsFiscal(ticks, at(ticks, "ticks"));
    for (const [shown, name] of [
      [format, "format"],
      [tooltipFormat, "tooltipFormat"],
    ] as const)
      if (shown && !planned(shown)) intlOptions(shown as object, at(shown, name));
    if (!plannedTicks && !plannedFormat && !plannedValue && !policy && ticks === count)
      return padding ? { ...context, padding } : context;
    // Category axes label every category that fits, and write them as they are.
    if (context.type === "band" && (plannedTicks || plannedFormat))
      throw new Error(
        plannedTicks
          ? `${at(ticks, "ticks")}: a category axis labels the categories that fit; drop ticks, or give a count`
          : `${at(format, "format")}: a category axis writes its categories as they are; drop format`,
      );
    const plan =
      plannedTicks || plannedFormat || policy
        ? tickPlanner(
            kit,
            ticks,
            format,
            context,
            scale,
            { ticks: at(ticks, "ticks"), format: at(format, "format") },
            repeats(scale),
          )
        : undefined;
    const shown = tooltipFormat ?? format;
    const formatValue = plannedValue
      ? writer(kit, shown, context, scale, at(shown, tooltipFormat ? "tooltipFormat" : "format"))
          ?.value
      : undefined;
    const { ticks: _, ...rest } = spec;
    return {
      ...context,
      spec: count === undefined ? rest : { ...rest, ticks: count },
      plan,
      formatValue,
      padding,
    };
  };
  const plans = new Map<string, PaintPlan>();
  return {
    paint: (panels) => planPanels(panels, plans),
    axes: listed && compiledAxes(kit, listed.axes),
    legends: legends && compiledLegends(kit, legends),
    scales: ownScales(kit, read, context, scalePath),
    config: read,
    context,
  };
}

/**
 * Where padding `given` on scale `scale` is set, for messages: a subplot's
 * settings, the scale's in `scales`, or the short form's, which the model
 * merges `scales` into (equal shares are told apart by where they are
 * found first).
 */
function paddingPath(config: ChartConfig, scale: string, given: unknown): string {
  const of = (settings: unknown) => (settings as { padding?: unknown } | undefined)?.padding;
  const panel = config.panels?.declared.findIndex((p) => of(p[scale as ScaleName]) === given) ?? -1;
  if (SCALES.includes(scale as ScaleName) && panel >= 0) return `panels[${panel}].${scale}.padding`;
  return of(config.scales?.[scale]) === given || !SCALES.includes(scale as ScaleName)
    ? `${scalePath(scale)}.padding`
    : `${scale}.padding`;
}

/** Where scale `name` is set: `scales.name`, or of an odd name `scales["p.99"]`. */
function scalePath(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? `scales.${name}` : `scales[${JSON.stringify(name)}]`;
}

/** A format only the compiler writes: a pattern or a function. */
function planned(format: Format | undefined): boolean {
  return typeof format === "function" || (!!format && ("number" in format || "time" in format));
}
