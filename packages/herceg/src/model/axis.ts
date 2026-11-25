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
import { type MeasureText, shapedMeasure, textHeight, textWidth } from "../layout/text.ts";
import type { Breaks } from "../lod/m4.ts";
import type { AxisBands } from "../marks/mark.ts";
import {
  BandScale,
  type LabelledTicks,
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
import type { AxisTick, Rect, SegmentGeometry } from "../scene/scene.ts";
import type { XAxisSpec } from "../spec/spec.ts";
import type { TextPaint } from "../style/style.ts";

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
   * guide compiler plans (forms other than a count and Intl options):
   * `auto` where the ticks are automatic, which fit their labels as the
   * model's own do.
   */
  plan?: ((ticker: PositionScale, count: number) => TickPlan) | undefined;
  /**
   * Whether two neighbouring labels stand too close where they are drawn,
   * set where their paints are known: automatic ticks then take the finest
   * interval at which none do (see `planAxis`).
   */
  meets?: LabelsMeet | undefined;
  /**
   * How one value is written, where the guide compiler writes them; marked
   * `own` where it is the axis' own `tooltipFormat`, which field displays'
   * formats do not write over (fields/chart.ts, `ShownField.over`).
   */
  formatValue?: (Formatter & { readonly own?: true }) | undefined;
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

/** An axis' ticks and their labels; from a planner, `auto` where it chose the ticks. */
export interface TickPlan {
  ticks: number[];
  labels: string[];
  auto?: boolean | undefined;
}

/**
 * Whether neighbouring labels `a` and `b`, in tick order, stand too close
 * as drawn; their positions are pixels from the low end of the plan's
 * range (its plot's left or top), so a plan judged once holds wherever its
 * plot stands.
 */
export type LabelsMeet = (a: AxisTick, b: AxisTick) => boolean;

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
  const planned = (n: number) => ticksOf(context, ticker, n);
  let plan = planned(count);
  const { meets } = context;
  if (meets && (!context.plan || plan.auto))
    plan = fitted(plan, planned, count, scale, meets, ticker);
  return { scale, ticks: plan.ticks, labels: plan.labels, within, context, count };
}

/** Pixels kept between neighbouring labels side by side, as "hide" keeps them (guides/axes.ts). */
const PAD = 4;

/**
 * Whether neighbouring labels overlap as the model's axes draw them, in any
 * of `paints`, as "hide" judges them: centred on their ticks, across the
 * plot by their widths (no narrower than their shapes, `shapedMeasure`),
 * PAD apart; along it by their blocks' heights, their lines' leading
 * keeping them apart; with their boxes.
 */
export function labelsMeet(
  paints: readonly TextPaint[],
  measure: MeasureText,
  across: boolean,
): LabelsMeet {
  const shaped = shapedMeasure(measure);
  // Each label is the second of one pair and the first of the next.
  let last = "";
  let size = 0;
  const sizeOf = (label: string) => {
    if (label !== last) {
      last = label;
      size = Math.max(
        ...paints.map((paint) =>
          across ? textWidth(label, paint, shaped) : textHeight(paint, label),
        ),
      );
    }
    return size;
  };
  const pad = across ? PAD : 0;
  return (a, b) => {
    const half = sizeOf(a.label) / 2;
    return Math.abs(b.position - a.position) < half + sizeOf(b.label) / 2 + pad;
  };
}

/**
 * Automatic ticks whose labels do not meet (`meets`, where `scale` draws
 * them): `plan`, planned for `count`, where none of its labels do; else the
 * first plan for each of the eight whole counts below that fits, or on an
 * axis with breaks, whose thinning can keep a finer interval at a lower
 * count, the fitting plan of those eight with the finest interval (and of
 * those the most ticks); past those, plans for half the count, and half
 * again, until one fits. At one tick's count, or where coarser plans have
 * no ticks, the last plan with ticks is kept, its labels still meeting the
 * one kept before them left blank. A plan the same as the last one judged
 * is not judged again.
 */
function fitted(
  plan: TickPlan,
  planned: (count: number) => TickPlan,
  count: number,
  scale: PositionScale,
  meets: LabelsMeet,
  ticker: PositionScale,
): TickPlan {
  // Its labels, those meeting the one kept before them blank; undefined where none meet.
  const low = Math.min(...scale.range);
  const thinned = ({ ticks, labels }: TickPlan) => {
    let last: AxisTick | undefined;
    let out: string[] | undefined;
    labels.forEach((label, k) => {
      if (!label) return;
      const tick = { position: scale.map(ticks[k]!) - low, value: ticks[k]!, label };
      if (!last || !meets(last, tick)) last = tick;
      else {
        out ??= labels.slice();
        out[k] = "";
      }
    });
    return out;
  };
  // The last plan judged, and whether it fits: a plan the same as it is not
  // judged again. A plan of no ticks (coarser steps can leave the domain
  // none) fits nothing: the last with ticks is kept, labels blanked.
  let judged = plan;
  let apart = false;
  const fits = (p: TickPlan) => {
    if (p.ticks.length === 0) return false;
    const same =
      p.ticks.length === judged.ticks.length &&
      p.ticks.every((t, k) => t === judged.ticks[k] && p.labels[k] === judged.labels[k]);
    if (!same) apart = !thinned(p);
    judged = p;
    return apart;
  };
  if (!thinned(plan)) return plan;
  const broken = ticker.breaks !== undefined;
  let best: TickPlan | undefined;
  let finest = Number.POSITIVE_INFINITY;
  let n = count;
  while (n > Math.max(1, count - 8)) {
    const p = planned(--n);
    if (!fits(p)) continue;
    if (!broken) return p;
    // The interval its ticks were planned at, which a format's labels may have coarsened.
    const interval =
      (ticker as CalendarScale).intervalOf?.(p.ticks)?.duration ?? Number.POSITIVE_INFINITY;
    if (!best || interval < finest || (interval === finest && p.ticks.length > best.ticks.length)) {
      best = p;
      finest = interval;
    }
  }
  if (best) return best;
  while (n > 1) {
    n = Math.floor(n / 2);
    const p = planned(n);
    if (fits(p)) return p;
  }
  return { ticks: judged.ticks, labels: thinned(judged) ?? judged.labels };
}

/** `ticker`'s ticks and labels for about `count` ticks, as `context` plans them. */
function ticksOf(context: AxisContext, ticker: PositionScale, count: number): TickPlan {
  if (context.plan) return context.plan(ticker, count);
  const format = context.spec?.format;
  const time = ticker.type === "time" ? (ticker as CalendarScale) : undefined;
  if (format) {
    const write = time
      ? timeFormatter(format as Intl.DateTimeFormatOptions, context.zone, context.locale)
      : numberFormatter(format as Intl.NumberFormatOptions, context.locale);
    return writtenTicks(ticker, count, (values) => values.map(write));
  }
  const auto = autoTicks(ticker, count);
  const { ticks, labelled } = auto;
  // Log ticks each with the decimals it needs ("0.2", "1", "1,000"), repeats
  // judged among the labelled ones.
  const labels = time
    ? timeTickLabels(
        ticks,
        time.interval(count),
        context.zone,
        context.locale,
        time.tickContexts?.(ticks),
      )
    : numberTickLabels(labelledOf(ticks, labelled), context.locale, !!labelled);
  return { ticks, labels: spread(auto, blankRepeats(labels)) };
}

/**
 * `ticker`'s automatic ticks for about `count`, and on log scales which of
 * them are labelled (`LogScale.labelledTicks`).
 */
export function autoTicks(ticker: PositionScale, count: number): LabelledTicks {
  return ticker instanceof LogScale ? ticker.labelledTicks(count) : { ticks: ticker.ticks(count) };
}

/** The items of labelled ticks, where `labelled` says; all without it. */
export function labelledOf<T>(items: T[], labelled: readonly boolean[] | undefined): T[] {
  return labelled ? items.filter((_, k) => labelled[k]) : items;
}

/** `labels` of the labelled ones of `ticks`, in place among blanks for the others. */
export function spread({ ticks, labelled }: LabelledTicks, labels: string[]): string[] {
  let n = 0;
  return labelled ? ticks.map((_, k) => (labelled[k] ? labels[n++]! : "")) : labels;
}

/**
 * About `count` ticks of `ticker` and their labels as `write` writes them:
 * the labelled ones alone, where a log scale leaves some blank. Where
 * labelled neighbors read alike, a coarser interval the format tells apart
 * takes their place if it has ticks in view (a date-only format steps by
 * days, not hours). A tick is its value, never its text: labels still
 * repeating the one before are left blank, and their ticks and grid lines
 * kept ("Apr" of two years are two ticks).
 */
export function writtenTicks(
  ticker: PositionScale,
  count: number,
  write: (values: number[]) => string[],
): { ticks: number[]; labels: string[] } {
  const written = (plan: LabelledTicks) =>
    blankRepeats(write(labelledOf(plan.ticks, plan.labelled)));
  let plan = autoTicks(ticker, count);
  let labels = written(plan);
  const runs = labels.filter((label, i) => !i || label).length;
  const coarser =
    runs < labels.length ? autoTicks(ticker, (count * runs) / labels.length) : undefined;
  if (coarser?.ticks.length) {
    plan = coarser;
    labels = written(plan);
  }
  return { ticks: plan.ticks, labels: spread(plan, labels) };
}

/** `labels` with those equal to the one before them left blank. */
export function blankRepeats(labels: string[]): string[] {
  return labels.map((label, i) => (i > 0 && label !== "" && label === labels[i - 1] ? "" : label));
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
 * across the plot (x) or along it (y): its count (see `wholeCount`), else
 * one per 80 pixels across (100 for times) or 45 along.
 */
export function tickCountOf({ type, spec }: AxisContext, size: number, across: boolean): number {
  // Contexts hold counts: the guide compiler plans the other forms.
  const given = spec?.ticks as number | undefined;
  return given !== undefined
    ? wholeCount(given, size)
    : Math.max(2, Math.round(size / (across ? (type === "time" ? 100 : 80) : 45)));
}

/**
 * A count of ticks given for an axis `pixels` long, as it is planned and its
 * domain rounded: whole, and from one to one for every two pixels, so that
 * plans for counts far past what an axis can show stay bounded.
 */
export function wholeCount(count: number, pixels: number): number {
  return Math.max(1, Math.min(Math.round(count), Math.floor(pixels / 2)));
}

/**
 * A band axis over `bands`, labeled with their texts where they have them
 * (its scale's categories stay their labels). Labels are thinned to every
 * k-th band so neighbors do not overlap: `size` is the room the largest
 * label takes along the axis (for horizontal labels their width, for
 * vertical ones a line height).
 */
export function planBandAxis(
  bands: AxisBands,
  range: readonly [number, number],
  padding: number,
  size: number,
): AxisPlan {
  const categories = bands.labels;
  const scale = new BandScale(categories, range, padding);
  const every = Math.max(1, Math.ceil((size + 6) / Math.max(1e-9, Math.abs(scale.step))));
  const ticks: number[] = [];
  for (let i = 0; i < categories.length; i += every) ticks.push(i);
  return { scale, ticks, labels: ticks.map((i) => bands.texts[i]!) };
}
