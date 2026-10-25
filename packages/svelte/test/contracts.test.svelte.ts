// Proofs of the matrix's Svelte integration (test/contracts/), one per row:
// the row's mark component in a <Chart> draws what the chart of its spec
// draws, reports the datum under the pointer and a refused option through
// its onhover and onerror props, takes a new prop without a new chart, and
// leaves nothing when unmounted.

import type { Chart as HercegChart } from "herceg";
import { flushSync, mount, unmount } from "svelte";
import { describe, expect } from "vitest";
import type { Inspection } from "../../herceg/src/model/inspect.ts";
import { ChartError } from "../../herceg/src/spec/errors.ts";
import {
  firstPoint,
  host,
  integrationOf,
  REFUSED,
  SETTINGS,
} from "../../herceg/test/browser/contracts/integration.ts";
import { press } from "../../herceg/test/browser/contracts/pointer.ts";
import { cellsOf } from "../../herceg/test/contracts/matrix.ts";
import { contractTest } from "../../herceg/test/helpers/contracts.ts";
import { sameDrawing } from "../../herceg/test/helpers/surfaces.ts";
import Matrix from "./Matrix.svelte";

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("integration.svelte", () => {
  for (const cell of cellsOf("integration.svelte"))
    contractTest(`${cell.row}.integration.svelte`, async () => {
      if (cell.state !== "works") throw new Error(`integration.svelte is never ${cell.state}`);
      const { element, props, reference, reading } = integrationOf(cell.row, "svelte");
      const hovers: (Inspection | undefined)[] = [];
      const errors: ChartError[] = [];
      const given = $state<{
        chart: HercegChart | null;
        options: Record<string, unknown>;
        mark: Record<string, unknown>;
      }>({ chart: null, options: { ...SETTINGS }, mark: {} });
      const [mine, theirs] = [host(), host()];
      const drawn = reference(theirs);
      const mounted = mount(Matrix, {
        target: mine,
        props: {
          get chart() {
            return given.chart;
          },
          set chart(value) {
            given.chart = value;
          },
          get options() {
            return given.options;
          },
          get mark() {
            return given.mark;
          },
          element,
          props,
          onhover: ({ inspection }) => hovers.push(inspection),
          onerror: (error) => errors.push(error),
        },
      });
      try {
        flushSync();
        const chart = given.chart!;
        await sameDrawing(chart, drawn);
        // The datum under the pointer, through onhover.
        if (reading) {
          press(chart as never, "pointermove", reading.at(chart as never));
          await frame();
          expect(firstPoint(hovers.at(-1))).toEqual(reading.point);
        }
        // A new prop changes the chart it made.
        given.options = { ...SETTINGS, title: "Updated" };
        flushSync();
        expect(given.chart).toBe(chart);
        chart.render();
        expect(chart.root.textContent).toContain("Updated");
        // An option the chart refuses reaches onerror.
        given.mark = REFUSED.option;
        flushSync();
        await expect.poll(() => errors.length).toBeGreaterThan(0);
        expect(errors[0]).toBeInstanceOf(ChartError);
        expect(errors[0]!.message).toContain(REFUSED.says);
        expect(errors[0]).toMatchObject({ path: REFUSED.path });
        // Unmounted, it leaves nothing.
        const { root } = chart;
        unmount(mounted);
        flushSync();
        expect(root.isConnected).toBe(false);
        expect(mine.childElementCount).toBe(0);
      } finally {
        drawn.destroy();
        mine.remove();
        theirs.remove();
      }
    });
});
