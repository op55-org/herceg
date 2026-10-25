// The engine's proofs of the viewport events fixture
// (test/fixtures/viewport-events.json): every case's actions through a
// chart made from its spec, each making the events, refusals, and views
// the fixture lists. test/web/viewport-events.test.ts checks the fixture's
// shape.
import { afterEach, beforeEach, describe, expect } from "vitest";
import { encodedCategory } from "../../src/data/column.ts";
import type { Table } from "../../src/data/table.ts";
import { createChart } from "../../src/dom/chart.ts";
import type { ViewChange } from "../../src/model/model.ts";
import { loadSpec } from "../../src/spec/load.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import {
  restoreViewportState,
  type ViewportEventPayload,
  viewportEventPayload,
  viewportStatePayload,
} from "../../src/web/events.ts";
import fixture from "../fixtures/viewport-events.json";
import { contractTest } from "../helpers/contracts.ts";

type Range = [number, number] | null;

interface Action {
  do: "setViewport" | "getViewport" | "update" | "load" | "remount";
  view?: ViewChange;
  panel?: string;
  spec?: object;
  data?: object;
  events?: ViewportEventPayload[];
  error?: { code: string; path: string; panel?: string; message: string };
  returns?: { x: Range; y: Range; yRight: Range };
}

interface Case {
  contract: string;
  name: string;
  spec: object;
  actions: Action[];
}

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:640px;height:400px";
  document.body.append(host);
});

afterEach(() => host.remove());

const specOver = ({ spec }: Case, columns: object) =>
  ({ data: { data: { columns } }, ...spec }) as unknown as ChartSpec;

/** `table`'s columns as `rows` has them, in its kinds, for `Table.reset`. */
function columnsOf(table: Table, rows: Table): Parameters<Table["reset"]>[0] {
  const columns: Record<string, unknown> = {};
  for (const field of table.fields()) {
    if (table.kind(field) === "category") {
      const { codes, dictionary } = rows.categories(field);
      columns[field] = encodedCategory(codes, dictionary);
    } else columns[field] = rows.numbers(field);
  }
  return columns as Parameters<Table["reset"]>[0];
}

/**
 * The events `expected` lists, with placeholders the names of the
 * instances they stand for: bound at first sight, by `named`, to the
 * instance at their place in `actual`, one name of a scale's to one
 * placeholder.
 */
function resolved(
  expected: readonly ViewportEventPayload[],
  actual: readonly ViewportEventPayload[],
  named: Map<string, string>,
): ViewportEventPayload[] {
  return expected.map((event, i) => ({
    ...event,
    scales: event.scales.map((entry, j) => {
      const placeholder = `${entry.scale} ${entry.instance}`;
      let instance = named.get(placeholder);
      const seen = actual[i]?.scales[j];
      if (instance === undefined && seen?.scale === entry.scale) {
        const name = `${seen.scale} ${seen.instance}`;
        if (![...named.values()].includes(name)) {
          named.set(placeholder, name);
          instance = name;
        }
      }
      return { ...entry, instance: instance?.slice(entry.scale.length + 1) ?? entry.instance };
    }),
  }));
}

describe("the viewport events fixture, through charts", () => {
  for (const testCase of fixture.cases as Case[])
    contractTest(
      `${testCase.contract}.engine`,
      async () => {
        const heard: ViewportEventPayload[] = [];
        let mounted: Case = testCase;
        let data: object = fixture.data;
        const mount = () => {
          const loaded = loadSpec(specOver(mounted, data));
          const chart = createChart(host, { ...loaded.config, animation: false });
          chart.render();
          chart.on("viewport", (event) => heard.push(viewportEventPayload(event)));
          return { loaded, chart };
        };
        let { loaded, chart } = mount();
        const named = new Map<string, string>();
        for (const [step, action] of testCase.actions.entries()) {
          const at = `action ${step} (${action.do})`;
          heard.length = 0;
          const target = action.panel === undefined ? {} : { panel: action.panel };
          if (action.do === "getViewport") {
            expect(chart.getViewport(target), at).toEqual(action.returns);
            continue;
          }
          if (action.do === "setViewport") {
            const set = () => chart.setViewport(action.view!, target);
            if (action.error) {
              const before = chart.getPanels().map(({ key }) => chart.getViewport({ panel: key }));
              expect(set, at).toThrow(expect.objectContaining(action.error));
              expect(heard, at).toEqual([]);
              const after = chart.getPanels().map(({ key }) => chart.getViewport({ panel: key }));
              expect(after, `${at}: a refusal changes nothing`).toEqual(before);
              continue;
            }
            set();
          } else if (action.do === "remount") {
            // Another chart in its place, given the state of the one before.
            const state = viewportStatePayload(chart);
            chart.destroy();
            mounted = { ...mounted, spec: action.spec ?? mounted.spec };
            data = action.data ?? data;
            ({ loaded, chart } = mount());
            heard.length = 0;
            named.clear();
            const restored = await restoreViewportState(chart, state);
            expect(restored, at).toEqual(viewportStatePayload(chart));
          } else {
            data = action.data!;
            const next = loadSpec(specOver(mounted, data));
            if (action.do === "load") chart.update({ ...next.config, animation: false });
            else {
              const table = loaded.tables.get("data")!;
              table.reset(columnsOf(table, next.tables.get("data")!));
            }
            // Their events are the next frame's.
            expect(heard, at).toEqual([]);
          }
          chart.render();
          expect(heard, at).toEqual(resolved(action.events!, heard, named));
        }
        chart.destroy();
      },
      testCase.name,
    );
});
