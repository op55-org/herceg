// What clicked items stand for (`ItemTarget.provenance` and `rows()`): what
// they group by, their condition on their mark's table and through derived
// tables, captured with clicks, Enter, and secondary presses, never with
// hover, and their rows read by identity when asked.
import "./interactive.ts";
import { describe, expect, it } from "vitest";
import { sum } from "../../src/data/aggregations.ts";
import { time } from "../../src/data/column.ts";
import { derive } from "../../src/data/derive.ts";
import { compileExpression, type Expression } from "../../src/data/expression.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { type Table, table } from "../../src/data/table.ts";
import type { Chart } from "../../src/dom/chart.ts";
import type { ItemTarget } from "../../src/dom/events.ts";
import { chartFromSpec } from "../../src/from-spec.ts";
import { bar } from "../../src/marks/bar.ts";
import { point } from "../../src/marks/point.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import { inputEventPayload } from "../../src/web/events.ts";
import fixture from "../fixtures/provenance-events.json";
import { contractTest } from "../helpers/contracts.ts";
import { frame, heard, host, key, mount, pointer } from "./interaction/helpers.ts";

const DAY = 86_400_000;
const month = (m: number) => Date.UTC(2025, m, 1);

/** Daily revenue for two regions over the first quarter of 2025. */
function days() {
  const n = 90;
  return table(
    {
      day: time(Array.from({ length: n * 2 }, (_, i) => month(0) + Math.floor(i / 2) * DAY)),
      region: Array.from({ length: n * 2 }, (_, i) => (i % 2 ? "South" : "North")),
      revenue: Float64Array.from({ length: n * 2 }, (_, i) => 100 + (i % 7) * 10),
    },
    { name: "days" },
  );
}

/** The rows of `t` where `condition` holds. */
function where(t: Table, condition: Expression | null | undefined): number[] {
  const holds = compileExpression(condition as Expression, t);
  return Array.from({ length: t.length }, (_, i) => i).filter((i) => holds.at(i));
}

/** Clicks (x, y) in data, and gives the item target the click reported. */
async function clickAt(chart: Chart, x: number | string, y: number): Promise<ItemTarget> {
  const clicks = heard(chart, "click");
  const px = chart.toPixel(x as number, { axis: "x" })!;
  const py = chart.toPixel(y, { axis: "y" })!;
  pointer(chart, "pointerdown", px, py);
  pointer(chart, "pointerup", px, py);
  await frame();
  const target = clicks.at(-1)?.target;
  expect(target?.kind).toBe("item");
  return target as ItemTarget;
}

describe("the dashboard's monthly bars", () => {
  contractTest(
    "interaction.provenance.chart.engine",
    async () => {
      const source = days();
      const monthly = derive(source)
        .bin("day", { bins: [month(0), month(1), month(2), month(3)], as: "month" })
        .aggregate({ by: ["month", "region"], ops: { revenue: sum("revenue") } })
        .table();
      const chart = await mount({
        marks: [bar(monthly, { id: "periods", x: "month", y: "revenue", series: "region" })],
      });
      const target = await clickAt(chart, month(1) + 2 * DAY, 100);
      const { provenance } = target;
      expect(provenance?.groups).toEqual([
        { field: "month", value: month(1), time: true },
        { field: "region", value: expect.any(String) },
      ]);
      const region = provenance!.groups[1]! as { value: string };
      expect(provenance?.source?.table).toBe("days");
      // Exactly February's days of the bar's region.
      const rows = where(source as unknown as Table, provenance!.source!.condition);
      expect(rows.length).toBe(28);
      expect(
        rows.every((row) => {
          const day = source.value("day", row) as number;
          return day >= month(1) && day < month(2) && source.value("region", row) === region.value;
        }),
      ).toBe(true);
      // Its own rows: the one row of the month and region.
      const own = target.rows!();
      expect(own.table).toBe(monthly);
      expect([...own.positions]).toEqual(where(monthly as unknown as Table, provenance!.condition));
      expect(own.positions).toHaveLength(1);
    },
    "a monthly bar says its month and region, and its days on the day table (b-dash.01, .04, .10)",
  );
});

describe("input", () => {
  it("carries provenance and rows on clicks, secondary presses, and Enter, never on hover", async () => {
    const data = table({ id: ["a", "b", "c"], x: [0, 5, 10], y: [0, 5, 10] });
    const chart = await mount({ marks: [point(data, { x: "x", y: "y", itemKey: "id" })] });
    const [hovers, clicks, menus] = [
      heard(chart, "hover"),
      heard(chart, "click"),
      heard(chart, "contextMenu"),
    ];
    const [x, y] = [chart.toPixel(5, { axis: "x" })!, chart.toPixel(5, { axis: "y" })!];
    pointer(chart, "pointermove", x, y);
    await frame();
    const hovered = hovers.at(-1)?.target as ItemTarget;
    expect(hovered).toMatchObject({ kind: "item", row: 1 });
    expect("provenance" in hovered || "rows" in hovered).toBe(false);
    pointer(chart, "pointerdown", x, y);
    pointer(chart, "pointerup", x, y);
    pointer(chart, "pointerdown", x, y, { button: 2 });
    chart.root.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: chart.root.getBoundingClientRect().left + x,
        clientY: chart.root.getBoundingClientRect().top + y,
      }),
    );
    await frame();
    const condition = ["==", ["field", "id"], "b"];
    for (const event of [clicks.at(-1), menus.at(-1)]) {
      const target = event?.target as ItemTarget;
      expect(target.provenance).toEqual({
        groups: [{ field: "id", value: "b" }],
        condition,
        source: undefined,
      });
      expect([...target.rows!().positions]).toEqual([1]);
    }
    // Enter on the keyboard's cursor: a click on what it is on.
    chart.root.focus();
    key(chart, "ArrowRight");
    key(chart, "Enter");
    await frame();
    const entered = clicks.at(-1)!;
    expect(entered.cause).toBe("keyboard");
    expect((entered.target as ItemTarget).provenance?.condition).toEqual(expect.any(Array));
  });

  it("keep rows by identity: appended rows join none, dropped ones leave, and none survive a reset", async () => {
    const data = table({ id: ["a", "b", "a"], x: [0, 5, 10], y: [0, 5, 10] });
    const chart = await mount({ marks: [point(data, { x: "x", y: "y", itemKey: "id" })] });
    const target = await clickAt(chart, 10, 10);
    const rows = () => [...target.rows!().positions];
    expect(rows()).toEqual([0, 2]);
    data.append({ id: ["a"], x: [7], y: [7] });
    expect(rows()).toEqual([0, 2]);
    data.dropFirst(1);
    expect(rows()).toEqual([1]);
    data.reset({ id: ["a"], x: [10], y: [10] });
    expect(rows()).toEqual([]);
  });

  it("keep an ordered table's rows through rows inserted before them", async () => {
    const data = orderedTable({ t: [0, 5, 10], v: [0, 5, 10] }, { orderBy: "t" });
    const chart = await mount({ marks: [point(data, { x: "t", y: "v" })] });
    const target = await clickAt(chart, 5, 5);
    expect(target.provenance).toMatchObject({ groups: [], condition: null });
    expect([...target.rows!().positions]).toEqual([1]);
    data.append({ t: [2, 3], v: [1, 1] });
    expect([...target.rows!().positions]).toEqual([3]);
  });
});

describe("JSON", () => {
  it("writes the times a click captured, whatever the chart holds since", async () => {
    const data = table({ at: time([month(0), month(1), month(2)]), v: [1, 2, 3] });
    const chart = await mount({ marks: [bar(data, { x: "at", y: "v" })] });
    const clicks = heard(chart, "click");
    await clickAt(chart, month(1), 1);
    const event = clicks.at(-1)!;
    chart.update({ marks: [bar(table({ at: [0, 1, 2], v: [1, 2, 3] }), { x: "at", y: "v" })] });
    await frame();
    expect(inputEventPayload(chart, event).target).toMatchObject({
      provenance: { groups: [{ field: "at", value: month(1), time: true }] },
    });
  });

  let spec: unknown;
  for (const { contract, name, spec: given, click, provenance } of fixture.cases)
    contractTest(
      `${contract}.engine`,
      async () => {
        if (given !== "same") spec = given;
        const chart = chartFromSpec(host(), spec as ChartSpec);
        for (let loading = chart.loading; loading; loading = chart.loading) await loading;
        chart.render();
        const clicks = heard(chart, "click");
        await clickAt(chart, click.x, click.y);
        const payload = inputEventPayload(chart, clicks.at(-1)!);
        expect(payload.target).toMatchObject({ kind: "item", provenance });
        chart.destroy();
      },
      `writes ${name}`,
    );
});
