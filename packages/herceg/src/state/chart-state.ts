// State support (`herceg/state`): what only applications that set a
// chart's state from outside need, given in options as `state: chartState`
// so that charts without it carry none of it: state options and their
// equality, each report's basis and its state's whole value, conditional
// writes, what a selection stands for in each table (conditions), and
// selections of items and series, with the drawing of their looks.

import type {
  Basis,
  ChartEvents,
  Conditional,
  Emitter,
  PanelTarget,
  StateChange,
  ViewportEvent,
} from "../dom/events.ts";
import type { Chart } from "../dom/handle.ts";
import { unmappable } from "../lod/m4.ts";
import { DIM, type Mark } from "../marks/mark.ts";
import { placeAt, rowOf } from "../marks/series.ts";
import { conditionsOf } from "../model/conditions.ts";
import { GUIDE_KIT } from "../model/guides.ts";
import type { HighlightKit } from "../model/highlight.ts";
import { type ChartModel, type ViewChange, viewKey } from "../model/model.ts";
import type { Panels } from "../model/panels.ts";
import type { SelectionOwner } from "../model/selected-rows.ts";
import { CLOUD_POINTS, type Scene } from "../scene/scene.ts";
import { ChartError } from "../spec/errors.ts";
import {
  type ChartSelection,
  type DrillState,
  type ItemReference,
  type PinTarget,
  type SeriesReference,
  STATE_OPTIONS,
  type StateSpec,
  type ViewportState,
  type ViewState,
  type VisibilityState,
} from "../spec/state.ts";

/** What a chart lends the state support it attaches. */
export interface StateHost {
  readonly chart: Chart;
  readonly model: ChartModel;
  readonly events: Emitter;
  /**
   * Calls `change`, which calls a method of the chart's that changes state
   * `name`, with cause "options", ending a gesture that changes it first;
   * drill roots after the first frame, whose trees they need.
   */
  as(name: keyof StateSpec, change: () => void): void;
  /** Draws the scene again on the next frame. */
  invalidate(): void;
}

/** State support, which a chart attaches once and keeps for its life. */
export interface ChartStateSupport {
  attach(host: StateHost): AttachedState;
  /**
   * The scene of a static export (SVG, images, PDF, snapshots) of
   * `options`, which `draw` draws of `model`, with the state options among
   * them applied as a chart's first state.
   */
  exported(
    model: ChartModel,
    options: StateSpec & { panels?: Panels | undefined },
    draw: () => Scene,
  ): Scene;
}

/**
 * A chart's state support: what the chart asks of it. Attached, it also
 * wraps the chart's setters, which take `expected` and references to
 * items and series, and gives the chart its `basis`.
 */
export interface AttachedState {
  /** What loads to draw items' and series' looks, while it does. */
  readonly loading: Promise<void> | undefined;
  /** Applies the state options among `options` whose value is not the one last given (see `StateSpec`). */
  options(options: StateSpec): void;
}

/** The methods that take `expected`. */
type Setter =
  | "select"
  | "setViewport"
  | "setHiddenKeys"
  | "setVisibility"
  | "setDrillRoot"
  | "setCamera"
  | "setItemPosition"
  | "pin";

/** `import { chartState } from "herceg/state"`: give it as the `state` option. */
export const chartState: ChartStateSupport = {
  attach: (host) => new ChartState(host),
  exported: (model, { selection, viewport, visibility, drillRoot, panels }, draw) => {
    // Brushes draw on the page, and looks load: neither is drawn here.
    if (selection)
      throw new ChartError({
        code: "unsupported",
        path: "selection",
        message: "selection: a static export draws no selection; leave it out",
      });
    if (visibility) {
      // Keys of a legend group's series stand for the group (see `HiddenKeys.has`).
      const { hidden } = model;
      for (const key of visibility.hidden) hidden.add(key);
      if (visibility.panels) {
        if (!panels)
          throw new ChartError({
            code: "unsupported",
            path: "visibility.panels",
            message: "visibility panels: the chart has no subplots; drop panels",
          });
        hidden.panels = panels.own(visibility.panels, hidden.panels);
      }
    }
    // Drawn once first, for the legend entries, panels, and trees the state names.
    if (!viewport && !visibility && drillRoot === undefined) return draw();
    draw();
    for (const [panel, view] of eachPanel(viewport)) {
      const { x = null, y = null, yRight = null } = (view ?? {}) as ViewState;
      // A map's or network's plane keeps a view of its own, as a chart's does.
      if (model.items?.ownsView(panel)) model.items.setView({ x, y }, panel);
      else model.applyViews(model.viewChanges({ x, y, yRight }, panel));
    }
    for (const [panel, node] of eachPanel(drillRoot)) {
      if (!model.items) throw new Error("drillRoot: the chart has no tree to drill");
      model.items.setDrillRoot(node as string | readonly string[] | null, panel);
    }
    return draw();
  },
};

/** A state's value for the chart, or for each panel where they have their own (see `Scoped`). */
function eachPanel(state: unknown): [string | undefined, unknown][] {
  if (state === undefined) return [];
  return state && typeof state === "object" && "panels" in state
    ? Object.entries(state.panels as Record<string, unknown>)
    : [[undefined, state]];
}

/** What the drawing of items' and series' looks shares with charts (see `HighlightKit`). */
const LOOKS_KIT: HighlightKit = {
  placeAt,
  rowOf,
  unmappable,
  guides: GUIDE_KIT,
  dim: DIM,
  cloudPoints: CLOUD_POINTS,
};

/** The state option of each event reporting one. */
const OPTIONS = {
  select: "selection",
  viewport: "viewport",
  visibility: "visibility",
  drill: "drillRoot",
} as const;

/** What `update` takes that changes state alone: state options, and state support, which a chart keeps. */
const STATE_KEYS = new Set<string>([...STATE_OPTIONS, "state"]);

/** Lists states hold as sets, which compare equal in any order and with repeats. */
const SETS = new Set(["items", "series", "hidden", "shown"]);

/** The events reporting a state, which carry a basis; all but the last are of states conditional writes write. */
const REPORTS = [
  "select",
  "viewport",
  "visibility",
  "drill",
  "camera",
  "itemMove",
  "pin",
  "rowSelection",
] as const;

/** The reports of states conditional writes write, whose changes are recorded. */
const RECORDED = new Set<string>(REPORTS.slice(0, -1));

/** The state each setter writes, as the event reporting it is named, and where it takes its target (`expected`). */
const WRITES: Record<Setter, readonly [(typeof REPORTS)[number], number]> = {
  select: ["select", 1],
  setViewport: ["viewport", 1],
  setHiddenKeys: ["visibility", 1],
  setVisibility: ["visibility", 2],
  setDrillRoot: ["drill", 1],
  setCamera: ["camera", 1],
  setItemPosition: ["itemMove", 2],
  pin: ["pin", 1],
};

class ChartState implements AttachedState {
  readonly #host: StateHost;
  /** Names this chart in the bases it reports, so another chart's are told apart. */
  readonly #token = Math.random().toString(36).slice(2, 10);
  /**
   * The last report of a change of each state, by its scope ("selection",
   * "hidden", a view's instance, a layout state and its subplot), which a
   * refused conditional write reports again.
   */
  readonly #changed = new Map<string, readonly [type: string, event: StateChange]>();
  /**
   * The revision of the newest change of each state, by scope, which
   * conditional writes compare with: a setter's when it makes it, before
   * its report (which may wait for a frame, or for listeners).
   */
  readonly #mutated = new Map<string, number>();
  /** The chart's emitter's own `emit`, which reports without recording: a refused write's report is no change. */
  readonly #emit: Emitter["emit"];
  /**
   * The states written by calls waiting for the first frame (which draws
   * the panels they name): until it draws them, every basis is older.
   */
  readonly #waiting = new Set<string>();
  /** The state options last given, by name, as `stateKey` writes them; one removed is forgotten. */
  readonly #given = new Map<string, string>();
  /**
   * Each state as last reported (previews too), by its option's name, as
   * `stateKey` writes it: given back, as bindings give it, it changes
   * nothing and ends no gesture.
   */
  readonly #reported = new Map<string, string>();
  #looks: (() => void) | undefined;
  #looksLoading: Promise<void> | undefined;

  constructor(host: StateHost) {
    this.#host = host;
    // Every change of a state is reported: each report is recorded, then
    // extended once, before any listener hears it (and changes it again).
    const { events } = host;
    const emit = events.emit.bind(events);
    this.#emit = (type, event) => emit(type, events.has(type) ? this.#extend(type, event) : event);
    events.emit = (type, event) => {
      if (RECORDED.has(type)) this.#record(type, event as StateChange);
      this.#emit(type, event);
    };
    // Changes of view are reported only to listeners: these are always heard.
    events.on("viewport", () => {});
    // The pinned tooltip, which the interaction controller keeps once it
    // has loaded; a pin asked for before then waits for it.
    const { model } = host;
    Object.assign(host.chart, {
      pin: (at: PinTarget | null) => {
        const named =
          at && "item" in at ? { ...at, item: this.#keyOf(at.item, "pin.item", "pin item") } : at;
        if (model.pins) model.pins.pin(named, "api");
        else model.pinning = { at: named };
      },
    });
    Object.defineProperty(host.chart, "pinned", {
      get: () => (model.pins ? model.pins.pinned : (model.pinning?.at ?? null)),
    });
    // Conditional writes, and items and series by reference: the setters, wrapped.
    const chart = host.chart as unknown as Record<Setter, (...args: unknown[]) => void>;
    for (const [where, [, at]] of Object.entries(WRITES) as [Setter, (typeof WRITES)[Setter]][]) {
      const write = chart[where].bind(chart);
      chart[where] = (...args) => {
        const target = (args[at] ?? {}) as PanelTarget & Conditional;
        const [type] = WRITES[where];
        if (target.expected !== undefined && this.#refused(where, target, args[0] as ViewChange))
          return;
        if (where === "select") args[0] = this.#named(args[0] as ChartSelection | null);
        // What it changes, found before it does: a reset's, what it resets.
        const scopes = this.#scopesOf(type, target, args[0] as ViewChange);
        const made = host.chart.revision + 1;
        write(...args);
        // A change made is newer than every earlier basis, reported or not
        // yet; so is one waiting for the first frame, once it makes it.
        if (host.chart.revision >= made)
          for (const scope of scopes ?? [])
            this.#mutated.set(scope, Math.max(this.#mutated.get(scope) ?? 0, made));
        else if (host.chart.drawnRevision === undefined) this.#waiting.add(type);
      };
    }
    // State options alone change the state, not what the chart draws it
    // with; an empty update reads the page and the host again.
    const { update } = host.chart;
    host.chart.update = (options) => {
      const keys = Object.keys(options);
      if (keys.length && keys.every((key) => STATE_KEYS.has(key))) this.options(options);
      else update.call(host.chart, options);
    };
    Object.defineProperty(chart, "basis", { get: () => this.#basisAt(host.chart.revision) });
  }

  /** Records a report of a change (previews are none) as the newest of its scopes, unless a newer one is. */
  #record(type: string, event: StateChange): void {
    if ((event as { phase?: string }).phase === "preview") return;
    for (const scope of this.#scopes(type, event)) {
      if ((this.#changed.get(scope)?.[1].revision ?? -1) <= event.revision)
        this.#changed.set(scope, [type, event]);
      this.#mutated.set(scope, Math.max(this.#mutated.get(scope) ?? 0, event.revision));
    }
    if (type !== "select") return;
    // Items' and series' looks are drawn with the marks, once their drawing loads.
    const kind = (event as ChartEvents["select"]).selection?.kind;
    if (this.#looks) this.#host.invalidate();
    else if (kind === "items" || kind === "series") this.#loadLooks();
  }

  get loading(): Promise<void> | undefined {
    return this.#looksLoading;
  }

  #basisAt(revision: number): Basis {
    return `${this.#token}:${revision}` as Basis;
  }

  options(options: StateSpec): void {
    for (const name of STATE_OPTIONS) {
      if (!(name in options)) continue;
      const value = options[name];
      if (value === undefined) {
        this.#given.delete(name);
        continue;
      }
      const key = stateKey(value);
      if (this.#given.get(name) === key) continue;
      this.#given.set(name, key);
      if (this.#reported.get(name) === key) continue;
      const { chart, model } = this.#host;
      // A gesture changing the state ends: a map's or network's too.
      const as = (name: keyof StateSpec, change: () => void) => {
        model.items?.endGestures(name);
        this.#host.as(name, change);
      };
      if (name === "selection") as(name, () => chart.select(value as ChartSelection | null));
      else if (name === "visibility") {
        const { hidden, panels } = value as VisibilityState;
        as(name, () => chart.setHiddenKeys(hidden, panels ? { panels } : {}));
      } else {
        for (const [panel, state] of eachPanel(value)) {
          // A viewport is the whole view: an axis left out is not zoomed.
          const { x = null, y = null, yRight = null } = (state ?? {}) as ViewState;
          as(name, () =>
            name === "viewport"
              ? chart.setViewport({ x, y, yRight }, { panel })
              : chart.setDrillRoot(state as string | readonly string[] | null, { panel }),
          );
        }
      }
    }
  }

  /** A selection with items or series named by their keys, in one order (null for none); others as given. */
  #named(selection: ChartSelection | null): ChartSelection | null {
    const kind = selection?.kind;
    // Brushes, and ranges along x, are the chart's.
    if (kind === "brush" || !selection || Array.isArray(selection)) return selection;
    if (kind !== "items" && kind !== "series")
      throw new ChartError({
        code: "invalid-option",
        path: "selection.kind",
        message: `selection kind: expected "brush", "items", or "series"; received ${JSON.stringify(kind)}`,
      });
    const list = kind === "items" ? selection.items : selection.series;
    if (!Array.isArray(list))
      throw new TypeError(`selection ${kind}: expected a list of keys or references`);
    const keys = list.map((entry: string | ItemReference | SeriesReference, i) =>
      this.#keyOf(entry, `selection.${kind}[${i}]`, `selection ${kind}[${i}]`),
    );
    // In one order, so that selections equal by value are equal as written.
    const unique = [...new Set(keys)].sort();
    if (unique.length === 0) return null;
    // Their looks load as they are given, so the chart's `loading` waits for them.
    this.#loadLooks();
    return kind === "items" ? { kind, items: unique } : { kind, series: unique };
  }

  /** An item or series key, as given or as a reference names it (refused, at `path`, for a mark of no such id). */
  #keyOf(entry: string | ItemReference | SeriesReference, path: string, where: string): string {
    if (typeof entry === "string") return entry;
    const marks = this.#host.model.config.marks as readonly Mark[];
    if (!marks.some(({ spec }) => spec.id === entry?.mark))
      throw new ChartError({
        code: "unknown-reference",
        path: `${path}.mark`,
        message: `${where}: no mark has the id ${JSON.stringify(entry?.mark)}; give a mark's id, or a key from an event`,
      });
    return JSON.stringify([
      entry.mark,
      ...("item" in entry ? entry.item : [(entry as SeriesReference).series]),
    ]);
  }

  /**
   * Whether method `where`'s write, with `target.expected`, is refused: the
   * state it writes (in the scope it writes: of `view`, for a viewport)
   * changed since that basis. If so, the report of the change that did is
   * given again, as the state is now, with cause "api". Throws for a basis
   * this chart did not report.
   */
  #refused(where: Setter, target: PanelTarget & Conditional, view?: ViewChange): boolean {
    const expected = target.expected!;
    const at = String(expected).lastIndexOf(":");
    const revision = Number(expected.slice(at + 1));
    if (expected.slice(0, at) !== this.#token || !(revision >= 0))
      throw new ChartError({
        code: "invalid-option",
        path: "expected",
        message: `${where} expected: the basis is another chart's; give one this chart reported`,
      });
    const [type] = WRITES[where];
    // A write of the state waits for the first frame: none checks against it before that.
    if (this.#waiting.has(type) && this.#host.chart.drawnRevision === undefined) return true;
    // Nor against a pin asked for and not made yet, which no report has said.
    const { model } = this.#host;
    if (type === "pin" && (model.pins ? model.pins.waiting : model.pinning !== undefined))
      return true;
    // A camera a gesture turned, not reported yet: its report, at the next frame, says how it is.
    if (
      where === "setCamera" &&
      (this.#host.model.items?.pendingCamera(target.panel) ?? -1) > revision
    )
      return true;
    const scope = (this.#scopesOf(type, target, view) ?? []).find(
      (scope) => (this.#mutated.get(scope) ?? -1) > revision,
    );
    if (scope === undefined) return false;
    // A refused write changes nothing and reports the state as it is: as
    // the newest change's report says, or as its report, still to come, will.
    const newest = this.#changed.get(scope);
    if (newest && newest[1].revision >= this.#mutated.get(scope)!)
      this.#emit(
        newest[0] as never,
        { ...newest[1], cause: "api", revision: this.#host.chart.revision } as never,
      );
    return true;
  }

  /**
   * The scopes of the state of event `type` that a report of it (`of`)
   * changed, or a write to `of`'s panel (of `view`, a viewport) changes.
   */
  #scopes(type: string, of: object, view?: ViewChange): string[] {
    const { model } = this.#host;
    const panel = (of as PanelTarget).panel;
    if (type === "select") return ["selection"];
    if (type === "pin") return ["pin"];
    if (type === "visibility") return ["hidden"];
    if (type === "viewport") {
      const items = model.items;
      // A write's instances, or a report's.
      const scales =
        "scales" in of
          ? (of as ViewportEvent).scales
          : view === null && panel === undefined
            ? // A reset of every view: every plane's, and the axes' if any.
              [
                ...(items?.planes ?? []),
                ...(items?.ownsView(panel) ? [] : model.viewChanges(null, panel)).map(
                  ([scale, instance]) => ({ scale, instance }),
                ),
              ]
            : items?.ownsView(panel)
              ? // A plane's axes the write sets: a pair is x, null both.
                items
                  .select(panel)!
                  .scales.filter(
                    ({ scale }) =>
                      view === null ||
                      (Array.isArray(view)
                        ? scale === "x"
                        : (view as Record<string, unknown>)[scale] !== undefined),
                  )
              : model.viewChanges(view!, panel).map(([scale, instance]) => ({ scale, instance }));
      return scales.map(({ scale, instance }) => viewKey(scale, instance));
    }
    // A layout mark's state, the chart's or a subplot's own: as a report
    // names it, or as the setter finds a write's, its panel named or not.
    if ("revision" in of) return [`${type} ${(of as { panels?: string[] }).panels?.[0] ?? ""}`];
    const has = type === "drill" ? "drill" : type === "camera" ? "camera" : "moves";
    return [`${type} ${model.items?.scopeOf(has, panel) ?? ""}`];
  }

  /** `#scopes` of a write; undefined for one naming a panel the first frame has not drawn yet. */
  #scopesOf(type: string, of: object, view?: ViewChange): string[] | undefined {
    try {
      return this.#scopes(type, of, view);
    } catch {
      return undefined;
    }
  }

  /** A state event with its basis and its state's whole value; others as they are. */
  #extend<K extends keyof ChartEvents>(type: K, event: ChartEvents[K]): ChartEvents[K] {
    if (!(REPORTS as readonly string[]).includes(type)) return event;
    const report = event as ChartEvents[K] & { revision: number };
    const extra: Record<string, unknown> = { basis: this.#basisAt(report.revision) };
    if (type === "select") {
      const { selection, owner } = event as ChartEvents["select"];
      extra.state = this.#host.chart.selection;
      extra.conditions = conditionsOf(
        this.#host.model,
        selection,
        owner.scales.length > 0 ? (owner as SelectionOwner) : null,
      );
    } else if (type === "viewport") extra.state = this.#viewState();
    else if (type === "drill") extra.state = this.#drillState();
    else if (type === "visibility") {
      const { hiddenKeys, panels } = event as ChartEvents["visibility"];
      extra.state = { hidden: hiddenKeys, ...(panels && { panels }) };
    }
    // A selection as the event shows it: a preview's, while a gesture makes it.
    const option = OPTIONS[type as keyof typeof OPTIONS];
    const shown = type === "select" ? (event as ChartEvents["select"]).selection : extra.state;
    if (option) this.#reported.set(option, stateKey(shown));
    return { ...report, ...extra };
  }

  /**
   * The chart's whole view, as the `viewport` option takes it: one view
   * where every panel shares the instances it draws, else each panel's.
   */
  #viewState(): ViewportState {
    const model = this.#host.model;
    const all = model.allPanels();
    const shared = model
      .panels()
      .every((p) => p.xGroup === "" && p.yGroup === "" && p.yRightGroup === "");
    return shared && all.length === model.panels().length
      ? model.getViewport()
      : {
          panels: Object.fromEntries(
            all.map(({ key }) => [key, model.items?.view(key, true) ?? model.getViewport(key)]),
          ),
        };
  }

  /** The drill roots of the chart's trees, as the `drillRoot` option takes them (see `DrillState`). */
  #drillState(): DrillState {
    const items = this.#host.model.items!;
    const drilling = items.panels.filter(({ result }) => result.drill);
    return drilling.every(({ state }) => state === "")
      ? (items.drillRoot()?.key ?? null)
      : {
          panels: Object.fromEntries(
            drilling.map(({ key }) => [key, items.drillRoot(key)?.key ?? null]),
          ),
        };
  }

  /**
   * Loads what draws a selection of items or series in its marks' looks,
   * the first time a chart has one: until then it is kept and reported,
   * not drawn.
   */
  #loadLooks(): void {
    if (this.#looks || this.#looksLoading) return;
    const host = this.#host;
    const loading = import("../model/highlight.ts").then(({ selectionLooks }) => {
      this.#looks = selectionLooks(
        LOOKS_KIT,
        host.model,
        () => host.chart.selection,
        () => host.invalidate(),
      );
      this.#looksLoading = undefined;
      host.invalidate();
    });
    // Failed, it stays, so the chart's `ready` rejects with it; selections
    // are kept and reported, not drawn. Unread, it is no unhandled rejection.
    loading.catch(() => {});
    this.#looksLoading = loading;
  }
}

/**
 * A state as text, the same for states equal by value: objects' keys in
 * order, lists of keys as sets (in any order, repeats once), and every
 * number as written.
 */
function stateKey(state: unknown): string {
  return (
    JSON.stringify(state, (key, value: unknown) =>
      SETS.has(key) && Array.isArray(value)
        ? [...new Set(value.map((entry) => JSON.stringify(entry)))].sort()
        : value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
          : value,
    ) ?? ""
  );
}
