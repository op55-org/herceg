// A chart's state as applications set and read it from outside: the state
// options and their equality, each report's basis and its state's whole
// value, conditional writes (`expected`), what a selection stands for in
// each table (conditions), and selections of items and series named by
// reference, with the loading of their looks. The chart (chart.ts)
// owns one: its setters write through `write`, and its emitter reports
// every event through `report`.

import { unmappable } from "../lod/m4.ts";
import { DIM, type Mark } from "../marks/mark.ts";
import { placeAt, rowOf } from "../marks/series.ts";
import { conditionsOf } from "../model/conditions.ts";
import { GUIDE_KIT } from "../model/guides.ts";
import type { HighlightKit } from "../model/highlight.ts";
import { type ChartModel, type ViewChange, viewKey } from "../model/model.ts";
import type { SelectionOwner } from "../model/selected-rows.ts";
import { CLOUD_POINTS } from "../scene/scene.ts";
import { ChartError } from "../spec/errors.ts";
import {
  type ChartSelection,
  type DrillState,
  eachPanel,
  type ItemReference,
  type SeriesReference,
  STATE_OPTIONS,
  type StateSpec,
  type ViewportState,
  type ViewState,
} from "../spec/state.ts";
import type {
  Basis,
  ChartEvents,
  Conditional,
  Emitter,
  PanelTarget,
  StateChange,
  Unextended,
  ViewportEvent,
} from "./events.ts";

/** What a chart lends its state. */
export interface StateHost {
  readonly model: ChartModel;
  /** The chart's emitter, which delivers a refused write's report again. */
  readonly events: Emitter;
  /** The chart's revision (see `Chart.revision`). */
  revision(): number;
  /** The revision on screen; undefined before the first frame. */
  drawnRevision(): number | undefined;
  selection(): ChartSelection | null;
  /**
   * Sets state `name` to `value`, in `panel` (the chart's, for none), as
   * its setter does, reporting cause "options".
   */
  set(name: keyof StateSpec, value: unknown, panel: string | undefined): void;
  /** Draws the scene again on the next frame. */
  invalidate(): void;
}

/** The methods that take `expected`. */
export type Setter =
  | "select"
  | "setViewport"
  | "setHiddenKeys"
  | "setVisibility"
  | "setDrillRoot"
  | "setCamera"
  | "setItemPosition"
  | "pin";

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

/** The state each setter writes, as the event reporting it is named. */
const WRITES: Record<Setter, (typeof REPORTS)[number]> = {
  select: "select",
  setViewport: "viewport",
  setHiddenKeys: "visibility",
  setVisibility: "visibility",
  setDrillRoot: "drill",
  setCamera: "camera",
  setItemPosition: "itemMove",
  pin: "pin",
};

export class ChartState {
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
  #looks = false;
  #looksLoading: Promise<void> | undefined;

  constructor(host: StateHost) {
    this.#host = host;
  }

  /** What loads to draw items' and series' looks, while it does. */
  get loading(): Promise<void> | undefined {
    return this.#looksLoading;
  }

  /** The basis of the chart's state as of `revision`. */
  basisAt(revision: number): Basis {
    return `${this.#token}:${revision}` as Basis;
  }

  /**
   * Makes setter `where`'s change, `change`, unless `target.expected` is a
   * basis the state it writes (in the scope it writes: of `view`, for a
   * viewport) changed since; then the report of the change that did is
   * given again, as the state is now, with cause "api". A change made is
   * newer than every earlier basis. Throws for a basis this chart did not
   * report.
   */
  write(
    where: Setter,
    target: PanelTarget & Conditional,
    view: ViewChange | undefined,
    change: () => void,
  ): void {
    if (target.expected !== undefined && this.#refused(where, target, view)) return;
    const type = WRITES[where];
    const host = this.#host;
    // What it changes, found before it does: a reset's, what it resets.
    const scopes = this.#scopesOf(type, target, view);
    const made = host.revision() + 1;
    change();
    // A change waiting for the first frame is newer once that frame makes it.
    if (host.revision() >= made)
      for (const scope of scopes ?? [])
        this.#mutated.set(scope, Math.max(this.#mutated.get(scope) ?? 0, made));
    else if (host.drawnRevision() === undefined) this.#waiting.add(type);
  }

  /**
   * An event as listeners hear it (the chart's emitter's hook): a report
   * of a change of state is recorded, before any listener hears it (and
   * changes the state again), and extended once.
   */
  report<K extends keyof ChartEvents>(type: K, event: Unextended<ChartEvents[K]>): ChartEvents[K] {
    if (RECORDED.has(type)) this.#record(type, event as StateChange);
    return this.#heard(type, event);
  }

  /** An event extended where anyone hears it; views always, whose whole state `#reported` keeps. */
  #heard<K extends keyof ChartEvents>(type: K, event: Unextended<ChartEvents[K]>): ChartEvents[K] {
    // Unheard, it reaches no one as it is.
    return this.#host.events.has(type) || type === "viewport"
      ? this.#extend(type, event)
      : (event as never);
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

  /** Applies the state options among `options` whose value is not the one last given (see `StateSpec`). */
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
      const { set } = this.#host;
      if (name === "selection" || name === "visibility") set(name, value, undefined);
      else
        for (const [panel, state] of eachPanel(value)) {
          // A viewport is the whole view: an axis left out is not zoomed.
          const { x = null, y = null, yRight = null } = (state ?? {}) as ViewState;
          set(name, name === "viewport" ? { x, y, yRight } : state, panel);
        }
    }
  }

  /** A selection with items or series named by their keys, in one order (null for none); others as given. */
  named(selection: ChartSelection | null): ChartSelection | null {
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
      this.keyOf(entry, `selection.${kind}[${i}]`, `selection ${kind}[${i}]`),
    );
    // In one order, so that selections equal by value are equal as written.
    const unique = [...new Set(keys)].sort();
    if (unique.length === 0) return null;
    // Their looks load as they are given, so the chart's `loading` waits for them.
    this.#loadLooks();
    return kind === "items" ? { kind, items: unique } : { kind, series: unique };
  }

  /** An item or series key, as given or as a reference names it (refused, at `path`, for a mark of no such id). */
  keyOf(entry: string | ItemReference | SeriesReference, path: string, where: string): string {
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
   * Whether method `where`'s write, with `target.expected`, is refused (see
   * `write`), reporting the state as it is if so.
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
    const type = WRITES[where];
    const { model } = this.#host;
    // A write of the state waits for the first frame: none checks against it before that.
    if (this.#waiting.has(type) && this.#host.drawnRevision() === undefined) return true;
    // Nor against a pin asked for and not made yet, which no report has said.
    if (type === "pin" && (model.pins ? model.pins.waiting : model.pinning !== undefined))
      return true;
    // A camera a gesture turned, not reported yet: its report, at the next frame, says how it is.
    if (where === "setCamera" && (model.items?.pendingCamera(target.panel) ?? -1) > revision)
      return true;
    const scope = (this.#scopesOf(type, target, view) ?? []).find(
      (scope) => (this.#mutated.get(scope) ?? -1) > revision,
    );
    if (scope === undefined) return false;
    // A refused write changes nothing and reports the state as it is: as
    // the newest change's report says, or as its report, still to come, will.
    // Delivered without recording it: it is no change.
    const newest = this.#changed.get(scope);
    if (newest && newest[1].revision >= this.#mutated.get(scope)!) {
      const type = newest[0] as keyof ChartEvents;
      const again = { ...newest[1], cause: "api", revision: this.#host.revision() };
      this.#host.events.deliver(type, this.#heard(type, again as never));
    }
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

  /**
   * `#scopes` of a write; undefined for one naming a panel the first frame
   * has not drawn yet (the write waits for that frame, or is refused).
   */
  #scopesOf(type: string, of: object, view?: ViewChange): string[] | undefined {
    try {
      return this.#scopes(type, of, view);
    } catch {
      return undefined;
    }
  }

  /** A state event with its basis and its state's whole value; others as they are. */
  #extend<K extends keyof ChartEvents>(type: K, event: Unextended<ChartEvents[K]>): ChartEvents[K] {
    // Other events have nothing to add.
    if (!(REPORTS as readonly string[]).includes(type)) return event as never;
    const report = event as StateChange;
    const extra: Record<string, unknown> = { basis: this.basisAt(report.revision) };
    const host = this.#host;
    if (type === "select") {
      const { selection, owner } = event as ChartEvents["select"];
      extra.state = host.selection();
      extra.conditions = conditionsOf(
        host.model,
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
    return { ...report, ...extra } as ChartEvents[K];
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
      selectionLooks(
        LOOKS_KIT,
        host.model,
        () => host.selection(),
        () => host.invalidate(),
      );
      this.#looks = true;
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
