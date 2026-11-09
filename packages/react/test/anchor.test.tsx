import { type Chart as HercegChart, table } from "herceg";
import { act, createContext, Fragment, StrictMode, useContext, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Anchor, Bar, Chart, Line } from "../src/index.ts";
import { Columns, Panel } from "../src/layout.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px";
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const metrics = table({ t: [0, 1, 2, 3], a: [1, 4, 2, 3] });

/** Waits for what the chart loads and the frames after it. */
async function settle(chart: HercegChart) {
  await act(async () => {
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    await frame();
    await frame();
  });
}

/** The middle of `element`'s bottom edge, from the chart's root. */
function bottomOf(chart: HercegChart, element: Element) {
  const root = chart.root.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  return { x: box.left - root.left + box.width / 2, y: box.bottom - root.top };
}

describe("<Anchor>", () => {
  it("renders its children with the application's context where the chart holds them", async () => {
    const Unit = createContext("");
    function Label() {
      const [clicks, setClicks] = useState(0);
      return (
        <button type="button" onClick={() => setClicks(clicks + 1)}>
          {`Peak ${useContext(Unit)} ${clicks}`}
        </button>
      );
    }
    const ref: { current: HercegChart | null } = { current: null };
    const draw = (x: number) =>
      act(() =>
        root.render(
          <Unit value="ms">
            <Chart ref={ref}>
              <Line data={metrics} x="t" y="a" />
              <Anchor at={{ x, y: 4 }} side="top" offset={8}>
                <Label />
              </Anchor>
            </Chart>
          </Unit>,
        ),
      );
    draw(1);
    const chart = ref.current!;
    await settle(chart);
    const button = host.querySelector("button")!;
    expect(button.textContent).toBe("Peak ms 0");
    expect(chart.root.contains(button)).toBe(true);
    const at = (x: number) => {
      const place = bottomOf(chart, button);
      expect(Math.abs(place.x - chart.toPixel(x, { axis: "x" })!)).toBeLessThanOrEqual(1);
      expect(Math.abs(place.y - (chart.toPixel(4, { axis: "y" })! - 8))).toBeLessThanOrEqual(1);
    };
    at(1);
    // Its state is React's: a click renders it again in place.
    act(() => button.click());
    expect(host.querySelector("button")!.textContent).toBe("Peak ms 1");
    // New props move it from the next frame.
    draw(2);
    await settle(chart);
    at(2);
  });

  it("removes what it holds once unmounted, and anchors again once mounted", async () => {
    const ref: { current: HercegChart | null } = { current: null };
    const draw = (shown: boolean) =>
      act(() =>
        root.render(
          <Chart ref={ref}>
            <Line data={metrics} x="t" y="a" />
            {shown && (
              <Anchor at={{ x: 1, y: 4 }}>
                <i>held</i>
              </Anchor>
            )}
          </Chart>,
        ),
      );
    draw(true);
    await settle(ref.current!);
    expect(ref.current!.root.querySelector("i")).not.toBeNull();
    draw(false);
    expect(host.querySelector("i")).toBeNull();
    draw(true);
    await settle(ref.current!);
    expect(ref.current!.root.querySelector("i")).not.toBeNull();
  });

  it("anchors once through StrictMode's double mount, and at an item from a click", async () => {
    const sales = table({ region: ["N", "S"], v: [3, 5] });
    const ref: { current: HercegChart | null } = { current: null };
    function App() {
      const [open, setOpen] = useState<string | null>(null);
      return (
        <Chart
          ref={ref}
          onClick={({ target }) => setOpen(target?.kind === "item" ? target.item : null)}
        >
          <Bar data={sales} id="bars" x="region" y="v" itemKey="region" />
          {open && (
            <Anchor at={{ item: open }} side="top">
              <em>{open}</em>
            </Anchor>
          )}
        </Chart>
      );
    }
    act(() =>
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      ),
    );
    const chart = ref.current!;
    await settle(chart);
    const { plot } = chart.getPanels()[0]!;
    const rect = chart.root.getBoundingClientRect();
    const [x, y] = [
      rect.left + chart.toPixel(1, { axis: "x" })!,
      rect.top + plot.y + plot.height - 5,
    ];
    const init = {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
      pointerId: 1,
      isPrimary: true,
    };
    await act(async () => {
      chart.root.dispatchEvent(new PointerEvent("pointermove", init));
      chart.root.dispatchEvent(new PointerEvent("pointerdown", init));
      chart.root.dispatchEvent(new PointerEvent("pointerup", init));
      await frame();
    });
    await settle(chart);
    const shown = chart.root.querySelectorAll("em");
    expect([...shown].map((element) => element.textContent)).toEqual([
      JSON.stringify(["bars", "S"]),
    ]);
    const place = bottomOf(chart, shown[0]!.parentElement!);
    expect(Math.abs(place.y - chart.toPixel(5, { axis: "y" })!)).toBeLessThanOrEqual(1);
  });

  it.each([
    ["alike", "tag", false],
    ["left out", undefined, false],
    ["alike, in a panel", "tag", true],
    ["left out, in a panel", undefined, true],
  ])("keeps each anchor's element through keyed fragments, its key %s", async (_, key, inPanel) => {
    const ref: { current: HercegChart | null } = { current: null };
    const draw = (groups: string[]) =>
      act(() =>
        root.render(
          <Chart ref={ref}>
            {((fragments) => (inPanel ? <Panel id="p">{fragments}</Panel> : fragments))(
              groups.map((group) => (
                <Fragment key={group}>
                  <Line data={metrics} x="t" y="a" />
                  <Anchor key={key} at={{ x: 1, y: 4 }}>
                    <i>{group}</i>
                  </Anchor>
                </Fragment>
              )),
            )}
          </Chart>,
        ),
      );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      draw(["a", "b"]);
      await settle(ref.current!);
      const b = [...host.querySelectorAll("i")].find((i) => i.textContent === "b");
      draw(["b"]);
      await settle(ref.current!);
      expect([...host.querySelectorAll("i")].map((i) => i.textContent)).toEqual(["b"]);
      expect(host.querySelector("i")).toBe(b);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it.each([
    ["", false],
    [", in a panel", true],
  ])(
    "keeps each anchor's element where a fragment's key and its own read as another's%s",
    async (_, inPanel) => {
      const ref: { current: HercegChart | null } = { current: null };
      const draw = (shown: boolean) =>
        act(() =>
          root.render(
            <Chart ref={ref}>
              <Line data={metrics} x="t" y="a" />
              {((anchors) => (inPanel ? <Panel id="p">{anchors}</Panel> : anchors))([
                shown && (
                  <Fragment key="a">
                    <Anchor key="b" at={{ x: 1, y: 4 }}>
                      <i>gone</i>
                    </Anchor>
                  </Fragment>
                ),
                // `Children.toArray` keys this ".$a.$b", as it does "b" in the fragment above.
                <Anchor key="a.$b" at={{ x: 1, y: 4 }}>
                  <i>kept</i>
                </Anchor>,
              ])}
            </Chart>,
          ),
        );
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        draw(true);
        await settle(ref.current!);
        const kept = [...host.querySelectorAll("i")].find((i) => i.textContent === "kept");
        draw(false);
        await settle(ref.current!);
        expect([...host.querySelectorAll("i")].map((i) => i.textContent)).toEqual(["kept"]);
        expect(host.querySelector("i")).toBe(kept);
        expect(errors).not.toHaveBeenCalled();
      } finally {
        errors.mockRestore();
      }
    },
  );

  it("keeps each anchor's element where a panel's id and its key read as another's", async () => {
    const ref: { current: HercegChart | null } = { current: null };
    const draw = (shown: boolean) =>
      act(() =>
        root.render(
          <Chart ref={ref}>
            <Columns>
              <Panel id="p">
                <Line data={metrics} x="t" y="a" />
                {shown && (
                  <Anchor key="x/.$.$y" at={{ x: 1, y: 4 }}>
                    <i>gone</i>
                  </Anchor>
                )}
              </Panel>
              {/* Its anchor's key in its panel, ".$.$y", after this id reads as the one above after "p". */}
              <Panel id="p/.$.$x">
                <Line data={metrics} x="t" y="a" />
                <Anchor key="y" at={{ x: 1, y: 4 }}>
                  <i>kept</i>
                </Anchor>
              </Panel>
            </Columns>
          </Chart>,
        ),
      );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      draw(true);
      await settle(ref.current!);
      const kept = [...host.querySelectorAll("i")].find((i) => i.textContent === "kept");
      draw(false);
      await settle(ref.current!);
      expect([...host.querySelectorAll("i")].map((i) => i.textContent)).toEqual(["kept"]);
      expect(host.querySelector("i")).toBe(kept);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it("moves when a coordinate changes kind: a Date after its text", async () => {
    const ref: { current: HercegChart | null } = { current: null };
    const draw = (x: string | Date) =>
      act(() =>
        root.render(
          <Chart ref={ref} onError={() => {}}>
            <Line data={metrics} x="t" y="a" />
            <Anchor at={{ x, y: 4 }}>
              <i>held</i>
            </Anchor>
          </Chart>,
        ),
      );
    const when = new Date(1);
    draw(when.toISOString());
    await settle(ref.current!);
    const shown = () => host.querySelector("i")!.getBoundingClientRect().width > 0;
    expect(shown()).toBe(false);
    draw(when);
    await settle(ref.current!);
    expect(shown()).toBe(true);
  });

  it("anchors in the panel it is in, beside the chart's own", async () => {
    const ref: { current: HercegChart | null } = { current: null };
    act(() =>
      root.render(
        <Chart ref={ref}>
          <Columns>
            <Panel id="a">
              <Line data={metrics} x="t" y="a" />
              <Anchor at={{ x: 1, y: 4 }}>
                <i>a</i>
              </Anchor>
            </Panel>
            <Panel id="b">
              <Line data={metrics} x="t" y="a" />
              <Anchor at={{ x: 1, y: 4 }}>
                <i>b</i>
              </Anchor>
            </Panel>
          </Columns>
          <Anchor at={{ x: 2, y: 4 }} panel="b">
            <i>chart</i>
          </Anchor>
        </Chart>,
      ),
    );
    const chart = ref.current!;
    await settle(chart);
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

  it("goes with its chart, and refuses to render outside one", async () => {
    const ref: { current: HercegChart | null } = { current: null };
    act(() =>
      root.render(
        <Chart ref={ref}>
          <Line data={metrics} x="t" y="a" />
          <Anchor at={{ x: 1, y: 4 }}>
            <i>held</i>
          </Anchor>
        </Chart>,
      ),
    );
    await settle(ref.current!);
    act(() => root.render(null));
    expect(host.querySelector("i")).toBeNull();
    expect(() =>
      renderToString(
        <Anchor at={{ x: 1, y: 1 }}>
          <i>lost</i>
        </Anchor>,
      ),
    ).toThrow("<Anchor> must be among the children of a <Chart>");
  });

  it("renders nothing on the server", () => {
    const markup = renderToString(
      <Chart>
        <Line data={metrics} x="t" y="a" />
        <Anchor at={{ x: 1, y: 4 }}>
          <i>held</i>
        </Anchor>
      </Chart>,
    );
    expect(markup).not.toContain("held");
  });
});
