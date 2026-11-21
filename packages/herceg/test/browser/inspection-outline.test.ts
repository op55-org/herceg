// The inspected item's outline (`theme.style.inspectionOutline`): the role
// on the pointer's and the pinned tooltip's outline, and the keyboard's
// cursor, which always draws the default look (the theme's text color at
// 2 pixels) and still marks what it is on without the tooltip, in every
// family with items or points.
import "./interactive.ts";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { fromGeoJSON } from "../../src/data/geojson.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { candlestick } from "../../src/marks/candlestick.ts";
import { custom } from "../../src/marks/custom.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { funnel } from "../../src/marks/funnel.ts";
import { gauge } from "../../src/marks/gauge.ts";
import { geopoint } from "../../src/marks/geopoint.ts";
import { geoshape } from "../../src/marks/geoshape.ts";
import { graph } from "../../src/marks/graph.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import type { ItemInfo } from "../../src/marks/layout-mark.ts";
import { line } from "../../src/marks/line.ts";
import { line3d } from "../../src/marks/line3d.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { radar } from "../../src/marks/radar.ts";
import { sankey } from "../../src/marks/sankey.ts";
import { sunburst } from "../../src/marks/sunburst.ts";
import { surface } from "../../src/marks/surface.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { resolveTheme } from "../../src/theme.ts";
import { contractTest } from "../helpers/contracts.ts";
import { MOUSE } from "./helpers.ts";

const charts: Chart[] = [];
afterEach(() => {
  for (const chart of charts.splice(0)) {
    const host = chart.root.parentElement;
    chart.destroy();
    host?.remove();
  }
});

/** Destroys `chart` and its host now, rather than after the test. */
function unmount(chart: Chart) {
  charts.splice(charts.indexOf(chart), 1);
  chart.root.parentElement?.remove();
  chart.destroy();
}

async function mount(options: ChartOptions): Promise<Chart> {
  const host = document.createElement("div");
  host.style.cssText = "width:400px;height:300px";
  document.body.append(host);
  const chart = createChart(host, {
    errorMode: "throw",
    renderer: "svg",
    locale: "en-US",
    ...options,
  });
  charts.push(chart);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  chart.render();
  return chart;
}

const sales = table({
  region: ["North", "South", "East", "West"],
  revenue: [40, 25, 20, 15],
});
const tree = table({
  region: ["North", "North", "South", "South"],
  city: ["Oslo", "Bergen", "Rome", "Milan"],
  value: [4, 2, 3, 1],
});
const flows = table({
  from: ["Coal", "Gas", "Gas", "Wind"],
  to: ["Grid", "Grid", "Heat", "Grid"],
  twh: [5, 3, 2, 4],
});
const players = table({ name: ["Ana", "Bo"], speed: [7, 5], power: [4, 8], range: [6, 6] });
const metrics = table({
  t: [0, 1, 2, 3, 4],
  a: [3, 5, 4, 6, 5],
  b: [1, 2, 2, 3, 2],
  host: ["east", "west", "east", "west", "east"],
});

/** The ring around the keyboard cursor's point on a series, last in the chart's overlay. */
const ringOf = (chart: Chart) =>
  chart.root.querySelector<SVGCircleElement>("svg circle[r='6.5'][fill='none']")!;

/** The item outline the chart draws over itself, just before the ring. */
const outlineOf = (chart: Chart) => ringOf(chart).previousElementSibling as SVGPathElement;

/** How an element is stroked, by its attributes, and whether it shows. */
function paintOf(element: Element) {
  return {
    stroke: element.getAttribute("stroke"),
    width: element.getAttribute("stroke-width"),
    dash: element.getAttribute("stroke-dasharray"),
    opacity: element.getAttribute("stroke-opacity") ?? "1",
    shown: element.getAttribute("visibility") === "visible",
  };
}

const LIGHT = resolveTheme("light");
/** The default look, which the keyboard's cursor always draws. */
const DEFAULT = { stroke: LIGHT.text, width: "2", dash: null, opacity: "1", shown: true };

/** A point inside an item drawn: its sector's middle, or its box's. */
function inside(chart: Chart, { box, sector }: ItemInfo): [number, number] {
  const rect = chart.root.getBoundingClientRect();
  if (sector) {
    const angle = (sector.startAngle + sector.endAngle) / 2;
    const radius = (sector.innerRadius + sector.outerRadius) / 2;
    return [
      rect.left + sector.cx + radius * Math.sin(angle),
      rect.top + sector.cy - radius * Math.cos(angle),
    ];
  }
  return [rect.left + box.x + box.width / 2, rect.top + box.y + box.height / 2];
}

/** The item of `mark` named `name` last among its names (a slice's category, a node's own name). */
function itemOf(chart: Chart, mark: string, name: string): ItemInfo {
  return chart.getItems({ mark })!.items.find(({ names }) => names.at(-1) === name)!;
}

/** Whether the chart's own tooltip box shows. */
const tooltipShown = (chart: Chart) =>
  [...chart.root.children].some(
    (child) =>
      child instanceof HTMLDivElement &&
      child.style.padding === "8px 10px" &&
      child.style.display === "block",
  );

function hover(chart: Chart, [clientX, clientY]: [number, number]) {
  chart.root.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, clientX, clientY, pointerId: MOUSE }),
  );
  chart.render();
}

function leave(chart: Chart) {
  chart.root.dispatchEvent(new PointerEvent("pointerleave", { pointerId: MOUSE }));
  chart.render();
}

function clickAt(chart: Chart, [clientX, clientY]: [number, number]) {
  for (const type of ["pointerdown", "pointerup"])
    chart.root.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX, clientY, pointerId: MOUSE, button: 0 }),
    );
  chart.root.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY }));
  chart.render();
}

function press(chart: Chart, key: string) {
  chart.root.focus();
  chart.root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  chart.render();
}

const ORANGE = { stroke: "#ff8800", strokeWidth: 3, dash: [4, 2], opacity: 0.5 };
const orange = { stroke: "#ff8800", width: "3", dash: "4 2", opacity: "0.5", shown: true };
const pieOf = (style?: object, options: Partial<ChartOptions> = {}) =>
  mount({
    marks: [pie(sales, { id: "pie", category: "region", value: "revenue" })],
    ...(style ? { theme: { style: { inspectionOutline: style } } } : {}),
    ...options,
  });

describe("the inspected item's outline", () => {
  contractTest("inspection.outline.role.engine", async () => {
    // By default the text color at 2 pixels, as before the role.
    const plain = await pieOf();
    hover(plain, inside(plain, itemOf(plain, "pie", "North")));
    expect(paintOf(outlineOf(plain))).toEqual(DEFAULT);
    // The role styles the pointer's outline...
    const chart = await pieOf(ORANGE, { tooltip: { pin: "click" } });
    const south = inside(chart, itemOf(chart, "pie", "South"));
    hover(chart, south);
    expect(paintOf(outlineOf(chart))).toEqual(orange);
    // ...and the pinned tooltip's, once the pointer has gone.
    clickAt(chart, south);
    expect(chart.pinned).toEqual({ item: expect.stringContaining("South"), panel: "" });
    leave(chart);
    expect(paintOf(outlineOf(chart))).toEqual(orange);
    // The keyboard's cursor keeps the default whatever the role says.
    press(chart, "ArrowRight");
    expect(paintOf(outlineOf(chart))).toEqual(DEFAULT);
  });

  contractTest(
    "inspection.outline.none.engine",
    async () => {
      for (const style of [{ stroke: "none" }, { strokeWidth: 0 }, { opacity: 0 }]) {
        const chart = await pieOf(style, { tooltip: { pin: "click" } });
        const north = inside(chart, itemOf(chart, "pie", "North"));
        const drawsNothing = () => {
          const drawn = getComputedStyle(outlineOf(chart));
          return (
            drawn.stroke === "none" ||
            Number.parseFloat(drawn.strokeWidth) === 0 ||
            Number(drawn.strokeOpacity) === 0
          );
        };
        // The tooltip still shows what the pointer is on; the outline draws nothing.
        hover(chart, north);
        expect(tooltipShown(chart)).toBe(true);
        expect(drawsNothing()).toBe(true);
        clickAt(chart, north);
        leave(chart);
        expect(chart.pinned).not.toBeNull();
        expect(drawsNothing()).toBe(true);
      }
    },
    "stroke none, a zero width, or a zero opacity leaves the pointer's and the pin's outline out",
  );

  it("draws no outline on a sunburst's sectors under the pointer with stroke none, as B3's reference", async () => {
    const chart = await mount({
      marks: [
        sunburst(tree, { id: "flare", path: ["region", "city"], value: "value", center: false }),
      ],
      theme: { style: { inspectionOutline: { stroke: "none" } } },
    });
    for (const name of ["North", "Oslo", "Rome"]) {
      hover(chart, inside(chart, itemOf(chart, "flare", name)));
      expect(getComputedStyle(outlineOf(chart)).stroke).toBe("none");
      expect(outlineOf(chart).getAttribute("d")).toMatch(/A/);
    }
  });

  contractTest(
    "inspection.outline.keyboard.engine",
    async () => {
      for (const style of [
        undefined,
        { stroke: "none" },
        { strokeWidth: 0 },
        { opacity: 0 },
        ORANGE,
      ]) {
        const chart = await pieOf(style);
        press(chart, "ArrowRight");
        expect(paintOf(outlineOf(chart))).toEqual(DEFAULT);
        expect(getComputedStyle(outlineOf(chart)).stroke).not.toBe("none");
        press(chart, "ArrowRight");
        expect(paintOf(outlineOf(chart))).toEqual(DEFAULT);
      }
      // The theme's text color, as tokens set it, on a dark theme too.
      const dark = await pieOf(
        { stroke: "none" },
        { theme: { extends: "dark", style: { inspectionOutline: { stroke: "none" } } } },
      );
      press(dark, "ArrowRight");
      expect(paintOf(outlineOf(dark))).toEqual({ ...DEFAULT, stroke: resolveTheme("dark").text });
    },
    "the keyboard's cursor draws the text color at 2 pixels whatever the role says",
  );

  it("hands one outline from a pin to the keyboard's cursor on another item, in the default look", async () => {
    const chart = await pieOf({ stroke: "none" }, { tooltip: { pin: "click" } });
    // South pinned; the keyboard's first step goes to North.
    clickAt(chart, inside(chart, itemOf(chart, "pie", "South")));
    leave(chart);
    const pinned = outlineOf(chart).getAttribute("d");
    expect(paintOf(outlineOf(chart))).toMatchObject({ stroke: "none" });
    press(chart, "ArrowRight");
    expect(outlineOf(chart).getAttribute("d")).not.toBe(pinned);
    expect(paintOf(outlineOf(chart))).toEqual(DEFAULT);
    // The pointer back over the pie takes over, in the role's look.
    hover(chart, inside(chart, itemOf(chart, "pie", "East")));
    expect(paintOf(outlineOf(chart))).toMatchObject({ stroke: "none" });
  });

  contractTest(
    "inspection.outline.forced.engine",
    async (context) => {
      if (!(await commands.forcedColors(true))) {
        await commands.forcedColors(false);
        context.skip("this engine emulates no forced colors");
      }
      try {
        for (const style of [{ stroke: "none" }, ORANGE]) {
          const chart = await pieOf(style);
          press(chart, "ArrowRight");
          expect(paintOf(outlineOf(chart))).toEqual(DEFAULT);
          const drawn = getComputedStyle(outlineOf(chart));
          expect(drawn.stroke).not.toBe("none");
          expect(drawn.strokeWidth).toBe("2px");
        }
      } finally {
        await commands.forcedColors(false);
      }
    },
    "under forced colors the keyboard's outline is the default look",
  );

  it("finds nothing to fix in a chart whose role draws none, focused by keyboard", async () => {
    const chart = await pieOf({ stroke: "none" }, { title: "Revenue" });
    press(chart, "ArrowRight");
    const results = await axe.run(chart.root, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
      },
      rules: { region: { enabled: false }, "page-has-heading-one": { enabled: false } },
    });
    expect(results.passes.length).toBeGreaterThan(0);
    expect(results.violations.map(({ id }) => id)).toEqual([]);
    expect(paintOf(outlineOf(chart))).toEqual(DEFAULT);
  });
});

/** A square region of a map, `size` degrees wide, west edge at `west`. */
const region = (west: number, size: number) => [
  [west, 0],
  [west + size, 0],
  [west + size, size],
  [west, size],
  [west, 0],
];
const countries = fromGeoJSON({
  type: "FeatureCollection",
  features: [0, 1, 2].map((i) => ({
    type: "Feature" as const,
    properties: { name: `C${i}` },
    geometry: { type: "Polygon" as const, coordinates: [region(i * 10, 8)] },
  })),
});
const places = table({ lon: [0, 10, 20], lat: [0, 5, 10], name: ["a", "b", "c"] });
const cloud = table({ x: [0, 1, 2, 3], y: [1, 0, 2, 1], z: [0, 1, 1, 2] });
const prices = table({
  t: [0, 1, 2, 3],
  open: [10, 12, 11, 13],
  high: [13, 14, 13, 15],
  low: [9, 10, 10, 12],
  close: [12, 11, 13, 14],
});
const spans = table({
  id: ["F-0", "F-1", "F-2"],
  start: [10, 20, 30],
  end: [40, 50, 60],
  category: ["a", "a", "a"],
});

/** Charts of each family with items. */
const ITEM_FAMILIES: [string, ChartOptions["marks"]][] = [
  ["a pie", [pie(sales, { category: "region", value: "revenue" })]],
  ["a donut", [pie(sales, { category: "region", value: "revenue", innerRadius: 0.5 })]],
  ["a sunburst", [sunburst(tree, { path: ["region", "city"], value: "value" })]],
  ["a treemap", [treemap(tree, { path: ["region", "city"], value: "value" })]],
  ["a network", [graph(flows, { source: "from", target: "to", value: "twh" })]],
  ["a Sankey diagram", [sankey(flows, { source: "from", target: "to", value: "twh" })]],
  ["a funnel", [funnel(sales, { category: "region", value: "revenue" })]],
  ["a gauge", [gauge(table({ cpu: [73] }), { value: "cpu", label: "CPU" })]],
  ["a radar", [radar(players, { fields: ["speed", "power", "range"], series: "name" })]],
  ["a map's regions", [geoshape(countries, { labelField: "name" })]],
  ["a map's points", [geopoint(places, { longitude: "lon", latitude: "lat" })]],
  ["3D points", [point3d(cloud, { x: "x", y: "y", z: "z" })]],
  ["a 3D line", [line3d(cloud, { x: "x", y: "y", z: "z" })]],
  [
    "a surface",
    [
      surface(table({ x: [0, 1, 0, 1], y: [0, 0, 1, 1], z: [1, 2, 3, 4] }), {
        x: "x",
        y: "y",
        z: "z",
      }),
    ],
  ],
];

/** Charts of each family with points on series. */
const POINT_FAMILIES: [string, ChartOptions["marks"]][] = [
  ["lines", [line(metrics, { x: "t", y: ["a", "b"] })]],
  ["points", [point(metrics, { x: "t", y: "a" })]],
  ["bars", [bar(metrics, { x: "host", y: "a" })]],
  ["areas", [area(metrics, { x: "t", y: "a" })]],
  ["a heatmap", [heatmap(metrics, { x: "t", y: "host", color: "a" })]],
  ["box plots", [boxplot(metrics, { x: "host", y: "a" })]],
  ["error bars", [errorbar(metrics, { x: "t", y1: "b", y2: "a" })]],
  [
    "candles",
    [candlestick(prices, { x: "t", open: "open", high: "high", low: "low", close: "close" })],
  ],
  [
    "custom range items",
    [
      custom(spans, {
        x: ["start", "end"],
        y: "id",
        series: "category",
        itemKey: "id",
        draw({ table: t, series, x, y, item, rect }) {
          const end = t.numbers("end");
          for (const s of series)
            for (let k = 0; k < s.length; k++) {
              const row = s.rowAt(k);
              item(s, row, () =>
                rect(x(s.x[row]!), y(s.y[row]!) - 4, x(end[row]!) - x(s.x[row]!), 8, {
                  fill: s.color,
                }),
              );
            }
        },
      }),
    ],
  ],
];

/** Markers of inspected points, which the chart draws just before the outline. */
const dotsOf = (chart: Chart) => outlineOf(chart).previousElementSibling!;

/** That the chart draws its keyboard's mark alone: no crosshair, dots, or tooltip. */
function expectAlone(chart: Chart, name: string) {
  expect([...chart.root.querySelectorAll("svg line[visibility='visible']")], name).toEqual([]);
  expect(dotsOf(chart).childElementCount, name).toBe(0);
  expect(tooltipShown(chart), name).toBe(false);
}

describe("the keyboard's mark without the tooltip", () => {
  contractTest(
    "inspection.outline.untipped.engine",
    async () => {
      for (const listening of [false, true])
        for (const [name, marks] of ITEM_FAMILIES) {
          // Where the cursor's item is outlined with the tooltip.
          const tipped = await mount({ marks });
          press(tipped, "ArrowRight");
          const d = outlineOf(tipped).getAttribute("d");
          expect(paintOf(outlineOf(tipped)), name).toEqual(DEFAULT);
          const chart = await mount({
            tooltip: false,
            marks,
            theme: { style: { inspectionOutline: { stroke: "none" } } },
          });
          if (listening) chart.on("hover", () => {});
          press(chart, "ArrowRight");
          expect(paintOf(outlineOf(chart)), name).toEqual(DEFAULT);
          expect(outlineOf(chart).getAttribute("d"), name).toBe(d);
          expectAlone(chart, name);
          // Each family's charts go before the next mount, so the page keeps
          // two charts and their contexts, not ninety.
          unmount(tipped);
          unmount(chart);
        }
      for (const listening of [false, true])
        for (const [name, marks] of POINT_FAMILIES) {
          // Where the cursor's point is ringed with the tooltip.
          const tipped = await mount({ marks });
          press(tipped, "ArrowRight");
          const at = [ringOf(tipped).getAttribute("cx"), ringOf(tipped).getAttribute("cy")];
          expect(paintOf(ringOf(tipped)).shown, name).toBe(true);
          const chart = await mount({ tooltip: false, marks });
          if (listening) chart.on("hover", () => {});
          press(chart, "ArrowRight");
          const ring = ringOf(chart);
          expect(paintOf(ring).shown, name).toBe(true);
          expect(ring.getAttribute("stroke"), name).toBe(LIGHT.text);
          expect([ring.getAttribute("cx"), ring.getAttribute("cy")], name).toEqual(at);
          expectAlone(chart, name);
          unmount(tipped);
          unmount(chart);
        }
    },
    "with tooltip false, the keyboard's cursor still draws its outline or ring, and nothing else",
  );

  it("leaves the pointer's cursor to the application, and other charts' cursors out while the keyboard's shows", async () => {
    const chart = await mount({
      tooltip: false,
      marks: [pie(sales, { id: "pie", category: "region", value: "revenue" })],
    });
    hover(chart, inside(chart, itemOf(chart, "pie", "North")));
    expect(paintOf(outlineOf(chart)).shown).toBe(false);
    leave(chart);
    // A cursor shown on a chart of series, then the keyboard's.
    const lines = await mount({
      tooltip: false,
      marks: [line(metrics, { x: "t", y: ["a", "b"] })],
    });
    lines.showCursor({ x: 2 });
    lines.render();
    expect(lines.root.querySelectorAll("svg line[visibility='visible']")).toHaveLength(1);
    press(lines, "ArrowRight");
    expect(paintOf(ringOf(lines)).shown).toBe(true);
    expectAlone(lines, "a shown cursor");
  });

  it("rings the keyboard's point where the inspection there reads nothing, with or without the tooltip", async () => {
    // An unsorted line read at the previous point: nothing precedes x = 0.
    const unsorted = table({ x: [1, 0, 2], y: [20, 30, 40] });
    for (const tooltip of [true, false]) {
      const chart = await mount({
        tooltip,
        inspection: { mode: "nearest-x", snap: "previous" },
        marks: [line(unsorted, { x: "x", y: "y" })],
      });
      const points = [0, 1, 2].map((row) => [
        String(chart.toPixel(unsorted.numbers("x")[row]!, { axis: "x" })),
        String(chart.toPixel(unsorted.numbers("y")[row]!, { axis: "y" })),
      ]);
      for (const key of ["ArrowRight", "ArrowRight", "ArrowRight"]) {
        press(chart, key);
        const ring = ringOf(chart);
        expect(paintOf(ring).shown).toBe(true);
        expect(points.map(String)).toContain(
          String([ring.getAttribute("cx"), ring.getAttribute("cy")]),
        );
      }
    }
  });
});
