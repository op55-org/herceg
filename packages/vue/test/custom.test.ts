// <Custom> keeps one custom mark in its place while its props but `draw`
// and `pointText` are the same, calling the ones of the last render: an
// inline `draw` keeps a transition playing.
import {
  type DataDrawContext,
  type Chart as HercegChart,
  type Schema,
  type Table,
  table,
} from "herceg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type App,
  computed,
  createApp,
  defineComponent,
  nextTick,
  reactive,
  ref,
  shallowRef,
} from "vue";
import { collectGarbage } from "../../herceg/test/browser/helpers.ts";
import { Chart, Custom, Line } from "../src/index.ts";

let host: HTMLDivElement;
let app: App | undefined;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:300px";
  document.body.append(host);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  host.remove();
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const tick = (ms: number) => vi.advanceTimersByTime(ms);

function mount(template: string, setup: () => object): App {
  app = createApp(defineComponent({ components: { Chart, Custom, Line }, setup, template }));
  app.mount(host);
  return app;
}

/** Frames and the clock from here on are the test's, as in the engine's animation tests. */
async function controlTime(chart: HercegChart) {
  await frame();
  await frame();
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  chart.render();
  tick(16);
}

const flights = () => table({ id: ["a", "b"], start: [0, 10], end: [40, 50], lane: [1, 2] });
type FlightSchema = ReturnType<typeof flights> extends Table<infer S> ? S : never;
/** Each call of a draw: its reach past the ends, and each flight's end, by id. */
type Read = { past: number; ends: Record<string, number> };

/**
 * A draw of flights from start to end, reaching `past` further, recording
 * what it reads; `_note` is closed over, not drawn.
 */
const drawing =
  (reads: Read[], past: number, _note?: string) =>
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

/**
 * A chart of flights whose values move, its draw made as the chart
 * renders, reading `past` and `note` then: a change of either renders the
 * chart's slot again.
 */
const FLYING = `<Chart ref="view" renderer="svg" @error="touch"
    :animation="{ values: true, duration, easing: 'linear' }"
    :x="{ domain: [0, 100] }" :y="{ domain: [0, 3] }">
  <Custom :data="data" :x="['start', 'end']" y="lane" item-key="id"
    :draw="drawing(reads, past, note)" />
</Chart>`;

function flying(data: ReturnType<typeof flights>, reads: Read[]) {
  const view = shallowRef<InstanceType<typeof Chart> | null>(null);
  const note = ref("on time");
  const past = ref(0);
  const duration = ref(320);
  // Told of a refusal, the application writes to the mark's table, which counts a revision.
  const touch = () => data.replace(1, { lane: [2] });
  mount(FLYING, () => ({ view, note, past, duration, data, reads, drawing, touch }));
  return { chart: () => view.value!.chart!, note, past, duration };
}

describe("<Custom>", () => {
  it("keeps a transition playing through renders with an inline draw", async () => {
    const data = flights();
    const reads: Read[] = [];
    const { chart, note } = flying(data, reads);
    await chart().loading;
    await controlTime(chart());
    data.replace(0, { end: [60, 70] });
    tick(160);
    expect(reads.at(-1)!.ends).toEqual({ a: 50, b: 60 });
    // A render whose draw is new but draws alike: the values move on.
    note.value = "late";
    await nextTick();
    tick(16);
    expect(reads.at(-1)!.ends).toEqual({ a: 51, b: 61 });
    tick(400);
    expect(reads.at(-1)!.ends).toEqual({ a: 60, b: 70 });
  });

  it("shows a change of the draw's logic from the next frame, at rest and while values move", async () => {
    const data = flights();
    const reads: Read[] = [];
    const { chart, past } = flying(data, reads);
    await chart().loading;
    await controlTime(chart());
    past.value = 10;
    await nextTick();
    tick(16);
    expect(reads.at(-1)!.past).toBe(10);
    data.replace(0, { end: [60, 70] });
    tick(160);
    past.value = 20;
    await nextTick();
    tick(16);
    expect(reads.at(-1)).toEqual({ past: 20, ends: { a: 51, b: 61 } });
    tick(400);
    expect(reads.at(-1)).toEqual({ past: 20, ends: { a: 60, b: 70 } });
  });

  it("calls what it called while the chart refuses an update, and the latest once it takes one", async () => {
    const data = flights();
    const reads: Read[] = [];
    const { chart, past, duration } = flying(data, reads);
    await chart().loading;
    await controlTime(chart());
    data.replace(0, { end: [60, 70] });
    tick(160);
    // A duration the chart refuses, and a new draw: it draws as it was.
    duration.value = -1;
    past.value = 10;
    await nextTick();
    tick(16);
    expect(reads.at(-1)!.past).toBe(0);
    past.value = 20;
    await nextTick();
    tick(16);
    expect(reads.at(-1)!.past).toBe(0);
    duration.value = 320;
    await nextTick();
    tick(16);
    expect(reads.at(-1)!.past).toBe(20);
  });

  it("draws again for a draw a computed returns, which reads the state it needs", async () => {
    const labels = () =>
      [...host.querySelectorAll('[data-kind="shapes"] text')].map((t) => t.textContent);
    const label = ref("first");
    const draw = computed(() => {
      const text = label.value;
      return ({ text: write, x, y }: DataDrawContext<FlightSchema>) => write(x(1), y(2), text);
    });
    mount(
      `<Chart :x="{ domain: [0, 2] }" :y="{ domain: [0, 3] }"><Custom :draw="draw" /></Chart>`,
      () => ({
        draw,
      }),
    );
    await frame();
    expect(labels()).toEqual(["first"]);
    label.value = "second";
    await nextTick();
    await frame();
    expect(labels()).toEqual(["second"]);
  });

  it("swaps the draws of identical marks that swap places, drawing both again", async () => {
    const view = shallowRef<InstanceType<typeof Chart> | null>(null);
    const order = ref(["A", "B"]);
    const metrics = table({ t: [0, 1, 2, 3], a: [1, 2, 3, 4] });
    const labels = () =>
      [...host.querySelectorAll('[data-kind="shapes"] text')].map((t) => t.textContent);
    mount(
      `<Chart ref="view">
        <Line :data="metrics" x="t" y="a" />
        <Custom v-for="name in order" :key="name" :draw="({ text, x, y }) => text(x(1), y(2), name)" />
      </Chart>`,
      () => ({ view, order, metrics }),
    );
    await frame();
    expect(labels()).toEqual(["A", "B"]);
    const revision = view.value!.chart!.revision;
    order.value = ["B", "A"];
    await nextTick();
    await frame();
    expect(labels()).toEqual(["B", "A"]);
    // Each mark drew again; the chart's marks did not change.
    expect(view.value!.chart!.revision).toBe(revision + 2);
  });

  it("is a new mark when a prop it was built with changed in place", async () => {
    const data = table({ a: [0, 1], b: [5, 6], c: [9, 9], v: [1, 2] });
    const starts: number[] = [];
    const ends = reactive(["a", "c"]);
    const draw = ({ series }: DataDrawContext<Schema>) => {
      starts.push(series[0]!.x[0]!);
    };
    mount(
      `<Chart :x="{ domain: [0, 10] }" :y="{ domain: [0, 3] }">
        <Custom :data="data" :x="ends" y="v" :draw="draw" />
      </Chart>`,
      () => ({ data, ends, draw }),
    );
    await frame();
    expect(starts.at(-1)).toBe(0);
    ends[0] = "b";
    await nextTick();
    await frame();
    expect(starts.at(-1)).toBe(5);
  });

  it("drops its mark with the component, and with the chart on unmount", async () => {
    const data = flights();
    const reads: Read[] = [];
    const view = shallowRef<InstanceType<typeof Chart> | null>(null);
    const shown = ref(true);
    const past = ref(0);
    const draws: WeakRef<object>[] = [];
    const draw = computed(() => {
      const made = drawing(reads, past.value);
      draws.push(new WeakRef(made));
      return made;
    });
    mount(
      `<Chart ref="view" :x="{ domain: [0, 100] }" :y="{ domain: [0, 3] }">
        <Line :data="data" x="start" y="lane" />
        <Custom v-if="shown" :data="data" :x="['start', 'end']" y="lane" :draw="draw" />
      </Chart>`,
      () => ({ view, shown, data, draw }),
    );
    past.value = 1;
    await nextTick();
    await frame();
    expect(reads.at(-1)!.past).toBe(1);
    shown.value = false;
    await nextTick();
    await frame();
    const count = reads.length;
    data.replace(0, { end: [45] });
    view.value!.chart!.render();
    expect(reads).toHaveLength(count);
    shown.value = true;
    past.value = 3;
    await nextTick();
    await frame();
    expect(reads.at(-1)!.past).toBe(3);
    app!.unmount();
    app = undefined;
    data.replace(0, { end: [50] });
    await frame();
    expect(reads.at(-1)!.past).toBe(3);
    // What the marks called is let go of, the computed's last aside. A
    // collection may leave some for the next one, under load especially;
    // nothing derefs them in between, which would keep them a while.
    for (let i = 0; i < 10; i++) {
      await frame();
      await collectGarbage();
    }
    expect(draws.slice(0, -1).filter((ref) => ref.deref() !== undefined)).toEqual([]);
  });
});
