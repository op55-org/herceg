// <Custom> keeps its own custom mark while its props but `draw` and
// `pointText` are the same, calling the latest of those: a draw made from
// the state it reads keeps a transition playing.
import type { DataDrawContext, Chart as HercegChart } from "herceg";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectUntilGone } from "../../herceg/test/browser/helpers.ts";
import Flights from "./Flights.svelte";
import { type FlightSchema, flights, points } from "./flights.ts";
import Labels from "./Labels.svelte";
import Points from "./Points.svelte";

let host: HTMLDivElement;
let mounted: Record<string, unknown> | undefined;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:300px";
  document.body.append(host);
});

afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  flushSync();
  host.remove();
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const tick = (ms: number) => vi.advanceTimersByTime(ms);

/** Frames and the clock from here on are the test's, as in the engine's animation tests. */
async function controlTime(chart: HercegChart) {
  await frame();
  await frame();
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  chart.render();
  tick(16);
}

/** Each call of a draw: its reach past the ends, and each flight's end, by id. */
type Read = { past: number; ends: Record<string, number> };

/** Draws of flights from start to end, reaching `past` further, recording what they read. */
const drawingInto =
  (reads: Read[]) =>
  (past: number, _note: string) =>
  ({ table: rows, series, x, y, item, path }: DataDrawContext<FlightSchema>) => {
    const end = rows.numbers("end");
    const ends: Record<string, number> = {};
    for (const s of series)
      for (let k = 0; k < s.length; k++) {
        const row = s.rowAt(k);
        ends[rows.value("id", row) as string] = end[row]!;
        item(s, row, () =>
          path(`M${x(s.x[row]!)} ${y(s.y[row]!)}H${x(end[row]! + past)}`, { stroke: s.color }),
        );
      }
    reads.push({ past, ends });
  };

/** <Flights>, its props state the tests change; `chart` is bound. */
async function flying(reads: Read[], spread = false) {
  const props = $state({
    data: flights(),
    drawing: drawingInto(reads),
    past: 0,
    note: "on time",
    unit: "min",
    series: undefined as string | undefined,
    spread,
    duration: 320,
    onerror: undefined as (() => void) | undefined,
    chart: null as HercegChart | null,
  });
  mounted = mount(Flights, { target: host, props });
  flushSync();
  await props.chart!.loading;
  await controlTime(props.chart!);
  return props;
}

const labels = () =>
  [...host.querySelectorAll('[data-kind="shapes"] text')].map((t) => t.textContent);

describe("<Custom>", () => {
  it("keeps a transition playing through a new draw that draws alike", async () => {
    const reads: Read[] = [];
    const props = await flying(reads);
    props.data.replace(0, { end: [60, 70] });
    tick(160);
    expect(reads.at(-1)!.ends).toEqual({ a: 50, b: 60 });
    // The draw is made again, closing over a new note it does not draw.
    props.note = "late";
    flushSync();
    tick(16);
    expect(reads.at(-1)!.ends).toEqual({ a: 51, b: 61 });
    tick(400);
    expect(reads.at(-1)!.ends).toEqual({ a: 60, b: 70 });
  });

  it("shows a change of the draw's logic from the next frame, at rest and while values move", async () => {
    const reads: Read[] = [];
    const props = await flying(reads);
    props.past = 10;
    flushSync();
    tick(16);
    expect(reads.at(-1)!.past).toBe(10);
    props.data.replace(0, { end: [60, 70] });
    tick(160);
    props.past = 20;
    flushSync();
    tick(16);
    expect(reads.at(-1)).toEqual({ past: 20, ends: { a: 51, b: 61 } });
    tick(400);
    expect(reads.at(-1)).toEqual({ past: 20, ends: { a: 60, b: 70 } });
  });

  it("keeps a transition playing through a new pointText", async () => {
    const reads: Read[] = [];
    const props = await flying(reads);
    props.data.replace(0, { end: [60, 70] });
    tick(160);
    props.unit = "minutes";
    flushSync();
    tick(16);
    expect(reads.at(-1)!.ends).toEqual({ a: 51, b: 61 });
    tick(400);
    expect(reads.at(-1)!.ends).toEqual({ a: 60, b: 70 });
  });

  it("keeps a transition playing through a draw given in a spread of props", async () => {
    const reads: Read[] = [];
    const props = await flying(reads, true);
    props.data.replace(0, { end: [60, 70] });
    tick(160);
    props.note = "late";
    flushSync();
    tick(16);
    expect(reads.at(-1)!.ends).toEqual({ a: 51, b: 61 });
    props.past = 10;
    flushSync();
    tick(16);
    expect(reads.at(-1)).toEqual({ past: 10, ends: { a: 52, b: 62 } });
  });

  it("calls what the chart shows while its props are refused, and the latest draw once they are not", async () => {
    const reads: Read[] = [];
    const props = await flying(reads);
    props.data.replace(0, { end: [60, 70] });
    tick(160);
    // A series field the table lacks, and a new draw: the chart keeps the mark it had.
    props.series = "gate";
    props.past = 10;
    flushSync();
    tick(16);
    expect(reads.at(-1)!.past).toBe(0);
    props.series = undefined;
    flushSync();
    tick(16);
    expect(reads.at(-1)!.past).toBe(10);
    tick(400);
    expect(reads.at(-1)).toEqual({ past: 10, ends: { a: 60, b: 70 } });
  });

  it("calls what it called while the chart refuses an update, and the latest once it takes one", async () => {
    const reads: Read[] = [];
    const props = await flying(reads);
    // Told of a refusal, the application writes to the mark's table, which counts a revision.
    props.onerror = () => props.data.replace(1, { lane: [2] });
    flushSync();
    props.data.replace(0, { end: [60, 70] });
    tick(160);
    // A duration the chart refuses, and a new draw: it draws as it was.
    props.duration = -1;
    props.past = 10;
    flushSync();
    tick(16);
    expect(reads.at(-1)!.past).toBe(0);
    props.past = 20;
    flushSync();
    tick(16);
    expect(reads.at(-1)!.past).toBe(0);
    props.duration = 320;
    flushSync();
    tick(16);
    expect(reads.at(-1)!.past).toBe(20);
  });

  it("keeps each component's mark with it as identical marks move, and draws each one's changes", async () => {
    const props = $state({
      data: flights(),
      names: ["A", "B"],
      written: {} as Record<string, string>,
      chart: null as HercegChart | null,
    });
    mounted = mount(Labels, { target: host, props });
    flushSync();
    await frame();
    expect(labels()).toEqual(["A", "B"]);
    const names = async (next: string[]) => {
      props.names = next;
      flushSync();
      // The keyed each moves the components' anchors, which the chart hears of after a mutation.
      await Promise.resolve();
      flushSync();
      await frame();
      return labels();
    };
    expect(await names(["B", "A"])).toEqual(["B", "A"]);
    expect(await names(["A", "B"])).toEqual(["A", "B"]);
    expect(await names(["C", "A", "B"])).toEqual(["C", "A", "B"]);
    expect(await names(["C", "B"])).toEqual(["C", "B"]);
    // One component's draw changes: only its mark draws it.
    props.written = { B: "B2" };
    flushSync();
    await frame();
    expect(labels()).toEqual(["C", "B2"]);
    expect(await names(["B", "C"])).toEqual(["B2", "C"]);
  });

  it("calls the latest pointText, which a tooltip at rest shows from the next frame", async () => {
    const props = $state({ data: points(), unit: "req", chart: null as HercegChart | null });
    mounted = mount(Points, { target: host, props });
    flushSync();
    const chart = props.chart!;
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    const rect = chart.root.getBoundingClientRect();
    chart.root.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: rect.left + chart.toPixel(1, { axis: "x" })!,
        clientY: rect.top + chart.toPixel(3, { axis: "y" })!,
      }),
    );
    await frame();
    const box = () =>
      [...host.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')].find(
        (div) => div.style.display === "block",
      );
    expect(box()!.textContent).toContain("3 req");
    props.unit = "rps";
    flushSync();
    await frame();
    expect(box()!.textContent).toContain("3 rps");
  });

  it("lets go of the draws it no longer calls while the chart stays", async () => {
    const reads: Read[] = [];
    const made: WeakRef<object>[] = [];
    const draws = drawingInto(reads);
    const props = await flying(reads);
    props.drawing = (past, note) => {
      const draw = draws(past, note);
      made.push(new WeakRef(draw));
      return draw;
    };
    for (const past of [1, 2, 3]) {
      props.past = past;
      flushSync();
      tick(16);
    }
    expect(reads.at(-1)!.past).toBe(3);
    vi.useRealTimers();
    // The last is the mark's, and the component's.
    await collectUntilGone(made.slice(0, -1));
    expect(made.slice(0, -1).filter((ref) => ref.deref() !== undefined)).toEqual([]);
    expect(made.at(-1)!.deref()).toBeDefined();
  });

  it("drops its mark with the component, and with the chart on unmount", async () => {
    const props = $state({
      data: flights(),
      names: ["A"],
      written: { A: "one" } as Record<string, string>,
      shown: true,
      chart: null as HercegChart | null,
    });
    mounted = mount(Labels, { target: host, props });
    flushSync();
    await frame();
    expect(labels()).toEqual(["one"]);
    props.written = { A: "two" };
    flushSync();
    await frame();
    expect(labels()).toEqual(["two"]);
    props.shown = false;
    flushSync();
    await frame();
    expect(labels()).toEqual([]);
    props.shown = true;
    flushSync();
    await frame();
    expect(labels()).toEqual(["two"]);
    const chart = new WeakRef(props.chart!);
    unmount(mounted);
    mounted = undefined;
    flushSync();
    props.chart = null;
    await collectUntilGone([chart]);
    expect(chart.deref()).toBeUndefined();
  });
});
