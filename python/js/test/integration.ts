// The matrix's integration proofs of Python's live surfaces (test/contracts/):
// the notebook widget, Streamlit, and web fragments. Each surface's describe
// in contracts.test.ts gives this harness a driver of its entry point and
// host, and the harness proves the surface's cell of each mark row, as the
// adapters' proofs do theirs (packages/react/test/contracts.test.tsx): the
// row's chart, sent as Python sends it, draws what the chart of its spec
// draws, reports the datum under the pointer and a refused change through
// the surface's own paths, takes a change on the chart it made, and leaves
// nothing once closed.

import { expect } from "vitest";
import type { Chart } from "../../../packages/herceg/src/dom/chart.ts";
import { ChartError, type ChartErrorInfo } from "../../../packages/herceg/src/spec/errors.ts";
import { loadSpec } from "../../../packages/herceg/src/spec/load.ts";
import type { ChartSpec, MarkSpec } from "../../../packages/herceg/src/spec/spec.ts";
import { validateSpec } from "../../../packages/herceg/src/spec/validate.ts";
import type { InspectionPayload } from "../../../packages/herceg/src/web/events.ts";
import {
  firstPoint,
  host,
  REFUSED,
  referenceOf,
  SETTINGS,
} from "../../../packages/herceg/test/browser/contracts/integration.ts";
import type { Pair } from "../../../packages/herceg/test/browser/contracts/pointer.ts";
import { type Cell, cellsOf, specOf } from "../../../packages/herceg/test/contracts/matrix.ts";
import { contractTest } from "../../../packages/herceg/test/helpers/contracts.ts";
import { sameDrawing } from "../../../packages/herceg/test/helpers/surfaces.ts";

/** A live surface Python sends charts to, as its proofs drive it. */
export interface Surface {
  /** Its name in the matrix: its cells are `integration.<name>`. */
  name: "widget" | "streamlit" | "web";
  /**
   * How a change of options reaches the chart: in place (the widget's
   * update), or by a chart made in its place (a Streamlit rerun's new bytes).
   */
  changes: "in place" | "in its place";
  /**
   * What the surface reports of a refusal: the engine's error, with its
   * code and path (the widget's message, a fragment's `herceg:error`), or
   * its message alone (the alert Streamlit shows).
   */
  refusals: "error" | "message";
  /** Shows `spec` in `host` through the surface's entry point, as Python sends it. */
  show(host: HTMLElement, spec: ChartSpec): Promise<Shown>;
}

/** A refusal as a surface reports it (see `Surface.refusals`). */
export type Reported = Pick<ChartErrorInfo, "message"> &
  Partial<Pick<ChartErrorInfo, "code" | "path">>;

/** A chart a surface shows, driven as its user and Python drive it. */
export interface Shown {
  /** The chart the surface made last. */
  chart(): Chart;
  /**
   * Reads at a pixel of the chart with the surface's gesture (the widget's
   * hover), and resolves with the inspection of the report it sent through
   * its own path; fails if it sent none.
   */
  readAt(at: Pair): Promise<InspectionPayload | null>;
  /**
   * Sends a change of chart options, as Python does to the chart it made,
   * and resolves with the chart shown after it; absent where the surface
   * takes none (a web fragment, until fragments take updates).
   */
  change?(options: Record<string, unknown>): Promise<Chart>;
  /**
   * Sends `refused` as the surface's next chart, as Python would, and then
   * the chart it showed again; resolves with the refusals the surface
   * reported of them through its own path, once the chart is back.
   */
  refuse(refused: ChartSpec): Promise<Reported[]>;
  /** Closes it as its host does; again, nothing. */
  close(): void;
}

/**
 * What both charts of a proof take besides SETTINGS: a theme of their own,
 * which Streamlit would otherwise take from the app.
 */
const OWN = { theme: "light" } as const;

/** Row `row`'s chart as Python sends it: its spec, at the size and with the tooltip of its reference. */
function sentOf(row: string): ChartSpec {
  return { ...specOf(row)!, ...SETTINGS, ...OWN } as ChartSpec;
}

/**
 * The row's spec with its mark in a panel the chart does not have (the
 * adapters' REFUSED option), and the error the engine refuses it with: the
 * spec's validator words it apart from the chart a program makes.
 */
function refusalOf(spec: ChartSpec): { refused: ChartSpec; error: ChartErrorInfo } {
  const [mark, ...rest] = spec.marks;
  const refused = { ...spec, marks: [{ ...mark, ...REFUSED.option } as MarkSpec, ...rest] };
  try {
    loadSpec(refused);
  } catch (error) {
    expect(error).toBeInstanceOf(ChartError);
    const { code, path, message } = error as ChartError;
    expect(path).toBe(REFUSED.path);
    return { refused, error: { code, path, message } as ChartErrorInfo };
  }
  throw new Error(`the engine draws a mark in panel "${REFUSED.option.panel}"`);
}

/** The middle of a chart's first plot. */
function middle(chart: Chart): Pair {
  const { x, y, width, height } = chart.getPanels()[0]!.plot;
  return [x + width / 2, y + height / 2];
}

/** Proves `surface`'s cell of each mark row: one contract test per row. */
export function proveIntegration(surface: Surface): void {
  const capability = `integration.${surface.name}`;
  // Rows whose marks the pointer reads nothing of (a rule, text): a report reads no point.
  const unread = new Set(
    cellsOf("reading.nearest").flatMap((c) => (c.state === "na" ? [c.row] : [])),
  );
  for (const cell of cellsOf(capability))
    contractTest(`${cell.row}.${capability}`, async () => {
      if (cell.state === "na") return proveAbsent(cell);
      if (cell.state !== "works") throw new Error(`${capability} is never ${cell.state}`);
      await proveWorks(surface, cell.row, unread.has(cell.row));
    });
}

/** A row the spec cannot write (a custom mark, a TypeScript function) has no chart to send. */
function proveAbsent({ row }: Cell) {
  expect(specOf(row)).toBeUndefined();
  expect(() => validateSpec({ marks: [{ type: row }] } as never)).toThrow(/^marks\[0\]\.type: /);
}

async function proveWorks(surface: Surface, row: string, unread: boolean) {
  const { reference, reading } = referenceOf(row);
  if (!reading && !unread) throw new Error(`rows.json gives ${row} no reading`);
  const spec = sentOf(row);
  const [mine, theirs] = [host(), host()];
  const drawn = reference(theirs, OWN);
  let shown: Shown | undefined;
  try {
    shown = await surface.show(mine, spec);
    const chart = shown.chart();
    await sameDrawing(chart, drawn);
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;

    // The datum under the pointer, as the surface reports it; none of a
    // mark the pointer reads nothing of.
    const read = await shown.readAt(reading ? reading.at(chart) : middle(chart));
    expect(firstPoint(read)).toEqual(reading?.point);

    // A change of options, on the chart it made: still the one in the host,
    // or one made in its place, the other let go of.
    if (shown.change) {
      const changed = await shown.change({ title: "Updated" });
      expect(mine.contains(changed.root), "the chart shown, in the host").toBe(true);
      if (surface.changes === "in place") expect(changed, "the chart it made").toBe(chart);
      else expect(chart.root.isConnected, "the chart it replaced").toBe(false);
      changed.render();
      expect(changed.root.textContent).toContain("Updated");
    }

    // A chart the engine refuses, reported as it refuses it, once.
    const { refused, error } = refusalOf(spec);
    const reported = await shown.refuse(refused);
    const { code, path, message } = error;
    const expected = surface.refusals === "error" ? { code, path, message } : { message };
    expect(reported).toEqual([expected]);

    // Closed, it leaves nothing.
    const { root } = shown.chart();
    expect(mine.contains(root), "the chart shown again, in the host").toBe(true);
    shown.close();
    expect(root.isConnected).toBe(false);
    expect(mine.childElementCount).toBe(0);
  } finally {
    shown?.close();
    drawn.destroy();
    mine.remove();
    theirs.remove();
  }
}
