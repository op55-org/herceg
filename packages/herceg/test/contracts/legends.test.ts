// Proofs of the matrix's legend capabilities (test/contracts/), one per row.

import { describe, expect } from "vitest";
import { estimateText } from "../../src/layout/text.ts";
import { guidesOf } from "../../src/scene/scene.ts";
import { ChartError } from "../../src/spec/errors.ts";
import { contractTest } from "../helpers/contracts.ts";
import {
  build,
  cellsOf,
  customDrew,
  expectRefused,
  fixtureOf,
  markOf,
  neighbor,
  paintsOf,
  tables,
} from "./matrix.ts";

/** The keys, labels, and swatch colors of a scene's legends, in order. */
function entriesOf(scene: ReturnType<typeof build>["scene"]) {
  return guidesOf(scene, "legend").flatMap((legend) =>
    legend.entries.map(({ key, label, color }) => ({ key, label, color })),
  );
}

/** The words of a text: "0 links (kind k)" names 0, links, kind, and k. */
const wordsOf = (text: unknown) => String(text ?? "").split(/[^\p{L}\p{N}]+/u);

/**
 * What a chart draws with every legend key but `shown` hidden: the colors
 * its marks paint, and the words naming each drawn thing in `color`: a
 * series' label (its scene marks are keyed by series, a custom mark's
 * noted as it draws them), and an item's inspected label and text and,
 * where it is a row, that row's values.
 */
function showing(row: string, keys: string[], shown: string, color: string) {
  const chart = { marks: [markOf(row)] };
  const { model } = build(chart);
  for (const key of keys) if (key !== shown) model.hidden.add(key);
  customDrew.clear();
  const marks = model.scene(estimateText).panels.flatMap((p) => p.marks);
  // A custom mark draws the series it is given.
  const named: string[][] = [...customDrew].map(wordsOf);
  const drawn = new Set(marks.map(({ key }) => key.split("|")[0]));
  for (const panel of model.panels())
    for (const series of model.panelSeries(panel.key))
      if (drawn.has(series.key)) named.push(wordsOf(series.label));
  const table = tables?.[fixtureOf(row).table] as { columns?: object } | undefined;
  const columns = Object.values(table?.columns ?? {});
  /** A column's value at row `i`: a list's, or a typed column's (time, categories). */
  const cellOf = (column: unknown, i: number) =>
    Array.isArray(column) ? column[i] : (column as { values?: unknown[] }).values?.[i];
  for (let key = model.stepItem(undefined, 1); key !== undefined; ) {
    for (const point of model.inspectItem(key)?.points ?? [])
      if (point.color === color) {
        const values = point.row == null ? [] : columns.map((column) => cellOf(column, point.row!));
        named.push([...wordsOf(point.label), ...wordsOf(point.text), ...values.map(String)]);
      }
    const next = model.stepItem(key, 1);
    key = next === key ? undefined : next;
  }
  return { painted: paintsOf(marks), named };
}

describe("legend.categorical", () => {
  for (const cell of cellsOf("legend.categorical"))
    contractTest(`${cell.row}.legend.categorical`, () => {
      const chart = { marks: [markOf(cell.row)] };
      if (cell.state === "refused") return expectRefused(() => build(chart), cell);
      if (cell.state === "na") {
        // Beside a line of two series in another panel, the legend lists
        // the line's series, and of the mark at most an entry for it whole.
        const panels = [{ id: "a" }, { id: "b" }];
        const series = neighbor({ series: "kind", panel: "a" });
        const { scene } = build({ panels, marks: [series, markOf(cell.row, { panel: "b" })] });
        const line = build({ panels, marks: [series] }).scene;
        const { entry } = fixtureOf(cell.row);
        expect(entriesOf(scene).map((e) => e.label)).toEqual(["k", "m", ...(entry ? [entry] : [])]);
        expect(entriesOf(scene).slice(0, 2)).toEqual(entriesOf(line));
        return;
      }
      const { categories } = fixtureOf(cell.row);
      if (!categories) throw new Error(`rows.json gives ${cell.row} no categories to list`);
      const { scene } = build(chart);
      const entries = entriesOf(scene);
      expect(entries.map((e) => e.label)).toEqual(categories);
      // Each swatch is the color of what its entry names: shown alone, it paints that color, and
      // none of the other entries'; and what it draws in that color is what its label names.
      const keys = entries.map(({ key }) => key);
      for (const { key, label, color } of entries) {
        const { painted, named } = showing(cell.row, keys, key, color);
        expect(painted.has(color), `${label} alone paints its swatch color ${color}`).toBe(true);
        expect(
          named.some((words) => words.includes(label)),
          `${label} alone draws what ${label} names`,
        ).toBe(true);
        for (const words of named)
          for (const other of entries)
            if (other.label !== label)
              expect(words, `${label} alone draws ${other.label}`).not.toContain(other.label);
        for (const other of entries)
          if (other.color !== color)
            expect(painted.has(other.color), `${label} alone paints ${other.label}'s color`).toBe(
              false,
            );
      }
    });
});

/** The labels of a scene's colorbars, as numbers. */
function colorbarLabels(scene: ReturnType<typeof build>["scene"]): number[][] {
  return guidesOf(scene, "colorbar").map((bar) =>
    bar.items.flatMap((item) => (item.type === "text" ? [Number(item.text)] : [])),
  );
}

describe("legend.colorbar", () => {
  const named = [{ type: "colorbar", scale: { mark: "m", channel: "color" } }];
  for (const cell of cellsOf("legend.colorbar"))
    contractTest(`${cell.row}.legend.colorbar`, () => {
      const { colorbar } = fixtureOf(cell.row);
      const chart = {
        marks: [markOf(cell.row, { id: "m", ...colorbar?.options })],
        guides: named,
      } as never;
      if (cell.state === "refused") return expectRefused(() => build(chart), cell);
      if (cell.state === "na") {
        // A colorbar of the mark as it is drawn is refused where it names the
        // mark, as nothing it draws is colored by numbers; one of a point
        // beside it, which is, is drawn.
        let thrown: unknown;
        try {
          build({ marks: [markOf(cell.row, { id: "m" })], guides: named } as never);
        } catch (error) {
          thrown = error;
        }
        expect(thrown, "the colorbar is refused").toBeInstanceOf(ChartError);
        const { code, path, message } = thrown as ChartError;
        expect(code).toBe("invalid-option");
        expect(["guides[0].scale", "guides[0].scale.channel"]).toContain(path);
        expect(message.startsWith(`chart ${path}: mark "m" `)).toBe(true);
        const panels = [{ id: "a" }, { id: "b" }];
        const point = markOf("point", { id: "p", panel: "a", color: "y" });
        const { scene } = build({
          panels,
          marks: [point, markOf(cell.row, { panel: "b" })],
          guides: [{ type: "colorbar", scale: { mark: "p", channel: "color" } }],
        } as never);
        expect(colorbarLabels(scene)).toHaveLength(1);
        return;
      }
      if (!colorbar?.domain) throw new Error(`rows.json gives ${cell.row} no colorbar extent`);
      const [labels] = colorbarLabels(build(chart).scene);
      const [low, high] = colorbar.domain;
      expect(labels!.length, "a colorbar of labeled ticks").toBeGreaterThan(1);
      for (const value of labels!) {
        expect(value).toBeGreaterThanOrEqual(low!);
        expect(value).toBeLessThanOrEqual(high!);
      }
    });
});
