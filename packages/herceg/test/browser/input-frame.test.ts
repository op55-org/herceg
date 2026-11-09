// Input before drawing: each frame reads where the pointer is against the
// frame on screen, every chart's read before any listener runs, reports the
// hovers, then draws, so that what a hover listener changes is drawn in the
// frame of the move. Data changed since the frame on screen is read once a
// frame draws it, as before.

import "./interactive.ts";
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import type { Chart } from "../../src/dom/chart.ts";
import { line } from "../../src/marks/line.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { collectGarbage, modelOf } from "./helpers.ts";
import { frame, heard, key, mount, mountNow, pointer, within } from "./interaction/helpers.ts";

function data() {
  return table({
    t: Float64Array.from({ length: 10 }, (_, i) => i),
    a: Float64Array.from({ length: 10 }, (_, i) => i * 2),
  });
}

/** A line chart of its own data, loaded, with a hover listener (so picking loaded too). */
async function chartOf(rows = data(), options = {}) {
  const chart = await mount({ marks: [line(rows, { x: "t", y: "a" })], ...options });
  const hovers = heard(chart, "hover");
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  return { chart, rows, hovers };
}

/** Raises every value of `a` by `by`, as an application re-basing its lines would. */
function raise(rows: ReturnType<typeof data>, by: number) {
  rows.setColumn(
    "a",
    rows.numbers("a").map((v) => v + by),
  );
}

const centre = (chart: Chart) => within(chart, "", 0.5, 0.5);

describe("input before drawing", () => {
  it("draws what a hover listener changes in the frame of the move", async () => {
    const { chart, rows } = await chartOf();
    const renders = heard(chart, "render");
    let changed: number | undefined;
    chart.on("hover", () => {
      if (changed !== undefined) return;
      raise(rows, 1);
      changed = chart.revision;
    });
    pointer(chart, "pointermove", ...centre(chart));
    await frame();
    expect(changed).toBeDefined();
    expect(renders.at(-1)?.revision).toBe(changed);
    expect(chart.drawnRevision).toBe(changed);
  });

  it("reports a move with the frame on screen, then what changed under it once drawn", async () => {
    const { chart, rows, hovers } = await chartOf();
    const before = chart.revision;
    let raised = false;
    chart.on("hover", () => {
      if (raised) return;
      raised = true;
      raise(rows, 1);
    });
    const [x, y] = centre(chart);
    pointer(chart, "pointermove", x, y);
    await frame();
    // The move, as the frame on screen showed it; then the same pointer on the values drawn.
    expect(hovers.map(({ revision }) => revision)).toEqual([before, before + 1]);
    const [read, drawn] = hovers.map(({ inspection }) => inspection!.points[0]!.value);
    expect(drawn! - read!).toBe(1);
    expect(hovers.map(({ pointer }) => [pointer?.x, pointer?.y])).toEqual([
      [x, y],
      [x, y],
    ]);
  });

  it("reads every chart before any listener runs, a listener changing another chart", async () => {
    const one = await chartOf();
    const two = await chartOf();
    const twoRevision = two.chart.revision;
    const renders = heard(two.chart, "render");
    let changed: number | undefined;
    // The first chart read is the first heard: its listener changes the second.
    one.chart.on("hover", () => {
      if (changed !== undefined) return;
      raise(two.rows, 5);
      changed = two.chart.revision;
    });
    pointer(one.chart, "pointermove", ...centre(one.chart));
    pointer(two.chart, "pointermove", ...centre(two.chart));
    await frame();
    // The second chart's hover read what its frame on screen showed, before the change;
    // the change drew in the frame, and what it moved under the pointer was reported once drawn.
    expect(two.hovers.map(({ revision }) => revision)).toEqual([twoRevision, changed]);
    const [before, after] = two.hovers.map(({ inspection }) => inspection!.points[0]!.value);
    expect(after! - before!).toBe(5);
    expect(renders.map(({ revision }) => revision)).toEqual([changed]);
  });

  it("draws a chart a listener changes once, with the cursor its group shares", async () => {
    const sync = { cursor: "input-frame" };
    const one = await chartOf(data(), { interaction: { sync } });
    const two = await chartOf(data(), { interaction: { sync } });
    const renders = heard(two.chart, "render");
    let changed: number | undefined;
    one.chart.on("hover", ({ cause }) => {
      if (cause !== "pointer" || changed !== undefined) return;
      raise(two.rows, 1);
      changed = two.chart.revision;
    });
    pointer(one.chart, "pointermove", ...centre(one.chart));
    await frame();
    expect(renders.map(({ revision }) => revision)).toEqual([changed]);
    // The cursor shared is reported once drawn, on the values the listener drew.
    const synced = two.hovers.filter(({ cause }) => cause === "sync");
    expect(synced.map(({ revision }) => revision)).toEqual([changed]);
  });

  it("runs a listener that always changes what it reads once a frame, never in a loop", async () => {
    const { chart, rows } = await chartOf();
    const calls: number[] = [];
    let frames = 0;
    chart.on("hover", () => {
      calls.push(frames);
      raise(rows, 1);
    });
    pointer(chart, "pointermove", ...centre(chart));
    for (; frames < 4; frames++) await frame();
    // The move's frame: the move, then the values its change drew under the pointer; after
    // that, the change each call makes is drawn and reported in the next frame.
    expect(calls).toEqual([0, 0, 1, 2, 3]);
  });

  it("goes on with the frame when a listener destroys its own chart or another", async () => {
    const one = await chartOf();
    const two = await chartOf();
    const three = await chartOf();
    const renders = heard(three.chart, "render");
    one.chart.on("hover", () => {
      two.chart.destroy();
      one.chart.destroy();
      raise(three.rows, 1);
    });
    for (const { chart } of [one, two, three]) pointer(chart, "pointermove", ...centre(chart));
    await frame();
    // The second chart's hover, read with the others, is not reported once it is destroyed.
    expect(one.hovers).toHaveLength(1);
    expect(two.hovers).toHaveLength(0);
    expect(three.hovers).toHaveLength(2);
    expect(renders.map(({ revision }) => revision)).toEqual([three.chart.revision]);
    expect(one.chart.root.isConnected).toBe(false);
    expect(two.chart.root.isConnected).toBe(false);
  });

  it("draws a chart a listener makes in the frame", async () => {
    const { chart } = await chartOf();
    let made: Chart | undefined;
    chart.on("hover", () => {
      made ??= mountNow({ marks: [line(data(), { x: "t", y: "a" })] });
    });
    pointer(chart, "pointermove", ...centre(chart));
    await frame();
    expect(made?.drawnRevision).toBe(made?.revision);
  });

  it("reports in turn what a listener draws at once, the older hover first", async () => {
    const { chart, rows, hovers } = await chartOf();
    const before = chart.revision;
    let heardWhileDrawing: number | undefined;
    chart.on("hover", () => {
      if (heardWhileDrawing !== undefined) return;
      raise(rows, 1);
      // Drawn at once: its hover is reported once this one's listeners are done.
      chart.render();
      heardWhileDrawing = hovers.length;
    });
    pointer(chart, "pointermove", ...centre(chart));
    await frame();
    expect(heardWhileDrawing).toBe(1);
    expect(hovers.map(({ revision }) => revision)).toEqual([before, before + 1]);
  });

  it("reports the newer hover of a chart another chart's listener drew at once, not the older", async () => {
    const one = await chartOf();
    const two = await chartOf();
    let changed: number | undefined;
    one.chart.on("hover", () => {
      if (changed !== undefined) return;
      raise(two.rows, 1);
      changed = two.chart.revision;
      two.chart.render();
    });
    pointer(one.chart, "pointermove", ...centre(one.chart));
    pointer(two.chart, "pointermove", ...centre(two.chart));
    await frame();
    expect(two.hovers.map(({ revision }) => revision)).toEqual([changed]);
  });

  it("reads after the draw where data changed since the frame on screen", async () => {
    const { chart, rows, hovers } = await chartOf();
    const renders = heard(chart, "render");
    const seen: number[] = [];
    chart.on("hover", () => seen.push(renders.length));
    raise(rows, 3);
    const changed = chart.revision;
    pointer(chart, "pointermove", ...centre(chart));
    await frame();
    // Reported once the frame drawing the change was drawn, reading the new values.
    expect(seen).toEqual([0]);
    expect(hovers.map(({ revision }) => revision)).toEqual([changed]);
    expect(renders.map(({ revision }) => revision)).toEqual([changed]);
  });

  it("reports every move, margins included, and with inspection off, no inspection", async () => {
    const { chart, hovers } = await chartOf(data(), { inspection: false });
    const { plot } = chart.getPanels()[0]!;
    const places = [
      [plot.x + 10, plot.y + 10],
      [plot.x + 11, plot.y + 10],
      [plot.x - 20, plot.y + 10],
      [plot.x + 10, plot.y + plot.height + 12],
    ] as const;
    for (const [x, y] of places) {
      pointer(chart, "pointermove", x, y);
      await frame();
    }
    expect(hovers.map(({ pointer }) => [pointer?.x, pointer?.y])).toEqual(places);
    expect(hovers.map(({ pointer }) => pointer?.inPlot)).toEqual([true, true, false, false]);
    expect(hovers.every(({ pointer }) => pointer?.values.x !== undefined)).toBe(true);
    expect(hovers.every(({ inspection }) => inspection === undefined)).toBe(true);
    pointer(chart, "pointerleave", 0, 0);
    await frame();
    expect(hovers.at(-1)).toMatchObject({ pointer: undefined, target: undefined });
  });

  it("reports a pointer at rest again when the data under it changes", async () => {
    const { chart, rows, hovers } = await chartOf();
    pointer(chart, "pointermove", ...centre(chart));
    await frame();
    expect(hovers).toHaveLength(1);
    await frame();
    expect(hovers).toHaveLength(1);
    raise(rows, 2);
    await frame();
    expect(hovers).toHaveLength(2);
    expect(hovers[1]!.revision).toBe(chart.revision);
  });

  for (const away of ["leaves", "is no longer heard"] as const)
    it(`keeps no frame alive once the pointer that read it ${away}`, async () => {
      const big = () =>
        table({
          t: Float64Array.from({ length: 20_000 }, (_, i) => i),
          a: Float64Array.from({ length: 20_000 }, (_, i) => Math.sin(i)),
        });
      const chart = await mount({
        marks: [line(big(), { x: "t", y: "a" })],
        inspection: false,
        renderer: "canvas",
      });
      // Heard by a listener keeping no event: each holds its frame's panels.
      const stop = chart.on("hover", () => {});
      for (let loading = chart.loading; loading; loading = chart.loading) await loading;
      const old = new WeakRef(modelOf(chart).drawnMarks()[0]!.geometry[0]!);
      pointer(chart, "pointermove", 4, 4);
      await frame();
      if (away === "leaves") pointer(chart, "pointerleave", 4, 4);
      else stop();
      await frame();
      chart.update({ marks: [line(big(), { x: "t", y: "a" })] });
      for (let i = 0; i < 3; i++) {
        await frame();
        await collectGarbage();
      }
      expect(old.deref()).toBeUndefined();
    });

  it("reports what the pointer reads again once a gesture that hid it ends", async () => {
    const chart = await mount({
      marks: [point3d(table({ x: [0], y: [0], z: [0] }), { x: "x", y: "y", z: "z" })],
    });
    const hovers = heard(chart, "hover");
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    const model = modelOf(chart);
    const place = () => {
      const { px, py } = model.inspectItem(model.stepItem(undefined, 1)!)!.points[0]!;
      return [Math.round(px), Math.round(py)] as const;
    };
    const [x, y] = place();
    pointer(chart, "pointermove", x, y);
    await frame();
    expect(hovers.at(-1)?.inspection).toBeDefined();
    // Turning the chart, the pointer reads nothing; the point turns in place, under it.
    pointer(chart, "pointerdown", x, y);
    pointer(chart, "pointermove", x + 5, y);
    await frame();
    expect(hovers.at(-1)?.inspection).toBeUndefined();
    pointer(chart, "pointerup", x + 5, y);
    await frame();
    // A frame of the overlay alone reads it again.
    chart.hideCursor();
    await frame();
    expect(hovers.at(-1)?.inspection).toBeDefined();
  });

  it("reports the keyboard cursor's moves at once, before the next frame draws", async () => {
    const { chart, hovers } = await chartOf();
    chart.root.focus();
    key(chart, "ArrowRight");
    expect(hovers.at(-1)).toMatchObject({ cause: "keyboard" });
    const first = hovers.length;
    key(chart, "ArrowRight");
    expect(hovers.length).toBe(first + 1);
    await frame();
    expect(hovers.length).toBe(first + 1);
  });
});

describe("input before drawing, with the keyboard cursor", () => {
  /** The tooltip shown, if any. */
  const tooltipOf = (chart: Chart) =>
    [...chart.root.querySelectorAll<HTMLElement>(":scope > div[aria-hidden]")].find(
      (element) => element.style.display === "block",
    );
  /** The ring around the keyboard cursor's point, while shown. */
  const ring = (chart: Chart) => {
    const circle = [...chart.root.querySelectorAll("circle")].find(
      (c) => c.getAttribute("r") === "6.5" && c.getAttribute("visibility") === "visible",
    );
    return circle && Number(circle.getAttribute("cx"));
  };
  const said = (chart: Chart) => chart.root.querySelector("[aria-live]")!.textContent;
  const stream = () => table({ x: [0, 1, 2, 3, 4, 5, 6, 7], y: [0, 10, 20, 30, 40, 50, 60, 70] });

  it("keeps a resting cursor, its tooltip, and its hover on its row as a listener moves it", async () => {
    const rows = stream();
    const chart = await mount({ marks: [line(rows, { x: "x", y: "y" })] });
    const hovers = heard(chart, "hover");
    const renders = heard(chart, "render");
    chart.root.focus();
    key(chart, "ArrowRight");
    await frame();
    // A listener of the key's hover moves the cursor's row back one, as a stream does.
    let changed: number | undefined;
    chart.on("hover", ({ cause }) => {
      if (cause !== "keyboard" || changed !== undefined) return;
      rows.dropFirst(1);
      rows.append({ x: [8], y: [80] });
      changed = chart.revision;
    });
    key(chart, "End");
    expect(said(chart)).toBe("70 at 7");
    await frame();
    // The frame drawing the change shows the cursor on its row, as its hover says.
    expect(renders.at(-1)?.revision).toBe(changed);
    expect(tooltipOf(chart)?.textContent).toContain("70");
    expect(tooltipOf(chart)?.textContent).not.toContain("80");
    expect(ring(chart)).toBeCloseTo(chart.toPixel(7, { axis: "x" })!, 0);
    const last = hovers.at(-1)!;
    expect(last).toMatchObject({ cause: "keyboard", revision: changed });
    expect((last.target as { row?: number }).row).toBe(6);
    expect(last.inspection?.points[0]?.text).toBe("70");
    // The next key reports what the cursor was checked to be on.
    key(chart, "ArrowLeft");
    expect(said(chart)).toBe("60 at 6");
    expect((hovers.at(-1)!.target as { row?: number }).row).toBe(5);
    expect(hovers.at(-1)!.inspection?.points[0]?.text).toBe("60");
  });

  it("moves a cursor once in a frame where another chart's listener draws its chart at once", async () => {
    const rows = stream();
    const keyed = await mount({ marks: [line(rows, { x: "x", y: "y" })] });
    const renders = heard(keyed, "render");
    keyed.root.focus();
    key(keyed, "ArrowRight");
    key(keyed, "End");
    await frame();
    const { chart: other } = await chartOf();
    let changed: number | undefined;
    other.on("hover", () => {
      if (changed !== undefined) return;
      rows.dropFirst(1);
      changed = keyed.revision;
      keyed.render();
    });
    pointer(other, "pointermove", ...centre(other));
    await frame();
    expect(renders.map(({ revision }) => revision).at(-1)).toBe(changed);
    expect(renders.filter(({ revision }) => revision === changed)).toHaveLength(1);
    expect(tooltipOf(keyed)?.textContent).toContain("70");
    expect(ring(keyed)).toBeCloseTo(keyed.toPixel(7, { axis: "x" })!, 0);
    key(keyed, "ArrowLeft");
    expect(said(keyed)).toBe("60 at 6");
  });

  it("reports a cursor whose target went once as nothing, then cursors it is shown", async () => {
    const sync = { cursor: "input-frame-gone" };
    const rows = stream();
    const keyed = await mount({ marks: [line(rows, { x: "x", y: "y" })], interaction: { sync } });
    const hovers = heard(keyed, "hover");
    const { chart: other } = await chartOf(data(), { interaction: { sync } });
    keyed.root.focus();
    key(keyed, "ArrowRight");
    await frame();
    expect(hovers.at(-1)?.target).toBeDefined();
    // Its row dropped, the cursor is gone: one hover of nothing.
    rows.dropFirst(1);
    keyed.render();
    await frame();
    await frame();
    const empty = hovers.filter(({ target, inspection }) => !target && !inspection);
    expect(empty).toHaveLength(1);
    expect(hovers.at(-1)).toMatchObject({ cause: "keyboard", target: undefined });
    // Then cursors shown in it report as they do in any chart.
    keyed.showCursor({ x: 3 });
    await frame();
    expect(hovers.at(-1)).toMatchObject({ cause: "api", inspection: { value: 3 } });
    keyed.hideCursor();
    pointer(other, "pointermove", ...within(other, "", 0.5, 0.5));
    await frame();
    expect(hovers.at(-1)?.cause).toBe("sync");
    expect(hovers.at(-1)?.inspection).toBeDefined();
  });

  for (const [name, event] of [
    ["ArrowRight", "hover"],
    ["End", "hover"],
    ["Enter", "click"],
  ] as const)
    it(`is safe when a listener destroys the chart during ${name}'s report`, async () => {
      const chart = await mount({ marks: [line(stream(), { x: "x", y: "y" })] });
      const errors: unknown[] = [];
      const caught = (event: ErrorEvent) => errors.push(event.error);
      addEventListener("error", caught);
      try {
        chart.root.focus();
        key(chart, "ArrowRight");
        await frame();
        chart.on(event, ({ cause }) => {
          if (cause === "keyboard") chart.destroy();
        });
        key(chart, name);
        await frame();
        await frame();
      } finally {
        removeEventListener("error", caught);
      }
      expect(errors).toEqual([]);
      expect(chart.root.isConnected).toBe(false);
    });
});
