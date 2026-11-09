// Anchors (`anchor`): application elements a chart holds at a place in its
// data, moved with every frame it draws and hidden while the place is out
// of view. Applications that import `anchor` load this module with it;
// charts keep only hooks for it (chart.ts): each frame drawn calls `place`
// before `render` tells of it, and the controller leaves input inside
// anchors to them. A point is placed through its panel's scales as drawn
// (while values move, the frame's); an item at its box as the frame drew
// it, cut to what its geometry shows, by code that loads with the first
// item anchor (dom/anchor-items.ts). A transform moves each
// wrapper, its percentages of the wrapper's own box putting the element on
// its side of the place, so nothing is measured and an element changing
// size needs no frame. A wrapper whose place is out of view is not
// displayed; focus inside it moves to the chart's root first. Options the
// chart cannot place keep their anchor hidden, and are told of once.

import type { DrawnPanel } from "../model/model.ts";
import type { Rect, Scene } from "../scene/scene.ts";
import { ChartError, type ChartErrorCode } from "../spec/errors.ts";
import type { FrameCoordinate, Side } from "../spec/place.ts";
import type { ItemReference } from "../spec/state.ts";
import { AnchorItems } from "./anchor-items.ts";
import { KIT, MountedChart } from "./chart.ts";
import type { Chart } from "./handle.ts";
import type { InteractionHost } from "./interaction.ts";
import type { FrameDrawing, Places } from "./value-transition.ts";

/**
 * A place along one axis an anchor takes: a value on the panel's axis (a
 * number, epoch ms or a Date on time axes, a category's name), `{ data }`
 * on a scale the chart names ("x", "y", "yRight", or one of its `scales`),
 * or a share of the plot (or with `frame: "chart"`, the chart) or pixels
 * from its edge, as annotations' coordinates are.
 */
export type AnchorCoordinate =
  | number
  | string
  | Date
  | { readonly data: number | string; readonly scale?: string; readonly offset?: number }
  | FrameCoordinate;

/**
 * Where an anchored element is held: a point (`x` and `y`, which may mix
 * kinds), or an item by its key from an event or by a reference, at its
 * box as the frame drew it, cut to what of it is in view.
 */
export type AnchorAt =
  | { readonly x: AnchorCoordinate; readonly y: AnchorCoordinate; readonly item?: never }
  | { readonly item: string | ItemReference; readonly x?: never; readonly y?: never };

export interface AnchorOptions {
  at: AnchorAt;
  /**
   * Which side of the place the element sits on, `offset` pixels from it:
   * above it ("top", the default), beside it, below it, or centred on it
   * ("center", which takes no `align` or `offset`). For an item, the place
   * is its box's edge on that side.
   */
  side?: Side | "center" | undefined;
  /**
   * Where along that side: the element's start, centre, or end at the
   * place's (an item box's start or end edge; a point itself). Start is the
   * left in left-to-right text, the right in right-to-left text, and the
   * top for the "left" and "right" sides.
   * @default "center"
   */
  align?: "start" | "center" | "end" | undefined;
  /** Pixels between the place and the element. @minimum 0 */
  offset?: number | undefined;
  /** The panel: a facet value or subplot id; needed in charts of several, and for an item drawn in several. */
  panel?: string | undefined;
}

/** An element a chart holds at a place in its data (see `anchor`). */
export interface Anchor {
  readonly element: HTMLElement;
  /**
   * Whether the element shows: its place is drawn and in view. Read in a
   * `render` listener, it says what that frame showed.
   */
  readonly shown: boolean;
  /** Holds it at another place, from the next frame, which this asks for. */
  set(options: AnchorOptions): void;
  /**
   * Takes the element out of the chart (it is detached, not put back where
   * it was) and forgets its place. Focus inside it moves to the chart's
   * root. Once removed, an anchor does nothing.
   */
  remove(): void;
}

/**
 * Holds `element`, the application's, at a place in `chart`'s data: it
 * moves with every frame the chart draws (zoom, pan, resize, streaming,
 * transitions) and hides (`display: none`) while the place is out of
 * view, its item or its panel not drawn. The element moves into a wrapper
 * over the plots and under the tooltip, which the chart positions; the
 * element's own styles stay. Its pointer input and keys are its own,
 * never the chart's; in the tab order it follows the chart's root;
 * exports leave it out. Focus inside it when it hides moves to the
 * chart's root. Placed from the next frame, which this asks for. Throws
 * for an element anchored already (in this chart or another) and for a
 * chart destroyed; options the chart cannot place keep it hidden and are
 * told of once (`onError`, "error" listeners, or the console).
 *
 * ```ts
 * anchor(chart, button, { at: { x: peak.time, y: peak.value }, side: "top", offset: 8 });
 * ```
 */
export function anchor(chart: Chart, element: HTMLElement, options: AnchorOptions): Anchor {
  if (!(chart instanceof MountedChart))
    throw new TypeError(`anchor chart: expected a chart from createChart; received ${chart}`);
  const anchors = MountedChart.anchors(chart, (host) => new Anchors(host));
  const holder = anchored.get(element);
  if (!anchors || holder)
    throw new Error(
      holder
        ? `anchor element: anchored already, in ${holder === anchors ? "this" : "another"} chart; move it with its anchor's set, or remove that anchor first`
        : "anchor chart: the chart is destroyed; anchor in a mounted chart",
    );
  return anchors.add(element, options);
}

/** What a chart lends its anchors: what it lends its controller, and how the frame on screen draws while values move. */
export interface AnchorHost extends InteractionHost {
  drawing(): FrameDrawing | undefined;
}

/** The anchors holding each element anchored: one anchor per element, across charts. */
const anchored = /* @__PURE__ */ new WeakMap<HTMLElement, Anchors>();

const SIDES = ["top", "right", "bottom", "left", "center"] as const;
const ALIGNS = ["start", "center", "end"] as const;

/** Options as checked: a point's coordinates or an item, and how the element sits there. */
interface Checked {
  point: readonly [x: AnchorCoordinate, y: AnchorCoordinate] | undefined;
  item: string | ItemReference | undefined;
  side: (typeof SIDES)[number];
  align: (typeof ALIGNS)[number];
  offset: number;
  panel: string | undefined;
}

/**
 * An anchor as its chart keeps it: its element and wrapper, its options
 * (checked once each), whether they were told of as refused, the transform
 * written, and what the last frame showed.
 */
interface Held {
  readonly element: HTMLElement;
  readonly wrapper: HTMLDivElement;
  options: AnchorOptions;
  checked: Checked | undefined;
  told: boolean;
  transform: string;
  shown: boolean;
}

/** One chart's anchors: their wrappers, in a layer of the chart's, and their placing. */
export class Anchors {
  /** What holds the wrappers: over the plots and the legend, under the tooltip, next after the root in the tab order. */
  readonly layer: HTMLDivElement;
  readonly #host: AnchorHost;
  readonly #held: Held[] = [];
  /** Item anchors' lookups, once picking's code has loaded; null if it failed to load. */
  #loaded: AnchorItems | null | undefined;
  /** Picking's loading, which the chart's `loading` waits for. */
  loading: Promise<void> | undefined;
  /** The scene the anchors were last placed in, while nothing has asked them to move since. */
  #placed: Scene | undefined;
  /** How many placings have begun: a placing begun while another shows its anchors ends that one. */
  #placings = 0;
  #disposed = false;

  constructor(host: AnchorHost) {
    this.#host = host;
    this.layer = host.root.ownerDocument.createElement("div");
    this.layer.style.cssText = "position:absolute;left:0;top:0;width:100%;height:0;z-index:1";
    host.legend.before(this.layer);
  }

  /** Anchors `element` (see `anchor`). */
  add(element: HTMLElement, options: AnchorOptions): Anchor {
    const wrapper = this.layer.ownerDocument.createElement("div");
    // Shown once placed, as a flex box: as tall as the element, with no line box below an inline one.
    wrapper.style.cssText = "position:absolute;left:0;top:0;display:none";
    wrapper.append(element);
    this.layer.append(wrapper);
    anchored.set(element, this);
    const held: Held = {
      element,
      wrapper,
      options,
      checked: undefined,
      told: false,
      transform: "",
      shown: false,
    };
    this.#held.push(held);
    this.#asked(options);
    return {
      element,
      get shown() {
        return held.shown;
      },
      set: (next) => {
        if (!this.#held.includes(held)) return;
        Object.assign(held, { options: next, checked: undefined, told: false });
        this.#asked(next);
      },
      remove: () => this.#remove(held),
    };
  }

  /** Asks for a frame to place an anchor at `options`; an item's loads picking's code now, which `loading` waits for. */
  #asked(options: AnchorOptions): void {
    if (options?.at?.item !== undefined) this.#items();
    this.#placed = undefined;
    this.#host.schedule();
  }

  /** Places the anchors where the frame on screen draws their places, or hides them. */
  place(): void {
    const host = this.#host;
    const scene = host.scene();
    const drawing = host.drawing();
    // A frame drawing the scene they were placed in (a cursor's move) moves none.
    if (!scene || this.#disposed || (scene === this.#placed && !drawing)) return;
    this.#placed = drawing ? undefined : scene;
    let rtl: boolean | undefined;
    // Items' rows first, every anchor's of a table found in one pass; with
    // no item anchors left, their tables are let go.
    const items = this.#held.some(({ options }) => options?.at?.item !== undefined)
      ? this.#items()
      : (this.#loaded ?? undefined);
    for (const held of this.#held)
      try {
        held.checked ??= this.#check(held.options);
        const { item } = held.checked;
        if (items && item !== undefined) items.want(items.keyOf(item));
      } catch {
        // Told of as it is placed.
      }
    items?.update();
    // Every place is read from the frame before any anchor shows or hides:
    // what that runs (focus leaving a hidden anchor, listeners told of
    // refusals) may change data, set or remove anchors, place them again,
    // or destroy the chart.
    const placed: [Held, AnchorOptions, string | undefined, unknown][] = [];
    for (const held of this.#held) {
      let transform: string | undefined;
      let refused: unknown;
      try {
        held.checked ??= this.#check(held.options);
        const box = this.#where(held.checked, scene, drawing);
        if (box) {
          const { side, align, offset } = held.checked;
          // Start and end along the top and bottom follow the text's direction.
          if (align !== "center" && (side === "top" || side === "bottom"))
            rtl ??= getComputedStyle(this.layer).direction === "rtl";
          transform = placement(box, side, align, offset, rtl === true);
        }
      } catch (error) {
        if (!held.told) refused = error;
      }
      placed.push([held, held.options, transform, refused]);
    }
    const placing = ++this.#placings;
    for (const [held, options, transform, refused] of placed) {
      if (this.#disposed || this.#placings !== placing) return;
      // Removed or set other options since, it is the next frame's.
      if (!this.#held.includes(held) || held.options !== options) continue;
      if (refused === undefined) this.#show(held, transform);
      else {
        held.told = true;
        this.#show(held, undefined);
        host.report(refused, "compile");
      }
    }
  }

  /** Removes every anchor, and lets go of the tables it listens to: the chart is destroyed. */
  dispose(): void {
    this.#disposed = true;
    for (const held of [...this.#held]) this.#remove(held);
    this.#loaded?.dispose();
  }

  #remove(held: Held): void {
    const at = this.#held.indexOf(held);
    if (at < 0) return;
    this.#held.splice(at, 1);
    anchored.delete(held.element);
    this.#show(held, undefined);
    // What focus leaving it ran may have anchored the element again, which keeps it.
    if (held.element.parentNode === held.wrapper) held.element.remove();
    held.wrapper.remove();
    // The next frame lets go of what only this anchor's item needed.
    this.#placed = undefined;
    if (!this.#disposed) this.#host.schedule();
  }

  /** Shows the anchor at `transform`, or hides it (undefined), focus inside it moving to the chart's root. */
  #show(held: Held, transform: string | undefined): void {
    const { wrapper } = held;
    if (transform !== undefined && transform !== held.transform) {
      wrapper.style.transform = transform;
      held.transform = transform;
    }
    const shown = transform !== undefined;
    if (shown === held.shown) return;
    if (!shown && wrapper.matches(":focus-within")) {
      const placing = this.#placings;
      this.#host.root.focus({ preventScroll: true });
      // What focus leaving it ran may have placed it again (a blur listener's `set` and `render`).
      if (this.#placings !== placing && this.#held.includes(held)) return;
    }
    held.shown = shown;
    wrapper.style.display = shown ? "flex" : "none";
  }

  /** A refusal of the options at `path`. */
  #error(path: string, message: string, code: ChartErrorCode = "invalid-option"): ChartError {
    return new ChartError({
      phase: "validate",
      code,
      path: `anchor.${path}`,
      message: `anchor ${path}: ${message}`,
    });
  }

  /** The options checked, or a refusal of what is wrong in them. */
  #check(options: AnchorOptions): Checked {
    const { at, side = "top", align = "center", offset = 0, panel } = options ?? {};
    const shown = (value: unknown) =>
      value instanceof Date ? `${value}` : (JSON.stringify(value) ?? String(value));
    const expected = (path: string, list: string, value: unknown) =>
      this.#error(path, `expected ${list}; received ${shown(value)}`);
    if (typeof at !== "object" || at === null)
      throw expected("at", "a point ({ x, y }) or an item ({ item })", at);
    const { x, y, item } = at as { x?: unknown; y?: unknown; item?: unknown };
    if (item !== undefined && (x !== undefined || y !== undefined))
      throw this.#error("at", "a point (x and y) or an item, not both; drop one");
    if (
      item !== undefined &&
      !(typeof item === "string"
        ? itemKey(item)
        : typeof (item as ItemReference)?.mark === "string" &&
          Array.isArray((item as ItemReference).item))
    )
      throw expected("at.item", "an item key from an event, or a reference ({ mark, item })", item);
    if (item === undefined)
      for (const [axis, value] of [
        ["x", x],
        ["y", y],
      ] as const)
        if (!coordinate(value))
          throw expected(
            `at.${axis}`,
            `a value on the ${axis} axis, a category, or { fraction } or { px }`,
            value,
          );
    if (!SIDES.includes(side as never))
      throw expected("side", `"top", "right", "bottom", "left", or "center"`, side);
    if (!ALIGNS.includes(align as never))
      throw expected("align", `"start", "center", or "end"`, align);
    if (!(typeof offset === "number" && offset >= 0 && offset < Infinity))
      throw expected("offset", "pixels, 0 or more", offset);
    if (panel !== undefined && typeof panel !== "string")
      throw expected("panel", "a panel's key", panel);
    return {
      point: item === undefined ? [x as AnchorCoordinate, y as AnchorCoordinate] : undefined,
      item: item as Checked["item"],
      side,
      align,
      offset,
      panel,
    };
  }

  /** Where the anchor's place is drawn, a box of no size for a point; undefined out of view. */
  #where(checked: Checked, scene: Scene, drawing: FrameDrawing | undefined): Rect | undefined {
    const { model } = this.#host;
    if (checked.point) {
      const panel = this.#panel(checked.panel, drawing?.panels ?? model.panels());
      return panel && this.#pointIn(panel, checked.point, drawing);
    }
    const items = this.#loaded;
    const boxes = items?.boxes(items.keyOf(checked.item!), scene, drawing);
    if (!boxes) return undefined;
    if (checked.panel !== undefined) {
      this.#known(checked.panel);
      return boxes.get(checked.panel);
    }
    if (boxes.size > 1)
      throw this.#error(
        "at.item",
        `the item is drawn in panels ${names([...boxes.keys()])}; name one with panel`,
      );
    return boxes.values().next().value;
  }

  /**
   * The panel of a point: `key`, or the chart's only one; undefined for a
   * facet value not drawn now. Refused for panels of no axes, and for a
   * subplot the chart does not have.
   */
  #panel(key: string | undefined, panels: readonly DrawnPanel[]): DrawnPanel | undefined {
    const { model } = this.#host;
    const all = model.allPanels();
    if (key === undefined) {
      if (all.length > 1)
        throw this.#error(
          "panel",
          `the chart has several panels; name one of ${names(all.map(({ key }) => key))}`,
        );
      key = all[0]?.key ?? "";
    }
    const panel = panels.find((p) => p.key === key);
    if (panel) return panel;
    if (all.some((p) => p.key === key))
      throw this.#error(
        "at",
        `panel ${JSON.stringify(key)} has no axes (a layout mark's); anchor at an item`,
      );
    this.#known(key);
    return undefined;
  }

  /** Refuses a panel key the chart has no panel of: facet values come and go with the data; subplots are the options'. */
  #known(key: string): void {
    const { model } = this.#host;
    if (!model.config.facet && !model.allPanels().some((p) => p.key === key))
      model.instanceOf("x", key, "anchor panel");
  }

  /** A point in `panel` as the frame draws it: undefined where a value on an axis is out of view. */
  #pointIn(
    panel: DrawnPanel,
    [x, y]: Checked["point"] & {},
    drawing: FrameDrawing | undefined,
  ): Rect | undefined {
    const { model } = this.#host;
    const { plot } = panel;
    const places = drawing?.places.get(panel.key);
    const at: number[] = [];
    // Coordinates as annotations' (layout/position.ts), which charts of lines alone do not load.
    for (const [axis, value] of [
      ["x", x],
      ["y", y],
    ] as const) {
      const [start, length] = axis === "x" ? [plot.x, plot.width] : [plot.y, plot.height];
      if (typeof value === "object" && !(value instanceof Date) && !("data" in value)) {
        // A share of the plot (or chart) or pixels from its edge: where it says, never out of view.
        const box =
          value.frame === "chart" ? { x: 0, y: 0, width: model.width, height: model.height } : plot;
        const [from, size] = axis === "x" ? [box.x, box.width] : [box.y, box.height];
        const share = "fraction" in value ? value.fraction : value.px;
        at.push(
          ("fraction" in value ? from + (axis === "x" ? share : 1 - share) * size : from + share) +
            (value.offset ?? 0),
        );
        continue;
      }
      const {
        data,
        scale: name = axis,
        offset = 0,
      } = typeof value === "object" && !(value instanceof Date)
        ? value
        : { data: value instanceof Date ? value.getTime() : value };
      const pixel = this.#pixel(panel, name, axis, data, places);
      // A value is out of view outside the plot.
      if (pixel === undefined || !(pixel >= start && pixel <= start + length)) return undefined;
      at.push(pixel + offset);
    }
    return { x: at[0]!, y: at[1]!, width: 0, height: 0 };
  }

  /**
   * The pixel of `value` on the scale `name` of `panel`, along `axis`, as
   * drawn: a category's at its band (between its places while categories
   * change order); undefined for a value the scale cannot show.
   */
  #pixel(
    panel: DrawnPanel,
    name: string,
    axis: "x" | "y",
    value: number | string,
    places: Places | undefined,
  ): number | undefined {
    const scale =
      name === "x"
        ? panel.x
        : name === "y"
          ? panel.drawsY || !panel.yRight
            ? panel.y
            : undefined
          : name === "yRight"
            ? panel.yRight
            : this.#host.model
                .drawnMarks()
                .find((drawn) => drawn.panel === panel.key && drawn.frame?.scaleOf)
                ?.frame?.scaleOf?.(name, axis);
    if (!scale)
      throw this.#error(
        `at.${axis}.scale`,
        `the panel has no scale ${JSON.stringify(name)}; name "x", "y", "yRight", or one of the chart's scales`,
      );
    if (typeof value === "string") {
      if (!scale.categories)
        throw this.#error(
          `at.${axis}`,
          `${JSON.stringify(value)} is a category, and the ${name} axis holds numbers; give a number`,
        );
      const moving = places?.[name as "x" | "y" | "yRight"]?.get(value);
      if (moving !== undefined) return moving;
      const index = scale.categories.indexOf(value);
      return index < 0 ? undefined : scale.map(index);
    }
    if (!Number.isFinite(value) || scale.breaks?.hides(value)) return undefined;
    const pixel = scale.map(value);
    return Number.isFinite(pixel) ? pixel : undefined;
  }

  /** Item anchors' lookups (dom/anchor-items.ts), once picking's code has loaded; it loads at the first ask. */
  #items(): AnchorItems | undefined {
    if (this.#loaded === undefined && !this.loading)
      this.loading = import("../model/pick.ts")
        .then(
          (pick) => {
            this.#loaded = new AnchorItems(this.#host, KIT, pick, (path, message, code) =>
              this.#error(path, message, code),
            );
          },
          // Without it, item anchors stay hidden.
          () => {
            this.#loaded = null;
          },
        )
        .finally(() => {
          this.loading = undefined;
          this.#placed = undefined;
          if (!this.#disposed) this.#host.schedule();
        });
    return this.#loaded ?? undefined;
  }
}

/** Whether `key` is an item key: a mark's key, then the item's parts. */
function itemKey(key: string): boolean {
  try {
    const parts = JSON.parse(key) as unknown;
    return Array.isArray(parts) && parts.length > 1;
  } catch {
    return false;
  }
}

/** Whether `value` is a coordinate an anchor takes. */
function coordinate(value: unknown): boolean {
  if (typeof value === "number") return !Number.isNaN(value);
  if (typeof value === "string") return true;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== "object" || value === null) return false;
  const given = value as { data?: unknown; fraction?: unknown; px?: unknown; offset?: unknown };
  const share = "fraction" in given ? given.fraction : "px" in given ? given.px : undefined;
  const ok =
    "data" in given
      ? typeof given.data === "string" || typeof given.data === "number"
      : typeof share === "number" && Number.isFinite(share);
  return ok && (given.offset === undefined || Number.isFinite(given.offset));
}

/** Panel keys or ids, quoted, for messages. */
function names(keys: readonly string[]): string {
  return keys.map((key) => JSON.stringify(key)).join(", ");
}

/**
 * The transform putting a wrapper on `side` of `box`, `offset` pixels
 * away, at `align` along that side: the box's edge's start (left, or right
 * in right-to-left text; the top beside it), middle, or end, the element's
 * own start, middle, or end there. "center" centres it on the box.
 */
function placement(
  { x, y, width, height }: Rect,
  side: Checked["side"],
  align: Checked["align"],
  offset: number,
  rtl: boolean,
): string {
  if (side === "center")
    return `translate(${x + width / 2}px,${y + height / 2}px) translate(-50%,-50%)`;
  const beside = side === "left" || side === "right";
  let along = align === "start" ? 0 : align === "end" ? 1 : 0.5;
  if (rtl && !beside) along = 1 - along;
  const [px, py, sx, sy] = beside
    ? [
        side === "left" ? x - offset : x + width + offset,
        y + along * height,
        side === "left" ? -100 : 0,
        -100 * along,
      ]
    : [
        x + along * width,
        side === "top" ? y - offset : y + height + offset,
        -100 * along,
        side === "top" ? -100 : 0,
      ];
  return `translate(${px}px,${py}px) translate(${sx}%,${sy}%)`;
}
