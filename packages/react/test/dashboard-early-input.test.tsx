// The dashboard's acceptance test of input before its code loads, and of
// cleanup (fixtures/Dashboard.tsx): in a page of its own, so that no chart
// before it loaded the code that answers input (its axes' compilers and the
// interaction controller, both still loading when the reader drags).

import { describe, expect } from "vitest";
import { contractTest } from "../../herceg/test/helpers/contracts.ts";
import { END, HOUR } from "./fixtures/Dashboard.tsx";
import {
  cleanups,
  crosshair,
  expectDragBeforeLoaded,
  frame,
  mountDashboard,
} from "./fixtures/page.tsx";

describe("dashboard", () => {
  contractTest("dashboard.early-input-cleanup.react", async () => {
    const mounted = await mountDashboard({ wait: false });
    const { overview, week, errors } = mounted;
    await expectDragBeforeLoaded(mounted);
    expect(errors).toEqual([]);
    // Unmounted, the charts leave nothing, and nothing they listened to reaches them.
    const roots = [overview.root, week.root];
    mounted.unmount();
    expect(roots.filter((root) => root.isConnected)).toEqual([]);
    expect(mounted.element.childElementCount).toBe(0);
    const thrown: unknown[] = [];
    const listen = (event: ErrorEvent) => thrown.push(event.error);
    window.addEventListener("error", listen);
    cleanups.push(() => window.removeEventListener("error", listen));
    mounted.data.telemetry.reset({
      t: mounted.data.telemetry.numbers("t"),
      load: mounted.data.telemetry.numbers("load"),
      requests: mounted.data.telemetry.numbers("requests"),
      estimated: mounted.data.telemetry.numbers("estimated"),
    } as never);
    mounted.data.picks.set("picked", null);
    // A chart left in the cursor group shows another's cursor without the ones that left.
    const other = await mountDashboard();
    other.week.showCursor({ x: END - 2 * HOUR });
    await frame();
    await frame();
    expect(crosshair(other.overview)).toBeDefined();
    expect(thrown).toEqual([]);
  });
});
