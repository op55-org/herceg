// The guide compiler: plans what only charts asking for it need (see
// model/guides.ts). It plans the ticks and formats of axes whose settings
// ask for more than a count and Intl options, the axes `guides` lists, and
// legends and colorbars. A live chart loads it before drawing such a
// configuration; static output imports it.

import type { AxisContext } from "../model/axis.ts";
import type { CompiledGuides, GuideCompiler, GuideKit } from "../model/guides.ts";
import type { ChartConfig } from "../model/model.ts";
import type { ScaleName } from "../model/scales.ts";
import { compiledAxes, listedAxes } from "./axes.ts";
import { compiledLegends, plannedLegends } from "./legends.ts";
import type { Format } from "./options.ts";
import { countOf, tickPlanner, writer } from "./ticks.ts";

/**
 * Refuses what axes and guides ask before round 2's stream R draws it (see
 * marks/pending.ts): scales' padding, grids among the marks, axes of the
 * chart's own position scales, and tick labels inside the plot or apart
 * from their ticks.
 */
function refusePending(kit: GuideKit, config: ChartConfig): void {
  const refuse = (path: string, correction: string) => {
    throw new kit.ChartError({
      code: "unsupported",
      path,
      message: `chart ${path}: not drawn as given yet (round 2 stream R adds it); ${correction}`,
    });
  };
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
        box(name)
          ? []
          : [
              [
                /^[A-Za-z_$][\w$]*$/.test(name)
                  ? `scales.${name}`
                  : `scales[${JSON.stringify(name)}]`,
                scale,
              ],
            ],
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
  for (const [path, settings] of axes) {
    const axis = settings as { grid?: unknown; padding?: unknown } | undefined;
    const z = gridZ(axis?.grid);
    if (z !== undefined && z !== -1) refuse(`${path}.grid.zIndex`, "drop zIndex");
    if (axis?.padding !== undefined && axis.padding !== "auto")
      refuse(`${path}.padding`, 'drop padding, or give "auto"');
  }
  config.guides?.forEach((guide, i) => {
    if (guide.type === "legend") return;
    const at = `guides[${i}]`;
    if (guide.type === "axis") {
      if (!SCALES.includes(guide.scale as ScaleName)) {
        if (["linear", "log", "time"].includes(config.scales?.[guide.scale]?.type as string))
          refuse(`${at}.scale`, "name x, y, or yRight");
        throw new kit.ChartError({
          code: "unknown-reference",
          path: `${at}.scale`,
          message: `chart ${at}.scale: the chart has no position scale "${guide.scale}"; name x, y, or yRight`,
        });
      }
      const z = gridZ(guide.grid);
      if (z !== undefined && z !== -1) refuse(`${at}.grid.zIndex`, "drop zIndex");
    }
    for (const [path, spec] of tickLabels(guide, at)) {
      const { inside, gap } = (spec || {}) as { inside?: boolean; gap?: number };
      if (inside || gap !== undefined)
        refuse(`${path}.${inside ? "inside" : "gap"}`, `drop ${inside ? "inside" : "gap"}`);
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
  // refuses those round 2 does not draw yet.
  for (const [name, scale] of Object.entries(scales ?? {}))
    if (
      !SCALES.includes(name as ScaleName) &&
      !["ordinal", "identity", "linear", "log", "time"].includes(scale?.type as string)
    )
      throw new Error(
        `chart scales.${name}: marks place values on x, y, and yRight; name one of those, or give type: "ordinal" for a scale of categories`,
      );
  for (const scale of SCALES) note(scales?.[scale], `scales.${scale}`);
  refusePending(kit, config);
  let read = config;
  // Listed axes: each scale's on its default side read as its short form.
  config.guides?.forEach((guide, i) => {
    note(guide, `guides[${i}]`);
  });
  const listed = listedAxes(read);
  if (listed) read = { ...read, ...listed.read };
  // The duplicates policy of the axis whose ticks the model plans for the
  // scale: an axis moved off the default side leaves out repeats, as its
  // other layers do, unless it says otherwise.
  const repeats = (scale: ScaleName) => {
    const axis = listed?.axes.find((one) => one.scale === scale && one.layers[0]!.planned);
    const labels = axis?.layers[0]?.labels;
    return labels ? (labels.duplicates ?? (axis.home ? undefined : "hide")) : undefined;
  };
  const legends = plannedLegends(kit, read);
  return {
    axes: listed && compiledAxes(kit, listed.axes),
    legends: legends && compiledLegends(kit, legends),
    config: read,
    context(context: AxisContext, scale: ScaleName): AxisContext {
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
      if (!plannedTicks && !plannedFormat && !plannedValue && !policy && ticks === count)
        return context;
      const at = (value: unknown, fallback: string) =>
        `chart ${paths.get(value as object) ?? `${scale}.${fallback}`}`;
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
      };
    },
  };
}

/** A format only the compiler writes: a pattern or a function. */
function planned(format: Format | undefined): boolean {
  return typeof format === "function" || (!!format && ("number" in format || "time" in format));
}
