// Proofs of the matrix's placement capabilities (test/contracts/), one per
// row: the row's mark drawn in a named panel, or split into facets, draws
// there what it draws alone, and nothing elsewhere.

import { describe, expect } from "vitest";
import type { ChartModel } from "../../src/model/model.ts";
import { contractTest } from "../helpers/contracts.ts";
import {
  build,
  cellsOf,
  expectInside,
  expectPlacedAlike,
  expectRefused,
  groupTables,
  isConstant,
  markOf,
  neighbor,
  panelOf,
  placedIn,
  signature,
} from "./matrix.ts";

const twoPanels = [{ id: "a" }, { id: "b" }];
/**
 * Geometry's signatures without what facets share: keys (they name source
 * rows, which a table of one group numbers anew), rasters' cells (a shared
 * scale spans every panel's), and the order of labels.
 */
const unkeyed = (geometry: Parameters<typeof signature>[0]) =>
  signature(geometry)
    .map(({ key: _, size, labels, ...drawn }) =>
      JSON.stringify({
        ...drawn,
        ...(drawn.kind !== "raster" && { size }),
        ...(labels && { labels: [...labels].sort() }),
      }),
    )
    .sort();

/**
 * Expects the row's mark drawn in panel `at` beside a line in `beside` to
 * draw there, at the same places in its plot, what it draws in `twin`, a
 * panel of the same size, beside the line in `besideTwin`, and the line
 * likewise; and no other panel to draw anything.
 */
function expectPlaced(
  row: string,
  layout: object,
  [at, beside]: [string, string],
  [twin, besideTwin]: [string, string],
): void {
  const chart = (mark: string, line: string) =>
    build({
      ...layout,
      marks: [neighbor({ panel: line }), markOf(row, { panel: mark })],
    } as never).scene;
  const [scene, reference] = [chart(at, beside), chart(twin, besideTwin)];
  const drawn = placedIn(panelOf(scene, at));
  expect(drawn.length, "the mark draws in its panel").toBeGreaterThan(0);
  expectInside(panelOf(scene, at), row);
  expectPlacedAlike(drawn, placedIn(panelOf(reference, twin)));
  expectPlacedAlike(placedIn(panelOf(scene, beside)), placedIn(panelOf(reference, besideTwin)));
  for (const panel of scene.panels)
    if (panel.key !== at && panel.key !== beside) expect(panel.marks, panel.key).toEqual([]);
}

/** A grid layout cell holding `content`. */
const cell = (row: number, column: number, content: object, span: object = {}) => ({
  row,
  column,
  ...span,
  content,
});
const place = (panel: string) => ({ type: "panel", panel });

describe("placement.panel", () => {
  for (const cell of cellsOf("placement.panel"))
    contractTest(`${cell.row}.placement.panel`, () => {
      const placed = {
        panels: twoPanels,
        marks: [neighbor({ panel: "a" }), markOf(cell.row, { panel: "b" })],
      };
      if (cell.state === "refused") return expectRefused(() => build(placed), cell);
      if (cell.state !== "works") throw new Error(`placement.panel is never ${cell.state}`);
      // The panels are the same size: the mark draws in b what it draws in a.
      expectPlaced(cell.row, { panels: twoPanels }, ["b", "a"], ["a", "b"]);
    });
});

describe("placement.nested", () => {
  // Columns of rows: four panels of one size, a and b on the left.
  const nested = {
    panels: ["a", "b", "c", "d"].map((id) => ({ id })),
    layout: {
      type: "grid",
      columns: [1, 1],
      cells: [
        cell(0, 0, {
          type: "grid",
          rows: [1, 1],
          cells: [cell(0, 0, place("a")), cell(1, 0, place("b"))],
        }),
        cell(0, 1, {
          type: "grid",
          rows: [1, 1],
          cells: [cell(0, 0, place("c")), cell(1, 0, place("d"))],
        }),
      ],
    },
  };
  for (const cell of cellsOf("placement.nested"))
    contractTest(`${cell.row}.placement.nested`, () => {
      const placed = {
        ...nested,
        marks: [neighbor({ panel: "c" }), markOf(cell.row, { panel: "b" })],
      };
      if (cell.state === "refused") return expectRefused(() => build(placed as never), cell);
      if (cell.state !== "works") throw new Error(`placement.nested is never ${cell.state}`);
      expectPlaced(cell.row, nested, ["b", "c"], ["d", "a"]);
      const { scene } = build(placed as never);
      // b is under a, left of d.
      expect(panelOf(scene, "b").plot.y).toBeGreaterThan(panelOf(scene, "a").plot.y);
      expect(panelOf(scene, "b").plot.x).toBeLessThan(panelOf(scene, "d").plot.x);
    });
});

describe("placement.span", () => {
  // A panel across both columns over two panels; and the same as rows of a
  // panel and a grid of two, which draws its top panel alike.
  const spanned = {
    panels: ["wide", "a", "b"].map((id) => ({ id })),
    layout: {
      type: "grid",
      rows: [1, 1],
      columns: [1, 1],
      cells: [
        cell(0, 0, place("wide"), { columnSpan: 2 }),
        cell(1, 0, place("a")),
        cell(1, 1, place("b")),
      ],
    },
  };
  const stacked = {
    ...spanned,
    layout: {
      type: "grid",
      rows: [1, 1],
      cells: [
        cell(0, 0, place("wide")),
        cell(1, 0, {
          type: "grid",
          columns: [1, 1],
          cells: [cell(0, 0, place("a")), cell(0, 1, place("b"))],
        }),
      ],
    },
  };
  for (const cell of cellsOf("placement.span"))
    contractTest(`${cell.row}.placement.span`, () => {
      const marks = [neighbor({ panel: "a" }), markOf(cell.row, { panel: "wide" })];
      if (cell.state === "refused")
        return expectRefused(() => build({ ...spanned, marks } as never), cell);
      if (cell.state !== "works") throw new Error(`placement.span is never ${cell.state}`);
      const { scene } = build({ ...spanned, marks } as never);
      const reference = build({ ...stacked, marks } as never).scene;
      const wide = panelOf(scene, "wide");
      expect(signature(wide.marks).length, "the mark draws in its panel").toBeGreaterThan(0);
      expectInside(wide, cell.row);
      expectPlacedAlike(placedIn(wide), placedIn(panelOf(reference, "wide")));
      expect(wide.plot).toEqual(panelOf(reference, "wide").plot);
      expect(panelOf(scene, "b").marks).toEqual([]);
      // Across both columns: from a's left to b's right.
      expect(wide.plot.width).toBeGreaterThan(1.5 * panelOf(scene, "a").plot.width);
    });
});

describe("placement.inset", () => {
  // Two insets of one size over a panel.
  const size = { width: { px: 220 }, height: { px: 150 } };
  const insets = {
    panels: ["p", "i1", "i2"].map((id) => ({ id })),
    layout: {
      type: "panel",
      panel: "p",
      insets: [
        { panel: "i1", place: { inside: "top-left" }, ...size },
        { panel: "i2", place: { inside: "bottom-right" }, ...size },
      ],
    },
  };
  for (const cell of cellsOf("placement.inset"))
    contractTest(`${cell.row}.placement.inset`, () => {
      const placed = {
        ...insets,
        marks: [neighbor({ panel: "p" }), markOf(cell.row, { panel: "i1" })],
      };
      if (cell.state === "refused") return expectRefused(() => build(placed as never), cell);
      if (cell.state !== "works") throw new Error(`placement.inset is never ${cell.state}`);
      expectPlaced(cell.row, insets, ["i1", "p"], ["i2", "p"]);
    });
});

describe("placement.facet-in-cell", () => {
  for (const cell of cellsOf("placement.facet-in-cell"))
    contractTest(`${cell.row}.placement.facet-in-cell`, () => {
      const request = {
        panels: [{ id: "a" }],
        layout: place("a"),
        facet: { field: "group" },
        marks: [markOf(cell.row, { panel: "a" })],
      };
      if (cell.state !== "refused")
        throw new Error(`placement.facet-in-cell is ${cell.state}: prove it`);
      expectRefused(() => build(request as never), cell);
    });
});

/**
 * The data a panel shows, whatever its size and scales: each series' values along the axes, by its key (a
 * series reads the rows it lists of its table's columns, or their first
 * `length`; on a category axis, a value is its category), what its
 * annotations and layout marks are said to show (annotations every facet
 * shows are said of the chart, and each panel's by its name too), and
 * what each item a layout mark drew tells when inspected, in any order.
 */
function shownIn(model: ChartModel, panel: string) {
  const scales = model.panels().find(({ key }) => key === panel);
  const series = model.panelSeries(panel).map(({ key, x, y, y0, rows, length }) => {
    const read = (values: ArrayLike<number> | undefined, axis: "x" | "y") =>
      values &&
      Array.from({ length }, (_, i) => {
        const value = values[rows ? rows[i]! : i]!;
        return scales?.[axis].categories?.[value] ?? value;
      });
    return { key, x: read(x, "x"), y: read(y, "y"), y0: read(y0, "y") };
  });
  series.sort((a, b) => a.key.localeCompare(b.key));
  // The chart's notes but those it tells of each panel by name ("N: Rules: ...").
  const named = model.panels().map(({ key }) => `${key}: `);
  const shared = model
    .annotationSummaries()
    .filter((note) => !named.some((name) => note.startsWith(name)));
  // A default name numbers its row ("Point 4"), which a table of one group numbers anew.
  const unnumbered = (label: string, row: number | undefined) =>
    row !== undefined && label.endsWith(` ${row + 1}`)
      ? `${label.slice(0, -String(row + 1).length)}#`
      : label;
  const items: string[] = [];
  for (let key = model.stepItem(undefined, 1, panel); key !== undefined; ) {
    const points = model.inspectItem(key, panel)?.points ?? [];
    const told = points.map(({ label, row, text, value }) => [unnumbered(label, row), text, value]);
    items.push(JSON.stringify(told));
    const next = model.stepItem(key, 1, panel);
    key = next === key ? undefined : next;
  }
  return {
    series,
    notes: [...new Set([...shared, ...model.annotationSummaries(panel)])],
    layout: model.layoutSummary(panel),
    items: items.sort(),
  };
}

describe("placement.facet", () => {
  for (const cell of cellsOf("placement.facet"))
    contractTest(`${cell.row}.placement.facet`, () => {
      // A line beside an annotation gives the facets rows to split.
      const marks = isConstant(cell.row) ? [neighbor(), markOf(cell.row)] : [markOf(cell.row)];
      const faceted = { facet: { field: "group" }, marks };
      if (cell.state === "refused") return expectRefused(() => build(faceted), cell);
      if (cell.state !== "works") throw new Error(`placement.facet is never ${cell.state}`);
      const { model, scene } = build(faceted);
      expect(scene.panels.map((p) => p.key)).toEqual(["N", "S"]);
      // The groups show different data, so a panel showing the other's fails.
      expect(shownIn(model, "N"), "the groups' data").not.toEqual(shownIn(model, "S"));
      for (const group of ["N", "S"]) {
        const apart = build({ data: groupTables(group), marks });
        // Keys name source rows, which the apart chart's table numbers anew.
        expect(unkeyed(panelOf(scene, group).marks), `panel ${group}`).toEqual(
          unkeyed(apart.scene.panels[0]!.marks),
        );
        expect(shownIn(model, group), `panel ${group}'s data`).toEqual(
          shownIn(apart.model, apart.scene.panels[0]!.key),
        );
      }
    });
});

// The alternative a dendrogram's refusal of facets names: drawn whole in every facet panel.
contractTest("dendrogram.placement.facet.repeat", () => {
  const cells = { type: "heatmap", data: "samples", x: "category", y: "group", color: "y" };
  const { scene } = build({
    facet: { field: "group" },
    marks: [cells as never, markOf("dendrogram", { facet: "repeat" })],
    x: { scope: "panel" },
    y: { scope: "panel" },
  });
  const merges = (geometry: Parameters<typeof signature>[0]) =>
    signature(geometry).filter(({ kind }) => kind === "segments");
  const alone = build({ marks: [markOf("dendrogram")] }).scene;
  expect(scene.panels.map((p) => p.key)).toEqual(["N", "S"]);
  expect(merges(alone.panels[0]!.marks).length).toBeGreaterThan(0);
  for (const panel of scene.panels)
    expect(merges(panel.marks).map(({ count }) => count)).toEqual(
      merges(alone.panels[0]!.marks).map(({ count }) => count),
    );
});
