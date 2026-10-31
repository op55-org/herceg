// The feature compiler: draws what only charts asking for it need of their
// marks (see model/features.ts): channels beyond constants, categorical
// scales, styles by value, markers, and which observations lines connect.
// A live chart loads it before drawing such a configuration; static output
// imports it. It imports only types from the chart's modules and is handed
// what it uses of their code (`FeatureKit`).

import type { MarkRows } from "../../data/row-view.ts";
import type { Table } from "../../data/table.ts";
import { symbolReach } from "../../draw/symbol-shapes.ts";
import { numberPattern, timePattern } from "../../format/patterns.ts";
import type { PointSink, Polyline } from "../../lod/polyline.ts";
import { clearDomain } from "../../model/clearance.ts";
import type {
  CompiledFeatures,
  FeatureCompiler,
  FeatureKit,
  Identities,
  MarkFeatures,
  PointChannels,
  RowLooks,
  SeriesFeatures,
  SeriesSwatch,
} from "../../model/features.ts";
import type { LegendEntry } from "../../model/legend.ts";
import type { ChartConfig } from "../../model/model.ts";
import type { AreaGeometry, Geometry, GuideItem, LineGeometry } from "../../scene/scene.ts";
import type {
  AreaLabelsSpec,
  ChannelSpec,
  EncodingsSpec,
  LabelContent,
  OrdinalScaleSpec,
  SymbolName,
} from "../../spec/encoding.ts";
import type { ChartErrorCode } from "../../spec/errors.ts";
import type { FormatSpec } from "../../spec/guides.ts";
import type { AreaSpec, BarSpec, LineSpec, TextSpec } from "../../spec/spec.ts";
import type { PaintReader, Theme } from "../../theme.ts";
import type { ChartMark, Frame, Mark, Palette } from "../mark.ts";
import type { Series } from "../series.ts";
import { ChannelScale, channelScaleProblem, wholeTable } from "./channel-scales.ts";
import {
  checkOutputs,
  compileChannel,
  fieldsOf,
  IDENTITY,
  outputCheck,
  type ScaleOf,
  scalePath,
} from "./channels.ts";
import { writeContent } from "./content.ts";
import { bandRuns, indexedBand, Topology } from "./continuity.ts";
import { encodedChannels } from "./encoded.ts";
import { type MarkScope, scalePrefix, scopeOfMark, tableNames } from "./identity.ts";
import {
  checkAt,
  checkContent,
  checkOwners,
  checkPlace,
  Drawings,
  edgeOf,
  placing,
  recording,
  seriesLabels,
} from "./labels.ts";
import { MARKER_RADIUS, markerPath, markers } from "./markers.ts";
import { PointStyles } from "./points.ts";
import { boundFrame, checkPositions } from "./positions.ts";
import {
  type PathEnds,
  pathEnds,
  positionBuffer,
  Recorder,
  type TracedEdge,
  tableRow,
} from "./provenance.ts";
import { type RowStyleSpec, RowStyles, rowLooks } from "./row-styles.ts";
import {
  fillPieces,
  holed,
  keptStretches,
  marksAt,
  RunMarks,
  reduceRuns,
  runAt,
  stretchesOf,
  strokeStretches,
  tracedEnds,
} from "./run-paths.ts";
import type { Look } from "./runs.ts";
import { type CategoryScale, IdentityColors, OrdinalScale } from "./scales.ts";
import { type SeriesPaint, SeriesStyles } from "./series-styles.ts";

/** The compiler, with the chart's code it uses. */
export function featureCompiler(kit: FeatureKit): FeatureCompiler {
  return {
    compile: (config, marks, previous, identities) =>
      compile(kit, config, marks, previous, identities),
    names: (tables, places, last) => tableNames(kit, tables, places, last),
  };
}

/** Marks whose short-form `color` is a field or a color (others' is a field). */
const PAINTED = [
  "line",
  "area",
  "bar",
  "histogram",
  "boxplot",
  "boxen",
  "violin",
  "errorbar",
  "rug",
];

/** Scales channels read without naming one. */
const DEFAULT_SCALES = ["color", "symbol", "dash"];
const POSITIONS = ["x", "y", "yRight"];

interface Compiled extends CompiledFeatures {
  readonly scales: ReadonlyMap<string, OrdinalScale>;
}

function compile(
  kit: FeatureKit,
  config: ChartConfig,
  marks: readonly Mark[],
  previous: CompiledFeatures | undefined,
  identities: Identities,
): CompiledFeatures {
  // Scales keep their values' places across updates that keep their settings.
  const kept = (previous as Compiled | undefined)?.scales;
  const scales = new Map<string, OrdinalScale>();
  /** A scale named `name` made (or kept) under `key`: its name, or its panel's or field's too. */
  const scaleOf = (name: string, spec: OrdinalScaleSpec | undefined, key = name) => {
    const old = kept?.get(key);
    const same = old && JSON.stringify(old.spec) === JSON.stringify(spec);
    const scale = new OrdinalScale(name, spec, same ? old : undefined);
    scales.set(key, scale);
    return scale;
  };
  // What series and rows stand for beyond the core's scopes, whose hidden keys stay.
  const prefixes = new Set<string>();
  /** Declared scales of each panel's own (`scope: "panel"`), made per panel as marks read them. */
  const ofPanels = new Map<string, OrdinalScaleSpec>();
  /** Declared identity scales, which map nothing. */
  const unmapped = new Set<string>();
  /** Declared channel scales, which map numbers onto widths, opacities, sizes, and colors. */
  const continuous = new Map<string, ChannelScale>();
  for (const [name, spec] of Object.entries(config.scales ?? {})) {
    if (spec !== undefined && POSITIONS.includes(name) && "range" in spec)
      throw new kit.ChartError({
        code: "invalid-option",
        path: scalePath(name),
        message: `chart ${scalePath(name)}: places values on an axis, which a range does not set; give the channel scale another name, and name it in encode`,
      });
    if (POSITIONS.includes(name) || spec === undefined) continue;
    if ("range" in spec) {
      const problem = channelScaleProblem(spec);
      if (problem)
        throw new kit.ChartError({
          code: "invalid-option",
          path: `${scalePath(name)}${problem.at}`,
          message: `chart ${scalePath(name)}${problem.at}: expected ${problem.expected}; received ${JSON.stringify(problem.value)}`,
        });
      // The default scales map categories: what series and category fields read unnamed.
      if (DEFAULT_SCALES.includes(name))
        throw new kit.ChartError({
          code: "invalid-option",
          path: scalePath(name),
          message: `chart ${scalePath(name)}: "${name}" is the scale marks read categories through by default, which a scale with a range does not map; give the channel scale another name, and name it in encode`,
        });
      continuous.set(name, new ChannelScale(name, spec));
      continue;
    }
    // Malformed first, for good, as the validator checks a spec before what it draws.
    const { scope } = spec as { scope?: unknown };
    if (spec.type === "ordinal" && scope !== undefined && scope !== "chart" && scope !== "panel")
      throw new kit.ChartError({
        code: "invalid-option",
        path: `${scalePath(name)}.scope`,
        message: `chart ${scalePath(name)}.scope: expected "chart" or "panel"; received ${JSON.stringify(scope)}`,
      });
    // Position scales of the chart's own are the guide compiler's (guides/positions.ts).
    if (spec.type === "linear" || spec.type === "log" || spec.type === "time") continue;
    if (spec.type === "identity") {
      unmapped.add(name);
      continue;
    }
    const ordinal = spec as OrdinalScaleSpec;
    if (ordinal.type !== "ordinal")
      throw new Error(
        `chart ${scalePath(name)}: expected type: "ordinal", a scale of categories; marks place values on x, y, and yRight`,
      );
    if (ordinal.scope === "panel") ofPanels.set(name, ordinal);
    else scaleOf(name, ordinal);
  }
  // The chart's palette slots of identity keys, which each scene hands over first.
  const chart: { slot: ((key: string) => number) | undefined } = { slot: undefined };
  const colors = new Map<string, IdentityColors>();
  /**
   * The scale `name` of a mark drawn in `panel`: the chart's, or for a
   * scale of each panel's own, its subplot's. Facets and marks of every
   * panel have no one subplot.
   */
  const scaleIn = (name: string, panel: string | undefined, path: string) => {
    const spec = ofPanels.get(name);
    if (!spec) return scales.get(name);
    if (config.facet || panel === "*")
      throw new kit.ChartError({
        code: "unsupported",
        path: `${scalePath(name)}.scope`,
        message: `chart ${scalePath(name)}.scope: "panel" maps values in each subplot, and ${path} ${config.facet ? "is split into facets" : "is drawn in every panel"}; draw it in one subplot, or drop scope`,
      });
    const key = `${name}\0${panel ?? ""}`;
    return scales.get(key) ?? scaleOf(name, spec, key);
  };
  /** The prefix of identity keys of the values of scale `name` in `panel`. */
  const prefixIn = (name: string, panel: string | undefined) => {
    const prefix = scalePrefix(name, ofPanels.has(name) ? (panel ?? "") : undefined);
    prefixes.add(prefix);
    return prefix;
  };
  const readIn =
    (
      table: Table | undefined,
      mark: Where,
      panel: string | undefined,
      rows?: () => MarkRows,
    ): ScaleOf =>
    (name, path, field) => {
      if (unmapped.has(name)) return IDENTITY;
      const channelScale = continuous.get(name);
      if (channelScale) {
        // The rows the mark draws, before facets and the legend, whose values the domain spans.
        if (field !== undefined && table?.has(field))
          channelScale.read(rows ?? (() => wholeTable(table)), field);
        return channelScale;
      }
      const scale = scaleIn(name, panel, path);
      if (scale) return scale;
      // Without a declared "color", a field's values take the colors of what they stand for.
      if (name === "color" && field !== undefined && table) {
        const prefix = identities.field(table, field, mark.index);
        let made = colors.get(prefix);
        if (!made) {
          made = new IdentityColors(prefix, chart);
          colors.set(prefix, made);
        }
        return made;
      }
      // A field's values take the shapes and dashes of its name, apart from other fields'.
      if (DEFAULT_SCALES.includes(name)) {
        const key = field === undefined ? name : `${name}\0${field}`;
        return scales.get(key) ?? scaleOf(name, undefined, key);
      }
      const names = [
        ...new Set([...scales.values()].map((scale) => scale.name)),
        ...ofPanels.keys(),
      ]
        .filter((n) => !DEFAULT_SCALES.includes(n) || config.scales?.[n] !== undefined)
        .map((n) => `"${n}"`)
        .join(", ");
      throw new kit.ChartError({
        code: "unknown-reference",
        path: `marks[${mark.index}].${path.slice(mark.path.length + 1)}`,
        mark: mark.mark,
        message: `${path}: the chart has no scale "${name}"; add it to scales${names ? `, or name one of ${names}` : ""}`,
      });
    };
  const zone = config.timeZone ?? "local";
  /**
   * The scales whose values series and layout items stand for, by the
   * prefix of their identity keys (a panel's own, for scales of each
   * subplot), with the marks reading them: legends list their declared
   * domains for those marks.
   */
  const listed = new Map<string, { scale: CategoryScale; marks: Set<ChartMark> }>();
  const list = (prefix: string, scale: CategoryScale, mark: ChartMark) => {
    const readers = listed.get(prefix) ?? { scale, marks: new Set<ChartMark>() };
    readers.marks.add(mark);
    listed.set(prefix, readers);
  };
  /** The keys of a declared domain's values, in its order; none without one. */
  const domainKeys = (prefix: string, scale: CategoryScale) =>
    (scale.spec?.domain ?? []).map((value) => `${prefix}${JSON.stringify(value)}}`);
  const byMark = new Map<Mark, MarkFeatures & { use(theme: Theme, paint: PaintReader): void }>();
  /**
   * Regions painted per row whose legend entries are their labels' values,
   * by mark key: each entry takes the look of the first row holding it.
   */
  const paintedRows = new Map<Mark, PaintedRows>();
  const declared = config.scales?.color !== undefined;
  // Labels following series: marks' own `labels`, and text `from` a mark
  // (by its id). Their sources' series record what they draw (labels.ts).
  const followed = new Set(
    marks.flatMap((mark) => {
      const from = (mark.spec as Partial<TextSpec>).from;
      return mark.spec.type === "text" && from ? [from.mark] : [];
    }),
  );
  const drawings = new Map<Mark, Drawings>();
  marks.forEach((mark, at) => {
    // Named by its place among the chart's marks, layout marks included.
    const index = identities.positions[at]!;
    const spec = mark.spec as { type: string; id?: string; color?: unknown };
    const path = `${spec.type}${spec.id === undefined ? ` (mark ${index})` : ` "${spec.id}"`}`;
    const where: Where = { path, index, mark: spec.id ?? index };
    try {
      compileMark(mark, identities.scopes[at], spec, path, where);
    } catch (error) {
      throw placed(kit, error, where);
    }
  });
  function compileMark(
    mark: Mark,
    own: string | undefined,
    spec: { type: string; id?: string; color?: unknown },
    path: string,
    where: Where,
  ): void {
    if (spec.type === "text" && (mark.spec as TextSpec).from) {
      byMark.set(mark, followingText(kit, mark, where, marks, drawings, config, zone));
      return;
    }
    if (mark.bound) checkPositions(mark, where);
    // On marks whose `color` is a field or a color, a name both says neither
    // (their series would read it as a field), and one that is neither is a mistake.
    const short = PAINTED.includes(spec.type) ? spec.color : undefined;
    if (typeof short === "string" && kit.isColor(short) === !!mark.table?.has(short))
      throw new Error(
        kit.isColor(short)
          ? `${path} color: "${short}" names both a field and a color; give encode.color: { field: "${short}" } or { value: "${short}" }`
          : `${path} color: "${short}" is neither a field nor a color; ${mark.table ? `the table has ${fieldsOf(mark.table)}` : "the mark has no table"}, and colors are hex, rgb(), hsl(), var(), or CSS names`,
      );
    const by = (field: string) => identities.field(mark.table!, field, where.index);
    const { panel } = mark.spec;
    // Colors an identity or channel scale gives stand for nothing.
    const scope = scopeOfMark(mark, own, by, declared, (name) =>
      unmapped.has(name) || continuous.has(name) ? undefined : prefixIn(name, panel),
    );
    // A series field is inferred from a color field only through a scale that maps its values.
    const encoded = (spec as { encode?: { color?: object } }).encode?.color;
    const through = (encoded ?? spec.color) as { field?: string; scale?: unknown } | undefined;
    if (
      (mark.spec as { series?: unknown }).series === undefined &&
      through?.field !== undefined &&
      through.field === mark.identity?.field &&
      (unmapped.has(through.scale as string) || continuous.has(through.scale as string))
    )
      throw new Error(
        `${path} ${encoded ? "encode.color" : "color"}.scale: "${through.scale}" is ${unmapped.has(through.scale as string) ? "an identity scale" : "a channel scale"}, whose colors split no series; give series, or series: false`,
      );
    for (const prefix of [scope?.color, scope?.rows])
      if (prefix && prefix !== own) prefixes.add(prefix);
    const read = readIn(mark.table, where, panel, mark.rows && (() => mark.rows!()));
    // A color channel naming series stands for them whatever paints them
    // (scopeOfMark), so it is checked where a paint of the mark's own wins too.
    const color = (spec as { encode?: { color?: ChannelSpec<string> } }).encode?.color;
    if (color && "series" in color)
      compileChannel(
        color,
        mark.table,
        read,
        "color",
        outputCheck("color", kit.isColor),
        `${path} encode.color`,
      );
    // The declared scale series' colors follow, its places in their field's dictionary order.
    // Scopes name only scales of categories (`scopeOfMark` leaves channel scales out).
    const scale =
      scope?.scale === undefined
        ? undefined
        : (read(scope.scale, `${path} ${scope.option ?? "color"}`) as CategoryScale);
    if (scale) {
      checkOutputs(scale, outputCheck("color", kit.isColor), `${path} color`);
      // The scale reads the values that color the mark, not series it colors otherwise.
      if (scope!.field !== undefined) scale.read(mark.table!, scope!.field);
      const prefix = scalePrefix(scale.name, ofPanels.has(scale.name) ? (panel ?? "") : undefined);
      if (scope!.color === prefix) list(prefix, scale, mark);
    }
    // Series of lines and areas labels follow record what they draw.
    const labels = (mark.spec as { labels?: AreaLabelsSpec }).labels;
    const drawn =
      (spec.type === "line" || spec.type === "area") &&
      (labels !== undefined || (spec.id !== undefined && followed.has(spec.id)))
        ? new Drawings(mark)
        : undefined;
    // Series of marks that need nothing else take the declared scale's colors.
    if (!mark.featured && !asks(mark) && !drawn) {
      if (scale) byMark.set(mark, scaledFeatures(scale, scope!));
      return;
    }
    const log = positionsLog(config, mark);
    const at = { scope, path, read, scale, where, labeled: drawn !== undefined };
    if (spec.type === "line") byMark.set(mark, lineFeatures(kit, mark, at, zone, log));
    else if (spec.type === "area") byMark.set(mark, areaFeatures(kit, mark, at, zone, log));
    else if (spec.type === "bar") byMark.set(mark, barFeatures(kit, mark, at, zone, config.locale));
    else if (spec.type === "point") byMark.set(mark, pointFeatures(kit, mark, at));
    else if (spec.type === "custom") byMark.set(mark, customFeatures(kit, mark, at));
    else if (spec.type === "region" && (mark.spec as { encode?: object }).encode) {
      const looks = rowLooks(mark.spec as RowStyleSpec, mark.table, read, path, kit.isColor);
      byMark.set(mark, { ...labelFeatures(kit, mark, zone, path, where, config.locale), ...looks });
      const { label } = mark.spec as { label?: string | { field?: string } };
      const field = typeof label === "object" ? label.field : undefined;
      if (field !== undefined && mark.table)
        paintedRows.set(mark, {
          table: mark.table,
          field,
          looks: looks.rowLooks,
          // Outlines of no width, or of no sides, draw nothing (region.ts).
          outlined: outlines(
            mark.spec as { strokeWidth?: number; strokeSides?: readonly string[] },
          ),
        });
    } else if (spec.type === "rule" || spec.type === "region" || spec.type === "text")
      byMark.set(mark, labelFeatures(kit, mark, zone, path, where, config.locale));
    else
      throw new Error(
        `${path}: encode, style, markers, continuity, and where are not options of ${spec.type} marks`,
      );
    if (!drawn) return;
    const features = byMark.get(mark)!;
    recording(features, drawn);
    drawings.set(mark, drawn);
    if (labels?.content)
      checkOwners(
        kit,
        mark,
        labels.at,
        labels.content,
        (i) => `marks[${where.index}].labels.content[${i}]`,
      );
    if (labels)
      Object.assign(
        features,
        placing(
          kit,
          {
            source: mark,
            index: where.index,
            drawings: drawn,
            at: labels.at,
            ...seriesLabels(mark, labels, path),
            content: writeContent(
              kit,
              labels.content ?? [{ series: true }],
              mark.table,
              config.locale,
              zone,
              (i) => `marks[${where.index}].labels.content[${i}]`,
              { series: true, value: true },
            ),
            style: labels.style,
            place: labels.place,
            path: `${path} labels.style`,
          },
          JSON.stringify([where.mark, "labels"]),
        ),
      );
  }
  // Layout marks' items follow a declared color scale too, reading their fields' values into it.
  let theme: Theme | undefined;
  let paint: PaintReader | undefined;
  /** The declared color scale of a mark's items, in its panel. */
  const colorOf = (mark: Mark) =>
    declared
      ? (scaleIn(
          "color",
          mark.spec.panel,
          `${mark.spec.type} (mark ${(config.marks as readonly Mark[]).indexOf(mark)})`,
        ) ?? scaleOf("color", undefined))
      : undefined;
  if (declared)
    for (const mark of config.marks as readonly Mark[]) {
      const identity = mark.identity as { field?: string; table?: Table } | undefined;
      if (!marks.includes(mark) && identity?.field !== undefined && mark.table) {
        const scale = colorOf(mark)!;
        scale.read(identity.table ?? mark.table, identity.field);
        list(prefixIn("color", mark.spec.panel), scale, mark);
      }
    }
  const compiled: Compiled = {
    scales,
    scopes: prefixes,
    items: (mark) => {
      const scale = colorOf(mark);
      return (
        scale && {
          prefix: prefixIn("color", mark.spec.panel),
          color: (value) =>
            theme && paint!(scale.output(value, theme.palette, theme.muted), "chart scales.color"),
        }
      );
    },
    of: (mark) => byMark.get(mark),
    listDomains: (entries, plain) => {
      let out = [...entries];
      for (const [prefix, { scale, marks }] of listed) {
        const domain = scale.spec?.domain;
        // Marks left out of legends list it where guides name them, and only there.
        if (!domain || !theme || (plain && [...marks].every(({ spec }) => spec.legend === false)))
          continue;
        const path = `chart ${scalePath(scale.name)}`;
        // In the place and look of the scale's first entry drawn, at the end
        // without one; values drawn outside the domain (in its `unknown`) follow.
        const at = out.findIndex(({ key }) => key.startsWith(prefix));
        const look = out[at];
        const keys = domainKeys(prefix, scale);
        const drawn = new Map(out.map((entry) => [entry.key, entry]));
        const listing = domain.map((value, i): LegendEntry => {
          const color = paint!(scale.output(value, theme!.palette, theme!.muted), path);
          const glyph = look?.glyph;
          return (
            drawn.get(keys[i]!) ?? { key: keys[i]!, label: value, color, ...(glyph && { glyph }) }
          );
        });
        const outside = out.filter(({ key }) => key.startsWith(prefix) && !keys.includes(key));
        out = out.filter(({ key }) => !key.startsWith(prefix));
        out.splice(at < 0 ? out.length : at, 0, ...listing, ...outside);
      }
      return out;
    },
    labelLooks: (mark, entries) => {
      const painted = paintedRows.get(mark);
      return painted ? rowPainted(entries, painted) : entries;
    },
    domainKeys: (mark) =>
      [...listed].flatMap(([prefix, { scale, marks }]) =>
        marks.has(mark) ? domainKeys(prefix, scale) : [],
      ),
    frame: (frame, bound) => boundFrame(kit, frame, bound),
    update(t, slot, p) {
      theme = t;
      paint = p;
      chart.slot = slot;
      for (const scale of scales.values()) scale.update();
      // Every reader of a channel scale is known: its domain spans them all, whatever their order.
      for (const [name, scale] of continuous) scale.update(p, `chart ${scalePath(name)}`);
      for (const features of byMark.values()) features.use(t, p);
    },
  };
  return compiled;
}

/**
 * The features of text following the series of mark `from.mark` (a line or
 * area declared before it, in its panel), whose labels it places as it is
 * drawn: its label's text, a field of the source mark's, or content.
 */
function followingText(
  kit: FeatureKit,
  mark: Mark,
  where: Where,
  marks: readonly Mark[],
  drawings: ReadonlyMap<Mark, Drawings>,
  config: ChartConfig,
  zone: string,
): MarkFeatures & { use(): void } {
  const spec = mark.spec as TextSpec;
  const from = spec.from!;
  const at = `${where.path} from`;
  const source = marks.find((m) => m.spec.id === from.mark);
  if (!source) {
    const layout = (config.marks as readonly Mark[]).some((m) => m.spec.id === from.mark);
    throw new kit.ChartError({
      code: layout ? "invalid-option" : "unknown-reference",
      path: `marks[${where.index}].from.mark`,
      mark: where.mark,
      message: layout
        ? `${at}.mark: mark "${from.mark}" draws its own layout; text follows the series of lines and areas`
        : `${at}.mark: no mark has id "${from.mark}"; give the line or area it follows id: "${from.mark}"`,
    });
  }
  const { type, panel } = source.spec;
  if (type !== "line" && type !== "area")
    throw new Error(
      `${at}.mark: mark "${from.mark}" is a ${type}; text follows the series of lines and areas`,
    );
  if (marks.indexOf(source) > marks.indexOf(mark))
    throw new Error(
      `${at}.mark: mark "${from.mark}" comes after this text; declare the text after the mark it follows`,
    );
  if (panel !== spec.panel)
    throw new Error(
      `${where.path} panel: the text follows mark "${from.mark}", drawn in ${panel === undefined ? "no panel" : `panel "${panel}"`}; draw it there too`,
    );
  checkAt(from.at, `${at}.at`);
  const edge = edgeOf(source, from.edge, at);
  const label = typeof spec.label === "string" ? { text: spec.label } : spec.label;
  checkContent(label.content, `${where.path} label.content`);
  checkPlace(label.place, `${where.path} label.place`);
  const own = `marks[${where.index}].label`;
  const content: LabelContent = label.content ?? [
    label.field !== undefined
      ? { field: label.field, ...(label.format && { format: label.format }) }
      : label.text!,
  ];
  checkOwners(kit, source, from.at, content, (i) =>
    label.content ? `${own}.content[${i}]` : `${own}.field`,
  );
  return {
    use() {},
    palette: (base) => base,
    attach() {},
    ...placing(
      kit,
      {
        source,
        index: identityIndex(config, source),
        drawings: drawings.get(source)!,
        at: from.at,
        edge,
        content: writeContent(
          kit,
          content,
          source.table,
          config.locale,
          zone,
          (i) => (label.content ? `${own}.content[${i}]` : own),
          { series: true, value: true },
        ),
        style: label.style,
        halo: spec.halo,
        place: label.place,
        path: `${where.path} label.style`,
      },
      JSON.stringify([where.mark, "text"]),
    ),
  };
}

/** A mark's index among the chart's marks, layout marks included. */
function identityIndex(config: ChartConfig, mark: Mark): number {
  return (config.marks as readonly Mark[]).indexOf(mark);
}

/**
 * `error`, thrown compiling the features of the mark `where` names, as a
 * ChartError at the option its message starts with: "line (mark 1)
 * encode.color.field: ..." at `marks[1].encode.color.field`, "chart
 * scales.color.map..." at `scales.color.map...`. Errors made with a `code`
 * keep it.
 */
function placed(kit: FeatureKit, error: unknown, where: Where): unknown {
  if (error instanceof kit.ChartError || !(error instanceof Error)) return error;
  const { message } = error;
  // The mark's name may hold colons (an id's), so the option is read after
  // it, up to a colon or " (read by " outside quoted keys (`map["a:b"]`).
  const at = (text: string) => text.match(/^(?:"(?:[^"\\]|\\.)*"|(?! \(read by )[^:"])*/)![0];
  const own = message.startsWith(`${where.path} `);
  const location = at(own ? message.slice(where.path.length + 1) : message);
  const path = own
    ? `marks[${where.index}].${location.replaceAll(" ", ".")}`
    : location.startsWith("chart ")
      ? location.slice(6)
      : `marks[${where.index}]`;
  const code = (error as { code?: ChartErrorCode }).code ?? "invalid-option";
  return new kit.ChartError({ code, path, mark: where.mark, message }, error);
}

/** Which mark features are compiled for: its name in messages, its index among the chart's marks, and its id or index. */
export interface Where {
  readonly path: string;
  readonly index: number;
  readonly mark: string | number;
}

/**
 * Where a mark's features are compiled: its scope, its name in messages,
 * its scales, and the declared scale its series' colors follow, if any.
 */
interface At {
  readonly scope: MarkScope | undefined;
  readonly path: string;
  readonly read: ScaleOf;
  readonly scale: CategoryScale | undefined;
  readonly where: Where;
  /** Whether labels follow the mark's series (`labels`, or text `from` it). */
  readonly labeled: boolean;
}

/**
 * A palette giving series the colors of what they stand for: through the
 * scale their mark's scope declares (`scales.color`, or a scale a channel
 * names), where `color` (the mark's own) gives none, and naming the
 * identity of a series standing for a scale's value.
 */
function scaledPalette(
  base: Palette,
  scope: MarkScope | undefined,
  scale: CategoryScale | undefined,
  theme: () => Theme | undefined,
  color: (key: string, label: string | undefined, given: string | undefined) => string | undefined,
): Palette {
  return (key, label, given) => {
    const own = color(key, label, given);
    const t = theme();
    const name = label ?? sourceOf(key);
    return base(
      key,
      label,
      own ?? (scale && t ? scale.output(name, t.palette, t.muted) : own),
      // A series its rows color (by another field) stands for their value, which the
      // chart keeps from the last scene; others for their name through the scale.
      scope?.scale === undefined || own === ""
        ? undefined
        : `${scope.color}${JSON.stringify(name)}}`,
    );
  };
}

/** For a mark needing no other features: its series' colors through a declared scale. */
function scaledFeatures(
  scale: CategoryScale,
  scope: MarkScope,
): MarkFeatures & { use(theme: Theme, paint: PaintReader): void } {
  let theme: Theme | undefined;
  return {
    use(t) {
      theme = t;
    },
    palette: (base) =>
      scaledPalette(
        base,
        scope,
        scale,
        () => theme,
        (_key, _label, given) => given,
      ),
    attach: (s) => identify(s, scope, undefined),
  };
}

/**
 * What a series stands for where its mark's scope says more than the
 * core's default: a declared scale's value (its name), or the value of the
 * field a line or area is colored by (`value`, its rows' one).
 */
function identify(s: Series, scope: MarkScope | undefined, value: string | undefined): void {
  if (!scope) return;
  // Series named through a scale stand for their names, whatever their rows' paint.
  if (value !== undefined && !scope.named) {
    s.entry = `${scope.color}${JSON.stringify(value)}}`;
    s.entryLabel = value;
  } else if (scope.scale !== undefined) s.entry = `${scope.color}${JSON.stringify(s.label)}}`;
  if (scope.named) s.partition = s.entry;
}

/** Whether a mark asks for options only the feature compiler draws. */
function asks(mark: Mark): boolean {
  const spec = mark.spec as unknown as Record<string, unknown>;
  return ["encode", "style", "markers", "continuity", "where"].some(
    (key) => spec[key] !== undefined,
  );
}

/** A series' source, from its key (see `seriesKey`): a y field, or a series field's value. */
function sourceOf(key: string): string {
  return String((JSON.parse(key) as unknown[])[1]);
}

/**
 * The axis a line's or area's positions lie in bands along: its orient's,
 * where its position field (named, or a coordinate's) is a category, as the
 * mark orders its series' rows by band then.
 */
function bandAxis(mark: Mark): "x" | "y" | undefined {
  const orient = mark.tooltip === "y" ? "y" : "x";
  const given = (mark.spec as { x?: unknown; y?: unknown })[orient];
  const field = given === undefined ? undefined : positionField(given);
  const table = mark.table;
  return field !== undefined && table?.has(field) && table.kind(field) === "category"
    ? orient
    : undefined;
}

/**
 * Whether a line's or area's positions lie on a log scale, as the chart's
 * settings say (a scale of the chart's own they are placed on; else each
 * panel's axis it draws in, the scale's settings, the short form; log
 * scales are never inferred): where every panel it draws in has one, since
 * its runs are measured once for all of them. Shares and pixels are linear.
 */
function positionsLog(config: ChartConfig, mark: Mark): boolean {
  const spec = mark.spec as { panel?: string; axis?: string };
  const bound = mark.bound?.[mark.tooltip !== "y" ? "x" : "y"];
  if (bound && bound.kind !== "axis")
    return bound.kind === "scale" && config.scales?.[bound.scale]?.type === "log";
  const name = mark.tooltip !== "y" ? "x" : spec.axis === "right" ? "yRight" : "y";
  const chart = config.scales?.[name]?.type ?? config[name]?.type;
  const list = config.panels?.list ?? [];
  const drawn = spec.panel === "*" ? list : list.filter((p) => p.id === spec.panel);
  const types = drawn.length > 0 ? drawn.map((p) => p[name]?.type ?? chart) : [chart];
  return types.every((type) => type === "log");
}

/** A mark's spec as its looks read it: its series field the one it splits rows by, inferred included. */
function resolved<T extends { series?: string | false }>(
  mark: Mark,
): Omit<T, "series"> & { series?: string } {
  const { series: _, ...spec } = mark.spec as unknown as T;
  const field = mark.identity?.field;
  return field === undefined ? spec : { ...spec, series: field };
}

/** Lines' looks by series, markers, and continuity. */
function lineFeatures(
  kit: FeatureKit,
  mark: Mark,
  { scope, path, read, scale, where, labeled }: At,
  zone: string,
  log: boolean,
): MarkFeatures & { use(theme: Theme, paint: PaintReader): void } {
  const spec = mark.spec as LineSpec;
  const table = mark.table!;
  const styles = new SeriesStyles(
    resolved<LineSpec>(mark),
    table,
    read,
    "stroke",
    where,
    kit,
    mark.tooltip as "x" | "y",
    () => mark.rows!(),
    bandAxis(mark),
  );
  const along = mark.tooltip as "x" | "y";
  const field = positionField(spec[along]);
  const topology =
    spec.continuity || spec.where !== undefined
      ? new Topology(kit, table, spec, { field, log }, zone, path)
      : undefined;
  topology?.check(table.kind(field), typeof spec.continuity?.maxGap === "object", path);
  const symbol: SymbolName = typeof spec.markers === "string" ? spec.markers : "circle";
  const looks = Object.values(spec.style?.by?.map ?? {}).flatMap((style) =>
    style.marker ? [style.marker] : [],
  );
  const marked = spec.markers !== false && (spec.markers !== undefined || looks.length > 0);
  // Markers reach their symbol's radius and half their outline past their
  // observations, the furthest of the mark's and its series' looks.
  let reach = 0;
  if (marked)
    for (const look of [{}, ...looks]) {
      const style = { ...spec.style?.marker, ...look };
      const outlined = style.stroke !== undefined || style.strokeWidth !== undefined;
      const r = (style.radius ?? MARKER_RADIUS) * symbolReach(style.symbol ?? symbol);
      reach = Math.max(reach, r + (outlined ? (style.strokeWidth ?? 1) / 2 : 0));
    }
  let theme: Theme | undefined;
  let paintOf: PaintReader;
  return {
    ...(reach > 0 && { inset: { x: reach, y: reach }, clearDomain }),
    use(t, p) {
      theme = t;
      paintOf = p;
      styles.use(t, p);
    },
    palette: (base) =>
      scaledPalette(
        base,
        scope,
        scale,
        () => theme,
        (key, label, given) => styles.color(sourceOf(key), given, label),
      ),
    attach(s) {
      const paint = styles.paint(s, sourceOf(s.key));
      identify(s, scope, paint.value);
      // Markers where the mark asks for them, or the series' style gives them.
      const marker =
        marked && (spec.markers || paint.style?.marker)
          ? { ...spec.style?.marker, ...paint.style?.marker }
          : undefined;
      if (marker?.fill !== undefined)
        marker.fill = paintOf(marker.fill, `${path} style.marker.fill`);
      if (marker?.stroke !== undefined)
        marker.stroke = paintOf(marker.stroke, `${path} style.marker.stroke`);
      // The observations the last trace kept, which markers stand at, the
      // row of each, and with runs, the run of each.
      let kept: Float32Array = new Float32Array(0);
      let keptRows: Float64Array = new Float64Array(0);
      let count = 0;
      const markerRuns: number[] = [];
      const rowsOf = new WeakMap<Geometry, ArrayLike<number>>();
      // Which observation each point traced is, where markers, `continuity`,
      // or labels ask: the rows ending the series' paths, by panel, as last
      // traced there, and the line as last traced, for labels.
      const recorder = marker || topology || labeled ? new Recorder() : undefined;
      const endsIn = new Map<string, PathEnds>();
      let traced: { upper?: TracedEdge } = {};
      // With runs: the points tracing reduced (before curves and steps), and the run of each.
      const marks = paint.runs && new RunMarks(paint.runs.looks);
      let reduced: Polyline | undefined;
      // The width the series was last drawn at, which its runs' looks are over.
      let width = spec.strokeWidth ?? 0;
      /** Look `index` of the series' runs as it draws, over the mark's `width`: its width, dash, and opacity. */
      const drawn = new Map<
        number,
        { look: Look; strokeWidth: number; dash: readonly number[] | undefined; opacity: number }
      >();
      const drawnLook = (index: number, width: number) => {
        let made = drawn.get(index);
        if (!made) {
          const look = styles.look(index, paint);
          const strokeWidth = look.strokeWidth ?? width;
          made = {
            look,
            strokeWidth,
            dash: kit.dashPattern(look.dash ?? spec.dash, strokeWidth),
            opacity: (look.opacity ?? 1) * (paint.strokeOpacity ?? 1),
          };
          drawn.set(index, made);
        }
        return made;
      };
      /** Markers in the looks of their observations' runs, a geometry per look. */
      const runMarkers = (series: Series, width: number) => {
        const byLook = new Map<number, { coords: number[]; rows: number[] }>();
        for (let i = 0; i < count; i++) {
          const look = paint.runs!.looks[markerRuns[i]!]!;
          const at = byLook.get(look) ?? byLook.set(look, { coords: [], rows: [] }).get(look)!;
          at.coords.push(kept[i * 2]!, kept[i * 2 + 1]!);
          at.rows.push(keptRows[i]!);
        }
        return [...byLook].map(([index, { coords, rows }]) => {
          // As the line's stretch there is drawn.
          const { look } = drawnLook(index, width);
          const dots = markers(
            kit,
            series.key,
            Float32Array.from(coords),
            coords.length / 2,
            marker!,
            symbol,
            look.color ?? series.color,
            look.opacity ?? 1,
          );
          const made = { ...dots, key: `${dots.key}${index}` };
          rowsOf.set(made, rows);
          return made;
        });
      };
      const features: SeriesFeatures = {
        swatch(theme) {
          const strokeWidth = paint.strokeWidth ?? spec.strokeWidth ?? theme.style.line.strokeWidth;
          const dash = paint.dash ?? spec.dash;
          const stroke: SeriesSwatch = {
            type: "line",
            stroke: s.color,
            strokeWidth,
            ...(dash !== undefined && { dash }),
            opacity: paint.opacity * (paint.strokeOpacity ?? 1),
          };
          if (!marker) return stroke;
          // The marker as markers draw it: its symbol, outlined where they are.
          const glyph = marker.symbol ?? symbol;
          const r = marker.radius ?? MARKER_RADIUS;
          const outlined = marker.stroke !== undefined || marker.strokeWidth !== undefined;
          const dot: SeriesSwatch = {
            type: "glyph",
            d: markerPath(kit, glyph, 0, 0, r),
            size: 2 * r * symbolReach(glyph),
            fill: marker.fill ?? s.color,
            opacity: paint.opacity * (marker.opacity ?? 1),
            ...(outlined && { stroke: marker.stroke ?? s.color }),
          };
          return { type: "composite", parts: [stroke, dot] };
        },
        geometry(geometry, series, frame) {
          const line = geometry as LineGeometry;
          width = line.strokeWidth;
          if (paint.runs && marks && reduced) {
            // Looks along the series: each run's stretch of line, then markers in their runs' looks.
            const width = line.strokeWidth;
            const looks = paint.runs.looks;
            const stretches = stretchesOf(reduced, line.path, marks, spec.curve);
            const out: Geometry[] = strokeStretches(
              line.path,
              stretches,
              (run) => drawnLook(looks[run]!, width),
              (i) => frame.polyline(series.key, `run${i}`),
            ).map(({ run, path, dashOffset, holes }, i) => {
              const { look, strokeWidth, dash, opacity } = drawnLook(looks[run]!, width);
              const piece: LineGeometry = {
                ...line,
                key: `${line.key}|run${i}`,
                of: line.key,
                stroke: look.color ?? series.color,
                strokeWidth,
                dash,
                ...(dash?.length && { dashOffset }),
                path,
              };
              return holed(styles.translucent(piece, opacity), holes);
            });
            if (marker && count > 0) out.push(...runMarkers(series, width));
            count = 0;
            return out;
          }
          if (paint.strokeWidth !== undefined || paint.dash !== undefined) {
            line.strokeWidth = paint.strokeWidth ?? line.strokeWidth;
            line.dash = kit.dashPattern(paint.dash ?? spec.dash, line.strokeWidth);
          }
          const out: Geometry[] = [
            styles.translucent(line, paint.opacity * (paint.strokeOpacity ?? 1)),
          ];
          if (marker && count > 0) {
            const dots = markers(
              kit,
              series.key,
              kept,
              count,
              marker,
              symbol,
              series.color,
              paint.opacity,
            );
            rowsOf.set(dots, keptRows.subarray(0, count));
            out.push(dots);
          }
          count = 0;
          return out;
        },
      };
      if (marker) features.markerRows = (markers) => rowsOf.get(markers);
      if (paint.runs)
        features.lookAt = (series) => {
          const ends = tracedEnds(s, series, paint.runs!.ends);
          return (k) => {
            const look = styles.look(paint.runs!.looks[runAt(ends, k)]!, paint);
            return {
              color: look.color ?? series.color,
              opacity: (look.opacity ?? 1) * (paint.strokeOpacity ?? 1),
              width: look.strokeWidth ?? width,
            };
          };
        };
      if (marker || topology || marks || labeled)
        features.trace = (series, y, frame, stage, out, start, end, reduce) => {
          // Which observation each point is, where markers or path ends read it.
          const sink = recorder && stage === "line" ? recorder : undefined;
          sink?.start(out, positionBuffer(frame, series.key, stage));
          let step = (a: number, b: number, _run?: number) => reduce(a, b, sink);
          if (marker && stage === "line") {
            // Crossings `where` meets are not observations: they get no markers.
            kept = frame.floats(series.key, "markers", 64);
            keptRows = frame.doubles(series.key, "marker-rows", 32);
            count = 0;
            markerRuns.length = 0;
            step = (a, b, run) => {
              const from = out.count;
              reduce(a, b, sink);
              const added = out.count - from;
              if (run !== undefined) for (let i = 0; i < added; i++) markerRuns.push(run);
              const length = (count + added) * 2;
              if (length > kept.length) {
                const grown = frame.floats(series.key, "markers", length);
                grown.set(kept.subarray(0, count * 2));
                kept = grown;
              }
              if (count + added > keptRows.length) {
                const grown = frame.doubles(series.key, "marker-rows", length);
                grown.set(keptRows.subarray(0, count));
                keptRows = grown;
              }
              for (let i = 0; i < added; i++)
                keptRows[count + i] = tableRow(series, sink!.positions[from + i]!);
              kept.set(out.coords.subarray(from * 2, out.count * 2), count * 2);
              // Lines along y are traced with x and y swapped, and swapped back after.
              if (along === "y")
                for (let i = count * 2; i < length; i += 2)
                  [kept[i], kept[i + 1]] = [kept[i + 1]!, kept[i]!];
              count = length / 2;
            };
          }
          let each: (a: number, b: number) => void = step;
          if (marks) {
            // Each run reduced apart, so its boundaries are points of the path.
            reduced = out;
            marks.reset();
            drawn.clear();
            const ends = tracedEnds(s, series, paint.runs!.ends);
            each = (a, b) => reduceRuns(out, marks, ends, series.length, a, b, step);
          }
          if (topology) topology.trace(series, y, frame, sink ?? out, start, end, each);
          else each(start, end);
          if (!sink) return;
          sink.settle();
          if (topology) endsIn.set(endsKey(series, frame), pathEnds(out, sink, series));
          if (labeled) {
            const { positions } = sink;
            traced = {
              upper: { series, values: y, other: undefined, frame, path: out, positions },
            };
          }
        };
      if (labeled)
        features.takeTrace = () => {
          const taken = traced;
          traced = {};
          return taken;
        };
      if (topology) {
        features.extent = (...args) => topology.extent(...args);
        // Along y, a line leaves out rows whose values a break hides.
        features.across = (series, values, log, breaks) =>
          topology.across(series, values, log, breaks, true);
        features.drawn = (row) => topology.drawn(row);
        features.pathEnds = (series, frame) => endsOf(endsIn, series, frame);
        features.shown = (series) => topology.shown(series);
      }
      s.features = features;
    },
  };
}

/**
 * As `SeriesFeatures.pathEnds`: whether a row ends a path, as `series` was
 * last traced in `frame`'s panel (a highlight's masked copy of it apart).
 */
function endsOf(
  endsIn: ReadonlyMap<string, PathEnds>,
  series: Series,
  frame: Frame,
): ((row: number, way: 1 | -1) => boolean) | undefined {
  const ends = endsIn.get(endsKey(series, frame));
  return ends && ((row, way) => (way === 1 ? ends.last : ends.first).has(row));
}

/** Where a series' path ends are kept: by panel, and by series key, which a masked copy changes. */
function endsKey(series: Series, frame: { readonly panel?: string | undefined }): string {
  return `${frame.panel ?? ""}\u0000${series.key}`;
}

/**
 * The field a line's or area's positions read: its own, or its
 * coordinate's (marks/row-bindings.ts), whichever scale places it.
 */
function positionField(position: unknown): string {
  if (typeof position !== "object") return position as string;
  const coordinate = position as {
    field?: string;
    fraction?: { field: string };
    px?: { field: string };
  };
  return coordinate.field ?? (coordinate.fraction ?? coordinate.px)!.field;
}

/** How marks write values in a pattern format (`{ number }`, `{ time }`). */
function formatOf(
  kit: FeatureKit,
  zone: string,
): (format: FormatSpec, locale: string | undefined, path: string) => (value: number) => string {
  return (format, locale, path) => {
    const pattern = format as { number?: string; time?: string };
    return pattern.time !== undefined
      ? timePattern(kit, pattern.time, zone, locale, `${path}.time`)
      : numberPattern(kit, pattern.number!, locale, `${path}.number`);
  };
}

/** Bars' looks by series and by row, and their labels' pattern formats. */
function barFeatures(
  kit: FeatureKit,
  mark: Mark,
  { scope, path, read, scale, where }: At,
  zone: string,
  locale: string | undefined,
): MarkFeatures & { use(theme: Theme, paint: PaintReader): void } {
  const spec = mark.spec as BarSpec;
  const styles = new RowStyles(
    resolved<BarSpec>(mark),
    mark.table!,
    () => mark.rows!(),
    read,
    path,
    kit.isColor,
  );
  const format = formatOf(kit, zone);
  // A pattern refused is refused now, not when the first label is drawn.
  const labels = typeof spec.labels === "object" ? spec.labels : undefined;
  const pattern = labels?.format as { number?: string; time?: string } | undefined;
  if (pattern?.number !== undefined || pattern?.time !== undefined)
    format(labels!.format!, undefined, `${path} labels.format`);
  // Labels of parts: a field at the bar's row, its series, its value.
  const content =
    labels?.content &&
    writeContent(
      kit,
      labels.content,
      mark.table,
      locale,
      zone,
      (i) => `marks[${where.index}].labels.content[${i}]`,
      { series: true, value: true },
    );
  let theme: Theme | undefined;
  let paintOf: PaintReader;
  return {
    use(t, p) {
      theme = t;
      paintOf = p;
      styles.use(t, p);
    },
    palette: (base) =>
      scaledPalette(
        base,
        scope,
        styles.byRow ? undefined : scale,
        () => theme,
        (key, label, given) => styles.color(sourceOf(key), given, label),
      ),
    attach(s) {
      identify(s, scope, undefined);
      const rows = styles.rows(s, sourceOf(s.key));
      if (!rows) return;
      // A series of bars of one look shows it in legends that draw marks' looks.
      const look = rows.paints.length === 1 ? rows.paints[0] : undefined;
      const stroke = look?.stroke ?? (spec.stroke && paintOf(spec.stroke, `${path} stroke`));
      s.features = {
        rows,
        key: () => styles.key(),
        swatch: look
          ? () => ({
              type: "rect",
              fill: look.fill ?? s.color,
              ...(stroke !== undefined && { stroke }),
              fillOpacity: look.fillOpacity ?? spec.fillOpacity ?? 1,
              opacity: look.opacity ?? spec.opacity ?? 1,
            })
          : undefined,
      };
    },
    format,
    content,
  };
}

/**
 * Annotations' labels in pattern formats, and of parts (`content`): a
 * field of their table's, or a rule's value at its place.
 */
function labelFeatures(
  kit: FeatureKit,
  mark: Mark,
  zone: string,
  path: string,
  where: Where,
  locale: string | undefined,
): MarkFeatures & { use(theme: Theme, paint: PaintReader): void } {
  const format = formatOf(kit, zone);
  const label = (mark.spec as { label?: unknown }).label;
  const own =
    typeof label === "object"
      ? (label as { format?: FormatSpec; content?: LabelContent })
      : undefined;
  const pattern = own?.format;
  // A pattern refused is refused now, not when the first label is drawn; Intl options are the chart's.
  const { number, time } = (pattern ?? {}) as { number?: string; time?: string };
  if (number !== undefined || time !== undefined)
    format(pattern!, undefined, `${path} label.format`);
  if (own) checkContent(own.content, `${path} label.content`);
  const content =
    own?.content &&
    writeContent(
      kit,
      own.content,
      mark.table,
      locale,
      zone,
      (i) => `marks[${where.index}].label.content[${i}]`,
      { series: false, value: mark.spec.type === "rule" },
    );
  return { use() {}, palette: (base) => base, attach() {}, format, content };
}

/**
 * As `SeriesFeatures.pathEnds`, for a layer of a series field's stack: its
 * path stops where its edges have a gap between a row and the layer's next
 * along the stack (its own missing value, or a break or a position without
 * support, which every layer's edges have). Undefined over category bands.
 */
function stackEnds(
  series: Series,
  along: "x" | "y",
): ((row: number, way: 1 | -1) => boolean) | undefined {
  const edges = series.edges;
  if (!edges || series.places?.[along]) return undefined;
  const values = series[along];
  const { x: positions, top } = edges;
  // The layer's rows in order along the stack.
  const order = edges.positionOrder ?? series.rows;
  const count = order ? order.length : series.length;
  const rowAt = (k: number) => (order ? order[k]! : k);
  // The first of `length` places from which `before` is false.
  const search = (length: number, before: (k: number) => boolean) => {
    let lo = 0;
    let hi = length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (before(mid)) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const from = (value: number) => search(positions.length, (e) => positions[e]! < value);
  // Each row's own top, which its entry holds too.
  const tops = along === "x" ? series.y : series.x;
  // The entry of the layer's `k`th row: the entries at its position hold
  // its rows there in turn, and a row with a top is at the next entry with
  // one, past breaks between them.
  const entryOf = (k: number) => {
    const value = values[rowAt(k)]!;
    let first = k;
    while (first > 0 && values[rowAt(first - 1)] === value) first--;
    let e = from(value);
    for (let j = first; ; j++, e++) {
      if (Number.isFinite(tops[rowAt(j)]!))
        while (e < positions.length && Number.isNaN(top[e]!)) e++;
      if (j === k) return e;
    }
  };
  return (row, way) => {
    const value = values[row]!;
    let k = search(count, (j) => values[rowAt(j)]! < value);
    while (k < count && rowAt(k) !== row && values[rowAt(k)] === value) k++;
    if (k >= count || rowAt(k) !== row) return false;
    const next = k + way;
    if (next < 0 || next >= count) return true;
    // Any entry without a top between the two rows' entries breaks the path.
    const end = entryOf(Math.max(k, next));
    for (let e = entryOf(Math.min(k, next)) + 1; e < end; e++)
      if (Number.isNaN(top[e]!)) return true;
    return false;
  };
}

/** Areas' looks by series, and continuity: traced, or for a series field's stack, its breaks. */
function areaFeatures(
  kit: FeatureKit,
  mark: Mark,
  { scope, path, read, scale, where, labeled }: At,
  zone: string,
  log: boolean,
): MarkFeatures & { use(theme: Theme, paint: PaintReader): void } {
  const spec = mark.spec as AreaSpec & { stack?: unknown };
  const table = mark.table!;
  const styles = new SeriesStyles(
    resolved<AreaSpec>(mark),
    table,
    read,
    "fill",
    where,
    kit,
    mark.tooltip as "x" | "y",
    () => mark.rows!(),
    bandAxis(mark),
  );
  const asks = spec.continuity || spec.where !== undefined;
  if (
    spec.continuity &&
    spec.curve === "monotone" &&
    (spec.y1 !== undefined || spec.x1 !== undefined)
  )
    throw new Error(
      `${path} continuity: monotone bands cannot break yet; give a linear or step curve`,
    );
  if (spec.where !== undefined && spec.stack)
    throw new Error(`${path} where: stacked areas cannot leave rows out yet; drop it or the stack`);

  const along = mark.tooltip as "x" | "y";
  const field = positionField(spec[along]);
  const continuity = asks ? new Topology(kit, table, spec, { field, log }, zone, path) : undefined;
  continuity?.check(table.kind(field), typeof spec.continuity?.maxGap === "object", path);
  // A series field's stack (its series given, or its color's field, as the
  // mark resolved it) breaks its layers' edges where their runs do; stacks
  // of fields share rows, so trace their runs as single areas do.
  const unioned =
    spec.stack &&
    spec.y1 === undefined &&
    spec.x1 === undefined &&
    mark.identity?.field !== undefined;
  const topology = unioned ? undefined : continuity;
  let theme: Theme | undefined;
  return {
    continuity: unioned ? continuity : undefined,
    use(t, p) {
      theme = t;
      styles.use(t, p);
    },
    palette: (base) =>
      scaledPalette(
        base,
        scope,
        scale,
        () => theme,
        (key, label, given) => styles.color(sourceOf(key), given, label),
      ),
    attach(s) {
      const paint = styles.paint(s, sourceOf(s.key));
      // A stack's layers share edges, which looks along a layer would have to follow too.
      if (paint.runs && spec.stack)
        throw new kit.ChartError({
          code: "unsupported",
          path: `marks[${where.index}].encode`,
          mark: where.mark,
          message: `${path} encode: the look of series "${s.label}" changes along it, and stacked areas take one look per layer; keep each layer's look, or drop the stack`,
        });
      identify(s, scope, paint.value);
      const banded = spec.y1 !== undefined || spec.x1 !== undefined;
      // With runs: each edge's points as tracing reduced them (before steps), and the run of each.
      const runs = paint.runs;
      const marks = runs && { upper: new RunMarks(runs.looks), lower: new RunMarks(runs.looks) };
      let reduced: { upper: Polyline | undefined; lower: Polyline | undefined } = {
        upper: undefined,
        lower: undefined,
      };
      // With runs: the area as last drawn, whose outline its runs' looks follow.
      let drawn: AreaGeometry | undefined;
      const features: SeriesFeatures = {
        // As areas fill by default (see the guide compiler's samples): stacks nearly opaque.
        swatch: () => ({
          type: "rect",
          fill: s.color,
          opacity:
            (paint.fillOpacity ?? spec.fillOpacity ?? (spec.stack ? 0.85 : banded ? 0.2 : 0.25)) *
            paint.opacity,
        }),
        geometry(geometry, series, frame) {
          const area = geometry as AreaGeometry;
          if (runs && marks) {
            drawn = area;
            return runAreas(styles, area, series, frame, paint, marks, reduced, spec, banded);
          }
          if (paint.stroke !== undefined) area.stroke = paint.stroke;
          if (paint.strokeWidth !== undefined) area.strokeWidth = paint.strokeWidth;
          if (paint.fillOpacity !== undefined) area.fillOpacity = paint.fillOpacity;
          // Opacity is the fill's and the outline's: canvases draw areas at their own alphas.
          area.fillOpacity *= paint.opacity;
          if (paint.opacity !== 1 || paint.strokeOpacity !== undefined)
            area.strokeOpacity = (paint.strokeOpacity ?? 1) * paint.opacity;
          return [area];
        },
      };
      // A layer of a series field's stack stops where the stack's edges break.
      if (unioned && continuity) features.pathEnds = (series) => stackEnds(series, along);
      if (runs)
        features.lookAt = (series) => {
          const ends = tracedEnds(s, series, runs.ends);
          const looks = drawn && areaLooks(styles, drawn, series, paint, spec.stroke);
          return (k) => {
            const run = runAt(ends, k);
            return {
              color: looks?.strokeOf(run) ?? looks?.fill(run) ?? series.color,
              opacity: (paint.strokeOpacity ?? 1) * (looks?.opacity(run) ?? 1),
              width: looks?.width(run) ?? 0,
            };
          };
        };
      if (topology || marks || labeled) {
        // Which observation each point traced is, where `continuity` or
        // labels ask: the rows ending the series' paths, by panel, as last
        // traced there (its upper edge's: both edges' runs end alike), and
        // its edges as last traced, for labels.
        const recorder = topology || labeled ? new Recorder() : undefined;
        const lowerRecorder = labeled ? new Recorder() : undefined;
        const endsIn = new Map<string, PathEnds>();
        let traced: { upper?: TracedEdge; lower?: TracedEdge } = {};
        features.trace = (series, y, frame, stage, out, start, end, reduce) => {
          recorder?.start(out, positionBuffer(frame, series.key, stage));
          const step = (a: number, b: number) => reduce(a, b, recorder);
          let each = step;
          if (marks) {
            reduced = { upper: out, lower: undefined };
            marks.upper.reset();
            const ends = tracedEnds(s, series, runs!.ends);
            each = (a, b) => reduceRuns(out, marks.upper, ends, series.length, a, b, step);
          }
          if (topology) topology.trace(series, y, frame, recorder ?? out, start, end, each);
          else each(start, end);
          if (!recorder) return;
          recorder.settle();
          if (topology) endsIn.set(endsKey(series, frame), pathEnds(out, recorder, series));
          if (labeled) {
            const { positions } = recorder;
            traced = {
              upper: { series, values: y, other: undefined, frame, path: out, positions },
            };
          }
        };
        features.band = (series, top, bottom, frame, upper, lower, start, end, reduce, indexes) => {
          traced = {};
          recorder?.start(upper, positionBuffer(frame, series.key, "upper"));
          lowerRecorder?.start(lower, positionBuffer(frame, series.key, "lower"));
          // Each edge written through its recorder, where it has one.
          const [up, down]: [PointSink, PointSink] = [recorder ?? upper, lowerRecorder ?? lower];
          let each: (edge: Series["y"], a: number, b: number, out: PointSink) => void = reduce;
          if (marks) {
            reduced = { upper, lower };
            marks.upper.reset();
            marks.lower.reset();
            const ends = tracedEnds(s, series, runs!.ends);
            each = (edge, a, b, out) =>
              reduceRuns(
                out === up ? upper : lower,
                out === up ? marks.upper : marks.lower,
                ends,
                series.length,
                a,
                b,
                (from, to) => reduce(edge, from, to, out),
              );
          }
          if (topology) topology.band(series, top, bottom, frame, up, down, start, end, each);
          else if (
            !marks &&
            indexes &&
            indexedBand(series, top, bottom, frame, start, end, indexes)
          ) {
            reduce(top, start, end, up, indexes.top);
            reduce(bottom, start, end, down, indexes.bottom);
          } else bandRuns(series, top, bottom, frame, up, down, start, end, each);
          // A stack's layer drawn through its edges (no series of the mark's)
          // runs through the stack's positions, which name none of its rows.
          if (!recorder || !series.features) return;
          recorder.settle();
          if (topology) endsIn.set(endsKey(series, frame), pathEnds(upper, recorder, series));
          if (labeled) {
            lowerRecorder!.settle();
            const at = { series, frame };
            traced = {
              upper: {
                ...at,
                values: top,
                other: bottom,
                path: upper,
                positions: recorder.positions,
              },
              lower: {
                ...at,
                values: bottom,
                other: top,
                path: lower,
                positions: lowerRecorder!.positions,
              },
            };
          }
        };
        if (topology) features.pathEnds = (series, frame) => endsOf(endsIn, series, frame);
        if (labeled) {
          features.takeTrace = () => {
            const taken = traced;
            traced = {};
            return taken;
          };
          // Layers curved together: both edges' points stand at the same rows.
          features.curved = (series, { upper, lower }, kept, frame) => {
            const positions = positionBuffer(frame, series.key, "upper")(kept.length);
            positions.set(kept);
            const [top, bottom] = [series.y, series.y0];
            const at = { series, frame, positions };
            traced = {
              upper: { ...at, values: top, other: bottom, path: upper },
              ...(bottom && { lower: { ...at, values: bottom, other: top, path: lower } }),
            };
          };
        }
      }
      if (marks)
        features.runs = {
          ends: (series) => tracedEnds(s, series, runs!.ends),
          kept(series, positions) {
            // Layers curved together keep the points of both edges at the same positions.
            const ends = tracedEnds(s, series, runs!.ends);
            marksAt(marks.upper, positions, ends);
            marksAt(marks.lower, positions, ends);
            reduced = { upper: undefined, lower: undefined };
          },
        };
      if (topology) {
        features.extent = (...args) => topology.extent(...args);
        // Along y, an area leaves out rows whose values a break hides; a band keeps them at its seam.
        features.across = (series, values, log, breaks) =>
          topology.across(
            series,
            values,
            log,
            breaks,
            spec.y1 === undefined && spec.x1 === undefined,
          );
        features.drawn = (row) => topology.drawn(row);
        features.shown = (series) => topology.shown(series);
      }
      s.features = features;
    },
  };
}

/**
 * An area whose looks change along its series, drawn in its runs'
 * stretches (run-paths.ts): each run's fill, then each run's outline over
 * them, as an area draws its outline over its fill.
 */
function runAreas(
  styles: SeriesStyles,
  area: AreaGeometry,
  series: Series,
  frame: Frame,
  paint: SeriesPaint,
  marks: { upper: RunMarks; lower: RunMarks },
  reduced: { upper: Polyline | undefined; lower: Polyline | undefined },
  { curve, stroke }: AreaSpec,
  banded: boolean,
): Geometry[] {
  const upper = stretchesOf(reduced.upper ?? area.upper, area.upper, marks.upper, curve);
  // A band's lower edge; an area along y closes at its baseline through one of its own.
  const lower =
    banded && area.lower
      ? stretchesOf(reduced.lower ?? area.lower, area.lower, marks.lower, curve)
      : undefined;
  const { fill, opacity, strokeOf, width } = areaLooks(styles, area, series, paint, stroke);
  const out: Geometry[] = fillPieces(area, upper, lower, (i, edge) =>
    frame.polyline(series.key, `run${i}-${edge}`),
  ).map(({ area: piece, run }) => ({
    ...piece,
    fill: fill(run),
    fillOpacity: (paint.fillOpacity ?? area.fillOpacity) * opacity(run),
  }));
  // Outlines where the area has one, and dots for observations standing
  // alone: areas of no fill, so they end as the area's outline does.
  // Each run's own width decides, which the series' style may give where the area's is 0.
  const outlined = keptStretches(
    upper,
    (st) => width(st.run) > 0 && (st.from === st.to || strokeOf(st.run) !== null),
  );
  if (outlined.length > 0) {
    strokeStretches(
      area.upper,
      outlined,
      (run) => ({ strokeWidth: width(run), dash: undefined }),
      (i) => frame.polyline(series.key, `run${i}-outline`),
    ).forEach(({ run, path, holes }, i) => {
      const piece: AreaGeometry = {
        ...area,
        key: `${area.key}|outline${i}`,
        of: area.key,
        fill: fill(run),
        fillOpacity: 0,
        upper: path,
        lower: null,
        stroke: strokeOf(run),
        strokeWidth: width(run),
        strokeOpacity: (paint.strokeOpacity ?? 1) * opacity(run),
        curve: undefined,
      };
      out.push(holed(piece, holes));
    });
  }
  return out;
}

/**
 * The looks of the runs of an area's series (`area` as the mark draws it,
 * `stroke` its option): each run's look, fill, opacity, and outline, which
 * also paints dots of observations standing alone (null for none).
 */
function areaLooks(
  styles: SeriesStyles,
  area: AreaGeometry,
  series: Series,
  paint: SeriesPaint,
  stroke: string | undefined,
) {
  const { runs } = paint;
  const looks = new Map<number, Look>();
  const lookOf = (run: number) => {
    const index = runs!.looks[run]!;
    const look = looks.get(index) ?? styles.look(index, paint);
    looks.set(index, look);
    return look;
  };
  const fill = (run: number) => lookOf(run).color ?? series.color;
  // An outline the option colors whole; else each run's in its own color.
  // What the series has whatever its rows is in each look already.
  const whole = stroke === undefined ? undefined : area.stroke;
  return {
    lookOf,
    fill,
    opacity: (run: number) => lookOf(run).opacity ?? 1,
    width: (run: number) => lookOf(run).strokeWidth ?? area.strokeWidth,
    strokeOf: (run: number) =>
      lookOf(run).stroke ?? (area.stroke === null ? null : (whole ?? fill(run))),
  };
}

/** A custom mark's channels, which its `draw` reads per row, and the colors they give its series. */
function customFeatures(
  kit: FeatureKit,
  mark: Mark,
  { scope, path, read, scale }: At,
): MarkFeatures & { use(theme: Theme, paint: PaintReader): void } {
  const { encode } = mark.spec as {
    encode?: Pick<EncodingsSpec, "color" | "strokeWidth" | "opacity">;
  };
  const channels = encodedChannels(kit, encode, mark.table!, mark.identity?.field, read, path);
  let theme: Theme | undefined;
  return {
    use(t, p) {
      theme = t;
      channels.use(t, p);
    },
    palette: (base) =>
      scaledPalette(
        base,
        scope,
        scale,
        () => theme,
        (key, label, given) => given ?? channels.seriesColor(sourceOf(key), label),
      ),
    attach: (s) => identify(s, scope, undefined),
    encoded: channels.encoded,
  };
}

/** Points' looks by their channels (points.ts), which every series of the mark shares. */
function pointFeatures(
  kit: FeatureKit,
  mark: Mark,
  { scope, path, read, scale }: At,
): MarkFeatures & { use(theme: Theme, paint: PaintReader): void } {
  const channels = (mark as Mark & { channels: PointChannels }).channels;
  const styles = new PointStyles(
    kit,
    channels,
    mark.table!,
    () => mark.rows!(),
    read,
    path,
    mark.identity?.field,
  );
  let theme: Theme | undefined;
  return {
    use(t, p) {
      theme = t;
      styles.use(t, p);
    },
    // Sizes and shapes the channels give reach as far as the largest.
    get inset() {
      if (!channels.size && !channels.symbol) return undefined;
      const reach = styles.inset();
      return { x: reach, y: reach };
    },
    palette: (base) =>
      scaledPalette(
        base,
        scope,
        scale,
        () => theme,
        (key, label, given) => given ?? styles.seriesColor(sourceOf(key), label),
      ),
    attach(s) {
      identify(s, scope, undefined);
      s.features = { points: styles.looks() };
    },
  };
}

/** Whether a region's outlines draw: of a width above 0, on a side at least (all by default). */
function outlines({
  strokeWidth = 1,
  strokeSides,
}: {
  strokeWidth?: number;
  strokeSides?: readonly string[];
}) {
  return strokeWidth > 0 && strokeSides?.length !== 0;
}

/** A region painted per row whose legend lists it by its label field (see `rowPainted`). */
interface PaintedRows {
  readonly table: Table;
  readonly field: string;
  readonly looks: () => RowLooks | undefined;
  /** Whether its outlines draw (see `outlines`). */
  readonly outlined: boolean;
}

/**
 * A region's legend entries (their keys name the label's value,
 * marks/hidden.ts `rowKey`) in the paint of the first row holding each:
 * its fill as the entry's color, its opacity over the swatch's, and its
 * outline, which makes the swatch an outlined box (1 pixel wide, as
 * legends' outlines are).
 */
function rowPainted(
  entries: LegendEntry[],
  { table, field, looks: of, outlined }: PaintedRows,
): LegendEntry[] {
  const looks = of();
  if (!looks) return entries;
  const first = new Map<string, number>();
  for (let row = table.length - 1; row >= 0; row--)
    first.set(String(table.value(field as never, row)), row);
  return entries.map((entry) => {
    const { equals } = JSON.parse(entry.key) as { equals?: string };
    const row = equals === undefined ? undefined : first.get(equals);
    if (row === undefined) return entry;
    const look = looks.paints[looks.of(row)]!;
    const color = look.fill ?? entry.color;
    const stroke = outlined ? look.stroke : undefined;
    const items = entry.sample?.items.map((item): GuideItem => {
      if (item.type === "rect" && stroke !== undefined) {
        // The box's fill at the swatch's opacity, under the row's own.
        const [w, h] = [item.width, item.height];
        return {
          type: "shape",
          d: `M${-w / 2},${-h / 2}h${w}v${h}h${-w}z`,
          at: [item.x + w / 2, item.y + h / 2],
          fill: color,
          stroke,
          ...(item.opacity !== undefined && { fillOpacity: item.opacity }),
          ...(look.opacity !== undefined && { opacity: look.opacity }),
        };
      }
      if (item.type !== "rect" && item.type !== "shape") return item;
      return {
        ...item,
        fill: color,
        ...(item.type === "shape" && stroke !== undefined && { stroke }),
        ...(look.opacity !== undefined && { opacity: (item.opacity ?? 1) * look.opacity }),
      };
    });
    return { ...entry, color, ...(items && { sample: { ...entry.sample!, items } }) };
  });
}
