// Proofs of the matrix's Vue integration (test/contracts/), one per row:
// the row's mark component in a <Chart> draws what the chart of its spec
// draws, reports the datum under the pointer and a refused option through
// its hover and error events, takes a new prop without a new chart, and
// leaves nothing when unmounted.

import { describe, expect } from "vitest";
import { type Component, createApp, h, nextTick, shallowRef } from "vue";
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
import * as components from "../src/index.ts";

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("integration.vue", () => {
  for (const cell of cellsOf("integration.vue"))
    contractTest(`${cell.row}.integration.vue`, async () => {
      if (cell.state !== "works") throw new Error(`integration.vue is never ${cell.state}`);
      const { element, props, reference, reading } = integrationOf(cell.row, "vue");
      const Mark = (components as unknown as Record<string, Component>)[element]!;
      const view = shallowRef<InstanceType<typeof components.Chart> | null>(null);
      const given = shallowRef<{ chart: object; mark: object }>({ chart: {}, mark: {} });
      const hovers: (Inspection | undefined)[] = [];
      const errors: ChartError[] = [];
      const [mine, theirs] = [host(), host()];
      const app = createApp({
        render: () =>
          h(
            components.Chart,
            {
              ref: view,
              ...SETTINGS,
              ...given.value.chart,
              onHover: ({ inspection }: { inspection: Inspection | undefined }) =>
                hovers.push(inspection),
              onError: (error: ChartError) => errors.push(error),
            },
            () => [h(Mark, { ...props, ...given.value.mark })],
          ),
      });
      const drawn = reference(theirs);
      try {
        app.mount(mine);
        const chart = view.value!.chart!;
        await sameDrawing(chart, drawn);
        // The datum under the pointer, through the hover event.
        if (reading) {
          press(chart as never, "pointermove", reading.at(chart as never));
          await frame();
          expect(firstPoint(hovers.at(-1))).toEqual(reading.point);
        }
        // A new prop changes the chart it made.
        given.value = { chart: { title: "Updated" }, mark: {} };
        await nextTick();
        expect(view.value!.chart).toBe(chart);
        chart.render();
        expect(chart.root.textContent).toContain("Updated");
        // An option the chart refuses reaches the error event.
        given.value = { chart: { title: "Updated" }, mark: REFUSED.option };
        await nextTick();
        await expect.poll(() => errors.length).toBeGreaterThan(0);
        expect(errors[0]).toBeInstanceOf(ChartError);
        expect(errors[0]!.message).toContain(REFUSED.says);
        expect(errors[0]).toMatchObject({ path: REFUSED.path });
        // Unmounted, it leaves nothing.
        const { root } = chart;
        app.unmount();
        expect(root.isConnected).toBe(false);
        expect(mine.childElementCount).toBe(0);
      } finally {
        drawn.destroy();
        mine.remove();
        theirs.remove();
      }
    });
});
