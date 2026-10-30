// Axes the chart's guides list. Each scale's axis on its default side (x
// below the plots, y on their left, yRight on their right) takes the place
// of the automatic one: its settings are read as the short form's, which
// the model plans as it always has. Axes on other sides (x above the plots,
// y on their right) are drawn beside them. Any listed axis may have tick
// layers of its own (minor ticks, a row of day boundaries), tick marks
// pointing in or out, a line, and labels turned or kept apart.

import { anchorBlock } from "../layout/block.ts";
import type { MeasureText } from "../layout/text.ts";
import type { AxisPlan } from "../model/axis.ts";
import type { AxesState, CompiledAxes, GuideKit } from "../model/guides.ts";
import type { ChartConfig } from "../model/model.ts";
import type { ScaleName } from "../model/scales.ts";
import type { AxisGuide, AxisTick, GuideItem, Rect, TextItem } from "../scene/scene.ts";
import type { Side } from "../spec/place.ts";
import type {
  AxisStyles,
  StrokeStyle,
  TextStyle,
  TickLabelsSpec,
  TickMarkSpec,
} from "../spec/spec.ts";
import type { StrokePaint, TextPaint } from "../style/style.ts";
import type { AxisGuideOptions, ChartAxisOptions, Format, Ticks } from "./options.ts";
import { type Read, restroke, restyle } from "./paints.ts";
import { countOf, tickPlanner } from "./ticks.ts";

/** The side each scale's automatic axis is on. */
const HOME: Record<ScaleName, Side> = { x: "bottom", y: "left", yRight: "right" };
/** Whether `scale` is x, y, or yRight, not one of the chart's own (which may be named "constructor"). */
const builtIn = (scale: string): scale is ScaleName => Object.hasOwn(HOME, scale);
/** The default x axes' tick marks' length, which their labels' room keeps (axis-guide.ts). */
export const TICK = 5;
/** Pixels between rows of labels. */
const ROW_GAP = 2;
/** Pixels between labels and a title, as the default axes keep. */
const GAP = 6;
/** Pixels kept between labels that must not touch. */
const PAD = 4;
/** Pixels from a y axis' line to its labels, as the default axes draw them. */
const Y_GAP = 8;
/** Pixels from labels inside the plot to the ends of the ticks on their side, by default. */
const INSIDE_GAP = 4;

/** A layer of an axis' ticks, resolved. */
export interface Layer {
  id: string;
  /** Where it is set, for messages. */
  path: string;
  ticks: Ticks | undefined;
  format: Format | undefined;
  /**
   * Whether its ticks are the model's plan of the scale: the major layer of
   * the axis on its default side, or with none there, of the first listed.
   */
  planned: boolean;
  tick: Required<TickMarkSpec> | false;
  labels: (TickLabelsSpec & { row: number }) | false;
  style: { tick?: StrokeStyle; tickLabel?: TextStyle } | undefined;
}

/** An axis the guides list, resolved against the short form. */
export interface ListedAxis {
  key: string;
  /** Where it is listed, for messages. */
  path: string;
  /** x, y, yRight, or a position scale of the chart's own. */
  scale: string;
  side: Side;
  /** On its scale's default side, where the model's plan gives its major ticks. */
  home: boolean;
  /** Whether it runs across the chart (an x axis), its labels in rows, or along y; and above the plots. */
  across: boolean;
  above: boolean;
  /** Whether it is drawn: axes on the default side are shown as the short form's `show` says. */
  show: boolean;
  /** Titles of axes elsewhere; the model writes those on the default side. */
  title: string | undefined;
  /** For an axis moved off the default side: each subplot's own title of the scale, over `title`. */
  titles?: readonly (string | undefined)[];
  /** Subplots whose own settings hide the scale's axis, which axes elsewhere leave out too. */
  off?: readonly boolean[];
  line: boolean;
  layers: Layer[];
  style: AxisStyles | undefined;
  /** Whether it draws as the automatic axis does, so the model's stands as it is. */
  plain: boolean;
  /** For a y axis on the right: whether the panels of each row share y, so the last one's axis is theirs. */
  rows: boolean;
  /** For an x axis above the plots: whether the panels of each column share x, so the first one's axis is theirs. */
  columns: boolean;
  /** Where panels sharing its scale draw it: on their outer edge, or "all" of them. */
  repeat: "outer" | "all" | undefined;
}

/**
 * The axes `config.guides` lists, and the short forms as the model reads
 * them: each scale's settings with those of its listed axis on its default
 * side, or with the automatic axis hidden when the scale's axes are all
 * elsewhere. With tick labels `aligned` at their ticks, which listed axes
 * draw, a scale the guides list no axis of has one on its default side.
 * Undefined when there are no axes to list.
 */
export function listedAxes(
  config: ChartConfig,
  aligned = false,
): { read: Partial<Record<ScaleName, ChartAxisOptions>>; axes: ListedAxis[] } | undefined {
  const right = config.marks.some((mark) => mark.spec.axis === "right");
  const given = config.guides ?? [];
  const guides = aligned
    ? [
        ...given,
        ...(["x", "y", ...(right ? ["yRight" as const] : [])] as const).flatMap((scale) =>
          given.some((guide) => guide.type === "axis" && guide.scale === scale)
            ? []
            : [{ type: "axis", scale } as AxisGuideOptions],
        ),
      ]
    : given;
  if (!guides.some((guide) => guide.type === "axis")) return undefined;
  const read: Partial<Record<ScaleName, ChartAxisOptions>> = {};
  const axes: ListedAxis[] = [];
  const yScope = config.y?.scope ?? (config.panels ? "panel" : "chart");
  const rows = yScope === "chart" || yScope === "row";
  const xScope = config.x?.scope ?? (config.panels ? "panel" : "chart");
  const columns = xScope === "chart" || xScope === "column";
  for (const scale of ["x", "y", "yRight"] as const) {
    const short = config[scale];
    const sides = new Set<Side>();
    let home: AxisGuideOptions | undefined;
    let first: AxisGuideOptions | undefined;
    guides.forEach((guide, i) => {
      if (guide.type !== "axis" || guide.scale !== scale) return;
      const side = guide.place?.side ?? HOME[scale];
      const path = `chart guides[${i}].place.side`;
      const along =
        scale === "x"
          ? side === "top" || side === "bottom"
          : side === "right" || (scale === "y" && side === "left");
      if (!along)
        throw new Error(
          `${path}: ${scale} axes go ${scale === "x" ? 'on the "top" or the "bottom"' : scale === "y" ? 'on the "left" or the "right"' : 'on the "right"'}; received "${side}"`,
        );
      if (sides.has(side))
        throw new Error(
          `${path}: scale ${scale} has an axis on the ${side} already; give this one ${scale === "x" ? (side === "top" ? '"bottom"' : '"top"') : side === "left" ? '"right"' : '"left"'}`,
        );
      if (scale === "y" && side === "right" && right)
        throw new Error(
          `${path}: marks with axis: "right" put yRight's axis on the right; keep y's on the left`,
        );
      sides.add(side);
      first ??= guide;
      if (side === HOME[scale]) home = guide;
      const axis = resolve(guide, scale, side, short, `chart guides[${i}]`);
      axes.push({
        ...axis,
        // Aligned labels are the guides' to draw: the model's automatic axes do not align them.
        plain: axis.plain && !aligned,
        rows,
        columns,
        repeat: guide.repeat ?? short?.repeat,
      });
    });
    if (sides.size === 0) continue;
    // Grid lines follow the axis on the default side, or without one, the
    // first listed: the hidden automatic axis plans its ticks as that one's,
    // and that one draws the ticks it planned.
    const owner = home ?? first!;
    if (!home) {
      // A subplot showing the automatic axis would bring it back beside the moved one.
      const shown = config.panels?.list.findIndex((panel) => panel[scale]?.show === true) ?? -1;
      if (shown >= 0)
        throw new Error(
          `chart panels[${shown}].${scale}.show: the guides list ${scale}'s axes elsewhere, which hides its axis on the ${HOME[scale]}; drop show, or list an axis on the ${HOME[scale]}`,
        );
      // The axis moved off the default side takes the scale's titles with it.
      const moved = axes.find((axis) => axis.scale === scale)!;
      moved.layers[0]!.planned = true;
      moved.title ??= short?.title;
      const own = config.panels?.list.map((panel) => panel[scale]?.title);
      if (own?.some((title) => title !== undefined)) moved.titles = own;
    }
    // Axes elsewhere leave out the subplots that hide the scale's axis.
    const off = config.panels?.list.map((panel) => panel[scale]?.show === false);
    if (off?.includes(true))
      for (const axis of axes) if (axis.scale === scale && !axis.home) axis.off = off;
    const style = home?.style
      ? mergeStyles(short?.style, home.style)
      : owner.style?.grid
        ? { ...short?.style, grid: { ...short?.style?.grid, ...owner.style.grid } }
        : short?.style;
    read[scale] = {
      ...short,
      show: home ? (home.show ?? short?.show ?? true) : false,
      ...(home?.title !== undefined && { title: home.title }),
      ...(owner.ticks !== undefined && { ticks: owner.ticks }),
      ...(owner.format !== undefined && { format: owner.format }),
      ...(owner.grid !== undefined && { grid: owner.grid }),
      ...(home?.repeat !== undefined && { repeat: home.repeat }),
      ...(style && { style }),
    };
  }
  // Axes of the chart's own position scales go where they are placed: along
  // y on the right, or along x above the plots, where no other axis is.
  guides.forEach((guide, i) => {
    if (guide.type !== "axis" || builtIn(guide.scale)) return;
    const path = `chart guides[${i}]`;
    const side = guide.place?.side;
    if (side !== "right" && side !== "top")
      throw new Error(
        `${path}.place.side: an axis of a scale of the chart's own goes on the "right" (along y) or the "top" (along x); ${side ? `received "${side}"` : "give place: { side }"}`,
      );
    if (axes.some((axis) => axis.side === side) || (side === "right" && right))
      throw new Error(`${path}.place.side: the ${side} has an axis already; give its other side`);
    // The panels of a row (or a column) share the scale's instance where
    // the chart or each row (column) has one.
    const scope = (config.scales?.[guide.scale] as { scope?: unknown } | undefined)?.scope;
    const shared = scope === undefined || scope === "chart";
    axes.push({
      ...resolve(guide, guide.scale, side, undefined, path),
      rows: shared || scope === "row",
      columns: shared || scope === "column",
      repeat: guide.repeat,
    });
  });
  return { read, axes };
}

function resolve(
  guide: AxisGuideOptions,
  scale: string,
  side: Side,
  short: ChartAxisOptions | undefined,
  path: string,
): Omit<ListedAxis, "rows" | "columns" | "repeat"> {
  const home = builtIn(scale) && side === HOME[scale];
  const across = side === "top" || side === "bottom";
  const layers = resolveLayers(
    { ...guide, ticks: guide.ticks ?? short?.ticks, format: guide.format ?? short?.format },
    { across, home, path, name: `${scale} axis`, tick: across ? TICK : 3 },
  );
  return {
    // Ids and generated keys apart: a guide's id cannot take another's key.
    key: guide.id !== undefined ? `id|${guide.id}` : `${scale}|${side}`,
    path,
    scale,
    side,
    home,
    across,
    above: side === "top",
    show: guide.show ?? short?.show ?? true,
    title: home ? undefined : guide.title,
    line: guide.line ?? across,
    layers,
    // Over the paints the model resolved for the scale's axis in each panel,
    // which take the chart's and subplots' styles already.
    style: home ? undefined : guide.style,
    plain:
      home &&
      guide.tick === undefined &&
      guide.labels === undefined &&
      guide.line === undefined &&
      layers.length === 1,
  };
}

/**
 * The layers of an axis (or a colorbar) with `settings`: its own ticks,
 * "major" (planned by the model on an axis' default side, `home`), then
 * those it lists. Axes along x draw tick marks by default, as long as the
 * default axes'; others as `tick` says for their layers only.
 */
export function resolveLayers(
  settings: {
    ticks?: Ticks | undefined;
    format?: Format | undefined;
    tick?: TickMarkSpec | false | undefined;
    labels?: TickLabelsSpec | false | undefined;
    layers?: AxisGuideOptions["layers"] | undefined;
  },
  {
    across,
    home,
    path,
    name,
    tick: minor,
    major = across && { direction: "out", length: TICK },
    beside = true,
  }: {
    across: boolean;
    home: boolean;
    path: string;
    name: string;
    tick: number;
    major?: TickMarkSpec | false;
    /** Whether labels may go inside the plot and apart from their ticks, as axes' may, not colorbars'. */
    beside?: boolean;
  },
): Layer[] {
  const tick = (spec: TickMarkSpec | false | undefined, fallback: TickMarkSpec | false) => {
    const given = spec ?? fallback;
    return given && { direction: given.direction ?? "out", length: given.length ?? TICK };
  };
  const labels = (spec: TickLabelsSpec | false | undefined, where: string) => {
    if (spec === false) return false;
    const row = spec?.row ?? 0;
    if (
      !across &&
      (row > 0 ||
        spec?.rotation !== undefined ||
        spec?.collision === "stagger" ||
        spec?.collision === "wrap")
    )
      throw new Error(
        `${where}: rows, turned labels, staggering, and wrapping are for labels side by side; drop them from this ${name}`,
      );
    const rotation = spec?.rotation;
    for (const turn of typeof rotation === "object" ? rotation.candidates : [rotation ?? 0])
      if (!(turn >= -90 && turn <= 90))
        throw new Error(
          `${where}.rotation: ${turn} degrees is beyond a quarter turn; give degrees from -90 (reading up) to 90 (reading down)`,
        );
    if (spec?.collision === "wrap" && spec.rotation !== undefined)
      throw new Error(
        `${where}.collision: "wrap" breaks labels that lie flat; drop rotation, or keep turned labels apart with "hide" or "stagger"`,
      );
    const placing = spec?.inside ? "inside" : spec?.gap !== undefined ? "gap" : undefined;
    if (!beside && placing)
      throw new Error(
        `${where}.${placing}: a colorbar's labels stand beside its ramp; drop ${placing}`,
      );
    return { ...spec, row };
  };
  return [
    {
      id: "major",
      path,
      ticks: settings.ticks,
      format: settings.format,
      planned: home,
      tick: tick(settings.tick, major),
      labels: labels(settings.labels, `${path}.labels`),
      style: undefined,
    },
    ...(settings.layers ?? []).map(
      (layer, k): Layer => ({
        id: layer.id,
        path: `${path}.layers[${k}]`,
        ticks: layer.ticks,
        format: layer.format,
        planned: false,
        tick: tick(layer.tick, { direction: "out", length: minor }),
        labels: labels(layer.labels, `${path}.layers[${k}].labels`),
        style: layer.style,
      }),
    ),
  ];
}

/** Styles by role, `own`'s properties over `base`'s. */
function mergeStyles(
  base: AxisStyles | undefined,
  own: AxisStyles | undefined,
): AxisStyles | undefined {
  if (!base || !own) return own ?? base;
  const out: Record<string, object> = { ...base };
  for (const [role, style] of Object.entries(own))
    out[role] = { ...(base as Record<string, object>)[role], ...style };
  return out as AxisStyles;
}

/** A layer planned for one panel: where its ticks are and what they say, and how its labels are drawn. */
export interface Placed {
  layer: Layer;
  ticks: AxisTick[];
  angle: number;
  /** Lanes its labels take in turn: two when staggered; and each tick's lane. */
  lanes: number;
  lane: readonly number[];
  /** Along y, where each tick's label is drawn, inside the chart. */
  at: readonly number[] | undefined;
  /**
   * For flat labels inside the plot, or aligned by their style: which of
   * their blocks' ends, or middle, is at their tick, in screen order along
   * the axis (left to right, top to bottom), as their style's align (x) or
   * verticalAlign (y) says.
   */
  align: Align | undefined;
  label: TextPaint;
  tick: StrokePaint;
}

/** A block's end at a point along an axis, in screen order: it reaches on from there ("start"), back ("end"), or both ways. */
type Align = "start" | "center" | "end";

/** The compiled axes of `listed`, planned and drawn with the chart's code `kit`. */
export function compiledAxes(kit: GuideKit, listed: readonly ListedAxis[]): CompiledAxes {
  const elsewhere = listed.filter((axis) => !axis.home && axis.show);
  const changed = (scale: string) =>
    listed.find((axis) => axis.scale === scale && axis.home && !axis.plain);
  // Room above and below the plots is kept before x is planned, from a plan
  // over a column's share of the width. Where the panels' own plans need
  // more (turned labels choosing a steeper angle in narrower plots), the
  // room grows for scenes of this width, as margins do, and the model lays
  // the scene out again.
  // Room below may be less than none: an axis on the default side with no
  // labels outside the plot gives back what the model keeps for them.
  let kept = { width: Number.NaN, top: 0, bottom: Number.NEGATIVE_INFINITY };
  let reserved = { top: 0, bottom: 0 };
  return {
    across(state) {
      if (kept.width !== state.width)
        kept = { width: state.width, top: 0, bottom: Number.NEGATIVE_INFINITY };
      let top = 0;
      let bottom = Number.NEGATIVE_INFINITY;
      const home = changed("x");
      state.labeled.x.forEach((shows, i) => {
        if (shows && home)
          bottom = Math.max(
            bottom,
            extraDepth(
              kit,
              home,
              state,
              placedLayers(kit, home, state, i, provisional(state, home, i)),
            ),
          );
      });
      const over = state.labeled.x.map(() => false);
      for (const axis of elsewhere) {
        if (axis.side !== "top") continue;
        if (state.headers)
          throw new Error(
            `${axis.path}.place.side: an x axis above the plots needs panels without titles or headers; place it on the "bottom"`,
          );
        const rowCount = Math.ceil(state.labeled.x.length / state.columns);
        if (!state.cells && rowCount > 1 && !axis.columns && axis.repeat !== "all")
          throw new Error(
            `${axis.path}.place.side: an x axis above the plots stands over each column's first panel, so the panels of a column must share ${axis.scale}; give ${axis.scale} scope "column" or "chart", ${builtIn(axis.scale) ? 'repeat "all" for one above every panel, or keep the axis at the bottom' : 'or repeat "all" for one above every panel'}`,
          );
        for (let i = 0; i < over.length; i++)
          if (drawsIn(axis, state, i)) {
            over[i] = true;
            top = Math.max(
              top,
              depthOf(
                kit,
                axis,
                state,
                i,
                placedLayers(kit, axis, state, i, provisional(state, axis, i)),
              ),
            );
          }
      }
      bottom = Math.max(bottom, kept.bottom);
      reserved = { top: Math.max(top, kept.top), bottom: Number.isFinite(bottom) ? bottom : 0 };
      return { ...reserved, over };
    },
    beside(state) {
      let left = 0;
      let right = 0;
      for (const scale of ["y", "yRight"] as const) {
        const home = changed(scale);
        if (!home) continue;
        // What its ticks and labels outside the plot take, over the room
        // the model keeps for its labels (as wide as the major layer's).
        let needs = Number.NEGATIVE_INFINITY;
        let keeps = Number.NEGATIVE_INFINITY;
        state.labeled[scale].forEach((shows, i) => {
          if (!shows) return;
          const placed = placedLayers(kit, home, state, i, state.plan(scale, i, 0));
          needs = Math.max(needs, outsideBreadth(kit, placed, state.measure));
          keeps = Math.max(keeps, Math.ceil(widest(kit, [placed[0]!], state.measure)) + Y_GAP);
        });
        const extra = Number.isFinite(needs) ? needs - keeps : outward(home.layers);
        if (scale === "y") left = extra;
        else right = extra;
      }
      const after = state.drawsY.map(() => false);
      for (const axis of elsewhere) {
        if (axis.side !== "right") continue;
        if (!state.cells && state.columns > 1 && !axis.rows && axis.repeat !== "all")
          throw new Error(
            `${axis.path}.place.side: a y axis on the right stands beside each row's last panel, so the panels of a row must share ${axis.scale}; give ${axis.scale} scope "row" or "chart", ${builtIn(axis.scale) ? 'repeat "all" for one beside every panel, or keep the axis on the left' : 'or repeat "all" for one beside every panel'}`,
          );
        state.drawsY.forEach((_, i) => {
          if (!drawsIn(axis, state, i)) return;
          after[i] = true;
          right = Math.max(right, breadth(kit, axis, state, i));
        });
      }
      return { left, right, after };
    },
    ends(plan, state, i) {
      const { measure } = state;
      let lo = Infinity;
      let hi = -Infinity;
      const add = (tick: AxisTick, paint: TextPaint, angle: number, run: Run, align?: Align) => {
        if (!tick.label) return;
        const [from, to] = extent(tick, paint, angle, run, measure, align);
        lo = Math.min(lo, from);
        hi = Math.max(hi, to);
      };
      const home = changed("x");
      if (state.labeled.x[i]) {
        if (home)
          for (const placed of placedLayers(kit, home, state, i, plan))
            for (const tick of placed.ticks)
              add(tick, placed.label, placed.angle, runOf(home, placed.layer), placed.align);
        else {
          // The default axis' labels, centered on their ticks.
          const paint = state.styles.axisText("tickLabel", "x", i);
          plan.ticks.forEach((t, k) => {
            add(
              { position: plan.scale.map(t), value: t, label: plan.labels[k] ?? "" },
              paint,
              0,
              "below",
            );
          });
        }
      }
      for (const axis of elsewhere)
        if (axis.side === "top" && drawsIn(axis, state, i))
          for (const placed of placedLayers(kit, axis, state, i, over(state, axis, i, plan)))
            for (const tick of placed.ticks)
              add(tick, placed.label, placed.angle, runOf(axis, placed.layer), placed.align);
      return lo > hi ? undefined : [lo, hi];
    },
    fits(state, planOf) {
      let top = 0;
      let bottom = Number.NEGATIVE_INFINITY;
      const home = changed("x");
      state.labeled.x.forEach((shows, i) => {
        if (shows && home)
          bottom = Math.max(
            bottom,
            extraDepth(kit, home, state, placedLayers(kit, home, state, i, planOf(i))),
          );
      });
      for (const axis of elsewhere)
        if (axis.side === "top")
          for (let i = 0; i < state.labeled.x.length; i++)
            if (drawsIn(axis, state, i))
              top = Math.max(
                top,
                depthOf(
                  kit,
                  axis,
                  state,
                  i,
                  placedLayers(kit, axis, state, i, over(state, axis, i, planOf(i))),
                ),
              );
      if (top <= reserved.top + 0.5 && bottom <= reserved.bottom + 0.5) return true;
      kept = {
        width: kept.width,
        top: Math.max(kept.top, Math.ceil(top)),
        bottom: Math.max(kept.bottom, Math.ceil(bottom)),
      };
      return false;
    },
    panel(axes, state, index, plot, plans) {
      const out = axes.map((guide) => {
        const axis = changed(guide.scale);
        return axis
          ? rebuild(
              kit,
              guide,
              axis,
              // Axes on their scale's default side are of x, y, and yRight.
              placedLayers(kit, axis, state, index, plans[axis.scale as ScaleName]),
              state,
              index,
            )
          : guide;
      });
      for (const axis of elsewhere) {
        const plan = builtIn(axis.scale)
          ? plans[axis.scale]
          : plans.own?.plan(
              axis.scale,
              index,
              axis.across ? plot.width : plot.height,
              axis.across,
              axis.across ? plot.x : plot.y,
            );
        if (!plan) continue;
        if (drawsIn(axis, state, index))
          out.push(
            beyond(kit, axis, placedLayers(kit, axis, state, index, plan), state, index, plot),
          );
      }
      return out;
    },
  };
}

/**
 * Whether panel `i` draws `axis`, an axis elsewhere: an x axis above each
 * panel of the first row, a y axis beside the last panel of each row that
 * draws along y (in a layout of cells, the outer panels of those sharing
 * the instance of the axis' scale), or with `repeat` "all" every panel;
 * unless the panel's own settings hide the scale's axis.
 */
function drawsIn(axis: ListedAxis, state: AxesState, i: number): boolean {
  if (axis.off?.[i]) return false;
  const { cells } = state;
  const all = axis.repeat === "all";
  return axis.side === "top"
    ? cells
      ? cells.top(i, axis)
      : i < state.labeled.x.length && (all || i < state.columns)
    : !!state.drawsY[i] && (cells ? cells.last(i, axis) : all || lastInRow(state, i));
}

/** Whether panel `i` is the last of its row, where y axes on the right go. */
function lastInRow(state: AxesState, i: number): boolean {
  return i % state.columns === state.columns - 1 || i === state.drawsY.length - 1;
}

/** How far tick marks reach into the plot from the axis line. */
function inward(layers: readonly Layer[]): number {
  let reach = 0;
  for (const { tick } of layers)
    if (tick)
      reach = Math.max(
        reach,
        tick.direction === "in" ? tick.length : tick.direction === "cross" ? tick.length / 2 : 0,
      );
  return reach;
}

/**
 * Pixels from the axis line to a layer's first row of labels: past the
 * ticks on their side by their `gap`; without one, as default axes place
 * labels outside (`gap` from the line, and past ticks longer than theirs
 * along x), or inside, a few pixels past the ticks.
 */
function firstRow(
  labels: TickLabelsSpec,
  gap: number,
  across: boolean,
  layers: readonly Layer[],
): number {
  if (labels.inside) return inward(layers) + (labels.gap ?? INSIDE_GAP);
  const reach = outward(layers);
  if (labels.gap !== undefined) return reach + labels.gap;
  return gap + (across ? Math.max(0, reach - TICK) : reach);
}

/** How far tick marks reach out from the axis line. */
export function outward(layers: readonly Layer[]): number {
  let reach = 0;
  for (const { tick } of layers)
    if (tick)
      reach = Math.max(
        reach,
        tick.direction === "out" ? tick.length : tick.direction === "cross" ? tick.length / 2 : 0,
      );
  return reach;
}

/**
 * The plan of `axis`, above or below panel `i`, over the pixels x's `plan`
 * spans there: x's own, or its scale's (a scale of the chart's own).
 */
function over(state: AxesState, axis: ListedAxis, i: number, plan: AxisPlan): AxisPlan | undefined {
  if (axis.scale === "x") return plan;
  const [a, b] = plan.scale.range;
  return state.plan(axis.scale, i, Math.abs(b - a), Math.min(a, b));
}

/** The x plan an axis' room is measured with before x is planned: over a column's share of the width. */
function provisional(state: AxesState, axis: ListedAxis, i: number): AxisPlan | undefined {
  return state.plan(axis.scale, i, state.cells?.width(i) ?? state.width / state.columns);
}

/** Panel `i`'s layers of `axis` over `plan`: each one's ticks and labels, as its collision policy keeps them. */
function placedLayers(
  kit: GuideKit,
  axis: ListedAxis,
  state: AxesState,
  i: number,
  plan: AxisPlan | undefined,
): Placed[] {
  const { styles } = state;
  const at = `${axis.path}.style`;
  const base = {
    label: restyle(
      kit,
      styles.read,
      styles.axisText("tickLabel", axis.scale, i),
      axis.style?.tickLabel,
      `${at}.tickLabel`,
    ),
    tick: restroke(
      kit,
      styles.read,
      styles.axisStroke("tick", axis.scale, i),
      axis.style?.tick,
      `${at}.tick`,
    ),
  };
  const within = state.cells?.within(i) ?? [0, state.height];
  return layered(kit, axis, base, styles.read, state.measure, plan, within);
}

/**
 * The layers of an axis (or a colorbar's) over `plan`, their labels and
 * tick marks drawn with `base`'s paints under their own styles.
 */
export function layered(
  kit: GuideKit,
  axis: { layers: readonly Layer[]; scale: string; across: boolean; above: boolean },
  base: { label: TextPaint; tick: StrokePaint },
  read: Read,
  measure: MeasureText,
  plan: AxisPlan | undefined,
  /**
   * The span down labels along y stay inside (the chart, or an inset's
   * box); undefined to leave them at their ticks.
   */
  within: readonly [number, number] | undefined,
): Placed[] {
  const placed = axis.layers.map((layer): Placed => {
    const run = runOf(axis, layer);
    const at = `${layer.path}.style`;
    const label = restyle(kit, read, base.label, layer.style?.tickLabel, `${at}.tickLabel`);
    const tick = restroke(kit, read, base.tick, layer.style?.tick, `${at}.tick`);
    let ticks: AxisTick[] = [];
    if (plan) {
      // A category axis' own layer labels its categories, on any side.
      const categories = !plan.context && layer.id === "major";
      const own = layer.planned || categories ? plan : planLayer(kit, layer, axis, plan);
      const labels = layer.labels;
      // Turned or kept-apart labels of a category axis choose among all its categories.
      const all =
        categories && labels && (labels.rotation !== undefined || labels.collision !== undefined);
      ticks = all
        ? (plan.scale.categories ?? []).map((name, k) => ({
            position: plan.scale.map(k),
            value: k,
            label: name,
          }))
        : own.ticks.map((t, k) => ({
            position: own.scale.map(t),
            value: t,
            label: own.labels[k] ?? "",
          }));
    }
    let angle = 0;
    let lanes = 1;
    let lane: number[] = [];
    let labelAt: number[] | undefined;
    let align: Align | undefined;
    const labels = layer.labels;
    if (labels) {
      // Labels that may turn are written on one line.
      if (labels.rotation !== undefined)
        ticks = ticks.map((t) =>
          t.label.includes("\n") ? { ...t, label: t.label.replaceAll("\n", " ") } : t,
        );
      // Flat labels stand at their ticks as their style aligns them: inside
      // the plot centered by default, outside it where the style says.
      const aligned = (axis.across ? label.align : label.verticalAlign) !== undefined;
      const flat = labels.inside || aligned ? alignAt(axis.across, label) : undefined;
      angle = angleOf(labels, ticks, label, measure, run, flat);
      if (!angle) align = flat;
      const collision = labels.collision ?? "show";
      if (collision === "wrap") ticks = wrapped(ticks, label, measure);
      if (collision === "stagger") lanes = 2;
      // Labels along y stay inside the chart (an inset's box), where the
      // plot's ends leave no room for a layer's taller ones: they meet
      // where they are drawn.
      if (run === "along" && within !== undefined) {
        const [lo, hi] = within;
        labelAt = ticks.map(({ position, label: text }) => {
          if (!text) return position;
          const { height } = boxOf(text, label, measure);
          // From the tick to its block's middle.
          const middle = align === "start" ? height / 2 : align === "end" ? -height / 2 : 0;
          if (height > hi - lo + 0.5)
            throw new kit.ChartError({
              code: "layout-failed",
              phase: "layout",
              path: layer.path,
              message: `${layer.path}: a label ${Math.ceil(height)} px tall does not fit the ${Math.floor(hi - lo)} px down it stays inside; make the chart or inset taller, or its labels smaller or of fewer lines`,
            });
          return Math.min(Math.max(position + middle, lo + height / 2), hi - height / 2) - middle;
        });
      }
      if (collision === "hide" || collision === "stagger") {
        const drawnAt = labelAt;
        const shown = drawnAt ? ticks.map((t, k) => ({ ...t, position: drawnAt[k]! })) : ticks;
        const result = kept(shown, label, measure, angle, lanes, run, align);
        ticks = ticks.map((t, k) => ({ ...t, label: result.ticks[k]!.label }));
        lane = result.lane;
      }
    }
    return { layer, ticks, angle, lanes, lane, at: labelAt, align, label, tick };
  });
  // Labels stand off the line as default axes place them, by the gap for their size.
  const gap = axis.across ? kit.tickLabelGap(base.label.size) : Y_GAP;
  return prioritized(kit, placed, measure, axis, gap);
}

/** How an axis' labels lie: side by side below or above the plots, or one above another along y. */
type Run = "below" | "above" | "along";

/** How `layer`'s labels lie on `axis`: those inside the plot on the line's other side. */
function runOf(axis: { across: boolean; above: boolean }, layer: Layer): Run {
  if (!axis.across) return "along";
  return axis.above !== (layer.labels ? !!layer.labels.inside : false) ? "above" : "below";
}

/**
 * Where flat labels stand at their ticks along the axis, in screen order:
 * as their style's `align` says along x, `verticalAlign` along y.
 */
function alignAt(across: boolean, paint: TextPaint): Align {
  if (across) return paint.align ?? "center";
  return paint.verticalAlign === "top"
    ? "start"
    : paint.verticalAlign === "bottom"
      ? "end"
      : "center";
}

/**
 * The layers with labels that overlap a label of a layer of higher
 * priority in their row left out, as a day's date at midnight in place of
 * the hour there: where they meet along the axis and off it (their gaps
 * past the ticks, `gap` by default, and their lanes).
 */
function prioritized(
  kit: GuideKit,
  layers: Placed[],
  measure: MeasureText,
  axis: { across: boolean; above: boolean },
  gap: number,
): Placed[] {
  const rank = (placed: Placed) => (placed.layer.labels ? (placed.layer.labels.priority ?? 0) : 0);
  const inside = ({ layer }: Placed) => (layer.labels ? !!layer.labels.inside : false);
  const all = layers.map(({ layer }) => layer);
  // Each label's box, as drawn: its extent along the axis, in its layer's
  // paint, turn, and alignment, and how far it stands off the line to how
  // far it reaches. Measured once a layer is compared.
  const boxes = new Map<Placed, ([number, number, number, number] | undefined)[]>();
  const boxesOf = (of: Placed) => {
    let found = boxes.get(of);
    if (found) return found;
    const run = runOf(axis, of.layer);
    const lane = laneDepth(kit, of, measure);
    const first = firstRow(of.layer.labels || {}, gap, axis.across, all);
    found = of.ticks.map((tick, k) => {
      if (!tick.label) return undefined;
      const at = of.at ? { ...tick, position: of.at[k]! } : tick;
      const [lo, hi] = extent(at, of.label, of.angle, run, measure, of.align);
      const near = first + (of.lane[k] ?? 0) * (lane + ROW_GAP);
      const depth = axis.across
        ? labelDepth(kit, of, tick.label, measure)
        : kit.textWidth(tick.label, of.label, measure);
      return [lo, hi, near, near + depth];
    });
    boxes.set(of, found);
    return found;
  };
  return layers.map((placed) => {
    const { labels } = placed.layer;
    if (!labels) return placed;
    // Rows inside the plot and outside it are apart.
    const above = layers.filter(
      (other) =>
        other.layer.labels &&
        other.layer.labels.row === labels.row &&
        inside(other) === inside(placed) &&
        rank(other) > rank(placed),
    );
    if (above.length === 0) return placed;
    const own = boxesOf(placed);
    const ticks = placed.ticks.map((tick, k) => {
      const box = own[k];
      if (!box) return tick;
      const [lo, hi, near, far] = box;
      const meets = above.some((other) =>
        boxesOf(other).some(
          (kept) =>
            !!kept && lo < kept[1] + PAD && kept[0] < hi + PAD && near < kept[3] && kept[2] < far,
        ),
      );
      return meets ? { ...tick, label: "" } : tick;
    });
    return { ...placed, ticks };
  });
}

/**
 * Where a label reaches along its axis: its box's extent, as it turns from
 * its tick, or for flat labels inside the plot, as `align` puts it there.
 */
export function extent(
  tick: AxisTick,
  paint: TextPaint,
  angle: number,
  run: Run,
  measure: MeasureText,
  align?: Align,
): [number, number] {
  const { width, height } = boxOf(tick.label, paint, measure);
  const at = tick.position;
  if (align) {
    const size = run === "along" ? height : width;
    return align === "start"
      ? [at, at + size]
      : align === "end"
        ? [at - size, at]
        : [at - size / 2, at + size / 2];
  }
  if (run === "along") return [at - height / 2, at + height / 2];
  const { anchor, cos, sin } = turned(angle, run === "above");
  const along = width * cos;
  const across = (height / 2) * sin;
  const from = anchor === "middle" ? along / 2 : anchor === "end" ? along : 0;
  const to = anchor === "middle" ? along / 2 : anchor === "start" ? along : 0;
  return [at - from - across, at + to + across];
}

/** A label's box: its lines of text and, with a background, the box's padding. */
function boxOf(
  label: string,
  paint: TextPaint,
  measure: MeasureText,
): { width: number; height: number } {
  const [top, right, bottom, left] = paint.background ? paint.padding : [0, 0, 0, 0];
  const lines = label.split("\n");
  return {
    width: Math.max(...lines.map((line) => measure(line, paint.css))) + left + right,
    height: lines.length * paint.lineHeight + top + bottom,
  };
}

/** A layer's own plan over the scale of the axis' plan `plan`: about its own count of ticks, or the axis'. */
function planLayer(kit: GuideKit, layer: Layer, axis: { scale: string }, plan: AxisPlan): AxisPlan {
  const context = plan.context;
  if (!context || plan.within === undefined || plan.count === undefined)
    throw new Error(
      `${layer.path}: a category axis labels its categories in one layer; drop the ${axis.scale} axis' layers`,
    );
  const planner = tickPlanner(
    kit,
    layer.ticks,
    layer.format,
    context,
    axis.scale,
    { ticks: `${layer.path}.ticks`, format: `${layer.path}.format` },
    layer.labels ? layer.labels.duplicates : "hide",
  );
  return kit.planAxis(
    { ...context, plan: planner },
    plan.scale.domain as [number, number],
    plan.scale.range as [number, number],
    countOf(layer.ticks) ?? plan.count,
    plan.within,
  );
}

/**
 * How a label turned `angle` degrees clockwise is anchored at its tick on
 * an axis along x: running away from the plot, below it or (`above`) above.
 */
export function turned(
  angle: number,
  above = false,
): { anchor: TextItem["anchor"]; cos: number; sin: number } {
  const turn = (angle * Math.PI) / 180;
  const away = above ? -angle : angle;
  return {
    anchor: away > 0 ? "start" : away < 0 ? "end" : "middle",
    cos: Math.abs(Math.cos(turn)),
    sin: Math.abs(Math.sin(turn)),
  };
}

/** The angle labels are drawn at: their rotation, or the first candidate at which neighbors do not overlap. */
function angleOf(
  labels: TickLabelsSpec,
  ticks: readonly AxisTick[],
  paint: TextPaint,
  measure: MeasureText,
  run: Run,
  flat?: Align,
): number {
  const rotation = labels.rotation;
  if (typeof rotation !== "object") return rotation ?? 0;
  // Neighbors are the labels drawn: blank ticks between them keep no room.
  const shown = ticks.filter((tick) => tick.label);
  for (const angle of rotation.candidates) {
    let fits = true;
    for (let k = 1; k < shown.length && fits; k++)
      fits = !overlaps(
        shown[k - 1]!,
        shown[k]!,
        paint,
        measure,
        angle,
        run,
        angle ? undefined : flat,
      );
    if (fits) return angle;
  }
  return rotation.candidates.at(-1)!;
}

/**
 * Whether two labels at the same angle overlap: on an axis along x, their
 * boxes compared along the labels' direction and across it; along y, their
 * lines one above the other.
 */
function overlaps(
  first: AxisTick,
  second: AxisTick,
  paint: TextPaint,
  measure: MeasureText,
  angle: number,
  run: Run,
  align?: Align,
): boolean {
  if (!first.label || !second.label) return false;
  // In pixel order, `a` before `b`, as reversed axes have them otherwise.
  const [a, b] = first.position <= second.position ? [first, second] : [second, first];
  // Blocks aligned at their ticks meet where their extents do.
  if (align) {
    const [, end] = extent(a, paint, angle, run, measure, align);
    const [start] = extent(b, paint, angle, run, measure, align);
    return start < end + (run === "along" ? 0 : PAD);
  }
  const d = b.position - a.position;
  // Labels in boxes take their padding too.
  const { width: wa, height: tall } = boxOf(a.label, paint, measure);
  const wb = boxOf(b.label, paint, measure);
  // One above the other, blocks meet within half of each one's height.
  if (run === "along") return d < (tall + wb.height) / 2;
  const { anchor, cos, sin } = turned(angle, run === "above");
  if (d * sin >= Math.max(tall, wb.height)) return false;
  const reach = anchor === "middle" ? (wa + wb.width) / 2 : anchor === "start" ? wa : wb.width;
  return d * cos < reach + PAD;
}

/**
 * Labels as "hide" and "stagger" keep them: every n-th, for the least n at
 * which those kept, on `lanes` lanes taken in turn, no longer overlap; and
 * the lane of each tick's label.
 */
function kept(
  ticks: AxisTick[],
  paint: TextPaint,
  measure: MeasureText,
  angle: number,
  lanes: number,
  run: Run,
  align?: Align,
): { ticks: AxisTick[]; lane: number[] } {
  for (let every = 1; every <= ticks.length; every++) {
    const shown = ticks.filter((tick, k) => tick.label && k % every === 0);
    let fits = true;
    for (let k = lanes; k < shown.length && fits; k++)
      fits = !overlaps(shown[k - lanes]!, shown[k]!, paint, measure, angle, run, align);
    if (fits) {
      let n = 0;
      const lane = ticks.map((tick, k) => (tick.label && k % every === 0 ? n++ % lanes : 0));
      return {
        ticks: ticks.map((tick, k) => (k % every === 0 ? tick : { ...tick, label: "" })),
        lane,
      };
    }
  }
  return { ticks, lane: [] };
}

/** Labels broken at spaces into lines that fit between their neighbors, three lines at most. */
function wrapped(ticks: AxisTick[], paint: TextPaint, measure: MeasureText): AxisTick[] {
  return ticks.map((tick, k) => {
    const near = [ticks[k - 1], ticks[k + 1]].filter((other) => other !== undefined);
    const room = Math.min(...near.map((other) => Math.abs(other.position - tick.position))) - PAD;
    if (!(room > 0) || measure(tick.label, paint.css) <= room) return tick;
    const lines: string[] = [];
    for (const word of tick.label.split(" ")) {
      const last = lines.at(-1);
      if (
        last !== undefined &&
        (lines.length >= 3 || measure(`${last} ${word}`, paint.css) <= room)
      )
        lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    return { ...tick, label: lines.join("\n") };
  });
}

/** How tall a layer's row of labels is: a line (or a wrapped label's lines), or turned labels' extent. */
function laneDepth(kit: GuideKit, placed: Placed, measure: MeasureText): number {
  let deepest = labelDepth(kit, placed, "", measure);
  for (const { label } of placed.ticks)
    deepest = Math.max(deepest, labelDepth(kit, placed, label, measure));
  return deepest;
}

/** How far `text`, a label of `placed` on an x axis, reaches from its row's start, as turned. */
function labelDepth(
  kit: GuideKit,
  { angle, label }: Placed,
  text: string,
  measure: MeasureText,
): number {
  const height = kit.textHeight(label);
  if (!angle) return height + (text.split("\n").length - 1) * label.lineHeight;
  const { cos, sin } = turned(angle);
  return kit.textWidth(text, label, measure) * sin + height * cos;
}

/** Each row's depth: the deepest of the layers labeled in it, their lanes included. */
export function rowDepths(
  kit: GuideKit,
  layers: readonly Placed[],
  measure: MeasureText,
  inside = false,
): number[] {
  const rows: number[] = [];
  for (const placed of layers) {
    const { labels } = placed.layer;
    if (!labels || !!labels.inside !== inside) continue;
    const lane = laneDepth(kit, placed, measure);
    const depth = lane * placed.lanes + (placed.lanes - 1) * ROW_GAP;
    rows[labels.row] = Math.max(rows[labels.row] ?? 0, depth);
  }
  return Array.from(rows, (row) => row ?? 0);
}

/**
 * Pixels `layers`' tick marks and labels outside the plot take out from
 * the line of an x axis: its ticks, and each row of labels past them, the
 * first `gap` from the line unless its layer gives its own. Labels inside
 * the plot take none.
 */
function outsideDepth(
  kit: GuideKit,
  layers: readonly Placed[],
  measure: MeasureText,
  gap: number,
): number {
  const all = layers.map(({ layer }) => layer);
  const rows = rowDepths(kit, layers, measure);
  let depth = outward(all);
  for (const { layer } of layers) {
    const { labels } = layer;
    if (!labels || labels.inside) continue;
    let away = firstRow(labels, gap, true, all);
    for (let row = 0; row < labels.row; row++) away += (rows[row] ?? 0) + ROW_GAP;
    depth = Math.max(depth, away + (rows[labels.row] ?? 0));
  }
  return depth;
}

/**
 * Pixels a y axis' tick marks and labels outside the plot take beside its
 * line: its ticks, and its widest labels past them. Labels inside take none.
 */
function outsideBreadth(kit: GuideKit, layers: readonly Placed[], measure: MeasureText): number {
  const all = layers.map(({ layer }) => layer);
  let breadth = outward(all);
  for (const placed of layers) {
    const { labels } = placed.layer;
    if (!labels || labels.inside) continue;
    const away = firstRow(labels, Y_GAP, false, all);
    breadth = Math.max(breadth, away + Math.ceil(widest(kit, [placed], measure)));
  }
  return breadth;
}

/** Pixels an x axis' ticks, rows of labels outside the plot, and title, `layers` placed in panel `i`, take out from the line. */
function depthOf(
  kit: GuideKit,
  axis: ListedAxis,
  state: AxesState,
  i: number,
  layers: readonly Placed[],
): number {
  const text = titleOf(axis, i);
  const title = text ? kit.textHeight(titlePaint(kit, axis, state, i), text) + GAP : 0;
  return outsideDepth(kit, layers, state.measure, kit.tickLabelGap(layers[0]!.label.size)) + title;
}

/**
 * Pixels the x axis on the default side, `layers` placed, takes beyond
 * what the model keeps for its ticks and one line of labels: less than
 * none with no labels outside the plot, whose room it gives back.
 */
function extraDepth(
  kit: GuideKit,
  axis: ListedAxis,
  state: AxesState,
  layers: readonly Placed[],
): number {
  if (!layers.some(({ layer }) => layer.labels && !layer.labels.inside))
    return outward(axis.layers) - state.xRoom;
  const gap = kit.tickLabelGap(layers[0]!.label.size);
  const ticks = Math.max(0, outward(axis.layers) - TICK);
  const labels = outsideDepth(kit, layers, state.measure, gap) - gap - ticks;
  return ticks + Math.max(0, labels - kit.textHeight(layers[0]!.label));
}

/** The widest of `layers`' labels. */
export function widest(kit: GuideKit, layers: readonly Placed[], measure: MeasureText): number {
  let most = 0;
  for (const { ticks, label } of layers)
    for (const tick of ticks) most = Math.max(most, kit.textWidth(tick.label, label, measure));
  return most;
}

/** Pixels a y axis on the right takes beside its plot: ticks, labels outside it, and title. */
function breadth(kit: GuideKit, axis: ListedAxis, state: AxesState, i: number): number {
  const layers = placedLayers(kit, axis, state, i, state.plan(axis.scale, i, 0));
  const text = titleOf(axis, i);
  const title = text ? kit.textHeight(titlePaint(kit, axis, state, i), text) + GAP : 0;
  const reach = outward(axis.layers);
  const beside = outsideBreadth(kit, layers, state.measure);
  // Room past the labels, as the default axes keep.
  return beside + (beside > reach ? GAP + 2 : 0) + title;
}

/** Panel `i`'s default axis `guide` drawn as the listed axis `axis` asks, its layers placed. */
function rebuild(
  kit: GuideKit,
  guide: AxisGuide,
  axis: ListedAxis,
  layers: Placed[],
  state: AxesState,
  i: number,
): AxisGuide {
  // The major layer shows what the default axis shows: none where the panel has nothing to label.
  if (guide.ticks.length === 0) layers[0]!.ticks = [];
  // The model resolves line paints for x axes only, which draw lines by default.
  const line = axis.line && state.styles.axisStroke("axisLine", axis.scale, i);
  const items = drawn(kit, guide, layers, line, state.measure, state);
  if (guide.title)
    items.push(
      titleItem(kit, guide.side, guide.title, guide.paints.title, guide.surface, state.measure),
    );
  return { ...guide, ticks: layers[0]!.ticks, items, layers: axis.layers.map(({ id }) => id) };
}

/** The title of an axis elsewhere in panel `i`: a subplot's own, or the axis'. */
function titleOf(axis: ListedAxis, i: number): string | undefined {
  return axis.titles?.[i] ?? axis.title;
}

/** How an axis elsewhere writes its title in panel `i`: the scale's axis title paint, and its own style. */
function titlePaint(kit: GuideKit, axis: ListedAxis, state: AxesState, i: number): TextPaint {
  return restyle(
    kit,
    state.styles.read,
    state.styles.axisText("axisTitle", axis.scale, i),
    axis.style?.axisTitle,
    `${axis.path}.style.axisTitle`,
  );
}

/** Panel `i`'s listed axis `axis` on a side of `plot` other than its scale's default one, its layers placed. */
function beyond(
  kit: GuideKit,
  axis: ListedAxis,
  layers: Placed[],
  state: AxesState,
  i: number,
  plot: Rect,
): AxisGuide {
  const { styles, surface, measure } = state;
  const above = axis.side === "top";
  const paints = {
    line: restroke(
      kit,
      styles.read,
      styles.axisStroke("axisLine", axis.scale, i),
      axis.style?.axisLine,
      `${axis.path}.style.axisLine`,
    ),
    tick: layers[0]!.tick,
    label: layers[0]!.label,
    title: titlePaint(kit, axis, state, i),
  };
  const placement = {
    side: axis.side,
    edge: above ? plot.y : plot.x + plot.width,
    start: above ? plot.x : plot.y + plot.height,
    end: above ? plot.x + plot.width : plot.y,
    tickLength: outward(axis.layers),
    gap: above ? kit.tickLabelGap(paints.label.size) : Y_GAP,
    surface,
    paints,
  };
  const items = drawn(kit, placement, layers, axis.line && paints.line, measure, state);
  let title: AxisGuide["title"];
  const text = titleOf(axis, i);
  if (text) {
    // Beyond the labels: the axis' room less half the title's lines, at their middle.
    const room = above ? depthOf(kit, axis, state, i, layers) : breadth(kit, axis, state, i);
    const half = kit.textHeight(paints.title, text) / 2;
    // Along the plot as its style aligns it: left to right above, top to bottom on the right.
    const along = kit.aligned(
      paints.title.align ?? "center",
      above ? plot.x : plot.y,
      above ? plot.width : plot.height,
    );
    title = above
      ? { text, x: along.at, y: placement.edge - room + half, anchor: along.anchor }
      : { text, x: placement.edge + room - half, y: along.at, anchor: along.anchor };
    items.push(titleItem(kit, axis.side, title, paints.title, surface, measure));
  }
  return {
    kind: "axis",
    key: `${axis.key}|${i}`,
    scale: axis.scale,
    ...placement,
    ticks: layers[0]!.ticks,
    title,
    items,
    layers: axis.layers.map(({ id }) => id),
  };
}

/**
 * Where a label centered at `x` goes: there, or for rows beyond the first,
 * whose labels' room the margins do not keep, moved inside the chart.
 */
function inside(
  x: number,
  label: string,
  paint: TextPaint,
  measure: MeasureText,
  row: number,
  width: number,
): number {
  if (row === 0) return x;
  const half = Math.max(...label.split("\n").map((line) => measure(line, paint.css))) / 2;
  return Math.min(Math.max(x, half + 2), width - half - 2);
}

/** An axis' title: across an axis along x, turned beside one along y. */
function titleItem(
  kit: GuideKit,
  side: Side,
  title: NonNullable<AxisGuide["title"]>,
  paint: TextPaint,
  surface: string,
  measure: MeasureText,
): TextItem {
  const angle = side === "left" ? -90 : side === "right" ? 90 : 0;
  const at = {
    x: title.x,
    y: title.y,
    anchor: title.anchor ?? "middle",
    baseline: "middle",
    angle,
  } as const;
  // Its point is its lines' middle, in its turn.
  return kit.textItem(
    title.text,
    kit.centeredLines(title.text, at, paint),
    paint,
    surface,
    measure,
  );
}

/**
 * The items of an axis at `placement`: its line, each layer's tick marks
 * (one stroke for those that look alike, each position once, as long as
 * the longest there), and labels in rows outward from the line.
 */
export function drawn(
  kit: GuideKit,
  placement: Pick<AxisGuide, "side" | "edge" | "start" | "end" | "gap" | "surface">,
  layers: readonly Placed[],
  line: StrokePaint | false,
  measure: MeasureText,
  { width }: { readonly width: number },
): GuideItem[] {
  const { side } = placement;
  const across = side === "top" || side === "bottom";
  const out = side === "bottom" || side === "right" ? 1 : -1;
  // Lines fall on pixel centers, so 1-pixel lines are crisp.
  const edge = Math.round(placement.edge) + 0.5;
  const point = (along: number, from: number) => (across ? [along, from] : [from, along]);
  const strokes = new Map<
    string,
    { paint: StrokePaint; coords: number[]; at: Map<number, number[]> }
  >();
  const strokeOf = (paint: StrokePaint) => {
    const key = kit.strokeKey(paint);
    let found = strokes.get(key);
    if (!found) {
      found = { paint, coords: [], at: new Map() };
      strokes.set(key, found);
    }
    return found;
  };
  if (line)
    strokeOf(line).coords.push(...point(placement.start, edge), ...point(placement.end, edge));
  for (const { layer, ticks, tick: paint } of layers) {
    const tick = layer.tick;
    if (!tick) continue;
    const { length, direction } = tick;
    const reach =
      direction === "out"
        ? [0, length]
        : direction === "in"
          ? [-length, 0]
          : [-length / 2, length / 2];
    const { at } = strokeOf(paint);
    for (const { position } of ticks) {
      const where = Math.round(position) + 0.5;
      const before = at.get(where);
      if (before) at.set(where, [Math.min(before[0]!, reach[0]!), Math.max(before[1]!, reach[1]!)]);
      else at.set(where, reach);
    }
  }
  const items: GuideItem[] = [];
  for (const { paint, coords, at } of strokes.values()) {
    for (const [where, [from, to]] of at)
      coords.push(...point(where, edge + out * from!), ...point(where, edge + out * to!));
    if (coords.length > 0) items.push({ type: "segments", coords, paint });
  }
  // Rows of labels from the line outward, or inward for labels inside the plot.
  const rows = [false, true].map((inside) => rowDepths(kit, layers, measure, inside));
  for (const placed of layers) {
    const { layer, ticks, angle, lane: lanes, label: paint, align } = placed;
    const labels = layer.labels;
    if (!labels) continue;
    const inner = !!labels.inside;
    const dir = inner ? -out : out;
    let away = firstRow(
      labels,
      placement.gap,
      across,
      layers.map(({ layer }) => layer),
    );
    for (let row = 0; row < labels.row; row++) away += (rows[+inner]![row] ?? 0) + ROW_GAP;
    const lane = laneDepth(kit, placed, measure) + ROW_GAP;
    const { anchor, cos } = turned(angle, dir < 0);
    ticks.forEach(({ position, label }, k) => {
      if (!label) return;
      const distance = away + (lanes[k] ?? 0) * lane;
      if (align) {
        // Flat labels aligned at their ticks: blocks as their style aligns
        // them along the axis, standing off the line on their side.
        const point = across
          ? { x: position, y: edge + dir * distance }
          : { x: placement.edge + dir * distance, y: placed.at?.[k] ?? position };
        const block = anchorBlock(
          kit.textLines(label, paint, measure),
          {
            ...point,
            align: across ? align : dir > 0 ? "start" : "end",
            verticalAlign: across
              ? dir > 0
                ? "top"
                : "bottom"
              : align === "start"
                ? "top"
                : align === "end"
                  ? "bottom"
                  : "middle",
            angle: 0,
          },
          paint,
        );
        items.push(kit.textItem(label, block.at, paint, placement.surface, measure, block.box));
        return;
      }
      let at: Parameters<GuideKit["textItem"]>[1];
      if (!across) {
        // As the default y axes place labels: from the axis' line as given,
        // inside the chart (see `layered`).
        at = {
          x: placement.edge + out * distance,
          // The first of a label's lines, the block centered where it is drawn.
          y: (placed.at?.[k] ?? position) - ((label.split("\n").length - 1) * paint.lineHeight) / 2,
          anchor: side === "left" ? "end" : "start",
          baseline: "middle",
          angle: 0,
        };
      } else if (angle)
        at = {
          x: position,
          y: edge + dir * (distance + (kit.textHeight(paint) / 2) * cos),
          anchor,
          baseline: "middle",
          angle,
        };
      else
        at =
          dir > 0
            ? {
                x: inside(position, label, paint, measure, labels.row, width),
                y: edge + distance,
                anchor: "middle",
                baseline: "hanging",
                angle: 0,
              }
            : {
                x: inside(position, label, paint, measure, labels.row, width),
                // The first line, of as many as the label has, whose block
                // (and box) ends where labels below it begin.
                y:
                  edge -
                  distance -
                  kit.textHeight(paint) / 2 -
                  (label.split("\n").length - 1) * paint.lineHeight,
                anchor: "middle",
                baseline: "middle",
                angle: 0,
              };
      items.push(kit.textItem(label, at, paint, placement.surface, measure));
    });
  }
  return items;
}
