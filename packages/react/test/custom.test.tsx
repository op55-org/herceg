// <Custom> keeps one custom mark in its place while its props but `draw`
// and `pointText` are the same, calling the ones React committed last: an
// inline `draw` keeps a transition playing, and a render React discards
// changes nothing.
import { type DataDrawContext, type Chart as HercegChart, type Table, table } from "herceg";
import { act, StrictMode, Suspense, startTransition, use } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectGarbage } from "../../herceg/test/browser/helpers.ts";
import { Chart, Custom, Line } from "../src/index.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:300px";
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

/**
 * Frames and the clock from here on are the test's, as in the engine's
 * animation tests: time moves only with `tick`, so frames take no time.
 */
async function controlTime(chart: HercegChart) {
  await act(frame);
  await act(frame);
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  act(() => chart.render());
  tick(16);
}

const flights = () => table({ id: ["a", "b"], start: [0, 10], end: [40, 50], lane: [1, 2] });
type Flights = ReturnType<typeof flights>;
type FlightSchema = Flights extends Table<infer S> ? S : never;
/** Each call of a draw: its reach past the ends, and each flight's end, by id. */
type Read = { past: number; ends: Record<string, number> };

/** A draw of flights from start to end, reaching `past` further, recording what it reads. */
const drawing =
  (reads: Read[], past: number) =>
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

/** A chart of flights whose values move, its draw written inline. */
function Flying({
  data,
  reads,
  past = 0,
  duration = 320,
  onChart,
  onError,
}: {
  data: Flights;
  reads: Read[];
  past?: number;
  duration?: number;
  onChart: (chart: HercegChart | null) => void;
  onError?: () => void;
}) {
  return (
    <Chart
      ref={onChart}
      onError={onError}
      renderer="svg"
      animation={{ values: true, duration, easing: "linear" }}
      x={{ domain: [0, 100] }}
      y={{ domain: [0, 3] }}
    >
      <Custom
        data={data}
        x={["start", "end"]}
        y="lane"
        itemKey="id"
        draw={(context) => drawing(reads, past)(context)}
      />
    </Chart>
  );
}

describe("<Custom>", () => {
  it("keeps a transition playing through renders with an inline draw", async () => {
    const data = flights();
    const reads: Read[] = [];
    let chart: HercegChart | null = null;
    const onChart = (value: HercegChart | null) => {
      chart = value ?? chart;
    };
    act(() => root.render(<Flying data={data} reads={reads} onChart={onChart} />));
    await act(() => chart!.loading);
    await controlTime(chart!);
    act(() => data.replace(0, { end: [60, 70] }));
    tick(160);
    expect(reads.at(-1)!.ends).toEqual({ a: 50, b: 60 });
    // A render whose draw is new but draws alike: the values move on.
    act(() => root.render(<Flying data={data} reads={reads} onChart={onChart} />));
    tick(16);
    expect(reads.at(-1)!.ends).toEqual({ a: 51, b: 61 });
    tick(400);
    expect(reads.at(-1)!.ends).toEqual({ a: 60, b: 70 });
  });

  it("shows a change of the draw's logic from the next frame, at rest and while values move", async () => {
    const data = flights();
    const reads: Read[] = [];
    let chart: HercegChart | null = null;
    const onChart = (value: HercegChart | null) => {
      chart = value ?? chart;
    };
    const view = (past: number) => (
      <Flying data={data} reads={reads} past={past} onChart={onChart} />
    );
    act(() => root.render(view(0)));
    await act(() => chart!.loading);
    await controlTime(chart!);
    const reach = () => host.querySelector('[data-kind="shapes"] path')?.getAttribute("d");
    const before = reach();
    act(() => root.render(view(10)));
    tick(16);
    expect(reads.at(-1)!.past).toBe(10);
    expect(reach()).not.toBe(before);
    // While values move: the next frame draws as the new draw does, its values between.
    act(() => data.replace(0, { end: [60, 70] }));
    tick(160);
    act(() => root.render(view(20)));
    tick(16);
    expect(reads.at(-1)).toEqual({ past: 20, ends: { a: 51, b: 61 } });
    tick(400);
    // It ends as the last draw paints the new values.
    expect(reads.at(-1)).toEqual({ past: 20, ends: { a: 60, b: 70 } });
    const at = (value: number) => chart!.toPixel(value, { axis: "x" })!;
    expect(reach()).toContain(`H${at(80)}`);
  });

  it("calls what it called while the chart refuses an update, and the latest once it takes one", async () => {
    const data = flights();
    const reads: Read[] = [];
    let chart: HercegChart | null = null;
    const onChart = (value: HercegChart | null) => {
      chart = value ?? chart;
    };
    // Told of the refusal, the application writes to the mark's table, which counts a revision.
    const touch = () => data.replace(1, { lane: [2] });
    const view = (past: number, duration = 320) => (
      <Flying
        data={data}
        reads={reads}
        past={past}
        duration={duration}
        onChart={onChart}
        onError={touch}
      />
    );
    act(() => root.render(view(0)));
    await act(() => chart!.loading);
    await controlTime(chart!);
    act(() => data.replace(0, { end: [60, 70] }));
    tick(160);
    // A duration the chart refuses, and a new draw: it draws as it was.
    act(() => root.render(view(10, -1)));
    tick(16);
    expect(reads.at(-1)!.past).toBe(0);
    act(() => root.render(view(20, -1)));
    tick(16);
    expect(reads.at(-1)!.past).toBe(0);
    act(() => root.render(view(20)));
    tick(16);
    expect(reads.at(-1)!.past).toBe(20);
  });

  it("swaps the draws of identical marks that swap places, drawing both again", async () => {
    let chart: HercegChart | null = null;
    const label = (text: string) => (
      <Custom key={text} draw={({ text: write, x, y }) => write(x(1), y(2), text)} />
    );
    const labels = () =>
      [...host.querySelectorAll('[data-kind="shapes"] text')].map((t) => t.textContent);
    const metrics = table({ t: [0, 1, 2, 3], a: [1, 2, 3, 4] });
    const view = (order: string[]) => (
      <Chart
        ref={(value) => {
          chart = value ?? chart;
        }}
      >
        <Line data={metrics} x="t" y="a" />
        {order.map(label)}
      </Chart>
    );
    act(() => root.render(view(["A", "B"])));
    await act(frame);
    expect(labels()).toEqual(["A", "B"]);
    const revision = chart!.revision;
    act(() => root.render(view(["B", "A"])));
    await act(frame);
    expect(labels()).toEqual(["B", "A"]);
    // Each mark drew again; the chart's marks did not change.
    expect(chart!.revision).toBe(revision + 2);
  });

  it("is a new mark when a prop it was built with changed in place", async () => {
    const data = table({ a: [0, 1], b: [5, 6], c: [9, 9], v: [1, 2] });
    const starts: number[] = [];
    const ends: ["a" | "b", "c"] = ["a", "c"];
    const view = () => (
      <Chart x={{ domain: [0, 10] }} y={{ domain: [0, 3] }}>
        <Custom
          data={data}
          x={ends}
          y="v"
          draw={({ series }) => {
            starts.push(series[0]!.x[0]!);
          }}
        />
      </Chart>
    );
    act(() => root.render(view()));
    await act(frame);
    expect(starts.at(-1)).toBe(0);
    ends[0] = "b";
    act(() => root.render(view()));
    await act(frame);
    expect(starts.at(-1)).toBe(5);
  });

  it("installs nothing from a render React discards", async () => {
    let chart: HercegChart | null = null;
    const pending = new Promise<never>(() => {});
    function Waits({ wait }: { wait: boolean }) {
      if (wait) use(pending);
      return null;
    }
    const labels = () =>
      [...host.querySelectorAll('[data-kind="shapes"] text')].map((t) => t.textContent);
    function App({ name, wait }: { name: string; wait: boolean }) {
      return (
        <Suspense fallback={null}>
          <Chart
            ref={(value) => {
              chart = value ?? chart;
            }}
            x={{ domain: [0, 2] }}
            y={{ domain: [0, 3] }}
          >
            <Custom draw={({ text, x, y }) => text(x(1), y(2), name)} />
          </Chart>
          <Waits wait={wait} />
        </Suspense>
      );
    }
    act(() => root.render(<App name="one" wait={false} />));
    await act(frame);
    // The transition suspends, so React keeps showing render "one".
    act(() => startTransition(() => root.render(<App name="two" wait />)));
    act(() => chart!.render());
    expect(labels()).toEqual(["one"]);
  });

  it("keeps a transition playing in strict mode, whose renders and effects run twice", async () => {
    const data = flights();
    const reads: Read[] = [];
    let chart: HercegChart | null = null;
    const onChart = (value: HercegChart | null) => {
      chart = value ?? chart;
    };
    const view = (past: number) => (
      <StrictMode>
        <Flying data={data} reads={reads} past={past} onChart={onChart} />
      </StrictMode>
    );
    act(() => root.render(view(0)));
    await act(() => chart!.loading);
    await controlTime(chart!);
    act(() => data.replace(0, { end: [60, 70] }));
    tick(160);
    act(() => root.render(view(5)));
    tick(16);
    expect(reads.at(-1)).toEqual({ past: 5, ends: { a: 51, b: 61 } });
    tick(400);
    expect(reads.at(-1)).toEqual({ past: 5, ends: { a: 60, b: 70 } });
  });

  it("calls the latest pointText, which a tooltip at rest shows from the next frame", async () => {
    const data = table({ t: [0, 1, 2, 3], v: [1, 3, 2, 4] });
    let chart: HercegChart | null = null;
    const view = (unit: string) => (
      <Chart
        ref={(value) => {
          chart = value ?? chart;
        }}
        locale="en-US"
      >
        <Custom
          data={data}
          x="t"
          y="v"
          pointText={(row, format, s) => `${format.y(s.y[row]!)} ${unit}`}
          draw={({ series, circle, x, y }) => {
            for (const s of series)
              for (let k = 0; k < s.length; k++) circle(x(s.x[k]!), y(s.y[k]!), 3);
          }}
        />
      </Chart>
    );
    act(() => root.render(view("req")));
    for (let loading = chart!.loading; loading; loading = chart!.loading) await loading;
    const rect = chart!.root.getBoundingClientRect();
    await act(async () => {
      chart!.root.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: rect.left + chart!.toPixel(1, { axis: "x" })!,
          clientY: rect.top + chart!.toPixel(3, { axis: "y" })!,
        }),
      );
      await frame();
    });
    const box = () =>
      [...host.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')].find(
        (div) => div.style.display === "block",
      );
    expect(box()!.textContent).toContain("3 req");
    act(() => root.render(view("rps")));
    await act(frame);
    expect(box()!.textContent).toContain("3 rps");
  });

  it("drops its mark with the element, and with the chart on unmount", async () => {
    const data = flights();
    const reads: Read[] = [];
    let chart: HercegChart | null = null;
    const draws: WeakRef<object>[] = [];
    function App({ shown, past }: { shown: boolean; past: number }) {
      const draw = drawing(reads, past);
      draws.push(new WeakRef(draw));
      return (
        <Chart
          ref={(value) => {
            chart = value ?? chart;
          }}
          x={{ domain: [0, 100] }}
          y={{ domain: [0, 3] }}
        >
          <Line data={data} x="start" y="lane" />
          {shown && <Custom data={data} x={["start", "end"]} y="lane" draw={draw} />}
        </Chart>
      );
    }
    act(() => root.render(<App shown past={0} />));
    act(() => root.render(<App shown past={1} />));
    await act(frame);
    expect(reads.at(-1)!.past).toBe(1);
    act(() => root.render(<App shown={false} past={2} />));
    await act(frame);
    const count = reads.length;
    act(() => data.replace(0, { end: [45] }));
    act(() => chart!.render());
    expect(reads).toHaveLength(count);
    act(() => root.render(<App shown past={3} />));
    await act(frame);
    expect(reads.at(-1)!.past).toBe(3);
    act(() => root.unmount());
    root = createRoot(host);
    act(() => data.replace(0, { end: [50] }));
    await frame();
    expect(reads.at(-1)!.past).toBe(3);
    // What the marks called is let go of, the test's handle on the chart aside.
    chart = null;
    for (let i = 0; i < 3; i++) {
      await frame();
      await collectGarbage();
    }
    expect(draws.filter((ref) => ref.deref() !== undefined)).toEqual([]);
  });
});
