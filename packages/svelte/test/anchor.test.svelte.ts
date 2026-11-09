import { type Chart as HercegChart, table } from "herceg";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anchors from "./Anchors.svelte";

let host: HTMLDivElement;
let mounted: Record<string, unknown> | undefined;

beforeEach(() => {
  host = document.createElement("div");
  host.style.width = "600px";
  document.body.append(host);
});

afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  flushSync();
  host.remove();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const metrics = table({ t: [0, 1, 2, 3], a: [1, 4, 2, 3] });

type Props = Parameters<typeof Anchors>[1];

/** <Anchors> with `props` as state the tests change; `chart` is bound. */
async function anchors(initial: Omit<Props, "data">) {
  const props = $state({ data: metrics, chart: null, ...initial }) as Props & {
    chart: HercegChart;
  };
  mounted = mount(Anchors, { target: host, props });
  flushSync();
  await settle(props.chart);
  return props;
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
  it("moves when a coordinate changes kind: a Date after its text", async () => {
    const when = new Date(1);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const props = await anchors({ shape: "point", x: when.toISOString() });
      const shown = () => host.querySelector("button")!.getBoundingClientRect().width > 0;
      expect(shown()).toBe(false);
      props.x = when;
      flushSync();
      await settle(props.chart);
      expect(shown()).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });

  it("renders its children, with the application's context, where the chart holds them", async () => {
    const props = await anchors({ shape: "point" });
    const { chart } = props;
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
    flushSync();
    expect(button().textContent).toBe("Peak ms 1");
    // New props move it from the next frame.
    props.x = 2;
    flushSync();
    await settle(chart);
    at(2);
    // Unmounted, it is gone; mounted again, it is held again.
    props.shown = false;
    flushSync();
    expect(host.querySelector("button")).toBeNull();
    props.shown = true;
    flushSync();
    await settle(chart);
    expect(chart.root.contains(button())).toBe(true);
  });

  it("anchors in the panel it is in, beside the chart's own", async () => {
    const { chart } = await anchors({ shape: "panels" });
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

  it("goes with its chart", async () => {
    await anchors({ shape: "point" });
    unmount(mounted!);
    mounted = undefined;
    flushSync();
    expect(host.querySelector("button")).toBeNull();
  });
});
