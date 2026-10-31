// Labels following the series of lines and areas (marks/attachments.ts):
// `labels` on the mark itself, painted where it paints, and text `from` it,
// painted as the text is. Each scene, the source mark's series record what
// they drew in each panel (`Drawings`); the labels then find their anchors
// on it (attach.ts), write their content (content.ts), take their looks
// (the series' color unless their style gives one), and are placed beside
// their points or outside the plot (layout/attached.ts), whose room the
// chart keeps. Hidden series draw nothing, so their labels are left out;
// labels make no rows.

import { type AttachedLabel, type LabelOwner, placeAttached } from "../../layout/attached.ts";
import type { PanelDrawing } from "../../layout/placer.ts";
import type { FeatureKit, MarkFeatures } from "../../model/features.ts";
import type { AreaGeometry, Geometry, LineGeometry, Rect } from "../../scene/scene.ts";
import type {
  AreaLabelsSpec,
  LabelAt,
  LabelContent,
  LabelLayoutSpec,
  LabelPlaceSpec,
} from "../../spec/encoding.ts";
import type { AreaSpec } from "../../spec/spec.ts";
import type { TextStyle } from "../../spec/style.ts";
import type { Frame, Mark } from "../mark.ts";
import type { Series } from "../series.ts";
import { type Anchor, anchorOf, type DrawnEdge } from "./attach.ts";
import type { ContentWriter } from "./content.ts";

/** What a series drew in a panel: the series, the frame it drew in (its scales), and where labels following it go there. */
interface Drawn {
  readonly series: Series;
  readonly frame: Frame;
  /** By `Drawings.want`'s key: undefined where the series draws nothing there. */
  readonly anchors: ReadonlyMap<string, Anchor | undefined>;
}

/**
 * What a source mark's series drew in each panel of the scene being drawn,
 * and where on them the labels following them go, found as each draws,
 * while its trace's record of which observation each point is holds.
 */
export class Drawings {
  #scene = -1;
  #owner: object | undefined;
  readonly #panels = new Map<Rect, Map<string, Drawn>>();
  readonly #wanted: { key: string; at: LabelAt; edge: "upper" | "lower" }[] = [];

  readonly source: Mark;

  constructor(source: Mark) {
    this.source = source;
  }

  /** Has each series find where a label at `at` on edge `edge` goes; the key it is found under. */
  want(at: LabelAt, edge: "upper" | "lower"): string {
    const key = `${edge}|${at}`;
    if (!this.#wanted.some((w) => w.key === key)) this.#wanted.push({ key, at, edge });
    return key;
  }

  /**
   * Records what `series` drew in `frame`'s panel: `geometry`, its line or
   * area, before style runs cut it. A highlight's parts of a series, drawn
   * after it, are not series of their own.
   */
  record(geometry: Geometry, series: Series, frame: Frame): void {
    // The trace records of the geometry just drawn, taken whether it is
    // labeled or not, so none outlives the geometry it was traced for.
    const traced = series.features?.takeTrace?.() ?? {};
    if (series.whole) return;
    if (frame.scene !== this.#scene || frame.owner !== this.#owner) {
      this.#scene = frame.scene;
      this.#owner = frame.owner;
      this.#panels.clear();
    }
    let drawn = this.#panels.get(frame.plot);
    if (!drawn) {
      drawn = new Map();
      this.#panels.set(frame.plot, drawn);
    }
    if (drawn.has(series.key)) return;
    const { source } = this;
    const spec = source.spec as AreaSpec & { stack?: unknown };
    const area = geometry.kind === "area" ? (geometry as AreaGeometry) : undefined;
    const along = source.tooltip === "y" ? "y" : "x";
    // Read on the source's scales (another axis' for text following a series on it).
    const [top, bottom] = along === "x" ? [series.y, series.y0] : [series.x, series.x0];
    const shift = source.displace && ((row: number) => source.displace!(series, row, frame));
    // How layers draw rows, for edges whose traces are not recorded.
    const layered = !!area && (spec.y1 !== undefined || spec.x1 !== undefined || !!spec.stack);
    const across = frame[along === "x" ? "y" : "x"];
    const zeros =
      area && spec.stack && across.type === "log" ? Math.min(...across.domain) : undefined;
    const anchors = new Map<string, Anchor | undefined>();
    for (const { key, at, edge } of this.#wanted) {
      const path =
        edge === "lower" ? area?.lower : (area?.upper ?? (geometry as LineGeometry).path);
      if (!path) continue;
      const [values, other] = edge === "lower" ? [bottom!, top] : [top, bottom];
      const seams = layered && along === "y";
      const drawnEdge: DrawnEdge = {
        along,
        path,
        curve: spec.curve,
        traced: traced[edge],
        series,
        values,
      };
      anchors.set(key, anchorOf({ ...drawnEdge, other, shift, seams, zeros }, frame, at));
    }
    drawn.set(series.key, { series, frame, anchors });
  }

  /** What the mark's series drew in `frame`'s panel, in this scene. */
  in(frame: Frame): ReadonlyMap<string, Drawn> | undefined {
    return frame.scene === this.#scene && frame.owner === this.#owner
      ? this.#panels.get(frame.plot)
      : undefined;
  }
}

/** Labels following each series of a source mark, as `labels` or text `from` it declares them. */
export interface Following {
  /** The source mark, its index among the chart's marks, and what its series drew. */
  readonly source: Mark;
  readonly index: number;
  readonly drawings: Drawings;
  readonly at: LabelAt;
  /** The edge followed: a line's, an area's value edge, or one of a band's (`lower`, its first field's). */
  readonly edge: "upper" | "lower";
  readonly content: ContentWriter;
  readonly style: TextStyle | undefined;
  /** The halo of the mark the labels are text of, under their style's. */
  readonly halo?: TextStyle["halo"];
  readonly place: LabelPlaceSpec | undefined;
  /** How they keep apart from the panel's other series labels ("move" by default). */
  readonly layout: Omit<LabelLayoutSpec, "overlapGroup"> | undefined;
  /** Names the labels' style in messages: `line "cpu" labels.style`. */
  readonly path: string;
}

/**
 * The labels following each series `following` names in `frame`'s panel,
 * of `owner`, for the panel's placement (`panelLabels`).
 */
export function followingLabels(
  kit: FeatureKit,
  following: Following,
  frame: Frame,
  owner: LabelOwner,
): AttachedLabel[] {
  const drawn = following.drawings.in(frame);
  if (!drawn) return [];
  const { source, at, content, place, layout } = following;
  const along = source.tooltip === "y" ? "y" : "x";
  // Found as the series drew, as `placing` asked.
  const wanted = following.drawings.want(at, following.edge);
  const style = following.style && frame.read(following.style, following.path);
  // Labels before their series' start go before their point; others after it.
  const align = at === "first" || at === "visible-start" ? "end" : "start";
  // Inside, labels are drawn on the plot's fill; outside, on the chart's background.
  const chart = kit.surface(frame.theme);
  const under = place?.outside ? chart : (frame.surface ?? chart);
  const labels: AttachedLabel[] = [];
  for (const { series: s, frame: drawnIn, anchors } of drawn.values()) {
    const anchor = anchors.get(wanted);
    if (!anchor) continue;
    const paint = {
      ...kit.textPaint([frame.theme.roles.text, { color: s.color, align }, style, { halo: false }]),
      // The style's line height, for parts of other sizes.
      lineRatio: style?.lineHeight ?? frame.theme.roles.text.lineHeight,
    };
    const time = drawnIn[along === "x" ? "y" : "x"].type === "time";
    const text = content(anchor.row, s.label, anchor.value, time);
    if (!text) continue;
    labels.push({
      key: `${s.key}|${at}`,
      at: {
        panel: frame.panel ?? "",
        mark: following.index,
        series: s.key,
        row: anchor.row,
        value: anchor.value,
        x: anchor.x,
        y: anchor.y,
        visible: true,
      },
      text,
      parts: content.styled?.(anchor.row, s.label, anchor.value, time, paint, frame),
      paint,
      place: { outside: place?.outside, reserve: place?.reserve, offset: place?.offset },
      halo: kit.textHalo({ ...paint, halo: style?.halo ?? following.halo ?? "auto" }, under),
      overlap: layout?.overlap ?? "move",
      priority: layout?.priority ?? 0,
      owner,
    });
  }
  return labels;
}

/**
 * Labels following series where the feature compiler draws them: gathered
 * per panel for `panelLabels` to place with the panel's others, which
 * keeps the room those outside the plot took.
 */
export function placing(
  kit: FeatureKit,
  following: Following,
  key: string,
): Required<Pick<MarkFeatures, "labels" | "room">> {
  const at = following.path.replace(/\.style$/, "");
  checkLayout(following.layout, at);
  // Each series finds where its label goes as it draws.
  following.drawings.want(following.at, following.edge);
  const leader = following.layout?.leader;
  const look = leader === true ? {} : leader || undefined;
  const owner: LabelOwner = {
    key,
    leader: look && {
      stroke: look.stroke,
      path: `${at}.leader.stroke`,
      strokeWidth: look.strokeWidth ?? 1,
      dash: kit.dashPattern(look.dash, look.strokeWidth ?? 1),
      opacity: look.opacity,
    },
    room: [0, 0],
  };
  return {
    labels: (frame) => {
      // A panel drawing none of its labels keeps no room for them.
      owner.room = [0, 0];
      return followingLabels(kit, following, frame, owner);
    },
    room: () => owner.room,
  };
}

/**
 * Places the series labels of a panel's marks, `drawings`, together
 * (layout/attached.ts), adding each mark's to its geometry; the boxes of
 * the labels drawn.
 */
export function panelLabels(
  kit: FeatureKit,
  drawings: readonly PanelDrawing[],
  of: (mark: Mark) => MarkFeatures | undefined,
): Rect[] {
  let labels: AttachedLabel[] | undefined;
  let frame: Frame | undefined;
  const drawingOf = new Map<LabelOwner, PanelDrawing>();
  for (const drawing of drawings) {
    const own = of(drawing.of)?.labels?.(drawing.frame);
    if (!own) continue;
    frame ??= drawing.frame;
    labels ??= [];
    for (const label of own) {
      labels.push(label);
      drawingOf.set(label.owner, drawing);
    }
  }
  if (!labels || !frame) return [];
  const { geometry, boxes } = placeAttached(labels, frame, kit);
  for (const [owner, parts] of geometry) drawingOf.get(owner)!.geometry.push(...parts);
  return boxes;
}

/**
 * Checks how series labels keep apart (`at` names them in messages): they
 * take `overlap`, `leader`, and `priority`, and no group, since a panel's
 * series labels keep apart across marks already.
 */
function checkLayout(layout: LabelLayoutSpec | undefined, at: string): void {
  if (layout === undefined) return;
  const { leader, priority } = layout;
  const overlap = layout.overlap as string | undefined;
  if (layout.overlapGroup !== undefined)
    throw new Error(
      `${at}.overlapGroup: series labels already keep apart across marks; drop overlapGroup`,
    );
  if (overlap === "stagger" || overlap === "wrap")
    throw new Error(
      `${at}.overlap: "${overlap}" is for tick labels; use "show", "hide", or "move"`,
    );
  if (overlap !== undefined && overlap !== "show" && overlap !== "hide" && overlap !== "move")
    throw new Error(
      `${at}.overlap: expected "show", "hide", or "move"; received ${JSON.stringify(overlap)}`,
    );
  if (leader !== undefined && leader !== false) {
    if (leader !== true && (typeof leader !== "object" || leader === null))
      throw new Error(
        `${at}.leader: expected true, false, or a stroke style such as { stroke: "#999" }`,
      );
    if ((overlap ?? "move") !== "move")
      throw new Error(
        `${at}.leader: labels that ${overlap} stay at their points and draw none; use overlap "move"`,
      );
  }
  if (priority !== undefined && !Number.isFinite(priority))
    throw new Error(`${at}.priority: expected a number; received ${JSON.stringify(priority)}`);
}

/** Has `features`' series record what they draw into `drawings`, for labels following them. */
export function recording(features: MarkFeatures, drawings: Drawings): void {
  const attach = features.attach.bind(features);
  features.attach = (s) => {
    attach(s);
    const own = s.features?.geometry;
    const geometry = (g: Geometry, series: Series, frame: Frame) => {
      drawings.record(g, series, frame);
      return own ? own(g, series, frame) : [g];
    };
    if (s.features) s.features.geometry = geometry;
    else s.features = { geometry };
  };
}

/**
 * The labels `labels` asks for on line or area `mark` (named `path` in
 * messages), checked: at `at`, along the edge `edge` names (a band's), in
 * the place `place` gives.
 */
export function seriesLabels(
  mark: Mark,
  labels: AreaLabelsSpec,
  path: string,
): { edge: "upper" | "lower" } {
  const at = `${path} labels`;
  checkAt(labels.at, `${at}.at`);
  checkContent(labels.content, `${at}.content`);
  checkPlace(labels.place, `${at}.place`);
  if (labels.style !== undefined && (typeof labels.style !== "object" || labels.style === null))
    throw new Error(`${at}.style: expected a text style such as { fontSize: 12 }`);
  return { edge: edgeOf(mark, labels.edge, at) };
}

/**
 * Refuses fields read where labels following `source` stand at no known
 * observation: where the layers of a series field's stack (drawn through
 * the stack's edges) enter or leave the view. `path` names each part of
 * `content`.
 */
export function checkOwners(
  kit: FeatureKit,
  source: Mark,
  at: LabelAt,
  content: LabelContent,
  path: (part: number) => string,
): void {
  if ((at !== "visible-start" && at !== "visible-end") || source.spec.type !== "area") return;
  const spec = source.spec as AreaSpec & { stack?: unknown };
  const edged = !!spec.stack && source.identity?.field !== undefined;
  const field = content.findIndex((part) => typeof part === "object" && part?.field !== undefined);
  if (!edged || field < 0) return;
  const where = path(field);
  throw new kit.ChartError({
    code: "invalid-option",
    path: where,
    message: `${where}: where the view cuts a stack split by a series field, which row stands there is not known, so no field is read; write the series or the value there, or label at "first" or "last"`,
  });
}

/** Checks that a label's `content`, where given, is a list of parts. */
export function checkContent(content: unknown, path: string): void {
  if (content !== undefined && !(Array.isArray(content) && content.length > 0))
    throw new Error(`${path}: expected a list of parts, such as ["Peak: ", { value: true }]`);
}

/** Where along each series labels go. */
const AT = ["first", "last", "visible-start", "visible-end"] as const;

/** Checks where along its series a label goes (`at`, or text's `from.at`). */
export function checkAt(at: unknown, path: string): void {
  if (!(AT as readonly unknown[]).includes(at))
    throw new Error(
      `${path}: expected "first", "last", "visible-start", or "visible-end"; received ${JSON.stringify(at)}`,
    );
}

/** Checks a label's `place` where it follows a series: outside the plot or not, its offset. */
export function checkPlace(place: LabelPlaceSpec | undefined, path: string): void {
  if (place === undefined) return;
  if (typeof place !== "object" || place === null)
    throw new Error(`${path}: expected { outside, reserve, offset }`);
  for (const option of ["attachment", "side"] as const)
    if (place[option] !== undefined)
      throw new Error(
        `${path}.${option}: labels go where they follow their series; drop ${option}`,
      );
  for (const option of ["outside", "reserve"] as const)
    if (place[option] !== undefined && typeof place[option] !== "boolean")
      throw new Error(`${path}.${option}: expected true or false`);
  if (place.offset !== undefined && !Number.isFinite(place.offset))
    throw new Error(`${path}.offset: expected a number of pixels`);
}

/**
 * The edge of `mark`'s series labels follow (`at` names its option in
 * messages): a line's, an area's value edge, or the edge of a band its
 * `edge` names, which a band needs and nothing else takes.
 */
export function edgeOf(mark: Mark, edge: string | undefined, at: string): "upper" | "lower" {
  const spec = mark.spec as { type: string; y1?: unknown; x1?: unknown };
  const band = spec.type === "area" && (spec.y1 !== undefined || spec.x1 !== undefined);
  if (!band) {
    if (edge !== undefined)
      throw new Error(
        `${at}.edge: ${spec.type === "line" ? "a line's labels follow the line" : "an area's labels follow its values' edge"}; drop edge`,
      );
    return "upper";
  }
  const [low, high] = spec.y1 !== undefined ? ["y1", "y2"] : ["x1", "x2"];
  if (edge !== low && edge !== high)
    throw new Error(
      `${at}.edge: a band's labels follow one of its edges; give edge: "${low}" or "${high}"`,
    );
  return edge === low ? "lower" : "upper";
}
