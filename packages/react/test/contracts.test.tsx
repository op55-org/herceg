// Proofs of the matrix's React integration (test/contracts/), one per row:
// the row's mark element in a <Chart> draws what the chart of its spec
// draws, reports the datum under the pointer and a refused option through
// its props, takes a new prop without a new chart, and leaves nothing when
// unmounted.

import type { Chart as HercegChart } from "herceg";
import type { ComponentType } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
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
import * as components from "../src/index.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("integration.react", () => {
  for (const cell of cellsOf("integration.react"))
    contractTest(`${cell.row}.integration.react`, async () => {
      if (cell.state !== "works") throw new Error(`integration.react is never ${cell.state}`);
      const { element, props, reference, reading } = integrationOf(cell.row, "react");
      const Mark = (components as unknown as Record<string, ComponentType<object>>)[element]!;
      const ref: { current: HercegChart | null } = { current: null };
      const hovers: (Inspection | undefined)[] = [];
      const errors: ChartError[] = [];
      const [mine, theirs] = [host(), host()];
      const root = createRoot(mine);
      const render = (options: object = {}, mark: object = {}) =>
        act(() =>
          root.render(
            <components.Chart
              ref={ref}
              {...SETTINGS}
              {...options}
              onHover={({ inspection }) => hovers.push(inspection)}
              onError={(error) => errors.push(error)}
            >
              <Mark {...props} {...mark} />
            </components.Chart>,
          ),
        );
      const drawn = reference(theirs);
      try {
        render();
        const chart = ref.current!;
        await sameDrawing(chart, drawn);
        // The datum under the pointer, through onHover.
        if (reading) {
          press(chart as never, "pointermove", reading.at(chart as never));
          await frame();
          expect(firstPoint(hovers.at(-1))).toEqual(reading.point);
        }
        // A new prop changes the chart it made.
        render({ title: "Updated" });
        expect(ref.current).toBe(chart);
        chart.render();
        expect(chart.root.textContent).toContain("Updated");
        // An option the chart refuses reaches onError.
        render({ title: "Updated" }, REFUSED.option);
        await expect.poll(() => errors.length).toBeGreaterThan(0);
        expect(errors[0]).toBeInstanceOf(ChartError);
        expect(errors[0]!.message).toContain(REFUSED.says);
        expect(errors[0]).toMatchObject({ path: REFUSED.path });
        // Unmounted, it leaves nothing.
        const { root: drawnRoot } = chart;
        act(() => root.unmount());
        expect(ref.current).toBeNull();
        expect(drawnRoot.isConnected).toBe(false);
        expect(mine.childElementCount).toBe(0);
      } finally {
        drawn.destroy();
        mine.remove();
        theirs.remove();
      }
    });
});
