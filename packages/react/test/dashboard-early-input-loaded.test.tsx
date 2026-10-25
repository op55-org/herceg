// The dashboard's acceptance test of input before its axes' code loads, on
// a page where another chart has already loaded the code that answers input
// (fixtures/Dashboard.tsx): in a page of its own, so that only that chart
// loaded any code before the dashboard.

import { table } from "herceg";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect } from "vitest";
import type { Chart as HercegChart } from "../../herceg/src/dom/handle.ts";
import { contractTest } from "../../herceg/test/helpers/contracts.ts";
import { Chart, Line } from "../src/index.ts";
import { cleanups, expectDragBeforeLoaded, host, mountDashboard } from "./fixtures/page.tsx";

describe("dashboard", () => {
  contractTest("dashboard.early-input-loaded.react", async () => {
    // A plain line chart, answering input, without the overview's axis layers, bars, or text.
    const ref: { current: HercegChart | null } = { current: null };
    const root = createRoot(host());
    act(() =>
      root.render(
        <Chart ref={ref} height={200}>
          <Line data={table({ x: [0, 1, 2], y: [3, 1, 2] })} x="x" y="y" />
        </Chart>,
      ),
    );
    cleanups.push(() => act(() => root.unmount()));
    await ref.current!.loading;
    const mounted = await mountDashboard({ wait: false });
    await expectDragBeforeLoaded(mounted);
    expect(mounted.errors).toEqual([]);
  });
});
