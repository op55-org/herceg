// Announcements of selections: a click that selects says what Enter says,
// once per gesture, by the item's own point as its mark writes it (its
// heading and content where it has them, else its name at its place), or a
// series by its name, with a count where the selection holds more than the
// name says. Brushes and lassos keep their wording and add a row count their
// row selection already knows. Previews, cancelled drags, and selections
// the application or another chart made are quiet.
import "./interactive.ts";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { RowSet } from "../../src/data/row-set.ts";
import { selectionStore, selectRows, selectWhere } from "../../src/data/selection.ts";
import { type Table, table } from "../../src/data/table.ts";
import type { Chart, ChartOptions } from "../../src/dom/chart.ts";
import { custom } from "../../src/marks/custom.ts";
import { graph } from "../../src/marks/graph.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import type { MarkTooltip } from "../../src/marks/tooltip-fields.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { contractTest } from "../helpers/contracts.ts";
import { modelOf, pageOrigin, realMouse } from "./helpers.ts";
import { frame, key, mount, pointer } from "./interaction/helpers.ts";

/** What is still loading (picking, the brush) once a gesture asked for it, then a frame. */
async function settled(chart: Chart) {
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  await frame();
}

/**
 * The texts each chart's live region is given while `gesture` runs and
 * until it settles, in order: one per announcement made.
 */
async function spokenIn(charts: readonly Chart[], gesture: () => unknown): Promise<string[][]> {
  const said = charts.map(() => [] as string[]);
  const observers = charts.map((chart, i) => {
    const take = (records: MutationRecord[]) => {
      for (const record of records)
        for (const node of record.addedNodes) said[i]!.push(node.textContent ?? "");
    };
    const observer = new MutationObserver(take);
    observer.observe(chart.root.querySelector("[aria-live]")!, { childList: true });
    return [observer, take] as const;
  });
  await gesture();
  for (const chart of charts) await settled(chart);
  for (const [observer, take] of observers) {
    take(observer.takeRecords());
    observer.disconnect();
  }
  return said;
}

async function spoken(chart: Chart, gesture: () => unknown): Promise<string[]> {
  return (await spokenIn([chart], gesture))[0]!;
}

/** A click at pixel (x, y) of the chart, with Shift where asked. */
function click(chart: Chart, [x, y]: readonly [number, number], shiftKey = false) {
  pointer(chart, "pointerdown", x, y, { shiftKey });
  pointer(chart, "pointerup", x, y, { shiftKey });
}

/** A brush along x, from 15 to 45, at y 25. */
function brushIn(chart: Chart) {
  const [b0, b1] = [at(chart, 15, 25), at(chart, 45, 25)];
  pointer(chart, "pointerdown", ...b0);
  pointer(chart, "pointermove", ...b1);
  pointer(chart, "pointerup", ...b1);
}

/** The pixel of value (x, y) on the chart's axes. */
const at = (chart: Chart, x: number, y: number): [number, number] => [
  chart.toPixel(x, { axis: "x" })!,
  chart.toPixel(y, { axis: "y" })!,
];

/** Five points on the diagonal, in a chart of fixed domains. */
const diagonal = () => table({ x: [10, 20, 30, 40, 50], y: [10, 20, 30, 40, 50] });
const DOMAINS = { x: { domain: [0, 60] }, y: { domain: [0, 60] } } as const;

/** A2's comets: forecasts from start to end, on lanes, by category. */
const forecasts = () =>
  table({
    id: ["C-12", "C-13", "C-14"],
    start: [10, 30, 50],
    end: [25, 45, 70],
    lane: [1, 2, 3],
    category: ["rates", "fx", "rates"],
  });
type Forecasts = ReturnType<typeof forecasts>;
type CometTooltip = MarkTooltip<Forecasts extends Table<infer S> ? S : never>;

/** A2's line: the comet's id, its category, and its ends. */
const A2: CometTooltip = {
  content: [{ field: "id" }, " ", { series: true }, ": ", { value: true }],
};

function comets(data: Forecasts, tooltip: CometTooltip, options: { inspect?: false } = {}) {
  return custom(data, {
    id: "comets",
    x: ["start", "end"],
    y: "lane",
    series: "category",
    itemKey: "id",
    tooltip,
    ...options,
    draw({ table: t, series, x, y, item, rect, circle }) {
      const end = t.numbers("end");
      for (const s of series)
        for (let k = 0; k < s.length; k++) {
          const row = s.rowAt(k);
          const [x0, cy] = [x(s.x[row]!), y(s.y[row]!)];
          item(s, row, () => {
            rect(x0, cy - 3, x(end[row]!) - x0, 6, { fill: s.color });
            circle(x0, cy, 4, { fill: s.color });
          });
        }
    },
  });
}

const cometChart = (data: Forecasts, tooltip = A2, extra: Partial<ChartOptions> = {}) =>
  mount({
    x: { domain: [0, 80] },
    y: { domain: [0, 4] },
    tooltip: { heading: false },
    interaction: { select: "items" },
    marks: [comets(data, tooltip)],
    ...extra,
  });

describe("announcements of selections", () => {
  contractTest(
    "selection.announced.click.engine",
    async () => {
      const chart = await cometChart(forecasts());
      const c12 = at(chart, 17, 1);
      const c13 = at(chart, 37, 2);
      const c14 = at(chart, 60, 3);
      const empty = at(chart, 76, 0.4);
      expect(await spoken(chart, () => click(chart, c12))).toEqual([
        "C-12 rates: 10 – 25 selected.",
      ]);
      expect(await spoken(chart, () => click(chart, c13, true))).toEqual([
        "C-13 fx: 30 – 45 selected. 2 items selected.",
      ]);
      // A deselection says what remains, one item included.
      expect(await spoken(chart, () => click(chart, c12, true))).toEqual([
        "C-12 rates: 10 – 25 deselected. 1 item selected.",
      ]);
      // A plain click selects its comet alone, and again lets it go.
      expect(await spoken(chart, () => click(chart, c14))).toEqual([
        "C-14 rates: 50 – 70 selected.",
      ]);
      expect(await spoken(chart, () => click(chart, c14))).toEqual(["Selection cleared."]);
      // A click on the plot clears a selection, and says nothing where none is.
      expect(await spoken(chart, () => click(chart, empty))).toEqual([]);
      await spoken(chart, () => click(chart, c12));
      expect(await spoken(chart, () => click(chart, empty))).toEqual(["Selection cleared."]);
      expect(chart.selection).toBeNull();
    },
    "says each click's selection once, by the comet's content line, with a count where several are",
  );

  contractTest(
    "selection.announced.keyboard.engine",
    async () => {
      const chart = await cometChart(forecasts());
      chart.root.focus();
      await spoken(chart, () => key(chart, "ArrowRight"));
      // Enter says what a click on the same comet says.
      expect(await spoken(chart, () => key(chart, "Enter"))).toEqual([
        "C-12 rates: 10 – 25 selected.",
      ]);
      expect(await spoken(chart, () => key(chart, "Enter"))).toEqual(["Selection cleared."]);
      // Its heading leads where its mark has one, as the keyboard's arrival says it.
      const headed = await cometChart(forecasts(), {
        heading: [{ field: "id" }],
        content: [{ series: true }, ": ", { value: true }],
      });
      expect(await spoken(headed, () => click(headed, at(headed, 37, 2)))).toEqual([
        "C-13. fx: 30 – 45 selected.",
      ]);
      headed.root.focus();
      await spoken(headed, () => key(headed, "ArrowRight"));
      expect(await spoken(headed, () => key(headed, "Enter"))).toEqual([
        "C-12. rates: 10 – 25 selected.",
      ]);
    },
    "says Enter's selection as a click's, the heading first where the mark has one",
  );

  it("names a point without content by its series and place, and a series by its name", async () => {
    const data = table({ t: [0, 1, 2, 3], a: [5, 6, 7, 8], b: [1, 2, 3, 4] });
    const points = await mount({
      marks: [point(data, { x: "t", y: "a" })],
      interaction: { select: "items" },
    });
    expect(await spoken(points, () => click(points, at(points, 2, 7)))).toEqual([
      "a at 2 selected.",
    ]);
    const lines = await mount({
      marks: [line(data, { x: "t", y: ["a", "b"] })],
      interaction: { select: "series" },
    });
    expect(await spoken(lines, () => click(lines, at(lines, 1.5, 6.5)))).toEqual(["a selected."]);
    expect(await spoken(lines, () => click(lines, at(lines, 1.5, 2.5), true))).toEqual([
      "b selected. 2 series selected.",
    ]);
    expect(await spoken(lines, () => click(lines, at(lines, 1.5, 6.5), true))).toEqual([
      "a deselected. 1 series selected.",
    ]);
  });

  contractTest(
    "selection.announced.uninspected.engine",
    async () => {
      // A mark left out of inspection is still picked and selected, and named.
      const chart = await mount({
        x: { domain: [0, 80] },
        y: { domain: [0, 4] },
        interaction: { select: "items" },
        marks: [comets(forecasts(), A2, { inspect: false })],
      });
      const c13 = at(chart, 37, 2);
      expect(chart.inspect(...c13)).toBeUndefined();
      expect(await spoken(chart, () => click(chart, c13))).toEqual(["C-13 fx: 30 – 45 selected."]);
    },
    "names an item of a mark with inspect: false that a click selects",
  );

  contractTest(
    "selection.announced.listeners.engine",
    async () => {
      // A listener dropping the selected row: the name is taken before it runs.
      const data = forecasts();
      const chart = await cometChart(data);
      const off = chart.on("select", () => data.dropFirst(1));
      expect(await spoken(chart, () => click(chart, at(chart, 17, 1)))).toEqual([
        "C-12 rates: 10 – 25 selected.",
      ]);
      off();
      // Enter alike, the cursor on the row a listener drops.
      const keyed = forecasts();
      const other = await cometChart(keyed);
      other.root.focus();
      await spoken(other, () => key(other, "ArrowRight"));
      other.on("select", () => keyed.dropFirst(1));
      expect(await spoken(other, () => key(other, "Enter"))).toEqual([
        "C-12 rates: 10 – 25 selected.",
      ]);
      // A listener changing the selection: what it holds then is said, not what was asked.
      const replaced = await cometChart(forecasts());
      await spoken(replaced, () => click(replaced, at(replaced, 37, 2)));
      const held = replaced.selection;
      const [first] = held?.kind === "items" ? held.items : [];
      replaced.on("select", ({ selection }) => {
        if (selection?.kind === "items" && selection.items.length === 2)
          replaced.select({ kind: "items", items: selection.items.filter((k) => k !== first) });
      });
      // Shift adds C-12 to C-13; the listener keeps C-12 alone, and no count follows.
      expect(await spoken(replaced, () => click(replaced, at(replaced, 17, 1), true))).toEqual([
        "C-12 rates: 10 – 25 selected.",
      ]);
      // One undoing the change leaves nothing to say.
      const vetoed = await cometChart(forecasts());
      vetoed.on("select", ({ selection }) => {
        if (selection) vetoed.select(null);
      });
      expect(await spoken(vetoed, () => click(vetoed, at(vetoed, 37, 2)))).toEqual([]);
      // Nor one putting back an equal selection, or one of another kind.
      const restored = await cometChart(forecasts());
      await spoken(restored, () => click(restored, at(restored, 37, 2)));
      const previous = restored.selection;
      const stop = restored.on("select", ({ selection }) => {
        if (selection?.kind === "items" && selection.items.length === 2) restored.select(previous);
      });
      expect(await spoken(restored, () => click(restored, at(restored, 17, 1), true))).toEqual([]);
      stop();
      restored.on("select", ({ selection }) => {
        if (selection?.kind === "items") restored.select({ kind: "series", series: ["rates"] });
      });
      expect(await spoken(restored, () => click(restored, at(restored, 60, 3)))).toEqual([]);
      expect(restored.selection?.kind).toBe("series");
    },
    "names the item before selection listeners run, and counts after them",
  );

  contractTest(
    "selection.announced.rows.engine",
    async () => {
      const data = diagonal();
      const store = selectionStore(data);
      const chart = await mount({
        ...DOMAINS,
        marks: [point(data, { x: "x", y: "y" })],
        interaction: { brush: "lasso" },
        rowSelection: rowSelection({ store, channel: "picked" }),
      });
      // A lasso writes the rows it holds, whose count the row selection knows.
      const loop = [at(chart, 5, 5), at(chart, 35, 5), at(chart, 35, 35), at(chart, 5, 35)];
      const said = await spoken(chart, () => {
        pointer(chart, "pointerdown", ...loop[0]!);
        for (const p of [...loop.slice(1), loop[0]!]) pointer(chart, "pointermove", ...p);
        pointer(chart, "pointerup", ...loop[0]!);
      });
      expect(said).toEqual(["Selected a freehand region. 3 rows."]);
      // A brush along x writes a condition: its count is not known, and not counted.
      chart.update({ interaction: { brush: "x" } });
      await settled(chart);
      const [x0, y0] = at(chart, 15, 25);
      const [x1] = at(chart, 45, 25);
      const brushed = await spoken(chart, () => {
        pointer(chart, "pointerdown", x0, y0);
        pointer(chart, "pointermove", x1, y0);
        pointer(chart, "pointerup", x1, y0);
      });
      expect(brushed).toHaveLength(1);
      expect(brushed[0]).toMatch(/^Selected x from [\d.]+ to [\d.]+\.$/);
      // A click selecting rows says how many, as Space does; one off the data clears them.
      const clicked = await mount({
        ...DOMAINS,
        marks: [point(data, { x: "x", y: "y" })],
        rowSelection: rowSelection({ store: selectionStore(data), channel: "picked" }),
      });
      expect(await spoken(clicked, () => click(clicked, at(clicked, 20, 20)))).toEqual([
        "1 row selected",
      ]);
      expect(await spoken(clicked, () => click(clicked, at(clicked, 40, 40), true))).toEqual([
        "2 rows selected",
      ]);
      expect(await spoken(clicked, () => click(clicked, at(clicked, 5, 55)))).toEqual([
        "Selection cleared.",
      ]);
      // What the channel holds once its listeners have run is said: three rows a
      // listener wrote in place of one; nothing where it put back what was held.
      const picks = selectionStore(data);
      const listened = await mount({
        ...DOMAINS,
        marks: [point(data, { x: "x", y: "y" })],
        rowSelection: rowSelection({ store: picks, channel: "picked" }),
      });
      const three = selectRows(new RowSet(data).addAll([0, 1, 2]));
      const off = listened.on("rowSelection", ({ selection }) => {
        if (selection?.kind === "rows" && selection.rows.size === 1) picks.set("picked", three);
      });
      expect(await spoken(listened, () => click(listened, at(listened, 40, 40)))).toEqual([
        "3 rows selected",
      ]);
      off();
      listened.on("rowSelection", ({ selection }) => {
        if (!selection) picks.set("picked", three);
      });
      expect(await spoken(listened, () => click(listened, at(listened, 5, 55)))).toEqual([]);
      expect(picks.get("picked")).toBe(three);
      // Of two tables' rows a click off the data clears, one a listener put
      // back: the other was cleared, and that is said.
      const others = table({ x: [12, 22, 32, 42, 52], y: [50, 45, 5, 52, 3] });
      const [mine, theirs] = [selectionStore(data), selectionStore(others)];
      const two = await mount({
        ...DOMAINS,
        marks: [point(data, { x: "x", y: "y" }), point(others, { x: "x", y: "y" })],
        rowSelection: rowSelection(
          { store: mine, channel: "picked" },
          { store: theirs, channel: "picked" },
        ),
      });
      await spoken(two, () => click(two, at(two, 20, 20)));
      await spoken(two, () => click(two, at(two, 22, 45)));
      const kept = mine.get("picked");
      expect([kept?.kind, theirs.get("picked")?.kind]).toEqual(["rows", "rows"]);
      two.on("rowSelection", () => {
        if (!mine.get("picked")) mine.set("picked", kept!);
      });
      expect(await spoken(two, () => click(two, at(two, 5, 30)))).toEqual(["Selection cleared."]);
      expect([mine.get("picked"), theirs.get("picked")]).toEqual([kept, null]);
      // A brush a click clears, whose rows a listener put back: the brush
      // went while its rows are still selected, and that is what is said.
      const conditions = selectionStore(data);
      const brushing = await mount({
        ...DOMAINS,
        marks: [point(data, { x: "x", y: "y" })],
        interaction: { brush: "x" },
        rowSelection: rowSelection({ store: conditions, channel: "picked" }),
      });
      await spoken(brushing, () => brushIn(brushing));
      const condition = conditions.get("picked");
      expect(condition?.kind).toBe("predicate");
      brushing.on("rowSelection", ({ selection }) => {
        if (!selection) conditions.set("picked", condition!);
      });
      expect(await spoken(brushing, () => click(brushing, at(brushing, 55, 5)))).toEqual([
        "Brush cleared.",
      ]);
      expect([brushing.selection, conditions.get("picked")]).toEqual([null, condition]);
    },
    "adds the rows a lasso wrote, counts none for a condition, and says what row clicks select",
  );

  contractTest(
    "selection.announced.quiet.engine",
    async () => {
      // Selections the application makes, or another chart shares, are quiet.
      const chart = await cometChart(forecasts());
      await spoken(chart, () => click(chart, at(chart, 17, 1)));
      const selection = chart.selection;
      expect(
        await spoken(chart, () => {
          chart.select(null);
          chart.select(selection);
        }),
      ).toEqual([]);
      const data = diagonal();
      const store = selectionStore(data);
      const options = (): ChartOptions => ({
        ...DOMAINS,
        marks: [point(data, { x: "x", y: "y" })],
        interaction: { brush: "x", sync: { selection: "announced" } },
        rowSelection: rowSelection({ store, channel: "picked", live: true }),
      });
      const [one, two] = [await mount(options()), await mount(options())];
      const [x0, y0] = at(one, 15, 25);
      const [x1] = at(one, 45, 25);
      // A drag's previews say nothing, and the chart it syncs says nothing of its commit.
      const said = await spokenIn([one, two], async () => {
        pointer(one, "pointerdown", x0, y0);
        pointer(one, "pointermove", (x0 + x1) / 2, y0);
        await frame();
        pointer(one, "pointermove", x1, y0);
        await frame();
        expect(one.root.querySelector("[aria-live]")!.textContent).toBe("");
        pointer(one, "pointerup", x1, y0);
      });
      expect(said[0]).toHaveLength(1);
      expect(said[1]).toEqual([]);
      expect(two.selection).not.toBeNull();
      // A grid or the application writing the rows is quiet too.
      expect(
        await spokenIn([one, two], () =>
          store.set("picked", selectRows(new RowSet(data).addAll([0, 1]))),
        ),
      ).toEqual([[], []]);
      // A drag cancelled by Escape says nothing.
      const cancelled = await spoken(one, async () => {
        pointer(one, "pointerdown", x0, y0);
        pointer(one, "pointermove", x1, y0);
        await frame();
        key(one, "Escape");
        pointer(one, "pointerup", x1, y0);
      });
      expect(cancelled).toEqual([]);
    },
    "says nothing of api and sync selections, previews, and cancelled drags",
  );

  contractTest(
    "selection.announced.clears.engine",
    async () => {
      // Escape clears the chart's brush and the rows clicks select, said once:
      // the brush writes one table's rows, clicks and Space the other's.
      const data = diagonal();
      const picks = diagonal();
      const [brushes, store] = [selectionStore(data), selectionStore(picks)];
      const chart = await mount({
        ...DOMAINS,
        // The keyboard's first stop is the first mark's series.
        marks: [point(picks, { x: "x", y: "y" }), point(data, { x: "x", y: "y" })],
        interaction: { brush: "x" },
        rowSelection: rowSelection(
          { store, channel: "picked", events: ["click"] },
          { store: brushes, channel: "brushed", events: ["brush"] },
        ),
      });
      chart.root.focus();
      await spoken(chart, () => key(chart, "ArrowRight"));
      await spoken(chart, () => key(chart, " "));
      expect(store.get("picked")).not.toBeNull();
      await spoken(chart, () => key(chart, "ArrowRight", { shiftKey: true }));
      expect(chart.selection?.kind).toBe("brush");
      expect(await spoken(chart, () => key(chart, "Escape"))).toEqual(["Selection cleared."]);
      expect([chart.selection, store.get("picked"), brushes.get("brushed")]).toEqual([
        null,
        null,
        null,
      ]);
      // Nothing left to clear: nothing said.
      expect(await spoken(chart, () => key(chart, "Escape"))).toEqual([]);
      // Rows alone, and a brush alone, each say it once.
      await spoken(chart, () => key(chart, "ArrowRight"));
      await spoken(chart, () => key(chart, " "));
      expect(await spoken(chart, () => key(chart, "Escape"))).toEqual(["Selection cleared."]);
      await spoken(chart, () => key(chart, "ArrowRight"));
      await spoken(chart, () => key(chart, "ArrowRight", { shiftKey: true }));
      expect(await spoken(chart, () => key(chart, "Escape"))).toEqual(["Selection cleared."]);
      // A double click's clear binding says so, where its first click left a brush to clear.
      const brushed = await mount({
        ...DOMAINS,
        marks: [point(data, { x: "x", y: "y" })],
        interaction: { brush: { shape: "x", clear: "double-click" } },
      });
      const [x0, y0] = at(brushed, 15, 25);
      const [x1] = at(brushed, 45, 25);
      pointer(brushed, "pointerdown", x0, y0);
      pointer(brushed, "pointermove", x1, y0);
      pointer(brushed, "pointerup", x1, y0);
      await settled(brushed);
      const rect = brushed.root.getBoundingClientRect();
      const [cx, cy] = [rect.left + x0, rect.top + y0];
      expect(
        await spoken(brushed, () => {
          click(brushed, [x0, y0]);
          brushed.root.dispatchEvent(
            new MouseEvent("dblclick", { bubbles: true, clientX: cx, clientY: cy }),
          );
        }),
      ).toEqual(["Selection cleared."]);
    },
    "says Selection cleared once for Escape and clear bindings, and nothing where none was",
  );

  contractTest(
    "selection.announced.boundary.engine",
    async () => {
      // A listener writing an empty set of rows in place of a clear: cleared all the same.
      const data = diagonal();
      const store = selectionStore(data);
      const chart = await mount({
        ...DOMAINS,
        marks: [point(data, { x: "x", y: "y" })],
        rowSelection: rowSelection({ store, channel: "picked" }),
      });
      await spoken(chart, () => click(chart, at(chart, 20, 20)));
      chart.on("rowSelection", ({ selection }) => {
        if (!selection) store.set("picked", selectRows(new RowSet(data)));
      });
      expect(await spoken(chart, () => click(chart, at(chart, 5, 55)))).toEqual([
        "Selection cleared.",
      ]);
      // One writing a condition in place of a clear: the brush that wrote the rows
      // is gone while rows are still selected, by a click off the data or by Escape.
      const conditions = selectionStore(data);
      const brushing = await mount({
        ...DOMAINS,
        marks: [point(data, { x: "x", y: "y" })],
        interaction: { brush: "x" },
        rowSelection: rowSelection({ store: conditions, channel: "picked" }),
      });
      const brush = () => brushIn(brushing);
      await spoken(brushing, brush);
      brushing.on("rowSelection", ({ selection }) => {
        if (!selection) conditions.set("picked", selectWhere(true));
      });
      expect(await spoken(brushing, () => click(brushing, at(brushing, 55, 5)))).toEqual([
        "Brush cleared.",
      ]);
      expect(brushing.selection).toBeNull();
      await spoken(brushing, brush);
      brushing.root.focus();
      expect(await spoken(brushing, () => key(brushing, "Escape"))).toEqual(["Brush cleared."]);
      expect(brushing.selection).toBeNull();
      // Escape whose clear a select listener undoes, rows and brush: nothing said.
      const picks = diagonal();
      const [brushes, clicked] = [selectionStore(data), selectionStore(picks)];
      const both = await mount({
        ...DOMAINS,
        marks: [point(picks, { x: "x", y: "y" }), point(data, { x: "x", y: "y" })],
        interaction: { brush: "x" },
        rowSelection: rowSelection(
          { store: clicked, channel: "picked", events: ["click"] },
          { store: brushes, channel: "brushed", events: ["brush"] },
        ),
      });
      both.root.focus();
      await spoken(both, () => key(both, "ArrowRight"));
      await spoken(both, () => key(both, " "));
      await spoken(both, () => key(both, "ArrowRight", { shiftKey: true }));
      const [held, rows] = [both.selection, clicked.get("picked")];
      expect([held?.kind, rows?.kind]).toEqual(["brush", "rows"]);
      both.on("select", ({ selection }) => {
        if (selection) return;
        both.select(held);
        clicked.set("picked", rows!);
      });
      expect(await spoken(both, () => key(both, "Escape"))).toEqual([]);
      expect([both.selection, clicked.get("picked")]).toEqual([held, rows]);
      // A click on a point whose rows a listener turns into a condition: its
      // rows say nothing, the brush the click cleared is said.
      const conditional = selectionStore(data);
      const pointed = await mount({
        ...DOMAINS,
        marks: [point(data, { x: "x", y: "y" })],
        interaction: { brush: "x" },
        rowSelection: rowSelection({ store: conditional, channel: "picked", events: ["click"] }),
      });
      await spoken(pointed, () => brushIn(pointed));
      pointed.on("rowSelection", ({ selection }) => {
        if (selection?.kind === "rows") conditional.set("picked", selectWhere(true));
      });
      expect(await spoken(pointed, () => click(pointed, at(pointed, 20, 20)))).toEqual([
        "Brush cleared.",
      ]);
      expect([pointed.selection, conditional.get("picked")?.kind]).toEqual([null, "predicate"]);
      // A click listener putting back the rows a click off the data cleared: nothing said.
      const restoring = selectionStore(data);
      const undone = await mount({
        ...DOMAINS,
        marks: [point(data, { x: "x", y: "y" })],
        rowSelection: rowSelection({ store: restoring, channel: "picked" }),
      });
      await spoken(undone, () => click(undone, at(undone, 20, 20)));
      const saved = restoring.get("picked");
      undone.on("click", ({ rows: changes }) => {
        if (changes?.some((change) => change.selection === null)) restoring.set("picked", saved!);
      });
      expect(await spoken(undone, () => click(undone, at(undone, 5, 55)))).toEqual([]);
      expect(restoring.get("picked")).toBe(saved);
      // A select listener putting the brush back, then writing a condition to its
      // channel, which lets the brush go afterwards: that later change is the
      // application's, as "sync" changes are, and nothing is said, by Escape or a click.
      for (const gesture of ["Escape", "click"] as const) {
        const later = selectionStore(data);
        const kept = await mount({
          ...DOMAINS,
          marks: [point(data, { x: "x", y: "y" })],
          interaction: { brush: "x" },
          rowSelection: rowSelection({ store: later, channel: "picked", events: ["brush"] }),
        });
        await spoken(kept, () => brushIn(kept));
        const brushed = kept.selection;
        const stop = kept.on("select", ({ selection }) => {
          if (selection) return;
          stop();
          kept.select(brushed);
          later.set("picked", selectWhere(true));
        });
        kept.root.focus();
        const said = await spoken(kept, () =>
          gesture === "Escape" ? key(kept, "Escape") : click(kept, at(kept, 55, 5)),
        );
        expect(said).toEqual([]);
        expect([kept.selection, later.get("picked")?.kind]).toEqual([null, "predicate"]);
      }
    },
    "says a gesture once, after its own work and every listener it fires, and leaves later writes to the application",
  );

  it("says a brush's clear by one rule whichever way a click or Escape goes", async () => {
    // With items or series selected by clicks, a click off the data clears the
    // brush without the row link's click: bound rows still selected say so too.
    for (const select of ["items", "series"] as const) {
      const data = diagonal();
      const store = selectionStore(data);
      const chart = await mount({
        ...DOMAINS,
        marks: [point(data, { x: "x", y: "y" })],
        interaction: { brush: "x", select },
        rowSelection: rowSelection({ store, channel: "picked" }),
      });
      await spoken(chart, () => brushIn(chart));
      chart.on("rowSelection", ({ selection }) => {
        if (!selection) store.set("picked", selectWhere(true));
      });
      expect(await spoken(chart, () => click(chart, at(chart, 55, 5)))).toEqual(["Brush cleared."]);
      expect([chart.selection, store.get("picked")?.kind]).toEqual([null, "predicate"]);
    }
    // Two tables' channels, one a listener keeps a condition in, the other
    // cleared: by a click with or without items or series, or by Escape.
    const others = () => table({ x: [22, 32, 42], y: [50, 45, 52] });
    for (const [select, gesture] of [
      [undefined, "click"],
      ["items", "click"],
      ["series", "click"],
      [undefined, "Escape"],
    ] as const) {
      const [data, more] = [diagonal(), others()];
      const [mine, theirs] = [selectionStore(data), selectionStore(more)];
      const chart = await mount({
        ...DOMAINS,
        marks: [point(data, { x: "x", y: "y" }), point(more, { x: "x", y: "y" })],
        interaction: { brush: "x", ...(select && { select }) },
        rowSelection: rowSelection(
          { store: mine, channel: "picked" },
          { store: theirs, channel: "picked" },
        ),
      });
      await spoken(chart, () => brushIn(chart));
      expect([mine.get("picked")?.kind, theirs.get("picked")?.kind]).toEqual([
        "predicate",
        "predicate",
      ]);
      chart.on("rowSelection", () => {
        if (!mine.get("picked")) mine.set("picked", selectWhere(true));
      });
      chart.root.focus();
      const said = await spoken(chart, () =>
        gesture === "Escape" ? key(chart, "Escape") : click(chart, at(chart, 55, 5)),
      );
      expect([select, gesture, said]).toEqual([select, gesture, ["Brush cleared."]]);
      expect([chart.selection, mine.get("picked")?.kind, theirs.get("picked")]).toEqual([
        null,
        "predicate",
        null,
      ]);
    }
    // Rows a click clears, and a brush-only channel a listener keeps rows in.
    for (const gesture of ["click", "Escape"] as const) {
      const [data, picks] = [diagonal(), others()];
      const [brushes, clicks] = [selectionStore(data), selectionStore(picks)];
      const chart = await mount({
        ...DOMAINS,
        marks: [point(picks, { x: "x", y: "y" }), point(data, { x: "x", y: "y" })],
        interaction: { brush: "x" },
        rowSelection: rowSelection(
          { store: clicks, channel: "picked", events: ["click"] },
          { store: brushes, channel: "brushed", events: ["brush"] },
        ),
      });
      await spoken(chart, () => click(chart, at(chart, 22, 50)));
      await spoken(chart, () => brushIn(chart));
      expect([clicks.get("picked")?.kind, chart.selection?.kind]).toEqual(["rows", "brush"]);
      chart.on("rowSelection", () => {
        if (!brushes.get("brushed")) brushes.set("brushed", selectWhere(true));
      });
      chart.root.focus();
      const said = await spoken(chart, () =>
        gesture === "Escape" ? key(chart, "Escape") : click(chart, at(chart, 55, 5)),
      );
      expect([gesture, said]).toEqual([gesture, ["Brush cleared."]]);
      expect([chart.selection, clicks.get("picked"), brushes.get("brushed")?.kind]).toEqual([
        null,
        null,
        "predicate",
      ]);
    }
  });

  it("compares items and series as sets: a listener putting the same back in another order is quiet", async () => {
    const chart = await mount({
      ...DOMAINS,
      marks: [point(diagonal(), { x: "x", y: "y" })],
      interaction: { select: "items" },
    });
    await spoken(chart, () => click(chart, at(chart, 40, 40)));
    await spoken(chart, () => click(chart, at(chart, 20, 20), true));
    const saved = chart.selection;
    chart.on("select", ({ cause }) => {
      if (cause === "pointer") chart.select(saved);
    });
    expect(await spoken(chart, () => click(chart, at(chart, 50, 50), true))).toEqual([]);
    const keys = (s: typeof saved) => (s?.kind === "items" ? [...s.items].sort() : []);
    expect(keys(chart.selection)).toEqual(keys(saved));
  });

  it("gives each Space press to one handler: a binding first, else the rows", async () => {
    // Space bound to clear the brush, with rows bound at mount or later: the
    // binding takes the press, and the rows under the cursor are not selected.
    for (const later of [false, true]) {
      const data = diagonal();
      const store = selectionStore(data);
      const options: ChartOptions = {
        ...DOMAINS,
        marks: [point(data, { x: "x", y: "y" })],
        interaction: {
          brush: "x",
          bindings: [{ gesture: { type: "key", key: " " }, action: { type: "clearBrush" } }],
        },
      };
      const bound = rowSelection({ store, channel: "picked" });
      const chart = await mount(later ? options : { ...options, rowSelection: bound });
      if (later) {
        chart.update({ rowSelection: bound });
        await settled(chart);
      }
      chart.root.focus();
      await spoken(chart, () => key(chart, "ArrowRight"));
      await spoken(chart, () => key(chart, "ArrowRight", { shiftKey: true }));
      expect(chart.selection?.kind).toBe("brush");
      expect(await spoken(chart, () => key(chart, " "))).toEqual(["Selection cleared."]);
      expect([chart.selection, store.get("picked")]).toEqual([null, null]);
      // With no brush to clear, the binding passes Space on to the rows.
      expect(await spoken(chart, () => key(chart, " "))).toEqual(["1 row selected"]);
    }
  });

  it("leaves a legend's selections to its buttons' pressed state", async () => {
    const data = table({ t: [0, 1, 2], a: [1, 2, 3], b: [3, 2, 1] });
    const chart = await mount({
      marks: [line(data, { x: "t", y: ["a", "b"] })],
      legend: { action: "select" },
    });
    const button = chart.root.querySelector<HTMLButtonElement>("button")!;
    expect(await spoken(chart, () => button.click())).toEqual([]);
    expect(chart.selection).not.toBeNull();
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("says a network's lasso with the rows it wrote", async () => {
    const nodes = table({ name: ["a", "b", "c", "d"] });
    const links = table({ from: ["a", "b", "c", "d"], to: ["b", "c", "d", "a"] });
    const store = selectionStore(nodes);
    const chart = await mount({
      marks: [graph(links, { source: "from", target: "to", nodes, node: "name" })],
      interaction: { zoom: true, brush: { shape: "lasso", clear: "double-click" } },
      rowSelection: rowSelection({ store, channel: "picked" }),
    });
    const where = (name: string) => {
      const { px, py } = modelOf(chart).inspectItem(JSON.stringify([0, name]))!.points[0]!;
      return [px, py] as const;
    };
    const [x, y] = where("a");
    const origin = pageOrigin(chart.root);
    const lasso = async () => {
      const loop = [
        [x - 12, y - 12],
        [x + 12, y - 12],
        [x + 12, y + 12],
        [x - 12, y + 12],
        [x - 12, y - 12],
      ] as const;
      await realMouse({ type: "move", x: origin.x + loop[0][0], y: origin.y + loop[0][1] });
      await realMouse({ type: "press", x: origin.x + loop[0][0], y: origin.y + loop[0][1] });
      for (const [px, py] of loop.slice(1))
        await realMouse({ type: "move", x: origin.x + px, y: origin.y + py });
      await realMouse({ type: "release", x: origin.x + loop[0][0], y: origin.y + loop[0][1] });
    };
    expect(await spoken(chart, lasso)).toEqual(["Selected a freehand region. 1 row."]);
    // The same lasso again selects nothing new: nothing said.
    expect(await spoken(chart, lasso)).toEqual([]);
    // Nor where a listener gives back a copy of the last one in place of another.
    const last = chart.selection;
    const off = chart.on("select", ({ selection }) => {
      if (JSON.stringify(selection) !== JSON.stringify(last)) chart.select(structuredClone(last));
    });
    const [bx, by] = where("c");
    const other = async () => {
      const at = (dx: number, dy: number) => ({ x: origin.x + bx + dx, y: origin.y + by + dy });
      await realMouse({ type: "move", ...at(-12, -12) });
      await realMouse({ type: "press", ...at(-12, -12) });
      for (const [dx, dy] of [
        [12, -12],
        [12, 12],
        [-12, 12],
        [-12, -12],
      ] as const)
        await realMouse({ type: "move", ...at(dx, dy) });
      await realMouse({ type: "release", ...at(-12, -12) });
    };
    expect(await spoken(chart, other)).toEqual([]);
    expect(chart.selection).toEqual(last);
    off();
    // Its clear binding says so, again where it repeats (a selection set between is quiet).
    const away = { x: origin.x + 8, y: origin.y + 8 };
    const doubleClick = async () => {
      await realMouse({ type: "move", ...away });
      for (const clickCount of [1, 2]) {
        await realMouse({ type: "press", ...away, clickCount });
        await realMouse({ type: "release", ...away, clickCount });
      }
    };
    const selection = chart.selection;
    expect(await spoken(chart, doubleClick)).toEqual(["Selection cleared."]);
    expect(await spoken(chart, () => chart.select(selection))).toEqual([]);
    expect(await spoken(chart, doubleClick)).toEqual(["Selection cleared.\u00a0"]);
  });

  it("passes axe with a selection announced", async () => {
    const chart = await cometChart(forecasts());
    await spoken(chart, () => click(chart, at(chart, 17, 1)));
    const results = await axe.run(chart.root, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
      },
      rules: { region: { enabled: false }, "page-has-heading-one": { enabled: false } },
    });
    expect(results.passes.length).toBeGreaterThan(0);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
