import {
  type Formatter,
  numberFormatter,
  numberTickLabels,
  timeFormatter,
  timeTickLabels,
  timeValueFormatter,
} from "../format/format.ts";
import type { TimeZone } from "../format/zone.ts";
import type { AxisOptions } from "../guides/options.ts";
import type { Breaks } from "../lod/m4.ts";
import {
  BandScale,
  LinearScale,
  LogScale,
  niceDomain,
  niceLogDomain,
  type PositionScale,
} from "../scale/scale.ts";
import {
  type CalendarScale,
  niceTimeDomain,
  TIME_UNIT_MS,
  TimeScale,
  type TimeUnit,
} from "../scale/time.ts";
import type { Rect, SegmentGeometry } from "../scene/scene.ts";
import type { XAxisSpec } from "../spec/spec.ts";

export type AxisType = "linear" | "log" | "time" | "band";

export interface AxisPlan {
  scale: PositionScale;
  ticks: number[];
  labels: string[];
  /** The domain ticks were chosen in (see `planAxis`); none for band axes. */
  within?: readonly [number, number];
  /**
   * What a continuous axis was planned with, and for how many ticks, so it
   * can be planned again over other domains (as values move between scenes).
   */
  context?: AxisContext;
  count?: number;
  /**
   * The pixels its domain was padded over (`AxisContext.padding`): the
   * shortest of the plots sharing it, over which views read back from
   * any of them are unpadded.
   */
  padded?: number | undefined;
}

export interface AxisContext {
  type: AxisType;
  spec: AxisOptions | undefined;
  zone: TimeZone;
  locale: string | undefined;
  /** Time a time axis leaves out, resolved in `zone` (scale/breaks.ts). */
  breaks?: AxisBreaks | undefined;
  /**
   * The ticks and labels of `ticker` (the scale over the domain ticks are
   * chosen in) for about `count` ticks, for axes whose ticks or format the
   * guide compiler plans (forms other than a count and Intl options).
   */
  plan?:
    | ((ticker: PositionScale, count: number) => { ticks: number[]; labels: string[] })
    | undefined;
  /** How one value is written, where the guide compiler writes them. */
  formatValue?: Formatter | undefined;
  /**
   * Padding the axis' settings give (the guide compiler's, other than
   * "auto"), in place of the room marks ask for at its ends.
   */
  padding?: AxisPadding | undefined;
}

/**
 * An axis' explicit padding (guides/padding.ts): the domain shown for a
 * domain or view over `pixels`, and the view a domain shown is padding.
 */
export interface AxisPadding {
  pad(domain: readonly [number, number], pixels: number): [number, number];
  unpad(domain: readonly [number, number], pixels: number): [number, number];
}

/** A time axis' breaks as axes use them; implemented by scale/breaks.ts. */
export interface AxisBreaks extends Breaks {
  /** Decorative segments behind data, thinned on the final panel scale. */
  seams?(
    scale: PositionScale,
    plot: Rect,
    options: NonNullable<XAxisSpec["seams"]>,
    color: string,
  ): SegmentGeometry | undefined;
  /** A time scale over `domain` that leaves the breaks out. */
  scale(domain: readonly [number, number], range: readonly [number, number]): PositionScale;
  /** `domain` changed by `change` in positions (time shown), as room at its ends is. */
  inPositions(
    domain: [number, number],
    change: (positions: [number, number]) => [number, number],
  ): [number, number];
  /**
   * `domain`, or when it shows no time (it is inside a break), the hour
   * either side of the break's seam; refused when `configured`.
   */
  showing(domain: [number, number], configured: boolean): [number, number];
}

/** Widens empty or zero-width domains so a scale can be built. */
export function usableDomain(
  domain: readonly [number, number] | undefined,
  type: AxisType,
): [number, number] {
  if (!domain) return type === "log" ? [1, 10] : [0, 1];
  const [lo, hi] = domain;
  if (lo !== hi) return [lo, hi];
  if (type === "log") return [lo / 10, lo * 10];
  if (type === "time") return [lo - 3_600_000, lo + 3_600_000];
  const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
  return [lo - pad, lo + pad];
}

/** Applies the axis' nice option to a domain. */
export function niceAxisDomain(
  domain: [number, number],
  context: AxisContext,
  count: number,
  nice: boolean,
): [number, number] {
  if (!nice) return domain;
  if (context.type === "log") return niceLogDomain(domain[0], domain[1]);
  if (context.type === "time") {
    const breaks = context.breaks;
    // With breaks, the interval follows the time shown.
    const span = breaks && breaks.collapse(domain[1]) - breaks.collapse(domain[0]);
    return niceTimeDomain(domain[0], domain[1], count, context.zone, span);
  }
  return niceDomain(domain[0], domain[1], count);
}

export function createScale(
  context: AxisContext,
  domain: readonly [number, number],
  range: readonly [number, number],
): PositionScale {
  if (context.type === "log") return new LogScale(domain, range);
  if (context.type === "time" && context.breaks) return context.breaks.scale(domain, range);
  if (context.type === "time") return new TimeScale(domain, range, context.zone);
  return new LinearScale(domain, range);
}

/**
 * Ticks and labels for a scale over `domain`. Ticks are chosen in `within`
 * (part of the domain): a domain rounded to nice values and then widened
 * for glyphs keeps the nice values as its ticks, while choosing in the
 * widened domain could step past them (a span just over a threshold takes
 * a coarser step, and a short axis can keep only one tick).
 */
export function planAxis(
  context: AxisContext,
  domain: readonly [number, number],
  range: readonly [number, number],
  count: number,
  within: readonly [number, number] = domain,
): AxisPlan {
  const scale = createScale(context, domain, range);
  const ticker = within === domain ? scale : createScale(context, within, range);
  if (context.plan) return { scale, ...context.plan(ticker, count), within, context, count };
  const format = context.spec?.format;
  let ticks = ticker.ticks(count);
  let labels: string[];
  if (ticker.type === "time") {
    const time = ticker as CalendarScale;
    const formatter =
      format && timeFormatter(format as Intl.DateTimeFormatOptions, context.zone, context.locale);
    labels = formatter
      ? ticks.map(formatter)
      : timeTickLabels(
          ticks,
          time.interval(count),
          context.zone,
          context.locale,
          time.tickContexts?.(ticks),
        );
    let unique = new Set(labels);
    if (formatter && unique.size < labels.length) {
      // Prefer a coarser calendar interval the format can distinguish.
      // Keep the useful candidates if that interval has no boundary in view.
      const coarser = ticker.ticks((count * unique.size) / labels.length);
      if (coarser.length) {
        ticks = coarser;
        labels = ticks.map(formatter);
        unique = new Set(labels);
      }
    }
    if (unique.size < labels.length) {
      const distinct = [...unique];
      ticks = ticks.filter((_, i) => unique.delete(labels[i]!));
      labels = distinct;
    }
  } else {
    labels = format
      ? ticks.map(numberFormatter(format as Intl.NumberFormatOptions, context.locale))
      : numberTickLabels(ticks, context.locale);
  }
  return { scale, ticks, labels, within, context, count };
}

/** `plan` for a panel `offset` pixels along: the same ticks and labels on a moved range. */
export function shiftPlan(plan: AxisPlan, context: AxisContext, offset: number): AxisPlan {
  if (offset === 0) return plan;
  const { scale } = plan;
  const range: [number, number] = [scale.range[0] + offset, scale.range[1] + offset];
  const moved =
    scale instanceof BandScale
      ? new BandScale(scale.categories, range, scale.padding)
      : createScale(context, scale.domain, range);
  return { ...plan, scale: moved };
}

/** Formatter for single values on this axis, as shown in tooltips. */
export function valueFormatter(context: AxisContext, fallback: Formatter): Formatter {
  if (context.formatValue) return context.formatValue;
  const format = context.spec?.tooltipFormat ?? context.spec?.format;
  if (!format) return fallback;
  return context.type === "time"
    ? timeFormatter(format as Intl.DateTimeFormatOptions, context.zone, context.locale)
    : numberFormatter(format as Intl.NumberFormatOptions, context.locale);
}

/**
 * How tooltips write values of a continuous axis of `context` over
 * `scale`: as its settings say, else times as precisely as the scale
 * resolves them and numbers by `numbers`.
 */
export function tooltipFormatter(
  context: AxisContext,
  scale: PositionScale,
  numbers: Formatter,
): Formatter {
  return valueFormatter(
    context,
    context.type === "time"
      ? timeValueFormatter(timeUnitFor(scale), context.zone, context.locale)
      : numbers,
  );
}

/**
 * Precision for time values in tooltips: finer when each pixel covers less
 * time (on axes with breaks, less time shown).
 */
function timeUnitFor(scale: PositionScale): TimeUnit {
  const perPixel = Math.abs(1 / scale.mapping().factor);
  if (perPixel < TIME_UNIT_MS.second) return "millisecond";
  if (perPixel < TIME_UNIT_MS.minute) return "second";
  if (perPixel < TIME_UNIT_MS.day) return "minute";
  return "day";
}

/**
 * About how many ticks an axis of `context` takes over `size` pixels,
 * across the plot (x) or along it (y): its count, else one per 80 pixels
 * across (100 for times) or 45 along.
 */
export function tickCountOf({ type, spec }: AxisContext, size: number, across: boolean): number {
  // Contexts hold counts: the guide compiler plans the other forms.
  return (
    (spec?.ticks as number | undefined) ??
    Math.max(2, Math.round(size / (across ? (type === "time" ? 100 : 80) : 45)))
  );
}

/**
 * A band axis. Labels are thinned to every k-th band so neighbors do not
 * overlap: `size` is the room the largest label takes along the axis (for
 * horizontal labels their width, for vertical ones a line height).
 */
export function planBandAxis(
  categories: readonly string[],
  range: readonly [number, number],
  padding: number,
  size: number,
): AxisPlan {
  const scale = new BandScale(categories, range, padding);
  const every = Math.max(1, Math.ceil((size + 6) / Math.max(1e-9, Math.abs(scale.step))));
  const ticks: number[] = [];
  for (let i = 0; i < categories.length; i += every) ticks.push(i);
  return { scale, ticks, labels: ticks.map((i) => categories[i]!) };
}
