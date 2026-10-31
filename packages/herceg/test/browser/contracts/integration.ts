// What the adapters' proofs of the matrix's integration share (packages/
// react, vue, and svelte, test/contracts.test.*): a row's mark as their
// elements write it, the chart a spec makes of it to draw the same, and
// what the pointer reads of it.

import marks from "../../../../../test/contracts/marks.json";
import type { Table } from "../../../src/data/table.ts";
import { type Chart, createChart } from "../../../src/dom/chart.ts";
import type { Inspection } from "../../../src/model/inspect.ts";
import { defaultsOf, fixtureOf, loadedOf, MADE_OPTIONS, markOf } from "../../contracts/matrix.ts";
import { dateTimes } from "../helpers.ts";
import { type Item, itemAt, type Pair, pixels } from "./pointer.ts";

export type Adapter = "react" | "vue" | "svelte";

/**
 * Chart settings both charts of a proof take: the matrix's locale and time
 * zone, 400 px high, and the tooltip of the one nearest datum (rows.json's
 * `reading.points`).
 */
export const SETTINGS = {
  locale: "en-US",
  timeZone: "UTC",
  height: 400,
  inspection: { mode: "nearest" },
} as const;

/** A mark option every row refuses, where, and the end of the message it is refused with. */
export const REFUSED = {
  option: { panel: "nowhere" },
  path: "marks[0].panel",
  says: "panel: the chart has no panels; drop it",
};

export interface Integration {
  /** The element's name in the adapter (marks.json's inventory). */
  element: string;
  /** Its props: the mark's options as the spec spells them, its tables in place of their names. */
  props: Record<string, unknown>;
  /** The chart the spec makes of the row, in `host` (600 px wide), with SETTINGS. */
  reference(host: HTMLElement): Chart;
  /** Where the pointer reads a datum of the row, and the point it reads; undefined where it reads none. */
  reading: { at(chart: Chart): Pair; point: [string, number | null, string] } | undefined;
}

export function integrationOf(row: string, adapter: Adapter): Integration {
  const element = (marks.rows as Record<string, { inventory: Record<Adapter, string> }>)[row]!
    .inventory[adapter];
  const { table, mark } = fixtureOf(row) as { table: string; mark?: Record<string, unknown> };
  const { config, tables } = loadedOf({ marks: [markOf(row)] });
  const { type: _, ...options } = (mark ?? MADE_OPTIONS[row]!) as Record<string, unknown>;
  const props: Record<string, unknown> = { ...options, data: tables.get(table) as Table };
  // A network names its nodes' table, which elements take as a table.
  if (typeof props.nodes === "string") props.nodes = tables.get(props.nodes);
  const { read } = defaultsOf(table) as { read?: Pair };
  const reading = { ...(read && { at: read }), ...fixtureOf(row).reading } as {
    at?: Pair | Item;
    points?: [string, number | null, string][];
  };
  return {
    element,
    props,
    reference: (host) => createChart(host, { ...config, ...SETTINGS }),
    reading:
      reading.points && reading.at
        ? {
            at: (chart) =>
              Array.isArray(reading.at) ? pixels(chart, reading.at) : itemAt(chart, reading.at!).at,
            point: reading.points[0]!,
          }
        : undefined,
  };
}

/** The first point an inspection reads, as rows.json writes it. */
export function firstPoint(inspection: Inspection | undefined) {
  const point = inspection?.points[0];
  return point && [dateTimes(point.label), point.row ?? null, dateTimes(point.text)];
}

/** A host 600 px wide at the end of the page. */
export function host(): HTMLDivElement {
  const element = document.createElement("div");
  element.style.width = "600px";
  document.body.append(element);
  return element;
}
