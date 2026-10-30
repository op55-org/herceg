// The notebook widget's front end, loaded by anywidget: draws a ChartWidget
// (python/src/herceg/widget.py), applies the updates Python sends, and
// reports interaction back.
//
// A widget shown in several outputs has one view per output. The views share
// the widget's tables and marks, so each update is decoded once and every
// view redraws from the same data.

import {
  type Camera,
  type Chart,
  type ChartOptions,
  createChart,
  type DataSelection,
  RowSet,
  type SelectionStore,
  selectRows,
  selectWhere,
  showFailure,
  type Table,
  type Viewport,
} from "herceg";
import {
  type ChartErrorInfo,
  type ChartSpec,
  type ColumnSpec,
  chartError,
  type Expression,
  errorInfo,
  loadSpec,
  restoreVisibility,
  type SpecBuffer,
  type VisibilityState,
  visibilityState,
} from "herceg/spec";
import { resolveCamera, sameCamera } from "../../packages/herceg/src/three/camera.ts";
import {
  CAMERAS,
  chartSelection,
  chartViewport,
  DRILLS,
  type DrillPayload,
  drillPayload,
  edgePayload,
  type ItemPositionsPayload,
  inspectionPayload,
  MOVES,
  namesCategories,
  PLANES,
  positionsValue,
  recordPosition,
  restoreViewportState,
  type SelectionPayload,
  selectionPayload,
  selectionReport,
  showDrillRoot,
  showItemPositions,
  statePanels,
  targetOf,
  type ViewportEventPayload,
  type ViewportPayload,
  type ViewportStatePayload,
  viewportEventPayload,
  viewportPayload,
  viewportStatePayload,
} from "./events.ts";
import { planeKeys } from "./planes.ts";
import { resetColumns } from "./tables.ts";

/** The parts of an anywidget model this module uses. */
export interface Model {
  get(name: string): unknown;
  send(content: object, callbacks?: unknown, buffers?: ArrayBuffer[] | ArrayBufferView[]): void;
  on(event: string, callback: (...args: never[]) => void): void;
}

/**
 * What a chart's views show: its axes, as the engine reads them
 * (`viewportStatePayload`), and each map's or network's subplot's plane,
 * which that leaves out, by panel.
 */
export interface ViewsPayload {
  axes: ViewportStatePayload;
  planes: Record<string, ViewportPayload>;
}

/**
 * A change of view Python asks for (`set_viewport`), which each display's
 * chart makes or refuses: the axes given (none to reset every one) of
 * `panel`'s instances, or of those every panel shares.
 */
export interface ViewportRequest {
  request: number;
  viewport: Partial<Omit<ViewportPayload, "time">> | null;
  panel?: string;
}

/** Interaction state shared by Python and every display. */
interface ViewStates {
  camera: Camera | null;
  select: SelectionPayload | null;
  viewport: ViewsPayload | null;
  drill: DrillPayload | null;
  itemMove: ItemPositionsPayload;
  visibility: VisibilityState | null;
}
type ViewEvent = keyof ViewStates;
type ViewState = ViewStates[ViewEvent];
const stateKeys = {
  camera: "camera",
  select: "selection",
  viewport: "views",
  drill: "drill_root",
  itemMove: "item_positions",
  visibility: "visibility",
} as const;
/** Events whose state each network subplot (or tree or 3D subplot) has of its own. */
type PanelEvent = "drill" | "itemMove" | "camera";

/**
 * Where a state is kept: the event's name for the chart's, "event:panel"
 * for a subplot's (see `targetOf`); also the outbox's kind of its reports.
 */
function stateKey(event: ViewEvent, panel = ""): string {
  return panel === "" ? event : `${event}:${panel}`;
}

/**
 * A channel's selection between Python and the browser: a condition, or
 * rows, whose positions (Python to the browser) or identities (back) travel
 * as a buffer.
 */
export type RowsPayload =
  | { kind: "predicate"; expression: Expression }
  | { kind: "rows"; rows?: number; generation?: number };

/** What a bound channel holds, as a snapshot restores it. */
export interface HeldRows {
  table: string;
  channel: string;
  selection: RowsPayload | null;
}

/** The whole chart as Python sends it when a browser connects. */
export interface Snapshot {
  /** Counts the changes Python sent; every update carries the next number. */
  revision: number;
  camera?: Camera | null;
  spec: ChartSpec;
  buffers: SpecBuffer[];
  selection: SelectionPayload | null;
  /** The views as a display last reported them; null before any did. */
  viewport: ViewsPayload | null;
  /** Python's changes of view no display has made yet, in order. */
  viewportRequests?: ViewportRequest[];
  /**
   * What the legends hide, as a display last reported or Python set it,
   * and whether of a chart drawn before this one (`carried`), whose marks
   * may be others now.
   */
  visibility?: { state: VisibilityState; carried: boolean } | null;
  drill_root: DrillPayload | null;
  item_positions: ItemPositionsPayload;
  /** The states of subplots' networks, trees, and 3D marks, by event and panel. */
  panel_states?: Partial<Record<PanelEvent, Record<string, ViewState>>>;
  /**
   * Per table a row selection binds, how Python numbers its rows: the rows
   * dropped from its front since it was last replaced, and how many times
   * it was. Rows reported to Python are numbered so.
   */
  rows?: Record<string, [number, number]>;
  /** What the bound channels hold, rows indexing `buffers`. */
  rowSelections?: HeldRows[];
}

type Columns = Record<string, ColumnSpec>;

/**
 * Updates from Python. Columns index the buffers sent with the message. A
 * selection or viewport comes from Python or, with its `origin`, from a browser.
 */
/**
 * Python showing or hiding the cursor (`show_cursor`, `hide_cursor`): not
 * state, so outside the updates' revisions.
 */
interface CursorMessage {
  type: "cursor";
  position: { x: number | string } | { y: number | string } | null;
  broadcast: boolean;
  snap?: "nearest" | "previous" | "next";
  tooltip?: boolean;
}

export type Update = { revision: number } & (
  | { type: "append"; table: string; columns: Columns; maxRows?: number }
  | { type: "replace"; table: string; columns: Columns }
  | { type: "tables"; tables: Record<string, Columns>; options: Record<string, unknown> }
  | { type: "chart"; spec: ChartSpec; rows: Record<string, [number, number]> }
  | { type: "options"; options: Record<string, unknown> }
  | { type: "select"; selection: SelectionPayload | null; origin?: string }
  | { type: "camera"; camera: Camera | null; panel?: string; origin?: string }
  | { type: "viewport"; views: ViewsPayload | null; origin?: string }
  | ({ type: "setViewport" } & ViewportRequest)
  | { type: "visibility"; visibility: VisibilityState | null; origin?: string }
  | { type: "drill"; drill_root: DrillPayload | null; panel?: string; origin?: string }
  | { type: "itemMove"; item_positions: ItemPositionsPayload; panel?: string; origin?: string }
  | { type: "rows"; table: string; channel: string; selection: RowsPayload | null; origin?: string }
);

interface View {
  host: HTMLElement;
  element: HTMLDivElement;
  chart: Chart | undefined;
  /** The nodes this view's chart has moved, by panel ("" for the chart's one network). */
  positions: Map<string, ItemPositionsPayload>;
  /** The last error shown above the chart. */
  error: HTMLElement | undefined;
  /**
   * While its chart takes the views agreed on (see `#follow`): the changes
   * of view it made meanwhile, which go to no one, and Python's requests
   * waiting for it.
   */
  following?: { event: ViewportEventPayload | undefined; requests: ViewportRequest[] } | undefined;
  /** While its chart restores what the legends hid: done once it has, which later states wait for. */
  visibility?: Promise<void> | undefined;
  /**
   * The latest state sent to it while it restores, which it shows once it
   * has: what restoring hides meanwhile goes to no one.
   */
  newer?: { state: VisibilityState | null } | undefined;
}

type Range = readonly [number, number];

const DEFAULT_HEIGHT = 320;
/** Hover, zoom, and selection reach Python at most this often, the latest last. */
const THROTTLE_MS = 100;

class Widget {
  readonly #model: Model;
  readonly #views = new Set<View>();
  readonly #outbox: Throttle;
  /**
   * Tells this browser's range reports from those of other browsers on the
   * same widget, so Python's broadcast of them does not move this one back.
   */
  readonly #origin = Math.random().toString(36).slice(2);
  #revision = 0;
  /** Waiting for the whole chart after missing an update; updates until then are dropped. */
  #resyncing = false;
  #tables = new Map<string, Table>();
  #config: ChartOptions | undefined;
  /** Effective defaults by camera owner, including while no display is mounted. */
  #configuredCameras = new Map<string, Camera>();
  /** The coordinate system of each map's or network's view, by state (see `planeKeys`). */
  #planeKeys: Map<string, string> | undefined;
  /** The tables each network reads, with those they derive from, by state (see `networkTables`). */
  #networkTables = new Map<string, Set<string>>();
  /** The states of networks reading a derived table, whose nodes added rows can take away. */
  #derivedNetworks = new Set<string>();
  /** The spec's chart options, which option updates change. */
  #options: Record<string, unknown> = {};
  /** The rest of the spec: its tables, marks, and panels, which updates never change. */
  #structure: Record<string, unknown> = {};
  #error: unknown;
  /** Interaction state Python and the browser last agreed on, to drop echoes, by `stateKey`. */
  #states = new Map<string, ViewState>();
  /** The stores the views' row selections bind, by table name, which the views share. */
  #stores = new Map<string, SelectionStore>();
  /** Python's numbering of each bound table's rows, as of the snapshot (see `Snapshot.rows`). */
  #numbering: Record<string, [number, number]> = {};
  #unsubscribe: (() => void)[] = [];
  /** Applying a row selection from Python, which goes back to no one. */
  #applying = false;
  #itemsFrame: number | undefined;
  /** Moves not reported yet, by panel, and the view they come from. */
  #pendingPositions = new Map<string, ItemPositionsPayload>();
  #itemSource: View | undefined;
  /**
   * Python's changes of view no display has made or refused yet: every
   * display drawn makes them, and the first to settle one tells Python.
   */
  #requests: ViewportRequest[] = [];

  /** Whether what the legends hide was agreed on for a chart drawn before this one. */
  #visibilityCarried = false;

  constructor(model: Model) {
    this.#model = model;
    // Rows travel as buffers beside the message.
    this.#outbox = new Throttle((content) => {
      const { buffers, ...rest } = content as { buffers?: ArrayBuffer[] };
      model.send(rest, undefined, buffers);
    });
    this.#load(model.get("_chart") as Snapshot);
    model.on("change:_chart", () => {
      const snapshot = model.get("_chart") as Snapshot;
      // Python sends the chart to every browser when one asks; a browser
      // that has applied as many changes already draws the same chart.
      if (!this.#resyncing && snapshot.revision <= this.#revision) return;
      this.#load(snapshot);
      for (const view of this.#views) this.#mount(view, true, true);
    });
    model.on("msg:custom", (message: Update | CursorMessage, buffers: DataView[]) =>
      this.#receive(message, buffers ?? []),
    );
    // Python sends the whole chart again if this one is out of date.
    model.send({ type: "ready", revision: this.#revision });
  }

  render(host: HTMLElement): () => void {
    const element = host.ownerDocument.createElement("div");
    const view: View = {
      host,
      element,
      chart: undefined,
      positions: new Map(),
      error: undefined,
    };
    host.append(element);
    this.#views.add(view);
    this.#mount(view);
    return () => {
      view.chart?.destroy();
      view.chart = undefined;
      view.error?.remove();
      element.remove();
      this.#views.delete(view);
    };
  }

  dispose(): void {
    this.#cancelItems();
    this.#outbox.dispose();
    for (const stop of this.#unsubscribe) stop();
  }

  #load(snapshot: Snapshot) {
    this.#revision = snapshot.revision;
    this.#resyncing = false;
    // Views and rows waiting to be reported predate the snapshot's.
    this.#outbox.cancel("select");
    this.#outbox.cancelAll("camera");
    this.#outbox.cancel("viewport");
    this.#outbox.cancel("visibility");
    this.#outbox.cancelAll("drill");
    this.#cancelItems();
    this.#outbox.cancelAll("rows:");
    this.#states = new Map<string, ViewState>([
      ["camera", snapshot.camera ?? null],
      ["select", snapshot.selection],
      ["viewport", snapshot.viewport],
      ["visibility", snapshot.visibility?.state ?? null],
      ["drill", snapshot.drill_root],
      ["itemMove", snapshot.item_positions],
    ]);
    this.#requests = [...(snapshot.viewportRequests ?? [])];
    this.#visibilityCarried = snapshot.visibility?.carried ?? false;
    for (const [event, states] of Object.entries(snapshot.panel_states ?? {}))
      for (const [panel, state] of Object.entries(states))
        this.#states.set(stateKey(event as PanelEvent, panel), state);
    this.#loadChart(snapshot.spec, snapshot.buffers, snapshot.rows ?? {}, true);
    for (const { table, channel, selection } of snapshot.rowSelections ?? []) {
      const rows = selection?.kind === "rows" ? snapshot.buffers[selection.rows!] : undefined;
      this.#setRows(table, channel, selection, rows && view(rows));
    }
  }

  /**
   * Loads a chart's spec: its tables, marks, and options, and the stores
   * of its row selections, which Python numbers rows of as `numbering` says.
   * Interaction state stays as it is.
   */
  #loadChart(
    spec: ChartSpec,
    buffers: readonly SpecBuffer[],
    numbering: Record<string, [number, number]>,
    restored = false,
  ) {
    // Option updates never change the row selection: it binds the tables loaded here.
    const { data, marks, version, facet, panels, layout, rowSelection, ...options } = spec;
    this.#structure = { data, marks, version, facet, panels, layout, rowSelection };
    this.#options = options;
    for (const stop of this.#unsubscribe) stop();
    this.#unsubscribe = [];
    try {
      const loaded = loadSpec(spec, buffers);
      this.#tables = loaded.tables;
      this.#config = loaded.config;
      this.#networkTables = networkTables(spec);
      this.#derivedNetworks = derivedNetworks(spec, this.#networkTables);
      this.#stores = loaded.stores;
      this.#error = undefined;
    } catch (error) {
      this.#tables = new Map();
      this.#config = undefined;
      this.#networkTables = new Map();
      this.#derivedNetworks = new Set();
      this.#stores = new Map();
      this.#error = error;
    }
    this.#numbering = numbering;
    this.#reconcileCameras(restored);
    // Changes of the channels by any view go to Python, as Python numbers rows.
    for (const [name, store] of this.#stores) {
      const channels = (this.#config?.rowSelection?.bindings ?? [])
        .filter((binding) => binding.store === store)
        .map(({ channel }) => channel);
      const seen = new Map(channels.map((channel) => [channel, store.get(channel)]));
      this.#unsubscribe.push(
        store.subscribe(() => {
          for (const channel of channels) {
            const now = store.get(channel);
            if (now === seen.get(channel)) continue;
            seen.set(channel, now);
            if (!this.#applying) this.#reportRows(name, channel, now);
          }
        }),
      );
    }
    this.#keepMapView();
  }

  /** Reports a channel's selection to Python: rows by identity, as Python numbers them. */
  #reportRows(name: string, channel: string, selection: DataSelection | null) {
    const table = this.#tables.get(name)!;
    const [dropped, generation] = this.#numbering[name] ?? [0, 0];
    // The revision tells Python which of its changes this one was made after.
    const content = {
      type: "rowSelection",
      table: name,
      channel,
      origin: this.#origin,
      revision: this.#revision,
    };
    if (selection?.kind !== "rows") {
      const payload = selection && { kind: "predicate", expression: selection.expression };
      this.#outbox.post(`rows:${name}:${channel}`, { ...content, selection: payload });
      return;
    }
    const positions = selection.rows.positions();
    // Python numbers rows from the snapshot's first, until a reset numbers them
    // afresh: the table's identities, past the rows the snapshot left out.
    const shift = table.generation === 0 ? dropped : 0;
    const identities = Float64Array.from(positions, (position) => table.identity(position) + shift);
    this.#outbox.post(`rows:${name}:${channel}`, {
      ...content,
      selection: { kind: "rows", generation: generation + table.generation },
      buffers: [identities.buffer],
    });
  }

  /** Sets a channel from Python: a condition, rows by position (`rows`), or nothing. */
  #setRows(
    name: string,
    channel: string,
    selection: RowsPayload | null,
    rows: Uint32Array | undefined,
  ) {
    const store = this.#stores.get(name);
    const table = this.#tables.get(name);
    if (!store || !table) return;
    let held: DataSelection | null = null;
    if (selection?.kind === "predicate") held = selectWhere(selection.expression);
    else if (selection?.kind === "rows") held = selectRows(new RowSet(table).addAll(rows ?? []));
    this.#applying = true;
    try {
      store.set(channel, held);
    } finally {
      this.#applying = false;
    }
  }

  /**
   * Draws the chart in a view. A chart drawn again (`again`) keeps its
   * views (as the views agreed on) and the keyboard focus, and, drawn from
   * other marks Python sent, what its legends hid where its marks and
   * series still are (see `restoreVisibility`); drawn from a snapshot
   * (`snapshot`), it hides what the snapshot says.
   */
  #mount(view: View, again = false, snapshot = false) {
    const previous = again ? view.chart : undefined;
    // Read before the chart goes: what it hides, is still to restore, or
    // was sent to show once it has.
    const before =
      previous && visibilityState(previous, view.newer && (view.newer.state ?? { hiddenKeys: [] }));
    const carried = before && !snapshot ? before : undefined;
    const focused = again && view.element.contains(view.element.ownerDocument.activeElement);
    view.chart?.destroy();
    view.chart = undefined;
    view.following = undefined;
    view.visibility = undefined;
    view.newer = undefined;
    view.error?.remove();
    view.element.replaceChildren();
    this.#size(view);
    if (!this.#config) {
      showError(view, this.#error);
      return;
    }
    let chart: Chart;
    try {
      chart = createChart(view.element, this.#config);
    } catch (error) {
      showError(view, error);
      return;
    }
    view.chart = chart;
    view.positions = new Map();
    if (focused) view.element.querySelector<HTMLElement>("[tabindex]")?.focus();
    const config = this.#config;
    // Each subplot's network or tree has a state of its own.
    const cameras = statePanels(config, CAMERAS);
    const drills = statePanels(config, DRILLS);
    const moves = statePanels(config, MOVES);
    // What the legends hid: the chart's before, or as agreed on, which a
    // chart replaced since agreed on for other marks. Restoring waits for
    // what the chart loads itself; a state sent meanwhile is newer.
    const restoring = carried ?? (this.#visibilityCarried ? this.#state("visibility") : null);
    if (restoring) {
      const done: Promise<void> = restoreVisibility(chart, restoring).then(
        () => {
          if (view.visibility === done) view.visibility = undefined;
        },
        () => {},
      );
      view.visibility = done;
    }
    // What Python and the last chart left: restored before listening, so
    // that restoring does not echo back to Python, or for a subplot chart
    // whose first scene waits for its guides, once its panels are known
    // (what is reported then is what Python has, and goes no further).
    const restore = () => {
      const agreed = this.#state("visibility");
      if (view.newer || (!restoring && agreed)) {
        try {
          this.#showVisibility(view, view.newer ? view.newer.state : agreed);
        } catch (error) {
          this.#refused(error);
        }
      }
      // Python's changes of view no display made yet: this one makes them too.
      void this.#follow(view, this.#state("viewport"), this.#requests);
      for (const panel of cameras)
        this.#show(view, "camera", this.#state("camera", panel), true, panel);
      for (const panel of drills)
        this.#show(view, "drill", this.#state("drill", panel), true, panel);
      for (const panel of moves) this.#show(view, "itemMove", this.#positions(panel), true, panel);
      this.#show(view, "select", this.#state("select"));
    };
    // What restoring changed that Python should hear.
    const restored = () => {
      for (const panel of drills)
        this.#report("drill", view, drillPayload(chart.getDrillRoot(targetOf(panel))), panel);
      if (!chart.getHiddenKeys().length)
        for (const panel of moves)
          this.#report("itemMove", view, { ...view.positions.get(panel) }, panel);
      // A selection whose categories are gone, or moved under its lasso, goes,
      // and Python hears so.
      if (this.#state("select") && !chart.selection) this.#report("select", view, null);
      for (const panel of cameras)
        this.#report("camera", view, chart.getCamera(targetOf(panel)) ?? null, panel);
    };
    const waiting = this.#waiting(chart) ? chart.loading : undefined;
    if (!waiting) restore();
    chart.on("select", (selection) =>
      this.#report("select", view, selectionReport(selection, selection.owner)),
    );
    // Python reads the views as the engine does, by scale instance and
    // panel, beside the planes of subplots' maps and networks. A change
    // made while the chart takes the views agreed on goes to no one: what
    // it comes to is reported once it has.
    chart.on("viewport", (event) => {
      const payload = viewportEventPayload(event);
      if (view.following) view.following.event = merged(view.following.event, payload);
      else this.#report("viewport", view, this.#viewsOf(chart), "", false, payload);
    });
    // The state the event reports, without what made it.
    chart.on("visibility", ({ hiddenKeys, panels }) => {
      if (!view.newer) this.#report("visibility", view, { hiddenKeys, ...(panels && { panels }) });
    });
    chart.on("drill", (root) => {
      if (!this.#applying) this.#report("drill", view, drillPayload(root), root.panels?.[0] ?? "");
    });
    chart.on("itemMove", ({ key, position, panels }) => {
      if (this.#applying) return;
      const panel = panels?.[0] ?? "";
      const own = view.positions.get(panel) ?? {};
      view.positions.set(panel, own);
      recordPosition(own, key, position);
      const pending = this.#pendingPositions.get(panel) ?? { ...this.#positions(panel) };
      this.#pendingPositions.set(panel, pending);
      recordPosition(pending, key, position);
      this.#itemSource = view;
      this.#itemsFrame ??= requestAnimationFrame(() => {
        this.#itemsFrame = undefined;
        const source = this.#itemSource!;
        const reports = [...this.#pendingPositions];
        this.#pendingPositions.clear();
        this.#itemSource = undefined;
        for (const [at, positions] of reports) this.#report("itemMove", source, positions, at);
      });
    });
    chart.on("visibility", () => {
      for (const panel of moves) this.#show(view, "itemMove", this.#positions(panel), true, panel);
    });
    if (!waiting) restored();
    else
      waiting.then(
        () => {
          if (view.chart !== chart) return;
          chart.render();
          restore();
          restored();
        },
        () => {},
      );
    chart.on("hover", ({ inspection }) => {
      if (!this.#listening("hover")) return;
      this.#outbox.post("hover", {
        type: "hover",
        inspection: inspectionPayload(chart, inspection),
      });
    });
    chart.on("click", ({ inspection }) => {
      if (!inspection || !this.#listening("click")) return;
      this.#model.send({ type: "click", inspection: inspectionPayload(chart, inspection) });
    });
    chart.on("edge", (edge) => {
      if (this.#listening("edge")) this.#model.send({ type: "edge", edge: edgePayload(edge) });
    });
    // A drag turns the camera every frame: Python hears of it at most once a throttle interval.
    chart.on("camera", ({ camera, panels }) =>
      this.#report("camera", view, camera, panels?.[0] ?? ""),
    );
  }

  /** What a display's chart shows: its axes' views, and its subplots' maps' and networks'. */
  #viewsOf(chart: Chart): ViewsPayload {
    const planes = this.#config?.panels ? statePanels(this.#config, PLANES) : [];
    return {
      axes: viewportStatePayload(chart),
      planes: Object.fromEntries(
        planes.map((panel) => [panel, viewportPayload(chart, chart.getViewport({ panel }), true)]),
      ),
    };
  }

  /**
   * Gives a display's chart the views agreed on (`views`; none before a
   * display reported any): its axes' through the engine, which finds each
   * scale instance again where it is the same one and fits the others, and
   * its subplots' planes. Then makes Python's `requests` not yet made. A
   * change of view made meanwhile goes to no one; if the chart then shows
   * other views than those agreed on (limits it applies, panels it lacks),
   * those are reported, with the changes that made them.
   */
  async #follow(view: View, views: ViewsPayload | null, requests: readonly ViewportRequest[] = []) {
    const chart = view.chart!;
    const following = {
      event: view.following?.event,
      requests: [...(view.following?.requests ?? []), ...requests],
    };
    view.following = following;
    try {
      if (views?.axes.scales.length) await restoreViewportState(chart, views.axes);
    } catch (error) {
      // A state another chart reported that this one cannot read: its own views stay.
      console.error("herceg: could not restore the views", error);
    }
    // A chart drawn again since, or another state to follow, which won.
    if (view.chart !== chart || view.following !== following) return;
    try {
      this.#showPlanes(chart, views);
    } catch (error) {
      console.error("herceg: could not restore a map's or network's view", error);
    }
    view.following = undefined;
    for (const request of following.requests) this.#make(view, request);
    const now = this.#viewsOf(chart);
    if (valuesOf("viewport", now) !== valuesOf("viewport", this.#state("viewport")))
      this.#report("viewport", view, now, "", false, following.event);
  }

  /** Shows the views of maps and networks agreed on: the chart's one, or each subplot's. */
  #showPlanes(chart: Chart, views: ViewsPayload | null) {
    const config = this.#config!;
    if (!config.panels) {
      const plane = config.marks.some((mark) => PLANES.includes(mark.spec.type));
      const shown = views?.axes.view;
      if (plane && shown)
        chart.setViewport({ x: shown.x as Range | null, y: shown.y as Range | null });
      return;
    }
    for (const panel of statePanels(config, PLANES)) {
      const shown = views?.planes[panel];
      if (shown)
        chart.setViewport({ x: shown.x as Range | null, y: shown.y as Range | null }, { panel });
    }
  }

  /**
   * Makes a change of view Python asked for in a display's chart, as its
   * engine takes it, and settles it (see `#settle`). A display taking the
   * views agreed on makes it once it has.
   */
  #make(view: View, request: ViewportRequest) {
    if (view.following) {
      view.following.requests.push(request);
      return;
    }
    const chart = view.chart!;
    const { viewport, panel } = request;
    const target = panel === undefined ? undefined : { panel };
    try {
      if (viewport === null) chart.setViewport(null, target);
      else if (this.#plane(panel)) {
        const { x, y } = viewport as { x?: Range | null; y?: Range | null };
        chart.setViewport({ ...(x !== undefined && { x }), ...(y !== undefined && { y }) }, target);
      } else {
        // Categories named by label are read off the data as drawn.
        if (Object.values(viewport).some((ends) => typeof ends?.[0] === "string")) chart.render();
        const shown = chartViewport(chart, { x: null, y: null, yRight: null, ...viewport }, panel);
        const change: Partial<Viewport> = {};
        for (const axis of ["x", "y", "yRight"] as const)
          if (viewport[axis] !== undefined) change[axis] = shown[axis];
        chart.setViewport(change, target);
      }
    } catch (error) {
      this.#settle(request, error);
      return;
    }
    this.#settle(request);
  }

  /**
   * Tells Python a display made a change of view it asked for, or refused
   * it (`error`): the first display to do either settles it, and the
   * others' make no news.
   */
  #settle({ request }: ViewportRequest, error?: unknown) {
    const at = this.#requests.findIndex((pending) => pending.request === request);
    if (at < 0) return;
    this.#requests.splice(at, 1);
    if (error === undefined) this.#model.send({ type: "applied", request, origin: this.#origin });
    else this.#refused(error, request);
  }

  /** Whether `panel` (none for the chart's own view) is a map's or network's plane. */
  #plane(panel: string | undefined): boolean {
    const config = this.#config!;
    if (panel === undefined)
      return !config.panels && config.marks.some((mark) => PLANES.includes(mark.spec.type));
    return !!config.panels && statePanels(config, PLANES).includes(panel);
  }

  /**
   * Tells Python what a chart refused of what it asked (`request`, a change
   * of view), or of an update: as the engine says it, with its code and path.
   */
  #refused(error: unknown, request?: number) {
    const info: ChartErrorInfo = errorInfo(chartError(error, "compile"));
    this.#model.send({
      type: "error",
      error: info,
      origin: this.#origin,
      ...(request !== undefined && { request }),
    });
  }

  #size({ element }: View) {
    const { width, height } = this.#config ?? {};
    element.style.width = width === undefined ? "100%" : `${width}px`;
    element.style.height = `${height ?? DEFAULT_HEIGHT}px`;
  }

  #listening(event: string): boolean {
    return ((this.#model.get("_listening") as string[] | undefined) ?? []).includes(event);
  }

  /** Drops moves not reported yet: of the networks of states `panels`, or every network's. */
  #cancelItems(panels?: readonly string[]) {
    if (panels) {
      for (const panel of panels) {
        this.#pendingPositions.delete(panel);
        this.#outbox.cancel(stateKey("itemMove", panel));
      }
    } else {
      this.#pendingPositions.clear();
      this.#outbox.cancelAll("itemMove");
    }
    if (this.#pendingPositions.size > 0) return;
    if (this.#itemsFrame !== undefined) cancelAnimationFrame(this.#itemsFrame);
    this.#itemsFrame = undefined;
    this.#itemSource = undefined;
  }

  /** The state of `event` of panel `panel` ("" for the chart's one) as last agreed on. */
  #state<K extends ViewEvent>(event: K, panel = ""): ViewStates[K] {
    // No nodes moved, as Python starts.
    const none = event === "itemMove" ? {} : null;
    return (this.#states.get(stateKey(event, panel)) ?? none) as ViewStates[K];
  }

  /** The moved nodes of panel `panel`'s network. */
  #positions(panel: string): ItemPositionsPayload {
    return this.#state("itemMove", panel);
  }

  /**
   * Follows a change of tables `tables` in the moves of the networks
   * reading them. Moved nodes the data still has stay moved; the others go,
   * here as in Python, which lets go of the same ones (but for networks of
   * derived tables, whose rows it lacks). Moves not sent yet were made on
   * the data before: waiting for their frame or held back by the throttle,
   * those the data keeps are sent at the change's revision.
   */
  #followPositions(tables: readonly string[], derivedOnly = false) {
    const panels = [...this.#networkTables]
      .filter(([panel]) => !derivedOnly || this.#derivedNetworks.has(panel))
      .filter(([, read]) => tables.some((table) => read.has(table)))
      .map(([panel]) => panel);
    if (panels.length === 0) return;
    const source = this.#itemSource;
    const unsent = new Map<string, { moves: ItemPositionsPayload; view: View | undefined }>();
    for (const panel of panels) {
      const waiting = this.#pendingPositions.get(panel);
      const held = this.#outbox.cancel(stateKey("itemMove", panel));
      if (waiting) unsent.set(panel, { moves: waiting, view: source });
      else if (held) unsent.set(panel, { moves: this.#positions(panel), view: undefined });
    }
    this.#cancelItems(panels);
    const views = [...this.#views].filter((view) => this.#ready(view));
    for (const panel of panels) {
      const waiting = unsent.get(panel);
      const state = waiting?.moves ?? this.#positions(panel);
      // Nothing moved and nothing to send: no frame drawn before its time.
      if (!waiting && Object.keys(state).length === 0) continue;
      // A move waiting for its frame is drawn only in the display it came
      // from; every display holds the others, of hidden nodes too. Without
      // one (closed since), the networks' tables say which nodes remain.
      const source = waiting?.view;
      const view = source ? (this.#views.has(source) ? source : undefined) : views[0];
      let keeps = (key: string) => this.#ownsNode(key);
      if (view && this.#ready(view)) {
        view.chart!.render();
        const kept = view.chart!.getItemPositions(targetOf(panel));
        keeps = (key) => Object.hasOwn(kept, key);
      }
      const remaining = Object.fromEntries(Object.entries(state).filter(([key]) => keeps(key)));
      this.#report("itemMove", view, remaining, panel, waiting !== undefined);
    }
  }

  /** Whether a network of the chart, as its tables are now, has the node keyed `key`. */
  #ownsNode(key: string): boolean {
    return (this.#config?.marks ?? []).some((mark, index) => {
      const owns = (mark as { ownsNode?: (key: string, id: string | number) => boolean }).ownsNode;
      return owns?.call(mark, key, mark.spec.id ?? index) === true;
    });
  }

  /**
   * A view's interaction state changed (of panel `panel`, "" for the
   * chart's one): the other views follow, and Python hears of it.
   */
  #report<K extends ViewEvent>(
    event: K,
    source: View | undefined,
    payload: ViewStates[K],
    panel = "",
    resend = false,
    change?: ViewportEventPayload,
  ) {
    const key = stateKey(event, panel);
    const same = valuesOf(event, payload) === valuesOf(event, this.#state(event, panel));
    // The same values, perhaps saying better which axes hold times.
    if (payload || !same) this.#states.set(key, payload);
    // Sent again only when Python may not have heard of them.
    if (same && !resend) return;
    const shown = same ? [] : this.#views;
    for (const view of shown) {
      if (!this.#ready(view) || (view === source && event !== "itemMove")) continue;
      try {
        this.#show(view, event, payload, event === "itemMove", panel);
      } catch (error) {
        showError(view, error);
      }
    }
    // The revision tells Python which of its changes this one was made after.
    const value = { [stateKeys[event]]: payload, ...(panel && { panel }) };
    const report: Record<string, unknown> = {
      type: event,
      ...value,
      origin: this.#origin,
      revision: this.#revision,
    };
    // Changes of view held back by the throttle reach Python as one, of
    // every instance and panel they changed.
    if (event === "viewport") {
      const held = this.#outbox.held(key) as { event?: ViewportEventPayload } | undefined;
      const all = merged(held?.event, change);
      if (all) report.event = all;
    }
    this.#outbox.post(key, report);
  }

  /**
   * Shows interaction state in a chart. Category labels are found in
   * the bands of the current data, so the chart first draws any data
   * changes it has not drawn yet. A selection shown here writes no rows:
   * the view brushed wrote them to the stores every view shares.
   */
  /** Whether a subplot chart has not had its first scene, its panels unknown until loading settles. */
  #waiting(chart: Chart): boolean {
    return !!this.#config?.panels && chart.getPanels().length === 0 && chart.loading !== undefined;
  }

  /**
   * Whether a view shows a chart that states apply to now: one waiting for
   * its panels takes the latest when it has them.
   */
  #ready(view: View): boolean {
    return !!view.chart && !this.#waiting(view.chart);
  }

  #show(view: View, event: ViewEvent, payload: ViewState, restore = false, panel = "") {
    const chart = view.chart!;
    if (event === "viewport") {
      void this.#follow(view, payload as ViewsPayload | null);
      return;
    }
    if (event === "visibility") {
      this.#showVisibility(view, payload as VisibilityState | null);
      return;
    }
    if (event === "camera") {
      chart.setCamera(payload as Camera | null, targetOf(panel));
      return;
    }
    if (event === "drill" || event === "itemMove") {
      this.#applying = true;
      try {
        if (event === "drill") showDrillRoot(chart, payload as DrillPayload | null, restore, panel);
        else {
          const held = view.positions.get(panel) ?? {};
          view.positions.set(panel, held);
          showItemPositions(chart, payload as ItemPositionsPayload, held, restore, panel);
        }
      } finally {
        this.#applying = false;
      }
      return;
    }
    if (event === "select") {
      const selection = payload as SelectionPayload | null;
      if (namesCategories(selection) || selection?.lasso) chart.render();
      // A subplot's map or network's lasso is its panel's.
      const target = selection?.panels?.[0];
      chart.select(chartSelection(chart, selection), {
        rows: false,
        ...(target !== undefined && { panel: target }),
      });
      if (selection?.lasso && !selection.categories) this.#learnCategories(chart, selection);
    }
  }

  /**
   * Hides what `state` says in a display's chart: at once (refusals thrown),
   * or once it has restored what its legends hid, which `state` is newer
   * than (refusals going back to Python).
   */
  #showVisibility(view: View, state: VisibilityState | null) {
    const chart = view.chart!;
    const show = () => chart.setHiddenKeys(state?.hiddenKeys ?? [], { panels: state?.panels });
    if (!view.visibility) {
      view.newer = undefined;
      return show();
    }
    const newer = { state };
    view.newer = newer;
    const done: Promise<void> = view.visibility.then(() => {
      if (view.visibility === done) view.visibility = undefined;
      if (view.chart !== chart) return;
      if (view.newer === newer) view.newer = undefined;
      try {
        show();
      } catch (error) {
        this.#refused(error);
      }
    });
    view.visibility = done;
  }

  /**
   * A lasso from Python is over the categories a chart draws when it first
   * shows it: they are kept with it, here and in Python, so that it goes
   * when they move.
   */
  #learnCategories(chart: Chart, selection: SelectionPayload) {
    const categories = selectionPayload(chart.selection, chart.selectionOwner)?.categories;
    if (!categories) return;
    const known = { ...selection, categories };
    this.#states.set("select", known);
    const report = { type: "select", selection: known, origin: this.#origin };
    this.#outbox.post("select", { ...report, revision: this.#revision });
  }

  #receive(message: Update | CursorMessage, buffers: readonly DataView[]) {
    if (message.type === "cursor") {
      const { position, broadcast, snap, tooltip } = message;
      const shown = { broadcast, ...(snap && { snap }), ...(tooltip !== undefined && { tooltip }) };
      for (const { chart } of this.#views)
        if (position) chart?.showCursor(position, shown);
        else chart?.hideCursor({ broadcast });
      return;
    }
    // Already applied: a duplicate.
    if (this.#resyncing || message.revision <= this.#revision) return;
    if (message.revision > this.#revision + 1) {
      // An update was missed (this browser connected after it was sent, say).
      this.#resyncing = true;
      this.#model.send({ type: "resync" });
      return;
    }
    this.#revision = message.revision;
    try {
      this.#apply(message, buffers);
    } catch (error) {
      console.error("herceg: could not apply an update from Python", error);
      for (const view of this.#views) showError(view, error);
      this.#refused(error);
      return;
    }
    // An update applied: the banner over a chart of one that was not goes.
    for (const view of this.#views)
      if (view.chart && view.error) {
        view.error.remove();
        view.error = undefined;
      }
  }

  #apply(message: Update, buffers: readonly DataView[]) {
    switch (message.type) {
      case "append": {
        const table = this.#table(message.table);
        table.append(appendBatch(table, decode(message.columns, buffers)));
        const excess = message.maxRows === undefined ? 0 : table.length - message.maxRows;
        if (excess > 0) table.dropFirst(excess);
        // Rows added take no node from a network, but may from one over a
        // derived table (a sum turning negative); rows dropped may from any.
        this.#followPositions([message.table], excess <= 0);
        this.#keepMapView();
        this.#keepCategorySelection();
        return;
      }
      case "replace": {
        const table = this.#table(message.table);
        table.reset(resetColumns(table, decode(message.columns, buffers)));
        this.#followPositions([message.table]);
        this.#keepMapView();
        this.#keepCategorySelection();
        return;
      }
      case "tables": {
        // An express chart computed again: every table is read before any
        // changes, so one that cannot be read changes nothing.
        const tables = Object.entries(message.tables).map(([name, columns]) => {
          const table = this.#table(name);
          return [table, resetColumns(table, decode(columns, buffers))] as const;
        });
        for (const [table, columns] of tables) table.reset(columns);
        this.#followPositions(Object.keys(message.tables));
        this.#keepMapView();
        this.#keepCategorySelection();
        if (Object.keys(message.options).length) this.#updateOptions(message.options);
        return;
      }
      case "chart":
        // An express chart computed again with other marks: its data and
        // marks are new, not its interaction state, so the views draw it
        // again keeping their zoom and brush, and reports still on their
        // way to Python go on.
        this.#loadChart(message.spec, buffers, message.rows);
        // Changes of view asked for the chart it replaces go, as in Python;
        // what the legends hide was agreed on for its marks.
        this.#requests = [];
        this.#visibilityCarried = true;
        // Its networks' data is new, so their moved nodes go, as Python lets
        // go of them, with any moves still waiting to be reported.
        this.#cancelItems();
        for (const key of this.#states.keys())
          if (key === "itemMove" || key.startsWith("itemMove:")) this.#states.set(key, {});
        for (const view of this.#views) {
          view.positions.clear();
          this.#mount(view, true);
        }
        return;
      case "options":
        // Changes of view asked for before go, as in Python: the options may change the scales.
        this.#requests = [];
        for (const view of this.#views) if (view.following) view.following.requests = [];
        this.#updateOptions(message.options);
        return;
      case "rows":
        // A browser's own selection, back from Python: it holds it already.
        if (message.origin === this.#origin) return;
        this.#outbox.cancel(`rows:${message.table}:${message.channel}`);
        this.#setRows(
          message.table,
          message.channel,
          message.selection,
          buffers[0] && view(buffers[0]),
        );
        return;
      case "itemMove": {
        if (message.origin === this.#origin) return;
        const panel = message.panel ?? "";
        this.#cancelItems([panel]);
        const known = this.#positions(panel);
        const next = message.item_positions;
        this.#states.set(stateKey("itemMove", panel), next);
        const applied = new Set<string>();
        for (const view of this.#views) {
          if (!this.#ready(view)) continue;
          // A display that hides a node takes its override too, and draws it once shown.
          this.#show(view, "itemMove", next, true, panel);
          for (const key of Object.keys(view.positions.get(panel) ?? {})) applied.add(key);
        }
        const unknown = Object.keys(next).filter(
          (key) => !applied.has(key) && !Object.hasOwn(known, key),
        );
        // Checked where a chart has its networks drawn; else kept for restoring.
        const source = [...this.#views].find((view) => this.#ready(view));
        if (unknown.length && source) {
          const invalid = new Set(unknown);
          const kept = Object.fromEntries(
            Object.entries(next).filter(([key]) => !invalid.has(key)),
          );
          this.#report("itemMove", source, kept, panel);
          throw new Error(
            `widget.item_positions: no displayed node for ${JSON.stringify(unknown[0])}; use a reported item key`,
          );
        }
        return;
      }
      case "setViewport": {
        const { type: _, revision: __, ...request } = message;
        // Every display makes it, those drawn later too while none has.
        this.#requests.push(request);
        for (const view of this.#views) if (this.#ready(view)) this.#make(view, request);
        return;
      }
      case "camera":
      case "select":
      case "viewport":
      case "visibility":
      case "drill": {
        // This browser's own view, back from Python: it is already drawn,
        // and newer ones may be on their way.
        if (message.origin === this.#origin) return;
        const panel =
          message.type === "camera" || message.type === "drill" ? (message.panel ?? "") : "";
        const key = stateKey(message.type, panel);
        // A view from Python or another browser replaces any not yet reported.
        this.#outbox.cancel(key);
        const payload =
          message.type === "camera"
            ? message.camera
            : message.type === "select"
              ? message.selection
              : message.type === "viewport"
                ? message.views
                : message.type === "visibility"
                  ? message.visibility
                  : message.drill_root;
        this.#states.set(key, payload);
        if (message.type === "visibility") {
          this.#visibilityCarried = false;
          // Displays waiting for their panels show it once they have them.
          for (const view of this.#views)
            if (view.chart && !this.#ready(view)) view.newer = { state: message.visibility };
        }
        // Rows travel apart ("rows"): the browser whose view was brushed wrote
        // them, and Python sets them with `row_selection`.
        const name = panel ? "widget.panel_drill_roots" : "widget.drill_root";
        for (const view of this.#views) {
          // A chart waiting for its panels restores the state once it has them.
          if (!this.#ready(view)) continue;
          const root = () => drillPayload(view.chart!.getDrillRoot(targetOf(panel)));
          try {
            this.#show(view, message.type, payload, false, panel);
          } catch (error) {
            // Keys a chart cannot hide go back to Python, refused.
            if (message.type === "visibility") {
              this.#refused(error);
              return;
            }
            if (message.type !== "drill") throw error;
            this.#report("drill", view, root(), panel);
            throw new Error(
              `${name}: ${error instanceof Error ? error.message : String(error)}; use a reported item key`,
            );
          }
          if (message.type === "drill") this.#report("drill", view, root(), panel);
        }
        return;
      }
    }
  }

  /**
   * A selection on a category axis is its labels: when the data changes, the
   * brush moves to where they are now, or goes (and Python hears so) when
   * they are gone. A lasso's outline is in band positions, so it goes when
   * the categories change.
   */
  #keepCategorySelection() {
    const selection = this.#state("select");
    if (!namesCategories(selection)) return;
    for (const view of this.#views) if (this.#ready(view)) this.#show(view, "select", selection);
  }

  /**
   * A map's view and lasso belong to its resolved projection, which a data
   * update can change: they go where it did, each subplot's on its own.
   * Displays fit those views, and report it; without one, the views agreed
   * on lose them, and Python hears so.
   */
  #keepMapView() {
    const next = this.#config ? planeKeys(this.#config) : new Map<string, string>();
    const previous = this.#planeKeys;
    this.#planeKeys = next;
    for (const [panel, key] of previous ?? []) {
      if (!key.startsWith("map:") || next.get(panel) === key) continue;
      const ready = [...this.#views].filter((view) => this.#ready(view));
      const target = panel === "" ? undefined : { panel };
      for (const view of ready) view.chart!.setViewport({ x: null, y: null }, target);
      const agreed = this.#state("viewport");
      if (!ready.length && agreed) {
        const fitted = { x: null, y: null, yRight: null, time: [] };
        this.#outbox.cancel("viewport");
        this.#report(
          "viewport",
          undefined,
          panel === ""
            ? { ...agreed, axes: { ...agreed.axes, view: fitted } }
            : { ...agreed, planes: { ...agreed.planes, [panel]: fitted } },
        );
      }
      if (panel !== "" && !this.#state("select")?.panels?.includes(panel)) continue;
      this.#outbox.cancel("select");
      this.#report("select", undefined, null);
    }
  }

  #table(name: string): Table {
    const table = this.#tables.get(name);
    if (!table) throw new Error(`The chart has no table named "${name}"`);
    return table;
  }

  /** Changes chart options; null removes one. */
  #updateOptions(changes: Record<string, unknown>) {
    const next = { ...this.#options };
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    if (!this.#config) throw new Error("the chart did not load");
    // Checked as loadSpec checks a whole spec, with the same errors, against
    // the chart's marks (a projection needs maps) over the tables it has.
    const { config } = loadSpec({ ...this.#structure, ...next } as unknown as ChartSpec, [], {
      tables: this.#tables,
      stores: this.#stores,
    });
    const update = Object.fromEntries(
      Object.keys(changes).map((key) => [key, (config as Record<string, unknown>)[key]]),
    ) as Partial<ChartOptions>;
    this.#options = next;
    this.#config = { ...this.#config, ...update };
    for (const view of this.#views) {
      view.chart?.update(update);
      this.#size(view);
      // Drawn at once: views shown next read the panels' axes as drawn,
      // which options such as an axis' `scope` change.
      view.chart?.render();
    }
    // Reconcile even with no mounted display; unchanged effective defaults keep turned views.
    this.#reconcileCameras();
    for (const [panel, configured] of this.#configuredCameras)
      if (this.#state("camera", panel) === null)
        this.#report("camera", undefined, configured, panel);
    // A new projection moves maps' planes.
    this.#keepMapView();
  }

  /** Snapshots supply authoritative state; replacements retain only unchanged-default cameras. */
  #reconcileCameras(restored = false) {
    const next = new Map<string, Camera>();
    const config = this.#config;
    if (config)
      for (const panel of statePanels(config, CAMERAS)) {
        const override = config.panels?.list.find(({ id }) => id === panel)?.camera;
        const camera = resolveCamera({ ...config.camera, ...override });
        next.set(panel, camera);
        const previous = this.#configuredCameras.get(panel);
        if (!restored && previous && !sameCamera(previous, camera)) {
          this.#outbox.cancel(stateKey("camera", panel));
          this.#states.set(stateKey("camera", panel), null);
        }
      }
    for (const panel of this.#configuredCameras.keys())
      if (!next.has(panel)) {
        this.#outbox.cancel(stateKey("camera", panel));
        this.#states.delete(stateKey("camera", panel));
      }
    this.#configuredCameras = next;
  }
}

/** Rows' positions from Python: little-endian uint32, copied where unaligned. */
function view(buffer: SpecBuffer): Uint32Array {
  const bytes = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);
  const aligned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  return new Uint32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4);
}

/** Columns of an update, read like a spec's table: checked, and viewed without copying. */
function decode(columns: Columns, buffers: readonly DataView[]): Table {
  return loadSpec({ data: { rows: { columns } }, marks: [] }, buffers).tables.get("rows")!;
}

/** The states (see `networkTables`) of networks that read a derived table. */
function derivedNetworks(spec: ChartSpec, tables: Map<string, Set<string>>): Set<string> {
  const derived = new Set<string>();
  for (const [panel, read] of tables)
    for (const name of read) {
      const entry = spec.data?.[name];
      if (entry && "source" in entry) derived.add(panel);
    }
  return derived;
}

/**
 * The tables each network of a spec reads (its links' and its nodes'),
 * with the tables they derive from, by state: each subplot's, or "" for
 * the chart's one.
 */
function networkTables(spec: ChartSpec): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  for (const mark of spec.marks) {
    if (mark.type !== "graph") continue;
    const panel = (spec.panels && mark.panel) || "";
    const read = tables.get(panel) ?? new Set<string>();
    tables.set(panel, read);
    for (let name of [mark.data, mark.nodes])
      while (name !== undefined && !read.has(name)) {
        read.add(name);
        const entry = spec.data?.[name];
        name = entry && "source" in entry ? entry.source : undefined;
      }
  }
  return tables;
}

/**
 * Records keyed by field have no prototype, so fields such as "__proto__"
 * stay ordinary keys.
 */
function fieldRecord(): Record<string, unknown> {
  return Object.create(null);
}

/** Appended values per field; categories as labels, since codes index the update's dictionary. */
function appendBatch(table: Table, rows: Table): Parameters<Table["append"]>[0] {
  const batch = fieldRecord();
  for (const field of table.fields()) {
    // Python sends tables of shapes whole (replace), never appended.
    if (table.kind(field) === "geometry") throw new Error(`Field "${field}" holds shapes`);
    if (table.kind(field) !== "category") {
      batch[field] = rows.numbers(field);
      continue;
    }
    const { codes, dictionary } = rows.categories(field);
    batch[field] = Array.from(codes, (code) => (code < 0 ? null : dictionary[code]!));
  }
  return batch as Parameters<Table["append"]>[0];
}

/**
 * A state's values, whichever axes hold times: equal for an echo of the
 * same state.
 */
function valuesOf(event: ViewEvent, state: ViewState): string {
  if (event === "drill" || event === "camera" || event === "visibility")
    return JSON.stringify(state);
  if (event === "viewport") {
    // Displays count their own changes of view: the views are what count.
    const views = state as ViewsPayload | null;
    return JSON.stringify(views && [{ ...views.axes, viewRevision: 0 }, views.planes]);
  }
  if (event === "itemMove") return positionsValue(state as ItemPositionsPayload);
  const selection = state as SelectionPayload | null;
  const { x = null, y = null, lasso = null, panels } = selection ?? {};
  return JSON.stringify([x, y, lasso, panels]);
}

/**
 * Changes of view as one (`a`, then `b`): each instance's and panel's last
 * view, in the order first changed, with what made the last change.
 */
function merged(
  a: ViewportEventPayload | undefined,
  b: ViewportEventPayload | undefined,
): ViewportEventPayload | undefined {
  if (!a || !b) return a ?? b;
  const scales = new Map(a.scales.map((scale) => [`${scale.scale} ${scale.instance}`, scale]));
  for (const scale of b.scales) scales.set(`${scale.scale} ${scale.instance}`, scale);
  const views = new Map(a.views.map((view) => [view.panel, view]));
  for (const view of b.views) views.set(view.panel, view);
  return { ...b, scales: [...scales.values()], views: [...views.values()] };
}

/**
 * Shows what kept a view from drawing, as charts show it: over the chart
 * where one still draws (an update from Python it could not apply), else
 * in its place, at its size.
 */
function showError(view: View, error: unknown) {
  view.error?.remove();
  const { element, chart } = view;
  view.error = chart
    ? showFailure(chart.root, error, true)
    : showFailure(element, error, false, {
        width: element.getBoundingClientRect().width || 640,
        height: element.getBoundingClientRect().height || DEFAULT_HEIGHT,
      });
}

/** Sends each kind of message at most every THROTTLE_MS, always ending with the latest. */
class Throttle {
  readonly #send: (content: object) => void;
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #pending = new Map<string, object>();

  constructor(send: (content: object) => void) {
    this.#send = send;
  }

  post(kind: string, content: object) {
    if (this.#timers.has(kind)) {
      this.#pending.set(kind, content);
      return;
    }
    this.#send(content);
    this.#timers.set(
      kind,
      setTimeout(() => {
        this.#timers.delete(kind);
        const latest = this.#pending.get(kind);
        this.#pending.delete(kind);
        if (latest) this.post(kind, latest);
      }, THROTTLE_MS),
    );
  }

  /** The message of this kind waiting to be sent, if one is. */
  held(kind: string): object | undefined {
    return this.#pending.get(kind);
  }

  /** Drops a message of this kind still waiting to be sent; whether there was one. */
  cancel(kind: string): boolean {
    return this.#pending.delete(kind);
  }

  /** Drops the messages of every kind starting with `prefix` still waiting to be sent. */
  cancelAll(prefix: string) {
    for (const kind of [...this.#pending.keys()])
      if (kind.startsWith(prefix)) this.#pending.delete(kind);
  }

  dispose() {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#pending.clear();
  }
}

/**
 * anywidget calls this once per widget, so the views of a widget share one
 * Widget: `initialize` runs first, then `render` for each output.
 */
export default () => {
  let widget: Widget | undefined;
  return {
    initialize({ model }: { model: Model }) {
      widget = new Widget(model);
      return () => widget?.dispose();
    },
    render({ model, el }: { model: Model; el: HTMLElement }) {
      widget ??= new Widget(model);
      return widget.render(el);
    },
  };
};
