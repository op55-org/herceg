// Totals rows and headings in the page: the footer rowgroup sticky at the
// grid's bottom, its label, focus, and keys; header rows over columns by
// whole heading paths, split by pins and moves; what assistive technology
// reads of both.
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { count, max, mean, sum } from "../../src/data/aggregations.ts";
import { category } from "../../src/data/column.ts";
import { groupRows } from "../../src/data/groups.ts";
import { pivotRows } from "../../src/data/pivot.ts";
import { rowView } from "../../src/data/row-view.ts";
import { type Schema, table } from "../../src/data/table.ts";
import { rowTotals } from "../../src/data/totals.ts";
import { createGrid, type Grid } from "../../src/dom/grid.ts";
import { createPivotGrid } from "../../src/dom/grid-pivot.ts";
import { createRemoteGrid } from "../../src/dom/grid-remote.ts";
import { memorySource } from "../../src/grid/memory.ts";
import { createGridModel, type GridModelOptions } from "../../src/grid/model.ts";
import { createPivotGridModel } from "../../src/grid/pivot.ts";
import { createRemoteGridModel } from "../../src/grid/remote.ts";
import {
  type GridSource,
  GridSourceError,
  type GridSourceErrorCode,
} from "../../src/grid/source.ts";
import { collectGarbage } from "./helpers.ts";

const hosts: HTMLElement[] = [];
const grids: { destroy(): void }[] = [];
afterEach(() => {
  for (const grid of grids.splice(0)) grid.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Requests by service: `rows` of them. */
const requests = (rows: number) =>
  table({
    service: category(Array.from({ length: rows }, (_, i) => ["api", "web", "db"][i % 3]!)),
    region: category(Array.from({ length: rows }, (_, i) => ["eu", "us"][i % 2]!)),
    ms: Float64Array.from({ length: rows }, (_, i) => 10 + (i % 7)),
    bytes: Float64Array.from({ length: rows }, (_, i) => 1000 * (i + 1)),
  });

const OPS = { n: count(), ms: mean("ms"), bytes: sum("bytes"), worst: max("ms") };

function mount<C extends readonly unknown[]>(
  rows: number,
  columns: C,
  options: { height?: number; width?: number; totals?: boolean } = {},
) {
  const t = requests(rows);
  const view = rowView(t);
  const totals = options.totals === false ? null : rowTotals(view, { ops: OPS });
  // Columns of any of the table's fields: checked when the model is made.
  const model = createGridModel({
    data: view,
    totals,
    columns,
    locale: "en-US",
  } as unknown as GridModelOptions<Schema>);
  const host = document.createElement("div");
  host.style.cssText = `width:${options.width ?? 700}px;height:${options.height ?? 300}px`;
  document.body.append(host);
  hosts.push(host);
  const grid = createGrid(host, { model, ariaLabel: "Requests" });
  grids.push(grid);
  return { t, view, totals, model, grid };
}

/** A host of the given size in the page. */
function hostOf(width = 700, height = 300) {
  const host = document.createElement("div");
  host.style.cssText = `width:${width}px;height:${height}px`;
  document.body.append(host);
  hosts.push(host);
  return host;
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  await frame();
};

const said = (grid: { root: HTMLElement }) =>
  grid.root.querySelector("[aria-live]")!.textContent?.trim();

const footer = (grid: { root: HTMLElement }) => grid.root.querySelector<HTMLElement>(".hg-footer")!;
const totalsRow = (grid: { root: HTMLElement }) =>
  footer(grid).querySelector<HTMLElement>("[role=row]")!;
const totalsText = (grid: { root: HTMLElement }) =>
  [...totalsRow(grid).querySelectorAll("[role=gridcell]")].map((cell) => cell.textContent);
const scrollerOf = (grid: { root: HTMLElement }) =>
  grid.root.querySelector<HTMLElement>(".hg-scroller")!;

const COLUMNS = [
  { field: "service" },
  { field: "region" },
  { field: "ms", aggregate: "ms", format: { maximumFractionDigits: 1 } },
  { field: "bytes", aggregate: "bytes" },
] as const;

describe("totals rows", () => {
  it("draw a footer row of each column's total and the label, read as a row after the rows", async () => {
    const { model, grid } = mount(30, COLUMNS);
    await frame();
    const row = totalsRow(grid);
    expect(footer(grid).getAttribute("role")).toBe("rowgroup");
    expect(row.getAttribute("role")).toBe("row");
    expect(totalsText(grid)).toEqual(["Total", "", "12.8", "465,000"]);
    const scroller = scrollerOf(grid);
    expect(scroller.getAttribute("aria-rowcount")).toBe(String(model.rowCount + 2));
    expect(row.getAttribute("aria-rowindex")).toBe(String(model.rowCount + 2));
    expect(row.getAttribute("aria-label")).toBe("Total");
    // Sticky at the bottom of the scroller over the rows.
    const bottom = scroller.getBoundingClientRect().bottom - scroller.clientTop;
    expect(Math.abs(row.getBoundingClientRect().bottom - bottom)).toBeLessThanOrEqual(1);
    // The rows' viewport ends above it.
    expect(model.viewportHeight).toBe(scroller.clientHeight - 32 - model.rowHeight);
  });

  it("sit right under a few rows, and follow rows as they stream", async () => {
    const { t, grid } = mount(2, COLUMNS);
    await frame();
    const rows = grid.root.querySelectorAll<HTMLElement>(".hg-body [role=row]");
    const last = rows[rows.length - 1]!.getBoundingClientRect().bottom;
    expect(Math.abs(totalsRow(grid).getBoundingClientRect().top - last)).toBeLessThanOrEqual(1);
    t.append({ service: ["api"], region: ["eu"], ms: [100], bytes: [7] });
    await frame();
    expect(totalsText(grid)).toEqual(["Total", "", "40.3", "3,007"]);
  });

  it("are named Total where every column shows a total, and where the label scrolled away", async () => {
    const { grid } = mount(5, [
      { field: "ms", aggregate: "ms" },
      { field: "bytes", aggregate: "bytes" },
    ]);
    await frame();
    expect(totalsRow(grid).getAttribute("aria-label")).toBe("Total");
    const wide = mount(
      5,
      [
        { field: "service" },
        ...Array.from({ length: 12 }, (_, i) => ({
          field: "bytes",
          id: `b${i}`,
          aggregate: "bytes",
        })),
      ],
      { width: 400 },
    );
    await frame();
    expect(totalsText(wide.grid)[0]).toBe("Total");
    wide.model.scrollTo({ left: 12 * 120 });
    await frame();
    expect(totalsText(wide.grid)).not.toContain("Total");
    expect(totalsRow(wide.grid).getAttribute("aria-label")).toBe("Total");
  });

  it("take the focus from the last row and Ctrl+End, keep it as rows append, and select nothing", async () => {
    const { t, model, grid } = mount(3, COLUMNS);
    grid.focusCell(2, "ms");
    await userEvent.keyboard("{ArrowDown}");
    expect(model.focus).toMatchObject({ rowIndex: 3, column: "ms" });
    expect(document.activeElement?.closest(".hg-footer")).not.toBeNull();
    await userEvent.keyboard(" ");
    expect(model.selectedCount).toBe(0);
    t.append({ service: ["api"], region: ["eu"], ms: [1], bytes: [1] });
    await frame();
    expect(model.focus).toMatchObject({ rowIndex: 4, column: "ms" });
    await userEvent.keyboard("{ArrowUp}");
    expect(model.focus).toMatchObject({ rowIndex: 3 });
    await userEvent.keyboard("{Control>}{Home}{/Control}{Control>}{End}{/Control}");
    expect(model.focus).toMatchObject({ rowIndex: 4, column: "bytes" });
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(model.selectedCount).toBe(0);
  });
});

describe("totals rows of other grids", () => {
  it("follow group rows in a tree grid, after its last row", async () => {
    const t = requests(9);
    const view = rowView(t);
    const model = createGridModel({
      data: view,
      groups: groupRows(view, { by: ["service"], ops: OPS }),
      totals: rowTotals(view, { ops: OPS }),
      columns: COLUMNS as never,
      locale: "en-US",
    });
    const grid = createGrid(hostOf(), { model, ariaLabel: "Requests" });
    grids.push(grid);
    await frame();
    const scroller = scrollerOf(grid);
    expect(scroller.getAttribute("role")).toBe("treegrid");
    // Three groups, collapsed; the totals row after them.
    expect(model.rowCount).toBe(3);
    expect(totalsRow(grid).getAttribute("aria-rowindex")).toBe("5");
    expect(totalsText(grid)).toEqual(["Total", "", "12.4", "45,000"]);
    model.expandAll();
    await frame();
    expect(totalsRow(grid).getAttribute("aria-rowindex")).toBe(String(model.rowCount + 2));
    expect(scroller.getAttribute("aria-rowcount")).toBe(String(model.rowCount + 2));
  });

  it("show a pivot's totals of each value and of every row, under value headings", async () => {
    const t = requests(12);
    const pivot = pivotRows(rowView(t), {
      rows: "service",
      pivot: "region",
      ops: { n: count(), ms: mean("ms") },
      totals: true,
    });
    const model = createPivotGridModel({ data: pivot, locale: "en-US" });
    const grid = createPivotGrid(hostOf(900), { model, ariaLabel: "Requests" });
    grids.push(grid);
    await frame();
    // Value headings over their aggregates' columns, as any columns' headings.
    const band = [...grid.root.querySelectorAll(".hg-band [role=columnheader]")].map(
      (cell) => cell.textContent,
    );
    expect(band).toEqual(["eu", "us", "Total"]);
    expect(totalsText(grid)).toEqual(["Total", "6", "12.67", "6", "12.5", "12", "12.58"]);
    expect(totalsRow(grid).getAttribute("aria-rowindex")).toBe(String(model.rowCount + 3));
  });

  it("say a remote grid's totals are loading, show them, and say when they failed", async () => {
    const data = requests(300);
    const memory = memorySource(data);
    let fail = false;
    let release: () => void = () => {};
    const source: GridSource = {
      schema: memory.schema,
      rows: (request, signal) => memory.rows(request, signal),
      totals: async (request, signal) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        if (fail) throw new GridSourceError("unavailable", "The server is down");
        return memory.totals(request, signal);
      },
    };
    const model = createRemoteGridModel({
      source,
      totals: [
        { op: "mean", field: "ms", as: "ms" },
        { op: "sum", field: "bytes", as: "bytes" },
      ],
      columns: COLUMNS as never,
      locale: "en-US",
    });
    const grid = createRemoteGrid(hostOf(), { model, ariaLabel: "Requests" });
    grids.push(grid);
    await settle();
    const row = totalsRow(grid);
    expect(row.getAttribute("aria-busy")).toBe("true");
    expect(row.dataset.state).toBe("loading");
    expect(totalsText(grid)).toEqual(["Total", "", "", ""]);
    release();
    await settle();
    expect(row.hasAttribute("aria-busy")).toBe(false);
    expect(row.hasAttribute("data-state")).toBe(false);
    expect(totalsText(grid)).toEqual(["Total", "", "13", "45,150,000"]);
    // Another query asks again; this time the source fails.
    fail = true;
    model.refresh();
    await settle();
    release();
    await settle();
    expect(row.dataset.state).toBe("failed");
    expect(said(grid)).toBe("Totals could not load: The server is down");
    const notice = grid.root.querySelector<HTMLElement>(".hg-status")!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain("The totals could not load.");
    // Trying again from the totals row leaves the focus there.
    grid.focusCell(model.rowCount, "ms");
    await settle();
    fail = false;
    notice.querySelector("button")!.click();
    await settle();
    release();
    await settle();
    expect(row.hasAttribute("data-state")).toBe(false);
    expect(notice.hidden).toBe(true);
    expect(model.focus).toMatchObject({ rowIndex: model.rowCount, column: "ms" });
  });

  for (const end of ["refresh", "dispose"] as const)
    it(`let go of an expired snapshot's failures once a ${end} ends it, its totals still pending or failed late`, async () => {
      const memory = memorySource(requests(300));
      let late: (error: Error) => void = () => {};
      // Made out of the test's scope, so nothing here holds the errors.
      const refs = (() => {
        const made: WeakRef<Error>[] = [];
        const fail = (error: Error) => {
          made.push(new WeakRef(error));
          return error;
        };
        const source: GridSource = {
          schema: memory.schema,
          // The first query's snapshot expires as soon as rows past its first window are asked for.
          rows: (request, signal) =>
            request.revision === 1 && request.snapshot !== null
              ? Promise.reject(
                  fail(new GridSourceError("snapshot-expired", "The snapshot expired")),
                )
              : memory.rows(request, signal),
          // The first query's totals answer late, or never.
          totals: (request, signal) =>
            request.revision === 1
              ? new Promise((_, reject) => {
                  late = (error) => reject(fail(error));
                })
              : memory.totals(request, signal),
        };
        const model = createRemoteGridModel({
          source,
          totals: [{ op: "mean", field: "ms", as: "ms" }],
          columns: COLUMNS as never,
          blockSize: 32,
          settleDelay: 0,
          locale: "en-US",
        });
        model.setViewport(600, 300);
        return { made, model };
      })();
      const { model } = refs;
      await settle();
      expect(model.status.error?.message).toBe("The snapshot expired");
      if (end === "refresh") {
        model.refresh();
        await settle();
        expect(model.status.error).toBeNull();
      } else {
        late(new GridSourceError("unavailable", "Late totals"));
        // The test lets go of the promise too (WebKit's resolving functions keep it).
        late = () => {};
        await settle();
        model.dispose();
        expect(model.status.error).toBeNull();
      }
      for (let i = 0; i < 3; i++) {
        await frame();
        await collectGarbage();
      }
      // The model, kept, holds none of the failures of what it ended.
      expect(refs.made.length).toBeGreaterThan(0);
      expect(refs.made.map((ref) => ref.deref())).toEqual(refs.made.map(() => undefined));
      model.dispose();
    });

  for (const order of ["rows, then totals", "totals, then rows"] as const)
    it(`say a remote snapshot expired whatever fails after (${order}), and refresh from it`, async () => {
      const memory = memorySource(requests(300));
      // Requests after a query's first window wait to be settled by hand, as do totals.
      type Held = {
        signal: AbortSignal;
        settled: boolean;
        settle(code?: GridSourceErrorCode): void;
      };
      let held: { rows: Held[]; totals: Held[] } = { rows: [], totals: [] };
      const hold = <T>(list: Held[], signal: AbortSignal, ask: () => Promise<T>) =>
        new Promise<T>((resolve, reject) => {
          const one: Held = {
            signal,
            settled: false,
            settle: (code) => {
              one.settled = true;
              if (code) reject(new GridSourceError(code, `The source said ${code}`));
              else ask().then(resolve, reject);
            },
          };
          list.push(one);
        });
      const free = () => new AbortController().signal;
      const source: GridSource = {
        schema: memory.schema,
        rows: (request, signal) =>
          request.snapshot === null
            ? memory.rows(request, signal)
            : hold(held.rows, signal, () => memory.rows(request, free())),
        totals: (request, signal) =>
          hold(held.totals, signal, () => memory.totals(request, free())),
      };
      const waiting = () => {
        const live = (list: Held[]) => list.filter((one) => !one.settled && !one.signal.aborted);
        held = { rows: live(held.rows), totals: live(held.totals) };
        return held;
      };
      const totals = [
        { op: "mean", field: "ms", as: "ms" },
        { op: "sum", field: "bytes", as: "bytes" },
      ] as const;
      const model = createRemoteGridModel({
        source,
        totals,
        columns: COLUMNS as never,
        blockSize: 32,
        settleDelay: 0,
        locale: "en-US",
      });
      const grid = createRemoteGrid(hostOf(), { model, ariaLabel: "Requests" });
      grids.push(grid);
      await settle();
      model.scrollTo({ top: model.rowHeight * 200 });
      await settle();
      const notice = grid.root.querySelector<HTMLElement>(".hg-status")!;
      const button = notice.querySelector("button")!;
      const expired = () => {
        expect(model.status.error?.message).toBe("The source said snapshot-expired");
        expect(notice.hidden).toBe(false);
        expect(notice.textContent).toContain("The rows changed where they live.");
        expect(button.hidden).toBe(false);
        expect(button.textContent).toBe("Refresh");
      };
      if (order === "rows, then totals") {
        waiting().rows[0]!.settle("snapshot-expired");
        await settle();
        expired();
        waiting().totals[0]!.settle("unavailable");
      } else {
        waiting().totals[0]!.settle("unavailable");
        await settle();
        expect(notice.textContent).toContain("The totals could not load.");
        waiting().rows[0]!.settle("snapshot-expired");
      }
      for (const one of waiting().rows) one.settle("unavailable");
      await settle();
      expired();
      expect(said(grid)).toBe("Rows could not load: The source said snapshot-expired");
      expect(totalsRow(grid).dataset.state).toBe("failed");
      // Other totals, then none: none asked of the expired snapshot, and it is still said.
      model.update({ totals: [{ op: "max", field: "ms", as: "ms" }] });
      await settle();
      expect(waiting().totals).toHaveLength(0);
      expect(model.status.totals).toBe("failed");
      expired();
      model.update({ totals: null });
      await settle();
      expect(footer(grid).hidden).toBe(true);
      expired();
      // Refreshing reads a new snapshot's rows and totals.
      model.update({ totals });
      button.click();
      for (let round = 0; round < 4; round++) {
        await settle();
        const { rows, totals } = waiting();
        for (const one of [...rows, ...totals]) one.settle();
      }
      await settle();
      expect(model.status).toMatchObject({ error: null, failed: 0, totals: "loaded" });
      expect(notice.hidden).toBe(true);
      expect(totalsText(grid)).toEqual(["Total", "", "13", "45,150,000"]);
    });
});

describe("headings", () => {
  const HEADED = [
    { field: "service", pin: "left" },
    { field: "ms", heading: "Latency" },
    { field: "ms", id: "worst", heading: "Latency", title: "Worst" },
    { field: "bytes", heading: ["Traffic", "Bytes"] },
    { field: "region", heading: [{ id: "a", title: "Where" }] },
    { field: "region", id: "r2", heading: [{ id: "b", title: "Where" }] },
  ] as const;

  const band = (grid: Grid, level: number) =>
    [
      ...grid.root.querySelectorAll<HTMLElement>(
        `.hg-band[aria-rowindex="${level}"] [role=columnheader]`,
      ),
    ].map((cell): [string | null, number, number] => {
      const start = Number(cell.getAttribute("aria-colindex"));
      return [cell.textContent, start, start + Number(cell.getAttribute("aria-colspan")) - 1];
    });

  it("span runs of columns by whole paths, a row per level, and name columns with them", async () => {
    const { model, grid } = mount(5, HEADED, { totals: false, width: 900 });
    await frame();
    expect(band(grid, 1)).toEqual([
      ["Latency", 2, 3],
      ["Traffic", 4, 4],
      ["Where", 5, 5],
      ["Where", 6, 6],
    ]);
    expect(band(grid, 2)).toEqual([["Bytes", 4, 4]]);
    const own = grid.root.querySelector(".hg-header > :last-child")!;
    expect(own.getAttribute("aria-rowindex")).toBe("3");
    const labels = [...own.querySelectorAll("[role=columnheader]")].map((cell) =>
      cell.getAttribute("aria-label"),
    );
    expect(labels).toEqual([
      null,
      "Latency, ms",
      "Latency, Worst",
      "Traffic, Bytes, bytes",
      "Where, region",
      "Where, region",
    ]);
    expect(model.columnTitle("worst")).toBe("Latency, Worst");
    // A column moved out of its run makes two headers.
    model.moveColumn("worst", null);
    grid.render();
    expect(band(grid, 1).filter(([title]) => title === "Latency")).toHaveLength(2);
  });

  it("split runs at pins and join them over hidden columns, and leave the keys on the columns' own row", async () => {
    const { model, grid } = mount(
      5,
      [
        { field: "service", pin: "left", heading: "Who" },
        { field: "region", heading: "Who" },
        { field: "ms", heading: "Speed" },
        { field: "bytes", heading: "Other" },
        { field: "ms", id: "ms2", heading: "Speed" },
      ],
      { totals: false, width: 900 },
    );
    await frame();
    // Held and scrolling columns of one heading: a header over each part.
    expect(band(grid, 1)).toEqual([
      ["Who", 1, 1],
      ["Who", 2, 2],
      ["Speed", 3, 3],
      ["Other", 4, 4],
      ["Speed", 5, 5],
    ]);
    // A hidden column between two of one heading: the shown ones are adjacent.
    model.setColumnVisible("bytes", false);
    grid.render();
    expect(band(grid, 1)).toEqual([
      ["Who", 1, 1],
      ["Who", 2, 2],
      ["Speed", 3, 4],
    ]);
    // Headings take no focus: up from a column's header stays there.
    grid.focusCell(-1, "ms");
    await userEvent.keyboard("{ArrowUp}");
    expect(model.focus).toMatchObject({ rowIndex: -1, column: "ms" });
    expect(document.activeElement?.closest(".hg-band")).toBeNull();
    // Without headings, no band rows.
    model.setColumns([{ field: "service" }, { field: "ms" }] as never);
    grid.render();
    expect(grid.root.querySelectorAll(".hg-band")).toHaveLength(0);
    expect(grid.root.querySelector(".hg-header > [role=row]")!.getAttribute("aria-rowindex")).toBe(
      "1",
    );
  });
});
