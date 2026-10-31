// The first chart on a page to need picking loads it: input that reads what
// it is on waits for it, and is reported once it is here. Nothing else in
// this file loads picking, so its one test sees the first load.

import { expect, it } from "vitest";
import { selectionStore } from "../../src/data/selection.ts";
import { table } from "../../src/data/table.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { point } from "../../src/marks/point.ts";
import { facet } from "../../src/model/facet.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { frame, heard, key, mount, pointer } from "./interaction/helpers.ts";

it("loads on the first listener, holds input that reads targets, and settles", async () => {
  const data = table({ x: [0, 5, 10], y: [0, 5, 10] });
  const chart = await mount({ marks: [point(data, { x: "x", y: "y", id: "dots" })] });
  expect(chart.loading).toBeUndefined();
  // Another chart, whose rows clicks select from now on, and which the
  // first click's selection destroys: the second click it held does nothing.
  const store = selectionStore(data);
  const other = await mount({ marks: [point(data, { x: "x", y: "y" })] });
  // And one whose rows stream: the row Enter was pressed on moves before it is read.
  const streamed = table({ x: [0, 5, 10], y: [1, 2, 3] });
  const keyed = await mount({ marks: [point(streamed, { x: "x", y: "y", id: "keyed" })] });
  // One of boxes, whose first category goes; and one whose mark reads another table.
  const groups = table({
    host: ["a", "a", "a", "b", "b", "b", "c", "c", "c"],
    v: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  });
  const boxes = await mount({ marks: [boxplot(groups, { x: "host", y: "v", id: "boxes" })] });
  const swap = (y: number) => [
    point(table({ x: [0, 5, 10], y: [1, y, 3] }), { x: "x", y: "y", id: "swapped" }),
  ];
  const swapped = await mount({ marks: swap(2) });
  // And boxes in facets of categories of their own, whose first facet goes.
  const regions = table({
    host: ["a", "a", "a", "b", "b", "b", "c", "c", "c"],
    region: ["eu", "eu", "eu", "us", "us", "us", "us", "us", "us"],
    v: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  });
  const faceted = await mount({
    marks: [boxplot(regions, { x: "host", y: "v", id: "regions" })],
    facet: facet("region"),
    x: { scope: "panel" },
  });
  other.update({ rowSelection: rowSelection({ store, channel: "focus" }) });
  other.on("rowSelection", () => other.destroy());
  for (const value of [0, 10]) {
    const [px, py] = [other.toPixel(value, { axis: "x" })!, other.toPixel(value, { axis: "y" })!];
    pointer(other, "pointerdown", px, py);
    pointer(other, "pointerup", px, py);
  }
  expect(store.get("focus")).toBeNull();
  const entered = heard(keyed, "click");
  keyed.root.focus();
  for (const name of ["Home", "ArrowRight", "Enter"]) key(keyed, name);
  streamed.dropFirst(1);
  keyed.render();
  const boxed = heard(boxes, "click");
  boxes.root.focus();
  for (const name of ["Home", "ArrowRight", "Enter"]) key(boxes, name);
  groups.dropFirst(3);
  boxes.render();
  const unswapped = heard(swapped, "click");
  swapped.root.focus();
  for (const name of ["Home", "ArrowRight", "Enter"]) key(swapped, name);
  swapped.update({ marks: swap(80) });
  swapped.render();
  const regional = heard(faceted, "click");
  faceted.root.focus();
  for (const name of ["Home", "ArrowDown", "Enter"]) key(faceted, name);
  regions.dropFirst(3);
  faceted.render();
  const hovers = heard(chart, "hover");
  const clicks = heard(chart, "click");
  const menus = heard(chart, "contextMenu");
  // Listened to, picking loads; the chart is loading until it is here.
  expect(chart.loading).toBeInstanceOf(Promise);
  // Enter on the keyboard's cursor, twice, as it moves.
  chart.root.focus();
  for (const name of ["Home", "Enter", "ArrowRight", "Enter"]) key(chart, name);
  const [x, y] = [chart.toPixel(5, { axis: "x" })!, chart.toPixel(5, { axis: "y" })!];
  pointer(chart, "pointermove", x, y);
  pointer(chart, "pointerdown", x, y);
  pointer(chart, "pointerup", x, y);
  pointer(chart, "contextmenu", x, y, { button: 2 });
  // Off the plot: on the x axis' label "10", and on nothing (the corner).
  const label = [...chart.root.querySelectorAll("svg text")].find(
    (text) => text.textContent === "10" && text.getBoundingClientRect().top > y + 40,
  )!;
  const box = label.getBoundingClientRect();
  const root = chart.root.getBoundingClientRect();
  for (const [px, py] of [
    [box.left - root.left + box.width / 2, box.top - root.top + box.height / 2],
    [2, 2],
  ] as const) {
    pointer(chart, "pointerdown", px, py);
    pointer(chart, "pointerup", px, py);
  }
  // Nothing is reported without what it is on.
  expect([hovers, clicks, menus].map((events) => events.length)).toEqual([0, 0, 0]);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  const item = (row: number) => ({ kind: "item", markId: "dots", row });
  expect(hovers.at(-1)?.target).toMatchObject(item(1));
  // Each where it was pressed.
  expect(clicks.map(({ cause, target }) => ({ cause, target }))).toMatchObject([
    { cause: "keyboard", target: item(0) },
    { cause: "keyboard", target: item(1) },
    { cause: "pointer", target: item(1) },
    { cause: "pointer", target: { kind: "axisLabel", scale: "x", text: "10" } },
  ]);
  expect(menus.map(({ target }) => target)).toMatchObject([item(1)]);
  expect(chart.loading).toBeUndefined();
  // The other chart's clicks wait for picking, then for a frame of its new options.
  await frame();
  await frame();
  // Enter names the row it was pressed on, (5, 2), at its place now.
  expect(entered.map(({ target }) => target)).toMatchObject([
    { kind: "item", markId: "keyed", row: 0 },
  ]);
  // The box of b, though it is first now; and nothing of a table the row was not in.
  expect(boxed.map(({ inspection }) => inspection?.label)).toEqual(["b"]);
  expect(boxed[0]?.target).toMatchObject({ kind: "item", markId: "boxes" });
  expect(unswapped).toEqual([]);
  expect(regional.map(({ inspection }) => inspection?.label)).toEqual(["b"]);
  const selected = store.get("focus");
  expect(selected?.kind === "rows" && [...selected.rows.positions()]).toEqual([0]);
});
