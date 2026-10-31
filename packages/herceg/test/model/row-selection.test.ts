import { describe, expect, it } from "vitest";
import type { ColumnInput } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { selectionStore, selectRows, selectWhere } from "../../src/data/selection.ts";
import { type Table, table as typed } from "../../src/data/table.ts";

import { estimateText } from "../../src/layout/text.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { candlestick } from "../../src/marks/candlestick.ts";
import { contour } from "../../src/marks/contour.ts";
import { custom } from "../../src/marks/custom.ts";
import { dendrogram } from "../../src/marks/dendrogram.ts";
import { gauge } from "../../src/marks/gauge.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { point } from "../../src/marks/point.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { rug } from "../../src/marks/rug.ts";
import { rule } from "../../src/marks/rule.ts";
import { type ChangeCause, type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import {
  type RowSelectionChange,
  rowSelection,
  type SelectionBinding,
} from "../../src/model/row-selection.ts";
import {
  brushedRows,
  clickedRows,
  type Brushed as Selection,
} from "../../src/model/selected-rows.ts";
import { ChartError } from "../../src/spec/errors.ts";
import type { BrushSpec, PanelInteractionSpec } from "../../src/spec/spec.ts";
import { withPicker } from "../helpers/picker.ts";

/** Tables as charts read them, whatever their fields. */
const table = (columns: Record<string, ColumnInput>): Table => typed(columns) as unknown as Table;

const trips = table({ km: [1, 2, 3, 4], fare: [5, 9, 12, 20], kind: ["a", "b", "a", "b"] });

function drawn(config: ChartConfig): ChartModel {
  const model = new ChartModel({ locale: "en-US", timeZone: "UTC", ...config });
  model.setSize(600, 400, 1);
  model.scene(estimateText);
  return model;
}

/** A chart as its row selection sees it, without a DOM. */
function chart() {
  const element = new EventTarget() as never;
  return {
    selection: { x: [1, 2], y: null, lasso: null } as Selection | null,
    /** The causes it was cleared as. */
    cleared: [] as ChangeCause[],
    clear(cause: ChangeCause) {
      this.selection = null;
      this.cleared.push(cause);
    },
    render() {},
    root: element,
  };
}

function mounted(
  binding: Partial<SelectionBinding> = {},
  hear: (change: RowSelectionChange) => void = () => {},
) {
  const store = binding.store ?? selectionStore(trips);
  const selection = rowSelection({ store, channel: "focus", ...binding });
  const model = withPicker(
    drawn({
      marks: [point(trips, { x: "km", y: "fare" })],
      interaction: { brush: "x" },
      rowSelection: selection,
    }),
  );
  const host = chart();
  const changes: RowSelectionChange[] = [];
  // Each change's cause and revision, apart from what it changed.
  const counts: [string, number][] = [];
  const events = {
    emit: (
      _type: "rowSelection",
      { cause, revision, ...change }: RowSelectionChange & { cause: string; revision: number },
    ) => {
      changes.push(change);
      counts.push([cause, revision]);
      hear(change);
    },
  };
  let redrawn = 0;
  // The chart's revision, as the link counts changes it did not.
  let revision = 0;
  const live = { textContent: "" as string | null };
  const link = selection.mount(
    undefined,
    model,
    host,
    events,
    () => redrawn++,
    () => ++revision,
    () => null,
    live,
  );
  return {
    store,
    selection,
    model,
    host,
    link,
    changes,
    counts,
    redrawn: () => redrawn,
    revision: () => revision,
  };
}

const brush = (x: readonly [number, number]): Selection => ({ x, y: null, lasso: null });

/** What `make` refuses: a chart error's code, path, and message. */
function refusal(make: () => unknown) {
  try {
    make();
  } catch (error) {
    expect(error).toBeInstanceOf(ChartError);
    const { code, path, message } = error as ChartError;
    return { code, path, message };
  }
  throw new Error("expected a refusal");
}
const noKeys = { shiftKey: false, ctrlKey: false, metaKey: false };

describe("row selection bindings", () => {
  it("refuse bindings that are not ones", () => {
    const store = selectionStore(trips);
    expect(() => rowSelection()).toThrow("rowSelection: expected a binding");
    expect(() => rowSelection({ store, channel: "" })).toThrow(
      'rowSelection channel: expected a name; received ""',
    );
    expect(() => rowSelection({ store, channel: "c", events: ["drag" as "brush"] })).toThrow(
      'rowSelection events: expected "brush", "lasso", or "click"; received "drag"',
    );
    expect(() => rowSelection({ store, channel: "c", effect: "filter" as "none" })).toThrow(
      'rowSelection effect: expected "highlight" or "none"; received "filter"',
    );
    expect(() =>
      rowSelection({ store, channel: "c" }, { store: selectionStore(trips), channel: "d" }),
    ).toThrow("binds each table once");
    expect(() => rowSelection({ store: {} as never, channel: "c" })).toThrow("SelectionStore");
  });

  it("refuse charts whose rows cannot be selected yet", () => {
    const bound = rowSelection({ store: selectionStore(trips), channel: "c" });
    expect(() => drawn({ marks: [gauge(trips, { value: "km" })], rowSelection: bound })).toThrow(
      "gauge rowSelection: cannot select rows yet",
    );
    const other = table({ x: [1] });
    expect(() => drawn({ marks: [point(other, { x: "x", y: "x" })], rowSelection: bound })).toThrow(
      'rowSelection store: no mark reads its table (channel "c")',
    );
    const counted = { marks: [histogram(trips, { x: "km" })], rowSelection: bound };
    expect(() => drawn({ ...counted, interaction: { brush: "lasso" } })).toThrow(
      'histogram brush: lassos cannot select its rows yet; leave "lasso" out of rowSelection events',
    );
    expect(() => drawn({ ...counted, interaction: { brush: "xy" } })).toThrow(
      "histogram brush: its y axis holds statistics; brush along x only",
    );
    expect(() => drawn({ ...counted, interaction: { brush: "x" } })).not.toThrow();
    const boxes = { marks: [boxplot(trips, { x: "kind", y: "fare" })], rowSelection: bound };
    expect(() => drawn({ ...boxes, interaction: { brush: "y" } })).toThrow(
      "y axis holds statistics",
    );
    // Rug ticks have a place along their own axis only, beside a scatter plot too.
    const ticks = {
      marks: [point(trips, { x: "km", y: "fare" }), rug(trips, { x: "km" })],
      rowSelection: bound,
    };
    for (const brush of ["y", "xy"] as const)
      expect(() => drawn({ ...ticks, interaction: { brush } })).toThrow(
        "rug brush: its ticks have no y value; brush along x only",
      );
    expect(() => drawn({ ...ticks, interaction: { brush: "x" } })).not.toThrow();
    expect(() => drawn({ ...ticks, interaction: { brush: "lasso" } })).not.toThrow();
    const sideways = { marks: [rug(trips, { y: "fare" })], rowSelection: bound };
    expect(() => drawn({ ...sideways, interaction: { brush: "x" } })).toThrow(
      "rug brush: its ticks have no x value; brush along y only",
    );
    // Cells are lassoed at their centers.
    const cells = { marks: [heatmap(trips, { x: "kind", y: "kind", color: "fare" })] };
    expect(() =>
      drawn({ ...cells, rowSelection: bound, interaction: { brush: "lasso" } }),
    ).not.toThrow();
    // Without the gesture in its events, a binding refuses nothing about it.
    const quiet = rowSelection({ store: selectionStore(trips), channel: "c", events: ["click"] });
    expect(() =>
      drawn({ ...counted, rowSelection: quiet, interaction: { brush: "xy" } }),
    ).not.toThrow();
  });

  it("refuse as chart errors at the option they refuse", () => {
    const store = selectionStore(trips);
    const bound = rowSelection({ store, channel: "c" });
    expect(refusal(() => rowSelection({ store, channel: "c" }, { store, channel: "" }))).toEqual({
      code: "invalid-option",
      path: "rowSelection[1].channel",
      message: 'rowSelection channel: expected a name; received ""',
    });
    expect(
      refusal(() => drawn({ marks: [gauge(trips, { value: "km" })], rowSelection: bound })),
    ).toEqual({
      code: "unsupported",
      path: "rowSelection",
      message:
        "gauge rowSelection: cannot select rows yet; select them in a chart of the same table along x and y, linked by the store",
    });
    // A 3D chart's layers draw as one: named by their type.
    const cloud = point3d(trips, { x: "km", y: "fare", z: "km" });
    expect(refusal(() => drawn({ marks: [cloud], rowSelection: bound })).message).toMatch(
      /^point3d rowSelection: cannot select rows yet;/,
    );
    const counted = { marks: [histogram(trips, { x: "km" })], rowSelection: bound };
    expect(refusal(() => drawn({ ...counted, interaction: { brush: "y" } }))).toEqual({
      code: "unsupported",
      path: "interaction.brush",
      message: "histogram brush: its y axis holds statistics; brush along x only",
    });
    const other = table({ x: [1] });
    expect(
      refusal(() => drawn({ marks: [point(other, { x: "x", y: "x" })], rowSelection: bound })),
    ).toMatchObject({ code: "invalid-option", path: "rowSelection" });
  });

  it("judge the brush of each panel a mark draws in, refused where it is set", () => {
    const store = selectionStore(trips);
    const bound = rowSelection({ store, channel: "c" });
    const scatter = point(trips, { x: "km", y: "fare", panel: "a" });
    const inPanels = (
      counts: ChartConfig["marks"][number],
      own: PanelInteractionSpec,
      chartBrush?: BrushSpec,
    ) =>
      drawn({
        marks: [scatter, counts],
        panels: panels([{ id: "a" }, { id: "b", interaction: own }]),
        ...(chartBrush && { interaction: { brush: chartBrush } }),
        rowSelection: bound,
      });
    const counts = histogram(trips, { x: "km", panel: "b" });
    // A subplot's own brush takes the place of the chart's over what it draws...
    expect(() => inPanels(counts, { brush: "x" }, "y")).not.toThrow();
    // ...and is refused at the subplot that sets it.
    expect(refusal(() => inPanels(counts, { brush: "y" }))).toEqual({
      code: "unsupported",
      path: "panels[1].interaction.brush",
      message: "histogram brush: its y axis holds statistics; brush along x only",
    });
    expect(refusal(() => inPanels(counts, { zoom: true }, "y")).path).toBe("interaction.brush");
    // A mark in every panel, under each panel's brush.
    const everywhere = histogram(trips, { x: "km", panel: "*" });
    expect(refusal(() => inPanels(everywhere, { brush: "x" }, "y")).path).toBe("interaction.brush");
    // Whether a panel's brush writes rows, and so never zooms, is its own too.
    const model = inPanels(counts, { brush: "x" });
    const link = bound.mount(
      undefined,
      model,
      chart(),
      { emit() {} },
      () => {},
      () => 0,
      () => null,
      {
        textContent: "",
      },
    );
    expect([link.brushes("a"), link.brushes("b")]).toEqual([false, true]);
    link.dispose();
  });

  it("refuse tables only marks whose rows gestures do not select read, and what they cannot do", () => {
    const store = selectionStore(trips);
    const bind = (binding: Partial<SelectionBinding> = {}) =>
      rowSelection({ store, channel: "c", ...binding });
    // Annotations of a table, beside points of it, leave the points' rows selected.
    const rules = rule(trips, { x: "km" });
    expect(refusal(() => drawn({ marks: [rules], rowSelection: bind() }))).toEqual({
      code: "unsupported",
      path: "rowSelection",
      message:
        "rule rowSelection: annotations do not select their rows yet; bind the table of a mark that draws its rows as data, such as points",
    });
    expect(() =>
      drawn({ marks: [point(trips, { x: "km", y: "fare" }), rules], rowSelection: bind() }),
    ).not.toThrow();
    const merges = table({ first: [0, 3], second: [1, 2], height: [1, 2] });
    const tree = dendrogram(merges, {
      first: "first",
      second: "second",
      height: "height",
      leaves: ["a", "b", "c"],
    });
    expect(
      refusal(() =>
        drawn({
          marks: [tree],
          rowSelection: rowSelection({ store: selectionStore(merges), channel: "c" }),
        }),
      ).message,
    ).toBe(
      "dendrogram rowSelection: its rows are merges of clusters, which gestures do not select; bind the table of the heatmap it orders",
    );
    // A contour's bands summarize its grid: brushes select the grid's rows, clicks none.
    const grid = table({ x: [0, 1, 0, 1], y: [0, 0, 1, 1], z: [0, 1, 2, 3] });
    const bands = contour(grid, { x: "x", y: "y", color: "z", thresholds: [1.5] });
    const ofGrid = (binding: Partial<SelectionBinding>) =>
      rowSelection({ store: selectionStore(grid), channel: "c", ...binding });
    expect(
      refusal(() => drawn({ marks: [bands], rowSelection: ofGrid({ effect: "none" }) })),
    ).toEqual({
      code: "unsupported",
      path: "rowSelection.events",
      message:
        'contour rowSelection events: its bands summarize the grid, whose rows a click does not select; give events: ["brush"], and brush a range of x or y',
    });
    expect(
      refusal(() => drawn({ marks: [bands], rowSelection: ofGrid({ events: ["brush"] }) })),
    ).toEqual({
      code: "unsupported",
      path: "rowSelection.effect",
      message:
        'contour rowSelection effect: its bands draw no highlight of the rows selected; give effect: "none"',
    });
    const brushed = drawn({
      marks: [bands],
      interaction: { brush: "x" },
      rowSelection: ofGrid({ events: ["brush"], effect: "none" }),
    });
    expect(brushedRows(brushed, grid, brush([0.5, 1.5]), null)).toEqual(
      selectWhere(col("x").ge(0.5).and(col("x").le(1.5))),
    );
  });

  it("compare as JSON by their stores' identities", () => {
    const store = selectionStore(trips);
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    expect(same(rowSelection({ store, channel: "c" }), rowSelection({ store, channel: "c" }))).toBe(
      true,
    );
    expect(
      same(
        rowSelection({ store, channel: "c" }),
        rowSelection({ store: selectionStore(trips), channel: "c" }),
      ),
    ).toBe(false);
    expect(
      same(
        rowSelection({ store, channel: "c" }),
        rowSelection({ store, channel: "c", effect: "none" }),
      ),
    ).toBe(false);
  });
});

/** Circles a custom mark draws at trips' km and fares, selecting rows of a channel. */
function customs() {
  const circles = custom(trips, {
    x: "km",
    y: "fare",
    draw({ series, x, y, circle }) {
      for (const s of series)
        for (let i = 0; i < s.length; i++) circle(x(s.x[i]!), y(s.y[i]!), 3, { fill: s.color });
    },
  });
  return drawn({
    marks: [circles],
    interaction: { brush: "x" },
    rowSelection: rowSelection({ store: selectionStore(trips), channel: "c", effect: "none" }),
  });
}

describe("the rows gestures select", () => {
  it("of custom marks of x and y fields, as of points", () => {
    const model = customs();
    expect(brushedRows(model, trips, brush([1.5, 3.5]), null)).toEqual(
      selectWhere(col("km").ge(1.5).and(col("km").le(3.5))),
    );
  });

  // Clicks pick what custom marks draw once their items are recorded (contract 3C).
  it.skip("of custom marks clicked, as of points", () => {
    const model = customs();
    const [px, py] = [model.xScale()!.map(3), model.yScale()!.map(12)];
    expect(
      Array.from(clickedRows(withPicker(model), new Set([trips]), px, py)?.rows ?? []),
    ).toEqual([2]);
  });

  it("of a candlestick clicked anywhere on its candle", () => {
    const prices = table({
      day: [1, 2, 3],
      open: [10, 20, 15],
      high: [30, 40, 35],
      low: [5, 15, 10],
      close: [20, 15, 30],
    });
    const candles = candlestick(prices, {
      x: "day",
      open: "open",
      high: "high",
      low: "low",
      close: "close",
    });
    const model = drawn({ marks: [candles] });
    const tables = new Set([prices]);
    const x = model.xScale()!.map(2);
    const y = model.yScale()!;
    // Its wick above the body, and the body's edge away from its middle.
    for (const [px, py] of [
      [x, y.map(38)],
      [x + 4, y.map(17)],
    ] as const)
      expect(Array.from(clickedRows(withPicker(model), tables, px, py)?.rows ?? [])).toEqual([1]);
    expect(clickedRows(withPicker(model), tables, x, y.map(45))).toBeUndefined();
  });
});

describe("a mounted chart's row selection", () => {
  it("writes a brush's rows, reports them, and clears them while the channel still holds them", () => {
    const { store, link, changes } = mounted();
    const written = link.brushed(brush([1.5, 3.5]), null, true, "pointer", 0);
    const condition = selectWhere(col("km").ge(1.5).and(col("km").le(3.5)));
    expect(store.get("focus")).toEqual(condition);
    expect(written?.rows).toEqual([{ table: trips, channel: "focus", selection: condition }]);
    expect(changes).toEqual(written?.rows);
    expect(link.brushed(null, null, true, "pointer", 0)?.rows).toEqual([
      { table: trips, channel: "focus", selection: null },
    ]);
    expect(store.get("focus")).toBeNull();
    // Clearing a brush whose rows another writer replaced leaves theirs.
    link.brushed(brush([1.5, 3.5]), null, true, "pointer", 0);
    const grid = selectRows(new RowSet(trips).add(0));
    store.set("focus", grid);
    expect(link.brushed(null, null, true, "pointer", 0)).toBeUndefined();
    expect(store.get("focus")).toBe(grid);
  });

  it("lets go of its brush when another writer replaces its rows", async () => {
    const { store, link, host, redrawn } = mounted();
    link.brushed(brush([1.5, 3.5]), null, true, "pointer", 0);
    const before = redrawn();
    store.set("focus", selectRows(new RowSet(trips).add(0)));
    // Once the change is reported: views showing the writer's brush let theirs go first.
    expect(host.cleared).toEqual([]);
    await Promise.resolve();
    expect(host.cleared).toEqual(["sync"]);
    expect(redrawn()).toBe(before + 1);
    // Another channel's change changes nothing here.
    store.set("other", selectRows(new RowSet(trips)));
    expect(host.cleared).toEqual(["sync"]);
  });

  it("lets go of its brush as the click that replaces its rows", () => {
    const { store, link, model, host } = mounted();
    const [panel] = model.panels();
    link.brushed(brush([1.5, 3.5]), null, true, "pointer", 0);
    link.clicked(
      panel!.x.map(trips.value("km", 0) as number),
      panel!.y.map(trips.value("fare", 0) as number),
      noKeys,
    )?.();
    expect(host.cleared).toEqual(["pointer"]);
    // As a key does.
    host.selection = brush([1.5, 3.5]);
    link.brushed(host.selection, null, true, "pointer", 0);
    (host.root as EventTarget).dispatchEvent(
      Object.assign(new Event("keydown"), { key: "Escape", ...noKeys }),
    );
    expect(store.get("focus")).toBeNull();
    expect(host.cleared).toEqual(["pointer", "keyboard"]);
  });

  it("lets go of its brush when it shows a selection it does not write", async () => {
    const { store, link, host } = mounted();
    link.brushed(brush([1.5, 3.5]), null, true, "pointer", 0);
    // Another view writes its brush's rows, and this one shows that brush as the change is reported.
    store.set("focus", selectRows(new RowSet(trips).add(0)));
    expect(link.brushed(brush([0, 1]), null, false, "pointer", 0)).toBeUndefined();
    await Promise.resolve();
    expect(host.cleared).toEqual([]);
    expect(link.brushed(null, null, true, "pointer", 0)).toBeUndefined();
    expect(store.get("focus")).not.toBeNull();
  });

  it("selects clicked rows: only them, added with Shift, toggled with Ctrl or Cmd", () => {
    const { store, link, model } = mounted();
    const [panel] = model.panels();
    const at = (row: number) =>
      [
        panel!.x.map(trips.value("km", row) as number),
        panel!.y.map(trips.value("fare", row) as number),
      ] as const;
    const rows = () => {
      const held = store.get("focus");
      return held?.kind === "rows" ? Array.from(held.rows.positions()) : held;
    };
    link.clicked(...at(1), noKeys)?.();
    expect(rows()).toEqual([1]);
    link.clicked(...at(3), { ...noKeys, shiftKey: true })?.();
    expect(rows()).toEqual([1, 3]);
    link.clicked(...at(1), { ...noKeys, metaKey: true })?.();
    expect(rows()).toEqual([3]);
    // A brush's condition becomes its rows as they are when a click adds to it.
    link.brushed(brush([0, 2.5]), null, true, "pointer", 0);
    link.clicked(...at(3), { ...noKeys, ctrlKey: true })?.();
    expect(rows()).toEqual([0, 1, 3]);
    // Off the data: a modified click changes nothing, a plain one clears.
    expect(link.clicked(5, 5, { ...noKeys, shiftKey: true })?.()?.rows).toEqual([]);
    expect(rows()).toEqual([0, 1, 3]);
    expect(link.clicked(5, 5, noKeys)?.()?.rows).toEqual([
      { table: trips, channel: "focus", selection: null },
    ]);
    expect(rows()).toBeNull();
  });

  it("reports each change with its cause and revision, counting those the chart did not", () => {
    const { store, link, model, counts } = mounted();
    const [panel] = model.panels();
    // The chart's brush, counted by the chart with its selection.
    link.brushed(brush([1.5, 3.5]), null, true, "pointer", 7);
    expect(counts).toEqual([["pointer", 7]]);
    // A click, counted once as its change is heard.
    link.clicked(
      panel!.x.map(trips.value("km", 1) as number),
      panel!.y.map(trips.value("fare", 1) as number),
      noKeys,
    )?.();
    expect(counts.at(-1)).toEqual(["pointer", 1]);
    // Another writer's change.
    store.set("focus", null);
    expect(counts.at(-1)).toEqual(["sync", 2]);
    // An unchanged channel reports and counts nothing.
    store.set("focus", null);
    expect(counts).toHaveLength(3);
  });

  it("gives listeners' writes, and writes heard first, their own causes and counts", () => {
    // A listener of the chart's brush writes the channel again, and so does the chart.
    let again: (() => void) | undefined;
    const { store, link, counts } = mounted({}, () => {
      const then = again;
      again = undefined;
      then?.();
    });
    again = () => store.set("focus", selectRows(new RowSet(trips).add(0)));
    link.brushed(brush([1.5, 3.5]), null, true, "pointer", 7);
    expect(counts).toEqual([
      ["pointer", 7],
      ["sync", 1],
    ]);
    again = () => link.brushed(brush([0, 1]), null, true, "api", 8);
    store.set("focus", null);
    expect(counts.slice(2)).toEqual([
      ["sync", 2],
      ["api", 8],
    ]);
    // A store's earlier listener replaces a change as it hears it: both
    // count, and what the channel holds after them is reported once.
    const early = selectionStore(trips);
    const replaced = selectRows(new RowSet(trips).add(2));
    early.subscribe(({ selection }) => {
      if (selection !== replaced && selection !== null) early.set("focus", replaced);
    });
    const late = mounted({ store: early });
    early.set("focus", selectRows(new RowSet(trips).add(1)));
    expect(late.counts).toEqual([["sync", 1]]);
    expect(late.changes.map((c) => c.selection)).toEqual([replaced]);
    expect(late.revision()).toBe(2);
    // An earlier listener adds a row to what a click wrote and writes it back.
    const reused = selectionStore(trips);
    reused.subscribe(({ selection }) => {
      if (selection?.kind === "rows" && !selection.rows.has(2)) {
        selection.rows.add(2);
        reused.set("focus", selection);
      }
    });
    const clicked = mounted({ store: reused });
    const [panel] = clicked.model.panels();
    clicked.link.clicked(
      panel!.x.map(trips.value("km", 1) as number),
      panel!.y.map(trips.value("fare", 1) as number),
      noKeys,
    )?.();
    expect(clicked.revision()).toBe(2);
    expect(clicked.counts).toEqual([["sync", 1]]);
  });

  it("writes only the gestures in its events", () => {
    const { store, link } = mounted({ events: ["click"] });
    expect(link.brushes(undefined)).toBe(false);
    expect(link.brushed(brush([1, 2]), null, true, "pointer", 0)).toBeUndefined();
    expect(store.get("focus")).toBeNull();
    const reading = mounted({ events: [] });
    expect(reading.link.clicked(5, 5, noKeys)).toBeUndefined();
    expect(mounted().link.brushes(undefined)).toBe(true);
  });

  it("highlights only with effect highlight, and lets go of the model when disposed", () => {
    const { link, model } = mounted();
    expect(model.highlight).toBeDefined();
    link.dispose();
    expect(model.highlight).toBeUndefined();
    expect(mounted({ effect: "none" }).model.highlight).toBeUndefined();
  });

  it("is kept for the same row selection, and replaced for another", () => {
    const { selection, link, model, host } = mounted();
    const events = { emit: () => {} };
    const live = { textContent: null };
    expect(
      selection.mount(
        link,
        model,
        host,
        events,
        () => {},
        () => 0,
        () => null,
        live,
      ),
    ).toBe(link);
    const other = rowSelection({ store: selectionStore(trips), channel: "focus" });
    const replaced = other.mount(
      link,
      model,
      host,
      events,
      () => {},
      () => 0,
      () => null,
      live,
    );
    expect(replaced).not.toBe(link);
    expect(replaced.selection).toBe(other);
  });

  it("keeps what its brush wrote through a binding of the same channel that replaces it", () => {
    const { store, selection, link, model, host } = mounted();
    link.brushed(brush([1.5, 3.5]), null, true, "pointer", 0);
    // The same store and channel, without highlighting: an adapter's new prop.
    const quiet = rowSelection({ store, channel: "focus", effect: "none" });
    expect(quiet.toJSON()).not.toEqual(selection.toJSON());
    const replaced = quiet.mount(
      link,
      model,
      host,
      { emit: () => {} },
      () => {},
      () => 0,
      () => null,
      { textContent: null },
    );
    expect(replaced.brushed(null, null, true, "pointer", 0)?.rows).toEqual([
      { table: trips, channel: "focus", selection: null },
    ]);
    expect(store.get("focus")).toBeNull();
  });

  it("lets go of a brush another writer replaced while its binding was being replaced", async () => {
    const { store, link, model, host } = mounted();
    link.brushed(brush([1.5, 3.5]), null, true, "pointer", 0);
    store.set("focus", selectRows(new RowSet(trips).add(0)));
    // Before the check of that change, a binding of the same channel replaces this one.
    rowSelection({ store, channel: "focus", effect: "none" }).mount(
      link,
      model,
      host,
      { emit: () => {} },
      () => {},
      () => 0,
      () => null,
      { textContent: null },
    );
    await Promise.resolve();
    expect(host.cleared).toEqual(["sync"]);
  });

  it("clears only channels still holding its brush's rows, as a listener of an earlier clear brushes again", () => {
    const rides = table({ km: [1, 2, 3, 4], fare: [6, 8, 10, 12] });
    const [first, second] = [selectionStore(trips), selectionStore(rides)];
    const selection = rowSelection(
      { store: first, channel: "focus" },
      { store: second, channel: "focus" },
    );
    const model = drawn({
      marks: [point(trips, { x: "km", y: "fare" }), point(rides, { x: "km", y: "fare" })],
      interaction: { brush: "x" },
      rowSelection: selection,
    });
    const link = selection.mount(
      undefined,
      model,
      chart(),
      { emit() {} },
      () => {},
      () => 0,
      () => null,
      { textContent: null },
    );
    link.brushed(brush([1.5, 3.5]), null, true, "pointer", 1);
    // As the first channel is cleared, its listener brushes again, writing both.
    let again = false;
    first.subscribe(() => {
      if (again || first.get("focus") !== null) return;
      again = true;
      link.brushed(brush([0.5, 2.5]), null, true, "pointer", 2);
    });
    const cleared = link.brushed(null, null, true, "pointer", 3);
    expect(first.get("focus")).not.toBeNull();
    expect(second.get("focus")).not.toBeNull();
    // Only the clear made is reported.
    expect(cleared?.rows.map((change) => change.table)).toEqual([trips]);
  });

  it("clears no rows a listener changed in place and wrote back since its lasso wrote them", () => {
    const { store, link } = mounted({ events: ["lasso"] });
    const outline: [number, number][] = [
      [0.5, 4],
      [1.5, 4],
      [1.5, 6],
      [0.5, 6],
    ];
    link.brushed({ x: null, y: null, lasso: outline }, null, true, "pointer", 1);
    const held = store.get("focus");
    expect(held?.kind === "rows" && Array.from(held.rows.positions())).toEqual([0]);
    const clear = link.release();
    // A listener adds a row to the lasso's set and writes the same selection back.
    if (held?.kind === "rows") held.rows.add(2);
    store.set("focus", held);
    clear("pointer", 2);
    const after = store.get("focus");
    expect(after?.kind === "rows" && Array.from(after.rows.positions())).toEqual([0, 2]);
  });

  it("lets go of its brush when a listener replaces its rows as they are written", () => {
    const { store, link, host } = mounted();
    const grid = selectRows(new RowSet(trips).add(0));
    const stop = store.subscribe(() => {
      if (store.get("focus")?.kind === "predicate") store.set("focus", grid);
    });
    link.brushed(brush([1.5, 3.5]), null, true, "pointer", 0);
    stop();
    expect(store.get("focus")).toBe(grid);
    expect(host.cleared).toEqual(["pointer"]);
  });

  it("reports a row set changed in place and written again", () => {
    const { store, changes } = mounted();
    const set = new RowSet(trips).add(0);
    const rows = selectRows(set);
    store.set("focus", rows);
    set.add(1);
    store.set("focus", rows);
    expect(changes).toHaveLength(2);
  });

  it("reports changes of its channels by any writer, once each", () => {
    const { store, changes } = mounted();
    const rows = selectRows(new RowSet(trips).add(2));
    store.set("focus", rows);
    store.set("other", rows);
    store.set("focus", rows);
    expect(changes).toEqual([{ table: trips, channel: "focus", selection: rows }]);
  });
});
