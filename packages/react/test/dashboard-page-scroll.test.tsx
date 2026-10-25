// The dashboard in a page that scrolls, with real input as a person gives
// it (the tester's report): the vertical wheel over a chart scrolls the
// page and leaves the view, the wheel sideways pans without zooming, and a
// drag pans and selects no text of the page.

import { expect } from "vitest";
import { pageOrigin, realMouse } from "../../herceg/test/browser/helpers.ts";
import { contractTest } from "../../herceg/test/helpers/contracts.ts";
import { DAY, END } from "./fixtures/Dashboard.tsx";
import { cleanups, frame, middleOf, mountDashboard, panelOf } from "./fixtures/page.tsx";

/** Waits up to a second of frames for `done`, as a page scrolls after a wheel's event. */
async function until(done: () => boolean): Promise<void> {
  for (let frames = 0; frames < 60 && !done(); frames++) await frame();
}

contractTest("dashboard.page-scroll.react", async () => {
  // Text to select above the dashboard, and room below it to scroll into.
  const intro = document.createElement("p");
  intro.textContent = "Operations: load and requests over the last day.";
  document.body.prepend(intro);
  const room = document.createElement("div");
  room.style.height = "3000px";
  cleanups.push(() => intro.remove());
  const { overview, errors } = await mountDashboard();
  document.body.append(room);
  cleanups.push(() => room.remove());
  expect(errors).toEqual([]);
  const page = document.scrollingElement!;
  // The overview in view, its top 40 pixels down, the page scrolled some way.
  const show = async () => {
    page.scrollTop += overview.root.getBoundingClientRect().top - 40;
    await frame();
  };
  await show();
  const now = () => panelOf(overview, "now");
  const pointer = () => {
    const origin = pageOrigin(overview.root);
    const [x, y] = middleOf(now());
    return { x: origin.x + x, y: origin.y + y };
  };
  // The view the reader moves: the last day, till they move it.
  const view = () => overview.getViewport({ panel: "now" }).x;
  const top = page.scrollTop;
  await realMouse({ type: "move", ...pointer() });

  await realMouse({ type: "wheel", ...pointer(), deltaY: 120 });
  await until(() => page.scrollTop !== top);
  expect(page.scrollTop, "the vertical wheel scrolls the page").toBeGreaterThan(top);
  expect(view(), "and leaves the view").toBeNull();

  const scrolled = page.scrollTop;
  const sideways = async () => {
    const before = view();
    await realMouse({ type: "wheel", ...pointer(), deltaX: 120 });
    await until(() => view()?.[0] !== before?.[0]);
    const [lo, hi] = view() ?? [Number.NaN, Number.NaN];
    expect(lo, "the wheel sideways pans").toBeGreaterThan(before?.[0] ?? END - DAY);
    expect(hi - lo, "without zooming").toBeCloseTo(DAY, 0);
    return lo;
  };
  await sideways();
  const panned = await sideways();
  expect([page.scrollTop, page.scrollLeft], "and the page stays").toEqual([scrolled, 0]);

  // A drag from the plot over the axis' labels to the chart's title pans, and selects nothing.
  await show();
  const [from, origin] = [pointer(), pageOrigin(overview.root)];
  const to = { x: origin.x + 20, y: origin.y + 10 };
  await realMouse({ type: "press", ...from });
  for (const t of [0.25, 0.5, 0.75, 1])
    await realMouse({
      type: "move",
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    });
  await realMouse({ type: "release", ...to });
  await frame();
  expect(view()![0], "the drag pans").toBeGreaterThan(panned);
  expect(document.getSelection()?.toString(), "no text selected").toBe("");
});
