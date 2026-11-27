// A bar of groups bound to its source's store through lineage, in the
// browser: it follows a brush of another chart of the source, its click
// selects the rows behind the bar, and its keyboard text and description
// say how many of them the channel holds.
import "./interactive.ts";
import { describe, expect } from "vitest";
import { sum } from "../../src/data/aggregations.ts";
import { groupRows } from "../../src/data/groups.ts";
import { rowView } from "../../src/data/row-view.ts";
import { type SelectionStore, selectionStore } from "../../src/data/selection.ts";
import { type Schema, type Table, table } from "../../src/data/table.ts";
import type { Chart } from "../../src/dom/chart.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { point } from "../../src/marks/point.ts";
import { lineage } from "../../src/model/lineage-kit.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { contractTest } from "../helpers/contracts.ts";
import { modelOf } from "./helpers.ts";
import { frame, host, key, MOUSE, mount } from "./interaction/helpers.ts";

/** Sales of three regions, North's revenue 10 + 20 + 30, South's 5 + 15, East's 40. */
function sales() {
  return table(
    {
      region: ["North", "North", "North", "South", "South", "East"],
      day: [1, 2, 3, 1, 2, 3],
      revenue: [10, 20, 30, 5, 15, 40],
    },
    { name: "sales" },
  );
}

/** Sends pointer event `type` at client pixel (x, y) of `chart`'s root. */
function pointer(chart: Chart, type: string, x: number, y: number) {
  const rect = chart.root.getBoundingClientRect();
  chart.root.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: rect.left + x,
      clientY: rect.top + y,
      pointerId: MOUSE,
      pointerType: "mouse",
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    }),
  );
}

/** The parts the bar chart draws its bars in: "on", "off", "lower", "upper", "partial". */
function parts(chart: Chart): string[] {
  const marks = modelOf(chart).scene(estimateText).panels[0]!.marks;
  return marks.filter((g) => g.kind === "rect").map((g) => g.key.split("\u0001")[1] ?? "");
}

/** What a channel holds, as positions. */
function rowsOf<S extends Schema>(store: SelectionStore<S>) {
  const held = store.get("days");
  return held?.kind === "rows" ? Array.from(held.rows.positions()) : held;
}

describe("a bar of groups bound to its source's store", () => {
  contractTest(
    "selection.lineage.engine",
    async () => {
      const source = sales();
      const store = selectionStore(source);
      const byRegion = groupRows(rowView(source), {
        by: ["region"],
        ops: { revenue: sum("revenue") },
      });
      const days = await mount(
        {
          marks: [point(source, { x: "day", y: "revenue" })],
          interaction: { brush: "x" },
          rowSelection: rowSelection({ store, channel: "days" }),
        },
        host(400, 300),
      );
      const regions = await mount(
        {
          marks: [bar(byRegion.table as unknown as Table, { x: "region", y: "revenue" })],
          rowSelection: rowSelection({ store, channel: "days", lineage }),
          renderer: "canvas",
        },
        host(400, 300),
      );
      expect(parts(regions)).toEqual([""]);
      // A brush over days 1 and 2 of the points selects four rows.
      const { plot } = days.getPanels()[0]!;
      const x = (day: number) => days.toPixel(day, { axis: "x" })!;
      const middle = plot.y + plot.height / 2;
      // From the plot's left edge, where day 1 may be.
      pointer(days, "pointerdown", plot.x + 1, middle);
      pointer(days, "pointermove", x(1.5), middle);
      pointer(days, "pointermove", x(2.2), middle);
      pointer(days, "pointerup", x(2.2), middle);
      expect(store.get("days")?.kind).toBe("predicate");
      await frame();
      // North's 30 of 60 from its base, the rest dimmed; South all of it; East none.
      expect(parts(regions).sort()).toEqual(["lower", "off", "on", "upper"]);
      regions.root.focus();
      key(regions, "ArrowRight");
      await frame();
      const said = regions.root.querySelector("[aria-live]")!.textContent;
      expect(said).toContain("60; 2 of 3 rows selected, revenue 30 of 60");
      // Descriptions are written at most once a second.
      await expect
        .poll(() => regions.root.textContent, { timeout: 3000 })
        .toContain("4 of 6 rows of sales selected.");
      // A click on South's bar selects the rows behind it, as rows of the source.
      const bars = regions.getPanels()[0]!.plot;
      pointer(regions, "pointermove", bars.x + bars.width / 2, bars.y + bars.height - 4);
      pointer(regions, "pointerdown", bars.x + bars.width / 2, bars.y + bars.height - 4);
      pointer(regions, "pointerup", bars.x + bars.width / 2, bars.y + bars.height - 4);
      await frame();
      expect(rowsOf(store)).toEqual([3, 4]);
      expect(parts(regions).sort()).toEqual(["off", "on"]);
    },
    "follows a brush of its source, and a click on it selects the rows behind it",
  );
});
