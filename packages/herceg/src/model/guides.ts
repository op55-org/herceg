// What the model asks of the guide compiler, the code that plans guides
// beyond the default (ticks other than a count, pattern and function formats,
// the chart's `scales` and `guides`, legend layouts). The compiler loads with
// the charts that use it: a live chart imports it before drawing such a
// configuration, and static output (SVG, PDF, specs) brings it with it, so
// charts that use none of it carry none of it.

import { markupOf, n } from "../draw/markup.ts";
import { textItemMarkup } from "../draw/text.ts";
import {
  type Formatter,
  formatNumber,
  numberFormatter,
  numberTickLabels,
  timeFormatter,
  timeTickLabels,
} from "../format/format.ts";
import { fromWall, toWall } from "../format/zone.ts";
import { aligned } from "../layout/place.ts";
import {
  centeredLines,
  fitText,
  type MeasureText,
  textHalo,
  textHeight,
  textItem,
  textLines,
  textWidth,
} from "../layout/text.ts";
import { mapValue } from "../lod/m4.ts";
import type { Mark } from "../marks/mark.ts";
import type { Series } from "../marks/series.ts";
import { xExtent } from "../marks/series.ts";
import { domainExtent, unionExtent } from "../marks/trace.ts";
import type { PositionScale } from "../scale/scale.ts";
import { chooseInterval, timeTicks } from "../scale/time.ts";
import { strokeKey } from "../scene/grid.ts";
import { type AxisGuide, type Panel, type Rect, tickLabelGap } from "../scene/scene.ts";
import { ChartError } from "../spec/errors.ts";
import type { Place } from "../spec/place.ts";
import type { ScaleScope } from "../spec/spec.ts";
import { cssFont, dashPattern, insets, textPaint } from "../style/style.ts";
import { surface, type Theme } from "../theme.ts";
import {
  type AxisContext,
  type AxisPlan,
  createScale,
  niceAxisDomain,
  planAxis,
  tickCountOf,
  tooltipFormatter,
  usableDomain,
} from "./axis.ts";
import type { clearDomain } from "./clearance.ts";
import type { MarkSeries } from "./inspect.ts";
import {
  entryOf,
  type LegendContent,
  type LegendFlow,
  type LegendText,
  type MeasuredLegend,
  measureLegends,
} from "./legend.ts";
import type { ChartConfig, PanelPlans } from "./model.ts";
import type { PanelSplit } from "./panel-layout.ts";
import type { ScaleName } from "./scales.ts";
import type { ChartStyles } from "./styles.ts";

/**
 * What the guide compiler and the feature compiler use of the chart's own
 * code, handed to them rather than imported: a module both the chart and a
 * compiler's chunk imported would move out of the chart's first chunk into
 * a chunk of its own (as esbuild splits code), which compresses worse.
 */
export const GUIDE_KIT = {
  textItemMarkup,
  surface,
  textPaint,
  formatNumber,
  numberFormatter,
  numberTickLabels,
  timeFormatter,
  timeTickLabels,
  toWall,
  fromWall,
  chooseInterval,
  timeTicks,
  planAxis,
  textItem,
  textLines,
  fitText,
  centeredLines,
  textWidth,
  textHeight,
  tickLabelGap,
  strokeKey,
  cssFont,
  dashPattern,
  insets,
  aligned,
  textHalo,
  measureLegends,
  entryOf,
  n,
  markupOf,
  mapValue,
  ChartError,
  xExtent,
  domainExtent,
  unionExtent,
  usableDomain,
  niceAxisDomain,
  createScale,
  tickCountOf,
  tooltipFormatter,
  alignsTickLabels,
};

export type GuideKit = typeof GUIDE_KIT;

/** Plans a configuration's guides (guides/compile.ts). */
export interface GuideCompiler {
  compile(config: ChartConfig): CompiledGuides;
}

/** A configuration's guides as the compiler planned them. */
export interface CompiledGuides {
  /** The configuration as the model reads it: each scale's listed axis on its default side read as its short form. */
  readonly config: ChartConfig;
  /**
   * `context`, the context of an axis of scale `scale`, with how its ticks
   * are planned and its values written where its settings ask for more
   * than a count and Intl options.
   */
  context(context: AxisContext, scale: ScaleName): AxisContext;
  /**
   * Orders what each of `panels` paints by zIndex (`Panel.paint`; see
   * scene/paint.ts), keeping a panel's order while its values stay.
   */
  paint(panels: readonly Panel[]): void;
  /** The axes `guides` lists, where they change the default ones. */
  readonly axes?: CompiledAxes | undefined;
  /** The chart's position scales of its own, where `scales` names any (guides/positions.ts). */
  readonly scales?: CompiledScales | undefined;
  /**
   * The chart's legends, measured, and where each goes, where legend
   * settings or `guides` ask for more than the automatic legend: `content`
   * is what the automatic legend would show, `flow` how a legend placed
   * somewhere flows by default, and `marks` every mark's series.
   */
  readonly legends?:
    | ((
        content: LegendContent,
        text: LegendText,
        flow: (place: Place) => LegendFlow,
        marks: readonly MarkSeries[],
        theme: Theme,
        chart: { readonly width: number; readonly height: number },
      ) => PlacedLegend[])
    | undefined;
}

/**
 * Position scales of the chart's own (`scales.depth: { type: "linear" }`),
 * which marks place values on by name.
 */
export interface CompiledScales {
  /**
   * Their domains, one per instance (`instances`, each panel's under a
   * scope, the layout's by default), from what the instance's panels'
   * marks (`panels[i]`, those it draws by `members[i]`) place on them,
   * `hidden` series left out; padded by default with the `room` each
   * mark asks for, over the shortest plot (`length`) of the instance.
   */
  resolve(scene: {
    split: Pick<PanelSplit, "panels" | "members">;
    hidden: (mark: Mark, series: Series) => boolean;
    zone: string;
    locale: string | undefined;
    instances: (scope: ScaleScope | undefined, path: string) => readonly number[];
    room: (mark: Mark) => MarkRoom | undefined;
    /** Pixels `mark` draws past its series' ends away from zero (bars' labels). */
    headroom: (mark: Mark, series: readonly Series[]) => number;
    /** Panel `i`'s plot's length along `axis`, read once panels are placed. */
    length: (i: number, axis: "x" | "y") => number;
  }): OwnScales;
}

/** What a mark draws past its values, and how a fitted domain keeps room for it: the mark's or its features'. */
export interface MarkRoom {
  readonly inset?: { readonly x: number; readonly y: number } | undefined;
  readonly clearDomain?: typeof clearDomain | undefined;
}

/** The chart's position scales of its own for one scene. */
export interface OwnScales {
  /** Each panel's instance of scale `name`, as its scope says; undefined for a name the chart has no scale of. */
  groupOf(name: string): readonly number[] | undefined;
  /** Scale `name` along `axis` over panel `i`'s `plot`. */
  scale(name: string, axis: "x" | "y", i: number, plot: Rect): PositionScale;
  /**
   * An axis of scale `name` for panel `i` over `size` pixels from `start`,
   * across the plot (x, left to right) or along it (y, bottom to top);
   * without `start`, before panels are placed, padded for `size`;
   * undefined for a name the chart has no scale of.
   */
  plan(
    name: string,
    i: number,
    size: number,
    across: boolean,
    start?: number,
  ): AxisPlan | undefined;
  /** How tooltips write the values `mark` places on these scales over panel `i`'s `plot`, by direction. */
  formats(mark: Mark, i: number, plot: Rect): { x?: Formatter; y?: Formatter };
}

/** A legend measured, with where it goes and its track's key. */
export interface PlacedLegend {
  key: string;
  place: Place;
  measured: MeasuredLegend | undefined;
  /** Sentences for the chart's description of what it draws that is not a button (entries that explain). */
  notes?: readonly string[] | undefined;
}

/**
 * Axes the guides list beyond the default ones, or drawn other than they
 * are: tick layers, tick marks and labels of their own, axes above the
 * plots and y axes on the right. The model keeps the room they ask for and
 * hands them each panel's default axes to change.
 */
export interface CompiledAxes {
  /**
   * Pixels they take above the plots, and below the default x axes'
   * labels; and which panels draw an axis above their plot.
   */
  across(state: AxesState): { top: number; bottom: number; over: readonly boolean[] };
  /**
   * Where panel `i`'s x labels over `plan`, below and above it, every
   * layer's as drawn, begin and end along the plan's range; undefined
   * where it draws none.
   */
  ends(plan: AxisPlan, state: AxesState, i: number): [number, number] | undefined;
  /**
   * Pixels they take beside the plots, beyond the default y axes', once y
   * is planned; and which panels draw an axis on the right of their plot.
   */
  beside(state: AxesState): { left: number; right: number; after: readonly boolean[] };
  /** Panel `index`'s axes along `plot`: the default ones, `axes`, changed and added to. */
  panel(
    axes: readonly AxisGuide[],
    state: AxesState,
    index: number,
    plot: Rect,
    plans: PanelPlans,
  ): AxisGuide[];
  /**
   * Whether the room `across` kept fits the x axes as panel `i`'s x plan,
   * `planOf(i)`, labels them; if not, `across` keeps more for scenes of this
   * width, and the model lays the scene out again.
   */
  fits(state: AxesState, planOf: (i: number) => AxisPlan): boolean;
}

/**
 * How a listed axis of `scale` is placed among the panels: as its `repeat`
 * says, by the scale's instances, but where panels' own settings hide it (`off`).
 */
export interface ListedPlacing {
  readonly scale: string;
  readonly repeat: "outer" | "all" | undefined;
  readonly off?: readonly boolean[] | undefined;
}

/** What the guides' axes read of a scene the model lays out. */
export interface AxesState {
  readonly measure: MeasureText;
  readonly styles: ChartStyles;
  /** What labels are drawn on, for their halos. */
  readonly surface: string;
  /** The chart's size. */
  readonly width: number;
  readonly height: number;
  /** Panels in a row, and whether panels have headers above them. */
  readonly columns: number;
  readonly headers: boolean;
  /** Which panels label x below them, and the left and right y beside them. */
  readonly labeled: Readonly<Record<ScaleName, readonly boolean[]>>;
  /** Which panels draw marks along the left y axis, shown or not. */
  readonly drawsY: readonly boolean[];
  /** Pixels the model keeps below the plots for the x axis' tick marks and labels, its title apart. */
  readonly xRoom: number;
  /**
   * In a layout of cells, in place of rows of `columns`: whether panel `i`
   * is the highest of the panels with axes lined up with it that share its
   * instance of `axis`' scale (where axes above the plots go), or the last
   * of those drawing along y and sharing it in its row (where axes on the
   * right go), among the panels `axis` is not hidden in (`off`) and as its
   * `repeat` says; its plot's width at a first guess; and for an inset,
   * the span down its box, which its labels along y stay inside.
   */
  readonly cells?: {
    top(i: number, axis: ListedPlacing): boolean;
    last(i: number, axis: ListedPlacing): boolean;
    width(i: number): number;
    within(i: number): readonly [number, number] | undefined;
  };
  /**
   * The plan of panel `panel`'s axis of `scale`: for x, one over `pixels`
   * (for room, before x is planned); for y, its own; for a scale of the
   * chart's own, one over `pixels` across from `start` (0 by default), or
   * without them along its plot.
   */
  plan(scale: string, panel: number, pixels: number, start?: number): AxisPlan | undefined;
}

/**
 * Whether tick label styles (a theme's, axes' short forms', subplots',
 * listed guides'), or the base text styles they start from, align labels
 * at their ticks: the axes the guides list draw them so, and scales
 * without one get one on their default side (guides/axes.ts).
 */
function alignsTickLabels(config: ChartConfig): boolean {
  const aligns = (value: unknown): boolean =>
    typeof value === "object" &&
    value !== null &&
    Object.entries(value).some(([key, style]) =>
      key === "tickLabel" || key === "text"
        ? (style?.align ?? style?.verticalAlign) !== undefined
        : typeof style === "object" && aligns(style),
    );
  return aligns([
    config.theme,
    config.x,
    config.y,
    config.yRight,
    config.panels?.list,
    config.guides,
  ]);
}

/**
 * Whether a configuration uses what only the guide compiler plans: ticks
 * other than a number, formats other than Intl options, `scales`, `guides`,
 * and legend settings beyond its place and style.
 */
export function needsGuides(config: ChartConfig): boolean {
  const { x, y, yRight, legend, panels, scales } = config;
  return (
    // Position scales, the short forms' and the chart's own, are planned there.
    !!config.guides ||
    alignsTickLabels(config) ||
    // Marks painted out of their order, and on scales of the chart's own.
    (config.marks as readonly Mark[]).some(
      ({ bound, scaled, spec }) =>
        scaled ||
        !!spec.zIndex ||
        // Annotations listed by their labels.
        spec.legend === true ||
        bound?.x?.kind === "scale" ||
        bound?.y?.kind === "scale",
    ) ||
    Object.values(scales ?? {}).some(
      (scale) => scale?.type !== "ordinal" && scale?.type !== "identity",
    ) ||
    [
      x,
      y,
      yRight,
      ...(panels?.list.flatMap((p) => [p.x, p.y, p.yRight]) ?? []),
      // Scales of the chart's own, whose settings the guide compiler checks first.
      ...(Object.values(scales ?? {}) as (typeof x)[]),
    ].some(
      (axis) =>
        axis &&
        (typeof axis.ticks === "object" ||
          // Grid settings and padding, which the guide compiler checks.
          typeof axis.grid === "object" ||
          axis.padding !== undefined ||
          [axis.ticks, axis.format, axis.tooltipFormat].some(
            (setting) =>
              typeof setting === "function" ||
              (setting as { number?: string })?.number !== undefined ||
              (setting as { time?: string })?.time !== undefined,
          )),
    ) ||
    (typeof legend === "object" &&
      Object.keys(legend).some((key) => key !== "place" && key !== "style"))
  );
}
