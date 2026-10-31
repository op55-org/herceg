// Position scales of the chart's own, named in its `scales` with a type
// ("linear", "log", or "time"): marks place values on one with `{ field,
// scale }` and `{ data, scale }` (marks/row-bindings.ts). A scale has one
// domain per instance, the chart's or with scope "panel" each panel's, from
// what the marks there place on it, as its settings set it; and it
// projects along x or y over each panel's plot, padded as its settings
// say: by default with room for what marks draw past their values, sized
// for the shortest plot sharing the instance. Nothing zooms it: its domain
// holds all of its data.

import type { Formatter } from "../format/format.ts";
import type { Mark } from "../marks/mark.ts";
import type { AxisContext } from "../model/axis.ts";
import type { CompiledScales, GuideKit, MarkRoom, OwnScales } from "../model/guides.ts";
import type { MarkSeries } from "../model/inspect.ts";
import type { ChartConfig } from "../model/model.ts";
import type { ScaleSpec } from "../spec/spec.ts";
import type { AxisGuideOptions, AxisOptions } from "./options.ts";

/** The types of position scales. */
const TYPES = ["linear", "log", "time"];

/** Ticks a domain of the chart's own is rounded for: it is set before any plot's size is known. */
const COUNT = 5;

/** The places of marks a scale of the chart's own may be named at. */
const PLACES = ["x", "y", "x1", "x2", "y1", "y2"];

/**
 * The chart's position scales of its own, with how each is planned
 * (`context`, the compiler's), checked against what marks name; undefined
 * when it has none.
 */
export function ownScales(
  kit: GuideKit,
  config: ChartConfig,
  context: (context: AxisContext, name: string) => AxisContext,
  path: (name: string) => string,
): CompiledScales | undefined {
  const own = new Map<string, ScaleSpec>();
  // Scales with a range map channels other than position (marks/features/channel-scales.ts).
  for (const [name, spec] of Object.entries(config.scales ?? {}))
    if (
      !["x", "y", "yRight"].includes(name) &&
      TYPES.includes(spec?.type as string) &&
      !("range" in spec!)
    )
      own.set(name, spec as ScaleSpec);
  config.marks.forEach((mark, i) => {
    for (const [at, name, value] of named(mark)) {
      if (!own.has(name))
        throw new kit.ChartError({
          code: "unknown-reference",
          path: `marks[${i}].${at}.scale`,
          message: `chart marks[${i}].${at}.scale: the chart has no position scale "${name}"; name x, y, or yRight, or add scales: { ${name}: { type: "linear" } }`,
        });
      if (typeof value === "string")
        throw new kit.ChartError({
          code: "invalid-option",
          path: `marks[${i}].${at}.data`,
          message: `chart marks[${i}].${at}.data: scale "${name}" places numbers and times, not "${value}"; give a number`,
        });
    }
  });
  if (own.size === 0) return undefined;
  // Values are written as the scale's axis writes them, as the axes x and y
  // have their home axis' format, unless the scale gives a tooltipFormat.
  const specOf = (name: string, spec: ScaleSpec): AxisOptions => {
    const axis = config.guides?.find(
      (guide): guide is AxisGuideOptions =>
        guide.type === "axis" && guide.scale === name && guide.format !== undefined,
    );
    return axis ? { ...spec, format: axis.format! } : spec;
  };
  // Each instance's domain, by what it was found from, kept while that stays.
  const kept = new Map<string, readonly [string, [number, number]]>();
  return {
    resolve({ split, hidden, zone, locale, instances, room, headroom, length }) {
      const contexts = new Map(
        [...own].map(([name, spec]) => [
          name,
          context({ type: spec.type!, spec: specOf(name, spec), zone, locale }, name),
        ]),
      );
      /** The domain of `name` over what `among` draws. */
      const domainOf = (name: string, among: readonly MarkSeries[]): [number, number] => {
        const ctx = contexts.get(name)!;
        const spec = own.get(name)!;
        if (spec.domain) return kit.usableDomain(spec.domain, ctx.type);
        const log = ctx.type === "log";
        // Zero where the settings say, else where marks stand on it (bars).
        let stands = false;
        const extents = among.map(
          ({ mark, series, rows }): [Mark, [number, number] | undefined] => {
            const parts: (readonly [number, number] | undefined)[] = [];
            const shown = series.filter((s) => !hidden(mark, s));
            for (const axis of ["x", "y"] as const) {
              if (!on(mark, axis, name)) {
                parts.push(mark.scaleExtent?.(name, axis, log, rows));
                continue;
              }
              // As the mark measures its values on its axes: what its
              // features draw, positions of hidden series too.
              parts.push(
                axis === "x"
                  ? mark.xExtent(mark.tooltip === "y" ? shown : series, log, undefined, rows)
                  : mark.yExtent(shown, -Infinity, Infinity, log, undefined, rows),
              );
              if (mark.zero === axis && shown.length > 0) stands = true;
            }
            return [mark, kit.unionExtent(parts)];
          },
        );
        let extent = kit.domainExtent(extents);
        if ((spec.zero ?? stands) && !log && extent) extent = kit.unionExtent([extent, [0, 0]]);
        return kit.niceAxisDomain(
          kit.usableDomain(extent, ctx.type),
          ctx,
          COUNT,
          spec.nice ?? true,
        );
      };
      /**
       * What a domain is found from: the marks, their tables' versions and
       * views' revisions, the panel's parts of their rows, and the series shown.
       */
      const drawn = (among: readonly MarkSeries[]) =>
        among
          .map(({ mark, series, rows }) => {
            const shown = series.filter((s) => !hidden(mark, s));
            const keys = shown.map((s) => `${s.key}#${s.length}`).join();
            const parts = rows?.map((part) => part.length).join(".");
            return `${config.marks.indexOf(mark)} ${mark.table?.version} ${mark.view?.revision} ${parts} ${keys}`;
          })
          .join("|");
      // Each panel's instance of each scale, as its scope says, each
      // instance's domain, and what its panels draw.
      const domains = new Map<
        string,
        { of: readonly number[]; instances: [number, number][]; among: MarkSeries[][] }
      >();
      for (const [name, spec] of own) {
        const of = instances(spec.scope, `chart ${path(name)}.scope`);
        const among: MarkSeries[][] = [];
        split.panels.forEach((entries, i) => {
          const g = of[i]!;
          among[g] = [
            ...(among[g] ?? []),
            ...entries.filter((_, m) => split.members?.[i]?.[m] !== false),
          ];
        });
        const found = Array.from(among, (entries = [], g): [number, number] => {
          const key = `${name} ${g}`;
          const from = drawn(entries);
          const cached = kept.get(key);
          if (cached?.[0] === from) return cached[1];
          const made = domainOf(name, entries);
          kept.set(key, [from, made]);
          return made;
        });
        domains.set(name, { of, instances: found, among });
      }
      /** Scale `name`'s domain in panel `i`. */
      const domain = (name: string, i: number) => {
        const { of, instances: found } = domains.get(name)!;
        return found[of[i] ?? 0] ?? found[0]!;
      };
      /**
       * What scale `name` shows in panel `i` along `axis`, `pixels` long
       * (by default the shortest of the instance's plots): its domain with
       * the padding given, or room for what its marks draw past their values.
       */
      const shown = (name: string, i: number, axis: "x" | "y", pixels?: number) => {
        const { of, among } = domains.get(name)!;
        const g = of[i] ?? 0;
        const size =
          pixels ?? Math.min(...of.flatMap((h, j) => (h === g ? [length(j, axis)] : [])), Infinity);
        const context = contexts.get(name)!;
        const fitted = domain(name, i);
        if (context.padding) return context.padding.pad(fitted, size);
        if (own.get(name)!.domain) return fitted;
        let [low, high] = [0, 0];
        let clear: MarkRoom["clearDomain"];
        for (const { mark, series } of among[g] ?? []) {
          if (!on(mark, axis, name)) continue;
          const drawn = room(mark);
          const inset = drawn?.inset?.[axis] ?? 0;
          const head =
            mark.zero === axis
              ? headroom(
                  mark,
                  series.filter((s) => !hidden(mark, s)),
                )
              : 0;
          if (inset || head) clear = drawn?.clearDomain;
          const log = context.type === "log";
          low = Math.max(low, inset + (!log && fitted[0] < 0 ? head : 0));
          high = Math.max(high, inset + (log || fitted[1] > 0 ? head : 0));
        }
        return clear?.(fitted, low, high, size, context.type) ?? fitted;
      };
      const numbers = (value: number) => kit.formatNumber(value, locale);
      const scales: OwnScales = {
        groupOf: (name) => domains.get(name)?.of,
        scale(name, axis, i, plot) {
          const range: [number, number] =
            axis === "x" ? [plot.x, plot.x + plot.width] : [plot.y + plot.height, plot.y];
          return kit.createScale(contexts.get(name)!, shown(name, i, axis), range);
        },
        plan(name, i, size, across, start) {
          const context = contexts.get(name);
          if (!context) return undefined;
          const from = start ?? 0;
          const range: [number, number] = across ? [from, from + size] : [from + size, from];
          const count = kit.tickCountOf(context, size, across);
          // Ticks within the domain, inside its padding; before panels are
          // placed (no `start`), padded for the size given.
          const shows = shown(name, i, across ? "x" : "y", start === undefined ? size : undefined);
          return kit.planAxis(context, shows, range, count, domain(name, i));
        },
        formats(mark, i, plot) {
          const formats: { x?: Formatter; y?: Formatter } = {};
          for (const axis of ["x", "y"] as const) {
            const bound = mark.bound?.[axis];
            if (bound?.kind === "scale")
              formats[axis] = kit.tooltipFormatter(
                contexts.get(bound.scale)!,
                scales.scale(bound.scale, axis, i, plot),
                numbers,
              );
          }
          return formats;
        },
      };
      return scales;
    },
  };
}

/** Whether `mark` places its rows along `axis` on scale `name`. */
function on(mark: Mark, axis: "x" | "y", name: string): boolean {
  const bound = mark.bound?.[axis];
  return bound?.kind === "scale" && bound.scale === name;
}

/**
 * The scales of the chart's own `mark` places values on: each place's
 * path, the scale's name, and the value given there.
 */
function named(mark: ChartConfig["marks"][number]): [string, string, unknown][] {
  const spec = mark.spec as unknown as Record<string, unknown> & {
    at?: Record<string, unknown>;
    span?: readonly unknown[];
  };
  const places: [string, unknown][] = [
    ...PLACES.map((key): [string, unknown] => [key, spec[key]]),
    ...Object.entries(spec.at ?? {}).map(([key, place]): [string, unknown] => [`at.${key}`, place]),
    ...(spec.span ?? []).map((place, k): [string, unknown] => [`span[${k}]`, place]),
  ];
  return places.flatMap(([at, place]) => {
    const { scale, data } = (place ?? {}) as { scale?: unknown; data?: unknown };
    return typeof scale === "string" && !["x", "y", "yRight"].includes(scale)
      ? [[at, scale, data] as [string, string, unknown]]
      : [];
  });
}
