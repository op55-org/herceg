// Layout items' geometry as drawn (`getItems`), decorations placed by it in
// the same frame, during value transitions too, and bars along a rank y.

import "./interactive.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { category } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { bar } from "../../src/marks/bar.ts";
import { gauge } from "../../src/marks/gauge.ts";
import type { ItemInfo } from "../../src/marks/layout-mark.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { sunburst } from "../../src/marks/sunburst.ts";
import { text } from "../../src/marks/text.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { xScale, yScale } from "../helpers/scales.ts";
import { modelOf } from "./helpers.ts";
import { heard, pointer } from "./interaction/helpers.ts";

const charts: Chart[] = [];

afterEach(() => {
  for (const chart of charts.splice(0)) {
    const host = chart.root.parentElement;
    chart.destroy();
    host?.remove();
  }
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** A chart at the top of the page, once what it loads has loaded. */
async function mount(options: ChartOptions, renderer: "svg" | "canvas" = "svg"): Promise<Chart> {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:400px";
  document.body.append(host);
  const chart = createChart(host, { locale: "en-US", renderer, ...options });
  charts.push(chart);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  chart.render();
  return chart;
}

const sales = () =>
  table({
    market: category(["Auburn, AL", "Auburn, AL", "Birmingham, AL"]),
    segment: category(["Almond lovers", "Berry buyers", "Almond lovers"]),
    value: [3840, 1920, 1600],
  });
const markets = () => table({ market: category(["Auburn, AL", "Birmingham, AL"]) });

/** Where text reading `label` is drawn in the chart's SVG layer. */
function textAt(chart: Chart, label: string): [number, number] | undefined {
  const found = [...chart.root.querySelectorAll("svg text")].find(
    (node) => node.textContent === label,
  );
  return found && [Number(found.getAttribute("x")), Number(found.getAttribute("y"))];
}

describe("getItems", () => {
  it("gives copies of the items the frame on screen drew, with the revision `render` reports", async () => {
    const host = document.createElement("div");
    host.style.cssText = "width:600px;height:400px";
    document.body.append(host);
    // The page's first chart painting marks out of order loads the code that plans it before it draws.
    const chart = createChart(host, {
      marks: [
        treemap(sales(), { id: "cells", path: ["market", "segment"], value: "value" }),
        text(markets(), {
          from: { mark: "cells", item: [{ field: "market" }], at: "center" },
          label: { field: "market" },
          zIndex: -1,
        }),
      ],
    });
    charts.push(chart);
    expect(chart.loading).toBeDefined();
    // Nothing is drawn before the first frame.
    expect(chart.getItems({ mark: "cells" })).toBeUndefined();
    const renders: number[] = [];
    chart.on("render", ({ revision }) => renders.push(revision));
    await chart.loading;
    await frame();
    await frame();
    const first = chart.getItems({ mark: "cells" })!;
    expect(first.revision).toBe(renders.at(-1));
    // In reading order, the keyboard's: each node, then its children, the larger first.
    expect(first.items.map((item) => item.names)).toEqual([
      ["Auburn, AL"],
      ["Auburn, AL", "Almond lovers"],
      ["Auburn, AL", "Berry buyers"],
      ["Birmingham, AL"],
      ["Birmingham, AL", "Almond lovers"],
    ]);
    // Copies: what the caller changes is its own.
    (first.items[0]!.box as { x: number }).x = -1;
    expect(chart.getItems({ mark: "cells" })!.items[0]!.box.x).not.toBe(-1);
    // A change is drawn, and reported, with its revision.
    chart.update({ marks: [treemap(sales(), { id: "cells", path: ["market"], value: "value" })] });
    await frame();
    await frame();
    const second = chart.getItems({ mark: "cells" })!;
    expect(second.revision).toBe(renders.at(-1));
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(second.items).toHaveLength(2);
  });

  it("gives nothing in charts without layout marks, and refuses ids of none in charts with them", async () => {
    const chart = await mount({
      marks: [line(table({ t: [1, 2], v: [1, 2] }), { id: "lines", x: "t", y: "v" })],
    });
    // A chart without layout marks has no items, as it has no drill root.
    expect(chart.getItems({ mark: "lines" })).toBeUndefined();
    const tree = await mount({
      marks: [treemap(sales(), { id: "cells", path: ["market"], value: "value" })],
    });
    expect(() => tree.getItems({ mark: "nope" })).toThrow(
      'getItems mark: no mark has id "nope"; name one of "cells"',
    );
    expect(() => tree.getItems({ mark: "cells", panel: "a" })).toThrow(
      /^getItems panel: "cells" is drawn in panels .*, not "a"/,
    );
    // Nor once a chart's layout marks are gone.
    tree.update({
      marks: [line(table({ t: [1, 2], v: [1, 2] }), { id: "lines", x: "t", y: "v" })],
    });
    await frame();
    expect(tree.getItems({ mark: "lines" })).toBeUndefined();
    expect(tree.getItems({ mark: "cells" })).toBeUndefined();
  });
});

describe("decorations", () => {
  it("draw B8's names above the columns and rules at their edges, picked over the treemap", async () => {
    for (const renderer of ["svg", "canvas"] as const) {
      const chart = await mount(
        {
          padding: { top: 28 },
          marks: [
            treemap(sales(), {
              id: "cells",
              path: ["market", "segment"],
              value: "value",
              labels: false,
            }),
            text(markets(), {
              id: "names",
              from: {
                mark: "cells",
                item: [{ field: "market" }],
                at: "top-left",
                offset: { x: 3, y: -16 },
              },
              label: { field: "market" },
            }),
            rule(markets(), {
              id: "edges",
              pick: false,
              x: { item: { mark: "cells", item: [{ field: "market" }] }, at: "start" },
            }),
          ],
        },
        renderer,
      );
      const columns = chart.getItems({ mark: "cells" })!.items.filter((c) => c.depth === 1);
      const { box } = columns[1]!;
      // Canvas holds its text; SVG's shows it hung from the column's top left corner.
      const [x, y] = textAt(chart, "Birmingham, AL") ?? [box.x + 3, box.y - 10];
      expect(x).toBeCloseTo(box.x + 3, 0);
      expect(y).toBeLessThan(box.y);
      expect(y).toBeGreaterThan(box.y - 16);
      // The name is picked above the treemap; the rule lets the pointer through to the cells.
      const clicks = heard(chart, "click");
      for (const [px, py] of [
        [x + 4, y],
        [box.x, box.y + 40],
      ] as const) {
        pointer(chart, "pointerdown", px, py);
        pointer(chart, "pointerup", px, py);
        await frame();
      }
      expect(clicks.map(({ target }) => target)).toMatchObject([
        { kind: "item", markId: "names" },
        { kind: "item", markId: "cells" },
      ]);
    }
  });

  it("take their own clicks over a tree that drills, unless they pick nothing", async () => {
    const press = async (chart: Chart, x: number, y: number) => {
      pointer(chart, "pointerdown", x, y);
      pointer(chart, "pointerup", x, y);
      await frame();
    };
    for (const pick of [true, false]) {
      // A band over the whole treemap: a click on a group's strip under it.
      const tiles = await mount({
        interaction: { zoom: true },
        marks: [
          treemap(sales(), { id: "cells", path: ["market", "segment"], value: "value" }),
          region({ x1: { fraction: 0 }, x2: { fraction: 1 }, fillOpacity: 0.1, pick }),
        ],
      });
      const group = tiles.getItems({ mark: "cells" })!.items.find((item) => item.depth === 1)!;
      await press(tiles, group.box.x + 4, group.box.y + 4);
      expect(tiles.getDrillRoot()?.key ?? null).toBe(pick ? null : group.key);
      // A name in a drilled sunburst's empty middle: a click on it stays.
      const rings = await mount({
        interaction: { zoom: true },
        marks: [
          sunburst(sales(), {
            id: "rings",
            path: ["market", "segment"],
            value: "value",
            center: false,
          }),
          text({ at: { x: { fraction: 0.5 }, y: { fraction: 0.5 } }, label: "Market", pick }),
        ],
      });
      rings.setDrillRoot(["Auburn, AL"]);
      await frame();
      const [x, y] = textAt(rings, "Market")!;
      await press(rings, x + 4, y - 3);
      expect(rings.getDrillRoot()?.key ?? null).toBe(pick ? '["rings","Auburn, AL"]' : null);
    }
  });

  it("follow a pie's slices through a value transition, in the frame that draws them", async () => {
    const shares = table({ region: category(["N", "S", "E"]), sales: [10, 20, 30] });
    const chart = await mount({
      animation: { duration: 300, values: true },
      marks: [
        pie(shares, {
          id: "slices",
          category: "region",
          value: "sales",
          sort: "input",
          labels: false,
        }),
        text(shares, {
          from: { mark: "slices", item: [{ field: "region" }], at: "center" },
          label: { field: "region" },
        }),
      ],
    });
    await frame();
    await frame();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    chart.render();
    vi.advanceTimersByTime(16);
    const centerOf = ({ box }: ItemInfo) => [box.x + box.width / 2, box.y + box.height / 2];
    const before = chart.getItems({ mark: "slices" })!.items.map(centerOf);
    const frames: { items: number[][]; text: (number[] | undefined)[] }[] = [];
    chart.on("render", () => {
      const items = chart.getItems({ mark: "slices" })!.items;
      frames.push({
        items: items.map(centerOf),
        text: items.map(({ names }) => textAt(chart, names[0]!)),
      });
    });
    shares.setColumn("sales", [30, 20, 10]);
    for (let k = 0; k < 30; k++) vi.advanceTimersByTime(16);
    // Frames between move the slices, and the names with them, in each frame.
    const moving = frames.filter(({ items }) => items.some((c, i) => c[0] !== before[i]![0]));
    expect(moving.length).toBeGreaterThan(3);
    const middle = moving[Math.floor(moving.length / 2)]!.items.flat();
    const last = frames.at(-1)!.items.flat();
    expect(middle.some((v, i) => Math.abs(v - last[i]!) > 5)).toBe(true);
    for (const { items, text: drawn } of frames)
      items.forEach((center, i) => {
        expect(drawn[i]![0]).toBeCloseTo(center[0]!, 0);
        expect(drawn[i]![1]).toBeCloseTo(center[1]!, 0);
      });
  });

  it("stay drawn in pixels beside a gauge while its dial moves", async () => {
    const readings = table({ cpu: [0.2] });
    const chart = await mount({
      animation: { duration: 300, values: true },
      marks: [
        gauge(readings, { value: "cpu", min: 0, max: 1 }),
        text({ at: { x: { fraction: 0.5 }, y: { px: 12 } }, label: "CPU now" }),
      ],
    });
    await frame();
    await frame();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    // A frame on the fake clock, so a slow real frame before it cannot make the change jump.
    chart.render();
    vi.advanceTimersByTime(16);
    const drawn: boolean[] = [];
    chart.on("render", () => drawn.push(textAt(chart, "CPU now") !== undefined));
    readings.setColumn("cpu", [0.9]);
    for (let k = 0; k < 30; k++) vi.advanceTimersByTime(16);
    expect(drawn.length).toBeGreaterThan(3);
    expect(drawn.every(Boolean)).toBe(true);
  });
});

describe("bars along y", () => {
  it("draw B6's bars on a rank scale, in SVG and on canvas alike", async () => {
    const ranked = table({
      brand: category(["IBM", "Apple", "Coca-Cola"]),
      value: [53_183, 40_000, 70_452],
      rank: [1, 2, 0],
    });
    const options: ChartOptions = {
      marks: [bar(ranked, { id: "brands", itemKey: "brand", orient: "y", x: "value", y: "rank" })],
      y: { domain: [2.5, -0.5] },
    };
    const svg = await mount(options, "svg");
    const canvas = await mount(options, "canvas");
    for (const chart of [svg, canvas]) {
      const model = modelOf(chart);
      const y = yScale(model)!;
      const x = xScale(model)!;
      // Each brand's bar runs along its rank, to its value.
      expect(
        chart.inspect(x.map(70_452) - 4, y.map(0), { mode: "nearest" })?.points[0],
      ).toMatchObject({
        markId: "brands",
        row: 2,
      });
      expect(
        chart.inspect(x.map(53_183) - 4, y.map(1), { mode: "nearest" })?.points[0],
      ).toMatchObject({
        row: 0,
      });
    }
  });
});
