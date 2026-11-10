// The interaction controller: pointer, wheel, and keyboard handling, and
// what they draw over the chart (crosshairs, points, item outlines, the
// tooltip, brushes, and crosshair labels). Charts load this module once,
// after their first frame or at the first input, and keep the input that
// arrives before it (chart.ts, `#hold`), which the controller then plays
// through its handlers. What the chart is (its state, inspection, views,
// selections, and their events) stays in chart.ts, which the controller
// changes through its host.

import type { Table } from "../data/table.ts";
import type { MeasureText } from "../layout/text.ts";
import type { DrawnRow } from "../marks/drawn.ts";
import type { AxisFormat, Mark, MarkKey } from "../marks/mark.ts";
import type { Series, xAt } from "../marks/series.ts";
import type { AxisPlan } from "../model/axis.ts";
import { type Binding, Bindings, shapeOf } from "../model/bindings.ts";
import type { AxisInspection } from "../model/inspect.ts";
import type { ItemResolver } from "../model/items.ts";
import {
  cursorAxis,
  inspectPosition,
  itemAt,
  type KeyedItem,
  keyboardStops,
  keyedItem,
  keyedPoint,
  orderAt,
  rowItem,
  standing,
  stepCell,
  stepPoint,
  type Visit,
} from "../model/keyboard.ts";
import type { ChartModel, DrawnPanel, Inspection, Viewport } from "../model/model.ts";
import type { Picked, Picker, PickKit } from "../model/pick.ts";
import type { RowLink } from "../model/row-selection.ts";
import type { SelectionOwner } from "../model/selected-rows.ts";
import { padded, unpadded } from "../model/view-padding.ts";
import type { PositionScale } from "../scale/scale.ts";
import type {
  AxisGuide,
  LabelBox,
  LegendGuide,
  PlotRect,
  Scene,
  TextItem,
  tickLabelGap,
} from "../scene/scene.ts";
import type { BrushSpec, CursorShowSpec, Snap, ZoomSpec } from "../spec/spec.ts";
import type {
  ChartSelection,
  ItemReference,
  Phase,
  PinTarget,
  SeriesReference,
} from "../spec/state.ts";
import type { surface } from "../theme.ts";
import type { CrosshairLabels } from "./axis-labels.ts";
import type { Brush } from "./brush.ts";
import type { BrushSelection } from "./brushed.ts";
import type { ChartOptions } from "./chart.ts";
import type {
  AxisLabelTarget,
  ChangeCause,
  Emitter,
  InputEvent,
  ItemTarget,
  LegendEntryTarget,
  Pointer,
  Target,
} from "./events.ts";
import type { CursorPosition } from "./handle.ts";
import type { LegendClick } from "./legend.ts";
import { pressed, pressFocus } from "./press-focus.ts";
import { frameCount } from "./scheduler.ts";
import type { svgElement } from "./svg-layer.ts";
import { contentText, describeInspection, fieldsSpoken, Tooltip } from "./tooltip.ts";

// Layout controls compile their bindings with this module's class
// (layout-controls.ts), which keeps it in this module's chunk: in a chunk
// of its own, it would be one more round trip before the first input.
export { Bindings };

/** Picking's module, loaded when needed (see `Interaction.needPicking`). */
type PickModule = typeof import("../model/pick.ts");

/** Picking's module, once a chart on the page has loaded it: charts after that take it at once. */
let picking: PickModule | undefined;

/** Loads picking for the charts on the page: as the first that needs it does, and for this package's tests. */
/** How picking's module is imported (see `forgetPicking`). */
let importPicking = (): Promise<PickModule> => import("../model/pick.ts");

export const loadPicking = (): Promise<PickModule> =>
  importPicking().then((module) => (picking = module));

/**
 * For this package's tests: charts made after this load picking again, as
 * the page's first, through `load`.
 */
export function forgetPicking(load = (): Promise<PickModule> => import("../model/pick.ts")): void {
  picking = undefined;
  importPicking = load;
}

/**
 * Where an input event keeps the panels drawn as it was captured, which
 * writing it as JSON reads (web/events.ts): listeners of events before it
 * may change them.
 */
const FRAME = Symbol.for("herceg.inputFrame");

/**
 * Code the controller shares with the chart, handed to it so that loading
 * the controller moves none of it out of the chart's bundle.
 */
export interface InteractionKit extends PickKit {
  svgElement: typeof svgElement;
  xAt: typeof xAt;
  surface: typeof surface;
  tickLabelGap: typeof tickLabelGap;
  /** Keys the keyboard cursor and selections answer to. */
  keys: readonly string[];
  /** Below this many pixels, a press is a click rather than a drag. */
  dragThreshold: number;
}

/** What a chart lends its controller. */
export interface InteractionHost {
  readonly root: HTMLDivElement;
  readonly model: ChartModel;
  /** The pointer overlay of the chart's SVG layer. */
  readonly overlay: SVGGElement;
  /** The live region, which reads sentences aloud. */
  readonly live: HTMLElement;
  /** The legend's element, whose presses and clicks are its own. */
  readonly legend: HTMLElement;
  /** What holds the chart's anchors (dom/anchors.ts), whose input is the application's; undefined before the first. */
  anchors(): HTMLElement | undefined;
  /** The entry each click on the legend was on, as drawn then (see `Legend.clicked`). */
  readonly legendClicks: WeakMap<Event, LegendClick>;
  /** What a legend entry of `keys` (its own, or its targets) stands for (see `legendMembers`). */
  members(keys: readonly string[]): { series: string[]; items: string[] };
  /** What a legend entry of `keys` acts on, as references name it. */
  references(keys: readonly string[]): (SeriesReference | ItemReference)[];
  readonly events: Emitter;
  /** Unique in the page: prefixes the ids the controller's drawings need. */
  readonly id: string;
  options(): ChartOptions;
  /** The scene on screen, undefined before the first. */
  scene(): Scene | undefined;
  /** Counts changes of options and data, the marks and rows inspections name. */
  revision(): number;
  /** The chart's revision the frame on screen drew, which input events carry. */
  drawnRevision(): number;
  /** Counts a change of the chart's state the controller made (a pin), returning the chart's revision. */
  count(): number;
  /** Draws the overlay again on the next frame. */
  schedule(): void;
  /**
   * Tells of code the controller could not load (phase "load"), or of
   * options it refuses once a frame shows what they apply to ("compile"),
   * as the chart tells of what fails.
   */
  report(error: unknown, phase: "load" | "compile"): void;
  /** Draws the scene again on the next frame. */
  invalidate(): void;
  /** Ends the frame without drawing the data: keeps the selection, then draws the overlay. */
  finishFrame(): void;
  /** Draws pending changes now, values on their way shown where they go. */
  current(): void;
  /** Whether changes since the last frame (options, data, size) may change the panels or their scales. */
  stale(): boolean;
  /** Shows values on their way where they go, before input reads them. */
  showValues(): void;
  /** Ends a change of view or values playing and draws where it was going. */
  settle(): void;
  animated(change: () => void): void;
  /** One change of view, made in `panel` (by default, in none), reported once and shared with synced charts. */
  changeView(change: () => void, cause: ChangeCause, panel?: string): void;
  /** Sets the selection (a brush in panel `at`), as one of the chart's own, sharing it with synced charts. */
  select(selection: ChartSelection | null, at?: DrawnPanel, cause?: ChangeCause): void;
  /**
   * Reports what a gesture making a brush in `at` shows (a `preview`), or
   * that it was undone (`cancel`, going back to the selection there is), as
   * a change of `cause`.
   */
  preview(
    selection: BrushSelection | null,
    at: DrawnPanel,
    phase: "preview" | "cancel",
    cause: ChangeCause,
  ): void;
  selection(): ChartSelection | null;
  owner(): SelectionOwner | null;
  rows(): RowLink | undefined;
  /** The brush, once loaded: it draws drags and the selection. */
  brush(): Brush | undefined;
  /** The scale the chart's cursor channel carries, when it syncs its cursor. */
  cursorScale(): "x" | "y" | "xy" | undefined;
  /**
   * Shares the value under the pointer in `panel` (a category by name)
   * with synced charts; null for none.
   */
  shareCursor(value: number | string | null, panel?: DrawnPanel): void;
  /** The cursor a synced chart shares or `showCursor` shows, or null. */
  cursor(): ShownCursor | null;
  /** What last changed the view or what bounds it. */
  cause(): ChangeCause;
}

/**
 * A cursor the chart shows that is not its pointer's: where, and with
 * `showCursor`, how it shows (else as the cursor channel says).
 */
export interface ShownCursor {
  at: CursorPosition;
  shown?: CursorShowSpec;
  /** Shared by another chart, or shown by `showCursor`. */
  cause: "sync" | "api";
  /**
   * Its sync channel's panel: it shows on the panels sharing that panel's
   * instance of its axis, as drawn now (none while that panel is not);
   * by default, on every panel.
   */
  panel?: string | undefined;
}

/** Where the keyboard cursor is: a panel, a series, and a position in the series' part in the panel. */
export interface KeyboardCursor {
  panel: string;
  key: string;
  position: number;
  /** Where it stood when it moved there (see `standing`), which a series that goes is handed on from. */
  stood?: { axis: "x" | "y"; place: number; height: number } | undefined;
  /** What it is on (see `KeyedItem`), which each scene drawn finds again (see `itemAt`). */
  item?: KeyedItem | undefined;
}

/**
 * A run of Up and Down: the series of a panel in the order they visit
 * them, taken once where the cursor stood (see `orderAt`), and the one the
 * cursor is at; the scene it was taken in, a change of which ends it.
 */
interface Run {
  panel: string;
  axis: "x" | "y";
  place: number;
  order: Visit[];
  at: number;
}

/**
 * The pinned tooltip: where (`at`, as `pinned` reports it), and for an
 * item, the keyboard's kind of cursor on it and what that is on, found
 * again in each frame drawn since a change of options or data (`seen`:
 * the revision of the frame it was found in).
 */
interface Pin {
  at: PinTarget;
  cursor?: KeyboardCursor;
  item?: KeyedItem | undefined;
  seen?: number;
}

/**
 * A rule with `drag` being dragged: its mark (as the chart has it now, by
 * `id` or else its place), its item's key, the axis it moves along and its
 * scale, the value it had, the value the pointer gives it, and the value
 * last reported (a preview).
 */
interface DraggedRule {
  mark: Mark;
  /** The pointer pressing it, which holds the pointer's capture. */
  pointer: number;
  /**
   * The panel it is dragged in, in a chart of several when the press began:
   * every report of the gesture names it, so a cancel after its facet went
   * still pairs with the previews.
   */
  panel?: string;
  index: number;
  id: string | undefined;
  key: string;
  axis: "x" | "y";
  scale: "x" | "y" | "yRight";
  from: number;
  at?: number;
  reported?: number;
}

/**
 * A primary-button press on a plot until release: where it started, the
 * panel (and so the scales) it started in, and what dragging does.
 */
interface Press {
  x: number;
  y: number;
  panel: DrawnPanel;
  mode: "pan" | "brush" | "edit" | "cursor" | "click" | "move";
  /** The rule a "move" press drags. */
  rule?: DraggedRule;
  /** What the press's binding does. */
  action: Binding["action"] | undefined;
  moved: boolean;
  /** What a brush's gesture last reported it shows (as JSON); undefined before it reported any. */
  previewed?: string | undefined;
  /** The view when it started and the last its pan set, which Escape goes back from to the first. */
  from: View;
  last?: View;
}

/** What a panel showed along each axis, as a press or a frame saw it. */
type View = Viewport;

/** A two-finger pinch: the fingers' distance and middle when last moved, and the panel and axes it zooms. */
interface Pinch {
  distance: number;
  middle: { x: number; y: number };
  panel: DrawnPanel;
  /** The zoom its binding does. */
  action: Binding["action"] & { type: "zoom" };
}

/**
 * A panel's pixels as values of the view it shows (`#shown`): along x, y,
 * and the right y axis when it has one.
 */
interface Shown {
  panel: DrawnPanel;
  x(pixel: number): number;
  y(pixel: number): number;
  yRight: ((pixel: number) => number) | undefined;
}

/**
 * Values at the pixels of a scale's range for `view`, a view asked for
 * since the scale was drawn (null: the one drawn), read through the drawn
 * scale's pixels, which the view's ends span: so steps taken between frames
 * add up without drawing, on any scale type.
 */
function inverter(
  scale: PositionScale,
  view: readonly [number, number] | null,
): (pixel: number) => number {
  if (!view) return (pixel) => scale.invert(pixel);
  // Views are ascending; axes show them the way their domains run.
  const [a, b] = scale.domain[0] <= scale.domain[1] ? view : [view[1], view[0]];
  const [r0, r1] = scale.range;
  const p0 = scale.map(a);
  const p1 = scale.map(b);
  return (pixel) => scale.invert(p0 + ((pixel - r0) * (p1 - p0)) / (r1 - r0));
}

/**
 * The bindings of a chart's options, compiled, and those of subplots with
 * settings of their own, by id; throws for those it refuses.
 */
function bindingsOf(options: ChartOptions): Compiled {
  const { interaction, rowSelection, panels, tooltip, inspection } = options;
  if (typeof tooltip === "object" && tooltip.pin && inspection === false)
    throw new Error("tooltip.pin: pins what the pointer inspects; drop inspection: false");
  const brushesRows = rowSelection?.bindings.some(({ events }) => events.includes("brush"));
  const own = new Map<string, Bindings>();
  for (const [i, { id, interaction: settings }] of (panels?.declared ?? []).entries())
    if (settings)
      own.set(
        id,
        new Bindings(
          panels!.interactionOf(interaction, id),
          brushesRows,
          `panels[${i}].interaction`,
        ),
      );
  return [new Bindings(interaction, brushesRows), own];
}

type Compiled = [chart: Bindings, own: ReadonlyMap<string, Bindings>];

/** The scales a brush of `shape` has ranges on: a rectangle's and a lasso's, both. */
const shapeScales = (shape: BrushSpec): readonly ("x" | "y")[] =>
  shape === "x" ? ["x"] : shape === "y" ? ["y"] : ["x", "y"];

/** The opacity of an entry of a legend that selects while others are selected, as hidden entries fade. */
const HIDDEN_ENTRY = 0.4;

/** What the controller acts on along axes; layout marks' controls take the rest. */
const OWN = ({ type }: Binding["action"]) => type !== "orbit" && type !== "moveItem";
/** A gesture made with no key held. */
const UNMODIFIED = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

export class Interaction {
  readonly #host: InteractionHost;
  readonly #kit: InteractionKit;
  /** The gestures the chart's `interaction` binds. */
  #bindings: Bindings;
  /** Those subplots with settings of their own bind, by id (see `#bindingsIn`). */
  #own: ReadonlyMap<string, Bindings> = new Map();
  readonly #tooltip: Tooltip;
  /** Tooltips of other panels showing the cursor (`sync.panels.tooltip`), made as needed. */
  readonly #tips: Tooltip[] = [];
  /** What the keyboard's cursor shared with the cursor channel and the charts there show, or null. */
  #keyShared: string | null = null;
  /** What the pointer shared last, by value and panel, which a new scene shares again where it reads otherwise. */
  #pointerShared: string | null = null;
  /** A crosshair per panel shown; the first stays, hidden, when none is. */
  readonly #crosshairs: SVGLineElement[];
  /** Clip paths keeping a panel's crosshair off the insets over it, by panel key; and how many were made. */
  readonly #cuts = new Map<string, SVGClipPathElement>();
  #cutsMade = 0;
  readonly #dots: SVGGElement;
  /** Outlines the item inspected in charts of a layout mark (a pie slice). */
  readonly #outline: SVGPathElement;
  /** Rings the keyboard cursor's own point: the series it is on, whatever the inspection reads. */
  readonly #ring: SVGCircleElement;
  /** Labels on the axes at the crosshair, once loaded for `tooltip.axisLabels`; null if it failed to load. */
  #crosshair: CrosshairLabels | null | undefined;
  #crosshairLoading: Promise<void> | undefined;
  /** What draws tooltip fields and content and `renderTooltip`'s content, while it loads; and once it has. */
  #content: Promise<void> | undefined;
  #drawsContent = false;
  #pointer: { x: number; y: number } | null = null;
  /** Whether the pointer is a touch, which reaches further (see `#slop`). */
  #touch = false;
  /** The reach of the press being resolved, for what picks for it (see `#pressing`). */
  #pressReach: number | undefined;
  /** The element the pointer last moved over, which says the legend entry it is on. */
  #over: EventTarget | null = null;
  /**
   * Picking (model/pick.ts): what input is on, tested against what frames
   * drew. Loaded once events or row selections need it (`needPicking`);
   * null if it failed to load, tried again as options change.
   */
  #picking: { module: PickModule; picker: Picker } | null | undefined;
  #pickingLoad: Promise<void> | undefined;
  /** Names items in events, for the configuration it was made of. */
  #resolver: { marks: readonly unknown[]; resolver: ItemResolver } | undefined;
  /**
   * Clicks, secondary presses, and Enter on the keyboard cursor that came
   * while what the frame on screen drew had changed, or picking loaded:
   * picked once a frame draws the change (`resolve`); legend clicks read
   * meanwhile, reported in their turn.
   */
  #pending: (
    | {
        type: "click" | "contextMenu";
        x: number;
        y: number;
        event: MouseEvent;
        label?: boolean | undefined;
      }
    | { type: "key"; keyboard: KeyboardCursor; item: KeyedItem | undefined }
    | { type: "legend"; click: InputEvent }
  )[] = [];
  /** Input events captured as a frame drew, emitted when the controller next draws. */
  #due: (() => void)[] = [];
  /**
   * What the pointer was on as the last frame drew, captured before any
   * listener could change it: hover reports it whatever they change.
   */
  #captured: { scene: Scene; event: InputEvent } | null = null;
  /**
   * What a hover read since the controller last drew was of: the scene,
   * and the pointer and keyboard cursor, which each move replaces. The draw
   * that follows reads it again only where one of them changed.
   */
  #heard: Heard | null = null;
  /** The inspection options last reported for a reach in milliseconds off a time axis (see `draw`). */
  #checked: ChartOptions["inspection"];
  /** What the pointer read last, of a scene, which sharing it and drawing it read once (`#read`). */
  #reading: { x: number; y: number; scene: Scene; inspection: Inspection | undefined } | null =
    null;
  #keyboard: KeyboardCursor | null = null;
  /**
   * The keyboard cursor whose target went (its series hidden, its row
   * dropped): there is no cursor, and the next key hands it on from where
   * it stood (see `#handOff`), though its target came back meanwhile;
   * nothing looks for its target.
   */
  #gone: KeyboardCursor | null = null;
  #run: Run | null = null;
  #press: Press | null = null;
  /** The frame count when a brush's move last reported its preview at once (see `frameCount`). */
  #previewedIn = -1;
  /** Where each touch is, for pinches. */
  readonly #touches = new Map<number, { x: number; y: number }>();
  /**
   * The chart's own fingers: those it took the press of, until they leave.
   * Another finger (pressed in an anchor, even while the controller loaded,
   * or on a button) has no business with the chart's presses and pinches.
   */
  readonly #fingers = new Set<number>();
  #pinch: Pinch | null = null;
  /**
   * A press with nothing to drag (on a layout mark's items, or off the
   * panels): a click if released in place. Off the panels (`label`), only
   * on an axis label.
   */
  #tap: { pointer: number; x: number; y: number; moved: boolean; label?: boolean } | null = null;
  /** Where a keyboard selection (Shift + arrows) started: a value along the cursor's axis and its label. */
  #brushAnchor: { value: number; label: string; axis: "x" | "y" } | null = null;
  /** What the last hover event reported, to emit only changes. */
  #hovered = "";
  /** What read the last hover reported, for the report once it goes. */
  #cursorCause: InputEvent["cause"] = "pointer";
  /**
   * The ends each scale instance's view is near, by scale, group, and side:
   * the bound it came near, until it moves away or the bound moves.
   */
  readonly #edges = new Map<string, number>();
  /** Whether the views' edges are reported on the next frame, drawn or not: the first after attaching. */
  #edgesDue = true;
  /** The views each panel's frame drew, by panel: what input between frames starts from. */
  readonly #framed = new Map<string, View>();
  /** What the input being handled is, as views changed report it. */
  #cause: ChangeCause = "pointer";
  /** The pinned tooltip, and a pin asked for before a frame and picking could place it. */
  #pin: Pin | null = null;
  #pinLater: { at: PinTarget | null; cause: ChangeCause } | undefined;
  /** The inspection's mode the pin was made in: another lets it go. */
  #pinMode: unknown;
  /** Whether the pinned tooltip takes the keyboard's focus once drawn (pinned from the keyboard). */
  #focusPin = false;
  /** The legends' actions as last drawn, to restore their entries' states when they change. */
  #legendActions = "";
  /** The scene and the selection the legends' entries last said. */
  #legendsDrawn: [Scene | undefined, ChartSelection | null] = [undefined, null];
  /** Lets the pin go on a press outside the chart, while one is pinned. */
  #outside: ((event: Event) => void) | undefined;
  /** A press that may be on a rule, and the input after it, waiting for picking to tell; null when none. */
  #waiting: Event[] | null = null;
  /** Where `#outside` listens: the chart's root, the shadow roots around it, and the document. */
  #outsideOn: readonly EventTarget[] = [];
  /** The series point a picked aggregate (a bin, a box, a cell) stands for, which pins read it at. */
  readonly #points = new WeakMap<ItemTarget, { series: Series; position: number }>();
  /** Where in its series a picked row, or the keyboard cursor's, is drawn, which pins find it at. */
  readonly #drawnAt = new WeakMap<ItemTarget, DrawnRow | undefined>();
  /** Whether the chart has marks with `drag`, which presses pick first and the pointer's cursor shows. */
  #draggable = false;
  /** The resize cursor over a rule the pointer can drag, or none. */
  #ruleCursor = "";
  /** Whether a click where the pointer is acts (see `#acts`), which the pointer cursor shows. */
  #pointing = false;
  /** The cursor the chart last set on its root, which it changes only when its own choice does. */
  #cursor = "";
  /**
   * What the pointer was last read to be on (by a hover, or the cursor):
   * of the scene and the drill's frame drawn, and the pointer (which each
   * move replaces, with the element it is over); and once the cursor asks,
   * whether a click there acts. One pick serves both.
   */
  #on: [Scene | undefined, unknown, object, Target | undefined, boolean?] | null = null;
  /** Handlers by event type, which play held input too. */
  readonly #handlers = new Map<string, (event: never) => void>();
  readonly #cleanup: (() => void)[] = [];
  #disposed = false;

  constructor(host: InteractionHost, kit: InteractionKit) {
    this.#host = host;
    this.#kit = kit;
    // Bindings it refuses throw before anything is installed.
    const compiled = bindingsOf(host.options());
    [this.#bindings] = compiled;
    const { svgElement } = kit;
    const document = host.root.ownerDocument;
    this.#tooltip = new Tooltip(document);
    host.root.append(this.#tooltip.element);
    this.#crosshairs = [
      svgElement(document, "line", { "stroke-width": "1", visibility: "hidden" }),
    ];
    this.#dots = svgElement(document, "g");
    this.#outline = svgElement(document, "path", {
      fill: "none",
      "stroke-width": "2",
      "stroke-linejoin": "round",
      visibility: "hidden",
    });
    this.#ring = svgElement(document, "circle", {
      r: "6.5",
      fill: "none",
      "stroke-width": "2",
      visibility: "hidden",
    });
    host.overlay.append(...this.#crosshairs, this.#dots, this.#outline, this.#ring);
    // What presses focus draws no ring until a key (see press-focus.ts); a
    // focus the chart has without one now is a press's, held while this loaded.
    this.#cleanup.push(pressFocus(host.root));
    if (!host.root.matches(":focus-visible")) pressed(host.root);
    this.#listen();
    this.configure(compiled);
    // The chart's \`pin\` pins through the model; a pin it asked for before now is made now.
    const { model } = host;
    model.pins = this;
    const asked = model.pinning;
    model.pinning = undefined;
    if (asked) this.#pinAsked({ at: asked.at, cause: "api" });
  }

  /**
   * Whether the pointer reading what is under it or the keyboard is on the
   * chart, or a press is in progress. A pointer that reads nothing
   * (`inspection: false`, no hover listener, and no click of the chart's
   * own to show) lets changed values move.
   */
  get busy(): boolean {
    return !!((this.#pointer && this.#reads()) || this.#keyboard || this.#press || this.#tap);
  }

  /**
   * Whether the pointer reads what is under it: by inspection, picking for
   * hover listeners, or for the cursor, where the chart's clicks act.
   */
  #reads(): boolean {
    return (
      this.#host.options().inspection !== false ||
      this.#host.events.has("hover") ||
      this.#clicksAct()
    );
  }

  /**
   * Whether the chart's own clicks act on what they are on: select it
   * (`interaction.select`), pin it (`tooltip.pin`), select its rows
   * (a row selection's clicks), or drill a tree.
   */
  #clicksAct(): boolean {
    const host = this.#host;
    return (
      !!host.options().interaction?.select ||
      this.#pinsByClick() ||
      !!host.rows()?.takesClicks ||
      !!host.model.drills
    );
  }

  /**
   * Shows the pointer cursor where a click acts (see `#acts`), decided once
   * for each move, scene, and drill frame; not for touches or a drag. A
   * rule the pointer can drag keeps its resize cursor. With the pointer
   * gone to the keyboard, the cursor stays as it was until it moves.
   */
  #aim(shown: Inspection | undefined): void {
    const pointer = this.#pointer;
    const host = this.#host;
    const acts =
      !!pointer && !this.#touch && !this.#press?.moved && !this.#tap?.moved && this.#clicksAct();
    // What it is on is read once picking is here (a load draws again).
    if (acts) this.needPicking();
    if (!acts || !this.#picking) {
      // Holds no scene it no longer reads.
      this.#on = null;
      if (pointer) this.#pointing = false;
    } else {
      let on = this.#on;
      if (
        !on ||
        on[0] !== host.scene() ||
        on[1] !== host.model.items?.transitionItems ||
        on[2] !== pointer
      )
        this.#pointed(pointer!);
      on = this.#on!;
      this.#pointing = on[4] ??= this.#acts(on[3], pointer!.x, pointer!.y, shown);
    }
    this.#setCursor();
  }

  /** After a drag, which shows no pointer cursor: a frame shows it where the pointer rests. */
  #aimAgain(): void {
    if (this.#clicksAct()) this.#host.schedule();
  }

  /**
   * Which of `panel`'s drag bindings a press at (x, y) takes: the chart's
   * own; one that edits the brush only on it, which moves or resizes it.
   */
  #takes(panel: DrawnPanel, x: number, y: number): (action: Binding["action"]) => boolean {
    return (a) => OWN(a) && (a.type !== "editBrush" || !!this.#brushAt(panel, x, y));
  }

  /** What the pointer is on (`#targetAt`), noted for the cursor (see `#on`). */
  #pointed(pointer: { x: number; y: number }): Target | undefined {
    const target = this.#targetAt(pointer.x, pointer.y, this.#over);
    const host = this.#host;
    if (this.#picking)
      this.#on = [host.scene(), host.model.items?.transitionItems, pointer, target];
    return target;
  }

  /** Sets the root's cursor where the chart's choice changed: a rule's, the pointer, or none. */
  #setCursor(): void {
    const cursor = this.#ruleCursor || (this.#pointing ? "pointer" : "");
    if (cursor === this.#cursor) return;
    this.#cursor = cursor;
    this.#host.root.style.cursor = cursor;
  }

  /**
   * Whether a click at (x, y) on `target` acts, as `#clicked` decides: it
   * selects rows where a row selection takes clicks, else drills or
   * selects the item or its series; and where it does not drill, pins the
   * item, with what `shown` reads (the pointer's inspection). Clicks off
   * the data, which clear, do not count; off the panels, a press clicks
   * only on an axis label, and in one, none whose drag moves the
   * crosshair cursor (see the pointerdown handler).
   */
  #acts(target: Target | undefined, x: number, y: number, shown: Inspection | undefined): boolean {
    const host = this.#host;
    if (!host.model.layout && !this.#onItems(x, y)) {
      const panel = this.#panelAt(x, y);
      // As a press with the mouse and no key held.
      const press = { ...UNMODIFIED, button: 0, pointerType: "mouse" };
      if (
        panel
          ? this.#bindingsIn(panel).match("drag", press, this.#takes(panel, x, y))?.action.type ===
            "cursor"
          : !this.#axisLabel(x, y)
      )
        return false;
    }
    const select = host.options().interaction?.select;
    const rows = select ? undefined : host.rows()?.clicks(x, y);
    if (rows === undefined && this.#drills(target, x, y)) return true;
    if (target?.kind !== "item") return !!rows;
    return (
      !!rows ||
      select === "items" ||
      (select === "series" && target.series !== undefined) ||
      (this.#pinsByClick() && !!this.#pinOf(target, () => shown))
    );
  }

  get keyboard(): KeyboardCursor | null {
    return this.#keyboard;
  }

  /** The panels a brush being dragged would select in: those drawing its instances. */
  get dragged(): readonly string[] | undefined {
    const press = this.#press;
    if (press?.mode !== "brush" && press?.mode !== "edit") return undefined;
    // The panels drawing its instances: y is the right one's in a panel without a left.
    const scales = shapeScales(this.#shape(press)).map((scale) =>
      scale === "y" && !press.panel.drawsY ? "yRight" : scale,
    );
    return this.#host.model
      .panels()
      .filter((panel) =>
        scales.every(
          (scale) =>
            panel[`${scale}Group`] === press.panel[`${scale}Group`] &&
            (scale === "x" || (scale === "y" ? panel.drawsY : panel.yRight)),
        ),
      )
      .map(({ key }) => key);
  }

  /** The shape a press brushes: its binding's, else its panel's `interaction.brush`. */
  #shape({ action, panel }: Press): BrushSpec {
    const shape = action?.type === "brush" ? action.shape : undefined;
    return shape ?? shapeOf(this.#host.model.interactionOf(panel.key)?.brush) ?? "x";
  }

  /**
   * Ends a gesture changing `state` (the chart's options set it anew), as
   * a change of `cause`: a brush drawn, moved, or resized reports `cancel`.
   */
  end(state: "selection" | "viewport" | "visibility" | "drillRoot", cause: ChangeCause): void {
    const mode = this.#press?.mode;
    if (
      state === "selection"
        ? mode === "brush" || mode === "edit"
        : state === "viewport" && mode === "pan"
    )
      this.#cancelPress(false, cause);
  }

  /** The chart's brush in `panel`, and what a press at a pixel would move of it, when it is on it. */
  #brushAt(panel: DrawnPanel, x: number, y: number) {
    const host = this.#host;
    const selection = host.selection();
    const brush = host.brush();
    const shown = selection?.kind === "brush" && host.owner()?.panels.includes(panel.key);
    const handle = shown ? brush?.handleAt(x, y, selection, panel) : undefined;
    return handle && { brush: brush!, selection: selection as BrushSelection, handle };
  }

  /**
   * Reports what a brush being drawn, moved, or resized selects now, when
   * that changed since it last did: once a frame. Brushes that zoom when
   * released select nothing, and report nothing.
   */
  #preview(): void {
    const press = this.#press;
    const brush = this.#host.brush();
    if (!press?.moved || !brush?.dragging) return;
    if (press.mode !== "edit" && (press.mode !== "brush" || this.#zoomsOnRelease(press))) return;
    const selection = brush.current();
    const shown = JSON.stringify(selection);
    if (shown === (press.previewed ?? "null")) return;
    press.previewed = shown;
    this.#host.preview(selection, press.panel, "preview", "pointer");
  }

  /** Whether a press's brush zooms to its ranges on release rather than selecting them. */
  #zoomsOnRelease(press: Press): boolean {
    return press.action?.type === "brush" && !!press.action.zoom;
  }

  /**
   * The bindings of `panel`: a subplot's own settings' (`PanelSpec.interaction`),
   * else the chart's.
   */
  #bindingsIn(panel: DrawnPanel | undefined): Bindings {
    return (panel && this.#own.get(panel.key)) ?? this.#bindings;
  }

  /** Pending while the crosshair labels, the tooltip's content, or picking load. */
  get loading(): Promise<unknown>[] {
    return [this.#crosshairLoading, this.#content, this.#pickingLoad].filter(
      (loading) => loading !== undefined,
    );
  }

  /** Throws for bindings of `options` it would refuse, as `configure` does, changing nothing. */
  check(options: ChartOptions): void {
    bindingsOf(options);
  }

  /**
   * Pins the tooltip at `at`, or lets it go (null), as `cause` asks: state
   * support's `pin`. Before a frame shows where, and picking has loaded to
   * name items, the pin waits for them (see `draw`). Throws for a place
   * the chart does not draw.
   */
  pin(at: PinTarget | null, cause: ChangeCause): void {
    if (at && (!this.#host.scene() || !this.#picking)) {
      this.#pinLater = { at, cause };
      this.needPicking();
      this.#host.schedule();
      return;
    }
    this.#pinLater = undefined;
    this.#setPin(at && this.#pinAt(at), cause);
  }

  /**
   * Makes a pin asked for before it could be made (see `pin`). One at
   * nothing the chart reads, or draws, is let go, said so, as `pinned`
   * said it was asked for.
   */
  #pinAsked(asked: { at: PinTarget | null; cause: ChangeCause }): void {
    const host = this.#host;
    const had = this.#pin;
    try {
      this.pin(asked.at, asked.cause);
    } catch (error) {
      this.#pinLater = undefined;
      host.report(error, "compile");
    }
    if (asked.at && !had && !this.#pin && !this.#pinLater && !this.#disposed)
      host.events.emit("pin", {
        at: null,
        inspection: undefined,
        cause: asked.cause,
        revision: host.count(),
      });
  }

  /** Where the tooltip is pinned, or asked to be. */
  get pinned(): PinTarget | null {
    return this.#pinLater ? this.#pinLater.at : (this.#pin?.at ?? null);
  }

  /** Whether a pin asked for waits for a frame (see `pin`). */
  get waiting(): boolean {
    return this.#pinLater !== undefined;
  }

  /** Whether a click or Enter pins the tooltip (`tooltip.pin`). */
  #pinsByClick(): boolean {
    const { tooltip } = this.#host.options();
    return typeof tooltip === "object" && tooltip.pin === "click";
  }

  /** A pin at a place the application names (see `PinTarget`); throws for one the chart does not draw. */
  #pinAt(at: PinTarget): Pin {
    const { model } = this.#host;
    const all = model.allPanels();
    const names = all.map(({ key }) => JSON.stringify(key)).join(", ");
    const panel = at.panel ?? (all.length === 1 ? all[0]!.key : undefined);
    if (panel === undefined || !all.some(({ key }) => key === panel))
      throw new RangeError(
        panel === undefined
          ? `pin panel: the chart has several panels; give one of ${names}`
          : `pin panel: ${JSON.stringify(panel)} is no panel of the chart; panels are ${names}`,
      );
    if ("item" in at) {
      const pin = this.#itemPin(at.item as string, panel);
      if (!pin)
        throw new RangeError(
          `pin item: ${JSON.stringify(at.item)} is no item the chart draws; give a key from an event`,
        );
      return pin;
    }
    const { value } = at;
    if (typeof value !== "string" && !Number.isFinite(value))
      throw new TypeError(
        `pin value: expected a finite number or a category's name; received ${String(value)}`,
      );
    const axis = at.axis ?? this.#pinAxis(panel, this.#cursorAxis());
    const scale = model.panels().find(({ key }) => key === panel)?.[axis];
    if (!scale)
      throw new RangeError(
        `pin axis: panel ${JSON.stringify(panel)} has no ${JSON.stringify(axis)} axis; pin an item there`,
      );
    // Categories by name, which data changes do not move.
    const name = typeof value === "number" ? scale.categories?.[value] : value;
    return { at: { value: name ?? value, axis, panel } };
  }

  /**
   * A pin at the item keyed `key` in `panel`: a layout mark's, or one of
   * its mark's series' there, found by the rows the key names, or for an
   * aggregate, item by item. Undefined where none is drawn.
   */
  #itemPin(key: string, panel: string): Pin | undefined {
    const { model } = this.#host;
    if (model.inspectItem(key, panel))
      return this.#anchored({ panel, key, position: 0 }, undefined, key);
    let named: unknown;
    try {
      [named] = JSON.parse(key) as unknown[];
    } catch {
      return undefined;
    }
    const marks = model.config.marks as readonly Mark[];
    const mark = marks.find((m, i) => (m.spec.id ?? i) === named);
    if (!mark) return undefined;
    const series = this.#stops(panel).filter((s) => model.markOf(s) === mark);
    const names = (cursor: KeyboardCursor) => this.#keyboardTarget(cursor)?.item === key;
    const { table } = mark;
    if (table && !mark.summarizes && mark.tooltip !== "cell") {
      for (const row of this.#items().rowsOf(key, table)) {
        const item = rowItem(table, row);
        for (const s of series) {
          const cursor = this.#itemNow({ panel, key: s.key, position: 0 }, item);
          if (cursor && names(cursor)) return this.#anchored(cursor, item, key);
        }
      }
      return undefined;
    }
    for (const s of series)
      for (let position = 0; position < s.length; position++) {
        const cursor = { panel, key: s.key, position };
        if (names(cursor)) return this.#anchored(cursor, this.#keyedItem(cursor), key);
      }
    return undefined;
  }

  /**
   * A pin of the item the keyboard's kind of cursor `cursor` is on (keyed
   * `key`, `item` naming what it is on): of the item itself where the
   * inspection reads one point or reads items, else of a value along the
   * inspection's axis: the one `shown` reads where given (what a click's
   * own inspection, and so its tooltip, read), else the item's own.
   * Undefined for an item the inspection does not read.
   */
  #anchored(
    cursor: KeyboardCursor,
    item: KeyedItem | undefined,
    key: string,
    shown?: Inspection,
  ): Pin | undefined {
    const { model } = this.#host;
    const inspection = this.#keyed(cursor);
    if (!inspection) return undefined;
    const { panel } = cursor;
    const mode = model.inspectorOf(panel)?.mode;
    if (inspection.axis === "item" || mode === "nearest")
      return { at: { item: key, panel }, cursor, item, seen: this.#host.drawnRevision() };
    // Its value along the axis the chart inspects along, which may not be its mark's own.
    const axis = this.#pinAxis(panel, inspection.axis);
    // Cells, points placed off that axis, and the right axis' points beside a left axis (whose
    // values a pin along y reads, even with its series hidden) are read where they are.
    const series = this.#stops(panel).find(({ key }) => key === cursor.key);
    const mark = series && model.markOf(series);
    const drawn = model.panels().find(({ key }) => key === panel);
    if (
      !mark ||
      !drawn ||
      mark.tooltip === "cell" ||
      (mark.place && mark.tooltip !== axis) ||
      (mark.bound?.[axis] !== undefined && mark.bound[axis]!.kind !== "axis") ||
      (axis === "y" && mark.spec.axis === "right" && drawn.drawsY)
    )
      return undefined;
    const scale = drawn[axis];
    // A line picked within reach of the pointer may be at another row than the one read there.
    const reads = shown?.axis === inspection.axis ? shown : inspection;
    let at = reads.value;
    if (axis !== reads.axis) {
      const point = reads.points.find((p) => p.key === cursor.key) ?? reads.points[0];
      at = point && scale ? scale.invert(axis === "x" ? point.px : point.py) : Number.NaN;
      if (scale?.categories) at = Math.round(at);
      if (!Number.isFinite(at)) return undefined;
    }
    const value = scale?.categories?.[at] ?? at;
    // An item the inspection at that value does not read pins nothing.
    const [read] = this.#cursorAt(value, axis, undefined, [drawn]);
    if (!read?.points.some((p) => p.key === cursor.key)) return undefined;
    return { at: { value, axis, panel } };
  }

  /** The axis a pin of a value in `panel` is along: the one its inspection follows, else `axis`. */
  #pinAxis(panel: string, axis: "x" | "y"): "x" | "y" {
    const mode = this.#host.model.inspectorOf(panel)?.mode;
    return mode === "nearest-y" ? "y" : mode === "nearest-x" ? "x" : axis;
  }

  /**
   * The keyboard's kind of cursor on an item target, and what it is on: a
   * layout mark's item by its key, an aggregate at the point it stands
   * for, a row in the series the inspection reads, where the pick or the
   * keyboard cursor found it drawn, else as `itemAt` finds it (the series
   * read may leave out rows drawn: a rug's off a log axis); undefined for
   * items of no series (annotations).
   */
  #cursorOf(target: ItemTarget): [KeyboardCursor, KeyedItem | undefined] | undefined {
    const { panel, item } = target;
    const drawn = this.#drawnAt.get(target);
    const table = (this.#host.model.config.marks[target.mark] as Mark | undefined)?.table;
    if (drawn && table) {
      const { series, position } = drawn;
      const keyed = rowItem(table, this.#kit.rowOf(series, position));
      const cursor = this.#itemNow({ panel, key: series.key, position }, keyed);
      return cursor ? [cursor, keyed] : undefined;
    }
    const point = this.#points.get(target);
    if (point) {
      const cursor = { panel, key: point.series.key, position: point.position };
      return [cursor, this.#keyedItem(cursor)];
    }
    return target.series === undefined && this.#host.model.inspectItem(item, panel)
      ? [{ panel, key: item, position: 0 }, undefined]
      : undefined;
  }

  /**
   * What a click or Enter on `target`, captured now, makes of the pinned
   * tooltip as it acts (in order with other input, after listeners of what
   * acted before it), where the chart pins by click: a pin at an item the
   * inspection reads, or letting it go (null) on a plot where no item is,
   * on an item it does not pin (a region), and on what it shows.
   * Undefined where it changes nothing: elsewhere, and once the options
   * no longer pin by click or inspect as they did.
   */
  #clickPin(
    target: Target | undefined,
    shown: () => Inspection | undefined,
  ): () => Pin | null | undefined {
    if (!this.#pinsByClick() || (target?.kind !== "item" && target?.kind !== "plot"))
      return () => undefined;
    const pin = target.kind === "item" ? this.#pinOf(target, shown) : null;
    const mode = this.#pinMode;
    return () =>
      !this.#pinsByClick() || this.#pinMode !== mode
        ? undefined
        : pin && JSON.stringify(pin.at) === JSON.stringify(this.#pin?.at)
          ? null
          : pin;
  }

  /**
   * The pin a click on `target` makes, at the item where the inspection
   * `shown` gives (what the click reads) reads it; null for an item it
   * does not pin.
   */
  #pinOf(target: ItemTarget, shown: () => Inspection | undefined): Pin | null {
    const at = this.#cursorOf(target);
    return (at && this.#anchored(...at, target.item, shown())) ?? null;
  }

  /**
   * Pins the tooltip (`pin`), or lets it go (null), and reports it: a pin
   * takes the pointer, and from the keyboard the focus, once drawn; let go
   * while it has the focus, the focus goes back to the chart.
   */
  #setPin(pin: Pin | null, cause: ChangeCause): void {
    const host = this.#host;
    // A listener may have destroyed the chart.
    if (this.#disposed) return;
    const same = pin && JSON.stringify(pin.at) === JSON.stringify(this.#pin?.at);
    // What a new pin shows, found first: one at what is gone lets the one there go.
    const found = pin && !same ? this.#pinFound(pin) : undefined;
    if (found === null) pin = null;
    // A pin where it is changes nothing.
    if (!pin && !this.#pin) return;
    this.#pin = pin;
    if (same) return;
    const { element } = this.#tooltip;
    element.style.pointerEvents = pin ? "auto" : "none";
    if (pin) {
      // Its content is read and reached now, as the live region no longer says it.
      element.removeAttribute("aria-hidden");
      element.setAttribute("role", "group");
      element.setAttribute("aria-label", "Pinned tooltip");
      element.tabIndex = -1;
      this.#focusPin = cause === "keyboard";
    } else {
      // The focus goes back to the chart before its place in the tooltip goes.
      const page = element.getRootNode() as Document | ShadowRoot;
      if (element.contains(page.activeElement)) host.root.focus({ preventScroll: true });
      element.setAttribute("aria-hidden", "true");
      element.removeAttribute("role");
      element.removeAttribute("aria-label");
      element.removeAttribute("tabindex");
    }
    this.#watchOutside(!!pin);
    const revision = host.count();
    host.schedule();
    host.events.emit("pin", {
      at: pin?.at ?? null,
      inspection: found ?? undefined,
      cause,
      revision,
    });
  }

  /**
   * What the pinned tooltip shows now (see `#pinFound`); lets the pin go
   * (cause "data") once what it is at is gone.
   */
  #pinned(): Inspection | undefined {
    const pin = this.#pin;
    const found = pin ? this.#pinFound(pin) : undefined;
    if (found === null) this.#setPin(null, "data");
    return found ?? undefined;
  }

  /**
   * What `pin` shows now: its item, found again once options or data
   * changed, or every series at its value; undefined while hidden (out of
   * view); null once its item, panel, or category is gone, or nothing
   * reads at its value in view.
   */
  #pinFound(pin: Pin): Inspection | undefined | null {
    const host = this.#host;
    const { model } = host;
    const { at } = pin;
    if (pin.cursor) {
      // Found in the frame drawn: a change since is found again once drawn.
      const revision = host.drawnRevision();
      if (pin.item && pin.seen !== revision) {
        // Found again by its key, which may name another row (a reset, an
        // item key moved); the row it stood at is no more than a guess.
        const now = this.#itemPin((at as { item: string }).item, pin.cursor.panel);
        if (!now?.cursor) return null;
        pin.cursor = now.cursor;
        pin.item = now.item;
      }
      pin.seen = revision;
      const inspection = this.#keyed(pin.cursor);
      // A layout mark's item no longer in its layout is gone; a row's out of view is hidden.
      const layout = model
        .drawnMarks()
        .find((d) => d.layout && d.panel === pin.cursor!.panel)?.layout;
      if (!inspection && !pin.item && (!layout || layout.indexOf(pin.cursor.key) < 0)) return null;
      if (!inspection) return undefined;
      // A series' item zoomed out of the plot is hidden, as values out of view are.
      const plot =
        inspection.axis !== "item" &&
        model.panels().find(({ key }) => key === pin.cursor!.panel)?.plot;
      const inside = ({ px, py }: { px: number; py: number }) =>
        !!plot &&
        px >= plot.x &&
        px <= plot.x + plot.width &&
        py >= plot.y &&
        py <= plot.y + plot.height;
      return plot && !inspection.points.some(inside) ? undefined : inspection;
    }
    const {
      value,
      axis = "x",
      panel,
    } = at as { value: number | string; axis?: "x" | "y"; panel: string };
    const drawn = model.panels().find(({ key }) => key === panel);
    const scale = drawn?.[axis];
    if (!drawn || !scale || (typeof value === "string" && !scale.categories?.includes(value)))
      return null;
    const px = scale.map(typeof value === "string" ? scale.categories!.indexOf(value) : value);
    const { plot } = drawn;
    const [from, length] = axis === "x" ? [plot.x, plot.width] : [plot.y, plot.height];
    if (!(px >= from && px <= from + length)) return undefined;
    const [inspection] = this.#cursorAt(value, axis, undefined, [drawn]);
    return inspection ?? null;
  }

  /**
   * Listens for presses outside the chart while a pin is pinned (`on`), or
   * stops. A press in a shadow root reaches the root around it as one on
   * its host, so the chart's root and every shadow root around it judge
   * presses, out to the document: each by what it sees of the chart.
   */
  #watchOutside(on: boolean): void {
    for (const target of this.#outsideOn)
      target.removeEventListener("pointerdown", this.#outside!, true);
    this.#outsideOn = [];
    if (!on) return;
    const { root } = this.#host;
    const roots: (Document | ShadowRoot)[] = [];
    for (let node = root.getRootNode(); node instanceof ShadowRoot; node = node.host.getRootNode())
      roots.push(node);
    roots.push(root.ownerDocument);
    this.#outside ??= (event) => {
      const around = this.#outsideOn as readonly (Document | ShadowRoot)[];
      const k = around.indexOf(event.currentTarget as Document | ShadowRoot);
      // The chart in its own root; the host of the shadow root that holds it in the others.
      const inside = k > 0 ? (around[k - 1] as ShadowRoot).host : root;
      if (!event.composedPath().includes(inside)) this.#setPin(null, "pointer");
    };
    this.#outsideOn = roots;
    for (const target of roots) target.addEventListener("pointerdown", this.#outside, true);
  }

  /** Whether `event`'s pointer is another than the one dragging a rule, which it leaves alone. */
  #besideRule(event: PointerEvent): boolean {
    const rule = this.#press?.rule;
    return !!rule && rule.pointer !== event.pointerId;
  }

  /** Whether an event's target is content that takes its own input: the pinned tooltip's, or an anchor. */
  #onContent(target: EventTarget | null): boolean {
    return (
      (!!this.#pin && this.#tooltip.element.contains(target as Node)) || this.#inAnchor(target)
    );
  }

  /** Whether an event's target is in an anchor (dom/anchors.ts), whose input is the application's. */
  #inAnchor(target: EventTarget | null): boolean {
    return !!this.#host.anchors()?.contains(target as Node);
  }

  /**
   * Whether an event is of a finger not the chart's (see `#fingers`),
   * whatever it is over now. (A mouse's or pen's events are of the press it
   * has, or of none.)
   */
  #stray(event: PointerEvent): boolean {
    return event.pointerType === "touch" && !this.#fingers.has(event.pointerId);
  }

  /** The rule with `drag` within reach of (x, y), picked with the reach of `event`'s pointer. */
  #ruleAt(x: number, y: number, event: PointerEvent): DraggedRule | undefined {
    const picked = this.#pressing(event, () =>
      this.#pick(x, y, (mark) => !!(mark.spec as { drag?: boolean }).drag),
    );
    if (!picked) return undefined;
    const marks = this.#host.model.config.marks as readonly Mark[];
    const index =
      typeof picked.key === "number"
        ? picked.key
        : marks.findIndex(({ spec }) => spec.id === picked.key);
    const mark = marks[index]!;
    const spec = mark.spec as { x?: number; y?: number; axis?: string; id?: string };
    const axis = spec.x !== undefined ? "x" : "y";
    return {
      mark,
      pointer: event.pointerId,
      index,
      id: spec.id,
      key: this.#itemTarget(picked).item,
      axis,
      scale: axis === "y" && spec.axis === "right" ? "yRight" : axis,
      from: Number(spec[axis]),
    };
  }

  /**
   * The mark a rule being dragged is now, as the chart's options have it;
   * undefined once gone, or made along another axis or scale, or in
   * another panel, which makes it another rule.
   */
  #ruleNow(rule: DraggedRule): Mark | undefined {
    const marks = this.#host.model.config.marks as readonly Mark[];
    const mark =
      rule.id === undefined ? marks[rule.index] : marks.find(({ spec }) => spec.id === rule.id);
    type Placed = { drag?: boolean; x?: unknown; axis?: string; panel?: string } | undefined;
    const [now, was] = [mark?.spec as Placed, rule.mark.spec as Placed];
    return now?.drag &&
      (now.x !== undefined) === (rule.axis === "x") &&
      now.axis === was?.axis &&
      now.panel === was?.panel
      ? mark
      : undefined;
  }

  /**
   * Draws a rule being dragged at the pointer's value along its axis,
   * kept in the plot: it is the chart's to draw there until it is dropped
   * (`Mark.moved`), the application's value its to set.
   */
  #moveRule(press: Press, x: number, y: number): void {
    const rule = press.rule!;
    const mark = this.#ruleNow(rule);
    const scale = this.#still(press.panel) && press.panel[rule.scale];
    if (!mark || !scale) {
      this.#cancelPress(false, "options");
      return;
    }
    const { plot } = press.panel;
    const at =
      rule.axis === "x"
        ? Math.min(Math.max(x, plot.x), plot.x + plot.width)
        : Math.min(Math.max(y, plot.y), plot.y + plot.height);
    // Options may have made it another mark since: the one drawn now is moved.
    this.#handOver(rule, mark);
    rule.at = scale.invert(at);
    mark.moved?.set(this.#host.model, rule.at);
    this.#host.invalidate();
  }

  /** Moves a dragged rule's preview to `mark`, the one the options draw for it now, keeping the pointer. */
  #handOver(rule: DraggedRule, mark: Mark): void {
    if (rule.mark === mark) return;
    rule.mark.moved?.delete(this.#host.model);
    rule.mark = mark;
    if (rule.at !== undefined) mark.moved?.set(this.#host.model, rule.at);
  }

  /**
   * A rule dropped where the pointer let go (where it was last, for a
   * release that went elsewhere): reported as a commit, then drawn, from
   * the next frame, where its options put it, which listeners may have
   * changed (accepted), left (rejected), or taken away.
   */
  #dropRule(press: Press, x?: number, y?: number): void {
    const rule = press.rule!;
    // Options or data that took its rule or its panel since send it back, as while held.
    if (!this.#ruleNow(rule) || !(this.#still(press.panel) && press.panel[rule.scale])) {
      this.#cancelPress(false, "options", press);
      return;
    }
    if (x !== undefined && y !== undefined) this.#moveRule(press, x, y);
    if (rule.at === undefined) return;
    this.#reportRule(rule, "commit", "pointer", rule.at);
    this.#letGo(rule);
  }

  /** Draws a rule dragged where its options put it again, and lets the pointer go. */
  #letGo(rule: DraggedRule): void {
    rule.mark.moved?.delete(this.#host.model);
    const { root } = this.#host;
    if (root.hasPointerCapture?.(rule.pointer)) root.releasePointerCapture(rule.pointer);
    this.#host.invalidate();
  }

  /** What a rule being dragged shows, reported once a frame when it moved since. */
  #previewRule(): void {
    const rule = this.#press?.rule;
    if (rule?.at === undefined || rule.at === rule.reported) return;
    rule.reported = rule.at;
    this.#reportRule(rule, "preview", "pointer", rule.at);
  }

  /** An `itemMove` of a rule being dragged: at `value` along its axis, undefined for a rule gone. */
  #reportRule(
    rule: DraggedRule,
    phase: Phase,
    cause: ChangeCause,
    value: number | undefined,
  ): void {
    const { panel } = rule;
    this.#host.events.emit("itemMove", {
      key: rule.key,
      markId: rule.id,
      position: value === undefined ? null : { [rule.axis]: value },
      phase,
      cause,
      revision: this.#host.drawnRevision(),
      ...(rule.scale === "yRight" && { axis: "right" }),
      ...(panel !== undefined && { panels: [panel] }),
    });
  }

  /**
   * Follows the chart's options, loading what they ask for; throws, before
   * changing anything, for bindings it refuses (a gesture bound twice, a key
   * the cursor takes).
   */
  configure([bindings, own]: Compiled = bindingsOf(this.#host.options())): void {
    const host = this.#host;
    const options = host.options();
    this.#bindings = bindings;
    this.#own = own;
    // A drag or a pinch its panel's settings no longer bind ends.
    const bound = (panel: DrawnPanel, action: Binding["action"]) =>
      this.#bindingsIn(panel).list.some(
        (binding) => JSON.stringify(binding.action) === JSON.stringify(action),
      );
    const press = this.#press;
    if (press?.action && !bound(press.panel, press.action)) this.#cancelPress();
    const pinch = this.#pinch;
    if (pinch && !bound(pinch.panel, pinch.action)) this.#pinch = null;
    host.root.style.touchAction = this.#touchPolicy();
    this.#draggable = options.marks.some((mark) => (mark.spec as { drag?: boolean }).drag);
    if (!this.#draggable) this.#ruleCursor = "";
    // A rule being dragged that the options no longer have goes back; one
    // they made again (an equal mark) goes on being dragged.
    const now = press?.rule && this.#ruleNow(press.rule);
    if (now) this.#handOver(press!.rule!, now);
    else if (press?.rule) this.#cancelPress(false, "options");
    // A pin of one inspection's mode means nothing in another.
    const mode = options.inspection === false ? false : options.inspection?.mode;
    if (this.#pin && mode !== this.#pinMode) this.#setPin(null, "options");
    this.#pinMode = mode;
    // Labels that failed to load are tried again.
    if (this.#crosshair === null) this.#crosshair = undefined;
    if (typeof options.tooltip === "object" && options.tooltip.axisLabels) this.#loadCrosshair();
    if (options.renderTooltip || options.marks.some((mark) => mark.spec.tooltip))
      this.#loadContent();
    // Picking that failed to load is tried again.
    if (this.#picking === null) this.#picking = undefined;
    this.needPicking();
  }

  /**
   * Loads picking once what input is on is asked for: by listeners of
   * hover, click, or contextMenu, a row selection taking clicks, pins,
   * dragged rules, or trees that drill
   * (checked as options change, as listeners are added, and as input
   * comes); at once if a chart on the page loaded it. Input it would read
   * waits for it (`#fresh`), and is resolved once it is here.
   */
  needPicking(): void {
    const host = this.#host;
    if (
      this.#picking !== undefined ||
      this.#pickingLoad ||
      (!host.rows() &&
        !host.options().interaction?.select &&
        !this.#pinsByClick() &&
        !this.#pinLater &&
        !this.#draggable &&
        !host.model.drills &&
        !(["hover", "click", "contextMenu"] as const).some((t) => host.events.has(t)))
    )
      return;
    if (picking) {
      this.#usePicking(picking);
      return;
    }
    this.#pickingLoad = loadPicking().then(
      (module) => {
        this.#pickingLoad = undefined;
        if (this.#disposed) return;
        this.#usePicking(module);
        this.#playWaiting();
        this.resolve(host.drawnRevision());
        this.draw();
      },
      (error: unknown) => {
        // Input that waited for it is dropped, a press on a rule played without it; new options try again.
        this.#pickingLoad = undefined;
        this.#picking = null;
        this.#pending = [];
        this.#playWaiting();
        host.report(error, "load");
      },
    );
  }

  /** Plays a press that waited for picking (to tell a rule's), and what followed it. */
  #playWaiting(): void {
    const waiting = this.#waiting;
    this.#waiting = null;
    for (const event of waiting ?? []) this.#handlers.get(event.type)?.(event as never);
  }

  #usePicking(module: PickModule): void {
    this.#picking = { module, picker: new module.Picker(this.#kit) };
    // Clicks that select rows pick as events do (model/selected-rows.ts).
    this.#host.model.picker = (x, y, accept) => this.#pick(x, y, accept);
  }

  /**
   * Plays input the chart held while this loaded, in order. Presses, wheels,
   * and double clicks on a layout mark's panels are its controls', which
   * were not there to take them: those are dropped, as hovers and context
   * menus are not.
   */
  play(held: readonly Event[]): void {
    // Read only for input held: measuring lays out the chart just drawn.
    if (held.length === 0) return;
    const controlled = !!this.#host.model.items?.asked().length;
    const rect = this.#host.root.getBoundingClientRect();
    for (const event of held) {
      const gesture =
        event instanceof MouseEvent && event.type !== "pointermove" && event.type !== "contextmenu";
      if (
        controlled &&
        gesture &&
        this.#onItems(event.clientX - rect.left, event.clientY - rect.top)
      )
        continue;
      this.#handlers.get(event.type)?.(event as never);
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#watchOutside(false);
    if (this.#host.model.pins === this) this.#host.model.pins = undefined;
    // A rule being dragged no longer holds its place (a mark may outlive its chart).
    this.#press?.rule?.mark.moved?.delete(this.#host.model);
    this.#pending = [];
    this.#waiting = null;
    this.#due = [];
    this.#captured = this.#heard = this.#on = null;
    for (const stop of this.#cleanup) stop();
  }

  /**
   * Resolves input against the frame just drawn, before any listener of
   * the frame can change the chart: clicks and secondary presses that
   * waited for it, and what the pointer at rest is on. Their events are
   * emitted after, as the controller draws (`#due`), with what was
   * captured here: rows named by their identities, read when asked.
   */
  resolve(revision: number): void {
    const host = this.#host;
    const scene = host.scene();
    if (!scene || !this.#fresh()) return;
    const pending = this.#pending;
    this.#pending = [];
    // Each is captured before any acts: what one click writes runs listeners.
    for (const input of pending)
      this.#due.push(
        input.type === "legend"
          ? () => host.events.emit("click", input.click)
          : input.type === "key"
            ? this.#enter(revision, this.#itemNow(input.keyboard, input.item))
            : input.type === "click"
              ? this.#clicked(input, input.event, revision, input.label)
              : this.#menu(input.x, input.y, input.event, revision),
      );
    const pointer = this.#pointer;
    this.#captured =
      pointer && host.events.has("hover") && this.#hear(scene)
        ? {
            scene,
            event: this.#stamped({
              pointer: this.#pointerAt(pointer.x, pointer.y),
              target: this.#pointed(pointer),
              inspection: this.#inspection(),
              cause: "pointer",
              revision,
            }),
          }
        : null;
  }

  /**
   * Reads what the pointer is on against the frame on screen, before any
   * chart draws or reports (see `Scheduled.read`): the hover that reports
   * it, once every chart has read. None where no one listens, the frame on
   * screen no longer shows the data (read once a frame draws it, `resolve`).
   * Keys report as they come.
   */
  read(): (() => void) | undefined {
    const host = this.#host;
    const scene = host.scene();
    if (!this.#pointer || !scene || !host.events.has("hover") || !this.#fresh()) return undefined;
    const heard = this.#hear(scene);
    const event = this.#inputEvent(this.#inspection());
    // Taken now: listeners of other charts' hovers may move the row it names.
    const key = hoverKey(event);
    // Not once a newer read reported it (a listener drew this chart since).
    return () => {
      if (this.#heard === heard && !this.#disposed) this.#hover(event, key);
    };
  }

  /** Notes that the pointer and keyboard cursor as they are now were read in `scene`. */
  #hear(scene: Scene): Heard {
    this.#heard = [scene, this.#pointer, this.#keyboard];
    return this.#heard;
  }

  /**
   * Whether what the frame on screen drew is what the chart shows now:
   * no change of options, data, or size since, which input waits for
   * (`resolve`).
   */
  #fresh(): boolean {
    const host = this.#host;
    this.needPicking();
    return (
      (this.#picking !== undefined || !this.#pickingLoad) &&
      !host.stale() &&
      host.model.drawnMarks().every((drawn) => drawn.current())
    );
  }

  /**
   * Pixels past a shape the pointer may be and still pick it: more for a
   * finger. A press resolved later reaches as its own pointer did.
   */
  #slop(): number {
    return this.#pressReach ?? (this.#touch ? 8 : 4);
  }

  /**
   * What `read` gives while what picks reaches as `event`'s pointer does,
   * leaving the reach of the pointer now as it is.
   */
  #pressing<T>(event: MouseEvent, read: () => T): T {
    const before = this.#pressReach;
    this.#pressReach = (event as PointerEvent).pointerType === "touch" ? 8 : 4;
    try {
      return read();
    } finally {
      this.#pressReach = before;
    }
  }

  /**
   * The topmost item drawn within reach of (x, y), of marks `accept` takes
   * (every one by default), of `series` only when it names one.
   */
  #pick(
    x: number,
    y: number,
    accept?: (mark: Mark) => boolean,
    series?: string,
  ): Picked | undefined {
    const query = { x, y, slop: this.#slop(), series };
    return this.#picking?.picker.pick(this.#host.model, query, accept);
  }

  /** Where (x, y) is: its panel, whether in its plot, and its values on the panel's axes. */
  #pointerAt(x: number, y: number): Pointer {
    const { model } = this.#host;
    const panels = model.panels();
    const over = this.#panelAt(x, y);
    // Off the plots of a chart of one panel, its axes still read.
    const panel =
      over ?? (panels.length === 1 && model.allPanels().length === 1 ? panels[0] : undefined);
    const values: Record<string, number> = {};
    const categories: Record<string, string> = {};
    if (panel)
      for (const axis of ["x", "y", "yRight"] as const) {
        const scale = axis === "y" && !panel.drawsY ? undefined : panel[axis];
        if (!scale) continue;
        const value = scale.invert(axis === "x" ? x : y);
        if (!Number.isFinite(value)) continue;
        values[axis] = value;
        const category = scale.categories?.[Math.round(value)];
        if (category !== undefined) categories[axis] = category;
      }
    const all = model.allPanels();
    const inItems = over
      ? undefined
      : all.find((p) => p.items && holds(p.plot, x, y) && !model.coveredAt(p.key, x, y));
    // A layout mark's panel, off its plot too in a chart of one panel.
    const items = inItems ?? (!panel && all.length === 1 && all[0]!.items ? all[0] : undefined);
    // A map's or network's plane, in its units.
    const plane = items
      ? model.drawnMarks().find((drawn) => drawn.panel === items.key && drawn.layout?.plane)?.layout
          ?.plane
      : undefined;
    if (plane) {
      values.x = plane.x.invert(x);
      values.y = plane.y.invert(y);
    }
    return {
      x,
      y,
      panel: panel?.key ?? items?.key,
      inPlot: !!over || !!inItems,
      values,
      categories,
    };
  }

  /**
   * What (x, y) is on: a legend entry (`element` the event's target), an
   * item, an axis label, or a plot; undefined over nothing input addresses.
   */
  #targetAt(x: number, y: number, element?: EventTarget | null): Target | undefined {
    const entry = this.#legendEntry(element);
    if (entry !== undefined) return entry ?? undefined;
    if (!this.#picking) return undefined;
    const picked = this.#pick(x, y);
    if (picked) return this.#itemTarget(picked);
    const label = this.#axisLabel(x, y);
    if (label) return label;
    const { model } = this.#host;
    const panel = model
      .allPanels()
      .find(({ key, plot }) => holds(plot, x, y) && !model.coveredAt(key, x, y));
    return panel && { kind: "plot", panel: panel.key };
  }

  /** The item target of what was picked, its row named by identity until read. */
  #itemTarget({ drawn, key, item, series }: Picked): ItemTarget {
    const marks = this.#host.model.config.marks;
    const mark = typeof key === "number" ? key : marks.findIndex(({ spec }) => spec.id === key);
    const { part } = item;
    const target = this.#target(
      mark,
      part.kind === "group"
        ? part.key
        : this.#items().keyOfRow(key, {
            table: part.table,
            position: part.position,
            series,
          }),
      part.kind === "row" ? part : undefined,
      series?.key,
      drawn.panel,
      item.box,
    );
    if (part.kind === "group" && part.point) this.#points.set(target, part.point);
    return target;
  }

  /**
   * An item target: of mark `mark` (its index), keyed `item`, of the table
   * row `row` names (its identity taken now, its position read when asked),
   * drawn where `row.series` says in its series.
   */
  #target(
    mark: number,
    item: string,
    row: { table: Table; position: number; series?: DrawnRow | undefined } | undefined,
    series: string | undefined,
    panel: string,
    box: ItemTarget["box"],
  ): ItemTarget {
    const markId = this.#host.model.config.marks[mark]?.spec.id;
    const table = row?.table;
    const identity = row && table!.identity(row.position);
    const generation = table?.generation;
    const target: ItemTarget = {
      kind: "item",
      mark,
      markId,
      item,
      series,
      get row() {
        const position = table ? table.positionOf(identity!, generation!) : -1;
        return position >= 0 ? position : undefined;
      },
      panel,
      box,
    };
    this.#drawnAt.set(target, row?.series);
    return target;
  }

  /** Item keys of the chart's marks (model/items.ts), for its configuration. */
  #items(): ItemResolver {
    const { marks } = this.#host.model.config;
    if (this.#resolver?.marks !== marks)
      this.#resolver = {
        marks,
        resolver: this.#picking!.module.itemResolver(
          marks.map((mark, i) => ({ mark: mark as Mark, key: (mark.spec.id ?? i) as MarkKey })),
        ),
      };
    return this.#resolver.resolver;
  }

  /**
   * The legend entry `element` is in: undefined outside the legend, null
   * on the legend between its entries. For a `click`, the one it was on.
   */
  #legendEntry(
    element: EventTarget | null | undefined,
    click?: Event,
  ): LegendEntryTarget | null | undefined {
    const found = this.#legendItem(element, click);
    if (!found) return found;
    const { key, label, selects, targets } = found.item;
    return {
      kind: "legendEntry",
      key,
      label,
      panel: found.guide.panel,
      references: this.#host.references(selects ?? (targets?.length ? targets : [key])),
    };
  }

  /**
   * The legend and entry `element` is in: undefined outside the legend,
   * null between its entries. For a `click`, the one it was on as the
   * legend drew it then, gone since or not (a click held while this loaded).
   */
  #legendItem(
    element: EventTarget | null | undefined,
    click?: Event,
  ): LegendClick | null | undefined {
    const clicked = click && this.#host.legendClicks.get(click);
    if (clicked) return clicked;
    const legend = this.#host.legend;
    if (!(element instanceof Node) || !legend.contains(element)) return undefined;
    const button = (element instanceof Element ? element : element.parentElement)?.closest(
      "button",
    );
    const scene = this.#host.scene();
    if (!button || !scene) return null;
    // Buttons are in the order of the legends' entries (dom/legend.ts).
    const at = [...legend.querySelectorAll("button")].indexOf(button);
    let k = 0;
    for (const guide of scene.guides) {
      if (guide.kind !== "legend") continue;
      for (const item of guide.entries) if (k++ === at) return { guide, item };
    }
    return null;
  }

  /**
   * A legend entry's `select` action (a legend's own hides): selects the
   * series it names, alone; with `add` (Shift), added to the series
   * selected, or taken out where they all are; pressed again as the only
   * ones selected, none.
   */
  #legendSelect(click: MouseEvent, add: boolean, cause: ChangeCause): void {
    const found = this.#legendItem(click.target, click);
    if (found?.guide.action !== "select") return;
    const host = this.#host;
    const [kind, keys] = this.#legendNames(found.item.selects ?? found.item.key);
    const held = this.#heldOf(kind);
    const all = keys.length > 0 && keys.every((key) => held.includes(key));
    const next = add
      ? all
        ? held.filter((key) => !keys.includes(key))
        : [...new Set([...held, ...keys])]
      : all && held.length === keys.length
        ? []
        : keys;
    const sorted = [...next].sort();
    host.select(
      next.length === 0
        ? null
        : kind === "series"
          ? { kind, series: sorted }
          : { kind, items: sorted },
      undefined,
      cause,
    );
  }

  /** The keys of the series or items the selection holds, where it is of `kind`. */
  #heldOf(kind: "series" | "items"): readonly string[] {
    const current = this.#host.selection();
    if (current?.kind === "series" && kind === "series") return current.series as readonly string[];
    if (current?.kind === "items" && kind === "items") return current.items as readonly string[];
    return [];
  }

  /**
   * What a legend entry's targets name (`legendMembers`): the series they
   * stand for, or where they name none, the layout marks' items that stand
   * for them (a pie's slices).
   */
  #legendNames(targets: string | readonly string[]): ["series" | "items", string[]] {
    const { series, items } = this.#host.members([targets].flat());
    return series.length > 0 ? ["series", series] : ["items", items];
  }

  /**
   * Says what pressing the entries of legends that do not hide does: in a
   * legend that selects, pressed while their series are selected (and the
   * others faded while some are); in one that does nothing, nothing.
   */
  #legendStates(scene: Scene): void {
    // Frames of the cursor alone change neither the legends nor the selection.
    const selection = this.#host.selection();
    if (scene === this.#legendsDrawn[0] && selection === this.#legendsDrawn[1]) return;
    this.#legendsDrawn = [scene, selection];
    const legends = scene.guides.filter((guide): guide is LegendGuide => guide.kind === "legend");
    const actions = JSON.stringify(legends.map(({ action }) => action));
    const changed = actions !== this.#legendActions;
    this.#legendActions = actions;
    if (!changed && !legends.some(({ action }) => action !== undefined && action !== "hide"))
      return;
    const buttons = this.#host.legend.querySelectorAll("button");
    let k = 0;
    for (const { action, entries } of legends)
      for (const item of entries) {
        const button = buttons[k++];
        if (!button) continue;
        if (action === undefined || action === "hide") {
          // Hiding again: pressed and titled as the legend draws entries that hide.
          if (changed) {
            button.setAttribute("aria-pressed", item.mixed ? "mixed" : String(!item.hidden));
            button.title = `${item.hidden || item.mixed ? "Show" : "Hide"} ${item.label}`;
            button.style.opacity = "";
          }
          continue;
        }
        if (action === false) {
          button.removeAttribute("aria-pressed");
          button.removeAttribute("title");
          button.style.opacity = "";
          continue;
        }
        const [kind, keys] = this.#legendNames(item.selects ?? item.key);
        const chosen = new Set(this.#heldOf(kind));
        const on = keys.length > 0 && keys.every((key) => chosen.has(key));
        button.setAttribute("aria-pressed", String(on));
        button.title = `${on ? "Deselect" : "Select"} ${item.label}`;
        button.style.opacity = chosen.size > 0 && !on ? String(HIDDEN_ENTRY) : "";
      }
  }

  /**
   * The tick label at (x, y): of axes the guides list, the boxes their
   * guide laid out; of automatic axes, those of their labels as drawn.
   */
  #axisLabel(x: number, y: number): AxisLabelTarget | undefined {
    const host = this.#host;
    const scene = host.scene();
    // Labels are measured as the chart measures text (as its frames do).
    const measure = host.model.drawnMarks().find(({ frame }) => frame)?.frame?.measure;
    if (!scene || !measure || !this.#picking) return undefined;
    for (const panel of scene.panels) {
      const drawn = host.model.panels().find(({ key }) => key === panel.key);
      for (const axis of panel.axes) {
        const scale = drawn?.[axis.scale as "x" | "y" | "yRight"];
        const boxes =
          axis.labelBoxes ?? (axis.layers ? [] : labelBoxes(axis, measure, this.#picking!.module));
        for (const { layer, value, category, text, box } of boxes)
          if (holds(box, x, y))
            return {
              kind: "axisLabel",
              panel: panel.key,
              scale: axis.scale,
              layer,
              value,
              category: category ?? scale?.categories?.[value],
              text,
              box,
            };
      }
    }
    return undefined;
  }

  /**
   * The keyboard cursor's item: a layout mark's item it is on, a row of its
   * series, or an aggregate (a bin, a box) or a cell, the item drawn at its
   * point.
   */
  #keyboardTarget(keyboard = this.#keyboard): ItemTarget | undefined {
    const { model } = this.#host;
    if (!keyboard || !this.#picking) return undefined;
    const marks = model.config.marks;
    // Pins name series that share the keyboard's stops' positions too.
    const series = this.#stops(keyboard.panel).find(({ key }) => key === keyboard.key);
    const mark = series && model.markOf(series);
    if (!series || !mark) {
      // A layout mark's item: the one keyed, as its panel's record drew it.
      const drawn = model.drawnMarks().find((d) => d.layout && d.panel === keyboard.panel);
      const layout = drawn?.layout;
      const at = layout ? layout.indexOf(keyboard.key) : -1;
      const item = at < 0 ? undefined : this.#picking.module.layoutItem(drawn!, layout!.item(at));
      return (
        item &&
        this.#itemTarget({ drawn: drawn!, key: item.mark ?? drawn!.mark, item, series: undefined })
      );
    }
    const index = marks.indexOf(mark);
    const point = this.#keyedPoint(keyboard)?.points[0];
    if (!mark.table || mark.summarizes || mark.tooltip === "cell") {
      // Picked at its point, moved into the plot: a bin or a box the view
      // cuts off is picked where it shows.
      const plot = model.panels().find(({ key }) => key === keyboard.panel)?.plot;
      if (!point || !plot) return undefined;
      const x = Math.min(Math.max(point.px, plot.x), plot.x + plot.width);
      const y = Math.min(Math.max(point.py, plot.y), plot.y + plot.height);
      // The cursor's series' own, whatever other series draw over it there.
      const picked = this.#pick(x, y, (m) => m === mark, series.key);
      const part = picked?.item.part;
      const at = part?.kind === "group" ? part.point : undefined;
      // Only the cursor's own: what shows where its point moved to may be another.
      const own = at
        ? at.series.key === series.key && at.position === keyboard.position
        : x === point.px && y === point.py;
      return picked && own ? this.#itemTarget(picked) : undefined;
    }
    const row = this.#kit.rowOf(series, keyboard.position);
    return this.#target(
      index,
      this.#items().keyOfRow((mark.spec.id ?? index) as MarkKey, {
        table: mark.table,
        position: row,
        series,
      }),
      { table: mark.table, position: row, series: { series, position: keyboard.position } },
      series.key,
      keyboard.panel,
      { x: point?.px ?? 0, y: point?.py ?? 0, width: 0, height: 0 },
    );
  }

  /** Emits `event` as a hover, when what it is on, reads, or where the pointer is changed (`key`). */
  #hover(event: InputEvent, key = hoverKey(event)): void {
    if (key === this.#hovered) return;
    this.#hovered = key;
    this.#cursorCause = event.cause;
    this.#host.events.emit("hover", event);
  }

  /**
   * Draws the cursor and tooltip and reports what is hovered when it
   * changed; after a frame of the data (`frame`), views near their limits.
   */
  draw(frame = false): void {
    const host = this.#host;
    // Whether data or options changed since the scene was drawn, or since
    // this draw began, or a listener of what it reports drew another: what
    // it would inspect is gone, and the frame drawing the change inspects again.
    const [revision, inspected] = [host.revision(), host.scene()];
    const changed = () =>
      host.stale() || host.revision() !== revision || host.scene() !== inspected;
    // Whether this scene found the keyboard cursor's target gone: reported
    // once, as nothing hovered; after it the chart has no cursor of its own.
    let lost = false;
    if (frame) {
      // A new scene ends a run of Up and Down: its order is of the last one.
      this.#run = null;
      // The keyboard cursor stays on what it is on, wherever data changes
      // moved it, and stands there; where that went, there is none until
      // the next key hands it on (see `#gone`).
      const keyboard = this.#keyboard;
      if (keyboard) {
        const now = this.#itemNow(keyboard, keyboard.item);
        if (now) now.stood = standing(host.model, now.panel, now.key, now.position, this.#kit);
        else this.#gone = keyboard;
        lost = !now;
        this.#keyboard = now;
      }
      this.#framed.clear();
      for (const panel of host.model.panels()) this.#framed.set(panel.key, this.#view(panel));
      // What touches do depends on the panels drawn, which the first scene brings.
      const touch = this.#touchPolicy();
      if (host.root.style.touchAction !== touch) host.root.style.touchAction = touch;
    }
    if (frame || this.#edgesDue) {
      this.#edgesDue = false;
      this.#reportEdges();
    }
    // A reach in milliseconds needs a time axis, which only the scene drawn
    // tells: reported once for the options, until the axes it reads change.
    const asked = host.options().inspection;
    const within = asked ? asked.within : undefined;
    const axis = asked && asked.mode === "nearest-y" ? "y" : "x";
    const untimed =
      typeof within === "object" &&
      "milliseconds" in within &&
      host.model.panels().some((panel) => panel[axis] && panel[axis].type !== "time");
    if (!untimed) this.#checked = undefined;
    else if (asked !== this.#checked) {
      this.#checked = asked;
      host.report(
        new Error(`inspection.within: the ${axis} axis is not a time axis; give a number`),
        "compile",
      );
    }
    const scene = host.scene();
    if (!scene) return;
    // What was read since the last draw, kept no longer: what the hover depends on beyond
    // the scene and input (a gesture ending, listeners leaving) is read at each draw.
    const heard = this.#heard;
    this.#heard = null;
    // Input resolved as a frame drew is reported now, whatever listeners changed since.
    const due = this.#due;
    this.#due = [];
    // A listener may destroy the chart: what is left of the input goes with it.
    for (const emit of due) if (!this.#disposed) emit();
    if (this.#disposed) return;
    // What a brush or a rule being dragged shows is reported once a frame.
    this.#preview();
    this.#previewRule();
    // A pin asked for before a frame and picking could place it is made now.
    const later = this.#pinLater;
    if (later && this.#picking) this.#pinAsked(later);
    const captured = this.#captured;
    this.#captured = null;
    if (captured?.scene === scene) this.#hover(captured.event);
    // New data may move what a pointer at rest reads, and so its cursor.
    if (frame && this.#pointer) this.#sharePointer(this.#pointer.x, this.#pointer.y, true);
    // Listeners of what this frame reported: edges, the cursor shared.
    if (changed()) return;
    const { theme } = scene;
    this.#legendStates(scene);
    const panels = host.model.panels();
    // Panels without insets over them any more need no clip.
    for (const [key, clip] of this.#cuts)
      if (!scene.panels.some((panel) => panel.key === key && panel.visible)) {
        clip.remove();
        this.#cuts.delete(key);
      }
    const options = host.options();
    const showTooltip = options.tooltip ?? true;
    // The pinned tooltip, read again: a pin whose item went lets go here.
    const pinned = this.#pinned();
    if (changed()) return;
    // Hover listeners get the inspection even without the built-in tooltip,
    // which is how applications draw their own.
    const hovering = host.events.has("hover");
    const inspects = showTooltip || hovering;
    const active = inspects ? this.#inspection() : undefined;
    this.#shareKeyboard(active);
    // Over a plot where it reads nothing, the pointer's cursor is a line
    // alone; with `inspection: false`, the pointer draws none here.
    const bare = inspects && !active && options.inspection !== false ? this.#sharing() : undefined;
    const own = active ?? bare;
    // The cursor shows in the chart's other panels too (`sync.panels`). A
    // cursor another chart shares, or `showCursor` shows, shows in every
    // panel, with one tooltip when it asks for it.
    const across = this.#across(own);
    const shown = [
      ...(pinned && showTooltip ? [pinned] : []),
      ...(own ? [own, ...across] : this.#synced()),
    ];
    const sync = options.interaction?.sync;
    const acrossTips =
      typeof sync === "object" && typeof sync.panels === "object" && sync.panels.tooltip;
    const reads = ({ points }: Inspection) => points.length > 0;
    // A pinned tooltip is the only one the chart shows, none while it is out of view.
    const tips = new Set<Inspection>(
      showTooltip && this.#pin
        ? pinned
          ? [pinned]
          : []
        : showTooltip
          ? own
            ? [active, ...(acrossTips ? across : [])].filter(
                (tip): tip is Inspection => !!tip && reads(tip),
              )
            : this.#showing(host.cursor()).tooltip
              ? shown.filter(reads).slice(0, 1)
              : []
          : [],
    );
    // What the pointer or keyboard is on and reads (a cursor shown here is reported once drawn),
    // unless read in this scene since the last draw; in the scene that lost the keyboard
    // cursor's target, that nothing is hovered. Once what it is on can be read (`needPicking`).
    const mine = !!(this.#pointer || this.#keyboard);
    const read = heard?.[0] === scene && heard[1] === this.#pointer && heard[2] === this.#keyboard;
    if (hovering && (mine || lost) && !read && (this.#picking || !this.#pickingLoad)) {
      this.#hover(this.#inputEvent(active));
      if (changed()) return;
    }
    this.#aim(active);
    const { svgElement, tickLabelGap, surface } = this.#kit;
    const document = host.root.ownerDocument;
    const lines = this.#crosshairs;
    // Without the tooltip, the pointer's cursor is the application's to draw.
    const drawn = showTooltip || !own ? shown : [];
    while (lines.length < drawn.length) {
      const line = svgElement(document, "line", { "stroke-width": "1" });
      this.#dots.before(line);
      lines.push(line);
    }
    // Each inspected point's marker: its center, color, and clip.
    const dots: [number, number, string, string | undefined][] = [];
    let tipped = 0;
    this.#outline.setAttribute("visibility", "hidden");
    this.#ring.setAttribute("visibility", "hidden");
    const bounds = { width: scene.width, height: scene.height };
    for (const [i, line] of lines.entries()) {
      const inspection = drawn[i];
      if (!inspection || inspection.axis === "item") line.setAttribute("visibility", "hidden");
      if (!inspection) continue;
      // What the pointer draws in a panel stays off the insets over it.
      const target = panels.find(({ key }) => key === (inspection.panel ?? "")) ?? panels[0];
      const named = inspection.panel ?? target?.key;
      const shown = scene.panels.find(({ key }) => key === named);
      const cut = shown?.visible && this.#cut(shown.key, shown.visible);
      // Items are outlined instead of crossed, and their tooltip points at them.
      if (inspection.axis === "item") {
        if (cut) this.#outline.setAttribute("clip-path", cut);
        else this.#outline.removeAttribute("clip-path");
        this.#outline.setAttribute("d", inspection.outline);
        this.#outline.setAttribute("stroke", theme.text);
        this.#outline.setAttribute("visibility", "visible");
        const [item] = inspection.points;
        const at = { x: item!.px, y: item!.py };
        const anchor = inspection === pinned ? at : (this.#pointer ?? at);
        if (tips.has(inspection)) this.#tip(tipped++).show(inspection, theme, anchor, bounds);
        continue;
      }
      const { plot } = target!;
      const visible = shown?.visible;
      if (cut) line.setAttribute("clip-path", cut);
      else line.removeAttribute("clip-path");
      // The crosshair crosses the plot at the inspected position: a vertical
      // line for x, a horizontal one for y.
      const at = String(Math.round(inspection.position) + 0.5);
      const vertical = inspection.axis === "x";
      line.setAttribute("x1", vertical ? at : String(plot.x));
      line.setAttribute("x2", vertical ? at : String(plot.x + plot.width));
      line.setAttribute("y1", vertical ? String(plot.y) : at);
      line.setAttribute("y2", vertical ? String(plot.y + plot.height) : at);
      const { stroke, strokeWidth, opacity, dash } = theme.style.crosshair;
      line.setAttribute("stroke", stroke);
      line.setAttribute("stroke-width", String(strokeWidth));
      line.setAttribute("stroke-opacity", String(opacity));
      if (dash.length > 0) line.setAttribute("stroke-dasharray", dash.join(" "));
      else line.removeAttribute("stroke-dasharray");
      line.setAttribute("visibility", "visible");
      // A bar may end outside the plot; its marker would land on the axes.
      const inside = (point: { px: number; py: number }) =>
        (visible ?? [plot]).some(
          (box) =>
            point.px >= box.x - 0.5 &&
            point.px <= box.x + box.width + 0.5 &&
            point.py >= box.y - 0.5 &&
            point.py <= box.y + box.height + 0.5,
        );
      for (const point of inspection.points.filter(inside))
        dots.push([point.px, point.py, point.color, cut || undefined]);
      // The keyboard cursor's own point is ringed where it is in view.
      const own =
        inspection === active && !this.#pointer ? this.#keyedPoint()?.points[0] : undefined;
      const ringed = own && inside(own) ? own : undefined;
      if (ringed) {
        this.#ring.setAttribute("cx", String(ringed.px));
        this.#ring.setAttribute("cy", String(ringed.py));
        this.#ring.setAttribute("stroke", theme.text);
        if (cut) this.#ring.setAttribute("clip-path", cut);
        else this.#ring.removeAttribute("clip-path");
        this.#ring.setAttribute("visibility", "visible");
      }
      // The pointer's tooltip is at the pointer, the keyboard's at its own
      // point while in view; others' at the crosshair.
      if (tips.has(inspection)) {
        // A pin of an item points at it.
        const point =
          (inspection === pinned && this.#pin?.cursor && inspection.points[0]) || ringed;
        const anchor =
          (inspection === active && this.#pointer) ||
          (point && { x: point.px, y: point.py }) ||
          (vertical
            ? { x: inspection.position, y: plot.y + plot.height / 2 }
            : { x: plot.x + plot.width / 2, y: inspection.position });
        // The keyboard's own row is marked among those the tooltip lists.
        const row = inspection.points.findIndex(
          (p) => !!own && p.key === own.key && p.px === own.px && p.py === own.py,
        );
        this.#tip(tipped++).show(inspection, theme, anchor, bounds, row);
      }
    }
    // Markers are kept from one move to the next, their attributes rewritten.
    const markers = this.#dots.children;
    while (markers.length > dots.length) this.#dots.lastElementChild!.remove();
    dots.forEach(([cx, cy, fill, cut], i) => {
      const dot =
        markers[i] ??
        this.#dots.appendChild(svgElement(document, "circle", { r: "3.5", "stroke-width": "1.5" }));
      dot.setAttribute("cx", String(cx));
      dot.setAttribute("cy", String(cy));
      dot.setAttribute("fill", fill);
      dot.setAttribute("stroke", theme.background === "transparent" ? "#ffffff" : theme.background);
      if (cut) dot.setAttribute("clip-path", cut);
      else dot.removeAttribute("clip-path");
    });
    const tooltip = options.tooltip;
    const crosshair = this.#crosshair;
    if (crosshair && typeof tooltip === "object" && tooltip.axisLabels) {
      // The pointer's or keyboard's cursor labels its own panel's axes alone.
      crosshair.draw(own ? [own] : drawn, own, this.#pointer, {
        model: host.model,
        scene,
        labelGap: tickLabelGap(theme.fontSize),
        surface: surface(theme),
      });
    } else {
      crosshair?.hide();
    }
    // Tooltips not shown this frame hide: the chart's own first, then those of other panels.
    for (const tip of [this.#tooltip, ...this.#tips].slice(tipped)) tip.hide();
    // Pinned from the keyboard, its content takes the focus once shown.
    if (this.#focusPin && tipped > 0 && pinned) {
      this.#focusPin = false;
      this.#tooltip.element.focus({ preventScroll: true });
    }
    // A cursor another chart shares, or `showCursor` shows, once drawn; or
    // nothing since what read last went (Escape, the pointer leaving).
    if (hovering && !mine)
      this.#hover(
        this.#stamped({
          pointer: undefined,
          target: undefined,
          inspection: shown.find(reads),
          cause: host.cursor()?.cause ?? this.#cursorCause,
          revision: host.drawnRevision(),
        }),
      );
  }

  /** What the pointer or the keyboard's cursor is on now, reading `inspection` there. */
  #inputEvent(inspection: Inspection | undefined): InputEvent {
    const pointer = this.#pointer;
    return this.#stamped({
      pointer: pointer ? this.#pointerAt(pointer.x, pointer.y) : undefined,
      target: pointer ? this.#pointed(pointer) : this.#keyboardTarget(),
      inspection,
      cause: pointer ? "pointer" : "keyboard",
      revision: this.#host.drawnRevision(),
    });
  }

  /** `event`, keeping the panels drawn now with it (see `FRAME`). */
  #stamped<Event extends InputEvent>(event: Event): Event {
    return Object.defineProperty(event, FRAME, { value: this.#host.model.panels() });
  }

  /**
   * The `i`th tooltip shown this frame: the chart's own, then one per other
   * panel showing the cursor with `sync.panels.tooltip`, made as needed.
   */
  #tip(i: number): Tooltip {
    if (i === 0) return this.#tooltip;
    let tip = this.#tips[i - 1];
    if (!tip) {
      tip = new Tooltip(this.#host.root.ownerDocument);
      this.#host.root.append(tip.element);
      this.#tips.push(tip);
    }
    return tip;
  }

  /**
   * Shares where the keyboard's cursor is with the charts of the cursor
   * channel, as the pointer's is shared: when it moves, and none once it
   * leaves. The pointer's own takes over while it is on the chart.
   */
  #shareKeyboard(active: Inspection | undefined): void {
    const host = this.#host;
    const axis = this.#cursorAxis();
    if (this.#pointer || host.cursorScale() !== axis) return;
    const panel = host.model.panels().find(({ key }) => key === (active?.panel ?? ""));
    const scale = panel?.[axis];
    const value =
      this.#keyboard && active?.axis === axis && scale
        ? scale.categories
          ? (scale.categories[active.value] ?? null)
          : active.value
        : null;
    // In another panel, the same value may be another instance's.
    const shared = value === null ? null : JSON.stringify([value, panel?.key]);
    if (shared === this.#keyShared) return;
    this.#keyShared = shared;
    host.shareCursor(value, panel);
  }

  /**
   * What touches the chart leaves to the browser: the axis its touch drags
   * do not move along, and pinches, where no binding takes them.
   */
  #touchPolicy(): string {
    const kinds = new Set(this.#host.model.items?.asked().map(({ kind }) => kind));
    const plane = kinds.has("map") || kinds.has("drag");
    // Pans and brushes take axes or a map's or network's plane; orbits a 3D
    // chart. Subplots with bindings of their own take what any panel takes.
    const axes = this.#host.model.panels().length > 0;
    let along = "";
    let pinch: string | undefined;
    for (const bindings of [this.#bindings, ...this.#own.values()]) {
      const action = bindings.match(
        "drag",
        { ...UNMODIFIED, button: 0, pointerType: "touch" },
        (a) =>
          a.type === "orbit"
            ? kinds.has("orbit")
            : a.type === "moveItem"
              ? kinds.has("drag")
              : a.type === "pageScroll" || axes || plane,
      )?.action;
      along +=
        action?.type === "pan"
          ? (action.axes ?? (plane ? "xy" : "x"))
          : action?.type === "brush"
            ? action.shape === "lasso"
              ? "xy"
              : (action.shape ?? "x")
            : action?.type === "orbit" || action?.type === "cursor"
              ? "x"
              : action?.type === "moveItem"
                ? "xy"
                : "";
      // Pinches zoom along axes. Charts that drag both ways (maps, networks)
      // take them too, doing nothing, unless a binding leaves them to the page.
      const type = bindings.match("pinch", UNMODIFIED)?.action.type;
      if (pinch !== "zoom") pinch = type ?? pinch;
    }
    // Rules dragged move along their axis: a horizontal rule along y.
    for (const { spec } of this.#host.options().marks)
      if ((spec as { drag?: boolean }).drag)
        along += (spec as { x?: unknown }).x !== undefined ? "x" : "y";
    const pinches = axes && pinch === "zoom";
    const [x, y] = [along.includes("x"), along.includes("y")];
    return x && y
      ? pinch === "pageScroll"
        ? "pinch-zoom"
        : "none"
      : x
        ? `pan-y${pinches ? "" : " pinch-zoom"}`
        : y
          ? `pan-x${pinches ? "" : " pinch-zoom"}`
          : pinches
            ? "pan-x pan-y"
            : "";
  }

  /**
   * Reports each scale instance whose view came within its limits'
   * threshold of an end (`interaction.limits`, `edge`), once until it is
   * farther away than the threshold and hysteresis again. An instance
   * without a view shows all of its data, near no end: a page loading
   * history on edges would otherwise widen the extent, refit, and hear of
   * the new end at once, again and again.
   */
  #reportEdges(): void {
    const { model, events } = this.#host;
    const edges = this.#edges;
    const panels = model.panels();
    const seen = new Set<string>();
    for (const instance of model.instances.values()) {
      const { scale: name, instance: group, type } = instance;
      const { edge, extent } = model.limitsOf(name, group) ?? {};
      if (!edge || type === "band" || !model.viewOf(name, group)) continue;
      const { threshold = 0.1, hysteresis = 0.05 } = edge === true ? {} : edge;
      const panel = panels.find(({ key }) => key === instance.panels[0]);
      const scale = panel?.[name];
      if (!scale) continue;
      // The data bounds an x scale every panel shares, where the extent does not.
      const data = name === "x" && group === "" ? model.dataXExtent() : undefined;
      // The view shown, without the padding drawn around it.
      const [a, b] = unpadded(panel.plans[name], scale.domain as [number, number]);
      const domain = [Math.min(a, b), Math.max(a, b)] as const;
      // Log axes measure by ratios, where ends that are not positive bound nothing (as limits do).
      const to = scale.type === "log" ? Math.log : Number;
      const span = to(domain[1]) - to(domain[0]);
      for (const end of [0, 1] as const) {
        const bound = extent?.[end] ?? data?.[end];
        const distance =
          bound == null ? Number.NaN : end ? to(bound) - to(domain[1]) : to(domain[0]) - to(bound);
        if (!Number.isFinite(distance)) continue;
        const key = `${name} ${group} ${end}`;
        seen.add(key);
        // Near the same bound, the view reports again once it has moved away.
        // A listener's own frame may have reported it already: the latch is shared.
        if (edges.get(key) === bound) {
          if (distance > (threshold + hysteresis) * span) edges.delete(key);
          continue;
        }
        edges.delete(key);
        if (distance > threshold * span) continue;
        // Latched before listeners run, which may load and draw at once.
        edges.set(key, bound!);
        events.emit("edge", {
          ...instance,
          side: end ? "end" : "start",
          domain,
          bound: bound!,
          cause: this.#host.cause(),
        });
      }
    }
    // Ends no longer limited, or of instances no longer drawn, are let go.
    for (const key of edges.keys()) if (!seen.has(key)) edges.delete(key);
  }

  /** The point the pointer or the keyboard is on. */
  #inspection(): Inspection | undefined {
    const { model } = this.#host;
    if (!this.#host.scene()) return undefined;
    // A chart being turned, panned, or dragged shows no tooltip.
    if (model.items?.busy) return undefined;
    // The model applies the chart's inspection; with `inspection: false`, the pointer reads nothing.
    if (this.#pointer)
      return this.#host.options().inspection === false
        ? undefined
        : this.#read(this.#pointer.x, this.#pointer.y);
    return this.#keyboard ? this.#keyed(this.#keyboard) : undefined;
  }

  /** The keyboard cursor's own point, read alone (see `keyedPoint`); none for a layout mark's item. */
  #keyedPoint(keyboard = this.#keyboard): AxisInspection | undefined {
    return keyboard
      ? keyedPoint(this.#host.model, keyboard.key, keyboard.position, keyboard.panel, this.#kit)
      : undefined;
  }

  /** What the keyboard's cursor at `keyboard` reads: an item, or the points at its position. */
  #keyed({ key, panel, position }: KeyboardCursor): Inspection | undefined {
    const { model } = this.#host;
    return model.inspectItem(key, panel) ?? inspectPosition(model, key, position, panel, this.#kit);
  }

  /**
   * The pointer's cursor over a panel where it reads nothing, when other
   * charts or the chart's other panels show it: a line alone at its value
   * along the axis the chart's data is placed on.
   */
  #sharing(): Inspection | undefined {
    const pointer = this.#pointer;
    const axis = this.#cursorAxis();
    const panel = pointer && this.#panelAt(pointer.x, pointer.y);
    const value = panel ? this.#valueAt(panel, axis, pointer.x, pointer.y) : null;
    if (!panel || value === null) return undefined;
    const [line] = this.#cursorAt(value, axis, undefined, [panel], true);
    return line && (this.#host.cursorScale() === axis || this.#across(line).length > 0)
      ? line
      : undefined;
  }

  /**
   * Each panel's cursor that another chart shares or `showCursor` shows,
   * along the axis the chart's data is placed on, at a value on it (a
   * category by name on category axes): the points there, or a line alone
   * where no point is.
   */
  #synced(): Inspection[] {
    const { model } = this.#host;
    const cursor = this.#host.cursor();
    const axis = this.#cursorAxis();
    if (!cursor || !(axis in cursor.at)) return [];
    const value = (cursor.at as Record<string, number | string>)[axis]!;
    const group = `${axis}Group` as const;
    const all = model.panels();
    const of = all.find(({ key }) => key === cursor.panel)?.[group];
    const panels = all.filter((panel) => cursor.panel === undefined || panel[group] === of);
    return this.#cursorAt(value, axis, this.#showing(cursor).snap, panels, true);
  }

  /** How a cursor the chart did not make shows: as `showCursor` said, else as its cursor channel says. */
  #showing(cursor: ShownCursor | null): CursorShowSpec {
    const sync = this.#host.options().interaction?.sync;
    const channel = typeof sync === "object" ? sync.cursor : undefined;
    const given = typeof channel === "object" ? channel : {};
    return { ...given, ...cursor?.shown };
  }

  /**
   * Each of `panels`' points at `value` along `axis` (a category by name on
   * category axes), read as `snap` says (by default, as the chart's
   * inspection reads): none where the value is out of a panel's view or in
   * a break its axis leaves out.
   */
  #cursorAt(
    value: number | string,
    axis: "x" | "y",
    snap: Snap | undefined,
    panels: readonly DrawnPanel[],
    bare = false,
  ): Inspection[] {
    const { model } = this.#host;
    const reads = model.series().length > 0;
    return panels.flatMap((panel) => {
      const scale = panel[axis];
      const { plot } = panel;
      const named = typeof value === "string";
      const at = named ? (scale.categories?.indexOf(value) ?? -1) : value;
      // Categories go by name, other values by number; a time an axis break
      // leaves out has no place.
      if ((named ? at < 0 : scale.categories) || scale.breaks?.hides(at)) return [];
      const px = scale.map(at);
      // Outside a panel's range, the pixel would land in a neighboring panel.
      const [from, length] = axis === "x" ? [plot.x, plot.width] : [plot.y, plot.height];
      if (!(px >= from && px <= from + length)) return [];
      const inspection = !reads
        ? undefined
        : axis === "x"
          ? model.inspect(px, plot.y + plot.height / 2, "nearest-x", panel.key, snap)
          : model.inspect(plot.x + plot.width / 2, px, "nearest-y", panel.key, snap);
      if (inspection) return [inspection];
      // A cursor shown, with no point under it, crosses the plot alone.
      const label = named ? value : model.formatsOf(undefined, panel.key)[axis](at);
      const line: Inspection = { axis, value: at, position: px, label, points: [] };
      return bare ? [panel.key ? { ...line, panel: panel.key } : line] : [];
    });
  }

  /**
   * The cursor in the other panels of the chart, where `active` (the
   * pointer's or keyboard's) is in one (`interaction.sync.panels`): at its
   * value in those sharing the scale it is on, by default, and with
   * `panels` on in those with scales of their own too, read on each one's,
   * or a line alone where nothing is.
   */
  #across(active: Inspection | undefined): Inspection[] {
    const option = this.#host.options().interaction?.sync;
    const panels = typeof option === "object" ? option.panels : undefined;
    const axis = active?.axis;
    if (!axis || axis === "item" || panels === false) return [];
    const all = this.#host.model.panels();
    const from = all.find(({ key }) => key === (active.panel ?? ""));
    if (!from || all.length < 2) return [];
    const show: CursorShowSpec = typeof panels === "object" ? panels : {};
    const group = `${axis}Group` as const;
    const others = all.filter(
      (panel) => panel !== from && (panels !== undefined || panel[group] === from[group]),
    );
    const { categories } = from[axis];
    const value = categories ? categories[active.value] : active.value;
    return value === undefined ? [] : this.#cursorAt(value, axis, show.snap, others, true);
  }

  /** The axis the chart's data is placed along, which its cursor follows (see `cursorAxis`). */
  #cursorAxis(): "x" | "y" {
    const { model } = this.#host;
    return cursorAxis(model.panels().map(({ key }) => model.inspectorOf(key)));
  }

  /**
   * Shares the pointer's cursor at (x, y) along the axis the data is placed
   * on, if the cursor channel carries it; over no panel, none. `again`, only
   * where it stands elsewhere than it last did.
   */
  #sharePointer(x: number, y: number, again = false): void {
    const host = this.#host;
    const axis = this.#cursorAxis();
    if (host.cursorScale() !== axis) return;
    const panel = this.#panelAt(x, y);
    const value = panel ? this.#sharedAt(panel, axis, x, y) : null;
    const shared = JSON.stringify([value, panel?.key]);
    if (again && shared === this.#pointerShared) return;
    this.#pointerShared = shared;
    host.shareCursor(value, panel);
    // The charts there show the pointer's now: the keyboard shares again where it is.
    this.#keyShared = null;
  }

  /**
   * The value the pointer's cursor at (x, y) over `panel` stands at along
   * `axis`, which peers show: what it reads, where its crosshair is drawn
   * (a line's nearest point, a calendar's cell), else the pointer's value.
   */
  #sharedAt(panel: DrawnPanel, axis: "x" | "y", x: number, y: number): number | string | null {
    const read =
      this.#host.model.items?.busy || this.#host.options().inspection === false
        ? undefined
        : this.#read(x, y);
    if (read?.axis !== axis || (read.panel ?? "") !== panel.key)
      return this.#valueAt(panel, axis, x, y);
    const { categories } = panel[axis];
    return categories ? (categories[read.value] ?? null) : read.value;
  }

  /**
   * What the pointer at (x, y) reads in the scene shown, read once for
   * the cursor it shares and the frame drawing it, which pointer moves
   * come once each before.
   */
  #read(x: number, y: number): Inspection | undefined {
    const scene = this.#host.scene();
    const last = this.#reading;
    if (last && last.scene === scene && last.x === x && last.y === y) return last.inspection;
    const inspection = this.#host.model.inspect(x, y);
    this.#reading = scene ? { x, y, scene, inspection } : null;
    return inspection;
  }

  /** The value under a pixel of `panel` along `axis`: a category by name on category axes. */
  #valueAt(panel: DrawnPanel, axis: "x" | "y", x: number, y: number): number | string | null {
    const scale = panel[axis];
    const value = scale.invert(axis === "x" ? x : y);
    return scale.categories ? (scale.categories[Math.round(value)] ?? null) : value;
  }

  /** The series of panel `panel` the keyboard stops at: every one its inspection shows (see `keyboardStops`). */
  #stops(panel: string): Series[] {
    return keyboardStops(this.#host.model.inspectorOf(panel));
  }

  /** For heatmaps: the cell the keyboard steps to (see `stepCell`). */
  #stepCell(
    panel: string,
    key: string,
    position: number,
    columns: number,
    rows: number,
  ): number | undefined {
    return stepCell(this.#host.model.inspectorOf(panel), key, position, columns, rows);
  }

  #listen() {
    const host = this.#host;
    const root = host.root;
    const DRAG_THRESHOLD = this.#kit.dragThreshold;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      const handle = (event: HTMLElementEventMap[K]) => {
        // What follows a press waiting for picking waits with it, in order
        // (but what capture listeners note as it happens, the wheel's steps,
        // and menus, which wait for picking on their own and whose browser
        // menu is kept off at once).
        if (
          this.#waiting &&
          !options?.capture &&
          event instanceof MouseEvent &&
          !(event instanceof WheelEvent) &&
          event.type !== "contextmenu"
        ) {
          this.#waiting.push(event);
          return;
        }
        this.#cause = type === "wheel" ? "wheel" : type === "keydown" ? "keyboard" : "pointer";
        handler(event);
      };
      root.addEventListener(type, handle, options);
      this.#cleanup.push(() => root.removeEventListener(type, handle, options));
      if (!options?.capture) this.#handlers.set(type, handle);
    };
    const local = (event: MouseEvent) => {
      const rect = root.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    // Over a pinned tooltip or an anchor, the pointer is on its content, not on the chart.
    const leave = () => {
      this.#pointer = this.#reading = this.#pointerShared = this.#over = this.#on = null;
      this.#ruleCursor = "";
      this.#pointing = false;
      this.#setCursor();
      host.shareCursor(null);
    };
    on("pointermove", (event) => {
      // Another finger than the chart's moves nothing of the chart's, wherever it goes.
      if (this.#stray(event)) return;
      if (this.#onContent(event.target) && !this.#press) {
        if (this.#pointer) {
          leave();
          host.schedule();
        }
        return;
      }
      // Inspection reads the new values: they show first, but a drill plays
      // on (the frames' items are read meanwhile), as values do under a
      // pointer that reads nothing.
      if (!host.model.items?.transitionItems && this.#reads()) host.showValues();
      this.#pointer = local(event);
      this.#touch = event.pointerType === "touch";
      this.#over = event.target;
      this.#keyboard = this.#gone = null;
      this.#brushAnchor = null;
      // Another pointer than a rule's being dragged moves nothing.
      const press = this.#besideRule(event) ? null : this.#press;
      const { x, y } = this.#pointer;
      if (this.#touches.has(event.pointerId)) {
        this.#touches.set(event.pointerId, { x, y });
        if (this.#pinch) {
          this.#pinched();
          return;
        }
      }
      const tap = this.#tap;
      // A press that strays is not a click, even if it comes back.
      if (tap?.pointer === event.pointerId)
        tap.moved ||= Math.hypot(x - tap.x, y - tap.y) >= DRAG_THRESHOLD;
      if (press && !this.#still(press.panel)) this.#cancelPress();
      else if (press) {
        press.moved ||= Math.hypot(x - press.x, y - press.y) >= DRAG_THRESHOLD;
        if (press.moved && press.mode === "pan") {
          this.#pan(press, x, y);
          return;
        }
        if (press.mode === "move" && event.buttons === 0) {
          // Its release went elsewhere (before the pointer was captured): dropped where it was.
          this.#press = null;
          if (press.moved) this.#dropRule(press);
          return;
        }
        if (press.moved && press.mode === "move") {
          this.#moveRule(press, x, y);
          return;
        }
        const brush = host.brush();
        if (press.moved && press.mode === "brush" && brush) {
          if (!brush.dragging) {
            brush.mode = this.#shape(press);
            brush.start(press.x, press.y, press.panel);
          }
          brush.move(x, y);
        } else if (press.moved && press.mode === "edit" && brush) {
          if (!brush.dragging) {
            // What it moves, as it was where the press landed.
            const at = this.#brushAt(press.panel, press.x, press.y);
            if (at) brush.edit(at.handle, at.selection, press.x, press.y, press.panel);
          }
          brush.move(x, y);
        }
        // A brush's first move between two frames reports what it shows at
        // once, so that every chart its rows reach draws it on the coming
        // frame; later moves report with that frame (see `draw`).
        if (press.moved && this.#previewedIn !== frameCount()) {
          this.#previewedIn = frameCount();
          this.#preview();
        }
      }
      // Over a rule it can drag, the pointer says which way it moves.
      if (this.#draggable && !press) {
        const rule = this.#ruleAt(x, y, event);
        this.#ruleCursor = rule ? (rule.axis === "x" ? "ew-resize" : "ns-resize") : "";
        this.#setCursor();
      }
      host.schedule();
      this.#sharePointer(x, y);
    });
    on("pointerleave", (event) => {
      if (event.pointerType === "touch" && !this.#fingers.delete(event.pointerId)) return;
      leave();
      // A captured drag leaves only when released; any other press ends
      // here. A rule's goes on where it holds the pointer (a leave played
      // from before the controller took it), else it is dropped where it was
      // (its press played after its release outside).
      const press = this.#press;
      if (press?.mode !== "move") this.#cancelPress();
      else if (!this.#besideRule(event) && !root.hasPointerCapture?.(event.pointerId)) {
        this.#press = null;
        this.#dropRule(press);
      }
      if (this.#tap?.pointer === event.pointerId) this.#tap = null;
    });

    on(
      "wheel",
      (event) => {
        // A pinned tooltip's content scrolls as its own, as an anchor does.
        if (!host.scene() || this.#onContent(event.target)) return;
        const point = local(event);
        if (this.#onItems(point.x, point.y)) return;
        // Outside the plots, the wheel acts on the x scale every panel
        // shares; without one, on none, and the page scrolls.
        const panel =
          this.#panelAt(point.x, point.y) ??
          host.model.panels().find(({ xGroup }) => xGroup === "");
        const focused = root.ownerDocument.activeElement === root;
        // The wheel over the brush resizes it, where a binding says so.
        const over = panel && this.#brushAt(panel, point.x, point.y);
        const takes = (a: Binding["action"]) => OWN(a) && (a.type !== "editBrush" || !!over);
        const action =
          panel && this.#bindingsIn(panel).match("wheel", event, takes, focused)?.action;
        if (action?.type === "editBrush" && over) {
          event.preventDefault();
          const factor = Math.exp(event.deltaY * (event.deltaMode === 1 ? 16 : 1) * 0.002);
          const { x, y } = point;
          host.select(over.brush.resized(over.selection, panel!, x, y, factor), panel, "wheel");
          return;
        }
        if (!action || (action.type !== "pan" && action.type !== "zoom")) return;
        event.preventDefault();
        // Steps faster than frames add up, each from the view the last asked for.
        const shown = this.#shown(panel!);
        // Lines and pages are turned into pixels; the wheel moves most along one axis.
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? panel!.plot.height : 1;
        const [dx, dy] = [event.deltaX * unit, event.deltaY * unit];
        const along = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        if (action.type === "zoom")
          this.#zoomAt(shown, point, Math.exp(along * 0.002), action.axes);
        else if (action.axes === "xy") this.#move(shown, "xy", dx, dy);
        else this.#move(shown, action.axes, along, along);
      },
      { passive: false },
    );
    on("pointerdown", (event) => {
      // Buttons (the legend's, controls'), a pinned tooltip's content, and
      // anchors take their own presses; a rule being dragged keeps its pointer's.
      if (
        !host.scene() ||
        (event.target as Element).closest?.("button") ||
        this.#onContent(event.target) ||
        this.#besideRule(event)
      )
        return;
      // A drag starts from the view it lands in, not one passing by, and
      // from values as they are; a drill plays on, its frame's items read.
      if (!host.model.items?.transitionItems) {
        host.settle();
        host.current();
      }
      const { x, y } = local(event);
      if (event.pointerType === "touch") {
        this.#fingers.add(event.pointerId);
        this.#touches.set(event.pointerId, { x, y });
        if (this.#touches.size === 2 && this.#startPinch(event)) return;
      }
      // Presses on what layout marks draw are clicks, not drags.
      if (host.model.layout || this.#onItems(x, y)) {
        // A second pointer down makes neither a click (a pinch, say).
        if (this.#tap) this.#tap.moved = true;
        else if (event.button === 0) this.#tap = { pointer: event.pointerId, x, y, moved: false };
        return;
      }
      // Presses on the axes, titles, gaps, or legend are not on the data:
      // released in place on an axis label, they click it (which, while
      // picking loads, it tells once loaded).
      const panel = this.#panelAt(x, y);
      if (!panel) {
        if (event.button === 0 && (!this.#picking || this.#axisLabel(x, y)))
          this.#tap = { pointer: event.pointerId, x, y, moved: false, label: true };
        return;
      }
      // A press on a rule with `drag` moves it, whatever else dragging does
      // there; which rule it presses, picking says, which it may wait for.
      if (event.button === 0 && this.#draggable && !this.#picking && this.#pickingLoad) {
        this.#waiting = [event];
        if (event.pointerType !== "touch") root.setPointerCapture?.(event.pointerId);
        return;
      }
      const rule = event.button === 0 && this.#draggable ? this.#ruleAt(x, y, event) : undefined;
      if (rule) {
        if (this.#host.model.panels().length > 1) rule.panel = panel.key;
        // A tap another pointer holds is no click now (as beside a pinch).
        if (this.#tap) this.#tap.moved = true;
        this.#press = {
          x,
          y,
          panel,
          mode: "move",
          action: undefined,
          moved: false,
          from: this.#view(panel),
          rule,
        };
        event.preventDefault();
        if (event.eventPhase) root.focus({ preventScroll: true });
        if (event.pointerType !== "touch") root.setPointerCapture?.(event.pointerId);
        return;
      }
      const action = this.#bindingsIn(panel).match("drag", event, this.#takes(panel, x, y))?.action;
      const type = action?.type;
      const mode =
        type === "pan" || type === "brush" || type === "cursor"
          ? type
          : type === "editBrush"
            ? "edit"
            : "click";
      // Other buttons click nothing.
      if (mode === "click" && event.button !== 0) return;
      this.#press = { x, y, panel, mode, action, moved: false, from: this.#view(panel) };
      // Touches are captured where they land, at once.
      if (mode !== "click") {
        // Cancel native selection at its start; replay must not move focus.
        event.preventDefault();
        if (event.eventPhase) root.focus({ preventScroll: true });
        if (event.pointerType !== "touch") root.setPointerCapture?.(event.pointerId);
      }
    });
    on("pointerup", (event) => {
      if (this.#stray(event)) return;
      // Released over an anchor, a press clicks nothing of the chart's.
      const off = this.#inAnchor(event.target);
      this.#touches.delete(event.pointerId);
      if (this.#pinch) {
        this.#pinch = null;
        return;
      }
      const tap = this.#tap;
      // A rule's drag ends with its own pointer's release, whatever another's tap waits for.
      if (tap && this.#press?.rule?.pointer !== event.pointerId) {
        if (tap.pointer !== event.pointerId) return;
        this.#tap = null;
        if (!tap.moved && !off) this.#click(local(event), event, tap.label);
        else if (tap.moved) this.#aimAgain();
        return;
      }
      if (this.#besideRule(event)) return;
      const press = this.#press;
      this.#press = null;
      if (!press) return;
      if (press.moved) this.#aimAgain();
      if (!press.moved) {
        if (event.button === 0 && press.mode !== "cursor" && !off) this.#click(local(event), event);
        return;
      }
      if (press.mode === "move") {
        const end = local(event);
        this.#dropRule(press, end.x, end.y);
        return;
      }
      if (press.mode !== "brush" && press.mode !== "edit") return;
      // The release point ends the brush, wherever the last move was.
      const end = local(event);
      const brush = host.brush();
      brush?.move(end.x, end.y);
      const selection = brush?.end() ?? null;
      // The drag outline goes, whether or not the brush selects anything.
      host.schedule();
      // A panel that went while dragging (its facet value did) selects nothing;
      // a brush that showed something and selects nothing went back.
      if (!selection || !this.#still(press.panel)) {
        if (press.previewed !== undefined) host.preview(null, press.panel, "cancel", "pointer");
        return;
      }
      if (this.#zoomsOnRelease(press) && this.#zoomable(selection, press.panel)) {
        this.#zoomTo(selection, press.panel);
        return;
      }
      const before = host.selection();
      host.select(selection, press.panel);
      const selected = host.selection();
      // Released where it began, the brush changed nothing: its previews end as undone.
      if (selected === before && press.previewed !== undefined)
        host.preview(null, press.panel, "cancel", "pointer");
      if (selected?.kind === "brush") {
        const format = host.model.formatsOf(undefined, press.panel.key);
        host.live.textContent = describeSelection(selected, format);
      }
    });
    // A drag the chart makes of a press (a brush, pan, lasso, node move, or
    // turn) captures its pointer at the root. The browser must not drag the
    // page's selection instead, which would end the press: Chrome does when
    // the selection spans the drawing pressed.
    // -1 is no pointer's id: it marks events no pointing device made. A
    // second pointer (a touch beside the mouse) leaves the first one's.
    let pressed = -1;
    on(
      "pointerdown",
      (event) => {
        if (!root.hasPointerCapture?.(pressed)) pressed = event.pointerId;
      },
      { capture: true },
    );
    on("dragstart", (event) => {
      if (root.hasPointerCapture?.(pressed)) event.preventDefault();
    });
    // The browser took the pointer (a touch turned into scrolling, say): a
    // pan keeps where it got, a brush goes. A tap ends only with its own pointer.
    const cancel = (event: PointerEvent) => {
      if (this.#stray(event)) return;
      this.#touches.delete(event.pointerId);
      this.#pinch = null;
      if (!this.#besideRule(event)) this.#cancelPress();
      if (this.#tap?.pointer === event.pointerId) this.#tap = null;
    };
    on("pointercancel", cancel);
    on("lostpointercapture", (event) => {
      if (this.#press || this.#tap?.pointer === event.pointerId) cancel(event);
    });
    // Double click resets: on a plot, its scales; elsewhere, every one. The
    // legend's buttons keep their clicks.
    on("dblclick", (event) => {
      if (host.legend.contains(event.target as Node) || this.#onContent(event.target)) return;
      const { x, y } = local(event);
      if (this.#onItems(x, y)) return;
      const panel = this.#panelAt(x, y);
      const brushed = host.selection()?.kind === "brush";
      const takes = (a: Binding["action"]) => OWN(a) && (a.type !== "clearBrush" || brushed);
      const action = this.#bindingsIn(panel).match("doubleClick", event, takes)?.action;
      if (action?.type === "clearBrush") host.select(null);
      else if (action?.type === "reset") this.#reset(panel);
      else if (action?.type === "zoom" && panel)
        this.#zoomAt(this.#shown(panel), { x, y }, 1 / (action.factor ?? 2), action.axes);
    });

    // A secondary press reports where it is and what it is on; while it is
    // listened to, the browser's own menu stays off the plots.
    on("contextmenu", (event) => {
      if (!host.scene() || !host.events.has("contextMenu") || this.#onContent(event.target)) return;
      const { x, y } = local(event);
      if (this.#panelAt(x, y) || this.#onItems(x, y)) event.preventDefault();
      if (this.#fresh()) this.#menu(x, y, event)();
      else this.#pending.push({ type: "contextMenu", x, y, event });
    });
    // A legend entry's button clicked, by the pointer or a key, is a click
    // on its entry: read before the legend acts on it (as the event goes
    // down to the button), reported after (as it comes back up). One the
    // chart held before this loaded is read as it is played.
    const legendClick = (event: MouseEvent): InputEvent | undefined => {
      const target = host.events.has("click") ? this.#legendEntry(event.target, event) : undefined;
      if (!target) return undefined;
      const { x, y } = local(event);
      // A button pressed from the keyboard clicks with no count.
      const keyboard = event.detail === 0;
      return this.#stamped({
        pointer: keyboard ? undefined : this.#pointerAt(x, y),
        target,
        inspection: undefined,
        cause: keyboard ? "keyboard" : "pointer",
        revision: host.drawnRevision(),
      });
    };
    let read: { event: Event; click: InputEvent | undefined } | undefined;
    on("click", (event) => (read = { event, click: legendClick(event) }), { capture: true });
    on("click", (event) => {
      const click = read?.event === event ? read.click : legendClick(event);
      read = undefined;
      // A legend that selects selects first: the click is reported after.
      this.#legendSelect(event, event.shiftKey, event.detail === 0 ? "keyboard" : "pointer");
      // After input still waiting to be read, in order.
      if (click && this.#pending.length) this.#pending.push({ type: "legend", click });
      else if (click) host.events.emit("click", click);
    });

    // Keys in an anchor are the application's.
    on("keydown", (event) => this.#inAnchor(event.target) || this.#key(event));
    // Focus moving to the chart's own controls (its legend) keeps the cursor;
    // to an anchor, the application's, it leaves the chart.
    on("focusout", (event) => {
      const to = event.relatedTarget;
      if (host.root.contains(to as Node | null) && !this.#inAnchor(to)) return;
      this.#keyboard = this.#gone = null;
      this.#brushAnchor = null;
      host.schedule();
    });
  }

  /** Moves a drag's axes by its shift, through the scales of the panel it started in. */
  #pan(press: Press, x: number, y: number) {
    this.#host.settle();
    const { action } = press;
    this.#move(
      this.#drawn(press.panel),
      action?.type === "pan" ? action.axes : undefined,
      press.x - x,
      press.y - y,
    );
    press.last = this.#view(press.panel);
  }

  /**
   * Shows what lies `dx` pixels right and `dy` down of what a panel shows,
   * along `axes` (x by default) of those that pan: not category axes.
   */
  #move(shown: Shown, axes: ZoomSpec | undefined, dx: number, dy: number) {
    const { panel } = shown;
    const { plot } = panel;
    const along = this.#axes(axes, panel);
    this.#change(() => {
      if (along.y) this.#zoomY(shown, plot.y + plot.height + dy, plot.y + dy, true);
      if (along.x) this.#zoomX(shown, plot.x + dx, plot.x + plot.width + dx);
    }, panel);
  }

  /**
   * Zooms a panel by `scale` (the new view's span over the old) about the
   * pixel `at`, which `to` (a pinch's middle, moved) shows next, along
   * `axes`: in pixel space, inverted, so the value under the pointer stays
   * with it on any scale type, including log.
   */
  #zoomAt(
    shown: Shown,
    at: { x: number; y: number },
    scale: number,
    axes: ZoomSpec | undefined,
    to = at,
  ) {
    const { panel } = shown;
    const { plot } = panel;
    const along = this.#axes(axes, panel);
    const inside = (value: number, from: number, length: number) =>
      Math.min(from + length, Math.max(from, value));
    const [px, py] = [inside(at.x, plot.x, plot.width), inside(at.y, plot.y, plot.height)];
    const [qx, qy] = [inside(to.x, plot.x, plot.width), inside(to.y, plot.y, plot.height)];
    // The pixels of what the view shows now that its edges will show.
    const edge = (side: number, from: number, next: number) => from + (side - next) * scale;
    this.#change(() => {
      if (along.y)
        this.#zoomY(shown, edge(plot.y + plot.height, py, qy), edge(plot.y, py, qy), true);
      if (along.x) this.#zoomX(shown, edge(plot.x, px, qx), edge(plot.x + plot.width, px, qx));
    }, panel);
  }

  /** Back to the configured view: of `panel`'s scales, or of every one. */
  #reset(panel: DrawnPanel | undefined) {
    const { model } = this.#host;
    const changes = model.viewChanges(null, panel?.key);
    this.#host.animated(() => this.#change(() => model.applyViews(changes), panel));
  }

  /** One change of view, made in `panel`, reported as caused by the input being handled. */
  #change(change: () => void, panel: DrawnPanel | undefined): void {
    this.#host.changeView(change, this.#cause, panel?.key);
  }

  /** A panel's pixels as values of the view drawn in it. */
  #drawn(panel: DrawnPanel): Shown {
    return {
      panel,
      x: inverter(panel.x, null),
      y: inverter(panel.y, null),
      yRight: panel.yRight && inverter(panel.yRight, null),
    };
  }

  /**
   * A panel's pixels as values of the view asked for since its frame, which
   * input between frames acts on. A view reset since then shows what fitting
   * the data gives, and other changes may change the scales, which only
   * drawing finds: those draw first.
   */
  #shown(drawn: DrawnPanel): Shown {
    const host = this.#host;
    host.settle();
    const { x, y, yRight } = this.#view(drawn);
    const was = this.#framed.get(drawn.key) ?? { x, y, yRight };
    // Options, data, or a size changed since may give the panel other scales.
    if (host.stale() || (!x && was.x) || (!y && was.y) || (!yRight && was.yRight)) {
      host.current();
      return this.#drawn(this.#find(drawn) ?? drawn);
    }
    const panel = drawn;
    const { plans } = panel;
    // Views asked for show with their axes' padding, as drawing them will.
    const shows = (plan: AxisPlan | undefined, view: readonly [number, number] | null) =>
      view && padded(plan, view);
    return {
      panel,
      x: inverter(panel.x, shows(plans.x, x)),
      y: inverter(panel.y, shows(plans.y, y)),
      yRight: panel.yRight && inverter(panel.yRight, shows(plans.yRight, yRight)),
    };
  }

  /**
   * Which of `panel`'s axes an action along `axes` (x by default) moves:
   * not category axes, nor a y axis it draws nothing along.
   */
  #axes(axes: ZoomSpec | undefined, panel: DrawnPanel): { x: boolean; y: boolean } {
    const along = axes ?? "x";
    return {
      x: along.includes("x") && panel.x.type !== "band",
      y:
        along.includes("y") &&
        ((panel.drawsY && panel.y.type !== "band") ||
          (panel.yRight !== undefined && panel.yRight.type !== "band")),
    };
  }

  /** `panel` in the scene drawn last, if it is still there with its scales' instances. */
  #find(panel: DrawnPanel): DrawnPanel | undefined {
    return this.#host.model
      .panels()
      .find(
        (other) =>
          other.key === panel.key &&
          other.xGroup === panel.xGroup &&
          other.yGroup === panel.yGroup &&
          other.yRightGroup === panel.yRightGroup,
      );
  }

  /** What `panel` shows along each axis: its instances' views. */
  #view(panel: DrawnPanel): View {
    const { model } = this.#host;
    return {
      x: model.viewOf("x", panel.xGroup),
      y: panel.drawsY ? model.viewOf("y", panel.yGroup) : null,
      yRight: panel.yRight ? model.viewOf("yRight", panel.yRightGroup) : null,
    };
  }

  /**
   * Whether a selection can be zoomed to: ranges (a lasso cannot), on
   * axes that zoom, in a chart whose brushes do not select rows.
   */
  #zoomable(selection: BrushSelection, panel: DrawnPanel): boolean {
    if (selection.lasso || !(selection.x || selection.y) || this.#host.rows()?.brushes(panel.key))
      return false;
    return (!selection.x || panel.x.type !== "band") && (!selection.y || panel.y.type !== "band");
  }

  /**
   * Whether Enter zooms to a selection (made with the keyboard or received
   * from a synced chart): when the chart zooms along every axis it has a
   * range on, and it can be zoomed to.
   */
  #zooms(selection: BrushSelection, panel: DrawnPanel): boolean {
    const axes = this.#bindingsIn(panel)
      .list.map(({ action }) => (action.type === "zoom" ? (action.axes ?? "x") : ""))
      .join("");
    return (
      (!selection.x || axes.includes("x")) &&
      (!selection.y || axes.includes("y")) &&
      this.#zoomable(selection, panel)
    );
  }

  /** Starts a pinch with a second touch, if a binding zooms with pinches. */
  #startPinch(event: PointerEvent): boolean {
    const [a, b] = [...this.#touches.values()];
    const panel = this.#panelAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
    const action = panel && this.#bindingsIn(panel).match("pinch", event, OWN)?.action;
    if (action?.type !== "zoom" || !panel) return false;
    this.#cancelPress();
    this.#pinch = {
      distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
      middle: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
      panel,
      action,
    };
    return true;
  }

  /**
   * Zooms by how much a pinch's fingers moved apart or together, and moves
   * what was between them to where they are now.
   */
  #pinched() {
    const pinch = this.#pinch!;
    const [a, b] = [...this.#touches.values()];
    const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    const middle = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
    if (!(distance > 0 && pinch.distance > 0)) return;
    const panel = this.#find(pinch.panel);
    if (!panel) return;
    this.#zoomAt(
      this.#shown(panel),
      pinch.middle,
      pinch.distance / distance,
      pinch.action.axes,
      middle,
    );
    pinch.distance = distance;
    pinch.middle = middle;
  }

  /**
   * A press ends without doing more: the browser took the pointer, or its
   * panel went. With `back` (Escape), a pan goes back to where it started,
   * unless the view changed since in another way (`setViewport`, a synced chart).
   */
  #cancelPress(back = false, cause: ChangeCause = "pointer", press = this.#press) {
    this.#press = null;
    this.#host.brush()?.cancel();
    this.#host.schedule();
    // A brush that reported what it showed reports going back.
    if (press?.previewed !== undefined) this.#host.preview(null, press.panel, "cancel", cause);
    // A rule goes back to where its options put it (gone with them, none).
    const rule = press?.rule;
    if (rule) {
      this.#letGo(rule);
      if (rule.reported !== undefined) {
        const now = this.#ruleNow(rule)?.spec as Record<string, unknown> | undefined;
        this.#reportRule(rule, "cancel", cause, now && Number(now[rule.axis]));
      }
    }
    if (!back || !press?.last || !this.#still(press.panel)) return;
    const { panel, from, last } = press;
    const now = this.#view(panel);
    if (now.x !== last.x || now.y !== last.y || now.yRight !== last.yRight) return;
    const { model } = this.#host;
    this.#change(() => {
      model.setView("x", panel.xGroup, from.x);
      if (panel.drawsY) model.setView("y", panel.yGroup, from.y);
      if (panel.yRight) model.setView("yRight", panel.yRightGroup, from.yRight);
    }, panel);
  }

  /**
   * Whether a panel of an earlier scene is still drawn, with the same
   * scales to share: what a drag that started in it may go on acting on.
   */
  #still(panel: DrawnPanel): boolean {
    return this.#find(panel) !== undefined;
  }

  /** Zooms to a brushed selection. */
  #zoomTo(selection: BrushSelection, panel: DrawnPanel) {
    const host = this.#host;
    const { x, y } = selection;
    host.animated(() =>
      this.#change(() => {
        if (y) this.#zoomY(this.#drawn(panel), panel.y.map(y[0]), panel.y.map(y[1]));
        if (x) host.model.setView("x", panel.xGroup, x);
      }, panel),
    );
  }

  /**
   * Shows the x values a panel shows between two pixels at the plot's
   * edges: the view whose padding shows them.
   */
  #zoomX(shown: Shown, left: number, right: number) {
    const { panel } = shown;
    const view = unpadded(panel.plans.x, [shown.x(left), shown.x(right)]);
    this.#host.model.setView("x", panel.xGroup, view);
  }

  /**
   * Shows the y values between two pixels of a panel: on the left axis, and
   * on the right axis what the same pixels show there. Pixels at the plot's
   * `edges` show the view's padding too.
   */
  #zoomY(shown: Shown, bottom: number, top: number, edges = false) {
    const { panel, yRight } = shown;
    const { plans } = panel;
    const view = (plan: AxisPlan | undefined, y: (pixel: number) => number) => {
      const values: [number, number] = [y(bottom), y(top)];
      return edges ? unpadded(plan, values) : values;
    };
    const { model } = this.#host;
    if (panel.drawsY && panel.y.type !== "band")
      model.setView("y", panel.yGroup, view(plans.y, shown.y));
    if (yRight && panel.yRight!.type !== "band")
      model.setView("yRight", panel.yRightGroup, view(plans.yRight, yRight));
  }

  /**
   * A clip path of the parts of panel `key`'s plot insets leave `visible`,
   * kept per panel, as a `url(...)`.
   */
  #cut(key: string, visible: readonly PlotRect[]): string {
    const host = this.#host;
    const { svgElement } = this.#kit;
    const document = host.root.ownerDocument;
    let clip = this.#cuts.get(key);
    if (!clip) {
      clip = svgElement(document, "clipPath", { id: `${host.id}-cut-${++this.#cutsMade}` });
      host.overlay.prepend(clip);
      this.#cuts.set(key, clip);
    }
    clip.replaceChildren(
      ...visible.map(({ x, y, width, height }) =>
        svgElement(document, "rect", {
          x: String(x),
          y: String(y),
          width: String(width),
          height: String(height),
        }),
      ),
    );
    return `url(#${clip.id})`;
  }

  /** The panel with axes whose plot holds a point of the chart, unless an inset covers it there. */
  #panelAt(x: number, y: number): DrawnPanel | undefined {
    const { model } = this.#host;
    return model.panels().find((p) => holds(p.plot, x, y) && !model.coveredAt(p.key, x, y));
  }

  /** Whether a point of the chart is in a panel a layout mark drew in, unless an inset covers it there. */
  #onItems(x: number, y: number): boolean {
    const { model } = this.#host;
    return model
      .allPanels()
      .some((p) => p.items && holds(p.plot, x, y) && !model.coveredAt(p.key, x, y));
  }

  /**
   * A press released without dragging: selects the rows there (with
   * `rowSelection`), clears the brushed selection, and reports what it is
   * on; while what the frame on screen drew has changed, once a frame
   * draws the change (`resolve`), so that it picks what the user saw.
   */
  #click(point: { x: number; y: number }, event: MouseEvent, label?: boolean) {
    if (this.#fresh()) this.#clicked(point, event, undefined, label)();
    else this.#pending.push({ type: "click", ...point, event, label });
  }

  /**
   * A click: what it is on, what the inspection reads there, and the rows
   * it selects, captured now; returns what it does with them (selects the
   * rows, clears the brush, reports the click), which runs listeners. A
   * `label` click (off the panels) is one only on an axis label.
   */
  #clicked(
    { x, y }: { x: number; y: number },
    event: MouseEvent,
    revision = this.#host.drawnRevision(),
    label?: boolean,
  ): () => void {
    const host = this.#host;
    // A press off the panels clicks an axis label, or nothing.
    if (label && !this.#axisLabel(x, y)) return () => {};
    const payload = host.events.has("click") ? this.#pressed(x, y, event, revision) : undefined;
    // Items or series a click selects (`interaction.select`), which write
    // bound rows in turn; else row selections pick with the reach of its
    // pointer, as its event does.
    const picks = !!host.options().interaction?.select;
    const target =
      picks || this.#pinsByClick() || host.model.drills
        ? (payload?.target ?? this.#pressing(event, () => this.#targetAt(x, y, event.target)))
        : undefined;
    const select = picks
      ? undefined
      : this.#pressing(event, () => host.rows()?.clicked(x, y, event));
    // One click, one decision: a tree drills (unless clicks select rows),
    // and does nothing else; else the click selects and pins, each as the
    // chart asks, what it picked.
    const drills = !select && this.#drills(target, x, y);
    const chosen = picks && !drills ? this.#chosen(target, event.shiftKey) : undefined;
    // A pin is at what the click's inspection reads, as the tooltip at the pointer showed.
    const pinning = drills
      ? undefined
      : this.#clickPin(target, () =>
          payload
            ? payload.inspection
            : host.options().inspection === false
              ? undefined
              : host.model.inspect(x, y),
        );
    const panel = this.#panelAt(x, y);
    const brush = host.model.interactionOf(panel?.key)?.brush;
    // A click clears the brush where it says so (by default), but not one on the brush it moves.
    const settings = typeof brush === "object" ? brush : undefined;
    const clears =
      !!brush &&
      (settings?.clear ?? "click") === "click" &&
      !(settings?.edit && panel && this.#brushAt(panel, x, y));
    return () => {
      if (drills) this.#drill(target!, x, y, "pointer");
      const written = select?.();
      if (chosen !== undefined) host.select(chosen);
      // A click on an item standing for none of the bound rows keeps the brush too, as a drill does.
      else if (clears && !drills && written !== null && host.selection()?.kind === "brush")
        host.select(null);
      const pin = pinning?.();
      if (pin !== undefined) this.#setPin(pin, "pointer");
      // Onto the event captured, which keeps the panels it was captured with.
      if (payload && !this.#disposed) host.events.emit("click", Object.assign(payload, written));
    };
  }

  /** Drills as `#drills` found a click or Enter on `target` does (dom/drill.ts). */
  #drill(target: Target, x: number, y: number, cause: ChangeCause): void {
    if (target.kind === "item" || target.kind === "plot")
      this.#host.model.drills?.(
        target.kind === "item" ? target.item : undefined,
        target.panel,
        x,
        y,
        cause,
      );
  }

  /**
   * Whether a click at (x, y) on `target` drills a tree its panel's `zoom`
   * drills (dom/drill.ts): into a node with nodes under it, or up from its
   * root or a sunburst's empty middle.
   */
  #drills(target: Target | undefined, x: number, y: number): boolean {
    if (target?.kind !== "item" && target?.kind !== "plot") return false;
    const { model } = this.#host;
    const panel = target.panel || undefined;
    const drill = model.interactionOf(panel)?.zoom ? model.items?.result(panel)?.drill : undefined;
    if (!drill) return false;
    // While a drill plays, a sector leaving the view opens too.
    const leaving = !!model.items?.transitionItems;
    return target.kind === "item"
      ? target.item === drill.key ||
          drill.opens(target.item) ||
          (leaving && drill.opensInTree(target.item))
      : !!drill.out?.(x, y);
  }

  /**
   * What a click or Enter on `target` selects where the chart asks
   * (`interaction.select`): the item, or its series, alone; with `shift`,
   * added or taken out. On the only one selected, or on a plot where no
   * item is, none (but with `shift`, or over a brush, which clears as it
   * says). Undefined where it changes nothing: an item of no series
   * selecting series, axis labels, legends.
   */
  #chosen(target: Target | undefined, shift: boolean): ChartSelection | null | undefined {
    const host = this.#host;
    const select = host.options().interaction?.select;
    if (!select || (target?.kind !== "item" && target?.kind !== "plot")) return undefined;
    const key = target.kind === "item" ? (select === "items" ? target.item : target.series) : null;
    if (key === undefined) return undefined;
    const current = host.selection();
    // A click off the data leaves a brush to its own `clear`.
    if (key === null) return shift || current?.kind === "brush" ? undefined : null;
    const held: readonly unknown[] =
      current?.kind === "items" && select === "items"
        ? current.items
        : current?.kind === "series" && select === "series"
          ? current.series
          : [];
    const keys = shift
      ? held.includes(key)
        ? held.filter((k) => k !== key)
        : [...held, key]
      : held.length === 1 && held[0] === key
        ? []
        : [key];
    if (keys.length === 0) return null;
    return select === "items"
      ? { kind: "items", items: keys as string[] }
      : { kind: "series", series: keys as string[] };
  }

  /** A secondary press's event, captured now, to emit. */
  #menu(x: number, y: number, event: MouseEvent, revision?: number): () => void {
    const host = this.#host;
    const payload = this.#pressed(x, y, event, revision) as InputEvent & { pointer: Pointer };
    return () => host.events.emit("contextMenu", payload);
  }

  /** What the keyboard's cursor is on (see `KeyedItem`); undefined for layout marks', which keys name. */
  #keyedItem({ panel, key, position }: KeyboardCursor): KeyedItem | undefined {
    return keyedItem(this.#host.model, panel, key, position, this.#kit);
  }

  /**
   * `keyboard` on what it was on (`item`), wherever data changes since
   * have moved it in its series (see `itemAt`); on a layout mark's item
   * (no `item`), where its layout drew one of its key; null once it is gone.
   */
  #itemNow(keyboard: KeyboardCursor, item: KeyedItem | undefined): KeyboardCursor | null {
    const { panel, key } = keyboard;
    const { model } = this.#host;
    if (!item) return model.inspectItem(key, panel) ? keyboard : null;
    const position = itemAt(model, panel, key, keyboard.position, item, this.#kit);
    return position < 0 ? null : { ...keyboard, position };
  }

  /**
   * Enter on the keyboard cursor (as it was when pressed): a click on what
   * it is on, captured now, to emit; nothing for a row gone since.
   */
  #enter(revision = this.#host.drawnRevision(), keyboard = this.#keyboard): () => void {
    const host = this.#host;
    if (!keyboard) return () => {};
    const inspection = this.#keyed(keyboard);
    const payload = this.#stamped({
      pointer: undefined,
      target: host.events.has("click")
        ? this.#provenanced(this.#keyboardTarget(keyboard))
        : this.#keyboardTarget(keyboard),
      inspection,
      cause: "keyboard",
      revision,
    });
    // Enter on a node with nodes under it, or on a sunburst's middle, drills, and does nothing else.
    const drills = this.#drills(payload.target, Number.NaN, Number.NaN);
    const chosen = drills ? undefined : this.#chosen(payload.target, false);
    const pinning = drills ? undefined : this.#clickPin(payload.target, () => inspection);
    return () => {
      if (drills) this.#drill(payload.target!, Number.NaN, Number.NaN, "keyboard");
      if (chosen !== undefined) {
        host.select(chosen, undefined, "keyboard");
        this.#saySelected(payload.target as ItemTarget, keyboard, inspection);
      }
      const pin = pinning?.();
      if (pin !== undefined) this.#setPin(pin, "keyboard");
      if (!this.#disposed && host.events.has("click")) host.events.emit("click", payload);
    };
  }

  /**
   * Announces what Enter on the keyboard cursor (`keyboard`, reading
   * `inspection`) made of the selection, once listeners of it have run: its
   * item or series selected or deselected, or the selection cleared.
   */
  #saySelected(
    target: ItemTarget | undefined,
    keyboard: KeyboardCursor,
    inspection: Inspection | undefined,
  ): void {
    const host = this.#host;
    if (this.#disposed || target?.kind !== "item") return;
    const selection = host.selection();
    const series = host.options().interaction?.select === "series";
    const held = (selection as { series?: string[]; items?: string[] } | null)?.[
      series ? "series" : "items"
    ];
    // A series by its name, a point by its name and place, a layout item by its name.
    const own = this.#keyedPoint(keyboard);
    const [point] = (own ?? inspection)?.points ?? [];
    if (!point) return;
    const name = series || !own ? point.label : `${point.label} at ${own.label}`;
    host.live.textContent = !selection
      ? "Selection cleared"
      : `${name} ${held?.includes((series ? target.series : target.item)!) ? "selected" : "deselected"}`;
  }

  /**
   * What a press at (x, y) reports: where, what it is on (picked with the
   * reach of its pointer, which picks for row selections too), and what
   * the inspection reads there.
   */
  #pressed(
    x: number,
    y: number,
    event: MouseEvent,
    revision = this.#host.drawnRevision(),
  ): InputEvent {
    const host = this.#host;
    return this.#stamped({
      pointer: this.#pointerAt(x, y),
      target: this.#provenanced(this.#pressing(event, () => this.#targetAt(x, y, event.target))),
      inspection: host.options().inspection === false ? undefined : host.model.inspect(x, y),
      cause: "pointer",
      revision,
    });
  }

  /**
   * `target` with what an item stands for and its rows, taken now, as a
   * click, Enter, or a secondary press captures it (hover takes neither).
   */
  #provenanced(target: Target | undefined): Target | undefined {
    const { model } = this.#host;
    const mark = target?.kind === "item" && (model.config.marks[target.mark] as Mark | undefined);
    if (!mark || !this.#picking) return target;
    const { item, panel } = target as ItemTarget;
    const { provenanceOf, rowsOfItem } = this.#picking.module;
    // An aggregate's point, a layout's item (of no row), or a row.
    const picked =
      this.#points.get(target as ItemTarget) ??
      ((target as ItemTarget).row === undefined ? "group" : undefined);
    return Object.assign(target!, {
      provenance: provenanceOf(model, mark, item, panel),
      rows: rowsOfItem(model, this.#items(), mark, item, panel, picked),
    });
  }

  /**
   * Arrow keys move the keyboard cursor. Left and Right (Home, End, Page Up
   * and Down) step through the points of the series it is on, keeping its
   * position in the series, so repeated x values are each reachable; Up and
   * Down move to the series drawn next above or below at its place, in
   * screen order (see `#upDown`), and past the last to the next panel. Each
   * move announces the series the cursor is on where it changed, and its
   * point; `i` announces every series it reads (`#readAll`). With brushing
   * on, Shift extends a selection from where the cursor started, Enter
   * zooms to it when zoom is on, and Escape clears it.
   */
  #key(event: KeyboardEvent) {
    const host = this.#host;
    const { model, live } = host;
    // Escape gives up a press waiting for picking, and what followed it.
    const waiting = this.#waiting;
    if (event.key === "Escape" && waiting) {
      event.preventDefault();
      this.#waiting = null;
      const { pointerId } = waiting[0] as PointerEvent;
      if (host.root.hasPointerCapture?.(pointerId)) host.root.releasePointerCapture(pointerId);
      return;
    }
    // Escape lets a pinned tooltip go, the focus in its content or not,
    // unless it ends a drag first.
    if (event.key === "Escape" && this.#pin && !this.#press) {
      event.preventDefault();
      this.#setPin(null, "keyboard");
      return;
    }
    // Controls inside the chart (legend buttons) keep their own keys.
    if (event.target !== host.root || this.#boundKey(event)) return;
    if (event.key === "i" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      this.#readAll(event);
      return;
    }
    if (!this.#kit.keys.includes(event.key)) return;
    // Escape ends a drag, a pan going back to where it started.
    if (event.key === "Escape" && this.#press) {
      event.preventDefault();
      this.#cancelPress(true, "keyboard");
      return;
    }
    // A selection cleared since (by a click, a synced chart, `select`) starts afresh.
    if (host.selection()?.kind !== "brush") this.#brushAnchor = null;
    // Keys move through what the chart shows once pending changes (a series
    // hidden, new options, values on their way) are drawn, and values that
    // render listeners changed meanwhile do not move.
    host.current();
    const panels = model.panels();
    const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
    // A cursor whose series went is handed on (see `#handOff`): Up, Down,
    // and Enter land where it was handed, which is announced; the other
    // keys step from there, or in a layout mark's items from their ends.
    const handed = this.#keyboard ?? this.#gone;
    const lands = vertical || event.key === "Enter";
    // Escape clears what it clears wherever the cursor is.
    const off = event.key !== "Escape" && this.#handOff(event.key === "ArrowUp");
    if (typeof off === "string") return this.#itemKey(event, off, lands);
    if (off && lands) {
      event.preventDefault();
      this.#arrive(handed, true);
      return;
    }
    // Enter and Escape act on the selection, whichever panel the cursor is in.
    if (event.key === "Enter") {
      this.#run = null;
      const selection = host.selection();
      const owner = host.owner();
      const at = owner?.plane ? undefined : panels.find(({ key }) => owner?.panels.includes(key));
      if (selection?.kind !== "brush" || !at || !this.#zooms(selection, at)) {
        // Else Enter on the keyboard cursor clicks what it is on, as the pointer
        // would, and selects it where the chart asks.
        if (
          this.#keyboard &&
          (host.events.has("click") ||
            host.options().interaction?.select ||
            this.#pinsByClick() ||
            model.drills)
        ) {
          event.preventDefault();
          if (this.#fresh()) this.#enter()();
          else {
            const keyboard = this.#keyboard;
            this.#pending.push({ type: "key", keyboard, item: this.#keyedItem(keyboard) });
          }
        }
        return;
      }
      event.preventDefault();
      this.#brushAnchor = null;
      host.select(null, undefined, "keyboard");
      // A select listener may have taken the panel away, or given it other
      // scales: zoom only where the selection still is.
      host.current();
      const still = this.#find(at);
      if (still) this.#zoomTo(selection, still);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.#keyboard = this.#gone = null;
      this.#brushAnchor = null;
      live.textContent = "";
      if (host.selection()) host.select(null, undefined, "keyboard");
      host.schedule();
      return;
    }
    // Where the cursor stops, panel by panel: Left and Right move through a
    // stop's points, or a layout mark's items (a stop of their own), Up and
    // Down between a panel's series and on to the next panel.
    const stops = model
      .allPanels()
      .flatMap(({ key, items }): { panel: string; series?: Series }[] =>
        items ? [{ panel: key }] : this.#stops(key).map((series) => ({ panel: key, series })),
      );
    const keyboard = this.#keyboard;
    let at = stops.findIndex(
      ({ panel, series }) => panel === keyboard?.panel && (!series || series.key === keyboard.key),
    );
    // The cursor's stop may be gone with nowhere to hand it: then it starts afresh in its panel.
    const found = at >= 0;
    const current = found ? keyboard!.position : -1;
    if (!found)
      at = Math.max(
        0,
        stops.findIndex(({ panel }) => panel === keyboard?.panel),
      );
    const start = stops[at];
    if (!start) return;
    // A layout mark's items: every arrow key reads them in a chart of one.
    if (!start.series && (!vertical || stops.length < 2)) {
      this.#itemKey(event, start.panel);
      return;
    }
    // Heatmaps step cell by cell, in rows and columns as drawn; Up and Down
    // leave the grid at its edges. Contours' regions and lines are read as points are.
    const cells = (series: Series | undefined) =>
      series !== undefined && model.markOf(series)?.stepCell !== undefined;
    let cell: number | undefined;
    if (cells(start.series) && current >= 0) {
      const [columns, rows] = CELL_STEPS[event.key] ?? [0, 0];
      cell =
        this.#stepCell(start.panel, start.series!.key, current, columns, rows) ??
        (vertical ? undefined : current);
    }
    let panel = start.panel;
    let series = start.series;
    let position = Math.max(0, current);
    if (vertical && cell === undefined && keyboard && found) {
      const to = this.#upDown(event.key === "ArrowUp", keyboard);
      if (!to) {
        // Nowhere to go: the cursor says where it is again, so the key is
        // heard: its series and place in the run, or its cell.
        event.preventDefault();
        const own = this.#keyedPoint(keyboard);
        const [point] = own?.points ?? [];
        if (point)
          this.#say(
            cells(start.series)
              ? describeInspection(this.#inspection() ?? own!)
              : point.label + this.#rank(),
          );
        return;
      }
      if (typeof to === "string") return this.#itemKey(event, to, true);
      ({ panel } = this.#run!);
      ({ position } = to);
      series = this.#stops(panel).find(({ key }) => key === to.key);
      if (!series) return;
      // Entering a grid, the cursor starts at its top left cell.
      if (cells(series)) cell = this.#stepCell(panel, series.key, -1, 0, 0);
    } else if (!series) return this.#itemKey(event, panel, true);
    else if (cell === undefined && cells(series) && current < 0)
      cell = this.#stepCell(panel, series.key, -1, 0, 0);
    if (cell !== undefined) position = cell;
    else if (!vertical || !keyboard || !found)
      ({ series, position } = stepPoint(
        model.inspectorOf(panel)!,
        series!,
        current,
        event.key,
        this.#kit,
      ));
    const to = panels.find(({ key }) => key === panel);
    // Reading series already exclude hidden points; other series step over
    // axis breaks in the direction of travel.
    const breaks = model.markOf(series!)?.readSeries ? undefined : to?.x.breaks;
    if (breaks && !vertical) {
      const back = event.key === "ArrowLeft" || event.key === "PageUp" || event.key === "End";
      const { x, rows, length, sorted } = series!;
      const shown = breaks.nearestShown(x, position, length, back, sorted, rows);
      if (shown >= 0) position = shown;
    }
    event.preventDefault();
    // Where the cursor stood, as Shift's selection starts from it.
    const before = this.#keyedPoint(keyboard);
    this.#keyboard = { panel, key: series!.key, position };
    // Named from where it was: a cursor handed on names the series it is handed to.
    const own = this.#arrive(handed, vertical && !!keyboard && found, cells(series));
    if (!own) return;
    // Shift selects a range along the axis the cursor steps along: for
    // brushes along that axis, and for rectangles and lassos, which the
    // keyboard cannot draw. A range does not go on into a panel with
    // another scale along that axis, nor along another axis.
    const { axis } = own;
    const brush = shapeOf(model.interactionOf(panel)?.brush);
    const from = panels.find(({ key }) => key === start.panel);
    const crossed = from?.[`${axis}Group`] !== to?.[`${axis}Group`];
    if (crossed || (this.#brushAnchor && this.#brushAnchor.axis !== axis)) this.#brushAnchor = null;
    if (event.shiftKey && (brush === axis || brush === "xy" || brush === "lasso")) {
      const begin = before?.axis === axis && !crossed ? before : own;
      this.#brushAnchor ??= { value: begin.value, label: begin.label, axis };
      const range = [this.#brushAnchor.value, own.value] as const;
      // In the panel as drawn: what listeners changed since waits for the next frame.
      host.select(
        {
          kind: "brush",
          x: axis === "x" ? range : null,
          y: axis === "y" ? range : null,
          lasso: null,
        },
        to,
        "keyboard",
      );
      const selection = host.selection();
      const zooms = selection?.kind === "brush" && this.#zooms(selection, to!);
      const hint = zooms ? " Press Enter to zoom to it." : "";
      live.textContent = `Selected ${this.#brushAnchor.label} to ${own.label}.${hint} ${live.textContent}`;
    } else {
      this.#brushAnchor = null;
    }
  }

  /**
   * Announces the keyboard cursor where it arrived from `from` (null for
   * none): the panel where it entered one; where the series changed, the
   * series, with its place in the run of Up and Down that moved it there
   * (`ranked`); then its point, and where; for a `cell`, what the tooltip
   * reads. Returns its own point, read alone (see `keyedPoint`), or
   * undefined where it reads nothing.
   */
  #arrive(from: KeyboardCursor | null, ranked: boolean, cell = false): AxisInspection | undefined {
    const host = this.#host;
    const { model } = host;
    const keyboard = this.#keyboard!;
    const { panel, key, position } = keyboard;
    this.#pointer = null;
    if (!ranked) this.#run = null;
    // What it is on, reads, and stands at are taken on the frame drawn,
    // before listeners of its hover can change the data under it.
    const inspection = this.#inspection();
    const own = this.#keyedPoint();
    keyboard.stood = standing(model, panel, key, position, this.#kit);
    keyboard.item = this.#keyedItem(keyboard);
    // The cursor moves on the frame drawn: what listeners changed while it
    // drew waits for the next.
    host.finishFrame();
    if (this.#disposed || (!inspection && !own)) return undefined;
    let text = describeInspection((inspection ?? own)!);
    const [point] = own?.points ?? [];
    if (point && !cell) {
      const rank = ranked ? this.#rank() : "";
      // A series of one place (a box plot's category) is not named twice.
      const where = own!.label === point.label ? "" : ` at ${own!.label}`;
      const named = from?.panel !== panel || from.key !== key;
      // A row of content is read whole, in place of the name and value.
      const content = contentText(point);
      text = `${content === undefined ? `${named ? `${point.label}${rank}: ` : ""}${point.text}` : `${content}${rank}`}${where}${fieldsSpoken(point)}`;
    }
    // Arriving in a panel, the cursor names it and the annotations it alone draws.
    if (model.namesPanels && from?.panel !== panel)
      text = [
        `${model.panels().find((drawn) => drawn.key === panel)?.label ?? panel}:`,
        ...model.annotationSummaries(panel),
        text,
      ].join(" ");
    host.live.textContent = text;
    return own;
  }

  /**
   * Where Up (or Down) takes the keyboard cursor: the series before (or
   * after) it in its panel's run, in screen order at its place (taken once,
   * at the run's first press, and kept while Up and Down follow: see
   * `orderAt`); past the run's ends, as `#beyond` says. A press going
   * nowhere leaves the run as it was.
   */
  #upDown(up: boolean, keyboard: KeyboardCursor): Visit | string | undefined {
    const { model } = this.#host;
    const { panel, key, position } = keyboard;
    let run = this.#run;
    const visit = run?.order[run.at];
    // A run ends with any other move (see `#arrive`), a new scene (see
    // `draw`), or another panel; a layout mark's items have none.
    if (!run || run.panel !== panel || visit?.key !== key || visit.position !== position) {
      const stood = standing(model, panel, key, position, this.#kit);
      run = this.#run = this.#runAt(
        panel,
        stood ?? { axis: "x", place: Number.NaN, height: 0 },
        (order) => {
          const at = order.findIndex((v) => v.key === key);
          // The cursor stays on its own observation, wherever the order found its series'.
          if (at >= 0) order[at] = { ...order[at]!, position };
          return at < 0 ? (up ? order.length : -1) : at;
        },
      );
      if (!stood) run.order = [];
    }
    const next = run.order[run.at + (up ? -1 : 1)];
    if (!next) return this.#beyond(up, panel, run.axis, run.place);
    run.at += up ? -1 : 1;
    return next;
  }

  /**
   * Where Up (or Down) goes past the ends of panel `panel`'s run at `place`
   * along `axis`: into the next panel that way with series, at its last (or
   * first) series there, starting a run in it, or at a layout mark's items
   * there (that panel's key); undefined past the first (or last) panel.
   */
  #beyond(up: boolean, panel: string, axis: "x" | "y", place: number): Visit | string | undefined {
    const { model } = this.#host;
    // At the same value on a scale both share, else at the same pixel across
    // the plot; from a layout mark's items, at the plot's start.
    const all = model.allPanels();
    const from = model.panels().find((drawn) => drawn.key === panel);
    const across = axis === "x" ? "y" : "x";
    const step = up ? -1 : 1;
    for (
      let p = all.findIndex((at) => at.key === panel) + step;
      p >= 0 && p < all.length;
      p += step
    ) {
      const { key, items } = all[p]!;
      if (items) return key;
      const to = model.panels().find((drawn) => drawn.key === key);
      if (!to) continue;
      const there =
        !from || Number.isNaN(place)
          ? to.plot[axis]
          : from[`${axis}Group`] === to[`${axis}Group`]
            ? to[axis].map(from[axis].invert(place))
            : to.plot[axis] + place - from.plot[axis];
      // From the edge it enters by: its first series from above, its last from below.
      const edge = to.plot[across] + (up ? (axis === "x" ? to.plot.height : to.plot.width) : 0);
      const entered = this.#runAt(key, { axis, place: there, height: edge }, (order) =>
        up ? order.length - 1 : 0,
      );
      if (entered.order.length) {
        this.#run = entered;
        return entered.order[entered.at];
      }
    }
    return undefined;
  }

  /**
   * A run of Up and Down in panel `panel` where the keyboard cursor `stood`
   * (see `standing`): its series in their order there, and the one the
   * cursor is at, which `at` finds.
   */
  #runAt(
    panel: string,
    stood: { axis: "x" | "y"; place: number; height: number },
    at: (order: Visit[]) => number,
  ): Run {
    const order = orderAt(
      this.#host.model,
      panel,
      stood.axis,
      stood.place,
      stood.height,
      this.#kit,
    );
    return { panel, ...stood, order, at: at(order) };
  }

  /**
   * Hands the keyboard cursor on where its series or row went (hidden by
   * the legend, dropped by a stream), whether or not that came back since:
   * to the series next below where it stood among the others (above,
   * `up`), else the nearest the other way, by screen order at its place,
   * as a run starting there; in its own series where that is the panel's
   * only one; to the layout mark's items where one took its panel or its
   * item went; with nothing left in its panel, on to the next panel that
   * way (see `#beyond`). Returns whether it did, or a layout mark's panel
   * to enter; finding nothing, it leaves no cursor.
   */
  #handOff(up: boolean): boolean | string {
    const keyboard = this.#gone;
    this.#gone = null;
    if (!keyboard) return false;
    const { panel, key, position } = keyboard;
    const items = this.#host.model.allPanels().find((at) => at.key === panel)?.items;
    // Where it last stood: a layer hidden from a stack is drawn nowhere, and
    // a series' row a stream dropped stands for nothing; a layout mark's
    // item gone, its panel's items are entered again.
    const stood = keyboard.stood ?? standing(this.#host.model, panel, key, position, this.#kit);
    if (!stood) return !!items && panel;
    // Series in series order, which places it among series drawn at its height.
    const keys =
      this.#host.model
        .inspectorOf(panel)
        ?.marks.flatMap(({ series }) => series.map((s) => s.key)) ?? [];
    const run = this.#runAt(panel, stood, (order) => {
      // Of the others (a series whose row went stays in the order), the
      // first below where it stood, or the one above it; a series alone
      // keeps it, at its observation nearest there.
      const others = order.filter((v) => v.key !== key || order.length < 2);
      const below = others.findIndex(
        (v) =>
          v.height > stood.height ||
          (v.height === stood.height && keys.indexOf(v.key) > keys.indexOf(key)),
      );
      return order.indexOf(
        others[below < 0 ? others.length - 1 : up ? Math.max(0, below - 1) : below]!,
      );
    });
    const visit =
      run.order[run.at] ?? (items ? panel : this.#beyond(up, panel, stood.axis, stood.place));
    if (typeof visit !== "object") return visit ?? false;
    if (run.order[run.at]) this.#run = run;
    this.#keyboard = { panel: this.#run!.panel, key: visit.key, position: visit.position };
    return true;
  }

  /**
   * `i`: announces every point the keyboard cursor reads, as the tooltip
   * lists them, again when pressed again.
   */
  #readAll(event: KeyboardEvent) {
    if (!(this.#keyboard ?? this.#gone)) return;
    event.preventDefault();
    this.#host.current();
    // A cursor whose series went reads where it is handed (see `#handOff`),
    // arriving there first.
    const handed = this.#gone;
    const off = this.#handOff(false);
    if (typeof off === "string") return this.#itemKey(event, off, true);
    if (off) this.#arrive(handed, false);
    this.#run = null;
    const inspection = this.#inspection();
    if (!inspection) return;
    const text =
      inspection.axis === "item"
        ? describeInspection(inspection)
        : `${inspection.points.length} series at ${inspection.label}: ${inspection.points
            .map(
              (point) =>
                `${contentText(point) ?? `${point.label} ${point.text}`}${fieldsSpoken(point)}`,
            )
            .join("; ")}`;
    this.#say(text);
  }

  /** The keyboard cursor's place in its run of Up and Down (", 2 of 12"); none in a run of one. */
  #rank(): string {
    const { at = 0, order = [] } = this.#run ?? {};
    return order.length > 1 ? `, ${at + 1} of ${order.length}` : "";
  }

  /** Announces `text`, again where it was the last announcement: told apart by a space. */
  #say(text: string): void {
    const { live } = this.#host;
    live.textContent = live.textContent === text ? `${text}\u00a0` : text;
  }

  /**
   * A key a binding takes: pans by its step, zooms about the plot's middle
   * by its factor, or resets, in the keyboard cursor's panel (the first by default).
   */
  #boundKey(event: KeyboardEvent): boolean {
    const host = this.#host;
    const panels = host.model.panels();
    const at = panels.find(({ key }) => key === this.#keyboard?.panel) ?? panels[0];
    const brushed = host.selection()?.kind === "brush";
    const takes = (a: Binding["action"]) => OWN(a) && (a.type !== "clearBrush" || brushed);
    const action = this.#bindingsIn(at).match("key", event, takes)?.action;
    if (!action || !at) return false;
    event.preventDefault();
    if (action.type === "clearBrush") {
      host.select(null, undefined, "keyboard");
      return true;
    }
    const shown = this.#shown(at);
    const { plot } = shown.panel;
    if (action.type === "pan") {
      const [across, up] = action.step ?? [0.1, 0];
      this.#move(shown, action.axes, across * plot.width, -up * plot.height);
    } else if (action.type === "zoom") {
      const middle = { x: plot.x + plot.width / 2, y: plot.y + plot.height / 2 };
      this.#zoomAt(shown, middle, 1 / (action.factor ?? 1.25), action.axes);
    } else if (action.type === "reset") this.#reset(shown.panel);
    return true;
  }

  /**
   * Arrow keys step through a layout mark's items in `panel`, in reading
   * order; Up and Down `enter` the panel at its first item. Arriving in a
   * facet panel or subplot, the cursor names it. Escape leaves a chart of
   * one layout mark's items.
   */
  #itemKey(event: KeyboardEvent, panel: string, enters = false) {
    const host = this.#host;
    const items = host.model.items!;
    const from = this.#keyboard;
    const to = items.step(event.key, from, panel, enters);
    if (to === undefined) return;
    event.preventDefault();
    this.#keyboard = to;
    this.#pointer = null;
    this.#brushAnchor = null;
    host.finishFrame();
    const inspection = this.#inspection();
    host.live.textContent = to
      ? items.said(inspection && describeInspection(inspection), panel, from?.panel !== panel)
      : "";
  }

  /** Loads the crosshair labels the first time a chart asks for `tooltip.axisLabels`. */
  #loadCrosshair(): void {
    if (this.#crosshair !== undefined || this.#crosshairLoading) return;
    this.#crosshairLoading = import("./axis-labels.ts")
      .then(({ CrosshairLabels }) => {
        const labels = new CrosshairLabels(this.#host.root.ownerDocument);
        this.#dots.before(labels.line);
        this.#host.root.append(labels.labels);
        return labels;
      })
      // Without it, the crosshair has no labels, until the options ask again.
      .catch((error: unknown) => {
        this.#host.report(error, "load");
        return null;
      })
      .then((labels) => {
        this.#crosshair = labels;
        this.#crosshairLoading = undefined;
        if (!this.#disposed) this.#host.schedule();
      });
  }

  /**
   * Loads what draws the fields and content marks' tooltips show, which
   * inspections carry (written as the chart inspects), and
   * `renderTooltip`'s content, in the tooltip.
   */
  #loadContent(): void {
    const host = this.#host;
    if (this.#content || this.#drawsContent) return;
    this.#content = import("./tooltip-content.ts")
      .then(({ ownContent }) => {
        if (this.#disposed) return;
        this.#drawsContent = true;
        this.#cleanup.push(
          ownContent(
            this.#tooltip,
            () => host.options().renderTooltip,
            () => host.revision(),
            () => !!this.#pin,
          ),
        );
      })
      // Without it, tooltips show points' names and values (or their content's text).
      .catch((error: unknown) => this.#host.report(error, "load"))
      .then(() => {
        this.#content = undefined;
        if (!this.#disposed) host.invalidate();
      });
  }
}

/** Columns right and rows up each key moves in a grid of cells. */
const CELL_STEPS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  Home: [Number.NEGATIVE_INFINITY, 0],
  End: [Number.POSITIVE_INFINITY, 0],
  PageUp: [0, Number.POSITIVE_INFINITY],
  PageDown: [0, Number.NEGATIVE_INFINITY],
};

/** A sentence announcing a selection, with values as the axes label them. */
function describeSelection(selection: BrushSelection, format: AxisFormat): string {
  if (selection.lasso) return "Selected a freehand region.";
  const { x, y } = selection;
  const ranges: string[] = [];
  if (x) ranges.push(`x from ${format.x(x[0])} to ${format.x(x[1])}`);
  if (y) ranges.push(`y from ${format.y(y[0])} to ${format.y(y[1])}`);
  return `Selected ${ranges.join(" and ")}.`;
}

/** Whether a plot holds a point of the chart. */
/** What a hover read was of: a scene, and the pointer and keyboard cursor then. */
type Heard = [scene: Scene, pointer: object | null, keyboard: object | null];

/**
 * What a hover reports, to report only changes: "" for nothing, as before
 * anything was hovered. A pointer that stays where it is on a view that
 * moved is at other values.
 */
function hoverKey({ pointer, target, inspection }: InputEvent): string {
  return pointer || target || inspection ? JSON.stringify([pointer, target, inspection]) : "";
}

function holds(plot: PlotRect, x: number, y: number): boolean {
  return x >= plot.x && x <= plot.x + plot.width && y >= plot.y && y <= plot.y + plot.height;
}

/**
 * The boxes of an automatic axis' tick labels, as drawn: its text items in
 * the order of its ticks (its title after them), measured as picking
 * measures text.
 */
function labelBoxes(
  axis: AxisGuide,
  measure: MeasureText,
  { textBox }: PickModule,
): readonly LabelBox[] {
  const texts = axis.items.filter((item): item is TextItem => item.type === "text");
  return axis.ticks.flatMap(({ value, label }, k) => {
    const item = texts[k];
    return item && label
      ? [
          {
            layer: "major",
            value,
            category: undefined,
            text: label,
            box: textBox(item, { measure }),
          },
        ]
      : [];
  });
}
