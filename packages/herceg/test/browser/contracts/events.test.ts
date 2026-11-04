// Proofs of the matrix's events (test/contracts/), one per row: a click on
// the row's mark reports its item as the click's target; with tooltip.pin
// the click pins the tooltip there; with interaction.zoom a click on a
// tree's group drills into it; a network's node, or a rule of a value,
// moves by a drag. Where a row does none of it, its proof observes that.

import "../interactive.ts";
import { describe, expect } from "vitest";
import { userEvent } from "vitest/browser";
import type { Chart } from "../../../src/dom/chart.ts";
import type { ChartEvents, ItemTarget } from "../../../src/dom/events.ts";
import type { MarkSpec } from "../../../src/spec/spec.ts";
import { cellsOf, fixtureOf, isConstant, markOf, neighbor } from "../../contracts/matrix.ts";
import { contractTest } from "../../helpers/contracts.ts";
import { MOUSE } from "../helpers.ts";
import { expectChartRefused, mount, mountLoaded, plotsOf } from "./mount.ts";
import { click, drag, itemAt, itemClicked, type Pair, pixel, placeOf } from "./pointer.ts";

/** Records a chart's events of a type from now on. */
function heard<K extends keyof ChartEvents>(chart: Chart, type: K): ChartEvents[K][] {
  const events: ChartEvents[K][] = [];
  chart.on(type, (event) => events.push(event));
  return events;
}

/** The rows a click on the row's item selects, and their table (rows.json's `selection`). */
function selectedByClick(row: string): { data: string; rows: number[] } {
  const { table, selection } = fixtureOf(row) as {
    table: string;
    selection?: { data?: string; rows?: { click?: number[] } };
  };
  return { data: selection?.data ?? table, rows: selection?.rows?.click ?? [] };
}

/** The rows whose click selects rows of their table (selection.click works). */
const SELECTING = new Set(
  cellsOf("selection.click")
    .filter((cell) => cell.state === "works")
    .map((cell) => cell.row),
);

describe("events.click", () => {
  for (const cell of cellsOf("events.click"))
    contractTest(`${cell.row}.events.click`, async () => {
      if (cell.state !== "works") throw new Error(`events.click is never ${cell.state}`);
      const { chart, tables } = await mountLoaded({ marks: [markOf(cell.row, { id: "m" })] });
      const found = itemClicked(chart, cell.row);
      expect(found, "a click picks the mark's item").toBeDefined();
      const { at, target } = found!;
      expect(target).toMatchObject({ kind: "item", mark: 0, markId: "m", panel: "" });
      expect(target.item).toEqual(expect.any(String));
      // The next click there reports the same item.
      const clicks = heard(chart, "click");
      click(chart, at);
      expect(clicks).toHaveLength(1);
      expect(clicks[0]).toMatchObject({ cause: "pointer", target: { item: target.item } });
      // With the rows it stands for: as a click selects them, the fixture's;
      // else an item of one row its row, and an aggregate's, none.
      const { rows, row } = clicks[0]!.target as ItemTarget;
      if (isConstant(cell.row)) {
        expect(rows, "a constant annotation has no rows").toBeUndefined();
        return;
      }
      const read = rows!();
      if (!SELECTING.has(cell.row)) {
        expect(read.table).toBe(tables.get(fixtureOf(cell.row).table));
        expect(Array.from(read.positions)).toEqual(row === undefined ? [] : [row]);
        return;
      }
      const { data, rows: selected } = selectedByClick(cell.row);
      expect(at, "where the selection's fixture clicks").toEqual(placeOf(chart, cell.row));
      expect(read.table).toBe(tables.get(data));
      expect(Array.from(read.positions)).toEqual(selected);
    });
});

describe("events.pin", () => {
  for (const cell of cellsOf("events.pin"))
    contractTest(`${cell.row}.events.pin`, async () => {
      if (cell.state !== "works" && cell.state !== "na")
        throw new Error(`events.pin is never ${cell.state}`);
      const mark = markOf(cell.row, { id: "m" });
      // Where a click picks the item, found on a chart that does not pin.
      const found = itemClicked(await mount({ marks: [mark] }), cell.row);
      expect(found, "a click picks the mark's item").toBeDefined();
      const chart = await mount({ marks: [mark], tooltip: { pin: "click" } });
      const [pins, clicks] = [heard(chart, "pin"), heard(chart, "click")];
      click(chart, found!.at);
      expect(clicks[0]!.target?.kind).toBe("item");
      const { item } = clicks[0]!.target as ItemTarget;
      if (cell.state === "na") {
        expect(pins).toEqual([]);
        return;
      }
      expect(pins).toHaveLength(1);
      const [pin] = pins;
      expect(pin!.cause).toBe("pointer");
      // At the item, or at its value along the inspection's axis (every series read there).
      if (pin!.at && "item" in pin!.at) expect(pin!.at).toEqual({ item, panel: "" });
      else
        expect(pin!.at).toEqual({
          value: expect.anything(),
          axis: expect.stringMatching(/^[xy]$/),
          panel: "",
        });
      expect(pin!.inspection?.points.length).toBeGreaterThan(0);
      // A second click there lets it go.
      click(chart, found!.at);
      expect(pins.map((p) => p.at === null)).toEqual([false, true]);
    });
});

describe("events.drill", () => {
  for (const cell of cellsOf("events.drill"))
    contractTest(`${cell.row}.events.drill`, async () => {
      const spec = { marks: [markOf(cell.row, { id: "m" })], interaction: { zoom: true } };
      if (cell.state === "refused") return expectChartRefused(spec, cell);
      const chart = await mount(spec);
      const drills = heard(chart, "drill");
      if (cell.state === "na") {
        // A click on its item drills nothing.
        expect(itemClicked(chart, cell.row), "a click picks the mark's item").toBeDefined();
        expect(drills).toEqual([]);
        expect(chart.getDrillRoot()?.key ?? null).toBeNull();
        return;
      }
      // A group of the tree's first level: the first its legend lists.
      const label = fixtureOf(cell.row).categories![0]!;
      const clicks = heard(chart, "click");
      click(chart, itemAt(chart, { label }).at);
      const group = (clicks[0]!.target as ItemTarget).item;
      expect(drills).toHaveLength(1);
      expect(drills[0]).toMatchObject({
        key: group,
        path: [{ key: group, label }],
        cause: "pointer",
        revision: chart.revision,
      });
      expect(chart.getDrillRoot()).toEqual({ key: group, path: [{ key: group, label }] });
      // Backspace goes back out to the whole tree.
      chart.root.focus();
      await userEvent.keyboard("{Backspace}");
      expect(drills.map(({ key, cause }) => [key, cause])).toEqual([
        [group, "pointer"],
        [null, "keyboard"],
      ]);
      expect(chart.getDrillRoot()).toEqual({ key: null, path: [] });
    });
});

/** A pointer event at a pixel of the chart, the primary button held or not. */
function pointer(chart: Chart, type: string, [x, y]: Pair, buttons: number): void {
  const rect = chart.root.getBoundingClientRect();
  chart.root.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      buttons,
      pointerId: MOUSE,
      pointerType: "mouse",
      clientX: rect.left + x,
      clientY: rect.top + y,
    }),
  );
}

describe("events.item-move", () => {
  for (const cell of cellsOf("events.item-move"))
    contractTest(`${cell.row}.events.item-move`, async () => {
      const rule = fixtureOf(cell.row).mark as (MarkSpec & { y?: number }) | undefined;
      if (cell.state === "refused")
        // A rule is asked to move by its own drag; the other marks by the chart's.
        return expectChartRefused(
          rule?.type === "rule"
            ? { marks: [markOf(cell.row, { id: "m", drag: true })] }
            : { marks: [markOf(cell.row, { id: "m" })], interaction: { drag: true } },
          cell,
        );
      if (cell.state !== "works") throw new Error(`events.item-move is never ${cell.state}`);
      if (rule?.type === "rule") {
        // A rule of a value: the row's, without the table every row's mark is given
        // (a rule over a table moves with its rows), beside a line for its axes.
        const { data: _, ...value } = markOf(cell.row, { id: "m", drag: true }) as MarkSpec & {
          data?: string;
        };
        const chart = await mount({ marks: [neighbor(), value as MarkSpec] });
        const moves = heard(chart, "itemMove");
        const x = plotsOf(chart).x + plotsOf(chart).width / 2;
        const [from, to] = [rule.y!, rule.y! + 4];
        pointer(chart, "pointerdown", [x, pixel(chart, from, "y")], 1);
        for (const y of [from + 2, to]) {
          pointer(chart, "pointermove", [x, pixel(chart, y, "y")], 1);
          chart.render();
        }
        pointer(chart, "pointerup", [x, pixel(chart, to, "y")], 0);
        expect(moves.map(({ phase }) => phase)).toEqual(["preview", "preview", "commit"]);
        for (const move of moves)
          expect(move).toMatchObject({ key: '["m",0]', markId: "m", cause: "pointer" });
        expect(moves.at(-1)!.position!.y).toBeCloseTo(to, 0);
        expect(moves.at(-1)!.position!.x).toBeUndefined();
        return;
      }
      // A network's node, dragged.
      const chart = await mount({
        marks: [markOf(cell.row, { id: "m" })],
        interaction: { drag: true },
      });
      const found = itemClicked(chart, cell.row);
      expect(found, "a click picks a node").toBeDefined();
      const { at, target } = found!;
      const moves = heard(chart, "itemMove");
      drag(chart, [at, [at[0] + 10, at[1] + 10], [at[0] + 30, at[1] + 20]]);
      expect(moves).toHaveLength(1);
      const [move] = moves;
      expect(move).toMatchObject({ key: target.item, phase: "commit", cause: "pointer" });
      expect(move!.position).toEqual({ x: expect.any(Number), y: expect.any(Number) });
      // It stays where it was dropped.
      expect(chart.getItemPositions()[target.item]).toEqual(move!.position);
    });
});
