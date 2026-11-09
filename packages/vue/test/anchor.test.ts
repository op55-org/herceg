import { type Chart as HercegChart, table } from "herceg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type App,
  type Component,
  createApp,
  createSSRApp,
  defineComponent,
  Fragment,
  h,
  inject,
  nextTick,
  provide,
  ref,
} from "vue";
import { renderToString } from "vue/server-renderer";
import { collectGarbage } from "../../herceg/test/browser/helpers.ts";
import { pathKey } from "../src/chart.ts";
import { Anchor, Chart, Line } from "../src/index.ts";
import { Columns, Panel } from "../src/layout.ts";

let host: HTMLDivElement;
let app: App | undefined;

beforeEach(() => {
  host = document.createElement("div");
  host.style.width = "600px";
  document.body.append(host);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  host.remove();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const metrics = table({ t: [0, 1, 2, 3], a: [1, 4, 2, 3] });

/** Mounts a template; `setup` returns what it reads, with `chart`, a ref to its <Chart>. */
async function mount(template: string, setup: () => object = () => ({})) {
  const chart = ref<{ chart: HercegChart | null } | null>(null);
  const Label = defineComponent({
    setup() {
      const clicks = ref(0);
      return { clicks, unit: inject("unit", "") };
    },
    template: `<button type="button" @click="clicks++">Peak {{ unit }} {{ clicks }}</button>`,
  });
  app = createApp(
    defineComponent({
      components: { Anchor, Chart, Columns, Label, Line, Panel },
      setup: () => {
        provide("unit", "ms");
        return { ...setup(), chart, metrics };
      },
      template,
    }),
  );
  app.mount(host);
  const made = chart.value!.chart!;
  await settle(made);
  return made;
}

async function settle(chart: HercegChart) {
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  await frame();
  await frame();
}

/** The middle of `element`'s bottom edge, from the chart's root. */
function bottomOf(chart: HercegChart, element: Element) {
  const root = chart.root.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  return { x: box.left - root.left + box.width / 2, y: box.bottom - root.top };
}

describe("<Anchor>", () => {
  it("teleports its slot, with the application's provides, to where the chart holds it", async () => {
    const x = ref(1);
    const shown = ref(true);
    const chart = await mount(
      `<Chart ref="chart">
        <Line :data="metrics" x="t" y="a" />
        <Anchor v-if="shown" :at="{ x, y: 4 }" side="top" :offset="8"><Label /></Anchor>
      </Chart>`,
      () => ({ x, shown }),
    );
    const button = () => host.querySelector("button")!;
    expect(button().textContent).toBe("Peak ms 0");
    expect(chart.root.contains(button())).toBe(true);
    const at = (value: number) => {
      const place = bottomOf(chart, button());
      expect(Math.abs(place.x - chart.toPixel(value, { axis: "x" })!)).toBeLessThanOrEqual(1);
      expect(Math.abs(place.y - (chart.toPixel(4, { axis: "y" })! - 8))).toBeLessThanOrEqual(1);
    };
    at(1);
    button().click();
    await nextTick();
    expect(button().textContent).toBe("Peak ms 1");
    // New props move it from the next frame.
    x.value = 2;
    await nextTick();
    await settle(chart);
    at(2);
    // Unmounted, it is gone; mounted again, it is held again.
    shown.value = false;
    await nextTick();
    expect(host.querySelector("button")).toBeNull();
    shown.value = true;
    await nextTick();
    await settle(chart);
    expect(chart.root.contains(button())).toBe(true);
  });

  it.each([
    ["alike", 'key="tag"', false],
    ["left out", "", false],
    ["alike, in a panel", 'key="tag"', true],
    ["left out, in a panel", "", true],
  ])("keeps each anchor's element through keyed fragments, its key %s", async (_, key, inPanel) => {
    const groups = ref(["a", "b"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const chart = await mount(
        `<Chart ref="chart">${inPanel ? '<Panel id="p">' : ""}
          <template v-for="group in groups" :key="group">
            <Line :data="metrics" x="t" y="a" />
            <Anchor ${key} :at="{ x: 1, y: 4 }"><i>{{ group }}</i></Anchor>
          </template>
        ${inPanel ? "</Panel>" : ""}</Chart>`,
        () => ({ groups }),
      );
      const b = [...host.querySelectorAll("i")].find((i) => i.textContent === "b");
      groups.value = ["b"];
      await nextTick();
      await settle(chart);
      expect([...host.querySelectorAll("i")].map((i) => i.textContent)).toEqual(["b"]);
      expect(host.querySelector("i")).toBe(b);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  const held = (key: string | number | symbol | undefined, text: string) =>
    h(Anchor, { ...(key === undefined ? {} : { key }), at: { x: 1, y: 4 } }, () => h("i", text));
  // Each case's first anchor is at place 1, after the line.
  const joined = (shown: boolean) => [
    shown ? h(Fragment, { key: "a" }, [held("b", "gone")]) : null,
    held("a/b", "kept"),
  ];
  const placed = (shown: boolean) => [shown ? held(undefined, "gone") : null, held(1, "kept")];
  const [first, second] = [Symbol(), Symbol()];
  const symbols = (shown: boolean) => [shown ? held(first, "gone") : null, held(second, "kept")];
  it.each([
    ["a fragment's key and its own joined", joined, false],
    ["a fragment's key and its own joined, in a panel", joined, true],
    ["a place and a key alike", placed, false],
    ["a place and a key alike, in a panel", placed, true],
    ["symbols", symbols, false],
    ["symbols, in a panel", symbols, true],
  ])("keeps each anchor's element where %s read as another's key", async (_, anchors, inPanel) => {
    const shown = ref(true);
    const chart = ref<{ chart: HercegChart | null } | null>(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      app = createApp(
        defineComponent({
          setup: () => () =>
            h(Chart, { ref: chart }, () => {
              const children = [
                h(Line as Component, { data: metrics, x: "t", y: "a" }),
                ...anchors(shown.value),
              ];
              return inPanel ? [h(Panel, { id: "p" }, () => children)] : children;
            }),
        }),
      );
      app.mount(host);
      await settle(chart.value!.chart!);
      const kept = [...host.querySelectorAll("i")].find((i) => i.textContent === "kept");
      shown.value = false;
      await nextTick();
      await settle(chart.value!.chart!);
      expect([...host.querySelectorAll("i")].map((i) => i.textContent)).toEqual(["kept"]);
      expect(host.querySelector("i")).toBe(kept);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("keys paths apart by kind, symbols by name or token, and lets go of symbols it keyed", async () => {
    const [a, b] = [Symbol("k"), Symbol("k")];
    expect(pathKey([a])).toBe(pathKey([a]));
    expect(pathKey([a])).not.toBe(pathKey([b]));
    expect(pathKey([Symbol.for("k")])).toBe(pathKey([Symbol.for("k")]));
    const keys = [[1], ["1"], [[1]], [Symbol.for("1")], ["p", ["x"]], ["p/x"]].map(pathKey);
    expect(new Set(keys).size).toBe(keys.length);
    const used = (() => {
      const key = Symbol();
      pathKey(["p", [key]]);
      return new WeakRef(key);
    })();
    await collectGarbage();
    expect(used.deref()).toBeUndefined();
  });

  it("moves when a coordinate changes kind: a Date after its text", async () => {
    const when = new Date(1);
    const x = ref<string | Date>(when.toISOString());
    const chart = await mount(
      `<Chart ref="chart" :on-error="() => {}">
        <Line :data="metrics" x="t" y="a" />
        <Anchor :at="{ x, y: 4 }"><i>held</i></Anchor>
      </Chart>`,
      () => ({ x }),
    );
    const shown = () => host.querySelector("i")!.getBoundingClientRect().width > 0;
    expect(shown()).toBe(false);
    x.value = when;
    await nextTick();
    await settle(chart);
    expect(shown()).toBe(true);
  });

  it("anchors in the panel it is in, beside the chart's own", async () => {
    const chart = await mount(
      `<Chart ref="chart">
        <Columns>
          <Panel id="a"><Line :data="metrics" x="t" y="a" /><Anchor :at="{ x: 1, y: 4 }"><i>a</i></Anchor></Panel>
          <Panel id="b"><Line :data="metrics" x="t" y="a" /><Anchor :at="{ x: 1, y: 4 }"><i>b</i></Anchor></Panel>
        </Columns>
        <Anchor :at="{ x: 2, y: 4 }" panel="b"><i>chart</i></Anchor>
      </Chart>`,
    );
    for (const [text, panel, x] of [
      ["a", "a", 1],
      ["b", "b", 1],
      ["chart", "b", 2],
    ] as const) {
      const shown = [...chart.root.querySelectorAll("i")].find((i) => i.textContent === text)!;
      const place = bottomOf(chart, shown.parentElement!);
      expect(Math.abs(place.x - chart.toPixel(x, { axis: "x", panel })!)).toBeLessThanOrEqual(1);
    }
  });

  it("goes with its chart, and renders nothing on the server", async () => {
    await mount(
      `<Chart ref="chart"><Line :data="metrics" x="t" y="a" /><Anchor :at="{ x: 1, y: 4 }"><i>held</i></Anchor></Chart>`,
    );
    app!.unmount();
    app = undefined;
    expect(host.querySelector("i")).toBeNull();
    const markup = await renderToString(
      createSSRApp(
        defineComponent({
          components: { Anchor, Chart, Line },
          setup: () => ({ metrics }),
          template: `<Chart><Line :data="metrics" x="t" y="a" /><Anchor :at="{ x: 1, y: 4 }"><i>held</i></Anchor></Chart>`,
        }),
      ),
    );
    expect(markup).not.toContain("held");
  });
});
