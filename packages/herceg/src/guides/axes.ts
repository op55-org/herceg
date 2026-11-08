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
import type { ChartConfig, PanelPlans } from "../model/model.ts";
import type { ScaleName } from "../model/scales.ts";
import type { ChartStyles } from "../model/styles.ts";
import type { AxisGuide, AxisTick, GuideItem, LabelBox, Rect, TextItem } from "../scene/scene.ts";
import type { Side } from "../spec/place.ts";
import type {
  AxisStyles,
  StrokeStyle,
  TextStyle,
  TickLabelsSpec,
  TickMarkSpec,
} from "../spec/spec.ts";
import type { StrokePaint, TextPaint } from "../style/style.ts";
import type { AxisGuideOptions, ChartAxisOptions, Format, GuideOptions, Ticks } from "./options.ts";
import { type Read, restroke, restyle } from "./paints.ts";
import { countOf, tickPlanner } from "./ticks.ts";

/** The side each scale's automatic axis is on. */
const HOME: Record<ScaleName, Side> = { x: "bottom", y: "left", yRight: "right" };
/** The sides each scale's axes go on, as messages refusing others say. */
const SIDES: Record<ScaleName, string> = {
  x: "an x axis goes on the top or the bottom",
  y: "a y axis goes on the left or the right",
  yRight: "the right y axis is on the right",
};
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
/** The most lines a wrapped label takes. */
const WRAPPED = 3;
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
  /** The least and most its ticks and labels take beside the plot, as `room` says. */
  room: Room | undefined;
  /** In subplots: each panel's own room, by its place in the layout, over `room` (see `roomIn`). */
  rooms?: readonly (Room | undefined)[] | undefined;
}

/** The least and most pixels an axis' ticks and labels take beside the plot. */
type Room = { min: number; max: number };

/** A guide, and where it is set, for messages: in `guides`, or by a short form (`short`). */
interface Listed {
  guide: GuideOptions;
  path: string;
  short?: boolean;
}

/**
 * The axes `config.guides` lists, and those the short forms' `place` and
 * `room` stand for; and the short forms as the model reads them: each
 * scale's settings with those of its listed axis on its default side, or
 * with the automatic axis hidden when the scale's axes are all elsewhere.
 * With tick labels `aligned` at their ticks, which listed axes draw, a
 * scale the guides list no axis of has one on its default side. Undefined
 * when there are no axes to list.
 */
export function listedAxes(
  config: ChartConfig,
  aligned = false,
): { read: Partial<Record<ScaleName, ChartAxisOptions>>; axes: ListedAxis[] } | undefined {
  const right = config.marks.some((mark) => mark.spec.axis === "right");
  const guides: Listed[] = (config.guides ?? []).map((guide, i) => ({
    guide,
    path: `chart guides[${i}]`,
  }));
  const lists = (scale: string) =>
    guides.some(({ guide }) => guide.type === "axis" && guide.scale === scale);
  for (const scale of ["x", "y", "yRight"] as const) {
    const guide = shortGuide(config, scale, guides);
    if (guide) guides.push({ guide, path: `chart ${scale}`, short: true });
  }
  if (aligned)
    for (const scale of ["x", "y", ...(right ? ["yRight" as const] : [])] as const)
      if (!lists(scale)) guides.push({ guide: { type: "axis", scale }, path: `chart ${scale}` });
  if (!guides.some(({ guide }) => guide.type === "axis")) return undefined;
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
    // Subplots' own rooms, by their place in the layout.
    const own = config.panels?.list.map((panel) => ({
      room: panel[scale]?.room,
      path: `chart panels[${config.panels!.declared.indexOf(panel)}].${scale}`,
    }));
    for (const { guide, path: at, short: synthesized } of guides) {
      if (guide.type !== "axis" || guide.scale !== scale) continue;
      const side = guide.place?.side ?? HOME[scale];
      const path = `${at}.place.side`;
      const along =
        scale === "x"
          ? side === "top" || side === "bottom"
          : side === "right" || (scale === "y" && side === "left");
      if (!along) throw new Error(`${path}: ${SIDES[scale]}; received ${JSON.stringify(side)}`);
      // A short form's side is one guide's: the guides listed before it may not take it.
      if (sides.has(side))
        throw new Error(
          synthesized
            ? `${at}.place: guides list ${scale === "x" ? "an x" : "a y"} axis on the ${side} too; give its options in one of them`
            : `${path}: scale ${scale} has an axis on the ${side} already; give this one ${scale === "x" ? (side === "top" ? '"bottom"' : '"top"') : side === "left" ? '"right"' : '"left"'}`,
        );
      if (scale === "y" && side === "right" && right)
        throw new Error(
          `${path}: marks with axis: "right" put yRight's axis on the right; keep y's on the left`,
        );
      sides.add(side);
      first ??= guide;
      if (side === HOME[scale]) home = guide;
      const axis = resolve(guide, scale, side, short, at, own, synthesized);
      axes.push({
        ...axis,
        // Aligned labels are the guides' to draw: the model's automatic axes do not align them.
        plain: axis.plain && !aligned,
        rows,
        columns,
        repeat: guide.repeat ?? short?.repeat,
      });
    }
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
      // Titles of parts are text by now (guides/compile.ts, `titled`); subplots' are text.
      moved.title ??= short?.title as string | undefined;
      const own = config.panels?.list.map((panel) => panel[scale]?.title as string | undefined);
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
  for (const { guide, path } of guides) {
    if (guide.type !== "axis" || builtIn(guide.scale)) continue;
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
  }
  return { read, axes };
}

/**
 * The axis guide a short form's `place` or `room` stands for: with `place`,
 * `axis({ scale, place })`, its side checked as the guides' are; with only
 * a room (its own or a subplot's), the scale's axis on its default side
 * where `guides` list none of the scale, which takes the room as it takes
 * the short form's other settings.
 */
function shortGuide(
  config: ChartConfig,
  scale: ScaleName,
  guides: readonly Listed[],
): AxisGuideOptions | undefined {
  type Placed = { place?: { side: Side }; room?: unknown } | undefined;
  const short = config[scale] as Placed;
  const panels = config.panels?.declared.map((panel) => panel[scale] as Placed) ?? [];
  const placed = panels.findIndex((axis) => axis?.place !== undefined);
  if (placed >= 0)
    throw new Error(
      `chart panels[${placed}].${scale}.place: a panel's axes are on the chart's sides; give place on the chart's ${scale}`,
    );
  if (short?.place !== undefined) {
    if (scale === "yRight") throw new Error(`chart yRight.place: ${SIDES.yRight}; drop place`);
    return { type: "axis", scale, place: short.place };
  }
  const roomed = [short, ...panels].some((axis) => axis?.room !== undefined);
  const listed = guides.some(({ guide }) => guide.type === "axis" && guide.scale === scale);
  return roomed && !listed ? { type: "axis", scale } : undefined;
}

/**
 * `guide`, listed at `path`, resolved against the short form `short`; its
 * room its own or the short form's, and in each subplot the subplot's own
 * (`own`, by its place in the layout). A guide a short form stands for
 * (`synthesized`) has the default tick marks, which its room must hold.
 */
function resolve(
  guide: AxisGuideOptions,
  scale: string,
  side: Side,
  short: ChartAxisOptions | undefined,
  path: string,
  own?: readonly { room: AxisGuideOptions["room"]; path: string }[],
  synthesized = false,
): Omit<ListedAxis, "rows" | "columns" | "repeat"> {
  const home = builtIn(scale) && side === HOME[scale];
  const across = side === "top" || side === "bottom";
  const layers = resolveLayers(
    { ...guide, ticks: guide.ticks ?? short?.ticks, format: guide.format ?? short?.format },
    { across, home, path, name: `${scale} axis`, tick: across ? TICK : 3 },
  );
  // The room holds the ticks outside the plot whole; only labels shorten or go.
  const ticks = outward(layers);
  const roomAt = (given: AxisGuideOptions["room"], at: string) => {
    const room = roomOf(given, at);
    if (room && ticks > room.max)
      throw new Error(
        `${at}.room: its tick marks reach ${ticks} px out from the plot, past the ${room.max} px room; give a room of at least ${ticks} px${synthesized ? "" : ", or shorter or inward tick marks"}`,
      );
    return room;
  };
  const room =
    guide.room !== undefined ? roomAt(guide.room, path) : roomAt(short?.room, `chart ${scale}`);
  const rooms = own?.map(({ room, path }) => roomAt(room, path));
  const roomed = room !== undefined || !!rooms?.some((one) => one !== undefined);
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
    title: home ? undefined : (guide.title as string | undefined),
    line: guide.line ?? across,
    layers,
    // Over the paints the model resolved for the scale's axis in each panel,
    // which take the chart's and subplots' styles already.
    style: home ? undefined : guide.style,
    room,
    ...(rooms?.some((one) => one !== undefined) && { rooms }),
    plain:
      home &&
      guide.tick === undefined &&
      guide.labels === undefined &&
      guide.line === undefined &&
      !roomed &&
      layers.length === 1,
  };
}

/** An axis' `room`, set at `path`: a fixed one, or bounds. */
function roomOf(room: AxisGuideOptions["room"], path: string): Room | undefined {
  if (room === undefined) return undefined;
  const { min = 0, max = Number.POSITIVE_INFINITY } =
    typeof room === "number" ? { min: room, max: room } : (room ?? {});
  // No most where it is left out; pixels where they are given.
  const given = typeof room === "number" ? [room] : [min, room?.max ?? 0];
  if (
    !(typeof room === "number" || (typeof room === "object" && room !== null)) ||
    !(given.every(Number.isFinite) && min >= 0 && max >= min)
  )
    throw new Error(
      `${path}.room: expected finite pixels of at least 0, or { min, max } with min no more than max; received ${typeof room === "object" && room !== null ? `{ min: ${room.min}, max: ${room.max} }` : typeof room === "number" ? room : JSON.stringify(room)}`,
    );
  return { min, max };
}

/** The room `axis` takes in panel `i`: the panel's own, or the axis'. */
function roomIn(axis: ListedAxis, i: number): Room | undefined {
  return axis.rooms?.[i] ?? axis.room;
}

/** `axis` without its rooms, its labels as they are. */
function unroomed(axis: ListedAxis): ListedAxis {
  return axis.room || axis.rooms ? { ...axis, room: undefined, rooms: undefined } : axis;
}

/** `size` held within `room`'s bounds. */
function within(size: number, room: Room | undefined): number {
  return room ? Math.min(Math.max(size, room.min), room.max) : size;
}

/**
 * How labels outside the plot of an axis with a `room`, in `label`, are
 * shortened to fit it as painted (boxes, and outlines or halos past them,
 * too): with an ellipsis, line by line, lines where not even the ellipsis
 * fits left out, and a label none of whose lines fit left out whole.
 * Undefined where the room leaves them as they are.
 */
function roomFit(
  kit: GuideKit,
  axis: { layers: readonly Layer[]; across: boolean; room?: Room | undefined },
  labels: TickLabelsSpec,
  label: TextPaint,
  measure: MeasureText,
): ((text: string) => string) | undefined {
  const { room } = axis;
  // Rows of labels along x are left out whole instead (see `rowsKept`).
  if (!room || labels.inside || axis.across) return undefined;
  const { css, background, padding } = label;
  const [, right, , left] = background ? padding : [0, 0, 0, 0];
  // Past the box's far side: half its outline, or the halo beyond its padding.
  const outline = background?.stroke ? (background.strokeWidth ?? 1) / 2 : 0;
  const halo = (kit.textHalo(label, "")?.width ?? 0) / 2 - Math.min(left, right);
  const width =
    room.max -
    firstRow(labels, Y_GAP, false, axis.layers) -
    left -
    right -
    Math.max(0, outline, halo);
  return (text) => {
    const lines = text.split("\n").map((line) => {
      const shown = kit.fitText(line, width, measure, css);
      return measure(shown, css) <= width ? shown : "";
    });
    return lines.some((line) => line) ? lines.join("\n") : "";
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
        spec?.overlap === "stagger" ||
        spec?.overlap === "wrap")
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
    if (spec?.overlap === "wrap" && spec.rotation !== undefined)
      throw new Error(
        `${where}.overlap: "wrap" breaks labels that lie flat; drop rotation, or keep turned labels apart with "hide" or "stagger"`,
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
  // labels outside the plot gives back what the model keeps for them. Each
  // panel's is kept apart, as a room of its own holds it to its bounds.
  let kept = { width: Number.NaN, top: [] as number[], bottom: [] as number[] };
  let reserved = { top: [] as number[], bottom: [] as number[] };
  /**
   * What each panel's x axes take below its plot, beyond what the model
   * keeps for them (`xRoom`), and above it, as their layers are placed
   * over `planOf`'s plans; and where a room of the panel's own holds them.
   */
  const depths = (
    state: AxesState,
    planOf: (axis: ListedAxis, i: number) => AxisPlan | undefined,
  ) => {
    const count = state.labeled.x.length;
    const below = Array<number>(count).fill(Number.NEGATIVE_INFINITY);
    const above = Array<number>(count).fill(0);
    const ownBelow = Array<boolean>(count).fill(false);
    const ownAbove = Array<boolean>(count).fill(false);
    // Whether the layers kept write labels: a room leaves rows out.
    const writing = Array<boolean>(count).fill(false);
    const home = changed("x");
    if (home)
      state.labeled.x.forEach((shows, i) => {
        if (!shows) return;
        const layers = placedLayers(kit, home, state, i, planOf(home, i));
        const extra = extraDepth(kit, home, state, layers);
        const room = roomIn(home, i);
        below[i] = room ? within(state.xRoom + extra, room) - state.xRoom : extra;
        ownBelow[i] = !!room;
        writing[i] = layers.some(({ layer }) => layer.labels);
      });
    for (const axis of elsewhere)
      if (axis.side === "top")
        for (let i = 0; i < count; i++)
          if (drawsIn(axis, state, i)) {
            const layers = placedLayers(kit, axis, state, i, planOf(axis, i));
            above[i] = Math.max(above[i]!, depthOf(kit, axis, state, i, layers));
            ownAbove[i] ||= !!roomIn(axis, i);
            writing[i] ||= layers.some(({ layer }) => layer.labels);
          }
    return { below, above, ownBelow, ownAbove, writing };
  };
  // How far each panel's y labels reach is found before y is planned, from
  // a line of each layer's labels; where the labels planned reach further
  // (several lines), it grows for scenes of this size, and the model lays
  // the scene out again.
  let reaching = { size: "", reach: [] as number[] };
  let reached: readonly number[] = [];
  /**
   * Calls `each` with each listed axis panel `index` draws (those on their
   * scale's default side, then those elsewhere) and its plan in `plans`.
   */
  const placings = (
    state: AxesState,
    index: number,
    plot: Rect,
    plans: PanelPlans,
    each: (axis: ListedAxis, plan: AxisPlan | undefined) => void,
  ) => {
    for (const scale of ["x", "y", "yRight"] as const) {
      const axis = changed(scale);
      if (axis) each(axis, plans[scale]);
    }
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
      if (plan && drawsIn(axis, state, index)) each(axis, plan);
    }
  };
  /** Panel `index`'s axes (see `CompiledAxes.panel`), leaving out rows of labels from `cuts` on. */
  const panelAxes = (
    axes: readonly AxisGuide[],
    state: AxesState,
    index: number,
    plot: Rect,
    plans: PanelPlans,
    cuts?: ReadonlyMap<ListedAxis, number>,
  ): AxisGuide[] => {
    const out = axes.map((guide) => {
      const axis = changed(guide.scale);
      // Axes on their scale's default side are of x, y, and yRight.
      const plan = axis && plans[axis.scale as ScaleName];
      return axis
        ? rebuild(
            kit,
            guide,
            axis,
            placedLayers(kit, axis, state, index, plan, cuts?.get(axis)),
            state,
            index,
            plan?.scale.categories,
          )
        : guide;
    });
    placings(state, index, plot, plans, (axis, plan) => {
      if (axis.home) return;
      out.push(
        beyond(
          kit,
          axis,
          placedLayers(kit, axis, state, index, plan, cuts?.get(axis)),
          state,
          index,
          plot,
          plan!.scale.categories,
        ),
      );
    });
    return out;
  };
  return {
    across(state) {
      if (kept.width !== state.width) kept = { width: state.width, top: [], bottom: [] };
      const home = changed("x");
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
        for (let i = 0; i < over.length; i++) if (drawsIn(axis, state, i)) over[i] = true;
      }
      const taken = depths(state, (axis, i) => provisional(state, axis, i));
      // Panels writing x labels, in the rows their rooms keep.
      const labels = state.labeled.x.map((shows, i) => (shows && !home) || taken.writing[i]!);
      const below = settled(taken.below, taken.ownBelow, kept.bottom);
      const above = settled(taken.above, taken.ownAbove, kept.top);
      reserved = { top: above.each, bottom: below.each };
      const size = `${state.width}x${state.height}`;
      if (reaching.size !== size) reaching = { size, reach: [] };
      const reach = over.map((_, i) => {
        let most = reaching.reach[i] ?? 0;
        const of = (label: TextPaint, align?: Align) => {
          most = Math.max(most, blockReach(kit, label, "", align));
        };
        const layers = (axis: ListedAxis) => {
          for (const placed of placedLayers(kit, axis, state, i, undefined))
            if (placed.layer.labels) of(placed.label, placed.align);
        };
        for (const scale of ["y", "yRight"] as const) {
          if (!state.labeled[scale][i]) continue;
          const home = changed(scale);
          if (home) layers(home);
          else of(state.styles.axisText("tickLabel", scale, i));
        }
        for (const axis of elsewhere)
          if (axis.side === "right" && drawsIn(axis, state, i)) layers(axis);
        return most;
      });
      reached = reach;
      return {
        top: above.most,
        bottom: below.most,
        tops: above.each,
        bottoms: below.each,
        over,
        labels,
        reach,
      };
    },
    tickLabels(scale, i, styles) {
      const home = changed(scale);
      if (!home) return undefined;
      const base = baseLabel(kit, home, styles, i);
      return home.layers
        .filter((layer) => layer.labels)
        .map((layer) =>
          restyle(kit, styles.read, base, layer.style?.tickLabel, `${layer.path}.style.tickLabel`),
        );
    },
    beside(state) {
      let left = 0;
      let right = 0;
      // A panel whose room is its own takes it, beside the model's room for its labels.
      const own = { y: [] as number[], right: [] as number[] };
      for (const scale of ["y", "yRight"] as const) {
        const home = changed(scale);
        if (!home) continue;
        // What its ticks and labels outside the plot take, over the room
        // the model keeps for its labels (as wide as the major layer's):
        // the most of the panels without a room, or of all where every
        // panel has one.
        const needs = { free: [] as number[], all: [] as number[] };
        const keeps = { free: [] as number[], all: [] as number[] };
        state.labeled[scale].forEach((shows, i) => {
          if (!shows) return;
          // Its labels as they are, before the room shortens them: what
          // the room holds within its bounds.
          const whole = placedLayers(kit, unroomed(home), state, i, state.plan(scale, i, 0));
          const room = roomIn(home, i);
          const takes = within(outsideBreadth(kit, whole, state.measure), room);
          const keep = Math.ceil(widest(kit, [whole[0]!], state.measure)) + Y_GAP;
          needs.all.push(takes);
          keeps.all.push(keep);
          if (room) own[scale === "y" ? "y" : "right"][i] = takes - keep;
          else {
            needs.free.push(takes);
            keeps.free.push(keep);
          }
        });
        const of = needs.free.length ? "free" : "all";
        const extra = needs.all.length
          ? mostOf(needs[of]) - mostOf(keeps[of])
          : outward(home.layers);
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
        const takes = { free: [] as number[], all: [] as number[] };
        state.drawsY.forEach((_, i) => {
          if (!drawsIn(axis, state, i)) return;
          after[i] = true;
          const breadthIn = breadth(kit, axis, state, i);
          takes.all.push(breadthIn);
          if (roomIn(axis, i)) own.right[i] = breadthIn;
          else takes.free.push(breadthIn);
        });
        right = Math.max(right, mostOf(takes.free.length ? takes.free : takes.all));
      }
      return {
        left,
        right,
        lefts: state.drawsY.map((_, i) => own.y[i] ?? left),
        rights: state.drawsY.map((_, i) => own.right[i] ?? right),
        after,
      };
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
      // Layers without labels have their ticks' labels planned, not written.
      const addAll = (axis: ListedAxis, placed: readonly Placed[]) => {
        for (const { layer, ticks, label, angle, align } of placed)
          if (layer.labels)
            for (const tick of ticks) add(tick, label, angle, runOf(axis, layer), align);
      };
      const home = changed("x");
      if (state.labeled.x[i]) {
        if (home) addAll(home, placedLayers(kit, home, state, i, plan));
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
          addAll(axis, placedLayers(kit, axis, state, i, over(state, axis, i, plan)));
      return lo > hi ? undefined : [lo, hi];
    },
    fits(state, planOf) {
      const taken = depths(state, (axis, i) => over(state, axis, i, planOf(i)));
      // The y labels as planned, every line of them: how far each block
      // reaches from its tick, and its room to the plot's end it reaches toward.
      const blocks = state.labeled.x.map((_, i) => {
        const out: LabelReach[] = [];
        const add = (axis: ListedAxis, plan: AxisPlan | undefined) => {
          if (!plan) return;
          const [lo, hi] = [...plan.scale.range].sort((a, b) => a - b);
          for (const { layer, ticks, label, align } of placedLayers(kit, axis, state, i, plan))
            if (layer.labels)
              for (const { label: text, position } of ticks) {
                if (!text) continue;
                const room =
                  align === "start"
                    ? hi! - position
                    : align === "end"
                      ? position - lo!
                      : Math.min(hi! - position, position - lo!);
                out.push({
                  reach: blockReach(kit, label, text, align),
                  room,
                  share: room / (hi! - lo! || 1),
                });
              }
        };
        for (const scale of ["y", "yRight"] as const) {
          const home = changed(scale);
          if (home && state.labeled[scale][i]) add(home, state.plan(scale, i, 0));
        }
        for (const axis of elsewhere)
          if (axis.side === "right" && drawsIn(axis, state, i))
            add(axis, state.plan(axis.scale, i, 0));
        return out;
      });
      // Where a label reaches past the reach given, the scene is laid out
      // again with what every panel's labels need then. Rows give up at
      // most twice the reach added for each row past the first (weights
      // may put all of it on one).
      const reaches = blocks.every((list, i) =>
        list.every(({ reach, room }) => reach - room <= (reached[i] ?? 0) + 0.5),
      );
      if (!reaches) {
        const shrink = 2 * (Math.ceil(blocks.length / state.columns) - 1);
        blocks.forEach((list, i) => {
          const given = reached[i] ?? 0;
          const need = reachKept(list, given, shrink);
          if (need > given + 0.5) reaching.reach[i] = Math.max(reaching.reach[i] ?? 0, need);
        });
      }
      const deeper = (depths: readonly number[], given: readonly number[]) =>
        depths.some((depth, i) => depth > (given[i] ?? 0) + 0.5);
      if (reaches && !deeper(taken.above, reserved.top) && !deeper(taken.below, reserved.bottom))
        return true;
      const grown = (depths: readonly number[], before: readonly number[]) =>
        depths.map((depth, i) => Math.max(before[i] ?? Number.NEGATIVE_INFINITY, Math.ceil(depth)));
      kept = {
        width: kept.width,
        top: grown(taken.above, kept.top),
        bottom: grown(taken.below, kept.bottom),
      };
      return false;
    },
    panel(axes, state, index, plot, plans) {
      return panelAxes(axes, state, index, plot, plans);
    },
    moving(axes, state, index, plot, plans) {
      // The rows of labels the scene's rooms leave out stay out in frames
      // between, where labels of values between may be shorter: found
      // when a transition first asks for a frame.
      let cuts: Map<ListedAxis, number> | undefined;
      const cutsOf = () => {
        const found = new Map<ListedAxis, number>();
        placings(state, index, plot, plans, (axis, plan) => {
          if (!axis.across || !roomIn(axis, index)) return;
          const cut = cutRow(axis, placedLayers(kit, axis, state, index, plan));
          if (cut !== undefined) found.set(axis, cut);
        });
        return found;
      };
      return {
        defaults: axes,
        at: (defaults, frame) => {
          cuts ??= cutsOf();
          return panelAxes(
            defaults,
            {
              ...state,
              plan: (scale, k, pixels, start) =>
                k === index && (scale === "y" || scale === "yRight")
                  ? frame[scale]
                  : state.plan(scale, k, pixels, start),
            },
            index,
            plot,
            { ...frame, own: plans.own },
            cuts,
          );
        },
      };
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

/**
 * Each panel's depth of axes, at least what earlier scenes kept for it
 * (`floor`): its own where a room holds it (`own`), else the most any
 * panel without a room takes, which they all keep; and the most of all.
 * Depths of panels drawing none (less than any) are none.
 */
function settled(
  depths: readonly number[],
  own: readonly boolean[],
  floor: readonly number[],
): { most: number; each: number[] } {
  const each = depths.map((depth, i) => Math.max(depth, floor[i] ?? Number.NEGATIVE_INFINITY));
  const free = mostOf(each.filter((_, i) => !own[i]));
  const none = (depth: number) => (Number.isFinite(depth) ? depth : 0);
  return { most: none(mostOf(each)), each: each.map((depth, i) => none(own[i] ? depth : free)) };
}

/** The most of `values`, less than any where there are none. */
function mostOf(values: readonly number[]): number {
  return Math.max(Number.NEGATIVE_INFINITY, ...values);
}

/** A y label's block: how far it reaches from its tick, its room to the plot's end it reaches toward, and that room as a share of the plot's length. */
interface LabelReach {
  reach: number;
  room: number;
  share: number;
}

/**
 * The least reach past a plot's ends that keeps `blocks` within it once
 * the scene is laid out with it: the plots then give up at most `shrink`
 * px of length for each px of reach past `given`, each block's room its
 * share of that. A block whose room would shrink as fast as the reach grows
 * takes its whole reach where it would reach past the rest's.
 */
function reachKept(blocks: readonly LabelReach[], given: number, shrink: number): number {
  let kept = given;
  const fast: LabelReach[] = [];
  for (const block of blocks) {
    const { reach, room, share } = block;
    // The least r with reach - (room - share * shrink * (r - given)) <= r.
    if (share * shrink < 1)
      kept = Math.max(
        kept,
        Math.min(reach, (reach - room - share * shrink * given) / (1 - share * shrink)),
      );
    else fast.push(block);
  }
  for (let grown = true; grown; ) {
    grown = false;
    for (const { reach, room, share } of fast)
      if (reach > kept && reach - room + share * shrink * (kept - given) > kept + 0.5) {
        kept = reach;
        grown = true;
      }
  }
  return kept;
}

/**
 * How far a block of `text` (a line where none is given) in `paint`
 * reaches up or down past its tick: half its box, or its lines (the last
 * as tall as its size), all of it where its end is at the tick (`align`),
 * and its box's outline or a halo past the box's top and bottom padding
 * (as `labelReach` in model/panel-layout.ts for a centered line).
 */
function blockReach(kit: GuideKit, paint: TextPaint, text = "", align?: Align): number {
  const lines = text.split("\n").length;
  const height = paint.background
    ? kit.textHeight(paint, text)
    : (lines - 1) * paint.lineHeight + paint.size;
  return Math.ceil((align === "start" || align === "end" ? height : height / 2) + past(kit, paint));
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

/** Panel `i`'s layers of `axis` over `plan`: each one's ticks and labels, as its overlap policy keeps them. */
function placedLayers(
  kit: GuideKit,
  axis: ListedAxis,
  state: AxesState,
  i: number,
  plan: AxisPlan | undefined,
  cut?: number,
): Placed[] {
  const { styles } = state;
  const base = {
    label: baseLabel(kit, axis, styles, i),
    tick: restroke(
      kit,
      styles.read,
      styles.axisStroke("tick", axis.scale, i),
      axis.style?.tick,
      `${axis.path}.style.tick`,
    ),
  };
  const span = state.cells?.within(i) ?? [0, state.height];
  // A panel's own room, and below the plots, the gap the model draws labels at.
  const room = roomIn(axis, i);
  const gap = axis.home && axis.across ? state.xGap(i) : undefined;
  const roomed = room === axis.room && cut === undefined ? axis : { ...axis, room, cut };
  return layered(kit, roomed, base, styles.read, state.measure, plan, span, gap);
}

/** The first row of labels outside the plot that `placed`, `axis`' layers laid out, leaves out. */
function cutRow(axis: ListedAxis, placed: readonly Placed[]): number | undefined {
  let cut: number | undefined;
  for (const { layer } of placed) {
    const labels = axis.layers.find(({ id }) => id === layer.id)?.labels;
    if (labels && !labels.inside && !layer.labels) cut = Math.min(cut ?? labels.row, labels.row);
  }
  return cut;
}

/** How `axis` writes panel `i`'s tick labels, before its layers' own styles. */
function baseLabel(kit: GuideKit, axis: ListedAxis, styles: ChartStyles, i: number): TextPaint {
  return restyle(
    kit,
    styles.read,
    styles.axisText("tickLabel", axis.scale, i),
    axis.style?.tickLabel,
    `${axis.path}.style.tickLabel`,
  );
}

/**
 * The layers of an axis (or a colorbar's) over `plan`, their labels and
 * tick marks drawn with `base`'s paints under their own styles. Along x, a
 * room holds rows of labels outside the plot from the line outward: angles
 * needing more depth than a row has left are not tried, wrapped labels keep
 * the lines that fit, and rows that do not fit are left out whole.
 */
export function layered(
  kit: GuideKit,
  axis: {
    layers: readonly Layer[];
    scale: string;
    across: boolean;
    above: boolean;
    room?: Room | undefined;
    /** The first row of labels outside the plot to leave out, whatever fits. */
    cut?: number | undefined;
  },
  base: { label: TextPaint; tick: StrokePaint },
  read: Read,
  measure: MeasureText,
  plan: AxisPlan | undefined,
  /**
   * The span down labels along y stay inside (the chart, or an inset's
   * box); undefined to leave them at their ticks.
   */
  within: readonly [number, number] | undefined,
  /**
   * Along x, pixels from the line to the labels as they are drawn (the
   * model's, below the plots); by default the default axes', for their size.
   */
  labelGap?: number,
): Placed[] {
  // Labels stand off the line as default axes place them, by the gap for their size.
  const gap = axis.across ? kit.tickLabelGap(base.label.size) : Y_GAP;
  /** `layer` placed, its labels outside the plot within `room` px of where its row starts. */
  const place = (layer: Layer, room: number): Placed => {
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
        categories && labels && (labels.rotation !== undefined || labels.overlap !== undefined);
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
      // Shortened to a y axis' room first: what is left out hides and reaches nothing.
      const fit = roomFit(kit, axis, labels, label, measure);
      if (fit) ticks = ticks.map((t) => ({ ...t, label: fit(t.label) }));
      // Labels that may turn are written on one line.
      if (labels.rotation !== undefined)
        ticks = ticks.map((t) =>
          t.label.includes("\n") ? { ...t, label: t.label.replaceAll("\n", " ") } : t,
        );
      // Flat labels stand at their ticks as their style aligns them: inside
      // the plot centered by default, outside it where the style says.
      const aligned = (axis.across ? label.align : label.verticalAlign) !== undefined;
      const flat = labels.inside || aligned ? alignAt(axis.across, label) : undefined;
      if (labels.overlap === "stagger") lanes = 2;
      // The depth the room leaves these labels as painted, past their boxes too.
      const depth = room - past(kit, label);
      const fits =
        room < Number.POSITIVE_INFINITY
          ? (turn: number) =>
              rowDepth(kit, { ticks, angle: turn, label, lanes }, measure) +
                past(kit, label, turn) <=
              room + 0.5
          : undefined;
      const turned = angleOf(labels, ticks, label, measure, run, flat, fits);
      angle = turned.angle;
      if (!angle) align = flat;
      // Labels the room keeps from turning further are kept apart as "hide" keeps them.
      const overlap = turned.thin && !labels.overlap ? "hide" : (labels.overlap ?? "show");
      if (overlap === "wrap")
        ticks = wrapped(kit, ticks, label, measure, fits && linesWithin(kit, label, depth));
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
      if (overlap === "hide" || overlap === "stagger") {
        const drawnAt = labelAt;
        const shown = drawnAt ? ticks.map((t, k) => ({ ...t, position: drawnAt[k]! })) : ticks;
        const result = kept(shown, label, measure, angle, lanes, run, align);
        ticks = ticks.map((t, k) => ({ ...t, label: result.ticks[k]!.label }));
        lane = result.lane;
      }
    }
    return { layer, ticks, angle, lanes, lane, at: labelAt, align, label, tick };
  };
  const room = axis.across ? axis.room : undefined;
  const from = labelGap ?? gap;
  const placed = room
    ? rowsWithin(kit, axis.layers, room.max, from, measure, place)
    : axis.layers.map((layer) => place(layer, Number.POSITIVE_INFINITY));
  const ranked = prioritized(kit, placed, measure, axis, gap);
  return room ? rowsKept(kit, ranked, room.max, from, measure, axis.cut) : ranked;
}

/**
 * `layers` placed by `place` in the order of their rows of labels outside
 * the plot, from the line outward: each given the pixels from where its
 * row starts, past the rows before it as placed, to `most` px from the line.
 */
function rowsWithin(
  kit: GuideKit,
  layers: readonly Layer[],
  most: number,
  gap: number,
  measure: MeasureText,
  place: (layer: Layer, room: number) => Placed,
): Placed[] {
  const out: Placed[] = [];
  const rows: number[] = [];
  const rowOf = ({ labels }: Layer) => (labels && !labels.inside ? labels.row : -1);
  const order = layers.map((_, k) => k).sort((a, b) => rowOf(layers[a]!) - rowOf(layers[b]!));
  for (const k of order) {
    const layer = layers[k]!;
    const row = rowOf(layer);
    if (row < 0) {
      out[k] = place(layer, Number.POSITIVE_INFINITY);
      continue;
    }
    let away = firstRow(layer.labels as TickLabelsSpec, gap, true, layers);
    for (let r = 0; r < row; r++) away += (rows[r] ?? 0) + ROW_GAP;
    const placed = place(layer, most - away);
    out[k] = placed;
    rows[row] = Math.max(rows[row] ?? 0, rowDepth(kit, placed, measure));
  }
  return out;
}

/**
 * `placed` with its rows of labels outside the plot kept from the line
 * outward while they end, as painted, within `most` px of it: the first
 * row reaching past, and every row beyond it, are left out whole, every
 * layer and lane in them (their labels, not their tick marks). Labels
 * inside the plot stay.
 */
function rowsKept(
  kit: GuideKit,
  placed: readonly Placed[],
  most: number,
  gap: number,
  measure: MeasureText,
  from = Number.POSITIVE_INFINITY,
): Placed[] {
  const layers = placed.map(({ layer }) => layer);
  const rows = rowDepths(kit, placed, measure);
  let cut = from;
  for (const { layer, label, angle } of placed) {
    const { labels } = layer;
    if (!labels || labels.inside) continue;
    let end = firstRow(labels, gap, true, layers);
    for (let r = 0; r < labels.row; r++) end += (rows[r] ?? 0) + ROW_GAP;
    end += (rows[labels.row] ?? 0) + past(kit, label, angle);
    if (end > most + 0.5) cut = Math.min(cut, labels.row);
  }
  if (cut === Number.POSITIVE_INFINITY) return placed as Placed[];
  return placed.map((one) => {
    const { labels } = one.layer;
    if (!labels || labels.inside || labels.row < cut) return one;
    return {
      ...one,
      layer: { ...one.layer, labels: false },
      ticks: one.ticks.map((tick) => ({ ...tick, label: "" })),
      lane: [],
    };
  });
}

/**
 * How many lines of wrapped labels in `paint` fit `depth` px, or all they
 * have where none fits (their row is then left out whole).
 */
function linesWithin(kit: GuideKit, paint: TextPaint, depth: number): number {
  const lines = Math.floor((depth - kit.textHeight(paint)) / paint.lineHeight) + 1;
  return lines >= 1 ? lines : Number.POSITIVE_INFINITY;
}

/**
 * How far what is painted of a label, turned `angle` degrees, reaches
 * past its box's top and bottom: its outline, which widens the box on
 * every side (its corners further when turned), or its halo, which
 * reaches as far every way past the text, less the box's padding as
 * turned.
 */
function past(kit: GuideKit, paint: TextPaint, angle = 0): number {
  const box = paint.background;
  const [top, right, bottom, left] = box ? paint.padding : [0, 0, 0, 0];
  const { cos, sin } = turned(angle);
  return Math.max(
    0,
    box?.stroke ? ((box.strokeWidth ?? 1) / 2) * (cos + sin) : 0,
    (kit.textHalo(paint, "")?.width ?? 0) / 2 -
      (Math.min(top, bottom) * cos + Math.min(left, right) * sin),
  );
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

/**
 * The angle labels are drawn at: their rotation, or the first candidate at
 * which neighbors do not overlap. Where a room leaves too little depth for
 * some candidates (`fits`), they are not tried: with none of the others
 * keeping labels apart, the last of them, and the labels are to be kept
 * apart as "hide" keeps them (`thin`).
 */
function angleOf(
  labels: TickLabelsSpec,
  ticks: readonly AxisTick[],
  paint: TextPaint,
  measure: MeasureText,
  run: Run,
  flat?: Align,
  fits?: (angle: number) => boolean,
): { angle: number; thin: boolean } {
  const rotation = labels.rotation;
  if (typeof rotation !== "object") return { angle: rotation ?? 0, thin: false };
  const candidates = fits ? rotation.candidates.filter(fits) : rotation.candidates;
  // With no candidate the room has depth for, flat labels thinned where
  // they fit, else the row is left out (see `rowsKept`).
  if (candidates.length === 0)
    return fits!(0)
      ? { angle: 0, thin: true }
      : { angle: rotation.candidates.at(-1)!, thin: false };
  // Neighbors are the labels drawn: blank ticks between them keep no room.
  const shown = ticks.filter((tick) => tick.label);
  for (const angle of candidates) {
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
    if (fits) return { angle, thin: false };
  }
  return { angle: candidates.at(-1)!, thin: candidates.length < rotation.candidates.length };
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

/**
 * Labels broken at spaces into lines that fit between their neighbors,
 * each of their own lines into three at most. Where an axis' room holds
 * fewer (`most`), a label keeps that many, the last ending with an
 * ellipsis to say it is cut short; one whose ellipsis does not fit is
 * left out.
 */
function wrapped(
  kit: GuideKit,
  ticks: AxisTick[],
  paint: TextPaint,
  measure: MeasureText,
  most?: number,
): AxisTick[] {
  const { css } = paint;
  return ticks.map((tick, k) => {
    const near = [ticks[k - 1], ticks[k + 1]].filter((other) => other !== undefined);
    const room = Math.min(...near.map((other) => Math.abs(other.position - tick.position))) - PAD;
    const lines: string[] = [];
    for (const line of tick.label.split("\n")) {
      const from = lines.length;
      const words = room > 0 && measure(line, css) > room ? line.split(" ") : [line];
      for (const word of words) {
        const last = lines.length > from ? lines.at(-1) : undefined;
        if (
          last !== undefined &&
          (lines.length - from >= WRAPPED || measure(`${last} ${word}`, css) <= room)
        )
          lines[lines.length - 1] = `${last} ${word}`;
        else lines.push(word);
      }
    }
    if (most !== undefined && lines.length > most) {
      lines.length = most;
      const width = room > 0 ? room : Number.POSITIVE_INFINITY;
      const last = kit.fitText(`${lines[most - 1]}…`, width, measure, css);
      if (measure(last, css) > width) return { ...tick, label: "" };
      lines[most - 1] = last;
    }
    const label = lines.join("\n");
    return label === tick.label ? tick : { ...tick, label };
  });
}

/** How a row of labels' depth is measured: a layer's ticks, turn, paint, and lanes. */
type RowLabels = Pick<Placed, "ticks" | "angle" | "label" | "lanes">;

/** How deep a layer's row of labels is: its lanes, each as deep as its deepest label. */
function rowDepth(kit: GuideKit, placed: RowLabels, measure: MeasureText): number {
  return laneDepth(kit, placed, measure) * placed.lanes + (placed.lanes - 1) * ROW_GAP;
}

/** How tall a layer's row of labels is: a line (or a wrapped label's lines), or turned labels' extent. */
function laneDepth(kit: GuideKit, placed: RowLabels, measure: MeasureText): number {
  let deepest = labelDepth(kit, placed, "", measure);
  for (const { label } of placed.ticks)
    deepest = Math.max(deepest, labelDepth(kit, placed, label, measure));
  return deepest;
}

/** How far `text`, a label of `placed` on an x axis, reaches from its row's start, as turned. */
function labelDepth(
  kit: GuideKit,
  { angle, label }: Pick<Placed, "angle" | "label">,
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
    rows[labels.row] = Math.max(rows[labels.row] ?? 0, rowDepth(kit, placed, measure));
  }
  return Array.from(rows, (row) => row ?? 0);
}

/**
 * Pixels `layers`' tick marks and labels outside the plot take out from
 * the line of an x axis: its ticks, and each row of labels past them, the
 * first `gap` from the line unless its layer gives its own, with what is
 * painted past their boxes (`past`). Labels inside the plot take none.
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
  for (const { layer, label, angle } of layers) {
    const { labels } = layer;
    if (!labels || labels.inside) continue;
    let away = firstRow(labels, gap, true, all);
    for (let row = 0; row < labels.row; row++) away += (rows[row] ?? 0) + ROW_GAP;
    depth = Math.max(depth, away + (rows[labels.row] ?? 0) + past(kit, label, angle));
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
  const gap = kit.tickLabelGap(layers[0]!.label.size);
  return within(outsideDepth(kit, layers, state.measure, gap), roomIn(axis, i)) + title;
}

/**
 * Pixels the x axis on the default side, `layers` placed, takes beyond
 * what the model keeps for its ticks and labels' lines: less than
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
  return ticks + Math.max(0, labels - state.xLabelLines);
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
  // Its labels as they are, before the room shortens them.
  const layers = placedLayers(kit, unroomed(axis), state, i, state.plan(axis.scale, i, 0));
  const text = titleOf(axis, i);
  const title = text ? kit.textHeight(titlePaint(kit, axis, state, i), text) + GAP : 0;
  const reach = outward(axis.layers);
  const beside = within(outsideBreadth(kit, layers, state.measure), roomIn(axis, i));
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
  categories: readonly string[] | undefined,
): AxisGuide {
  // The major layer shows what the default axis shows: none where the panel has nothing to label.
  if (guide.ticks.length === 0) layers[0]!.ticks = [];
  // The model resolves line paints for x axes only, which draw lines by default.
  const line = axis.line && state.styles.axisStroke("axisLine", axis.scale, i);
  const labelBoxes: LabelBox[] = [];
  const items = drawn(kit, guide, layers, line, state.measure, state, {
    boxes: labelBoxes,
    categories,
  });
  if (guide.title)
    items.push(
      titleItem(kit, guide.side, guide.title, guide.paints.title, guide.surface, state.measure),
    );
  return {
    ...guide,
    ticks: layers[0]!.ticks,
    items,
    layers: axis.layers.map(({ id }) => id),
    labelBoxes,
  };
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
  categories: readonly string[] | undefined,
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
  const labelBoxes: LabelBox[] = [];
  const items = drawn(kit, placement, layers, axis.line && paints.line, measure, state, {
    boxes: labelBoxes,
    categories,
  });
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
    labelBoxes,
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
 * the longest there), and labels in rows outward from the line. With
 * `record`, each label's box goes into its `boxes` as it is laid out
 * (`AxisGuide.labelBoxes`), named by its category on a category axis.
 */
export function drawn(
  kit: GuideKit,
  placement: Pick<AxisGuide, "side" | "edge" | "start" | "end" | "gap" | "surface">,
  layers: readonly Placed[],
  line: StrokePaint | false,
  measure: MeasureText,
  { width }: { readonly width: number },
  record?: { boxes: LabelBox[]; categories: readonly string[] | undefined },
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
    ticks.forEach(({ position, value, label }, k) => {
      if (!label) return;
      const distance = away + (lanes[k] ?? 0) * lane;
      const recorded = (box: Rect) =>
        record?.boxes.push({
          layer: layer.id,
          value,
          category: record.categories?.[value],
          text: label,
          box,
        });
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
        const item = kit.textItem(label, block.at, paint, placement.surface, measure, block.box);
        items.push(item);
        if (record) recorded(itemBox(kit, item, measure));
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
      const item = kit.textItem(label, at, paint, placement.surface, measure);
      items.push(item);
      if (record) recorded(itemBox(kit, item, measure));
    });
  }
  return items;
}

/**
 * The box a label's text item covers: its lines (and its box's padding),
 * from its point as its anchor and baseline say, and turned as it is, the
 * box around the turned one.
 */
function itemBox(kit: GuideKit, item: TextItem, measure: MeasureText): Rect {
  const { paint, x, y, angle } = item;
  let box = item.box;
  if (!box) {
    const { width, height } = kit.textLines(item.text, paint, measure);
    const top =
      item.baseline === "middle"
        ? y - paint.lineHeight / 2
        : item.baseline === "hanging"
          ? y - (paint.lineHeight - paint.size) / 2
          : y - paint.size;
    const share = item.anchor === "middle" ? 0.5 : item.anchor === "end" ? 1 : 0;
    box = { x: x - width * share, y: top, width, height };
  }
  if (!angle) return box;
  const turn = (angle * Math.PI) / 180;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [cx, cy] of [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ] as const) {
    xs.push(x + (cx - x) * cos - (cy - y) * sin);
    ys.push(y + (cx - x) * sin + (cy - y) * cos);
  }
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  return { x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 };
}
