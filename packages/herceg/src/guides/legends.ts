// Legends the chart's settings and guides ask for beyond the automatic one:
// legends of the scales they name, laid out in columns or rows under a
// title, with entries of your own and swatches drawn as the marks look.
// Each legend claims the scales it shows; the automatic legend shows the
// rest.

import { symbolReach } from "../draw/symbol-shapes.ts";
import { numberPattern, type TimePattern, timePattern } from "../format/patterns.ts";
import { markerPath } from "../marks/features/markers.ts";
import type { LayoutMark } from "../marks/layout-mark.ts";
import type { LegendScale, RowParts } from "../marks/mark.ts";
import type { SeriesSwatch } from "../model/features.ts";
import type { GuideKit, PlacedLegend } from "../model/guides.ts";
import type { MarkSeries } from "../model/inspect.ts";
import type {
  LegendContent,
  LegendEntry,
  LegendFlow,
  LegendFlowItem,
  LegendOut,
  LegendPart,
  LegendText,
  MeasuredLegend,
} from "../model/legend.ts";
import type { ChartConfig } from "../model/model.ts";
import type { CaptionGuide, Guide, GuideItem, LegendGuide, LegendItem } from "../scene/scene.ts";
import type { Place } from "../spec/place.ts";
import type {
  Dash,
  LegendEntrySpec,
  LegendGuideSpec,
  LegendInclude,
  LegendOptionsSpec,
  LegendStyles,
  ScaleRef,
  SwatchSpec,
} from "../spec/spec.ts";
import type { PaintReader, Theme } from "../theme.ts";
import { type ColorbarPlan, measureColorbar, plannedColorbars } from "./colorbars.ts";
import { type Read, restyle } from "./paints.ts";
import { drawnOf, markKey, rowKey, seriesKey, Visibility } from "./visibility.ts";

/** Colors as given, for legends laid out without a chart reading them. */
const same: PaintReader = (value) => value;

/** The square swatch, as the automatic legend draws it, and a line sample's length. */
const SWATCH = 10;
const LINE = 16;
/** Pixels between a swatch and its label, between entries in a row, and between rows. */
const LABEL_GAP = 6;
const ENTRY_GAP = 16;
const ROW_GAP = 4;
/** Opacity of a hidden entry's swatch and label, as the automatic legend fades them. */
const HIDDEN = 0.4;

/** A legend the configuration asks for, resolved. */
interface Plan {
  key: string;
  place: Place;
  options: LegendOptionsSpec;
  /** What it lists of the chart's scales and marks; undefined for all a legend shows by default. */
  sources: readonly LegendInclude[] | undefined;
  automatic: boolean;
  /** Where `guides` lists it; -1 for the automatic legend. */
  index: number;
  /** For the automatic legend: whether the chart sets `legend`, so that it shows even one entry. */
  explicit: boolean;
  /** For the automatic legend: whether `legend` is true, so that it lists what panels' legends do too. */
  forced?: boolean;
  /** Where its settings are, for messages. */
  path: string;
  /** A panel's legend: the key of the subplot whose marks it lists. */
  panel?: string | undefined;
}

/** What legends read of the configuration besides their plans. */
interface Planned {
  legends: Plan[];
  colorbars: ColorbarPlan[];
  /** Layout marks with ids (maps, pies), whose color ramps guides may name. */
  layouts: ReadonlyMap<string, LayoutMark>;
  /** Every layout mark, named or not. */
  drawsOwn: readonly LayoutMark[];
  /** Each mark's key, as its geometry and hidden keys name it: its id, or its place. */
  places: ReadonlyMap<object, string | number>;
  /** The chart's scales of categories, which legends list by name. */
  scales: ReadonlySet<string>;
  /** Of those, the scales of each panel's own (`scope: "panel"`), whose values each subplot names. */
  scoped: ReadonlySet<string>;
  /** The chart's subplots. */
  panels: readonly string[];
  /** The chart's time zone, which annotations' labels in time patterns are written in. */
  zone: string;
}

/**
 * The legends and colorbars of `config`: the automatic legend, unless it
 * is off, and those its guides list; undefined where there are none.
 */
export function plannedLegends(kit: GuideKit, config: ChartConfig): Planned | undefined {
  const { legend } = config;
  const listed = (config.guides ?? []).flatMap((guide, i) =>
    guide.type === "legend" && guide.show !== false ? [{ guide, i }] : [],
  );
  const options = typeof legend === "object" ? legend : {};
  const colorbars = plannedColorbars(config.guides);
  if (legend === false && listed.length === 0 && colorbars.length === 0) return undefined;
  const plans: Plan[] = listed.map(({ guide, i }) => ({
    key: guide.id !== undefined ? `legend|id|${guide.id}` : `legend|${i}`,
    place: placeOf(guide),
    options: guide,
    sources: guide.include,
    index: i,
    automatic: false,
    explicit: true,
    path: `chart guides[${i}]`,
    panel: guide.panel,
  }));
  if (legend !== false)
    plans.unshift({
      key: "legend",
      place: options.place ?? { side: "top" },
      options,
      sources: options.include,
      index: -1,
      automatic: true,
      explicit: legend !== undefined,
      forced: legend === true,
      path: "chart legend",
    });
  const scales = Object.entries(config.scales ?? {}).flatMap(([name, scale]) =>
    scale?.type === "ordinal" ? [name] : [],
  );
  for (const plan of colorbars) {
    const name = plan.scale?.scale;
    if (name !== undefined)
      throw new kit.ChartError({
        code: "invalid-option",
        path: `${plan.path.slice(6)}.scale`,
        message: `${plan.path}.scale: a colorbar shows a mark's color ramp, and "${name}" ${scales.includes(name) ? "is a scale of categories, whose values a legend lists, as include: [{ scale }]" : "is no color ramp"}; name the mark, as { mark, channel: "color" }`,
      });
  }
  const layouts = new Map<string, LayoutMark>();
  const drawsOwn: LayoutMark[] = [];
  const places = new Map<object, string | number>();
  config.marks.forEach((mark, i) => {
    places.set(mark, mark.spec.id ?? i);
    if ((mark as { layout?: boolean }).layout !== true) return;
    drawsOwn.push(mark as LayoutMark);
    if (mark.spec.id !== undefined) layouts.set(mark.spec.id, mark as LayoutMark);
  });
  return {
    legends: plans,
    colorbars,
    layouts,
    drawsOwn,
    places,
    scales: new Set(scales),
    scoped: new Set(
      scales.filter(
        (name) => (config.scales?.[name] as { scope?: string } | undefined)?.scope === "panel",
      ),
    ),
    panels: config.panels?.list.map(({ id }) => id) ?? [],
    zone: config.timeZone ?? "UTC",
  };
}

/**
 * Where a legend guide goes: as its place says, or a panel's above its
 * panel; a place inside a plot or beside a panel names the legend's panel
 * unless it names another.
 */
function placeOf(guide: LegendGuideSpec): Place {
  const { place, panel } = guide;
  if (panel === undefined) return place ?? { side: "top" };
  if (!place) return { side: "top", scope: "panel", panel };
  return place.scope === "chart" || place.panel !== undefined
    ? place
    : { ...place, scope: "panel", panel };
}

/** A scale of a mark's that a guide names. */
type ChannelRef = Extract<ScaleRef, { mark: string }>;

/** Marks and the channels of scales they own (a mark's series are its "series"). */
type Owned = readonly { mark: string | number; channel: string }[];

/** What guides may name of a mark with an identity that declares nothing (see `Mark.legendScales`). */
const SERIES: readonly LegendScale[] = ["series"];

/** Options where marks read fields through scales (`{ field, scale }`), their paints first. */
const CHANNELS = ["color", "fill", "stroke", "size", "symbol", "fillOpacity"] as const;

/** Whether `mark` reads scale `name`: through a channel, or as the chart's "color", by its series. */
function readsScale(mark: MarkSeries["mark"], name: string): boolean {
  if (name === "color" && mark.identity) return true;
  const spec = mark.spec as unknown as Record<string, unknown> & {
    encode?: Record<string, unknown>;
  };
  return [...CHANNELS.map((key) => spec[key]), ...Object.values(spec.encode ?? {})].some(
    (channel) => (channel as { scale?: unknown } | undefined)?.scale === name,
  );
}

/**
 * The fields `mark` reads through scale `name`, whose values color, size,
 * or shape its series or rows, but its series field where its series take
 * their colors through the scale: the series then stand for the scale's
 * values (marks/features/identity.ts).
 */
function scaleFields(mark: MarkSeries["mark"], name: string): string[] {
  const spec = mark.spec as unknown as Record<string, unknown> & {
    encode?: Record<string, unknown>;
  };
  const channels = [...CHANNELS.map((key) => spec[key]), ...Object.values(spec.encode ?? {})];
  const painting = seriesChannel(mark);
  const fields = channels.flatMap((channel) => {
    const { field, scale } = (channel ?? {}) as { field?: unknown; scale?: unknown };
    return typeof field === "string" &&
      scale === name &&
      !(field === mark.identity?.field && channel === painting)
      ? [field]
      : [];
  });
  return [...new Set(fields)];
}

/**
 * The channel a mark's series take their colors through, as
 * marks/features/identity.ts reads it: one naming them (`series: true`),
 * else the mark's own paint as a channel (a line's stroke, an area's,
 * bar's, or point's fill) unless that is a constant, else its color.
 */
function seriesChannel(mark: MarkSeries["mark"]): object | undefined {
  type Channel = { series?: boolean };
  const spec = mark.spec as unknown as Record<string, unknown> & {
    type: string;
    encode?: Record<string, Channel | undefined>;
  };
  const given =
    spec.encode?.color ?? (typeof spec.color === "object" ? (spec.color as Channel) : undefined);
  if (given?.series) return given;
  const { type } = spec;
  const primary =
    type === "line"
      ? "stroke"
      : type === "area" || type === "bar" || type === "point"
        ? "fill"
        : undefined;
  if (primary && spec[primary] !== undefined) return undefined;
  return (primary && spec.encode?.[primary]) || given;
}

/** The legends of `planned`, measured as the model asks (see `CompiledGuides.legends`). */
export function compiledLegends(kit: GuideKit, planned: Planned) {
  const { legends: plans, colorbars, layouts, places } = planned;
  return (
    content: LegendContent,
    text: LegendText,
    flow: (place: Place) => LegendFlow,
    marks: readonly MarkSeries[],
    theme: Theme,
    chart: { readonly width: number; readonly height: number },
  ): PlacedLegend[] => {
    const owners = ownersOf(marks, content.features);
    const paint = text.paint ?? same;
    const partsOf = partOwners(kit, marks, planned.drawsOwn, places, theme, text.locale, paint);
    // Marks left out of legends (`legend: false`, annotations not listed by
    // their labels) are left out of those that show what no guide names;
    // guides naming them show them. Their entries come after the others',
    // which keep their looks.
    const unlisted = new Set<string | number>();
    // Marks whose color field splits their series: their colors are the series'.
    const split = new Set<string | number>();
    const entries = [...content.entries];
    const keys = new Set(entries.map(({ key }) => key));
    // Annotations' entries, written as their labels are, of their rows drawn in a panel or all.
    const pattern = (format: object, locale: string | undefined, path: string) => {
      const pattern = format as { number?: string; time?: string };
      return pattern.time !== undefined
        ? timePattern(kit, pattern as TimePattern, planned.zone, locale, path)
        : numberPattern(kit, pattern as { number: string }, locale, path);
    };
    const labelEntries = (mark: MarkSeries["mark"], rows?: RowParts) =>
      mark.labelEntries!(places.get(mark)!, text.locale, rows, pattern);
    // Marks legends name whole.
    const named = new Set(
      plans.flatMap(
        (plan) =>
          plan.sources?.flatMap((ref) =>
            ref.mark !== undefined && ref.channel === undefined ? [ref.mark] : [],
          ) ?? [],
      ),
    );
    marks.forEach(({ mark, series }, index) => {
      const id = mark.spec.id ?? index;
      const { color, encode } = mark.spec as {
        color?: string;
        encode?: { color?: { field?: string } };
      };
      const field = mark.identity?.field;
      if (field !== undefined && (encode?.color?.field ?? color) === field) split.add(id);
      if (mark.labelEntries) {
        // Annotations by their labels, in the looks they draw.
        if (mark.spec.legend !== true) unlisted.add(id);
        if (mark.spec.legend !== true && !(typeof id === "string" && named.has(id))) return;
        const look = annotationLook(kit, mark.spec, theme, paint);
        const own = labelEntries(mark).map((entry) => ({ ...entry, ...look }));
        for (const entry of content.features?.labelLooks(mark, own) ?? own) {
          if (keys.has(entry.key)) continue;
          keys.add(entry.key);
          owners.set(entry.key, [id]);
          entries.push(entry);
        }
        return;
      }
      if (mark.spec.legend !== false) return;
      unlisted.add(id);
      for (const s of series) {
        const entry = kit.entryOf(mark, s, theme, paint);
        if (!entry || keys.has(entry.key)) continue;
        keys.add(entry.key);
        entries.push(entry);
      }
    });
    const allParts = [...content.parts];
    for (const [key, { part }] of partsOf)
      if (!allParts.some((shown) => shown.key === key)) allParts.push(part);
    // Whether a scale a mark owns is one `ref` names: a mark's "color" is
    // its series' where its color splits them.
    const names = (ref: ChannelRef, mark: string | number, channel: string) =>
      ref.mark === mark &&
      (ref.channel === channel ||
        (ref.channel === "color" && channel === "series" && split.has(mark)));
    // Whether `ref` names an entry or a part (`key`, of a scale `scale`)
    // that marks own (`owned`): a scale by name its values and the keys of
    // its outputs, a mark whole its entries.
    const refers = (ref: LegendInclude, owned: Owned, key: string, scale?: string) =>
      ref.scale !== undefined
        ? scale === ref.scale || key.startsWith(`{"scale":${JSON.stringify(ref.scale)},`)
        : ref.channel === undefined
          ? owned.some(({ mark, channel }) => mark === ref.mark && channel === "series")
          : owned.some(({ mark, channel }) => names(ref, mark, channel));
    const ownedBy = (key: string): Owned =>
      (owners.get(key) ?? [""]).map((mark) => ({ mark, channel: "series" }));
    // Panels' legends list what their panels draw, and the chart's what they
    // do not; where panels show or hide series of their own, the chart's
    // entries say so (see model/panel-legends.ts, loaded with subplots).
    const ofPanels = plans.find((plan) => plan.panel !== undefined);
    const Legends = content.panelLegends;
    if (ofPanels && !Legends)
      throw new kit.ChartError({
        code: "unknown-reference",
        path: `${ofPanels.path}.panel`,
        message: `${ofPanels.path}.panel: lists a subplot's marks, and the chart has no subplots; drop panel`,
      });
    // Marks legends name, which panels' legends list whatever their `legend`.
    const listedMarks = new Set(
      plans.flatMap(
        (plan) => plan.sources?.flatMap(({ mark }) => (mark === undefined ? [] : [mark])) ?? [],
      ),
    );
    // Wherever panels are, for the items layout marks draw in them too.
    const inPanels =
      Legends && content.split
        ? new Legends(
            content,
            owners,
            partsOf,
            theme,
            text.locale,
            paint,
            listedMarks,
            labelEntries,
          )
        : undefined;
    for (const plan of plans) if (plan.panel !== undefined) inPanels!.check(plan.panel, plan.path);
    // What entries name as drawn, and what showing them lets go of.
    const drawn = new Visibility(
      content,
      drawnOf(
        content,
        marks,
        places,
        planned.drawsOwn,
        (mark) =>
          mark.legend(places.get(mark)!, content.color!, theme, paint).map(({ key }) => key),
        inPanels?.items(),
      ),
    );
    const find = (id: string, path: string) => {
      const found = marks.find(({ mark }) => mark.spec.id === id);
      if (!found)
        throw new kit.ChartError({
          code: "unknown-reference",
          path: path.slice(path.indexOf(" ") + 1),
          message: `${path}: no mark has id "${id}"; give the mark id: "${id}"`,
        });
      return found;
    };
    // Errors of references, at their paths (the chart's options'), as the chart's own.
    const refused = (
      path: string,
      message: string,
      code: "invalid-option" | "unknown-reference" | "unknown-field" = "invalid-option",
    ) =>
      new kit.ChartError({
        code,
        path: path.slice(path.indexOf(" ") + 1),
        message: `${path}${message}`,
      });
    // A reference names a mark and a scale its options give it (see
    // `Mark.legendScales`), whatever its rows hold now: one naming no such
    // scale is a mistake, not an empty legend; one whose scale shows
    // nothing yet shows nothing until it does.
    const resolve = (ref: LegendInclude, path: string): void => {
      if (ref.scale !== undefined) {
        if (planned.scales.has(ref.scale)) return;
        const declared = [...planned.scales].map((name) => `"${name}"`).join(", ");
        throw refused(
          `${path}.scale`,
          `: the chart has no scale of categories "${ref.scale}"; ${declared ? `name one of ${declared}` : "declare it in scales"}`,
          "unknown-reference",
        );
      }
      const layout = layouts.get(ref.mark);
      if (layout) {
        // A map's color ramp, which colorbars and legends may name.
        if (ref.channel === "color" && layout.legendScales?.includes("ramp")) return;
        throw refused(
          path,
          `: mark "${ref.mark}" draws its own layout, whose items the automatic legend shows; drop the reference${layout.legendScales?.includes("ramp") ? ', or name its color ramp, as channel: "color"' : ""}`,
        );
      }
      const { mark } = find(ref.mark, `${path}.mark`);
      if (ref.channel === undefined) {
        if (mark.labelEntries && !(mark.spec as { label?: unknown }).label)
          throw refused(
            `${path}.mark`,
            `: mark "${ref.mark}" is an annotation without a label, which names no entry; give it a label`,
          );
        return;
      }
      const scales = mark.legendScales ?? (mark.identity ? SERIES : []);
      const owned = new Set<string>(
        scales.map((scale) => (scale === "ramp" || scale === "key" ? "color" : scale)),
      );
      // A color splitting series is theirs.
      if (split.has(ref.mark)) owned.add("color");
      if (owned.has(ref.channel)) return;
      const has = [...owned].map((channel) => `channel: "${channel}"`).join(" or ");
      throw refused(
        `${path}.channel`,
        `: mark "${ref.mark}" has no "${ref.channel}" scale${
          has
            ? `; name one it has, as ${has}`
            : ", nor another a legend shows; name a mark that colors, sizes, or shapes by a field, or drop the reference"
        }`,
      );
    };
    /** Whether `mark` hides its rows by a field's value (marks/hidden.ts): points, bars outside stacks, annotations. */
    const byRows = (mark: MarkSeries["mark"]) =>
      !!mark.labelEntries ||
      mark.spec.type === "point" ||
      (mark.spec.type === "bar" && !(mark.spec as { stack?: unknown }).stack);
    /**
     * The keys an entry of a legend's own (at `path`; of panel `panel`'s
     * legend) hides and shows: a mark whole; its series of a field's
     * values, or its rows of them (points, bars outside stacks,
     * annotations); a scale's values, in every mark reading it: its series
     * standing for them, and its rows holding them. Keys name values, not
     * what the marks have now, so what they gain later follows.
     */
    const targetsOf = (spec: LegendEntrySpec, path: string, panel: string | undefined) =>
      (spec.targets ?? []).flatMap((target, t): string[] => {
        const where = `${path}.targets[${t}]`;
        if (target.scale !== undefined) {
          const name = target.scale;
          resolve({ scale: name }, where);
          const scale = JSON.stringify(name);
          // A scale of each panel's own maps values in each panel apart:
          // in the panels drawing marks that read it.
          const within = !planned.scoped.has(name)
            ? [undefined]
            : panel !== undefined
              ? [panel]
              : planned.panels.filter((p) =>
                  marks.some(({ mark }) => mark.spec.panel === p && readsScale(mark, name)),
                );
          // Marks reading it: their rows holding a value, or their series of
          // one where they draw their rows as one.
          const readers = marks.flatMap(({ mark }) =>
            scaleFields(mark, name).flatMap((field) => {
              const place = places.get(mark)!;
              if (byRows(mark)) return [(value: string) => rowKey(place, field, value)];
              return field === mark.identity?.field
                ? [(value: string) => seriesKey(place, value)]
                : [];
            }),
          );
          return target.values.flatMap((value) => [
            ...within.map(
              (p) =>
                `{"scale":${scale},${p === undefined ? "" : `"panel":${JSON.stringify(p)},`}"value":${JSON.stringify(value)}}`,
            ),
            ...readers.map((key) => key(value)),
          ]);
        }
        // A mark of series, or one drawing its own layout, which hides whole too.
        const layout = layouts.get(target.mark);
        const series = layout ? undefined : find(target.mark, `${where}.mark`).mark;
        const mark = layout ?? series!;
        const drawnIn = mark.spec.panel;
        if (panel !== undefined && drawnIn !== panel)
          throw refused(
            `${where}.mark`,
            drawnIn === "*"
              ? `: mark "${target.mark}" is drawn in every panel, which follows the chart's legend only; target it from the chart's legend`
              : `: mark "${target.mark}" is drawn in ${drawnIn === undefined ? "no panel" : `panel "${drawnIn}"`}, and this legend toggles panel "${panel}"'s; target it from the legend of its panel or the chart's`,
          );
        const place = places.get(mark)!;
        if (target.field === undefined) return [markKey(place)];
        const { field, values } = target;
        const by = mark.identity?.field;
        // A series field's values are its series.
        if (field === by) return values.map((value) => seriesKey(place, value));
        const { type } = mark.spec;
        if (!series || !byRows(series))
          throw refused(
            `${where}.field`,
            `: ${type} "${target.mark}" ${type === "bar" ? "stacks its bars by series" : "draws its rows as one"}, which values of field "${field}" do not split; target ${by === undefined ? "the mark whole" : `its series by "${by}", or the mark whole`}`,
          );
        if (!series.table?.has(field))
          throw refused(
            `${where}.field`,
            `: mark "${target.mark}" has no field "${field}"; name one its table has`,
            "unknown-field",
          );
        return values.map((value) => rowKey(place, field, value));
      });
    // Colorbars claim the color scales they show from every legend.
    const barred = new Set<string>();
    const bars = colorbars.flatMap((plan): { index: number; legend: PlacedLegend }[] => {
      const ref = plan.scale as ChannelRef | undefined;
      if (ref && ref.channel !== "color")
        throw refused(
          `${plan.path}.scale.channel`,
          `: a colorbar shows a color scale; give channel: "color"`,
        );
      if (ref) resolve(ref, `${plan.path}.scale`);
      if (ref && !layouts.has(ref.mark) && !find(ref.mark, "").mark.legendScales?.includes("ramp"))
        throw refused(
          `${plan.path}.scale`,
          `: mark "${ref.mark}" has no color scale a colorbar shows; color it by a number field, or name another mark`,
        );
      // A ramp of no values yet is drawn once it has some: of a mark of
      // series, or a layout mark (a map), named or not.
      const part = colorbarPart(plan, partsOf, content.parts, unlisted, () =>
        [...marks.map(({ mark }) => mark), ...planned.drawsOwn].some(
          (mark) => !unlisted.has(places.get(mark)!) && !!mark.legendScales?.includes("ramp"),
        ),
      );
      if (!part) return [];
      barred.add(part.key);
      const measured = measureColorbar(kit, plan, part.colorbar!, text, theme, chart);
      return [{ index: plan.index, legend: { key: plan.key, place: plan.place, measured } }];
    });
    // What the chart's listed legends show, which the automatic one leaves
    // to them; a panel's legend covers what it lists in its panel only (see
    // the automatic legend's below).
    const claimed: LegendInclude[] = [];
    const all = plans.some((plan) => !plan.automatic && !plan.sources && plan.panel === undefined);
    for (const plan of plans)
      plan.sources?.forEach((ref, k) => {
        resolve(ref, `${plan.path}.include[${k}]`);
        if (plan.panel === undefined) claimed.push(ref);
      });
    // What each legend lists: entries (of what its panel draws, for a
    // panel's) and parts that the marks it shows own, then its own entries.
    const listed = plans.map((plan) => {
      // What a legend shows of what marks own (an entry, a part marks share):
      // what it includes, or by default what no listed legend claims.
      const shows = (owned: Owned, key: string, scale?: string) =>
        plan.sources
          ? plan.sources.some((ref) => refers(ref, owned, key, scale))
          : owned.some(({ mark }) => !unlisted.has(mark)) &&
            (!plan.automatic || (!all && !claimed.some((ref) => refers(ref, owned, key, scale))));
      const parts = allParts.filter((part) => {
        const shared = partsOf.get(part.key);
        return !barred.has(part.key) && (!shared || shows(shared.owners, part.key, part.scale));
      });
      const own = plan.options.entries;
      if (plan.panel !== undefined) {
        const shown = inPanels!.listed(plan.panel, entries, parts, shows);
        // Its own entries cover, beside what it lists, what they toggle all of in its panel.
        const targeted = own?.flatMap((spec, k) =>
          targetsOf(spec, `${plan.path}.entries[${k}]`, plan.panel),
        );
        if (targeted?.length)
          inPanels!.listed(plan.panel, entries, [], () => true, new Set(targeted));
        return { plan, ...shown };
      }
      return {
        plan,
        entries: entries.filter(({ key }) => shows(ownedBy(key), key)),
        parts,
      };
    });
    const sampled = entries.some((entry) => entry.sample);
    // In the order `guides` lists them, the automatic legend first.
    return listed
      .map(({ plan, entries, parts }): { index: number; legend: PlacedLegend } => {
        // The chart's legend leaves to panels' legends what they list
        // wherever it is drawn, unless the chart asks for it.
        if (plan.automatic && inPanels && !plan.forced)
          ({ entries, parts } = inPanels.uncovered(entries, parts));
        // Without an explicit setting, a chart of one series needs no automatic legend.
        if (!plan.explicit && content.entries.length < 2 && !sampled) entries = [];
        // A panel's legend toggles what its entries name there.
        const shown = plan.panel === undefined ? undefined : inPanels!.shown(plan.panel);
        // Entries as drawn (a panel's in its panel), and what showing each
        // lets go of: every entry's state first, so that rows of the values
        // they name, and what hides them, are read in one pass.
        const hidden = new Set<string>();
        const targets = entries.map((entry) => shown?.targets.get(entry.key) ?? [entry.key]);
        const states = drawn.states(targets, plan.panel);
        entries = entries.map((entry, i) => {
          const said = states[i];
          if (said === true) hidden.add(entry.key);
          const shows =
            said === true || said === "mixed" ? drawn.shows(targets[i]!, plan.panel) : undefined;
          return {
            ...entry,
            ...(said === "mixed" && { mixed: true }),
            ...(shows && { shows }),
          };
        });
        const { options } = plan;
        // An automatic legend without layout settings, or annotations' looks, is the default legend's.
        const plain =
          plan.automatic &&
          !shown &&
          !sampled &&
          !Object.keys(options).some((k) => k !== "place" && k !== "style");
        const measured = plain
          ? kit.measureLegends({ ...content, entries, parts, hidden }, text, flow(plan.place))
          : measureLegend(
              kit,
              plan,
              {
                entries,
                parts,
                hidden,
                also: shown?.also ?? content.also,
              },
              text,
              flow(plan.place),
              marks,
              theme,
              {
                targets: targetsOf,
                find,
                states: (targets) => drawn.states(targets, plan.panel),
                shows: (keys) => drawn.shows(keys, plan.panel),
              },
              shown,
            );
        const notes = notesOf(plan, measured);
        return { index: plan.index, legend: { key: plan.key, place: plan.place, measured, notes } };
      })
      .concat(bars)
      .sort((a, b) => a.index - b.index)
      .map(({ legend }) => legend);
  };
}

/** An annotation's entries' look: its color, and a swatch drawn as it draws. */
function annotationLook(
  kit: GuideKit,
  spec: object,
  theme: Theme,
  paint: PaintReader,
): { color: string; sample: Sample | undefined } {
  const { type, stroke, fill, label } = spec as {
    type: string;
    stroke?: string;
    fill?: string;
    label?: { style?: { color?: string } };
  };
  // Text in the color its label is drawn in.
  const text = label?.style?.color;
  const color =
    type === "text"
      ? text === undefined
        ? theme.text
        : paint(text, "text label.style.color")
      : ((type === "rule" ? stroke : fill) ?? undefined) === undefined
        ? theme.muted
        : paint(
            (type === "rule" ? stroke : fill)!,
            `${type} ${type === "rule" ? "stroke" : "fill"}`,
          );
  return { color, sample: sampleOf(kit, spec, { key: "", label: "", color }, theme, paint) };
}

/**
 * The legend part of the color scale a colorbar shows: of the mark its
 * `scale` names (a ramp, checked), or the chart's only one; none while the
 * ramp has no values, or while no mark of one (`ramped`) has.
 */
function colorbarPart(
  plan: ColorbarPlan,
  owners: ReturnType<typeof partOwners>,
  shown: readonly LegendPart[],
  unlisted: ReadonlySet<string | number>,
  ramped: () => boolean,
): LegendPart | undefined {
  const ref = plan.scale as ChannelRef | undefined;
  const candidates = new Map<string, LegendPart>();
  for (const [key, shared] of owners)
    if (
      shared.part.colorbar &&
      shared.owners.some(({ mark }) => (ref ? mark === ref.mark : !unlisted.has(mark)))
    )
      candidates.set(key, shared.part);
  // Layout marks' color scales (a choropleth's) are among the parts the chart shows.
  if (!ref) for (const part of shown) if (part.colorbar) candidates.set(part.key, part);
  const found = [...candidates.values()];
  if (ref || found.length === 1 || (found.length === 0 && ramped())) return found[0];
  throw new Error(
    found.length === 0
      ? `${plan.path}: the chart has no color scale a colorbar shows; color a heatmap, contour, map, or points by a number field`
      : `${plan.path}.scale: the chart has ${found.length} color scales; name one, as scale: { mark: "id", channel: "color" }`,
  );
}

/**
 * The marks (by id, or their index) each entry's series belong to, and the
 * entries of the declared domains they read (`domains`), drawn or not.
 */
function ownersOf(
  marks: readonly MarkSeries[],
  features: LegendContent["features"],
): Map<string, (string | number)[]> {
  const owners = new Map<string, (string | number)[]>();
  marks.forEach(({ mark, series }, index) => {
    const id = mark.spec.id ?? index;
    // Series are listed under their identity's entry.
    for (const key of [
      ...series.map((s) => s.entry ?? s.key),
      ...(features?.domainKeys(mark) ?? []),
    ]) {
      const list = owners.get(key) ?? [];
      if (!list.includes(id)) list.push(id);
      owners.set(key, list);
    }
  });
  return owners;
}

/**
 * The marks and channels of each legend part (a color ramp, a key of
 * sizes, symbols, or colors): marks with the same scale share one part.
 * Layout marks own their parts too (by their ids or places), which guides
 * may name.
 */
function partOwners(
  kit: GuideKit,
  marks: readonly MarkSeries[],
  layouts: readonly LayoutMark[],
  places: ReadonlyMap<object, string | number>,
  theme: Theme,
  locale: string | undefined,
  paint: PaintReader,
) {
  const owners = new Map<
    string,
    { owners: { mark: string | number; channel: ChannelRef["channel"] }[]; part: LegendPart }
  >();
  const format = (value: number) => kit.formatNumber(value, locale);
  const own = (part: LegendPart, mark: string | number) => {
    // Keys of sizes and shapes say so; ramps and color keys show color.
    const channel: ChannelRef["channel"] =
      part.channel === "size" ? "size" : part.channel === "shape" ? "symbol" : "color";
    const owner = { mark, channel };
    const shared = owners.get(part.key);
    if (shared) shared.owners.push(owner);
    else owners.set(part.key, { owners: [owner], part });
  };
  marks.forEach(({ mark, series }, index) => {
    for (const part of mark.legends?.(series, theme, format, paint) ?? [])
      own(part, mark.spec.id ?? index);
  });
  for (const layout of layouts)
    for (const part of layout.legends?.(theme, locale, paint) ?? []) own(part, places.get(layout)!);
  return owners;
}

/** A swatch's items about its left middle, and how wide and tall it is. */
type Sample = { width: number; height: number; items: GuideItem[] };

/** Pixels between looks of an entry drawn side by side. */
const SAMPLE_GAP = 3;

/** Whether a look fills an area (a box, a glyph), which another drawn over it would hide. */
function filled(look: Sample): boolean {
  return look.items.some(
    (item) => item.type === "rect" || (item.type === "shape" && item.fill !== "none"),
  );
}

/** Whether a look draws lines (a stroke, an outline), which another of them would cover. */
function lined(look: Sample): boolean {
  return look.items.some(
    (item) => item.type === "segments" || (item.type === "shape" && item.fill === "none"),
  );
}

/** An entry as a legend with settings lays it out: what it says, its swatch, and what it toggles. */
interface Row {
  key: string;
  label: string;
  color: string;
  glyph?: string | undefined;
  stroke?: string | undefined;
  sample: Sample | undefined;
  /** The series keys it toggles; none for an entry that explains rather than toggles. */
  targets: readonly string[];
  /** What showing it lets go of, where more than its targets (`LegendItem.shows`). */
  shows?: readonly string[] | undefined;
  hidden: boolean;
  mixed?: boolean | undefined;
}

/**
 * A legend with settings: its title, entries in a grid or rows, then its
 * parts; a panel's toggles each entry's series in it (`targets`) and draws
 * swatches as the marks drawn there (`drawn`) do.
 */
function measureLegend(
  kit: GuideKit,
  plan: Plan,
  content: LegendContent,
  shared: LegendText,
  flow: LegendFlow,
  marks: readonly MarkSeries[],
  theme: Theme,
  own: Own,
  {
    targets,
    drawn,
  }: {
    targets?: ReadonlyMap<string, readonly string[]> | undefined;
    drawn?: ReadonlySet<string | number> | undefined;
  } = {},
): (MeasuredLegend & { explained: string[] }) | undefined {
  const { options, path } = plan;
  const text: LegendText = { ...shared, ...paints(kit, shared, options.style, `${path}.style`) };
  const { measure } = text;
  const looks = drawn ? marks.filter(({ mark }, m) => drawn.has(mark.spec.id ?? m)) : marks;
  const paint = text.paint ?? same;
  // What it includes, then its own entries.
  let rows = derived(kit, options, content, looks, theme, paint, plan.sources);
  if (targets) rows = rows.map((row) => ({ ...row, targets: targets.get(row.key) ?? row.targets }));
  if (options.entries) {
    // Each entry has a key of its own: equal labels never merge, and keys never do.
    const keys = new Set(rows.map(({ key }) => key));
    options.entries.forEach(({ key }, k) => {
      if (keys.has(key))
        throw new kit.ChartError({
          code: "invalid-option",
          path: `${path.slice(6)}.entries[${k}].key`,
          message: `${path}.entries[${k}].key: "${key}" is the key of another of the legend's entries; give each a key of its own`,
        });
      keys.add(key);
    });
    rows = [
      ...rows,
      ...custom(
        kit,
        options.entries,
        own,
        theme,
        path,
        text.read ?? ((given) => given),
        paint,
        plan.panel,
      ),
    ];
  }
  // Every entry's swatch takes the widest one's room, and its row the tallest's.
  const swatch = Math.max(SWATCH, ...rows.map((row) => row.sample?.width ?? 0));
  const entryHeight = Math.max(
    text.lineHeight,
    ...rows.map((row) => Math.max(kit.textHeight(text.label, row.label), row.sample?.height ?? 0)),
  );
  const widths = rows.map(
    (row) => swatch + LABEL_GAP + kit.textWidth(row.label, text.label, measure),
  );
  // Where each entry goes: in a grid of fixed columns or rows, or in rows
  // flowing as the automatic legend's do.
  // A count of rows fills down each column, unless `order` says otherwise.
  const slots =
    options.columns || options.rows
      ? gridSlots(widths, options, options.order ?? (options.columns ? "row" : "column"))
      : flowSlots(widths, flow.wrap);
  const entryRows = Math.max(0, ...slots.map(({ row }) => row + 1));
  const gridWidth = Math.max(0, ...slots.map(({ x }, k) => x + widths[k]!));
  const title = typeof options.title === "string" ? { text: options.title } : options.title;
  const titlePaint = restyle(
    kit,
    text.read ?? ((given) => given),
    text.title,
    title?.style,
    `${path}.title.style`,
  );
  const titleHeight = title ? kit.textHeight(titlePaint, title.text) : 0;
  const entriesHeight = entryRows ? entryRows * entryHeight + (entryRows - 1) * ROW_GAP : 0;
  // The parts (color ramps, keys) flow under the entries, each as its flow items say.
  const out: LegendOut = { guides: [], finish: [] };
  // Keys' entries take the legend's grid too, under their titles; ramps flow.
  const order = options.order ?? (options.columns ? "row" : "column");
  const grid = options.columns || options.rows;
  const itemsOf = content.parts.map((part) => ({ part, items: part.items(text, out) }));
  const partItems = itemsOf.flatMap(({ items }) => items);
  const partRows = grid
    ? itemsOf.flatMap(({ part, items }) =>
        part.channel !== undefined ? keyRows(items, options, order) : flowRows(items, flow.wrap),
      )
    : flowRows(partItems, flow.wrap);
  const partsHeight = partRows.reduce(
    (sum, row) => sum + row.height,
    (partRows.length - 1) * ROW_GAP,
  );
  const blocks = [titleHeight, entriesHeight, partRows.length ? partsHeight : 0].filter(
    (h) => h > 0,
  );
  const width = Math.max(
    gridWidth,
    title ? kit.textWidth(title.text, titlePaint, measure) : 0,
    ...partRows.map((row) => row.width),
  );
  const height = blocks.reduce((sum, h) => sum + h, (blocks.length - 1) * ROW_GAP);
  if (rows.length === 0 && partItems.length === 0) return undefined;
  return {
    width,
    height,
    explained: rows.filter((row) => row.targets.length === 0).map((row) => row.label),
    place(x, y, surface) {
      if (surface !== undefined) text.surface = surface;
      const guides: Guide[] = [];
      const caption: GuideItem[] = [];
      if (title)
        caption.push(
          kit.textItem(
            title.text,
            {
              x,
              y: y + kit.textHeight(titlePaint) / 2,
              anchor: "start",
              baseline: "middle",
              angle: 0,
            },
            titlePaint,
            text.surface,
            measure,
          ),
        );
      const top = y + (titleHeight && titleHeight + ROW_GAP);
      const entries: LegendItem[] = [];
      rows.forEach((row, k) => {
        const slot = slots[k]!;
        const ex = x + slot.x;
        const ey = top + slot.row * (entryHeight + ROW_GAP) + entryHeight / 2;
        const item: LegendItem = {
          key: row.key,
          label: row.label,
          color: row.color,
          hidden: row.hidden,
          x: ex,
          y: ey,
          ...(row.glyph && { glyph: row.glyph }),
          ...(row.stroke && { stroke: row.stroke }),
          ...(row.sample && { sample: { ...row.sample, width: swatch } }),
          ...(row.mixed && { mixed: true }),
          ...(row.shows && { shows: row.shows }),
        };
        if (row.targets.length > 0) {
          if (row.targets.length !== 1 || row.targets[0] !== row.key) item.targets = row.targets;
          entries.push(item);
        } else caption.push(...entryItems(kit, item, swatch, text));
      });
      if (caption.length > 0)
        guides.push({
          kind: "caption",
          key: `${plan.key}|caption`,
          items: caption,
        } satisfies CaptionGuide);
      if (entries.length > 0) {
        let items: GuideItem[] | undefined;
        guides.push({
          kind: "legend",
          key: plan.key,
          entries,
          ...(plan.panel !== undefined && { panel: plan.panel }),
          label: text.label,
          halo: kit.textHalo(text.label, text.surface),
          get items() {
            items ??= entries.flatMap((entry) => entryItems(kit, entry, swatch, text));
            return items;
          },
        } satisfies LegendGuide);
      }
      let py = top + entriesHeight + (entriesHeight ? ROW_GAP : 0);
      for (const row of partRows) {
        for (const { item, at } of row.cells) item.place(x + at, py + row.height / 2);
        py += row.height + ROW_GAP;
      }
      for (const finish of out.finish) finish();
      guides.push(...out.guides);
      return guides;
    },
  };
}

/**
 * Sentences for what a legend draws that is not a button, which assistive
 * technology does not see: its entries that explain rather than toggle.
 */
function notesOf(plan: Plan, measured: MeasuredLegend | undefined): string[] {
  const explained = (measured as { explained?: string[] } | undefined)?.explained ?? [];
  if (explained.length === 0) return [];
  const title = plan.options.title;
  const name = typeof title === "string" ? title : (title?.text ?? "The legend");
  return [`${name}: ${explained.join(", ")}.`];
}

/** The legend's text paints with its own style, set at `path`, over the chart's. */
function paints(kit: GuideKit, text: LegendText, style: LegendStyles | undefined, path: string) {
  const read = text.read ?? ((given) => given);
  return {
    label: restyle(kit, read, text.label, style?.legendLabel, `${path}.legendLabel`),
    title: restyle(kit, read, text.title, style?.legendTitle, `${path}.legendTitle`),
    value: restyle(kit, read, text.value, style?.tickLabel, `${path}.tickLabel`),
  };
}

/**
 * The legend's entries from the scales it shows: one per identity (see
 * model/identity.ts), which toggles every series standing for it. With
 * `swatches: "mark"`, each draws as the marks showing it draw (several
 * looks together, where they differ).
 */
function derived(
  kit: GuideKit,
  options: LegendOptionsSpec,
  content: LegendContent,
  marks: readonly MarkSeries[],
  theme: Theme,
  paint: PaintReader,
  sources: readonly LegendInclude[] | undefined,
): Row[] {
  // The marks and series each entry stands for, for their looks: of marks
  // left out of legends too, where the legend names them.
  const shown = new Map<
    string,
    { mark: MarkSeries["mark"]; series: MarkSeries["series"][number] }[]
  >();
  const listed = (mark: MarkSeries["mark"]) =>
    mark.spec.legend !== false || !!sources?.some((ref) => ref.mark === mark.spec.id);
  if (options.swatches === "mark")
    for (const { mark, series } of marks)
      if (listed(mark))
        for (const s of series) {
          const key = s.entry ?? s.key;
          shown.set(key, [...(shown.get(key) ?? []), { mark, series: s }]);
        }
  // Layout marks' items standing for an entry, in their colors and glyphs.
  const items = new Map<string, LegendEntry[]>();
  if (options.swatches === "mark")
    for (const entry of content.also ?? [])
      items.set(entry.key, [...(items.get(entry.key) ?? []), entry]);
  return content.entries.map((entry) => {
    // Annotations' entries come with their looks.
    let sample = entry.sample as Sample | undefined;
    const looks = [
      ...(shown.get(entry.key) ?? []).map(({ mark, series }) => {
        // A series styled by the feature compiler says how it looks; others
        // as their mark lists them (a point's symbol, a line's stroke).
        const own = series.features?.swatch?.(theme);
        if (own) return swatchItems(kit, own);
        const listed = mark.legendEntry
          ? mark.legendEntry(series, theme, paint)
          : { color: series.color };
        return listed
          ? sampleOf(
              kit,
              mark.spec,
              { key: entry.key, label: entry.label, ...listed },
              theme,
              paint,
            )
          : undefined;
      }),
      ...(items.get(entry.key) ?? []).map((item) => sampleOf(kit, undefined, item, theme, paint)),
    ];
    // Marks drawing it differently each show their look, once: a line over
    // boxes, a box under lines, and looks that would hide one another (boxes
    // and glyphs, lines and lines) side by side.
    const seen = new Set<string>();
    for (const look of looks) {
      if (!look) continue;
      const items = JSON.stringify(look.items);
      if (seen.has(items)) continue;
      seen.add(items);
      if (!sample) {
        sample = look;
        continue;
      }
      const width = Math.max(sample.width, look.width);
      const height = Math.max(sample.height, look.height);
      if (!filled(look) && !lined(sample))
        sample = { width, height, items: [...sample.items, ...look.items] };
      else if (filled(look) && !filled(sample))
        sample = { width, height, items: [...look.items, ...sample.items] };
      else {
        const dx = sample.width + SAMPLE_GAP;
        sample = {
          width: dx + look.width,
          height,
          items: [...sample.items, ...look.items.map((item) => moved(item, dx, 0, undefined))],
        };
      }
    }
    return {
      key: entry.key,
      label: entry.label,
      color: entry.color,
      glyph: entry.glyph,
      stroke: entry.stroke,
      sample,
      targets: [entry.key],
      shows: entry.shows,
      hidden: content.hidden.has(entry.key),
      mixed: entry.mixed,
    };
  });
}

/**
 * How a legend reads its own entries: the keys an entry hides and shows,
 * what showing them lets go of, and a mark by id.
 */
interface Own {
  targets(spec: LegendEntrySpec, path: string, panel: string | undefined): string[];
  /** How what each entry's keys name is drawn where the legend toggles it (see `Visibility.states`). */
  states(targets: readonly (readonly string[])[]): (boolean | "mixed" | undefined)[];
  shows(keys: readonly string[]): readonly string[] | undefined;
  find(id: string, path: string): MarkSeries;
}

/** Entries of your own: explaining a swatch, or a mark's look, and toggling what they target. */
function custom(
  kit: GuideKit,
  specs: readonly LegendEntrySpec[],
  { targets: targetsOf, states: statesOf, shows, find }: Own,
  theme: Theme,
  path: string,
  read: Read,
  paint: PaintReader,
  /** A panel's legend's: it toggles marks of that panel only. */
  panel: string | undefined,
): Row[] {
  const targets = specs.map((spec, k) => targetsOf(spec, `${path}.entries[${k}]`, panel));
  // Hidden where all of what it names is, mixed where some is; what names
  // nothing drawn has no say: every entry's first, the rows of the values
  // they name read together.
  const states = statesOf(targets);
  return specs.map((spec, k) => {
    const at = `${path}.entries[${k}]`;
    const said = states[k];
    // What pressing it lets go of, read where pressing it shows.
    const more = said === true || said === "mixed" ? shows(targets[k]!) : undefined;
    let sample: Row["sample"];
    let color = theme.muted;
    if (spec.swatch) sample = swatchItems(kit, readSwatch(read, spec.swatch, `${at}.swatch`));
    else if (spec.sample) {
      const { mark, series } = find(spec.sample.mark, `${at}.sample.mark`);
      // As the mark's own entries look: its first series' color, and a point's symbol.
      const s = series[0];
      const look =
        (s && mark.legendEntry?.(s, theme, paint)) || (s && { color: s.color }) || undefined;
      color = look?.color ?? color;
      sample = sampleOf(
        kit,
        mark.spec,
        {
          key: spec.key,
          label: spec.label,
          color,
          ...(look?.glyph && { glyph: look.glyph }),
          ...(look?.stroke && { stroke: look.stroke }),
        },
        theme,
        paint,
      );
    }
    return {
      key: spec.key,
      label: spec.label,
      color,
      sample: sample ?? swatchItems(kit, { type: "rect", fill: color }),
      targets: targets[k]!,
      hidden: said === true,
      ...(said === "mixed" && { mixed: true }),
      ...(more && { shows: more }),
    };
  });
}

/**
 * A series' swatch drawn as its mark draws it: a line of its width and
 * dash, a box of an area's or bar's fill, a point's symbol.
 */
function sampleOf(
  kit: GuideKit,
  spec: object | undefined,
  entry: LegendEntry,
  theme: Theme,
  paint: PaintReader,
): Row["sample"] {
  const mark = (spec ?? {}) as {
    type?: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    dash?: Dash;
    fillOpacity?: number;
    opacity?: number;
    stack?: unknown;
    y1?: unknown;
    y2?: unknown;
  };
  if (entry.glyph)
    return {
      width: SWATCH,
      height: SWATCH,
      items: [
        {
          type: "shape",
          d: entry.glyph,
          at: [SWATCH / 2, 0],
          fill: entry.color,
          ...(entry.stroke && { stroke: entry.stroke }),
        },
      ],
    };
  switch (mark.type) {
    case "line":
      return swatchItems(kit, {
        type: "line",
        stroke: entry.color,
        strokeWidth: mark.strokeWidth ?? theme.style.line.strokeWidth,
        ...(mark.dash !== undefined && { dash: mark.dash }),
      });
    // Annotations as they draw by default: a dashed muted rule, a faint region.
    case "rule":
      return swatchItems(kit, {
        type: "line",
        stroke: mark.stroke === undefined ? theme.muted : paint(mark.stroke, "rule stroke"),
        strokeWidth: mark.strokeWidth ?? 1,
        dash: mark.dash ?? [4, 4],
      });
    case "region":
      return swatchItems(kit, {
        type: "rect",
        fill: mark.fill === undefined ? theme.muted : paint(mark.fill, "region fill"),
        opacity: mark.fillOpacity ?? 0.15,
      });
    case "area": {
      // As areas fill: stacks nearly opaque, bands and areas lighter.
      const banded = mark.y1 !== undefined || mark.y2 !== undefined;
      const opacity = mark.fillOpacity ?? (mark.stack ? 0.85 : banded ? 0.2 : 0.25);
      return swatchItems(kit, { type: "rect", fill: entry.color, opacity });
    }
    default:
      // Bars as they paint: outlined in their stroke, at their opacities.
      return swatchItems(kit, {
        type: "rect",
        fill: entry.color,
        ...(mark.type === "bar" &&
          mark.stroke !== undefined && { stroke: paint(mark.stroke, "bar stroke") }),
        ...(mark.fillOpacity !== undefined && { fillOpacity: mark.fillOpacity }),
        ...(mark.opacity !== undefined && { opacity: mark.opacity }),
      });
  }
}

/** A swatch with its colors read as the chart reads styles' (CSS variables from the page), `path` naming it. */
function readSwatch(read: Read, swatch: SwatchSpec, path: string): SwatchSpec {
  return swatch.type === "composite"
    ? {
        ...swatch,
        parts: swatch.parts.map((part, j) => readSwatch(read, part, `${path}.parts[${j}]`)),
      }
    : read(swatch, path);
}

/** A swatch's items about its left middle, and its size. */
function swatchItems(kit: GuideKit, swatch: SeriesSwatch): Sample {
  switch (swatch.type) {
    case "line": {
      const strokeWidth = swatch.strokeWidth ?? 2;
      return {
        width: LINE,
        height: Math.max(SWATCH, strokeWidth),
        items: [
          {
            type: "segments",
            coords: [0, 0, LINE, 0],
            paint: {
              stroke: swatch.stroke,
              strokeWidth,
              dash: kit.dashPattern(swatch.dash as Dash | undefined, strokeWidth) ?? [],
              opacity: swatch.opacity ?? 1,
            },
          },
        ],
      };
    }
    case "rect": {
      // The fill's opacity under the outline's; a box without one, both as one.
      const { fillOpacity, opacity } = swatch;
      const alpha =
        fillOpacity === undefined && opacity === undefined
          ? undefined
          : (fillOpacity ?? 1) * (opacity ?? 1);
      const h = SWATCH / 2;
      return {
        width: SWATCH,
        height: SWATCH,
        items: [
          // An outlined box is a shape, whose outline renderers draw.
          swatch.stroke
            ? {
                type: "shape",
                d: `M${-h},${-h}h${SWATCH}v${SWATCH}h${-SWATCH}z`,
                at: [h, 0],
                fill: swatch.fill,
                stroke: swatch.stroke,
                ...(fillOpacity !== undefined && { fillOpacity }),
                ...(opacity !== undefined && { opacity }),
              }
            : {
                type: "rect",
                x: 0,
                y: -h,
                width: SWATCH,
                height: SWATCH,
                radius: 2,
                fill: swatch.fill,
                ...(alpha !== undefined && { opacity: alpha }),
              },
        ],
      };
    }
    case "symbol": {
      // `size` pixels across, whatever the shape reaches per unit of radius.
      const symbol = swatch.symbol ?? "circle";
      const size = swatch.size ?? SWATCH;
      const r = size / 2 / symbolReach(symbol);
      return swatchItems(kit, {
        type: "glyph",
        d: markerPath(kit, symbol, 0, 0, r),
        size,
        fill: swatch.fill,
        ...(swatch.stroke && { stroke: swatch.stroke }),
        ...(swatch.opacity !== undefined && { opacity: swatch.opacity }),
      });
    }
    case "glyph": {
      const size = Math.max(SWATCH, swatch.size);
      return {
        width: size,
        height: size,
        items: [
          {
            type: "shape",
            d: swatch.d,
            at: [size / 2, 0],
            fill: swatch.fill,
            ...(swatch.stroke && { stroke: swatch.stroke }),
            ...(swatch.opacity !== undefined && { opacity: swatch.opacity }),
          },
        ],
      };
    }
    case "composite": {
      // Parts over one another, centered on the widest: a line with its marker on it.
      const parts = swatch.parts.map((part) => swatchItems(kit, part));
      const width = Math.max(...parts.map((part) => part.width));
      return {
        width,
        height: Math.max(...parts.map((part) => part.height)),
        items: parts.flatMap((part) =>
          part.items.map((item) => moved(item, (width - part.width) / 2, 0, undefined)),
        ),
      };
    }
  }
}

/** What static output draws of an entry: its swatch, sample, or glyph, then its label. */
function entryItems(
  kit: GuideKit,
  entry: LegendItem,
  swatch: number,
  text: LegendText,
): GuideItem[] {
  // Faded as the live legend fades it: hidden, or hidden in some panels only.
  const opacity = entry.hidden ? HIDDEN : entry.mixed ? (1 + HIDDEN) / 2 : undefined;
  const items: GuideItem[] = [];
  const { sample, glyph } = entry;
  if (sample) for (const item of sample.items) items.push(moved(item, entry.x, entry.y, opacity));
  else if (glyph)
    items.push({
      type: "shape",
      d: glyph,
      at: [entry.x + SWATCH / 2, entry.y],
      fill: entry.color,
      stroke: entry.stroke,
      opacity,
    });
  else
    items.push({
      type: "rect",
      x: entry.x,
      y: entry.y - SWATCH / 2,
      width: SWATCH,
      height: SWATCH,
      radius: 2,
      fill: entry.color,
      opacity,
    });
  // Lines centered on the swatch.
  const y = entry.y - ((entry.label.split("\n").length - 1) * text.label.lineHeight) / 2;
  const label = kit.textItem(
    entry.label,
    { x: entry.x + swatch + LABEL_GAP, y, anchor: "start", baseline: "middle", angle: 0 },
    text.label,
    text.surface,
    text.measure,
  );
  items.push(opacity === undefined ? label : { ...label, opacity });
  return items;
}

/** A swatch item moved to (x, y), faded by `opacity`. */
function moved(item: GuideItem, x: number, y: number, opacity: number | undefined): GuideItem {
  switch (item.type) {
    case "segments":
      return {
        ...item,
        coords: item.coords.map((c, k) => c + (k % 2 === 0 ? x : y)),
        ...(opacity !== undefined && {
          paint: { ...item.paint, opacity: item.paint.opacity * opacity },
        }),
      };
    case "shape":
      return {
        ...item,
        at: [item.at[0] + x, item.at[1] + y],
        ...(opacity !== undefined && { opacity: (item.opacity ?? 1) * opacity }),
      };
    case "rect":
      return {
        ...item,
        x: item.x + x,
        y: item.y + y,
        ...(opacity !== undefined && { opacity: (item.opacity ?? 1) * opacity }),
      };
    default:
      return item;
  }
}

/** Where an entry goes: pixels from the legend's left, and its row. */
interface Slot {
  x: number;
  row: number;
}

/**
 * Entries `widths` wide in a grid of `columns`, or of `rows`, each column as
 * wide as its widest entry, filled row by row or down each column. A grid
 * filled across the lines it was asked for (down each of three columns,
 * along each of three rows) spreads its entries evenly over them.
 */
function gridSlots(
  widths: readonly number[],
  { columns, rows }: { columns?: number | undefined; rows?: number | undefined },
  order: "row" | "column",
): Slot[] {
  const count = widths.length;
  const lines = Math.max(1, Math.min(columns ?? rows ?? 1, count));
  const along = columns !== undefined ? order === "row" : order === "column";
  const cells: [column: number, row: number][] = [];
  if (along) {
    // Columns filled row by row, or rows down each column: the other side follows.
    for (let k = 0; k < count; k++)
      cells.push(
        columns !== undefined
          ? [k % lines, Math.floor(k / lines)]
          : [Math.floor(k / lines), k % lines],
      );
  } else {
    const base = Math.floor(count / lines);
    const extra = count % lines;
    for (let line = 0; line < lines; line++)
      for (let at = 0; at < base + (line < extra ? 1 : 0); at++)
        cells.push(columns !== undefined ? [line, at] : [at, line]);
  }
  const across = Math.max(0, ...cells.map(([column]) => column + 1));
  const columnWidths = Array.from({ length: across }, (_, c) =>
    Math.max(0, ...widths.filter((_, k) => cells[k]![0] === c)),
  );
  const starts = columnWidths.map((_, c) =>
    columnWidths.slice(0, c).reduce((sum, w) => sum + w + ENTRY_GAP, 0),
  );
  return cells.map(([column, row]) => ({ x: starts[column]!, row }));
}

/** Entries `widths` wide in rows wrapping at `wrap`, or one per row, as the automatic legend flows them. */
function flowSlots(widths: readonly number[], wrap: number | undefined): Slot[] {
  const slots: Slot[] = [];
  let row = 0;
  let x = 0;
  widths.forEach((width, k) => {
    if (k > 0 && (wrap === undefined || x + width > wrap)) {
      row++;
      x = 0;
    }
    slots.push({ x, row });
    x += width + ENTRY_GAP;
  });
  return slots;
}

/** Flow items in rows that wrap at `wrap` (or one per row); items that break start their own. */
function flowRows(items: readonly LegendFlowItem[], wrap: number | undefined): PartRow[] {
  const rows: PartRow[] = [];
  let row: PartRow | undefined;
  for (const item of items) {
    const last = row?.cells.at(-1);
    const at = last ? last.at + last.item.width + last.item.gap : 0;
    if (!row || item.breaks || wrap === undefined || at + item.width > wrap) {
      row = { cells: [], width: 0, height: 0 };
      rows.push(row);
    }
    const start = row.cells.length > 0 ? at : 0;
    row.cells.push({ item, at: start });
    row.width = start + item.width;
    row.height = Math.max(row.height, item.height);
  }
  return rows;
}

/** A row of legend parts' items, each at its distance from the legend's left. */
interface PartRow {
  cells: { item: LegendFlowItem; at: number }[];
  width: number;
  height: number;
}

/** A key's items with a legend's grid: its title in a row of its own, then its entries in the grid's cells. */
function keyRows(
  [title, ...entries]: readonly LegendFlowItem[],
  grid: { columns?: number | undefined; rows?: number | undefined },
  order: "row" | "column",
): PartRow[] {
  if (!title) return [];
  const slots = gridSlots(
    entries.map((item) => item.width),
    grid,
    order,
  );
  const lines: PartRow[] = [];
  entries.forEach((item, k) => {
    const { x, row } = slots[k]!;
    lines[row] ??= { cells: [], width: 0, height: 0 };
    const line = lines[row];
    line.cells.push({ item, at: x });
    line.width = Math.max(line.width, x + item.width);
    line.height = Math.max(line.height, item.height);
  });
  return [{ cells: [{ item: title, at: 0 }], width: title.width, height: title.height }, ...lines];
}
